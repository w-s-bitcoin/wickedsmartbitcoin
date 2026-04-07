#!/usr/bin/env python3
"""Update an active script-hash outputs table incrementally."""

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

STRUCTURE_FREEZE_NAME = "exposure_analysis"
SCHEMA = "public"
STXO_NAME_RE = re.compile(r"^stxos_(\d+)_(\d+)_archive$")


@dataclass(frozen=True)
class StxoPartition:
    lo: int
    hi: int
    name: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Update an active script-hash outputs table incrementally")
    parser.add_argument("--table", required=True, choices=["active_p2sh_outputs", "active_p2wsh_outputs"])
    parser.add_argument("--scripttype", required=True, choices=["scripthash", "witness_v0_scripthash"])
    parser.add_argument("--exposed-table", required=True, choices=["exposed_p2sh_address", "exposed_p2wsh_address"])
    return parser.parse_args()


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


def get_checkpoint(cur, name: str):
    row = fetch_one(
        cur,
        f"""
        SELECT freeze_blockheight
        FROM {qualify(SCHEMA, 'analysis_freeze')}
        WHERE name = %s
        """,
        (name,),
    )
    return None if row is None else int(row[0])


def upsert_table_freeze(cur, table_name: str, freeze_height: int):
    cur.execute(
        f"""
        INSERT INTO {qualify(SCHEMA, 'analysis_freeze')} (name, freeze_blockheight)
        VALUES (%s, %s)
        ON CONFLICT (name) DO UPDATE
        SET freeze_blockheight = EXCLUDED.freeze_blockheight
        """,
        (table_name, freeze_height),
    )


def ensure_final_table(cur, table_name: str):
    table_qname = qualify(SCHEMA, table_name)
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
            is_exposed     boolean NOT NULL DEFAULT false,
            PRIMARY KEY (blockheight, transactionid, vout)
        );
        """
    )
    cur.execute(f"ALTER TABLE {table_qname} ADD COLUMN IF NOT EXISTS is_exposed boolean;")
    cur.execute(f"UPDATE {table_qname} SET is_exposed = FALSE WHERE is_exposed IS NULL;")
    cur.execute(f"ALTER TABLE {table_qname} ALTER COLUMN is_exposed SET DEFAULT false;")
    cur.execute(f"CREATE INDEX IF NOT EXISTS {quote_ident(table_name + '_address_idx')} ON {table_qname} (address);")
    cur.execute(f"CREATE INDEX IF NOT EXISTS {quote_ident(table_name + '_address_block_idx')} ON {table_qname} (address, blockheight);")
    cur.execute(f"CREATE INDEX IF NOT EXISTS {quote_ident(table_name + '_address_spendingblock_idx')} ON {table_qname} (address, spendingblock) WHERE spendingblock IS NOT NULL;")
    cur.execute(f"CREATE INDEX IF NOT EXISTS {quote_ident(table_name + '_unspent_address_idx')} ON {table_qname} (address) INCLUDE (amount, blockheight, transactionid, vout) WHERE isspent = false;")
    cur.execute(f"CREATE INDEX IF NOT EXISTS {quote_ident(table_name + '_is_exposed_idx')} ON {table_qname} (is_exposed);")


def create_temp_tables(cur):
    cur.execute("DROP TABLE IF EXISTS tmp_changed_addresses;")
    cur.execute("DROP TABLE IF EXISTS tmp_active_changed_addresses;")
    cur.execute("CREATE TEMP TABLE tmp_changed_addresses (address text PRIMARY KEY) ON COMMIT DROP;")
    cur.execute("CREATE TEMP TABLE tmp_active_changed_addresses (address text PRIMARY KEY) ON COMMIT DROP;")


def seed_changed_addresses_from_outputs(cur, scripttype: str, previous_freeze: int, freeze_height: int):
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
        (scripttype, previous_freeze, freeze_height),
    )


def seed_changed_addresses_from_latest_stxo_new_unspent(cur, latest_part: StxoPartition, scripttype: str, previous_freeze: int, freeze_height: int):
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
        (scripttype, previous_freeze, freeze_height, freeze_height),
    )


def seed_changed_addresses_from_spends(cur, part: StxoPartition, scripttype: str, previous_freeze: int, freeze_height: int):
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
        (scripttype, previous_freeze, freeze_height),
    )


def seed_changed_addresses_from_exposure(cur, exposed_table: str, previous_freeze: int, freeze_height: int):
    cur.execute(
        f"""
        INSERT INTO tmp_changed_addresses (address)
        SELECT e.address
        FROM {qualify(SCHEMA, exposed_table)} e
        WHERE e.exposed_height > %s
          AND e.exposed_height <= %s
        ON CONFLICT DO NOTHING;
        """,
        (previous_freeze, freeze_height),
    )


def seed_active_changed_addresses_from_outputs(cur, scripttype: str, freeze_height: int):
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
        (scripttype, freeze_height),
    )


def seed_active_changed_addresses_from_latest_stxo(cur, latest_part: StxoPartition, scripttype: str, freeze_height: int):
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
        (scripttype, freeze_height, freeze_height),
    )


def count_temp_addresses(cur):
    changed_count = fetch_one(cur, "SELECT COUNT(*) FROM tmp_changed_addresses;")[0]
    active_changed_count = fetch_one(cur, "SELECT COUNT(*) FROM tmp_active_changed_addresses;")[0]
    return int(changed_count), int(active_changed_count)


def delete_changed_addresses(cur, table_name: str) -> int:
    cur.execute(
        f"""
        DELETE FROM {qualify(SCHEMA, table_name)} t
        USING tmp_changed_addresses c
        WHERE t.address = c.address;
        """
    )
    return cur.rowcount


def upsert_current_unspent_rows(cur, table_name: str, exposed_table: str, scripttype: str, freeze_height: int) -> int:
    cur.execute(
        f"""
        INSERT INTO {qualify(SCHEMA, table_name)}
            (address, blockheight, transactionid, vout, amount, isspent, spendingblock, is_exposed)
        SELECT
            o.address,
            o.blockheight,
            o.transactionid,
            o.vout,
            o.amount,
            false AS isspent,
            NULL::bigint AS spendingblock,
            (e.address IS NOT NULL) AS is_exposed
        FROM {qualify(SCHEMA, 'outputs')} o
        JOIN tmp_active_changed_addresses a
          ON a.address = o.address
        LEFT JOIN {qualify(SCHEMA, exposed_table)} e
          ON e.address = o.address
         AND e.exposed_height <= %s
        WHERE o.scripttype = %s
          AND o.blockheight <= %s
          AND o.isspent = false
        ON CONFLICT (blockheight, transactionid, vout) DO UPDATE
        SET address = EXCLUDED.address,
            amount = EXCLUDED.amount,
            isspent = EXCLUDED.isspent,
            spendingblock = EXCLUDED.spendingblock,
            is_exposed = EXCLUDED.is_exposed;
        """,
        (freeze_height, scripttype, freeze_height),
    )
    return cur.rowcount


def upsert_historical_rows_from_partition(cur, table_name: str, exposed_table: str, part: StxoPartition, scripttype: str, freeze_height: int) -> int:
    cur.execute(
        f"""
        INSERT INTO {qualify(SCHEMA, table_name)}
            (address, blockheight, transactionid, vout, amount, isspent, spendingblock, is_exposed)
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
            END AS spendingblock,
            (e.address IS NOT NULL) AS is_exposed
        FROM {qualify(SCHEMA, part.name)} s
        JOIN tmp_active_changed_addresses a
          ON a.address = s.address
        LEFT JOIN {qualify(SCHEMA, exposed_table)} e
          ON e.address = s.address
         AND e.exposed_height <= %s
        WHERE s.scripttype = %s
          AND s.blockheight <= %s
        ON CONFLICT (blockheight, transactionid, vout) DO UPDATE
        SET address = EXCLUDED.address,
            amount = EXCLUDED.amount,
            isspent = EXCLUDED.isspent,
            spendingblock = EXCLUDED.spendingblock,
            is_exposed = EXCLUDED.is_exposed;
        """,
        (freeze_height, freeze_height, freeze_height, scripttype, freeze_height),
    )
    return cur.rowcount


def print_table_summary(cur, table_name: str):
    row = fetch_one(
        cur,
        f"""
        SELECT
            COUNT(*) AS row_count,
            COUNT(DISTINCT address) AS address_count,
            COUNT(*) FILTER (WHERE isspent = false) AS utxo_count,
            COALESCE(SUM(amount) FILTER (WHERE isspent = false), 0) AS utxo_sats,
            COUNT(*) FILTER (WHERE is_exposed) AS exposed_rows,
            COUNT(DISTINCT address) FILTER (WHERE is_exposed) AS exposed_addresses,
            COALESCE(SUM(amount) FILTER (WHERE is_exposed AND isspent = false), 0) AS exposed_utxo_sats
        FROM {qualify(SCHEMA, table_name)};
        """
    )
    print(f"rows total           : {row[0]:,}")
    print(f"distinct addresses   : {row[1]:,}")
    print(f"unspent rows         : {row[2]:,}")
    print(f"unspent btc          : {row[3] / 100_000_000:,.8f}")
    print(f"exposed rows         : {row[4]:,}")
    print(f"exposed addresses    : {row[5]:,}")
    print(f"exposed unspent btc  : {row[6] / 100_000_000:,.8f}")


def main():
    args = parse_args()
    table_name = args.table
    scripttype = args.scripttype
    exposed_table = args.exposed_table

    conn = connect()
    conn.autocommit = False

    try:
        with conn.cursor() as cur:
            ensure_analysis_freeze(cur)

            structure_height = get_checkpoint(cur, STRUCTURE_FREEZE_NAME)
            if structure_height is None:
                raise RuntimeError(f"No analysis_freeze row found for {STRUCTURE_FREEZE_NAME!r}")

            latest_part = get_latest_stxo_partition(cur)
            all_parts = list_stxo_partitions(cur)

            print("=" * 88)
            print(f"updating {table_name}")
            print("=" * 88)

            ensure_final_table(cur, table_name)
            previous_freeze = get_checkpoint(cur, table_name)
            exposure_height = get_checkpoint(cur, exposed_table)

            if previous_freeze is None:
                raise RuntimeError(
                    f"No analysis_freeze row found for {table_name!r}. Seed it once using the current max(blockheight) from that table."
                )
            if exposure_height is None:
                raise RuntimeError(
                    f"No analysis_freeze row found for {exposed_table!r}. Run the exposed address builder first."
                )

            freeze_height = min(structure_height, exposure_height)
            if freeze_height < previous_freeze:
                raise RuntimeError(
                    f"{table_name}: effective freeze moved backwards ({previous_freeze} -> {freeze_height}). Use a full rebuild instead."
                )

            if freeze_height == previous_freeze:
                print(f"structure freeze      : {structure_height}")
                print(f"exposure freeze       : {exposure_height}")
                print(f"effective freeze      : {freeze_height}")
                print("freeze height unchanged. nothing to do.\n")
                return

            create_temp_tables(cur)
            seed_changed_addresses_from_outputs(cur, scripttype, previous_freeze, freeze_height)
            seed_changed_addresses_from_latest_stxo_new_unspent(cur, latest_part, scripttype, previous_freeze, freeze_height)
            for part in all_parts:
                seed_changed_addresses_from_spends(cur, part, scripttype, previous_freeze, freeze_height)
            seed_changed_addresses_from_exposure(cur, exposed_table, previous_freeze, freeze_height)
            seed_active_changed_addresses_from_outputs(cur, scripttype, freeze_height)
            seed_active_changed_addresses_from_latest_stxo(cur, latest_part, scripttype, freeze_height)

            changed_count, active_changed_count = count_temp_addresses(cur)
            print(f"previous freeze       : {previous_freeze}")
            print(f"structure freeze      : {structure_height}")
            print(f"exposure freeze       : {exposure_height}")
            print(f"effective freeze      : {freeze_height}")
            print(f"changed addresses     : {changed_count:,}")
            print(f"active changed now    : {active_changed_count:,}")
            print(f"latest stxo partition : {latest_part.name}")
            print()

            if changed_count == 0:
                upsert_table_freeze(cur, table_name, freeze_height)
                print("no changed addresses found")
                print()
                print_table_summary(cur, table_name)
                print()
                conn.commit()
                print("update committed")
                return

            deleted_rows = delete_changed_addresses(cur, table_name)
            print(f"deleted rows for changed addresses       : {deleted_rows:,}")

            current_upserts = 0
            if active_changed_count > 0:
                current_upserts = upsert_current_unspent_rows(cur, table_name, exposed_table, scripttype, freeze_height)
            print(f"upserted current unspent rows            : {current_upserts:,}")

            total_stxo_upserts = 0
            if active_changed_count > 0:
                for part in all_parts:
                    changed = upsert_historical_rows_from_partition(cur, table_name, exposed_table, part, scripttype, freeze_height)
                    total_stxo_upserts += changed
                    if changed:
                        print(f"upserted from {part.name:<28}: {changed:,}")

            print(f"total historical stxo upserts            : {total_stxo_upserts:,}")
            cur.execute(f"UPDATE {qualify(SCHEMA, table_name)} SET is_exposed = FALSE WHERE is_exposed IS NULL;")
            cur.execute(f"ANALYZE {qualify(SCHEMA, table_name)};")
            upsert_table_freeze(cur, table_name, freeze_height)
            print()
            print_table_summary(cur, table_name)
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
