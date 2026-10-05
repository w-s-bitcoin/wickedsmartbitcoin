#!/usr/bin/env python3
"""Source merge plans and exact duplicate/conflict pagination in disposable PG14."""
import os
from pathlib import Path
import sys
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'webapps/quantum_exposure/pipeline'))
try:
    import psycopg2
except ImportError:
    psycopg2=None
if psycopg2:
    from psycopg2 import sql
    from psycopg2.extras import RealDictCursor,execute_values
    import quantum_v2_store as store

DSN=os.environ.get('QUANTUM_STREAM_TEST_DSN')
TABLES=('outputs','stxos_0_9_archive','stxos_10_99999_archive')
FIELDS=('blockheight','transactionid','vout','amount','address','scripttype','scripthex','spendingblock')
def row(tx,amount=1,*,height=1,script='51',spent=None,address=None):
    return (height,tx,0,amount,address,'nonstandard',script,spent)
def walk(plan):
    yield plan
    for child in plan.get('Plans',[]):yield from walk(child)


@unittest.skipUnless(DSN and psycopg2,'Set QUANTUM_STREAM_TEST_DSN to a temporary *_fixture database')
class SourceStreaming(unittest.TestCase):
    def setUp(self):
        args=psycopg2.extensions.parse_dsn(DSN)
        if not args.get('dbname','').endswith('_fixture') or not args.get('host','').startswith(('/tmp/','/private/tmp/')):
            raise RuntimeError('Refusing destructive setup outside temporary socket + *_fixture database')
        self.conn=psycopg2.connect(DSN)
        with self.conn,self.conn.cursor() as cur:
            cur.execute('DROP SCHEMA IF EXISTS quantum_v2 CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public')
            cur.execute('CREATE TABLE blockheader(blockheight bigint PRIMARY KEY,blockhash text,time bigint)')
            cur.executemany('INSERT INTO blockheader VALUES(%s,%s,%s)',[(h,f'{h:064x}',1600000000+h*600) for h in range(21)])
            for name in TABLES:
                # Source occurrence indexes are not guaranteed unique. Keep the
                # fixture deliberately nonunique to model retained duplicate rows.
                cur.execute(sql.SQL('''CREATE TABLE {} (blockheight bigint,transactionid text,vout integer,
                    amount bigint,address text,scripttype text,scripthex text,spendingblock bigint)''').format(sql.Identifier(name)))
                cur.execute(sql.SQL('CREATE INDEX ON {} (blockheight)').format(sql.Identifier(name)))
        store.migrate(self.conn)

    def tearDown(self):
        self.conn.rollback()
        with self.conn,self.conn.cursor() as cur:
            cur.execute('DROP SCHEMA quantum_v2 CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public')
        self.conn.close()

    def load(self,sources):
        with self.conn,self.conn.cursor() as cur:
            for name,rows in zip(TABLES,sources):
                cur.execute(sql.SQL('TRUNCATE {}').format(sql.Identifier(name)))
                if rows:execute_values(cur,sql.SQL('INSERT INTO {} VALUES %s').format(sql.Identifier(name)),rows)

    def collect(self,limit,*,other_only=False):
        key=(-1,'',-1);result=[]
        for _ in range(100):
            with store.transaction(self.conn) as cur:
                rows,done,key=store._source_occurrence_page(cur,key,20,limit,other_only=other_only)
            result.extend(tuple(r[f] for f in FIELDS) for r in rows)
            if done:return result,key
        self.fail('Source cursor did not finish')

    def test_duplicate_prefix_cannot_hide_later_occurrences_or_window_completion(self):
        sources=([row('a')]*50+[row('b',2),row('c',3)],[],[])
        self.load(sources)
        for limit in (1,2,3,10):
            with self.subTest(limit=limit):
                rows,key=self.collect(limit)
                self.assertEqual(rows,[row('a'),row('b',2),row('c',3)])
                self.assertEqual(key,(21,'',-1))

    def test_exact_cross_source_copies_and_nulls_collapse_once(self):
        a=row('a',script=None);b=row('b',2);c=row('c',3)
        self.load(([a,b],[a,b],[b,c]))
        for limit in (1,2,3,10):
            with self.subTest(limit=limit):self.assertEqual(self.collect(limit)[0],[a,b,c])

    def test_payload_conflicts_after_duplicate_prefix_fail_before_cursor_commit(self):
        for sources in (([row('a')]*50+[row('b',2)],[row('b',3)],[]),
                        ([row('a'),row('b',script=None)],[row('b',script='')],[])):
            self.load(sources)
            store.initialize_source_seed(self.conn,20,f'{20:064x}')
            with self.assertRaisesRegex(store.StoreError,'Conflicting'):
                store.bootstrap_step(self.conn,limit=2)
            status=store.projection_status(self.conn)
            self.assertEqual(status['cursors'][0]['rows_processed'],0)
            self.assertEqual(status['cursors'][0]['last_height'],-1)
            with self.conn,self.conn.cursor() as cur:
                cur.execute('SELECT count(*) FROM quantum_v2.group_state');self.assertEqual(cur.fetchone()[0],0)
                cur.execute('TRUNCATE quantum_v2.bootstrap_cursor,quantum_v2.projection')

    def test_canonical_reduction_counts_distinct_occurrences_not_raw_copies(self):
        self.load(([row('a')]*50+[row('b',2),row('c',3)],[row('b',2)],[]))
        store.initialize_source_seed(self.conn,20,f'{20:064x}')
        for _ in range(10):
            if store.bootstrap_step(self.conn,limit=2):break
        else:self.fail('Canonical page did not finish')
        with self.conn,self.conn.cursor() as cur:
            cur.execute('SELECT sum(balance_sats),sum(utxo_count) FROM quantum_v2.group_state')
            self.assertEqual(cur.fetchone(),(6,3))
        self.assertEqual(store.projection_status(self.conn)['cursors'][0]['rows_processed'],3)

    def test_archive_movement_between_pages_preserves_global_frontier(self):
        a=row('a',spent=30);b=row('b',2,spent=30);c=row('c',3,spent=30)
        self.load(([a,b,c],[],[a]))
        with store.transaction(self.conn) as cur:first,done,key=store._source_occurrence_page(cur,(-1,'',-1),20,1)
        self.assertFalse(done);self.assertEqual(tuple(first[0][f] for f in FIELDS),a)
        with self.conn,self.conn.cursor() as cur:
            cur.execute('INSERT INTO stxos_10_99999_archive SELECT * FROM outputs')
            cur.execute('DELETE FROM outputs')
        remaining=[]
        for _ in range(5):
            with store.transaction(self.conn) as cur:page,done,key=store._source_occurrence_page(cur,key,20,1)
            remaining.extend(tuple(r[f] for f in FIELDS) for r in page)
            if done:break
        self.assertEqual(remaining,[b,c]);self.assertEqual(key,(21,'',-1))

    def test_other_source_filter_deduplicates_before_limit_and_empty_windows_finish(self):
        a=row('a',spent=30);b=row('b',2,spent=30)
        self.load(([a]*50+[b],[],[a,b]))
        self.assertEqual(self.collect(1,other_only=True),([a,b],(21,'',-1)))
        self.load(([],[],[]));self.assertEqual(self.collect(1),([],(21,'',-1)))

    def test_pg14_plan_streams_page_without_reading_each_branch_limit(self):
        with store.transaction(self.conn) as cur:
            for offset,name in enumerate(TABLES):
                cur.execute(sql.SQL('''INSERT INTO {} SELECT (i*3+%s)/90+1,lpad((i*3+%s)::text,10,'0'),0,
                    i,'address','nonstandard','51',NULL FROM generate_series(1,30000) i''').format(sql.Identifier(name)),(offset,offset))
                cur.execute(sql.SQL('ANALYZE {}').format(sql.Identifier(name)))
            query,params,_=store._source_occurrence_query(cur,(-1,'',-1),100,1000)
            cur.execute(sql.SQL('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) ')+query,params)
            plan=cur.fetchone()['QUERY PLAN'][0]['Plan'];nodes=list(walk(plan));kinds=[n['Node Type'] for n in nodes]
            self.assertIn('Unique',kinds);self.assertIn('Merge Append',kinds)
            self.assertNotIn('Sort',kinds);self.assertNotIn('Aggregate',kinds)
            self.assertNotIn('Seq Scan',kinds)
            scans=[n for n in nodes if n.get('Relation Name') in TABLES]
            self.assertEqual(len(scans),3)
            self.assertLess(sum(n['Actual Rows']*n['Actual Loops'] for n in scans),1600)
            self.assertEqual(plan['Actual Rows'],1001)


if __name__=='__main__':unittest.main()
