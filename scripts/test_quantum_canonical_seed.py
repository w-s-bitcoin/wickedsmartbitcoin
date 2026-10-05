#!/usr/bin/env python3
"""Unpublished legacy-to-canonical transition; explicit disposable DB only."""
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'webapps/quantum_exposure/pipeline'))
try:
    import psycopg2
except ImportError:
    psycopg2=None
if psycopg2:
    import quantum_v2_store as store
    import quantum_v2_control as control
    import quantum_v2_validation as validation
    import run_quantum_worker as worker

DSN=os.environ.get('QUANTUM_CANONICAL_SEED_TEST_DSN')
KEY='11'*20
HEIGHT=40
HASH=f'{HEIGHT:064x}'


@unittest.skipUnless(DSN and psycopg2,'Set QUANTUM_CANONICAL_SEED_TEST_DSN to an explicit temporary *_fixture database')
class CanonicalTransitionTests(unittest.TestCase):
    def setUp(self):
        params=psycopg2.extensions.parse_dsn(DSN)
        if not params.get('dbname','').endswith('_fixture') or not params.get('host','').startswith(('/tmp/','/private/tmp/')):
            raise RuntimeError('Refusing fixture setup outside temporary socket + *_fixture database')
        self.conn=psycopg2.connect(DSN)
        with self.conn,self.conn.cursor() as cur:
            cur.execute('DROP SCHEMA IF EXISTS quantum_v2 CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public')
            cur.execute('CREATE TABLE blockheader(blockheight bigint PRIMARY KEY,blockhash text,time bigint)')
            cur.executemany('INSERT INTO blockheader VALUES(%s,%s,%s)',[(h,f'{h:064x}',1_600_000_000+h*600) for h in range(47)])
            cur.execute('''CREATE TABLE outputs(blockheight bigint,transactionid text,vout integer,amount bigint,address text,
                scripttype text,scripthex text,spendingblock bigint,PRIMARY KEY(blockheight,transactionid,vout))''')
            cur.execute('CREATE TABLE stxos_0_99_archive(LIKE outputs INCLUDING ALL)')
            cur.execute('INSERT INTO outputs VALUES(30,\'canonical-funding\',0,100000000,\'g\',\'pubkeyhash\',%s,NULL)',('76a914'+KEY+'88ac',))
            cur.execute('CREATE TABLE analysis_freeze(name text PRIMARY KEY,freeze_blockheight bigint)')
            cur.executemany('INSERT INTO analysis_freeze VALUES(%s,40)',[(name,) for name in
                store.LEGACY+('key_outputs_all','exposed_keyhash20','exposed_p2sh_address','exposed_p2wsh_address')])
            cur.execute('''CREATE TABLE key_outputs_all(keyhash20 bytea,blockheight bigint,transactionid text,vout integer,
                amount bigint,script_type text,spendingblock bigint,address text,PRIMARY KEY(blockheight,transactionid,vout))''')
            cur.execute('CREATE TABLE active_key_outputs(LIKE key_outputs_all INCLUDING ALL)')
            for name in store.LEGACY[1:]:
                cur.execute(f'''CREATE TABLE {name}(blockheight bigint,transactionid text,vout integer,amount bigint,
                    spendingblock bigint,address text,PRIMARY KEY(blockheight,transactionid,vout))''')
            for name in ('key_outputs_all','active_key_outputs'):
                cur.executemany(f'INSERT INTO {name} VALUES(%s,%s,%s,0,100000000,\'pubkeyhash\',%s,\'g\')',
                    [(bytes.fromhex(KEY),20,'orphan-created-and-spent',21),(bytes.fromhex(KEY),30,'canonical-funding',None)])
            cur.execute('CREATE TABLE exposed_keyhash20(keyhash20 bytea PRIMARY KEY,exposed_height bigint)')
            cur.execute('INSERT INTO exposed_keyhash20 VALUES(%s,21)',(bytes.fromhex(KEY),))
            for name in ('exposed_p2sh_address','exposed_p2wsh_address'):
                cur.execute(f'CREATE TABLE {name}(address text PRIMARY KEY,exposed_height bigint)')
        store.migrate(self.conn);control.migrate(self.conn);validation.migrate(self.conn);store.migrate_physical(self.conn)
        with self.conn,self.conn.cursor() as cur:
            cur.execute('UPDATE quantum_v2.source_state SET ready=true,committed_height=46,committed_hash=%s',(f'{46:064x}',))
        store.initialize_seed(self.conn,HEIGHT,HASH)
        store.bootstrap_step(self.conn,limit=10,source_table='active_key_outputs')

    def tearDown(self):
        self.conn.rollback()
        with self.conn,self.conn.cursor() as cur:
            cur.execute('DROP SCHEMA quantum_v2 CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public')
        self.conn.close()

    def query(self,statement,params=()):
        with self.conn,self.conn.cursor() as cur:
            cur.execute(statement,params)
            return cur.fetchall() if cur.description else None

    def transition(self):
        return store.transition_legacy_seed(self.conn,expected_height=HEIGHT,expected_hash=HASH)

    def finish(self):
        for _ in range(20):
            if store.bootstrap_step(self.conn,limit=1):return
        self.fail('Fixture bootstrap did not complete')

    def proof(self):
        validation.initialize(self.conn,HEIGHT,HASH)
        for _ in range(20):
            if validation.step(self.conn,limit=10):return validation.verify(self.conn)
        self.fail('Fixture validation did not complete')

    def test_stale_orphan_claim_passes_balance_proof_but_cannot_export(self):
        self.finish()
        self.assertTrue(self.proof()['passed'])
        self.assertEqual(self.query('''SELECT balance_sats,first_received_height,first_disclosure_height,last_spend_height,
            first_disclosure_hash FROM quantum_v2.group_state WHERE group_id=%s''',(KEY,)),
            [(100000000,20,21,21,f'{21:064x}')])
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(RuntimeError,'canonical-source initialization'):
                worker.export_request(self.conn,{'state_dir':directory},
                    {'id':1,'target_height':HEIGHT,'target_hash':HASH},stop_requested=lambda:False)
            self.assertEqual(list(Path(directory).iterdir()),[])

    def test_transition_rebuilds_dates_and_preserves_original_unverified_evidence(self):
        self.query('''INSERT INTO quantum_v2.orphan_disclosure
            (group_id,exposed_height,exposed_hash,projection_height,projection_hash,source)
            VALUES('prior-observation',1,%s,2,%s,'fixture')''',('a'*64,'b'*64))
        self.query("INSERT INTO quantum_v2.validation_result VALUES(40,%s,now(),true,'{\"scope\":\"discarded legacy balance proof\"}')",(HASH,))
        self.query("INSERT INTO quantum_v2.validation_result VALUES(39,%s,now(),true,'{\"scope\":\"older checkpoint\"}')",(f'{39:064x}',))
        self.query("INSERT INTO quantum_v2.validation_result VALUES(40,%s,now(),false,'{\"scope\":\"different branch\"}')",('f'*64,))
        audit=self.transition()
        self.assertEqual(audit['previous_seed_mode'],'legacy')
        self.assertEqual(sum(c['rows_processed'] for c in audit['previous_bootstrap_cursors']),2)
        self.assertEqual(self.query('SELECT seed_mode,status FROM quantum_v2.projection'),[('canonical','seeding')])
        self.assertEqual(self.query('SELECT source_table,rows_processed FROM quantum_v2.bootstrap_cursor'),[('canonical_blocks',0)])
        self.assertEqual(self.query('SELECT target_height,target_hash FROM quantum_v2.validation_result ORDER BY target_height,target_hash'),
                         [(39,f'{39:064x}'),(40,'f'*64)])
        discarded=audit['discarded_anchor_validation_reports']
        self.assertEqual(len(discarded),1)
        self.assertEqual((discarded[0]['target_height'],discarded[0]['target_hash'],discarded[0]['passed']),
                         (40,HASH,True))
        self.assertEqual(discarded[0]['report'],{'scope':'discarded legacy balance proof'})
        self.assertTrue(discarded[0]['verified_at'])
        self.assertEqual(self.query('SELECT count(*) FROM quantum_v2.bootstrap_heap_cursor'),[(0,)])
        self.assertEqual(self.query('SELECT count(*) FROM quantum_v2.bootstrap_display_origin'),[(0,)])
        self.finish()
        self.assertTrue(self.proof()['passed'])
        self.assertEqual(self.query('''SELECT balance_sats,first_received_height,first_disclosure_height,last_spend_height,
            first_disclosure_hash FROM quantum_v2.group_state WHERE group_id=%s''',(KEY,)),
            [(100000000,30,None,None,None)])
        self.assertEqual(self.query('SELECT exposed_height FROM exposed_keyhash20'),[(21,)])
        self.assertEqual(self.query('SELECT count(*) FROM key_outputs_all'),[(2,)])
        self.assertEqual(self.query('SELECT group_id FROM quantum_v2.orphan_disclosure'),[('prior-observation',)])
        self.assertEqual(self.query("SELECT status,metrics->>'mode' FROM quantum_v2.run WHERE id=%s",(audit['run_id'],)),
                         [('succeeded','legacy-to-canonical-transition')])
        self.assertEqual(self.query("SELECT metrics->'discarded_anchor_validation_reports' FROM quantum_v2.run WHERE id=%s",(audit['run_id'],)),
                         [(discarded,)])

    def test_legacy_reset_retains_actual_delta_evidence_without_promoting_imported_claim(self):
        self.finish()
        self.query("UPDATE outputs SET spendingblock=41 WHERE transactionid='canonical-funding'")
        store.apply_range(self.conn,42)
        self.assertEqual(self.query('SELECT first_disclosure_height FROM quantum_v2.group_state WHERE group_id=%s',(KEY,)),[(21,)])
        self.assertEqual(self.query('SELECT exposed_height FROM quantum_v2.disclosure WHERE group_id=%s',(KEY,)),[(41,)])
        self.query('''INSERT INTO quantum_v2.orphan_disclosure
            (group_id,exposed_height,exposed_hash,projection_height,projection_hash,source)
            VALUES('prior-observation',1,%s,2,%s,'fixture')''',('a'*64,'b'*64))
        self.query("UPDATE quantum_v2.projection SET status='needs_reseed'")
        for _ in range(10):
            if store.reset_projection_step(self.conn,confirm_anchor_hash=HASH,limit=1):break
        else:self.fail('Bounded diagnostic reset did not finish')
        self.assertEqual(self.query('SELECT group_id,exposed_height FROM quantum_v2.orphan_disclosure ORDER BY group_id'),
                         [(KEY,41),('prior-observation',1)])
        self.assertEqual(self.query('SELECT exposed_height FROM exposed_keyhash20'),[(21,)])

    def test_legacy_rollback_does_not_promote_imported_claim(self):
        self.finish()
        self.query("UPDATE outputs SET spendingblock=41 WHERE transactionid='canonical-funding'")
        store.apply_range(self.conn,42)
        self.assertTrue(store.rollback_step(self.conn,40)['done'])
        self.assertEqual(self.query('SELECT group_id,exposed_height FROM quantum_v2.orphan_disclosure'),[(KEY,41)])

    def test_published_generated_or_incremental_states_are_refused(self):
        request="INSERT INTO quantum_v2.request(target_height,target_hash,methodology_version) VALUES(40,'"+HASH+"','fixture')"
        cases=("INSERT INTO quantum_v2.request(target_height,target_hash,methodology_version,status) VALUES(40,'"+HASH+"','fixture','analyzed')",
               "INSERT INTO quantum_v2.request(target_height,target_hash,methodology_version,generation_id) VALUES(40,'"+HASH+"','fixture','sealed')",
               request+"; INSERT INTO quantum_v2.accepted_generation SELECT 'website',id,target_height,target_hash,'sealed','commit',now() FROM quantum_v2.request",
               request+"; INSERT INTO quantum_v2.delivery(request_id,destination) SELECT id,'website' FROM quantum_v2.request",
               "INSERT INTO quantum_v2.projection_batch(from_height,from_hash,to_height,to_hash) VALUES(39,'a',40,'b')")
        for statement in cases:
            with self.subTest(statement=statement):
                self.query(statement)
                with self.assertRaisesRegex(store.StoreError,'refuses accepted/generated/delivered'):
                    self.transition()
                self.assertEqual(self.query('SELECT seed_mode FROM quantum_v2.projection'),[('legacy',)])
                self.assertEqual(self.query('SELECT count(*) FROM quantum_v2.group_state'),[(1,)])
                self.query('DELETE FROM quantum_v2.accepted_generation; DELETE FROM quantum_v2.delivery; DELETE FROM quantum_v2.request; DELETE FROM quantum_v2.projection_batch')

    def test_canonical_seed_cannot_export_a_stale_methodology_request(self):
        self.transition();self.finish()
        with self.assertRaisesRegex(RuntimeError,'Request methodology differs'):
            worker.export_request(self.conn,{},
                {'id':1,'target_height':HEIGHT,'target_hash':HASH,'methodology_version':'legacy-stale'},
                stop_requested=lambda:False)

    def test_wrong_frontier_or_unready_source_is_refused(self):
        with self.assertRaisesRegex(store.StoreError,'exact expected'):
            store.transition_legacy_seed(self.conn,expected_height=HEIGHT,expected_hash='a'*64)
        self.query('UPDATE quantum_v2.source_state SET ready=false')
        with self.assertRaises(store.SourceNotReady):self.transition()
        self.query('UPDATE quantum_v2.source_state SET ready=true')
        self.finish()
        with self.assertRaisesRegex(store.StoreError,'unfinished legacy'):
            self.transition()

    def test_writer_lock_and_audit_failure_leave_import_unchanged(self):
        other=psycopg2.connect(DSN)
        try:
            with other,other.cursor() as cur:cur.execute('SELECT pg_advisory_lock(811947,2)')
            with self.assertRaisesRegex(store.StoreError,'global writer lock'):self.transition()
        finally:other.close()
        self.query("INSERT INTO quantum_v2.validation_result VALUES(40,%s,now(),true,'{\"preserve_on_failure\":true}')",(HASH,))
        self.query("""CREATE FUNCTION reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'fixture audit failure'; END; $$;
            CREATE TRIGGER reject_audit BEFORE INSERT ON quantum_v2.run FOR EACH ROW EXECUTE FUNCTION reject_audit()""")
        with self.assertRaisesRegex(psycopg2.Error,'fixture audit failure'):self.transition()
        self.assertEqual(self.query('SELECT seed_mode FROM quantum_v2.projection'),[('legacy',)])
        self.assertEqual(self.query('SELECT count(*) FROM quantum_v2.group_state'),[(1,)])
        self.assertEqual(self.query('SELECT sum(rows_processed) FROM quantum_v2.bootstrap_cursor'),[(2,)])
        self.assertEqual(self.query('SELECT report FROM quantum_v2.validation_result WHERE target_height=40 AND target_hash=%s',(HASH,)),
                         [({'preserve_on_failure':True},)])


@unittest.skipUnless(psycopg2,'psycopg2 required to import worker CLI')
class CanonicalCliTests(unittest.TestCase):
    def test_initialize_defaults_canonical_and_legacy_is_explicit_diagnostic(self):
        with tempfile.TemporaryDirectory() as directory:
            config=Path(directory)/'config.json';config.write_text('{}')
            for flag,canonical in (([],True),(['--canonical'],True),(['--legacy-unverified'],False)):
                argv=['worker','--config',str(config),'initialize','--height','40','--hash',HASH,'--start-after','0',*flag]
                with mock.patch.object(sys,'argv',argv),mock.patch.object(worker,'connect') as connect, \
                     mock.patch.object(control,'take_writer_lock',return_value=True),mock.patch.object(control,'configure'), \
                     mock.patch.object(worker,'log'),mock.patch.object(store,'initialize_seed') as legacy, \
                     mock.patch.object(store,'initialize_source_seed') as source:
                    self.assertEqual(worker.main(),0)
                    (source if canonical else legacy).assert_called_once_with(connect.return_value,40,HASH)
                    (legacy if canonical else source).assert_not_called()


if __name__=='__main__':unittest.main()
