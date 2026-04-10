#!/usr/bin/env python3
"""Build historical dashboard snapshots at one or many block heights.

Historical semantics:
- An output is considered unspent at snapshot height H iff spendingblock IS NULL OR spendingblock > H.
- Exposure is considered known at H iff exposed_height <= H.

This script intentionally does not use `isspent` flags for historical eligibility.
"""

from __future__ import annotations

import argparse
import csv
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Iterable

import psycopg2
from dotenv import load_dotenv
from pipeline_paths import PIPELINE_DIR, QUANTUM_DIR, resolve_env_file

import run_dashboard_analysis as rda

SCHEMA = "public"
GENESIS_PUBKEY_KEYHASH20_HEX = "62e907b15cbf27d5425399ebf6f0fb50ebb88f18"
P2PK_PUBKEY_CACHE_TABLE = "dashboard_p2pk_pubkey_cache"
DEFAULT_ENV_FILE = resolve_env_file()
DEFAULT_OUT_DIR = QUANTUM_DIR / "webapp_data"
KEEP_INTERVAL = 50_000


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build historical dashboard snapshot(s)")
    parser.add_argument("--schema", default=SCHEMA, help="PostgreSQL schema (default: public)")
    parser.add_argument(
        "--env-file",
        default=str(DEFAULT_ENV_FILE),
        help="Path to .env file with DB credentials",
    )
    parser.add_argument(
        "--out-dir",
        default=str(DEFAULT_OUT_DIR),
        help="Output directory for CSV files (default: webapps/quantum_exposure/webapp_data)",
    )
    parser.add_argument("--height", type=int, default=None, help="Single snapshot height")
    parser.add_argument("--start", type=int, default=None, help="Start height (inclusive)")
    parser.add_argument("--end", type=int, default=None, help="End height (inclusive)")
    parser.add_argument(
        "--step",
        type=int,
        default=10_000,
        help="Step size for range mode (default: 10000)",
    )
    parser.add_argument(
        "--skip-multiples-of",
        type=int,
        default=0,
        help=(
            "Skip heights that are exact multiples of this value "
            "(example: 50000 to skip 50k checkpoints)"
        ),
    )
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        default=False,
        help="Skip heights that already exist in out-dir or out-dir/archived",
    )
    parser.add_argument(
        "--annotate-details",
        action="store_true",
        default=False,
        help="Run detail annotation pass before export (slower)",
    )
    parser.add_argument(
        "--reuse-cached-labels",
        action=argparse.BooleanOptionalAction,
        default=True,
        help=(
            "Apply historical cross-snapshot label cache before export. "
            "Enabled by default; use --no-reuse-cached-labels to disable."
        ),
    )
    parser.add_argument(
        "--skip-main-pipeline-postprocess",
        action="store_true",
        default=False,
        help=(
            "Skip clean_new_webapp_data.py, fill_identity_details.py, and "
            "generate_eco_files.py after historical builds"
        ),
    )
    return parser.parse_args()


def connect() -> psycopg2.extensions.connection:
    conn = psycopg2.connect(
        host=os.getenv("POSTGRES_HOST"),
        database=os.getenv("POSTGRES_DB"),
        user=os.getenv("POSTGRES_USER"),
        password=os.getenv("POSTGRES_PASSWORD"),
    )
    conn.autocommit = False
    conn.set_session(isolation_level="REPEATABLE READ")
    return conn


def qualify(schema: str, table: str) -> str:
    return f'"{schema}"."{table}"'


def _parse_partition_name(name: str) -> tuple[int, int] | None:
    match = re.fullmatch(r"stxos_(\d+)_(\d+)_archive", name)
    if not match:
        return None
    return int(match.group(1)), int(match.group(2))


def get_stxo_partitions(cur) -> list[tuple[str, int, int]]:
    cur.execute(
        """
        SELECT tablename
        FROM pg_catalog.pg_tables
        WHERE schemaname = %s
          AND tablename ~ '^stxos_[0-9]+_[0-9]+_archive$'
        ORDER BY tablename;
        """,
        (SCHEMA,),
    )

    partitions: list[tuple[str, int, int]] = []
    for (table_name,) in cur.fetchall():
        bounds = _parse_partition_name(table_name)
        if bounds is None:
            continue
        lo, hi = bounds
        partitions.append((table_name, lo, hi))

    if not partitions:
        raise RuntimeError("No stxos_*_archive partitions found")

    return partitions


def relevant_partitions(partitions: Iterable[tuple[str, int, int]], height: int) -> list[tuple[str, int, int]]:
    # Partition range is by spendingblock. Any partition ending at/below H cannot
    # contribute unspent-at-H rows because all rows were spent no later than H.
    return [part for part in partitions if part[2] > height]


def nonkey_group_id_expr(alias: str) -> str:
    return f"COALESCE(NULLIF({alias}.address, ''), 'out:' || {alias}.transactionid || ':' || {alias}.vout::text)"


def nonkey_script_type_expr(alias: str) -> str:
    return f"""
    CASE
        WHEN {alias}.scripttype = 'scripthash' THEN 'P2SH'
        WHEN {alias}.scripttype = 'witness_v0_scripthash' THEN 'P2WSH'
        WHEN {alias}.scripttype = 'witness_v1_taproot' THEN 'P2TR'
        ELSE 'Other'
    END
    """.strip()


def nonkey_is_exposed_expr(alias: str) -> str:
    return f"""
    CASE
        WHEN {alias}.scripttype = 'scripthash' THEN ep2sh.address IS NOT NULL
        WHEN {alias}.scripttype = 'witness_v0_scripthash' THEN ep2wsh.address IS NOT NULL
        WHEN {alias}.scripttype = 'witness_v1_taproot' THEN true
        WHEN {alias}.scripttype LIKE 'Multisig %%' THEN true
        ELSE false
    END
    """.strip()


def p2pk_pubkey_from_scripthex_expr(alias: str) -> str:
    lowered = f"lower({alias}.scripthex)"
    return f"""
    CASE
        WHEN {alias}.scripthex ~* '^[0-9a-f]+$'
         AND (
            (substr({lowered}, 1, 2) = '21' AND right({lowered}, 2) = 'ac' AND length({lowered}) = 70)
            OR
            (substr({lowered}, 1, 2) = '41' AND right({lowered}, 2) = 'ac' AND length({lowered}) = 134)
         )
        THEN CASE
            WHEN substr({lowered}, 1, 2) = '21' THEN substr({lowered}, 3, 66)
            WHEN substr({lowered}, 1, 2) = '41' THEN substr({lowered}, 3, 130)
            ELSE NULL
        END
        ELSE NULL
    END
    """.strip()


def ensure_p2pk_pubkey_cache(cur) -> None:
    cur.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {qualify(SCHEMA, P2PK_PUBKEY_CACHE_TABLE)} (
            keyhash20 BYTEA PRIMARY KEY,
            pubkey_hex TEXT NOT NULL,
            first_seen_blockheight BIGINT,
            source_table TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """,
    )


def _populate_p2pk_cache_from_outputs(cur, max_height: int) -> int:
    pubkey_expr = p2pk_pubkey_from_scripthex_expr("src")
    cur.execute(
        f"""
        INSERT INTO {qualify(SCHEMA, P2PK_PUBKEY_CACHE_TABLE)}
            (keyhash20, pubkey_hex, first_seen_blockheight, source_table)
        SELECT
            k.keyhash20,
            p.pubkey_hex,
            MIN(k.blockheight)::bigint AS first_seen_blockheight,
            'outputs'::text AS source_table
        FROM {qualify(SCHEMA, 'key_outputs_all')} k
        JOIN {qualify(SCHEMA, 'outputs')} src
          ON src.blockheight = k.blockheight
         AND src.transactionid = k.transactionid
         AND src.vout = k.vout
        CROSS JOIN LATERAL (
            SELECT {pubkey_expr} AS pubkey_hex
        ) p
        WHERE k.script_type = 'pubkey'
          AND k.blockheight <= %s
          AND p.pubkey_hex IS NOT NULL
        GROUP BY k.keyhash20, p.pubkey_hex
        ON CONFLICT (keyhash20) DO NOTHING;
        """,
        (max_height,),
    )
    return cur.rowcount


def _populate_p2pk_cache_from_stxo_partitions(
    cur,
    max_height: int,
    partitions: Iterable[tuple[str, int, int]],
) -> int:
    total_inserted = 0
    for table_name, _, _ in partitions:
        pubkey_expr = p2pk_pubkey_from_scripthex_expr("s")
        cur.execute(
            f"""
            INSERT INTO {qualify(SCHEMA, P2PK_PUBKEY_CACHE_TABLE)}
                (keyhash20, pubkey_hex, first_seen_blockheight, source_table)
            SELECT
                k.keyhash20,
                p.pubkey_hex,
                MIN(k.blockheight)::bigint AS first_seen_blockheight,
                %s::text AS source_table
            FROM {qualify(SCHEMA, 'key_outputs_all')} k
            JOIN {qualify(SCHEMA, table_name)} s
              ON s.blockheight = k.blockheight
             AND s.transactionid = k.transactionid
             AND s.vout = k.vout
             AND s.scripttype = 'pubkey'
            CROSS JOIN LATERAL (
                SELECT {pubkey_expr} AS pubkey_hex
            ) p
            WHERE k.script_type = 'pubkey'
              AND k.blockheight <= %s
              AND p.pubkey_hex IS NOT NULL
            GROUP BY k.keyhash20, p.pubkey_hex
            ON CONFLICT (keyhash20) DO NOTHING;
            """,
            (table_name, max_height),
        )
        total_inserted += cur.rowcount
    return total_inserted


def populate_p2pk_pubkey_cache(
    cur,
    max_height: int,
    partitions: Iterable[tuple[str, int, int]],
) -> tuple[int, int, int]:
    ensure_p2pk_pubkey_cache(cur)
    inserted_from_outputs = _populate_p2pk_cache_from_outputs(cur, max_height)
    inserted_from_stxo = _populate_p2pk_cache_from_stxo_partitions(cur, max_height, partitions)
    cur.execute(f"SELECT COUNT(*) FROM {qualify(SCHEMA, P2PK_PUBKEY_CACHE_TABLE)};")
    row = cur.fetchone()
    total_cached = int(row[0]) if row and row[0] is not None else 0
    return inserted_from_outputs, inserted_from_stxo, total_cached


def insert_keyhash_rows(cur, height: int) -> int:
    cur.execute(
        f"""
        INSERT INTO tmp_hist_all_rows
            (group_id, display_group_id, script_type, amount, blockheight, spendingblock, is_exposed)
        SELECT
            encode(k.keyhash20, 'hex') AS group_id,
            COALESCE(p2pk.pubkey_hex, NULLIF(k.address, ''), encode(k.keyhash20, 'hex')) AS display_group_id,
            CASE k.script_type
                WHEN 'pubkey' THEN 'P2PK'
                WHEN 'pubkeyhash' THEN 'P2PKH'
                WHEN 'witness_v0_keyhash' THEN 'P2WPKH'
                ELSE 'Other'
            END AS script_type,
            k.amount::bigint,
            k.blockheight,
            k.spendingblock,
            CASE
                WHEN k.blockheight = 0
                 AND k.script_type = 'pubkey'
                 AND encode(k.keyhash20, 'hex') = %s
                THEN false
                ELSE (e.keyhash20 IS NOT NULL)
            END AS is_exposed
        FROM {qualify(SCHEMA, 'key_outputs_all')} k
                LEFT JOIN {qualify(SCHEMA, P2PK_PUBKEY_CACHE_TABLE)} p2pk
                    ON p2pk.keyhash20 = k.keyhash20
         AND k.script_type = 'pubkey'
        LEFT JOIN {qualify(SCHEMA, 'exposed_keyhash20')} e
          ON e.keyhash20 = k.keyhash20
         AND e.exposed_height <= %s
        WHERE k.script_type IN ('pubkey', 'pubkeyhash', 'witness_v0_keyhash')
          AND k.blockheight <= %s
          AND (k.spendingblock IS NULL OR k.spendingblock > %s);
        """,
                (GENESIS_PUBKEY_KEYHASH20_HEX, height, height, height),
    )
    return cur.rowcount


def _stxo_where_clause(lo: int, height: int) -> tuple[str, tuple[int, ...]]:
    if lo > height:
        return "s.blockheight <= %s", (height,)
    return "s.blockheight <= %s AND s.spendingblock > %s", (height, height)


def _union_all_sql(select_statements: list[str]) -> str:
    return "\nUNION ALL\n".join(select_statements)


def build_stxo_union_for_unspent(partitions: Iterable[tuple[str, int, int]], height: int) -> str:
    h = int(height)
    statements: list[str] = []
    for table_name, lo, _ in partitions:
        table_qname = qualify(SCHEMA, table_name)
        where_sql = f"s.blockheight <= {h}" if lo > h else f"s.blockheight <= {h} AND s.spendingblock > {h}"
        statements.append(
            f"""
            SELECT
                s.address,
                s.scripttype,
                s.transactionid,
                s.vout,
                s.amount,
                s.blockheight,
                s.spendingblock
            FROM {table_qname} s
            WHERE {where_sql}
            """.strip()
        )
    return _union_all_sql(statements)


def build_stxo_union_for_history(partitions: Iterable[tuple[str, int, int]], height: int) -> str:
    h = int(height)
    statements: list[str] = []
    for table_name, lo, _ in partitions:
        if lo > h:
            continue
        table_qname = qualify(SCHEMA, table_name)
        statements.append(
            f"""
            SELECT
                s.address,
                s.scripttype,
                s.transactionid,
                s.vout,
                s.blockheight,
                s.spendingblock
            FROM {table_qname} s
            WHERE s.blockheight <= {h}
            """.strip()
        )
    return _union_all_sql(statements)


def insert_outputs_rows(cur, height: int) -> int:
    group_id_sql = nonkey_group_id_expr("o")
    script_type_sql = nonkey_script_type_expr("o")
    is_exposed_sql = nonkey_is_exposed_expr("o")
    cur.execute(
        f"""
        INSERT INTO tmp_hist_all_rows
            (group_id, display_group_id, script_type, amount, blockheight, spendingblock, is_exposed)
        SELECT
            {group_id_sql} AS group_id,
            {group_id_sql} AS display_group_id,
            {script_type_sql} AS script_type,
            o.amount::bigint,
            o.blockheight,
            NULL::bigint AS spendingblock,
            {is_exposed_sql} AS is_exposed
        FROM {qualify(SCHEMA, 'outputs')} o
        LEFT JOIN {qualify(SCHEMA, 'exposed_p2sh_address')} ep2sh
          ON o.scripttype = 'scripthash'
         AND ep2sh.address = o.address
         AND ep2sh.exposed_height <= %s
        LEFT JOIN {qualify(SCHEMA, 'exposed_p2wsh_address')} ep2wsh
          ON o.scripttype = 'witness_v0_scripthash'
         AND ep2wsh.address = o.address
         AND ep2wsh.exposed_height <= %s
        WHERE o.blockheight <= %s
          AND (
                o.scripttype IN ('scripthash', 'witness_v0_scripthash', 'witness_v1_taproot')
                OR (
                    o.scripttype IS NOT NULL
                    AND o.scripttype NOT IN (
                        'pubkey',
                        'pubkeyhash',
                        'witness_v0_keyhash',
                        'scripthash',
                        'witness_v0_scripthash',
                        'witness_v1_taproot'
                    )
                    AND o.scripttype NOT LIKE 'Multisig %%'
                )
                OR (o.scripttype LIKE 'Multisig %%')
          );
        """,
        (height, height, height),
    )
    return cur.rowcount


def insert_stxo_rows_bulk(cur, partitions: list[tuple[str, int, int]], height: int) -> int:
    stxo_union_sql = build_stxo_union_for_unspent(partitions, height)
    if not stxo_union_sql:
        return 0

    group_id_sql = nonkey_group_id_expr("s")
    script_type_sql = nonkey_script_type_expr("s")
    is_exposed_sql = nonkey_is_exposed_expr("s")
    cur.execute(
        f"""
        INSERT INTO tmp_hist_all_rows
            (group_id, display_group_id, script_type, amount, blockheight, spendingblock, is_exposed)
        SELECT
            {group_id_sql} AS group_id,
            {group_id_sql} AS display_group_id,
            {script_type_sql} AS script_type,
            s.amount::bigint,
            s.blockheight,
            s.spendingblock,
            {is_exposed_sql} AS is_exposed
                FROM (
                        {stxo_union_sql}
                ) s
        LEFT JOIN {qualify(SCHEMA, 'exposed_p2sh_address')} ep2sh
          ON s.scripttype = 'scripthash'
         AND ep2sh.address = s.address
         AND ep2sh.exposed_height <= %s
        LEFT JOIN {qualify(SCHEMA, 'exposed_p2wsh_address')} ep2wsh
          ON s.scripttype = 'witness_v0_scripthash'
         AND ep2wsh.address = s.address
         AND ep2wsh.exposed_height <= %s
                WHERE (
                s.scripttype IN ('scripthash', 'witness_v0_scripthash', 'witness_v1_taproot')
                OR (
                    s.scripttype IS NOT NULL
                    AND s.scripttype NOT IN (
                        'pubkey',
                        'pubkeyhash',
                        'witness_v0_keyhash',
                        'scripthash',
                        'witness_v0_scripthash',
                        'witness_v1_taproot'
                    )
                    AND s.scripttype NOT LIKE 'Multisig %%'
                )
                OR (s.scripttype LIKE 'Multisig %%')
          );
        """,
                (height, height),
    )
    return cur.rowcount


def build_last_spend_history(cur, height: int, cutoff_height: int, partitions: list[tuple[str, int, int]]) -> int:
    """Populate tmp_hist_last_spend with MAX(spendingblock) <= height per (group_id, script_type).

    Two-pass strategy:
    1. Fast pass — query active_*_outputs tables. These contain the complete per-address output
       history for every address that still has UTXOs at the freeze height. A resolved group_id
       is recorded in tmp_hist_active_found so it is skipped in the archive pass.
    2. Archive pass (for group_ids NOT in active tables):
       - Key types (P2PK/P2PKH/P2WPKH) + P2TR + Other: scan all stxo archive partitions with
         lo <= height. Full history is required to correctly distinguish 'never_spent' from
         'inactive' (a P2PK output that never spent must not be mis-classified as inactive).
       - P2SH + P2WSH: scan only partitions where hi > cutoff_height, filtering spendingblock to
         the active period (cutoff_height < spend <= height). If no active-period spend is found
         and the group is exposed, it must have last spent before the cutoff → assume 'inactive'.
    """
    cur.execute("DROP TABLE IF EXISTS tmp_hist_last_spend;")
    cur.execute(
        """
        CREATE TEMP TABLE tmp_hist_last_spend (
            group_id TEXT NOT NULL,
            script_type TEXT NOT NULL,
            last_spend_blockheight BIGINT NOT NULL,
            PRIMARY KEY (group_id, script_type)
        ) ON COMMIT DROP;
        """
    )

    # Tracks which (group_id, script_type) pairs were resolved from active_*_outputs.
    # These are skipped in the archive pass.
    cur.execute("DROP TABLE IF EXISTS tmp_hist_active_found;")
    cur.execute(
        """
        CREATE TEMP TABLE tmp_hist_active_found (
            group_id TEXT NOT NULL,
            script_type TEXT NOT NULL,
            PRIMARY KEY (group_id, script_type)
        ) ON COMMIT DROP;
        """
    )

    cur.execute("DROP TABLE IF EXISTS tmp_hist_groups;")
    cur.execute(
        """
        CREATE TEMP TABLE tmp_hist_groups ON COMMIT DROP AS
        SELECT DISTINCT group_id, script_type
        FROM tmp_hist_all_rows
        WHERE group_id IS NOT NULL
          AND group_id <> '';
        """
    )
    cur.execute(
        """
        CREATE INDEX tmp_hist_groups_group_script_idx
        ON tmp_hist_groups (group_id, script_type);
        """
    )
    cur.execute("ANALYZE tmp_hist_groups;")

    # ── First pass: active_*_outputs tables ────────────────────────────────────────
    key_type_case_a = """CASE a.script_type
            WHEN 'pubkey'             THEN 'P2PK'
            WHEN 'pubkeyhash'         THEN 'P2PKH'
            WHEN 'witness_v0_keyhash' THEN 'P2WPKH'
        END"""

    # Key types via active_key_outputs (keyhash20 → P2PK/P2PKH/P2WPKH).
    cur.execute(
        f"""
        INSERT INTO tmp_hist_active_found (group_id, script_type)
        SELECT DISTINCT encode(a.keyhash20, 'hex') AS group_id,
                        {key_type_case_a} AS script_type
        FROM {qualify(SCHEMA, 'active_key_outputs')} a
        JOIN tmp_hist_groups g
          ON g.group_id = encode(a.keyhash20, 'hex')
         AND g.script_type = {key_type_case_a}
        WHERE a.script_type IN ('pubkey', 'pubkeyhash', 'witness_v0_keyhash')
        ON CONFLICT (group_id, script_type) DO NOTHING;
        """
    )
    cur.execute(
        f"""
        INSERT INTO tmp_hist_last_spend (group_id, script_type, last_spend_blockheight)
        SELECT encode(a.keyhash20, 'hex') AS group_id,
               {key_type_case_a} AS script_type,
               MAX(a.spendingblock)::bigint AS last_spend_blockheight
        FROM {qualify(SCHEMA, 'active_key_outputs')} a
        JOIN tmp_hist_groups g
          ON g.group_id = encode(a.keyhash20, 'hex')
         AND g.script_type = {key_type_case_a}
        WHERE a.script_type IN ('pubkey', 'pubkeyhash', 'witness_v0_keyhash')
          AND a.spendingblock IS NOT NULL
          AND a.spendingblock <= %s
        GROUP BY 1, 2
        ON CONFLICT (group_id, script_type) DO UPDATE
        SET last_spend_blockheight = GREATEST(
            tmp_hist_last_spend.last_spend_blockheight,
            EXCLUDED.last_spend_blockheight
        );
        """,
        (height,),
    )

    # Non-key address-based types: P2SH, P2WSH, P2TR — joined by address column.
    for active_table, script_type_label in [
        ("active_p2sh_outputs", "P2SH"),
        ("active_p2wsh_outputs", "P2WSH"),
        ("active_p2tr_outputs", "P2TR"),
    ]:
        cur.execute(
            f"""
            INSERT INTO tmp_hist_active_found (group_id, script_type)
            SELECT DISTINCT a.address AS group_id, %s AS script_type
            FROM {qualify(SCHEMA, active_table)} a
            JOIN tmp_hist_groups g ON g.group_id = a.address AND g.script_type = %s
            WHERE a.address IS NOT NULL AND a.address <> ''
            ON CONFLICT (group_id, script_type) DO NOTHING;
            """,
            (script_type_label, script_type_label),
        )
        cur.execute(
            f"""
            INSERT INTO tmp_hist_last_spend (group_id, script_type, last_spend_blockheight)
            SELECT a.address AS group_id, %s AS script_type,
                   MAX(a.spendingblock)::bigint AS last_spend_blockheight
            FROM {qualify(SCHEMA, active_table)} a
            JOIN tmp_hist_groups g ON g.group_id = a.address AND g.script_type = %s
            WHERE a.address IS NOT NULL AND a.address <> ''
              AND a.spendingblock IS NOT NULL
              AND a.spendingblock <= %s
            GROUP BY 1, 2
            ON CONFLICT (group_id, script_type) DO UPDATE
            SET last_spend_blockheight = GREATEST(
                tmp_hist_last_spend.last_spend_blockheight,
                EXCLUDED.last_spend_blockheight
            );
            """,
            (script_type_label, script_type_label, height),
        )

    # Other (bare multisig) via active_bare_ms_outputs — group_id uses address-or-outpoint fallback.
    bare_ms_gid = nonkey_group_id_expr("a")
    cur.execute(
        f"""
        INSERT INTO tmp_hist_active_found (group_id, script_type)
        SELECT DISTINCT {bare_ms_gid} AS group_id, 'Other' AS script_type
        FROM {qualify(SCHEMA, 'active_bare_ms_outputs')} a
        JOIN tmp_hist_groups g ON g.group_id = {bare_ms_gid} AND g.script_type = 'Other'
        ON CONFLICT (group_id, script_type) DO NOTHING;
        """
    )
    cur.execute(
        f"""
        INSERT INTO tmp_hist_last_spend (group_id, script_type, last_spend_blockheight)
        SELECT {bare_ms_gid} AS group_id, 'Other' AS script_type,
               MAX(a.spendingblock)::bigint AS last_spend_blockheight
        FROM {qualify(SCHEMA, 'active_bare_ms_outputs')} a
        JOIN tmp_hist_groups g ON g.group_id = {bare_ms_gid} AND g.script_type = 'Other'
        WHERE a.spendingblock IS NOT NULL
          AND a.spendingblock <= %s
        GROUP BY 1, 2
        ON CONFLICT (group_id, script_type) DO UPDATE
        SET last_spend_blockheight = GREATEST(
            tmp_hist_last_spend.last_spend_blockheight,
            EXCLUDED.last_spend_blockheight
        );
        """,
        (height,),
    )

    # ── Second pass: stxo archive partitions for group_ids not in active tables ──────
    # history_all    — partitions where lo <= height (could contain any spend up to height)
    # history_active — subset of above where hi > cutoff_height (could contain active-period spends)
    history_all = [(name, lo, hi) for name, lo, hi in partitions if lo <= height]
    history_active = [(name, lo, hi) for name, lo, hi in partitions if lo <= height and hi > cutoff_height]

    key_type_case_k = """CASE k.script_type
            WHEN 'pubkey'             THEN 'P2PK'
            WHEN 'pubkeyhash'         THEN 'P2PKH'
            WHEN 'witness_v0_keyhash' THEN 'P2WPKH'
        END"""

    # Key types + P2TR + Other: full history required to correctly classify never_spent vs inactive.
    history_all_union_sql = build_stxo_union_for_history(history_all, height)
    if history_all_union_sql:
        # Key types via key_outputs_all mapping (no keyhash20 in stxo rows directly).
        cur.execute(
            f"""
            INSERT INTO tmp_hist_last_spend (group_id, script_type, last_spend_blockheight)
            SELECT
                encode(k.keyhash20, 'hex') AS group_id,
                {key_type_case_k} AS script_type,
                MAX(s.spendingblock)::bigint AS last_spend_blockheight
            FROM (
                {history_all_union_sql}
            ) s
            JOIN {qualify(SCHEMA, 'key_outputs_all')} k
              ON k.blockheight = s.blockheight
             AND k.transactionid = s.transactionid
             AND k.vout = s.vout
             AND k.script_type IN ('pubkey', 'pubkeyhash', 'witness_v0_keyhash')
            JOIN tmp_hist_groups g
              ON g.group_id = encode(k.keyhash20, 'hex')
             AND g.script_type = {key_type_case_k}
            LEFT JOIN tmp_hist_active_found fa
              ON fa.group_id = encode(k.keyhash20, 'hex')
             AND fa.script_type = {key_type_case_k}
            WHERE fa.group_id IS NULL
              AND s.spendingblock IS NOT NULL
              AND s.spendingblock <= %s
            GROUP BY 1, 2
            ON CONFLICT (group_id, script_type) DO UPDATE
            SET last_spend_blockheight = GREATEST(
                tmp_hist_last_spend.last_spend_blockheight,
                EXCLUDED.last_spend_blockheight
            );
            """,
            (height,),
        )

        # P2TR + Other: directly from stxo rows (always-exposed types, full history needed).
        group_id_sql = nonkey_group_id_expr("s")
        script_type_sql = nonkey_script_type_expr("s")
        cur.execute(
            f"""
            INSERT INTO tmp_hist_last_spend (group_id, script_type, last_spend_blockheight)
            SELECT
                {group_id_sql} AS group_id,
                {script_type_sql} AS script_type,
                MAX(s.spendingblock)::bigint AS last_spend_blockheight
            FROM (
                {history_all_union_sql}
            ) s
            JOIN tmp_hist_groups g
              ON g.group_id = {group_id_sql}
             AND g.script_type = {script_type_sql}
            LEFT JOIN tmp_hist_active_found fa
              ON fa.group_id = {group_id_sql}
             AND fa.script_type = {script_type_sql}
            WHERE fa.group_id IS NULL
              AND s.spendingblock IS NOT NULL
              AND s.spendingblock <= %s
              AND s.scripttype NOT IN (
                    'pubkey', 'pubkeyhash', 'witness_v0_keyhash',
                    'scripthash', 'witness_v0_scripthash'
              )
            GROUP BY 1, 2
            ON CONFLICT (group_id, script_type) DO UPDATE
            SET last_spend_blockheight = GREATEST(
                tmp_hist_last_spend.last_spend_blockheight,
                EXCLUDED.last_spend_blockheight
            );
            """,
            (height,),
        )

    # P2SH + P2WSH: only check partitions that may contain active-period spends.
    # Skipping old archives is safe because if no active-period spend is found and the group
    # is exposed, the last spend must have been before the cutoff → handled as 'inactive' below.
    history_active_union_sql = build_stxo_union_for_history(history_active, height)
    if history_active_union_sql:
        group_id_sql = nonkey_group_id_expr("s")
        script_type_sql = nonkey_script_type_expr("s")
        cur.execute(
            f"""
            INSERT INTO tmp_hist_last_spend (group_id, script_type, last_spend_blockheight)
            SELECT
                {group_id_sql} AS group_id,
                {script_type_sql} AS script_type,
                MAX(s.spendingblock)::bigint AS last_spend_blockheight
            FROM (
                {history_active_union_sql}
            ) s
            JOIN tmp_hist_groups g
              ON g.group_id = {group_id_sql}
             AND g.script_type = {script_type_sql}
            LEFT JOIN tmp_hist_active_found fa
              ON fa.group_id = {group_id_sql}
             AND fa.script_type = {script_type_sql}
            WHERE fa.group_id IS NULL
              AND s.spendingblock IS NOT NULL
              AND s.spendingblock > %s
              AND s.spendingblock <= %s
              AND s.scripttype IN ('scripthash', 'witness_v0_scripthash')
            GROUP BY 1, 2
            ON CONFLICT (group_id, script_type) DO UPDATE
            SET last_spend_blockheight = GREATEST(
                tmp_hist_last_spend.last_spend_blockheight,
                EXCLUDED.last_spend_blockheight
            );
            """,
            (cutoff_height, height),
        )

    # ── Assume inactive for exposed P2SH/P2WSH with no spend found ──────────────────
    # An exposed P2SH/P2WSH must have spent at least once (spending reveals the redeemScript).
    # If no spend was found in the active tables or in the active-period archives, the last spend
    # preceded the cutoff — classify as 'inactive' by inserting a sentinel of blockheight 1.
    cur.execute(
        """
        INSERT INTO tmp_hist_last_spend (group_id, script_type, last_spend_blockheight)
        SELECT DISTINCT g.group_id, g.script_type, 1::bigint
        FROM tmp_hist_groups g
        LEFT JOIN tmp_hist_active_found fa
          ON fa.group_id = g.group_id AND fa.script_type = g.script_type
        LEFT JOIN tmp_hist_last_spend ls
          ON ls.group_id = g.group_id AND ls.script_type = g.script_type
        WHERE g.script_type IN ('P2SH', 'P2WSH')
          AND fa.group_id IS NULL
          AND ls.group_id IS NULL
          AND EXISTS (
              SELECT 1 FROM tmp_hist_all_rows r
              WHERE r.group_id = g.group_id
                AND r.script_type = g.script_type
                AND r.is_exposed = true
          )
        ON CONFLICT (group_id, script_type) DO NOTHING;
        """
    )

    cur.execute("SELECT COUNT(*) FROM tmp_hist_last_spend;")
    row = cur.fetchone()
    return int(row[0]) if row and row[0] is not None else 0


def build_first_exposure_history(cur, height: int, partitions: list[tuple[str, int, int]]) -> int:
        """Populate tmp_hist_first_exposed with MIN(exposed output blockheight) <= height.

        Unlike tmp_hist_all_rows (which is intentionally unspent-at-H only), this computes
        first exposure from full output history so first_exposed_blockheight remains
        consistent with last_spend_blockheight.
        """
        cur.execute("DROP TABLE IF EXISTS tmp_hist_first_exposed;")
        cur.execute(
                """
                CREATE TEMP TABLE tmp_hist_first_exposed (
                        group_id TEXT NOT NULL,
                        script_type TEXT NOT NULL,
                        first_exposed_blockheight BIGINT NOT NULL,
                        PRIMARY KEY (group_id, script_type)
                ) ON COMMIT DROP;
                """
        )

        cur.execute("DROP TABLE IF EXISTS tmp_hist_groups_for_exposure;")
        cur.execute(
                """
                CREATE TEMP TABLE tmp_hist_groups_for_exposure ON COMMIT DROP AS
                SELECT DISTINCT group_id, script_type
                FROM tmp_hist_all_rows
                WHERE group_id IS NOT NULL
                    AND group_id <> '';
                """
        )
        cur.execute(
            """
            CREATE INDEX tmp_hist_groups_for_exposure_group_script_idx
            ON tmp_hist_groups_for_exposure (group_id, script_type);
            """
        )
        cur.execute("ANALYZE tmp_hist_groups_for_exposure;")

        key_type_case = """CASE k.script_type
                        WHEN 'pubkey'             THEN 'P2PK'
                        WHEN 'pubkeyhash'         THEN 'P2PKH'
                        WHEN 'witness_v0_keyhash' THEN 'P2WPKH'
                END"""

        # Key-type groups: exposure from exposed_keyhash20, history from key_outputs_all.
        cur.execute(
                f"""
                INSERT INTO tmp_hist_first_exposed (group_id, script_type, first_exposed_blockheight)
                SELECT
                        encode(k.keyhash20, 'hex') AS group_id,
                        {key_type_case} AS script_type,
                        MIN(k.blockheight)::bigint AS first_exposed_blockheight
                FROM {qualify(SCHEMA, 'key_outputs_all')} k
                JOIN {qualify(SCHEMA, 'exposed_keyhash20')} e
                    ON e.keyhash20 = k.keyhash20
                 AND e.exposed_height <= %s
                JOIN tmp_hist_groups_for_exposure g
                    ON g.group_id = encode(k.keyhash20, 'hex')
                 AND g.script_type = {key_type_case}
                WHERE k.script_type IN ('pubkey', 'pubkeyhash', 'witness_v0_keyhash')
                    AND k.blockheight <= %s
                GROUP BY 1, 2
                ON CONFLICT (group_id, script_type) DO UPDATE
                SET first_exposed_blockheight = LEAST(
                        tmp_hist_first_exposed.first_exposed_blockheight,
                        EXCLUDED.first_exposed_blockheight
                );
                """,
                (height, height),
        )

        group_id_sql = nonkey_group_id_expr("o")
        script_type_sql = nonkey_script_type_expr("o")

        # Non-key exposed groups from outputs in a single pass:
        # - P2SH / P2WSH via exposed address tables
        # - P2TR always exposed
        # - Other only for canonical multisig rows
        cur.execute(
                f"""
                INSERT INTO tmp_hist_first_exposed (group_id, script_type, first_exposed_blockheight)
                SELECT
                        {group_id_sql} AS group_id,
                        {script_type_sql} AS script_type,
                        MIN(o.blockheight)::bigint AS first_exposed_blockheight
                FROM {qualify(SCHEMA, 'outputs')} o
                JOIN tmp_hist_groups_for_exposure g
                    ON g.group_id = {group_id_sql}
                 AND g.script_type = {script_type_sql}
                LEFT JOIN {qualify(SCHEMA, 'exposed_p2sh_address')} ep2sh
                    ON o.scripttype = 'scripthash'
                 AND ep2sh.address = o.address
                 AND ep2sh.exposed_height <= %s
                LEFT JOIN {qualify(SCHEMA, 'exposed_p2wsh_address')} ep2wsh
                    ON o.scripttype = 'witness_v0_scripthash'
                 AND ep2wsh.address = o.address
                 AND ep2wsh.exposed_height <= %s
                WHERE o.blockheight <= %s
                    AND (
                                o.scripttype IN ('scripthash', 'witness_v0_scripthash', 'witness_v1_taproot')
                                OR o.scripttype LIKE 'Multisig %%'
                            )
                    AND (
                                (o.scripttype = 'scripthash' AND ep2sh.address IS NOT NULL)
                                OR (o.scripttype = 'witness_v0_scripthash' AND ep2wsh.address IS NOT NULL)
                                OR (o.scripttype = 'witness_v1_taproot')
                                OR (o.scripttype LIKE 'Multisig %%')
                            )
                GROUP BY 1, 2
                ON CONFLICT (group_id, script_type) DO UPDATE
                SET first_exposed_blockheight = LEAST(
                        tmp_hist_first_exposed.first_exposed_blockheight,
                        EXCLUDED.first_exposed_blockheight
                );
                """,
                (height, height, height),
        )

        # Include non-key history from STXO archives as well. Some addresses have their
        # earliest relevant outputs only in archives (spent rows), and outputs can hold
        # only newer/unspent rows.
        history_stxo_union_sql = build_stxo_union_for_history(partitions, height)
        if history_stxo_union_sql:
            group_id_sql = nonkey_group_id_expr("s")
            script_type_sql = nonkey_script_type_expr("s")
            cur.execute(
                f"""
                INSERT INTO tmp_hist_first_exposed (group_id, script_type, first_exposed_blockheight)
                SELECT
                    {group_id_sql} AS group_id,
                    {script_type_sql} AS script_type,
                    MIN(s.blockheight)::bigint AS first_exposed_blockheight
                FROM (
                    {history_stxo_union_sql}
                ) s
                JOIN tmp_hist_groups_for_exposure g
                    ON g.group_id = {group_id_sql}
                 AND g.script_type = {script_type_sql}
                LEFT JOIN {qualify(SCHEMA, 'exposed_p2sh_address')} ep2sh
                    ON s.scripttype = 'scripthash'
                 AND ep2sh.address = s.address
                 AND ep2sh.exposed_height <= %s
                LEFT JOIN {qualify(SCHEMA, 'exposed_p2wsh_address')} ep2wsh
                    ON s.scripttype = 'witness_v0_scripthash'
                 AND ep2wsh.address = s.address
                 AND ep2wsh.exposed_height <= %s
                WHERE (
                        s.scripttype IN ('scripthash', 'witness_v0_scripthash', 'witness_v1_taproot')
                        OR s.scripttype LIKE 'Multisig %%'
                        )
                    AND (
                        (s.scripttype = 'scripthash' AND ep2sh.address IS NOT NULL)
                        OR (s.scripttype = 'witness_v0_scripthash' AND ep2wsh.address IS NOT NULL)
                        OR (s.scripttype = 'witness_v1_taproot')
                        OR (s.scripttype LIKE 'Multisig %%')
                        )
                GROUP BY 1, 2
                ON CONFLICT (group_id, script_type) DO UPDATE
                SET first_exposed_blockheight = LEAST(
                    tmp_hist_first_exposed.first_exposed_blockheight,
                    EXCLUDED.first_exposed_blockheight
                );
                """,
                (height, height),
            )

        cur.execute("SELECT COUNT(*) FROM tmp_hist_first_exposed;")
        row = cur.fetchone()
        return int(row[0]) if row and row[0] is not None else 0


def build_dashboard_base_historical(cur, height: int, cutoff_height: int, partitions: list[tuple[str, int, int]]) -> None:
    cur.execute("DROP TABLE IF EXISTS tmp_hist_all_rows;")
    cur.execute(
        """
        CREATE TEMP TABLE tmp_hist_all_rows (
            group_id TEXT NOT NULL,
            display_group_id TEXT NOT NULL,
            script_type TEXT NOT NULL,
            amount BIGINT NOT NULL,
            blockheight BIGINT NOT NULL,
            spendingblock BIGINT,
            is_exposed BOOLEAN NOT NULL
        ) ON COMMIT DROP;
        """
    )

    t_insert_start = time.perf_counter()
    inserted_key_rows = insert_keyhash_rows(cur, height)
    inserted_outputs_rows = insert_outputs_rows(cur, height)

    unspent_partitions = relevant_partitions(partitions, height)
    inserted_stxo_rows = insert_stxo_rows_bulk(cur, unspent_partitions, height)
    t_insert_elapsed = time.perf_counter() - t_insert_start

    cur.execute(
        """
        CREATE INDEX tmp_hist_all_rows_group_script_idx
        ON tmp_hist_all_rows (group_id, script_type);
        """
    )
    cur.execute(
        """
        CREATE INDEX tmp_hist_all_rows_group_script_spend_idx
        ON tmp_hist_all_rows (group_id, script_type, spendingblock);
        """
    )
    cur.execute(
        """
        CREATE INDEX tmp_hist_all_rows_group_script_block_idx
        ON tmp_hist_all_rows (group_id, script_type, blockheight);
        """
    )
    cur.execute("ANALYZE tmp_hist_all_rows;")

    t_history_start = time.perf_counter()
    last_spend_groups = build_last_spend_history(cur, height, cutoff_height, partitions)
    first_exposed_groups = build_first_exposure_history(cur, height, partitions)
    t_history_elapsed = time.perf_counter() - t_history_start

    print(f"rows inserted from key_outputs_all : {inserted_key_rows:,}")
    print(f"rows inserted from outputs         : {inserted_outputs_rows:,}")
    print(f"rows inserted from stxo partitions : {inserted_stxo_rows:,}")
    print(f"row insert phase time (s)         : {t_insert_elapsed:.2f}")
    print(f"groups with spend history <= H     : {last_spend_groups:,}")
    print(f"groups with exposure history <= H  : {first_exposed_groups:,}")
    print(f"history phase time (s)            : {t_history_elapsed:.2f}")

    cur.execute("DROP TABLE IF EXISTS tmp_dashboard_pubkey_base;")
    cur.execute(
        """
        CREATE TEMP TABLE tmp_dashboard_pubkey_base ON COMMIT DROP AS
        WITH grouped AS (
            SELECT
                r.group_id,
                MIN(r.display_group_id) AS display_group_id,
                r.script_type,
                COUNT(*)::bigint AS current_utxo_count,
                COALESCE(SUM(r.amount), 0)::bigint AS current_supply_sats,
                COUNT(*) FILTER (WHERE r.is_exposed)::bigint AS exposed_utxo_count,
                COALESCE(SUM(r.amount) FILTER (WHERE r.is_exposed), 0)::bigint AS exposed_supply_sats,
                MAX(r.spendingblock) FILTER (
                    WHERE r.spendingblock IS NOT NULL
                      AND r.spendingblock <= %s
                )::bigint AS last_spend_blockheight
            FROM tmp_hist_all_rows r
            WHERE r.group_id IS NOT NULL
            GROUP BY r.group_id, r.script_type
        )
        SELECT
            g.group_id,
            g.display_group_id,
            g.script_type,
            g.current_utxo_count,
            g.current_supply_sats,
            g.exposed_utxo_count,
            g.exposed_supply_sats,
            fe.first_exposed_blockheight,
            CASE
                WHEN g.exposed_supply_sats > 0 OR g.exposed_utxo_count > 0 THEN 1::bigint
                ELSE 0::bigint
            END AS exposed_pubkey_count,
            ls.last_spend_blockheight,
            CASE
                WHEN ls.last_spend_blockheight IS NULL THEN 'never_spent'
                WHEN ls.last_spend_blockheight <= %s THEN 'inactive'
                ELSE 'active'
            END AS spend_activity
        FROM grouped g
        LEFT JOIN tmp_hist_last_spend ls
          ON ls.group_id = g.group_id
         AND ls.script_type = g.script_type
                LEFT JOIN tmp_hist_first_exposed fe
                    ON fe.group_id = g.group_id
                 AND fe.script_type = g.script_type
        WHERE g.current_supply_sats > 0;
        """,
        (height, cutoff_height),
    )
    cur.execute("ANALYZE tmp_dashboard_pubkey_base;")


def resolve_heights(args: argparse.Namespace, chain_max_height: int) -> list[int]:
    if args.height is not None:
        if args.start is not None or args.end is not None:
            raise ValueError("Use either --height or --start/--end, not both")
        if args.height < 0:
            raise ValueError("--height must be >= 0")
        if args.height > chain_max_height:
            raise ValueError(f"--height {args.height} is above chain max {chain_max_height}")
        return [args.height]

    if args.start is None or args.end is None:
        raise ValueError("Provide either --height or both --start and --end")
    if args.step <= 0:
        raise ValueError("--step must be > 0")
    if args.start < 0 or args.end < 0:
        raise ValueError("--start/--end must be >= 0")
    if args.start > args.end:
        raise ValueError("--start must be <= --end")
    if args.end > chain_max_height:
        raise ValueError(f"--end {args.end} is above chain max {chain_max_height}")

    return list(range(args.start, args.end + 1, args.step))


def get_chain_max_height(cur) -> int:
    cur.execute(f"SELECT MAX(blockheight) FROM {qualify(SCHEMA, 'blockheader')};")
    row = cur.fetchone()
    if row is None or row[0] is None:
        raise RuntimeError("Could not determine max blockheight from blockheader")
    return int(row[0])


def get_block_time(cur, height: int) -> int:
    cur.execute(
        f"SELECT time FROM {qualify(SCHEMA, 'blockheader')} WHERE blockheight = %s;",
        (height,),
    )
    row = cur.fetchone()
    if row is None or row[0] is None:
        raise RuntimeError(f"No blockheader row for height {height}")
    return int(row[0])


def list_available_snapshot_heights(out_dir: Path) -> list[str]:
    heights: list[str] = []

    index_path = out_dir / "snapshots_index.csv"
    if index_path.exists():
        with index_path.open("r", encoding="utf-8", newline="") as f:
            reader = csv.DictReader(f)
            heights.extend(
                (row.get("snapshot_blockheight") or "").strip()
                for row in reader
                if (row.get("snapshot_blockheight") or "").strip().isdigit()
            )

    # Include numeric snapshot directories even if index is stale/missing.
    if out_dir.exists():
        for child in out_dir.iterdir():
            if child.is_dir() and child.name.isdigit():
                heights.append(child.name)

    # Deduplicate while preserving oldest-snapshot precedence.
    # Historical labels in earlier curated snapshots should win over newer
    # generic fallbacks such as Miner when the same group appears again.
    unique = sorted(set(heights), key=lambda value: int(value))
    return unique


def collect_existing_snapshot_heights(out_dir: Path) -> set[int]:
    heights: set[int] = set()

    for value in list_available_snapshot_heights(out_dir):
        if value.isdigit():
            heights.add(int(value))

    archived_dir = out_dir / "archived"
    if archived_dir.exists() and archived_dir.is_dir():
        for child in archived_dir.iterdir():
            if child.is_dir() and child.name.isdigit():
                heights.add(int(child.name))

    return heights


def apply_height_filters(heights: list[int], args: argparse.Namespace, out_dir: Path) -> tuple[list[int], int, int]:
    filtered = list(heights)
    skipped_by_multiple = 0
    skipped_existing = 0

    if args.skip_multiples_of:
        if args.skip_multiples_of <= 0:
            raise ValueError("--skip-multiples-of must be > 0")
        before = len(filtered)
        filtered = [h for h in filtered if h % args.skip_multiples_of != 0]
        skipped_by_multiple = before - len(filtered)

    if args.skip_existing:
        existing = collect_existing_snapshot_heights(out_dir)
        before = len(filtered)
        filtered = [h for h in filtered if h not in existing]
        skipped_existing = before - len(filtered)

    return filtered, skipped_by_multiple, skipped_existing


def split_pipe_values(raw: str) -> list[str]:
    return [part.strip() for part in raw.split("|") if part and part.strip()]


def canonical_pipe_signature(raw: str) -> str:
    values = split_pipe_values(raw)
    if not values:
        return ""
    unique_sorted = sorted(set(values), key=lambda value: (value.lower(), value))
    return "|".join(unique_sorted)


def load_label_cache_from_all_snapshots(
    out_dir: Path,
) -> tuple[
    list[str],
    list[tuple[str, str, str]],
    list[tuple[str, str, str]],
    list[tuple[str, str, str, str]],
    list[tuple[str, str, str]],
    list[tuple[str, str, str, str]],
]:
    snapshot_heights = list_available_snapshot_heights(out_dir)
    group_cache: dict[str, tuple[str, str]] = {}
    display_cache: dict[str, tuple[str, str]] = {}
    display_sig_cache: dict[tuple[str, str], tuple[str, str]] = {}
    display_token_cache: dict[str, tuple[str, str]] = {}
    display_script_cache: dict[tuple[str, str], tuple[str, str]] = {}

    for snapshot_height in snapshot_heights:
        ge1_path = out_dir / snapshot_height / "dashboard_pubkeys_ge_1btc.csv"
        if not ge1_path.exists():
            continue

        with ge1_path.open("r", encoding="utf-8", newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                group_id = (row.get("group_id") or "").strip()
                display_group_ids = (
                    row.get("display_group_ids") or row.get("display_group_id") or ""
                ).strip()
                script_types = (row.get("script_types") or row.get("script_type") or "").strip()
                details = (row.get("details") or row.get("comments") or "").strip()
                identity = (row.get("identity") or "").strip()

                if not details and not identity:
                    continue

                if group_id and group_id not in group_cache:
                    group_cache[group_id] = (details, identity)
                if display_group_ids and display_group_ids not in display_cache:
                    display_cache[display_group_ids] = (details, identity)

                display_sig = canonical_pipe_signature(display_group_ids)
                script_sig = canonical_pipe_signature(script_types)
                if display_sig:
                    sig_key = (display_sig, script_sig)
                    if sig_key not in display_sig_cache:
                        display_sig_cache[sig_key] = (details, identity)

                display_tokens = split_pipe_values(display_group_ids)
                script_tokens = split_pipe_values(script_types)

                for display_token in display_tokens:
                    if display_token not in display_token_cache:
                        display_token_cache[display_token] = (details, identity)

                for display_token in display_tokens:
                    for script_token in script_tokens:
                        key = (display_token, script_token)
                        if key not in display_script_cache:
                            display_script_cache[key] = (details, identity)

    group_rows = [(key, value[0], value[1]) for key, value in group_cache.items()]
    display_rows = [(key, value[0], value[1]) for key, value in display_cache.items()]
    display_sig_rows = [
        (key[0], key[1], value[0], value[1])
        for key, value in display_sig_cache.items()
    ]
    display_token_rows = [
        (key, value[0], value[1])
        for key, value in display_token_cache.items()
    ]
    display_script_rows = [
        (key[0], key[1], value[0], value[1])
        for key, value in display_script_cache.items()
    ]
    return (
        snapshot_heights,
        group_rows,
        display_rows,
        display_sig_rows,
        display_token_rows,
        display_script_rows,
    )


def prepare_label_cache(
    cur,
    group_rows: list[tuple[str, str, str]],
    display_rows: list[tuple[str, str, str]],
    display_sig_rows: list[tuple[str, str, str, str]],
    display_token_rows: list[tuple[str, str, str]],
    display_script_rows: list[tuple[str, str, str, str]],
) -> None:
    cur.execute("DROP TABLE IF EXISTS tmp_label_cache_by_group;")
    cur.execute("DROP TABLE IF EXISTS tmp_label_cache_by_display;")
    cur.execute("DROP TABLE IF EXISTS tmp_label_cache_by_display_sig;")
    cur.execute("DROP TABLE IF EXISTS tmp_label_cache_by_display_token;")
    cur.execute("DROP TABLE IF EXISTS tmp_label_cache_by_display_script;")
    cur.execute(
        """
        CREATE TEMP TABLE tmp_label_cache_by_group (
            group_id TEXT PRIMARY KEY,
            details TEXT,
            identity TEXT
        );
        """
    )
    cur.execute(
        """
        CREATE TEMP TABLE tmp_label_cache_by_display_sig (
            display_group_ids_sig TEXT NOT NULL,
            script_types_sig TEXT NOT NULL,
            details TEXT,
            identity TEXT,
            PRIMARY KEY (display_group_ids_sig, script_types_sig)
        );
        """
    )
    cur.execute(
        """
        CREATE TEMP TABLE tmp_label_cache_by_display_token (
            display_group_id TEXT PRIMARY KEY,
            details TEXT,
            identity TEXT
        );
        """
    )
    cur.execute(
        """
        CREATE TEMP TABLE tmp_label_cache_by_display_script (
            display_group_id TEXT NOT NULL,
            script_type TEXT NOT NULL,
            details TEXT,
            identity TEXT,
            PRIMARY KEY (display_group_id, script_type)
        );
        """
    )
    cur.execute(
        """
        CREATE TEMP TABLE tmp_label_cache_by_display (
            display_group_ids TEXT PRIMARY KEY,
            details TEXT,
            identity TEXT
        );
        """
    )
    if group_rows:
        cur.executemany(
            """
            INSERT INTO tmp_label_cache_by_group
                (group_id, details, identity)
            VALUES (%s, %s, %s);
            """,
            group_rows,
        )
    if display_rows:
        cur.executemany(
            """
            INSERT INTO tmp_label_cache_by_display
                (display_group_ids, details, identity)
            VALUES (%s, %s, %s);
            """,
            display_rows,
        )
    if display_sig_rows:
        cur.executemany(
            """
            INSERT INTO tmp_label_cache_by_display_sig
                (display_group_ids_sig, script_types_sig, details, identity)
            VALUES (%s, %s, %s, %s);
            """,
            display_sig_rows,
        )
    if display_token_rows:
        cur.executemany(
            """
            INSERT INTO tmp_label_cache_by_display_token
                (display_group_id, details, identity)
            VALUES (%s, %s, %s);
            """,
            display_token_rows,
        )
    if display_script_rows:
        cur.executemany(
            """
            INSERT INTO tmp_label_cache_by_display_script
                (display_group_id, script_type, details, identity)
            VALUES (%s, %s, %s, %s);
            """,
            display_script_rows,
        )


def apply_cached_labels_to_ge1(cur) -> tuple[int, int, int, int, int]:
    # Pass 1: exact group_id match.
    cur.execute(
        f"""
        UPDATE {rda.TMP_DASHBOARD_GE1_TABLE} t
        SET
            details = CASE
                WHEN (t.details IS NULL OR t.details = '') AND COALESCE(l.details, '') <> '' THEN l.details
                ELSE t.details
            END,
            identity = CASE
                WHEN COALESCE(t.identity, '') = '' AND COALESCE(l.identity, '') <> '' THEN l.identity
                ELSE t.identity
            END
        FROM tmp_label_cache_by_group l
        WHERE t.group_id = l.group_id
          AND (
                ((t.details IS NULL OR t.details = '') AND COALESCE(l.details, '') <> '')
             OR (COALESCE(t.identity, '') = '' AND COALESCE(l.identity, '') <> '')
          );
        """
    )
    by_group_id = cur.rowcount

    # Pass 2: fallback exact display_group_ids match for rows where group_id changed.
    cur.execute(
        f"""
        UPDATE {rda.TMP_DASHBOARD_GE1_TABLE} t
        SET
            details = CASE
                WHEN (t.details IS NULL OR t.details = '') AND COALESCE(l.details, '') <> '' THEN l.details
                ELSE t.details
            END,
            identity = CASE
                WHEN COALESCE(t.identity, '') = '' AND COALESCE(l.identity, '') <> '' THEN l.identity
                ELSE t.identity
            END
        FROM tmp_label_cache_by_display l
        WHERE t.display_group_ids = l.display_group_ids
          AND (
                ((t.details IS NULL OR t.details = '') AND COALESCE(l.details, '') <> '')
             OR (COALESCE(t.identity, '') = '' AND COALESCE(l.identity, '') <> '')
          );
        """
    )
    by_display_ids = cur.rowcount

    # Pass 3: canonicalized display_group_ids + script_types signature match
    # (handles ordering changes like A|B vs B|A while keeping full-set semantics).
    cur.execute(
        f"""
        UPDATE {rda.TMP_DASHBOARD_GE1_TABLE} t
        SET
            details = CASE
                WHEN (t.details IS NULL OR t.details = '') AND COALESCE(l.details, '') <> '' THEN l.details
                ELSE t.details
            END,
            identity = CASE
                WHEN COALESCE(t.identity, '') = '' AND COALESCE(l.identity, '') <> '' THEN l.identity
                ELSE t.identity
            END
        FROM tmp_label_cache_by_display_sig l
        WHERE l.display_group_ids_sig = (
                SELECT COALESCE(string_agg(DISTINCT btrim(value), '|' ORDER BY btrim(value)), '')
                FROM unnest(string_to_array(COALESCE(t.display_group_ids, ''), '|')) AS value
                WHERE btrim(value) <> ''
              )
          AND l.script_types_sig = (
                SELECT COALESCE(string_agg(DISTINCT btrim(value), '|' ORDER BY btrim(value)), '')
                FROM unnest(string_to_array(COALESCE(t.script_types, ''), '|')) AS value
                WHERE btrim(value) <> ''
              )
          AND (
                ((t.details IS NULL OR t.details = '') AND COALESCE(l.details, '') <> '')
             OR (COALESCE(t.identity, '') = '' AND COALESCE(l.identity, '') <> '')
          );
        """
    )
    by_display_sig = cur.rowcount

    # Pass 4: fallback address + script token overlap
    # (handles legacy rows that only had one member of a now-merged display/script set).
    cur.execute(
        f"""
        WITH picked AS (
            SELECT DISTINCT ON (t.group_id)
                t.group_id,
                l.details,
                l.identity
            FROM {rda.TMP_DASHBOARD_GE1_TABLE} t
            JOIN LATERAL unnest(string_to_array(COALESCE(t.display_group_ids, ''), '|')) AS d(display_group_id)
              ON true
            JOIN LATERAL unnest(string_to_array(COALESCE(t.script_types, ''), '|')) AS s(script_type)
              ON true
            JOIN tmp_label_cache_by_display_script l
              ON l.display_group_id = btrim(d.display_group_id)
             AND l.script_type = btrim(s.script_type)
            WHERE (
                    ((t.details IS NULL OR t.details = '') AND COALESCE(l.details, '') <> '')
                 OR (COALESCE(t.identity, '') = '' AND COALESCE(l.identity, '') <> '')
                  )
            ORDER BY t.group_id, l.display_group_id, l.script_type
        )
        UPDATE {rda.TMP_DASHBOARD_GE1_TABLE} t
        SET
            details = CASE
                WHEN (t.details IS NULL OR t.details = '') AND COALESCE(p.details, '') <> '' THEN p.details
                ELSE t.details
            END,
            identity = CASE
                WHEN COALESCE(t.identity, '') = '' AND COALESCE(p.identity, '') <> '' THEN p.identity
                ELSE t.identity
            END
        FROM picked p
        WHERE t.group_id = p.group_id
          AND (
                ((t.details IS NULL OR t.details = '') AND COALESCE(p.details, '') <> '')
             OR (COALESCE(t.identity, '') = '' AND COALESCE(p.identity, '') <> '')
          );
        """
    )
    by_display_script = cur.rowcount

    # Pass 5: final fallback by any display_group_id token overlap.
    cur.execute(
        f"""
        WITH picked AS (
            SELECT DISTINCT ON (t.group_id)
                t.group_id,
                l.details,
                l.identity
            FROM {rda.TMP_DASHBOARD_GE1_TABLE} t
            JOIN LATERAL unnest(string_to_array(COALESCE(t.display_group_ids, ''), '|')) AS d(display_group_id)
              ON true
            JOIN tmp_label_cache_by_display_token l
              ON l.display_group_id = btrim(d.display_group_id)
            WHERE (
                    ((t.details IS NULL OR t.details = '') AND COALESCE(l.details, '') <> '')
                 OR (COALESCE(t.identity, '') = '' AND COALESCE(l.identity, '') <> '')
                  )
            ORDER BY t.group_id, l.display_group_id
        )
        UPDATE {rda.TMP_DASHBOARD_GE1_TABLE} t
        SET
            details = CASE
                WHEN (t.details IS NULL OR t.details = '') AND COALESCE(p.details, '') <> '' THEN p.details
                ELSE t.details
            END,
            identity = CASE
                WHEN COALESCE(t.identity, '') = '' AND COALESCE(p.identity, '') <> '' THEN p.identity
                ELSE t.identity
            END
        FROM picked p
        WHERE t.group_id = p.group_id
          AND (
                ((t.details IS NULL OR t.details = '') AND COALESCE(p.details, '') <> '')
             OR (COALESCE(t.identity, '') = '' AND COALESCE(p.identity, '') <> '')
          );
        """
    )
    by_display_token = cur.rowcount

    return by_group_id, by_display_ids, by_display_sig, by_display_script, by_display_token


def run_one_snapshot(
    cur,
    out_dir: Path,
    snapshot_height: int,
    partitions: list[tuple[str, int, int]],
    annotate_details: bool,
    reuse_cached_labels: bool,
) -> None:
    analysis_time = get_block_time(cur, snapshot_height)
    cutoff_height, cutoff_time = rda.get_one_year_ago_block(cur, analysis_time, snapshot_height)
    unspent_partitions = relevant_partitions(partitions, snapshot_height)

    print()
    print(f"snapshot height             : {snapshot_height:,}")
    print(f"snapshot time               : {analysis_time}")
    print(f"one-year cutoff height      : {cutoff_height:,}")
    print(f"relevant stxo partitions    : {len(unspent_partitions):,}")

    # Pass full partition list so spend-history classification can scan older
    # partitions; build_dashboard_base_historical will still filter to relevant
    # partitions for unspent-at-height row reconstruction.
    t_base_start = time.perf_counter()
    build_dashboard_base_historical(cur, snapshot_height, cutoff_height, partitions)
    print(f"base build time (s)         : {time.perf_counter() - t_base_start:.2f}")

    t_ge1_start = time.perf_counter()
    ge1_rows = rda.refresh_ge1_dashboard_table(
        cur=cur,
        analysis_height=snapshot_height,
        analysis_time=analysis_time,
        cutoff_height=cutoff_height,
        cutoff_time=cutoff_time,
    )
    print(f"ge1 refresh time (s)        : {time.perf_counter() - t_ge1_start:.2f}")

    if reuse_cached_labels:
        (
            reused_by_group,
            reused_by_display,
            reused_by_display_sig,
            reused_by_display_script,
            reused_by_display_token,
        ) = apply_cached_labels_to_ge1(cur)
        print(f"labels reused by group_id    : {reused_by_group:,}")
        print(f"labels reused by display ids : {reused_by_display:,}")
        print(f"labels reused by display sig : {reused_by_display_sig:,}")
        print(f"labels reused by id+script   : {reused_by_display_script:,}")
        print(f"labels reused by id token    : {reused_by_display_token:,}")

    miner_labeled = rda.label_miner_identity(cur)
    print(f"miner identity rows labeled  : {miner_labeled:,}")

    t_agg_start = time.perf_counter()
    agg_rows = rda.refresh_aggregates(
        cur=cur,
        analysis_height=snapshot_height,
        analysis_time=analysis_time,
        cutoff_height=cutoff_height,
        cutoff_time=cutoff_time,
    )
    print(f"aggregate refresh time (s)  : {time.perf_counter() - t_agg_start:.2f}")

    if annotate_details:
        details_rows, cache_hits, stxo_lookups = rda.populate_ge1_comments(cur, out_dir)
        print(f"details applied             : {details_rows:,}")
        print(f"history cache hits          : {cache_hits:,}")
        print(f"new STXO lookups            : {stxo_lookups:,}")

    rda.enforce_genesis_ge1_row(cur)
    t_export_start = time.perf_counter()
    rda.print_dashboard_summary(cur, snapshot_height)
    csv_ge1_rows, csv_agg_rows, csv_meta_rows, snapshot_dir = rda.export_dashboard_csvs(
        cur=cur,
        snapshot=snapshot_height,
        analysis_time=analysis_time,
        cutoff_height=cutoff_height,
        cutoff_time=cutoff_time,
        out_dir=out_dir,
    )
    print(f"export time (s)             : {time.perf_counter() - t_export_start:.2f}")
    print(f"rows in ge1 temp table      : {ge1_rows:,}")
    print(f"rows in aggregates temp     : {agg_rows:,}")
    print(f"wrote ge1 rows              : {csv_ge1_rows:,} -> {snapshot_dir / 'dashboard_pubkeys_ge_1btc.csv'}")
    print(f"wrote aggregate rows        : {csv_agg_rows:,} -> {snapshot_dir / 'dashboard_pubkeys_aggregates.csv'}")
    print(f"wrote metadata rows         : {csv_meta_rows:,}")


def run_main_pipeline_postprocess(snapshot_heights: list[int], out_dir: Path, env_file: Path) -> None:
    if not snapshot_heights:
        return

    unique_heights = sorted(set(snapshot_heights))

    out_dir_resolved = out_dir.resolve()
    default_out_dir_resolved = DEFAULT_OUT_DIR.resolve()
    if out_dir_resolved != default_out_dir_resolved:
        print(
            "Skipping main-pipeline postprocess because --out-dir is non-default: "
            f"{out_dir_resolved} (expected {default_out_dir_resolved})"
        )
        print(
            "Run clean_new_webapp_data.py, fill_identity_details.py, and generate_eco_files.py "
            "manually against your custom output directory if needed."
        )
        archived = archive_non_50k_snapshots(unique_heights, out_dir)
        if archived:
            print(f"Archived non-50k snapshots: {archived}")
        return

    env = os.environ.copy()
    env["QUANTUM_PIPELINE_ENV_FILE"] = str(env_file)
    height_args = [str(height) for height in unique_heights]

    steps = [
        [sys.executable, str(PIPELINE_DIR / "clean_new_webapp_data.py"), *height_args],
        [sys.executable, str(PIPELINE_DIR / "fill_identity_details.py"), *height_args],
    ]

    print("\nRunning main-pipeline postprocess steps for historical snapshots...")
    for cmd in steps:
        print(f"$ ({PIPELINE_DIR}) {' '.join(cmd)}")
        subprocess.run(cmd, cwd=PIPELINE_DIR, env=env, check=True)

    archived = archive_non_50k_snapshots(unique_heights, out_dir)
    if archived:
        print(f"Archived non-50k snapshots: {archived}")

    generate_cmd = [sys.executable, str(PIPELINE_DIR / "generate_eco_files.py")]
    print(f"$ ({PIPELINE_DIR}) {' '.join(generate_cmd)}")
    subprocess.run(generate_cmd, cwd=PIPELINE_DIR, env=env, check=True)


def archive_non_50k_snapshots(snapshot_heights: list[int], out_dir: Path) -> list[int]:
    archived_heights: list[int] = []
    archived_dir = out_dir / "archived"
    archived_dir.mkdir(parents=True, exist_ok=True)

    for height in sorted(set(snapshot_heights)):
        if height % KEEP_INTERVAL == 0:
            continue

        src = out_dir / str(height)
        if not src.exists() or not src.is_dir():
            continue

        dest = archived_dir / str(height)
        if dest.exists():
            shutil.rmtree(dest)

        shutil.move(str(src), str(dest))
        archived_heights.append(height)

    return archived_heights


def main() -> None:
    global SCHEMA

    parsed = parse_args()
    SCHEMA = parsed.schema

    # Ensure imported helper module targets the same schema.
    rda.SCHEMA = SCHEMA

    load_dotenv(dotenv_path=Path(parsed.env_file))
    out_dir = Path(parsed.out_dir)
    built_heights: list[int] = []

    conn = connect()
    try:
        with conn.cursor() as cur:
            rda.ensure_dashboard_tables(cur)
            all_partitions = get_stxo_partitions(cur)
            chain_max = get_chain_max_height(cur)
            requested_heights = resolve_heights(parsed, chain_max)
            heights, skipped_by_multiple, skipped_existing = apply_height_filters(
                requested_heights,
                parsed,
                out_dir,
            )
            (
                source_snapshots,
                group_label_rows,
                display_label_rows,
                display_sig_label_rows,
                display_token_label_rows,
                display_script_label_rows,
            ) = load_label_cache_from_all_snapshots(out_dir)
            prepare_label_cache(
                cur,
                group_label_rows,
                display_label_rows,
                display_sig_label_rows,
                display_token_label_rows,
                display_script_label_rows,
            )

            print(f"chain max height            : {chain_max:,}")
            print(f"stxo partitions found       : {len(all_partitions):,}")
            print(f"snapshots requested         : {len(requested_heights):,}")
            print(f"skipped by multiples filter : {skipped_by_multiple:,}")
            print(f"skipped existing snapshots  : {skipped_existing:,}")
            print(f"snapshots selected          : {len(heights):,}")
            print(f"label source snapshots      : {len(source_snapshots):,}")
            print(f"group label rows cached     : {len(group_label_rows):,}")
            print(f"display label rows cached   : {len(display_label_rows):,}")
            print(f"display sig rows cached     : {len(display_sig_label_rows):,}")
            print(f"display token rows cached   : {len(display_token_label_rows):,}")
            print(f"display+script rows cached  : {len(display_script_label_rows):,}")
            print(f"reuse cached labels enabled : {parsed.reuse_cached_labels}")

            if not heights:
                print("No snapshot heights left after filters; nothing to build.")
                return

            p2pk_added_outputs, p2pk_added_stxo, p2pk_cache_rows = populate_p2pk_pubkey_cache(
                cur,
                max(heights),
                all_partitions,
            )
            print(f"p2pk pubkeys added (outputs): {p2pk_added_outputs:,}")
            print(f"p2pk pubkeys added (stxos)  : {p2pk_added_stxo:,}")
            print(f"p2pk pubkeys cached total   : {p2pk_cache_rows:,}")

            for idx, height in enumerate(heights, start=1):
                print(f"\n[{idx}/{len(heights)}] building historical snapshot")
                run_one_snapshot(
                    cur,
                    out_dir,
                    height,
                    all_partitions,
                    annotate_details=parsed.annotate_details,
                    reuse_cached_labels=parsed.reuse_cached_labels and bool(
                        group_label_rows
                        or display_label_rows
                        or display_sig_label_rows
                        or display_token_label_rows
                        or display_script_label_rows
                    ),
                )
                conn.commit()
                built_heights.append(height)

                # Move non-50k snapshots into archived/ immediately after build.
                if height % KEEP_INTERVAL != 0:
                    src = out_dir / str(height)
                    if src.exists() and src.is_dir():
                        archived_dir = out_dir / "archived"
                        archived_dir.mkdir(parents=True, exist_ok=True)
                        dest = archived_dir / str(height)
                        if dest.exists():
                            shutil.rmtree(dest)
                        shutil.move(str(src), str(dest))
                        print(f"archived                    : {dest}")

                # Generate ECO files for this snapshot immediately
                print(f"generating ECO files for snapshot {height}...")
                eco_cmd = [sys.executable, str(PIPELINE_DIR / "generate_eco_files.py")]
                try:
                    subprocess.run(eco_cmd, cwd=PIPELINE_DIR, check=True, capture_output=True)
                    print(f"ECO files generated for snapshot {height}")
                except subprocess.CalledProcessError as e:
                    print(f"warning: ECO generation had non-zero exit: {e}")
                    print(f"stdout: {e.stdout.decode() if e.stdout else ''}")
                    print(f"stderr: {e.stderr.decode() if e.stderr else ''}")

    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    if parsed.skip_main_pipeline_postprocess:
        print("Skipping main-pipeline postprocess by request (--skip-main-pipeline-postprocess).")
        archived = archive_non_50k_snapshots(built_heights, out_dir)
        if archived:
            print(f"Archived non-50k snapshots: {archived}")
    else:
        run_main_pipeline_postprocess(
            snapshot_heights=built_heights,
            out_dir=out_dir,
            env_file=Path(parsed.env_file),
        )


if __name__ == "__main__":
    main()
