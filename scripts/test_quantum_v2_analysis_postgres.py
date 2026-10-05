#!/usr/bin/env python3
"""Real SQL fixtures in an explicitly named disposable PostgreSQL database.

Usage: QUANTUM_ANALYSIS_TEST_DSN='host=... port=... dbname=quantum_analysis_fixture ...'
python scripts/test_quantum_v2_analysis_postgres.py
Never points at production; the connected database name must end in _fixture.
"""
import csv
import os
from pathlib import Path
import sys
import tempfile
import unittest

PIPELINE = Path(__file__).resolve().parents[1] / 'webapps/quantum_exposure/pipeline'
sys.path.insert(0, str(PIPELINE))
DSN = os.environ.get('QUANTUM_ANALYSIS_TEST_DSN')


@unittest.skipUnless(DSN, 'explicit disposable QUANTUM_ANALYSIS_TEST_DSN required')
class LegacyCanonicalSQLTests(unittest.TestCase):
    def setUp(self):
        import psycopg2
        import run_dashboard_analysis as current
        import run_historical_dashboard_analysis as historical
        self.current, self.historical = current, historical
        self.conn = psycopg2.connect(DSN)
        with self.conn.cursor() as cur:
            cur.execute('SELECT current_database()')
            if not cur.fetchone()[0].endswith('_fixture'):
                self.conn.close()
                raise RuntimeError('Only a disposable database ending _fixture is permitted')
            # Everything is rolled back at teardown, including fixture tables.
            cur.execute('''
                CREATE TABLE blockheader(blockheight bigint PRIMARY KEY,time bigint);
                CREATE TABLE outputs(blockheight bigint,transactionid text,vout integer,address text,
                    amount bigint,scripttype text,scripthex text,isspent boolean,spendingblock bigint);
                CREATE TABLE stxos_0_100000_archive(LIKE outputs INCLUDING ALL);
                CREATE TABLE active_key_outputs(blockheight bigint,transactionid text,vout integer,address text,
                    amount bigint,script_type text,keyhash20 bytea,spendingblock bigint,is_exposed boolean,isspent boolean);
                CREATE TABLE key_outputs_all(LIKE active_key_outputs INCLUDING ALL);
                CREATE TABLE exposed_keyhash20(keyhash20 bytea PRIMARY KEY,exposed_height bigint);
                CREATE TABLE active_p2sh_outputs(blockheight bigint,transactionid text,vout integer,address text,
                    amount bigint,spendingblock bigint,is_exposed boolean);
                CREATE TABLE active_p2wsh_outputs(LIKE active_p2sh_outputs INCLUDING ALL);
                CREATE TABLE active_p2tr_outputs(LIKE active_p2sh_outputs INCLUDING ALL);
                CREATE TABLE active_bare_ms_outputs(LIKE active_p2sh_outputs INCLUDING ALL);
                CREATE TABLE exposed_p2sh_address(address text PRIMARY KEY,exposed_height bigint);
                CREATE TABLE exposed_p2wsh_address(address text PRIMARY KEY,exposed_height bigint);
                CREATE TABLE dashboard_p2pk_pubkey_cache(keyhash20 bytea PRIMARY KEY,pubkey_hex text);
                INSERT INTO blockheader VALUES(100,1500000000),(200,1510000000),(300,1520000000),
                    (900,1790700000),(1000,1790812800);
                INSERT INTO exposed_keyhash20 VALUES(decode(repeat('01',20),'hex'),100),(decode(repeat('02',20),'hex'),300);
                INSERT INTO active_key_outputs VALUES
                    (100,'tx1',0,'a',60000000,'pubkey',decode(repeat('01',20),'hex'),NULL,true,false),
                    (200,'tx2',0,'a',60000000,'pubkeyhash',decode(repeat('01',20),'hex'),NULL,true,false),
                    (200,'tx3',0,'a',100000,'witness_v0_keyhash',decode(repeat('01',20),'hex'),900,true,true),
                    (100,'tx4',0,'b',120000000,'pubkeyhash',decode(repeat('02',20),'hex'),NULL,true,false);
                INSERT INTO key_outputs_all SELECT * FROM active_key_outputs;
                INSERT INTO outputs VALUES(200,'spent-live',0,'script-address',700000000,'scripthash','a91400',true,900),
                    (300,'live',0,'script-address',120000000,'scripthash','a91400',false,NULL);
                INSERT INTO active_p2sh_outputs VALUES(200,'spent-live',0,'script-address',700000000,900,true),
                    (300,'live',0,'script-address',120000000,NULL,true);
                INSERT INTO exposed_p2sh_address VALUES('script-address',900);
            ''')
        self.current.SCHEMA = self.historical.SCHEMA = 'public'

    def tearDown(self):
        self.conn.rollback()
        self.conn.close()

    def build(self, historical=False):
        rda = self.current
        with self.conn.cursor() as cur:
            rda.ensure_dashboard_tables(cur)
            if historical:
                self.historical.build_dashboard_base_historical(cur, 1000, 800, [('stxos_0_100000_archive',0,100000)])
            else:
                rda.build_dashboard_base(cur, 1000, 800, 'stxos_0_100000_archive')
            rda.canonicalize_dashboard_base(cur, 1790812800)
            rda.refresh_ge1_dashboard_table(cur,1000,1790812800,800,1759276800)
            rda.refresh_aggregates(cur,1000,1790812800,800,1759276800)
            cur.execute("SELECT exposed_supply_sats,exposed_utxo_count,exposed_pubkey_count FROM tmp_dashboard_pubkeys_aggregates WHERE balance_filter='ge1' AND script_type_filter='All' AND spend_activity_filter='all'")
            aggregate = cur.fetchone()
            cur.execute('SELECT SUM(exposed_supply_sats),SUM(exposed_utxo_count),COUNT(*) FROM tmp_dashboard_pubkeys_ge_1btc')
            self.assertEqual(aggregate, cur.fetchone())
            cur.execute("SELECT spend_activity,last_spend_blockheight,exposed_utxo_count_by_script_type FROM tmp_dashboard_pubkeys_ge_1btc WHERE group_id=%s",('01'*20,))
            activity, last_spend, per_script = cur.fetchone()
            self.assertEqual((activity,last_spend), ('active',900))
            self.assertIn('P2PK', per_script)
            cur.execute("SELECT first_received_blockheight,first_exposed_blockheight FROM tmp_dashboard_pubkeys_ge_1btc WHERE group_id=%s",('02'*20,))
            self.assertEqual(cur.fetchone(), (100,300))
            cur.execute("SELECT exposed_supply_sats FROM tmp_dashboard_pubkeys_ge_1btc WHERE group_id='script-address'")
            self.assertEqual(cur.fetchone()[0],120000000)
            with tempfile.TemporaryDirectory() as temp:
                _, path = rda.export_ge1_csv(cur,1000,Path(temp))
                with path.open() as stream:
                    rows=list(csv.DictReader(stream))
                self.assertEqual(len(rows),3)
                self.assertTrue(all(row['current_supply_sats'] for row in rows))

    def test_duplicate_coinbase_removal_is_not_a_spend(self):
        transaction='e3bf3d07d4b0375638d5f1db5255fe07ba2c4cb067cd81b84ee974b6585fb468'
        with self.conn.cursor() as cur:
            cur.execute("INSERT INTO blockheader VALUES(91722,1500000000),(91880,1505000000),(100000,1790812800)")
            cur.execute("INSERT INTO exposed_keyhash20 VALUES(decode(repeat('03',20),'hex'),91722)")
            for height in (91722,91880):
                cur.execute("INSERT INTO active_key_outputs VALUES(%s,%s,0,'duplicate',5000000000,'pubkey',decode(repeat('03',20),'hex'),NULL,true,false)",(height,transaction))
            cur.execute("INSERT INTO key_outputs_all SELECT * FROM active_key_outputs WHERE keyhash20=decode(repeat('03',20),'hex')")
            self.current.ensure_dashboard_tables(cur)
            for historical in (False,True):
                if historical:
                    self.historical.build_dashboard_base_historical(cur,100000,800,[('stxos_0_100000_archive',0,100000)])
                else:
                    self.current.build_dashboard_base(cur,100000,800,'stxos_0_100000_archive')
                self.current.canonicalize_dashboard_base(cur,1790812800)
                self.current.refresh_ge1_dashboard_table(cur,100000,1790812800,800,1759276800)
                cur.execute("SELECT current_supply_sats,exposed_supply_sats,last_spend_blockheight,first_received_blockheight FROM tmp_dashboard_pubkeys_ge_1btc WHERE group_id=%s",('03'*20,))
                self.assertEqual(cur.fetchone(),(5000000000,5000000000,None,91722))

    def test_normalized_legacy_import_recovers_distinct_groups(self):
        with self.conn.cursor() as cur, tempfile.TemporaryDirectory() as tmp:
            self.current.ensure_dashboard_tables(cur)
            path=Path(tmp)/'legacy.csv'
            with path.open('w',newline='') as stream:
                writer=csv.DictWriter(stream,fieldnames=['display_group_ids','exposed_supply_sats_by_script_type','spend_activity','exposed_utxo_count','first_exposed_blockheight','last_spend_blockheight','details','identity','first_exposed_unix_time','last_spend_unix_time'])
                writer.writeheader()
                writer.writerow(dict(display_group_ids='0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',exposed_supply_sats_by_script_type='{"P2PK":120000000}',spend_activity='never_spent',exposed_utxo_count=2,first_exposed_blockheight=100,first_exposed_unix_time=1500000000))
                writer.writerow(dict(display_group_ids='script-address',exposed_supply_sats_by_script_type='{"P2SH":150000000}',spend_activity='active',exposed_utxo_count=3,last_spend_blockheight=900,last_spend_unix_time=1790700000))
            self.assertEqual(self.current.load_ge1_csv_into_temp_table(cur,path),2)
            cur.execute('SELECT group_id,exposed_supply_sats,current_supply_sats FROM tmp_dashboard_pubkeys_ge_1btc ORDER BY group_id')
            self.assertEqual(cur.fetchall(),[('751e76e8199196d454941c45d1b3a323f1433bd6',120000000,None),('script-address',150000000,None)])

    def test_current_sql(self):
        self.build()

    def test_historical_sql(self):
        self.build(historical=True)

    def test_historical_inactive_spend_is_exact_archive_event(self):
        with self.conn.cursor() as cur:
            cur.execute("DELETE FROM active_p2sh_outputs")
            cur.execute("DELETE FROM outputs WHERE isspent=true")
            cur.execute("UPDATE exposed_p2sh_address SET exposed_height=200")
            cur.execute("""INSERT INTO stxos_0_100000_archive VALUES
                (100,'old-policy-spend',0,'script-address',50000000,'scripthash','a91400',true,200)""")
            self.current.ensure_dashboard_tables(cur)
            self.historical.build_dashboard_base_historical(cur,1000,800,[('stxos_0_100000_archive',0,100000)])
            self.current.canonicalize_dashboard_base(cur,1790812800)
            self.current.refresh_ge1_dashboard_table(cur,1000,1790812800,800,1759276800)
            cur.execute("SELECT last_spend_blockheight,last_spend_time,spend_activity FROM tmp_dashboard_pubkeys_ge_1btc WHERE group_id='script-address'")
            self.assertEqual(cur.fetchone(),(200,1510000000,'inactive'))


if __name__ == '__main__':
    unittest.main()
