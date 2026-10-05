#!/usr/bin/env python3
"""Certify the existing completed ingest once while holding its real caller lock.

Routine certification is installed inside CoreToPSQL. This initializer performs
only source/RPC checks and the small Quantum readiness writes; it never runs a
producer, modifies source rows, or fabricates a block boundary.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import json
import os
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'webapps/quantum_exposure/pipeline'))
import quantum_source_boundary as source


@contextmanager
def certification_lock(source_dir: Path, lock: Path = Path('/tmp/onchain_update_bitcoin_data.lock')):
    """Respect both gates used by the external ingestion caller."""
    if not (source_dir / 'update_bitcoin_data.sh').is_file():
        raise SystemExit('Source caller directory is unverified; pass --source-dir containing update_bitcoin_data.sh')
    maintenance = source_dir / '.storage-maintenance'

    def require_available():
        if maintenance.exists() or maintenance.is_symlink():
            raise SystemExit('Source storage maintenance is active; defer certification')

    require_available()
    try:
        lock.mkdir()
    except FileExistsError:
        raise SystemExit('Ingestion is active; retry certification after its completion')
    try:
        (lock / 'pid').write_text(str(os.getpid()))
        # Maintenance can start between the first check and lock acquisition.
        require_available()
        yield
    finally:
        (lock / 'pid').unlink(missing_ok=True)
        lock.rmdir()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file',type=Path,required=True)
    parser.add_argument('--source-dir',type=Path,
                        help='External caller directory; defaults to the environment file parent')
    parser.add_argument('--dsn')
    args=parser.parse_args()
    with certification_lock(args.source_dir or args.env_file.resolve().parent):
        certify(args)


def certify(args):
    import psycopg2
    from dotenv import load_dotenv
    from bitcoinrpc.authproxy import AuthServiceProxy

    conn=None
    try:
        load_dotenv(args.env_file,override=False)
        conn=psycopg2.connect(args.dsn,application_name='quantum-source-certification') if args.dsn else psycopg2.connect(
            host=os.getenv('POSTGRES_HOST'),dbname=os.getenv('POSTGRES_DB'),user=os.getenv('POSTGRES_USER'),
            password=os.getenv('POSTGRES_PASSWORD'),application_name='quantum-source-certification')
        rpc=AuthServiceProxy('http://{}:{}@{}:{}'.format(os.environ['RPC_USER'],os.environ['RPC_PASSWORD'],
            os.getenv('RPC_HOST','127.0.0.1'),os.getenv('RPC_PORT','8332')),timeout=15)
        identity=source.begin(conn)
        with conn,conn.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout='5s'")
            cur.execute('SELECT blockheight,blockhash FROM blockheader ORDER BY blockheight DESC LIMIT 1')
            height,block_hash=cur.fetchone()
            block=rpc.getblock(block_hash,1)
            if block['height']!=height or rpc.getblockhash(height)!=block_hash:
                raise RuntimeError('Source and node tip identity differ')
            # An unspent coinbase must exist at the completed tip. This also
            # verifies source transaction identity, without reading entire tables.
            cur.execute('SELECT DISTINCT transactionid FROM outputs WHERE blockheight=%s AND fromcoinbase',(height,))
            if [row[0] for row in cur.fetchall()] != [block['tx'][0]]:
                raise RuntimeError('Source tip coinbase is missing or differs from canonical block')
        source.finish(conn,rpc,identity)
        print(json.dumps({'ready':True,'committed_height':height,'committed_hash':block_hash,'ingestion_id':identity}))
    finally:
        if conn:
            conn.close()


if __name__=='__main__':
    try:
        main()
    except Exception as exc:
        # Some RPC transport exceptions include a credential-bearing URL.
        print(f'Certification failed ({type(exc).__name__}); readiness remains invalidated. Inspect source/node state.',file=sys.stderr)
        raise SystemExit(1)
