#!/usr/bin/env python3
"""Build dashboard analysis tables and export dashboard CSVs."""

import argparse
import csv
import hashlib
import os
import re
from pathlib import Path
from typing import Callable, Sequence

import psycopg2
from dotenv import load_dotenv
from pipeline_paths import QUANTUM_DIR, resolve_env_file

SCHEMA = "public"
FREEZE_NAME = "exposure_analysis"

ACTIVE_TABLES = [
    "active_key_outputs",
    "active_p2sh_outputs",
    "active_p2wsh_outputs",
    "active_p2tr_outputs",
    "active_bare_ms_outputs",
]

DASHBOARD_GE1_TABLE = "dashboard_pubkeys_ge_1btc"
DASHBOARD_AGGREGATES_TABLE = "dashboard_pubkeys_aggregates"
TMP_DASHBOARD_GE1_TABLE = "tmp_dashboard_pubkeys_ge_1btc"
TMP_DASHBOARD_AGGREGATES_TABLE = "tmp_dashboard_pubkeys_aggregates"
GENESIS_PUBKEY_KEYHASH20_HEX = "62e907b15cbf27d5425399ebf6f0fb50ebb88f18"
GENESIS_FIRST_EXPOSED_BLOCKHEIGHT = 0
GENESIS_FIRST_EXPOSED_TIME = 1231006505
GENESIS_IDENTITY = "Patoshi"
GENESIS_BLOCK_REWARD_SATS = 5_000_000_000
P2PK_PUBKEY_CACHE_TABLE = "dashboard_p2pk_pubkey_cache"
BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
KEYHASH20_HEX_RE = re.compile(r"^[0-9a-fA-F]{40}$")
DEFAULT_ENV_FILE = resolve_env_file()
DEFAULT_OUT_DIR = QUANTUM_DIR / "webapp_data"

# ---------------------------------------------------------------------------
# Bech32 helpers (P2WPKH / witness v0, mainnet "bc" HRP)
# Reference: BIP-0173 / https://github.com/sipa/bech32
# ---------------------------------------------------------------------------
_BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"


def _bech32_polymod(values):
    GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
    chk = 1
    for v in values:
        b = chk >> 25
        chk = (chk & 0x1FFFFFF) << 5 ^ v
        for i in range(5):
            chk ^= GEN[i] if ((b >> i) & 1) else 0
    return chk


def _bech32_hrp_expand(hrp):
    return [ord(x) >> 5 for x in hrp] + [0] + [ord(x) & 31 for x in hrp]


def _bech32_create_checksum(hrp, data):
    values = _bech32_hrp_expand(hrp) + list(data)
    polymod = _bech32_polymod(values + [0, 0, 0, 0, 0, 0]) ^ 1
    return [(polymod >> 5 * (5 - i)) & 31 for i in range(6)]


def _convertbits(data, frombits, tobits, pad=True):
    acc = 0
    bits = 0
    ret = []
    maxv = (1 << tobits) - 1
    max_acc = (1 << (frombits + tobits - 1)) - 1
    for value in data:
        acc = ((acc << frombits) | value) & max_acc
        bits += frombits
        while bits >= tobits:
            bits -= tobits
            ret.append((acc >> bits) & maxv)
    if pad and bits:
        ret.append((acc << (tobits - bits)) & maxv)
    return ret


def keyhash20_to_p2wpkh_bech32(keyhash20_hex: str, hrp: str = "bc") -> str:
    """Encode a 20-byte keyhash as a bech32 P2WPKH address (witness version 0)."""
    witprog = bytes.fromhex(keyhash20_hex.lower())
    data = _convertbits(witprog, 8, 5)
    combined = [0] + data + _bech32_create_checksum(hrp, [0] + data)
    return hrp + "1" + "".join(_BECH32_CHARSET[d] for d in combined)


def _fix_ge1_display_group_ids(headers: list, row: tuple) -> tuple:
    """Replace a raw keyhash20 hex in display_group_ids with the proper bech32 address for P2WPKH rows."""
    display_idx = headers.index("display_group_ids")
    script_idx = headers.index("script_types")
    row = list(row)
    display = row[display_idx]
    if (
        row[script_idx] == "P2WPKH"
        and isinstance(display, str)
        and KEYHASH20_HEX_RE.match(display)
    ):
        row[display_idx] = keyhash20_to_p2wpkh_bech32(display)
    return tuple(row)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
    )
    parser.add_argument(
        "--schema",
        default=SCHEMA,
        help="PostgreSQL schema containing dashboard tables (default: public)",
    )
    parser.add_argument(
        "--out-dir",
        default=str(DEFAULT_OUT_DIR),
        help="Output directory for CSV files (default: webapps/quantum_exposure/webapp_data)",
    )
    parser.add_argument(
        "--env-file",
        default=str(DEFAULT_ENV_FILE),
        help="Path to .env file with DB credentials",
    )
    parser.add_argument(
        "--snapshot-height",
        type=int,
        default=None,
        help="Block height of existing snapshot to update comments/details for (skips expensive build steps)",
    )
    parser.add_argument(
        "--upgrade-multisig",
        action="store_true",
        default=False,
        help=(
            "(Requires --snapshot-height) Re-scan wrapped rows where details is "
            "multisig/None/empty and try to resolve the m-of-n threshold"
        ),
    )
    parser.add_argument(
        "--redo-all-rows",
        action="store_true",
        default=False,
        help=(
            "(Optional with --snapshot-height) Re-run classification for all wrapped rows, "
            "including rows currently labeled None"
        ),
    )
    parser.add_argument(
        "--backfill-times-only",
        action="store_true",
        default=False,
        help=(
            "(Requires --snapshot-height) Backfill first_exposed_time and last_spend_time "
            "from blockheight columns, then export and exit"
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


def fetch_one(cur, sql: str, params=None):
    cur.execute(sql, params or ())
    return cur.fetchone()


def ensure_dashboard_tables(cur):
    # Build dashboard outputs in temp tables only; nothing persists in PostgreSQL.
    cur.execute(f"DROP TABLE IF EXISTS {TMP_DASHBOARD_GE1_TABLE};")
    cur.execute(f"DROP TABLE IF EXISTS {TMP_DASHBOARD_AGGREGATES_TABLE};")

    cur.execute(
        f"""
        CREATE TEMP TABLE {TMP_DASHBOARD_GE1_TABLE} (
            group_id                          TEXT    NOT NULL,
            display_group_ids                 TEXT    NOT NULL,
            script_types                      TEXT    NOT NULL,
            exposed_supply_sats_by_script_type TEXT,
            spend_activity                    TEXT    NOT NULL,
            exposed_utxo_count                BIGINT  NOT NULL,
            exposed_supply_sats               BIGINT  NOT NULL,
            first_exposed_blockheight         BIGINT,
            first_exposed_time                BIGINT,
            last_spend_blockheight            BIGINT,
            last_spend_time                   BIGINT,
            details                           TEXT,
            identity                          TEXT,
            created_at                        TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (group_id)
        );
        """
    )
    cur.execute(
        f"""
        CREATE INDEX {TMP_DASHBOARD_GE1_TABLE}_filters_idx
        ON {TMP_DASHBOARD_GE1_TABLE} (spend_activity, exposed_supply_sats);
        """
    )

    cur.execute(
        f"""
        CREATE TEMP TABLE {TMP_DASHBOARD_AGGREGATES_TABLE} (
            balance_filter             TEXT    NOT NULL,
            script_type_filter         TEXT    NOT NULL,
            spend_activity_filter      TEXT    NOT NULL,
            pubkey_count               BIGINT  NOT NULL,
            utxo_count                 BIGINT  NOT NULL,
            supply_sats                BIGINT  NOT NULL,
            exposed_pubkey_count       BIGINT  NOT NULL,
            exposed_utxo_count         BIGINT  NOT NULL,
            exposed_supply_sats        BIGINT  NOT NULL,
            estimated_migration_blocks NUMERIC(20,2) NOT NULL DEFAULT 0.00,
            created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (balance_filter, script_type_filter, spend_activity_filter)
        );
        """
    )
    cur.execute(
        f"""
        CREATE INDEX {TMP_DASHBOARD_AGGREGATES_TABLE}_filters_idx
        ON {TMP_DASHBOARD_AGGREGATES_TABLE} (balance_filter, script_type_filter, spend_activity_filter);
        """
    )


def load_ge1_csv_into_temp_table(cur, csv_path: Path):
    """Load an existing dashboard_pubkeys_ge_1btc.csv into the temp table, handling old CSV format."""
    if not csv_path.exists():
        raise FileNotFoundError(f"CSV file not found: {csv_path}")

    with csv_path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            raise ValueError(f"CSV has no headers: {csv_path}")

        rows = list(reader)

    # Normalize rows to new format, handling both old and new CSV structures
    normalized_rows = []
    seen_group_ids = set()
    
    for row in rows:
        group_id = row.get("group_id", "")
        
        # Skip duplicates (keep only first occurrence)
        if group_id in seen_group_ids:
            continue
        seen_group_ids.add(group_id)
        
        normalized = {}
        
        # Map required columns (with fallbacks for old format)
        normalized["group_id"] = group_id
        normalized["display_group_ids"] = row.get("display_group_ids") or row.get("display_group_id", "")
        normalized["script_types"] = row.get("script_types") or row.get("script_type", "")
        normalized["exposed_supply_sats_by_script_type"] = row.get("exposed_supply_sats_by_script_type") or ""
        normalized["spend_activity"] = row.get("spend_activity", "")
        normalized["exposed_utxo_count"] = row.get("exposed_utxo_count", 0)
        normalized["exposed_supply_sats"] = row.get("exposed_supply_sats", 0)
        normalized["first_exposed_blockheight"] = row.get("first_exposed_blockheight") or None
        normalized["first_exposed_time"] = row.get("first_exposed_time") or None
        normalized["last_spend_blockheight"] = row.get("last_spend_blockheight") or None
        normalized["last_spend_time"] = row.get("last_spend_time") or None
        
        # Map old "comments" to new "details", or use empty string if neither exists
        if "details" in row:
            normalized["details"] = row["details"] or ""
        elif "comments" in row:
            normalized["details"] = row["comments"] or ""
        else:
            normalized["details"] = ""
        
        # Add identity column (new, always empty initially)
        normalized["identity"] = row.get("identity", "")
        
        normalized_rows.append(normalized)

    # Insert into temp table
    cur.execute(f"TRUNCATE TABLE {TMP_DASHBOARD_GE1_TABLE};")

    if not normalized_rows:
        return 0

    # Build insert statement with all columns in the correct order
    columns = ["group_id", "display_group_ids", "script_types", "exposed_supply_sats_by_script_type", "spend_activity", 
               "exposed_utxo_count", "exposed_supply_sats", "first_exposed_blockheight",
               "first_exposed_time", "last_spend_blockheight", "last_spend_time",
               "details", "identity"]
    
    placeholders = ", ".join(["%s"] * len(columns))
    column_names = ", ".join(columns)

    insert_sql = f"""
        INSERT INTO {TMP_DASHBOARD_GE1_TABLE} ({column_names})
        VALUES ({placeholders})
    """

    data = []
    for row in normalized_rows:
        data.append(tuple(row.get(col) for col in columns))

    cur.executemany(insert_sql, data)
    return len(normalized_rows)


def get_freeze_height_and_time(cur):
    row = fetch_one(
        cur,
        f"""
        SELECT af.freeze_blockheight, bh.time
        FROM {qualify(SCHEMA, "analysis_freeze")} af
        JOIN {qualify(SCHEMA, "blockheader")} bh
          ON bh.blockheight = af.freeze_blockheight
        WHERE af.name = %s
        """,
        (FREEZE_NAME,),
    )
    if row is None:
        raise RuntimeError(f"No analysis_freeze row found for {FREEZE_NAME!r}")
    return int(row[0]), int(row[1])


def validate_active_tables_at_same_height(cur, analysis_height: int):
    for table_name in ACTIVE_TABLES:
        row = fetch_one(
            cur,
            f"""
            SELECT freeze_blockheight
            FROM {qualify(SCHEMA, "analysis_freeze")}
            WHERE name = %s
            """,
            (table_name,),
        )
        if row is None:
            raise RuntimeError(f"No analysis_freeze row found for {table_name!r}")
        table_height = int(row[0])
        if table_height != analysis_height:
            raise RuntimeError(
                f"{table_name} is at {table_height}, but {FREEZE_NAME} is at {analysis_height}. "
                "Update all active tables to the same freeze height before dashboard build."
            )


def get_one_year_ago_block(cur, analysis_time: int, analysis_height: int):
    row = fetch_one(
        cur,
        f"""
        WITH target AS (
            SELECT (to_timestamp(%s) - interval '1 year') AS target_time
        )
        SELECT bh.blockheight, bh.time
        FROM {qualify(SCHEMA, "blockheader")} bh
        CROSS JOIN target t
        WHERE bh.blockheight <= %s
        ORDER BY ABS(EXTRACT(EPOCH FROM (to_timestamp(bh.time) - t.target_time)))
        LIMIT 1
        """,
        (analysis_time, analysis_height),
    )
    if row is None:
        raise RuntimeError("Could not determine block height closest to one year ago.")
    return int(row[0]), int(row[1])


def get_latest_stxo_archive_table(cur) -> str:
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

    latest_name = None
    latest_range_hi = -1
    for (table_name,) in cur.fetchall():
        match = re.match(r"^stxos_(\d+)_(\d+)_archive$", table_name)
        if not match:
            continue
        range_hi = int(match.group(2))
        if range_hi > latest_range_hi:
            latest_range_hi = range_hi
            latest_name = table_name

    if latest_name is None:
        raise RuntimeError("No stxos_*_archive tables found in schema.")

    return latest_name


def get_stxo_archive_tables(cur) -> list[str]:
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

    table_names: list[str] = []
    for (table_name,) in cur.fetchall():
        match = re.match(r"^stxos_(\d+)_(\d+)_archive$", table_name)
        if not match:
            continue
        table_names.append(table_name)

    if not table_names:
        raise RuntimeError("No stxos_*_archive tables found in schema.")

    return table_names


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
        """
    )


def prepare_missing_active_p2pk_cache_keys(cur, analysis_height: int) -> int:
    ensure_p2pk_pubkey_cache(cur)
    cur.execute("DROP TABLE IF EXISTS tmp_active_missing_p2pk_keys;")
    cur.execute(
        f"""
        CREATE TEMP TABLE tmp_active_missing_p2pk_keys ON COMMIT DROP AS
        SELECT DISTINCT k.keyhash20
        FROM {qualify(SCHEMA, 'active_key_outputs')} k
        LEFT JOIN {qualify(SCHEMA, P2PK_PUBKEY_CACHE_TABLE)} c
          ON c.keyhash20 = k.keyhash20
        WHERE k.script_type = 'pubkey'
          AND k.keyhash20 IS NOT NULL
          AND k.blockheight <= %s
          AND c.keyhash20 IS NULL;
        """,
        (analysis_height,),
    )
    cur.execute("ALTER TABLE tmp_active_missing_p2pk_keys ADD PRIMARY KEY (keyhash20);")
    cur.execute("SELECT COUNT(*) FROM tmp_active_missing_p2pk_keys;")
    row = cur.fetchone()
    return int(row[0]) if row and row[0] is not None else 0


def _populate_p2pk_cache_from_outputs_for_missing(cur, analysis_height: int) -> int:
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
        FROM {qualify(SCHEMA, 'active_key_outputs')} k
        JOIN tmp_active_missing_p2pk_keys m
          ON m.keyhash20 = k.keyhash20
        JOIN {qualify(SCHEMA, 'outputs')} src
          ON src.blockheight = k.blockheight
         AND src.transactionid = k.transactionid
         AND src.vout = k.vout
         AND src.scripttype = 'pubkey'
        CROSS JOIN LATERAL (
            SELECT {pubkey_expr} AS pubkey_hex
        ) p
        WHERE k.script_type = 'pubkey'
          AND k.blockheight <= %s
          AND p.pubkey_hex IS NOT NULL
        GROUP BY k.keyhash20, p.pubkey_hex
        ON CONFLICT (keyhash20) DO NOTHING;
        """,
        (analysis_height,),
    )
    return cur.rowcount


def _populate_p2pk_cache_from_stxos_for_missing(
    cur,
    analysis_height: int,
    stxo_archive_tables: Sequence[str],
) -> int:
    total_inserted = 0
    for table_name in stxo_archive_tables:
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
            FROM {qualify(SCHEMA, 'active_key_outputs')} k
            JOIN tmp_active_missing_p2pk_keys m
              ON m.keyhash20 = k.keyhash20
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
            (table_name, analysis_height),
        )
        total_inserted += cur.rowcount
    return total_inserted


def populate_p2pk_pubkey_cache_for_active(
    cur,
    analysis_height: int,
    stxo_archive_tables: Sequence[str],
) -> tuple[int, int, int, int]:
    missing_before = prepare_missing_active_p2pk_cache_keys(cur, analysis_height)
    if missing_before == 0:
        cur.execute(f"SELECT COUNT(*) FROM {qualify(SCHEMA, P2PK_PUBKEY_CACHE_TABLE)};")
        row = cur.fetchone()
        total_cached = int(row[0]) if row and row[0] is not None else 0
        return 0, 0, total_cached, 0

    inserted_from_outputs = _populate_p2pk_cache_from_outputs_for_missing(cur, analysis_height)
    inserted_from_stxos = _populate_p2pk_cache_from_stxos_for_missing(cur, analysis_height, stxo_archive_tables)

    cur.execute(
        f"""
        SELECT COUNT(*)
        FROM tmp_active_missing_p2pk_keys m
        LEFT JOIN {qualify(SCHEMA, P2PK_PUBKEY_CACHE_TABLE)} c
          ON c.keyhash20 = m.keyhash20
        WHERE c.keyhash20 IS NULL;
        """
    )
    unresolved_row = cur.fetchone()
    unresolved = int(unresolved_row[0]) if unresolved_row and unresolved_row[0] is not None else 0

    cur.execute(f"SELECT COUNT(*) FROM {qualify(SCHEMA, P2PK_PUBKEY_CACHE_TABLE)};")
    total_row = cur.fetchone()
    total_cached = int(total_row[0]) if total_row and total_row[0] is not None else 0

    return inserted_from_outputs, inserted_from_stxos, total_cached, unresolved


def build_dashboard_base(cur, analysis_height: int, cutoff_height: int, latest_stxo_archive_table: str):
    latest_stxo_qname = qualify(SCHEMA, latest_stxo_archive_table)
    cur.execute("DROP TABLE IF EXISTS tmp_dashboard_pubkey_base;")
    cur.execute(
        f"""
        CREATE TEMP TABLE tmp_dashboard_pubkey_base ON COMMIT DROP AS
        WITH all_rows AS (
            SELECT
                encode(k.keyhash20, 'hex') AS group_id,
                CASE
                    WHEN k.script_type = 'pubkey'
                     AND p2pk.pubkey_hex IS NOT NULL
                    THEN p2pk.pubkey_hex
                    WHEN k.script_type = 'pubkey'
                     AND src.scripthex ~ '^[0-9a-f]+$'
                     AND (
                        (substr(src.scripthex, 1, 2) = '21' AND right(src.scripthex, 2) = 'ac' AND length(src.scripthex) = 70)
                        OR
                        (substr(src.scripthex, 1, 2) = '41' AND right(src.scripthex, 2) = 'ac' AND length(src.scripthex) = 134)
                     )
                    THEN CASE
                        WHEN substr(src.scripthex, 1, 2) = '21' THEN substr(src.scripthex, 3, 66)
                        WHEN substr(src.scripthex, 1, 2) = '41' THEN substr(src.scripthex, 3, 130)
                        ELSE encode(k.keyhash20, 'hex')
                    END
                    ELSE COALESCE(NULLIF(k.address, ''), NULLIF(src.address, ''), encode(k.keyhash20, 'hex'))
                END AS display_group_id,
                CASE k.script_type
                    WHEN 'pubkey' THEN 'P2PK'
                    WHEN 'pubkeyhash' THEN 'P2PKH'
                    WHEN 'witness_v0_keyhash' THEN 'P2WPKH'
                    ELSE 'Other'
                END AS script_type,
                k.amount::bigint AS amount,
                k.blockheight,
                (k.spendingblock IS NOT NULL AND k.spendingblock <= %s) AS isspent,
                k.spendingblock,
                CASE
                    WHEN k.blockheight = 0
                     AND k.script_type = 'pubkey'
                     AND encode(k.keyhash20, 'hex') = %s
                    THEN false
                    WHEN k.script_type IN ('pubkey', 'pubkeyhash', 'witness_v0_keyhash') THEN COALESCE(k.is_exposed, false)
                    ELSE false
                END AS is_exposed
            FROM {qualify(SCHEMA, 'active_key_outputs')} k
                        LEFT JOIN {qualify(SCHEMA, P2PK_PUBKEY_CACHE_TABLE)} p2pk
                            ON p2pk.keyhash20 = k.keyhash20
                         AND k.script_type = 'pubkey'
            LEFT JOIN {qualify(SCHEMA, 'outputs')} src
              ON src.blockheight = k.blockheight
             AND src.transactionid = k.transactionid
             AND src.vout = k.vout
                         AND k.script_type = 'pubkey'

            UNION ALL

            SELECT
                p.address AS group_id,
                p.address AS display_group_id,
                'P2SH'::text AS script_type,
                p.amount::bigint AS amount,
                p.blockheight,
                (p.spendingblock IS NOT NULL AND p.spendingblock <= %s) AS isspent,
                p.spendingblock,
                COALESCE(p.is_exposed, false) AS is_exposed
            FROM {qualify(SCHEMA, 'active_p2sh_outputs')} p

            UNION ALL

            SELECT
                w.address AS group_id,
                w.address AS display_group_id,
                'P2WSH'::text AS script_type,
                w.amount::bigint AS amount,
                w.blockheight,
                (w.spendingblock IS NOT NULL AND w.spendingblock <= %s) AS isspent,
                w.spendingblock,
                COALESCE(w.is_exposed, false) AS is_exposed
            FROM {qualify(SCHEMA, 'active_p2wsh_outputs')} w

            UNION ALL

            SELECT
                t.address AS group_id,
                t.address AS display_group_id,
                'P2TR'::text AS script_type,
                t.amount::bigint AS amount,
                t.blockheight,
                (t.spendingblock IS NOT NULL AND t.spendingblock <= %s) AS isspent,
                t.spendingblock,
                true AS is_exposed
            FROM {qualify(SCHEMA, 'active_p2tr_outputs')} t

            UNION ALL

            SELECT
                COALESCE(NULLIF(b.address, ''), 'out:' || b.transactionid || ':' || b.vout::text) AS group_id,
                COALESCE(NULLIF(b.address, ''), 'out:' || b.transactionid || ':' || b.vout::text) AS display_group_id,
                'Other'::text AS script_type,
                b.amount::bigint AS amount,
                b.blockheight,
                (b.spendingblock IS NOT NULL AND b.spendingblock <= %s) AS isspent,
                b.spendingblock,
                true AS is_exposed
            FROM {qualify(SCHEMA, 'active_bare_ms_outputs')} b

                        UNION ALL

                        SELECT
                                COALESCE(NULLIF(o.address, ''), 'out:' || o.transactionid || ':' || o.vout::text) AS group_id,
                COALESCE(NULLIF(o.address, ''), 'out:' || o.transactionid || ':' || o.vout::text) AS display_group_id,
                                'Other'::text AS script_type,
                                o.amount::bigint AS amount,
                                o.blockheight,
                                false AS isspent,
                                NULL::bigint AS spendingblock,
                                false AS is_exposed
                        FROM {qualify(SCHEMA, 'outputs')} o
                        WHERE o.blockheight <= %s
                            AND o.isspent = false
                            AND o.scripttype IS NOT NULL
                            AND o.scripttype NOT IN (
                                        'pubkey',
                                        'pubkeyhash',
                                        'witness_v0_keyhash',
                                        'scripthash',
                                        'witness_v0_scripthash',
                                        'witness_v1_taproot'
                            )
                            AND o.scripttype NOT LIKE 'Multisig %%'

                        UNION ALL

                        SELECT
                                COALESCE(NULLIF(s.address, ''), 'stxo:' || s.transactionid || ':' || s.vout::text) AS group_id,
                COALESCE(NULLIF(s.address, ''), 'stxo:' || s.transactionid || ':' || s.vout::text) AS display_group_id,
                                'Other'::text AS script_type,
                                s.amount::bigint AS amount,
                                s.blockheight,
                                false AS isspent,
                                NULL::bigint AS spendingblock,
                                false AS is_exposed
                        FROM {latest_stxo_qname} s
                        WHERE s.blockheight <= %s
                            AND s.spendingblock > %s
                            AND s.scripttype IS NOT NULL
                            AND s.scripttype NOT IN (
                                        'pubkey',
                                        'pubkeyhash',
                                        'witness_v0_keyhash',
                                        'scripthash',
                                        'witness_v0_scripthash',
                                        'witness_v1_taproot'
                            )
                            AND s.scripttype NOT LIKE 'Multisig %%'
        ),
        grouped AS (
            SELECT
                r.group_id,
                MIN(r.display_group_id) AS display_group_id,
                r.script_type,
                COUNT(*) FILTER (WHERE r.isspent = false)::bigint AS current_utxo_count,
                COALESCE(SUM(r.amount) FILTER (WHERE r.isspent = false), 0)::bigint AS current_supply_sats,
                COUNT(*) FILTER (WHERE r.isspent = false AND r.is_exposed)::bigint AS exposed_utxo_count,
                COALESCE(SUM(r.amount) FILTER (WHERE r.isspent = false AND r.is_exposed), 0)::bigint AS exposed_supply_sats,
                MIN(r.blockheight) FILTER (WHERE r.is_exposed)::bigint AS first_exposed_blockheight,
                MAX(r.spendingblock) FILTER (WHERE r.spendingblock IS NOT NULL)::bigint AS last_spend_blockheight
            FROM all_rows r
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
            g.first_exposed_blockheight,
            CASE
                WHEN g.exposed_supply_sats > 0 OR g.exposed_utxo_count > 0 THEN 1::bigint
                ELSE 0::bigint
            END AS exposed_pubkey_count,
            g.last_spend_blockheight,
            CASE
                WHEN g.last_spend_blockheight IS NULL THEN 'never_spent'
                WHEN g.last_spend_blockheight <= %s THEN 'inactive'
                ELSE 'active'
            END AS spend_activity
        FROM grouped g
        WHERE g.current_supply_sats > 0;
        """,
        (
            analysis_height,
            GENESIS_PUBKEY_KEYHASH20_HEX,
            analysis_height,
            analysis_height,
            analysis_height,
            analysis_height,
            analysis_height,
            analysis_height,
            analysis_height,
            cutoff_height,
        ),
    )
    cur.execute("ANALYZE tmp_dashboard_pubkey_base;")


def refresh_ge1_dashboard_table(cur, analysis_height: int, analysis_time: int, cutoff_height: int, cutoff_time: int):
    cur.execute(f"TRUNCATE TABLE {TMP_DASHBOARD_GE1_TABLE};")
    cur.execute(
        f"""
        INSERT INTO {TMP_DASHBOARD_GE1_TABLE} (
            group_id,
            display_group_ids,
            script_types,
            exposed_supply_sats_by_script_type,
            spend_activity,
            exposed_utxo_count,
            exposed_supply_sats,
            first_exposed_blockheight,
            first_exposed_time,
            last_spend_blockheight,
            last_spend_time
        )
        WITH grouped AS (
            SELECT
                b.group_id,
                string_agg(DISTINCT b.display_group_id, '|' ORDER BY b.display_group_id) AS display_group_ids,
                string_agg(DISTINCT b.script_type,      '|' ORDER BY b.script_type)      AS script_types,
                CASE
                    WHEN bool_or(b.spend_activity = 'active')   THEN 'active'
                    WHEN bool_or(b.spend_activity = 'inactive') THEN 'inactive'
                    ELSE 'never_spent'
                END AS spend_activity,
                SUM(b.exposed_utxo_count)::bigint  AS exposed_utxo_count,
                SUM(b.exposed_supply_sats)::bigint AS exposed_supply_sats,
                MIN(b.first_exposed_blockheight)::bigint AS first_exposed_blockheight,
                MAX(b.last_spend_blockheight)::bigint    AS last_spend_blockheight,
                json_object_agg(b.script_type, b.exposed_supply_sats)::text AS exposed_supply_sats_by_script_type
            FROM tmp_dashboard_pubkey_base b
            GROUP BY b.group_id
            HAVING SUM(b.current_supply_sats) >= 100000000
               AND SUM(b.exposed_supply_sats) > 0
        )
        SELECT
            g.group_id,
            g.display_group_ids,
            g.script_types,
            g.exposed_supply_sats_by_script_type,
            g.spend_activity,
            g.exposed_utxo_count,
            g.exposed_supply_sats,
            g.first_exposed_blockheight,
            fe.time::bigint AS first_exposed_time,
            g.last_spend_blockheight,
            ls.time::bigint AS last_spend_time
        FROM grouped g
        LEFT JOIN {qualify(SCHEMA, 'blockheader')} fe
          ON fe.blockheight = g.first_exposed_blockheight
        LEFT JOIN {qualify(SCHEMA, 'blockheader')} ls
          ON ls.blockheight = g.last_spend_blockheight;
        """
    )
    return cur.rowcount


def backfill_ge1_time_columns(cur) -> tuple[int, int]:
        cur.execute(
                f"""
                UPDATE {TMP_DASHBOARD_GE1_TABLE} t
                SET first_exposed_time = bh.time
                FROM {qualify(SCHEMA, 'blockheader')} bh
                WHERE t.first_exposed_blockheight IS NOT NULL
                    AND bh.blockheight = t.first_exposed_blockheight
                    AND (t.first_exposed_time IS NULL OR t.first_exposed_time = 0);
                """
        )
        first_updated = cur.rowcount

        cur.execute(
                f"""
                UPDATE {TMP_DASHBOARD_GE1_TABLE} t
                SET last_spend_time = bh.time
                FROM {qualify(SCHEMA, 'blockheader')} bh
                WHERE t.last_spend_blockheight IS NOT NULL
                    AND bh.blockheight = t.last_spend_blockheight
                    AND (t.last_spend_time IS NULL OR t.last_spend_time = 0);
                """
        )
        last_updated = cur.rowcount

        return first_updated, last_updated


def enforce_genesis_ge1_row(cur) -> int:
    """Force canonical genesis metadata on the GE1 row before exports."""
    cur.execute(
        f"""
        UPDATE {TMP_DASHBOARD_GE1_TABLE}
        SET
            first_exposed_blockheight = %s,
            first_exposed_time = %s,
            identity = %s
        WHERE group_id = %s
        """,
        (
            GENESIS_FIRST_EXPOSED_BLOCKHEIGHT,
            GENESIS_FIRST_EXPOSED_TIME,
            GENESIS_IDENTITY,
            GENESIS_PUBKEY_KEYHASH20_HEX,
        ),
    )
    return cur.rowcount


def split_pipe_values(value: str) -> list[str]:
    if not value:
        return []
    return [part.strip() for part in value.split("|") if part and part.strip()]


def _base58check_encode(payload: bytes) -> str:
    checksum = hashlib.sha256(hashlib.sha256(payload).digest()).digest()[:4]
    data = payload + checksum
    num = int.from_bytes(data, "big")

    encoded = ""
    while num > 0:
        num, rem = divmod(num, 58)
        encoded = BASE58_ALPHABET[rem] + encoded

    leading_zeros = 0
    for value in data:
        if value == 0:
            leading_zeros += 1
        else:
            break

    return ("1" * leading_zeros) + (encoded or "1")


def keyhash20_hex_to_p2pkh_address(keyhash20_hex: str) -> str:
    payload = b"\x00" + bytes.fromhex(keyhash20_hex)
    return _base58check_encode(payload)


def normalize_p2pkh_display_ids(cur) -> int:
    """Replace keyhash20 hex tokens in P2PKH display_group_ids with Base58 P2PKH addresses."""
    cur.execute(
        f"""
        SELECT group_id, display_group_ids
        FROM {TMP_DASHBOARD_GE1_TABLE}
        WHERE script_types = 'P2PKH'
           OR script_types LIKE 'P2PKH|%'
           OR script_types LIKE '%|P2PKH'
           OR script_types LIKE '%|P2PKH|%';
        """
    )
    rows = cur.fetchall()

    updates: list[tuple[str, str]] = []
    for group_id, display_group_ids in rows:
        group_id_value = (group_id or "").strip()
        original_display = display_group_ids or ""
        tokens = split_pipe_values(original_display)
        if not tokens and KEYHASH20_HEX_RE.fullmatch(group_id_value):
            tokens = [group_id_value]

        changed = False
        converted_tokens: list[str] = []
        for token in tokens:
            value = token.strip()
            if KEYHASH20_HEX_RE.fullmatch(value):
                value = keyhash20_hex_to_p2pkh_address(value.lower())
                changed = True
            converted_tokens.append(value)

        if not changed:
            continue

        deduped_tokens: list[str] = []
        seen_tokens: set[str] = set()
        for token in converted_tokens:
            if token in seen_tokens:
                continue
            seen_tokens.add(token)
            deduped_tokens.append(token)

        new_display = "|".join(deduped_tokens)
        if new_display and new_display != original_display:
            updates.append((new_display, group_id_value))

    if not updates:
        return 0

    cur.executemany(
        f"""
        UPDATE {TMP_DASHBOARD_GE1_TABLE}
        SET display_group_ids = %s
        WHERE group_id = %s
        """,
        updates,
    )
    return len(updates)


def _canonical_pipe_signature(value: str) -> str:
    parts = split_pipe_values(value)
    if not parts:
        return ""
    return "|".join(sorted(set(parts), key=lambda item: (item.lower(), item)))


def _normalize_multisig_details_label(value: str) -> str:
    text = (value or "").strip()
    return "None" if text.lower() == "multisig" else text


def _load_label_caches_from_csv(csv_path: Path):
    group_cache: dict[str, tuple[str, str]] = {}
    display_exact_cache: dict[str, tuple[str, str]] = {}
    display_sig_cache: dict[tuple[str, str], tuple[str, str]] = {}
    display_script_cache: dict[tuple[str, str], tuple[str, str]] = {}
    display_token_cache: dict[str, tuple[str, str]] = {}

    if not csv_path.exists():
        return group_cache, display_exact_cache, display_sig_cache, display_script_cache, display_token_cache

    with csv_path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            details = _normalize_multisig_details_label(
                (row.get("details") or row.get("comments") or "")
            )
            identity = (row.get("identity") or "").strip()
            if not details and not identity:
                continue

            group_id = (row.get("group_id") or "").strip()
            display_group_ids = (row.get("display_group_ids") or row.get("display_group_id") or "").strip()
            script_types = (row.get("script_types") or row.get("script_type") or "").strip()

            if group_id and group_id not in group_cache:
                group_cache[group_id] = (details, identity)

            if display_group_ids and display_group_ids not in display_exact_cache:
                display_exact_cache[display_group_ids] = (details, identity)

            display_sig = _canonical_pipe_signature(display_group_ids)
            script_sig = _canonical_pipe_signature(script_types)
            if display_sig and (display_sig, script_sig) not in display_sig_cache:
                display_sig_cache[(display_sig, script_sig)] = (details, identity)

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

    return group_cache, display_exact_cache, display_sig_cache, display_script_cache, display_token_cache


def carry_forward_labels_from_existing_snapshot(cur, csv_path: Path) -> dict[str, int]:
    """Carry details/identity from an existing snapshot CSV into the rebuilt temp table.

    Matching priority:
    1) group_id exact
    2) display_group_ids exact
    3) canonicalized display_group_ids + script_types signature
    4) any display_group_id + script_type token overlap
    5) any display_group_id token overlap
    """
    (
        group_cache,
        display_exact_cache,
        display_sig_cache,
        display_script_cache,
        display_token_cache,
    ) = _load_label_caches_from_csv(csv_path)

    if not (group_cache or display_exact_cache or display_sig_cache or display_script_cache or display_token_cache):
        return {
            "group": 0,
            "display_exact": 0,
            "display_sig": 0,
            "display_script": 0,
            "display_token": 0,
            "total": 0,
        }

    cur.execute(
        f"""
        SELECT group_id, display_group_ids, script_types, COALESCE(details, ''), COALESCE(identity, '')
        FROM {TMP_DASHBOARD_GE1_TABLE}
        """
    )
    rows = cur.fetchall()

    updates: list[tuple[str, str, str]] = []
    counts = {
        "group": 0,
        "display_exact": 0,
        "display_sig": 0,
        "display_script": 0,
        "display_token": 0,
    }

    for group_id, display_group_ids, script_types, details, identity in rows:
        has_details = bool((details or "").strip())
        has_identity = bool((identity or "").strip())
        if has_details and has_identity:
            continue

        label = None
        pass_name = None

        if group_id and group_id in group_cache:
            label = group_cache[group_id]
            pass_name = "group"

        if label is None and display_group_ids and display_group_ids in display_exact_cache:
            label = display_exact_cache[display_group_ids]
            pass_name = "display_exact"

        if label is None:
            display_sig = _canonical_pipe_signature(display_group_ids or "")
            script_sig = _canonical_pipe_signature(script_types or "")
            key = (display_sig, script_sig)
            if display_sig and key in display_sig_cache:
                label = display_sig_cache[key]
                pass_name = "display_sig"

        if label is None:
            display_tokens = split_pipe_values(display_group_ids or "")
            script_tokens = split_pipe_values(script_types or "")
            for display_token in sorted(set(display_tokens), key=lambda item: (item.lower(), item)):
                matched = False
                for script_token in sorted(set(script_tokens), key=lambda item: (item.lower(), item)):
                    key = (display_token, script_token)
                    if key in display_script_cache:
                        label = display_script_cache[key]
                        pass_name = "display_script"
                        matched = True
                        break
                if matched:
                    break

        if label is None:
            display_tokens = split_pipe_values(display_group_ids or "")
            for display_token in sorted(set(display_tokens), key=lambda item: (item.lower(), item)):
                if display_token in display_token_cache:
                    label = display_token_cache[display_token]
                    pass_name = "display_token"
                    break

        if label is None:
            continue

        label_details, label_identity = label
        new_details = details
        new_identity = identity

        if not has_details and label_details:
            new_details = label_details
        if not has_identity and label_identity:
            new_identity = label_identity

        if new_details != details or new_identity != identity:
            updates.append((new_details, new_identity, group_id))
            if pass_name:
                counts[pass_name] += 1

    if updates:
        cur.executemany(
            f"""
            UPDATE {TMP_DASHBOARD_GE1_TABLE}
            SET details = %s,
                identity = %s
            WHERE group_id = %s
            """,
            updates,
        )

    counts["total"] = len(updates)
    return counts


def _list_prior_snapshot_csvs(out_dir: Path, current_height: int) -> list[Path]:
    candidates: list[tuple[int, Path]] = []

    if out_dir.exists():
        for child in out_dir.iterdir():
            if not child.is_dir() or not child.name.isdigit():
                continue
            height = int(child.name)
            if height >= current_height:
                continue
            csv_path = child / "dashboard_pubkeys_ge_1btc.csv"
            if csv_path.exists():
                candidates.append((height, csv_path))

    archived_dir = out_dir / "archived"
    if archived_dir.exists():
        for child in archived_dir.iterdir():
            if not child.is_dir() or not child.name.isdigit():
                continue
            height = int(child.name)
            if height >= current_height:
                continue
            csv_path = child / "dashboard_pubkeys_ge_1btc.csv"
            if csv_path.exists():
                candidates.append((height, csv_path))

    # Oldest first so curated historical labels are applied before newer generic fallbacks.
    candidates.sort(key=lambda item: item[0])

    seen_heights: set[int] = set()
    ordered_paths: list[Path] = []
    for height, path in candidates:
        if height in seen_heights:
            continue
        seen_heights.add(height)
        ordered_paths.append(path)
    return ordered_paths


def carry_forward_labels_from_prior_snapshots(
    cur,
    out_dir: Path,
    current_height: int,
) -> dict[str, int]:
    totals = {
        "snapshots": 0,
        "group": 0,
        "display_exact": 0,
        "display_sig": 0,
        "display_script": 0,
        "display_token": 0,
        "total": 0,
    }

    for csv_path in _list_prior_snapshot_csvs(out_dir, current_height):
        reused = carry_forward_labels_from_existing_snapshot(cur, csv_path)
        totals["snapshots"] += 1
        for key in ("group", "display_exact", "display_sig", "display_script", "display_token", "total"):
            totals[key] += reused.get(key, 0)

    return totals


def label_miner_identity(cur) -> int:
    """Set identity = 'Miner' on GE1 rows that have no identity but received coinbase outputs.

    P2PK coinbase outputs are identified by extracting the pubkey hex directly
    from coinbases.scripthex and matching it against tokens in the display_group_ids
    column (P2PK rows store the pubkey hex there; group_id holds the keyhash20 hex).

    All non-P2PK coinbase outputs are matched by comparing coinbases.address against:
      - group_id (covers P2SH / P2WSH / P2TR / Other rows)
      - display_group_ids tokens (covers P2PKH / P2WPKH rows, where the address
        lives in display_group_ids while group_id holds the keyhash20 hex)

    Returns the number of rows updated.
    """
    coinbases_table = qualify(SCHEMA, "coinbases")
    ge1_table = TMP_DASHBOARD_GE1_TABLE

    cur.execute(
        f"""
        WITH unlabeled AS (
            SELECT group_id, display_group_ids
            FROM {ge1_table}
            WHERE identity IS NULL OR trim(identity) = ''
        ),
        -- P2PK: extract pubkey hex from coinbases.scripthex
        -- Compressed P2PK:   21 <33-byte pubkey> ac  → scripthex length 70
        -- Uncompressed P2PK: 41 <65-byte pubkey> ac  → scripthex length 134
        miner_pubkeys AS (
            SELECT DISTINCT
                CASE
                    WHEN length(c.scripthex) = 70
                     AND lower(left(c.scripthex, 2)) = '21'
                     AND lower(right(c.scripthex, 2)) = 'ac'
                    THEN lower(substr(c.scripthex, 3, 66))
                    WHEN length(c.scripthex) = 134
                     AND lower(left(c.scripthex, 2)) = '41'
                     AND lower(right(c.scripthex, 2)) = 'ac'
                    THEN lower(substr(c.scripthex, 3, 130))
                    ELSE NULL
                END AS pubkey_hex
            FROM {coinbases_table} c
            WHERE c.scripttype = 'pubkey'
              AND c.scripthex IS NOT NULL AND c.scripthex <> ''
        ),
        -- Non-P2PK: addresses from coinbases
        miner_addresses AS (
            SELECT DISTINCT c.address
            FROM {coinbases_table} c
            WHERE c.scripttype <> 'pubkey'
              AND c.address IS NOT NULL AND c.address <> ''
        ),
        -- P2PK match: pubkey hex in any display_group_ids token
        matched_by_pubkey AS (
            SELECT DISTINCT u.group_id
            FROM unlabeled u
            CROSS JOIN LATERAL unnest(string_to_array(u.display_group_ids, '|')) AS t(token)
            JOIN miner_pubkeys mp ON lower(trim(t.token)) = mp.pubkey_hex
            WHERE mp.pubkey_hex IS NOT NULL
        ),
        -- Non-key-type match: coinbase address = group_id (P2SH, P2WSH, P2TR, Other)
        matched_by_group_id AS (
            SELECT DISTINCT u.group_id
            FROM unlabeled u
            JOIN miner_addresses ma ON u.group_id = ma.address
        ),
        -- P2PKH / P2WPKH match: coinbase address appears in display_group_ids token
        matched_by_display AS (
            SELECT DISTINCT u.group_id
            FROM unlabeled u
            CROSS JOIN LATERAL unnest(string_to_array(u.display_group_ids, '|')) AS t(token)
            JOIN miner_addresses ma ON trim(t.token) = ma.address
        ),
        miner_groups AS (
            SELECT group_id FROM matched_by_pubkey
            UNION
            SELECT group_id FROM matched_by_group_id
            UNION
            SELECT group_id FROM matched_by_display
        )
        UPDATE {ge1_table} t
        SET identity = 'Miner'
        FROM miner_groups m
        WHERE t.group_id = m.group_id
          AND (t.identity IS NULL OR trim(t.identity) = '')
        """
    )
    return cur.rowcount


def has_dsms_marker(value: str) -> bool:
    return "(DSMS)" in (value or "")


def is_address_candidate(value: str) -> bool:
    if not value:
        return False
    if value.startswith("out:") or value.startswith("stxo:") or value.startswith("sha256:"):
        return False
    return True


def _parse_script(script_bytes: bytes) -> tuple[bool, list[bytes]]:
    has_multisig_opcode = False
    pushes: list[bytes] = []
    i = 0
    n = len(script_bytes)
    while i < n:
        op = script_bytes[i]
        i += 1

        if op <= 75:
            data_len = op
        elif op == 76:  # OP_PUSHDATA1
            if i >= n:
                break
            data_len = script_bytes[i]
            i += 1
        elif op == 77:  # OP_PUSHDATA2
            if i + 1 >= n:
                break
            data_len = script_bytes[i] | (script_bytes[i + 1] << 8)
            i += 2
        elif op == 78:  # OP_PUSHDATA4
            if i + 3 >= n:
                break
            data_len = (
                script_bytes[i]
                | (script_bytes[i + 1] << 8)
                | (script_bytes[i + 2] << 16)
                | (script_bytes[i + 3] << 24)
            )
            i += 4
        else:
            if op in (0xAE, 0xAF):  # OP_CHECKMULTISIG / OP_CHECKMULTISIGVERIFY
                has_multisig_opcode = True
            continue

        if data_len < 0 or i + data_len > n:
            break
        pushes.append(script_bytes[i : i + data_len])
        i += data_len

    return has_multisig_opcode, pushes


def _script_hex_is_multisig(script_hex: str) -> bool:
    if not script_hex or not re.fullmatch(r"[0-9a-fA-F]+", script_hex):
        return False
    if len(script_hex) % 2 != 0:
        return False

    try:
        script_bytes = bytes.fromhex(script_hex)
    except ValueError:
        return False

    has_multisig, pushes = _parse_script(script_bytes)
    if has_multisig:
        return True

    # For P2SH scriptSig, the final push often contains the redeem script.
    if pushes:
        inner_has_multisig, _ = _parse_script(pushes[-1])
        if inner_has_multisig:
            return True

    return False


def _decode_small_int_opcode(op: int):
    if op == 0x00:
        return 0
    if 0x51 <= op <= 0x60:
        return op - 0x50
    return None


def _parse_multisig_threshold(script_hex: str):
    if not script_hex or not re.fullmatch(r"[0-9a-fA-F]+", script_hex):
        return None
    if len(script_hex) % 2 != 0:
        return None

    try:
        b = bytes.fromhex(script_hex)
    except ValueError:
        return None

    if len(b) < 3:
        return None

    # canonical form: OP_m <pubkeys...> OP_n OP_CHECKMULTISIG(VERIFY)
    op_m = _decode_small_int_opcode(b[0])
    op_n = _decode_small_int_opcode(b[-2])
    op_chk = b[-1]
    if op_m is None or op_n is None or op_chk not in (0xAE, 0xAF):
        return None

    pubkey_pushes = 0
    i = 1
    while i < len(b) - 2:
        op = b[i]
        i += 1

        if op <= 75:
            data_len = op
        elif op == 76:
            if i >= len(b) - 2:
                return None
            data_len = b[i]
            i += 1
        elif op == 77:
            if i + 1 >= len(b) - 2:
                return None
            data_len = b[i] | (b[i + 1] << 8)
            i += 2
        else:
            return None

        if i + data_len > len(b) - 2:
            return None
        data = b[i : i + data_len]
        i += data_len
        if len(data) in (33, 65):
            pubkey_pushes += 1

    if not (0 <= op_m <= op_n):
        return None
    if pubkey_pushes and pubkey_pushes != op_n:
        return None

    return op_m, op_n


def _parse_multisig_from_type(scripttype: str):
    if not scripttype:
        return None
    match = re.search(r"Multisig\s+(\d+)\s*/\s*(\d+)", scripttype)
    if not match:
        return None
    return int(match.group(1)), int(match.group(2))


def _looks_like_canonical_multisig_threshold(script_hex: str) -> bool:
    """Fast pre-check for canonical m-of-n form before full parser work."""
    if not script_hex or len(script_hex) < 6:
        return False
    if len(script_hex) % 2 != 0 or not re.fullmatch(r"[0-9a-fA-F]+", script_hex):
        return False

    low = script_hex.lower()
    # canonical tail: OP_n OP_CHECKMULTISIG(VERIFY)
    if low[-2:] not in ("ae", "af"):
        return False
    if low[-4:-2] not in (
        "00",
        "51",
        "52",
        "53",
        "54",
        "55",
        "56",
        "57",
        "58",
        "59",
        "5a",
        "5b",
        "5c",
        "5d",
        "5e",
        "5f",
        "60",
    ):
        return False
    # canonical head typically starts with OP_m
    if low[:2] not in ("51", "52", "53", "54", "55", "56", "57", "58", "59", "5a", "5b", "5c", "5d", "5e", "5f", "60"):
        return False
    return True


def _might_contain_multisig_opcode(script_hex: str) -> bool:
    """Cheap coarse check before _script_hex_is_multisig's heavier parsing."""
    if not script_hex or len(script_hex) % 2 != 0 or not re.fullmatch(r"[0-9a-fA-F]+", script_hex):
        return False
    low = script_hex.lower()
    return "ae" in low or "af" in low


def _multisig_comment_rank(comment: str) -> int:
    """Rank comment specificity so m-of-n wins over generic multisig."""
    if not comment:
        return 0
    return 2 if re.search(r"\d+-of-\d+ multisig", comment) else 1


def _witness_candidates(spending_witness: str):
    if not spending_witness:
        return []
    parts = [p.strip() for p in spending_witness.split(",")]
    out = []
    for p in parts:
        if not p or p == "<empty>":
            continue
        if re.fullmatch(r"[0-9a-fA-F]+", p) and len(p) % 2 == 0:
            out.append(p)
    return out[::-1]


def _scriptsig_candidates(spending_script: str):
    if not spending_script or not re.fullmatch(r"[0-9a-fA-F]+", spending_script) or len(spending_script) % 2 != 0:
        return []

    try:
        _, pushes = _parse_script(bytes.fromhex(spending_script))
    except ValueError:
        return []

    return [pushes[-1].hex()] if pushes else []


def detect_multisig_comment_via_stxo(cur, stxo_tables: list[str], address: str) -> str:
    """Check first spendscript for each address; only return if it parses as m-of-n."""
    for table in stxo_tables:
        cur.execute(
            f"""
            SELECT spendingscript, spendingwitness, scripthex
            FROM public.{table}
            WHERE address = %s
              AND (
                    spendingscript IS NOT NULL
                 OR spendingwitness IS NOT NULL
                 OR scripthex IS NOT NULL
              )
            ORDER BY spendingblock DESC NULLS LAST, blockheight DESC
            LIMIT 1;
            """,
            (address,),
        )
        
        result = cur.fetchone()
        if not result:
            continue
            
        spendingscript, spendingwitness, scripthex = result
        candidates = []
        candidates.extend(_witness_candidates(spendingwitness or ""))
        candidates.extend(_scriptsig_candidates(spendingscript or ""))
        if scripthex:
            candidates.append(scripthex)

        for script in candidates:
            threshold = _parse_multisig_threshold(script)
            if threshold is not None:
                m, n = threshold
                return f"{m}-of-{n} multisig"
        
        # First row did not parse as m-of-n; don't continue to other tables
        return ""

    return ""


def _detect_wrapped_multisig_from_row(spendingscript: str, spendingwitness: str, scripthex: str) -> str:
    candidates = []
    candidates.extend(_witness_candidates(spendingwitness or ""))
    candidates.extend(_scriptsig_candidates(spendingscript or ""))
    if scripthex:
        candidates.append(scripthex)

    seen = set()
    for script in candidates:
        if script in seen:
            continue
        seen.add(script)

        if _looks_like_canonical_multisig_threshold(script):
            threshold = _parse_multisig_threshold(script)
            if threshold is not None:
                m, n = threshold
                return f"{m}-of-{n} multisig"

        if _might_contain_multisig_opcode(script) and _script_hex_is_multisig(script):
            return ""

    return ""


def prefetch_wrapped_multisig_comments(
    cur,
    stxo_tables: list[str],
    addresses: set[str],
    on_table_results: Callable[[str, dict[str, str]], None] | None = None,
) -> dict[str, str]:
    comments: dict[str, str] = {}
    if not addresses:
        return comments

    for table in stxo_tables:
        pending = [a for a in addresses if a not in comments]
        if not pending:
            break

        cur.execute(
            f"""
            WITH ranked AS (
                SELECT
                    address,
                    spendingscript,
                    spendingwitness,
                    scripthex,
                    ROW_NUMBER() OVER (
                        PARTITION BY address
                        ORDER BY spendingblock DESC NULLS LAST, blockheight DESC
                    ) AS rn
                FROM public.{table}
                WHERE address = ANY(%s)
                  AND (
                        spendingscript IS NOT NULL
                     OR spendingwitness IS NOT NULL
                     OR scripthex IS NOT NULL
                  )
            )
            SELECT address, spendingscript, spendingwitness, scripthex
            FROM ranked
            WHERE rn <= 1
            ORDER BY address, rn;
            """,
            (pending,),
        )

        rows = cur.fetchall()
        if rows:
            print(f"  {table}: queried {len(pending):,} addresses, got {len(rows):,} rows")
        table_hits: dict[str, str] = {}
        for address, spendingscript, spendingwitness, scripthex in rows:
            detected = _detect_wrapped_multisig_from_row(spendingscript, spendingwitness, scripthex)
            if detected:
                current = comments.get(address, "")
                if _multisig_comment_rank(detected) > _multisig_comment_rank(current):
                    comments[address] = detected
                    table_hits[address] = detected

        if table_hits and on_table_results is not None:
            on_table_results(table, table_hits)

    return comments


def detect_bare_ms_comment(cur, stxo_tables: list[str], address: str) -> str:
    """Check first row from outputs, then first row from first STXO table; only return if it parses as m-of-n."""
    # Try outputs first
    cur.execute(
        """
        SELECT scripttype, scripthex
        FROM public.outputs
        WHERE address = %s
          AND scripttype LIKE 'Multisig %%'
        ORDER BY blockheight DESC
        LIMIT 1;
        """,
        (address,),
    )
    result = cur.fetchone()
    if result:
        scripttype, scripthex = result
        mn = _parse_multisig_from_type(scripttype or "")
        if mn is not None:
            return f"{mn[0]}-of-{mn[1]} multisig"
        mn = _parse_multisig_threshold(scripthex or "")
        if mn is not None:
            return f"{mn[0]}-of-{mn[1]} multisig"
        # First row didn't parse; don't continue to STXO tables
        return ""

    # Try first STXO table only
    for table in stxo_tables:
        cur.execute(
            f"""
            SELECT scripttype, scripthex
            FROM public.{table}
            WHERE address = %s
              AND scripttype LIKE 'Multisig %%'
            ORDER BY spendingblock DESC NULLS LAST, blockheight DESC
            LIMIT 1;
            """,
            (address,),
        )
        result = cur.fetchone()
        if result:
            scripttype, scripthex = result
            mn = _parse_multisig_from_type(scripttype or "")
            if mn is not None:
                return f"{mn[0]}-of-{mn[1]} multisig"
            mn = _parse_multisig_threshold(scripthex or "")
            if mn is not None:
                return f"{mn[0]}-of-{mn[1]} multisig"
            # First row in first table didn't parse; stop here
            return ""

    return ""


def _detect_bare_multisig_from_row(scripttype: str, scripthex: str) -> str:
    mn = _parse_multisig_from_type(scripttype or "")
    if mn is not None:
        return f"{mn[0]}-of-{mn[1]} multisig"

    script = scripthex or ""
    if _looks_like_canonical_multisig_threshold(script):
        mn = _parse_multisig_threshold(script)
        if mn is not None:
            return f"{mn[0]}-of-{mn[1]} multisig"

    return ""


def prefetch_bare_ms_comments(
    cur,
    stxo_tables: list[str],
    addresses: set[str],
    on_table_results: Callable[[str, dict[str, str]], None] | None = None,
) -> dict[str, str]:
    comments: dict[str, str] = {}
    if not addresses:
        return comments

    pending = list(addresses)
    cur.execute(
        """
        WITH ranked AS (
            SELECT
                address,
                scripttype,
                scripthex,
                ROW_NUMBER() OVER (
                    PARTITION BY address
                    ORDER BY blockheight DESC
                ) AS rn
            FROM public.outputs
            WHERE address = ANY(%s)
              AND scripttype LIKE 'Multisig %%'
        )
        SELECT address, scripttype, scripthex
        FROM ranked
        WHERE rn <= 1
        ORDER BY address, rn;
        """,
        (pending,),
    )
    rows = cur.fetchall()
    if rows:
        print(f"  outputs: queried {len(pending):,} addresses, got {len(rows):,} rows")
    table_hits: dict[str, str] = {}
    for address, scripttype, scripthex in rows:
        if address in comments:
            continue
        detected = _detect_bare_multisig_from_row(scripttype, scripthex)
        if detected:
            comments[address] = detected
            table_hits[address] = detected

    if table_hits and on_table_results is not None:
        on_table_results("outputs", table_hits)

    for table in stxo_tables:
        pending = [a for a in addresses if a not in comments]
        if not pending:
            break

        cur.execute(
            f"""
            WITH ranked AS (
                SELECT
                    address,
                    scripttype,
                    scripthex,
                    ROW_NUMBER() OVER (
                        PARTITION BY address
                        ORDER BY spendingblock DESC NULLS LAST, blockheight DESC
                    ) AS rn
                FROM public.{table}
                WHERE address = ANY(%s)
                  AND scripttype LIKE 'Multisig %%'
            )
            SELECT address, scripttype, scripthex
            FROM ranked
            WHERE rn <= 1
            ORDER BY address, rn;
            """,
            (pending,),
        )

        rows = cur.fetchall()
        if rows:
            print(f"  {table}: queried {len(pending):,} addresses, got {len(rows):,} rows")
        table_hits = {}
        for address, scripttype, scripthex in rows:
            if address in comments:
                continue
            detected = _detect_bare_multisig_from_row(scripttype, scripthex)
            if detected:
                comments[address] = detected
                table_hits[address] = detected

        if table_hits and on_table_results is not None:
            on_table_results(table, table_hits)

    return comments


def load_historical_comment_cache(out_dir: Path) -> dict[str, str]:
    cache: dict[str, str] = {}
    if not out_dir.exists():
        return cache

    snapshot_dirs = sorted(
        [p for p in out_dir.iterdir() if p.is_dir() and p.name.isdigit()],
        key=lambda p: int(p.name),
        reverse=True,
    )

    for snapshot_dir in snapshot_dirs:
        csv_path = snapshot_dir / "dashboard_pubkeys_ge_1btc.csv"
        if not csv_path.exists():
            continue

        with csv_path.open("r", encoding="utf-8", newline="") as f:
            reader = csv.DictReader(f)
            if not reader.fieldnames or not ("comments" in reader.fieldnames or "details" in reader.fieldnames):
                continue

            for row in reader:
                # Support both old "comments" and new "details" column names
                comment = _normalize_multisig_details_label(
                    row.get("details") or row.get("comments") or ""
                )
                if not comment:
                    continue

                script_types = set(
                    split_pipe_values((row.get("script_types") or row.get("script_type") or "").strip())
                )
                display_ids = split_pipe_values(
                    row.get("display_group_ids") or row.get("display_group_id") or row.get("group_id") or ""
                )
                is_wrapped_multisig = bool({"P2SH", "P2WSH"} & script_types)
                is_bare_ms = "Other" in script_types and any(has_dsms_marker(v) for v in display_ids)
                if not (is_wrapped_multisig or is_bare_ms):
                    continue

                for addr in display_ids:
                    if is_address_candidate(addr):
                        cache.setdefault(addr, comment)

    return cache


def populate_ge1_comments(
    cur,
    out_dir: Path,
    on_partial_save: Callable[[str], None] | None = None,
) -> tuple[int, int, int]:
    address_comment_cache = load_historical_comment_cache(out_dir)
    stxo_comment_cache: dict[str, str] = {}
    updates: list[tuple[str, str]] = []
    stxo_tables = get_stxo_archive_tables(cur)
    unresolved_groups: list[tuple[str, list[str], bool]] = []
    group_remaining_addresses: dict[str, set[str]] = {}
    group_is_bare_ms: dict[str, bool] = {}
    resolved_groups: set[str] = set()
    address_to_groups: dict[str, set[str]] = {}
    wrapped_addresses_to_prefetch: set[str] = set()
    bare_addresses_to_prefetch: set[str] = set()

    historical_hits = 0
    stxo_lookups = 0

    cur.execute(
        f"""
        SELECT group_id, display_group_ids, script_types
        FROM {TMP_DASHBOARD_GE1_TABLE}
        WHERE details IS NULL OR details = ''
        """
    )

    for group_id, display_group_ids, script_types in cur.fetchall():
        script_type_set = set(split_pipe_values(script_types or ""))
        display_ids = split_pipe_values(display_group_ids or "")
        is_wrapped_multisig = bool({"P2SH", "P2WSH"} & script_type_set)
        is_bare_ms = "Other" in script_type_set and any(has_dsms_marker(v) for v in display_ids)

        if not (is_wrapped_multisig or is_bare_ms):
            continue

        addresses = [a for a in display_ids if is_address_candidate(a)]
        if not addresses and is_address_candidate(group_id):
            addresses = [group_id]

        if not addresses:
            continue

        comment = ""
        for addr in addresses:
            cached_comment = address_comment_cache.get(addr, "")
            if cached_comment:
                comment = cached_comment
                historical_hits += 1
                break

        if comment:
            updates.append((comment, group_id))
            resolved_groups.add(group_id)
            continue

        unresolved_groups.append((group_id, addresses, is_bare_ms))
        group_remaining_addresses[group_id] = set(addresses)
        group_is_bare_ms[group_id] = is_bare_ms
        for addr in addresses:
            address_to_groups.setdefault(addr, set()).add(group_id)
            if is_bare_ms and has_dsms_marker(addr):
                bare_addresses_to_prefetch.add(addr)
            else:
                wrapped_addresses_to_prefetch.add(addr)

    def flush_updates(batch_updates: list[tuple[str, str]]) -> None:
        if not batch_updates:
            return
        cur.executemany(
            f"""
            UPDATE {TMP_DASHBOARD_GE1_TABLE}
            SET details = %s
            WHERE group_id = %s
            """,
            batch_updates,
        )

    def process_table_hits(table_name: str, address_hits: dict[str, str]) -> None:
        batch_updates: list[tuple[str, str]] = []
        for addr, detected in address_hits.items():
            for group_id in address_to_groups.get(addr, set()):
                if group_id in resolved_groups:
                    continue
                batch_updates.append((detected, group_id))
                resolved_groups.add(group_id)
                for group_addr in group_remaining_addresses.get(group_id, set()):
                    address_comment_cache[group_addr] = detected

        flush_updates(batch_updates)
        if batch_updates and on_partial_save is not None:
            on_partial_save(table_name)

    # Apply cache-hit updates before STXO scans so partial saves include them.
    flush_updates(updates)

    wrapped_prefetch = prefetch_wrapped_multisig_comments(
        cur,
        stxo_tables,
        wrapped_addresses_to_prefetch,
        on_table_results=process_table_hits,
    )
    bare_prefetch = prefetch_bare_ms_comments(
        cur,
        stxo_tables,
        bare_addresses_to_prefetch,
        on_table_results=process_table_hits,
    )
    stxo_comment_cache.update(wrapped_prefetch)
    stxo_comment_cache.update(bare_prefetch)
    stxo_lookups += len(wrapped_addresses_to_prefetch) + len(bare_addresses_to_prefetch)

    updates = []
    for group_id, addresses, is_bare_ms in unresolved_groups:
        if group_id in resolved_groups:
            continue
        comment = ""

        for addr in addresses:
            detected = stxo_comment_cache.get(addr, "")

            if detected:
                comment = detected
                address_comment_cache[addr] = comment
                break

        if comment:
            updates.append((comment, group_id))
            resolved_groups.add(group_id)
        else:
            # Persist a negative lookup result so future runs can skip re-scanning.
            updates.append(("None", group_id))
            resolved_groups.add(group_id)
            for addr in addresses:
                address_comment_cache[addr] = "None"

    flush_updates(updates)

    return len(updates), historical_hits, stxo_lookups


def refresh_aggregates(cur, analysis_height: int, analysis_time: int, cutoff_height: int, cutoff_time: int):
    cur.execute(f"TRUNCATE TABLE {TMP_DASHBOARD_AGGREGATES_TABLE};")
    cur.execute(
        f"""
        INSERT INTO {TMP_DASHBOARD_AGGREGATES_TABLE} (
            balance_filter,
            script_type_filter,
            spend_activity_filter,
            pubkey_count,
            utxo_count,
            supply_sats,
            exposed_pubkey_count,
            exposed_utxo_count,
            exposed_supply_sats,
            estimated_migration_blocks
        )
        WITH tiers(balance_filter, min_sats) AS (
            VALUES
                ('all'::text,    0::bigint),
                ('ge1'::text,    100000000::bigint),
                ('ge10'::text,   1000000000::bigint),
                ('ge100'::text,  10000000000::bigint),
                ('ge1000'::text, 100000000000::bigint)
        )
        SELECT
            t.balance_filter,
            CASE
                WHEN GROUPING(s.script_type) = 1 THEN 'All'
                ELSE s.script_type
            END AS script_type_filter,
            CASE
                WHEN GROUPING(s.spend_activity) = 1 THEN 'all'
                ELSE s.spend_activity
            END AS spend_activity_filter,
            COUNT(*)::bigint AS pubkey_count,
            COALESCE(SUM(s.current_utxo_count), 0)::bigint AS utxo_count,
            COALESCE(SUM(
                CASE
                    WHEN s.script_type = 'P2PK'
                     AND s.group_id = %s
                    THEN GREATEST(s.current_supply_sats - %s, 0)
                    ELSE s.current_supply_sats
                END
            ), 0)::bigint AS supply_sats,
            COALESCE(SUM(s.exposed_pubkey_count), 0)::bigint AS exposed_pubkey_count,
            COALESCE(SUM(s.exposed_utxo_count), 0)::bigint AS exposed_utxo_count,
            COALESCE(SUM(s.exposed_supply_sats), 0)::bigint AS exposed_supply_sats,
            ROUND(
                COALESCE(SUM(
                    s.current_utxo_count::numeric * (
                        CASE s.script_type
                            WHEN 'P2PK'   THEN 111
                            WHEN 'P2PKH'  THEN 192
                            WHEN 'P2SH'   THEN 176
                            WHEN 'P2WPKH' THEN 112
                            WHEN 'P2WSH'  THEN 149
                            WHEN 'P2TR'   THEN 103
                            ELSE 176
                        END
                    )
                ), 0) * 4 / 4000000.0,
                2
            )::numeric(20,2) AS estimated_migration_blocks
        FROM tmp_dashboard_pubkey_base s
        JOIN tiers t ON s.current_supply_sats >= t.min_sats
        GROUP BY t.balance_filter, GROUPING SETS (
            (s.script_type, s.spend_activity),
            (s.script_type),
            (s.spend_activity),
            ()
        );
        """,
        (
            GENESIS_PUBKEY_KEYHASH20_HEX,
            GENESIS_BLOCK_REWARD_SATS,
        ),
    )
    return cur.rowcount


def print_dashboard_summary(cur, analysis_height: int):
    ge1 = fetch_one(
        cur,
        f"""
        SELECT
            COUNT(*)::bigint,
            COALESCE(SUM(exposed_supply_sats), 0)::bigint,
            COALESCE(SUM(exposed_utxo_count), 0)::bigint
        FROM {TMP_DASHBOARD_GE1_TABLE};
        """
    )
    totals_all = fetch_one(
        cur,
        f"""
        SELECT
            pubkey_count,
            supply_sats,
            exposed_supply_sats,
            exposed_pubkey_count,
            exposed_utxo_count
                FROM {TMP_DASHBOARD_AGGREGATES_TABLE}
        WHERE balance_filter = 'all'
          AND script_type_filter = 'All'
          AND spend_activity_filter = 'all';
        """
    )

    ge1_count = int(ge1[0]) if ge1 and ge1[0] is not None else 0
    ge1_exposed_supply = int(ge1[1]) if ge1 and ge1[1] is not None else 0
    ge1_exposed_pubkeys = ge1_count
    ge1_exposed_utxos = int(ge1[2]) if ge1 and ge1[2] is not None else 0

    total_pubkeys = int(totals_all[0]) if totals_all and totals_all[0] is not None else 0
    total_supply = int(totals_all[1]) if totals_all and totals_all[1] is not None else 0
    total_exposed_supply = int(totals_all[2]) if totals_all and totals_all[2] is not None else 0
    total_exposed_pubkeys = int(totals_all[3]) if totals_all and totals_all[3] is not None else 0
    total_exposed_utxos = int(totals_all[4]) if totals_all and totals_all[4] is not None else 0

    print("Dashboard build complete")
    print(f"snapshot blockheight       : {analysis_height:,}")
    print()
    print(">= 1 BTC detail table (exposed only)")
    print(f"rows                       : {ge1_count:,}")
    print(f"exposed supply BTC         : {ge1_exposed_supply / 100_000_000:,.8f}")
    print(f"exposed pubkey count       : {ge1_exposed_pubkeys:,}")
    print(f"exposed utxo count         : {ge1_exposed_utxos:,}")
    print()
    print("all balances totals (All script / all spend)")
    print(f"pubkeys                    : {total_pubkeys:,}")
    print(f"supply BTC                 : {total_supply / 100_000_000:,.8f}")
    print(f"exposed supply BTC         : {total_exposed_supply / 100_000_000:,.8f}")
    print(f"exposed pubkey count       : {total_exposed_pubkeys:,}")
    print(f"exposed utxo count         : {total_exposed_utxos:,}")


def copy_query_to_csv(cur, sql: str, params: Sequence, out_path: Path, row_transform=None) -> int:
    cur.execute(sql, params)
    rows = cur.fetchall()
    headers = [desc[0] for desc in cur.description]

    if row_transform is not None:
        rows = [row_transform(headers, row) for row in rows]

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(headers)
        writer.writerows(rows)

    return len(rows)


def upgrade_generic_multisig_details(
    cur,
    on_partial_save: Callable[[str], None] | None = None,
    redo_all_rows: bool = False,
) -> tuple[int, int]:
    """Re-scan wrapped rows and upgrade to m-of-n, optionally including previously labeled None."""
    stxo_tables = get_stxo_archive_tables(cur)

    if redo_all_rows:
        cur.execute(
            f"""
            SELECT group_id, display_group_ids, script_types
            FROM {TMP_DASHBOARD_GE1_TABLE}
            WHERE (
                    script_types = 'P2SH'
                 OR script_types = 'P2WSH'
                 OR script_types LIKE 'P2SH|%'
                 OR script_types LIKE '%|P2SH'
                 OR script_types LIKE '%|P2SH|%'
                 OR script_types LIKE 'P2WSH|%'
                 OR script_types LIKE '%|P2WSH'
                 OR script_types LIKE '%|P2WSH|%'
            )
            """
        )
    else:
        cur.execute(
            f"""
            SELECT group_id, display_group_ids, script_types
            FROM {TMP_DASHBOARD_GE1_TABLE}
            WHERE (details = 'multisig'
                OR details IS NULL
                OR details = '')
              AND (
                    script_types = 'P2SH'
                 OR script_types = 'P2WSH'
                 OR script_types LIKE 'P2SH|%'
                 OR script_types LIKE '%|P2SH'
                 OR script_types LIKE '%|P2SH|%'
                 OR script_types LIKE 'P2WSH|%'
                 OR script_types LIKE '%|P2WSH'
                 OR script_types LIKE '%|P2WSH|%'
              )
            """
        )
    candidate_rows = cur.fetchall()
    if not candidate_rows:
        if redo_all_rows:
            print("  No wrapped rows found to upgrade.")
        else:
            print("  No wrapped rows with multisig/empty details found to upgrade.")
        return 0, 0

    print(f"  Found {len(candidate_rows):,} wrapped candidate rows to attempt upgrade")

    address_to_groups: dict[str, set[str]] = {}
    for group_id, display_group_ids, script_types in candidate_rows:
        script_type_set = set(split_pipe_values(script_types or ""))
        display_ids = split_pipe_values(display_group_ids or "")
        is_wrapped = bool({"P2SH", "P2WSH"} & script_type_set)
        if not is_wrapped:
            continue
        addresses = [a for a in display_ids if is_address_candidate(a)]
        if not addresses and is_address_candidate(group_id):
            addresses = [group_id]
        for addr in addresses:
            address_to_groups.setdefault(addr, set()).add(group_id)

    all_addresses = set(address_to_groups.keys())
    if not all_addresses:
        print("  No upgradeable addresses found.")
        return 0, 0

    threshold_results: dict[str, str] = {}
    total_upgraded = 0

    for table in stxo_tables:
        pending = [a for a in all_addresses if a not in threshold_results]
        if not pending:
            break

        cur.execute(
            f"""
            WITH ranked AS (
                SELECT
                    address,
                    spendingscript,
                    spendingwitness,
                    scripthex,
                    ROW_NUMBER() OVER (
                        PARTITION BY address
                        ORDER BY spendingblock DESC NULLS LAST, blockheight DESC
                    ) AS rn
                FROM public.{table}
                WHERE address = ANY(%s)
                  AND (
                        spendingscript IS NOT NULL
                     OR spendingwitness IS NOT NULL
                     OR scripthex IS NOT NULL
                  )
            )
            SELECT address, spendingscript, spendingwitness, scripthex
            FROM ranked
            WHERE rn <= 24
            ORDER BY address, rn;
            """,
            (pending,),
        )
        rows = cur.fetchall()
        if not rows:
            continue

        print(f"  {table}: queried {len(pending):,} addresses, got {len(rows):,} rows")

        table_upgrades: dict[str, str] = {}
        for address, spendingscript, spendingwitness, scripthex in rows:
            if address in threshold_results:
                continue
            candidates = []
            candidates.extend(_witness_candidates(spendingwitness or ""))
            candidates.extend(_scriptsig_candidates(spendingscript or ""))
            if scripthex:
                candidates.append(scripthex)
            seen: set[str] = set()
            for c in candidates:
                if c in seen:
                    continue
                seen.add(c)
                if _looks_like_canonical_multisig_threshold(c):
                    th = _parse_multisig_threshold(c)
                    if th is not None:
                        m, n = th
                        comment = f"{m}-of-{n} multisig"
                        threshold_results[address] = comment
                        table_upgrades[address] = comment
                        break

        if not table_upgrades:
            continue

        # Apply upgrades for all groups associated with these addresses
        updates: list[tuple[str, str]] = []
        upgraded_groups: set[str] = set()
        for addr, comment in table_upgrades.items():
            for group_id in address_to_groups.get(addr, set()):
                if group_id not in upgraded_groups:
                    updates.append((comment, group_id))
                    upgraded_groups.add(group_id)

        cur.executemany(
            f"""
            UPDATE {TMP_DASHBOARD_GE1_TABLE}
            SET details = %s
            WHERE group_id = %s
            """,
            updates,
        )
        total_upgraded += len(updates)
        print(f"  upgraded {len(updates):,} rows from this table")

        if on_partial_save is not None:
            on_partial_save(table)

    unresolved_updates: list[tuple[str, str]] = []
    unresolved_groups: set[str] = set()
    for addr, group_ids in address_to_groups.items():
        if addr in threshold_results:
            continue
        for group_id in group_ids:
            if group_id in unresolved_groups:
                continue
            unresolved_groups.add(group_id)
            unresolved_updates.append(("None", group_id))

    if unresolved_updates:
        cur.executemany(
            f"""
            UPDATE {TMP_DASHBOARD_GE1_TABLE}
            SET details = %s
            WHERE group_id = %s
            """,
            unresolved_updates,
        )
        if on_partial_save is not None:
            on_partial_save("upgrade_multisig_unresolved")

    return total_upgraded, len(unresolved_updates)


def normalize_generic_multisig_details(cur) -> int:
    cur.execute(
        f"""
        UPDATE {TMP_DASHBOARD_GE1_TABLE}
        SET details = 'None'
        WHERE lower(trim(COALESCE(details, ''))) = 'multisig'
        """
    )
    return cur.rowcount


def export_ge1_csv(cur, snapshot: int, out_dir: Path) -> tuple[int, Path]:
    snapshot_dir = out_dir / str(snapshot)
    ge1_path = snapshot_dir / "dashboard_pubkeys_ge_1btc.csv"
    ge1_rows = copy_query_to_csv(
        cur,
        f"""
        SELECT
            group_id,
            display_group_ids,
            script_types,
            COALESCE(exposed_supply_sats_by_script_type, '{{}}') AS exposed_supply_sats_by_script_type,
            spend_activity,
            exposed_utxo_count,
            exposed_supply_sats,
            first_exposed_blockheight,
            first_exposed_time,
            last_spend_blockheight,
            last_spend_time,
            details,
            COALESCE(identity, '') AS identity
        FROM {TMP_DASHBOARD_GE1_TABLE}
        ORDER BY spend_activity, exposed_supply_sats DESC, group_id;
        """,
        (),
        ge1_path,
        row_transform=_fix_ge1_display_group_ids,
    )
    return ge1_rows, ge1_path


def export_dashboard_csvs(
    cur,
    snapshot: int,
    analysis_time: int,
    cutoff_height: int,
    cutoff_time: int,
    out_dir: Path,
) -> tuple[int, int, int, Path]:
    snapshot_dir = out_dir / str(snapshot)

    ge1_rows = copy_query_to_csv(
        cur,
        f"""
        SELECT
            group_id,
            display_group_ids,
            script_types,
            COALESCE(exposed_supply_sats_by_script_type, '{{}}') AS exposed_supply_sats_by_script_type,
            spend_activity,
            exposed_utxo_count,
            exposed_supply_sats,
            first_exposed_blockheight,
            first_exposed_time,
            last_spend_blockheight,
            last_spend_time,
            details,
            COALESCE(identity, '') AS identity
        FROM {TMP_DASHBOARD_GE1_TABLE}
        ORDER BY spend_activity, exposed_supply_sats DESC, group_id;
        """,
        (),
        snapshot_dir / "dashboard_pubkeys_ge_1btc.csv",
        row_transform=_fix_ge1_display_group_ids,
    )

    agg_rows = copy_query_to_csv(
        cur,
        f"""
        SELECT
            balance_filter,
            script_type_filter,
            spend_activity_filter,
            pubkey_count,
            utxo_count,
            supply_sats,
            exposed_pubkey_count,
            exposed_utxo_count,
            exposed_supply_sats,
            estimated_migration_blocks
        FROM {TMP_DASHBOARD_AGGREGATES_TABLE}
        ORDER BY balance_filter, script_type_filter, spend_activity_filter;
        """,
        (),
        snapshot_dir / "dashboard_pubkeys_aggregates.csv",
    )

    meta_path = snapshot_dir / "dashboard_snapshot_meta.csv"
    meta_path.parent.mkdir(parents=True, exist_ok=True)
    with meta_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow([
            "snapshot_blockheight",
            "snapshot_time",
            "one_year_ago_blockheight",
            "one_year_ago_block_time",
        ])
        writer.writerow([snapshot, analysis_time, cutoff_height, cutoff_time])
    meta_rows = 1

    snapshot_dirs = [p.name for p in out_dir.iterdir() if p.is_dir() and p.name.isdigit()]
    snapshot_dirs.sort(key=lambda value: int(value), reverse=True)

    latest_ptr = out_dir / "latest_snapshot.txt"
    latest_ptr.parent.mkdir(parents=True, exist_ok=True)
    latest_height = snapshot_dirs[0] if snapshot_dirs else str(snapshot)
    latest_ptr.write_text(latest_height, encoding="utf-8")

    index_path = out_dir / "snapshots_index.csv"
    with index_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["snapshot_blockheight", "snapshot_time"])
        for value in snapshot_dirs:
            snap_time = ""
            meta_file = out_dir / value / "dashboard_snapshot_meta.csv"
            if meta_file.exists():
                try:
                    with meta_file.open("r", encoding="utf-8") as mf:
                        meta_reader = csv.DictReader(mf)
                        meta_row = next(meta_reader, None)
                        if meta_row:
                            snap_time = meta_row.get("snapshot_time", "")
                except Exception:
                    pass
            writer.writerow([value, snap_time])

    return ge1_rows, agg_rows, meta_rows, snapshot_dir


def main() -> None:
    global SCHEMA

    args = parse_args()
    if args.backfill_times_only and args.snapshot_height is None:
        raise ValueError("--backfill-times-only requires --snapshot-height")
    if args.backfill_times_only and args.redo_all_rows:
        raise ValueError("--redo-all-rows is not applicable with --backfill-times-only")
    if args.backfill_times_only and args.upgrade_multisig:
        raise ValueError("--upgrade-multisig is not applicable with --backfill-times-only")

    SCHEMA = args.schema
    load_dotenv(dotenv_path=Path(args.env_file))

    conn = connect()
    try:
        with conn.cursor() as cur:
            ensure_dashboard_tables(cur)

            out_dir = Path(args.out_dir)

            # If snapshot-height is provided, just update comments and re-export
            if args.snapshot_height is not None:
                snapshot_height = args.snapshot_height
                csv_path = out_dir / str(snapshot_height) / "dashboard_pubkeys_ge_1btc.csv"
                partial_save_counter = 0

                def on_partial_save(table_name: str) -> None:
                    nonlocal partial_save_counter
                    partial_save_counter += 1
                    enforce_genesis_ge1_row(cur)
                    partial_rows, partial_path = export_ge1_csv(cur, snapshot_height, out_dir)
                    print(
                        f"  partial save {partial_save_counter}: {table_name} -> "
                        f"{partial_rows:,} rows -> {partial_path}"
                    )

                print(f"Loading existing snapshot from blockheight {snapshot_height:,}...")
                ge1_rows = load_ge1_csv_into_temp_table(cur, csv_path)
                print(f"Loaded {ge1_rows:,} rows into temp table")
                normalized_display_rows = normalize_p2pkh_display_ids(cur)
                print(f"normalized P2PKH display rows: {normalized_display_rows:,}")

                if args.backfill_times_only:
                    print("Backfilling first_exposed_time and last_spend_time from block heights...")
                    first_updated, last_updated = backfill_ge1_time_columns(cur)
                    print(f"first_exposed_time rows updated : {first_updated:,}")
                    print(f"last_spend_time rows updated    : {last_updated:,}")

                    enforce_genesis_ge1_row(cur)
                    csv_ge1_rows, ge1_path = export_ge1_csv(cur, snapshot_height, out_dir)
                    print()
                    print(f"Updated ge1 rows: {csv_ge1_rows:,} -> {ge1_path}")
                    return

                print("Annotating details (history cache first, STXO parser for new addresses)...")
                comment_updates, comment_history_hits, comment_stxo_lookups = populate_ge1_comments(
                    cur,
                    out_dir,
                    on_partial_save=on_partial_save,
                )
                print(f"details applied             : {comment_updates:,}")
                print(f"history cache hits          : {comment_history_hits:,}")
                print(f"new STXO lookups            : {comment_stxo_lookups:,}")

                if args.upgrade_multisig:
                    print()
                    print("Upgrading wrapped multisig/None/empty rows to m-of-n where possible...")
                    upgraded, downgraded_to_none = upgrade_generic_multisig_details(
                        cur,
                        on_partial_save=on_partial_save,
                        redo_all_rows=args.redo_all_rows,
                    )
                    print(f"rows upgraded to m-of-n    : {upgraded:,}")
                    print(f"rows set to None           : {downgraded_to_none:,}")

                normalized_multisig = normalize_generic_multisig_details(cur)
                if normalized_multisig:
                    print(f"generic multisig -> None   : {normalized_multisig:,}")

                print("Labeling miner identity from coinbases table...")
                miner_labeled = label_miner_identity(cur)
                print(f"miner identity rows labeled : {miner_labeled:,}")

                enforce_genesis_ge1_row(cur)
                csv_ge1_rows, ge1_path = export_ge1_csv(cur, snapshot_height, out_dir)
                print()
                print(f"Updated ge1 rows: {csv_ge1_rows:,} -> {ge1_path}")
                return

            # Full build: get freeze heights and build everything
            analysis_height, analysis_time = get_freeze_height_and_time(cur)
            validate_active_tables_at_same_height(cur, analysis_height)
            cutoff_height, cutoff_time = get_one_year_ago_block(cur, analysis_time, analysis_height)
            stxo_archive_tables = get_stxo_archive_tables(cur)
            latest_stxo_archive_table = get_latest_stxo_archive_table(cur)

            (
                p2pk_added_outputs,
                p2pk_added_stxos,
                p2pk_cache_total,
                p2pk_unresolved_active,
            ) = populate_p2pk_pubkey_cache_for_active(cur, analysis_height, stxo_archive_tables)

            print(f"analysis height            : {analysis_height:,}")
            print(f"analysis time              : {analysis_time}")
            print(f"one year cutoff height     : {cutoff_height:,}")
            print(f"one year cutoff time       : {cutoff_time}")
            print(f"stxo archive tables        : {len(stxo_archive_tables):,}")
            print(f"latest stxo archive table  : {latest_stxo_archive_table}")
            print(f"p2pk pubkeys added outputs : {p2pk_added_outputs:,}")
            print(f"p2pk pubkeys added stxos   : {p2pk_added_stxos:,}")
            print(f"p2pk pubkeys cached total  : {p2pk_cache_total:,}")
            print(f"p2pk unresolved active keys: {p2pk_unresolved_active:,}")
            print()

            print("Building unified dashboard base...")
            build_dashboard_base(cur, analysis_height, cutoff_height, latest_stxo_archive_table)

            print("Refreshing >= 1 BTC detail table...")
            ge1_rows = refresh_ge1_dashboard_table(
                cur=cur,
                analysis_height=analysis_height,
                analysis_time=analysis_time,
                cutoff_height=cutoff_height,
                cutoff_time=cutoff_time,
            )
            print(f"rows in {DASHBOARD_GE1_TABLE:<31}: {ge1_rows:,}")
            normalized_display_rows = normalize_p2pkh_display_ids(cur)
            print(f"normalized P2PKH display rows: {normalized_display_rows:,}")

            existing_ge1_csv = out_dir / str(analysis_height) / "dashboard_pubkeys_ge_1btc.csv"
            if existing_ge1_csv.exists():
                reused = carry_forward_labels_from_existing_snapshot(cur, existing_ge1_csv)
                print("Reused labels from existing snapshot CSV:")
                print(f"  by group_id               : {reused['group']:,}")
                print(f"  by display ids (exact)    : {reused['display_exact']:,}")
                print(f"  by display+script sig     : {reused['display_sig']:,}")
                print(f"  by display+script token   : {reused['display_script']:,}")
                print(f"  by display id token       : {reused['display_token']:,}")
                print(f"  total labels carried      : {reused['total']:,}")

            print("Refreshing aggregates table...")
            agg_rows = refresh_aggregates(
                cur=cur,
                analysis_height=analysis_height,
                analysis_time=analysis_time,
                cutoff_height=cutoff_height,
                cutoff_time=cutoff_time,
            )
            print(f"rows in {DASHBOARD_AGGREGATES_TABLE:<30}: {agg_rows:,}")

            print()
            print_dashboard_summary(cur, analysis_height)

            reused_prior = carry_forward_labels_from_prior_snapshots(
                cur=cur,
                out_dir=out_dir,
                current_height=analysis_height,
            )
            print("Reused labels from prior snapshot CSVs:")
            print(f"  snapshots scanned          : {reused_prior['snapshots']:,}")
            print(f"  by group_id               : {reused_prior['group']:,}")
            print(f"  by display ids (exact)    : {reused_prior['display_exact']:,}")
            print(f"  by display+script sig     : {reused_prior['display_sig']:,}")
            print(f"  by display+script token   : {reused_prior['display_script']:,}")
            print(f"  by display id token       : {reused_prior['display_token']:,}")
            print(f"  total labels carried      : {reused_prior['total']:,}")

            print("Labeling miner identity from coinbases table...")
            miner_labeled = label_miner_identity(cur)
            print(f"miner identity rows labeled : {miner_labeled:,}")
            print()

            print("Annotating ge1 details (history cache first, STXO parser for new addresses)...")
            comment_updates, comment_history_hits, comment_stxo_lookups = populate_ge1_comments(cur, out_dir)
            print(f"details applied             : {comment_updates:,}")
            print(f"history cache hits          : {comment_history_hits:,}")
            print(f"new STXO lookups            : {comment_stxo_lookups:,}")

            print("Upgrading wrapped multisig rows to m-of-n where possible...")
            upgraded, downgraded_to_none = upgrade_generic_multisig_details(
                cur,
                redo_all_rows=False,
            )
            print(f"rows upgraded to m-of-n    : {upgraded:,}")
            print(f"rows set to None           : {downgraded_to_none:,}")

            normalized_multisig = normalize_generic_multisig_details(cur)
            if normalized_multisig:
                print(f"generic multisig -> None   : {normalized_multisig:,}")

            enforce_genesis_ge1_row(cur)
            csv_ge1_rows, csv_agg_rows, csv_meta_rows, snapshot_dir = export_dashboard_csvs(
                cur=cur,
                snapshot=analysis_height,
                analysis_time=analysis_time,
                cutoff_height=cutoff_height,
                cutoff_time=cutoff_time,
                out_dir=out_dir,
            )
            print()
            print(f"Wrote ge1 rows: {csv_ge1_rows:,} -> {snapshot_dir / 'dashboard_pubkeys_ge_1btc.csv'}")
            print(f"Wrote aggregates rows: {csv_agg_rows:,} -> {snapshot_dir / 'dashboard_pubkeys_aggregates.csv'}")
            print(f"Wrote metadata rows: {csv_meta_rows:,} -> {snapshot_dir / 'dashboard_snapshot_meta.csv'}")
            print(f"Updated latest snapshot pointer -> {out_dir / 'latest_snapshot.txt'}")
            print(f"Updated snapshots index -> {out_dir / 'snapshots_index.csv'}")

    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
