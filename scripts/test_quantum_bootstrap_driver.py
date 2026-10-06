#!/usr/bin/env python3
"""Finite administrative bootstrap supervision; no implicit database access."""
import importlib.util
import copy
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from types import SimpleNamespace
from unittest import mock

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
sys.path.insert(0,str(ROOT/'webapps/quantum_exposure/pipeline'))
import run_quantum_bootstrap as driver
try:
    import psycopg2
    import test_quantum_v2_worker as fixtures
except ImportError:psycopg2=None
DSN=os.getenv('QUANTUM_BOOTSTRAP_TEST_DSN','')
BASE={'file':[1,2,3,4,5],'control':[True,'old']}


def state():
    return {'database':'fixture','projection':{'seed_mode':'canonical','status':'seeding','height':5,
       'anchor_height':5,'block_hash':'a','anchor_hash':'a'},
       'cursor':{'last_height':-1,'last_txid':'','last_vout':-1,'complete':False,'rows_processed':0},
       'database_connection_sha256':'fixture-endpoint',
       'source':{'ready':True,'committed_hash':'b','tip_hash':'b','committed_height':8},'canonical_anchor':'a'}


class DriverPureTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
    def test_explicit_finite_budget_bounds(self):
        driver.validate_budgets(86400,172800)
        for active,elapsed in [(0,10),(-1,10),(True,10),(86401,172800),(10,172801),(float('nan'),10),(10,float('inf')),(20,10)]:
            with self.subTest(active=active,elapsed=elapsed):
                with self.assertRaises(ValueError):driver.validate_budgets(active,elapsed)
    def deadline_result(self):
        pending={'nonce':'owned','deadline_monotonic':100.0}
        handoff={'nonce':'owned','child_pid':123,'backend_pid':456,'backend_start':'stamp','database':'fixture'}
        result={'nonce':'owned','event':'run_failed','exit_code':1,'run_id':'run',
            'worker_error':driver.deadline_error('owned'),'checkpoint':state(),
            'interruption':{'origin':'child_deadline_timer','nonce':'owned','child_pid':123,
                'signal':signal.SIGTERM,'deadline_monotonic':100.0,'observed_monotonic':100.01}}
        return result,pending,handoff
    def test_deadline_candidate_requires_owned_expired_signal_and_exact_failed_event(self):
        import copy
        result,pending,handoff=self.deadline_result()
        self.assertTrue(driver.deadline_candidate(result,pending,handoff,123))
        for key,value in [('origin','external_signal'),('nonce','different'),('child_pid',999),
                          ('signal',signal.SIGINT),('deadline_monotonic',99),('observed_monotonic',99.9),
                          ('observed_monotonic',float('nan'))]:
            changed=copy.deepcopy(result);changed['interruption'][key]=value
            with self.subTest(key=key,value=value):self.assertFalse(driver.deadline_candidate(changed,pending,handoff,123))
        for key,value in [('event','run_complete'),('exit_code',0),('run_id',None),
                          ('worker_error','SliceInterrupted: '),('worker_error','RuntimeError: resource limit')]:
            changed=copy.deepcopy(result);changed[key]=value
            with self.subTest(key=key):self.assertFalse(driver.deadline_candidate(changed,pending,handoff,123))
        self.assertFalse(driver.deadline_candidate(result,pending,dict(handoff,backend_pid=999,nonce='other'),123))
    @unittest.skipUnless(psycopg2,'Durable failure verifier imports psycopg2 cursor type')
    def test_verified_deadline_never_rewrites_failure_and_rejects_missing_or_breached_evidence(self):
        import copy
        result,pending,handoff=self.deadline_result()
        config_path=self.root/'config.json';driver.atomic_json(config_path,{})
        session={'implementation_sha256':'i','config_sha256':'c','config_path':str(config_path),
                 'pause_baseline':BASE,'expected_anchor':['fixture',5,'a']}
        metrics={'mode':'bootstrap','implementation_sha256':'i','config_sha256':'c','wall_seconds':45.1,
                 'memory_limit_bytes':4*1024**3,'peak_combined_private_memory_bytes':2000,
                 'memory_limit_exceeded':False,'disk_reserve_exceeded':False,
                 'memory_measurement_error':None,'disk_measurement_error':None,
                 'processes':{'123':{'private_memory_bytes':1000},'456':{'private_memory_bytes':1000}}}
        row={'id':'run','pid':123,'status':'failed','error':driver.deadline_error('owned'),
             'finished_at':'finished','metrics':metrics}
        conn=mock.MagicMock();cur=conn.cursor.return_value.__enter__.return_value
        def verify(record,**patches):
            cur.fetchone.side_effect=[(False,),record]
            with mock.patch.object(driver,'pause_state',return_value=patches.get('pause',BASE)),\
                 mock.patch.object(driver,'identities',return_value=patches.get('identities',{'implementation_sha256':'i','config_sha256':'c'})),\
                 mock.patch.object(driver,'snapshot',return_value=patches.get('snapshot',state())):
                return driver.verify_deadline_checkpoint(conn,patches.get('config',{}),session,None,None,result,pending,handoff,123)
        before=copy.deepcopy(row);proof=verify(row)
        self.assertEqual(proof['classification'],'verified_controlled_deadline')
        self.assertEqual(proof['retained_run_status'],'failed');self.assertEqual(proof['measured_wall_seconds'],45.1)
        self.assertEqual(row,before)
        tuned=copy.deepcopy(row);tuned['metrics']['memory_limit_bytes']=8*1024**3
        self.assertIsNone(verify(tuned))
        self.assertIsNone(verify(row,config={'bootstrap_memory_limit_bytes':8*1024**3}))
        self.assertEqual(verify(tuned,config={'bootstrap_memory_limit_bytes':8*1024**3})['retained_run_status'],'failed')
        for call in cur.execute.call_args_list:
            self.assertTrue(call.args[0].lstrip().startswith('SELECT'))
        for key,value in [('mode','boundary'),('implementation_sha256','other'),('config_sha256','other'),
                          ('memory_limit_exceeded',True),('disk_reserve_exceeded',True),
                          ('memory_measurement_error','unknown'),('disk_measurement_error','unknown'),
                          ('wall_seconds',0),('peak_combined_private_memory_bytes',5*1024**3),('processes',{})]:
            changed=copy.deepcopy(row);changed['metrics'][key]=value
            with self.subTest(metric=key):self.assertIsNone(verify(changed))
        for key,value in [('pid',999),('status','succeeded'),('error','RuntimeError: source changed'),('finished_at',None)]:
            changed=copy.deepcopy(row);changed[key]=value
            with self.subTest(field=key):self.assertIsNone(verify(changed))
        self.assertIsNone(verify(row,pause={'file':[99],'control':BASE['control']}))
        self.assertIsNone(verify(row,identities={'implementation_sha256':'changed'}))
        changed=state();changed['canonical_anchor']='fork'
        with self.assertRaisesRegex(RuntimeError,'anchor changed'):verify(row,snapshot=changed)
        unready=state();unready['source']['ready']=False
        self.assertEqual(verify(row,snapshot=unready)['source_status'],'source_not_ready')
    def test_resume_budget_does_not_restart_clock_or_active_time(self):
        session={'max_active_seconds':100,'active_seconds':80,'deadline_unix':200,'last_wall_unix':150}
        self.assertEqual(driver.remaining(session,160),20)
        self.assertEqual(driver.remaining(session,195),5)
        self.assertLess(driver.remaining(session,201),0)
        with self.assertRaisesRegex(RuntimeError,'clock'):driver.remaining(session,100)

    def progress_session(self,count=0):
        session={'expected_anchor':['fixture',5,'a'],'completed_slices':1}
        driver.progress_accounting(session,'new_session')['consecutive_no_progress']=count
        return session

    def test_success_and_verified_failed_deadline_share_no_progress_streak(self):
        session=self.progress_session()
        complete={'event':'run_complete','exit_code':0,'run_id':'success'}
        controlled={'event':'run_failed','exit_code':1,'run_id':'failed',
                    'continuation':{'classification':'verified_controlled_deadline','source_status':'seeding'}}
        original=copy.deepcopy(controlled)
        for number,result in enumerate((complete,complete,controlled),1):
            observation=driver.observe_progress(session,state(),state(),result)
            self.assertEqual(observation['classification'],'no_durable_progress')
            self.assertEqual(observation['consecutive_no_progress'],number)
        self.assertEqual(controlled,original)
        self.assertEqual(session['progress_guard']['last_observation']['run_id'],'failed')

    def test_empty_window_key_rows_and_completion_each_count_as_progress(self):
        for change in ({'last_height':0},{'last_txid':'a'},{'last_vout':0},
                       {'rows_processed':1},{'complete':True}):
            with self.subTest(change=change):
                session=self.progress_session(2);after=state();after['cursor'].update(change)
                observation=driver.observe_progress(session,state(),after,{'event':'run_complete','exit_code':0})
                self.assertEqual(observation['classification'],'cursor_advanced')
                self.assertEqual(observation['previous_no_progress'],2)
                self.assertEqual(session['progress_guard']['consecutive_no_progress'],0)

    def test_source_yields_preserve_streak_even_if_endpoints_later_look_ready(self):
        for location in ('before','after','event','controlled_proof'):
            with self.subTest(location=location):
                session=self.progress_session(2);before=state();after=state()
                result={'event':'run_complete','exit_code':0}
                if location=='before':before['source']['ready']=False
                elif location=='after':after['source']['ready']=False
                elif location=='event':result['event']='source_not_ready'
                else:result={'event':'run_failed','exit_code':1,'continuation':{
                    'classification':'verified_controlled_deadline','source_status':'source_not_ready'}}
                observation=driver.observe_progress(session,before,after,result)
                self.assertEqual(observation['classification'],'source_not_ready')
                self.assertEqual(observation['previous_no_progress'],2)
                self.assertEqual(session['progress_guard']['consecutive_no_progress'],2)

    def test_unknown_failed_or_paused_work_is_not_reclassified_as_stall(self):
        for event,code in (('run_failed',1),('slice_interrupted',1),('paused',0),('already_running',0)):
            with self.subTest(event=event):
                session=self.progress_session(2);original=copy.deepcopy(session)
                self.assertIsNone(driver.observe_progress(session,state(),state(),{'event':event,'exit_code':code}))
                self.assertEqual(session,original)

    def test_committed_progress_resets_streak_without_reclassifying_failure_or_pause(self):
        for result in ({'event':'run_failed','exit_code':1},
                       {'event':'paused','exit_code':0},
                       {'event':'run_complete','exit_code':0,'supervisor_stop':'paused'},
                       {'event':'run_complete','exit_code':0,'supervisor_stop':'source_or_config_changed'}):
            with self.subTest(result=result):
                session=self.progress_session(2);after=state();after['cursor']['last_height']=0
                original=copy.deepcopy(result)
                observation=driver.observe_progress(session,state(),after,result)
                self.assertEqual(observation['classification'],'cursor_advanced')
                self.assertEqual(session['progress_guard']['consecutive_no_progress'],0)
                self.assertEqual(result,original)
                session=self.progress_session(2)
                self.assertIsNone(driver.observe_progress(session,state(),state(),result))
                self.assertEqual(session['progress_guard']['consecutive_no_progress'],2)

    def test_cursor_regression_is_an_error_even_if_another_field_advances(self):
        before=state();before['cursor'].update(last_height=2,last_txid='b',last_vout=1,rows_processed=100)
        for change in ({'last_height':1,'rows_processed':101},{'last_txid':'a'},
                       {'last_vout':0},{'rows_processed':99}):
            with self.subTest(change=change):
                after=copy.deepcopy(before);after['cursor'].update(change)
                with self.assertRaisesRegex(RuntimeError,'cursor regressed'):
                    driver.observe_progress(self.progress_session(),before,after,{'event':'run_complete','exit_code':0})

    def test_new_session_has_explicit_empty_baseline_and_does_not_reinitialize(self):
        config={'state_dir':str(self.root)};worker=mock.Mock()
        with mock.patch.object(driver,'snapshot',return_value=state()), \
             mock.patch.object(driver,'pause_state',return_value=BASE), \
             mock.patch.object(driver,'identities',return_value={'code':'unchanged'}):
            path,session=driver.new_session(self.root/'config.json',config,worker,None,None,86400,172800)
        self.assertEqual(session['progress_guard'],{'baseline':'new_session','threshold':3,
            'consecutive_no_progress':0,'last_observation':None})
        self.assertEqual(driver.read_json(path)['last_checkpoint']['cursor'],state()['cursor'])
        worker.assert_not_called()

    def test_resume_preserves_streak_and_old_journal_baseline_is_explicit(self):
        path=self.root/'session.json';config_path=self.root/'config.json'
        original={'version':driver.VERSION,'config_path':str(config_path),'max_active_seconds':100,'max_elapsed_seconds':200,
          'created_unix':1000,'deadline_unix':1200,'active_seconds':20,'expected_anchor':['fixture',5,'a'],
          'pause_baseline':BASE,'id':'fixture','code':'unchanged'}
        with mock.patch.object(driver,'identities',return_value={'code':'unchanged'}), \
             mock.patch.object(driver,'snapshot',return_value=state()), \
             mock.patch.object(driver,'pause_state',return_value=BASE):
            driver.atomic_json(path,original)
            legacy=driver.checked_session(path,config_path,{},None,None,None)
            self.assertEqual(legacy['progress_guard']['baseline'],'legacy_journal')
            self.assertEqual(legacy['progress_guard']['consecutive_no_progress'],0)
            legacy['progress_guard']['consecutive_no_progress']=2
            driver.atomic_json(path,legacy)
            self.assertEqual(driver.checked_session(path,config_path,{},None,None,None),legacy)
            legacy['progress_guard']['consecutive_no_progress']=True
            driver.atomic_json(path,legacy)
            with self.assertRaisesRegex(ValueError,'progress accounting'):
                driver.checked_session(path,config_path,{},None,None,None)

    def test_interrupted_resume_resets_only_demonstrated_commits_and_retains_charge(self):
        for advanced in (False,True):
            with self.subTest(advanced=advanced):
                session=self.progress_session(2)
                session.update(id='interrupted',status='interrupted',active_seconds=5,
                    last_checkpoint=state(),in_flight={'pid':42,'nonce':'n','reserved_seconds':10})
                path=self.root/'session.json';current=state()
                if advanced:current['cursor']['last_height']=0
                with mock.patch.object(driver,'_alive',return_value=False):
                    driver.reconcile_interrupted(session,path)
                with mock.patch.object(driver,'snapshot',return_value=current):
                    driver.reconcile_progress(None,session,path)
                saved=driver.read_json(path)
                self.assertEqual(saved['active_seconds'],17)
                self.assertEqual(saved['status'],'interrupted')
                self.assertIsNone(saved['in_flight'])
                self.assertEqual(saved['progress_guard']['consecutive_no_progress'],0 if advanced else 2)
                if advanced:
                    self.assertEqual(saved['progress_guard']['last_observation']['previous_no_progress'],2)
                    self.assertEqual(saved['last_checkpoint']['cursor'],current['cursor'])

    def run_stalled_supervisor(self,*,resume_count=None,result=None,results=None,snapshots=None):
        import io
        config_path=self.root/'config.json'
        config={'state_dir':str(self.root),'production_repo':str(ROOT),'work_seconds':45}
        driver.atomic_json(config_path,config)
        session={'version':driver.VERSION,'id':'pilot','config_path':str(config_path),
            'max_active_seconds':500,'max_elapsed_seconds':600,'active_seconds':0,
            'deadline_unix':1600,'created_unix':1000,'last_wall_unix':1000,'pause_baseline':BASE,
            'expected_anchor':['fixture',5,'a'],'initial_rows':0,'completed_slices':0,
            'last_checkpoint':state(),'in_flight':None,'code':'same',
            'stop_reason':'three_source_ready_slices_without_durable_cursor_progress'}
        progress=driver.progress_accounting(session,'new_session')
        progress['consecutive_no_progress']=resume_count or 0
        path=self.root/'bootstrap_sessions/pilot/session.json';path.parent.mkdir(parents=True)
        driver.atomic_json(path,session)
        worker=mock.MagicMock();launched=[]
        result_iter=iter(results) if results is not None else None
        def slice_work(conn,config,path,session,worker,fingerprint,seconds,lease_fd):
            launched.append(seconds);session['active_seconds']+=10
            return copy.deepcopy(next(result_iter) if result_iter is not None else
                                 result or {'event':'run_complete','exit_code':0,'run_id':str(len(launched))})
        with mock.patch.object(driver,'runtime',return_value=(worker,None)), \
             mock.patch.object(driver,'new_session',return_value=(path,session)), \
             mock.patch.object(driver,'pause_state',return_value=BASE), \
             mock.patch.object(driver,'identities',return_value={'code':'same'}), \
             mock.patch.object(driver,'snapshot',side_effect=snapshots if snapshots is not None else lambda _conn:state()), \
             mock.patch.object(driver,'supervise_slice',side_effect=slice_work), \
             mock.patch.object(driver.time,'time',return_value=1000), \
             mock.patch.object(driver.sys,'stdout',io.StringIO()):
            arguments=['--config',str(config_path),'--rest-seconds','0']
            arguments+=(['--resume',str(path)] if resume_count is not None else
                        ['--max-active-seconds','500','--max-elapsed-seconds','600'])
            code=driver.main(arguments)
        return code,launched,driver.read_json(path),path

    def test_supervisor_stops_after_three_committed_no_progress_observations(self):
        code,launched,journal,path=self.run_stalled_supervisor()
        self.assertEqual(code,1);self.assertEqual(len(launched),3)
        self.assertEqual(journal['status'],'no_progress')
        self.assertEqual(journal['stop_reason'],'three_source_ready_slices_without_durable_cursor_progress')
        self.assertEqual(journal['active_seconds'],30);self.assertEqual(journal['deadline_unix'],1600)
        self.assertEqual(journal['progress_guard']['consecutive_no_progress'],3)
        events=[json.loads(line) for line in (path.parent/'events.jsonl').read_text().splitlines()]
        self.assertEqual([e['progress']['consecutive_no_progress'] for e in events],[1,2,3])

    def test_resume_reaches_threshold_without_reset_and_terminal_resume_launches_nothing(self):
        for initial,wanted in ((2,1),(3,0)):
            with self.subTest(initial=initial),tempfile.TemporaryDirectory() as temp:
                self.root=Path(temp)
                code,launched,journal,_path=self.run_stalled_supervisor(resume_count=initial)
                self.assertEqual(code,1);self.assertEqual(len(launched),wanted)
                self.assertEqual(journal['progress_guard']['consecutive_no_progress'],3)
                self.assertEqual(journal['status'],'no_progress')

    def test_resume_observes_delayed_completion_and_clears_current_stall_reason(self):
        complete=state();complete['cursor']['complete']=True;complete['projection']['status']='ready'
        code,launched,journal,path=self.run_stalled_supervisor(
            resume_count=3,snapshots=[complete,complete,complete])
        self.assertEqual(code,0);self.assertEqual(launched,[])
        self.assertEqual(journal['status'],'bootstrap_complete')
        self.assertNotIn('stop_reason',journal)
        self.assertEqual(journal['progress_guard']['consecutive_no_progress'],0)
        self.assertEqual(journal['progress_guard']['last_observation']['previous_no_progress'],3)
        events=[json.loads(line) for line in (path.parent/'events.jsonl').read_text().splitlines()]
        self.assertEqual(events[0]['event'],'resume_cursor_advanced')

    def test_readiness_wait_and_yield_between_stalls_cannot_restart_the_allowance(self):
        complete={'event':'run_complete','exit_code':0}
        yielded={'event':'source_not_ready','exit_code':0}
        snapshots=[state() for _ in range(9)]
        snapshots[2]['source']['ready']=False
        code,launched,journal,path=self.run_stalled_supervisor(
            results=[complete,yielded,complete,complete],snapshots=snapshots)
        self.assertEqual(code,1);self.assertEqual(len(launched),4)
        self.assertEqual(journal['status'],'no_progress')
        self.assertEqual(journal['active_seconds'],40)
        events=[json.loads(line) for line in (path.parent/'events.jsonl').read_text().splitlines()]
        self.assertEqual([e['progress']['consecutive_no_progress'] for e in events],[1,1,1,2,3])
        self.assertEqual([e['progress']['classification'] for e in events],
                         ['no_durable_progress','source_not_ready_between_slices','source_not_ready',
                          'no_durable_progress','no_durable_progress'])

    def test_supervisor_preserves_genuine_failure_instead_of_counting_a_stall(self):
        code,launched,journal,_path=self.run_stalled_supervisor(result={'event':'run_failed','exit_code':1,'run_id':'failed'})
        self.assertEqual(code,1);self.assertEqual(len(launched),1)
        self.assertEqual(journal['status'],'failed')
        self.assertEqual(journal['progress_guard']['consecutive_no_progress'],0)
    def test_unusable_tail_stops_before_starting_a_child(self):
        self.assertIsNone(driver.next_slice_seconds(45,120-114.47195))
        self.assertIsNone(driver.next_slice_seconds(45,9.999))
        self.assertEqual(driver.next_slice_seconds(45,10),5)
        self.assertEqual(driver.next_slice_seconds(45,50),45)
        self.assertEqual(driver.next_slice_seconds(3,8),3)
        self.assertIsNone(driver.next_slice_seconds(3,7.999))
        for invalid in (0,-1,float('inf'),float('nan')):
            with self.assertRaises(ValueError):driver.next_slice_seconds(invalid,120)
    def test_120_second_production_schedule_never_launches_fraction_second_tail(self):
        import io
        config_path=self.root/'config.json';path=self.root/'session.json'
        config={'state_dir':str(self.root),'production_repo':str(ROOT),'work_seconds':45}
        driver.atomic_json(config_path,config)
        session={'id':'pilot','config_path':str(config_path),'max_active_seconds':120,'active_seconds':0,
            'deadline_unix':1240,'created_unix':1000,'last_wall_unix':1000,'pause_baseline':BASE,
            'expected_anchor':['fixture',5,'a'],'initial_rows':0,'completed_slices':0,'code':'same'}
        checkpoint=state();charges=iter((40.1,40.1,29.2,5.07195));launched=[];worker=mock.MagicMock()
        def slice_work(conn,config,path,session,worker,fingerprint,seconds,lease_fd):
            launched.append(seconds);session['active_seconds']+=next(charges)
            checkpoint['cursor']['rows_processed']+=100
            return {'event':'run_complete','exit_code':0,'run_id':str(len(launched))}
        with mock.patch.object(driver,'runtime',return_value=(worker,None)),\
             mock.patch.object(driver,'new_session',return_value=(path,session)),\
             mock.patch.object(driver,'pause_state',return_value=BASE),\
             mock.patch.object(driver,'identities',return_value={'code':'same'}),\
             mock.patch.object(driver,'snapshot',return_value=checkpoint),\
             mock.patch.object(driver,'supervise_slice',side_effect=slice_work),\
             mock.patch.object(driver.time,'time',return_value=1000),\
             mock.patch.object(driver.sys,'stdout',io.StringIO()):
            code=driver.main(['--config',str(config_path),'--max-active-seconds','120',
                              '--max-elapsed-seconds','240','--rest-seconds','0'])
        self.assertEqual(code,0);self.assertEqual(session['status'],'budget_exhausted')
        self.assertEqual(len(launched),4);self.assertTrue(all(seconds>=5 for seconds in launched))
        for actual,expected in zip(launched,(45,45,34.8,5.6)):self.assertAlmostEqual(actual,expected)
        self.assertAlmostEqual(session['active_seconds'],114.47195)
        self.assertEqual(driver.read_json(path)['status'],'budget_exhausted')
    def test_explicit_bootstrap_duration_controls_driver_without_changing_routine_budget(self):
        import io
        config_path=self.root/'config.json';path=self.root/'session.json'
        config={'state_dir':str(self.root),'production_repo':str(ROOT),'work_seconds':45,'bootstrap_work_seconds':180}
        driver.atomic_json(config_path,config)
        session={'id':'pilot','config_path':str(config_path),'max_active_seconds':500,'active_seconds':0,
            'deadline_unix':1600,'created_unix':1000,'last_wall_unix':1000,'pause_baseline':BASE,
            'expected_anchor':['fixture',5,'a'],'initial_rows':0,'completed_slices':0,'code':'same'}
        checkpoint=state();worker=mock.MagicMock();launched=[]
        def slice_work(conn,config,path,session,worker,fingerprint,seconds,lease_fd):
            launched.append(seconds);session['active_seconds']+=175
            checkpoint['projection']['status']='ready';checkpoint['cursor']['complete']=True
            return {'event':'run_complete','exit_code':0,'run_id':'one'}
        with mock.patch.object(driver,'runtime',return_value=(worker,None)), \
             mock.patch.object(driver,'new_session',return_value=(path,session)), \
             mock.patch.object(driver,'pause_state',return_value=BASE), \
             mock.patch.object(driver,'identities',return_value={'code':'same'}), \
             mock.patch.object(driver,'snapshot',return_value=checkpoint), \
             mock.patch.object(driver,'supervise_slice',side_effect=slice_work), \
             mock.patch.object(driver.time,'time',return_value=1000), \
             mock.patch.object(driver.sys,'stdout',io.StringIO()):
            self.assertEqual(driver.main(['--config',str(config_path),'--max-active-seconds','500',
                '--max-elapsed-seconds','600','--rest-seconds','0']),0)
        self.assertEqual(launched,[180]);self.assertEqual(session['active_seconds'],175)
        self.assertEqual(session['status'],'bootstrap_complete');self.assertEqual(config['work_seconds'],45)

    def test_invalid_explicit_duration_fails_before_connection(self):
        config=self.root/'config.json';driver.atomic_json(config,{'bootstrap_work_seconds':301})
        worker=mock.Mock()
        with mock.patch.object(driver,'runtime',return_value=(worker,None)),self.assertRaises(ValueError):
            driver.main(['--config',str(config),'--max-active-seconds','120','--max-elapsed-seconds','240'])
        worker.connect.assert_not_called()

    def test_tuned_supervisor_rejects_legacy_before_session_or_child_creation(self):
        config=self.root/'config.json'
        driver.atomic_json(config,{'state_dir':str(self.root),'production_repo':str(ROOT),
            'work_seconds':45,'bootstrap_work_seconds':180,'bootstrap_temp_buffers_mb':512,
            'bootstrap_work_mem_mb':128,'bootstrap_memory_limit_bytes':8*1024**3})
        checkpoint=state();checkpoint['projection']['seed_mode']='legacy'
        worker=mock.MagicMock()
        with mock.patch.object(driver,'runtime',return_value=(worker,None)), \
             mock.patch.object(driver,'snapshot',return_value=checkpoint), \
             mock.patch.object(driver,'supervise_slice') as launch, \
             self.assertRaisesRegex(RuntimeError,'canonical seeding/ready'):
            driver.main(['--config',str(config),'--max-active-seconds','500','--max-elapsed-seconds','600'])
        launch.assert_not_called();worker.run_once.assert_not_called()
        self.assertFalse((self.root/'bootstrap_sessions').exists())
        worker.connect.return_value.close.assert_called_once()
    def test_original_pause_can_be_bypassed_but_new_pause_or_resume_stops(self):
        self.assertFalse(driver.pause_changed(BASE,BASE))
        for current in ({'file':[9],'control':BASE['control']},{'file':BASE['file'],'control':[True,'new']},
                        {'file':None,'control':[False,'new']},{'file':None,'control':None}):
            self.assertTrue(driver.pause_changed(current,BASE))
    def test_ready_unready_and_anchor_drift_are_distinct(self):
        sample=state();self.assertEqual(driver.check_snapshot(sample,['fixture',5,'a']),'seeding')
        sample['source']['ready']=False;self.assertEqual(driver.check_snapshot(sample),'source_not_ready')
        sample['canonical_anchor']='fork'
        with self.assertRaisesRegex(RuntimeError,'anchor changed'):driver.check_snapshot(sample)
        sample=state();sample['projection']['status']='ready';sample['cursor']['complete']=True
        self.assertEqual(driver.check_snapshot(sample),'ready')
        sample['cursor']['complete']=False
        with self.assertRaisesRegex(RuntimeError,'incomplete'):driver.check_snapshot(sample)
    def test_legacy_and_advanced_projection_refused(self):
        for changes in ({'seed_mode':'legacy'},{'status':'needs_reseed'},{'height':6}):
            sample=state();sample['projection'].update(changes)
            with self.assertRaises(RuntimeError):driver.check_snapshot(sample)
        with self.assertRaisesRegex(RuntimeError,'Database'):driver.check_snapshot(state(),['other',5,'a'])
    def test_interrupted_slice_is_charged_exactly_once(self):
        path=self.root/'session.json';session={'active_seconds':5,'in_flight':{'pid':42,'nonce':'n','reserved_seconds':10}}
        with mock.patch.object(driver,'_alive',return_value=False):driver.reconcile_interrupted(session,path)
        self.assertEqual(session['active_seconds'],17);self.assertIsNone(session['in_flight'])
        driver.reconcile_interrupted(session,path);self.assertEqual(session['active_seconds'],17)
        self.assertEqual(path.stat().st_mode&0o777,0o600)
    def test_alive_previous_child_is_never_restarted_or_killed(self):
        session={'active_seconds':5,'in_flight':{'pid':42,'nonce':'n','reserved_seconds':10}}
        with mock.patch.object(driver,'_alive',return_value=True),self.assertRaisesRegex(RuntimeError,'still alive'):
            driver.reconcile_interrupted(session,self.root/'session.json')
        self.assertEqual(session['active_seconds'],5)
    def test_singleton_lock_covers_rests_and_other_sessions(self):
        with driver.session_lock(self.root):
            with self.assertRaisesRegex(RuntimeError,'Another administrative'):
                with driver.session_lock(self.root):pass
        with driver.session_lock(self.root):pass
    def test_child_inherits_session_lease_before_pid_or_backend_handoff(self):
        with driver.session_lock(self.root) as fd:
            child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(10)'],pass_fds=(fd,))
        try:
            # Simulate parent death after Popen but before either identity write.
            with self.assertRaisesRegex(RuntimeError,'Another administrative'):
                with driver.session_lock(self.root):pass
        finally:child.terminate();child.wait(timeout=3)
        with driver.session_lock(self.root):pass
    def test_delayed_child_startup_uses_parent_absolute_deadline(self):
        config=self.root/'config.json';driver.atomic_json(config,{})
        path=self.root/'session.json';deadline=time.monotonic()+10
        session={'in_flight':{'nonce':'fixture','reserved_seconds':10,'deadline_monotonic':deadline},
                 'expected_anchor':['fixture',5,'a'],'pause_baseline':BASE,'code':'same'}
        driver.atomic_json(path,session);worker=mock.MagicMock();conn=worker.connect.return_value
        conn.cursor.return_value.__enter__.return_value.fetchone.return_value=(42,'start','fixture')
        worker.run_once.return_value=0
        def slow_runtime():time.sleep(.05);return worker,None
        with mock.patch.object(driver,'runtime',side_effect=slow_runtime),mock.patch.object(driver,'identities',return_value={'code':'same'}),\
             mock.patch.object(driver,'snapshot',return_value=state()),mock.patch.object(driver.threading,'Timer'),\
             mock.patch.object(driver.signal,'signal'):
            driver.child_slice(SimpleNamespace(config=config,slice=path,nonce='fixture',slice_seconds=10))
        self.assertEqual(worker.run_once.call_args.kwargs['admin_deadline'],deadline-10/3)
        self.assertEqual(worker.connect.call_args.kwargs['connect_timeout'],5)
    def test_long_child_uses_same_bootstrap_duration_and_absolute_cleanup_reserve(self):
        config=self.root/'config.json';driver.atomic_json(config,{'work_seconds':45,'bootstrap_work_seconds':180})
        path=self.root/'session.json';deadline=time.monotonic()+180
        session={'in_flight':{'nonce':'fixture','reserved_seconds':180,'deadline_monotonic':deadline},
                 'expected_anchor':['fixture',5,'a'],'pause_baseline':BASE,'code':'same'}
        driver.atomic_json(path,session);worker=mock.MagicMock()
        worker.connect.return_value.cursor.return_value.__enter__.return_value.fetchone.return_value=(42,'start','fixture')
        worker.run_once.return_value=0
        with mock.patch.object(driver,'runtime',return_value=(worker,None)), \
             mock.patch.object(driver,'identities',return_value={'code':'same'}), \
             mock.patch.object(driver,'snapshot',return_value=state()), \
             mock.patch.object(driver.threading,'Timer'),mock.patch.object(driver.signal,'signal'):
            driver.child_slice(SimpleNamespace(config=config,slice=path,nonce='fixture',slice_seconds=180))
        self.assertEqual(worker.run_once.call_args.kwargs['admin_deadline'],deadline-5)
        self.assertTrue(worker.run_once.call_args.kwargs['bootstrap_only'])
        self.assertEqual(worker.run_once.call_args.args[1]['bootstrap_work_seconds'],180)
    def test_connection_failures_do_not_print_dsn_values(self):
        import io
        error=ValueError('invalid DSN password=secret-fixture-token')
        output=io.StringIO()
        with mock.patch.object(driver,'main',side_effect=error),mock.patch.object(driver.sys,'stderr',output):
            self.assertEqual(driver.cli([]),1)
        self.assertNotIn('secret-fixture-token',output.getvalue())
        self.assertEqual(json.loads(output.getvalue())['error_type'],'ValueError')
    def test_orphan_child_deadline_covers_uncooperative_connection_setup(self):
        config=self.root/'config.json';driver.atomic_json(config,{})
        path=self.root/'session.json'
        driver.atomic_json(path,{'in_flight':{'nonce':'orphan','reserved_seconds':.2,
                           'deadline_monotonic':time.monotonic()+.2}})
        source='''import sys,time
from types import SimpleNamespace
from pathlib import Path
sys.path.insert(0,sys.argv[1])
import run_quantum_bootstrap as driver
def blocked_connect(*args,**kwargs):
    while True:
        try:time.sleep(30)
        except Exception:pass
driver.runtime=lambda:(SimpleNamespace(connect=blocked_connect),None)
driver.identities=lambda *args:{}
driver.child_slice(SimpleNamespace(config=Path(sys.argv[2]),slice=Path(sys.argv[3]),nonce='orphan',slice_seconds=.2))
'''
        started=time.monotonic()
        process=subprocess.Popen([sys.executable,'-c',source,str(ROOT/'scripts'),str(config),str(path)])
        try:self.assertEqual(process.wait(timeout=5),124)
        finally:
            if process.poll() is None:process.kill();process.wait()
        self.assertLess(time.monotonic()-started,4)
    def test_private_journal_and_symlink_refusal(self):
        target=self.root/'session.json';driver.atomic_json(target,{'secret_free':'metadata'})
        self.assertEqual(target.stat().st_mode&0o777,0o600)
        link=self.root/'link';link.symlink_to(target)
        with self.assertRaises(ValueError):driver.atomic_json(link,{})
        with self.assertRaises(ValueError):driver.read_json(link)
    def test_backend_cancel_requires_child_nonce_database_and_start(self):
        conn=mock.MagicMock();cur=conn.cursor.return_value.__enter__.return_value;cur.fetchone.return_value=(True,)
        handoff={'nonce':'expected','child_pid':123,'backend_pid':456,'backend_start':'timestamp','database':'fixture'}
        self.assertFalse(driver.cancel_owned_backend(conn,handoff,'wrong',123));cur.execute.assert_not_called()
        self.assertFalse(driver.cancel_owned_backend(conn,handoff,'expected',124));cur.execute.assert_not_called()
        self.assertTrue(driver.cancel_owned_backend(conn,handoff,'expected',123))
        statement,values=cur.execute.call_args.args
        self.assertIn('pg_cancel_backend',statement);self.assertNotIn('pg_terminate_backend',statement)
        self.assertIn('backend_start=',statement);self.assertIn('datname=current_database()',statement)
        self.assertEqual(values,(456,'timestamp','fixture','quantum-v2-bootstrap:expected'))
    def test_resume_retains_pause_until_explicit_acknowledgement(self):
        path=self.root/'session.json';config_path=self.root/'config.json'
        session={'version':driver.VERSION,'config_path':str(config_path),'max_active_seconds':100,'max_elapsed_seconds':200,
          'created_unix':1000,'deadline_unix':1200,'active_seconds':20,'expected_anchor':['fixture',5,'a'],
          'pause_baseline':BASE,'id':'fixture','code':'unchanged'}
        driver.atomic_json(path,session)
        patches=[mock.patch.object(driver,'identities',return_value={'code':'unchanged'}),
                 mock.patch.object(driver,'snapshot',return_value=state()),
                 mock.patch.object(driver,'pause_state',return_value={'file':[6],'control':[True,'new']})]
        for patch in patches:patch.start();self.addCleanup(patch.stop)
        with self.assertRaisesRegex(RuntimeError,'subsequent pause'):
            driver.checked_session(path,config_path,{},None,None,None)
        resumed=driver.checked_session(path,config_path,{},None,None,None,True)
        self.assertEqual(resumed['pause_baseline']['file'],[6]);self.assertEqual(resumed['deadline_unix'],1200)
        with mock.patch.object(driver,'identities',return_value={'code':'changed'}):
            with self.assertRaisesRegex(RuntimeError,'changed'):driver.checked_session(path,config_path,{},None,None,None,True)
    def test_database_endpoint_change_is_not_hidden_by_same_database_name_and_anchor(self):
        sample=state();sample['database_connection_sha256']='new-server'
        with self.assertRaisesRegex(RuntimeError,'Database'):
            driver.check_snapshot(sample,['fixture',5,'a','old-server'])
    def test_worker_run_log_tracks_identity_without_reissuing_metrics(self):
        import io
        output=io.StringIO();log=driver.RunLog(output)
        log.write('{"event":"run_complete","run_id":"one"');log.write(',"metrics":{"wall_seconds":1}}\n')
        self.assertEqual(log.last['run_id'],'one');self.assertEqual(output.getvalue().count('run_complete'),1)
    def test_real_child_group_stops_at_deadline_and_journal_can_resume(self):
        config_path=self.root/'config.json';driver.atomic_json(config_path,{})
        path=self.root/'session.json';session={'active_seconds':0,'config_path':str(config_path),'pause_baseline':BASE,'code':'same'}
        driver.atomic_json(path,session);real_popen=subprocess.Popen;children=[]
        def launch(*args,**kwargs):
            process=real_popen([sys.executable,'-c','import time; time.sleep(60)'],**kwargs);children.append(process);return process
        conn=mock.MagicMock()
        with mock.patch.object(driver.subprocess,'Popen',side_effect=launch),mock.patch.object(driver,'pause_state',return_value=BASE),\
             mock.patch.object(driver,'identities',return_value={'code':'same'}):
            result=driver.supervise_slice(conn,{},path,session,None,None,0.15)
        self.assertEqual(result['supervisor_stop'],'slice_deadline');self.assertTrue(result['incomplete_run_accounting'])
        self.assertIsNotNone(children[0].poll())
        self.assertLess(session['active_seconds'],3);self.assertIsNone(session['in_flight'])
        self.assertEqual(driver.read_json(path)['active_seconds'],session['active_seconds'])
    def test_pause_kills_no_unrelated_process_and_is_not_silent_success(self):
        config_path=self.root/'config.json';driver.atomic_json(config_path,{})
        path=self.root/'session.json';session={'active_seconds':0,'config_path':str(config_path),'pause_baseline':BASE,'code':'same'}
        driver.atomic_json(path,session);real_popen=subprocess.Popen;children=[]
        def launch(*args,**kwargs):
            p=real_popen([sys.executable,'-c','import time; time.sleep(60)'],**kwargs);children.append(p);return p
        with mock.patch.object(driver.subprocess,'Popen',side_effect=launch),\
             mock.patch.object(driver,'pause_state',return_value={'file':[6],'control':[True,'new']}),\
             mock.patch.object(driver,'identities',return_value={'code':'same'}):
            result=driver.supervise_slice(mock.MagicMock(),{},path,session,None,None,5)
        self.assertEqual(result['supervisor_stop'],'paused');self.assertTrue(result['incomplete_run_accounting'])
        self.assertIsNotNone(children[0].poll())


@unittest.skipUnless(DSN and psycopg2,'Set QUANTUM_BOOTSTRAP_TEST_DSN for isolated PostgreSQL driver tests')
class DriverDatabaseTests(unittest.TestCase):
    def setUp(self):
        with mock.patch.object(fixtures,'DSN',DSN):fixtures.WorkerFixture.setUp(self)
        self.config['dsn']=DSN
        fixtures.control.configure(self.conn,paused=True)
        Path(self.config['state_dir']).mkdir(parents=True,exist_ok=True)
        (Path(self.config['state_dir'])/'PAUSED').write_text('initial scheduling pause')
    def driver_config(self,work_seconds=10):
        self.config.update(production_repo=str(ROOT),work_seconds=work_seconds)
        path=Path(self.temp.name)/'driver-config.json';driver.atomic_json(path,self.config);return path
    def launch(self,config_path,*args):
        path=Path(self.temp.name)/('supervisor-'+str(time.monotonic_ns())+'.log')
        output=path.open('w')
        process=subprocess.Popen([sys.executable,str(ROOT/'scripts/run_quantum_bootstrap.py'),
            '--config',str(config_path),'--rest-seconds','0',*args],stdout=output,stderr=subprocess.STDOUT,
            start_new_session=True)
        output.close();self.addCleanup(lambda:process.poll() is None and process.kill())
        return process,path
    def wait_until(self,predicate,timeout=10):
        deadline=time.monotonic()+timeout
        while time.monotonic()<deadline:
            result=predicate()
            if result:return result
            time.sleep(.05)
        self.fail('Timed out waiting for disposable bootstrap fixture')
    def journal(self):
        paths=list((Path(self.config['state_dir'])/'bootstrap_sessions').glob('*/session.json'))
        return paths[0] if paths else None
    def running_child(self):
        path=self.journal()
        if not path:return None
        value=driver.read_json(path);pending=value.get('in_flight')
        if not pending or not pending.get('pid'):return None
        with self.conn,self.conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM quantum_v2.run WHERE status='running'")
            if not cur.fetchone()[0]:return None
        return path,value
    def slow_group_insert(self):
        with self.conn,self.conn.cursor() as cur:
            cur.execute('''CREATE FUNCTION slow_fixture_group() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN PERFORM pg_sleep(5); RETURN NEW; END $$;
                CREATE TRIGGER slow_fixture_group BEFORE INSERT ON quantum_v2.group_state
                FOR EACH ROW EXECUTE FUNCTION slow_fixture_group()''')
    def clear_slow_group_insert(self):
        with self.conn,self.conn.cursor() as cur:cur.execute('DROP TRIGGER slow_fixture_group ON quantum_v2.group_state')
    def test_shared_gate_stops_before_first_page_and_never_calls_delivery(self):
        with mock.patch.object(fixtures.store,'bootstrap_step') as seed,mock.patch.object(fixtures.worker,'deliver_pending') as deliver:
            self.assertEqual(fixtures.worker.run_once(self.conn,self.config,bootstrap_only=True,admin_stop_requested=lambda:True),0)
        seed.assert_not_called();deliver.assert_not_called()
    def test_deadline_cancels_atomic_page_without_advancing_checkpoint(self):
        def slow(*args,**kwargs):
            with fixtures.store.transaction(self.conn) as cur:
                cur.execute("UPDATE quantum_v2.bootstrap_cursor SET rows_processed=999 WHERE source_table='canonical_blocks'")
                cur.execute('SELECT pg_sleep(10)')
        with mock.patch.object(fixtures.store,'bootstrap_step',side_effect=slow):
            code=fixtures.worker.run_once(self.conn,self.config,bootstrap_only=True,
                admin_stop_requested=lambda:False,admin_deadline=time.monotonic()+0.2)
        self.assertEqual(code,0)
        with self.conn,self.conn.cursor() as cur:
            cur.execute("SELECT rows_processed FROM quantum_v2.bootstrap_cursor WHERE source_table='canonical_blocks'")
            self.assertEqual(cur.fetchone()[0],0)
    def test_supervised_anchor_drift_never_invokes_automatic_reseed(self):
        with self.conn,self.conn.cursor() as cur:cur.execute('UPDATE blockheader SET blockhash=%s WHERE blockheight=500',('f'*64,))
        with mock.patch.object(fixtures.worker,'recover_reorg',side_effect=AssertionError('silent reseed')):
            code=fixtures.worker.run_once(self.conn,self.config,bootstrap_only=True,admin_stop_requested=lambda:False)
        self.assertEqual(code,1)
        with self.conn,self.conn.cursor() as cur:
            cur.execute('SELECT anchor_hash,status FROM quantum_v2.projection');self.assertEqual(cur.fetchone(),(f'{500:064x}','seeding'))
    def test_complete_bootstrap_has_one_run_and_no_validation_export_delivery(self):
        with mock.patch.object(fixtures.worker,'validate_projection') as validate,mock.patch.object(fixtures.worker,'export_request') as export,mock.patch.object(fixtures.worker,'deliver_pending') as delivery:
            code=fixtures.worker.run_once(self.conn,self.config,bootstrap_only=True,admin_stop_requested=lambda:False,
                                        admin_deadline=time.monotonic()+5)
        self.assertEqual(code,0);validate.assert_not_called();export.assert_not_called();delivery.assert_not_called()
        with self.conn,self.conn.cursor() as cur:
            cur.execute('SELECT status FROM quantum_v2.projection');self.assertEqual(cur.fetchone()[0],'ready')
            cur.execute('SELECT count(*) FROM quantum_v2.run');self.assertEqual(cur.fetchone()[0],1)
        self.assertTrue((Path(self.config['state_dir'])/'PAUSED').exists())
    def test_real_supervisor_finishes_only_bootstrap_and_retains_pause(self):
        process,output=self.launch(self.driver_config(),'--max-active-seconds','20','--max-elapsed-seconds','30')
        self.assertEqual(process.wait(timeout=15),0,output.read_text())
        journal=driver.read_json(self.journal());self.assertEqual(journal['status'],'bootstrap_complete')
        self.assertIsNone(journal['in_flight']);self.assertGreater(journal['active_seconds'],0)
        with self.conn,self.conn.cursor() as cur:
            cur.execute('SELECT count(*),count(DISTINCT id) FROM quantum_v2.run');self.assertEqual(cur.fetchone(),(1,1))
            cur.execute('SELECT count(*) FROM quantum_v2.validation_result');self.assertEqual(cur.fetchone()[0],0)
            cur.execute('SELECT count(*) FROM quantum_v2.request WHERE generation_id IS NOT NULL');self.assertEqual(cur.fetchone()[0],0)
            cur.execute('SELECT paused FROM quantum_v2.control');self.assertTrue(cur.fetchone()[0])
        self.assertTrue((Path(self.config['state_dir'])/'PAUSED').exists())
    def test_owned_hard_deadline_keeps_failed_run_and_resumes_committed_checkpoint(self):
        # The first real child commits one source page, then stalls in Python
        # inside its next page. The normal soft SQL cancel cannot end that
        # sleep; the existing hard child deadline must unwind the real worker.
        # Only the fixture's first child is stalled. The next child must resume
        # without deleting its failed predecessor or charging away its cost.
        with self.conn,self.conn.cursor() as cur:
            cur.execute("INSERT INTO outputs SELECT 2,lpad(to_hex(n),64,'0'),0,100,'fixture','pubkey',%s,NULL FROM generate_series(10,20) n",('21'+fixtures.G+'ac',))
        self.config['bootstrap_rows']=1
        config=self.driver_config(work_seconds=3)
        child_source='''import os,sys,time
from pathlib import Path
sys.path.insert(0,str(Path(sys.argv[1]).parent))
import run_quantum_bootstrap as d
w,f=d.runtime()
args=sys.argv[2:]
session=Path(args[args.index('--slice')+1])
marker=session.parent/'fixture-first-child-stall'
try:fd=os.open(marker,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
except FileExistsError:fd=None
if fd is not None:
    os.close(fd);original=w.store.bootstrap_step;calls=0
    def stalled(*a,**kw):
        global calls
        calls+=1
        if calls==2:time.sleep(30)
        return original(*a,**kw)
    w.store.bootstrap_step=stalled
raise SystemExit(d.cli(args))
'''
        supervisor_source='''import subprocess,sys
from pathlib import Path
sys.path.insert(0,str(Path(sys.argv[1])/'scripts'))
import run_quantum_bootstrap as d
original=subprocess.Popen
def launch(args,**kwargs):
    if len(args)>1 and str(args[1]).endswith('/run_quantum_bootstrap.py'):
        args=[sys.executable,'-c',sys.argv[3],*args[1:]]
    return original(args,**kwargs)
d.subprocess.Popen=launch
raise SystemExit(d.cli(['--config',sys.argv[2],'--max-active-seconds','15','--max-elapsed-seconds','30','--rest-seconds','0']))
'''
        output=Path(self.temp.name)/'controlled-deadline.log'
        with output.open('w') as stream:
            process=subprocess.Popen([sys.executable,'-c',supervisor_source,str(ROOT),str(config),child_source],
                stdout=stream,stderr=subprocess.STDOUT,start_new_session=True)
        try:self.assertEqual(process.wait(timeout=20),0,output.read_text())
        finally:
            if process.poll() is None:process.kill();process.wait()
        journal=driver.read_json(self.journal())
        self.assertEqual(journal['status'],'bootstrap_complete')
        self.assertGreaterEqual(journal['completed_slices'],2)
        events=[json.loads(line) for line in (self.journal().parent/'events.jsonl').read_text().splitlines()]
        first=next(row for row in events if row['event']=='slice_finished')
        result=first['result']
        self.assertEqual((result['event'],result['exit_code']),('run_failed',1))
        self.assertEqual(result['continuation']['classification'],'verified_controlled_deadline')
        self.assertEqual(result['continuation']['retained_run_status'],'failed')
        self.assertEqual(first['rows_processed'],1)
        self.assertGreaterEqual(first['active_seconds'],3)
        self.assertGreater(journal['active_seconds'],first['active_seconds'])
        with self.conn,self.conn.cursor() as cur:
            cur.execute('SELECT status,error,metrics FROM quantum_v2.run WHERE id=%s',(result['run_id'],))
            status,error,metrics=cur.fetchone()
            self.assertEqual(status,'failed');self.assertEqual(error,driver.deadline_error(result['nonce']))
            self.assertGreater(metrics['wall_seconds'],0);self.assertEqual(metrics['mode'],'bootstrap')
            cur.execute("SELECT count(*) FROM quantum_v2.run WHERE status='running'");self.assertEqual(cur.fetchone()[0],0)
            cur.execute("SELECT rows_processed,complete FROM quantum_v2.bootstrap_cursor WHERE source_table='canonical_blocks'")
            self.assertEqual(cur.fetchone(),(12,True))
            cur.execute("SELECT count(*) FROM pg_stat_activity WHERE application_name=%s",('quantum-v2-bootstrap:'+result['nonce'],))
            self.assertEqual(cur.fetchone()[0],0)
    def test_killed_supervisor_resume_charges_reservation_and_keeps_committed_cursor(self):
        self.slow_group_insert();config=self.driver_config(work_seconds=3)
        process,output=self.launch(config,'--max-active-seconds','20','--max-elapsed-seconds','45')
        path,before=self.wait_until(self.running_child)
        process.kill();process.wait(timeout=5)
        pending=before['in_flight'];self.wait_until(lambda:not driver._alive(pending['pid']),timeout=10)
        self.assertIsNotNone(driver.read_json(path)['in_flight'])
        with self.conn,self.conn.cursor() as cur:
            cur.execute("SELECT rows_processed FROM quantum_v2.bootstrap_cursor WHERE source_table='canonical_blocks'")
            self.assertEqual(cur.fetchone()[0],0)
        self.clear_slow_group_insert()
        resumed,out=self.launch(config,'--resume',str(path))
        self.assertEqual(resumed.wait(timeout=15),0,out.read_text())
        after=driver.read_json(path);self.assertEqual(after['status'],'bootstrap_complete')
        self.assertEqual(after['deadline_unix'],before['deadline_unix'])
        self.assertGreaterEqual(after['active_seconds'],pending['reserved_seconds']+driver.CHILD_CLEANUP_SECONDS)
        events=[json.loads(line) for line in (path.parent/'events.jsonl').read_text().splitlines()]
        self.assertEqual(sum(event['event']=='interrupted_slice_charged' for event in events),1)
        with self.conn,self.conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM quantum_v2.run WHERE status='running'");self.assertEqual(cur.fetchone()[0],0)
    def test_real_new_pause_is_retained_until_explicit_resume_acknowledgement(self):
        self.slow_group_insert();config=self.driver_config(work_seconds=10)
        process,output=self.launch(config,'--max-active-seconds','25','--max-elapsed-seconds','45')
        path,before=self.wait_until(self.running_child)
        fixtures.control.configure(self.conn,paused=True)
        (Path(self.config['state_dir'])/'PAUSED').write_text('subsequent operator pause')
        self.assertEqual(process.wait(timeout=8),0,output.read_text())
        paused=driver.read_json(path);self.assertEqual(paused['status'],'paused')
        refused,out=self.launch(config,'--resume',str(path));self.assertNotEqual(refused.wait(timeout=8),0)
        self.assertIn('"error_type": "RuntimeError"',out.read_text())
        self.clear_slow_group_insert()
        resumed,out=self.launch(config,'--resume',str(path),'--acknowledge-pause')
        self.assertEqual(resumed.wait(timeout=15),0,out.read_text())
        after=driver.read_json(path);self.assertEqual(after['status'],'bootstrap_complete')
        self.assertEqual(after['deadline_unix'],before['deadline_unix'])
        self.assertGreaterEqual(after['active_seconds'],paused['active_seconds'])
        self.assertEqual((Path(self.config['state_dir'])/'PAUSED').read_text(),'subsequent operator pause')

if __name__=='__main__':unittest.main()
