#!/usr/bin/env python3
"""Explicit one-source enrichment imports and versioned verified policy caching.

No source/database work occurs on import. Importing a published snapshot is a
one-time operator action, never a per-snapshot historical vote. Existing detail
labels remain qualified legacy annotations. Bare locking policies and validated
redeem/witness commitments use separate evidence keys; unresolved parses are
persisted without promoting them to verified policies.
"""
from __future__ import annotations

import csv
from dataclasses import dataclass
import hashlib
import io
import itertools
import json
from pathlib import Path
from typing import Iterable, Mapping

from quantum_v2_analysis import PARSER_VERSION, committed_multisig, hash160, parse_multisig, valid_pubkey

MIGRATION = Path(__file__).with_name('migrations') / '003_enrichment.sql'
BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
BECH32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'


def _require_idle(conn):
    if conn.get_transaction_status() != 0:
        raise ValueError('Enrichment writes require an idle connection; unrelated work was not committed')


def _require_writer(cur):
    cur.execute('SELECT pg_try_advisory_xact_lock(811947,2) AS owned')
    value=cur.fetchone()
    if not (value['owned'] if isinstance(value,Mapping) else value[0]):
        raise RuntimeError('Another Quantum worker or maintenance session is running')


def migrate(conn):
    _require_idle(conn)
    body = MIGRATION.read_text(encoding='utf-8')
    digest = hashlib.sha256(body.encode()).hexdigest()
    with conn:
        with conn.cursor() as cur:
            _require_writer(cur)
            cur.execute('SELECT sha256 FROM quantum_v2.schema_migration WHERE version=3')
            row = cur.fetchone()
            if row:
                if row[0] != digest:
                    raise ValueError('Applied enrichment migration differs from checked-in version')
                return
            cur.execute(body)
            cur.execute('INSERT INTO quantum_v2.schema_migration(version,sha256) VALUES(3,%s)', (digest,))


def _base58_keyhash(address: str) -> str | None:
    if not address or address[0] != '1':
        return None
    value = 0
    try:
        for letter in address:
            value = value * 58 + BASE58.index(letter)
    except ValueError:
        return None
    raw = b'\x00' * (len(address) - len(address.lstrip('1'))) + value.to_bytes((value.bit_length()+7)//8, 'big')
    if len(raw) != 25 or raw[0] != 0 or hashlib.sha256(hashlib.sha256(raw[:-4]).digest()).digest()[:4] != raw[-4:]:
        return None
    return raw[1:21].hex()


def _bech32_keyhash(address: str) -> str | None:
    if address.lower() != address and address.upper() != address:
        return None
    address = address.lower()
    if not address.startswith('bc1') or len(address) != 42:
        return None
    try:
        data = [BECH32.index(char) for char in address[3:]]
    except ValueError:
        return None
    values = [ord(c) >> 5 for c in 'bc'] + [0] + [ord(c) & 31 for c in 'bc'] + data
    checksum = 1
    generators = (0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3)
    for value in values:
        high = checksum >> 25
        checksum = ((checksum & 0x1ffffff) << 5) ^ value
        for index, generator in enumerate(generators):
            if high >> index & 1:
                checksum ^= generator
    if checksum != 1 or data[0] != 0:
        return None
    accumulator, bits, result = 0, 0, bytearray()
    for value in data[1:-6]:
        accumulator = (accumulator << 5) | value
        bits += 5
        if bits >= 8:
            bits -= 8
            result.append((accumulator >> bits) & 255)
    if bits >= 5 or (accumulator << (8-bits)) & 255 or len(result) != 20:
        return None
    return result.hex()


def subject_aliases(row: Mapping) -> set[str]:
    subjects = set()
    if row.get('group_id'):
        subjects.add(str(row['group_id']))
    for value in str(row.get('display_group_ids') or row.get('display_group_id') or '').split('|'):
        value = value.strip()
        if not value:
            continue
        subjects.add(value)
        try:
            key = bytes.fromhex(value)
        except ValueError:
            key = b''
        if valid_pubkey(key):
            subjects.add(hash160(key).hex())
        if len(key) == 20:
            subjects.add(key.hex())
        keyhash = _base58_keyhash(value) or _bech32_keyhash(value)
        if keyhash:
            subjects.add(keyhash)
    return subjects


def _copy_batch(cur, rows):
    if not rows:
        return
    buffer = io.StringIO()
    # COPY CSV interprets an unquoted empty field as SQL NULL. These columns
    # intentionally preserve empty strings (identity-only/details-only labels).
    writer = csv.writer(buffer, quoting=csv.QUOTE_ALL)
    writer.writerows(rows)
    buffer.seek(0)
    cur.copy_expert('COPY quantum_attribution_import(subject_id,identity,details) FROM STDIN WITH (FORMAT CSV)', buffer)


def import_snapshot_labels(conn, csv_path: Path, *, revision: str | None = None) -> dict:
    """Atomically import one explicit CSV revision; conflicting aliases fail closed.

    Existing revisions are immutable and idempotent by exact file SHA-256. The
    PostgreSQL staging table handles deduplication; Python holds at most 2,048
    label/alias records at a time. Connection must not have unrelated pending work.
    """
    _require_idle(conn)
    csv_path = Path(csv_path).resolve()
    digest = hashlib.sha256()
    with csv_path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024*1024), b''):
            digest.update(chunk)
    file_hash = digest.hexdigest()
    revision = revision or f'legacy-{csv_path.parent.name}-{file_hash[:16]}'
    with conn:
        with conn.cursor() as cur:
            _require_writer(cur)
            cur.execute('SELECT source_sha256 FROM quantum_v2.enrichment_revision WHERE revision=%s', (revision,))
            previous = cur.fetchone()
            if previous:
                if previous[0] != file_hash:
                    raise ValueError('An enrichment revision cannot be overwritten with different evidence')
                return {'revision': revision, 'source_sha256': file_hash, 'already_imported': True}
            cur.execute('CREATE TEMP TABLE quantum_attribution_import(subject_id text,identity text,details text) ON COMMIT DROP')
            batch, input_rows = [], 0
            parsed_digest = hashlib.sha256()
            with csv_path.open('rb') as stream:
                def hashed_lines():
                    for line in stream:
                        parsed_digest.update(line)
                        yield line.decode('utf-8')
                for row in csv.DictReader(hashed_lines()):
                    identity, details = (row.get('identity') or '').strip(), (row.get('details') or '').strip()
                    if details == 'None':
                        details = ''
                    if not identity and not details:
                        continue
                    input_rows += 1
                    for subject in sorted(subject_aliases(row)):
                        batch.append((subject, identity, details))
                        if len(batch) >= 2048:
                            _copy_batch(cur, batch)
                            batch.clear()
            _copy_batch(cur, batch)
            if parsed_digest.hexdigest() != file_hash:
                raise ValueError("Label source changed while being imported; retry from an immutable snapshot")
            cur.execute('''SELECT COUNT(*) FROM (
                SELECT subject_id FROM quantum_attribution_import GROUP BY subject_id
                HAVING COUNT(DISTINCT NULLIF(identity,''))>1 OR COUNT(DISTINCT NULLIF(details,''))>1
            ) conflicts''')
            if cur.fetchone()[0]:
                raise ValueError('Source labels conflict for the same subject; supply a curated explicit revision')
            cur.execute('INSERT INTO quantum_v2.enrichment_revision(revision,source,source_sha256,kind) VALUES(%s,%s,%s,%s)',
                        (revision, str(csv_path), file_hash, 'legacy-snapshot'))
            cur.execute('''INSERT INTO quantum_v2.attribution(revision,subject_id,identity,details,details_quality)
                SELECT %s,subject_id,MAX(identity),MAX(details),'legacy-annotation'
                FROM quantum_attribution_import GROUP BY subject_id''', (revision,))
            return {'revision': revision, 'source_sha256': file_hash, 'input_rows': input_rows, 'subjects': cur.rowcount, 'already_imported': False}


def iter_enriched_rows(conn, rows: Iterable[Mapping], *, revision: str, fetch_size: int = 2048,
                       predicate=None):
    """Enrich canonical projection identities without repeating address decoding.

    Import resolves validated address/public-key aliases once. Projection rows
    already carry canonical key hashes or script addresses, so export needs only
    those IDs and literal displays to retrieve the immutable annotations.
    A predicate may limit annotations to already reduced groups used in detail
    views. All other rows pass through in order without an attribution lookup.
    """
    if fetch_size <= 0:
        raise ValueError('fetch_size must be positive')
    iterator = iter(rows)
    with conn.cursor() as cur:
        cur.execute('SELECT 1 FROM quantum_v2.enrichment_revision WHERE revision=%s', (revision,))
        if not cur.fetchone():
            raise ValueError(f'Unknown enrichment revision: {revision}')
        while batch := list(itertools.islice(iterator, fetch_size)):
            eligible = [predicate(row) if predicate is not None else True for row in batch]
            if not any(eligible):
                yield from batch
                continue
            aliases = [({str(row['group_id'])} | {
                value.strip() for value in str(row.get('display_group_ids') or
                                               row.get('display_group_id') or '').split('|') if value.strip()
            }) if selected else set() for row, selected in zip(batch, eligible)]
            subjects = sorted(set().union(*aliases))
            labels = {}
            if subjects:
                cur.execute('SELECT subject_id,identity,details,details_quality FROM quantum_v2.attribution WHERE revision=%s AND subject_id=ANY(%s)', (revision, subjects))
                labels = {row[0]: row[1:] for row in cur.fetchall()}
            for original, candidates, should_enrich in zip(batch, aliases, eligible):
                if not should_enrich:
                    yield original
                    continue
                row = dict(original)
                selected = labels.get(str(row['group_id']))
                if selected is None:
                    matches = {labels[subject] for subject in candidates if subject in labels}
                    if len(matches) > 1:
                        raise ValueError('Conflicting label aliases encountered during export')
                    selected = next(iter(matches), None)
                if selected:
                    row['identity'], row['details'], row['details_quality'] = selected
                    if 'slices' in row and not row['details']:
                        # canonical_groups retains quality only for nonempty
                        # detail annotations. Preserve raw-then-group parity.
                        row['details_quality'] = 'unresolved'
                yield row


# Bare policies are self-contained locking-script evidence. This domain is
# intentionally distinct from the original [scriptSig,witness] commitment cache
# key; old unresolved P2SH-style attempts on a bare script cannot poison it.
BARE_EVIDENCE_SHA256 = hashlib.sha256(b'quantum-policy-cache:bare-locking-script:v1').hexdigest()
POLICY_CACHE_BATCH_SIZE = 1024


@dataclass(frozen=True)
class PolicyParse:
    locking_script_sha256: str
    parser_version: str
    evidence_sha256: str
    policy_kind: str
    status: str
    m: int | None
    n: int | None
    public_keys: tuple[bytes, ...]

    def result(self):
        return dict(status=self.status,m=self.m,n=self.n,public_keys=[key.hex() for key in self.public_keys])

    def bare_eligible(self, locking_script: str) -> bool:
        """Require the cache result to bind the exact caller's bytes and parser.

        Curve validity was established by this parser version on the cache miss.
        A hit checks the full policy serialization rather than treating an
        unrelated status/threshold dictionary as proof for the current output.
        Cache source height/reference are deliberately absent from this object.
        """
        raw=bytes.fromhex(locking_script)
        if (self.policy_kind!='bare' or self.parser_version!=PARSER_VERSION or
                self.evidence_sha256!=BARE_EVIDENCE_SHA256 or
                self.locking_script_sha256!=hashlib.sha256(raw).hexdigest()):
            raise ValueError('Cached bare policy does not bind the exact locking script and parser version')
        if self.status=='unresolved':
            if self.m is not None or self.n is not None or self.public_keys:
                raise ValueError('Malformed unresolved policy-cache record')
            return False
        if (self.status!='recognized' or self.m is None or self.n is None or
                not 1<=self.m<=self.n<=16 or len(self.public_keys)!=self.n or
                any(len(key) not in (33,65) for key in self.public_keys) or
                not raw or raw[-1] not in (0xae,0xaf)):
            raise ValueError('Malformed recognized policy-cache record')
        reconstructed=bytes([0x50+self.m])+b''.join(bytes([len(key)])+key for key in self.public_keys)+bytes([0x50+self.n,raw[-1]])
        if reconstructed!=raw:
            raise ValueError('Cached policy threshold/keys do not match the exact locking script')
        return True


def _policy_request(request: Mapping):
    kind=request.get('policy_kind','committed')
    if kind not in ('bare','committed'):raise ValueError('Unknown policy evidence kind')
    locking=request['locking_script']
    raw=bytes.fromhex(locking)
    sig=request.get('spending_script','') or ''
    witness=request.get('spending_witness','') or ''
    if not isinstance(sig,str) or not isinstance(witness,str):raise TypeError('Policy evidence must use source text encoding')
    if kind=='bare' and (sig or witness):raise ValueError('Bare policy evidence is the locking script alone')
    digest=BARE_EVIDENCE_SHA256 if kind=='bare' else hashlib.sha256(json.dumps([sig,witness],separators=(',',':')).encode()).hexdigest()
    key=(hashlib.sha256(raw).hexdigest(),PARSER_VERSION,digest)
    return key,dict(request,policy_kind=kind,locking_script=raw.hex(),spending_script=sig,spending_witness=witness)


def _parse_record(key,kind,record):
    status,m,n,public_keys=record
    if status not in ('recognized','unresolved') or not isinstance(public_keys,list):
        raise ValueError('Malformed policy-cache record')
    try:keys=tuple(bytes.fromhex(value) for value in public_keys)
    except (ValueError,TypeError) as exc:raise ValueError('Malformed policy-cache public keys') from exc
    result=PolicyParse(*key,kind,status,m,n,keys)
    if status=='unresolved' and (m is not None or n is not None or keys):
        raise ValueError('Malformed unresolved policy-cache record')
    if status=='recognized' and (m is None or n is None or not 1<=m<=n<=16 or len(keys)!=n):
        raise ValueError('Malformed recognized policy-cache record')
    return result


def cache_policy_batch(cur, requests: Iterable[Mapping]) -> list[PolicyParse]:
    """One bounded, transaction-owned lookup/insert batch of immutable parses.

    At most 1024 requests enter this API; duplicates are parsed/written once.
    Results retain request order. Both positive and negative entries include the
    parser version and complete evidence key, so new witness evidence or parser
    versions cannot reuse an obsolete unresolved result. Source provenance is
    informational and is never returned as a disclosure/funding fact.
    """
    from psycopg2.extras import execute_values
    if cur.connection.autocommit:raise ValueError('Policy cache writes require an explicit transaction')
    requests=list(itertools.islice(iter(requests),POLICY_CACHE_BATCH_SIZE+1))
    if len(requests)>POLICY_CACHE_BATCH_SIZE:raise ValueError('Policy cache batch exceeds 1024 requests')
    if not requests:return []
    _require_writer(cur)
    ordered=[];unique={}
    for request in requests:
        key,normalized=_policy_request(request);ordered.append(key);unique.setdefault(key,normalized)
    records=execute_values(cur,'''SELECT wanted.locking_script_sha256,wanted.parser_version,wanted.evidence_sha256,
        cached.parse_status,cached.threshold_m,cached.key_count_n,cached.public_keys
        FROM (VALUES %s) wanted(locking_script_sha256,parser_version,evidence_sha256)
        LEFT JOIN LATERAL (SELECT parse_status,threshold_m,key_count_n,public_keys
            FROM quantum_v2.policy_parse_cache c
            WHERE c.locking_script_sha256=wanted.locking_script_sha256
              AND c.parser_version=wanted.parser_version AND c.evidence_sha256=wanted.evidence_sha256 LIMIT 1) cached ON true''',
        list(unique),page_size=POLICY_CACHE_BATCH_SIZE,fetch=True)
    found={};pending=[]
    for record in records:
        if isinstance(record,Mapping):
            key=tuple(record[name] for name in ('locking_script_sha256','parser_version','evidence_sha256'))
            values=tuple(record[name] for name in ('parse_status','threshold_m','key_count_n','public_keys'))
        else:key=tuple(record[:3]);values=record[3:]
        request=unique[key];kind=request['policy_kind']
        if values[0] is not None:
            result=_parse_record(key,kind,values)
        else:
            parsed=(parse_multisig(request['locking_script']) if kind=='bare' else
                    committed_multisig(request['spending_script'],request['spending_witness'],request['locking_script']))
            result=PolicyParse(*key,kind,'recognized' if parsed else 'unresolved',parsed[0] if parsed else None,
                               len(parsed[1]) if parsed else None,tuple(parsed[1]) if parsed else ())
            pending.append((*key,result.status,result.m,result.n,json.dumps([key.hex() for key in result.public_keys]),
                            request.get('source_height'),request.get('source_reference','')))
        if kind=='bare':result.bare_eligible(request['locking_script'])
        found[key]=result
    if pending:
        execute_values(cur,'''INSERT INTO quantum_v2.policy_parse_cache
            (locking_script_sha256,parser_version,evidence_sha256,parse_status,threshold_m,key_count_n,public_keys,source_height,source_reference)
            VALUES %s ON CONFLICT DO NOTHING''',pending,
            template='(%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s)',page_size=POLICY_CACHE_BATCH_SIZE)
    return [found[key] for key in ordered]


def cache_committed_policy(cur, *, locking_script: str, spending_script: str = '', spending_witness: str = '',
                           source_height: int | None = None, source_reference: str = '') -> dict:
    """Compatibility API; witness changes have distinct positive/negative keys."""
    return cache_policy_batch(cur,[dict(locking_script=locking_script,spending_script=spending_script,
        spending_witness=spending_witness,source_height=source_height,source_reference=source_reference)])[0].result()
