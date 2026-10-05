#!/usr/bin/env python3
"""Pure alias tests plus opt-in isolated PostgreSQL enrichment regressions."""
import csv
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

PIPELINE=Path(__file__).resolve().parents[1]/'webapps/quantum_exposure/pipeline'
sys.path.insert(0,str(PIPELINE))
import quantum_v2_enrichment as e
PUBKEY='0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
KEYHASH='751e76e8199196d454941c45d1b3a323f1433bd6'
DSN=os.environ.get('QUANTUM_ANALYSIS_TEST_DSN')


class AliasTests(unittest.TestCase):
    def test_serialization_and_address_aliases(self):
        for display in (PUBKEY,'1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH','bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'):
            self.assertIn(KEYHASH,e.subject_aliases({'display_group_ids':display}))
        self.assertEqual(e.subject_aliases({'group_id':'g','display_group_ids':'x|y'}),{'g','x','y'})

    def test_invalid_address_checksum_not_promoted(self):
        self.assertNotIn(KEYHASH,e.subject_aliases({'display_group_ids':'1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMJ'}))
        self.assertNotIn(KEYHASH,e.subject_aliases({'display_group_ids':'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5'}))


@unittest.skipUnless(DSN,'explicit disposable QUANTUM_ANALYSIS_TEST_DSN required')
class EnrichmentDatabaseTests(unittest.TestCase):
    def setUp(self):
        import psycopg2
        self.conn=psycopg2.connect(DSN)
        with self.conn.cursor() as cur:
            cur.execute('SELECT current_database()')
            if not cur.fetchone()[0].endswith('_fixture'):
                raise RuntimeError('Database name must end _fixture')
            cur.execute('CREATE SCHEMA quantum_v2')
            cur.execute('CREATE TABLE quantum_v2.schema_migration(version integer PRIMARY KEY,sha256 text,applied_at timestamptz DEFAULT now())')
        self.conn.commit()
        e.migrate(self.conn)
        self.tmp=tempfile.TemporaryDirectory()
        self.csv=Path(self.tmp.name)/'labels.csv'

    def tearDown(self):
        self.conn.rollback()
        with self.conn.cursor() as cur:
            cur.execute('DROP SCHEMA quantum_v2 CASCADE')
        self.conn.commit()
        self.conn.close()
        self.tmp.cleanup()

    def write(self,rows):
        with self.csv.open('w',newline='') as stream:
            writer=csv.DictWriter(stream,fieldnames=['group_id','display_group_ids','identity','details'])
            writer.writeheader();writer.writerows(rows)

    def test_import_revision_is_idempotent_and_export_alias_resolves(self):
        self.write([dict(group_id='',display_group_ids=PUBKEY,identity='Curated owner',details='1-of-1 multisig')])
        result=e.import_snapshot_labels(self.conn,self.csv,revision='r1')
        self.assertEqual(result['subjects'],2)
        self.assertTrue(e.import_snapshot_labels(self.conn,self.csv,revision='r1')['already_imported'])
        from unittest import mock
        with mock.patch.object(e,'subject_aliases',side_effect=AssertionError('Export repeated address/key decoding')):
            rows=list(e.iter_enriched_rows(self.conn,[dict(group_id=KEYHASH,display_group_id=PUBKEY,script_type='P2PKH')],revision='r1'))
        self.assertEqual(rows[0]['identity'],'Curated owner')
        self.assertEqual(rows[0]['details_quality'],'legacy-annotation')
        self.conn.rollback()
        self.write([dict(group_id='g',display_group_ids='g',identity='different',details='')])
        with self.assertRaisesRegex(ValueError,'cannot be overwritten'):
            e.import_snapshot_labels(self.conn,self.csv,revision='r1')

    def test_alias_conflict_rolls_back(self):
        self.write([dict(group_id='g',display_group_ids='a',identity='one',details=''),
                    dict(group_id='g',display_group_ids='b',identity='two',details='')])
        with self.assertRaisesRegex(ValueError,'conflict'):
            e.import_snapshot_labels(self.conn,self.csv,revision='conflict')
        with self.conn.cursor() as cur:
            cur.execute('SELECT COUNT(*) FROM quantum_v2.enrichment_revision')
            self.assertEqual(cur.fetchone()[0],0)

    def test_empty_label_fields_remain_empty_text(self):
        self.write([dict(group_id='identity-only',display_group_ids='identity-only',identity='unidentified',details=''),
                    dict(group_id='details-only',display_group_ids='details-only',identity='',details='reviewed note')])
        e.import_snapshot_labels(self.conn,self.csv,revision='empty-fields')
        with self.conn,self.conn.cursor() as cur:
            cur.execute('SELECT subject_id,identity,details FROM quantum_v2.attribution ORDER BY subject_id')
            self.assertEqual(cur.fetchall(),[('details-only','','reviewed note'),('identity-only','unidentified','')])

    def test_grouped_detail_enrichment_matches_raw_export_and_skips_ineligible_lookups(self):
        import psycopg2.extensions
        import quantum_v2_analysis as analysis
        self.write([
            dict(group_id='10-small',display_group_ids='small',identity='Small label',details='small details'),
            dict(group_id='20-unexposed',display_group_ids='unexposed',identity='Unexposed label',details='unexposed details'),
            dict(group_id='',display_group_ids=PUBKEY,identity='Combined owner',details='mixed family note'),
            dict(group_id='zz-identity',display_group_ids='identity-display',identity='Identity only',details=''),
        ])
        e.import_snapshot_labels(self.conn,self.csv,revision='group-detail-fixture')
        def state(group,family,amount,exposed,display):
            return dict(group_id=group,script_type=family,current_supply_sats=amount,current_utxo_count=1,
                        exposed_supply_sats=exposed,exposed_utxo_count=int(exposed>0),display_group_id=display)
        rows=[state('10-small','P2PKH',99_999_999,1,'small'),
              state('20-unexposed','P2PKH',200_000_000,0,'unexposed'),
              state(KEYHASH,'P2PK',50_000_000,50_000_000,PUBKEY),
              state(KEYHASH,'P2WPKH',60_000_000,0,'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'),
              state('zz-identity','P2PKH',100_000_000,1,'identity-display')]
        original=Path(self.tmp.name)/'raw-enriched'
        grouped=Path(self.tmp.name)/'group-enriched'
        options=dict(snapshot_height=1000,snapshot_time=1_700_000_000,label_version='group-detail-fixture')
        with self.conn:
            analysis.export_snapshot(e.iter_enriched_rows(self.conn,rows,revision='group-detail-fixture',fetch_size=2),
                                     output_dir=original,**options)
        lookups=[]
        class RecordingCursor(psycopg2.extensions.cursor):
            def execute(cursor,statement,params=None):
                if 'FROM quantum_v2.attribution' in statement:
                    lookups.append(params[1])
                return super().execute(statement,params)
        class RecordingConnection:
            def cursor(proxy):
                return self.conn.cursor(cursor_factory=RecordingCursor)
        def enrich(groups):
            return e.iter_enriched_rows(RecordingConnection(),groups,revision='group-detail-fixture',fetch_size=2,
                predicate=lambda group:group['current_supply_sats']>=100_000_000 and group['exposed_utxo_count']>0)
        with self.conn:
            analysis.export_snapshot(rows,output_dir=grouped,group_enricher=enrich,**options)
        self.assertEqual(len(lookups),1,'The first batch contains only ineligible groups and must issue no label lookup')
        self.assertEqual(set(lookups[0]),{KEYHASH,PUBKEY,'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
                                       'zz-identity','identity-display'})
        for path in (original/'1000').iterdir():
            self.assertEqual(path.read_bytes(),(grouped/'1000'/path.name).read_bytes(),path.name)
        with (grouped/'1000/dashboard_pubkeys_ge_1btc.csv').open(newline='') as stream:
            detail=list(csv.DictReader(stream))
        self.assertEqual([row['group_id'] for row in detail],[KEYHASH,'zz-identity'])
        self.assertEqual(detail[1]['details_quality'],'unresolved')

    def test_mutations_exclude_global_worker_and_allow_same_session(self):
        import psycopg2
        self.write([dict(group_id='g',display_group_ids='g',identity='fixture',details='')])
        with psycopg2.connect(DSN) as other:
            with other.cursor() as cur:
                cur.execute('SELECT pg_try_advisory_lock(811947,2)')
                self.assertTrue(cur.fetchone()[0])
            try:
                for operation in (lambda:e.migrate(self.conn),
                                  lambda:e.import_snapshot_labels(self.conn,self.csv,revision='blocked')):
                    with self.assertRaisesRegex(RuntimeError,'worker or maintenance'):
                        operation()
                with self.assertRaisesRegex(RuntimeError,'worker or maintenance'):
                    with self.conn,self.conn.cursor() as cur:
                        e.cache_committed_policy(cur,locking_script='51')
            finally:
                with other.cursor() as cur:
                    cur.execute('SELECT pg_advisory_unlock(811947,2)')
        with self.conn,self.conn.cursor() as cur:
            cur.execute('SELECT pg_try_advisory_lock(811947,2)')
            self.assertTrue(cur.fetchone()[0])
        try:
            e.migrate(self.conn)
            self.assertEqual(e.import_snapshot_labels(self.conn,self.csv,revision='owned')['subjects'],1)
        finally:
            with self.conn,self.conn.cursor() as cur:
                cur.execute('SELECT pg_advisory_unlock(811947,2)')

    def test_parser_cache_negative_evidence_does_not_poison_positive(self):
        script=bytes.fromhex('5121'+PUBKEY+'51ae')
        locking=(b'\x00\x20'+hashlib.sha256(script).digest()).hex()
        with self.conn.cursor() as cur:
            first=e.cache_committed_policy(cur,locking_script=locking,spending_witness='',source_reference='fixture')
            self.assertEqual(first['status'],'unresolved')
            second=e.cache_committed_policy(cur,locking_script=locking,spending_witness=script.hex(),source_reference='fixture')
            self.assertEqual(second['status'],'recognized')
            cached=e.cache_committed_policy(cur,locking_script=locking,spending_witness=script.hex(),source_reference='fixture')
            self.assertEqual(second,cached)
            cur.execute('SELECT COUNT(*) FROM quantum_v2.policy_parse_cache')
            self.assertEqual(cur.fetchone()[0],2)

    def test_write_does_not_commit_unrelated_transaction(self):
        with self.conn.cursor() as cur:
            cur.execute('SELECT 1')
        with self.assertRaisesRegex(ValueError,'idle connection'):
            e.migrate(self.conn)


if __name__=='__main__':
    unittest.main()
