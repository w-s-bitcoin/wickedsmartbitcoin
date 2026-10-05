#!/usr/bin/env python3
"""Live-group export fixtures; only an explicit temporary *_fixture DB is used."""
import hashlib
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
    from psycopg2.extras import RealDictCursor
    import quantum_v2_store as store
    import quantum_v2_analysis as analysis
except ImportError:
    psycopg2=None

DSN=os.getenv('QUANTUM_LIVE_EXPORT_TEST_DSN','')


@unittest.skipUnless(DSN and psycopg2,'Set QUANTUM_LIVE_EXPORT_TEST_DSN for a disposable PostgreSQL fixture')
class LiveExportTests(unittest.TestCase):
    def setUp(self):
        cfg=psycopg2.extensions.parse_dsn(DSN)
        if not cfg.get('dbname','').endswith('_fixture') or not cfg.get('host','').startswith(('/tmp/','/private/tmp/')):
            raise RuntimeError('Refusing fixture writes outside explicit temporary *_fixture database')
        self.conn=psycopg2.connect(DSN)
        self.addCleanup(self.conn.close)
        with self.conn,self.conn.cursor() as cur:
            cur.execute('DROP SCHEMA IF EXISTS quantum_v2 CASCADE')
            cur.execute('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
            cur.execute('CREATE TABLE blockheader(blockheight bigint PRIMARY KEY,blockhash text,time bigint)')
            cur.execute("INSERT INTO blockheader SELECT n,lpad(to_hex(n),64,'0'),1231006505+n*600 FROM generate_series(0,20) n")
        store.migrate(self.conn)
        store.migrate_live_export(self.conn)
        with self.conn,self.conn.cursor() as cur:
            cur.executemany('''INSERT INTO quantum_v2.group_state
                (group_id,script_type,balance_sats,utxo_count,eligible_sats,eligible_utxos,
                 first_received_height,first_disclosure_height,last_spend_height,display_group_id,details,identity)
                VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''',[
                ('a','P2PKH',200000000,1,200000000,1,4,5,None,'active-a','',''),
                ('a','P2PK',0,0,0,0,1,2,15,'retired-a','retained annotation','historical identity'),
                ('b','P2WPKH',0,3,0,3,3,4,None,'zero-value','',''),
                ('c','P2SH',300000000,1,0,0,5,None,6,'undisclosed','',''),
                ('d','P2TR',0,0,0,0,1,1,20,'fully-retired','',''),
                *[('e',family,100000000,1,100000000,1,2,3,10,family,'','') for family in analysis.SCRIPT_TYPES]])

    def rows(self,size=2):
        self.conn.set_session(isolation_level='REPEATABLE READ')
        with self.conn:
            return list(store.iter_group_rows(self.conn,fetch_size=size))

    def old_rows(self):
        with self.conn,self.conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute('''SELECT s.group_id,s.script_type,s.balance_sats AS current_supply_sats,
                s.utxo_count AS current_utxo_count,
                CASE WHEN s.first_disclosure_height IS NOT NULL THEN s.eligible_sats ELSE 0 END AS exposed_supply_sats,
                CASE WHEN s.first_disclosure_height IS NOT NULL THEN s.eligible_utxos ELSE 0 END AS exposed_utxo_count,
                s.first_received_height AS first_received_blockheight,
                s.first_disclosure_height AS first_exposed_blockheight,be.time AS first_exposed_time,
                s.last_spend_height AS last_spend_blockheight,bs.time AS last_spend_time,
                s.display_group_id,s.details,s.identity FROM quantum_v2.group_state s
                LEFT JOIN public.blockheader be ON be.blockheight=s.first_disclosure_height
                LEFT JOIN public.blockheader bs ON bs.blockheight=s.last_spend_height
                ORDER BY s.group_id,s.script_type''')
            return [dict(row) for row in cur.fetchall()]

    def test_live_groups_keep_retired_family_history_and_zero_value_outputs(self):
        old=self.old_rows()
        new=self.rows(1)
        self.assertEqual(new,[row for row in old if row['group_id']!='d'])
        self.assertEqual(new,self.rows(2))
        self.assertEqual(new,self.rows(100))
        grouped=list(analysis.canonical_groups(new,1231006505+20*600))
        a=next(row for row in grouped if row['group_id']=='a')
        self.assertEqual(a['first_received_blockheight'],1)
        self.assertEqual(a['first_exposed_blockheight'],2)
        self.assertEqual(a['last_spend_blockheight'],15)
        self.assertIn('retired-a',a['display_group_ids'])
        self.assertEqual(next(row for row in grouped if row['group_id']=='b')['current_utxo_count'],3)

    def test_entire_export_is_byte_identical_to_former_history_stream(self):
        with tempfile.TemporaryDirectory(prefix='quantum-live-export-') as temp:
            root=Path(temp)
            for name,rows in (('old',self.old_rows()),('new',self.rows(1))):
                analysis.export_snapshot(rows,snapshot_height=20,snapshot_time=1231006505+20*600,
                    output_dir=root/name,block_hash=f'{20:064x}',source_generation='fixture')
            old={path.name:hashlib.sha256(path.read_bytes()).hexdigest() for path in (root/'old/20').iterdir()}
            new={path.name:hashlib.sha256(path.read_bytes()).hexdigest() for path in (root/'new/20').iterdir()}
            self.assertEqual(old,new)
            self.assertGreaterEqual(len(old),6)

    def test_repeatable_read_is_stable_across_group_pages_and_concurrent_mutation(self):
        other=psycopg2.connect(DSN)
        self.addCleanup(other.close)
        expected=self.rows(1)
        self.conn.set_session(isolation_level='REPEATABLE READ')
        stream=store.iter_group_rows(self.conn,fetch_size=1)
        first=next(stream)
        self.assertEqual(first['group_id'],'a')
        with other,other.cursor() as cur:
            cur.execute("UPDATE quantum_v2.group_state SET utxo_count=0,eligible_utxos=0 WHERE group_id='b'")
            cur.execute("INSERT INTO quantum_v2.group_state(group_id,script_type,utxo_count) VALUES('bb','Other',1)")
            cur.execute("UPDATE quantum_v2.group_state SET last_spend_height=19 WHERE group_id='a' AND script_type='P2PK'")
        self.assertEqual([first,*stream],expected)
        self.conn.commit()
        next_rows=self.rows(1)
        self.assertNotIn('b',{row['group_id'] for row in next_rows})
        self.assertIn('bb',{row['group_id'] for row in next_rows})
        a=next(row for row in next_rows if row['group_id']=='a' and row['script_type']=='P2PK')
        self.assertEqual(a['last_spend_blockheight'],19)

    def test_missing_index_and_ended_snapshot_fail_closed(self):
        self.conn.set_session(isolation_level='REPEATABLE READ')
        stream=store.iter_group_rows(self.conn,fetch_size=1)
        next(stream);self.conn.commit()
        with self.assertRaisesRegex(store.StoreError,'ended the export snapshot'):next(stream)
        with self.conn,self.conn.cursor() as cur:cur.execute('DROP INDEX quantum_v2.group_state_live_group_id')
        with self.assertRaisesRegex(store.StoreError,'migration 006'):self.rows()
        self.conn.rollback()
        with self.assertRaisesRegex(store.StoreError,'missing or invalid'):store.migrate_live_export(self.conn)

    def test_migration_is_idempotent_and_excludes_another_writer(self):
        store.migrate_live_export(self.conn)
        with self.conn,self.conn.cursor() as cur:
            cur.execute('SELECT count(*) FROM quantum_v2.schema_migration WHERE version=6')
            self.assertEqual(cur.fetchone()[0],1)
        other=psycopg2.connect(DSN)
        self.addCleanup(other.close)
        with other,other.cursor() as cur:cur.execute('SELECT pg_advisory_lock(811947,2)')
        with self.assertRaisesRegex(store.StoreError,'global writer lock'):store.migrate_live_export(self.conn)

    def test_populated_build_requires_explicit_opt_in_and_keeps_local_limits(self):
        with self.conn,self.conn.cursor() as cur:
            cur.execute('DROP INDEX quantum_v2.group_state_live_group_id')
            cur.execute('DELETE FROM quantum_v2.schema_migration WHERE version=6')
            cur.execute('ALTER TABLE quantum_v2.group_state DROP CONSTRAINT group_state_zero_utxo_balance, DROP CONSTRAINT group_state_zero_eligible_balance')
        with self.assertRaisesRegex(store.StoreError,'explicit measured opt-in'):
            store.migrate_live_export(self.conn)
        store.migrate_live_export(self.conn,allow_populated=True)
        with self.conn,self.conn.cursor() as cur:
            cur.execute('SELECT count(*) FROM quantum_v2.schema_migration WHERE version=6')
            self.assertEqual(cur.fetchone()[0],1)
        self.assertEqual(len(self.rows()),11)

    def test_invalid_family_does_not_silently_truncate_group(self):
        with self.conn,self.conn.cursor() as cur:
            cur.execute("INSERT INTO quantum_v2.group_state(group_id,script_type) VALUES('e','Z-invalid-eighth')")
        with self.assertRaisesRegex(store.StoreError,'Unsupported script family'):self.rows()

    def test_large_retired_population_uses_partial_live_index_and_bounded_pk_lookups(self):
        with self.conn,self.conn.cursor() as cur:
            cur.execute("INSERT INTO quantum_v2.group_state(group_id,script_type) SELECT 'retired-'||lpad(n::text,8,'0'),'P2PKH' FROM generate_series(1,150000) n")
            cur.execute("INSERT INTO quantum_v2.group_state(group_id,script_type,utxo_count) SELECT 'live-'||lpad(n::text,8,'0'),'Other',1 FROM generate_series(1,200) n")
            cur.execute('ANALYZE quantum_v2.group_state')
            cur.execute('ANALYZE public.blockheader')
            for position in (None,'live-00000100'):
                query,params=store._live_group_page_query(position,10)
                cur.execute('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+query,params)
                plan=cur.fetchone()[0][0]['Plan']
                def nodes(node):
                    yield node
                    for child in node.get('Plans',[]):yield from nodes(child)
                all_nodes=list(nodes(plan))
                state_nodes=[node for node in all_nodes if node.get('Relation Name')=='group_state']
                self.assertTrue(any(node.get('Index Name')=='group_state_live_group_id' for node in state_nodes),all_nodes)
                self.assertTrue(any(node.get('Index Name')=='group_state_pkey' for node in state_nodes),all_nodes)
                self.assertFalse(any(node['Node Type']=='Seq Scan' for node in state_nodes),all_nodes)
                self.assertFalse(any(node.get('Strategy')=='Hashed' for node in all_nodes),all_nodes)
                self.assertLessEqual(plan['Actual Rows'],70)
                self.assertLess(plan['Shared Hit Blocks']+plan['Shared Read Blocks'],1000)


if __name__=='__main__':unittest.main()
