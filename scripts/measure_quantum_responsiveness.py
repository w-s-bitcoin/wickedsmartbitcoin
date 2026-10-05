#!/usr/bin/env python3
"""Read-only latency/ingestion evidence while a bounded Quantum job runs.

SELECT1 latency is a responsiveness proxy, not a claim about every desktop app.
Ingestion durations are observed source-hook completion intervals, not an A/B test.
"""
import argparse
import json
import os
from pathlib import Path
import statistics
import time
import psycopg2


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dsn',default='dbname=bitcoin_data')
    parser.add_argument('--seconds',type=int,default=60)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    if not 1<=args.seconds<=600:
        raise SystemExit('Probe duration must be 1..600 seconds')
    conn=psycopg2.connect(args.dsn,application_name='quantum-responsiveness-probe')
    conn.autocommit=True
    observations=[]
    try:
        with conn.cursor() as cur:
            cur.execute("SET statement_timeout='2s'")
            started=time.monotonic()
            while time.monotonic()-started<args.seconds:
                tick=time.monotonic()
                cur.execute('SELECT 1')
                cur.fetchone()
                observations.append((time.monotonic()-tick)*1000)
                time.sleep(1)
            cur.execute('''SELECT b.ingestion_id,c.blockheight,extract(epoch FROM(c.occurred_at-b.occurred_at))
                FROM quantum_v2.source_event b JOIN quantum_v2.source_event c USING(ingestion_id)
                WHERE b.event='begin' AND c.event='complete' ORDER BY c.id DESC LIMIT 20''')
            ingestion=[{'id':r[0],'height':r[1],'seconds':float(r[2])} for r in cur.fetchall()]
            cur.execute('SELECT temp_bytes,temp_files FROM pg_stat_database WHERE datname=current_database()')
            temp_bytes,temp_files=cur.fetchone()
        ordered=sorted(observations)
        result={'samples':len(ordered),'latency_ms':{'median':statistics.median(ordered),
            'p95':ordered[min(len(ordered)-1,int(len(ordered)*.95))],'max':max(ordered)},
            'load_average':os.getloadavg(),'recent_ingestion':ingestion,
            'database_temp_bytes':temp_bytes,'database_temp_files':temp_files}
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(json.dumps(result,indent=2)+'\n')
        print(json.dumps(result,indent=2))
    finally:
        conn.close()


if __name__=='__main__':
    main()
