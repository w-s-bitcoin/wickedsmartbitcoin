#!/usr/bin/env python3
"""End-to-end worker fixtures: real PostgreSQL/export, mocked Git destinations.

Only QUANTUM_WORKER_TEST_DSN on a /tmp socket and a *_fixture database is
accepted. The fixture replaces that database's public and quantum_v2 schemas.
"""
from __future__ import annotations

import csv
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "webapps/quantum_exposure/pipeline"))
try:
    import psycopg2
    import quantum_v2_control as control
    import quantum_v2_delivery as delivery
    import quantum_v2_enrichment as enrichment
    import quantum_v2_store as store
    import run_quantum_worker as worker
except ImportError:
    psycopg2 = None

DSN = os.environ.get("QUANTUM_WORKER_TEST_DSN", "")
G = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
KEY = hashlib.new("ripemd160", hashlib.sha256(bytes.fromhex(G)).digest()).hexdigest()


class FixtureMonitor:
    """Resource sampling is tested separately; do not adjust test process priority."""
    exceeded = False

    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def metrics(self):
        return {"fixture": True}


@unittest.skipUnless(DSN and psycopg2, "Set QUANTUM_WORKER_TEST_DSN for a disposable PostgreSQL fixture")
class WorkerFixture(unittest.TestCase):
    def setUp(self):
        config = psycopg2.extensions.parse_dsn(DSN)
        if not config.get("dbname", "").endswith("_fixture") or not config.get("host", "").startswith(("/tmp/", "/private/tmp/")):
            raise RuntimeError("Refusing setup outside explicit /tmp socket + *_fixture database")
        self.conn = psycopg2.connect(DSN)
        self.addCleanup(self.conn.close)
        self.temp = tempfile.TemporaryDirectory(prefix="quantum-worker-fixture-")
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.config = {"state_dir": str(root / "state"), "production_repo": str(root / "website"),
                       "standalone_repo": str(root / "standalone"), "work_seconds": 60,
                       "bootstrap_rows": 100, "batch_blocks": 100, "batch_pause_seconds": 0}
        with self.conn, self.conn.cursor() as cur:
            cur.execute("DROP SCHEMA IF EXISTS quantum_v2 CASCADE")
            cur.execute("DROP SCHEMA public CASCADE")
            cur.execute("CREATE SCHEMA public")
            cur.execute("CREATE TABLE blockheader(blockheight bigint PRIMARY KEY,blockhash text,time bigint)")
            cur.execute("INSERT INTO blockheader SELECT n,lpad(to_hex(n),64,'0'),1231006505+n*600 FROM generate_series(0,1006) n")
            cur.execute("CREATE TABLE inputs(id bigint)")
            cur.execute("""CREATE TABLE outputs(blockheight bigint,transactionid text,vout integer,
                amount bigint,address text,scripttype text,scripthex text,spendingblock bigint,
                PRIMARY KEY(blockheight,transactionid,vout))""")
            cur.execute("CREATE TABLE stxos_0_9999_archive (LIKE outputs INCLUDING ALL)")
            cur.executemany("INSERT INTO outputs VALUES(%s,%s,%s,%s,%s,%s,%s,%s)", [
                (1, "a" * 64, 0, 200_000_000, "public-key", "pubkey", "21" + G + "ac", None),
                (750, "b" * 64, 0, 100_000_000, "key-hash", "pubkeyhash", "76a914" + KEY + "88ac", None),
            ])
        store.migrate(self.conn)
        control.migrate(self.conn)
        enrichment.migrate(self.conn)
        worker.validation.migrate(self.conn)
        control.configure(self.conn, paused=False, start_height=0)
        with self.conn, self.conn.cursor() as cur:
            cur.execute("UPDATE quantum_v2.source_state SET ready=true,committed_height=1006,committed_hash=%s", (f"{1006:064x}",))
        store.initialize_source_seed(self.conn, 500, f"{500:064x}")
        for name, value in (("ResourceMonitor", FixtureMonitor), ("lower_priority", mock.Mock()), ("log", mock.Mock())):
            patch = mock.patch.object(worker, name, value)
            patch.start()
            self.addCleanup(patch.stop)

    def query(self, sql):
        with self.conn, self.conn.cursor() as cur:
            cur.execute(sql)
            return cur.fetchall()

    def pause_again(self):
        control.configure(self.conn,paused=True)
        pause=Path(self.config['state_dir'])/'PAUSED'
        pause.parent.mkdir(parents=True,exist_ok=True)
        pause.write_text('new operator pause\n')

    def test_pause_file_alone_blocks_automatic_tick(self):
        pause=Path(self.config['state_dir'])/'PAUSED'
        pause.parent.mkdir(parents=True)
        pause.write_text('operator pause\n')
        with mock.patch.object(store,'bootstrap_step') as bootstrap, mock.patch.object(worker,'deliver_pending') as deliver:
            self.assertEqual(worker.run_once(self.conn,self.config),0)
            bootstrap.assert_not_called()
            deliver.assert_not_called()

    def test_pause_after_last_projection_batch_blocks_export_and_destinations(self):
        apply=store.apply_range
        def apply_then_pause(*args,**kwargs):
            result=apply(*args,**kwargs)
            if args[1]==1000:
                control.configure(self.conn,paused=True)
            return result
        with mock.patch.object(store,'apply_range',side_effect=apply_then_pause), \
             mock.patch.object(worker.analysis,'export_snapshot') as export, \
             mock.patch.object(delivery,'deliver_website') as website, \
             mock.patch.object(delivery,'deliver_standalone') as standalone:
            self.assertEqual(worker.run_once(self.conn,self.config),0)
            export.assert_not_called(); website.assert_not_called(); standalone.assert_not_called()
        self.assertEqual(self.query('SELECT height FROM quantum_v2.projection'),[(1000,)])
        self.assertEqual(self.query("SELECT metrics->>'deferred' FROM quantum_v2.run"),[('paused',)])

    def test_pause_between_destinations_keeps_remaining_delivery_retryable(self):
        def standalone_then_pause(*args,**kwargs):
            control.configure(self.conn,paused=True)
            return {'commit':'standalone-accepted'}
        with mock.patch.object(delivery,'deliver_standalone',side_effect=standalone_then_pause), \
             mock.patch.object(delivery,'deliver_website',return_value={'commit':'website-accepted'}) as website:
            self.assertEqual(worker.run_once(self.conn,self.config),0)
            website.assert_not_called()
            self.assertEqual(self.query('SELECT destination,status FROM quantum_v2.delivery ORDER BY destination'),
                             [('standalone','complete'),('website','pending')])
            control.configure(self.conn,paused=False)
            with mock.patch.object(worker,'export_request') as export:
                self.assertEqual(worker.run_once(self.conn,self.config),0)
                export.assert_not_called()
            website.assert_called_once()

    def test_new_pause_stops_explicit_validation_despite_bypassing_existing_pause(self):
        while not store.bootstrap_step(self.conn,limit=100):
            pass
        self.pause_again()
        self.config['validation_rows']=1
        step=worker.validation.step
        def first_page_then_pause(*args,**kwargs):
            result=step(*args,**kwargs)
            self.pause_again()
            return result
        with mock.patch.object(worker.validation,'step',side_effect=first_page_then_pause) as stepped:
            self.assertEqual(worker.run_once(self.conn,self.config,validation_only=True),0)
            self.assertEqual(stepped.call_count,1)
        self.assertEqual(self.query('SELECT source_rows FROM quantum_v2.validation_checkpoint'),[(1,)])
        self.assertEqual(self.query('SELECT count(*) FROM quantum_v2.validation_result'),[(0,)])

    def test_new_pause_stops_explicit_bootstrap_after_committed_page(self):
        self.pause_again()
        self.config['bootstrap_rows_by_source']={'canonical_blocks':1}
        bootstrap=store.bootstrap_step
        def first_page_then_pause(*args,**kwargs):
            result=bootstrap(*args,**kwargs)
            self.pause_again()
            return result
        with mock.patch.object(store,'bootstrap_step',side_effect=first_page_then_pause) as stepped:
            self.assertEqual(worker.run_once(self.conn,self.config,bootstrap_only=True),0)
            self.assertEqual(stepped.call_count,1)
            self.assertEqual(stepped.call_args.kwargs['limit'],1)
        self.assertEqual(self.query('SELECT count(*) FROM quantum_v2.validation_result'),[(0,)])

    def test_bootstrap_selects_each_next_source_under_writer_lock(self):
        from quantum_worker_config import LEGACY_BOOTSTRAP_SOURCES
        self.assertEqual(LEGACY_BOOTSTRAP_SOURCES,store.LEGACY)
        self.config['bootstrap_rows_by_source']={'active_key_outputs':100000,
                                                'active_bare_ms_outputs':5000,'canonical_blocks':25000}
        with self.conn,self.conn.cursor() as cur:
            cur.executemany('INSERT INTO quantum_v2.bootstrap_cursor(source_table) VALUES(%s)',
                            [('other:source',),('active_key_outputs',),('active_bare_ms_outputs',)])
        other=psycopg2.connect(DSN)
        self.addCleanup(other.close)
        calls=[]
        def commit_page(conn,*,limit):
            with other,other.cursor() as cur:
                cur.execute('SELECT pg_try_advisory_lock(811947,2)')
                self.assertFalse(cur.fetchone()[0],'Source choice must remain protected by the worker lock')
            with conn,conn.cursor() as cur:
                cur.execute('SELECT source_table FROM quantum_v2.bootstrap_cursor WHERE NOT complete ORDER BY source_table LIMIT 1')
                source=cur.fetchone()[0]
                calls.append((source,limit))
                cur.execute('UPDATE quantum_v2.bootstrap_cursor SET complete=true WHERE source_table=%s',(source,))
                cur.execute('SELECT NOT EXISTS(SELECT 1 FROM quantum_v2.bootstrap_cursor WHERE NOT complete)')
                return cur.fetchone()[0]
        with mock.patch.object(store,'bootstrap_step',side_effect=commit_page):
            self.assertEqual(worker.run_once(self.conn,self.config,bootstrap_only=True),0)
        self.assertEqual(calls,[('active_bare_ms_outputs',5000),('active_key_outputs',100000),
                                ('canonical_blocks',25000),('other:source',100)])

    def test_bad_bootstrap_source_configuration_fails_before_database_work(self):
        for overrides in ({'outputs':1},{'canonical_blocks':False},{'other:source':100001}):
            self.config['bootstrap_rows_by_source']=overrides
            with mock.patch.object(control,'take_writer_lock') as lock, self.assertRaises(ValueError):
                worker.run_once(self.conn,self.config,bootstrap_only=True)
            lock.assert_not_called()

    def test_migrate_command_excludes_running_worker_before_any_ddl(self):
        other=psycopg2.connect(DSN)
        self.addCleanup(other.close)
        self.assertTrue(control.take_writer_lock(other))
        config=Path(self.temp.name)/'fixture-config.json'
        config.write_text(json.dumps(self.config))
        with mock.patch.object(worker,'connect',return_value=self.conn), \
             mock.patch.object(sys,'argv',['run_quantum_worker.py','--config',str(config),'migrate']), \
             mock.patch.object(store,'migrate') as migration:
            with self.assertRaisesRegex(RuntimeError,'maintenance session is active'):
                worker.main()
            migration.assert_not_called()
        control.release_writer_lock(other)

    def test_delivery_retry_keeps_projection_and_export_once(self):
        with mock.patch.object(delivery, "deliver_website", side_effect=[RuntimeError("fixture push unavailable"), {"commit": "website-accepted"}]) as website, \
             mock.patch.object(delivery, "deliver_standalone", return_value={"commit": "standalone-accepted"}) as standalone, \
             mock.patch.object(worker, "export_request", wraps=worker.export_request) as export:
            self.assertEqual(worker.run_once(self.conn, self.config), 0)
            self.assertEqual(self.query("SELECT status,attempt FROM quantum_v2.request"), [("analyzed", 1)])
            self.assertEqual(self.query("SELECT destination,status,attempts FROM quantum_v2.delivery ORDER BY destination"),
                             [("standalone", "complete", 1), ("website", "failed", 1)])
            output = Path(self.query("SELECT output_dir FROM quantum_v2.request")[0][0])
            marker = json.loads((output / "published_generation.json").read_text())
            self.assertEqual(marker["format"], 2)
            detail = output / "1000/dashboard_pubkeys_ge_1btc.csv"
            with detail.open(newline="") as handle:
                rows = list(csv.DictReader(handle))
            self.assertEqual(len(rows), 1)
            self.assertEqual(int(rows[0]["exposed_supply_sats"]), 300_000_000)
            self.assertEqual(json.loads(rows[0]["exposed_utxo_count_by_script_type"]), {"P2PK": 1, "P2PKH": 1})
            state = self.query("SELECT group_id,script_type,balance_sats FROM quantum_v2.group_state ORDER BY group_id,script_type")
            self.assertEqual(worker.run_once(self.conn, self.config), 0)
            self.assertEqual(self.query("SELECT status,attempt FROM quantum_v2.request"), [("complete", 1)])
            self.assertEqual(state, self.query("SELECT group_id,script_type,balance_sats FROM quantum_v2.group_state ORDER BY group_id,script_type"))
            self.assertEqual(export.call_count, 1)
            self.assertEqual(website.call_count, 2)
            self.assertEqual(standalone.call_count, 1)

    def test_worker_enriches_canonical_groups_after_family_reduction(self):
        labels=Path(self.temp.name)/'labels.csv'
        with labels.open('w',newline='') as handle:
            writer=csv.DictWriter(handle,fieldnames=['group_id','identity','details'])
            writer.writeheader()
            writer.writerow({'group_id':KEY,'identity':'Reviewed group','details':'fixture annotation'})
        enrichment.import_snapshot_labels(self.conn,labels,revision='worker-label-fixture')
        self.config['label_version']='worker-label-fixture'
        enrich=enrichment.iter_enriched_rows
        observed=[]
        def check_grouped(conn,rows,**kwargs):
            def checked():
                for group in rows:
                    self.assertIn('slices',group)
                    self.assertEqual(set(group['slices']),{'P2PK','P2PKH'})
                    self.assertTrue(kwargs['predicate'](group))
                    self.assertTrue(kwargs['predicate']({**group,'exposed_supply_sats':0,'exposed_utxo_count':1}))
                    self.assertFalse(kwargs['predicate']({**group,'exposed_supply_sats':0,'exposed_utxo_count':0}))
                    observed.append(group['group_id'])
                    yield group
            return enrich(conn,checked(),**kwargs)
        with mock.patch.object(enrichment,'iter_enriched_rows',side_effect=check_grouped), \
             mock.patch.object(delivery,'deliver_website',return_value={'commit':'website-accepted'}), \
             mock.patch.object(delivery,'deliver_standalone',return_value={'commit':'standalone-accepted'}):
            self.assertEqual(worker.run_once(self.conn,self.config),0)
        self.assertEqual(observed,[KEY])
        output=Path(self.query('SELECT output_dir FROM quantum_v2.request')[0][0])
        with (output/'1000/dashboard_pubkeys_ge_1btc.csv').open(newline='') as handle:
            rows=list(csv.DictReader(handle))
        self.assertEqual(rows[0]['identity'],'Reviewed group')
        self.assertEqual(rows[0]['details'],'fixture annotation')

    def test_failed_seal_resumes_at_checkpoint_without_accepting_partial(self):
        finish = delivery.finish_output
        attempts = 0

        def fail_once(*args, **kwargs):
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise RuntimeError("fixture crash before generation seal")
            return finish(*args, **kwargs)

        with mock.patch.object(delivery, "finish_output", side_effect=fail_once), \
             mock.patch.object(delivery, "deliver_website", return_value={"commit": "website-accepted"}), \
             mock.patch.object(delivery, "deliver_standalone", return_value={"commit": "standalone-accepted"}):
            self.assertEqual(worker.run_once(self.conn, self.config), 1)
            self.assertEqual(self.query("SELECT height,status FROM quantum_v2.projection"), [(1000, "ready")])
            self.assertEqual(self.query("SELECT count(*) FROM quantum_v2.delivery"), [(0,)])
            self.assertEqual(self.query("SELECT count(*) FROM quantum_v2.accepted_generation"), [(0,)])
            with mock.patch.object(store, "apply_range", side_effect=AssertionError("Projection replayed after export failure")):
                self.assertEqual(worker.run_once(self.conn, self.config), 0)
            self.assertEqual(self.query("SELECT status,attempt FROM quantum_v2.request"), [("complete", 2)])
            self.assertEqual(self.query("SELECT status FROM quantum_v2.run ORDER BY started_at"), [("failed",), ("succeeded",)])

    def test_validation_pause_preserves_checkpoint_and_admin_can_resume(self):
        while not store.bootstrap_step(self.conn, limit=100):
            pass
        pause_file = Path(self.config['state_dir']) / 'PAUSED'
        pause_file.parent.mkdir(parents=True)
        pause_file.write_text('operator pause\n')
        with mock.patch.object(worker.validation, 'step', wraps=worker.validation.step) as step:
            import time
            self.assertFalse(worker.validate_projection(self.conn, self.config, deadline=time.monotonic()+60))
            step.assert_not_called()
        self.assertEqual(self.query('SELECT count(*) FROM quantum_v2.validation_result'), [(0,)])
        self.assertEqual(worker.run_once(self.conn, self.config, validation_only=True), 0)
        self.assertEqual(self.query('SELECT passed FROM quantum_v2.validation_result'), [(True,)])

    def orphan_partial_seed(self):
        with self.conn, self.conn.cursor() as cur:
            cur.execute("INSERT INTO outputs VALUES(2,'extra',0,3,'public-key','pubkey',%s,NULL)", ("21"+G+"ac",))
        self.assertFalse(store.bootstrap_step(self.conn,limit=1))
        self.assertEqual(self.query("SELECT status FROM quantum_v2.projection"),[("seeding",)])
        with self.conn, self.conn.cursor() as cur:
            cur.execute("UPDATE blockheader SET blockhash='replacement-anchor' WHERE blockheight=500")
        control.configure(self.conn,paused=True)

    def test_paused_partial_seed_reorg_recovers_old_confirmed_anchor(self):
        self.orphan_partial_seed()
        with mock.patch.object(worker,"export_request") as export, \
             mock.patch.object(store,"initialize_source_seed",side_effect=AssertionError("Recovery initialized outside reset transaction")):
            self.assertEqual(worker.run_once(self.conn,self.config,bootstrap_only=True),0)
        export.assert_not_called()
        self.assertEqual(self.query("SELECT anchor_height,anchor_hash,status FROM quantum_v2.projection"),
                         [(500,"replacement-anchor","ready")])
        self.assertEqual(self.query("SELECT count(*) FROM quantum_v2.request"),[(0,)])
        self.assertEqual(self.query("SELECT count(*) FROM quantum_v2.orphan_disclosure"),[(1,)])
        metrics=self.query("SELECT metrics FROM quantum_v2.run")[0][0]
        self.assertTrue(metrics['fixture'])
        self.assertTrue(metrics['recovery']['canonical_seed_initialized'])
        self.assertGreater(metrics['recovery']['reset_pages'],0)

    def test_recovery_budget_exhaustion_never_exports(self):
        self.orphan_partial_seed()
        config=dict(self.config,work_seconds=0,reset_rows=1)
        with mock.patch.object(worker,"export_request") as export, \
             mock.patch.object(store,"reset_projection_step",wraps=store.reset_projection_step) as reset:
            self.assertEqual(worker.run_once(self.conn,config,bootstrap_only=True),0)
        reset.assert_not_called(); export.assert_not_called()
        self.assertEqual(self.query("SELECT status FROM quantum_v2.projection"),[("needs_reseed",)])
        metrics=self.query("SELECT metrics FROM quantum_v2.run")[0][0]
        self.assertEqual(metrics['recovery']['reset_pages'],0)
        self.assertEqual(worker.run_once(self.conn,self.config,bootstrap_only=True),0)
        self.assertEqual(self.query("SELECT status,anchor_hash FROM quantum_v2.projection"),[("ready","replacement-anchor")])

    def test_ingestion_race_defers_before_recovery_mutation(self):
        self.orphan_partial_seed()
        read_source=worker._recovery_source
        calls=0
        def start_ingestion(conn):
            nonlocal calls
            source=read_source(conn); calls+=1
            if calls==1:
                with conn,conn.cursor() as cur:
                    cur.execute("UPDATE quantum_v2.source_state SET ready=false")
            return source
        with mock.patch.object(worker,"_recovery_source",side_effect=start_ingestion), \
             mock.patch.object(worker,"export_request") as export:
            self.assertEqual(worker.run_once(self.conn,self.config,bootstrap_only=True),0)
        export.assert_not_called()
        self.assertEqual(self.query("SELECT status,anchor_hash FROM quantum_v2.projection"),[("seeding",f"{500:064x}")])
        self.assertEqual(self.query("SELECT metrics->>'deferred' FROM quantum_v2.run"),[("source_not_ready",)])

    def test_ingestion_race_inside_reset_fails_closed(self):
        self.orphan_partial_seed()
        reset=store.reset_projection_step
        def ingestion_before_step(conn,**kwargs):
            with conn,conn.cursor() as cur:
                cur.execute("UPDATE quantum_v2.source_state SET ready=false")
            return reset(conn,**kwargs)
        with mock.patch.object(store,"reset_projection_step",side_effect=ingestion_before_step), \
             mock.patch.object(worker,"export_request") as export:
            self.assertEqual(worker.run_once(self.conn,self.config,bootstrap_only=True),0)
        export.assert_not_called()
        self.assertEqual(self.query("SELECT status FROM quantum_v2.projection"),[("needs_reseed",)])
        self.assertEqual(self.query("SELECT count(*) FROM quantum_v2.bootstrap_cursor WHERE source_table LIKE 'reset:%'"),[(0,)])
        self.assertEqual(self.query("SELECT metrics->>'deferred' FROM quantum_v2.run"),[("source_not_ready",)])

    def test_recovery_deadline_cancels_long_page_and_records_checkpoint(self):
        self.orphan_partial_seed()
        def slow_page(conn,**kwargs):
            with conn,conn.cursor() as cur:
                cur.execute('SELECT pg_sleep(5)')
            self.fail('Deadline failed to cancel a slow recovery page')
        with mock.patch.object(store,'reset_projection_step',side_effect=slow_page), \
             mock.patch.object(worker,'export_request') as export:
            self.assertEqual(worker.run_once(self.conn,dict(self.config,work_seconds=0.1),bootstrap_only=True),0)
        export.assert_not_called()
        self.assertEqual(self.query("SELECT status FROM quantum_v2.projection"),[("needs_reseed",)])
        metrics=self.query("SELECT metrics FROM quantum_v2.run")[0][0]
        self.assertTrue(metrics['recovery']['deadline_reached'])
        self.assertEqual(metrics['recovery']['reset_pages'],0)

    def test_sealed_export_receipt_survives_acknowledgement_crash_and_new_epoch(self):
        analyzed=control.analyzed
        attempts=0
        def fail_first_ack(*args,**kwargs):
            nonlocal attempts
            attempts+=1
            if attempts==1: raise RuntimeError('fixture crash after seal before DB acknowledgement')
            return analyzed(*args,**kwargs)
        with mock.patch.object(control,'analyzed',side_effect=fail_first_ack), \
             mock.patch.object(delivery,'deliver_website',return_value={'commit':'website-accepted'}), \
             mock.patch.object(delivery,'deliver_standalone',return_value={'commit':'standalone-accepted'}):
            self.assertEqual(worker.run_once(self.conn,self.config),1)
            request_id=self.query('SELECT id FROM quantum_v2.request')[0][0]
            output=Path(self.config['state_dir'])/'generations'/f'quantum-1000-{f"{1000:064x}"[:12]}-r{request_id}'
            marker=(output/'published_generation.json').read_bytes()
            self.assertEqual(self.query('SELECT count(*) FROM quantum_v2.delivery'),[(0,)])
            with self.conn,self.conn.cursor() as cur:
                cur.execute('UPDATE quantum_v2.source_state SET epoch=epoch+1')
            with mock.patch.object(worker.analysis,'export_snapshot',side_effect=AssertionError('Sealed export was regenerated')), \
                 mock.patch.object(worker.subprocess,'check_output',return_value='f'*40+'\n'):
                self.assertEqual(worker.run_once(self.conn,self.config),0,self.query('SELECT error FROM quantum_v2.run ORDER BY started_at'))
            self.assertEqual(marker,(output/'published_generation.json').read_bytes())
            self.assertEqual(self.query('SELECT status FROM quantum_v2.request'),[('complete',)])

    def test_changed_implementation_cannot_reuse_sealed_export(self):
        import quantum_runtime
        with mock.patch.object(control,'analyzed',side_effect=RuntimeError('fixture acknowledgement crash')):
            self.assertEqual(worker.run_once(self.conn,self.config),1)
        with mock.patch.object(quantum_runtime,'implementation_fingerprint',return_value='f'*64), \
             mock.patch.object(worker.analysis,'export_snapshot') as export, \
             mock.patch.object(delivery,'deliver_website') as website:
            self.assertEqual(worker.run_once(self.conn,self.config),1)
            export.assert_not_called(); website.assert_not_called()
        self.assertIn('implementation_sha256',self.query('SELECT error FROM quantum_v2.run ORDER BY started_at DESC LIMIT 1')[0][0])

    def test_implementation_change_during_export_prevents_sealing(self):
        import quantum_runtime
        fingerprint=quantum_runtime.implementation_fingerprint(ROOT)
        with mock.patch.object(quantum_runtime,'implementation_fingerprint',side_effect=[fingerprint,'f'*64]), \
             mock.patch.object(delivery,'finish_output') as seal:
            self.assertEqual(worker.run_once(self.conn,self.config),1)
            seal.assert_not_called()
        self.assertEqual(self.query('SELECT count(*) FROM quantum_v2.delivery'),[(0,)])


if __name__ == "__main__":
    unittest.main()
