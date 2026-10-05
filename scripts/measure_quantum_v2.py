#!/usr/bin/env python3
"""Bounded source/index preflight. Creates only temporary sampled tables.

Run with the project's psycopg2 Python. Output is evidence, not a benchmark of
an entire boundary. Index/WAL estimates must be checked during actual migration.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
import time

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'webapps/quantum_exposure/pipeline'))
import psycopg2
from quantum_resources import ResourceMonitor, database_usage, lower_priority


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dsn', default='dbname=bitcoin_data')
    parser.add_argument('--output',type=Path,required=True)
    args = parser.parse_args()
    conn = psycopg2.connect(args.dsn,application_name='quantum-v2-preflight')
    lower_priority(conn.get_backend_pid())
    results = {'scope':'temporary 0.02 percent SYSTEM sample of newest spent archive',
               'estimate_limit':'sample size extrapolation; skew and btree deduplication affect full index size',
               'before_database':database_usage(conn)}
    start = time.monotonic()
    try:
        with ResourceMonitor(conn) as monitor:
            with conn,conn.cursor() as cur:
                cur.execute("SET LOCAL statement_timeout='30s'")
                cur.execute("SET LOCAL work_mem='32MB'")
                cur.execute("SET LOCAL maintenance_work_mem='64MB'")
                cur.execute('SET LOCAL max_parallel_workers_per_gather=0')
                cur.execute('SET LOCAL max_parallel_maintenance_workers=0')
                cur.execute("SET LOCAL temp_file_limit='2GB'")
                cur.execute('''CREATE TEMP TABLE quantum_index_sample AS SELECT address,blockheight,spendingblock,scripttype
                    FROM public.stxos_900000_999999_archive TABLESAMPLE SYSTEM(0.02) REPEATABLE(20261005)''')
                cur.execute('SELECT count(*),count(DISTINCT address) FROM quantum_index_sample')
                results['sample_rows'],results['sample_distinct_addresses'] = cur.fetchone()
                cur.execute('''CREATE INDEX quantum_sample_address ON quantum_index_sample(address)
                    INCLUDE(blockheight,spendingblock,scripttype)
                    WHERE scripttype NOT IN ('pubkey','pubkeyhash','witness_v0_keyhash')''')
                cur.execute('CREATE INDEX quantum_sample_creation ON quantum_index_sample(blockheight)')
                cur.execute("SELECT pg_relation_size('quantum_sample_address'),pg_relation_size('quantum_sample_creation')")
                address,creation = cur.fetchone()
                results['sample_indexes_bytes'] = {'nonkey_address':address,'creation':creation}
                results['naive_full_indexes_bytes'] = {'nonkey_address':address*5000,'creation':creation*5000}
                cur.execute('''SELECT scripttype,count(*),count(DISTINCT address),avg(octet_length(address))
                    FROM quantum_index_sample GROUP BY scripttype ORDER BY count(*) DESC''')
                results['families'] = [dict(zip(('scripttype','rows','distinct_addresses','mean_address_bytes'),row)) for row in cur.fetchall()]
                cur.execute("SELECT pg_relation_size('public.stxos_900000_999999_archive'),pg_indexes_size('public.stxos_900000_999999_archive')")
                results['source_heap_bytes'],results['source_indexes_bytes'] = cur.fetchone()
            results['resources'] = monitor.metrics()
        results['after_database'] = database_usage(conn)
    finally:
        conn.close()
        results['elapsed_seconds'] = time.monotonic()-start
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(json.dumps(results,indent=2,default=str)+'\n')
    print(json.dumps(results,indent=2,default=str))


if __name__=='__main__':
    main()
