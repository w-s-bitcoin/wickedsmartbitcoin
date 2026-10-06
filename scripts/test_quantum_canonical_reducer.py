#!/usr/bin/env python3
"""Bounded canonical SQL reducer against authored expectations and a Python oracle.

Optional QUANTUM_CANONICAL_REDUCER_TEST_DSN must identify a *_fixture database on
an explicit /tmp socket. No default database or producer is used.
"""
import hashlib
import os
from pathlib import Path
import sys
import unittest
from unittest import mock

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'webapps/quantum_exposure/pipeline'))
try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
    import quantum_v2_store as store
except ImportError:
    psycopg2=None

DSN=os.getenv('QUANTUM_CANONICAL_REDUCER_TEST_DSN','')
G='0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
K=hashlib.new('ripemd160',hashlib.sha256(bytes.fromhex(G)).digest()).hexdigest()
A='11'*20
FIELDS=('blockheight','transactionid','vout','amount','address','scripttype','scripthex','spendingblock')
def row(h,tx,amount,kind,address,raw,spent=None,vout=0):
    return dict(zip(FIELDS,(h,tx,vout,amount,address,kind,raw,spent)))
def pkh(k):return '76a914'+k+'88ac'


def python_oracle(rows,anchor,hashes):
    """Original per-occurrence accounting, independent of SQL classification/reduction."""
    states={};exposures={}
    for r in sorted(rows,key=lambda r:(r['blockheight'],r['transactionid'],r['vout'])):
        if r['blockheight']>anchor or (r.get('scripthex') or '').lower().startswith('6a') or len(r.get('scripthex') or '')>20000:continue
        g,f,d,eligible=store.identify(r);s=states.setdefault((g,f),store._empty(g,f,d))
        spec=store.BIP30_REMOVALS.get((r['blockheight'],r['transactionid'],r['vout']))
        removed=spec[0] if spec and hashes.get(r['blockheight'])==spec[1] and hashes.get(spec[0])==spec[2] else None
        spent=r['spendingblock'] if removed is None or (r['spendingblock'] is not None and r['spendingblock']<removed) else None
        created=r['blockheight']
        if created>0:s['first_received_height']=store._min(s['first_received_height'],created)
        if spent is not None and spent<=anchor:
            s['last_spend_height']=store._max(s['last_spend_height'],spent)
            if eligible:exposures[g]=store._min(exposures.get(g),spent)
        elif created>0 and (removed is None or removed>anchor):
            s['balance_sats']+=r['amount'];s['utxo_count']+=1
            if eligible:s['eligible_sats']+=r['amount'];s['eligible_utxos']+=1
        if eligible and (f in ('P2PK','P2TR') or str(r.get('scripttype','')).startswith('Multisig ')):
            exposures[g]=store._min(exposures.get(g),created)
    for (g,f),s in states.items():
        s['first_disclosure_height']=exposures.get(g)
        s['first_disclosure_hash']=hashes.get(exposures.get(g))
    return states,{g:(h,hashes[h]) for g,h in exposures.items()}


@unittest.skipUnless(DSN and psycopg2,'Set QUANTUM_CANONICAL_REDUCER_TEST_DSN for an isolated PostgreSQL fixture')
class CanonicalReducer(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        opts=psycopg2.extensions.parse_dsn(DSN)
        if not opts.get('dbname','').endswith('_fixture') or not opts.get('host','').startswith(('/tmp/','/private/tmp/')):
            raise RuntimeError('Refusing fixture reset outside explicit /tmp socket + *_fixture database')
        cls.conn=psycopg2.connect(DSN)
    @classmethod
    def tearDownClass(cls):cls.conn.close()
    def setUp(self):
        self.conn.rollback();self.conn.autocommit=True
        self.hashes={h:f'{h:064x}' for h in range(31)}
        with self.conn.cursor() as q:
            q.execute('DROP SCHEMA IF EXISTS quantum_v2 CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public')
            q.execute('CREATE TABLE blockheader(blockheight bigint PRIMARY KEY,blockhash text,time bigint)')
            q.executemany('INSERT INTO blockheader VALUES(%s,%s,%s)',[(h,b,1231006505+h*600) for h,b in self.hashes.items()])
            q.execute('''CREATE TABLE outputs(blockheight bigint,transactionid text,vout integer,amount bigint,
                address text,scripttype text,scripthex text,spendingblock bigint,PRIMARY KEY(blockheight,transactionid,vout))''')
            for name in ('stxos_0_9_archive','stxos_10_99999_archive'):
                q.execute('CREATE TABLE '+name+' (LIKE outputs INCLUDING ALL)')
        self.conn.autocommit=False;store.migrate(self.conn)
    def insert(self,rows,table=None):
        with self.conn,self.conn.cursor() as q:
            for r in rows:
                target=table or ('outputs' if r['spendingblock'] is None else 'stxos_0_9_archive' if r['spendingblock']<10 else 'stxos_10_99999_archive')
                q.execute('INSERT INTO '+target+' VALUES('+','.join(['%s']*8)+')',tuple(r[k] for k in FIELDS))
    def capture(self):
        with self.conn,self.conn.cursor(cursor_factory=RealDictCursor) as q:
            q.execute('SELECT * FROM quantum_v2.group_state ORDER BY group_id,script_type')
            states={(r['group_id'],r['script_type']):dict(r) for r in q.fetchall()}
            q.execute('SELECT * FROM quantum_v2.disclosure ORDER BY group_id')
            exposures={r['group_id']:(r['exposed_height'],r['exposed_hash']) for r in q.fetchall()}
        return states,exposures
    def tuple_identity(self,group=A,family='P2PKH'):
        with self.conn,self.conn.cursor() as q:
            q.execute('SELECT ctid::text,xmin::text FROM quantum_v2.group_state WHERE group_id=%s AND script_type=%s',(group,family))
            return q.fetchone()
    def seed(self,anchor=20,limit=4):
        store.initialize_source_seed(self.conn,anchor,self.hashes[anchor])
        for _ in range(300):
            if store.bootstrap_step(self.conn,limit=limit):return
        self.fail('Canonical seed did not finish')
    def mixed(self):
        return [row(0,'genesis',500,'pubkey',None,'21'+G+'ac'),
            row(1,'pkh-old',100,'pubkeyhash','first-key-address',pkh(K),4),
            row(2,'pkh-live',300,'pubkeyhash','later-address',pkh(K)),
            row(3,'wpkh-zero',0,'witness_v0_keyhash',None,'0014'+K),
            row(3,'pkh-unseen',77,'pubkeyhash',None,pkh(A)),
            row(1,'sh-old',90,'scripthash','sh','a914'+'22'*20+'87',8),
            row(2,'sh-sooner',20,'scripthash','sh','a914'+'22'*20+'87',5),
            row(4,'sh-live',150,'scripthash','sh','A914'+'22'*20+'87'),
            row(4,'wsh',44,'witness_v0_scripthash','wsh','0020'+'33'*32,21),
            row(4,'tr',55,'witness_v1_taproot','tr','5120'+G[2:]),
            row(5,'bare',66,'Multisig 1 of 1',None,'5121'+G+'51ae'),
            row(5,'invalidpk',1,'pubkey',None,'21'+'02'+'ff'*32+'ac'),
            row(5,'invalidtr',2,'witness_v1_taproot','invalidtr','5120'+'ff'*32),
            row(6,'unknown',9,None,None,'51'),row(6,'nulldata',80,'nulldata',None,'6a00'),
            row(6,'oversize',80,'nonstandard',None,'51'*10001)]
    def test_mixed_exact_metadata_and_counts_match_oracle(self):
        rows=self.mixed();self.insert(rows);self.seed(limit=3)
        states,exposure=self.capture();self.assertEqual((states,exposure),python_oracle(rows,20,self.hashes))
        self.assertEqual([states[(K,'P2PK')][x] for x in ('balance_sats','utxo_count','first_received_height','first_disclosure_height','last_spend_height')],[0,0,None,0,None])
        self.assertEqual([states[(K,'P2PKH')][x] for x in ('balance_sats','utxo_count','first_received_height','first_disclosure_height','last_spend_height','display_group_id')],[300,1,1,0,4,'first-key-address'])
        self.assertEqual(states[(K,'P2WPKH')]['utxo_count'],1)
        self.assertEqual(states[('sh','P2SH')]['first_disclosure_height'],5)
        self.assertEqual(states[('sh','P2SH')]['last_spend_height'],8)
        self.assertNotIn('invalidtr',exposure);self.assertEqual(states[('invalidtr','P2TR')]['eligible_utxos'],0)
        self.assertFalse(any('nulldata' in g or 'oversize' in g for g,f in states))
    def test_dense_block_and_late_earlier_disclosure_propagate_all_families(self):
        rows=[row(1,f'{i:04}',i,'pubkeyhash','same',pkh(A),15 if i==0 else None) for i in range(250)]
        rows += [row(2,'witness',5,'witness_v0_keyhash','witness','0014'+A,4)]
        self.insert(rows);self.seed(limit=17)
        states,exposures=self.capture();self.assertEqual((states,exposures),python_oracle(rows,20,self.hashes))
        self.assertEqual(states[(A,'P2PKH')]['first_disclosure_height'],4)
        self.assertEqual(states[(A,'P2PKH')]['utxo_count'],249)
    def test_many_conflict_keys_preserve_chronological_display_and_cross_family_disclosure(self):
        # Primary-key order is deliberately unrelated to chronological source
        # order. Reordering reduced writes must not choose a different display,
        # lose a zero-valued UTXO, or miss an earlier disclosure on a later page.
        keys=[hashlib.sha256(str(i).encode()).hexdigest()[:40] for i in range(64)]
        rows=[]
        for i,key in enumerate(keys):
            rows.extend([row(1,f'first-{i:03}',100,'pubkeyhash',f'first-{i}',pkh(key),18),
                         row(1,f'first-{i:03}',1,'pubkeyhash','wrong-vout-display',pkh(key),vout=1),
                         row(2,f'witness-{i:03}',0,'witness_v0_keyhash',f'witness-{i}','0014'+key),
                         row(3,f'later-{i:03}',2,'pubkeyhash','wrong-later-display',pkh(key),20),
                         row(4,f'disclose-{i:03}',3,'witness_v0_keyhash','wrong-witness-display','0014'+key,6)])
        expected=python_oracle(rows,20,self.hashes)
        for limit in (17,1000):
            with self.subTest(page_rows=limit):
                self.setUp();self.insert(list(reversed(rows)));self.seed(limit=limit)
                states,exposures=self.capture()
                self.assertEqual((states,exposures),expected)
                for i,key in enumerate(keys):
                    self.assertEqual(states[(key,'P2PKH')]['display_group_id'],f'first-{i}')
                    self.assertEqual(states[(key,'P2WPKH')]['display_group_id'],f'witness-{i}')
                    self.assertEqual(states[(key,'P2PKH')]['first_disclosure_height'],6)
                    self.assertEqual((states[(key,'P2WPKH')]['balance_sats'],states[(key,'P2WPKH')]['utxo_count']),(0,1))
    def test_conflicting_copy_at_lookahead_rolls_back(self):
        rows=[row(1,'a',1,'pubkeyhash','a',pkh(A)),row(1,'b',2,'pubkeyhash','a',pkh(A))]
        self.insert(rows);self.insert([dict(rows[1],amount=3)],'stxos_0_9_archive')
        store.initialize_source_seed(self.conn,20,self.hashes[20])
        with self.assertRaisesRegex(store.StoreError,'Conflicting'):store.bootstrap_step(self.conn,limit=2)
        self.assertEqual(self.capture(),({},{}));self.assertEqual(store.projection_status(self.conn)['cursors'][0]['rows_processed'],0)
    def test_later_disclosure_does_not_rewrite_existing_evidence(self):
        self.insert([row(1,'a',1,'pubkeyhash','a',pkh(A),4),row(2,'b',2,'pubkeyhash','b',pkh(A),8)])
        store.initialize_source_seed(self.conn,20,self.hashes[20]);store.bootstrap_step(self.conn,limit=1)
        with self.conn,self.conn.cursor() as q:
            q.execute('SELECT xmin::text,exposed_height FROM quantum_v2.disclosure WHERE group_id=%s',(A,));before=q.fetchone()
        store.bootstrap_step(self.conn,limit=1)
        with self.conn,self.conn.cursor() as q:
            q.execute('SELECT xmin::text,exposed_height FROM quantum_v2.disclosure WHERE group_id=%s',(A,));after=q.fetchone()
        self.assertEqual(before,after);self.assertEqual(after[1],4)
    def test_unchanged_historical_family_does_not_rewrite_tuple_but_advances_cursor(self):
        rows=[row(1,'a',10,'pubkeyhash','first',pkh(A),5),
              row(1,'b',20,'pubkeyhash','second',pkh(A),15),
              row(2,'c',30,'pubkeyhash','later',pkh(A),10)]
        self.insert(rows);store.initialize_source_seed(self.conn,20,self.hashes[20])
        self.assertFalse(store.bootstrap_step(self.conn,limit=2))
        before=self.capture();tuple_before=self.tuple_identity()
        self.assertTrue(store.bootstrap_step(self.conn,limit=2))
        self.assertEqual(self.tuple_identity(),tuple_before)
        self.assertEqual(self.capture(),before)
        self.assertEqual(self.capture(),python_oracle(rows,20,self.hashes))
        self.assertEqual(store.projection_status(self.conn)['cursors'][0]['rows_processed'],3)
    def test_guard_retains_null_metadata_earlier_hash_latest_spend_and_zero_value_adds(self):
        rows=[row(1,'a',50,'pubkeyhash','first',pkh(A)),
              row(2,'b',40,'pubkeyhash','later',pkh(A),10),
              row(3,'c',0,'pubkeyhash','later',pkh(A)),
              row(4,'d',7,'pubkeyhash','later',pkh(A),8),
              row(5,'e',9,'pubkeyhash','later',pkh(A),12),
              row(6,'f',3,'pubkeyhash','later',pkh(A)),
              row(7,'g',2,'pubkeyhash','later',pkh(A),9)]
        self.insert(rows);store.initialize_source_seed(self.conn,20,self.hashes[20]);previous=None
        for index in range(len(rows)):
            store.bootstrap_step(self.conn,limit=1)
            current=self.tuple_identity()
            self.assertEqual(self.capture(),python_oracle(rows[:index+1],20,self.hashes))
            if index==len(rows)-1:self.assertEqual(current,previous)
            elif previous is not None:self.assertNotEqual(current,previous)
            previous=current
        value=self.capture()[0][(A,'P2PKH')]
        self.assertEqual((value['balance_sats'],value['utxo_count'],value['eligible_sats'],value['eligible_utxos']),(53,3,53,3))
        self.assertEqual((value['first_received_height'],value['first_disclosure_height'],value['first_disclosure_hash'],value['last_spend_height'],value['display_group_id']),
                         (1,8,self.hashes[8],12,'first'))
    def test_metadata_only_null_funding_and_empty_display_are_filled(self):
        rows=[row(1,'a',1,'pubkeyhash','first',pkh(A),5),row(2,'b',2,'pubkeyhash','replacement',pkh(A),5)]
        self.insert(rows);store.initialize_source_seed(self.conn,20,self.hashes[20]);store.bootstrap_step(self.conn,limit=1)
        # Explicitly exercise NULL-aware MIN and fallback display branches with
        # a zero-accounting page; these cannot be reduced to nonzero additions.
        with self.conn,self.conn.cursor() as q:
            q.execute("UPDATE quantum_v2.group_state SET first_received_height=NULL,display_group_id='' WHERE group_id=%s",(A,))
        before=self.tuple_identity();store.bootstrap_step(self.conn,limit=1)
        self.assertNotEqual(self.tuple_identity(),before)
        value=self.capture()[0][(A,'P2PKH')]
        self.assertEqual((value['balance_sats'],value['utxo_count'],value['first_received_height'],value['display_group_id']),(0,0,2,'replacement'))
    def test_post_reduction_failure_rolls_back_state_disclosure_and_cursor(self):
        rows=[row(1,'a',10,'pubkeyhash','first',pkh(A),12),
              row(2,'b',20,'pubkeyhash','later',pkh(A),8),row(3,'c',7,'pubkeyhash','later',pkh(A))]
        self.insert(rows);store.initialize_source_seed(self.conn,20,self.hashes[20]);store.bootstrap_step(self.conn,limit=1)
        before=self.capture();cursor_before=store.projection_status(self.conn)['cursors'];tuple_before=self.tuple_identity()
        reduce=store._reduce_canonical_seed_page
        def fail_after_write(*args):
            reduce(*args)
            raise store.StoreError('Fixture interruption after state reduction')
        with mock.patch.object(store,'_reduce_canonical_seed_page',side_effect=fail_after_write):
            with self.assertRaisesRegex(store.StoreError,'Fixture interruption'):store.bootstrap_step(self.conn,limit=1)
        self.assertEqual(self.capture(),before);self.assertEqual(self.tuple_identity(),tuple_before)
        self.assertEqual(store.projection_status(self.conn)['cursors'],cursor_before)
        while not store.bootstrap_step(self.conn,limit=1):pass
        self.assertEqual(self.capture(),python_oracle(rows,20,self.hashes))
    def test_exact_archive_copy_and_movement_between_pages(self):
        rows=[row(1,'a',1,'pubkeyhash','a',pkh(A)),row(2,'b',2,'pubkeyhash','b',pkh(A))]
        self.insert(rows);self.insert(rows,'stxos_0_9_archive')
        store.initialize_source_seed(self.conn,20,self.hashes[20]);self.assertFalse(store.bootstrap_step(self.conn,limit=1))
        with self.conn,self.conn.cursor() as q:q.execute('DELETE FROM outputs')
        while not store.bootstrap_step(self.conn,limit=1):pass
        self.assertEqual(self.capture(),python_oracle(rows,20,self.hashes))
        self.assertEqual(store.projection_status(self.conn)['cursors'][0]['rows_processed'],2)
    def test_malformed_declared_standard_raw_fails_before_checkpoint(self):
        for kind in ('pubkeyhash','witness_v0_keyhash','scripthash','witness_v0_scripthash','witness_v1_taproot'):
            for raw in ('51',None):
                with self.subTest(kind=kind,raw=raw):
                    self.setUp();self.insert([row(1,'a',1,kind,'addr',raw)])
                    store.initialize_source_seed(self.conn,20,self.hashes[20])
                    with self.assertRaisesRegex(store.StoreError,'declared type'):store.bootstrap_step(self.conn,limit=10)
                    self.assertEqual(self.capture(),({},{}));self.assertEqual(store.projection_status(self.conn)['cursors'][0]['rows_processed'],0)
    def test_malformed_other_hex_rejected_and_empty_script_accounted(self):
        for raw in ('0','zz',' 51'):
            with self.subTest(raw=raw):
                self.setUp();self.insert([row(1,'bad',1,'nonstandard',None,raw)])
                store.initialize_source_seed(self.conn,20,self.hashes[20])
                with self.assertRaisesRegex(store.StoreError,'malformed locking-script'):store.bootstrap_step(self.conn,limit=10)
                self.assertEqual(self.capture(),({},{}))
        self.setUp();rows=[row(1,'empty',0,'nonstandard',None,'')];self.insert(rows);self.seed()
        self.assertEqual(self.capture(),python_oracle(rows,20,self.hashes))
    def test_invalid_amount_cannot_hide_inside_positive_group_sum(self):
        for amount in (-1,None):
            with self.subTest(amount=amount):
                self.setUp();self.insert([row(1,'a',100,'pubkeyhash','a',pkh(A)),row(1,'b',amount,'pubkeyhash','a',pkh(A))])
                store.initialize_source_seed(self.conn,20,self.hashes[20])
                with self.assertRaisesRegex(store.StoreError,'nonnegative'):store.bootstrap_step(self.conn,limit=10)
                self.assertEqual(self.capture(),({},{}))
    def test_source_delta_rejects_missing_standard_script_without_breaking_legacy(self):
        self.assertTrue(store.identify(row(1,'a',1,'scripthash','sh',None))[3])
        with self.assertRaisesRegex(store.StoreError,'declared type'):
            store.identify(row(1,'a',1,'scripthash','sh',None),require_raw_script=True)
    def test_missing_disclosure_header_rolls_back_state_and_cursor(self):
        self.insert([row(1,'a',1,'pubkeyhash','a',pkh(A),4)])
        with self.conn,self.conn.cursor() as q:q.execute('DELETE FROM blockheader WHERE blockheight=4')
        store.initialize_source_seed(self.conn,20,self.hashes[20])
        with self.assertRaisesRegex(store.SourceNotReady,'provenance'):store.bootstrap_step(self.conn,limit=5)
        self.assertEqual(self.capture(),({},{}));self.assertEqual(store.projection_status(self.conn)['cursors'][0]['rows_processed'],0)
    def test_bip30_removal_is_not_spend_and_repeat_survives(self):
        key,spec=next(iter(store.BIP30_REMOVALS.items()))
        self.hashes.update({key[0]:spec[1],spec[0]:spec[2],92000:f'{92000:064x}'})
        with self.conn,self.conn.cursor() as q:
            q.executemany('INSERT INTO blockheader VALUES(%s,%s,%s)',[(h,self.hashes[h],1231006505+h*600) for h in (key[0],spec[0],92000)])
        rows=[row(key[0],key[1],50,'pubkey',None,'21'+G+'ac',spec[0]),row(spec[0],key[1],50,'pubkey',None,'21'+G+'ac')]
        self.insert(rows);self.seed(anchor=92000,limit=1)
        self.assertEqual(self.capture(),python_oracle(rows,92000,self.hashes))
        value=self.capture()[0][(K,'P2PK')];self.assertEqual((value['balance_sats'],value['utxo_count'],value['last_spend_height']),(50,1,None))
    def test_exception_page_spans_multiple_insert_chunks(self):
        rows=[row(1,f'{i:04}',i,'witness_v1_taproot',f'tr-{i}','5120'+G[2:]) for i in range(2001)]
        self.insert(rows);self.seed(limit=10000)
        self.assertEqual(self.capture(),python_oracle(rows,20,self.hashes))
    def test_ordinary_rows_do_not_cross_python_classifier(self):
        rows=[row(1,f'{i:04}',i,'pubkeyhash','a',pkh(A)) for i in range(1000)]
        self.insert(rows)
        with mock.patch.object(store,'identify',side_effect=AssertionError('ordinary row transferred to Python')):self.seed(limit=1000)
        self.assertEqual(self.capture(),python_oracle(rows,20,self.hashes))

if __name__=='__main__':unittest.main()
