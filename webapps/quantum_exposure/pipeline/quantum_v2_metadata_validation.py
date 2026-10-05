"""Bounded, explicit historical metadata samples; no implicit DB connections.

Key-group occurrence enumeration uses the retained key_outputs_all ledger, then
verifies those occurrences against raw source rows. This checks the enumerated
history, not the completeness of that historical ledger. Non-key addresses use
the raw source's address indexes directly. Reports are returned, never published.
"""
from __future__ import annotations

import re
import time

from psycopg2 import sql

from quantum_v2_validation import BIP30, _certify, _transaction, classify_source

FIELDS = 'blockheight,transactionid,vout,amount,address,scripttype,scripthex,spendingblock'


def sample_metadata(conn, group_ids, *, max_occurrences=5000, seconds=30):
    """Check deterministic caller-selected groups with an explicit row/time cap.

    An incomplete/unresolved sample never passes. No validation cursors, tables,
    source rows, labels or publication files are changed by this operation.
    """
    selected = sorted(set(map(str, group_ids)))
    if not selected or len(selected) > 32 or not 1 <= max_occurrences <= 100000 or not 0 < seconds <= 300:
        raise ValueError('Select 1..32 groups, 1..100000 occurrences and at most 300 seconds')
    deadline = time.monotonic() + seconds

    def budget(cur):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError('Metadata sample reached its explicit time budget')
        cur.execute("SELECT set_config('statement_timeout',%s,true)", (str(max(1, int(remaining * 1000))),))

    with _transaction(conn) as cur:
        cur.execute('SELECT * FROM quantum_v2.projection WHERE singleton FOR SHARE')
        projection = cur.fetchone()
        if not projection or projection['status'] != 'ready':
            raise ValueError('Metadata samples require a completed projection')
        height, target_hash = projection['height'], projection['block_hash']
        _certify(cur, height, target_hash)
        cur.execute("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' AND tablename ~ '^stxos_[0-9]+_[0-9]+_archive$'")
        sources = ['outputs'] + sorted(row['tablename'] for row in cur.fetchall())
        cur.execute('SELECT * FROM quantum_v2.group_state WHERE group_id=ANY(%s)', (selected,))
        states = {}
        for row in cur.fetchall():
            states.setdefault(row['group_id'], []).append(row)
        cur.execute('SELECT blockheight,blockhash FROM public.blockheader WHERE blockheight=ANY(%s)',
                    ([h for entry in BIP30 for h in (entry[0], entry[3])],))
        headers = {row['blockheight']: row['blockhash'] for row in cur.fetchall()}
        removals = {(h, tx, vout): removed for h, tx, vout, removed, first_hash, last_hash in BIP30
                    if headers.get(h) == first_hash and headers.get(removed) == last_hash}
        report = {'target_height': height, 'target_hash': target_hash, 'passed': True, 'samples': [],
                  'scope': 'Caller-selected history; key-ledger completeness and cross-context disclosure are not certified'}
        consumed = 0
        for group in selected:
            budget(cur)
            sample = {'group_id': group, 'passed': False}
            report['samples'].append(sample)
            family_rows = states.get(group)
            if not family_rows:
                sample['unresolved'] = 'No projection group exists'
                report['passed'] = False
                continue
            capacity = max_occurrences - consumed
            if capacity <= 0:
                sample['unresolved'] = 'Occurrence budget exhausted'
                report['passed'] = False
                continue
            raw = {}
            is_key = any(row['script_type'] in ('P2PK', 'P2PKH', 'P2WPKH') for row in family_rows)
            occurrence_keys = None
            if is_key:
                sample['enumeration'] = 'key_outputs_all index; each occurrence re-read from raw source'
                if not re.fullmatch('[0-9a-f]{40}', group):
                    raise ValueError('Key group identifier is not a HASH160')
                cur.execute("SELECT to_regclass('public.key_outputs_all') AS relation")
                if not cur.fetchone()['relation']:
                    sample['unresolved'] = 'Retained key occurrence ledger unavailable'
                    report['passed'] = False
                    continue
                budget(cur)
                cur.execute('''SELECT blockheight,transactionid,vout FROM public.key_outputs_all
                    WHERE keyhash20=%s AND blockheight<=%s ORDER BY blockheight,transactionid,vout LIMIT %s''',
                            (bytes.fromhex(group), height, capacity + 1))
                occurrence_keys = [(row['blockheight'], row['transactionid'], row['vout']) for row in cur.fetchall()]
            elif group.startswith('script:'):
                sample['unresolved'] = 'Null-address script group has no bounded historical script index'
                report['passed'] = False
                continue
            elif match := re.fullmatch(r'out:(\d+):([^:]+):(\d+)', group):
                occurrence_keys = [(int(match[1]), match[2], int(match[3]))]
                sample['enumeration'] = 'Exact source occurrence primary key'
            else:
                sample['enumeration'] = 'Raw source address indexes'
            if occurrence_keys is not None and len(occurrence_keys) > capacity:
                sample['unresolved'] = 'Historical occurrence count exceeds the explicit budget'
                report['passed'] = False
                continue
            for source in sources:
                budget(cur)
                if occurrence_keys is not None:
                    if not occurrence_keys:
                        continue
                    # Lateral equality lookups keep each probe on occurrence PKs,
                    # avoiding a hash join that could scan an entire archive.
                    values = sql.SQL(',').join(sql.SQL('(%s::bigint,%s::text,%s::integer)') for _ in occurrence_keys)
                    statement = sql.SQL('SELECT o.* FROM (VALUES ') + values + sql.SQL(') k(h,tx,v) CROSS JOIN LATERAL (SELECT ' + FIELDS +
                        ' FROM {} WHERE blockheight=k.h AND transactionid=k.tx AND vout=k.v LIMIT 2) o').format(sql.Identifier('public', source))
                    cur.execute(statement, tuple(value for key in occurrence_keys for value in key))
                else:
                    cur.execute(sql.SQL('SELECT ' + FIELDS + ''' FROM {} WHERE address=%s AND blockheight<=%s
                        AND (scripttype NOT IN ('pubkey','pubkeyhash','witness_v0_keyhash') OR scripttype IS NULL)
                        ORDER BY blockheight,transactionid,vout LIMIT %s''').format(sql.Identifier('public', source)),
                                (group, height, capacity + 1))
                for row in cur.fetchall():
                    key = (row['blockheight'], row['transactionid'], row['vout'])
                    if key in raw and dict(raw[key]) != dict(row):
                        raise ValueError('Metadata source locations disagree for one occurrence')
                    raw[key] = row
                if len(raw) > capacity:
                    break
            if len(raw) > capacity:
                sample['unresolved'] = 'Historical occurrence count exceeds the explicit budget'
                report['passed'] = False
                continue
            consumed += len(raw)
            sample['raw_occurrences'] = len(raw)
            if not raw or (occurrence_keys is not None and set(occurrence_keys) != set(raw)):
                sample['unresolved'] = 'Enumerated historical occurrences are missing from retained raw source'
                report['passed'] = False
                continue
            funding, spends, disclosures = [], [], []
            for key, row in raw.items():
                actual_group, family, eligible, excluded = classify_source(row)
                if actual_group != group:
                    raise ValueError('Historical occurrence index disagrees with its raw-script group')
                if not excluded:
                    funding.append(row['blockheight'])
                spent, removed = row['spendingblock'], removals.get(key)
                if spent is not None and spent <= height and (removed is None or spent < removed):
                    spends.append(spent)
                    if eligible:
                        disclosures.append(spent)
                if eligible and (family in ('P2PK', 'P2TR') or str(row['scripttype']).startswith('Multisig ')):
                    disclosures.append(row['blockheight'])
            expected = {'first_received_height': min(funding, default=None), 'last_spend_height': max(spends, default=None),
                        'first_disclosure_height': min(disclosures, default=None)}
            actual = {field: (max if field == 'last_spend_height' else min)(
                (row[field] for row in family_rows if row[field] is not None), default=None) for field in expected}
            sample.update(expected=expected, actual=actual, passed=expected == actual)
            report['passed'] = report['passed'] and sample['passed']
        report['raw_occurrences'] = consumed
        report['elapsed_seconds'] = round(seconds - (deadline - time.monotonic()), 3)
        return report
