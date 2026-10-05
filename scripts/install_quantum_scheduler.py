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
import re
import subprocess
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'webapps/quantum_exposure/pipeline'))
from quantum_worker_config import bootstrap_row_limits

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
    record=json.loads(path.read_text())
    if not isinstance(record,dict):
        raise ValueError('Acceptance evidence must be an object')
    required=('code_revision','checkpoint_height','checkpoint_hash','generation_id','website_commit',
              'standalone_commit','active_seconds_per_boundary','peak_private_memory_bytes',
              'accounting_passed','recovery_passed','rollback_passed','browser_passed')
    for key in required:
        if key not in record or record[key] is None:
            raise ValueError(f'Acceptance evidence missing {key}')
    for key in ('accounting_passed','recovery_passed','rollback_passed','browser_passed'):
        if record[key] is not True:
            raise ValueError(f'Acceptance gate failed: {key}')
    for key in ('code_revision','website_commit','standalone_commit'):
        if not isinstance(record[key],str) or not re.fullmatch(r'[a-f0-9]{40}|[a-f0-9]{64}',record[key]):
            raise ValueError(f'Acceptance evidence has an invalid commit: {key}')
    if not isinstance(record['checkpoint_hash'],str) or not re.fullmatch(r'[a-f0-9]{64}',record['checkpoint_hash']):
        raise ValueError('Acceptance checkpoint hash is invalid')
    if type(record['checkpoint_height']) is not int or record['checkpoint_height']<0:
        raise ValueError('Acceptance checkpoint height is invalid')
    if not isinstance(record['generation_id'],str) or not re.fullmatch(r'[A-Za-z0-9_-]+',record['generation_id']):
        raise ValueError('Acceptance generation identity is invalid')
    for key in ('active_seconds_per_boundary','peak_private_memory_bytes'):
        if type(record[key]) not in (int,float) or not math.isfinite(record[key]) or record[key]<0:
            raise ValueError(f'Acceptance measurement is invalid: {key}')
    if record['active_seconds_per_boundary']>1800:
        raise ValueError('Measured boundary exceeds proposed 30-minute acceptance target')
    if record['peak_private_memory_bytes']>4*1024**3:
        raise ValueError('Measured private memory exceeds proposed 4 GiB acceptance target')
    return record


def check_scheduler_limits(config):
    try:
        bootstrap_row_limits(config)
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
            'memory_limit_bytes':4*1024**3}
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
            for key in ('work_seconds','export_seconds','batch_blocks','bootstrap_rows','bootstrap_rows_by_source','max_batch_rows',
                        'batch_pause_seconds','memory_limit_bytes','label_version',
                        'validation_rows','validation_blocks','reset_rows'):
                if key in existing:
                    config[key]=existing[key]
        if args.label_version:
            config['label_version']=args.label_version
        check_scheduler_limits(config)
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
