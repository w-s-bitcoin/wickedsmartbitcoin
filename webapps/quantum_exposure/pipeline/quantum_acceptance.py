"""Read-only scheduler acceptance against durable production evidence.

The operator still reviews recovery, rollback and browser reports. This gate
checks their recorded identity and hash; it does not claim to automate review.
No producer, migration, delivery, or scheduler is invoked here.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import subprocess

from quantum_worker_config import config_fingerprint, control_settings, effective_config, PROJECTION_ACCOUNTING_VERSION


VERSION = 'quantum-acceptance-v2'


def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError('Scheduler acceptance: '+message)


def positive(value):
    return type(value) in (int,float) and math.isfinite(value) and value>0


def check_record(record):
    import re
    require(isinstance(record,dict) and record.get('version')==VERSION,'a measured v2 acceptance record is required')
    for key in ('implementation_sha256','config_sha256','validation_report_sha256','checkpoint_hash','control_sha256'):
        require(isinstance(record.get(key),str) and re.fullmatch('[a-f0-9]{64}',record[key]),'invalid '+key)
    for key in ('code_revision','website_commit','standalone_commit'):
        require(isinstance(record.get(key),str) and re.fullmatch('[a-f0-9]{40}|[a-f0-9]{64}',record[key]),'invalid '+key)
    for key in ('checkpoint_height','request_id'):
        require(type(record.get(key)) is int and record[key]>0,'invalid '+key)
    require(record['checkpoint_height']%1000==0,'checkpoint must be a 1,000-block boundary')
    require(isinstance(record.get('generation_id'),str) and re.fullmatch('[A-Za-z0-9_-]+',record['generation_id']),'invalid generation identity')
    require(isinstance(record.get('database'),str) and record['database'],'database identity is required')
    require(isinstance(record.get('run_ids'),list) and record['run_ids'] and
            len(set(record['run_ids']))==len(record['run_ids']),'measured run IDs are required')
    for key,limit in (('active_seconds_per_boundary',1800),('peak_private_memory_bytes',4*1024**3)):
        require(positive(record.get(key)) and record[key]<=limit,'invalid or over-budget '+key)
    require(isinstance(record.get('reviews'),dict) and set(record['reviews'])=={'browser','recovery','rollback'},
            'reviewed browser, recovery and rollback evidence is required')
    return record


def check_evidence(record, state_dir):
    """Hash-bound operator reports; ordinary text summaries remain reviewable."""
    for kind, item in record['reviews'].items():
        require(isinstance(item,dict) and isinstance(item.get('path'),str),'invalid '+kind+' report reference')
        relative=Path(item['path'])
        require(not relative.is_absolute() and '..' not in relative.parts,'report must be under state_dir')
        path=(Path(state_dir)/relative).resolve()
        require(Path(state_dir).resolve() in path.parents,'report escapes state_dir')
        payload=path.read_bytes()
        require(hashlib.sha256(payload).hexdigest()==item.get('sha256'),kind+' report hash differs')
        report=json.loads(payload)
        require(report.get('kind')==kind and report.get('passed') is True and
                isinstance(report.get('summary'),str) and bool(report['summary'].strip()),kind+' review is incomplete')
        for key in ('implementation_sha256','config_sha256','request_id','generation_id','checkpoint_height','checkpoint_hash'):
            require(report.get(key)==record[key],kind+' review covers another '+key)


def read_snapshot(conn, record):
    """One repeatable-read snapshot; caller retains the global writer lock."""
    from psycopg2.extras import RealDictCursor
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        def one(sql,args=()):
            cur.execute(sql,args)
            row=cur.fetchone()
            return dict(row) if row else None
        def many(sql,args=()):
            cur.execute(sql,args)
            return [dict(row) for row in cur.fetchall()]
        snapshot={'database':one('SELECT current_database() AS name')['name'],
                  'projection':one('SELECT * FROM quantum_v2.projection WHERE singleton'),
                  'source':one('SELECT * FROM quantum_v2.source_state WHERE singleton'),
                  'control':one('SELECT * FROM quantum_v2.control WHERE singleton'),
                  'request':one('SELECT * FROM quantum_v2.request WHERE id=%s',(record['request_id'],)),
                  'incomplete_bootstrap':one('SELECT count(*) AS n FROM quantum_v2.bootstrap_cursor WHERE NOT complete')['n']}
        projection=snapshot['projection'] or {}
        snapshot['validations']=many('SELECT * FROM quantum_v2.validation_result WHERE target_height=ANY(%s)',
                                      ([record['checkpoint_height'],projection.get('anchor_height',-1)],))
        snapshot['runs']=many('SELECT * FROM quantum_v2.run WHERE request_id=%s ORDER BY started_at,id',(record['request_id'],))
        snapshot['deliveries']=many('SELECT * FROM quantum_v2.delivery WHERE request_id=%s',(record['request_id'],))
        snapshot['accepted']=many('SELECT * FROM quantum_v2.accepted_generation')
        snapshot['steps']=many('SELECT * FROM quantum_v2.step WHERE request_id=%s',(record['request_id'],))
        snapshot['batches']=many('SELECT * FROM quantum_v2.projection_batch WHERE to_height>%s AND to_height<=%s ORDER BY to_height',
                                 (projection.get('anchor_height',record['checkpoint_height']),record['checkpoint_height']))
        heights={record['checkpoint_height'],projection.get('anchor_height',-1),
                 (snapshot['source'] or {}).get('committed_height',-1),record['checkpoint_height']-1000}
        for batch in snapshot['batches']:
            heights.update((batch['from_height'],batch['to_height']))
        snapshot['canonical']=dict((row['blockheight'],row['blockhash']) for row in
            many('SELECT blockheight,blockhash FROM public.blockheader WHERE blockheight=ANY(%s)',(sorted(heights),)))
        return snapshot


def check_snapshot(record, snapshot, config, implementation, *, validation_version):
    """Pure evidence reconciliation, shared by DB integration and fixtures."""
    import quantum_v2_analysis as analysis
    check_record(record)
    require(record['implementation_sha256']==implementation,'tested implementation differs')
    require(record['config_sha256']==config_fingerprint(config),'tested effective configuration differs')
    reserve=effective_config(config)['disk_reserve_bytes']
    require(type(reserve) is int and reserve>0,'enabled scheduling requires a measured positive disk reserve')
    require(record['database']==snapshot['database'],'database differs from measured production evidence')
    height,block_hash=record['checkpoint_height'],record['checkpoint_hash']
    projection=snapshot['projection'] or {}
    require(projection.get('status')=='ready' and projection.get('height')==height and
            projection.get('block_hash')==block_hash and not snapshot['incomplete_bootstrap'],'projection/bootstrap is not complete at the accepted checkpoint')
    require(projection.get('seed_mode')=='canonical','legacy balance reconciliation does not certify disclosure/activity history; finish a canonical source seed')
    require(projection.get('methodology_version')==PROJECTION_ACCOUNTING_VERSION,'projection accounting version differs')
    source=snapshot['source'] or {}
    cfg=snapshot['control'] or {}
    require(source.get('ready') is True and type(source.get('committed_height')) is int and
            isinstance(source.get('committed_hash'),str) and len(source['committed_hash'])==64 and
            type(cfg.get('confirmations')) is int and cfg['confirmations']>=0 and
            source.get('committed_height',-1)-cfg['confirmations']>=height and
            snapshot['canonical'].get(source.get('committed_height'))==source.get('committed_hash'),'source is not ready/canonical at the required confirmation depth')
    require(snapshot['canonical'].get(height)==block_hash,'checkpoint is no longer canonical')
    require(cfg.get('boundary_size')==1000,'scheduler boundary is not 1,000 blocks')
    require(digest(control_settings(cfg))==record['control_sha256'],'persisted scheduler settings differ from acceptance')
    request=snapshot['request'] or {}
    for key,value in (('status','complete'),('target_height',height),('target_hash',block_hash),
                      ('generation_id',record['generation_id']),('methodology_version',analysis.METHODOLOGY_VERSION)):
        require(request.get(key)==value,'request does not match completed production '+key)
    require({'projection','export'}<={row['name'] for row in snapshot['steps'] if row['status']=='complete'},'projection/export steps are incomplete')
    proof=next((row for row in snapshot['validations'] if digest(row['report'])==record['validation_report_sha256']),None)
    require(proof and proof['passed'] is True,'full accounting proof is absent or differs')
    report=proof['report']
    require(report.get('passed') is True and report.get('mismatched_group_families')==0 and
            report.get('version')==validation_version and report.get('parser_version')==analysis.PARSER_VERSION and
            report.get('grouping_version')==analysis.GROUPING_VERSION and positive(report.get('source_rows')) and
            positive(report.get('accounted_utxos')) and positive(report.get('compared_group_families')),'accounting proof is incomplete or uses different analysis versions')
    proof_height,proof_hash=proof['target_height'],proof['target_hash']
    require(report.get('target_height')==proof_height and report.get('target_hash')==proof_hash and
            snapshot['canonical'].get(proof_height)==proof_hash,'accounting proof is no longer canonical')
    if proof_height!=height:
        require((proof_height,proof_hash)==(projection['anchor_height'],projection['anchor_hash']),'accounting proof is not the current canonical anchor')
        require(proof_height==height-1000,'anchor proof precedes the fully measured interval; reconcile the candidate checkpoint explicitly')
        cursor,cursor_hash=proof_height,proof_hash
        for batch in snapshot['batches']:
            require((batch['from_height'],batch['from_hash'])==(cursor,cursor_hash) and
                    batch['to_height']>cursor and snapshot['canonical'].get(batch['to_height'])==batch['to_hash'],
                    'incremental journal from accounting anchor has a gap or changed hash')
            cursor,cursor_hash=batch['to_height'],batch['to_hash']
        require((cursor,cursor_hash)==(height,block_hash),'accounting journal does not reach the candidate checkpoint; reconcile this checkpoint explicitly')
    for destination in ('website','standalone'):
        delivery=next((row for row in snapshot['deliveries'] if row['destination']==destination),{})
        accepted=next((row for row in snapshot['accepted'] if row['destination']==destination),{})
        commit=record[destination+'_commit']
        require(delivery.get('status')=='complete' and delivery.get('accepted_commit')==commit,'missing exact '+destination+' delivery receipt')
        for key,value in (('request_id',record['request_id']),('generation_id',record['generation_id']),
                          ('target_height',height),('target_hash',block_hash),('accepted_commit',commit)):
            require(accepted.get(key)==value,destination+' accepted generation differs: '+key)
    runs=snapshot['runs']
    require([str(row['id']) for row in runs]==record['run_ids'],'run IDs omit or reorder request attempts')
    cursor=height-1000
    active=0.0
    peak=0
    for row in runs:
        metric=row['metrics']
        require(row['status']=='succeeded' and row.get('finished_at') and not row.get('error') and
                metric.get('mode')=='boundary' and not metric.get('deferred'),
                'boundary includes unfinished, failed, bootstrap or deferred attempts; measure a fresh complete boundary')
        require(metric.get('implementation_sha256')==implementation and metric.get('config_sha256')==record['config_sha256'],
                'run source/config provenance differs or is absent')
        require(metric.get('scheduler_control')==control_settings(cfg),'run scheduler settings differ')
        before,after=metric.get('projection_before',{}),metric.get('projection_after',{})
        require(before.get('status')==after.get('status')=='ready' and before.get('height')==cursor and
                type(after.get('height')) is int and cursor<=after['height']<=height,'measured runs do not cover one contiguous complete 1,000-block boundary')
        if cursor==height-1000:
            require(before.get('block_hash')==snapshot['canonical'].get(cursor) and bool(before.get('block_hash')),
                    'measured starting checkpoint is not canonical')
        if active:
            require(before['block_hash']==last_hash,'measured run checkpoint hashes do not join')
        cursor,last_hash=after['height'],after.get('block_hash')
        require(positive(metric.get('wall_seconds')) and positive(metric.get('peak_combined_private_memory_bytes')) and
                metric.get('memory_limit_exceeded') is False and metric.get('memory_measurement_error') is None,
                'run has no valid positive private-memory/time measurement')
        processes=metric.get('processes',{})
        require(len(processes)==2 and all(positive(item.get('private_memory_bytes')) and not item.get('measurement_unavailable')
                                         for item in processes.values()),'worker/backend private memory was not measured')
        disks=metric.get('observed_minimum_free_disk_bytes',{})
        require(metric.get('minimum_free_disk_bytes')==reserve and metric.get('disk_reserve_exceeded') is False and
                metric.get('disk_measurement_error') is None and isinstance(disks,dict) and disks and
                all(type(value) is int and value>=reserve for value in disks.values()),
                'disk reserve was not measured on the production volumes or was breached')
        active+=metric['wall_seconds']
        peak=max(peak,metric['peak_combined_private_memory_bytes'])
    require(cursor==height and last_hash==block_hash,'measured boundary does not reach the exported checkpoint')
    require(math.isclose(active,record['active_seconds_per_boundary'],rel_tol=1e-9,abs_tol=1e-6) and
            peak==record['peak_private_memory_bytes'],'declared metrics differ from all persisted request runs')
    require(active<=1800 and peak<=4*1024**3,'measured complete boundary exceeds acceptance budgets')
    return {'request_id':record['request_id'],'active_seconds_per_boundary':active,'peak_private_memory_bytes':peak}


def check_files(record, snapshot, config):
    from immutable_generation import validate_immutable_generation
    from quantum_runtime import runtime_dependency_copies
    output=Path(snapshot['request']['output_dir']).resolve()
    require(output.parent==(Path(config['state_dir'])/'generations').resolve(),'sealed output is outside the configured production state')
    marker=json.loads((output/'published_generation.json').read_text())
    validate_immutable_generation(output,marker)
    require(marker.get('format')==2 and marker.get('generation_id')==record['generation_id'] and
            marker.get('snapshot_blockheight')==record['checkpoint_height'],'sealed publication identity differs')
    metadata=marker.get('metadata',{})
    for key in ('request_id','implementation_sha256','checkpoint_hash'):
        field='block_hash' if key=='checkpoint_hash' else key
        require(metadata.get(field)==record[key],'sealed publication metadata differs: '+field)
    relative='webapps/quantum_exposure/webapp_data/published_generation.json'
    def git(repo,*args):
        return subprocess.check_output(['git',*args],cwd=repo,text=True).strip()
    for destination in ('website','standalone'):
        repo=Path(config['production_repo' if destination=='website' else 'standalone_repo'])
        require(git(repo,'branch','--show-current')=='main',destination+' repository is not on main')
        commit=record[destination+'_commit']
        subprocess.run(['git','merge-base','--is-ancestor',commit,'HEAD'],cwd=repo,check=True,capture_output=True)
        accepted=json.loads(git(repo,'show',commit+':'+relative))
        require(accepted==marker,destination+' accepted Git marker differs from sealed publication')
        require(json.loads((repo/relative).read_text())==marker,destination+' current marker differs')
    runtime=Path(config['production_repo'])/'webapps/quantum_exposure'
    standalone=Path(config['standalone_repo'])
    for source,target in runtime_dependency_copies(runtime,standalone):
        require(target.is_file() and source.read_bytes()==target.read_bytes(),'standalone runtime does not match tested source: '+target.name)
    require(not git(standalone,'status','--porcelain'),'standalone has uncommitted changes')
    check_evidence(record,config['state_dir'])


def verify_live(record, config):
    from quantum_runtime import implementation_fingerprint
    from run_quantum_worker import connect, REPO
    from quantum_v2_validation import VERSION as validation_version
    require(Path(config['production_repo']).resolve()==REPO.resolve(),'verifier must run from the configured production checkout')
    conn=connect(config)
    try:
        conn.set_session(isolation_level='REPEATABLE READ',readonly=True)
        with conn.cursor() as cur:
            cur.execute('SELECT pg_try_advisory_lock(811947,2)')
            require(cur.fetchone()[0],'worker or another projection mutation is active')
        snapshot=read_snapshot(conn,record)
        result=check_snapshot(record,snapshot,config,implementation_fingerprint(REPO),validation_version=validation_version)
        check_files(record,snapshot,config)
        # Source ingestion does not take the projection writer lock. Recheck in
        # a fresh snapshot after potentially lengthy immutable-file hashing.
        conn.rollback()
        check_snapshot(record,read_snapshot(conn,record),config,implementation_fingerprint(REPO),
                       validation_version=validation_version)
        return result
    finally:
        conn.close()


def main():
    import argparse
    import sys
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--record',type=Path,required=True)
    args=parser.parse_args()
    record=check_record(json.loads(args.record.read_text()))
    config=json.load(sys.stdin)
    print(json.dumps(verify_live(record,config)))


if __name__=='__main__':
    main()
