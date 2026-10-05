"""Small ingestion hook: committed readiness only, no Quantum analysis.

Installed beside CoreToPSQL by install_quantum_source_hook.py. Imports neither
configuration nor database drivers. The caller owns its existing connection.
"""
from __future__ import annotations

import uuid


def begin(connection) -> str:
    """Invalidate readiness *before* any chain mutation, including reorgs."""
    ingestion_id = str(uuid.uuid4())
    with connection.cursor() as cursor:
        cursor.execute("""UPDATE quantum_v2.source_state
            SET ready=false,epoch=epoch+1,ingestion_id=%s,updated_at=clock_timestamp()
            WHERE singleton RETURNING epoch""", (ingestion_id,))
        if cursor.fetchone() is None:
            raise RuntimeError("Quantum source readiness migration is missing")
        cursor.execute("""INSERT INTO quantum_v2.source_event(ingestion_id,event)
            VALUES(%s,'begin')""", (ingestion_id,))
    connection.commit()
    return ingestion_id


def reorg(connection, height: int) -> None:
    """Call after deleting orphan headers, before committing the rollback."""
    with connection.cursor() as cursor:
        cursor.execute("""UPDATE quantum_v2.source_state SET ready=false,
            committed_height=b.blockheight,committed_hash=b.blockhash,
            updated_at=clock_timestamp()
            FROM (SELECT blockheight,blockhash FROM public.blockheader
                  WHERE blockheight=%s) b WHERE singleton""", (height - 1,))
        cursor.execute("""INSERT INTO quantum_v2.source_event
            (ingestion_id,event,blockheight,blockhash)
            SELECT ingestion_id,'reorg',%s,committed_hash
            FROM quantum_v2.source_state WHERE singleton""", (height - 1,))


def finish(connection, rpc_connection, ingestion_id: str) -> None:
    """Certify the complete ingest, including archival, against the node.

Committed spent rows still in outputs are valid input. Pending input rows are
not: they indicate that spend application did not finish. A failure deliberately
leaves ready=false; the existing ingestion recovery must finish before Quantum.
"""
    with connection.cursor() as cursor:
        cursor.execute("SELECT blockheight,blockhash FROM public.blockheader ORDER BY blockheight DESC LIMIT 1")
        row = cursor.fetchone()
        if row is None:
            raise RuntimeError("Cannot certify an empty source")
        height, block_hash = row
        if rpc_connection.getblockhash(int(height)) != block_hash:
            raise RuntimeError("Source tip differs from canonical RPC; Quantum remains paused")
        cursor.execute("SELECT EXISTS(SELECT 1 FROM public.inputs LIMIT 1)")
        if cursor.fetchone()[0]:
            raise RuntimeError("Unapplied source inputs remain; Quantum remains paused")
        cursor.execute("""UPDATE quantum_v2.source_state SET ready=true,
            committed_height=%s,committed_hash=%s,updated_at=clock_timestamp()
            WHERE singleton AND ingestion_id=%s RETURNING epoch""", (height, block_hash, ingestion_id))
        if cursor.fetchone() is None:
            raise RuntimeError("Concurrent source writer invalidated ingestion identity")
        cursor.execute("""INSERT INTO quantum_v2.source_event
            (ingestion_id,event,blockheight,blockhash) VALUES(%s,'complete',%s,%s)""",
            (ingestion_id, height, block_hash))
    connection.commit()
