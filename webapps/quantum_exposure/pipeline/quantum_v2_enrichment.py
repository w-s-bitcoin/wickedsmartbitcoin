#!/usr/bin/env python3
"""Explicit one-source enrichment imports and versioned verified policy caching.

No source/database work occurs on import. Importing a published snapshot is a
one-time operator action, never a per-snapshot historical vote. Existing detail
labels remain qualified legacy annotations; only commitment-validated policies
enter the verified parse cache.
"""
from __future__ import annotations

import csv
import hashlib
import io
import itertools
import json
from pathlib import Path
from typing import Iterable, Mapping

from quantum_v2_analysis import PARSER_VERSION, committed_multisig, hash160, valid_pubkey

MIGRATION = Path(__file__).with_name('migrations') / '003_enrichment.sql'
BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
BECH32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'


def _require_idle(conn):
    if conn.get_transaction_status() != 0:
        raise ValueError('Enrichment writes require an idle connection; unrelated work was not committed')


def _require_writer(cur):
    cur.execute('SELECT pg_try_advisory_xact_lock(811947,2)')
    if not cur.fetchone()[0]:
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


def cache_committed_policy(cur, *, locking_script: str, spending_script: str = '', spending_witness: str = '',
                           source_height: int | None = None, source_reference: str = '') -> dict:
    """Cache one proof-bearing parse; new witness evidence invalidates a negative hit."""
    if cur.connection.autocommit:
        raise ValueError('Policy cache writes require an explicit transaction')
    _require_writer(cur)
    raw = bytes.fromhex(locking_script)
    script_hash = hashlib.sha256(raw).hexdigest()
    evidence_hash = hashlib.sha256(json.dumps([spending_script, spending_witness], separators=(',', ':')).encode()).hexdigest()
    cur.execute('''SELECT parse_status,threshold_m,key_count_n,public_keys FROM quantum_v2.policy_parse_cache
                   WHERE locking_script_sha256=%s AND parser_version=%s AND evidence_sha256=%s''',
                (script_hash, PARSER_VERSION, evidence_hash))
    cached = cur.fetchone()
    if cached:
        return dict(status=cached[0], m=cached[1], n=cached[2], public_keys=cached[3])
    parsed = committed_multisig(spending_script, spending_witness, locking_script)
    result = dict(status='recognized' if parsed else 'unresolved', m=parsed[0] if parsed else None,
                  n=len(parsed[1]) if parsed else None, public_keys=[key.hex() for key in parsed[1]] if parsed else [])
    cur.execute('''INSERT INTO quantum_v2.policy_parse_cache
        (locking_script_sha256,parser_version,evidence_sha256,parse_status,threshold_m,key_count_n,public_keys,source_height,source_reference)
        VALUES(%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s) ON CONFLICT DO NOTHING''',
        (script_hash, PARSER_VERSION, evidence_hash, result['status'], result['m'], result['n'],
         json.dumps(result['public_keys']), source_height, source_reference))
    return result
