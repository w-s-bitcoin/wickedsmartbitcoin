#!/usr/bin/env python3
"""Read-only acceptance reconciliation fixtures; no live database or launchd."""
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'webapps/quantum_exposure/pipeline'))
sys.path.insert(0,str(Path(__file__).resolve().parent))
import quantum_acceptance as acceptance
import quantum_v2_analysis as analysis
from quantum_worker_config import config_fingerprint, effective_config, control_settings, PROJECTION_ACCOUNTING_VERSION


class AcceptanceTests(unittest.TestCase):
    def setUp(self):
        self.config={'production_repo':'/fixture/website','standalone_repo':'/fixture/standalone',
                     'state_dir':'/fixture/state','env_file':'/fixture/environment'}
        self.impl='e'*64
        controls={'start_height':961000,'confirmations':6,'boundary_size':1000}
        self.report={'version':'fixture-validation','target_height':962000,'target_hash':'a'*64,'passed':True,
                     'parser_version':analysis.PARSER_VERSION,'grouping_version':analysis.GROUPING_VERSION,
                     'mismatched_group_families':0,'source_rows':50,'accounted_utxos':30,'compared_group_families':20}
        self.record={'version':acceptance.VERSION,'code_revision':'1'*40,'checkpoint_height':963000,
                     'checkpoint_hash':'b'*64,'generation_id':'measured-963000','request_id':7,'database':'measured-production',
                     'website_commit':'2'*40,'standalone_commit':'3'*40,'implementation_sha256':self.impl,
                     'config_sha256':config_fingerprint(self.config),'control_sha256':acceptance.digest(control_settings(controls)),
                     'validation_report_sha256':acceptance.digest(self.report),'run_ids':['run-1','run-2'],
                     'active_seconds_per_boundary':100.0,'peak_private_memory_bytes':1000000,
                     'reviews':{kind:{'path':kind+'.json','sha256':'4'*64} for kind in ('browser','recovery','rollback')}}
        self.snapshot={'database':'measured-production','incomplete_bootstrap':0,
                       'projection':{'status':'ready','seed_mode':'canonical','height':963000,'block_hash':'b'*64,'anchor_height':962000,
                                     'anchor_hash':'a'*64,'methodology_version':PROJECTION_ACCOUNTING_VERSION},
                       'source':{'ready':True,'committed_height':963006,'committed_hash':'d'*64},'control':controls,
                       'canonical':{962000:'a'*64,962500:'c'*64,963000:'b'*64,963006:'d'*64},
                       'request':{'id':7,'status':'complete','target_height':963000,'target_hash':'b'*64,
                                  'generation_id':'measured-963000','methodology_version':analysis.METHODOLOGY_VERSION},
                       'steps':[{'name':name,'status':'complete'} for name in ('projection','export')],
                       'validations':[{'target_height':962000,'target_hash':'a'*64,'passed':True,'report':self.report}],
                       'batches':[{'from_height':962000,'from_hash':'a'*64,'to_height':962500,'to_hash':'c'*64},
                                  {'from_height':962500,'from_hash':'c'*64,'to_height':963000,'to_hash':'b'*64}],
                       'runs':[],'deliveries':[],'accepted':[]}
        for idx,(before,after) in enumerate(((962000,962500),(962500,963000)),1):
            metric={'mode':'boundary','implementation_sha256':self.impl,'config_sha256':self.record['config_sha256'],
                    'scheduler_control':dict(controls),'wall_seconds':50.0,'peak_combined_private_memory_bytes':1000000,
                    'memory_limit_exceeded':False,'memory_measurement_error':None,
                    'minimum_free_disk_bytes':512*1024**3,
                    'observed_minimum_free_disk_bytes':{'/fixture/data':1024*1024**3},
                    'disk_reserve_exceeded':False,'disk_measurement_error':None,
                    'processes':{'1':{'private_memory_bytes':400000},'2':{'private_memory_bytes':600000}},
                    'projection_before':{'status':'ready','height':before,'block_hash':self.snapshot['canonical'][before]},
                    'projection_after':{'status':'ready','height':after,'block_hash':self.snapshot['canonical'][after]}}
            self.snapshot['runs'].append({'id':'run-'+str(idx),'status':'succeeded','finished_at':'fixture-time','error':None,'metrics':metric})
        for destination in ('website','standalone'):
            commit=self.record[destination+'_commit']
            self.snapshot['deliveries'].append({'destination':destination,'status':'complete','accepted_commit':commit})
            self.snapshot['accepted'].append({'destination':destination,'request_id':7,'target_height':963000,
                                               'target_hash':'b'*64,'generation_id':'measured-963000','accepted_commit':commit})

    def verify(self):
        return acceptance.check_snapshot(self.record,self.snapshot,self.config,self.impl,validation_version='fixture-validation')

    def test_complete_boundary_with_canonical_anchor_proof(self):
        self.assertEqual(self.verify()['active_seconds_per_boundary'],100)

    def test_legacy_seed_cannot_pass_even_with_exact_balance_proof(self):
        self.snapshot['projection']['seed_mode']='legacy'
        with self.assertRaisesRegex(ValueError,'does not certify disclosure'):
            self.verify()

    def test_same_checkpoint_proof_does_not_require_retained_anchor_journal(self):
        proof=self.snapshot['validations'][0]
        proof.update(target_height=963000,target_hash='b'*64)
        proof['report'].update(target_height=963000,target_hash='b'*64)
        self.record['validation_report_sha256']=acceptance.digest(proof['report'])
        self.snapshot['batches']=[]
        self.verify()

    def test_incomplete_or_unverified_production_cannot_pass(self):
        for field,value in (('incomplete_bootstrap',1),('validations',[]),('deliveries',[]),('accepted',[]),('steps',[]),('batches',[])):
            with self.subTest(field=field):
                previous=self.snapshot[field]
                self.snapshot[field]=value
                with self.assertRaises(ValueError): self.verify()
                self.snapshot[field]=previous

    def test_false_fixture_and_changed_source_identity_rejected(self):
        changes=(('database','fixture'),('source',{'ready':False}),('projection',{'status':'seeding'}),
                 ('canonical',{963000:'9'*64}),('control',{'boundary_size':1}))
        for field,value in changes:
            with self.subTest(field=field):
                previous=self.snapshot[field]
                self.snapshot[field]=value
                with self.assertRaises(ValueError): self.verify()
                self.snapshot[field]=previous
        self.snapshot['source']['committed_hash']=None
        del self.snapshot['canonical'][963006]
        with self.assertRaisesRegex(ValueError,'source is not ready'): self.verify()

    def test_all_runs_required_and_full_thousand_block_span(self):
        self.record['run_ids']=['run-2']
        with self.assertRaisesRegex(ValueError,'omit'): self.verify()
        self.record['run_ids']=['run-1','run-2']
        self.snapshot['runs'][0]['metrics']['projection_before']['height']=962500
        with self.assertRaisesRegex(ValueError,'1,000'): self.verify()

    def test_measured_ingestion_yields_count_every_attempt_and_cost(self):
        self.snapshot['runs'][0]['metrics']['deferred']='source_not_ready'
        self.assertEqual(self.verify()['active_seconds_per_boundary'],100)
        # A no-progress ingestion yield is valid only at the same canonical
        # checkpoint; its full time and private peak still count.
        waiting=copy.deepcopy(self.snapshot['runs'][0])
        waiting['id']='run-wait'
        metric=waiting['metrics']
        metric['projection_after']=copy.deepcopy(metric['projection_before'])
        metric['wall_seconds']=7.0
        metric['peak_combined_private_memory_bytes']=1500000
        self.snapshot['runs'].insert(0,waiting)
        self.record['run_ids'].insert(0,'run-wait')
        self.record['active_seconds_per_boundary']=107.0
        self.record['peak_private_memory_bytes']=1500000
        self.assertEqual(self.verify()['active_seconds_per_boundary'],107)
        self.record['active_seconds_per_boundary']=100.0
        with self.assertRaisesRegex(ValueError,'declared metrics differ'): self.verify()

    def test_ingestion_yield_cannot_hide_missing_or_orphaned_checkpoint(self):
        metric=self.snapshot['runs'][0]['metrics']
        metric['deferred']='source_not_ready'
        after=metric.pop('projection_after')
        with self.assertRaisesRegex(ValueError,'contiguous'): self.verify()
        metric['projection_after']=after
        after['block_hash']='f'*64
        self.snapshot['runs'][1]['metrics']['projection_before']['block_hash']='f'*64
        with self.assertRaisesRegex(ValueError,'no longer canonical'): self.verify()
        after['block_hash']='c'*64
        self.snapshot['runs'][1]['metrics']['projection_before']['block_hash']='c'*64
        metric['recovery']={'rollback_pending':True}
        with self.assertRaisesRegex(ValueError,'incomplete reorg'): self.verify()

    def test_ingestion_yield_with_missing_measurement_or_unknown_reason_rejected(self):
        metric=self.snapshot['runs'][0]['metrics']
        metric['deferred']='source_not_ready'
        metric['wall_seconds']=0
        with self.assertRaisesRegex(ValueError,'measurement'): self.verify()
        metric['wall_seconds']=50.0
        metric['deferred']='unknown'
        with self.assertRaisesRegex(ValueError,'unsupported deferred'): self.verify()

    def test_unmeasured_failed_or_different_config_attempt_rejected(self):
        changes=(('wall_seconds',0),('peak_combined_private_memory_bytes',0),('memory_measurement_error','denied'),
                 ('memory_limit_exceeded',True),('processes',{}),('config_sha256','wrong'),
                 ('implementation_sha256','wrong'),('mode','bootstrap'),('deferred','paused'),('scheduler_control',{}),
                 ('observed_minimum_free_disk_bytes',{}),('minimum_free_disk_bytes',0),
                 ('disk_reserve_exceeded',True),('disk_measurement_error','unavailable'),
                 ('observed_minimum_free_disk_bytes',{'/fixture/data':1}))
        for key,value in changes:
            with self.subTest(key=key):
                original=copy.deepcopy(self.snapshot['runs'][0]['metrics'])
                self.snapshot['runs'][0]['metrics'][key]=value
                with self.assertRaises(ValueError): self.verify()
                self.snapshot['runs'][0]['metrics']=original
        self.snapshot['runs'][0]['status']='failed'
        with self.assertRaisesRegex(ValueError,'failed'): self.verify()

    def test_metrics_are_derived_not_operator_estimates(self):
        self.record['active_seconds_per_boundary']=1
        with self.assertRaisesRegex(ValueError,'declared metrics differ'): self.verify()
        self.record['active_seconds_per_boundary']=100
        self.record['peak_private_memory_bytes']=1
        with self.assertRaisesRegex(ValueError,'declared metrics differ'): self.verify()

    def test_config_digest_is_sanitized_normalized_and_sensitive_to_measured_knobs(self):
        self.assertEqual(config_fingerprint(self.config),config_fingerprint({**self.config,'dsn':'secret','password':'secret','undo_blocks':2016}))
        self.assertNotIn('secret',json.dumps(effective_config({**self.config,'dsn':'secret'})))
        self.config['undo_blocks']=1000
        with self.assertRaisesRegex(ValueError,'configuration differs'): self.verify()

    def test_review_artifacts_must_match_bytes_and_generation(self):
        with tempfile.TemporaryDirectory() as temp:
            for kind,item in self.record['reviews'].items():
                report={key:self.record[key] for key in ('implementation_sha256','config_sha256','request_id','generation_id','checkpoint_height','checkpoint_hash')}
                report.update(kind=kind,passed=True,summary='Reviewed isolated failure and recovery evidence.')
                payload=json.dumps(report).encode()
                (Path(temp)/item['path']).write_bytes(payload)
                item['sha256']=hashlib.sha256(payload).hexdigest()
            acceptance.check_evidence(self.record,temp)
            path=Path(temp)/'browser.json'
            path.write_text(path.read_text()+' ')
            with self.assertRaisesRegex(ValueError,'hash differs'): acceptance.check_evidence(self.record,temp)
            self.record['reviews']['browser']['sha256']=hashlib.sha256(path.read_bytes()).hexdigest()
            self.record['generation_id']='a-different-generation'
            with self.assertRaisesRegex(ValueError,'another generation'): acceptance.check_evidence(self.record,temp)

    def test_real_git_receipts_and_runtime_are_checked_without_publishing(self):
        from test_quantum_immutable_generation import seed
        import immutable_generation as publication
        from quantum_runtime import sync_generation_to_standalone
        from unittest.mock import patch
        def git(repo,*args):
            return subprocess.check_output(['git','-c','commit.gpgsign=false',*args],cwd=repo,
                                           text=True,stderr=subprocess.DEVNULL).strip()
        with tempfile.TemporaryDirectory(prefix='quantum-acceptance-git-') as temp:
            root=Path(temp)
            config={**self.config,'state_dir':str(root/'state'),'production_repo':str(root/'website'),
                    'standalone_repo':str(root/'standalone')}
            output=root/'state/generations/measured-963000'
            output.mkdir(parents=True)
            record=copy.deepcopy(self.record)
            record['checkpoint_hash']='a'*64
            metadata=seed(output,963000)
            metadata.update(request_id=7,implementation_sha256=self.impl,code_revision=record['code_revision'])
            publication.publish_immutable_generation(output,metadata=metadata,generation_id=record['generation_id'],reason='fixture')
            runtime=root/'runtime/webapps/quantum_exposure'
            runtime.mkdir(parents=True)
            (runtime.parent/'shared').mkdir()
            (runtime/'dashboard.html').write_text('<script src="dashboard_app.js"></script>')
            (runtime/'dashboard_app.js').write_text('// fixture runtime\n')
            (runtime.parent/'shared/webapp_data_auto_refresh.js').write_text('// fixture refresh\n')
            for destination,key in (('website','production_repo'),('standalone','standalone_repo')):
                repo=Path(config[key]);repo.mkdir()
                git(repo,'init','--initial-branch=main')
                git(repo,'config','user.name','Fixture');git(repo,'config','user.email','fixture@example.invalid')
                sync_generation_to_standalone(output,repo,runtime_dir=runtime)
                git(repo,'add','webapps');git(repo,'commit','-m','Fixture accepted publication')
                record[destination+'_commit']=git(repo,'rev-parse','HEAD')
            snapshot={'request':{'output_dir':str(output)}}
            # Reviewed source commit may differ from the sealed automation
            # data HEAD. Their source identity is the implementation digest.
            record['code_revision']='9'*40
            with patch.object(acceptance,'check_evidence'):
                acceptance.check_files(record,snapshot,config)
                marker=Path(config['standalone_repo'])/'webapps/quantum_exposure/webapp_data/published_generation.json'
                original=marker.read_text()
                changed=json.loads(original);changed['generation_id']='unrelated'
                marker.write_text(json.dumps(changed))
                with self.assertRaisesRegex(ValueError,'current marker differs'):
                    acceptance.check_files(record,snapshot,config)
                marker.write_text(original)
                (Path(config['standalone_repo'])/'webapps/quantum_exposure/dashboard_app.js').write_text('// stale runtime')
                with self.assertRaisesRegex(ValueError,'runtime does not match'):
                    acceptance.check_files(record,snapshot,config)


if __name__=='__main__':
    unittest.main()
