#!/usr/bin/env python3
"""Scheduler installer fixtures. No launchd, production paths or database used."""
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import install_quantum_scheduler as scheduler
from quantum_worker_config import bootstrap_resource_limits, bootstrap_row_limits, effective_config, LEGACY_BOOTSTRAP_SOURCES


def acceptance():
    return {'version':'quantum-acceptance-v2','code_revision':'a'*40,'checkpoint_height':963000,'checkpoint_hash':'b'*64,
            'generation_id':'quantum-fixture-r1','website_commit':'c'*40,'standalone_commit':'d'*40,
            'active_seconds_per_boundary':1800,'peak_private_memory_bytes':4*1024**3,
            'implementation_sha256':'e'*64,'config_sha256':'f'*64,'validation_report_sha256':'1'*64,
            'control_sha256':'3'*64,
            'request_id':1,'database':'production-fixture','run_ids':['fixture-run'],
            'reviews':{kind:{'path':kind+'.json','sha256':'2'*64} for kind in ('browser','recovery','rollback')}}


class SchedulerTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='quantum-scheduler-fixture-')
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name).resolve()
        self.home=self.root/'home'
        self.home.mkdir()
        self.production=self.root/'website space $literal'
        self.standalone=self.root/'standalone space'
        self.state=self.root/'private state'
        self.python=self.root/'python space'
        self.env=self.root/'environment file'
        self.production.mkdir()
        self.standalone.mkdir()
        self.state.mkdir()
        worker=self.production/'webapps/quantum_exposure/pipeline/run_quantum_worker.py'
        worker.parent.mkdir(parents=True)
        worker.write_text('# fixture only\n')
        self.python.write_text('# fixture executable path only\n')
        self.env.write_text('FIXTURE_SECRET=never-copy-this-value\n')
        self.args=['install_quantum_scheduler.py','--production-repo',str(self.production),
                   '--standalone-repo',str(self.standalone),'--python',str(self.python),
                   '--env-file',str(self.env),'--state-dir',str(self.state)]
        self.record=self.state/'acceptance.json'
        record=acceptance()
        self.config={'production_repo':str(self.production),'standalone_repo':str(self.standalone),
                     'env_file':str(self.env),'state_dir':str(self.state)}
        record['config_sha256']=scheduler.config_fingerprint(self.config)
        self.record.write_text(json.dumps(record))

    def invoke(self,*flags,loaded=False):
        calls=[]
        def run(args,**kwargs):
            self.assertIsInstance(args,list)
            self.assertFalse(kwargs.get('shell',False))
            calls.append(args)
            return subprocess.CompletedProcess(args,0 if loaded or args[1]!='print' else 1)
        def output(args,**kwargs):
            return '' if args[1]=='status' else 'a'*40+'\n'
        with patch.object(sys,'argv',self.args+list(flags)), patch.object(Path,'home',return_value=self.home), \
                patch.object(scheduler.subprocess,'run',side_effect=run), \
                patch.object(scheduler.subprocess,'check_output',side_effect=output), redirect_stdout(io.StringIO()) as stdout:
            scheduler.main()
        return calls,stdout.getvalue()

    def test_acceptance_uses_private_gate_at_boundary(self):
        record=acceptance()
        record['peak_physical_footprint_bytes']=32*1024**3
        self.record.write_text(json.dumps(record))
        self.assertEqual(scheduler.check_acceptance(self.record)['peak_private_memory_bytes'],4*1024**3)
        for key,value in (('peak_private_memory_bytes',4*1024**3+1),('active_seconds_per_boundary',1800.01)):
            with self.subTest(key=key):
                record=acceptance()
                record[key]=value
                self.record.write_text(json.dumps(record))
                with self.assertRaisesRegex(ValueError,'over-budget'):
                    scheduler.check_acceptance(self.record)

    def test_missing_false_and_invalid_evidence_rejected(self):
        for key,value in (('version','old'),('reviews',{}),('code_revision',''),
                          ('checkpoint_hash','bad'),('generation_id','../outside'),
                          ('active_seconds_per_boundary',-1),('active_seconds_per_boundary',float('nan')),
                          ('peak_private_memory_bytes',True),('checkpoint_height',-1),
                          ('active_seconds_per_boundary',0),('peak_private_memory_bytes',0)):
            with self.subTest(key=key,value=value):
                record=acceptance()
                record[key]=value
                self.record.write_text(json.dumps(record))
                with self.assertRaises(ValueError):
                    scheduler.check_acceptance(self.record)
        record=acceptance()
        del record['standalone_commit']
        self.record.write_text(json.dumps(record))
        with self.assertRaisesRegex(ValueError,'standalone_commit'):
            scheduler.check_acceptance(self.record)

    def test_dry_run_does_not_write_or_call_launchctl(self):
        calls,output=self.invoke()
        self.assertEqual(calls,[])
        self.assertFalse((self.state/'config.json').exists())
        self.assertFalse((self.home/'Library').exists())
        self.assertFalse(json.loads(output)['enabled_requested'])

    def test_loaded_job_refuses_install_and_enable_before_writes(self):
        config=self.state/'config.json'
        config.write_text('existing configuration\n')
        for flag in ('--install','--enable'):
            with self.subTest(flag=flag), self.assertRaisesRegex(SystemExit,'already loaded'):
                self.invoke(flag,loaded=True)
            self.assertEqual(config.read_text(),'existing configuration\n')
            self.assertFalse((self.home/'Library').exists())

    def test_install_preserves_settings_and_literal_spaced_paths(self):
        source_rows={'active_key_outputs':100000,'active_p2tr_outputs':25000,
                     'active_bare_ms_outputs':5000,'other:source':5000,'canonical_blocks':1000000}
        (self.state/'config.json').write_text(json.dumps({'work_seconds':12,'label_version':'reviewed-fixture',
                                                        'bootstrap_work_seconds':180,'bootstrap_temp_buffers_mb':512,
                                                        'bootstrap_work_mem_mb':128,'bootstrap_memory_limit_bytes':8*1024**3,
                                                        'bootstrap_wal_compression':True,
                                                        'bootstrap_rows_by_source':source_rows,
                                                        'validation_rows':500,'validation_blocks':20,'reset_rows':400,
                                                        'undo_blocks':10000}))
        calls,output=self.invoke('--install')
        self.assertEqual([call[1] for call in calls],['print'])
        result=json.loads(output)
        config=json.loads(Path(result['config']).read_text())
        self.assertEqual(config['work_seconds'],12)
        self.assertEqual(config['label_version'],'reviewed-fixture')
        self.assertEqual(config['bootstrap_rows_by_source'],source_rows)
        self.assertEqual(bootstrap_resource_limits(config),{'work_seconds':180,'temp_buffers_mb':512,
                         'work_mem_mb':128,'memory_limit_bytes':8*1024**3,'wal_compression':True})
        self.assertEqual(config['undo_blocks'],10000)
        self.assertEqual((config['validation_rows'],config['validation_blocks'],config['reset_rows']),(500,20,400))
        self.assertEqual(config['env_file'],str(self.env))
        self.assertNotIn('never-copy-this-value',Path(result['config']).read_text())
        self.assertEqual(Path(result['config']).stat().st_mode & 0o777,0o600)
        plist=plistlib.loads(Path(result['plist']).read_bytes())
        self.assertEqual(plist['ProgramArguments'],[str(self.python),str(self.production/'webapps/quantum_exposure/pipeline/run_quantum_worker.py'),
                                                   '--config',str(self.state/'config.json'),'once'])
        self.assertEqual(plist['WorkingDirectory'],str(self.production))
        self.assertNotIn('never-copy-this-value',str(plist))

    def test_state_inside_published_repo_is_rejected(self):
        self.args[-1]=str(self.production/'state')
        with self.assertRaisesRegex(SystemExit,'outside published repositories'):
            self.invoke('--install')
        self.assertFalse((self.production/'state').exists())

    def test_enable_requires_evidence_before_writes(self):
        self.record.unlink()
        with self.assertRaises(FileNotFoundError):
            self.invoke('--enable')
        self.assertFalse((self.state/'config.json').exists())
        self.assertFalse((self.home/'Library').exists())

    def test_unsafe_persisted_limits_are_rejected_before_writes(self):
        config=self.state/'config.json'
        for key,value in (('memory_limit_bytes',4*1024**3+1),('work_seconds',46),
                          ('export_seconds',1801),('batch_blocks',0),('bootstrap_rows',True),
                          ('bootstrap_rows',100001),
                          ('bootstrap_work_seconds',True),('bootstrap_work_seconds',4),('bootstrap_work_seconds',301),
                          ('bootstrap_temp_buffers_mb',1025),('bootstrap_work_mem_mb',257),
                          ('bootstrap_memory_limit_bytes',16*1024**3+1),
                          ('bootstrap_wal_compression',1),('bootstrap_wal_compression','on'),
                          ('undo_blocks',True),('undo_blocks',999),('undo_blocks',10001),('undo_blocks',2016.0),
                          ('max_batch_rows',-1),('batch_pause_seconds',float('nan'))):
            with self.subTest(key=key):
                original=json.dumps({key:value})
                config.write_text(original)
                with self.assertRaisesRegex(ValueError,'Scheduler'):
                    self.invoke('--install')
                self.assertEqual(config.read_text(),original)
                self.assertFalse((self.home/'Library').exists())

    def test_default_undo_retention_is_2016_blocks(self):
        self.invoke('--install')
        self.assertEqual(json.loads((self.state/'config.json').read_text())['undo_blocks'],2016)

    def test_invalid_source_row_overrides_are_rejected_before_writes(self):
        config=self.state/'config.json'
        for overrides in (None,[],{'outputs':5000},{'reset:group_state':5000},
                          {'active_key_outputs':True},{'active_p2tr_outputs':0},
                          {'other:source':100001},{'canonical_blocks':1.5},{'canonical_blocks':1000001}):
            with self.subTest(overrides=overrides):
                original=json.dumps({'bootstrap_rows_by_source':overrides})
                config.write_text(original)
                with self.assertRaisesRegex(ValueError,'Scheduler'):
                    self.invoke('--install')
                self.assertEqual(config.read_text(),original)
                self.assertFalse((self.home/'Library').exists())

    def test_explicit_label_revision_replaces_preserved_setting(self):
        (self.state/'config.json').write_text(json.dumps({'label_version':'previous'}))
        self.invoke('--install','--label-version','reviewed-next')
        self.assertEqual(json.loads((self.state/'config.json').read_text())['label_version'],'reviewed-next')

    def test_symlinked_config_does_not_overwrite_another_file(self):
        target=self.root/'operator file'
        target.write_text('preserve this\n')
        (self.state/'config.json').symlink_to(target)
        with self.assertRaisesRegex(SystemExit,'symlinked'):
            self.invoke('--install')
        self.assertEqual(target.read_text(),'preserve this\n')

    def test_enable_uses_scoped_argv_and_checked_code(self):
        calls,output=self.invoke('--enable')
        self.assertTrue(json.loads(output)['enabled_requested'])
        self.assertIn(['git','merge-base','--is-ancestor','a'*40,'a'*40],calls)
        bootstrap=next(call for call in calls if call[:2]==['launchctl','bootstrap'])
        self.assertEqual(len(bootstrap),4)
        self.assertEqual(bootstrap[-1],str(self.home/'Library/LaunchAgents'/f'{scheduler.LABEL}.plist'))
        enable=next(call for call in calls if call[:2]==['launchctl','enable'])
        self.assertLess(calls.index(enable),calls.index(bootstrap))
        verify=next(call for call in calls if call[0]==str(self.python))
        self.assertIn('quantum_acceptance.py',verify[1])
        self.assertLess(calls.index(verify),calls.index(enable))

    def test_changed_preserved_config_refuses_enable_before_writes(self):
        config=self.state/'config.json'
        config.write_text(json.dumps({'batch_blocks':11}))
        with self.assertRaisesRegex(SystemExit,'effective configuration'):
            self.invoke('--enable')
        self.assertEqual(json.loads(config.read_text()),{'batch_blocks':11})
        self.assertFalse((self.home/'Library').exists())

    def test_disk_reserve_is_preserved_and_cannot_be_disabled_for_enablement(self):
        self.invoke('--install')
        config=self.state/'config.json'
        self.assertEqual(json.loads(config.read_text())['disk_reserve_bytes'],512*1024**3)
        config.write_text(json.dumps({'disk_reserve_bytes':700*1024**3}))
        self.invoke('--install')
        self.assertEqual(json.loads(config.read_text())['disk_reserve_bytes'],700*1024**3)
        for value in (-1,True,1.5):
            config.write_text(json.dumps({'disk_reserve_bytes':value}))
            with self.assertRaisesRegex(ValueError,'disk_reserve_bytes'):
                self.invoke('--install')
        config.write_text(json.dumps({'disk_reserve_bytes':0}))
        with self.assertRaisesRegex(SystemExit,'positive disk reserve'):
            self.invoke('--enable')
        self.assertEqual(json.loads(config.read_text())['disk_reserve_bytes'],0)

    def test_failed_database_evidence_verification_never_installs(self):
        calls=[]
        def run(args,**kwargs):
            calls.append(args)
            code=1 if args[:2]==['launchctl','print'] or args[0]==str(self.python) else 0
            return subprocess.CompletedProcess(args,code,stdout='',stderr='bootstrap incomplete')
        with patch.object(sys,'argv',self.args+['--enable']), patch.object(Path,'home',return_value=self.home), \
                patch.object(scheduler.subprocess,'run',side_effect=run), \
                patch.object(scheduler.subprocess,'check_output',side_effect=lambda args,**kw: '' if args[1]=='status' else 'a'*40), \
                self.assertRaisesRegex(SystemExit,'bootstrap incomplete'):
            scheduler.main()
        self.assertFalse((self.state/'config.json').exists())
        self.assertFalse((self.home/'Library').exists())
        self.assertFalse(any(call[:2]==['launchctl','enable'] for call in calls))


class BootstrapConfigurationTests(unittest.TestCase):
    def test_resource_defaults_and_short_inherited_budgets(self):
        defaults={'work_seconds':45,'temp_buffers_mb':8,'work_mem_mb':32,'memory_limit_bytes':4*1024**3,
                  'wal_compression':False}
        self.assertEqual(bootstrap_resource_limits({}),defaults)
        for seconds in (0,0.2,0.5,3,45,3600,3600.5):
            self.assertEqual(bootstrap_resource_limits({'work_seconds':seconds})['work_seconds'],seconds)
            self.assertEqual(effective_config({'work_seconds':seconds})['work_seconds'],seconds)
        self.assertEqual(bootstrap_resource_limits({'memory_limit_bytes':2*1024**3})['memory_limit_bytes'],2*1024**3)

    def test_explicit_resource_bounds_reject_types_and_nonfinite_values(self):
        bounds={'bootstrap_work_seconds':(5,300), 'bootstrap_temp_buffers_mb':(8,1024),
                'bootstrap_work_mem_mb':(32,256), 'bootstrap_memory_limit_bytes':(1024**3,16*1024**3)}
        for key,(low,high) in bounds.items():
            for value in (low,high):
                self.assertEqual(bootstrap_resource_limits({key:value})[key.removeprefix('bootstrap_')],value)
            for value in (False,True,None,str(low),float(low),low-1,high+1,float('nan'),float('inf')):
                with self.subTest(key=key,value=value),self.assertRaisesRegex(ValueError,key):
                    bootstrap_resource_limits({key:value})

    def test_wal_compression_requires_an_explicit_boolean(self):
        for value in (False,True):
            self.assertIs(bootstrap_resource_limits({'bootstrap_wal_compression':value})['wal_compression'],value)
        for value in (0,1,None,'on','off','true',1.0):
            with self.subTest(value=value),self.assertRaisesRegex(ValueError,'bootstrap_wal_compression'):
                bootstrap_resource_limits({'bootstrap_wal_compression':value})

    def test_only_canonical_administration_accepts_larger_pages(self):
        config={'bootstrap_rows':50000,'bootstrap_rows_by_source':{'canonical_blocks':1000000,'active_key_outputs':100000}}
        self.assertEqual(bootstrap_row_limits(config),(50000,{'canonical_blocks':1000000,'active_key_outputs':100000}))
        self.assertEqual(bootstrap_row_limits(config,bootstrap_only=False),
                         (50000,{'canonical_blocks':100000,'active_key_outputs':100000}))
        self.assertEqual(config['bootstrap_rows_by_source']['canonical_blocks'],1000000)
        for source in LEGACY_BOOTSTRAP_SOURCES+('other:source',):
            with self.subTest(source=source),self.assertRaises(ValueError):
                bootstrap_row_limits({'bootstrap_rows_by_source':{source:100001}})
        for value in (True,0,1.0,'500000',1000001):
            with self.subTest(value=value),self.assertRaises(ValueError):
                bootstrap_row_limits({'bootstrap_rows_by_source':{'canonical_blocks':value}})

    def test_fingerprint_covers_tuning_without_changing_routine_defaults(self):
        baseline=scheduler.config_fingerprint({})
        defaults=effective_config({})
        for key,value in (('bootstrap_work_seconds',180),('bootstrap_temp_buffers_mb',512),
                          ('bootstrap_work_mem_mb',128),('bootstrap_memory_limit_bytes',8*1024**3),
                          ('bootstrap_wal_compression',True),
                          ('bootstrap_rows_by_source',{'canonical_blocks':500000})):
            config={key:value}
            self.assertNotEqual(baseline,scheduler.config_fingerprint(config))
            for normal in ('work_seconds','memory_limit_bytes','batch_blocks','max_batch_rows','validation_rows'):
                self.assertEqual(effective_config(config)[normal],defaults[normal])
        explicit={key:defaults[key] for key in defaults if key.startswith('bootstrap_')}
        self.assertEqual(baseline,scheduler.config_fingerprint(explicit))


if __name__=='__main__':
    unittest.main()
