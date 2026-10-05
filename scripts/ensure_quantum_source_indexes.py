#!/usr/bin/env python3
"""Build only measured Quantum access paths, concurrently and one at a time.

No index is dropped or replaced. A failed concurrent build is reported as an
invalid index for explicit recovery. Default prints the proposed DDL only.
This one-time migration has a 32 GiB temporary-space ceiling; normal workers
retain 2 GiB. Both retain 32 MiB work_mem and no parallel query workers.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys
import time

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'webapps/quantum_exposure/pipeline'))
import psycopg2
from psycopg2 import sql
from quantum_resources import ResourceMonitor,lower_priority


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dsn',default='dbname=bitcoin_data')
    parser.add_argument('--table',required=True)
    parser.add_argument('--kind',choices=('creation','nonkey_address'),required=True)
    parser.add_argument('--apply',action='store_true')
    parser.add_argument('--recover-invalid',action='store_true',help='Replace only this tool\'s own incomplete concurrent index')
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    if not re.fullmatch(r'stxos_\d+_\d+_archive',args.table):
        raise SystemExit('Only an explicit spent-output archive can be indexed')
    index=f'qe2_{args.table}_{args.kind}'
    definition={'creation':'(blockheight)',
        'nonkey_address':"(address) INCLUDE(blockheight,spendingblock,scripttype) WHERE address IS NOT NULL AND (scripttype NOT IN ('pubkey','pubkeyhash','witness_v0_keyhash') OR scripttype IS NULL)"}[args.kind]
    statement=sql.SQL('CREATE INDEX CONCURRENTLY {} ON public.{} '+definition).format(sql.Identifier(index),sql.Identifier(args.table))
    conn=psycopg2.connect(args.dsn,application_name='quantum-v2-index-migration')
    conn.autocommit=True
    evidence={'table':args.table,'index':index,'kind':args.kind,'applied':False}
    try:
        with conn.cursor() as cur:
            evidence['ddl']=statement.as_string(conn)
            print(evidence['ddl'],flush=True)
            if not args.apply:
                return
            cur.execute('SELECT pg_try_advisory_lock(811947,2)')
            if not cur.fetchone()[0]:
                raise RuntimeError('Quantum worker owns the writer lock; defer index migration')
            cur.execute("SET work_mem='32MB'")
            cur.execute("SET maintenance_work_mem='64MB'")
            cur.execute('SET max_parallel_workers_per_gather=0')
            cur.execute('SET max_parallel_maintenance_workers=0')
            cur.execute("SET temp_file_limit='32GB'")
            cur.execute("SET lock_timeout='2s'")
            cur.execute("SET statement_timeout='45min'")
            cur.execute('''SELECT i.indisvalid,pg_get_indexdef(i.indexrelid) FROM pg_index i
                JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace
                WHERE n.nspname='public' AND c.relname=%s''',(index,))
            existing=cur.fetchone()
            if existing:
                evidence.update(existing_valid=existing[0],existing_definition=existing[1])
                if not existing[0]:
                    if not args.recover_invalid:
                        raise RuntimeError('An invalid prior index exists; inspect and explicitly recover it')
                    # The exact deterministic name is owned by this migration;
                    # invalid indexes cannot serve consumer queries. Never drop
                    # an existing valid index or another producer's access path.
                    cur.execute(sql.SQL('DROP INDEX CONCURRENTLY public.{}').format(sql.Identifier(index)))
                    evidence['replaced_invalid']=True
                else:
                    print('Existing valid index retained',flush=True)
                    return
            lower_priority(conn.get_backend_pid())
            cur.execute('SELECT pg_current_wal_lsn()::text')
            evidence['cluster_wal_before']=cur.fetchone()[0]
            start=time.monotonic()
            try:
                with ResourceMonitor(conn) as monitor:
                    cur.execute(statement)
            finally:
                evidence['resources']=monitor.metrics()
                evidence['elapsed_seconds']=time.monotonic()-start
            cur.execute('SELECT pg_relation_size(%s::regclass),pg_current_wal_lsn()::text',(f'public.{index}',))
            evidence['index_bytes'],evidence['cluster_wal_after']=cur.fetchone()
            evidence.update(applied=True,elapsed_seconds=time.monotonic()-start)
    finally:
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(json.dumps(evidence,indent=2,default=str)+'\n')
        conn.close()
    print(json.dumps(evidence,indent=2),flush=True)


if __name__=='__main__':
    main()
