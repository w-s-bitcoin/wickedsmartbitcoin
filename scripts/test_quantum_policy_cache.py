#!/usr/bin/env python3
"""Durable policy cache integration; explicit isolated PostgreSQL fixture only."""
from dataclasses import replace
import hashlib
import os
from pathlib import Path
import sys
import unittest
from unittest import mock

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'webapps/quantum_exposure/pipeline'))
import quantum_v2_enrichment as enrichment
try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
    import quantum_v2_store as store
except ImportError:
    psycopg2=None
import test_quantum_canonical_reducer as canonical
DSN=os.getenv('QUANTUM_ANALYSIS_TEST_DSN','')
PUB='0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
POLICY='5121'+PUB+'51ae'
INVALID='5151ae'


class PureCacheBinding(unittest.TestCase):
    def result(self):
        return enrichment.PolicyParse(hashlib.sha256(bytes.fromhex(POLICY)).hexdigest(),enrichment.PARSER_VERSION,
            enrichment.BARE_EVIDENCE_SHA256,'bare','recognized',1,1,(bytes.fromhex(PUB),))
    def test_exact_script_and_parser_binding(self):
        result=self.result();self.assertTrue(result.bare_eligible(POLICY))
        for bad in (replace(result,locking_script_sha256='00'*32),replace(result,parser_version='wrong'),
                    replace(result,evidence_sha256='ff'*32),replace(result,policy_kind='committed'),
                    replace(result,public_keys=(b'\x02'+b'\xff'*32,))):
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):bad.bare_eligible(POLICY)
    def test_unresolved_has_no_threshold_or_keys(self):
        result=replace(self.result(),status='unresolved',m=None,n=None,public_keys=())
        self.assertFalse(result.bare_eligible(POLICY))
        with self.assertRaises(ValueError):replace(result,m=1).bare_eligible(POLICY)


@unittest.skipUnless(DSN and psycopg2,'Set QUANTUM_ANALYSIS_TEST_DSN for an isolated PostgreSQL fixture')
class PolicyCacheDatabase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        opts=psycopg2.extensions.parse_dsn(DSN)
        if not opts.get('dbname','').endswith('_fixture') or not opts.get('host','').startswith(('/tmp/','/private/tmp/')):
            raise RuntimeError('Refusing destructive fixture setup outside /tmp socket + *_fixture database')
        cls.conn=psycopg2.connect(DSN)
    @classmethod
    def tearDownClass(cls):cls.conn.close()
    def setUp(self):
        canonical.CanonicalReducer.setUp(self)
        enrichment.migrate(self.conn)
    insert=canonical.CanonicalReducer.insert
    capture=canonical.CanonicalReducer.capture
    seed=canonical.CanonicalReducer.seed
    def cached(self,requests):
        with self.conn,self.conn.cursor(cursor_factory=RealDictCursor) as cur:
            return enrichment.cache_policy_batch(cur,requests)
    def records(self):
        with self.conn,self.conn.cursor() as cur:
            cur.execute('SELECT locking_script_sha256,parser_version,evidence_sha256,parse_status,source_height,source_reference,xmin::text FROM quantum_v2.policy_parse_cache ORDER BY 1,2,3')
            return cur.fetchall()
    def test_bare_positive_negative_deduplicated_and_reused_without_parser(self):
        requests=[dict(policy_kind='bare',locking_script=raw,source_height=19,source_reference='first') for raw in (POLICY,INVALID,POLICY)]
        with mock.patch.object(enrichment,'parse_multisig',wraps=enrichment.parse_multisig) as parse:
            initial=self.cached(requests)
            self.assertEqual(parse.call_count,2)
        self.assertEqual([p.status for p in initial],['recognized','unresolved','recognized'])
        before=self.records()
        with mock.patch.object(enrichment,'parse_multisig',side_effect=AssertionError('warm policy reparsed')):
            warm=self.cached([dict(request,source_height=1,source_reference='later-evidence') for request in requests])
        self.assertEqual(initial,warm);self.assertEqual(before,self.records())
    def test_committed_negative_changes_with_evidence_and_bare_domain(self):
        locking='0020'+hashlib.sha256(bytes.fromhex(POLICY)).hexdigest()
        first=self.cached([dict(locking_script=locking)])[0]
        second=self.cached([dict(locking_script=locking,spending_witness=POLICY)])[0]
        self.assertEqual((first.status,second.status),('unresolved','recognized'))
        self.assertNotEqual(first.evidence_sha256,second.evidence_sha256)
        old=self.cached([dict(locking_script=POLICY)])[0]
        bare=self.cached([dict(policy_kind='bare',locking_script=POLICY)])[0]
        self.assertEqual((old.status,bare.status),('unresolved','recognized'))
        self.assertNotEqual(old.evidence_sha256,bare.evidence_sha256)
        self.assertEqual(len(self.records()),4)
    def test_parser_version_is_a_cache_miss(self):
        request=dict(policy_kind='bare',locking_script=POLICY)
        first=self.cached([request])[0]
        with mock.patch.object(enrichment,'PARSER_VERSION','fixture-new-parser'),mock.patch.object(enrichment,'parse_multisig',wraps=enrichment.parse_multisig) as parse:
            second=self.cached([request])[0]
            self.assertEqual(parse.call_count,1)
        self.assertNotEqual(first.parser_version,second.parser_version);self.assertEqual(len(self.records()),2)
    def test_canonical_seed_cache_dates_never_replace_source_dates_and_delta_hits(self):
        self.cached([dict(policy_kind='bare',locking_script=POLICY,source_height=19,source_reference='unrelated-cache-observation')])
        rows=[canonical.row(2,'bare-first',100,'Multisig 1 of 1',None,POLICY),
              canonical.row(3,'bad-first',77,'Multisig legacy',None,INVALID)]
        self.insert(rows)
        with mock.patch.object(enrichment,'parse_multisig',wraps=enrichment.parse_multisig) as parse:
            self.seed(anchor=5,limit=1);self.assertEqual(parse.call_count,1,'Only the previously unseen unresolved script is parsed')
        self.assertEqual(self.capture(),canonical.python_oracle(rows,5,self.hashes))
        g='script:'+hashlib.sha256(bytes.fromhex(POLICY)).hexdigest()
        self.assertEqual(self.capture()[0][(g,'Other')]['first_disclosure_height'],2)
        before=self.records()
        new=canonical.row(6,'bare-later',200,'Multisig 1 of 1',None,POLICY);self.insert([new])
        with mock.patch.object(enrichment,'parse_multisig',side_effect=AssertionError('delta repeated cached bare parse')):
            store.apply_range(self.conn,8)
        self.assertEqual(self.records(),before)
        self.assertEqual(self.capture(),canonical.python_oracle(rows+[new],8,self.hashes))
    def test_cold_cached_seed_and_no_cache_seed_have_identical_state(self):
        rows=[canonical.row(2,'a',100,'Multisig 1 of 1','bare',POLICY),
              canonical.row(3,'b',200,'Multisig legacy','invalid',INVALID)]
        self.insert(rows)
        with mock.patch.object(store,'_cached_bare_policies',return_value={}):self.seed(anchor=5,limit=1)
        expected=self.capture()
        with self.conn,self.conn.cursor() as cur:
            cur.execute('TRUNCATE quantum_v2.group_state,quantum_v2.disclosure,quantum_v2.bootstrap_cursor,quantum_v2.projection')
        self.seed(anchor=5,limit=1)
        self.assertEqual(self.capture(),expected);self.assertEqual(len(self.records()),2)
    def test_cache_and_projection_roll_back_together_on_late_failure(self):
        self.insert([canonical.row(2,'a',100,'Multisig 1 of 1','bare',POLICY)])
        store.initialize_source_seed(self.conn,5,self.hashes[5])
        with mock.patch.object(store,'_reduce_canonical_seed_page',side_effect=RuntimeError('late failure')):
            with self.assertRaisesRegex(RuntimeError,'late failure'):store.bootstrap_step(self.conn,limit=5)
        self.assertEqual(self.records(),[]);self.assertEqual(self.capture(),({},{}))
        self.assertEqual(store.projection_status(self.conn)['cursors'][0]['rows_processed'],0)
    def test_missing_applied_cache_fails_closed_but_store_only_fallback_survives(self):
        rows=[canonical.row(2,'a',100,'Multisig 1 of 1','bare',POLICY)];self.insert(rows)
        with self.conn,self.conn.cursor() as cur:cur.execute('DROP TABLE quantum_v2.policy_parse_cache')
        store.initialize_source_seed(self.conn,5,self.hashes[5])
        with self.assertRaisesRegex(store.StoreError,'migration003'):store.bootstrap_step(self.conn,limit=5)
        with self.conn,self.conn.cursor() as cur:cur.execute('DELETE FROM quantum_v2.schema_migration WHERE version=3')
        while not store.bootstrap_step(self.conn,limit=5):pass
        self.assertEqual(self.capture(),canonical.python_oracle(rows,5,self.hashes))
    def test_batch_queries_scale_with_unique_scripts_not_output_rows(self):
        class RecordingCursor(RealDictCursor):
            statements=[]
            def execute(cur,statement,params=None):
                cur.statements.append(statement.decode() if isinstance(statement,bytes) else str(statement))
                return super().execute(statement,params)
        rows=[canonical.row(2,f'{i:04}',1,'Multisig legacy',None,POLICY if i%2 else INVALID) for i in range(5000)]
        with self.conn,self.conn.cursor(cursor_factory=RecordingCursor) as cur:
            parsed=store._cached_bare_policies(cur,rows);cold=len(cur.statements)
            self.assertEqual(set(parsed),{POLICY,INVALID});self.assertEqual(cold,4)
            cur.statements.clear();store._cached_bare_policies(cur,rows);self.assertEqual(len(cur.statements),3)
        self.assertEqual(len(self.records()),2)
    def test_unique_script_chunks_stay_bounded(self):
        # Distinct well-formed hex with invalid policies gives persistent negative
        # cache coverage without manufacturing thousands of expensive curve keys.
        rows=[canonical.row(2,f'{i:04}',1,'Multisig legacy',None,'51'+f'{i:04x}'+'51ae') for i in range(2050)]
        with self.conn,self.conn.cursor(cursor_factory=RealDictCursor) as cur:
            result=store._cached_bare_policies(cur,rows)
        self.assertEqual(len(result),2050);self.assertEqual(len(self.records()),2050)
        self.assertTrue(all(value.status=='unresolved' for value in result.values()))
    def test_unbound_classifier_override_rejected(self):
        row=canonical.row(2,'a',1,'Multisig 1 of 1',None,POLICY)
        with self.assertRaisesRegex(store.StoreError,'bound parser-cache'):
            store.identify(row,bare_policy={'status':'recognized'})
        unrelated=self.cached([dict(policy_kind='bare',locking_script=INVALID)])[0]
        with self.assertRaisesRegex(ValueError,'exact locking script'):
            store.identify(row,bare_policy=unrelated)

if __name__=='__main__':unittest.main()
