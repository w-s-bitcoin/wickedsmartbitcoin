#!/usr/bin/env python3
"""Update key_outputs_all incrementally."""

import argparse
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import List

import psycopg2
from dotenv import load_dotenv
from pipeline_paths import resolve_env_file

env_path = resolve_env_file()
load_dotenv(dotenv_path=env_path)

SOURCE_FREEZE_NAME = "exposure_analysis"
TABLE_FREEZE_NAME = "key_outputs_all"
SCHEMA = "public"
TABLE_NAME = "key_outputs_all"

STXO_NAME_RE = re.compile(r"^stxos_(\d+)_(\d+)_archive$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Update key_outputs_all incrementally")
    parser.add_argument(
        "--freeze-height",
        type=int,
        default=None,
        help="Optional explicit freeze height. Must be <= safe freeze height.",
    )
    return parser.parse_args()


@dataclass(frozen=True)
class StxoPartition:
    lo: int
    hi: int
    name: str


def connect():
    return psycopg2.connect(
        host=os.getenv("POSTGRES_HOST"),
        database=os.getenv("POSTGRES_DB"),
        user=os.getenv("POSTGRES_USER"),
        password=os.getenv("POSTGRES_PASSWORD"),
    )


def quote_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def qualify(schema: str, table: str) -> str:
    return f"{quote_ident(schema)}.{quote_ident(table)}"


def fetch_one(cur, sql: str, params=None):
    cur.execute(sql, params or ())
    return cur.fetchone()


def list_stxo_partitions(cur) -> List[StxoPartition]:
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
    parts: List[StxoPartition] = []
    for (tname,) in cur.fetchall():
        match = STXO_NAME_RE.match(tname)
        if not match:
            continue
        parts.append(StxoPartition(int(match.group(1)), int(match.group(2)), tname))
    parts.sort(key=lambda part: (part.lo, part.hi))
    if not parts:
        raise RuntimeError("No stxos_*_archive tables found.")
    return parts


def get_latest_stxo_partition(cur) -> StxoPartition:
    return list_stxo_partitions(cur)[-1]


def ensure_supporting_objects(cur):
    cur.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto;")
    cur.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {qualify(SCHEMA, 'analysis_freeze')} (
            name text PRIMARY KEY,
            freeze_blockheight bigint NOT NULL
        );
        """
    )


def get_safe_freeze_height(cur, latest_part: StxoPartition) -> int:
    blockheader_tip = fetch_one(
        cur,
        f"""
        SELECT MAX(blockheight)
        FROM {qualify(SCHEMA, 'blockheader')};
        """,
    )[0]

    outputs_tip = fetch_one(
        cur,
        f"""
        SELECT MAX(blockheight)
        FROM {qualify(SCHEMA, 'outputs')};
        """,
    )[0]

    latest_stxo_block_max = fetch_one(
        cur,
        f"""
        SELECT MAX(blockheight)
        FROM {qualify(SCHEMA, latest_part.name)};
        """,
    )[0]

    latest_stxo_spending_max = fetch_one(
        cur,
        f"""
        SELECT MAX(spendingblock)
        FROM {qualify(SCHEMA, latest_part.name)};
        """,
    )[0]

    candidates = [
        int(blockheader_tip) if blockheader_tip is not None else None,
        int(outputs_tip) if outputs_tip is not None else None,
        int(latest_part.hi),
        int(latest_stxo_block_max) if latest_stxo_block_max is not None else None,
        int(latest_stxo_spending_max) if latest_stxo_spending_max is not None else None,
    ]
    candidates = [value for value in candidates if value is not None]

    if not candidates:
        raise RuntimeError("Could not determine a safe freeze height.")

    safe_freeze = min(candidates)

    print(f"blockheader tip             : {int(blockheader_tip):,}" if blockheader_tip is not None else "blockheader tip             : none")
    print(f"outputs tip                 : {int(outputs_tip):,}" if outputs_tip is not None else "outputs tip                 : none")
    print(f"latest stxo partition       : {latest_part.name}")
    print(f"latest stxo partition hi    : {latest_part.hi:,}")
    print(f"latest stxo max blockheight : {int(latest_stxo_block_max):,}" if latest_stxo_block_max is not None else "latest stxo max blockheight : none")
    print(f"latest stxo max spendblock  : {int(latest_stxo_spending_max):,}" if latest_stxo_spending_max is not None else "latest stxo max spendblock  : none")
    print(f"safe freeze height          : {safe_freeze:,}")

    return safe_freeze


def upsert_source_freeze(cur, freeze_height: int):
    cur.execute(
        f"""
        INSERT INTO {qualify(SCHEMA, 'analysis_freeze')} (name, freeze_blockheight)
        VALUES (%s, %s)
        ON CONFLICT (name) DO UPDATE
        SET freeze_blockheight = EXCLUDED.freeze_blockheight
        """,
        (SOURCE_FREEZE_NAME, freeze_height),
    )


def get_table_previous_freeze(cur):
    row = fetch_one(
        cur,
        f"""
        SELECT freeze_blockheight
        FROM {qualify(SCHEMA, 'analysis_freeze')}
        WHERE name = %s
        """,
        (TABLE_FREEZE_NAME,),
    )
    return None if row is None else int(row[0])


def upsert_table_freeze(cur, freeze_height: int):
    cur.execute(
        f"""
        INSERT INTO {qualify(SCHEMA, 'analysis_freeze')} (name, freeze_blockheight)
        VALUES (%s, %s)
        ON CONFLICT (name) DO UPDATE
        SET freeze_blockheight = EXCLUDED.freeze_blockheight
        """,
        (TABLE_FREEZE_NAME, freeze_height),
    )


def ensure_table_exists(cur):
    cur.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {qualify(SCHEMA, TABLE_NAME)} (
            keyhash20      bytea   NOT NULL,
            script_type    text    NOT NULL,
            address        text,
            blockheight    bigint  NOT NULL,
            transactionid  text    NOT NULL,
            vout           integer NOT NULL,
            amount         bigint  NOT NULL,
            isspent        boolean NOT NULL,
            spendingblock  bigint,
            source_table   text    NOT NULL,
            PRIMARY KEY (blockheight, transactionid, vout)
        );
        """
    )


P2PK_OUTPUTS_SELECT = """
SELECT
    digest(
        digest(
            CASE
                WHEN substr(x.scripthex, 1, 2) = '21' THEN decode(substr(x.scripthex, 3, 66), 'hex')
                WHEN substr(x.scripthex, 1, 2) = '41' THEN decode(substr(x.scripthex, 3, 130), 'hex')
                ELSE NULL
            END,
            'sha256'
        ),
        'ripemd160'
    ) AS keyhash20,
    'pubkey'::text AS script_type,
    x.address,
    x.blockheight,
    x.transactionid,
    x.vout,
    x.amount,
    x.spendingblock
FROM {source} x
WHERE x.scripttype = 'pubkey'
  AND x.scripthex ~ '^[0-9a-f]+$'
  AND (
        (substr(x.scripthex, 1, 2) = '21' AND right(x.scripthex, 2) = 'ac' AND length(x.scripthex) = 70)
     OR (substr(x.scripthex, 1, 2) = '41' AND right(x.scripthex, 2) = 'ac' AND length(x.scripthex) = 134)
  )
"""

P2PKH_OUTPUTS_SELECT = """
SELECT
    decode(substr(x.scripthex, 7, 40), 'hex') AS keyhash20,
    'pubkeyhash'::text AS script_type,
    x.address,
    x.blockheight,
    x.transactionid,
    x.vout,
    x.amount,
    x.spendingblock
FROM {source} x
WHERE x.scripttype = 'pubkeyhash'
  AND x.scripthex ~ '^[0-9a-f]+$'
  AND left(x.scripthex, 6) = '76a914'
  AND right(x.scripthex, 4) = '88ac'
  AND length(x.scripthex) = 50
"""

P2WPKH_OUTPUTS_SELECT = """
SELECT
    decode(substr(x.scripthex, 5, 40), 'hex') AS keyhash20,
    'witness_v0_keyhash'::text AS script_type,
    x.address,
    x.blockheight,
    x.transactionid,
    x.vout,
    x.amount,
    x.spendingblock
FROM {source} x
WHERE x.scripttype = 'witness_v0_keyhash'
  AND x.scripthex ~ '^[0-9a-f]+$'
  AND left(x.scripthex, 4) = '0014'
  AND length(x.scripthex) = 44
"""


def insert_new_outputs_from_outputs(cur, prev_freeze: int, new_freeze: int) -> int:
    sql = f"""
    INSERT INTO {qualify(SCHEMA, TABLE_NAME)}
        (keyhash20, script_type, address, blockheight, transactionid, vout, amount,
         isspent, spendingblock, source_table)
    SELECT
        z.keyhash20,
        z.script_type,
        z.address,
        z.blockheight,
        z.transactionid,
        z.vout,
        z.amount,
        false AS isspent,
        NULL::bigint AS spendingblock,
        'outputs'::text AS source_table
    FROM (
        {P2PK_OUTPUTS_SELECT.format(source=qualify(SCHEMA, 'outputs'))}
        UNION ALL
        {P2PKH_OUTPUTS_SELECT.format(source=qualify(SCHEMA, 'outputs'))}
        UNION ALL
        {P2WPKH_OUTPUTS_SELECT.format(source=qualify(SCHEMA, 'outputs'))}
    ) z
    WHERE z.keyhash20 IS NOT NULL
      AND z.blockheight > %s
      AND z.blockheight <= %s
    ON CONFLICT DO NOTHING;
    """
    cur.execute(sql, (prev_freeze, new_freeze))
    return cur.rowcount


def insert_new_outputs_from_latest_stxo_unspent_asof_freeze(cur, latest_part: StxoPartition, prev_freeze: int, new_freeze: int) -> int:
    sql = f"""
    INSERT INTO {qualify(SCHEMA, TABLE_NAME)}
        (keyhash20, script_type, address, blockheight, transactionid, vout, amount,
         isspent, spendingblock, source_table)
    SELECT
        z.keyhash20,
        z.script_type,
        z.address,
        z.blockheight,
        z.transactionid,
        z.vout,
        z.amount,
        false AS isspent,
        NULL::bigint AS spendingblock,
        %s AS source_table
    FROM (
        {P2PK_OUTPUTS_SELECT.format(source=qualify(SCHEMA, latest_part.name))}
        UNION ALL
        {P2PKH_OUTPUTS_SELECT.format(source=qualify(SCHEMA, latest_part.name))}
        UNION ALL
        {P2WPKH_OUTPUTS_SELECT.format(source=qualify(SCHEMA, latest_part.name))}
    ) z
    WHERE z.keyhash20 IS NOT NULL
      AND z.blockheight > %s
      AND z.blockheight <= %s
      AND z.spendingblock > %s
    ON CONFLICT DO NOTHING;
    """
    cur.execute(sql, (latest_part.name, prev_freeze, new_freeze, new_freeze))
    return cur.rowcount


def insert_new_outputs_from_stxo_spent_asof_freeze(cur, part: StxoPartition, prev_freeze: int, new_freeze: int) -> int:
    sql = f"""
    INSERT INTO {qualify(SCHEMA, TABLE_NAME)}
        (keyhash20, script_type, address, blockheight, transactionid, vout, amount,
         isspent, spendingblock, source_table)
    SELECT
        z.keyhash20,
        z.script_type,
        z.address,
        z.blockheight,
        z.transactionid,
        z.vout,
        z.amount,
        true AS isspent,
        z.spendingblock,
        %s AS source_table
    FROM (
        {P2PK_OUTPUTS_SELECT.format(source=qualify(SCHEMA, part.name))}
        UNION ALL
        {P2PKH_OUTPUTS_SELECT.format(source=qualify(SCHEMA, part.name))}
        UNION ALL
        {P2WPKH_OUTPUTS_SELECT.format(source=qualify(SCHEMA, part.name))}
    ) z
    WHERE z.keyhash20 IS NOT NULL
      AND z.blockheight > %s
      AND z.blockheight <= %s
      AND z.spendingblock <= %s
    ON CONFLICT DO NOTHING;
    """
    cur.execute(sql, (part.name, prev_freeze, new_freeze, new_freeze))
    return cur.rowcount


def update_existing_rows_that_became_spent(cur, part: StxoPartition, prev_freeze: int, new_freeze: int) -> int:
    sql = f"""
    WITH src AS (
        SELECT
            z.blockheight,
            z.transactionid,
            z.vout,
            z.spendingblock,
            %s::text AS source_table
        FROM (
            {P2PK_OUTPUTS_SELECT.format(source=qualify(SCHEMA, part.name))}
            UNION ALL
            {P2PKH_OUTPUTS_SELECT.format(source=qualify(SCHEMA, part.name))}
            UNION ALL
            {P2WPKH_OUTPUTS_SELECT.format(source=qualify(SCHEMA, part.name))}
        ) z
        WHERE z.keyhash20 IS NOT NULL
          AND z.blockheight <= %s
          AND z.spendingblock > %s
          AND z.spendingblock <= %s
    ),
    upd AS (
        UPDATE {qualify(SCHEMA, TABLE_NAME)} t
        SET
            isspent = true,
            spendingblock = s.spendingblock,
            source_table = s.source_table
        FROM src s
        WHERE t.blockheight = s.blockheight
          AND t.transactionid = s.transactionid
          AND t.vout = s.vout
          AND t.isspent = false
        RETURNING 1
    )
    SELECT COUNT(*) FROM upd;
    """
    cur.execute(sql, (part.name, new_freeze, prev_freeze, new_freeze))
    return int(cur.fetchone()[0])


def print_summary(cur):
    row = fetch_one(
        cur,
        f"""
        SELECT
            COUNT(*) AS row_count,
            COUNT(DISTINCT keyhash20) AS key_count,
            COUNT(*) FILTER (WHERE isspent = false) AS unspent_rows,
            COALESCE(SUM(amount) FILTER (WHERE isspent = false), 0) AS unspent_sats,
            COUNT(*) FILTER (WHERE isspent = true) AS spent_rows
        FROM {qualify(SCHEMA, TABLE_NAME)};
        """
    )
    print(f"rows total           : {row[0]:,}")
    print(f"distinct keys        : {row[1]:,}")
    print(f"unspent rows         : {row[2]:,}")
    print(f"unspent btc          : {row[3] / 100_000_000:,.8f}")
    print(f"spent rows           : {row[4]:,}")


def main():
    args = parse_args()

    conn = connect()
    conn.autocommit = False

    try:
        with conn.cursor() as cur:
            ensure_supporting_objects(cur)
            ensure_table_exists(cur)

            previous_freeze = get_table_previous_freeze(cur)
            latest_part = get_latest_stxo_partition(cur)
            all_parts = list_stxo_partitions(cur)

            safe_freeze = get_safe_freeze_height(cur, latest_part)
            if args.freeze_height is not None:
                if args.freeze_height > safe_freeze:
                    raise RuntimeError(
                        f"Requested freeze ({args.freeze_height}) exceeds safe freeze ({safe_freeze})."
                    )
                new_freeze = args.freeze_height
            else:
                new_freeze = safe_freeze
            upsert_source_freeze(cur, new_freeze)

            if previous_freeze is None:
                raise RuntimeError(
                    "No previous analysis_freeze row found for key_outputs_all. "
                    "Add it once with the height of your initial full build."
                )

            if new_freeze < previous_freeze:
                raise RuntimeError(
                    f"Freeze moved backwards ({previous_freeze} -> {new_freeze}). "
                    "Use a full rebuild instead."
                )

            if new_freeze == previous_freeze:
                print("Freeze height unchanged. Nothing to do.")
                return

            print(f"updating              : {TABLE_NAME}")
            print(f"source freeze name    : {SOURCE_FREEZE_NAME}")
            print(f"table freeze name     : {TABLE_FREEZE_NAME}")
            print(f"previous freeze       : {previous_freeze}")
            print(f"new freeze            : {new_freeze}")
            print(f"latest stxo partition : {latest_part.name}")
            print(f"stxo partitions       : {len(all_parts)}")
            print()

            inserted_outputs = insert_new_outputs_from_outputs(cur, previous_freeze, new_freeze)
            print(f"inserted new from outputs                      : {inserted_outputs:,}")

            inserted_latest_unspent = insert_new_outputs_from_latest_stxo_unspent_asof_freeze(
                cur, latest_part, previous_freeze, new_freeze
            )
            print(f"inserted new from latest stxo still-unspent   : {inserted_latest_unspent:,}")

            total_new_spent = 0
            total_updated_spent = 0
            for part in all_parts:
                inserted = insert_new_outputs_from_stxo_spent_asof_freeze(cur, part, previous_freeze, new_freeze)
                total_new_spent += inserted
                updated = update_existing_rows_that_became_spent(cur, part, previous_freeze, new_freeze)
                total_updated_spent += updated
                if inserted or updated:
                    print(
                        f"{part.name:<30} new_spent_rows={inserted:,} "
                        f"updated_existing_to_spent={updated:,}"
                    )

            print()
            print(f"inserted new spent rows from stxos            : {total_new_spent:,}")
            print(f"updated existing rows that became spent       : {total_updated_spent:,}")
            print()

            cur.execute(f"ANALYZE {qualify(SCHEMA, TABLE_NAME)};")
            upsert_table_freeze(cur, new_freeze)
            print_summary(cur)

        conn.commit()
        print("\nupdate committed")

    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
