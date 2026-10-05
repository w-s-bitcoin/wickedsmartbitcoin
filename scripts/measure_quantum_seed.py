#!/usr/bin/env python3
"""Bounded legacy-family seed sample; no source/projection/label mutations.

An explicit creation-height window and row cap are mandatory. Optional temporary
compact-state sizing disappears at transaction end. Samples are biased by their
selected window and cannot establish total group cardinality or rollout speed.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'webapps/quantum_exposure/pipeline'))

TABLES = {'active_key_outputs': None, 'active_p2sh_outputs': 'P2SH',
          'active_p2wsh_outputs': 'P2WSH', 'active_p2tr_outputs': 'P2TR',
          'active_bare_ms_outputs': 'Other'}
KEY_FAMILIES = {'pubkey': 'P2PK', 'pubkeyhash': 'P2PKH', 'witness_v0_keyhash': 'P2WPKH'}


def reduce_sample(rows, table, height, removals=None):
    """Bounded amount/count/date-shape reduction, without claiming key eligibility."""
    if table not in TABLES:
        raise ValueError('Unknown legacy family table')
    groups, widths, physical_bytes = {}, [], 0
    removals = removals or {}
    for row in rows:
        if table == 'active_key_outputs':
            group = bytes(row['keyhash20']).hex()
            family = KEY_FAMILIES[row['script_type']]
        else:
            if not row['address']:
                raise ValueError('Address-family sample contains an unresolved null group identity')
            group, family = row['address'], TABLES[table]
        state = groups.setdefault((group, family), [0, 0, None, None])
        created, spent = row['blockheight'], row['spendingblock']
        removed = removals.get((created, row['transactionid'], row['vout']))
        if removed is not None and spent is not None and spent >= removed:
            spent = None
        if created > 0:
            state[2] = min(state[2], created) if state[2] is not None else created
        if spent is not None and spent <= height:
            state[3] = max(state[3], spent) if state[3] is not None else spent
        elif created > 0 and created <= height and (removed is None or removed > height):
            if row['amount'] < 0:
                raise ValueError('Negative source amount')
            state[0] += row['amount']
            state[1] += 1
        width = int(row['source_row_bytes'])
        widths.append(width)
        physical_bytes += width
    by_family = {}
    for (group, family), state in groups.items():
        metrics = by_family.setdefault(family, dict(group_families=0, sample_live_group_families=0,
                                                   sample_current_utxos=0, sample_current_balance_sats=0))
        metrics['group_families'] += 1
        metrics['sample_live_group_families'] += int(state[1] > 0)
        metrics['sample_current_utxos'] += state[1]
        metrics['sample_current_balance_sats'] += state[0]
    summary = {'rows': len(rows), 'distinct_reporting_groups': len({group for group, family in groups}),
               'group_family_rows': len(groups), 'by_family': by_family,
               'source_tuple_bytes': physical_bytes,
               'source_tuple_bytes_mean': physical_bytes / len(rows) if rows else None,
               'source_tuple_bytes_min': min(widths, default=None), 'source_tuple_bytes_max': max(widths, default=None),
               'group_rows_json_bytes': sum(len(json.dumps((group, family, *state), separators=(',', ':')).encode())
                                           for (group, family), state in groups.items()),
               'first_occurrence': [rows[0][name] for name in ('blockheight', 'transactionid', 'vout')] if rows else None,
               'last_occurrence': [rows[-1][name] for name in ('blockheight', 'transactionid', 'vout')] if rows else None}
    return groups, summary


def measure(conn, *, table, height, start_height, end_height, row_limit,
            after_txid='', after_vout=-1, temp_state=False, statement_seconds=60, monitor_factory=None):
    from psycopg2 import sql
    from psycopg2.extras import RealDictCursor, execute_values
    from quantum_resources import ResourceMonitor, database_usage, lower_priority
    from quantum_v2_validation import BIP30

    if (table not in TABLES or not 0 <= start_height <= end_height <= height or not 1 <= row_limit <= 100000
            or not 1 <= statement_seconds <= 300 or after_vout < -1):
        raise ValueError('Require a known table, creation range within target, 1..100000 rows and 1..300 seconds')
    if conn.get_transaction_status() != 0:
        raise ValueError('Sampling requires an idle connection')
    conn.set_session(readonly=not temp_state, isolation_level='REPEATABLE READ', autocommit=False)
    evidence = {'scope': 'one bounded legacy family creation-window sample', 'status': 'running',
                'table': table, 'analysis_height': height, 'start_height': start_height, 'end_height': end_height,
                'row_limit': row_limit, 'temporary_state_requested': temp_state,
                'limitations': ['Selected rows are not a random or complete family sample.',
                                'Group cardinality and partial balances must not be extrapolated as exact totals.',
                                'Raw script hydration, curve/policy eligibility and full producer cost are not measured.',
                                'Temporary display identifiers use group IDs; real key displays/labels can increase row size.',
                                'Cluster WAL/database I/O counters include concurrent unrelated activity.']}
    lock_owned = False
    monitor = None
    started = time.monotonic()
    try:
        with conn, conn.cursor() as cur:
            cur.execute('SELECT pg_try_advisory_lock(811947,2)')
            lock_owned = cur.fetchone()[0]
            if not lock_owned:
                raise RuntimeError('Quantum worker is active; sample separately from production work')
        lower_priority(conn.get_backend_pid())
        evidence['before_database'] = database_usage(conn)
        with (monitor_factory or ResourceMonitor)(conn) as monitor:
            with conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("SELECT set_config('statement_timeout',%s,true)", (str(statement_seconds * 1000),))
                cur.execute("SET LOCAL work_mem='32MB'")
                cur.execute('SET LOCAL max_parallel_workers_per_gather=0')
                cur.execute("SET LOCAL temp_file_limit='2GB'")
                cur.execute("SET LOCAL lock_timeout='2s'")
                cur.execute('SELECT freeze_blockheight FROM public.analysis_freeze WHERE name=%s', (table,))
                freeze = cur.fetchone()
                evidence['family_freeze_height'] = freeze['freeze_blockheight'] if freeze else None
                if not freeze or freeze['freeze_blockheight'] != height:
                    raise ValueError('Requested analysis height differs from this family freeze')
                cur.execute('''SELECT c.reltuples::bigint AS estimated_rows,c.relpages,
                    pg_relation_size(c.oid) AS heap_bytes,pg_indexes_size(c.oid) AS index_bytes,
                    st.last_analyze,st.last_autoanalyze
                    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                    LEFT JOIN pg_stat_all_tables st ON st.relid=c.oid
                    WHERE n.nspname='public' AND c.relname=%s''', (table,))
                evidence['relation_estimates'] = dict(cur.fetchone())
                cur.execute('''SELECT attname,n_distinct,null_frac,avg_width,correlation FROM pg_stats
                    WHERE schemaname='public' AND tablename=%s AND attname=ANY(%s) ORDER BY attname''',
                            (table, ['keyhash20', 'address', 'script_type']))
                evidence['column_estimates'] = [dict(row) for row in cur.fetchall()]
                cur.execute('SELECT blockheight,blockhash FROM public.blockheader WHERE blockheight=ANY(%s)',
                            ([h for item in BIP30 for h in (item[0], item[3])],))
                headers = {row['blockheight']: row['blockhash'] for row in cur.fetchall()}
                removals = {(h, tx, vout): removed for h, tx, vout, removed, first_hash, last_hash in BIP30
                            if headers.get(h) == first_hash and headers.get(removed) == last_hash}
                key_fields = 'o.keyhash20,o.script_type,' if table == 'active_key_outputs' else ''
                query = sql.SQL('SELECT ' + key_fields + '''o.blockheight,o.transactionid,o.vout,o.amount,o.address,
                    o.spendingblock,pg_column_size(o) AS source_row_bytes FROM {} o
                    WHERE (o.blockheight,o.transactionid,o.vout)>(%s,%s,%s) AND o.blockheight<=%s
                    ORDER BY o.blockheight,o.transactionid,o.vout LIMIT %s''').format(sql.Identifier('public', table))
                params = (start_height, after_txid, after_vout, end_height, row_limit)
                cur.execute(sql.SQL('EXPLAIN (FORMAT JSON) ') + query, params)
                evidence['query_plan'] = cur.fetchone()['QUERY PLAN']
                query_started = time.monotonic()
                cur.execute(query, params)
                rows = cur.fetchall()
                evidence['query_seconds'] = time.monotonic() - query_started
                reduce_started = time.monotonic()
                groups, evidence['sample'] = reduce_sample(rows, table, height, removals)
                evidence['reduction_seconds'] = time.monotonic() - reduce_started
                evidence['row_limit_reached'] = len(rows) == row_limit
                if temp_state:
                    temp_started = time.monotonic()
                    cur.execute('''CREATE TEMP TABLE quantum_seed_size_sample (
                        group_id text COLLATE "C",script_type text COLLATE "C",balance_sats bigint,utxo_count bigint,
                        eligible_sats bigint,eligible_utxos bigint,first_received_height bigint,first_disclosure_height bigint,
                        first_disclosure_hash text,last_spend_height bigint,display_group_id text,details text,identity text,
                        PRIMARY KEY(group_id,script_type)) ON COMMIT DROP''')
                    if groups:
                        execute_values(cur, 'INSERT INTO quantum_seed_size_sample VALUES %s',
                            [(group, family, state[0], state[1], state[0], state[1], state[2], state[2], '0' * 64,
                              state[3], group, '', '') for (group, family), state in groups.items()], page_size=1000)
                    cur.execute('''SELECT count(*) AS rows,avg(pg_column_size(s)) AS mean_row_bytes,
                        pg_relation_size('quantum_seed_size_sample') AS heap_bytes,
                        pg_indexes_size('quantum_seed_size_sample') AS index_bytes FROM quantum_seed_size_sample s''')
                    evidence['temporary_compact_size'] = dict(cur.fetchone())
                    evidence['temporary_compact_size']['seconds'] = time.monotonic() - temp_started
                    evidence['temporary_compact_size']['model'] = 'Partial sampled state with populated hash/eligibility columns and blank labels; not real validated state'
            evidence['resources'] = monitor.metrics()
            if monitor.exceeded or getattr(monitor, 'measurement_error', None):
                raise RuntimeError('Resource guard exceeded or lost measurement')
        evidence['after_database'] = database_usage(conn)
        evidence['status'] = 'complete'
    except Exception as exc:
        conn.rollback()
        evidence.update(status='failed', error=f'{type(exc).__name__}: {exc}')
        if monitor:
            evidence['resources'] = monitor.metrics()
    finally:
        if lock_owned and 'after_database' not in evidence:
            try:
                evidence['after_database'] = database_usage(conn)
            except Exception as exc:
                conn.rollback()
                evidence['after_database_error'] = f'{type(exc).__name__}: {exc}'
        if lock_owned:
            conn.rollback()
            with conn, conn.cursor() as cur:
                cur.execute('SELECT pg_advisory_unlock(811947,2)')
        evidence['elapsed_seconds'] = time.monotonic() - started
    return evidence


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dsn', required=True, help='Explicit PostgreSQL connection string; not recorded in evidence')
    parser.add_argument('--table', choices=tuple(TABLES), required=True)
    parser.add_argument('--height', type=int, required=True, help='Exact retained family freeze')
    parser.add_argument('--start-height', type=int, required=True)
    parser.add_argument('--end-height', type=int, required=True)
    parser.add_argument('--after-txid', default='')
    parser.add_argument('--after-vout', type=int, default=-1)
    parser.add_argument('--rows', type=int, required=True)
    parser.add_argument('--statement-seconds', type=int, default=60)
    parser.add_argument('--temp-state', action='store_true', help='Measure a temporary compact row/index model; no persistent writes')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if not 0 <= args.start_height <= args.end_height <= args.height or not 1 <= args.rows <= 100000:
        parser.error('Creation range must lie within the target height; rows must be 1..100000')
    if not 1 <= args.statement_seconds <= 300 or args.after_vout < -1:
        parser.error('Statement timeout must be 1..300 seconds; after-vout must be at least -1')
    import psycopg2
    conn = psycopg2.connect(args.dsn, application_name='quantum-v2-seed-sample')
    try:
        report = measure(conn, table=args.table, height=args.height, start_height=args.start_height,
                         end_height=args.end_height, row_limit=args.rows, after_txid=args.after_txid,
                         after_vout=args.after_vout, temp_state=args.temp_state, statement_seconds=args.statement_seconds)
    finally:
        conn.close()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, default=str) + '\n')
    print(json.dumps(report, indent=2, default=str))
    return 0 if report['status'] == 'complete' else 1


if __name__ == '__main__':
    raise SystemExit(main())
