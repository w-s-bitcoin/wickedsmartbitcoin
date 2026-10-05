"""Keep imported legacy seed tables immutable once Quantum v2 is initialized."""
from __future__ import annotations


def guard_quantum_analysis(conn):
    """Serialize an explicitly requested legacy analysis with all v2 work.

    Unlike a legacy seed mutation, an isolated analysis may run after v2 has
    initialized. Its session lock spans cache commits until connection close.
    """
    if conn.get_transaction_status() != 0:
        raise RuntimeError('Quantum analysis guard requires an idle connection before queries')
    with conn:
        with conn.cursor() as cur:
            cur.execute('SELECT pg_try_advisory_lock(811947,2)')
            if not cur.fetchone()[0]:
                raise RuntimeError('Another Quantum worker or analysis holds the writer lock; no analysis was started')


def guard_legacy_mutation(conn):
    """Require legacy mode and hold its exclusion lock for this connection.

    Call on a fresh idle connection before DDL or writes. The session lock spans
    legacy batch commits. Acquire the global coordinator lock before the store
    lock, in the same order as v2, so migration and initialization cannot race
    the legacy-mode check. Closing the connection releases both locks. There is
    deliberately no bypass flag.
    """
    if conn.get_transaction_status() != 0:
        raise RuntimeError('Legacy guard requires an idle connection before mutation')
    acquired = []
    try:
        with conn.cursor() as cur:
            for key in (2, 1):
                cur.execute('SELECT pg_try_advisory_lock(811947,%s)', (key,))
                if not cur.fetchone()[0]:
                    raise RuntimeError('Quantum v2 or another legacy builder holds the writer lock; no legacy changes were made')
                acquired.append(key)
            cur.execute("SELECT to_regclass('quantum_v2.projection')")
            if cur.fetchone()[0] is not None:
                cur.execute('SELECT EXISTS(SELECT 1 FROM quantum_v2.projection)')
                if cur.fetchone()[0]:
                    raise RuntimeError('Quantum v2 is initialized: legacy seed tables are frozen. Use run_quantum_worker.py; no legacy changes were made')
        conn.commit()
    except Exception:
        conn.rollback()
        if acquired:
            with conn.cursor() as cur:
                for key in reversed(acquired):
                    cur.execute('SELECT pg_advisory_unlock(811947,%s)', (key,))
            conn.commit()
        raise
