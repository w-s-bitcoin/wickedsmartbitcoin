#!/usr/bin/env python3
"""Quantum job and ingestion crash/retry fixtures; never use a production DB."""
from __future__ import annotations

import ast
import hashlib
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

ROOT=Path(__file__).resolve().parents[1]
PIPELINE=ROOT/'webapps/quantum_exposure/pipeline'
sys.path.insert(0,str(PIPELINE))
SPEC=importlib.util.spec_from_file_location('quantum_installer',ROOT/'scripts/install_quantum_source_hook.py')
installer=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(installer)
CERT_SPEC=importlib.util.spec_from_file_location('quantum_certifier',ROOT/'scripts/certify_quantum_source.py')
certifier=importlib.util.module_from_spec(CERT_SPEC)
CERT_SPEC.loader.exec_module(certifier)
try:
    import psycopg2
    import quantum_v2_control as control
    import quantum_v2_store as store
    import quantum_source_boundary as source
    from quantum_legacy_guard import guard_legacy_mutation, guard_quantum_analysis
except ImportError:
    psycopg2=None

DSN=os.environ.get('QUANTUM_CONTROL_TEST_DSN','')


class SourcePatchTests(unittest.TestCase):
    ORIGINAL = '''def detect_reorg(rpc_connection, last_processed_height):
    MAX_REORG_DEPTH = 20
    for height in range(last_processed_height, max(last_processed_height - MAX_REORG_DEPTH, -1), -1):
        cursor.execute("SELECT blockhash FROM blockheader WHERE blockheight = %s;", (height,))
        row = cursor.fetchone()
        if not row:
            continue
        rpc_hash = rpc_connection.getblockhash(height)
        if row[0] == rpc_hash:
            reorg_start = height + 1
            return reorg_start if reorg_start <= last_processed_height else None
    return None

def rollback_reorg(reorg_height):
    cursor.execute("DELETE FROM blockheader WHERE blockheight >= %s;", (reorg_height,))

    connection.commit()

def main():
    initialize_connection()
    rpc_connection, latestHeight = initialize_rpc_connection()
    if currentHeight > 0:
        reorg_start = detect_reorg(rpc_connection, currentHeight - 1)
        if reorg_start is not None:
            rollback_reorg(reorg_start)
    if currentHeight > latestHeight:
        print("[Ingest] Up to date.")
        return False
    insert_sql_commands(startingHeight, maxHeight)
    connection.commit()
    close_connection()
    return True
'''

    def test_changed_source_fails_closed(self):
        with self.assertRaisesRegex(ValueError,'insertion point'):
            installer.patch_source('def main():\n    pass\n')

    def test_installed_source_is_idempotent(self):
        installed = installer.patch_source(self.ORIGINAL)
        self.assertEqual(installer.patch_source(installed), installed)

    def test_original_hook_install_is_upgraded_without_changing_hook_blocks(self):
        old = self.ORIGINAL
        for before, after in installer.REPLACEMENTS:
            old = old.replace(before, after)
        updated = installer.patch_source(old)
        self.assertEqual(updated, old.replace(*installer.REORG_TAIL))
        self.assertEqual(installer.patch_source(updated), updated)

    def test_exhausted_reorg_search_fails_before_new_source_mutation(self):
        updated = installer.patch_source(self.ORIGINAL)
        node = next(node for node in ast.parse(updated).body if isinstance(node, ast.FunctionDef)
                    and node.name == 'detect_reorg')
        cursor, rpc = mock.Mock(), mock.Mock()
        rpc.getblockhash.return_value = 'canonical'
        namespace = {'cursor': cursor}
        exec(compile(ast.Module(body=[node], type_ignores=[]), 'fixture-source', 'exec'), namespace)
        detect = namespace['detect_reorg']
        cursor.fetchone.side_effect = [('orphan',)] * 20
        with self.assertRaisesRegex(RuntimeError, 'No common ancestor'):
            detect(rpc, 100)
        self.assertEqual(rpc.getblockhash.call_count, 20)
        cursor.fetchone.side_effect = [('orphan',)] * 3 + [('canonical',)]
        self.assertEqual(detect(rpc, 100), 98)
        cursor.fetchone.side_effect = [('canonical',)]
        self.assertIsNone(detect(rpc, 100))
        cursor.fetchone.side_effect = [('orphan',), ('canonical',)]
        self.assertEqual(detect(rpc, 1), 1)

    def test_reviewed_upgrade_retains_distinct_backup_and_checks_source_under_lock(self):
        old = self.ORIGINAL
        for before, after in installer.REPLACEMENTS:
            old = old.replace(before, after)
        updated = installer.patch_source(old)
        digest = hashlib.sha256(old.encode()).hexdigest()
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            source_path, lock = directory / 'CoreToPSQL.py', directory / 'ingest.lock'
            source_path.write_text(old)
            first_backup = source_path.with_name(source_path.name + '.pre-quantum-v2')
            first_backup.write_text(self.ORIGINAL)
            with self.assertRaisesRegex(ValueError, 'SHA256'):
                installer.install_source(source_path, old, updated, expected_sha256='wrong', lock=lock)
            self.assertFalse(lock.exists())
            source_path.write_text(old + '\n# changed after dry run\n')
            with self.assertRaisesRegex(RuntimeError, 'changed after review'):
                installer.install_source(source_path, old, updated, expected_sha256=digest, lock=lock)
            self.assertFalse(lock.exists())
            source_path.write_text(old)
            installer.install_source(source_path, old, updated, expected_sha256=digest, lock=lock)
            self.assertEqual(source_path.read_text(), updated)
            self.assertEqual(first_backup.read_text(), self.ORIGINAL)
            self.assertEqual(source_path.with_name(source_path.name + '.pre-quantum-reorg-guard').read_text(), old)
            self.assertFalse(lock.exists())
            installer.install_source(source_path, updated, updated,
                                     expected_sha256=hashlib.sha256(updated.encode()).hexdigest(), lock=lock)

    def test_partial_import_or_missing_hook_is_rejected(self):
        installed = installer.patch_source(self.ORIGINAL)
        variants = ['import quantum_source_boundary\ndef main():\n    pass\n']
        for _, block in installer.REPLACEMENTS:
            variants.append(installed.replace(block, '', 1))
        for source_text in variants:
            with self.subTest(source=source_text), self.assertRaises((ValueError, SyntaxError)):
                installer.patch_source(source_text)

    def test_complete_text_in_wrong_scope_or_order_is_rejected(self):
        installed = installer.patch_source(self.ORIGINAL)
        variants = [installed.replace('def main():', 'def other():'),
                    installed.replace('def rollback_reorg(', 'def other_reorg('),
                    installed.replace('if currentHeight > latestHeight:', 'if False:'),
                    installed.replace('    initialize_connection()\n',
                                      '    initialize_connection()\n    rollback_reorg(1)\n'),
                    installed.replace('    close_connection()\n',
                                      '    update_nexthash(1, "fixture")\n    close_connection()\n'),
                    installed.replace('    quantum_ingestion_id = quantum_source_boundary.begin(connection)\n',
                                      '    quantum_ingestion_id = quantum_source_boundary.begin(connection)\n' * 2),
                    installed.replace('quantum_source_boundary.reorg(connection, reorg_height)',
                                      'quantum_source_boundary.reorg(connection, 0)')]
        for source_text in variants:
            with self.subTest(source=source_text), self.assertRaises(ValueError):
                installer.patch_source(source_text)


class LegacyAnalysisGuardTests(unittest.TestCase):
    def test_both_legacy_analyzers_guard_before_first_sql(self):
        for name in ('run_dashboard_analysis.py', 'run_historical_dashboard_analysis.py'):
            with self.subTest(name=name):
                tree = ast.parse((PIPELINE / name).read_text())
                main = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'main')
                operation = next(node for node in main.body if isinstance(node, ast.Try))
                self.assertEqual(ast.unparse(operation.body[0]), 'guard_quantum_analysis(conn)')
                self.assertIsInstance(operation.body[1], ast.With)


class CertificationLockTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        (self.directory / 'update_bitcoin_data.sh').write_text('# fixture caller\n')
        self.lock = self.directory / 'ingest.lock'

    def test_maintenance_rejects_before_lock_and_preserves_marker(self):
        marker = self.directory / '.storage-maintenance'
        marker.touch()
        with self.assertRaisesRegex(SystemExit, 'maintenance'):
            with certifier.certification_lock(self.directory, self.lock):
                self.fail('Certification must not start')
        self.assertTrue(marker.exists())
        self.assertFalse(self.lock.exists())

    def test_existing_ingest_lock_is_not_removed(self):
        self.lock.mkdir()
        (self.lock / 'pid').write_text('fixture owner')
        with self.assertRaisesRegex(SystemExit, 'Ingestion is active'):
            with certifier.certification_lock(self.directory, self.lock):
                self.fail('Certification must not start')
        self.assertEqual((self.lock / 'pid').read_text(), 'fixture owner')

    def test_maintenance_race_is_rechecked_and_own_lock_released(self):
        original_mkdir = Path.mkdir

        def acquire_then_maintenance(path, *args, **kwargs):
            result = original_mkdir(path, *args, **kwargs)
            if path == self.lock:
                (self.directory / '.storage-maintenance').touch()
            return result

        with mock.patch.object(Path, 'mkdir', acquire_then_maintenance):
            with self.assertRaisesRegex(SystemExit, 'maintenance'):
                with certifier.certification_lock(self.directory, self.lock):
                    self.fail('Certification must not start')
        self.assertFalse(self.lock.exists())

    def test_unknown_caller_fails_and_success_holds_lock_until_exit(self):
        with self.assertRaisesRegex(SystemExit, 'unverified'):
            with certifier.certification_lock(self.directory / 'missing', self.lock):
                self.fail('Certification must not start')
        with self.assertRaisesRegex(RuntimeError, 'fixture failure'):
            with certifier.certification_lock(self.directory, self.lock):
                self.assertEqual((self.lock / 'pid').read_text(), str(os.getpid()))
                raise RuntimeError('fixture failure')
        self.assertFalse(self.lock.exists())


@unittest.skipUnless(psycopg2 and DSN,'Set QUANTUM_CONTROL_TEST_DSN to an isolated *_fixture database')
class ControlTests(unittest.TestCase):
    def setUp(self):
        args = psycopg2.extensions.parse_dsn(DSN)
        if not args.get('dbname', '').endswith('_fixture') or not args.get('host', '').startswith(('/tmp/', '/private/tmp/')):
            raise RuntimeError('Refusing setup outside explicit /tmp socket + *_fixture database')
        self.conn=psycopg2.connect(DSN)
        if not self.conn.info.dbname.endswith('_fixture'):
            self.conn.close()
            raise RuntimeError('Refusing non-fixture database')
        self.addCleanup(self.conn.close)
        with self.conn,self.conn.cursor() as cur:
            cur.execute('DROP SCHEMA IF EXISTS quantum_v2 CASCADE')
            cur.execute('DROP TABLE IF EXISTS public.blockheader,public.inputs')
            cur.execute('CREATE TABLE public.blockheader(blockheight bigint PRIMARY KEY,blockhash text,time bigint)')
            cur.execute('CREATE TABLE public.inputs(id bigint)')
            cur.execute("INSERT INTO public.blockheader SELECT n, lpad(to_hex(n),64,'0'),n FROM generate_series(0,3010) n")
        store.migrate(self.conn)
        control.migrate(self.conn)
        control.configure(self.conn,paused=False,start_height=1000)
        with self.conn,self.conn.cursor() as cur:
            cur.execute("UPDATE quantum_v2.source_state SET ready=true,committed_height=3006,committed_hash=lpad(to_hex(3006),64,'0')")

    def fetch(self,query):
        with self.conn,self.conn.cursor() as cur:
            cur.execute(query)
            return cur.fetchall()

    def test_confirmations_boundaries_and_duplicate_discovery(self):
        with self.conn,self.conn.cursor() as cur:
            cur.execute("UPDATE quantum_v2.source_state SET committed_height=3005,committed_hash=lpad(to_hex(3005),64,'0')")
        self.assertEqual(len(control.discover(self.conn,'fixture-v2')),1)
        self.assertEqual(self.fetch('SELECT target_height FROM quantum_v2.request'),[(2000,)])
        self.assertEqual(control.discover(self.conn,'fixture-v2'),[])
        with self.conn,self.conn.cursor() as cur:
            cur.execute("UPDATE quantum_v2.source_state SET committed_height=3006,committed_hash=lpad(to_hex(3006),64,'0')")
        self.assertEqual(len(control.discover(self.conn,'fixture-v2')),1)
        self.assertEqual(control.next_request(self.conn)['target_height'],2000)

    def test_stale_certified_tip_hash_blocks_discovery_and_delivery(self):
        self.assertTrue(control.canonical_ready(self.conn,2000,f'{2000:064x}'))
        with self.conn,self.conn.cursor() as cur:
            cur.execute("UPDATE blockheader SET blockhash=repeat('f',64) WHERE blockheight=3006")
        self.assertEqual(control.discover(self.conn,'fixture-v2'),[])
        self.assertFalse(control.canonical_ready(self.conn,2000,f'{2000:064x}'))
        with self.conn,self.conn.cursor() as cur:
            cur.execute("UPDATE quantum_v2.source_state SET committed_hash=repeat('f',64)")
        self.assertEqual(len(control.discover(self.conn,'fixture-v2')),2)
        self.assertTrue(control.canonical_ready(self.conn,2000,f'{2000:064x}'))

    def test_direct_migration_respects_writer_and_existing_transactions(self):
        other = psycopg2.connect(DSN)
        self.addCleanup(other.close)
        self.assertTrue(control.take_writer_lock(other))
        with self.assertRaisesRegex(RuntimeError, 'worker or maintenance'):
            control.migrate(self.conn)
        self.assertEqual(self.conn.get_transaction_status(), 0)
        control.release_writer_lock(other)
        control.migrate(self.conn)
        with self.conn.cursor() as cur:
            cur.execute('INSERT INTO inputs VALUES (42)')
        with self.assertRaisesRegex(RuntimeError, 'idle connection'):
            control.migrate(self.conn)
        self.conn.rollback()
        self.assertEqual(self.fetch('SELECT * FROM inputs'), [])

    def test_legacy_guard_coordinates_migration_across_commits(self):
        guard_legacy_mutation(self.conn)
        self.conn.commit()
        other = psycopg2.connect(DSN)
        self.addCleanup(other.close)
        with self.assertRaisesRegex(RuntimeError, 'worker or maintenance'):
            control.migrate(other)
        with other, other.cursor() as cur:
            for key in (1, 2):
                cur.execute('SELECT pg_try_advisory_xact_lock(811947,%s)', (key,))
                self.assertFalse(cur.fetchone()[0])
        self.conn.close()
        control.migrate(other)

    def test_legacy_guard_rejection_releases_only_its_lock_acquisitions(self):
        with self.conn, self.conn.cursor() as cur:
            cur.execute("INSERT INTO quantum_v2.projection(status,anchor_height,anchor_hash,height,block_hash) VALUES('seeding',0,'h',0,'h')")
        other = psycopg2.connect(DSN)
        self.addCleanup(other.close)
        self.assertTrue(control.take_writer_lock(self.conn))
        with self.assertRaisesRegex(RuntimeError, 'legacy seed tables are frozen'):
            guard_legacy_mutation(self.conn)
        self.assertFalse(control.take_writer_lock(other), 'Preexisting caller lock must remain held')
        with other, other.cursor() as cur:
            cur.execute('SELECT pg_try_advisory_xact_lock(811947,1)')
            self.assertTrue(cur.fetchone()[0], 'Rejected guard must release the store lock')
        control.release_writer_lock(self.conn)
        self.assertTrue(control.take_writer_lock(other))

    def test_legacy_guard_second_lock_failure_releases_global_lock(self):
        other = psycopg2.connect(DSN)
        self.addCleanup(other.close)
        with other, other.cursor() as cur:
            cur.execute('SELECT pg_advisory_lock(811947,1)')
        with self.assertRaisesRegex(RuntimeError, 'writer lock'):
            guard_legacy_mutation(self.conn)
        self.assertTrue(control.take_writer_lock(other), 'Failed guard must release its global lock')

    def test_legacy_analysis_guard_allows_v2_but_serializes_sessions(self):
        with self.conn, self.conn.cursor() as cur:
            cur.execute("INSERT INTO quantum_v2.projection(status,anchor_height,anchor_hash,height,block_hash) VALUES('ready',0,'h',0,'h')")
        other = psycopg2.connect(DSN)
        self.addCleanup(other.close)
        guard_quantum_analysis(self.conn)
        self.conn.commit()
        self.assertFalse(control.take_writer_lock(other))
        with self.assertRaisesRegex(RuntimeError, 'no analysis was started'):
            guard_quantum_analysis(other)
        self.assertEqual(other.get_transaction_status(), 0)
        with self.assertRaisesRegex(RuntimeError, 'worker or maintenance'):
            control.migrate(other)
        self.conn.close()
        guard_quantum_analysis(other)
        other.close()
        with psycopg2.connect(DSN) as probe, probe.cursor() as cur:
            cur.execute('SELECT pg_try_advisory_xact_lock(811947,2)')
            self.assertTrue(cur.fetchone()[0])

    def test_legacy_analysis_guard_does_not_commit_callers_work(self):
        with self.conn.cursor() as cur:
            cur.execute('INSERT INTO inputs VALUES (7)')
        with self.assertRaisesRegex(RuntimeError, 'idle connection'):
            guard_quantum_analysis(self.conn)
        self.conn.rollback()
        self.assertEqual(self.fetch('SELECT * FROM inputs'), [])

    def test_source_readiness_remains_light_while_worker_owns_global_lock(self):
        other = psycopg2.connect(DSN)
        self.addCleanup(other.close)
        self.assertTrue(control.take_writer_lock(other))
        identity = source.begin(self.conn)
        rpc = mock.Mock()
        rpc.getblockhash.return_value = f'{3010:064x}'
        source.finish(self.conn, rpc, identity)
        self.assertTrue(self.fetch('SELECT ready FROM quantum_v2.source_state')[0][0])
        self.assertFalse(control.take_writer_lock(self.conn))

    def test_ingestion_unready_and_failed_finish_prevent_work(self):
        identity=source.begin(self.conn)
        self.assertEqual(control.discover(self.conn,'fixture-v2'),[])
        rpc=mock.Mock()
        rpc.getblockhash.return_value='f'*64
        with self.assertRaisesRegex(RuntimeError,'canonical RPC'):
            source.finish(self.conn,rpc,identity)
        self.conn.rollback()
        self.assertFalse(self.fetch('SELECT ready FROM quantum_v2.source_state')[0][0])
        rpc.getblockhash.return_value=f'{3010:064x}'
        with self.conn,self.conn.cursor() as cur:
            cur.execute('INSERT INTO inputs VALUES(1)')
        with self.assertRaisesRegex(RuntimeError,'Unapplied'):
            source.finish(self.conn,rpc,identity)
        self.conn.rollback()
        with self.conn,self.conn.cursor() as cur:
            cur.execute('DELETE FROM inputs')
        source.finish(self.conn,rpc,identity)
        self.assertTrue(self.fetch('SELECT ready FROM quantum_v2.source_state')[0][0])

    def test_exclusive_writer_and_crashed_attempt_recovery(self):
        other=psycopg2.connect(DSN)
        self.addCleanup(other.close)
        self.assertTrue(control.take_writer_lock(self.conn))
        self.assertFalse(control.take_writer_lock(other))
        ids=control.discover(self.conn,'fixture-v2')
        old=control.begin_run(self.conn,ids[0])
        new=control.begin_run(self.conn,ids[0])
        self.assertNotEqual(old,new)
        self.assertEqual(self.fetch("SELECT status FROM quantum_v2.run ORDER BY started_at"),[('interrupted',),('running',)])
        control.release_writer_lock(self.conn)
        self.assertTrue(control.take_writer_lock(other))

    def test_same_height_reorg_invalidates_request_identity(self):
        ids=control.discover(self.conn,'fixture-v2')
        with self.conn,self.conn.cursor() as cur:
            cur.execute("UPDATE blockheader SET blockhash=repeat('a',64) WHERE blockheight=2000")
        new=control.discover(self.conn,'fixture-v2')
        self.assertEqual(len(new),1)
        self.assertEqual(self.fetch(f'SELECT status FROM quantum_v2.request WHERE id={ids[0]}'),[('orphaned',)])
        self.assertEqual(control.next_request(self.conn)['target_hash'],'a'*64)

    def test_delivery_retry_is_independent_and_old_generation_is_superseded(self):
        ids=control.discover(self.conn,'fixture-v2')
        for n in ids:
            control.analyzed(self.conn,n,f'fixture-{n}',Path('/tmp')/f'fixture-{n}')
        old,new=sorted(ids)
        self.assertTrue(control.delivery_started(self.conn,old,'standalone'))
        control.delivery_finished(self.conn,old,'standalone',error='simulated network failure')
        self.assertTrue(control.delivery_started(self.conn,new,'website'))
        control.delivery_finished(self.conn,new,'website',commit='a'*40)
        self.assertFalse(control.delivery_started(self.conn,old,'website'))
        self.assertTrue(control.delivery_started(self.conn,old,'standalone'))
        control.delivery_finished(self.conn,old,'standalone',commit='b'*40)
        self.assertEqual(self.fetch(f'SELECT status FROM quantum_v2.request WHERE id={old}'),[('complete',)])
        self.assertIsNone(control.next_request(self.conn),'publication retry must not repeat analysis')


if __name__=='__main__':
    unittest.main()
