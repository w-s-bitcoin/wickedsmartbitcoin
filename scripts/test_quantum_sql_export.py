#!/usr/bin/env python3
"""SQL export regressions, with destructive setup restricted to an explicit fixture.

QUANTUM_SQL_EXPORT_TEST_DSN must use a /tmp Unix socket and a *_fixture database.
No database connection is made without that opt-in. The integrated tests compare
all six artifacts to the full canonical Python calculation, not legacy output.
"""
from __future__ import annotations

import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'webapps/quantum_exposure/pipeline'))
try:
    import psycopg2
    from psycopg2.extras import execute_values
    import quantum_v2_analysis as analysis
    import quantum_v2_sql_export as sql_export
    import quantum_v2_store as store
except ImportError:
    psycopg2 = None

DSN = os.environ.get('QUANTUM_SQL_EXPORT_TEST_DSN', '')
STAMP = 1791230400
FIELDS = ('group_id', 'script_type', 'balance_sats', 'utxo_count', 'eligible_sats', 'eligible_utxos',
          'first_received_height', 'first_disclosure_height', 'last_spend_height',
          'display_group_id', 'details', 'identity')


def family(group, kind='P2PKH', balance=100_000_000, count=1, eligible=None,
           exposed_count=None, received=1, disclosed=5, spent=100, **extra):
    return dict(zip(FIELDS, (group, kind, balance, count, balance if eligible is None else eligible,
        count if exposed_count is None else exposed_count, received, disclosed, spent,
        'display-' + group + '-' + kind, '', '')), **extra)


@unittest.skipUnless(psycopg2, 'psycopg2 is needed to import SQL export helpers')
class PureContractTests(unittest.TestCase):
    def test_context_pins_the_count_only_scenario_and_family_order(self):
        context = sql_export._context(STAMP)
        self.assertEqual(context['snapshot_time'], STAMP)
        for field in ('scenario_version', 'methodology_version', 'parser_version',
                      'grouping_version', 'subset_correction_version'):
            self.assertIsInstance(context[field], str)
        with mock.patch.object(analysis, 'SCENARIO_VERSION', 'future-policy-weight-v3'):
            with self.assertRaises(store.StoreError):
                sql_export._context(STAMP)
        with mock.patch.object(analysis, 'SCRIPT_TYPES', tuple(reversed(analysis.SCRIPT_TYPES))):
            with self.assertRaises(store.StoreError):
                sql_export._context(STAMP)
        with mock.patch.object(analysis, 'SCRIPT_MASKS', {'P2PK': 99}):
            with self.assertRaises(store.StoreError):
                sql_export._context(STAMP)

    def test_page_and_time_bounds_fail_before_any_connection_use(self):
        for size in (0, -1, True, 25_001, '10'):
            with self.subTest(size=size), self.assertRaises(store.StoreError):
                next(sql_export.iter_export_pages(None, snapshot_time=STAMP, guard=lambda: None,
                                                  fetch_groups=size))
        for stamp in (-1, True, '1791230400'):
            with self.subTest(stamp=stamp), self.assertRaises(store.StoreError):
                next(sql_export.iter_export_pages(None, snapshot_time=stamp, guard=lambda: None))
        with self.assertRaises(ValueError):
            next(sql_export.iter_export_pages(None, snapshot_time=STAMP, guard=None))

    def test_normalizer_requires_the_original_transaction_identity(self):
        record = ('frontier', dict(groups=0, last_group=None, transaction_started='start', snapshot='1:1:'))
        result = sql_export._normalize_page([record], None, 2, sql_export._context(STAMP), ('start', '1:1:'))
        self.assertTrue(result['done'])
        for identity in (('later', '1:1:'), ('start', '1:2:')):
            with self.assertRaises(store.StoreError):
                sql_export._normalize_page([record], None, 2, sql_export._context(STAMP), identity)


@unittest.skipUnless(DSN and psycopg2, 'Set QUANTUM_SQL_EXPORT_TEST_DSN for isolated PostgreSQL fixtures')
class SQLExportFixture(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        config = psycopg2.extensions.parse_dsn(DSN)
        if (not config.get('dbname', '').endswith('_fixture')
                or not config.get('host', '').startswith(('/tmp/', '/private/tmp/'))):
            raise RuntimeError('Refusing fixture reset outside an explicit /tmp socket + *_fixture database')
        cls.conn = psycopg2.connect(DSN)

    @classmethod
    def tearDownClass(cls):
        cls.conn.close()

    def setUp(self):
        self.conn.rollback()
        self.conn.set_session(readonly=False, isolation_level='READ COMMITTED', autocommit=True)
        with self.conn.cursor() as cur:
            cur.execute('DROP SCHEMA IF EXISTS quantum_v2 CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public')
            cur.execute('CREATE TABLE public.blockheader(blockheight integer PRIMARY KEY,time bigint)')
            cur.execute('INSERT INTO blockheader SELECT n,%s+n FROM generate_series(0,200) n', (STAMP,))
            cur.execute('UPDATE blockheader SET time=%s WHERE blockheight=100', (analysis.calendar_cutoff(STAMP) + 1,))
            cur.execute('UPDATE blockheader SET time=%s WHERE blockheight=101', (analysis.calendar_cutoff(STAMP),))
            cur.execute("SET work_mem='32MB'; SET max_parallel_workers_per_gather=0; SET statement_timeout='15s'")
        self.conn.autocommit = False
        store.migrate(self.conn)
        store.migrate_live_export(self.conn)

    def insert(self, rows):
        with self.conn, self.conn.cursor() as cur:
            execute_values(cur, 'INSERT INTO quantum_v2.group_state (' + ','.join(FIELDS) + ') VALUES %s',
                           [tuple(row[name] for name in FIELDS) for row in rows])

    def snapshot(self):
        self.conn.set_session(readonly=True, isolation_level='REPEATABLE READ', autocommit=False)

    def pages(self, size=2, guard=None):
        self.snapshot()
        return list(sql_export.iter_export_pages(self.conn, snapshot_time=STAMP, fetch_groups=size,
                                                guard=guard or (lambda: None)))

    def parity(self, size=2):
        self.snapshot()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            options = dict(snapshot_height=962000, snapshot_time=STAMP,
                           block_hash='a' * 64, source_generation='synthetic-fixture')
            expected = analysis.export_snapshot(store.iter_group_rows(self.conn, fetch_size=size),
                                                output_dir=root / 'oracle', **options)
            got = analysis.export_preaggregated_snapshot(
                sql_export.iter_export_pages(self.conn, snapshot_time=STAMP, fetch_groups=size, guard=lambda: None),
                output_dir=root / 'sql', guard=lambda: None, **options)
            self.assertEqual(got, expected)
            oracle, reduced = root / 'oracle/962000', root / 'sql/962000'
            self.assertEqual({path.name for path in oracle.iterdir()}, {path.name for path in reduced.iterdir()})
            self.assertEqual(len(list(oracle.iterdir())), 6)
            for path in oracle.iterdir():
                with self.subTest(file=path.name):
                    self.assertEqual(path.read_bytes(), (reduced / path.name).read_bytes())
            return got

    def test_empty_export_has_one_terminal_page_and_six_identical_files(self):
        pages = self.pages()
        self.assertEqual(len(pages), 1)
        self.assertEqual((pages[0]['group_count'], pages[0]['last_group_id'], pages[0]['done']), (0, None, True))
        self.conn.rollback()
        self.assertEqual(self.parity()['reporting_groups'], 0)

    def test_whole_group_tiers_activity_retired_history_and_zero_value_exposure(self):
        rows = [family('a', balance=60_000_000, eligible=0, exposed_count=0, disclosed=None),
                family('a', 'P2WPKH', balance=60_000_000, eligible=0, exposed_count=0, disclosed=None),
                family('a', 'P2PK', balance=0, count=1, eligible=0, disclosed=0, spent=None),
                family('b', balance=200_000_000, count=2),
                family('b', 'P2PK', balance=0, count=0, eligible=0, exposed_count=0,
                       received=0, disclosed=1, spent=101),
                family('retired', balance=0, count=0, eligible=0, exposed_count=0),
                family('zero', 'P2TR', balance=0, count=1, eligible=0, spent=None)]
        rows += [family('seven', kind, balance=100_000_000, count=index + 1,
                        spent=101 if index == 6 else 100) for index, kind in enumerate(analysis.SCRIPT_TYPES)]
        self.insert(rows)
        pages = self.pages(size=1)
        self.assertEqual([p['last_group_id'] for p in pages], ['a', 'b', 'seven', 'zero', None])
        self.assertTrue(pages[-1]['done'])
        b = next(p for p in pages if p['last_group_id'] == 'b')
        self.assertEqual({s['activity'] for s in b['packing']}, {'inactive'})
        self.assertEqual(len(b['detail_rows']), 2)  # Retired family retains dates/display metadata.
        a = pages[0]
        self.assertEqual(a['packing'][0]['tier_level'], 1)
        self.assertEqual(a['packing'][0]['exposed_counts'][0], 1)
        self.conn.rollback()
        self.assertEqual(self.parity(size=1)['reporting_groups'], 4)

    def test_exact_integer_aggregation_and_distinct_count_vectors(self):
        # PostgreSQL SUM(bigint) is numeric. JSON decoding must preserve integer
        # counts/amounts beyond IEEE-754 precision without a float intermediary.
        rows = [family(f'{number:03}', balance=2**53 + number, count=100_000 + number,
                       spent=None if number % 3 == 0 else 100 + number % 2)
                for number in range(25)]
        self.insert(rows)
        pages = self.pages(size=7)
        amount = sum(record['metrics'][2] for page in pages for record in page['base_cubes']
                     if (record['tier'], record['family'], record['activity']) == ('all', 'All', 'all'))
        self.assertEqual(amount, sum(row['balance_sats'] for row in rows))
        self.assertIs(type(amount), int)
        self.conn.rollback()
        self.parity(size=7)

    def test_all_127_family_masks_and_tier_boundaries_match_all_six_files(self):
        rows = []
        for mask in range(1, 128):
            selected = [kind for bit, kind in enumerate(analysis.SCRIPT_TYPES) if mask & (1 << bit)]
            for level, (_, minimum) in enumerate(analysis.TIERS):
                quotient, remainder = divmod(minimum, len(selected))
                for offset, kind in enumerate(selected):
                    amount = quotient + (offset < remainder)
                    rows.append(family(f'{mask:03}-{level}', kind, balance=amount,
                        count=1 + offset, eligible=amount if offset % 2 == 0 else 0,
                        exposed_count=1 + offset if offset % 2 == 0 else 0,
                        disclosed=5 if offset % 2 == 0 else None,
                        spent=(None, 100, 101)[mask % 3]))
        self.insert(rows)
        self.assertEqual(self.parity(size=31)['reporting_groups'], 127 * len(analysis.TIERS))

    def test_missing_disclosure_header_remains_explicitly_unknown(self):
        self.insert([family('unknown-date', disclosed=999)])
        self.assertIsNone(self.pages()[0]['detail_rows'][0]['first_exposed_time'])
        self.conn.rollback()
        self.parity()

    def test_missing_nonmaximum_retired_spend_header_fails_before_yield(self):
        self.insert([family('small', balance=20, spent=200),
                     family('small', 'P2PK', balance=0, count=0, eligible=0, exposed_count=0, spent=199)])
        with self.conn, self.conn.cursor() as cur:
            cur.execute('DELETE FROM blockheader WHERE blockheight=199')
        with self.assertRaisesRegex(store.StoreError, 'invalid accounting'):
            self.pages()

    def test_unknown_and_eighth_family_fail_even_below_detail_threshold(self):
        self.insert([family('small', balance=1), family('small', 'unsupported', balance=1)])
        with self.assertRaises(store.StoreError):
            self.pages()
        self.conn.rollback()
        self.conn.set_session(readonly=False)
        with self.conn, self.conn.cursor() as cur:
            cur.execute('DELETE FROM quantum_v2.group_state')
        self.insert([family('eight', kind, balance=1) for kind in analysis.SCRIPT_TYPES + ('unsupported',)])
        with self.assertRaises(store.StoreError):
            self.pages()

    def test_negative_history_height_fails_for_non_detail_family(self):
        self.insert([family('small', balance=1, received=-1)])
        with self.assertRaises(store.StoreError):
            self.pages()

    def test_hidden_eligible_corruption_fails_without_a_disclosure(self):
        with self.conn, self.conn.cursor() as cur:
            cur.execute('ALTER TABLE quantum_v2.group_state DROP CONSTRAINT group_state_check')
        self.insert([family('small', balance=1, eligible=2, disclosed=None)])
        with self.assertRaises(store.StoreError):
            self.pages()

    def test_negative_nonmaximum_header_time_fails(self):
        self.insert([family('small', balance=1, spent=101), family('small', 'Other', balance=1, spent=100)])
        with self.conn, self.conn.cursor() as cur:
            cur.execute('UPDATE blockheader SET time=-1 WHERE blockheight=100')
        with self.assertRaises(store.StoreError):
            self.pages()

    def test_missing_index_or_unvalidated_accounting_constraint_fails(self):
        with self.conn, self.conn.cursor() as cur:
            cur.execute('DROP INDEX quantum_v2.group_state_live_group_id')
        with self.assertRaisesRegex(store.StoreError, 'migration006'):
            self.pages()
        self.conn.rollback()
        self.conn.set_session(readonly=False)
        with self.conn, self.conn.cursor() as cur:
            cur.execute('CREATE INDEX group_state_live_group_id ON quantum_v2.group_state(group_id) WHERE utxo_count>0')
            cur.execute('ALTER TABLE quantum_v2.group_state DROP CONSTRAINT group_state_zero_utxo_balance')
            cur.execute('ALTER TABLE quantum_v2.group_state ADD CONSTRAINT group_state_zero_utxo_balance CHECK(utxo_count>0 OR balance_sats=0) NOT VALID')
        with self.assertRaisesRegex(store.StoreError, 'migration006'):
            self.pages()

    def test_transaction_and_resource_settings_are_required(self):
        for readonly, isolation, work_mem, parallel in (
                (False, 'REPEATABLE READ', '32MB', 0), (True, 'READ COMMITTED', '32MB', 0),
                (True, 'REPEATABLE READ', '64MB', 0), (True, 'REPEATABLE READ', '32MB', 1)):
            self.conn.rollback()
            self.conn.set_session(readonly=readonly, isolation_level=isolation)
            with self.conn.cursor() as cur:
                cur.execute('SET LOCAL work_mem=%s; SET LOCAL max_parallel_workers_per_gather=%s', (work_mem, parallel))
            with self.subTest(readonly=readonly, isolation=isolation, work_mem=work_mem, parallel=parallel), self.assertRaises(store.StoreError):
                list(sql_export.iter_export_pages(self.conn, snapshot_time=STAMP, guard=lambda: None))
        self.conn.rollback()
        self.conn.autocommit = True
        with self.assertRaises(store.StoreError):
            list(sql_export.iter_export_pages(self.conn, snapshot_time=STAMP, guard=lambda: None))

    def test_commit_then_new_transaction_between_pages_is_rejected(self):
        self.insert([family('a'), family('b')])
        self.snapshot()
        iterator = sql_export.iter_export_pages(self.conn, snapshot_time=STAMP, fetch_groups=1, guard=lambda: None)
        self.assertEqual(next(iterator)['last_group_id'], 'a')
        self.conn.commit()
        with self.conn.cursor() as cur:
            cur.execute('SELECT 1')
        with self.assertRaisesRegex(store.StoreError, 'changed the SQL export snapshot'):
            next(iterator)

    def test_concurrent_change_is_invisible_to_all_pages_in_snapshot(self):
        self.insert([family('a'), family('b')])
        self.snapshot()
        iterator = sql_export.iter_export_pages(self.conn, snapshot_time=STAMP, fetch_groups=1, guard=lambda: None)
        self.assertEqual(next(iterator)['last_group_id'], 'a')
        other = psycopg2.connect(DSN)
        try:
            with other, other.cursor() as cur:
                cur.execute("UPDATE quantum_v2.group_state SET balance_sats=200000000,eligible_sats=200000000 WHERE group_id='b'")
            page = next(iterator)
            self.assertEqual(page['detail_rows'][0]['current_supply_sats'], 100_000_000)
        finally:
            other.close()

    def test_guard_cancels_before_page_is_delivered_and_transaction_stays_owned(self):
        self.insert([family('a')])
        self.snapshot()
        calls = []
        def guard():
            calls.append(None)
            if len(calls) == 4:  # Initial/context, prequery, postquery.
                raise TimeoutError('fixture budget')
        with self.assertRaises(TimeoutError):
            next(sql_export.iter_export_pages(self.conn, snapshot_time=STAMP, guard=guard))
        self.assertEqual(len(calls), 4)
        self.assertEqual(self.conn.get_transaction_status(), psycopg2.extensions.TRANSACTION_STATUS_INTRANS)

    def test_page_plan_uses_live_index_and_bounded_primary_key_lookup(self):
        self.insert([family(f'{number:06}', balance=1) for number in range(1000)])
        with self.conn, self.conn.cursor() as cur:
            cur.execute('ANALYZE quantum_v2.group_state')
        self.snapshot()
        query, params = sql_export._page_query('000500', 2, STAMP)
        with self.conn.cursor() as cur:
            cur.execute('EXPLAIN(FORMAT JSON) ' + query, params)
            plan = cur.fetchone()[0][0]['Plan']
        def nodes(node):
            yield node
            for child in node.get('Plans', []):
                yield from nodes(child)
        relations = [node for node in nodes(plan) if node.get('Relation Name') == 'group_state']
        self.assertEqual({node.get('Index Name') for node in relations},
                         {'group_state_pkey', 'group_state_live_group_id'})
        self.assertTrue(all('Index' in node['Node Type'] for node in relations))


if __name__ == '__main__':
    unittest.main()
