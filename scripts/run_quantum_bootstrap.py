#!/usr/bin/env python3
"""Manually supervise a finite canonical bootstrap; never publish or enable a scheduler.

New sessions require explicit active and elapsed budgets. Resume retains those
budgets and the original pause token. Importing this script performs no I/O.
"""
from __future__ import annotations
import argparse
from contextlib import contextmanager
from datetime import datetime,timezone
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time
import uuid

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'webapps/quantum_exposure/pipeline'))
from quantum_worker_config import bootstrap_resource_limits
MAX_ACTIVE_SECONDS=24*60*60
MAX_ELAPSED_SECONDS=48*60*60
CLEANUP_RESERVE_SECONDS=5
CHILD_CLEANUP_SECONDS=2
MIN_USABLE_SLICE_SECONDS=5
VERSION='quantum-bootstrap-session-v1'


def utc():return datetime.now(timezone.utc).isoformat()
def normalize(value):return json.loads(json.dumps(value,default=str))
def read_json(path):
    path=Path(path)
    if path.is_symlink():raise ValueError('Symlinked administrative files are refused')
    return json.loads(path.read_text())
def atomic_json(path,value):
    path=Path(path)
    if path.is_symlink():raise ValueError('Symlinked administrative files are refused')
    temporary=path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp')
    fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    try:
        with os.fdopen(fd,'w') as stream:
            json.dump(value,stream,indent=2,default=str);stream.write('\n');stream.flush();os.fsync(stream.fileno())
        os.replace(temporary,path)
    finally:
        temporary.unlink(missing_ok=True)

def append_event(path,event):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_APPEND|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'a') as stream:stream.write(json.dumps(event,default=str)+'\n')


@contextmanager
def session_lock(state_dir):
    path=Path(state_dir)/'bootstrap-admin.lock'
    fd=os.open(path,os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
    try:
        try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError as exc:raise RuntimeError('Another administrative bootstrap supervisor owns the session lock') from exc
        yield fd
    finally:os.close(fd)


def runtime():
    sys.path.insert(0,str(ROOT/'webapps/quantum_exposure/pipeline'))
    import run_quantum_worker as worker
    from quantum_worker_config import config_fingerprint
    return worker,config_fingerprint


def identities(config,worker,fingerprint,config_path=None):
    result={'implementation_sha256':worker.implementation_fingerprint(ROOT),
            'config_sha256':fingerprint(config),
            'driver_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    if config_path is not None:
        result['config_file_sha256']=hashlib.sha256(Path(config_path).read_bytes()).hexdigest()
    if config.get('env_file'):
        result['environment_file_sha256']=hashlib.sha256(Path(config['env_file']).read_bytes()).hexdigest()
    return result


def pause_state(conn,config):
    path=Path(config['state_dir'])/'PAUSED'
    try:
        st=path.stat();token=[st.st_dev,st.st_ino,st.st_mtime_ns,st.st_ctime_ns,st.st_size]
    except FileNotFoundError:token=None
    with conn,conn.cursor() as cur:
        cur.execute('SELECT paused,updated_at FROM quantum_v2.control WHERE singleton');row=cur.fetchone()
    return {'file':token,'control':normalize(row)}


def pause_changed(current,baseline):
    row=current['control']
    # Normal scheduling must remain paused throughout manual initialization.
    return (not row or row[0] is not True or
            (current['file'] is not None and current['file']!=baseline['file']) or
            (row[0] and row!=baseline['control']))


def snapshot(conn):
    from psycopg2.extras import RealDictCursor
    with conn,conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute('SELECT current_database() AS database');database=cur.fetchone()['database']
        cur.execute('SELECT * FROM quantum_v2.projection WHERE singleton');projection=cur.fetchone()
        cur.execute("SELECT source_table,last_height,last_txid,last_vout,rows_processed,complete FROM quantum_v2.bootstrap_cursor WHERE source_table='canonical_blocks'")
        cursor=cur.fetchone()
        cur.execute('''SELECT s.ready,s.committed_height,s.committed_hash,b.blockhash AS tip_hash
            FROM quantum_v2.source_state s LEFT JOIN public.blockheader b ON b.blockheight=s.committed_height WHERE s.singleton''');source=cur.fetchone()
        anchor=None
        if projection:
            cur.execute('SELECT blockhash FROM public.blockheader WHERE blockheight=%s',(projection['anchor_height'],));row=cur.fetchone();anchor=row['blockhash'] if row else None
    endpoint={key:conn.info.dsn_parameters.get(key) for key in ('host','hostaddr','port','dbname','user','service')}
    endpoint_hash=hashlib.sha256(json.dumps(endpoint,sort_keys=True).encode()).hexdigest()
    return normalize(dict(database=database,database_connection_sha256=endpoint_hash,
        projection=projection,cursor=cursor,source=source,canonical_anchor=anchor))


def check_snapshot(value,expected=None):
    p=value['projection'];source=value['source'];cursor=value['cursor']
    if not p or p['seed_mode']!='canonical' or p['status'] not in ('seeding','ready') or not cursor:
        raise RuntimeError('An initialized canonical seeding/ready projection is required')
    if p['height']!=p['anchor_height'] or p['block_hash']!=p['anchor_hash']:
        raise RuntimeError('Administrative bootstrap cannot continue an incrementally advanced projection')
    if value['canonical_anchor']!=p['anchor_hash']:raise RuntimeError('Canonical anchor changed; explicit recovery is required')
    actual=[value['database'],p['anchor_height'],p['anchor_hash']]
    if expected and len(expected)==4:actual.append(value['database_connection_sha256'])
    if expected and actual!=list(expected):
        raise RuntimeError('Database or initialization anchor drifted')
    if (not source or not source['ready'] or not source['committed_hash'] or
            source['committed_hash']!=source['tip_hash'] or source['committed_height']<p['anchor_height']):
        return 'source_not_ready'
    if p['status']=='ready':
        if not cursor['complete']:raise RuntimeError('Ready projection has an incomplete bootstrap cursor')
        return 'ready'
    return 'seeding'


def validate_budgets(active,elapsed):
    for value,limit,name in ((active,MAX_ACTIVE_SECONDS,'active'),(elapsed,MAX_ELAPSED_SECONDS,'elapsed')):
        if type(value) not in (int,float) or not math.isfinite(value) or not 0<value<=limit:
            raise ValueError(f'Explicit {name} budget must be positive and at most {limit} seconds')
    if active>elapsed:raise ValueError('Active budget cannot exceed elapsed budget')


def remaining(session,now=None):
    now=time.time() if now is None else now
    if now<session.get('last_wall_unix',session.get('created_unix',now))-2:
        raise RuntimeError('Wall clock moved backwards; session deadline cannot be trusted')
    session['last_wall_unix']=max(now,session.get('last_wall_unix',now))
    return min(session['max_active_seconds']-session['active_seconds'],session['deadline_unix']-now)


def next_slice_seconds(work_seconds,available_seconds):
    """Leave a short tail unused instead of starting a child it cannot support."""
    configured=float(work_seconds)
    if not math.isfinite(configured) or configured<=0:raise ValueError('Invalid worker slice budget')
    seconds=min(configured,available_seconds-CLEANUP_RESERVE_SECONDS)
    return seconds if seconds>=min(configured,MIN_USABLE_SLICE_SECONDS) else None


def new_session(config_path,config,worker,fingerprint,conn,active,elapsed):
    validate_budgets(active,elapsed)
    before=snapshot(conn);check_snapshot(before)
    pause=pause_state(conn,config)
    if not pause['control'] or pause['control'][0] is not True:
        raise RuntimeError('Pause normal scheduling before starting administrative bootstrap')
    p=before['projection'];session_id=uuid.uuid4().hex
    sessions=Path(config['state_dir'])/'bootstrap_sessions';sessions.mkdir(mode=0o700,exist_ok=True)
    directory=sessions/session_id;directory.mkdir(mode=0o700)
    now=time.time()
    session=dict(version=VERSION,id=session_id,created_at=utc(),config_path=str(config_path),
        max_active_seconds=active,max_elapsed_seconds=elapsed,deadline_unix=now+elapsed,active_seconds=0,
        status='running',created_unix=now,last_wall_unix=now,initial_rows=before['cursor']['rows_processed'],pause_baseline=pause,
        expected_anchor=[before['database'],p['anchor_height'],p['anchor_hash'],before['database_connection_sha256']],
        last_checkpoint=before,completed_slices=0,in_flight=None,**identities(config,worker,fingerprint,config_path))
    path=directory/'session.json';atomic_json(path,session);return path,session


def checked_session(path,config_path,config,worker,fingerprint,conn,acknowledge_pause=False):
    session=read_json(path)
    if session.get('version')!=VERSION:raise ValueError('Unknown administrative session version')
    if str(config_path)!=session['config_path']:raise RuntimeError('Session configuration path changed')
    validate_budgets(session['max_active_seconds'],session['max_elapsed_seconds'])
    if session['deadline_unix']!=session['created_unix']+session['max_elapsed_seconds'] or session['active_seconds']<0:
        raise ValueError('Session budget journal is inconsistent')
    if any(session.get(key)!=value for key,value in identities(config,worker,fingerprint,config_path).items()):
        raise RuntimeError('Source, driver or effective configuration changed; start a reviewed new session')
    check_snapshot(snapshot(conn),session['expected_anchor'])
    current=pause_state(conn,config)
    if pause_changed(current,session['pause_baseline']):
        if not acknowledge_pause:raise RuntimeError('A subsequent pause is retained; use explicit --acknowledge-pause to authorize continuation')
        if not current['control'] or current['control'][0] is not True:raise RuntimeError('Normal scheduling must remain paused')
        session['pause_baseline']=current
        append_event(path.parent/'events.jsonl',{'at':utc(),'event':'pause_acknowledged','session_id':session['id']})
    return session


def _alive(pid):
    if not pid:return False
    try:os.kill(pid,0);return True
    except ProcessLookupError:return False


def reconcile_interrupted(session,path):
    pending=session.get('in_flight')
    if not pending:return
    pid=pending.get('pid')
    # A supervisor can die just after launch and before recording Popen.pid.
    # The child's nonce-bound handoff closes that gap without killing a PID.
    handoff_path=path.parent/(pending['nonce']+'.backend.json')
    if not pid and handoff_path.exists():
        handoff=read_json(handoff_path)
        if handoff.get('nonce')!=pending['nonce']:raise RuntimeError('Interrupted child handoff identity differs')
        pid=handoff.get('child_pid')
    if _alive(pid):raise RuntimeError('Previous slice process is still alive; do not overlap it')
    charged=pending['reserved_seconds']+CHILD_CLEANUP_SECONDS
    session['active_seconds']+=charged
    session['in_flight']=None
    append_event(path.parent/'events.jsonl',{'at':utc(),'event':'interrupted_slice_charged','nonce':pending['nonce'],
                 'charged_active_seconds':charged})
    atomic_json(path,session)


def cancel_owned_backend(conn,handoff,nonce,pid):
    if not handoff or handoff.get('nonce')!=nonce or handoff.get('child_pid')!=pid:
        return False
    with conn,conn.cursor() as cur:
        cur.execute('''SELECT pg_cancel_backend(pid) FROM pg_stat_activity
            WHERE pid=%s AND backend_start=%s::timestamptz AND datname=%s
              AND application_name=%s AND datname=current_database()''',
            (handoff['backend_pid'],handoff['backend_start'],handoff['database'],'quantum-v2-bootstrap:'+nonce))
        row=cur.fetchone()
    return bool(row and row[0])


def stop_child(process,conn,handoff,nonce):
    from quantum_subprocess import _stop_group
    try:cancel_owned_backend(conn,handoff,nonce,process.pid)
    finally:
        _stop_group(process)
        # Close the small cancel/exit race without ever terminating a PG backend.
        cancel_owned_backend(conn,handoff,nonce,process.pid)


def deadline_error(nonce):
    return 'SliceInterrupted: owned bootstrap deadline '+nonce


def deadline_candidate(result,pending,handoff,child_pid):
    """A failed worker result is not itself evidence of a controlled deadline."""
    interruption=result.get('interruption') or {}
    at=interruption.get('observed_monotonic')
    return bool(result.get('event')=='run_failed' and result.get('exit_code')==1 and result.get('run_id')
        and result.get('worker_error')==deadline_error(pending['nonce'])
        and result.get('nonce')==pending['nonce'] and handoff
        and handoff.get('nonce')==pending['nonce'] and handoff.get('child_pid')==child_pid
        and interruption.get('origin') in ('child_deadline_timer','supervisor_deadline')
        and interruption.get('nonce')==pending['nonce'] and interruption.get('child_pid')==child_pid
        and interruption.get('deadline_monotonic')==pending['deadline_monotonic']
        and interruption.get('signal')==signal.SIGTERM
        and type(at) in (int,float) and math.isfinite(at) and at>=pending['deadline_monotonic'])


def verify_deadline_checkpoint(conn,config,session,worker,fingerprint,result,pending,handoff,child_pid):
    """Read-only proof for resuming after a recorded FAILED bootstrap attempt.

    This never changes a run's status/error/metrics. It is valid only after the
    owned child/group has been reaped and its exact backend has disconnected.
    """
    from psycopg2.extras import RealDictCursor
    if not deadline_candidate(result,pending,handoff,child_pid):return None
    until=time.monotonic()+CHILD_CLEANUP_SECONDS
    while True:
        with conn,conn.cursor() as cur:
            cur.execute('''SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=%s
                AND backend_start=%s::timestamptz AND datname=%s AND application_name=%s
                AND datname=current_database())''',
                (handoff['backend_pid'],handoff['backend_start'],handoff['database'],
                 'quantum-v2-bootstrap:'+pending['nonce']))
            alive=cur.fetchone()[0]
        if not alive:break
        if time.monotonic()>=until:return None
        time.sleep(.05)
    with conn,conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute('SELECT id,pid,status,error,finished_at,metrics FROM quantum_v2.run WHERE id=%s',
                    (result['run_id'],));run=cur.fetchone()
    if (not run or run['pid']!=child_pid or run['status']!='failed' or not run['finished_at']
            or run['error']!=deadline_error(pending['nonce'])):return None
    metrics=run['metrics'] or {}
    if (metrics.get('mode')!='bootstrap' or metrics.get('implementation_sha256')!=session['implementation_sha256']
            or metrics.get('config_sha256')!=session['config_sha256']):return None
    # An interrupt must not hide a resource breach or missing measurements.
    for name in ('memory_limit_exceeded','disk_reserve_exceeded'):
        if metrics.get(name) is not False:return None
    for name in ('memory_measurement_error','disk_measurement_error'):
        if name not in metrics or metrics[name] is not None:return None
    for name in ('wall_seconds','peak_combined_private_memory_bytes'):
        value=metrics.get(name)
        if type(value) not in (int,float) or not math.isfinite(value) or value<=0:return None
    if metrics.get('memory_limit_bytes')!=bootstrap_resource_limits(config)['memory_limit_bytes']:return None
    if metrics['peak_combined_private_memory_bytes']>metrics['memory_limit_bytes']:return None
    processes=metrics.get('processes') or {}
    if set(processes)!={str(child_pid),str(handoff['backend_pid'])}:return None
    if any(type(row.get('private_memory_bytes')) is not int or row['private_memory_bytes']<=0
           for row in processes.values()):return None
    if pause_changed(pause_state(conn,config),session['pause_baseline']):return None
    if any(session.get(k)!=v for k,v in identities(read_json(session['config_path']),worker,fingerprint,session['config_path']).items()):return None
    checkpoint=result.get('checkpoint')
    if not checkpoint:return None
    check_snapshot(checkpoint,session['expected_anchor'])
    fresh=snapshot(conn);source_status=check_snapshot(fresh,session['expected_anchor'])
    if fresh['projection']!=checkpoint['projection'] or fresh['cursor']!=checkpoint['cursor']:return None
    return dict(classification='verified_controlled_deadline',run_id=str(run['id']),
        nonce=pending['nonce'],child_pid=child_pid,owned_child_reaped=True,
        retained_run_status=run['status'],retained_error=run['error'],measured_wall_seconds=metrics['wall_seconds'],
        owned_backend_gone=True,source_status=source_status,checkpoint_verified=True)


def supervise_slice(conn,config,path,session,worker,fingerprint,seconds,lease_fd=None):
    from quantum_subprocess import _finish_launch_before_cancelling,cancellation_signals
    nonce=uuid.uuid4().hex;prefix=path.parent/nonce
    start=time.monotonic()
    pending={'nonce':nonce,'reserved_seconds':seconds,'deadline_monotonic':start+seconds,'pid':None,'started_at':utc()}
    session['in_flight']=pending;atomic_json(path,session)
    process=None;reason=None;handoff=None;next_drift_check=0
    log_path=prefix.with_suffix('.log');result_path=prefix.with_suffix('.result.json');handoff_path=prefix.with_suffix('.backend.json')
    fd=os.open(log_path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    try:
        with os.fdopen(fd,'w') as output,cancellation_signals():
            with _finish_launch_before_cancelling():
                process=subprocess.Popen([sys.executable,str(Path(__file__).resolve()),'--config',str(session['config_path']),
                    '--slice',str(path),'--nonce',nonce,'--slice-seconds',str(seconds)],
                    cwd=ROOT,stdout=output,stderr=subprocess.STDOUT,start_new_session=True,
                    pass_fds=() if lease_fd is None else (lease_fd,))
                pending['pid']=process.pid;atomic_json(path,session)
            while process.poll() is None:
                if handoff is None and handoff_path.exists():handoff=read_json(handoff_path)
                if time.monotonic()-start>=seconds:reason='slice_deadline'
                elif pause_changed(pause_state(conn,config),session['pause_baseline']):reason='paused'
                elif time.monotonic()>=next_drift_check:
                    next_drift_check=time.monotonic()+1
                    if any(session.get(k)!=v for k,v in identities(read_json(session['config_path']),worker,fingerprint,session['config_path']).items()):reason='source_or_config_changed'
                if reason:
                    if reason=='slice_deadline':
                        atomic_json(prefix.with_suffix('.stop.json'),dict(nonce=nonce,child_pid=process.pid,
                            reason=reason,deadline_monotonic=pending['deadline_monotonic'],observed_monotonic=time.monotonic()))
                    stop_child(process,conn,handoff,nonce);break
                time.sleep(min(0.25,max(0,seconds-(time.monotonic()-start))))
        if not result_path.exists():
            if reason:
                return {'event':'child_interrupted_without_result','exit_code':process.returncode,'run_id':None,
                        'supervisor_stop':reason,'incomplete_run_accounting':True}
            raise RuntimeError('Bootstrap child left no completed result; inspect its private log')
        result=read_json(result_path)
        if result.get('nonce')!=nonce:raise RuntimeError('Bootstrap child result identity differs')
        result.pop('continuation',None)  # Only this supervisor may add verified continuation evidence.
        if reason:result['supervisor_stop']=reason
        if handoff is None and handoff_path.exists():handoff=read_json(handoff_path)
        if deadline_candidate(result,pending,handoff,process.pid) and reason in (None,'slice_deadline'):
            # Clear the complete owned process group even if the child's own
            # deadline fired and it exited before the parent's next poll.
            stop_child(process,conn,handoff,nonce)
            if process.returncode==1:
                proof=verify_deadline_checkpoint(conn,config,session,worker,fingerprint,result,pending,handoff,process.pid)
                if proof:result['continuation']=proof
        return result
    except BaseException:
        if process is not None:
            if handoff is None and handoff_path.exists():handoff=read_json(handoff_path)
            stop_child(process,conn,handoff,nonce)
        raise
    finally:
        # If the supervisor itself is killed before this write, resume charges
        # the full reservation above. Time budgets are never silently reset.
        session['active_seconds']+=time.monotonic()-start
        session['in_flight']=None;atomic_json(path,session)


class SliceInterrupted(Exception):
    """Let the worker persist failed-attempt costs before closing its session."""


class RunLog:
    """Stream ordinary worker output while retaining only its final result identity."""
    def __init__(self,stream):self.stream=stream;self.pending='';self.last=None
    def write(self,value):
        self.stream.write(value);self.stream.flush();self.pending+=value
        while '\n' in self.pending:
            line,self.pending=self.pending.split('\n',1)
            try:record=json.loads(line)
            except ValueError:continue
            if record.get('event') in ('run_complete','run_failed','source_not_ready','paused','already_running','initialization_required'):
                self.last=record
        return len(value)
    def flush(self):self.stream.flush()


def child_slice(args):
    import contextlib
    session=read_json(args.slice)
    pending=session.get('in_flight') or {}
    if pending.get('nonce')!=args.nonce or not 0<args.slice_seconds<=pending['reserved_seconds']:
        raise RuntimeError('Child slice reservation is absent or differs')
    hard_deadline=pending['deadline_monotonic']
    if not math.isfinite(hard_deadline):raise ValueError('Invalid absolute child deadline')
    conn=None;nonce=args.nonce;prefix=args.slice.parent/nonce
    result={'nonce':nonce,'event':'child_failed','exit_code':1,'run_id':None}
    finished=threading.Event();deadline_fired=threading.Event();interruption={}
    def interrupt(signum,frame):
        if interruption:return  # Allow one cooperative unwind, not repeated signals during its accounting.
        observed=time.monotonic();origin='external_signal'
        if signum==signal.SIGTERM and observed>=hard_deadline:
            if deadline_fired.is_set():origin='child_deadline_timer'
            else:
                stop_path=prefix.with_suffix('.stop.json')
                if stop_path.exists():
                    stop=read_json(stop_path)
                    if (stop.get('nonce')==nonce and stop.get('child_pid')==os.getpid()
                            and stop.get('reason')=='slice_deadline' and stop.get('deadline_monotonic')==hard_deadline
                            and type(stop.get('observed_monotonic')) in (int,float)
                            and hard_deadline<=stop['observed_monotonic']<=observed):origin='supervisor_deadline'
        interruption.update(origin=origin,nonce=nonce,child_pid=os.getpid(),signal=signum,
                            deadline_monotonic=hard_deadline,observed_monotonic=observed)
        raise SliceInterrupted('owned bootstrap deadline '+nonce if origin!='external_signal' else 'external signal')
    signal.signal(signal.SIGTERM,interrupt);signal.signal(signal.SIGINT,interrupt)
    def deadline():
        deadline_fired.set()
        if conn is not None:
            threading.Thread(target=conn.cancel,daemon=True).start()
        os.kill(os.getpid(),signal.SIGTERM)
        # An orphan must remain finite even if libpq connection establishment
        # or cooperative cleanup is blocked. Only this owned child exits.
        if not finished.wait(CHILD_CLEANUP_SECONDS):os._exit(124)
    timer=threading.Timer(max(0,hard_deadline-time.monotonic()),deadline);timer.daemon=True
    try:
        timer.start()
        worker,fingerprint=runtime();config=read_json(args.config)
        configured_seconds=bootstrap_resource_limits(config)['work_seconds']
        if args.slice_seconds>configured_seconds:raise ValueError('Child reservation exceeds configured bootstrap duration')
        if any(session.get(k)!=v for k,v in identities(config,worker,fingerprint,args.config).items()):raise RuntimeError('Child source/configuration drifted')
        conn=worker.connect(config,connect_timeout=max(2,min(5,math.ceil(hard_deadline-time.monotonic()))))
        with conn,conn.cursor() as cur:
            cur.execute("SET application_name=%s",('quantum-v2-bootstrap:'+nonce,))
            cur.execute('SELECT pg_backend_pid(),backend_start,current_database() FROM pg_stat_activity WHERE pid=pg_backend_pid()')
            pid,started,database=cur.fetchone()
        atomic_json(prefix.with_suffix('.backend.json'),dict(nonce=nonce,child_pid=os.getpid(),backend_pid=pid,backend_start=str(started),database=database))
        state=snapshot(conn);check_snapshot(state,session['expected_anchor'])
        def stopped():return pause_changed(pause_state(conn,config),session['pause_baseline'])
        log=RunLog(sys.stdout)
        with contextlib.redirect_stdout(log):
            code=worker.run_once(conn,config,bootstrap_only=True,admin_stop_requested=stopped,
                                 admin_deadline=hard_deadline-min(5,args.slice_seconds/3))
        event=log.last or {};result.update(event=event.get('event','no_run_event'),exit_code=code,run_id=event.get('run_id'))
        if event.get('error')==deadline_error(nonce):result['worker_error']=event['error']
        result['checkpoint']=snapshot(conn)
    except SliceInterrupted:
        if conn is not None:conn.rollback()
        result.update(event='slice_interrupted',exit_code=1)
    except Exception as exc:
        result['error_type']=type(exc).__name__
    finally:
        if conn is not None:conn.close()
        if interruption:result['interruption']=interruption
        atomic_json(prefix.with_suffix('.result.json'),result)
        finished.set();timer.cancel();timer.join()
    return result['exit_code']


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config',type=Path,required=True)
    parser.add_argument('--max-active-seconds',type=float)
    parser.add_argument('--max-elapsed-seconds',type=float)
    parser.add_argument('--resume',type=Path)
    parser.add_argument('--acknowledge-pause',action='store_true')
    parser.add_argument('--rest-seconds',type=float,default=15)
    parser.add_argument('--estimated-source-rows',type=int,help='Optional catalog planning estimate, never a count or ETA guarantee')
    parser.add_argument('--slice',type=Path,help=argparse.SUPPRESS)
    parser.add_argument('--nonce',help=argparse.SUPPRESS)
    parser.add_argument('--slice-seconds',type=float,help=argparse.SUPPRESS)
    args=parser.parse_args(argv)
    if args.slice:return child_slice(args)
    if not math.isfinite(args.rest_seconds) or not 0<=args.rest_seconds<=300:parser.error('rest-seconds must be 0..300')
    if args.resume and (args.max_active_seconds is not None or args.max_elapsed_seconds is not None):parser.error('Resume retains original budgets')
    if not args.resume and (args.max_active_seconds is None or args.max_elapsed_seconds is None):parser.error('New sessions require both finite budgets')
    if args.estimated_source_rows is not None and args.estimated_source_rows<=0:parser.error('estimated-source-rows must be positive')
    if args.acknowledge_pause and not args.resume:parser.error('Pause acknowledgement applies only to an existing session')
    worker,fingerprint=runtime();config_path=args.config.absolute();config=read_json(config_path)
    bootstrap_seconds=bootstrap_resource_limits(config)['work_seconds']
    if Path(config['production_repo']).resolve()!=ROOT:raise RuntimeError('Run the administrative driver from its configured production checkout')
    with session_lock(config['state_dir']) as lease_fd:
        conn=worker.connect(config,connect_timeout=5)
        session=None;path=None
        try:
            with conn,conn.cursor() as cur:cur.execute("SET statement_timeout='2s'")
            if args.resume:
                path=args.resume.absolute()
                expected=(Path(config['state_dir'])/'bootstrap_sessions').resolve()
                if expected not in path.resolve().parents:raise ValueError('Resume journal must belong to this private state directory')
                session=checked_session(path,config_path,config,worker,fingerprint,conn,args.acknowledge_pause)
                reconcile_interrupted(session,path)
            else:
                path,session=new_session(config_path,config,worker,fingerprint,conn,args.max_active_seconds,args.max_elapsed_seconds)
                session['estimated_source_rows']=args.estimated_source_rows;atomic_json(path,session)
            if args.resume and args.estimated_source_rows is not None and args.estimated_source_rows!=session.get('estimated_source_rows'):
                raise ValueError('Resume retains the original optional source estimate')
            session['status']='running';atomic_json(path,session)
            print(json.dumps({'event':'bootstrap_session','session':str(path),'deadline_unix':session['deadline_unix']}),flush=True)
            while remaining(session)>CLEANUP_RESERVE_SECONDS:
                if pause_changed(pause_state(conn,config),session['pause_baseline']):session['status']='paused';break
                if any(session.get(k)!=v for k,v in identities(read_json(config_path),worker,fingerprint,config_path).items()):session['status']='source_or_config_changed';break
                state=snapshot(conn);status=check_snapshot(state,session['expected_anchor'])
                if status=='ready':session['status']='bootstrap_complete';session['last_checkpoint']=state;break
                if status=='source_not_ready':
                    append_event(path.parent/'events.jsonl',{'at':utc(),'event':'source_not_ready'})
                else:
                    seconds=next_slice_seconds(bootstrap_seconds,remaining(session))
                    if seconds is None:
                        session['status']='budget_exhausted';break
                    result=supervise_slice(conn,config,path,session,worker,fingerprint,seconds,lease_fd)
                    session['last_checkpoint']=snapshot(conn);check_snapshot(session['last_checkpoint'],session['expected_anchor'])
                    session['completed_slices']+=1
                    event={'at':utc(),'event':'slice_finished','session_id':session['id'],'slice':session['completed_slices'],
                           'active_seconds':session['active_seconds'],'result':result,
                           'rows_processed':session['last_checkpoint']['cursor']['rows_processed']}
                    processed=event['rows_processed']-session['initial_rows']
                    if processed>0 and session['active_seconds']>0:
                        event['observed_rows_per_active_second']=processed/session['active_seconds']
                        if session.get('estimated_source_rows'):
                            event['estimated_remaining_active_seconds']=max(0,session['estimated_source_rows']-event['rows_processed'])/event['observed_rows_per_active_second']
                            event['estimate_warning']='Catalog-based extrapolation; not a completion guarantee'
                    append_event(path.parent/'events.jsonl',event);print(json.dumps(event,default=str),flush=True)
                    if result.get('supervisor_stop') in ('paused','source_or_config_changed'):
                        session['status']=result['supervisor_stop'];break
                    controlled_deadline=result.get('continuation',{}).get('classification')=='verified_controlled_deadline'
                    if (not controlled_deadline and (result['exit_code'] or result['event'] not in ('run_complete','source_not_ready','paused'))):
                        session['status']='failed';break
                    if result['event']=='paused':session['status']='paused';break
                atomic_json(path,session)
                rest_until=time.monotonic()+min(args.rest_seconds,max(0,remaining(session)-CLEANUP_RESERVE_SECONDS))
                while time.monotonic()<rest_until:
                    if pause_changed(pause_state(conn,config),session['pause_baseline']):break
                    time.sleep(min(1,max(0,rest_until-time.monotonic())))
            else:session['status']='budget_exhausted'
            atomic_json(path,session)
            print(json.dumps({'event':'bootstrap_session_stopped','status':session['status'],'session':str(path),
                              'active_seconds':session['active_seconds']}),flush=True)
            return 1 if session['status']=='failed' else 0
        except BaseException as exc:
            if session is not None and path is not None:
                session['status']='interrupted' if not isinstance(exc,Exception) else 'failed'
                # Exception text can contain connection/configuration values.
                # Retain a type and checkpoint identity, never credentials.
                session['error_type']=type(exc).__name__
                atomic_json(path,session)
                append_event(path.parent/'events.jsonl',{'at':utc(),'event':'bootstrap_session_stopped',
                    'status':session['status'],'error_type':type(exc).__name__,'session_id':session['id']})
            raise
        finally:conn.close()


def cli(argv=None):
    try:return main(argv)
    except Exception as exc:
        # DSN parsing and connection exceptions can include configuration text.
        print(json.dumps({'event':'bootstrap_driver_failed','error_type':type(exc).__name__}),file=sys.stderr,flush=True)
        return 1


if __name__=='__main__':raise SystemExit(cli())
