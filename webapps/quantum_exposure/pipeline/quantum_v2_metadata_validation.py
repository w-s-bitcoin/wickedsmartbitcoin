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

from quantum_v2_analysis import GROUPING_VERSION, METHODOLOGY_VERSION, PARSER_VERSION, classify_activity
from quantum_v2_validation import BIP30, _certify, _transaction, classify_source

FIELDS = 'blockheight,transactionid,vout,amount,address,scripttype,scripthex,spendingblock'
VERSION = 'bounded-historical-metadata-v2'
HEIGHT_FIELDS = ('first_received_height', 'first_disclosure_height', 'last_spend_height')
FAMILY_FIELDS = (*HEIGHT_FIELDS, 'display_group_id', 'first_disclosure_hash')


def _history(raw, group, height, removals, check_budget=lambda: None):
    """Independently reduce the enumerated history, without projection helpers."""
    families, disclosures = {}, []
    for number, key in enumerate(sorted(raw)):
        if number % 256 == 0:
            check_budget()
        row = raw[key]
        if not 0 <= row['blockheight'] <= height:
            raise ValueError('Historical occurrence lies outside the sampled checkpoint')
        script = (row['scripthex'] or '').lower()
        # The canonical source excludes these rows altogether. Genesis is
        # different: it establishes display/disclosure, but never first funding.
        if script.startswith('6a') or len(script) > 20000:
            continue
        actual_group, family, eligible, _ = classify_source(row)
        if actual_group != group:
            raise ValueError('Historical occurrence index disagrees with its raw-script group')
        display = script[2:-2] if family == 'P2PK' else row['address'] or group
        state = families.setdefault(family, dict(first_received_height=None,
            last_spend_height=None, display_group_id=display))
        created = row['blockheight']
        if created > 0 and state['first_received_height'] is None:
            state['first_received_height'] = created
        spent, removed = row['spendingblock'], removals.get(key)
        if spent is not None and spent <= height and (removed is None or spent < removed):
            state['last_spend_height'] = max(state['last_spend_height'] or 0, spent)
            if eligible:
                disclosures.append(spent)
        if eligible and (family in ('P2PK', 'P2TR') or str(row['scripttype']).startswith('Multisig ')):
            disclosures.append(created)
    return families, min(disclosures, default=None)


def _compare_metadata(families, disclosed, family_rows, registry, headers, height):
    """Compare all sampled families; a group minimum must not hide corruption."""
    expected = {'first_received_height': min((r['first_received_height'] for r in families.values()
                    if r['first_received_height'] is not None), default=None),
                'first_disclosure_height': disclosed,
                'last_spend_height': max((r['last_spend_height'] for r in families.values()
                    if r['last_spend_height'] is not None), default=None)}
    actual = {field: (max if field == 'last_spend_height' else min)(
        (row[field] for row in family_rows if row[field] is not None), default=None) for field in HEIGHT_FIELDS}
    disclosure_hash = headers.get(disclosed, {}).get('blockhash')
    expected_disclosure = {'exposed_height': disclosed, 'exposed_hash': disclosure_hash}
    actual_disclosure = ({'exposed_height': registry['exposed_height'], 'exposed_hash': registry['exposed_hash']}
                         if registry else {'exposed_height': None, 'exposed_hash': None})
    comparisons = []
    states = {row['script_type']: row for row in family_rows}
    for family in sorted(set(families) | set(states)):
        wanted = (dict(families[family], first_disclosure_height=disclosed,
                       first_disclosure_hash=disclosure_hash) if family in families else None)
        found = ({field: states[family][field] for field in FAMILY_FIELDS} if family in states else None)
        comparisons.append({'script_type': family, 'expected': wanted, 'actual': found, 'passed': wanted == found})
    referenced = {height}
    for row in [expected, *families.values(), *family_rows]:
        referenced.update(row[field] for field in HEIGHT_FIELDS if row.get(field) is not None)
    if registry:
        referenced.add(registry['exposed_height'])
    invalid = sorted(h for h in referenced if type(h) is not int or not 0 <= h <= height)
    missing = sorted(h for h in referenced if h not in headers or
                     not re.fullmatch('[0-9a-f]{64}', headers[h].get('blockhash') or ''))
    unknown_times = sorted(h for h in referenced if h in headers and
                           (type(headers[h].get('time')) is not int or headers[h]['time'] < 0))
    activity = {'expected': None, 'actual': None}
    if not invalid and not missing and not unknown_times:
        for label, metadata in (('expected', expected), ('actual', actual)):
            spent = metadata['last_spend_height']
            activity[label] = classify_activity(headers[spent]['time'] if spent is not None else None,
                                               headers[height]['time'], last_spend_height=spent)
    passed = (bool(families) and len(states) == len(family_rows) and expected == actual and
              expected_disclosure == actual_disclosure and all(row['passed'] for row in comparisons) and
              not invalid and not missing and not unknown_times and activity['expected'] == activity['actual'])
    result = dict(expected=expected, actual=actual, families=comparisons,
                  disclosure=dict(expected=expected_disclosure, actual=actual_disclosure),
                  activity=activity, passed=passed)
    if invalid:
        result['invalid_header_heights'] = invalid
    if missing or unknown_times:
        result.update(unresolved='Referenced canonical headers or exact timestamps are unavailable',
                      missing_header_heights=missing, unknown_time_heights=unknown_times)
    return result


def sample_metadata(conn, group_ids, *, max_occurrences=5000, seconds=30):
    """Check deterministic caller-selected groups with an explicit row/time cap.

    An incomplete/unresolved sample never passes. No validation cursors, tables,
    source rows, labels or publication files are changed by this operation.
    """
    selected = sorted(set(map(str, group_ids)))
    if not selected or len(selected) > 32 or not 1 <= max_occurrences <= 100000 or not 0 < seconds <= 300:
        raise ValueError('Select 1..32 groups, 1..100000 occurrences and at most 300 seconds')
    deadline = time.monotonic() + seconds

    def remaining():
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError('Metadata sample reached its explicit time budget')
        return remaining

    def budget(cur):
        cur.execute("SELECT set_config('statement_timeout',%s,true)", (str(max(1, int(remaining() * 1000))),))

    with _transaction(conn) as cur:
        budget(cur)
        cur.execute('SELECT * FROM quantum_v2.projection WHERE singleton FOR SHARE')
        projection = cur.fetchone()
        if not projection or projection['status'] != 'ready':
            raise ValueError('Metadata samples require a completed projection')
        height, target_hash = projection['height'], projection['block_hash']
        budget(cur)
        _certify(cur, height, target_hash)
        budget(cur)
        cur.execute("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' AND tablename ~ '^stxos_[0-9]+_[0-9]+_archive$'")
        sources = ['outputs'] + sorted(row['tablename'] for row in cur.fetchall())
        budget(cur)
        cur.execute('''SELECT s.* FROM unnest(%s::text[]) ids(group_id) CROSS JOIN LATERAL
            (SELECT * FROM quantum_v2.group_state WHERE group_id=ids.group_id ORDER BY script_type LIMIT 8) s''', (selected,))
        states = {}
        for row in cur.fetchall():
            states.setdefault(row['group_id'], []).append(row)
        if any(len(rows) > 7 for rows in states.values()):
            raise ValueError('Metadata sample exceeds supported family coverage')
        budget(cur)
        cur.execute('SELECT group_id,exposed_height,exposed_hash FROM quantum_v2.disclosure WHERE group_id=ANY(%s)', (selected,))
        registry = {row['group_id']: dict(row) for row in cur.fetchall()}
        budget(cur)
        cur.execute('SELECT blockheight,blockhash FROM public.blockheader WHERE blockheight=ANY(%s)',
                    ([h for entry in BIP30 for h in (entry[0], entry[3])],))
        headers = {row['blockheight']: row['blockhash'] for row in cur.fetchall()}
        removals = {(h, tx, vout): removed for h, tx, vout, removed, first_hash, last_hash in BIP30
                    if headers.get(h) == first_hash and headers.get(removed) == last_hash}
        report = {'version': VERSION, 'parser_version': PARSER_VERSION, 'grouping_version': GROUPING_VERSION,
                  'methodology_version': METHODOLOGY_VERSION, 'seed_mode': projection['seed_mode'],
                  'target_height': height, 'target_hash': target_hash, 'passed': True, 'samples': [],
                  'scope': 'Caller-selected enumerated history and family/registry/header consistency; '
                           'key-ledger completeness, cross-context disclosure and unsampled groups are not certified'}
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
                budget(cur)
                cur.execute("SELECT to_regclass('public.key_outputs_all') AS relation")
                if not cur.fetchone()['relation']:
                    sample['unresolved'] = 'Retained key occurrence ledger unavailable'
                    report['passed'] = False
                    continue
                budget(cur)
                cur.execute('''SELECT DISTINCT blockheight,transactionid,vout FROM public.key_outputs_all
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
                    # Deduplicate complete facts BEFORE the two-row conflict
                    # bound. Some archives lack occurrence uniqueness; two
                    # identical copies must not hide a third, conflicting copy.
                    # Lateral equalities keep probes on occurrence/height indexes.
                    values = sql.SQL(',').join(sql.SQL('(%s::bigint,%s::text,%s::integer)') for _ in occurrence_keys)
                    statement = sql.SQL('SELECT o.* FROM (VALUES ') + values + sql.SQL(') k(h,tx,v) CROSS JOIN LATERAL (SELECT DISTINCT ' + FIELDS +
                        ' FROM {} WHERE blockheight=k.h AND transactionid=k.tx AND vout=k.v LIMIT 2) o').format(sql.Identifier('public', source))
                    cur.execute(statement, tuple(value for key in occurrence_keys for value in key))
                else:
                    cur.execute(sql.SQL('SELECT DISTINCT ' + FIELDS + ''' FROM {} WHERE address=%s AND blockheight<=%s
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
            families, disclosed = _history(raw, group, height, removals, remaining)
            needed = {height}
            for row in [*families.values(), *family_rows]:
                needed.update(row.get(field) for field in HEIGHT_FIELDS if row.get(field) is not None)
            if disclosed is not None:
                needed.add(disclosed)
            if group in registry:
                needed.add(registry[group]['exposed_height'])
            budget(cur)
            cur.execute('SELECT blockheight,blockhash,time FROM public.blockheader WHERE blockheight=ANY(%s)', (sorted(needed),))
            exact_headers = {row['blockheight']: dict(row) for row in cur.fetchall()}
            sample.update(_compare_metadata(families, disclosed, family_rows, registry.get(group), exact_headers, height))
            report['passed'] = report['passed'] and sample['passed']
        remaining()
        report['raw_occurrences'] = consumed
        report['elapsed_seconds'] = round(seconds - (deadline - time.monotonic()), 3)
        return report
