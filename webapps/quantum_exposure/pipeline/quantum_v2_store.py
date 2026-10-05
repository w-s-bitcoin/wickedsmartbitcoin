#!/usr/bin/env python3
"""Compact, transactional Quantum projection. Importing this module performs no I/O.

Connections are supplied by the caller (psycopg2); no configuration or production
credentials are loaded here. Mutating APIs require an idle connection and own one
bounded transaction. The coordinator owns scheduling and the global writer lock.
"""
from __future__ import annotations

from collections import defaultdict
from contextlib import contextmanager
from functools import lru_cache
import hashlib
import json
from pathlib import Path
import re
from typing import Iterator

import psycopg2
from psycopg2 import sql
from psycopg2.extras import RealDictCursor, execute_values, Json

SCHEMA = 'quantum_v2'
MIGRATIONS = Path(__file__).with_name('migrations')
LEGACY = ('active_key_outputs', 'active_p2sh_outputs', 'active_p2wsh_outputs',
          'active_p2tr_outputs', 'active_bare_ms_outputs')
FAMILIES = {'pubkey': 'P2PK', 'pubkeyhash': 'P2PKH', 'witness_v0_keyhash': 'P2WPKH',
            'scripthash': 'P2SH', 'witness_v0_scripthash': 'P2WSH', 'witness_v1_taproot': 'P2TR'}
STATE_COLUMNS = ('group_id', 'script_type', 'balance_sats', 'utxo_count', 'eligible_sats',
                 'eligible_utxos', 'first_received_height', 'first_disclosure_height',
                 'first_disclosure_hash', 'last_spend_height', 'display_group_id', 'details', 'identity')
ARCHIVE_RE = re.compile(r'^stxos_(\d+)_(\d+)_archive$')
# Match Core's IsUnspendable fast exclusions; keep genesis separately because
# its public key is evidence even though its coinbase never entered chainstate.
NOT_PROVABLE_BURN = "(scripthex IS NULL OR (lower(left(scripthex,2))<>'6a' AND length(scripthex)<=20000))"
# Bitcoin Core src/validation.cpp IsBIP30Repeat/IsBIP30Unspendable. These are
# occurrence removals, never spends. Both canonical hashes must match the exception.
# https://github.com/bitcoin/bitcoin/blob/master/src/validation.cpp
BIP30_REMOVALS = {
    (91722,'e3bf3d07d4b0375638d5f1db5255fe07ba2c4cb067cd81b84ee974b6585fb468',0):
        (91880,'00000000000271a2dc26e7667f8419f2e15416dc6955e5a6c6cdf3f2574dd08e',
         '00000000000743f190a18c5577a3c2d2a1f610ae9601ac046a38084ccb7cd721'),
    (91812,'d5d27987d2a3dfc724e359870c6644b40e497bdc0589a033220fe15429d88599',0):
        (91842,'00000000000af0aed4792b1acee3d966af36cf5def14935db8de83d6f9306f2f',
         '00000000000a4d0a398161ffc163c503763b1f4360639393e0e4c8e300e0caec'),
}


class StoreError(RuntimeError):
    pass


class SourceNotReady(StoreError):
    pass


class ReseedRequired(StoreError):
    pass


class BatchTooLarge(StoreError):
    pass


class PhysicalSeedChanged(ReseedRequired):
    def __init__(self,message,checkpoint):
        super().__init__(message)
        self.checkpoint=checkpoint


def _q(name):
    return sql.Identifier('public', name)


@contextmanager
def transaction(conn):
    if conn.get_transaction_status() != psycopg2.extensions.TRANSACTION_STATUS_IDLE:
        raise StoreError('Store APIs require an idle connection; caller transaction was not changed')
    conn.set_session(isolation_level='REPEATABLE READ', readonly=False, autocommit=False)
    with conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute('SELECT pg_try_advisory_xact_lock(811947, 2) AS owned')
            if not cur.fetchone()['owned']:
                raise StoreError('Another Quantum coordinator owns the global writer lock')
            cur.execute("SET LOCAL work_mem='32MB'")
            cur.execute('SET LOCAL max_parallel_workers_per_gather=0')
            cur.execute("SET LOCAL lock_timeout='2s'")
            cur.execute("SET LOCAL statement_timeout='5min'")
            # Transaction lock is a second guard for callers without the coordinator.
            cur.execute('SELECT pg_try_advisory_xact_lock(811947, 1) AS owned')
            if not cur.fetchone()['owned']:
                raise StoreError('Another Quantum projection transaction owns the writer lock')
            yield cur


def migrate(conn):
    """Apply only store-owned migrations, checking already applied file hashes."""
    with transaction(conn) as cur:
        cur.execute('CREATE SCHEMA IF NOT EXISTS quantum_v2')
        cur.execute('''CREATE TABLE IF NOT EXISTS quantum_v2.schema_migration
                       (version integer PRIMARY KEY,sha256 text NOT NULL,
                        applied_at timestamptz NOT NULL DEFAULT now())''')
        for path in sorted(MIGRATIONS.glob('001_*.sql')):
            body = path.read_text(); digest = hashlib.sha256(body.encode()).hexdigest()
            version = int(path.name.split('_')[0])
            cur.execute('SELECT sha256 FROM quantum_v2.schema_migration WHERE version=%s', (version,))
            previous = cur.fetchone()
            if previous:
                if previous['sha256'] != digest:
                    raise StoreError(f'Applied migration {version} has changed')
                continue
            cur.execute(body)
            cur.execute('INSERT INTO quantum_v2.schema_migration(version,sha256) VALUES(%s,%s)', (version,digest))


def migrate_physical(conn):
    """Explicitly install optional physical bootstrap support; never enabled here."""
    path=MIGRATIONS/'005_physical_bootstrap.sql'
    body=path.read_text();digest=hashlib.sha256(body.encode()).hexdigest()
    with transaction(conn) as cur:
        cur.execute('SELECT sha256 FROM quantum_v2.schema_migration WHERE version=5')
        previous=cur.fetchone()
        if previous:
            if previous['sha256']!=digest: raise StoreError('Applied migration 5 has changed')
            return
        cur.execute(body)
        cur.execute('INSERT INTO quantum_v2.schema_migration(version,sha256) VALUES(5,%s)',(digest,))


def _physical_available(cur):
    cur.execute("SELECT to_regclass('quantum_v2.bootstrap_heap_cursor') AS relation")
    return cur.fetchone()['relation'] is not None


def _heap_identity(cur,table):
    # The logical occurrence must remain unique, including across physical pages.
    # Index INCLUDE columns do not establish uniqueness of the occurrence itself.
    cur.execute('''SELECT c.oid AS relation_oid,pg_relation_filenode(c.oid) AS relation_filenode,
        pg_relation_size(c.oid) AS heap_bytes,current_setting('block_size')::integer AS block_size,
        c.relkind,EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid=c.oid
            AND i.indisunique AND i.indisvalid AND i.indisready AND i.indpred IS NULL
            AND i.indnkeyatts=3 AND ARRAY(SELECT a.attname::text
                FROM unnest(i.indkey::smallint[]) WITH ORDINALITY k(attnum,ordinality)
                JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum
                WHERE k.ordinality<=i.indnkeyatts ORDER BY a.attname)
                =ARRAY['blockheight','transactionid','vout']::text[]) AS unique_occurrences
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname=%s''',(table,))
    return cur.fetchone()


def enable_physical_bootstrap(conn,source_table,*,blocks_per_page=1024):
    """Switch one unfinished immutable legacy source to bounded physical pages.

    Application legacy-write guards must be installed before this explicit call.
    Physical identity checks detect rewrite/growth, not same-page unguarded DML.
    There is no fallback to keyset mode after physical contributions have begun.
    """
    if source_table not in LEGACY or not 1<=blocks_per_page<=4096:
        raise ValueError('Require a legacy family and 1..4096 physical blocks')
    with transaction(conn) as cur:
        if not _physical_available(cur): raise StoreError('Install migration005 before enabling physical bootstrap')
        p=_projection(cur)
        if p['seed_mode']!='legacy' or p['status']!='seeding':
            raise StoreError('Physical scanning requires an unfinished legacy seed')
        _certify(cur,p['anchor_height'],p['anchor_hash']);_verify_legacy(cur,p['anchor_height'])
        cur.execute('SELECT * FROM quantum_v2.bootstrap_cursor WHERE source_table=%s FOR UPDATE',(source_table,))
        cursor=cur.fetchone()
        if cursor is None or cursor['complete']: raise StoreError('Legacy source is already complete or absent')
        # Exclude concurrent writes/rewrite while capturing a physical generation.
        cur.execute(sql.SQL('LOCK TABLE {} IN SHARE MODE').format(_q(source_table)))
        identity=_heap_identity(cur,source_table)
        if not identity or identity['relkind']!='r' or not identity['unique_occurrences']:
            raise StoreError('Physical seed requires a heap with a valid unique occurrence index')
        cur.execute('SELECT * FROM quantum_v2.bootstrap_heap_cursor WHERE source_table=%s',(source_table,))
        old=cur.fetchone()
        if old:
            _check_heap_identity(cur,old,p,identity)
            if old['blocks_per_page']!=blocks_per_page:
                raise StoreError('Physical source already enabled with a different block budget')
            return
        cur.execute('''INSERT INTO quantum_v2.bootstrap_heap_cursor
            (source_table,relation_oid,relation_filenode,heap_bytes,block_size,anchor_height,anchor_hash,
             cutoff_height,cutoff_txid,cutoff_vout,blocks_per_page)
            VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''',
            (source_table,identity['relation_oid'],identity['relation_filenode'],identity['heap_bytes'],
             identity['block_size'],p['anchor_height'],p['anchor_hash'],cursor['last_height'],
             cursor['last_txid'],cursor['last_vout'],blocks_per_page))


def _check_heap_identity(cur,checkpoint,projection,identity=None):
    identity=identity or _heap_identity(cur,checkpoint['source_table'])
    if (not identity or identity['relkind']!='r' or not identity['unique_occurrences']
            or any(identity[key]!=checkpoint[key] for key in
                   ('relation_oid','relation_filenode','heap_bytes','block_size'))
            or projection['anchor_height']!=checkpoint['anchor_height']
            or projection['anchor_hash']!=checkpoint['anchor_hash']):
        raise PhysicalSeedChanged('Legacy physical generation changed; projection reseed is required',dict(checkpoint))


def _load_physical_page(cur,checkpoint,projection,limit):
    table=checkpoint['source_table']
    _check_heap_identity(cur,checkpoint,projection)
    try:
        cur.execute(sql.SQL('LOCK TABLE {} IN SHARE MODE').format(_q(table)))
    except psycopg2.errors.UndefinedTable as error:
        raise PhysicalSeedChanged('Legacy physical relation disappeared; projection reseed is required',dict(checkpoint)) from error
    _check_heap_identity(cur,checkpoint,projection)
    start_block=int(str(checkpoint['next_tid'])[1:].split(',')[0])
    end_blocks=(checkpoint['heap_bytes']+checkpoint['block_size']-1)//checkpoint['block_size']
    range_end=min(start_block+checkpoint['blocks_per_page'],end_blocks)
    # Materialize only one bounded physical range. LIMIT has lookahead, and a
    # dense range resumes from its exact last consumed TID rather than skipping
    # to range_end. Temporary rows disappear on commit/rollback.
    cur.execute(sql.SQL('''CREATE TEMP TABLE quantum_seed_page ON COMMIT DROP AS
        SELECT ctid AS source_tid,* FROM {} WHERE ctid>%s::tid AND ctid<%s::tid
        AND (blockheight,transactionid,vout)>(%s,%s,%s) AND blockheight<=%s
        ORDER BY ctid LIMIT %s''').format(_q(table)),
        (checkpoint['next_tid'],f'({range_end},0)',checkpoint['cutoff_height'],checkpoint['cutoff_txid'],
         checkpoint['cutoff_vout'],projection['anchor_height'],limit+1))
    cur.execute('SELECT COUNT(*) AS count FROM pg_temp.quantum_seed_page')
    count=cur.fetchone()['count']
    if count>limit:
        cur.execute('''DELETE FROM pg_temp.quantum_seed_page WHERE source_tid=
            (SELECT source_tid FROM pg_temp.quantum_seed_page ORDER BY source_tid DESC LIMIT 1)''')
        cur.execute('SELECT source_tid::text AS next_tid FROM pg_temp.quantum_seed_page ORDER BY source_tid DESC LIMIT 1')
        next_tid=cur.fetchone()['next_tid'];complete=False;count=limit
    else:
        next_tid=f'({range_end},0)';complete=range_end>=end_blocks
    return dict(checkpoint,page_rows=count,next_tid=next_tid,complete=complete)


def block_hash(cur, height):
    cur.execute('SELECT blockhash FROM public.blockheader WHERE blockheight=%s', (height,))
    row = cur.fetchone()
    if not row:
        raise SourceNotReady(f'Missing canonical block {height}')
    return row['blockhash']


def _certify(cur, height, expected_hash=None):
    current = block_hash(cur, height)
    if expected_hash is not None and current != expected_hash:
        raise ReseedRequired(f'Canonical hash changed at {height}')
    cur.execute("SELECT to_regclass('quantum_v2.source_state') AS relation")
    if cur.fetchone()['relation']:
        cur.execute('SELECT ready,committed_height,committed_hash FROM quantum_v2.source_state WHERE singleton')
        ready = cur.fetchone()
        if not ready or not ready['ready'] or ready['committed_height'] < height:
            raise SourceNotReady('Source ingestion has not certified this height')
        if not ready['committed_hash'] or block_hash(cur,ready['committed_height']) != ready['committed_hash']:
            raise SourceNotReady('Certified source tip hash no longer matches canonical headers')
    return current


def _archives(cur):
    cur.execute("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' AND tablename ~ '^stxos_[0-9]+_[0-9]+_archive$'")
    return sorted((int(m[1]), int(m[2]), r['tablename']) for r in cur.fetchall()
                  if (m := ARCHIVE_RE.fullmatch(r['tablename'])))


def _projection(cur):
    cur.execute('SELECT * FROM quantum_v2.projection WHERE singleton FOR UPDATE')
    row = cur.fetchone()
    if row is None:
        raise StoreError('Initialize a verified seed before processing')
    return row


def projection_status(conn):
    with transaction(conn) as cur:
        cur.execute('SELECT * FROM quantum_v2.projection WHERE singleton')
        p = cur.fetchone()
        cur.execute('SELECT * FROM quantum_v2.bootstrap_cursor ORDER BY source_table')
        result={'projection': dict(p) if p else None, 'cursors': [dict(r) for r in cur.fetchall()]}
        if _physical_available(cur):
            cur.execute('SELECT * FROM quantum_v2.bootstrap_heap_cursor ORDER BY source_table')
            result['physical_cursors']=[dict(row) for row in cur.fetchall()]
        return result


def initialize_seed(conn, height: int, expected_hash: str):
    """Start/resume seed of unchanged legacy active tables at their common freeze."""
    with transaction(conn) as cur:
        _certify(cur, height, expected_hash)
        cur.execute('SELECT * FROM quantum_v2.projection WHERE singleton')
        previous = cur.fetchone()
        if previous:
            if previous['anchor_height'] == height and previous['anchor_hash'] == expected_hash and previous['status'] != 'needs_reseed':
                return
            raise ReseedRequired('Existing projection needs explicit reset before a different seed')
        _verify_legacy(cur, height)
        cur.execute('''INSERT INTO quantum_v2.projection(status,anchor_height,anchor_hash,height,block_hash)
                       VALUES('seeding',%s,%s,%s,%s)''', (height,expected_hash,height,expected_hash))
        sources = list(LEGACY) + ['other:source']
        execute_values(cur, 'INSERT INTO quantum_v2.bootstrap_cursor(source_table) VALUES %s', [(s,) for s in sources])


def initialize_source_seed(conn, height: int, expected_hash: str):
    """Explicit, expensive canonical rebuild after a deep reorg; bounded and resumable.

    Replays creation occurrences once and reconstructs disclosure/activity directly
    from canonical source data, never trusting an orphaned legacy freeze. The
    coordinator must assign a separate backfill budget and adequate storage.
    """
    with transaction(conn) as cur:
        _certify(cur,height,expected_hash)
        cur.execute('SELECT * FROM quantum_v2.projection WHERE singleton')
        p=cur.fetchone()
        if p:
            if p['seed_mode']=='canonical' and p['anchor_height']==height and p['anchor_hash']==expected_hash and p['status']!='needs_reseed':
                return
            raise ReseedRequired('Explicitly reset invalid projection before canonical rebuild')
        cur.execute("""INSERT INTO quantum_v2.projection(status,seed_mode,anchor_height,anchor_hash,height,block_hash)
                       VALUES('seeding','canonical',%s,%s,%s,%s)""",(height,expected_hash,height,expected_hash))
        cur.execute("INSERT INTO quantum_v2.bootstrap_cursor(source_table) VALUES('canonical_blocks')")


def _canonical_seed_step(cur,p,max_rows):
    cur.execute("SELECT * FROM quantum_v2.bootstrap_cursor WHERE source_table='canonical_blocks' FOR UPDATE")
    cursor=cur.fetchone(); anchor=p['anchor_height']
    if cursor['complete']:
        cur.execute("UPDATE quantum_v2.projection SET status='ready',updated_at=now() WHERE singleton")
        return True
    # Occurrence keysets can resume inside one exceptionally dense block; a fixed
    # block range could never progress when one block exceeds the row budget.
    key=(cursor['last_height'],cursor['last_txid'],cursor['last_vout'])
    rows,complete,next_key=_source_occurrence_page(cur,key,anchor,max_rows)
    states={}; exposures={}
    for r in rows:
        g,f,d,eligible=identify(r); s=states.setdefault((g,f),_empty(g,f,d))
        created=r['blockheight']; removed=_removal_height(cur,r); spent=_effective_spend(r,removed)
        if not _unspendable(r):
            s['first_received_height']=_min(s['first_received_height'],created)
        if spent is not None and spent<=anchor:
            s['last_spend_height']=_max(s['last_spend_height'],spent)
            if eligible: exposures[g]=_min(exposures.get(g),spent)
        elif not _unspendable(r) and (removed is None or removed>anchor):
            s['balance_sats']+=r['amount']; s['utxo_count']+=1
            if eligible: s['eligible_sats']+=r['amount']; s['eligible_utxos']+=1
        if eligible and (f in ('P2PK','P2TR') or str(r.get('scripttype','')).startswith('Multisig ')):
            exposures[g]=_min(exposures.get(g),created)
    if exposures:
        _save_disclosures(cur,exposures)
    if states:
        cur.execute('SELECT group_id,exposed_height FROM quantum_v2.disclosure WHERE group_id=ANY(%s)',(list({g for g,f in states}),))
        known={r['group_id']:r['exposed_height'] for r in cur.fetchall()}
        for (g,f),s in states.items(): s['first_disclosure_height']=known.get(g)
        _save_states(cur,states,additive=True)
    if exposures:
        cur.execute("""UPDATE quantum_v2.group_state s SET first_disclosure_height=d.exposed_height,
                       first_disclosure_hash=d.exposed_hash FROM quantum_v2.disclosure d
                       WHERE s.group_id=d.group_id AND d.group_id=ANY(%s)
                       AND (s.first_disclosure_height IS NULL OR d.exposed_height<s.first_disclosure_height)""",(list(exposures),))
    cur.execute("""UPDATE quantum_v2.bootstrap_cursor SET last_height=%s,last_txid=%s,last_vout=%s,
                   rows_processed=rows_processed+%s,complete=%s WHERE source_table='canonical_blocks'""",
                (*next_key,len(rows),complete))
    if complete: cur.execute("UPDATE quantum_v2.projection SET status='ready',updated_at=now() WHERE singleton")
    return complete


def _verify_legacy(cur, height):
    cur.execute('SELECT name,freeze_blockheight FROM public.analysis_freeze WHERE name=ANY(%s)', (list(LEGACY)+['key_outputs_all','exposed_keyhash20','exposed_p2sh_address','exposed_p2wsh_address'],))
    rows = cur.fetchall()
    if len(rows) != 9 or any(r['freeze_blockheight'] != height for r in rows):
        raise SourceNotReady('Legacy seed tables and registries must retain one common verified freeze')


def _min(a,b):
    return b if a is None else a if b is None else min(a,b)


def _max(a,b):
    return b if a is None else a if b is None else max(a,b)


@lru_cache(maxsize=131072)
def _valid_key(hex_key):
    from quantum_v2_analysis import valid_pubkey
    try:
        return valid_pubkey(bytes.fromhex(hex_key))
    except (ValueError, TypeError):
        return False


@lru_cache(maxsize=131072)
def _taproot_program(address):
    """Decode a mainnet BIP350 witness-v1 32-byte commitment, checking checksum."""
    if not isinstance(address,str) or (address.lower()!=address and address.upper()!=address): return None
    address=address.lower()
    if not address.startswith('bc1') or len(address)!=62: return None
    alphabet='qpzry9x8gf2tvdw0s3jn54khce6mua7l'
    try: data=[alphabet.index(c) for c in address[3:]]
    except ValueError: return None
    checksum=1
    for value in [3,3,0,2,3]+data:
        high=checksum>>25; checksum=((checksum&0x1ffffff)<<5)^value
        for i,generator in enumerate((0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3)):
            if high>>i&1: checksum^=generator
    if checksum!=0x2bc830a3 or data[0]!=1: return None
    acc=bits=0; result=bytearray()
    for value in data[1:-6]:
        acc=(acc<<5)|value; bits+=5
        if bits>=8:
            bits-=8; result.append((acc>>bits)&255)
    if bits>=5 or (acc<<(8-bits))&255 or len(result)!=32: return None
    return bytes(result)


def identify(row):
    """Return group, family, display, eligible. No private keys or ownership inference."""
    kind = row.get('scripttype', row.get('script_type', '')) or ''
    family = FAMILIES.get(kind, 'Other')
    address = row.get('address') or ''
    raw = (row.get('scripthex') or '').lower()
    key = row.get('keyhash20')
    if key is not None:
        group = bytes(key).hex()
        if kind!='pubkey': return group, family, address or group, True
        if not re.fullmatch(r'(21[0-9a-f]{66}|41[0-9a-f]{130})ac',raw):
            raise StoreError('Legacy P2PK occurrence needs its retained raw script before projection')
    if kind in ('pubkey','pubkeyhash','witness_v0_keyhash'):
        if kind == 'pubkey' and re.fullmatch(r'(21[0-9a-f]{66}|41[0-9a-f]{130})ac', raw):
            pub = bytes.fromhex(raw[2:-2])
            group = hashlib.new('ripemd160', hashlib.sha256(pub).digest()).hexdigest()
            if key is not None and group!=bytes(key).hex():
                raise StoreError('Legacy keyhash does not match retained P2PK script')
            return group, family, raw[2:-2], _valid_key(raw[2:-2])
        if kind == 'pubkeyhash' and re.fullmatch(r'76a914[0-9a-f]{40}88ac', raw):
            return raw[6:46], family, address or raw[6:46], True
        if kind == 'witness_v0_keyhash' and re.fullmatch(r'0014[0-9a-f]{40}', raw):
            return raw[4:], family, address or raw[4:], True
        raise StoreError('Source key script does not match its declared type')
    if not address:
        if kind.startswith('Multisig ') and raw:
            address = 'script:'+hashlib.sha256(bytes.fromhex(raw)).hexdigest()
        else:
            address = f"out:{row['blockheight']}:{row['transactionid']}:{row['vout']}"
    eligible=family in ('P2SH','P2WSH')
    if family=='P2TR':
        program=(bytes.fromhex(raw[4:]) if re.fullmatch(r'5120[0-9a-f]{64}',raw) else None) if raw else _taproot_program(address)
        eligible=program is not None and _valid_key('02'+program.hex())
    elif kind.startswith('Multisig '):
        from quantum_v2_analysis import parse_multisig
        eligible=parse_multisig(raw) is not None
    return address, family, address, eligible


def _empty(group, family, display):
    return dict(zip(STATE_COLUMNS, (group,family,0,0,0,0,None,None,None,None,display,'','')))


def _unspendable(row):
    # Genesis coinbase never entered Bitcoin's UTXO set; disclosure remains public.
    raw = (row.get('scripthex') or '').lower()
    return row['blockheight'] == 0 or raw.startswith('6a') or len(raw) > 20000


def _removal_height(cur,row):
    key=(row['blockheight'],row['transactionid'],row['vout'])
    spec=BIP30_REMOVALS.get(key)
    if not spec: return None
    cur.execute('SELECT blockheight,blockhash FROM public.blockheader WHERE blockheight=ANY(%s)',([key[0],spec[0]],))
    hashes={r['blockheight']:r['blockhash'] for r in cur.fetchall()}
    return spec[0] if hashes.get(key[0])==spec[1] and hashes.get(spec[0])==spec[2] else None


def _effective_spend(row,removed):
    spent=row['spendingblock']
    return spent if spent is not None and (removed is None or spent<removed) else None


def _legacy_disclosures(cur, identities, height, use_legacy=True):
    out = {}
    keys = sorted({bytes.fromhex(g) for g,f in identities if f in ('P2PK','P2PKH','P2WPKH')})
    if keys and use_legacy:
        cur.execute('SELECT encode(keyhash20,\'hex\') AS group_id,exposed_height FROM public.exposed_keyhash20 WHERE keyhash20=ANY(%s) AND exposed_height<=%s', (keys,height))
        out.update((r['group_id'],r['exposed_height']) for r in cur.fetchall())
    for family,table in [('P2SH','exposed_p2sh_address'),('P2WSH','exposed_p2wsh_address')]:
        addresses = sorted({g for g,f in identities if f == family})
        if addresses and use_legacy:
            cur.execute(sql.SQL('SELECT address AS group_id,exposed_height FROM {} WHERE address=ANY(%s) AND exposed_height<=%s').format(_q(table)), (addresses,height))
            out.update((r['group_id'],r['exposed_height']) for r in cur.fetchall())
    if identities:
        cur.execute('SELECT group_id,exposed_height FROM quantum_v2.disclosure WHERE group_id=ANY(%s) AND exposed_height<=%s', (list({g for g,f in identities}),height))
        for r in cur.fetchall():
            out[r['group_id']] = _min(out.get(r['group_id']),r['exposed_height'])
    return out


def _block_hashes(cur,heights):
    if not heights: return {}
    cur.execute('SELECT blockheight,blockhash FROM public.blockheader WHERE blockheight=ANY(%s)',(heights,))
    values={r['blockheight']:r['blockhash'] for r in cur.fetchall()}
    if len(values)!=len(set(heights)): raise SourceNotReady('Missing disclosure block provenance')
    return values


def _save_disclosures(cur,exposures):
    hashes=_block_hashes(cur,list(set(exposures.values())))
    execute_values(cur,"""INSERT INTO quantum_v2.disclosure(group_id,exposed_height,exposed_hash) VALUES %s
        ON CONFLICT(group_id) DO UPDATE SET
          exposed_height=LEAST(quantum_v2.disclosure.exposed_height,EXCLUDED.exposed_height),
          exposed_hash=CASE WHEN EXCLUDED.exposed_height<quantum_v2.disclosure.exposed_height
                       THEN EXCLUDED.exposed_hash ELSE quantum_v2.disclosure.exposed_hash END""",
        [(g,h,hashes[h]) for g,h in exposures.items()])


def _preserve_orphan_disclosures(cur,p,batch_id=None):
    # Preserve exact hashes captured BEFORE a reorg; current blockheader may now
    # describe another chain. Conservatively retain affected prior observations.
    condition='' if batch_id is None else ' AND group_id IN (SELECT group_id FROM quantum_v2.batch_undo WHERE batch_id=%s)'
    params=(p['height'],p['block_hash'],batch_id)
    if batch_id is not None: params+= (batch_id,)
    cur.execute("""INSERT INTO quantum_v2.orphan_disclosure
        (group_id,exposed_height,exposed_hash,projection_height,projection_hash,batch_id,source)
        SELECT group_id,first_disclosure_height,first_disclosure_hash,%s,%s,%s,'projection-observation'
        FROM quantum_v2.group_state WHERE first_disclosure_height IS NOT NULL
        AND first_disclosure_hash IS NOT NULL"""+condition+" ON CONFLICT DO NOTHING",params)
    condition='' if batch_id is None else ' WHERE group_id IN (SELECT group_id FROM quantum_v2.disclosure_undo WHERE batch_id=%s)'
    cur.execute("""INSERT INTO quantum_v2.orphan_disclosure
        (group_id,exposed_height,exposed_hash,projection_height,projection_hash,batch_id,source)
        SELECT group_id,exposed_height,exposed_hash,%s,%s,%s,'disclosure-observation'
        FROM quantum_v2.disclosure"""+condition+" ON CONFLICT DO NOTHING",params)


def _display_update(physical=False):
    fallback="CASE WHEN quantum_v2.group_state.display_group_id='' THEN EXCLUDED.display_group_id ELSE quantum_v2.group_state.display_group_id END"
    if physical:
        fallback='''COALESCE((SELECT d.display_group_id FROM quantum_v2.bootstrap_display_origin d
            WHERE d.group_id=EXCLUDED.group_id AND d.script_type=EXCLUDED.script_type),'''+fallback+')'
    return 'display_group_id='+fallback


def _display_origin_insert(candidates):
    return sql.SQL('''INSERT INTO quantum_v2.bootstrap_display_origin AS old
        (group_id,script_type,blockheight,transactionid,vout,display_group_id)
        SELECT d.* FROM ({}) d
        LEFT JOIN LATERAL (SELECT true AS found FROM quantum_v2.bootstrap_display_origin o
            WHERE o.group_id=d.group_id AND o.script_type=d.script_type LIMIT 1) o ON true
        LEFT JOIN LATERAL (SELECT true AS found FROM quantum_v2.group_state s
            WHERE s.group_id=d.group_id AND s.script_type=d.script_type LIMIT 1) s ON true
        WHERE o.found OR s.found IS NULL
        ON CONFLICT(group_id,script_type) DO UPDATE SET
          blockheight=EXCLUDED.blockheight,transactionid=EXCLUDED.transactionid,
          vout=EXCLUDED.vout,display_group_id=EXCLUDED.display_group_id
        WHERE (EXCLUDED.blockheight,EXCLUDED.transactionid,EXCLUDED.vout)
              <(old.blockheight,old.transactionid,old.vout)''').format(candidates)


def _record_physical_sql_displays(cur,table):
    if table=='active_key_outputs':
        group="encode(keyhash20,'hex')"
        family="CASE script_type WHEN 'pubkeyhash' THEN 'P2PKH' WHEN 'witness_v0_keyhash' THEN 'P2WPKH' END"
        predicate="WHERE script_type<>'pubkey'"
    else:
        group="COALESCE(NULLIF(address,''),'out:'||blockheight||':'||transactionid||':'||vout)"
        family="'P2SH'::text" if table=='active_p2sh_outputs' else "'P2WSH'::text"
        predicate=''
    query=sql.SQL('''SELECT DISTINCT ON(group_id,script_type)
            group_id,script_type,blockheight,transactionid,vout,COALESCE(NULLIF(address,''),group_id) AS display_group_id
        FROM (SELECT '''+group+' AS group_id,'+family+''' AS script_type,blockheight,transactionid,vout,address
              FROM pg_temp.quantum_seed_page '''+predicate+''') grouped
        ORDER BY group_id,script_type,blockheight,transactionid,vout''')
    cur.execute(_display_origin_insert(query))


def _record_physical_displays(cur,origins):
    if not origins: return
    candidates=sql.SQL('''SELECT * FROM (VALUES %s)
        AS v(group_id,script_type,blockheight,transactionid,vout,display_group_id)''')
    execute_values(cur,_display_origin_insert(candidates),list(origins.values()),page_size=1000)


def _save_states(cur, states, additive=False, preserve_hash=False, physical_display=False):
    if not states:
        return
    if not preserve_hash:
        heights=list({s['first_disclosure_height'] for s in states.values() if s['first_disclosure_height'] is not None})
        hashes=_block_hashes(cur,heights)
        for s in states.values(): s['first_disclosure_hash']=hashes.get(s['first_disclosure_height'])
    fields = ','.join(STATE_COLUMNS)
    if additive:
        setters = [f'{c}=quantum_v2.group_state.{c}+EXCLUDED.{c}' for c in STATE_COLUMNS[2:6]]
        setters += ['first_received_height=LEAST(quantum_v2.group_state.first_received_height,EXCLUDED.first_received_height)',
                    'first_disclosure_height=LEAST(quantum_v2.group_state.first_disclosure_height,EXCLUDED.first_disclosure_height)',
                    'first_disclosure_hash=CASE WHEN quantum_v2.group_state.first_disclosure_height IS NULL OR EXCLUDED.first_disclosure_height<quantum_v2.group_state.first_disclosure_height THEN EXCLUDED.first_disclosure_hash ELSE quantum_v2.group_state.first_disclosure_hash END',
                    'last_spend_height=GREATEST(quantum_v2.group_state.last_spend_height,EXCLUDED.last_spend_height)',
                    _display_update(physical_display)]
    else:
        setters = [f'{c}=EXCLUDED.{c}' for c in STATE_COLUMNS[2:]]
    execute_values(cur, f'INSERT INTO quantum_v2.group_state({fields}) VALUES %s ON CONFLICT(group_id,script_type) DO UPDATE SET '+','.join(setters),
                   [tuple(s[c] for c in STATE_COLUMNS) for s in states.values()], page_size=1000)


def _point_lookup_sources(cur,tables):
    """Find usable full btree prefixes for exact output occurrence probes.

    Live outputs has (transactionid,vout); some installations also index the
    complete occurrence. Partial or invalid indexes cannot justify this route.
    Archives without either prefix retain one creation-block scan per chunk.
    """
    cur.execute('''SELECT DISTINCT c.relname AS tablename
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        JOIN pg_catalog.pg_index i ON i.indrelid=c.oid
        JOIN pg_catalog.pg_class idx ON idx.oid=i.indexrelid
        JOIN pg_catalog.pg_am am ON am.oid=idx.relam
        CROSS JOIN LATERAL (
            SELECT array_agg(a.attname::text ORDER BY k.ordinality) AS names
            FROM unnest(i.indkey::smallint[]) WITH ORDINALITY k(attnum,ordinality)
            LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum
            WHERE k.ordinality<=i.indnkeyatts
        ) keys
        WHERE n.nspname='public' AND c.relname=ANY(%s)
          AND i.indisvalid AND i.indisready AND i.indpred IS NULL AND am.amname='btree'
          AND (keys.names[1:2] @> ARRAY['transactionid','vout']::text[]
               OR keys.names[1:3] @> ARRAY['blockheight','transactionid','vout']::text[])''',(tables,))
    return {row['tablename'] for row in cur.fetchall()}


def _prepare_legacy_scripts(cur,rows,anchor):
    """Restore omitted key/policy facts using bounded cache/occurrence lookups.

    Cached P2PK keys must reproduce keyhash20. Taproot addresses carry the full
    output key. Other missing facts use exact composite-index probes where
    available, otherwise indexed creation-block scans joined to occurrences.
    """
    missing={i:r for i,r in enumerate(rows) if not r.get('scripthex') and
             (r.get('scripttype',r.get('script_type','')) in ('pubkey','witness_v1_taproot') or
              str(r.get('scripttype','')).startswith('Multisig '))}
    if not missing: return
    pubkeys={bytes(r['keyhash20']) for r in missing.values() if r.get('keyhash20') is not None}
    cache={}
    if pubkeys:
        cur.execute("SELECT to_regclass('public.dashboard_p2pk_pubkey_cache') AS relation")
        if cur.fetchone()['relation']:
            cur.execute('SELECT keyhash20,pubkey_hex FROM public.dashboard_p2pk_pubkey_cache WHERE keyhash20=ANY(%s)',(list(pubkeys),))
            cache={bytes(r['keyhash20']):r['pubkey_hex'] for r in cur.fetchall()}
    for i,r in list(missing.items()):
        kind=r.get('scripttype',r.get('script_type',''))
        if kind=='pubkey':
            pub=cache.get(bytes(r['keyhash20']))
            try: raw=bytes.fromhex(pub) if pub else b''
            except (ValueError,TypeError): raw=b''
            if len(raw) in (33,65) and hashlib.new('ripemd160',hashlib.sha256(raw).digest()).digest()==bytes(r['keyhash20']):
                r['scripthex']=f'{len(raw):02x}'+raw.hex()+'ac'; del missing[i]
        elif kind=='witness_v1_taproot':
            program=_taproot_program(r.get('address'))
            if program is not None:
                r['scripthex']='5120'+program.hex(); del missing[i]
    if not missing: return
    archives=_archives(cur)
    # Frozen histories already record old spend heights. Route those occurrences
    # directly to their spend archive instead of probing every archive since
    # creation. Rows unspent at the anchor can only be live or in later archives.
    routes=[(n,lambda r,a=a,b=b:r['spendingblock'] is not None and a<=r['spendingblock']<=b)
            for a,b,n in archives]
    routes.append(('outputs',lambda r:True))
    routes.extend((n,lambda r:r['spendingblock'] is None) for a,b,n in archives if b>anchor)
    point_sources=_point_lookup_sources(cur,list({table for table,_ in routes}))
    for table,accept in routes:
        candidates=[(i,r['blockheight'],r['transactionid'],r['vout']) for i,r in missing.items() if accept(r)]
        if not candidates: continue
        if table in point_sources:
            # Equalities on both outpoint columns allow the live composite index
            # to locate one tuple directly. The creation-height filter preserves
            # BIP30 occurrence identity. Do not LIMIT: conflicting copies fail.
            query=sql.SQL('''WITH wanted(ordinal,height,txid,vout) AS MATERIALIZED (VALUES %s)
                SELECT k.ordinal,s.scripthex,s.scripttype FROM wanted k
                CROSS JOIN LATERAL (SELECT scripthex,scripttype FROM {}
                    WHERE transactionid=k.txid AND vout=k.vout AND blockheight=k.height OFFSET 0) s''').format(_q(table))
        else:
            # Without a composite prefix, group requested occurrences by block
            # so its unrelated outputs are read at most once per bounded chunk.
            # OFFSET 0 and MATERIALIZED retain this per-block scan boundary.
            query=sql.SQL('''WITH wanted(ordinal,height,txid,vout) AS MATERIALIZED (VALUES %s),
            blocks AS (SELECT height,array_agg(DISTINCT txid) AS txids,
                       array_agg(DISTINCT vout) AS vouts FROM wanted GROUP BY height),
            found AS MATERIALIZED (
                SELECT b.height,s.transactionid,s.vout,s.scripthex,s.scripttype FROM blocks b
                CROSS JOIN LATERAL (SELECT transactionid,vout,scripthex,scripttype FROM {}
                    WHERE blockheight=b.height AND transactionid=ANY(b.txids)
                    AND vout=ANY(b.vouts) OFFSET 0) s)
            SELECT k.ordinal,s.scripthex,s.scripttype FROM found s JOIN wanted k
                ON k.height=s.height AND k.txid=s.transactionid AND k.vout=s.vout''').format(_q(table))
        found=execute_values(cur,query,candidates,page_size=1000,fetch=True)
        if len({item['ordinal'] for item in found})!=len(found):
            raise StoreError('Conflicting duplicate source occurrence in legacy script lookup')
        for item in found:
            r=missing.pop(item['ordinal']); expected=r.get('scripttype',r.get('script_type',''))
            if item['scripttype']!=expected and not (expected.startswith('Multisig ') and str(item['scripttype']).startswith('Multisig ')):
                raise StoreError('Legacy script classification differs from its canonical source occurrence')
            if not item['scripthex']: raise StoreError('Source occurrence has no retained key/policy script')
            r['scripthex']=item['scripthex']
    if missing:
        raise StoreError('Missing canonical source key/policy facts for legacy seed occurrences')


def _source_occurrence_page(cur,key,anchor,limit,*,other_only=False):
    """One globally ordered source page, stable across archive movement.

    Branch and merge lookahead include the row after the page boundary. This
    rejects conflicting copies of an occurrence even when the conflict would
    otherwise straddle a cursor advance. Exact duplicate copies collapse.
    Returns rows, final completion, and the next durable occurrence cursor.
    """
    # Bound sparse predicates by creation height as well as result cardinality.
    # Empty windows advance durably instead of rescanning the entire archive.
    window_end=min(anchor,max(0,key[0])+999)
    sources=['outputs']+[n for a,b,n in _archives(cur) if (b>anchor if other_only else b>=key[0])]
    pieces=[]; params=[]
    for name in sources:
        predicate=' AND '+NOT_PROVABLE_BURN
        branch_params=[*key,window_end]
        if other_only:
            predicate+=""" AND (spendingblock IS NULL OR spendingblock>%s)
                AND (scripttype NOT IN ('pubkey','pubkeyhash','witness_v0_keyhash','scripthash','witness_v0_scripthash','witness_v1_taproot') OR scripttype IS NULL)
                AND (scripttype NOT LIKE 'Multisig %%' OR address IS NULL OR scripttype IS NULL)"""
            branch_params.append(anchor)
        pieces.append(sql.SQL("""(SELECT blockheight,transactionid,vout,amount,address,scripttype,scripthex,spendingblock
            FROM {} WHERE (blockheight,transactionid,vout)>(%s,%s,%s) AND blockheight<=%s"""+predicate+
            ' ORDER BY blockheight,transactionid,vout LIMIT %s)').format(_q(name)))
        params.extend((*branch_params,limit+1))
    query=sql.SQL('SELECT * FROM (')+sql.SQL(' UNION ').join(pieces)+sql.SQL(') source ORDER BY blockheight,transactionid,vout LIMIT %s')
    cur.execute(query,(*params,limit+1))
    rows=cur.fetchall()
    if len({(r['blockheight'],r['transactionid'],r['vout']) for r in rows})!=len(rows):
        raise StoreError('Conflicting source locations for one seed output occurrence')
    exhausted=len(rows)<=limit
    page=rows[:limit]
    next_key=(window_end+1,'',-1) if exhausted else (page[-1]['blockheight'],page[-1]['transactionid'],page[-1]['vout'])
    return page,exhausted and window_end==anchor,next_key


def _bootstrap_standard_page(cur,table,key,anchor,limit,physical=False):
    """Reduce one bounded standard-family page in PostgreSQL, returning only P2PK.

    Source rows, integer sums/counts, metadata, disclosure hashes and the cursor
    are one SQL statement. P2PK rows remain in the validated Python path within
    the same surrounding transaction; any failure rolls back both reducers.
    """
    is_key=table=='active_key_outputs'
    source_type={'active_p2sh_outputs':'scripthash','active_p2wsh_outputs':'witness_v0_scripthash'}.get(table)
    if not is_key and source_type is None: raise ValueError('Unsupported SQL seed source')
    key_column=sql.SQL('keyhash20') if is_key else sql.SQL('NULL::bytea AS keyhash20')
    type_column=sql.SQL('script_type') if is_key else sql.SQL('{}::text AS script_type').format(sql.Literal(source_type))
    group_expr=sql.SQL("encode(keyhash20,'hex')") if is_key else sql.SQL("COALESCE(NULLIF(address,''),'out:'||blockheight||':'||transactionid||':'||vout)")
    registry='exposed_keyhash20' if is_key else 'exposed_p2sh_address' if source_type=='scripthash' else 'exposed_p2wsh_address'
    registry_join=sql.SQL("e.keyhash20=decode(g.group_id,'hex')") if is_key else sql.SQL('e.address=g.group_id')
    if physical: _record_physical_sql_displays(cur,table)
    statement=sql.SQL('''WITH page AS MATERIALIZED (
        SELECT {key_column},blockheight,transactionid,vout,amount,address,{type_column},spendingblock
        FROM {source} WHERE (blockheight,transactionid,vout)>(%s,%s,%s) AND blockheight<=%s
        ORDER BY blockheight,transactionid,vout LIMIT %s
    ), ordinary AS MATERIALIZED (
        SELECT *,{group_expr} AS group_id FROM page WHERE script_type<>'pubkey'
    ), grouped AS MATERIALIZED (
        SELECT group_id,script_type,
            COALESCE(SUM(amount) FILTER(WHERE blockheight>0 AND (spendingblock IS NULL OR spendingblock>%s)),0)::bigint AS balance_sats,
            COUNT(*) FILTER(WHERE blockheight>0 AND (spendingblock IS NULL OR spendingblock>%s)) AS utxo_count,
            MIN(blockheight) FILTER(WHERE blockheight>0) AS first_received_height,
            MAX(spendingblock) FILTER(WHERE spendingblock<=%s) AS last_spend_height
        FROM ordinary GROUP BY group_id,script_type
    ), first_display AS MATERIALIZED (
        SELECT DISTINCT ON(group_id,script_type) group_id,script_type,
            COALESCE(NULLIF(address,''),group_id) AS display_group_id
        FROM ordinary ORDER BY group_id,script_type,blockheight,transactionid,vout
    ), projected AS MATERIALIZED (
        SELECT g.group_id,
            CASE g.script_type WHEN 'pubkeyhash' THEN 'P2PKH' WHEN 'witness_v0_keyhash' THEN 'P2WPKH'
              WHEN 'scripthash' THEN 'P2SH' WHEN 'witness_v0_scripthash' THEN 'P2WSH' END AS script_type,
            g.balance_sats,g.utxo_count,g.first_received_height,g.last_spend_height,d.display_group_id,
            LEAST(e.exposed_height,q.exposed_height) AS first_disclosure_height,b.blockhash AS first_disclosure_hash
        FROM grouped g JOIN first_display d USING(group_id,script_type)
        LEFT JOIN LATERAL (SELECT e.exposed_height FROM {registry} e
            WHERE {registry_join} AND e.exposed_height<=%s LIMIT 1) e ON true
        LEFT JOIN LATERAL (SELECT q.exposed_height FROM quantum_v2.disclosure q
            WHERE q.group_id=g.group_id AND q.exposed_height<=%s LIMIT 1) q ON true
        LEFT JOIN LATERAL (SELECT blockhash FROM public.blockheader b
            WHERE b.blockheight=LEAST(e.exposed_height,q.exposed_height) LIMIT 1) b ON true
    ), saved AS (
        INSERT INTO quantum_v2.group_state
          (group_id,script_type,balance_sats,utxo_count,eligible_sats,eligible_utxos,
           first_received_height,first_disclosure_height,first_disclosure_hash,last_spend_height,display_group_id)
        SELECT group_id,script_type,balance_sats,utxo_count,balance_sats,utxo_count,
               first_received_height,first_disclosure_height,first_disclosure_hash,last_spend_height,display_group_id
        FROM projected
        ON CONFLICT(group_id,script_type) DO UPDATE SET
            balance_sats=quantum_v2.group_state.balance_sats+excluded.balance_sats,
            utxo_count=quantum_v2.group_state.utxo_count+excluded.utxo_count,
            eligible_sats=quantum_v2.group_state.eligible_sats+excluded.eligible_sats,
            eligible_utxos=quantum_v2.group_state.eligible_utxos+excluded.eligible_utxos,
            first_received_height=LEAST(quantum_v2.group_state.first_received_height,excluded.first_received_height),
            last_spend_height=GREATEST(quantum_v2.group_state.last_spend_height,excluded.last_spend_height),
            first_disclosure_height=LEAST(quantum_v2.group_state.first_disclosure_height,excluded.first_disclosure_height),
            first_disclosure_hash=CASE WHEN quantum_v2.group_state.first_disclosure_height IS NULL
                OR excluded.first_disclosure_height<quantum_v2.group_state.first_disclosure_height
                THEN excluded.first_disclosure_hash ELSE quantum_v2.group_state.first_disclosure_hash END,
            {display_update}
        RETURNING 1
    ), frontier AS (
        UPDATE quantum_v2.bootstrap_cursor SET
            last_height=COALESCE((SELECT blockheight FROM page ORDER BY blockheight DESC,transactionid DESC,vout DESC LIMIT 1),last_height),
            last_txid=COALESCE((SELECT transactionid FROM page ORDER BY blockheight DESC,transactionid DESC,vout DESC LIMIT 1),last_txid),
            last_vout=COALESCE((SELECT vout FROM page ORDER BY blockheight DESC,transactionid DESC,vout DESC LIMIT 1),last_vout),
            rows_processed=rows_processed+(SELECT COUNT(*) FROM page),
            complete=(SELECT COUNT(*) FROM page)<%s WHERE source_table=%s RETURNING source_table
    )
    SELECT audit.missing_hashes,p.* FROM
        (SELECT COUNT(*) FILTER(WHERE first_disclosure_height IS NOT NULL AND first_disclosure_hash IS NULL) AS missing_hashes FROM projected) audit
        LEFT JOIN LATERAL (SELECT * FROM page WHERE script_type='pubkey'
            ORDER BY blockheight,transactionid,vout) p ON true''').format(
                key_column=key_column,type_column=type_column,
                source=sql.Identifier('pg_temp','quantum_seed_page') if physical else _q(table),group_expr=group_expr,
                registry=_q(registry),registry_join=registry_join,display_update=sql.SQL(_display_update(physical)))
    cur.execute(statement,(*key,anchor,limit,anchor,anchor,anchor,anchor,anchor,limit,table))
    result=cur.fetchall()
    if result[0]['missing_hashes']:
        raise SourceNotReady('Missing disclosure block provenance in SQL seed page')
    return [{k:v for k,v in r.items() if k!='missing_hashes'} for r in result if r['blockheight'] is not None]


def bootstrap_step(conn, limit=10000, *, source_table=None):
    """Commit one bounded seed page, preserving optional physical progress."""
    try:
        return _bootstrap_step(conn,limit,source_table=source_table)
    except PhysicalSeedChanged as error:
        # The failed page rolled back. Durably stop this same physical generation
        # before reporting the error, so later workers enter bounded reseeding.
        old=error.checkpoint
        with transaction(conn) as cur:
            cur.execute('''SELECT 1 FROM quantum_v2.bootstrap_heap_cursor WHERE source_table=%s
                AND relation_oid=%s AND relation_filenode=%s AND next_tid=%s::tid''',
                (old['source_table'],old['relation_oid'],old['relation_filenode'],old['next_tid']))
            if cur.fetchone():
                cur.execute("""UPDATE quantum_v2.projection SET status='needs_reseed',updated_at=now()
                    WHERE singleton AND seed_mode='legacy' AND anchor_height=%s AND anchor_hash=%s""",
                    (old['anchor_height'],old['anchor_hash']))
        raise


def _bootstrap_step(conn, limit=10000, *, source_table=None):
    """Process one durable page; True means every seed source is complete.

    ``source_table`` is an administrative legacy-family pilot selector. Normal
    scheduling leaves it unset. Other-source seeding remains last because it
    builds on the legacy group histories, and cannot be selected explicitly.
    """
    if not 1 <= limit <= 100000:
        raise ValueError('Seed page size must be 1..100000')
    if source_table is not None and source_table not in LEGACY:
        raise ValueError('Pilot source must be one of the legacy active families')
    with transaction(conn) as cur:
        p = _projection(cur)
        if p['status'] == 'ready':
            return True
        if p['status'] != 'seeding':
            raise ReseedRequired('Projection is awaiting a verified replacement seed')
        h = p['anchor_height']; _certify(cur,h,p['anchor_hash'])
        if p['seed_mode'] == 'canonical':
            if source_table is not None: raise ValueError('Family pilot selection is only available for legacy seeds')
            return _canonical_seed_step(cur,p,max_rows=limit)
        try:
            _verify_legacy(cur,h)
        except SourceNotReady as error:
            if _physical_available(cur):
                cur.execute('SELECT * FROM quantum_v2.bootstrap_heap_cursor ORDER BY source_table LIMIT 1')
                physical=cur.fetchone()
                if physical: raise PhysicalSeedChanged(str(error),dict(physical)) from error
            raise
        if source_table is None:
            cur.execute('SELECT * FROM quantum_v2.bootstrap_cursor WHERE NOT complete ORDER BY source_table LIMIT 1 FOR UPDATE')
        else:
            cur.execute('SELECT * FROM quantum_v2.bootstrap_cursor WHERE NOT complete AND source_table=%s FOR UPDATE',(source_table,))
        cursor = cur.fetchone()
        if cursor is None:
            cur.execute('SELECT EXISTS(SELECT 1 FROM quantum_v2.bootstrap_cursor WHERE NOT complete) AS pending')
            if cur.fetchone()['pending']: return False
            cur.execute("UPDATE quantum_v2.projection SET status='ready',updated_at=now() WHERE singleton")
            if _physical_available(cur):
                # Earliest displays are now final in group_state. Keep the five
                # small physical cursors as a scan trace, discard per-group scratch.
                cur.execute('TRUNCATE quantum_v2.bootstrap_display_origin')
            return True
        name = cursor['source_table']; other = name.startswith('other:'); table = name.split(':',1)[-1]
        key = (cursor['last_height'],cursor['last_txid'],cursor['last_vout'])
        physical=None
        if not other and _physical_available(cur):
            cur.execute('SELECT * FROM quantum_v2.bootstrap_heap_cursor WHERE source_table=%s FOR UPDATE',(table,))
            checkpoint=cur.fetchone()
            if checkpoint:
                physical=_load_physical_page(cur,checkpoint,p,limit)
                key=(checkpoint['cutoff_height'],checkpoint['cutoff_txid'],checkpoint['cutoff_vout'])
        source_complete=False
        sql_reduced=table in ('active_key_outputs','active_p2sh_outputs','active_p2wsh_outputs')
        if other:
            rows,source_complete,next_key=_source_occurrence_page(cur,key,h,limit,other_only=True)
        elif sql_reduced:
            rows=_bootstrap_standard_page(cur,table,key,h,limit,physical=physical is not None)
        else:
            family = {'active_p2sh_outputs':'scripthash','active_p2wsh_outputs':'witness_v0_scripthash',
                      'active_p2tr_outputs':'witness_v1_taproot','active_bare_ms_outputs':'Multisig legacy'}[table]
            cur.execute(sql.SQL('''SELECT blockheight,transactionid,vout,amount,address,%s AS scripttype,spendingblock
                FROM {} WHERE (blockheight,transactionid,vout)>(%s,%s,%s)
                ORDER BY blockheight,transactionid,vout LIMIT %s''').format(
                    sql.Identifier('pg_temp','quantum_seed_page') if physical else _q(table)), (family,*key,limit))
        if not other and not sql_reduced: rows=cur.fetchall()
        states = {}; identities = [];display_origins={}
        if not other: _prepare_legacy_scripts(cur,rows,h)
        for r in rows:
            g,f,d,eligible = identify(r); identities.append((g,f))
            if physical:
                origin=(g,f,r['blockheight'],r['transactionid'],r['vout'],d)
                old=display_origins.get((g,f))
                if old is None or origin[2:5]<old[2:5]: display_origins[(g,f)]=origin
            s = states.setdefault((g,f),_empty(g,f,d))
            if not _unspendable(r):
                s['first_received_height'] = _min(s['first_received_height'],r['blockheight'])
            removed=_removal_height(cur,r); spend_height=_effective_spend(r,removed)
            spent = spend_height is not None and spend_height <= h
            if spent:
                s['last_spend_height'] = _max(s['last_spend_height'],spend_height)
            elif not _unspendable(r) and (removed is None or removed>h):
                s['balance_sats'] += r['amount']; s['utxo_count'] += 1
                if eligible:
                    s['eligible_sats'] += r['amount']; s['eligible_utxos'] += 1
            if eligible and (f in ('P2PK','P2TR') or str(r.get('scripttype','')).startswith('Multisig ')):
                s['first_disclosure_height'] = _min(s['first_disclosure_height'],r['blockheight'])
        exposures = _legacy_disclosures(cur,identities,h)
        if other and states:
            cur.execute('SELECT DISTINCT group_id FROM quantum_v2.group_state WHERE group_id=ANY(%s)',
                        (list({g for g,f in states}),))
            known={r['group_id'] for r in cur.fetchall()}
            examples={}
            for r in rows:
                g,f,d,eligible=identify(r)
                if g not in known: examples[g]=(f,r)
            for key,metadata in _hydrate_metadata_batch(cur,examples,h).items():
                target=states.setdefault(key,_empty(key[0],key[1],metadata['display_group_id']))
                for column in ('first_received_height','first_disclosure_height'):
                    target[column]=_min(target[column],metadata[column])
                target['last_spend_height']=_max(target['last_spend_height'],metadata['last_spend_height'])
        for (g,f),s in states.items():
            s['first_disclosure_height'] = _min(s['first_disclosure_height'],exposures.get(g))
        if physical: _record_physical_displays(cur,display_origins)
        _save_states(cur,states,additive=True,physical_display=physical is not None)
        if physical:
            cur.execute('''UPDATE quantum_v2.bootstrap_heap_cursor SET next_tid=%s::tid,updated_at=now()
                WHERE source_table=%s''',(physical['next_tid'],name))
            cur.execute('''UPDATE quantum_v2.bootstrap_cursor SET last_height=%s,last_txid=%s,last_vout=%s,
                rows_processed=%s,complete=%s WHERE source_table=%s''',
                (*key,cursor['rows_processed']+physical['page_rows'],physical['complete'],name))
        elif other:
            cur.execute('''UPDATE quantum_v2.bootstrap_cursor SET last_height=%s,last_txid=%s,last_vout=%s,
                           rows_processed=rows_processed+%s,complete=%s WHERE source_table=%s''',
                        (*next_key,len(rows),source_complete,name))
        elif sql_reduced:
            pass  # The SQL page updated its cursor in this same transaction.
        elif rows:
            last = rows[-1]
            cur.execute('''UPDATE quantum_v2.bootstrap_cursor SET last_height=%s,last_txid=%s,last_vout=%s,
                           rows_processed=rows_processed+%s,complete=%s WHERE source_table=%s''',
                        (last['blockheight'],last['transactionid'],last['vout'],len(rows),len(rows)<limit,name))
        else:
            cur.execute('UPDATE quantum_v2.bootstrap_cursor SET complete=true WHERE source_table=%s',(name,))
        return False


def _source_delta(cur, lo, hi, max_rows, include_spends=True):
    sources = ['outputs']+[name for a,b,name in _archives(cur) if b>lo]
    seen = {}
    for name in sources:
        # Two indexed predicates avoid an OR forcing a whole-table scan.
        predicates=[('blockheight>%s AND blockheight<=%s',(lo,hi))]
        if include_spends:
            predicates.append(('spendingblock>%s AND spendingblock<=%s AND blockheight<=%s',(lo,hi,lo)))
        for predicate,params in predicates:
            m = ARCHIVE_RE.fullmatch(name)
            if predicate.startswith('spending') and m and int(m[1]) > hi:
                continue
            cur.execute(sql.SQL('''SELECT blockheight,transactionid,vout,amount,address,scripttype,scripthex,spendingblock
                FROM {} WHERE '''+predicate+' AND '+NOT_PROVABLE_BURN+' LIMIT %s').format(_q(name)), (*params,max_rows+1))
            for r in cur.fetchall():
                key = (r['blockheight'],r['transactionid'],r['vout'])
                if key in seen and dict(seen[key]) != dict(r):
                    raise StoreError('Conflicting source locations for one output occurrence')
                seen[key] = r
                if len(seen)>max_rows:
                    raise BatchTooLarge('Source range exceeds bounded row budget; split it')
    if include_spends:
        for key,spec in BIP30_REMOVALS.items():
            if not lo<spec[0]<=hi: continue
            for name in ['outputs']+[n for a,b,n in _archives(cur)]:
                cur.execute(sql.SQL('''SELECT blockheight,transactionid,vout,amount,address,scripttype,scripthex,spendingblock
                    FROM {} WHERE blockheight=%s AND transactionid=%s AND vout=%s''').format(_q(name)),key)
                found=cur.fetchone()
                if found and _removal_height(cur,found) is not None:
                    seen[key]=found
                    break
    return seen.values()


def _hydrate_metadata_batch(cur, examples, anchor):
    """One grouped indexed lookup per source, never one query per new address.

    Legacy tables retain a complete history only for groups active at the seed.
    For revived groups, read exact predecessor metadata. Timeouts abort the batch
    without substituting dates or advancing the projection frontier.
    """
    states={}
    keys={g:row for g,(family,row) in examples.items() if family in ('P2PK','P2PKH','P2WPKH')}
    if keys:
        cur.execute("""SELECT encode(keyhash20,'hex') AS group_id,script_type,
                       MIN(blockheight) FILTER(WHERE blockheight>0) AS first,
                       MAX(spendingblock) FILTER(WHERE spendingblock<=%s) AS last
                       FROM public.key_outputs_all WHERE keyhash20=ANY(%s) AND blockheight<=%s
                       GROUP BY keyhash20,script_type""",(anchor,[bytes.fromhex(g) for g in keys],anchor))
        for row in cur.fetchall():
            g=row['group_id']; f=FAMILIES[row['script_type']]
            s=_empty(g,f,keys[g].get('address') or g)
            s['first_received_height']=row['first']; s['last_spend_height']=row['last']; states[(g,f)]=s
    addresses={row.get('address'):g for g,(f,row) in examples.items()
               if f not in ('P2PK','P2PKH','P2WPKH') and row.get('address')}
    scripts={row['scripthex']:g for g,(f,row) in examples.items() if g.startswith('script:')}
    for column,subjects in [('address',addresses),('scripthex',scripts)]:
        if not subjects: continue
        for table in ['outputs']+[name for a,b,name in _archives(cur)]:
            condition="(scripttype NOT IN ('pubkey','pubkeyhash','witness_v0_keyhash') OR scripttype IS NULL)"
            if column=='scripthex': condition="scripttype LIKE 'Multisig %%' AND address IS NULL"
            cur.execute(sql.SQL("""SELECT {} AS subject,scripttype,
                       MIN(blockheight) FILTER(WHERE blockheight>0) AS first,
                       MAX(spendingblock) FILTER(WHERE spendingblock<=%s) AS last
                       FROM {} WHERE {}=ANY(%s) AND blockheight<=%s AND """+condition+" GROUP BY {},scripttype").format(
                           sql.Identifier(column),_q(table),sql.Identifier(column),sql.Identifier(column)),
                        (anchor,list(subjects),anchor))
            for row in cur.fetchall():
                g=subjects[row['subject']]; f=FAMILIES.get(row['scripttype'],'Other')
                state=states.setdefault((g,f),_empty(g,f,g))
                state['first_received_height']=_min(state['first_received_height'],row['first'])
                state['last_spend_height']=_max(state['last_spend_height'],row['last'])
                if f=='P2TR' or str(row['scripttype']).startswith('Multisig '):
                    state['first_disclosure_height']=_min(state['first_disclosure_height'],row['first'])
    return states


def apply_range(conn, to_height, max_rows=250000):
    """Apply a range exactly once, preserving before-images and the hash frontier."""
    with transaction(conn) as cur:
        p=_projection(cur)
        if p['status']!='ready':
            raise SourceNotReady('Seed has not completed')
        lo=p['height']; _certify(cur,lo,p['block_hash']); target_hash=_certify(cur,to_height)
        if to_height==lo:
            return {'height':lo,'rows':0,'idempotent':True}
        if to_height<lo:
            raise StoreError('Use rollback_to for backward movement')
        rows=list(_source_delta(cur,lo,to_height,max_rows))
        identities=[identify(r) for r in rows]; groups=sorted({x[0] for x in identities})
        cur.execute('SELECT * FROM quantum_v2.group_state WHERE group_id=ANY(%s)',(groups,))
        before={(r['group_id'],r['script_type']):dict(r) for r in cur.fetchall()}
        states={k:dict(v) for k,v in before.items()}
        known_groups={g for g,f in before}
        if p['seed_mode']=='legacy':
            examples={g:(f,row) for row,(g,f,d,e) in zip(rows,identities) if g not in known_groups}
            states.update(_hydrate_metadata_batch(cur,examples,p['anchor_height']))
        for row,(g,f,d,eligible) in zip(rows,identities):
            states.setdefault((g,f),_empty(g,f,d))
        disclosure=_legacy_disclosures(cur,[(g,f) for g,f,d,e in identities],lo,use_legacy=p['seed_mode']=='legacy')
        new_disclosure={}
        for row,(g,f,d,eligible) in zip(rows,identities):
            s=states[(g,f)]; created=row['blockheight']; removed=_removal_height(cur,row); spent=_effective_spend(row,removed)
            if not _unspendable(row):
                s['first_received_height']=_min(s['first_received_height'],created)
            if lo<created<=to_height:
                if not _unspendable(row):
                    s['balance_sats']+=row['amount']; s['utxo_count']+=1
                    if eligible: s['eligible_sats']+=row['amount']; s['eligible_utxos']+=1
                if eligible and (f in ('P2PK','P2TR') or str(row.get('scripttype','')).startswith('Multisig ')):
                    new_disclosure[g]=_min(new_disclosure.get(g),created)
            if spent is not None and lo<spent<=to_height:
                if not _unspendable(row):
                    s['balance_sats']-=row['amount']; s['utxo_count']-=1
                    if eligible: s['eligible_sats']-=row['amount']; s['eligible_utxos']-=1
                s['last_spend_height']=_max(s['last_spend_height'],spent)
                if eligible:
                    new_disclosure[g]=_min(new_disclosure.get(g),spent)
            if removed is not None and lo<removed<=to_height and not _unspendable(row):
                s['balance_sats']-=row['amount']; s['utxo_count']-=1
                if eligible: s['eligible_sats']-=row['amount']; s['eligible_utxos']-=1
        for g,h in new_disclosure.items(): disclosure[g]=_min(disclosure.get(g),h)
        for (g,f),s in states.items():
            s['first_disclosure_height']=_min(s['first_disclosure_height'],disclosure.get(g))
            if min(s['balance_sats'],s['utxo_count'],s['eligible_sats'],s['eligible_utxos'])<0:
                raise StoreError(f'Negative state for {g}; source/seed must be reconciled')
        cur.execute('INSERT INTO quantum_v2.projection_batch(from_height,from_hash,to_height,to_hash) VALUES(%s,%s,%s,%s) RETURNING batch_id',(lo,p['block_hash'],to_height,target_hash))
        batch=cur.fetchone()['batch_id']
        if states:
            execute_values(cur,'INSERT INTO quantum_v2.batch_undo(batch_id,group_id,script_type,before_row) VALUES %s',
                           [(batch,g,f,Json(before[(g,f)]) if (g,f) in before else None) for g,f in states])
        if new_disclosure:
            cur.execute('SELECT group_id,exposed_height,exposed_hash FROM quantum_v2.disclosure WHERE group_id=ANY(%s)',(list(new_disclosure),))
            old={r['group_id']:(r['exposed_height'],r['exposed_hash']) for r in cur.fetchall()}
            execute_values(cur,'INSERT INTO quantum_v2.disclosure_undo(batch_id,group_id,before_height,before_hash) VALUES %s',
                           [(batch,g,*old.get(g,(None,None))) for g in new_disclosure])
            _save_disclosures(cur,new_disclosure)
        _save_states(cur,states)
        cur.execute('UPDATE quantum_v2.projection SET height=%s,block_hash=%s,updated_at=now() WHERE singleton',(to_height,target_hash))
        return {'height':to_height,'rows':len(rows),'groups':len(groups),'batch_id':batch}


def rollback_to(conn,height):
    """Undo complete batches down to a retained checkpoint; deeper rollback is explicit."""
    with transaction(conn) as cur:
        p=_projection(cur)
        cur.execute('SELECT * FROM quantum_v2.projection_batch WHERE to_height>%s ORDER BY to_height DESC',(height,))
        batches=cur.fetchall()
        if height<p['anchor_height'] or (height!=p['height'] and (not batches or batches[-1]['from_height']!=height)):
            cur.execute("UPDATE quantum_v2.projection SET status='needs_reseed' WHERE singleton")
            return False
        for batch in batches:
            _preserve_orphan_disclosures(cur,p,batch['batch_id'])
            cur.execute('SELECT * FROM quantum_v2.batch_undo WHERE batch_id=%s',(batch['batch_id'],))
            old=cur.fetchall()
            for r in old:
                cur.execute('DELETE FROM quantum_v2.group_state WHERE group_id=%s AND script_type=%s',(r['group_id'],r['script_type']))
            _save_states(cur,{(r['group_id'],r['script_type']):r['before_row'] for r in old if r['before_row'] is not None},preserve_hash=True)
            cur.execute('SELECT * FROM quantum_v2.disclosure_undo WHERE batch_id=%s',(batch['batch_id'],))
            for r in cur.fetchall():
                if r['before_height'] is None:
                    cur.execute('DELETE FROM quantum_v2.disclosure WHERE group_id=%s',(r['group_id'],))
                else:
                    cur.execute('UPDATE quantum_v2.disclosure SET exposed_height=%s,exposed_hash=%s WHERE group_id=%s',(r['before_height'],r['before_hash'],r['group_id']))
            cur.execute('DELETE FROM quantum_v2.projection_batch WHERE batch_id=%s',(batch['batch_id'],))
            cur.execute('UPDATE quantum_v2.projection SET height=%s,block_hash=%s,status=\'ready\',updated_at=now() WHERE singleton',(batch['from_height'],batch['from_hash']))
        return True


def reset_projection_step(conn, *, confirm_anchor_hash, limit=10000,
                          reseed_height=None, reseed_hash=None):
    """Preserve one bounded evidence page; True means reset is fully complete.

    Two keyset cursors live in the existing bootstrap table. A crash commits
    neither evidence nor cursor, or both. No projection is truncated until both
    sources are copied. When a replacement target is supplied, its certification
    and canonical seed initialization share the final reset transaction, leaving
    no crash gap with a missing projection. The coordinator limits wall time.
    """
    if not 1<=limit<=100000: raise ValueError('Reset page size must be 1..100000')
    if (reseed_height is None)!=(reseed_hash is None):
        raise ValueError('Canonical reset requires both replacement height and hash')
    with transaction(conn) as cur:
        cur.execute('SELECT * FROM quantum_v2.projection WHERE singleton FOR UPDATE')
        p=cur.fetchone()
        if p is None: return True
        if (reseed_height is not None and p['seed_mode']=='canonical' and p['status']!='needs_reseed'
                and p['anchor_height']==reseed_height and p['anchor_hash']==reseed_hash):
            _certify(cur,reseed_height,reseed_hash)
            return True
        if p['status']!='needs_reseed' or p['anchor_hash']!=confirm_anchor_hash:
            raise StoreError('Reset requires needs_reseed status and exact previous anchor hash')
        if reseed_height is not None: _certify(cur,reseed_height,reseed_hash)
        cur.execute("""INSERT INTO quantum_v2.bootstrap_cursor(source_table)
                       VALUES('reset:group_state'),('reset:disclosure') ON CONFLICT DO NOTHING""")
        cur.execute("""SELECT * FROM quantum_v2.bootstrap_cursor WHERE source_table LIKE 'reset:%%'
                       AND NOT complete ORDER BY source_table LIMIT 1 FOR UPDATE""")
        cursor=cur.fetchone()
        if cursor:
            table=cursor['source_table'].split(':',1)[1]
            if table not in ('group_state','disclosure'): raise StoreError('Unknown reset evidence cursor')
            relation=sql.Identifier('quantum_v2',table)
            lower=sql.SQL(' WHERE group_id>%s') if cursor['last_height']>=0 else sql.SQL('')
            params=(cursor['last_txid'],limit) if cursor['last_height']>=0 else (limit,)
            cur.execute(sql.SQL('SELECT DISTINCT group_id FROM {}').format(relation)+lower+
                        sql.SQL(' ORDER BY group_id LIMIT %s'),params)
            groups=[r['group_id'] for r in cur.fetchall()]
            if groups:
                height='first_disclosure_height' if table=='group_state' else 'exposed_height'
                blockhash='first_disclosure_hash' if table=='group_state' else 'exposed_hash'
                cur.execute(sql.SQL('''INSERT INTO quantum_v2.orphan_disclosure
                    (group_id,exposed_height,exposed_hash,projection_height,projection_hash,batch_id,source)
                    SELECT group_id,{},{},%s,%s,NULL,%s FROM {} WHERE group_id=ANY(%s)
                    AND {} IS NOT NULL AND {} IS NOT NULL ON CONFLICT DO NOTHING''').format(
                        sql.Identifier(height),sql.Identifier(blockhash),relation,
                        sql.Identifier(height),sql.Identifier(blockhash)),
                    (p['height'],p['block_hash'],'reset-'+table,groups))
                cur.execute('''UPDATE quantum_v2.bootstrap_cursor SET last_height=0,last_txid=%s,
                               rows_processed=rows_processed+%s,complete=%s WHERE source_table=%s''',
                            (groups[-1],len(groups),len(groups)<limit,cursor['source_table']))
            else:
                cur.execute('UPDATE quantum_v2.bootstrap_cursor SET complete=true WHERE source_table=%s',
                            (cursor['source_table'],))
            return False
        cur.execute('TRUNCATE quantum_v2.batch_undo,quantum_v2.disclosure_undo,quantum_v2.projection_batch,quantum_v2.group_state,quantum_v2.disclosure,quantum_v2.bootstrap_cursor,quantum_v2.projection')
        if _physical_available(cur):
            cur.execute('TRUNCATE quantum_v2.bootstrap_heap_cursor,quantum_v2.bootstrap_display_origin')
        if reseed_height is not None:
            cur.execute("""INSERT INTO quantum_v2.projection(status,seed_mode,anchor_height,anchor_hash,height,block_hash)
                           VALUES('seeding','canonical',%s,%s,%s,%s)""",
                        (reseed_height,reseed_hash,reseed_height,reseed_hash))
            cur.execute("INSERT INTO quantum_v2.bootstrap_cursor(source_table) VALUES('canonical_blocks')")
        return True


def reset_projection(conn, *, confirm_anchor_hash):
    """Compatibility helper; budgeted workers should call reset_projection_step."""
    while not reset_projection_step(conn,confirm_anchor_hash=confirm_anchor_hash):
        pass


def iter_group_rows(conn, fetch_size=10000) -> Iterator[dict]:
    """Bounded keyset exporter input in the caller's stable transaction.

    Each state page is selected by its C-collated PK before bounded timestamp
    lookups and sorting. A named cursor alone would not prevent a planner from
    sorting/hash-joining the entire projection before returning its first row.
    Pages concatenate continuously, including when one group spans pages.
    """
    if not 1<=fetch_size<=100000: raise ValueError('Export page size must be 1..100000')
    if conn.autocommit: raise StoreError('Export requires a caller-owned stable transaction')
    with conn.cursor() as cur:
        cur.execute('SHOW transaction_isolation')
        if cur.fetchone()[0] not in ('repeatable read','serializable'):
            raise StoreError('Export requires REPEATABLE READ or SERIALIZABLE isolation')
    position=None
    while True:
        if conn.get_transaction_status()!=psycopg2.extensions.TRANSACTION_STATUS_INTRANS:
            raise StoreError('Caller ended the export snapshot between pages')
        predicate='' if position is None else 'WHERE (group_id,script_type)>(%s,%s)'
        params=(fetch_size,) if position is None else (*position,fetch_size)
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute('''WITH page AS MATERIALIZED (
                SELECT * FROM quantum_v2.group_state '''+predicate+'''
                ORDER BY group_id COLLATE "C",script_type COLLATE "C" LIMIT %s
            ) SELECT s.group_id,s.script_type,s.balance_sats AS current_supply_sats,
                s.utxo_count AS current_utxo_count,
                CASE WHEN s.first_disclosure_height IS NOT NULL THEN s.eligible_sats ELSE 0 END AS exposed_supply_sats,
                CASE WHEN s.first_disclosure_height IS NOT NULL THEN s.eligible_utxos ELSE 0 END AS exposed_utxo_count,
                s.first_received_height AS first_received_blockheight,
                s.first_disclosure_height AS first_exposed_blockheight,be.time AS first_exposed_time,
                s.last_spend_height AS last_spend_blockheight,bs.time AS last_spend_time,
                s.display_group_id,s.details,s.identity
                FROM page s
                LEFT JOIN LATERAL (SELECT time FROM public.blockheader
                    WHERE blockheight=s.first_disclosure_height LIMIT 1) be ON true
                LEFT JOIN LATERAL (SELECT time FROM public.blockheader
                    WHERE blockheight=s.last_spend_height LIMIT 1) bs ON true
                ORDER BY s.group_id COLLATE "C",s.script_type COLLATE "C"''',params)
            rows=cur.fetchall()
        if not rows: return
        yield from (dict(row) for row in rows)
        if len(rows)<fetch_size: return
        position=(rows[-1]['group_id'],rows[-1]['script_type'])
