"""Durable Quantum job state. All mutations are short, explicit transactions."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import uuid

from psycopg2.extras import RealDictCursor, Json

WRITER_LOCK = (811947, 2)


def migrate(conn):
    if conn.get_transaction_status() != 0:
        raise RuntimeError('Control migration requires an idle connection; unrelated work was not committed')
    path = Path(__file__).with_name('migrations') / '002_control.sql'
    body = path.read_text()
    digest = hashlib.sha256(body.encode()).hexdigest()
    with conn, conn.cursor() as cur:
        cur.execute('SELECT pg_try_advisory_xact_lock(%s,%s)', WRITER_LOCK)
        if not cur.fetchone()[0]:
            raise RuntimeError('Another Quantum worker or maintenance session is running')
        cur.execute('SELECT sha256 FROM quantum_v2.schema_migration WHERE version=2')
        row = cur.fetchone()
        if row:
            if row[0] != digest:
                raise RuntimeError('Applied control migration changed')
            return
        cur.execute(body)
        cur.execute('INSERT INTO quantum_v2.schema_migration(version,sha256) VALUES(2,%s)', (digest,))


def take_writer_lock(conn) -> bool:
    with conn, conn.cursor() as cur:
        cur.execute('SELECT pg_try_advisory_lock(%s,%s)', WRITER_LOCK)
        return cur.fetchone()[0]


def release_writer_lock(conn):
    conn.rollback()
    with conn, conn.cursor() as cur:
        cur.execute('SELECT pg_advisory_unlock(%s,%s)', WRITER_LOCK)


def status(conn) -> dict:
    with conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        result = {}
        for table in ('control', 'source_state', 'projection'):
            cur.execute(f'SELECT * FROM quantum_v2.{table} WHERE singleton')
            row = cur.fetchone()
            result[table] = dict(row) if row else None
        cur.execute('''SELECT r.*,jsonb_agg(to_jsonb(d)) FILTER(WHERE d.destination IS NOT NULL) AS deliveries
            FROM quantum_v2.request r LEFT JOIN quantum_v2.delivery d ON d.request_id=r.id
            GROUP BY r.id ORDER BY r.target_height DESC,r.id DESC LIMIT 15''')
        result['requests'] = [dict(r) for r in cur.fetchall()]
        cur.execute('SELECT * FROM quantum_v2.bootstrap_cursor ORDER BY source_table')
        result['bootstrap'] = [dict(r) for r in cur.fetchall()]
        cur.execute("SELECT to_regclass('quantum_v2.bootstrap_heap_cursor') AS relation")
        if cur.fetchone()['relation']:
            cur.execute('SELECT * FROM quantum_v2.bootstrap_heap_cursor ORDER BY source_table')
            result['physical_bootstrap'] = [dict(r) for r in cur.fetchall()]
        return result


def configure(conn, *, paused: bool | None = None, start_height: int | None = None,
              confirmations: int | None = None):
    with conn, conn.cursor() as cur:
        cur.execute('''UPDATE quantum_v2.control SET paused=COALESCE(%s,paused),
            start_height=COALESCE(%s,start_height),confirmations=COALESCE(%s,confirmations),
            updated_at=clock_timestamp() WHERE singleton''', (paused, start_height, confirmations))


def discover(conn, methodology_version: str) -> list[int]:
    """Create each missing eligible boundary; preserve gaps before start_height.

    Called under the session writer lock. Canonical changes invalidate old jobs,
    including completed jobs. Immutable artifacts remain available for audit.
    """
    with conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute('''SELECT c.*,s.ready,s.committed_height,s.epoch,
            s.committed_hash=b.blockhash AS source_hash_matches FROM quantum_v2.control c
            CROSS JOIN quantum_v2.source_state s LEFT JOIN public.blockheader b
            ON b.blockheight=s.committed_height WHERE c.singleton AND s.singleton''')
        cfg = cur.fetchone()
        if not cfg or cfg['paused'] or not cfg['ready'] or not cfg['source_hash_matches'] or cfg['start_height'] is None:
            return []
        cur.execute('''UPDATE quantum_v2.request r SET status='orphaned',updated_at=clock_timestamp()
            WHERE status<>'orphaned' AND NOT EXISTS (SELECT 1 FROM public.blockheader b
            WHERE b.blockheight=r.target_height AND b.blockhash=r.target_hash)''')
        size = cfg['boundary_size']
        last = ((cfg['committed_height'] - cfg['confirmations']) // size) * size
        first = (cfg['start_height'] // size + 1) * size
        cur.execute('''INSERT INTO quantum_v2.request(target_height,target_hash,methodology_version)
            SELECT b.blockheight,b.blockhash,%s FROM public.blockheader b
            WHERE b.blockheight BETWEEN %s AND %s AND mod(b.blockheight,%s)=0
            ON CONFLICT(target_height,target_hash,methodology_version) DO NOTHING RETURNING id''',
            (methodology_version, first, last, size))
        return [r['id'] for r in cur.fetchall()]


def next_request(conn):
    with conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        # Deliveries do not prevent subsequent expensive analysis. They are
        # serviced separately, and their accepted-height guard prevents rollback.
        cur.execute('''SELECT * FROM quantum_v2.request WHERE status IN ('pending','running','blocked')
            ORDER BY target_height,id LIMIT 1''')
        row = cur.fetchone()
        return dict(row) if row else None


def begin_run(conn, request_id: int | None) -> str:
    run_id = str(uuid.uuid4())
    with conn, conn.cursor() as cur:
        # The acquired session lock proves the prior owner's session is gone.
        cur.execute("UPDATE quantum_v2.run SET status='interrupted',finished_at=clock_timestamp() WHERE status='running'")
        cur.execute('INSERT INTO quantum_v2.run(id,request_id,pid,status) VALUES(%s,%s,%s,\'running\')',
                    (run_id, request_id, os.getpid()))
        if request_id is not None:
            cur.execute("UPDATE quantum_v2.request SET status='running',attempt=attempt+1,error=NULL,updated_at=clock_timestamp() WHERE id=%s", (request_id,))
    return run_id


def finish_run(conn, run_id: str, *, error: str | None = None, metrics: dict | None = None):
    conn.rollback()
    with conn, conn.cursor() as cur:
        cur.execute('''UPDATE quantum_v2.run SET status=%s,finished_at=clock_timestamp(),metrics=%s,error=%s
            WHERE id=%s''', ('failed' if error else 'succeeded', Json(metrics or {}), error, run_id))
        if error:
            cur.execute('''UPDATE quantum_v2.request SET error=%s,updated_at=clock_timestamp()
                WHERE id=(SELECT request_id FROM quantum_v2.run WHERE id=%s)''', (error, run_id))


def step(conn, request_id: int, name: str, state: str, cursor: dict | None = None):
    with conn, conn.cursor() as cur:
        cur.execute('''INSERT INTO quantum_v2.step(request_id,name,status,cursor) VALUES(%s,%s,%s,%s)
            ON CONFLICT(request_id,name) DO UPDATE SET status=excluded.status,cursor=excluded.cursor,
            attempts=quantum_v2.step.attempts+CASE WHEN excluded.status='running' THEN 1 ELSE 0 END,
            updated_at=clock_timestamp()''', (request_id, name, state, Json(cursor or {})))


def canonical_ready(conn, height: int, expected_hash: str) -> bool:
    with conn, conn.cursor() as cur:
        cur.execute('''SELECT s.ready AND s.committed_height >= %s+c.confirmations AND b.blockhash=%s
            AND tip.blockhash=s.committed_hash
            FROM quantum_v2.source_state s CROSS JOIN quantum_v2.control c
            JOIN public.blockheader b ON b.blockheight=%s
            LEFT JOIN public.blockheader tip ON tip.blockheight=s.committed_height
            WHERE s.singleton AND c.singleton''',
            (height, expected_hash, height))
        row = cur.fetchone()
        return bool(row and row[0])


def analyzed(conn, request_id: int, generation_id: str, output_dir: Path):
    with conn, conn.cursor() as cur:
        cur.execute('''UPDATE quantum_v2.request SET status='analyzed',generation_id=%s,output_dir=%s,
            error=NULL,updated_at=clock_timestamp() WHERE id=%s''', (generation_id, str(output_dir), request_id))
        cur.execute('''INSERT INTO quantum_v2.delivery(request_id,destination)
            VALUES(%s,'website'),(%s,'standalone') ON CONFLICT DO NOTHING''', (request_id, request_id))


def pending_deliveries(conn):
    with conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute('''SELECT r.*,d.destination,d.attempts FROM quantum_v2.delivery d
            JOIN quantum_v2.request r ON r.id=d.request_id
            WHERE d.status IN ('pending','failed','delivering') AND r.status<>'orphaned'
            ORDER BY r.target_height DESC,r.id DESC,d.destination''')
        return [dict(row) for row in cur.fetchall()]


def delivery_started(conn, request_id: int, destination: str) -> bool:
    with conn, conn.cursor() as cur:
        cur.execute('''SELECT EXISTS(SELECT 1 FROM quantum_v2.accepted_generation a
            JOIN quantum_v2.request r ON r.id=%s WHERE a.destination=%s
            AND (a.target_height>r.target_height OR (a.target_height=r.target_height AND a.request_id>r.id)))''',
            (request_id,destination))
        superseded = cur.fetchone()[0]
        cur.execute('''UPDATE quantum_v2.delivery SET status=%s,attempts=attempts+1,error=NULL,
            updated_at=clock_timestamp() WHERE request_id=%s AND destination=%s''',
            ('superseded' if superseded else 'delivering',request_id,destination))
        if superseded:
            _complete_delivered(cur,request_id)
        return not superseded


def _complete_delivered(cur,request_id):
    cur.execute('''UPDATE quantum_v2.request r SET status='complete',updated_at=clock_timestamp()
        WHERE id=%s AND status='analyzed' AND NOT EXISTS(SELECT 1 FROM quantum_v2.delivery d
        WHERE d.request_id=r.id AND d.status NOT IN ('complete','superseded'))''',(request_id,))


def delivery_finished(conn, request_id: int, destination: str, *, commit: str | None = None,
                      error: str | None = None, superseded: bool = False):
    with conn, conn.cursor() as cur:
        cur.execute('''UPDATE quantum_v2.delivery SET status=%s,accepted_commit=%s,error=%s,
            updated_at=clock_timestamp() WHERE request_id=%s AND destination=%s''',
            ('failed' if error else 'superseded' if superseded else 'complete',commit,error,request_id,destination))
        if not error and not superseded:
            if not commit:
                raise ValueError('Delivery acknowledgement requires an accepted Git commit')
            cur.execute('''INSERT INTO quantum_v2.accepted_generation
                (destination,request_id,target_height,target_hash,generation_id,accepted_commit)
                SELECT %s,id,target_height,target_hash,generation_id,%s FROM quantum_v2.request WHERE id=%s
                ON CONFLICT(destination) DO UPDATE SET request_id=excluded.request_id,target_height=excluded.target_height,
                target_hash=excluded.target_hash,generation_id=excluded.generation_id,
                accepted_commit=excluded.accepted_commit,accepted_at=clock_timestamp()
                WHERE (excluded.target_height,excluded.request_id) >=
                      (quantum_v2.accepted_generation.target_height,quantum_v2.accepted_generation.request_id)''',
                (destination,commit,request_id))
        _complete_delivered(cur,request_id)
