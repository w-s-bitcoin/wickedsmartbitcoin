#!/usr/bin/env python3
"""Opt-in disposable PostgreSQL tests for bounded addressless-policy hydration."""
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'webapps/quantum_exposure/pipeline'))
sys.path.insert(0,str(ROOT/'scripts'))
try:
    import psycopg2
except ImportError:
    psycopg2=None
if psycopg2:
    from psycopg2 import sql
    from psycopg2.extras import RealDictCursor
    import quantum_v2_store as store
    import ensure_quantum_source_indexes as provision

DSN=os.environ.get('QUANTUM_NULL_SCRIPT_TEST_DSN')
TABLES=('outputs','stxos_0_9_archive','stxos_10_99_archive')
PUBKEY='0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
SCRIPT='5121'+PUBKEY+'51ae'
OTHER='5121'+'02'+('11'*32)+'51ae'
GROUP='script:'+hashlib.sha256(bytes.fromhex(SCRIPT)).hexdigest()


@unittest.skipUnless(psycopg2,'psycopg2 required for source index helpers')
class IndexScopeTests(unittest.TestCase):
    def test_provisioning_requires_one_explicit_supported_source(self):
        for table,kind in [('outputs','creation'),('outputs','nonkey_address'),
                           ('stxos_*_archive','null_bare_script'),('blockheader','null_bare_script'),
                           ('outputs; DROP TABLE outputs','null_bare_script'),('outputs','unknown')]:
            with self.subTest(table=table,kind=kind),self.assertRaises(ValueError):
                provision.index_spec(table,kind)
        self.assertEqual(provision.index_spec('outputs','null_bare_script')[0],
                         'qe2_outputs_null_bare_script')

    def test_literal_whitespace_is_not_discarded(self):
        self.assertNotEqual(store._normalized_predicate("scripttype ~~ 'Multisig  %'::text"),
                            store._normalized_predicate("scripttype ~~ 'Multisig %'::text"))


@unittest.skipUnless(DSN and psycopg2,'explicit disposable QUANTUM_NULL_SCRIPT_TEST_DSN and psycopg2 required')
class NullScriptDatabaseTests(unittest.TestCase):
    def setUp(self):
        params=psycopg2.extensions.parse_dsn(DSN)
        if not params.get('dbname','').endswith('_fixture') or not params.get('host','').startswith('/private/tmp/'):
            raise RuntimeError('Use only a named _fixture database on the private temporary socket')
        self.conn=psycopg2.connect(DSN)
        with self.conn,self.conn.cursor() as cur:
            cur.execute('SELECT current_database()')
            self.assertTrue(cur.fetchone()[0].endswith('_fixture'))
            for table in TABLES:
                cur.execute(sql.SQL('CREATE TABLE public.{} (blockheight bigint, spendingblock bigint, address text, scripttype text, scripthex text)').format(sql.Identifier(table)))
        self.statements=[]

    def tearDown(self):
        self.conn.rollback()
        with self.conn,self.conn.cursor() as cur:
            for table in TABLES:
                cur.execute(sql.SQL('DROP TABLE public.{}').format(sql.Identifier(table)))
        self.conn.close()

    def index(self,table,predicate=None,expression='md5(lower(scripthex))',name=None):
        name=name or 'fixture_'+table
        with self.conn,self.conn.cursor() as cur:
            cur.execute(sql.SQL('CREATE INDEX {} ON public.{} ('+expression+')'+
                                (' WHERE '+predicate if predicate else '')).format(sql.Identifier(name),sql.Identifier(table)))

    def all_indexes(self):
        for table in TABLES:
            _,statement=provision.index_spec(table,'null_bare_script')
            with self.conn,self.conn.cursor() as cur:
                cur.execute(statement.as_string(self.conn).replace('INDEX CONCURRENTLY','INDEX'))

    def hydrate(self,address=None):
        statements=self.statements
        class RecordingCursor(RealDictCursor):
            def execute(cur,statement,params=None):
                statements.append(statement.as_string(cur.connection) if hasattr(statement,'as_string') else statement)
                return super().execute(statement,params)
        with self.conn,self.conn.cursor(cursor_factory=RecordingCursor) as cur:
            return store._hydrate_metadata_batch(cur,{GROUP:('Other',{'scripthex':SCRIPT.upper(),'address':address})},50)

    def insert(self,table,height,spent,script=SCRIPT,address=None,kind='Multisig 1 of 1'):
        with self.conn,self.conn.cursor() as cur:
            cur.execute(sql.SQL('INSERT INTO public.{} VALUES (%s,%s,%s,%s,%s)').format(sql.Identifier(table)),
                        (height,spent,address,kind,script))

    def test_missing_index_checks_every_source_before_history_read(self):
        self.index('outputs',"(address IS NULL OR address='') AND scripttype LIKE 'Multisig %'")
        self.index('stxos_0_9_archive',"(address IS NULL OR address='') AND scripttype LIKE 'Multisig %'")
        with self.assertRaisesRegex(store.StoreError,'stxos_10_99_archive.*ensure_quantum_source_indexes'):
            self.hydrate()
        self.assertEqual(len(self.statements),2,self.statements)
        self.assertTrue(all('pg_catalog.' in query for query in self.statements))
        self.assertFalse(any('MIN(blockheight)' in query for query in self.statements))

    def test_catalog_accepts_supported_broader_predicates_but_not_narrower_ones(self):
        self.index('outputs')
        self.index('stxos_0_9_archive',"address IS NULL OR address=''")
        self.index('stxos_10_99_archive',"scripttype LIKE 'Multisig %'")
        with self.conn,self.conn.cursor(cursor_factory=RealDictCursor) as cur:
            self.assertEqual(set(store._null_script_lookup_indexes(cur,list(TABLES))),set(TABLES))
        with self.conn,self.conn.cursor() as cur:
            cur.execute('DROP INDEX fixture_outputs')
        self.index('outputs',"(address IS NULL OR address='') AND scripttype LIKE 'Multisig  %'")
        with self.assertRaisesRegex(store.StoreError,'on: outputs'):
            self.hydrate()

    def test_wrong_expression_or_p2pk_predicate_does_not_authorize_scan(self):
        self.index('outputs',expression='scripthex')
        self.index('stxos_0_9_archive',"scripttype='pubkey'")
        self.index('stxos_10_99_archive',"address IS NULL",expression='md5(scripthex)')
        with self.assertRaisesRegex(store.StoreError,'on: outputs, stxos_0_9_archive, stxos_10_99_archive'):
            self.hydrate()
        self.assertEqual(len(self.statements),2)

    def test_null_only_index_does_not_cover_empty_address_identity(self):
        self.index('outputs',"address IS NULL AND scripttype LIKE 'Multisig %'")
        self.index('stxos_0_9_archive')
        self.index('stxos_10_99_archive')
        with self.assertRaisesRegex(store.StoreError,'on: outputs'):
            self.hydrate()
        self.assertEqual(len(self.statements),2)

    def test_normalized_exact_history_and_hash_collision_candidate(self):
        self.all_indexes()
        self.insert('outputs',30,None,SCRIPT.upper())
        self.insert('stxos_0_9_archive',7,9,address='')
        self.insert('stxos_10_99_archive',10,45,SCRIPT.upper())
        self.insert('stxos_10_99_archive',11,70)
        self.insert('outputs',60,None)
        self.insert('stxos_0_9_archive',1,8,OTHER)
        self.insert('stxos_10_99_archive',2,49,OTHER)
        self.insert('outputs',3,None,address='separate-address')
        # Force an unrelated candidate through the hash prefilter. The exact
        # normalized comparison must still reject it, as for a real collision.
        hashes=store._null_script_hashes([SCRIPT,OTHER])
        with mock.patch.object(store,'_null_script_hashes',return_value=hashes):
            result=self.hydrate(address='')
        self.assertEqual(set(result),{(GROUP,'Other')})
        state=result[(GROUP,'Other')]
        self.assertEqual(state['first_received_height'],7)
        self.assertEqual(state['first_disclosure_height'],7)
        self.assertEqual(state['last_spend_height'],45)
        queries=[query for query in self.statements if 'MIN(blockheight)' in query]
        self.assertEqual(len(queries),3)
        self.assertTrue(all('lower(scripthex)=ANY(%s)' in query and
                            'md5(lower(scripthex))=ANY(%s)' in query for query in queries))

    def test_dry_run_renders_one_table_without_creating_index(self):
        with tempfile.TemporaryDirectory() as directory:
            evidence=Path(directory)/'evidence.json'
            argv=['ensure_quantum_source_indexes.py','--dsn',DSN,'--table','outputs',
                  '--kind','null_bare_script','--output',str(evidence)]
            with mock.patch.object(sys,'argv',argv),contextlib.redirect_stdout(io.StringIO()):
                provision.main()
            plan=json.loads(evidence.read_text())
        self.assertFalse(plan['applied'])
        self.assertIn('CREATE INDEX CONCURRENTLY "qe2_outputs_null_bare_script" ON public."outputs"',plan['ddl'])
        with self.conn,self.conn.cursor() as cur:
            cur.execute("SELECT to_regclass('public.qe2_outputs_null_bare_script')")
            self.assertIsNone(cur.fetchone()[0])


if __name__=='__main__':unittest.main()
