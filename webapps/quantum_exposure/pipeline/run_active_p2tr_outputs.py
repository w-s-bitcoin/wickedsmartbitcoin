#!/usr/bin/env python3
"""Update active_p2tr_outputs incrementally."""

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
TARGET_TABLE = "active_p2tr_outputs"
SCRIPT_TYPE = "witness_v1_taproot"
SCHEMA = "public"
STXO_NAME_RE = re.compile(r"^stxos_(\d+)_(\d+)_archive$")


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
    table_qname = qualify(SCHEMA, TARGET_TABLE)
    cur.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {table_qname} (
            address        text    NOT NULL,
            blockheight    bigint  NOT NULL,
            transactionid  text    NOT NULL,
            vout           integer NOT NULL,
            amount         bigint  NOT NULL,
            isspent        boolean NOT NULL,
            spendingblock  bigint,
            PRIMARY KEY (blockheight, transactionid, vout)
        );
        """
    )
    cur.execute(f"CREATE INDEX IF NOT EXISTS {quote_ident(TARGET_TABLE + '_address_idx')} ON {table_qname} (address);")
    cur.execute(f"CREATE INDEX IF NOT EXISTS {quote_ident(TARGET_TABLE + '_address_block_idx')} ON {table_qname} (address, blockheight);")
    cur.execute(f"CREATE INDEX IF NOT EXISTS {quote_ident(TARGET_TABLE + '_address_spendingblock_idx')} ON {table_qname} (address, spendingblock) WHERE spendingblock IS NOT NULL;")
    cur.execute(f"CREATE INDEX IF NOT EXISTS {quote_ident(TARGET_TABLE + '_unspent_address_idx')} ON {table_qname} (address) INCLUDE (amount, blockheight, transactionid, vout) WHERE isspent = false;")


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


def create_temp_tables(cur):
    cur.execute("DROP TABLE IF EXISTS tmp_changed_addresses;")
    cur.execute("DROP TABLE IF EXISTS tmp_active_changed_addresses;")
    cur.execute("CREATE TEMP TABLE tmp_changed_addresses (address text PRIMARY KEY) ON COMMIT DROP;")
    cur.execute("CREATE TEMP TABLE tmp_active_changed_addresses (address text PRIMARY KEY) ON COMMIT DROP;")


def seed_changed_addresses_from_outputs(cur, previous_freeze: int, freeze_height: int):
    cur.execute(
        f"""
        INSERT INTO tmp_changed_addresses (address)
        SELECT DISTINCT o.address
        FROM {qualify(SCHEMA, 'outputs')} o
        WHERE o.scripttype = %s
          AND o.blockheight > %s
          AND o.blockheight <= %s
          AND o.address IS NOT NULL
        ON CONFLICT DO NOTHING;
        """,
        (SCRIPT_TYPE, previous_freeze, freeze_height),
    )


def seed_changed_addresses_from_latest_stxo_new_unspent(cur, latest_part: StxoPartition, previous_freeze: int, freeze_height: int):
    cur.execute(
        f"""
        INSERT INTO tmp_changed_addresses (address)
        SELECT DISTINCT s.address
        FROM {qualify(SCHEMA, latest_part.name)} s
        WHERE s.scripttype = %s
          AND s.blockheight > %s
          AND s.blockheight <= %s
          AND s.spendingblock > %s
          AND s.address IS NOT NULL
        ON CONFLICT DO NOTHING;
        """,
        (SCRIPT_TYPE, previous_freeze, freeze_height, freeze_height),
    )


def seed_changed_addresses_from_spends(cur, part: StxoPartition, previous_freeze: int, freeze_height: int):
    cur.execute(
        f"""
        INSERT INTO tmp_changed_addresses (address)
        SELECT DISTINCT s.address
        FROM {qualify(SCHEMA, part.name)} s
        WHERE s.scripttype = %s
          AND s.spendingblock > %s
          AND s.spendingblock <= %s
          AND s.address IS NOT NULL
        ON CONFLICT DO NOTHING;
        """,
        (SCRIPT_TYPE, previous_freeze, freeze_height),
    )


def seed_active_changed_addresses_from_outputs(cur, freeze_height: int):
    cur.execute(
        f"""
        INSERT INTO tmp_active_changed_addresses (address)
        SELECT DISTINCT o.address
        FROM {qualify(SCHEMA, 'outputs')} o
        JOIN tmp_changed_addresses c
          ON c.address = o.address
        WHERE o.scripttype = %s
          AND o.blockheight <= %s
          AND o.isspent = false
          AND o.address IS NOT NULL
        ON CONFLICT DO NOTHING;
        """,
        (SCRIPT_TYPE, freeze_height),
    )


def seed_active_changed_addresses_from_latest_stxo(cur, latest_part: StxoPartition, freeze_height: int):
    cur.execute(
        f"""
        INSERT INTO tmp_active_changed_addresses (address)
        SELECT DISTINCT s.address
        FROM {qualify(SCHEMA, latest_part.name)} s
        JOIN tmp_changed_addresses c
          ON c.address = s.address
        WHERE s.scripttype = %s
          AND s.blockheight <= %s
          AND s.spendingblock > %s
          AND s.address IS NOT NULL
        ON CONFLICT DO NOTHING;
        """,
        (SCRIPT_TYPE, freeze_height, freeze_height),
    )


def count_temp_addresses(cur):
    changed_count = fetch_one(cur, "SELECT COUNT(*) FROM tmp_changed_addresses;")[0]
    active_changed_count = fetch_one(cur, "SELECT COUNT(*) FROM tmp_active_changed_addresses;")[0]
    return int(changed_count), int(active_changed_count)


def delete_changed_addresses(cur) -> int:
    cur.execute(
        f"""
        DELETE FROM {qualify(SCHEMA, TARGET_TABLE)} t
        USING tmp_changed_addresses c
        WHERE t.address = c.address;
        """
    )
    return cur.rowcount


def upsert_current_unspent_rows(cur, freeze_height: int) -> int:
    cur.execute(
        f"""
        INSERT INTO {qualify(SCHEMA, TARGET_TABLE)}
            (address, blockheight, transactionid, vout, amount, isspent, spendingblock)
        SELECT
            o.address,
            o.blockheight,
            o.transactionid,
            o.vout,
            o.amount,
            false AS isspent,
            NULL::bigint AS spendingblock
        FROM {qualify(SCHEMA, 'outputs')} o
        JOIN tmp_active_changed_addresses a
          ON a.address = o.address
        WHERE o.scripttype = %s
          AND o.blockheight <= %s
          AND o.isspent = false
        ON CONFLICT (blockheight, transactionid, vout) DO UPDATE
        SET address = EXCLUDED.address,
            amount = EXCLUDED.amount,
            isspent = EXCLUDED.isspent,
            spendingblock = EXCLUDED.spendingblock;
        """,
        (SCRIPT_TYPE, freeze_height),
    )
    return cur.rowcount


def upsert_historical_rows_from_partition(cur, part: StxoPartition, freeze_height: int) -> int:
    cur.execute(
        f"""
        INSERT INTO {qualify(SCHEMA, TARGET_TABLE)}
            (address, blockheight, transactionid, vout, amount, isspent, spendingblock)
        SELECT
            s.address,
            s.blockheight,
            s.transactionid,
            s.vout,
            s.amount,
            CASE
                WHEN s.spendingblock <= %s THEN true
                ELSE false
            END AS isspent,
            CASE
                WHEN s.spendingblock <= %s THEN s.spendingblock
                ELSE NULL::bigint
            END AS spendingblock
        FROM {qualify(SCHEMA, part.name)} s
        JOIN tmp_active_changed_addresses a
          ON a.address = s.address
        WHERE s.scripttype = %s
          AND s.blockheight <= %s
        ON CONFLICT (blockheight, transactionid, vout) DO UPDATE
        SET address = EXCLUDED.address,
            amount = EXCLUDED.amount,
            isspent = EXCLUDED.isspent,
            spendingblock = EXCLUDED.spendingblock;
        """,
        (freeze_height, freeze_height, SCRIPT_TYPE, freeze_height),
    )
    return cur.rowcount


def print_summary(cur):
    row = fetch_one(
        cur,
        f"""
        SELECT
            COUNT(*) AS row_count,
            COUNT(DISTINCT address) AS address_count,
            COUNT(*) FILTER (WHERE isspent = false) AS utxo_count,
            COALESCE(SUM(amount) FILTER (WHERE isspent = false), 0) AS utxo_sats
        FROM {qualify(SCHEMA, TARGET_TABLE)};
        """
    )
    print(f"rows total           : {row[0]:,}")
    print(f"distinct addresses   : {row[1]:,}")
    print(f"unspent rows         : {row[2]:,}")
    print(f"unspent btc          : {row[3] / 100_000_000:,.8f}")


def main():
    conn = connect()
    conn.autocommit = False

    try:
        with conn.cursor() as cur:
            ensure_analysis_freeze(cur)
            ensure_target_table(cur)

            freeze_height = get_source_freeze_height(cur)
            previous_freeze = get_target_previous_freeze(cur)
            latest_part = get_latest_stxo_partition(cur)
            all_parts = list_stxo_partitions(cur)

            if previous_freeze is None:
                raise RuntimeError(
                    "No analysis_freeze row found for 'active_p2tr_outputs'. Run the initial build first or seed the checkpoint manually."
                )
            if freeze_height < previous_freeze:
                raise RuntimeError(
                    f"Freeze moved backwards ({previous_freeze} -> {freeze_height}). Use a full rebuild instead."
                )

            print(f"source freeze name    : {SOURCE_FREEZE_NAME}")
            print(f"target table          : {TARGET_TABLE}")
            print(f"script type           : {SCRIPT_TYPE}")
            print(f"previous freeze       : {previous_freeze}")
            print(f"new freeze            : {freeze_height}")
            print(f"latest stxo partition : {latest_part.name}")
            print(f"all stxo partitions   : {len(all_parts)}")
            print()

            if freeze_height == previous_freeze:
                print("Freeze height unchanged. Nothing to do.")
                return

            create_temp_tables(cur)
            print("Collecting changed addresses from outputs...")
            seed_changed_addresses_from_outputs(cur, previous_freeze, freeze_height)
            print("Collecting changed addresses from latest stxo partition...")
            seed_changed_addresses_from_latest_stxo_new_unspent(cur, latest_part, previous_freeze, freeze_height)
            print("Collecting changed addresses from stxo spends...")
            for part in all_parts:
                seed_changed_addresses_from_spends(cur, part, previous_freeze, freeze_height)
            cur.execute("ANALYZE tmp_changed_addresses;")

            print("Collecting still-active changed addresses...")
            seed_active_changed_addresses_from_outputs(cur, freeze_height)
            seed_active_changed_addresses_from_latest_stxo(cur, latest_part, freeze_height)
            cur.execute("ANALYZE tmp_active_changed_addresses;")

            changed_count, active_changed_count = count_temp_addresses(cur)
            print(f"changed addresses     : {changed_count:,}")
            print(f"active changed now    : {active_changed_count:,}")
            print()

            if changed_count == 0:
                upsert_target_freeze(cur, freeze_height)
                print("No changed addresses found.")
                print()
                print_summary(cur)
                conn.commit()
                print("\nupdate committed")
                return

            deleted_rows = delete_changed_addresses(cur)
            print(f"deleted rows for changed addresses       : {deleted_rows:,}")

            current_rows = 0
            if active_changed_count > 0:
                current_rows = upsert_current_unspent_rows(cur, freeze_height)
            print(f"upserted current unspent rows            : {current_rows:,}")

            total_stxo_rows = 0
            if active_changed_count > 0:
                for part in all_parts:
                    changed = upsert_historical_rows_from_partition(cur, part, freeze_height)
                    total_stxo_rows += changed
                    if changed:
                        print(f"{part.name:<30} upserts={changed:,}")

            print(f"total historical stxo upserts            : {total_stxo_rows:,}")
            cur.execute(f"ANALYZE {qualify(SCHEMA, TARGET_TABLE)};")
            upsert_target_freeze(cur, freeze_height)
            print()
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
