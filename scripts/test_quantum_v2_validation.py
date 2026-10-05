#!/usr/bin/env python3
"""Independent source-accounting fixtures; only an explicit /tmp *_fixture DB."""
from __future__ import annotations

import ast
import hashlib
import os
from pathlib import Path
import sys
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'webapps/quantum_exposure/pipeline'))
try:
    import psycopg2
    import quantum_v2_store as store
    import quantum_v2_control as control
    import quantum_v2_validation as validation
    from quantum_v2_metadata_validation import sample_metadata
    from quantum_legacy_guard import guard_legacy_mutation
except ImportError:
    psycopg2 = None

DSN = os.environ.get('QUANTUM_VALIDATION_TEST_DSN', '')
G = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
KEY = hashlib.new('ripemd160', hashlib.sha256(bytes.fromhex(G)).digest()).hexdigest()


class LegacyEntryGuardTests(unittest.TestCase):
    def test_all_seven_legacy_builders_guard_before_mutation(self):
        names = ('run_active_key_outputs.py', 'run_active_script_hash_outputs.py',
                 'run_active_p2tr_outputs.py', 'run_active_bare_ms_outputs.py',
                 'run_key_outputs_all.py', 'run_exposed_keyhash20.py', 'run_exposed_script_address.py')
        for name in names:
            with self.subTest(name=name):
                tree = ast.parse((ROOT / 'webapps/quantum_exposure/pipeline' / name).read_text())
                main = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'main')
                guarded = next(node for node in main.body if isinstance(node, ast.Try))
                first = guarded.body[0]
                self.assertIsInstance(first, ast.Expr)
                self.assertIsInstance(first.value, ast.Call)
                self.assertEqual(first.value.func.id, 'guard_legacy_mutation')


@unittest.skipUnless(DSN and psycopg2, 'Set QUANTUM_VALIDATION_TEST_DSN for a disposable fixture')
class ValidationFixture(unittest.TestCase):
    def setUp(self):
        args = psycopg2.extensions.parse_dsn(DSN)
        if not args.get('dbname', '').endswith('_fixture') or not args.get('host', '').startswith(('/tmp/', '/private/tmp/')):
            raise RuntimeError('Refusing setup outside explicit /tmp socket + *_fixture database')
        self.conn = psycopg2.connect(DSN)
        self.addCleanup(self.conn.close)
        with self.conn, self.conn.cursor() as cur:
            cur.execute('DROP SCHEMA IF EXISTS quantum_v2 CASCADE')
            cur.execute('DROP SCHEMA public CASCADE')
            cur.execute('CREATE SCHEMA public')
            cur.execute('CREATE TABLE blockheader(blockheight bigint PRIMARY KEY,blockhash text,time bigint)')
            cur.execute("INSERT INTO blockheader SELECT n,lpad(to_hex(n),64,'0'),1231006505+n*600 FROM generate_series(0,20) n")
            cur.execute('''CREATE TABLE outputs(blockheight bigint,transactionid text,vout integer,amount bigint,
                address text,scripttype text,scripthex text,spendingblock bigint,
                PRIMARY KEY(blockheight,transactionid,vout))''')
            cur.execute('CREATE TABLE stxos_0_20_archive (LIKE outputs INCLUDING ALL)')
            rows = [
                (1, 'a', 0, 200, 'pk', 'pubkey', '21' + G + 'ac', None),
                (2, 'b', 0, 100, 'pkh', 'pubkeyhash', '76a914' + KEY + '88ac', None),
                (2, 'c', 0, 0, 'wpkh', 'witness_v0_keyhash', '0014' + KEY, None),
                (3, 'd', 0, 40, 'sh', 'scripthash', 'a914' + '22' * 20 + '87', 20),
                (4, 'e', 0, 50, 'wsh', 'witness_v0_scripthash', '0020' + '33' * 32, None),
                (5, 'f', 0, 70, 'tr', 'witness_v1_taproot', '5120' + G[2:], None),
                (6, 'g', 0, 30, 'invalid-tr', 'witness_v1_taproot', '5120' + 'ff' * 32, None),
                (7, 'h', 0, 80, None, 'Multisig 1/1', '5121' + G + '51ae', None),
                (8, 'i', 0, 90, None, 'nonstandard', '6a', None),
                (9, 'j', 0, 1, 'unknown', 'nonstandard', '51', None),
                (11, 'later', 0, 999, 'later', 'pubkeyhash', '76a914' + '44' * 20 + '88ac', None),
            ]
            cur.executemany('INSERT INTO outputs VALUES(%s,%s,%s,%s,%s,%s,%s,%s)', rows)
            cur.execute("INSERT INTO stxos_0_20_archive SELECT * FROM outputs WHERE transactionid='d'")
            cur.execute('INSERT INTO stxos_0_20_archive VALUES(%s,%s,%s,%s,%s,%s,%s,%s)',
                        (2, 'old-spent', 0, 999, 'old', 'pubkeyhash', '76a914' + '55' * 20 + '88ac', 5))
        store.migrate(self.conn)
        control.migrate(self.conn)
        validation.migrate(self.conn)
        with self.conn, self.conn.cursor() as cur:
            cur.execute('UPDATE quantum_v2.source_state SET ready=true,committed_height=20,committed_hash=%s', (f'{20:064x}',))
        store.initialize_source_seed(self.conn, 10, f'{10:064x}')
        for _ in range(30):
            if store.bootstrap_step(self.conn, limit=2):
                break
        else:
            self.fail('Fixture seed did not complete')

    def query(self, statement, params=()):
        with self.conn, self.conn.cursor() as cur:
            cur.execute(statement, params)
            return cur.fetchall()

    def complete(self, limit=2):
        validation.initialize(self.conn, 10, f'{10:064x}')
        for _ in range(100):
            if validation.step(self.conn, limit=limit):
                return validation.verify(self.conn)
        self.fail('Validation did not complete within its bounded pages')

    def test_all_family_proof_resumes_and_preserves_zero_value_counts(self):
        first = validation.initialize(self.conn, 10, f'{10:064x}')
        self.assertEqual(first['last_height'], -1)
        self.assertFalse(validation.step(self.conn, limit=1))
        resumed = validation.initialize(self.conn, 10, f'{10:064x}')
        self.assertEqual(resumed['source_rows'], 1)
        validation.migrate(self.conn)
        report = self.complete(limit=1)
        self.assertTrue(report['passed'], report)
        self.assertEqual(report['accounted_utxos'], 9)
        totals = report['totals']['validation_group']
        self.assertEqual(totals['P2WPKH']['balance_sats'], 0)
        self.assertEqual(totals['P2WPKH']['utxo_count'], 1)
        self.assertEqual(totals['P2TR']['balance_sats'], 100)
        self.assertEqual(totals['P2TR']['eligible_sats'], 70)
        self.assertEqual(totals['Other']['balance_sats'], 81)
        self.assertEqual(totals['Other']['eligible_sats'], 80)
        self.assertEqual(validation.verify(self.conn), report)

    def test_validation_respects_global_writer_lock_and_owner_can_reenter(self):
        other=psycopg2.connect(DSN)
        self.addCleanup(other.close)
        self.assertTrue(control.take_writer_lock(other))
        try:
            for operation in (lambda:validation.initialize(self.conn,10,f'{10:064x}'),
                              lambda:validation.migrate(self.conn)):
                with self.assertRaisesRegex(RuntimeError,'worker or maintenance'):
                    operation()
            self.assertEqual(self.query('SELECT count(*) FROM quantum_v2.validation_checkpoint'),[(0,)])
        finally:
            control.release_writer_lock(other)
        self.assertTrue(control.take_writer_lock(self.conn))
        try:
            validation.initialize(self.conn,10,f'{10:064x}')
            self.assertFalse(validation.step(self.conn,limit=1))
        finally:
            control.release_writer_lock(self.conn)

    def test_ingestion_readiness_race_defers_without_advancing_source_cursor(self):
        validation.initialize(self.conn,10,f'{10:064x}')
        with self.conn,self.conn.cursor() as cur:
            cur.execute('UPDATE quantum_v2.source_state SET ready=false')
        with self.assertRaises(store.SourceNotReady):
            validation.step(self.conn,limit=1)
        self.assertEqual(self.query('SELECT source_rows,last_height FROM quantum_v2.validation_checkpoint'),[(0,-1)])

    def test_legacy_guard_rejects_initialized_projection_and_releases_lock(self):
        with self.assertRaisesRegex(RuntimeError, 'legacy seed tables are frozen'):
            guard_legacy_mutation(self.conn)
        self.assertEqual(self.conn.get_transaction_status(), 0)
        with psycopg2.connect(DSN) as other, other.cursor() as cur:
            for key in (1, 2):
                cur.execute('SELECT pg_try_advisory_xact_lock(811947,%s)', (key,))
                self.assertTrue(cur.fetchone()[0])

    def test_legacy_guard_spans_commits_and_excludes_racing_initialization(self):
        with self.conn, self.conn.cursor() as cur:
            cur.execute('DELETE FROM quantum_v2.projection')
        guard_legacy_mutation(self.conn)
        self.conn.commit()
        other = psycopg2.connect(DSN)
        try:
            with self.assertRaisesRegex(store.StoreError, 'Another Quantum coordinator'):
                store.initialize_source_seed(other, 10, f'{10:064x}')
        finally:
            other.close()
        self.conn.close()
        with psycopg2.connect(DSN) as other, other.cursor() as cur:
            for key in (1, 2):
                cur.execute('SELECT pg_try_advisory_xact_lock(811947,%s)', (key,))
                self.assertTrue(cur.fetchone()[0])

    def test_per_group_swapped_amounts_detected_despite_equal_global_totals(self):
        with self.conn, self.conn.cursor() as cur:
            cur.execute("UPDATE quantum_v2.group_state SET balance_sats=balance_sats+1,eligible_sats=eligible_sats+1 WHERE script_type='P2PK'")
            cur.execute("UPDATE quantum_v2.group_state SET balance_sats=balance_sats-1,eligible_sats=eligible_sats-1 WHERE group_id='tr'")
        report = self.complete()
        self.assertFalse(report['passed'])
        self.assertEqual(report['mismatched_group_families'], 2)
        self.assertEqual(self.query('SELECT status FROM quantum_v2.validation_checkpoint'), [('mismatch',)])
        with self.conn, self.conn.cursor() as cur:
            cur.execute("UPDATE quantum_v2.group_state SET balance_sats=balance_sats-1,eligible_sats=eligible_sats-1 WHERE script_type='P2PK'")
            cur.execute("UPDATE quantum_v2.group_state SET balance_sats=balance_sats+1,eligible_sats=eligible_sats+1 WHERE group_id='tr'")
        validation.initialize(self.conn, 10, f'{10:064x}', recompare=True)
        repaired = self.complete(limit=1)
        self.assertTrue(repaired['passed'])
        self.assertEqual(repaired['source_rows'], report['source_rows'])

    def test_comparison_pages_find_both_missing_sides_and_accept_zero_history(self):
        baseline=self.complete(limit=1)
        with self.conn,self.conn.cursor() as cur:
            cur.execute('''INSERT INTO quantum_v2.group_state
                (group_id,script_type,balance_sats,utxo_count,eligible_sats,eligible_utxos)
                VALUES('missing-source','P2PKH',15,1,15,1),('history-only','Other',0,0,0,0)''')
            cur.execute('''INSERT INTO quantum_v2.validation_group
                (group_id,script_type,balance_sats,utxo_count,eligible_sats,eligible_utxos)
                VALUES('missing-state','P2SH',13,1,13,1)''')
        validation.initialize(self.conn,10,f'{10:064x}',recompare=True)
        report=self.complete(limit=1)
        self.assertFalse(report['passed'])
        self.assertEqual(report['compared_group_families'],baseline['compared_group_families']+3)
        self.assertEqual(report['mismatched_group_families'],2)
        self.assertEqual({row['group_id'] for row in report['examples']},{'missing-source','missing-state'})

    def test_live_constraints_reject_positive_balances_without_corresponding_utxos(self):
        store.migrate_live_export(self.conn,allow_populated=True)
        for balances in ((1,0,0,0),(1,1,1,0)):
            with self.subTest(balances=balances),self.assertRaises(psycopg2.errors.CheckViolation):
                with self.conn,self.conn.cursor() as cur:
                    cur.execute('''INSERT INTO quantum_v2.group_state
                        (group_id,script_type,balance_sats,utxo_count,eligible_sats,eligible_utxos)
                        VALUES('impossible','Other',%s,%s,%s,%s)''',balances)
        with self.conn,self.conn.cursor() as cur:
            cur.execute("INSERT INTO quantum_v2.group_state(group_id,script_type,utxo_count) VALUES('zero-value','Other',1)")
        self.assertEqual(self.query("SELECT balance_sats,utxo_count FROM quantum_v2.group_state WHERE group_id='zero-value'"),[(0,1)])

    def test_live_comparison_skips_retired_history_and_finds_both_missing_zero_value_sides(self):
        baseline=self.complete(limit=1)
        store.migrate_live_export(self.conn,allow_populated=True)
        with self.conn,self.conn.cursor() as cur:
            cur.execute("INSERT INTO quantum_v2.group_state(group_id,script_type) SELECT 'retired-'||n,'Other' FROM generate_series(1,1000) n")
        validation.initialize(self.conn,10,f'{10:064x}',recompare=True)
        live=self.complete(limit=1)
        self.assertTrue(live['passed'])
        self.assertEqual(live['totals'],baseline['totals'])
        self.assertLessEqual(live['compared_group_families'],baseline['compared_group_families'])
        self.assertEqual(live['comparison_scope'],'live groups with validated zero-count constraints')
        with self.conn,self.conn.cursor() as cur:
            cur.execute("INSERT INTO quantum_v2.group_state(group_id,script_type,utxo_count) VALUES('missing-source','Other',1)")
            cur.execute('''INSERT INTO quantum_v2.validation_group
                (group_id,script_type,balance_sats,utxo_count,eligible_sats,eligible_utxos)
                VALUES('missing-state','P2SH',0,1,0,0)''')
        validation.initialize(self.conn,10,f'{10:064x}',recompare=True)
        report=self.complete(limit=1)
        self.assertFalse(report['passed'])
        self.assertEqual(report['compared_group_families'],live['compared_group_families']+2)
        self.assertEqual(report['mismatched_group_families'],2)
        self.assertEqual({row['group_id'] for row in report['examples']},{'missing-source','missing-state'})
        self.assertEqual(report['totals']['validation_group']['P2WPKH']['utxo_count'],1)

    def test_recorded_live_migration_with_missing_or_unvalidated_constraint_fails_closed(self):
        store.migrate_live_export(self.conn,allow_populated=True)
        self.complete()
        with self.conn,self.conn.cursor() as cur:
            cur.execute('ALTER TABLE quantum_v2.group_state DROP CONSTRAINT group_state_zero_utxo_balance')
        with self.assertRaisesRegex(ValueError,'validated constraints'):validation.verify(self.conn)
        with self.conn,self.conn.cursor() as cur:
            cur.execute('ALTER TABLE quantum_v2.group_state ADD CONSTRAINT group_state_zero_utxo_balance CHECK(utxo_count>0 OR balance_sats=0) NOT VALID')
        with self.assertRaisesRegex(ValueError,'validated constraints'):validation.verify(self.conn)
        with self.conn,self.conn.cursor() as cur:
            cur.execute('ALTER TABLE quantum_v2.group_state VALIDATE CONSTRAINT group_state_zero_utxo_balance')
        self.assertTrue(validation.verify(self.conn)['passed'])

    def test_live_comparison_plan_does_not_visit_large_retired_population(self):
        self.complete()
        store.migrate_live_export(self.conn,allow_populated=True)
        with self.conn,self.conn.cursor() as cur:
            cur.execute("INSERT INTO quantum_v2.group_state(group_id,script_type) SELECT '0-retired-'||lpad(n::text,8,'0'),'Other' FROM generate_series(1,200000) n")
            cur.execute("INSERT INTO quantum_v2.group_state(group_id,script_type,utxo_count) SELECT 'live-'||lpad(n::text,8,'0'),'Other',1 FROM generate_series(1,200) n")
            cur.execute('ANALYZE quantum_v2.group_state')
            cur.execute('ANALYZE quantum_v2.validation_group')
            for position in (('',''),(KEY,'P2PK'),('live-00000100','Other')):
                query,params=validation._comparison_page_query(cur,position,10)
                cur.execute('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) '+query,params)
                plan=cur.fetchone()[0][0]['Plan']
                def nodes(node):
                    yield node
                    for child in node.get('Plans',[]):yield from nodes(child)
                state_nodes=[node for node in nodes(plan) if node.get('Relation Name')=='group_state']
                self.assertTrue(any(node.get('Index Name')=='group_state_live_group_id' for node in state_nodes),plan)
                self.assertTrue(all(node['Node Type'] in ('Index Scan','Index Only Scan') for node in state_nodes),plan)
                self.assertLessEqual(plan['Actual Rows'],11)
                self.assertLess(plan['Shared Hit Blocks']+plan['Shared Read Blocks'],2000)

    def test_comparison_plan_looks_up_bounded_keys_without_whole_state_hashes(self):
        # A realistic fixture cardinality lets PostgreSQL choose its real plan;
        # no enable_seqscan override forces the expected access path.
        with self.conn,self.conn.cursor() as cur:
            cur.execute('''INSERT INTO quantum_v2.group_state(group_id,script_type,utxo_count)
                SELECT 'plan-'||lpad(n::text,5,'0'),'Other',1 FROM generate_series(1,10000) n''')
            cur.execute('''INSERT INTO quantum_v2.validation_group
                (group_id,script_type,balance_sats,utxo_count,eligible_sats,eligible_utxos)
                SELECT 'plan-'||lpad(n::text,5,'0'),'Other',0,1,0,0 FROM generate_series(1,10000) n''')
            cur.execute('ANALYZE quantum_v2.group_state')
            cur.execute('ANALYZE quantum_v2.validation_group')
            cur.execute('EXPLAIN(FORMAT JSON) '+validation._COMPARISON_PAGE_SQL,
                        ('','',3,'','',3,3))
            plan=cur.fetchone()[0][0]['Plan']
        def nodes(node):
            yield node
            for child in node.get('Plans',[]):yield from nodes(child)
        relation_scans=[node for node in nodes(plan)
                        if node.get('Relation Name') in ('group_state','validation_group')]
        self.assertEqual(len(relation_scans),4)
        self.assertTrue(all(node['Node Type'] in ('Index Scan','Index Only Scan') for node in relation_scans),plan)
        self.assertFalse(any(node['Node Type']=='Hash Join' for node in nodes(plan)),plan)

    def test_source_conflict_at_page_boundary_fails_without_advancing(self):
        with self.conn, self.conn.cursor() as cur:
            cur.execute("INSERT INTO stxos_0_20_archive SELECT blockheight,transactionid,vout,amount+1,address,scripttype,scripthex,spendingblock FROM outputs WHERE transactionid='a'")
        validation.initialize(self.conn, 10, f'{10:064x}')
        with self.assertRaisesRegex(ValueError, 'Conflicting'):
            validation.step(self.conn, limit=1)
        self.assertEqual(self.query('SELECT source_rows,last_height FROM quantum_v2.validation_checkpoint'), [(0, -1)])

    def test_repeated_source_prefix_does_not_hide_later_live_occurrences(self):
        with self.conn, self.conn.cursor() as cur:
            cur.execute('ALTER TABLE outputs DROP CONSTRAINT outputs_pkey')
            cur.execute("INSERT INTO outputs SELECT o.* FROM outputs o CROSS JOIN generate_series(1,50) n WHERE transactionid='a'")
        report = self.complete(limit=2)
        self.assertTrue(report['passed'], report)
        self.assertEqual(report['accounted_utxos'], 9)

    def test_repeated_source_prefix_cannot_certify_a_missing_later_group(self):
        with self.conn, self.conn.cursor() as cur:
            cur.execute('TRUNCATE stxos_0_20_archive')
            cur.execute("DELETE FROM outputs WHERE transactionid NOT IN ('a','b')")
            cur.execute('ALTER TABLE outputs DROP CONSTRAINT outputs_pkey')
            cur.execute("INSERT INTO outputs SELECT o.* FROM outputs o CROSS JOIN generate_series(1,50) n WHERE transactionid='a'")
            # The former raw branch cap returned only exact copies of a,
            # then falsely certified this incomplete projection.
            cur.execute("DELETE FROM quantum_v2.group_state WHERE script_type<>'P2PK'")
        report = self.complete(limit=2)
        self.assertFalse(report['passed'])
        self.assertEqual(report['accounted_utxos'], 2)
        self.assertEqual(report['mismatched_group_families'], 1)
        self.assertEqual(report['examples'][0]['script_type'], 'P2PKH')

    def test_repeated_source_prefix_cannot_hide_a_conflicting_lookahead(self):
        with self.conn, self.conn.cursor() as cur:
            cur.execute('TRUNCATE stxos_0_20_archive')
            cur.execute("DELETE FROM outputs WHERE transactionid NOT IN ('a','b')")
            cur.execute('ALTER TABLE outputs DROP CONSTRAINT outputs_pkey')
            cur.execute("INSERT INTO outputs SELECT o.* FROM outputs o CROSS JOIN generate_series(1,50) n WHERE transactionid='a'")
            cur.execute("INSERT INTO stxos_0_20_archive SELECT blockheight,transactionid,vout,amount+1,address,scripttype,scripthex,spendingblock FROM outputs WHERE transactionid='b'")
        validation.initialize(self.conn, 10, f'{10:064x}')
        with self.assertRaisesRegex(ValueError, 'Conflicting'):
            validation.step(self.conn, limit=2)
        self.assertEqual(self.query('SELECT source_rows,last_height FROM quantum_v2.validation_checkpoint'), [(0, -1)])
        self.assertEqual(self.query('SELECT count(*) FROM quantum_v2.validation_group'), [(0,)])

    def test_previous_pager_version_requires_fresh_source_validation(self):
        validation.initialize(self.conn, 10, f'{10:064x}')
        validation.step(self.conn, limit=1)
        with self.conn, self.conn.cursor() as cur:
            cur.execute("UPDATE quantum_v2.validation_checkpoint SET validation_version='raw-source-utxo-accounting-v1'")
        with self.assertRaisesRegex(ValueError, 'versions changed'):
            validation.step(self.conn, limit=1)
        checkpoint = validation.initialize(self.conn, 10, f'{10:064x}')
        self.assertEqual(checkpoint['source_rows'], 0)
        self.assertEqual(checkpoint['validation_version'], 'raw-source-utxo-accounting-v2')

    def test_archive_movement_between_pages_preserves_target_membership(self):
        validation.initialize(self.conn, 10, f'{10:064x}')
        validation.step(self.conn, limit=1)
        with self.conn, self.conn.cursor() as cur:
            cur.execute("UPDATE outputs SET spendingblock=20 WHERE transactionid IN ('a','b')")
            cur.execute("INSERT INTO stxos_0_20_archive SELECT * FROM outputs WHERE transactionid IN ('a','b')")
            cur.execute("DELETE FROM outputs WHERE transactionid IN ('a','b')")
        report = self.complete(limit=1)
        self.assertTrue(report['passed'])
        self.assertEqual(report['accounted_utxos'], 9)

    def test_sparse_creation_windows_advance_without_skipping_boundary_rows(self):
        validation.initialize(self.conn, 10, f'{10:064x}')
        # Genesis has no source rows: the empty bounded window must advance,
        # while the complete next height remains included on resume.
        self.assertFalse(validation.step(self.conn, limit=100, window_blocks=1))
        self.assertEqual(self.query('SELECT last_height,last_txid,last_vout,source_rows FROM quantum_v2.validation_checkpoint'),
                         [(1, '', -1, 0)])
        for _ in range(30):
            if validation.step(self.conn, limit=2, window_blocks=1):
                break
        else:
            self.fail('Narrow-window source validation failed to finish')
        report = validation.verify(self.conn)
        self.assertTrue(report['passed'], report)
        self.assertEqual(report['accounted_utxos'], 9)

    def test_creation_window_preserves_same_height_transaction_and_vout_frontier(self):
        with self.conn, self.conn.cursor() as cur:
            cur.execute('TRUNCATE outputs,stxos_0_20_archive')
            for table in ('outputs', 'stxos_0_20_archive'):
                cur.executemany(f'INSERT INTO {table} VALUES(%s,%s,%s,%s,%s,%s,%s,%s)', [
                    (2, 'same', 0, 1, 'a', 'nonstandard', '51', None),
                    (2, 'same', 1, 2, 'b', 'nonstandard', '51', None),
                    (2, 'same', 2, 3, 'c', 'nonstandard', '51', None),
                    (2, 'z', 0, 4, 'd', 'nonstandard', '51', 20),
                    (4, '', 0, 5, 'e', 'nonstandard', '51', None),
                ])
        checkpoint = dict(target_height=10, last_height=2, last_txid='same', last_vout=0)
        with self.conn, self.conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            first, done, frontier = validation._page(cur, checkpoint, 2, 1)
            self.assertEqual([(row['transactionid'], row['vout']) for row in first], [('same', 1), ('same', 2)])
            self.assertFalse(done)
            self.assertEqual(frontier, (2, 'same', 2))
            checkpoint.update(zip(('last_height', 'last_txid', 'last_vout'), frontier))
            second, done, frontier = validation._page(cur, checkpoint, 2, 1)
            self.assertEqual([(row['transactionid'], row['vout']) for row in second], [('z', 0)])
            self.assertFalse(done)
            self.assertEqual(frontier, (3, '', -1))
            checkpoint.update(zip(('last_height', 'last_txid', 'last_vout'), frontier))
            empty, done, frontier = validation._page(cur, checkpoint, 2, 1)
            self.assertEqual(empty, [])
            self.assertFalse(done)
            self.assertEqual(frontier, (4, '', -1))
            checkpoint.update(zip(('last_height', 'last_txid', 'last_vout'), frontier))
            final, _, _ = validation._page(cur, checkpoint, 2, 1)
            self.assertEqual([(row['blockheight'], row['transactionid'], row['vout']) for row in final], [(4, '', 0)])

    def test_source_page_plan_bounds_height_only_indexes_without_scanning_old_prefix(self):
        # Match the raw source's single-column creation indexes rather than
        # the convenient composite primary keys used by small correctness tests.
        with self.conn, self.conn.cursor() as cur:
            cur.execute('TRUNCATE outputs,stxos_0_20_archive')
            for table in ('outputs', 'stxos_0_20_archive'):
                cur.execute(f'ALTER TABLE {table} DROP CONSTRAINT {table}_pkey')
                cur.execute(f'CREATE INDEX {table}_validation_creation ON {table}(blockheight)')
                cur.execute(f'''INSERT INTO {table}
                    SELECT 1,'old-'||lpad(n::text,8,'0'),0,1,'old','nonstandard','51',NULL
                    FROM generate_series(1,25000) n''')
                cur.execute(f'''INSERT INTO {table}
                    SELECT 10,'same',n,1,'current','nonstandard','51',NULL
                    FROM generate_series(0,4) n''')
                cur.execute(f'ANALYZE {table}')
        captured = []
        with self.conn, self.conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            class CaptureCursor:
                def execute(self, query, params=None):
                    if isinstance(query, psycopg2.sql.Composed):
                        captured.append((query, params))
                    cur.execute(query, params)
                def fetchall(self):
                    return cur.fetchall()
            rows, done, frontier = validation._page(CaptureCursor(),
                dict(target_height=10, last_height=10, last_txid='same', last_vout=0), 2, 1000)
            self.assertEqual([row['vout'] for row in rows], [1, 2])
            self.assertFalse(done)
            self.assertEqual(frontier, (10, 'same', 2))
            self.assertEqual(len(captured), 1)
            query, params = captured[0]
            cur.execute(psycopg2.sql.SQL('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) ') + query, params)
            plan = cur.fetchone()['QUERY PLAN'][0]['Plan']
        def nodes(node):
            yield node
            for child in node.get('Plans', []):
                yield from nodes(child)
        branches = [node for node in nodes(plan) if node.get('Relation Name') in ('outputs', 'stxos_0_20_archive')]
        self.assertEqual({node['Relation Name'] for node in branches}, {'outputs', 'stxos_0_20_archive'})
        self.assertTrue(all(node['Node Type'] in ('Index Scan', 'Index Only Scan') for node in branches), plan)
        self.assertTrue(all('blockheight >= 10' in node.get('Index Cond', '') and
                            'blockheight <= 10' in node.get('Index Cond', '') for node in branches), plan)
        self.assertLessEqual(plan['Actual Rows'], 3)
        self.assertLess(plan['Shared Hit Blocks'] + plan['Shared Read Blocks'], 100)
        self.assertLess(sum(node.get('Rows Removed by Filter', 0) * node.get('Actual Loops', 1)
                            for node in branches), 20)

    def test_reorg_or_checkpoint_change_cannot_certify_old_comparison(self):
        validation.initialize(self.conn, 10, f'{10:064x}')
        validation.step(self.conn, limit=1)
        with self.conn, self.conn.cursor() as cur:
            cur.execute('UPDATE blockheader SET blockhash=%s WHERE blockheight=10', ('f' * 64,))
        with self.assertRaisesRegex(RuntimeError, 'canonical target changed'):
            validation.step(self.conn, limit=1)
        self.assertEqual(self.query('SELECT source_rows FROM quantum_v2.validation_checkpoint'), [(1,)])

    def test_version_change_cannot_mix_source_pages_or_seal_old_proof(self):
        validation.initialize(self.conn, 10, f'{10:064x}')
        validation.step(self.conn, limit=1)
        with mock.patch.object(validation, 'PARSER_VERSION', 'fixture-upgraded-parser'):
            with self.assertRaisesRegex(ValueError, 'versions changed'):
                validation.step(self.conn, limit=1)
            checkpoint = validation.initialize(self.conn, 10, f'{10:064x}')
            self.assertEqual(checkpoint['source_rows'], 0)
            self.assertEqual(checkpoint['parser_version'], 'fixture-upgraded-parser')

    def test_missing_committed_tip_hash_is_unready(self):
        with self.conn, self.conn.cursor() as cur:
            cur.execute('DELETE FROM blockheader WHERE blockheight=20')
        with self.assertRaisesRegex(RuntimeError, 'unready'):
            validation.initialize(self.conn, 10, f'{10:064x}')

    def test_metadata_samples_verify_raw_occurrences_and_detect_false_spend(self):
        with self.conn, self.conn.cursor() as cur:
            cur.execute('CREATE TABLE key_outputs_all(keyhash20 bytea,blockheight bigint,transactionid text,vout integer)')
            cur.execute("INSERT INTO key_outputs_all SELECT %s,blockheight,transactionid,vout FROM outputs WHERE transactionid IN ('a','b','c')", (bytes.fromhex(KEY),))
        report = sample_metadata(self.conn, [KEY, 'sh', 'tr'], max_occurrences=5)
        self.assertTrue(report['passed'], report)
        self.assertEqual(report['raw_occurrences'], 5)
        key_report = next(row for row in report['samples'] if row['group_id'] == KEY)
        self.assertEqual(key_report['expected'], {'first_received_height': 1, 'first_disclosure_height': 1, 'last_spend_height': None})
        with self.conn, self.conn.cursor() as cur:
            cur.execute('UPDATE quantum_v2.group_state SET last_spend_height=9 WHERE group_id=%s', (KEY,))
        self.assertFalse(sample_metadata(self.conn, [KEY])['passed'])

    def test_metadata_budget_and_missing_index_are_explicitly_unresolved(self):
        report = sample_metadata(self.conn, [KEY])
        self.assertFalse(report['passed'])
        self.assertIn('unavailable', report['samples'][0]['unresolved'])
        report = sample_metadata(self.conn, ['sh', 'tr'], max_occurrences=1)
        self.assertFalse(report['passed'])
        self.assertIn('budget', report['samples'][1]['unresolved'])

    def test_metadata_genesis_disclosure_is_not_funding(self):
        with self.conn, self.conn.cursor() as cur:
            cur.execute('CREATE TABLE key_outputs_all(keyhash20 bytea,blockheight bigint,transactionid text,vout integer)')
            cur.execute("INSERT INTO outputs VALUES(0,'genesis',0,5000000000,'pk','pubkey',%s,NULL)", ('21' + G + 'ac',))
            cur.execute("INSERT INTO key_outputs_all SELECT %s,blockheight,transactionid,vout FROM outputs WHERE transactionid IN ('genesis','a','b','c')", (bytes.fromhex(KEY),))
            cur.execute('UPDATE quantum_v2.group_state SET first_disclosure_height=0,first_disclosure_hash=%s WHERE group_id=%s', (f'{0:064x}', KEY))
        report = sample_metadata(self.conn, [KEY])
        self.assertTrue(report['passed'], report)
        self.assertEqual(report['samples'][0]['expected']['first_received_height'], 1)
        self.assertEqual(report['samples'][0]['expected']['first_disclosure_height'], 0)

    def test_bip30_original_excluded_and_repeat_occurrence_retained(self):
        original, txid, vout, repeat, first_hash, repeat_hash = validation.BIP30[0]
        with self.conn, self.conn.cursor() as cur:
            cur.executemany('INSERT INTO blockheader VALUES(%s,%s,%s)',
                            [(original, first_hash, 1231006505 + original * 600),
                             (repeat, repeat_hash, 1231006505 + repeat * 600)])
            cur.executemany('INSERT INTO outputs VALUES(%s,%s,%s,%s,%s,%s,%s,%s)',
                            [(h, txid, vout, 500, 'pk', 'pubkey', '21' + G + 'ac', None)
                             for h in (original, repeat)])
            cur.execute('UPDATE quantum_v2.source_state SET committed_height=%s,committed_hash=%s', (repeat, repeat_hash))
        store.apply_range(self.conn, repeat)
        validation.initialize(self.conn, repeat, repeat_hash)
        for _ in range(200):
            if validation.step(self.conn, limit=2):
                break
        else:
            self.fail('BIP30 validation did not complete')
        report = validation.verify(self.conn)
        self.assertTrue(report['passed'], report)
        self.assertEqual(report['totals']['validation_group']['P2PK']['balance_sats'], 700)
        self.assertEqual(report['totals']['validation_group']['P2PK']['utxo_count'], 2)


if __name__ == '__main__':
    unittest.main()
