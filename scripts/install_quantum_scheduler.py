#!/usr/bin/env python3
"""Install the separate per-user Quantum LaunchAgent after measured validation.

Default prints paths. --install writes configuration/plist but does not enable
the job. --enable also requires the recorded acceptance evidence in state_dir.
Credentials stay in the existing environment file; the plist contains no secrets.
"""
from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
import plistlib
import subprocess
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'webapps/quantum_exposure/pipeline'))
from quantum_worker_config import bootstrap_row_limits, bootstrap_resource_limits, undo_retention_blocks, DEFAULT_DISK_RESERVE_BYTES
from quantum_acceptance import check_record, config_fingerprint

LABEL='com.wickedsmartbitcoin.quantum'
ACCEPTANCE_RUNTIME_PATHS=(
    'webapps/quantum_exposure/pipeline', 'webapps/quantum_exposure/dashboard.html',
    'webapps/quantum_exposure/dashboard_app.js', 'webapps/quantum_exposure/preview.html',
    'webapps/quantum_exposure/preview_app.js', 'webapps/quantum_exposure/standalone_app.js',
    'webapps/shared', 'scripts/automation/_git_deploy.py', 'scripts/build_pages_dist.sh',
)


def launch_agent(config_path,python,production_repo,logs):
    worker=production_repo/'webapps/quantum_exposure/pipeline/run_quantum_worker.py'
    return {'Label':LABEL,'ProgramArguments':[str(python),str(worker),'--config',str(config_path),'once'],
            'WorkingDirectory':str(production_repo),'RunAtLoad':True,'StartInterval':60,
            'ProcessType':'Background','Nice':10,'LowPriorityIO':True,'ThrottleInterval':60,
            'ExitTimeOut':20,'EnvironmentVariables':{
                'PATH':'/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
                'GIT_TERMINAL_PROMPT':'0','PYTHONUNBUFFERED':'1'},
            'StandardOutPath':str(logs/'worker.log'),'StandardErrorPath':str(logs/'worker-error.log')}


def check_acceptance(path):
    return check_record(json.loads(path.read_text()))


def check_scheduler_limits(config):
    try:
        bootstrap_row_limits(config)
        bootstrap_resource_limits(config)
        undo_retention_blocks(config)
    except ValueError as exc:
        raise ValueError(f'Scheduler {exc}') from exc
    for key,ceiling in (('work_seconds',45),('export_seconds',1800),('memory_limit_bytes',4*1024**3)):
        value=config[key]
        if type(value) not in (int,float) or not math.isfinite(value) or not 0<value<=ceiling:
            raise ValueError(f'Scheduler {key} must be positive and no more than {ceiling}')
    for key in ('batch_blocks','bootstrap_rows','max_batch_rows','validation_rows','validation_blocks','reset_rows'):
        if key not in config:
            continue
        if type(config[key]) is not int or config[key]<=0:
            raise ValueError(f'Scheduler {key} must be a positive integer')
    pause=config['batch_pause_seconds']
    if type(pause) not in (int,float) or not math.isfinite(pause) or not 0<=pause<=45:
        raise ValueError('Scheduler batch_pause_seconds must be between zero and 45')
    reserve=config['disk_reserve_bytes']
    if type(reserve) is not int or reserve<0:
        raise ValueError('Scheduler disk_reserve_bytes must be a nonnegative integer')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--production-repo',type=Path,required=True)
    parser.add_argument('--standalone-repo',type=Path,required=True)
    parser.add_argument('--python',type=Path,required=True)
    parser.add_argument('--env-file',type=Path,required=True)
    parser.add_argument('--state-dir',type=Path,required=True)
    parser.add_argument('--label-version')
    parser.add_argument('--install',action='store_true')
    parser.add_argument('--enable',action='store_true')
    args=parser.parse_args()
    for name in ('production_repo','standalone_repo','python','env_file','state_dir'):
        setattr(args,name,getattr(args,name).expanduser().resolve())
    state=args.state_dir.expanduser().resolve()
    config_path=state/'config.json'
    logs=Path.home()/'Library/Logs/WickedSmartBitcoin/quantum'
    plist_path=Path.home()/'Library/LaunchAgents'/f'{LABEL}.plist'
    config={'production_repo':str(args.production_repo.resolve()),'standalone_repo':str(args.standalone_repo.resolve()),
            'env_file':str(args.env_file.resolve()),'state_dir':str(state),'work_seconds':45,'export_seconds':900,
            'batch_blocks':10,'bootstrap_rows':10000,'max_batch_rows':250000,'batch_pause_seconds':0.25,
            'memory_limit_bytes':4*1024**3,'undo_blocks':2016,'disk_reserve_bytes':DEFAULT_DISK_RESERVE_BYTES}
    if args.label_version:
        config['label_version']=args.label_version
    if args.install or args.enable:
        target=f'gui/{os.getuid()}'
        if subprocess.run(['launchctl','print',f'{target}/{LABEL}'],capture_output=True).returncode==0:
            raise SystemExit('Job is already loaded; inspect its installed configuration before replacing it')
        if args.production_repo==args.standalone_repo:
            raise SystemExit('Production and standalone must be separate repositories')
        for repo in (args.production_repo,args.standalone_repo):
            if not repo.is_dir():
                raise SystemExit(f'Missing scheduler repository: {repo}')
            if state==repo or repo in state.parents:
                raise SystemExit('Scheduler state must be outside published repositories')
        if config_path.is_symlink() or plist_path.is_symlink():
            raise SystemExit('Refusing to replace a symlinked scheduler configuration or plist')
    if args.enable:
        acceptance=check_acceptance(state/'acceptance.json')
        dirty=subprocess.check_output(['git','status','--porcelain','--',*ACCEPTANCE_RUNTIME_PATHS],
            cwd=args.production_repo,text=True)
        if dirty.strip():
            raise SystemExit('Relevant production runtime files are dirty; acceptance does not cover them')
        revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=args.production_repo,text=True).strip()
        # Automation data commits may follow the tested code revision. Require
        # that revision to be an ancestor and the worker sources to match it.
        subprocess.run(['git','merge-base','--is-ancestor',acceptance['code_revision'],revision],cwd=args.production_repo,check=True)
        subprocess.run(['git','diff','--exit-code',acceptance['code_revision'],revision,'--',
                        *ACCEPTANCE_RUNTIME_PATHS],cwd=args.production_repo,check=True)
    if args.install or args.enable:
        for file in (args.python,args.env_file,args.production_repo/'webapps/quantum_exposure/pipeline/run_quantum_worker.py'):
            if not file.is_file():
                raise SystemExit(f'Missing scheduler dependency: {file}')
        if config_path.exists():
            existing=json.loads(config_path.read_text())
            # Keep measured settings and enrichment revision from initialization.
            for key in ('work_seconds','bootstrap_work_seconds','bootstrap_temp_buffers_mb',
                        'bootstrap_work_mem_mb','bootstrap_memory_limit_bytes',
                        'export_seconds','batch_blocks','bootstrap_rows','bootstrap_rows_by_source','max_batch_rows',
                        'batch_pause_seconds','memory_limit_bytes','label_version',
                        'validation_rows','validation_blocks','reset_rows','undo_blocks','disk_reserve_bytes'):
                if key in existing:
                    config[key]=existing[key]
        if args.label_version:
            config['label_version']=args.label_version
        check_scheduler_limits(config)
        if args.enable:
            if config['disk_reserve_bytes']<=0:
                raise SystemExit('Enabled scheduling requires a positive disk reserve')
            if acceptance['config_sha256']!=config_fingerprint(config):
                raise SystemExit('Acceptance does not cover the proposed effective configuration')
            verifier=args.production_repo/'webapps/quantum_exposure/pipeline/quantum_acceptance.py'
            # Use the same interpreter, environment and production source as the
            # worker. The verifier is read-only; no files are installed first.
            result=subprocess.run([str(args.python),str(verifier),'--record',str(state/'acceptance.json')],
                                  input=json.dumps(config),text=True,capture_output=True)
            if result.returncode:
                raise SystemExit('Persisted production acceptance verification failed: '+result.stderr.strip())
        state.mkdir(parents=True,exist_ok=True,mode=0o700)
        logs.mkdir(parents=True,exist_ok=True)
        plist_path.parent.mkdir(parents=True,exist_ok=True)
        config_path.write_text(json.dumps(config,indent=2)+'\n')
        config_path.chmod(0o600)
        plist_path.write_bytes(plistlib.dumps(launch_agent(config_path,args.python,args.production_repo,logs)))
        if args.enable:
            subprocess.run(['launchctl','enable',f'{target}/{LABEL}'],check=True)
            subprocess.run(['launchctl','bootstrap',target,str(plist_path)],check=True)
            subprocess.run(['launchctl','print',f'{target}/{LABEL}'],check=True)
    print(json.dumps({'config':str(config_path),'plist':str(plist_path),'logs':str(logs),
                      'enabled_requested':args.enable},indent=2))


if __name__=='__main__':
    main()
