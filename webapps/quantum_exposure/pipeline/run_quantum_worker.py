#!/usr/bin/env python3
"""Separate, bounded Quantum coordinator. No work occurs at import time.

The launchd job invokes ``--config /absolute/path/config.json once``. Production
paths and credentials are explicit in that local file; it contains only a path
to the existing environment file, never copied secret values. Status is default.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone

import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

import quantum_v2_analysis as analysis
import quantum_v2_control as control
import quantum_v2_store as store
import quantum_v2_validation as validation
from quantum_resources import ResourceMonitor, database_usage, lower_priority
from quantum_worker_config import bootstrap_row_limits, undo_retention_blocks, config_fingerprint, control_settings, DEFAULT_DISK_RESERVE_BYTES
from quantum_runtime import implementation_fingerprint

PIPELINE=Path(__file__).resolve().parent
REPO=PIPELINE.parents[2]


def log(event,**fields):
    print(json.dumps({'at':datetime.now(timezone.utc).isoformat(),'event':event,**fields},default=str),flush=True)


def connect(config,*,connect_timeout=None):
    if config.get('env_file'):
        load_dotenv(config['env_file'],override=False)
    options={key:value for key,value in {
        'host':os.getenv('POSTGRES_HOST'),'dbname':os.getenv('POSTGRES_DB','bitcoin_data'),
        'user':os.getenv('POSTGRES_USER'),'password':os.getenv('POSTGRES_PASSWORD'),
        'application_name':'quantum-v2-worker',
        'options':'-c work_mem=32MB -c max_parallel_workers_per_gather=0 -c temp_file_limit=2GB -c lock_timeout=2s -c statement_timeout=300000',
    }.items() if value is not None}
    timeout={} if connect_timeout is None else {'connect_timeout':connect_timeout}
    conn=psycopg2.connect(config.get('dsn',''),**options,**timeout) if not config.get('dsn') else psycopg2.connect(config['dsn'],application_name='quantum-v2-worker',options=options['options'],**timeout)
    conn.set_session(isolation_level='READ COMMITTED',autocommit=False)
    return conn


def _projection(conn):
    with conn,conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute('SELECT * FROM quantum_v2.projection WHERE singleton')
        row=cur.fetchone()
        return dict(row) if row else None


def _bootstrap_page_limit(conn, fallback, by_source):
    """Read the next durable source while run_once holds the global writer lock."""
    if not by_source:
        return fallback
    with conn, conn.cursor() as cur:
        cur.execute('''SELECT source_table FROM quantum_v2.bootstrap_cursor
                       WHERE NOT complete ORDER BY source_table LIMIT 1''')
        row = cur.fetchone()
    return by_source.get(row[0], fallback) if row else fallback


def _baseline_verified(conn,projection):
    with conn,conn.cursor() as cur:
        cur.execute('''SELECT passed,report->>'version',report->>'parser_version',report->>'grouping_version'
            FROM quantum_v2.validation_result WHERE target_height=%s AND target_hash=%s''',
            (projection['anchor_height'],projection['anchor_hash']))
        row=cur.fetchone()
        return bool(row and row==(True,validation.VERSION,analysis.PARSER_VERSION,analysis.GROUPING_VERSION))


class PauseRequested(RuntimeError):
    pass


class PauseGate:
    """Admin commands may bypass an old pause, never a newly requested pause."""
    def __init__(self,conn,config,*,bypass_existing=False):
        self.conn=conn
        self.path=Path(config['state_dir'])/'PAUSED'
        self.baseline=self._state() if bypass_existing else None

    def _state(self):
        try:
            stat=self.path.stat()
            file_token=(stat.st_dev,stat.st_ino,stat.st_mtime_ns,stat.st_ctime_ns,stat.st_size)
        except FileNotFoundError:
            file_token=None
        # Called only between committed pages, never inside the export cursor's
        # repeatable-read transaction.
        with self.conn,self.conn.cursor() as cur:
            cur.execute('SELECT paused,updated_at FROM quantum_v2.control WHERE singleton')
            row=cur.fetchone()
        return file_token,row

    def __call__(self):
        file_token,row=self._state()
        if self.baseline is None:
            return bool(file_token is not None or not row or row[0])
        original_file,original_row=self.baseline
        return bool((file_token is not None and file_token!=original_file)
                    or not row or (row[0] and row!=original_row))


def validate_projection(conn,config,*,deadline,monitor=None,recompare=False,ignore_pause=False,stop_requested=None):
    """Independent raw-source proof, including a bounded group comparison pass."""
    projection=_projection(conn)
    if projection['status']!='ready':
        raise RuntimeError('Finish initialization before reconciling the projection')
    def stopped():
        return (stop_requested() if stop_requested is not None else
                not ignore_pause and (Path(config['state_dir'])/'PAUSED').exists())
    if stopped():
        log('validation_paused')
        return False
    validation.initialize(conn,projection['height'],projection['block_hash'],recompare=recompare)
    done=False
    while time.monotonic()<deadline:
        if stopped():
            log('validation_paused')
            return False
        done=validation.step(conn,limit=int(config.get('validation_rows',config.get('bootstrap_rows',10000))),
                             window_blocks=int(config.get('validation_blocks',1000)))
        _check_resources(monitor)
        if done:
            if stopped():
                log('validation_paused')
                return False
            report=validation.verify(conn)
            log('validation_complete',report=report)
            if not report['passed']:
                raise RuntimeError('Independent per-group reconciliation failed; publication remains blocked')
            return True
        time.sleep(float(config.get('batch_pause_seconds',0.25)))
    with conn,conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute('SELECT * FROM quantum_v2.validation_checkpoint WHERE singleton')
        log('validation_checkpoint',checkpoint=dict(cur.fetchone()))
    return False


def _check_resources(monitor):
    if monitor is not None and monitor.exceeded:
        raise RuntimeError('Resource guard exceeded; batch checkpoint retained')
    if monitor is not None and getattr(monitor,'measurement_error',None):
        raise RuntimeError('Resource measurement failed; checkpoint retained')
    if monitor is not None and getattr(monitor,'disk_exceeded',False):
        raise RuntimeError('Quantum disk reserve reached; checkpoint retained')
    if monitor is not None and getattr(monitor,'disk_measurement_error',None):
        raise RuntimeError('Disk measurement failed; checkpoint retained')


def _resource_disk_paths(conn,config):
    """Inspect the actual local PG data/WAL/tablespace and output filesystems."""
    with conn,conn.cursor() as cur:
        cur.execute('SHOW data_directory')
        data=Path(cur.fetchone()[0])
        cur.execute('''SELECT DISTINCT pg_tablespace_location(s.oid)
            FROM pg_tablespace s WHERE s.oid IN (
                SELECT dattablespace FROM pg_database WHERE datname=current_database()
                UNION SELECT c.reltablespace FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                      WHERE n.nspname='quantum_v2' AND c.reltablespace<>0)''')
        paths=[data,data/'pg_wal',Path(config['state_dir'])]
        paths.extend(Path(row[0]) for row in cur.fetchall() if row[0])
    volumes={}
    for path in paths:
        path=path.resolve()
        # Staging may not exist yet; its existing parent is on the same volume.
        while not path.exists() and path!=path.parent:
            path=path.parent
        volumes.setdefault(path.stat().st_dev,str(path))
    return tuple(volumes.values())


def _recovery_source(conn):
    """Read readiness and its canonical tip together, including after a race."""
    with conn,conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute('''SELECT s.ready,s.committed_height,s.committed_hash,c.confirmations,
            b.blockhash AS actual_hash FROM quantum_v2.source_state s
            CROSS JOIN quantum_v2.control c LEFT JOIN public.blockheader b
            ON b.blockheight=s.committed_height WHERE s.singleton AND c.singleton''')
        source=cur.fetchone()
    if not source or not source['ready'] or not source['committed_hash'] or source['committed_hash']!=source['actual_hash']:
        raise store.SourceNotReady('Source is not certified for reorg recovery')
    return source


def _maintenance_action(conn,action,*,deadline,monitor,metrics,stop_requested=None):
    """Run one atomic undo action, cancelling an in-flight query at the deadline."""
    if stop_requested is not None and stop_requested():
        metrics['paused']=True
        return None
    remaining=deadline-time.monotonic()
    if remaining<=0:
        metrics['deadline_reached']=True
        return None
    _check_resources(monitor)
    timer=threading.Timer(remaining,conn.cancel)
    timer.daemon=True; timer.start()
    try:
        result=action()
    except psycopg2.errors.QueryCanceled:
        conn.rollback()
        _check_resources(monitor)
        if time.monotonic()<deadline: raise
        metrics['deadline_reached']=True
        return None
    finally:
        timer.cancel(); timer.join()
    _check_resources(monitor)
    return result


def recover_reorg(conn,config,*,deadline=None,monitor=None,metrics=None,stop_requested=None):
    """Recover within the caller's resource/run budget, including interrupted seeds."""
    if deadline is None: deadline=time.monotonic()+float(config.get('work_seconds',45))
    metrics=metrics if metrics is not None else {}
    metrics.setdefault('reset_pages',0)
    metrics.setdefault('rollback_batches',0)
    projection=_projection(conn)
    if not projection: return None
    if stop_requested is not None and stop_requested():
        return projection
    source=_recovery_source(conn)
    with conn,conn.cursor() as cur:
        cur.execute('SELECT blockheight,blockhash FROM public.blockheader WHERE blockheight=ANY(%s)',
                    ([projection['height'],projection['anchor_height']],))
        hashes=dict(cur.fetchall())
        if (hashes.get(projection['height'])==projection['block_hash'] and
                hashes.get(projection['anchor_height'])==projection['anchor_hash'] and
                projection['status']!='needs_reseed'):
            return projection
        cur.execute('''SELECT p.from_height FROM quantum_v2.projection_batch p
            JOIN public.blockheader b ON b.blockheight=p.from_height AND b.blockhash=p.from_hash
            ORDER BY p.from_height DESC LIMIT 1''')
        ancestor=cur.fetchone()
    _recovery_source(conn)
    if projection['status']=='ready' and ancestor:
        metrics['rollback_pending']=True
        while True:
            def undo_one():
                _recovery_source(conn)
                return store.rollback_step(conn,ancestor[0])
            result=_maintenance_action(conn,undo_one,deadline=deadline,monitor=monitor,
                                       metrics=metrics,stop_requested=stop_requested)
            if result is None:
                return _projection(conn)
            if result['needs_reseed']:
                metrics['rollback_pending']=False
                projection=_projection(conn)
                break
            if result.get('batch_id') is not None:
                metrics['rollback_batches']+=1
            if result['done']:
                metrics['rollback_pending']=False
                metrics['rolled_back_to']=ancestor[0]
                log('reorg_rolled_back',height=ancestor[0])
                return _projection(conn)
            time.sleep(min(float(config.get('batch_pause_seconds',0.25)),max(0,deadline-time.monotonic())))
    if projection['status']!='needs_reseed':
        # No retained boundary repairs the seed. This includes an interrupted
        # seed whose anchor was orphaned before bootstrap finished.
        with store.transaction(conn) as cur:
            store._certify(cur,source['committed_height'],source['committed_hash'])
            cur.execute("UPDATE quantum_v2.projection SET status='needs_reseed',updated_at=now() WHERE singleton")
        projection=_projection(conn)
    source=_recovery_source(conn)
    confirmed=source['committed_height']-source['confirmations']
    with conn,conn.cursor() as cur:
        cur.execute('''SELECT min(r.target_height) FROM quantum_v2.request r
            JOIN public.blockheader b ON b.blockheight=r.target_height AND b.blockhash=r.target_hash
            WHERE r.status IN ('pending','running','blocked') AND r.target_height<=%s''',(confirmed,))
        target=cur.fetchone()[0]
        # Explicit paused bootstrap may have no queued request. Its old anchor
        # is a suitable replacement height once the new canonical block is deep enough.
        if target is None: target=projection['anchor_height']
        if target>confirmed:
            raise store.SourceNotReady('Replacement seed anchor is not yet confirmed')
        cur.execute('SELECT blockhash FROM public.blockheader WHERE blockheight=%s',(target,))
        row=cur.fetchone()
        if not row: raise store.SourceNotReady('Replacement seed target has not been ingested')
        target_hash=row[0]
    metrics.update(target_height=target,target_hash=target_hash)
    # The SQL statement timeout is deliberately larger than one worker slice.
    # Cancel an in-flight reset page at the slice deadline; its transaction
    # rolls back atomically and earlier committed evidence pages remain durable.
    remaining=deadline-time.monotonic()
    timer=threading.Timer(remaining,conn.cancel) if remaining>0 else None
    if timer is not None:
        timer.daemon=True; timer.start()
    try:
        while time.monotonic()<deadline:
            if stop_requested is not None and stop_requested():
                metrics['paused']=True
                break
            _recovery_source(conn)
            _check_resources(monitor)
            done=store.reset_projection_step(conn,confirm_anchor_hash=projection['anchor_hash'],
                limit=int(config.get('reset_rows',config.get('bootstrap_rows',10000))),
                reseed_height=target,reseed_hash=target_hash)
            metrics['reset_pages']+=1
            _check_resources(monitor)
            if done:
                metrics['canonical_seed_initialized']=True
                log('canonical_reseed_started',target=target)
                break
            time.sleep(min(float(config.get('batch_pause_seconds',0.25)),max(0,deadline-time.monotonic())))
        else:
            metrics['deadline_reached']=True
    except psycopg2.errors.QueryCanceled:
        conn.rollback()
        _check_resources(monitor)
        if time.monotonic()<deadline: raise
        metrics['deadline_reached']=True
    finally:
        if timer is not None:
            timer.cancel(); timer.join()
    if metrics.get('deadline_reached'):
        log('reorg_reset_checkpoint',target=target,pages=metrics['reset_pages'])
    return _projection(conn)


def _previous_output(conn,config,target):
    with conn,conn.cursor() as cur:
        cur.execute('''SELECT output_dir FROM quantum_v2.request WHERE target_height<%s
            AND status IN ('analyzed','complete') AND output_dir IS NOT NULL
            ORDER BY target_height DESC,id DESC LIMIT 1''',(target,))
        row=cur.fetchone()
    if row and Path(row[0]).is_dir():
        return Path(row[0])
    return Path(config['production_repo'])/'webapps/quantum_exposure/webapp_data'


def export_request(conn,config,request,*,stop_requested=None):
    import quantum_v2_delivery as delivery
    import quantum_v2_enrichment as enrichment
    from immutable_generation import validate_immutable_generation
    from quantum_runtime import implementation_fingerprint
    stop_requested=stop_requested or PauseGate(conn,config)
    if stop_requested():
        raise PauseRequested('Publication paused before export')
    height=request['target_height']
    projection=_projection(conn)
    if not projection or projection['seed_mode']!='canonical':
        raise RuntimeError('Publication requires canonical-source initialization; legacy seed metadata is unverified')
    if request.get('methodology_version')!=analysis.METHODOLOGY_VERSION:
        raise RuntimeError('Request methodology differs from the canonical exporter; reconcile the pending request first')
    if not projection or not _baseline_verified(conn,projection):
        raise RuntimeError('Independent baseline reconciliation is required before publication')
    generation=f'quantum-{height}-{request["target_hash"][:12]}-r{request["id"]}'
    output=Path(config['state_dir'])/'generations'/generation
    if not control.canonical_ready(conn,height,request['target_hash']):
        raise store.SourceNotReady('Target is no longer ready for export')
    code_revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=REPO,text=True).strip()
    implementation_sha256=implementation_fingerprint(REPO)
    marker=output/'published_generation.json'
    if marker.is_file():
        # Sealing and the database acknowledgement cannot share a transaction.
        # A verified sealed generation is the durable export receipt after a
        # crash in that gap. Reuse its original source epoch and bytes.
        manifest=json.loads(marker.read_text(encoding='utf-8'))
        validate_immutable_generation(output,manifest)
        metadata=manifest['metadata']
        expected={'request_id':request['id'],'snapshot_blockheight':height,
                  'block_hash':request['target_hash'],'implementation_sha256':implementation_sha256,
                  'methodology_version':analysis.METHODOLOGY_VERSION,'parser_version':analysis.PARSER_VERSION,
                  'grouping_version':analysis.GROUPING_VERSION,'scenario_version':analysis.SCENARIO_VERSION,
                  'export_version':analysis.EXPORT_VERSION,
                  'subset_correction_version':analysis.SUBSET_CORRECTION_VERSION,
                  'label_version':config.get('label_version','unattributed-v2')}
        mismatches=[key for key,value in expected.items() if metadata.get(key)!=value]
        if (manifest['generation_id']!=generation or manifest['snapshot_blockheight']!=height or
                request['methodology_version']!=analysis.METHODOLOGY_VERSION or mismatches):
            raise RuntimeError('Sealed generation identity or versions differ from the retry request: '+','.join(mismatches))
        if not control.canonical_ready(conn,height,request['target_hash']):
            raise store.SourceNotReady('Source changed while validating the sealed export receipt')
        control.step(conn,request['id'],'export','complete',{'generation_id':generation,'reused_sealed_generation':True})
        control.analyzed(conn,request['id'],generation,output)
        log('analyzed',height=height,generation_id=generation,output_dir=output,reused_sealed_generation=True)
        return
    control.step(conn,request['id'],'export','running',{'output_dir':str(output)})
    delivery.prepare_output(_previous_output(conn,config,height),output,height)
    conn.set_session(isolation_level='REPEATABLE READ',readonly=True)
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute("SELECT height,block_hash,status FROM quantum_v2.projection WHERE singleton")
                if cur.fetchone() != (height,request['target_hash'],'ready'):
                    raise RuntimeError('Projection checkpoint differs from requested export')
                cur.execute('SELECT time FROM public.blockheader WHERE blockheight=%s AND blockhash=%s',(height,request['target_hash']))
                row=cur.fetchone()
                if not row:
                    raise store.SourceNotReady('Target hash changed before export')
                snapshot_time=int(row[0])
                cur.execute('SELECT epoch FROM quantum_v2.source_state WHERE singleton AND ready')
                source=cur.fetchone()
                if not source:
                    raise store.SourceNotReady('Ingestion started before export')
            rows=store.iter_group_rows(conn)
            revision=config.get('label_version','unattributed-v2')
            group_enricher=None
            if config.get('label_version'):
                group_enricher=lambda groups: enrichment.iter_enriched_rows(conn,groups,revision=revision,
                    predicate=lambda group: group['current_supply_sats']>=100_000_000 and group['exposed_utxo_count']>0)
            metadata=analysis.export_snapshot(_guard_export(rows,config),snapshot_height=height,snapshot_time=snapshot_time,
                output_dir=output,block_hash=request['target_hash'],source_generation=str(source[0]),label_version=revision,
                group_enricher=group_enricher)
    finally:
        conn.set_session(isolation_level='READ COMMITTED',readonly=False)
    if not control.canonical_ready(conn,height,request['target_hash']):
        raise store.SourceNotReady('Source changed before sealing export; retry from checkpoint')
    if stop_requested():
        raise PauseRequested('Publication paused before sealing export')
    if implementation_fingerprint(REPO)!=implementation_sha256:
        raise RuntimeError('Quantum implementation changed during export; generation not sealed')
    metadata.update(block_hash=request['target_hash'],code_revision=code_revision,request_id=request['id'],
                    implementation_sha256=implementation_sha256)
    delivery.finish_output(output,metadata,generation)
    control.step(conn,request['id'],'export','complete',{'generation_id':generation})
    control.analyzed(conn,request['id'],generation,output)
    log('analyzed',height=height,generation_id=generation,output_dir=output)


def _guard_export(rows,config):
    deadline=time.monotonic()+float(config.get('export_seconds',900))
    pause_file=Path(config['state_dir'])/'PAUSED'
    for index,row in enumerate(rows):
        if index%1000==0:
            if pause_file.exists():
                raise PauseRequested('Export paused; isolated partial output remains retryable')
            if time.monotonic()>deadline:
                raise RuntimeError('Export exceeded its explicit time budget; generation not published')
        yield row


def deliver_pending(conn,config,*,stop_requested=None):
    import quantum_v2_delivery as delivery
    from quantum_subprocess import SupervisorStillRunning, cancellation_signals
    stop_requested=stop_requested or PauseGate(conn,config)
    # A retry-only tick reaches this path before the measured SQL work section.
    lower_priority(conn.get_backend_pid())
    for item in control.pending_deliveries(conn):
        if stop_requested():
            log('delivery_paused')
            return
        if not control.canonical_ready(conn,item['target_height'],item['target_hash']):
            continue
        if not control.delivery_started(conn,item['id'],item['destination']):
            continue
        attempt=delivery.DeliveryAttempt(Path(config['state_dir']),item['id'],item['destination'],
            provenance={'generation_id':item['generation_id'],
                        'implementation_sha256':implementation_fingerprint(REPO),
                        'config_sha256':config_fingerprint(config)})
        try:
            with cancellation_signals():
                if item['destination']=='website':
                    receipt=delivery.deliver_website(Path(item['output_dir']),Path(config['production_repo']),item['id'])
                else:
                    receipt=delivery.deliver_standalone(Path(item['output_dir']),Path(config['standalone_repo']))
            metrics=attempt.finish(receipt=receipt)
            control.delivery_finished(conn,item['id'],item['destination'],commit=receipt['commit'],
                                      superseded=receipt.get('status')=='superseded')
            log('delivery_complete',request_id=item['id'],destination=item['destination'],receipt=receipt,
                metrics=metrics,attempt_record=attempt.path)
        except BaseException as exc:
            # The destination remains retryable. A website failure must not
            # prevent independent standalone delivery or repeat projection work.
            message=f'{type(exc).__name__}: {exc}'
            metrics=attempt.finish(error=message[:2000],supervisor_pid=getattr(exc,'pid',None))
            control.delivery_finished(conn,item['id'],item['destination'],error=message[:2000])
            log('delivery_deferred',request_id=item['id'],destination=item['destination'],error=message[:2000],
                metrics=metrics,attempt_record=attempt.path)
            if not isinstance(exc,Exception):
                raise
            if isinstance(exc,SupervisorStillRunning):
                return


def run_once(conn,config,*,bootstrap_only=False,validation_only=False,recompare=False,
             admin_stop_requested=None,admin_deadline=None):
    bootstrap_rows, bootstrap_by_source = bootstrap_row_limits(config, legacy_sources=store.LEGACY)
    undo_blocks=undo_retention_blocks(config)
    if not control.take_writer_lock(conn):
        log('already_running')
        return 0
    run_id=None
    monitor=None
    recovery_metrics={}
    undo_metrics={'batches_pruned':0}
    before=None
    provenance={}
    try:
        state=control.status(conn)
        stop_requested=PauseGate(conn,config,bypass_existing=bootstrap_only or validation_only)
        if admin_stop_requested is not None:
            if not bootstrap_only:raise ValueError('Administrative supervision applies only to bootstrap')
            own_pause=stop_requested
            stop_requested=lambda:admin_stop_requested() or own_pause()
        if stop_requested():
            log('paused')
            return 0
        if not state['source_state'] or not state['source_state']['ready']:
            log('source_not_ready')
            return 0
        control.discover(conn,analysis.METHODOLOGY_VERSION)
        projection=_projection(conn)
        if projection is None:
            log('initialization_required')
            return 1
        if validation_only and projection['status']!='ready':
            raise RuntimeError('Finish initialization before running the validation command')
        request=control.next_request(conn)
        # A caught-up tick performs only a few indexed readiness/checkpoint reads.
        # Publication retries retain their own durable destination state.
        if projection['status']=='ready' and request is None and not (bootstrap_only or validation_only):
            with conn,conn.cursor() as cur:
                cur.execute('SELECT blockheight,blockhash FROM public.blockheader WHERE blockheight=ANY(%s)',
                    ([projection['height'],projection['anchor_height']],))
                hashes=dict(cur.fetchall())
            if (hashes.get(projection['height'])==projection['block_hash']
                    and hashes.get(projection['anchor_height'])==projection['anchor_hash']
                    and not store.undo_prune_pending(conn,keep_blocks=undo_blocks)):
                deliver_pending(conn,config,stop_requested=stop_requested)
                log('no_work',height=projection['height'])
                return 0
        provenance={'implementation_sha256':implementation_fingerprint(REPO),
                    'config_sha256':config_fingerprint(config),
                    'scheduler_control':control_settings(state['control']),
                    'mode':'bootstrap' if bootstrap_only else 'validation' if validation_only else 'boundary',
                    'projection_before':{'height':projection['height'],'block_hash':projection['block_hash'],
                                         'status':projection['status']}}
        run_id=control.begin_run(conn,request['id'] if request else None)
        lower_priority(conn.get_backend_pid())
        before=database_usage(conn)
        started=time.monotonic()
        deadline=started+float(config.get('work_seconds',45))
        if admin_deadline is not None:
            if not bootstrap_only:raise ValueError('Administrative deadline applies only to bootstrap')
            deadline=min(deadline,admin_deadline)
        with ResourceMonitor(conn,limit_bytes=int(config.get('memory_limit_bytes',4*1024**3)),
                disk_paths=_resource_disk_paths(conn,config),
                minimum_free_bytes=config.get('disk_reserve_bytes',DEFAULT_DISK_RESERVE_BYTES)) as monitor:
            # A manually supervised initialization pins its original anchor.
            # Source drift stops that session; normal worker recovery is unchanged.
            if admin_stop_requested is None:
                projection=recover_reorg(conn,config,deadline=deadline,monitor=monitor,metrics=recovery_metrics,
                                         stop_requested=stop_requested)
            while projection['status']=='seeding' and time.monotonic()<deadline:
                if stop_requested():
                    break
                if admin_deadline is None:
                    done=store.bootstrap_step(conn,limit=_bootstrap_page_limit(conn,bootstrap_rows,bootstrap_by_source))
                else:
                    done=_maintenance_action(conn,lambda:store.bootstrap_step(conn,limit=_bootstrap_page_limit(conn,bootstrap_rows,bootstrap_by_source)),
                        deadline=deadline,monitor=monitor,metrics=recovery_metrics,stop_requested=stop_requested)
                    if done is None:break
                _check_resources(monitor)
                if done:
                    break
                if stop_requested():
                    break
                time.sleep(float(config.get('batch_pause_seconds',0.25)))
            projection=_projection(conn)
            baseline_ok=False
            recovery_complete=not recovery_metrics.get('rollback_pending',False)
            if projection['status']=='ready' and recovery_complete and not (bootstrap_only or validation_only):
                result=_maintenance_action(conn,lambda:store.prune_undo_step(conn,keep_blocks=undo_blocks),
                    deadline=deadline,monitor=monitor,metrics=undo_metrics,stop_requested=stop_requested)
                if result is not None:
                    undo_metrics.update(result)
                    undo_metrics['batches_pruned']+=int(result['deleted_batch'] is not None)
            if projection['status']=='ready' and recovery_complete and not bootstrap_only and (request or validation_only):
                baseline_ok=_baseline_verified(conn,projection)
                if validation_only or not baseline_ok:
                    if not validation_only and projection['height']!=projection['anchor_height']:
                        raise RuntimeError('Unverified baseline lies behind projection; restore its checkpoint before validation')
                    validate_projection(conn,config,deadline=deadline,monitor=monitor,recompare=recompare,
                                        stop_requested=stop_requested)
                    baseline_ok=_baseline_verified(conn,projection)
            if projection['status']=='ready' and baseline_ok and request and not (bootstrap_only or validation_only):
                target=request['target_height']
                if projection['height']>target:
                    raise RuntimeError(f'Unfinished request {target} lies behind projection {projection["height"]}; restore/replay before advancing')
                control.step(conn,request['id'],'projection','running',{'height':projection['height']})
                batch_blocks=int(config.get('batch_blocks',10))
                while projection['height']<target and time.monotonic()<deadline:
                    if stop_requested():
                        break
                    end=min(target,projection['height']+batch_blocks)
                    try:
                        accounting=store.apply_range(conn,end,max_rows=int(config.get('max_batch_rows',250000)))
                    except store.BatchTooLarge:
                        if batch_blocks<=1:
                            raise
                        batch_blocks=max(1,batch_blocks//2)
                        continue
                    projection=_projection(conn)
                    control.step(conn,request['id'],'projection','running',{'height':projection['height'],'accounting':accounting})
                    _check_resources(monitor)
                    result=_maintenance_action(conn,lambda:store.prune_undo_step(conn,keep_blocks=undo_blocks),
                        deadline=deadline,monitor=monitor,metrics=undo_metrics,stop_requested=stop_requested)
                    if result is not None:
                        undo_metrics.update(result)
                        undo_metrics['batches_pruned']+=int(result['deleted_batch'] is not None)
                    time.sleep(float(config.get('batch_pause_seconds',0.25)))
                if projection['height']==target:
                    control.step(conn,request['id'],'projection','complete',{'height':target})
                    export_request(conn,config,request,stop_requested=stop_requested)
        _check_resources(monitor)
        metrics=monitor.metrics()
        metrics.update(provenance, database_before=before,database_after=database_usage(conn),recovery=recovery_metrics,undo=undo_metrics,
                       projection_after={key:projection[key] for key in ('height','block_hash','status')})
        if implementation_fingerprint(REPO)!=provenance['implementation_sha256']:
            raise RuntimeError('Quantum implementation changed during measured run')
        control.finish_run(conn,run_id,metrics=metrics)
        log('run_complete',run_id=run_id,projection=_projection(conn),metrics=metrics)
        if not (bootstrap_only or validation_only) and projection['status']=='ready' and not recovery_metrics.get('rollback_pending'):
            deliver_pending(conn,config,stop_requested=stop_requested)
        return 0
    except PauseRequested as exc:
        conn.rollback()
        metrics=monitor.metrics() if monitor else {}
        metrics.update(provenance,database_before=before,recovery=recovery_metrics,undo=undo_metrics,deferred='paused')
        if run_id: control.finish_run(conn,run_id,metrics=metrics)
        log('paused',run_id=run_id,reason=str(exc))
        return 0
    except store.SourceNotReady as exc:
        conn.rollback()
        metrics=monitor.metrics() if monitor else {}
        metrics.update(provenance,database_before=before,recovery=recovery_metrics,undo=undo_metrics,deferred='source_not_ready')
        if run_id:
            # An ingestion yield can follow committed projection pages or an
            # aborted export. Preserve its actual durable endpoint and all
            # measured work, so acceptance cannot omit the retry's cost.
            projection=_projection(conn)
            metrics.update(database_after=database_usage(conn),
                           projection_after={key:projection[key] for key in ('height','block_hash','status')})
            if implementation_fingerprint(REPO)!=provenance['implementation_sha256']:
                message='Quantum implementation changed during measured source deferral'
                control.finish_run(conn,run_id,error=message,metrics=metrics)
                log('run_failed',run_id=run_id,error=message)
                return 1
            control.finish_run(conn,run_id,metrics=metrics)
        log('source_not_ready',run_id=run_id,reason=str(exc))
        return 0
    except Exception as exc:
        conn.rollback()
        message=f'{type(exc).__name__}: {exc}'
        if run_id:
            metrics=monitor.metrics() if monitor else {}
            metrics.update(provenance,database_before=before,recovery=recovery_metrics,undo=undo_metrics)
            control.finish_run(conn,run_id,error=message[:2000],metrics=metrics)
        log('run_failed',run_id=run_id,error=message[:2000])
        return 1
    finally:
        control.release_writer_lock(conn)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config',type=Path,required=True)
    sub=parser.add_subparsers(dest='command')
    for name in ('status','migrate','pause','resume','once','bootstrap'):
        sub.add_parser(name)
    physical=sub.add_parser('bootstrap-physical',help='Enable bounded physical scanning for one frozen legacy source')
    physical.add_argument('--source',choices=store.LEGACY,required=True)
    physical.add_argument('--blocks',type=int,default=1024)
    validate=sub.add_parser('validate')
    validate.add_argument('--recompare',action='store_true',help='Recompare after an explicitly reviewed projection repair')
    initialize=sub.add_parser('initialize')
    initialize.add_argument('--height',type=int,required=True)
    initialize.add_argument('--hash',required=True)
    initialize.add_argument('--start-after',type=int,required=True)
    seed_mode=initialize.add_mutually_exclusive_group()
    seed_mode.add_argument('--canonical',action='store_true',help='Compatibility alias: canonical source is the default')
    seed_mode.add_argument('--legacy-unverified',action='store_true',help='Diagnostic legacy import; cannot be exported or accepted')
    args=parser.parse_args()
    config=json.loads(args.config.read_text())
    conn=connect(config)
    try:
        if args.command=='migrate':
            import quantum_v2_enrichment as enrichment
            if not control.take_writer_lock(conn):
                raise RuntimeError('Worker or maintenance session is active')
            store.migrate(conn)
            control.migrate(conn)
            enrichment.migrate(conn)
            validation.migrate(conn)
            store.migrate_physical(conn)
            store.migrate_live_export(conn)
            log('migrated')
        elif args.command=='bootstrap-physical':
            if not control.take_writer_lock(conn):
                raise RuntimeError('Worker or maintenance session is active')
            store.enable_physical_bootstrap(conn,args.source,blocks_per_page=args.blocks)
            log('physical_bootstrap_enabled',source=args.source,blocks=args.blocks)
        elif args.command=='initialize':
            if not control.take_writer_lock(conn):
                raise RuntimeError('Worker is active')
            initialize_fn=store.initialize_seed if args.legacy_unverified else store.initialize_source_seed
            initialize_fn(conn,args.height,args.hash)
            control.configure(conn,start_height=args.start_after,paused=True)
            log('initialized',height=args.height,mode='legacy-unverified' if args.legacy_unverified else 'canonical',paused=True)
        elif args.command in ('pause','resume'):
            control.configure(conn,paused=args.command=='pause')
            pause_file=Path(config['state_dir'])/'PAUSED'
            if args.command=='pause':
                pause_file.parent.mkdir(parents=True,exist_ok=True)
                pause_file.write_text(datetime.now(timezone.utc).isoformat()+'\n')
            else:
                pause_file.unlink(missing_ok=True)
            log(args.command)
        elif args.command in ('once','bootstrap','validate'):
            return run_once(conn,config,bootstrap_only=args.command=='bootstrap',
                            validation_only=args.command=='validate',recompare=getattr(args,'recompare',False))
        else:
            print(json.dumps(control.status(conn),indent=2,default=str))
        return 0
    finally:
        conn.close()


if __name__=='__main__':
    raise SystemExit(main())
