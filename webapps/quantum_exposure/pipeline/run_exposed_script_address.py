#!/usr/bin/env python3
"""Update an exposed script-address table incrementally."""

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

SCHEMA = "public"
SOURCE_FREEZE_NAME = "exposure_analysis"
STXO_NAME_RE = re.compile(r"^stxos_(\d+)_(\d+)_archive$")


@dataclass(frozen=True)
class StxoPartition:
    lo: int
    hi: int
    name: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Update an exposed script-address table incrementally")
    parser.add_argument("--table", required=True, choices=["exposed_p2sh_address", "exposed_p2wsh_address"])
    parser.add_argument("--scripttype", required=True, choices=["scripthash", "witness_v0_scripthash"])
    return parser.parse_args()


def connect():
    return psycopg2.connect(
        host=os.getenv("POSTGRES_HOST"),
        database=os.getenv("POSTGRES_DB"),
        user=os.getenv("POSTGRES_USER"),
        password=os.getenv("POSTGRES_PASSWORD"),
    )


def qualify(schema: str, table: str) -> str:
    return f'"{schema}"."{table}"'


def fetch_one(cur, sql: str, params=None):
    cur.execute(sql, params or ())
    return cur.fetchone()


def ensure_analysis_freeze(cur):
    cur.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {qualify(SCHEMA, 'analysis_freeze')} (
            name text PRIMARY KEY,
            freeze_blockheight bigint NOT NULL
        );
        """
    )


def ensure_target_table(cur, table_name: str):
    cur.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {qualify(SCHEMA, table_name)} (
            address TEXT PRIMARY KEY,
            exposed_height BIGINT NOT NULL
        );
        """
    )
    cur.execute(
        f"""
        CREATE INDEX IF NOT EXISTS "{table_name}_height_idx"
        ON {qualify(SCHEMA, table_name)} (exposed_height);
        """
    )


def get_source_freeze_height(cur) -> int:
    row = fetch_one(
        cur,
        f"""
        SELECT freeze_blockheight
        FROM {qualify(SCHEMA, 'analysis_freeze')}
        WHERE name = %s
        """,
        (SOURCE_FREEZE_NAME,),
    )
    if row is None:
        raise RuntimeError(f"No analysis_freeze row found for {SOURCE_FREEZE_NAME!r}")
    return int(row[0])


def get_target_previous_freeze(cur, table_name: str):
    row = fetch_one(
        cur,
        f"""
        SELECT freeze_blockheight
        FROM {qualify(SCHEMA, 'analysis_freeze')}
        WHERE name = %s
        """,
        (table_name,),
    )
    return None if row is None else int(row[0])


def upsert_target_freeze(cur, table_name: str, freeze_height: int):
    cur.execute(
        f"""
        INSERT INTO {qualify(SCHEMA, 'analysis_freeze')} (name, freeze_blockheight)
        VALUES (%s, %s)
        ON CONFLICT (name) DO UPDATE
        SET freeze_blockheight = EXCLUDED.freeze_blockheight
        """,
        (table_name, freeze_height),
    )


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


def insert_from_partition(cur, table_name: str, scripttype: str, part: StxoPartition, previous_freeze: int, freeze_height: int) -> int:
    cur.execute(
        f"""
        INSERT INTO {qualify(SCHEMA, table_name)} (address, exposed_height)
        SELECT
            s.address,
            MIN(s.spendingblock) AS exposed_height
        FROM {qualify(SCHEMA, part.name)} s
        WHERE s.scripttype = %s
          AND s.address IS NOT NULL
          AND s.spendingblock > %s
          AND s.spendingblock <= %s
        GROUP BY s.address
        ON CONFLICT (address) DO UPDATE
        SET exposed_height = LEAST(
            {qualify(SCHEMA, table_name)}.exposed_height,
            EXCLUDED.exposed_height
        );
        """,
        (scripttype, previous_freeze, freeze_height),
    )
    return cur.rowcount


def print_summary(cur, table_name: str):
    cur.execute(
        f"""
        SELECT COUNT(*), MIN(exposed_height), MAX(exposed_height)
        FROM {qualify(SCHEMA, table_name)};
        """
    )
    total, min_h, max_h = cur.fetchone()
    print(f"rows total                             : {total:,}")
    print(f"min exposed_height                     : {min_h:,}")
    print(f"max exposed_height                     : {max_h:,}")


def main():
    args = parse_args()
    table_name = args.table
    scripttype = args.scripttype

    conn = connect()
    conn.autocommit = False

    try:
        with conn.cursor() as cur:
            ensure_analysis_freeze(cur)
            ensure_target_table(cur, table_name)

            freeze_height = get_source_freeze_height(cur)
            all_parts = list_stxo_partitions(cur)
            previous_freeze = get_target_previous_freeze(cur, table_name)

            if previous_freeze is None:
                raise RuntimeError(
                    f"No analysis_freeze row found for {table_name!r}. Run the initial build first."
                )

            if freeze_height < previous_freeze:
                raise RuntimeError(
                    f"{table_name}: freeze moved backwards ({previous_freeze} -> {freeze_height}). Use a full rebuild instead."
                )

            print("=" * 88)
            print(f"updating {table_name}")
            print("=" * 88)
            print(f"source freeze name    : {SOURCE_FREEZE_NAME}")
            print(f"previous freeze       : {previous_freeze:,}")
            print(f"new freeze            : {freeze_height:,}")
            print(f"stxo partitions       : {len(all_parts)}")
            print()

            if freeze_height == previous_freeze:
                print("Freeze height unchanged. Nothing to do.")
                print()
                return

            total_rows = 0
            for part in all_parts:
                inserted = insert_from_partition(cur, table_name, scripttype, part, previous_freeze, freeze_height)
                total_rows += inserted
                if inserted:
                    print(f"{part.name:<30} inserted/updated={inserted:,}")

            print()
            print(f"total inserted/updated                 : {total_rows:,}")
            cur.execute(f"ANALYZE {qualify(SCHEMA, table_name)};")
            upsert_target_freeze(cur, table_name, freeze_height)
            print_summary(cur, table_name)
            print()

        conn.commit()
        print("update committed")

    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
