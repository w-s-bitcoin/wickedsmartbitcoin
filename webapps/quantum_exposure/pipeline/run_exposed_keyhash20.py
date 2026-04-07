#!/usr/bin/env python3
"""Update exposed_keyhash20 incrementally from key_outputs_all."""

import os
from pathlib import Path

import psycopg2
from dotenv import load_dotenv
from pipeline_paths import resolve_env_file

env_path = resolve_env_file()
load_dotenv(dotenv_path=env_path)

SCHEMA = "public"
SOURCE_FREEZE_NAME = "key_outputs_all"
TARGET_TABLE = "exposed_keyhash20"


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


def ensure_target_table(cur):
    cur.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {qualify(SCHEMA, TARGET_TABLE)} (
            keyhash20 BYTEA PRIMARY KEY,
            exposed_height BIGINT NOT NULL
        );
        """
    )
    cur.execute(
        f"""
        CREATE INDEX IF NOT EXISTS exposed_keyhash20_height_idx
        ON {qualify(SCHEMA, TARGET_TABLE)} (exposed_height);
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


def get_target_previous_freeze(cur):
    row = fetch_one(
        cur,
        f"""
        SELECT freeze_blockheight
        FROM {qualify(SCHEMA, 'analysis_freeze')}
        WHERE name = %s
        """,
        (TARGET_TABLE,),
    )
    return None if row is None else int(row[0])


def upsert_target_freeze(cur, freeze_height: int):
    cur.execute(
        f"""
        INSERT INTO {qualify(SCHEMA, 'analysis_freeze')} (name, freeze_blockheight)
        VALUES (%s, %s)
        ON CONFLICT (name) DO UPDATE
        SET freeze_blockheight = EXCLUDED.freeze_blockheight
        """,
        (TARGET_TABLE, freeze_height),
    )


def insert_new_exposures(cur, previous_freeze: int, freeze_height: int) -> int:
    cur.execute(
        f"""
        INSERT INTO {qualify(SCHEMA, TARGET_TABLE)} (keyhash20, exposed_height)
        SELECT
            x.keyhash20,
            MIN(x.exposed_height) AS exposed_height
        FROM (
            SELECT
                k.keyhash20,
                k.blockheight AS exposed_height
            FROM {qualify(SCHEMA, 'key_outputs_all')} k
            WHERE k.script_type = 'pubkey'
              AND k.blockheight > %s
              AND k.blockheight <= %s

            UNION ALL

            SELECT
                k.keyhash20,
                k.spendingblock AS exposed_height
            FROM {qualify(SCHEMA, 'key_outputs_all')} k
            WHERE k.isspent = true
              AND k.spendingblock IS NOT NULL
              AND k.spendingblock > %s
              AND k.spendingblock <= %s
        ) x
        WHERE x.keyhash20 IS NOT NULL
        GROUP BY x.keyhash20
        ON CONFLICT (keyhash20) DO UPDATE
        SET exposed_height = LEAST({qualify(SCHEMA, TARGET_TABLE)}.exposed_height, EXCLUDED.exposed_height);
        """,
        (previous_freeze, freeze_height, previous_freeze, freeze_height),
    )
    return cur.rowcount


def main():
    conn = connect()
    conn.autocommit = False

    try:
        with conn.cursor() as cur:
            ensure_analysis_freeze(cur)
            ensure_target_table(cur)

            freeze_height = get_source_freeze_height(cur)
            previous_freeze = get_target_previous_freeze(cur)

            if previous_freeze is None:
                raise RuntimeError(
                    "No analysis_freeze row found for 'exposed_keyhash20'. "
                    "Run the initial build first or seed the checkpoint manually."
                )

            if freeze_height < previous_freeze:
                raise RuntimeError(
                    f"Freeze moved backwards ({previous_freeze} -> {freeze_height}). "
                    "Use a full rebuild instead."
                )

            print(f"source freeze name    : {SOURCE_FREEZE_NAME}")
            print(f"target table          : {TARGET_TABLE}")
            print(f"previous freeze       : {previous_freeze:,}")
            print(f"new freeze            : {freeze_height:,}")
            print()

            if freeze_height == previous_freeze:
                print("Freeze height unchanged. Nothing to do.")
                return

            inserted = insert_new_exposures(cur, previous_freeze, freeze_height)
            print(f"distinct keyhash20 inserted/updated      : {inserted:,}")

            cur.execute(f"ANALYZE {qualify(SCHEMA, TARGET_TABLE)};")
            upsert_target_freeze(cur, freeze_height)

            cur.execute(
                f"""
                SELECT COUNT(*), MIN(exposed_height), MAX(exposed_height)
                FROM {qualify(SCHEMA, TARGET_TABLE)};
                """
            )
            total, min_h, max_h = cur.fetchone()
            print(f"rows total                               : {total:,}")
            print(f"min exposed_height                       : {min_h:,}")
            print(f"max exposed_height                       : {max_h:,}")

        conn.commit()
        print("\nupdate committed")

    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
