#!/usr/bin/env python3
"""Incrementally update webapp_data/blockheight_datetime_lookup.csv from blockheader."""

from __future__ import annotations

import argparse
import csv
import os
from pathlib import Path

import psycopg2
from dotenv import load_dotenv
from pipeline_paths import QUANTUM_DIR, resolve_env_file

WEBAPP_DATA_DIR = QUANTUM_DIR / "webapp_data"
LOOKUP_PATH = WEBAPP_DATA_DIR / "blockheight_datetime_lookup.csv"
SCHEMA = "public"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Update blockheight_datetime_lookup.csv from PostgreSQL blockheader"
    )
    parser.add_argument(
        "--env-file",
        default=str(resolve_env_file()),
        help="Path to .env file with PostgreSQL credentials",
    )
    return parser.parse_args()


def connect_db() -> psycopg2.extensions.connection:
    return psycopg2.connect(
        host=os.getenv("POSTGRES_HOST"),
        database=os.getenv("POSTGRES_DB"),
        user=os.getenv("POSTGRES_USER"),
        password=os.getenv("POSTGRES_PASSWORD"),
    )


def qualify(schema: str, table: str) -> str:
    return f'"{schema}"."{table}"'


def load_existing_lookup() -> tuple[dict[int, int], int]:
    if not LOOKUP_PATH.exists():
        return {}, -1

    rows_by_height: dict[int, int] = {}
    max_height = -1
    with open(LOOKUP_PATH, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                height = int(str(row.get("blockheight", "")).strip())
                unix_time = int(str(row.get("unix_time", "")).strip())
            except ValueError:
                continue
            rows_by_height[height] = unix_time
            if height > max_height:
                max_height = height

    return rows_by_height, max_height


def write_lookup(rows_by_height: dict[int, int]) -> None:
    LOOKUP_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(LOOKUP_PATH, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["blockheight", "unix_time"])
        for height in sorted(rows_by_height.keys()):
            writer.writerow([height, rows_by_height[height]])


def main() -> None:
    args = parse_args()
    load_dotenv(dotenv_path=Path(args.env_file))

    existing_rows, max_existing_height = load_existing_lookup()
    print(f"Existing lookup rows      : {len(existing_rows):,}")
    print(f"Existing max blockheight  : {max_existing_height:,}")

    conn = connect_db()
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute(f"SELECT MAX(blockheight) FROM {qualify(SCHEMA, 'blockheader')};")
            row = cur.fetchone()
            tip = int(row[0]) if row and row[0] is not None else -1
            print(f"Current chain tip         : {tip:,}")

            if tip <= max_existing_height:
                print("Lookup already up-to-date.")
                return

            cur.execute(
                f"""
                SELECT blockheight, time
                FROM {qualify(SCHEMA, 'blockheader')}
                WHERE blockheight > %s
                ORDER BY blockheight ASC
                """,
                (max_existing_height,),
            )
            fetched = 0
            for blockheight, unix_time in cur.fetchall():
                existing_rows[int(blockheight)] = int(unix_time)
                fetched += 1

            write_lookup(existing_rows)
            print(f"Added lookup rows         : {fetched:,}")
            print(f"Total lookup rows         : {len(existing_rows):,}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
