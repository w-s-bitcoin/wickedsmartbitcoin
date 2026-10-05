#!/usr/bin/env python3
"""Profile canonical CSV export with deterministic synthetic groups, never SQL.

This is a CPU/serialization benchmark, not blockchain accounting evidence.
Example: python scripts/measure_quantum_export.py --groups 100000 \
    --output-dir /private/tmp/quantum-export-profile
"""
from __future__ import annotations

import argparse
import cProfile
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import pstats
import resource
import sys
import time

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'webapps/quantum_exposure/pipeline'))
import quantum_v2_analysis as analysis

SNAPSHOT_TIME=1791230400
BALANCES=(25_000,10_000_000,100_000_000,350_000_000,1_000_000_000,10_000_000_000,100_000_000_000)


def synthetic_rows(groups,balance_profile='broad'):
    """Ordered 1–3-family groups, activity tiers, zero-value UTXOs and history.

    Every eighth group is retired. Every fourth live group has two families.
    Every tenth has an additional zero-balance historical family. Balance tiers
    and exposure are deliberately broad, not estimates of mainnet distribution.
    """
    for number in range(groups):
        group_id=f'{number:040x}'
        retired=number%8==0
        families=2 if number%4==0 else 1
        for offset in range(families+(number%10==0)):
            historical=offset==families
            family=analysis.SCRIPT_TYPES[(number+offset)%len(analysis.SCRIPT_TYPES)]
            count=0 if retired or historical else 1+number%31
            # Preserve actual zero-value UTXOs as a separate count test case.
            balance=(BALANCES[number%len(BALANCES)] if balance_profile=='broad' else
                     100_000_000*(1+number%1000) if number%101==0 else 500+number%10000)
            amount=0 if not count or number%97==0 else balance//families
            exposed_count=count if family in ('P2PK','P2TR','Other') else count if number%3 else 0
            exposed_amount=amount if exposed_count else 0
            age=number%3
            last_time=None if age==0 else SNAPSHOT_TIME-(400 if age==1 else 30)*86400
            disclosed=family in ('P2PK','P2TR','Other') or number%3!=0
            yield {'group_id':group_id,'script_type':family,
                   'current_supply_sats':amount,'current_utxo_count':count,
                   'exposed_supply_sats':exposed_amount,'exposed_utxo_count':exposed_count,
                   'first_received_blockheight':100_000+number%700_000,
                   'first_exposed_blockheight':200_000+number%600_000 if disclosed else None,
                   'first_exposed_time':SNAPSHOT_TIME-500*86400 if disclosed else None,
                   'last_spend_blockheight':900_000+number%50_000 if last_time is not None else None,
                   'last_spend_time':last_time,'display_group_id':f'synthetic-{number:010d}',
                   'details':'synthetic annotation' if number%37==0 else '',
                   'details_quality':'synthetic-fixture','identity':'synthetic entity' if number%1000==0 else ''}


def run_case(groups,output,*,profile=False,balance_profile='broad'):
    profiler=cProfile.Profile() if profile else None
    counts={'input_family_rows':0}
    def rows():
        for row in synthetic_rows(groups,balance_profile):
            counts['input_family_rows']+=1
            yield row
    started_wall=time.perf_counter(); started_cpu=time.process_time()
    if profiler: profiler.enable()
    metadata=analysis.export_snapshot(rows(),snapshot_height=970000,snapshot_time=SNAPSHOT_TIME,
        output_dir=output,block_hash='01'*32,source_generation='synthetic-only',label_version='synthetic-only')
    if profiler: profiler.disable()
    wall=time.perf_counter()-started_wall; cpu=time.process_time()-started_cpu
    files=[path for path in output.rglob('*') if path.is_file()]
    result={'profiled':profile,'input_groups':groups,**counts,
            'reporting_groups':metadata['reporting_groups'],'detail_rows':metadata['detail_rows'],
            'wall_seconds':wall,'cpu_seconds':cpu,'input_groups_per_second':groups/wall,
            'reporting_groups_per_second':metadata['reporting_groups']/wall,
            'output_bytes':sum(path.stat().st_size for path in files),
            'peak_process_rss_bytes':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*(1 if platform.system()=='Darwin' else 1024)}
    if profiler:
        profiler.dump_stats(str(output/'export.prof'))
        text=io.StringIO()
        stats=pstats.Stats(profiler,stream=text).strip_dirs()
        stats.sort_stats('cumulative').print_stats(30)
        stats.sort_stats('tottime').print_stats(30)
        (output/'profile_top.txt').write_text(text.getvalue())
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--groups',type=int,default=100000)
    parser.add_argument('--profile-groups',type=int,default=25000)
    parser.add_argument('--balance-profile',choices=('broad','mostly-small'),default='broad',
                        help='Mostly-small gives approximately1%% of groups high balances before exposure/retired filters')
    parser.add_argument('--output-dir',type=Path,required=True)
    args=parser.parse_args()
    if not 1<=args.groups<=1000000 or not 1<=args.profile_groups<=100000:
        parser.error('groups must be1..1000000 and profile-groups1..100000')
    output=args.output_dir.resolve()
    if output==ROOT or ROOT in output.parents:
        parser.error('Synthetic output must be outside the repository')
    if output.exists() and any(output.iterdir()): parser.error('Output directory must be empty')
    output.mkdir(parents=True,exist_ok=True)
    try: os.setpriority(os.PRIO_PROCESS,os.getpid(),10)
    except (AttributeError,OSError): pass
    report={'synthetic_only':True,'chain_accounting_proof':False,'database_queries':0,
            'distribution':args.balance_profile+';1–3 families;12.5%retired;not mainnet frequency estimates',
            'python':sys.version,'platform':platform.platform(),
            'analysis_sha256':hashlib.sha256(Path(analysis.__file__).read_bytes()).hexdigest()}
    report['baseline']=run_case(args.groups,output/'baseline',balance_profile=args.balance_profile)
    report['profile']=run_case(args.profile_groups,output/'profile',profile=True,balance_profile=args.balance_profile)
    speed=report['baseline']['input_groups_per_second']
    report['same_mix_extrapolation_seconds']={str(groups):groups/speed for groups in (1_000_000,10_000_000,25_000_000,50_000_000)}
    report['same_mix_input_groups_in900seconds']=int(900*speed)
    (output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'output_dir':str(output),**report},indent=2))


if __name__=='__main__': main()
