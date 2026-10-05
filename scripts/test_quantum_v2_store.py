#!/usr/bin/env python3
"""Disposable PostgreSQL fixture tests. Never connects to an implicit/default DB.

QUANTUM_STORE_TEST_DSN must name a database ending in _fixture on a /tmp socket.
Example: host=/private/tmp/quantum-v2-fixture-socket port=55439 dbname=quantum_store_fixture
"""
from __future__ import annotations
import importlib.util
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

DSN=os.getenv('QUANTUM_STORE_TEST_DSN','')
A='11'*20; B='22'*20
G='0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
# Mainnet witness-v1 vector from BIP350 (not a locally generated checksum).
# https://github.com/bitcoin/bips/blob/master/bip-0350.mediawiki#test-vectors
TR='bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0'


def pkh(key): return '76a914'+key+'88ac'
def row(h,tx,value,kind,address,script,spent=None): return (h,tx,0,value,address,kind,script,spent)


@unittest.skipUnless(psycopg2,'psycopg2 is needed to import the store')
class PublicKeyValidation(unittest.TestCase):
    def test_bip350_address_and_invalid_checksums(self):
        self.assertEqual(store._taproot_program(TR),bytes.fromhex(G[2:]))
        self.assertEqual(store._taproot_program(TR.upper()),bytes.fromhex(G[2:]))
        for address in (TR[:3].upper()+TR[3:],TR[:-1]+'q',
                        'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqh2y7hd'):
            self.assertIsNone(store._taproot_program(address))

    def test_invalid_points_never_qualify_as_key_exposure(self):
        base=dict(blockheight=1,transactionid='invalid',vout=0,address='invalid')
        for kind,script in [('pubkey','21'+'02'+'ff'*32+'ac'),
                            ('witness_v1_taproot','5120'+'ff'*32),
                            ('Multisig 1 of 1','5121'+'02'+'ff'*32+'51ae')]:
            self.assertFalse(store.identify(dict(base,scripttype=kind,scripthex=script))[3])
        self.assertTrue(store.identify(dict(base,scripttype='witness_v1_taproot',address=TR))[3])
        # Existing malformed raw data must never be repaired by a different address.
        self.assertFalse(store.identify(dict(base,scripttype='witness_v1_taproot',address=TR,scripthex='512001'))[3])


@unittest.skipUnless(DSN and psycopg2,'Set QUANTUM_STORE_TEST_DSN for an isolated PostgreSQL fixture')
class StoreFixture(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        config=psycopg2.extensions.parse_dsn(DSN)
        if not config.get('dbname','').endswith('_fixture') or not config.get('host','').startswith(('/tmp/','/private/tmp/')):
            raise RuntimeError('Refusing destructive fixture setup outside explicit /tmp socket + *_fixture database')
        cls.conn=psycopg2.connect(DSN)

    @classmethod
    def tearDownClass(cls): cls.conn.close()

    def setUp(self):
        self.conn.rollback(); self.conn.autocommit=True
        with self.conn.cursor() as c:
            c.execute('DROP SCHEMA IF EXISTS quantum_v2 CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public')
            c.execute('CREATE TABLE blockheader(blockheight bigint PRIMARY KEY,blockhash text,time bigint)')
            c.executemany('INSERT INTO blockheader VALUES(%s,%s,%s)',[(h,f'{h:064x}',1231006505+h*600) for h in range(31)])
            c.execute('''CREATE TABLE outputs(blockheight bigint,transactionid text,vout integer,amount bigint,address text,
                         scripttype text,scripthex text,spendingblock bigint,PRIMARY KEY(blockheight,transactionid,vout))''')
            for n in ['stxos_0_9_archive','stxos_10_99_archive']:
                c.execute(f'CREATE TABLE {n} (LIKE outputs INCLUDING ALL)')
            c.execute('CREATE TABLE analysis_freeze(name text PRIMARY KEY,freeze_blockheight bigint)')
            c.executemany('INSERT INTO analysis_freeze VALUES(%s,5)',[(x,) for x in store.LEGACY+('key_outputs_all','exposed_keyhash20','exposed_p2sh_address','exposed_p2wsh_address')])
            c.execute('''CREATE TABLE key_outputs_all(keyhash20 bytea,blockheight bigint,transactionid text,vout integer,
                         amount bigint,script_type text,spendingblock bigint,address text,PRIMARY KEY(blockheight,transactionid,vout))''')
            c.execute('CREATE TABLE active_key_outputs (LIKE key_outputs_all INCLUDING ALL)')
            for n in store.LEGACY[1:]:
                c.execute(f'''CREATE TABLE {n}(blockheight bigint,transactionid text,vout integer,amount bigint,
                             spendingblock bigint,address text,PRIMARY KEY(blockheight,transactionid,vout))''')
            c.execute('CREATE TABLE exposed_keyhash20(keyhash20 bytea PRIMARY KEY,exposed_height bigint)')
            for n in ['exposed_p2sh_address','exposed_p2wsh_address']:
                c.execute(f'CREATE TABLE {n}(address text PRIMARY KEY,exposed_height bigint)')
            c.execute('INSERT INTO exposed_keyhash20 VALUES(%s,3)',(bytes.fromhex(B),))
            c.execute("INSERT INTO exposed_p2sh_address VALUES('sh',4)")
        self.conn.autocommit=False
        self.source_rows=[row(1,'a',500,'pubkeyhash','a',pkh(A),6),
                          row(2,'aw',400,'witness_v0_keyhash','aw','0014'+A),
                          row(2,'b',100,'pubkeyhash','b',pkh(B),3),
                          row(2,'sh0',300,'scripthash','sh','a914'+'33'*20+'87',4),
                          row(4,'sh1',200,'scripthash','sh','a914'+'33'*20+'87'),
                          row(3,'tr',100,'witness_v1_taproot','tr','5120'+'44'*32)]
        self.add_source(self.source_rows)
        with self.conn:
            with self.conn.cursor() as c:
                for r in self.source_rows:
                    h,tx,v,value,address,kind,script,spend=r
                    if kind in ('pubkeyhash','witness_v0_keyhash'):
                        key=bytes.fromhex(A if tx in ('a','aw') else B)
                        c.execute('INSERT INTO key_outputs_all VALUES(%s,%s,%s,%s,%s,%s,%s,%s)',(key,h,tx,v,value,kind,spend,address))
                        if tx!='b': c.execute('INSERT INTO active_key_outputs VALUES(%s,%s,%s,%s,%s,%s,%s,%s)',(key,h,tx,v,value,kind,spend,address))
                    else:
                        table='active_p2sh_outputs' if kind=='scripthash' else 'active_p2tr_outputs'
                        c.execute(f'INSERT INTO {table} VALUES(%s,%s,%s,%s,%s,%s)',(h,tx,v,value,spend,address))
        store.migrate(self.conn)

    def add_source(self,rows):
        with self.conn:
            with self.conn.cursor() as c:
                for r in rows:
                    table='outputs' if r[-1] is None else 'stxos_0_9_archive' if r[-1]<10 else 'stxos_10_99_archive'
                    c.execute(f'INSERT INTO {table} VALUES(%s,%s,%s,%s,%s,%s,%s,%s)',r)

    def seed(self):
        store.initialize_seed(self.conn,5,f'{5:064x}')
        for _ in range(30):
            if store.bootstrap_step(self.conn,limit=2): break
        else: self.fail('Seed did not finish')

    def states(self):
        with self.conn:
            with self.conn.cursor(cursor_factory=RealDictCursor) as c:
                c.execute('SELECT * FROM quantum_v2.group_state ORDER BY group_id,script_type')
                return {(r['group_id'],r['script_type']):dict(r) for r in c.fetchall()}

    def test_bootstrap_resume_migration_and_same_height_idempotence(self):
        self.seed(); before=self.states()
        self.assertEqual(before[(A,'P2PKH')]['balance_sats'],500)
        self.assertEqual(before[(A,'P2WPKH')]['balance_sats'],400)
        self.assertEqual(before[('sh','P2SH')]['last_spend_height'],4)
        self.assertEqual(before[('sh','P2SH')]['first_disclosure_height'],4)
        store.migrate(self.conn); store.initialize_seed(self.conn,5,f'{5:064x}')
        self.assertTrue(store.apply_range(self.conn,5)['idempotent'])
        self.assertEqual(before,self.states())

    def test_disclosure_fanout_revived_zero_balance_and_undo(self):
        self.seed(); before=self.states()
        self.add_source([row(7,'b2',77,'pubkeyhash','b',pkh(B),7),row(7,'trnew',30,'witness_v1_taproot','newtr','5120'+'55'*32)])
        store.apply_range(self.conn,8)
        s=self.states()
        self.assertEqual(s[(A,'P2PKH')]['balance_sats'],0)
        self.assertEqual(s[(A,'P2WPKH')]['balance_sats'],400)
        self.assertEqual(s[(A,'P2WPKH')]['first_disclosure_height'],6)
        self.assertEqual(s[(B,'P2PKH')]['balance_sats'],0)
        self.assertEqual(s[(B,'P2PKH')]['first_received_height'],2)
        self.assertEqual(s[(B,'P2PKH')]['first_disclosure_height'],3)
        self.assertEqual(s[(B,'P2PKH')]['last_spend_height'],7)
        self.assertTrue(store.rollback_to(self.conn,5)); self.assertEqual(before,self.states())
        with self.conn:
            with self.conn.cursor() as c:
                c.execute('SELECT exposed_hash FROM quantum_v2.orphan_disclosure WHERE group_id=%s AND exposed_height=6',(A,))
                self.assertEqual(c.fetchone()[0],f'{6:064x}')
        store.apply_range(self.conn,8)
        self.assertEqual(s,self.states())
        with self.conn:
            rows=list(store.iter_group_rows(self.conn))
            one_at_a_time=list(store.iter_group_rows(self.conn,fetch_size=1))
        self.assertEqual(rows,one_at_a_time)
        aw=next(r for r in rows if r['group_id']==A and r['script_type']=='P2WPKH')
        self.assertEqual(aw['exposed_supply_sats'],400)
        self.assertEqual(aw['first_exposed_blockheight'],6)
        self.assertEqual(aw['last_spend_blockheight'],None)
        history=next(r for r in one_at_a_time if r['group_id']==A and r['script_type']=='P2PKH')
        self.assertEqual(history['current_utxo_count'],0)
        self.assertEqual(history['last_spend_time'],1231006505+6*600)

    def test_export_keysets_require_one_stable_snapshot(self):
        self.seed()
        self.conn.set_session(isolation_level='READ COMMITTED')
        with self.assertRaises(store.StoreError): list(store.iter_group_rows(self.conn,fetch_size=1))
        self.conn.rollback();self.conn.set_session(isolation_level='REPEATABLE READ')
        rows=store.iter_group_rows(self.conn,fetch_size=1)
        next(rows)
        self.conn.commit()
        with self.assertRaises(store.StoreError): next(rows)

    def test_row_budget_failure_is_atomic(self):
        self.seed(); before=self.states()
        self.add_source([row(7,'n1',1,'witness_v1_taproot','n1','5120'+'55'*32),row(7,'n2',2,'witness_v1_taproot','n2','5120'+'66'*32)])
        with self.assertRaises(store.BatchTooLarge): store.apply_range(self.conn,8,max_rows=1)
        self.assertEqual(before,self.states())
        self.assertEqual(store.projection_status(self.conn)['projection']['height'],5)

    def test_same_height_reorg_fails_and_deep_reseed_uses_source(self):
        self.seed()
        with self.conn:
            with self.conn.cursor() as c: c.execute("UPDATE blockheader SET blockhash='new-chain' WHERE blockheight=5")
        with self.assertRaises(store.ReseedRequired): store.apply_range(self.conn,5)
        self.assertFalse(store.rollback_to(self.conn,4))
        store.reset_projection(self.conn,confirm_anchor_hash=f'{5:064x}')
        store.initialize_source_seed(self.conn,5,'new-chain')
        for _ in range(20):
            if store.bootstrap_step(self.conn,limit=20):break
        else:self.fail('Canonical rebuild did not finish')
        self.assertEqual(store.projection_status(self.conn)['projection']['status'],'ready')
        s=self.states()
        self.assertEqual(s[(A,'P2PKH')]['balance_sats'],500)
        self.assertEqual(s[(B,'P2PKH')]['balance_sats'],0)
        self.assertEqual(s[(B,'P2PKH')]['first_disclosure_height'],3)
        with self.conn:
            with self.conn.cursor() as c:
                c.execute("SELECT count(*) FROM quantum_v2.orphan_disclosure WHERE group_id='sh'")
                self.assertEqual(c.fetchone()[0],1)

    def test_source_not_ready_does_not_advance(self):
        self.seed()
        with self.conn:
            with self.conn.cursor() as c:
                c.execute('CREATE TABLE quantum_v2.source_state(singleton boolean,ready boolean,committed_height integer,committed_hash text)')
                c.execute("INSERT INTO quantum_v2.source_state VALUES(true,false,8,'bad')")
        with self.assertRaises(store.SourceNotReady):store.apply_range(self.conn,8)
        self.assertEqual(store.projection_status(self.conn)['projection']['height'],5)

    def test_lagged_freeze_reads_nonlatest_future_spend_archive(self):
        self.add_source([row(4,'other',50,'nonstandard','old-other','51',8)])
        self.seed()
        self.assertEqual(self.states()[('old-other','Other')]['balance_sats'],50)
        store.apply_range(self.conn,9)
        self.assertEqual(self.states()[('old-other','Other')]['balance_sats'],0)

    def test_bip30_overwrite_removes_original_without_spend_activity(self):
        key,spec=next(iter(store.BIP30_REMOVALS.items()))
        created,tx,vout=key; removed,creation_hash,removal_hash=spec
        script='21'+G+'ac'
        original=row(created,tx,5000000000,'pubkey','g',script)
        repeat=row(removed,tx,5000000000,'pubkey','g',script)
        self.add_source([original,repeat])
        group=store.identify(dict(zip(('blockheight','transactionid','vout','amount','address','scripttype','scripthex','spendingblock'),original)))[0]
        anchor=removed-1
        with self.conn:
            with self.conn.cursor() as c:
                c.executemany('INSERT INTO blockheader VALUES(%s,%s,%s)',
                              [(created,creation_hash,1231006505+created*600),
                               (anchor,f'{anchor:064x}',1231006505+anchor*600),
                               (removed,removal_hash,1231006505+removed*600)])
                c.execute('UPDATE analysis_freeze SET freeze_blockheight=%s',(anchor,))
                for table in ('active_key_outputs','key_outputs_all'):
                    c.execute(f'INSERT INTO {table} VALUES(%s,%s,%s,0,5000000000,\'pubkey\',NULL,\'g\')',
                              (bytes.fromhex(group),created,tx))
                c.execute('INSERT INTO exposed_keyhash20 VALUES(%s,%s)',(bytes.fromhex(group),created))
        store.initialize_seed(self.conn,anchor,f'{anchor:064x}')
        while not store.bootstrap_step(self.conn,limit=20): pass
        self.assertEqual(self.states()[(group,'P2PK')]['balance_sats'],5000000000)
        store.apply_range(self.conn,removed)
        state=self.states()[(group,'P2PK')]
        self.assertEqual(state['balance_sats'],5000000000)
        self.assertEqual(state['utxo_count'],1)
        self.assertIsNone(state['last_spend_height'])
        store.rollback_to(self.conn,anchor)
        self.assertEqual(self.states()[(group,'P2PK')]['balance_sats'],5000000000)

    def test_genesis_is_disclosure_but_not_an_unspent_output(self):
        source=row(0,'genesis',5000000000,'pubkey','g','21'+G+'ac')
        self.add_source([source])
        group=store.identify(dict(zip(('blockheight','transactionid','vout','amount','address','scripttype','scripthex','spendingblock'),source)))[0]
        with self.conn:
            with self.conn.cursor() as c:
                c.execute('INSERT INTO active_key_outputs VALUES(%s,0,\'genesis\',0,5000000000,\'pubkey\',NULL,\'g\')',(bytes.fromhex(group),))
                c.execute('INSERT INTO exposed_keyhash20 VALUES(%s,0)',(bytes.fromhex(group),))
        self.seed()
        state=self.states()[(group,'P2PK')]
        self.assertEqual(state['balance_sats'],0)
        self.assertEqual(state['utxo_count'],0)
        self.assertEqual(state['first_disclosure_height'],0)
        self.assertIsNone(state['first_received_height'])
        self.add_source([row(7,'genesis-donation',123,'pubkeyhash','donation',pkh(group))])
        store.apply_range(self.conn,8)
        states=self.states()
        self.assertIsNone(states[(group,'P2PK')]['first_received_height'])
        self.assertEqual(states[(group,'P2PKH')]['first_received_height'],7)
        self.assertEqual(states[(group,'P2PKH')]['first_disclosure_height'],0)
        self.assertFalse(store.rollback_to(self.conn,4))
        store.reset_projection(self.conn,confirm_anchor_hash=f'{5:064x}')
        store.initialize_source_seed(self.conn,8,f'{8:064x}')
        while not store.bootstrap_step(self.conn,limit=2): pass
        states=self.states()
        self.assertIsNone(states[(group,'P2PK')]['first_received_height'])
        self.assertEqual(states[(group,'P2PKH')]['first_received_height'],7)
        self.assertEqual(states[(group,'P2PKH')]['first_disclosure_height'],0)

    def test_legacy_seed_and_delta_exclude_invalid_public_keys(self):
        source=row(4,'badpk',19,'pubkey','badpk','21'+'02'+'ff'*32+'ac')
        self.add_source([source,row(4,'badtr',23,'witness_v1_taproot','badtr','5120'+'ff'*32)])
        group=store.identify(dict(zip(('blockheight','transactionid','vout','amount','address','scripttype','scripthex','spendingblock'),source)))[0]
        with self.conn:
            with self.conn.cursor() as c:
                c.execute("INSERT INTO active_key_outputs VALUES(%s,4,'badpk',0,19,'pubkey',NULL,'badpk')",(bytes.fromhex(group),))
                c.execute("INSERT INTO active_p2tr_outputs VALUES(4,'badtr',0,23,NULL,'badtr')")
        self.seed()
        for key,value in [((group,'P2PK'),19),(('badtr','P2TR'),23)]:
            state=self.states()[key]
            self.assertEqual(state['balance_sats'],value)
            self.assertEqual(state['eligible_sats'],0)
            self.assertIsNone(state['first_disclosure_height'])
        self.add_source([row(7,'badtr2',29,'witness_v1_taproot','badtr','5120'+'ff'*32)])
        store.apply_range(self.conn,8)
        state=self.states()[('badtr','P2TR')]
        self.assertEqual(state['balance_sats'],52)
        self.assertEqual(state['eligible_sats'],0)
        self.assertIsNone(state['first_disclosure_height'])

    def test_missing_legacy_key_facts_fail_without_advancing_seed(self):
        with self.conn:
            with self.conn.cursor() as c:
                c.execute("INSERT INTO active_key_outputs VALUES(%s,4,'missing',0,19,'pubkey',NULL,'missing')",(bytes.fromhex(A),))
        store.initialize_seed(self.conn,5,f'{5:064x}')
        for _ in range(10):
            try: store.bootstrap_step(self.conn,limit=100)
            except store.StoreError: break
        else: self.fail('Missing raw public key unexpectedly accepted')
        status=store.projection_status(self.conn)
        cursor=next(r for r in status['cursors'] if r['source_table']=='active_key_outputs')
        self.assertEqual(cursor['rows_processed'],0)

    def test_legacy_script_lookup_uses_available_composite_prefixes_and_preserves_occurrences(self):
        with self.conn, self.conn.cursor() as cur:
            cur.execute('ALTER TABLE stxos_0_9_archive DROP CONSTRAINT stxos_0_9_archive_pkey')
            cur.execute('CREATE INDEX archive_height ON stxos_0_9_archive(blockheight)')
            cur.execute("CREATE INDEX archive_partial ON stxos_0_9_archive(transactionid,vout) WHERE scripttype='pubkey'")
            cur.execute('CREATE INDEX outputs_tx_vout ON outputs(transactionid,vout)')
        names=['outputs','stxos_0_9_archive','stxos_10_99_archive']
        with self.conn, self.conn.cursor(cursor_factory=RealDictCursor) as cur:
            self.assertEqual(store._point_lookup_sources(cur,names),{'outputs','stxos_10_99_archive'})
        first='5121'+G+'51ae';second='5221'+G+'21'+G+'52ae'
        entries=[row(2,'same-outpoint',11,'Multisig 1 of 1','bare-a',first),
                 row(3,'same-outpoint',12,'Multisig 2 of 2','bare-b',second),
                 row(2,'old-spent',13,'Multisig 1 of 1','bare-c',first,4),
                 row(4,'future-spent',14,'Multisig 2 of 2','bare-d',second,20)]
        self.add_source(entries)
        wanted=[dict(blockheight=r[0],transactionid=r[1],vout=r[2],address=r[4],scripttype=r[5],
                     spendingblock=r[-1] if r[-1] is not None and r[-1]<=5 else None) for r in entries]
        with self.conn, self.conn.cursor(cursor_factory=RealDictCursor) as cur:
            store._prepare_legacy_scripts(cur,wanted,5)
        self.assertEqual([r['scripthex'] for r in wanted],[r[6] for r in entries])
        with self.conn, self.conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Included outpoint columns are not a searchable btree prefix.
            cur.execute('CREATE INDEX archive_cover_only ON stxos_0_9_archive(blockheight) INCLUDE(transactionid,vout)')
            self.assertNotIn('stxos_0_9_archive',store._point_lookup_sources(cur,names))
            cur.execute('CREATE INDEX archive_full ON stxos_0_9_archive(vout,transactionid)')
            self.assertEqual(store._point_lookup_sources(cur,names),set(names))

    def test_reset_preserves_evidence_in_resumable_pages(self):
        self.seed(); store.apply_range(self.conn,8)
        with self.conn:
            with self.conn.cursor() as c:
                c.execute('SELECT DISTINCT group_id,first_disclosure_height,first_disclosure_hash FROM quantum_v2.group_state WHERE first_disclosure_height IS NOT NULL')
                expected=set(c.fetchall())
        self.assertFalse(store.rollback_to(self.conn,4))
        with self.assertRaises(store.StoreError):
            store.reset_projection_step(self.conn,confirm_anchor_hash='wrong',limit=1)
        self.assertFalse(store.reset_projection_step(self.conn,confirm_anchor_hash=f'{5:064x}',limit=1))
        status=store.projection_status(self.conn)
        self.assertEqual(status['projection']['status'],'needs_reseed')
        self.assertEqual(sum(r['rows_processed'] for r in status['cursors'] if r['source_table'].startswith('reset:')),1)
        for _ in range(30):
            if store.reset_projection_step(self.conn,confirm_anchor_hash=f'{5:064x}',limit=1): break
        else: self.fail('Bounded reset did not complete')
        self.assertIsNone(store.projection_status(self.conn)['projection'])
        self.assertTrue(store.reset_projection_step(self.conn,confirm_anchor_hash=f'{5:064x}',limit=1))
        with self.conn:
            with self.conn.cursor() as c:
                c.execute('SELECT group_id,exposed_height,exposed_hash FROM quantum_v2.orphan_disclosure')
                self.assertTrue(expected.issubset(set(c.fetchall())))

    def test_canonical_reseed_resumes_inside_dense_archive_boundary_block(self):
        self.add_source([row(9,f'dense{i}',i+1,'pubkeyhash','dense',pkh(A),9) for i in range(4)])
        store.initialize_source_seed(self.conn,9,f'{9:064x}')
        for _ in range(30):
            if store.bootstrap_step(self.conn,limit=1): break
        else: self.fail('Dense single block never progressed')
        state=self.states()[(A,'P2PKH')]
        self.assertEqual(state['balance_sats'],0)
        self.assertEqual(state['utxo_count'],0)
        self.assertEqual(state['last_spend_height'],9)
        cursor=store.projection_status(self.conn)['cursors'][0]
        self.assertEqual(cursor['rows_processed'],len(self.source_rows)+4)

    def test_other_seed_detects_conflict_after_page_boundary(self):
        self.add_source([row(4,'conflict',50,'nonstandard','other','51'),
                         row(4,'conflict',51,'nonstandard','other','51',8)])
        store.initialize_seed(self.conn,5,f'{5:064x}')
        for _ in range(30):
            try: store.bootstrap_step(self.conn,limit=1)
            except store.StoreError: break
        else: self.fail('Boundary conflict was silently skipped')
        cursor=next(r for r in store.projection_status(self.conn)['cursors'] if r['source_table']=='other:source')
        self.assertEqual(cursor['rows_processed'],0)
        self.assertEqual(cursor['last_height'],-1)

    def test_final_reset_and_replacement_seed_are_one_certified_transaction(self):
        self.seed(); self.assertFalse(store.rollback_to(self.conn,4))
        with self.conn,self.conn.cursor() as c:
            c.execute("UPDATE blockheader SET blockhash='replacement' WHERE blockheight=5")
        options=dict(confirm_anchor_hash=f'{5:064x}',limit=100,reseed_height=5,reseed_hash='replacement')
        self.assertFalse(store.reset_projection_step(self.conn,**options))
        self.assertFalse(store.reset_projection_step(self.conn,**options))
        before=self.states()
        with self.conn,self.conn.cursor() as c:
            c.execute('CREATE TABLE quantum_v2.source_state(singleton boolean,ready boolean,committed_height integer,committed_hash text)')
            c.execute('INSERT INTO quantum_v2.source_state VALUES(true,false,8,%s)',(f'{8:064x}',))
        with self.assertRaises(store.SourceNotReady): store.reset_projection_step(self.conn,**options)
        self.assertEqual(before,self.states())
        self.assertEqual(store.projection_status(self.conn)['projection']['status'],'needs_reseed')
        with self.conn,self.conn.cursor() as c: c.execute('UPDATE quantum_v2.source_state SET ready=true')
        self.assertTrue(store.reset_projection_step(self.conn,**options))
        projection=store.projection_status(self.conn)['projection']
        self.assertEqual((projection['status'],projection['seed_mode'],projection['anchor_hash']),('seeding','canonical','replacement'))
        self.assertTrue(store.reset_projection_step(self.conn,**options))

    def test_burn_outputs_do_not_create_empty_projection_groups(self):
        self.add_source([row(4,'burn',10,'nulldata',None,'6a01ff'),
                         row(4,'oversize',20,'nonstandard',None,'51'*10001)])
        self.seed()
        self.assertFalse(any(g.startswith('out:') for g,f in self.states()))
        self.add_source([row(7,'burn-new',30,'nulldata',None,'6A01FF')])
        store.apply_range(self.conn,8)
        self.assertFalse(any(g.startswith('out:') for g,f in self.states()))
        self.assertFalse(store.rollback_to(self.conn,4))
        store.reset_projection(self.conn,confirm_anchor_hash=f'{5:064x}')
        store.initialize_source_seed(self.conn,8,f'{8:064x}')
        while not store.bootstrap_step(self.conn,limit=2): pass
        self.assertFalse(any(g.startswith('out:') for g,f in self.states()))

    def test_global_writer_lock_guards_direct_store_apis(self):
        self.seed()
        other=psycopg2.connect(DSN)
        try:
            with other,other.cursor() as c: c.execute('SELECT pg_advisory_lock(811947,2)')
            for operation in (lambda:store.migrate(self.conn),lambda:store.bootstrap_step(self.conn),
                              lambda:store.apply_range(self.conn,8)):
                with self.assertRaises(store.StoreError): operation()
        finally: other.close()
        self.assertEqual(store.projection_status(self.conn)['projection']['height'],5)

    def test_sql_reducer_mixed_pubkey_pages_zero_values_and_page_size_parity(self):
        import hashlib
        key=hashlib.new('ripemd160',hashlib.sha256(bytes.fromhex(G)).digest()).hexdigest()
        entries=[row(1,'pk-old',120,'pubkey','pub','21'+G+'ac',4),
                 row(2,'first-zero',0,'pubkeyhash','first-address',pkh(key)),
                 row(3,'later-funded',150,'pubkeyhash','later-address',pkh(key),8),
                 row(3,'already-spent',77,'pubkeyhash','past-address',pkh(key),4),
                 row(4,'witness',20,'witness_v0_keyhash','witness-address','0014'+key),
                 row(1,'wsh-zero',0,'witness_v0_scripthash','wsh','0020'+'33'*32),
                 row(2,'wsh-spent',100,'witness_v0_scripthash','wsh','0020'+'33'*32,3),
                 row(4,'wsh-funded',80,'witness_v0_scripthash','wsh','0020'+'33'*32)]
        self.add_source(entries)
        with self.conn,self.conn.cursor() as c:
            c.execute('INSERT INTO exposed_keyhash20 VALUES(%s,1)',(bytes.fromhex(key),))
            c.execute("INSERT INTO exposed_p2wsh_address VALUES('wsh',2)")
            for h,tx,v,value,address,kind,script,spent in entries:
                if kind=='witness_v0_scripthash':
                    c.execute('INSERT INTO active_p2wsh_outputs VALUES(%s,%s,%s,%s,%s,%s)',(h,tx,v,value,spent,address))
                else:
                    c.execute('INSERT INTO active_key_outputs VALUES(%s,%s,%s,%s,%s,%s,%s,%s)',
                              (bytes.fromhex(key),h,tx,v,value,kind,spent,address))
        self.seed(); expected=self.states()
        pkh_state=expected[(key,'P2PKH')]
        self.assertEqual((pkh_state['balance_sats'],pkh_state['utxo_count'],pkh_state['eligible_utxos']),(150,2,2))
        self.assertEqual((pkh_state['first_received_height'],pkh_state['last_spend_height'],pkh_state['first_disclosure_height']),(2,4,1))
        self.assertEqual(pkh_state['display_group_id'],'first-address')
        self.assertEqual(pkh_state['first_disclosure_hash'],f'{1:064x}')
        wsh=expected[('wsh','P2WSH')]
        self.assertEqual((wsh['balance_sats'],wsh['utxo_count'],wsh['first_received_height'],wsh['last_spend_height']),(80,2,1,3))
        self.assertEqual((wsh['first_disclosure_height'],wsh['first_disclosure_hash']),(2,f'{2:064x}'))
        self.assertFalse(store.rollback_to(self.conn,4))
        store.reset_projection(self.conn,confirm_anchor_hash=f'{5:064x}')
        store.initialize_seed(self.conn,5,f'{5:064x}')
        while not store.bootstrap_step(self.conn,limit=100000): pass
        self.assertEqual(expected,self.states())

    def test_sparse_source_windows_advance_without_scanning_to_anchor(self):
        self.add_source([row(1500,'sparse',42,'nonstandard','sparse','51')])
        with store.transaction(self.conn) as cur:
            rows,done,key=store._source_occurrence_page(cur,(-1,'',-1),2005,10,other_only=True)
            self.assertEqual(rows,[]);self.assertFalse(done);self.assertEqual(key,(1000,'',-1))
            rows,done,key=store._source_occurrence_page(cur,key,2005,10,other_only=True)
            self.assertEqual([r['transactionid'] for r in rows],['sparse'])
            self.assertFalse(done);self.assertEqual(key,(2000,'',-1))
            rows,done,key=store._source_occurrence_page(cur,key,2005,10,other_only=True)
            self.assertEqual(rows,[]);self.assertTrue(done);self.assertEqual(key,(2006,'',-1))

    def test_family_pilots_out_of_order_match_default_and_noop_after_completion(self):
        self.seed(); expected=self.states()
        self.assertFalse(store.rollback_to(self.conn,4))
        store.reset_projection(self.conn,confirm_anchor_hash=f'{5:064x}')
        store.initialize_seed(self.conn,5,f'{5:064x}')
        with self.assertRaises(ValueError): store.bootstrap_step(self.conn,source_table='other:source')
        for family in reversed(store.LEGACY):
            for _ in range(10):
                self.assertFalse(store.bootstrap_step(self.conn,limit=1,source_table=family))
                cursor=next(r for r in store.projection_status(self.conn)['cursors'] if r['source_table']==family)
                if cursor['complete']:break
            else:self.fail('Family pilot never finished')
            states=self.states()
            self.assertFalse(store.bootstrap_step(self.conn,limit=1,source_table=family))
            self.assertEqual(states,self.states())
        self.assertEqual(store.projection_status(self.conn)['projection']['status'],'seeding')
        while not store.bootstrap_step(self.conn,limit=1):pass
        self.assertEqual(expected,self.states())
        self.assertTrue(store.bootstrap_step(self.conn,source_table=store.LEGACY[0]))

    def test_physical_dense_pages_preserve_keyset_prefix_and_full_projection_parity(self):
        import hashlib
        key=hashlib.new('ripemd160',hashlib.sha256(bytes.fromhex(G)).digest()).hexdigest()
        # Insertion/physical order deliberately disagrees with occurrence order,
        # including two funding transactions at the same height.
        entries=[row(4,'late',50,'pubkeyhash','late-display',pkh(key)),
                 row(2,'middle',40,'pubkeyhash','middle-display',pkh(key)),
                 row(2,'first',0,'pubkeyhash','earliest-display',pkh(key)),
                 row(3,'witness',20,'witness_v0_keyhash','witness','0014'+key),
                 row(1,'pk',120,'pubkey','pub','21'+G+'ac',4),
                 row(5,'later-a',17,'pubkeyhash','wrong-later-display',pkh(A)),
                 row(4,'bare-late',9,'Multisig 1 of 1','bare','5121'+G+'51ae'),
                 row(2,'bare-first',7,'Multisig 1 of 1','bare','5121'+G+'51ae'),
                 row(4,'wsh-late',8,'witness_v0_scripthash','wsh','0020'+'55'*32),
                 row(2,'wsh-first',6,'witness_v0_scripthash','wsh','0020'+'55'*32)]
        self.add_source(entries)
        with self.conn,self.conn.cursor() as cur:
            cur.execute('INSERT INTO exposed_keyhash20 VALUES(%s,1)',(bytes.fromhex(key),))
            for h,tx,v,value,address,kind,script,spent in entries:
                if kind in ('pubkey','pubkeyhash','witness_v0_keyhash'):
                    cur.execute('INSERT INTO active_key_outputs VALUES(%s,%s,%s,%s,%s,%s,%s,%s)',
                        (bytes.fromhex(A if tx=='later-a' else key),h,tx,v,value,kind,spent,address))
                else:
                    table='active_bare_ms_outputs' if kind.startswith('Multisig') else 'active_p2wsh_outputs'
                    cur.execute(f'INSERT INTO {table} VALUES(%s,%s,%s,%s,%s,%s)',(h,tx,v,value,spent,address))
        self.seed();expected=self.states()
        self.assertEqual(expected[(key,'P2PKH')]['display_group_id'],'earliest-display')
        self.assertFalse(store.rollback_to(self.conn,4));store.reset_projection(self.conn,confirm_anchor_hash=f'{5:064x}')
        store.migrate_physical(self.conn);store.migrate_physical(self.conn)
        store.initialize_seed(self.conn,5,f'{5:064x}')
        store.bootstrap_step(self.conn,limit=1,source_table='active_key_outputs')
        prefix=self.states()
        self.assertEqual(prefix[(A,'P2PKH')]['balance_sats'],500)
        for table in store.LEGACY: store.enable_physical_bootstrap(self.conn,table,blocks_per_page=1)
        store.enable_physical_bootstrap(self.conn,'active_key_outputs',blocks_per_page=1)
        status=store.projection_status(self.conn)
        key_cursor=next(r for r in status['physical_cursors'] if r['source_table']=='active_key_outputs')
        self.assertEqual((key_cursor['cutoff_height'],key_cursor['cutoff_txid'],key_cursor['cutoff_vout']),(1,'a',0))
        for _ in range(70):
            if all(r['complete'] for r in store.projection_status(self.conn)['cursors']):
                with self.conn,self.conn.cursor() as cur:
                    cur.execute("SELECT blockheight,transactionid,display_group_id FROM quantum_v2.bootstrap_display_origin WHERE group_id=%s AND script_type='P2PKH'",(key,))
                    self.assertEqual(cur.fetchone(),(2,'first','earliest-display'))
                    cur.execute("SELECT count(*) FROM quantum_v2.bootstrap_display_origin WHERE group_id=%s AND script_type='P2PKH'",(A,))
                    self.assertEqual(cur.fetchone()[0],0)
                self.assertTrue(store.bootstrap_step(self.conn,limit=1))
                break
            self.assertFalse(store.bootstrap_step(self.conn,limit=1))
        else:self.fail('Dense physical ranges did not finish')
        self.assertEqual(expected,self.states())
        self.assertEqual(len(store.projection_status(self.conn)['physical_cursors']),5)
        with self.conn,self.conn.cursor() as cur:
            cur.execute('SELECT count(*) FROM quantum_v2.bootstrap_display_origin')
            self.assertEqual(cur.fetchone()[0],0)
            cur.execute("SELECT rows_processed FROM quantum_v2.bootstrap_cursor WHERE source_table='active_key_outputs'")
            processed=cur.fetchone()[0]
            cur.execute('SELECT count(*) FROM active_key_outputs')
            self.assertEqual(processed,cur.fetchone()[0])
        self.assertTrue(store.bootstrap_step(self.conn,limit=1))

    def _start_physical_keys(self):
        store.migrate_physical(self.conn)
        store.initialize_seed(self.conn,5,f'{5:064x}')
        store.enable_physical_bootstrap(self.conn,'active_key_outputs',blocks_per_page=1)

    def test_physical_page_interruption_rolls_back_state_origins_and_both_cursors(self):
        self._start_physical_keys()
        before=store.projection_status(self.conn)
        with mock.patch.object(store,'_save_states',side_effect=RuntimeError('interrupted after SQL reducer')):
            with self.assertRaisesRegex(RuntimeError,'interrupted'):
                store.bootstrap_step(self.conn,limit=1,source_table='active_key_outputs')
        self.assertEqual(before,store.projection_status(self.conn))
        self.assertEqual(self.states(),{})
        with self.conn,self.conn.cursor() as cur:
            cur.execute('SELECT count(*) FROM quantum_v2.bootstrap_display_origin')
            self.assertEqual(cur.fetchone()[0],0)
            cur.execute("SELECT to_regclass('pg_temp.quantum_seed_page')")
            self.assertIsNone(cur.fetchone()[0])
        store.bootstrap_step(self.conn,limit=1,source_table='active_key_outputs')
        self.assertEqual(self.states()[(A,'P2PKH')]['balance_sats'],500)
        after=store.projection_status(self.conn)
        self.assertEqual(after['physical_cursors'][0]['next_tid'],'(0,1)')

    def test_physical_rewrite_requires_reseed_and_reset_clears_helpers(self):
        self._start_physical_keys()
        store.bootstrap_step(self.conn,limit=1,source_table='active_key_outputs')
        before=self.states();cursor=store.projection_status(self.conn)['physical_cursors']
        with self.conn,self.conn.cursor() as cur:
            cur.execute('CLUSTER active_key_outputs USING active_key_outputs_pkey')
        with self.assertRaises(store.PhysicalSeedChanged):
            store.bootstrap_step(self.conn,limit=1,source_table='active_key_outputs')
        self.assertEqual(before,self.states())
        status=store.projection_status(self.conn)
        self.assertEqual(status['projection']['status'],'needs_reseed')
        self.assertEqual(status['physical_cursors'],cursor)
        store.reset_projection(self.conn,confirm_anchor_hash=f'{5:064x}')
        self.assertEqual(store.projection_status(self.conn)['physical_cursors'],[])
        with self.conn,self.conn.cursor() as cur:
            cur.execute('SELECT count(*) FROM quantum_v2.bootstrap_display_origin')
            self.assertEqual(cur.fetchone()[0],0)

    def test_physical_heap_growth_requires_reseed(self):
        self._start_physical_keys()
        with self.conn,self.conn.cursor() as cur:
            cur.execute('''INSERT INTO active_key_outputs
                SELECT keyhash20,blockheight,'growth-'||n,vout,amount,script_type,spendingblock,address
                FROM active_key_outputs CROSS JOIN generate_series(1,1000) n WHERE transactionid='a' ''')
        with self.assertRaises(store.PhysicalSeedChanged):
            store.bootstrap_step(self.conn,limit=1,source_table='active_key_outputs')
        self.assertEqual(store.projection_status(self.conn)['projection']['status'],'needs_reseed')
        self.assertEqual(self.states(),{})

    def test_physical_freeze_change_requires_reseed(self):
        self._start_physical_keys()
        with self.conn,self.conn.cursor() as cur:
            cur.execute("UPDATE analysis_freeze SET freeze_blockheight=6 WHERE name='exposed_keyhash20'")
        with self.assertRaises(store.PhysicalSeedChanged):
            store.bootstrap_step(self.conn,limit=1,source_table='active_key_outputs')
        self.assertEqual(store.projection_status(self.conn)['projection']['status'],'needs_reseed')

    def test_physical_duplicate_occurrences_cannot_bypass_unique_identity_guard(self):
        self._start_physical_keys()
        with self.conn,self.conn.cursor() as cur:
            cur.execute('ALTER TABLE active_key_outputs DROP CONSTRAINT active_key_outputs_pkey')
            cur.execute("INSERT INTO active_key_outputs SELECT * FROM active_key_outputs WHERE transactionid='a'")
        with self.assertRaises(store.PhysicalSeedChanged):
            store.bootstrap_step(self.conn,limit=1,source_table='active_key_outputs')
        self.assertEqual(self.states(),{})

    def test_physical_empty_prefix_ranges_advance_without_counting_prefix_twice(self):
        with self.conn,self.conn.cursor() as cur:
            cur.execute('TRUNCATE active_p2sh_outputs')
            cur.execute('ALTER TABLE active_p2sh_outputs SET(fillfactor=10)')
            cur.execute("""INSERT INTO active_p2sh_outputs
                SELECT 1,'prefix-'||lpad(n::text,4,'0'),0,1,NULL,'prefix' FROM generate_series(1,100) n""")
            cur.execute("INSERT INTO active_p2sh_outputs VALUES(4,'last',0,9,NULL,'last')")
        store.migrate_physical(self.conn);store.initialize_seed(self.conn,5,f'{5:064x}')
        store.bootstrap_step(self.conn,limit=100,source_table='active_p2sh_outputs')
        store.enable_physical_bootstrap(self.conn,'active_p2sh_outputs',blocks_per_page=1)
        before=self.states()
        store.bootstrap_step(self.conn,limit=10,source_table='active_p2sh_outputs')
        after=store.projection_status(self.conn)
        self.assertEqual(after['physical_cursors'][0]['next_tid'],'(1,0)')
        self.assertEqual(before,self.states())
        for _ in range(100):
            cursor=next(r for r in store.projection_status(self.conn)['cursors'] if r['source_table']=='active_p2sh_outputs')
            if cursor['complete']:break
            store.bootstrap_step(self.conn,limit=10,source_table='active_p2sh_outputs')
        else:self.fail('Empty physical prefix windows failed to finish')
        self.assertEqual(cursor['rows_processed'],101)
        states=self.states()
        self.assertEqual(states[('prefix','P2SH')]['balance_sats'],100)
        self.assertEqual(states[('last','P2SH')]['balance_sats'],9)

    def test_physical_relation_replacement_and_missing_relation_fail_closed(self):
        self._start_physical_keys()
        with self.conn,self.conn.cursor() as cur:
            cur.execute('ALTER TABLE active_key_outputs RENAME TO old_active_key_outputs')
            cur.execute('CREATE TABLE active_key_outputs (LIKE old_active_key_outputs INCLUDING ALL)')
            cur.execute('INSERT INTO active_key_outputs SELECT * FROM old_active_key_outputs')
        with self.assertRaises(store.PhysicalSeedChanged):
            store.bootstrap_step(self.conn,limit=1,source_table='active_key_outputs')
        self.assertEqual(store.projection_status(self.conn)['projection']['status'],'needs_reseed')
        store.reset_projection(self.conn,confirm_anchor_hash=f'{5:064x}')
        store.initialize_seed(self.conn,5,f'{5:064x}')
        store.enable_physical_bootstrap(self.conn,'active_key_outputs',blocks_per_page=1)
        with self.conn,self.conn.cursor() as cur:cur.execute('DROP TABLE active_key_outputs')
        with self.assertRaises(store.PhysicalSeedChanged):
            store.bootstrap_step(self.conn,limit=1,source_table='active_key_outputs')
        self.assertEqual(store.projection_status(self.conn)['projection']['status'],'needs_reseed')

if __name__=='__main__': unittest.main()
