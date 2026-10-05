#!/usr/bin/env python3
"""Exact script hydration fixtures; never uses an implicit/default database."""
import hashlib
import os
from pathlib import Path
import sys
import unittest
from unittest import mock

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'webapps/quantum_exposure/pipeline'))
try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
    import quantum_v2_store as store
except ImportError:
    psycopg2=None
DSN=os.environ.get('QUANTUM_ANALYSIS_TEST_DSN','')
G='0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
POLICY='5121'+G+'51ae'

@unittest.skipUnless(DSN and psycopg2,'Set QUANTUM_ANALYSIS_TEST_DSN for a disposable PostgreSQL fixture')
class ScriptHydrationTests(unittest.TestCase):
    def setUp(self):
        config=psycopg2.extensions.parse_dsn(DSN)
        if not config.get('dbname','').endswith('_fixture') or not config.get('host','').startswith(('/tmp/','/private/tmp/')):
            raise RuntimeError('Refusing destructive setup outside a temporary fixture database')
        self.conn=psycopg2.connect(DSN);self.addCleanup(self.conn.close)
        with self.conn,self.conn.cursor() as cur:
            cur.execute('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
            cur.execute('''CREATE TABLE outputs(blockheight bigint,transactionid text,vout integer,
                address text,scripttype text,scripthex text,spendingblock bigint,
                PRIMARY KEY(blockheight,transactionid,vout))''')
            cur.execute('CREATE TABLE stxos_0_9999_archive (LIKE outputs)')
            cur.execute('CREATE INDEX archive_creation ON stxos_0_9999_archive(blockheight)')
            cur.execute("CREATE INDEX archive_address ON stxos_0_9999_archive(address) WHERE address IS NOT NULL AND (scripttype NOT IN ('pubkey','pubkeyhash','witness_v0_keyhash') OR scripttype IS NULL)")
            cur.execute("CREATE INDEX archive_pubkey ON stxos_0_9999_archive(blockheight) INCLUDE(transactionid,vout,scripthex) WHERE scripttype='pubkey'")
            cur.executemany('INSERT INTO stxos_0_9999_archive VALUES(%s,%s,%s,%s,%s,%s,%s)',[
                (50,'requested',0,'same-address','Multisig 1 of 1',POLICY,60),
                (50,'another-tx',0,'same-address','Multisig 1 of 1','5252ae',60),
                (50,'requested',1,'same-address','Multisig 1 of 1','5151ae',60),
                (51,'requested',0,'same-address','Multisig 1 of 1','5353ae',60),
                (50,'null-address',0,None,'Multisig 1 of 1',POLICY,60),
                (50,'pubkey',0,'public-key','pubkey','21'+G+'ac',60)])

    def row(self,tx='requested',address='same-address',kind='Multisig legacy'):
        row=dict(blockheight=50,transactionid=tx,vout=0,address=address,spendingblock=60,scripttype=kind)
        if kind=='pubkey':row['keyhash20']=hashlib.new('ripemd160',hashlib.sha256(bytes.fromhex(G)).digest()).digest()
        return row

    def prepare(self,rows):
        with self.conn,self.conn.cursor(cursor_factory=RealDictCursor) as cur:
            store._prepare_legacy_scripts(cur,rows,100)

    def test_address_route_keeps_complete_output_identity(self):
        rows=[self.row()]
        with mock.patch.object(store,'_legacy_script_lookup',wraps=store._legacy_script_lookup) as lookup:
            self.prepare(rows)
        self.assertEqual(rows[0]['scripthex'],POLICY)
        self.assertEqual(lookup.call_args.kwargs['mode'],'address')

    def test_address_duplicates_fail_and_mismatched_address_is_not_substituted(self):
        with self.conn,self.conn.cursor() as cur:
            cur.execute("INSERT INTO stxos_0_9999_archive SELECT * FROM stxos_0_9999_archive WHERE transactionid='requested' AND vout=0 AND blockheight=50")
        with self.assertRaisesRegex(store.StoreError,'Conflicting duplicate'):
            self.prepare([self.row()])
        with self.assertRaisesRegex(store.StoreError,'Missing canonical source'):
            self.prepare([self.row(address='wrong-address')])

    def test_null_address_falls_back_and_pubkey_uses_known_partial_family(self):
        rows=[self.row('null-address',None),self.row('pubkey','public-key','pubkey')]
        with mock.patch.object(store,'_legacy_script_lookup',wraps=store._legacy_script_lookup) as lookup:
            self.prepare(rows)
        self.assertEqual([r['scripthex'] for r in rows],[POLICY,'21'+G+'ac'])
        self.assertEqual({call.kwargs['mode'] for call in lookup.call_args_list},{'block','pubkey'})

    def test_unknown_partial_address_index_is_not_assumed_usable(self):
        with self.conn,self.conn.cursor() as cur:
            cur.execute('DROP INDEX archive_address')
            cur.execute("CREATE INDEX archive_wrong_partial ON stxos_0_9999_archive(address) WHERE blockheight>100")
        rows=[self.row()]
        with mock.patch.object(store,'_legacy_script_lookup',wraps=store._legacy_script_lookup) as lookup:
            self.prepare(rows)
        self.assertEqual(lookup.call_args.kwargs['mode'],'block')
        self.assertEqual(rows[0]['scripthex'],POLICY)

    def test_point_probe_remains_preferred_and_both_routes_return_same_rows(self):
        with self.conn,self.conn.cursor(cursor_factory=RealDictCursor) as cur:
            plain=store._legacy_script_lookup(cur,'stxos_0_9999_archive',[(0,50,'requested',0)],mode='block')
            addressed=store._legacy_script_lookup(cur,'stxos_0_9999_archive',[(0,50,'requested',0,'same-address')],mode='address')
            self.assertEqual(plain,addressed)
            cur.execute('CREATE INDEX archive_point ON stxos_0_9999_archive(transactionid,vout)')
        with mock.patch.object(store,'_legacy_script_lookup',wraps=store._legacy_script_lookup) as lookup:
            self.prepare([self.row()])
        self.assertEqual(lookup.call_args.kwargs['mode'],'point')

if __name__=='__main__':unittest.main()
