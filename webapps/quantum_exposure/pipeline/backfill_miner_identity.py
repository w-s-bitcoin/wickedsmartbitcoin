#!/usr/bin/env python3
"""One-time backfill: set identity='Miner' on dashboard GE1 CSV rows that
received coinbase outputs and currently have empty or 'unidentified' identity labels.

For key-type outputs (P2PK, P2PKH, P2WPKH) the coinbase is matched by joining
the coinbases table to key_outputs_all via (blockheight, transactionid, vout),
which resolves the keyhash20 without requiring any client-side HASH160 computation.

For all other output types the coinbase address column is matched directly against
the group_id.
"""

from __future__ import annotations

import argparse
import csv
import os
from pathlib import Path

import psycopg2
from dotenv import load_dotenv
from pipeline_paths import QUANTUM_DIR, resolve_env_file

SCHEMA = "public"
DEFAULT_OUT_DIR = QUANTUM_DIR / "webapp_data"
DEFAULT_ENV_FILE = resolve_env_file()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--schema",
        default=SCHEMA,
        help="PostgreSQL schema (default: public)",
    )
    parser.add_argument(
        "--out-dir",
        default=str(DEFAULT_OUT_DIR),
        help=(
            "Root directory containing numbered snapshot sub-folders "
            "and optional archived snapshots sub-folder "
            "(default: webapps/quantum_exposure/webapp_data)"
        ),
    )
    parser.add_argument(
        "--env-file",
        default=str(Path(os.getenv("QUANTUM_PIPELINE_ENV_FILE", str(DEFAULT_ENV_FILE)))),
        help="Path to .env file with DB credentials",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="Report what would change without writing any files",
    )
    return parser.parse_args()


def connect(env_file: str) -> psycopg2.extensions.connection:
    load_dotenv(dotenv_path=Path(env_file))
    conn = psycopg2.connect(
        host=os.getenv("POSTGRES_HOST"),
        database=os.getenv("POSTGRES_DB"),
        user=os.getenv("POSTGRES_USER"),
        password=os.getenv("POSTGRES_PASSWORD"),
    )
    conn.autocommit = True
    return conn


def qualify(schema: str, table: str) -> str:
    return f'"{schema}"."{table}"'


def fetch_miner_group_ids(cur, schema: str) -> set[str]:
    """Return all identifiers received as coinbase outputs.

    P2PK outputs:
        Extracts the pubkey hex directly from coinbases.scripthex.
        In dashboard CSVs, P2PK rows store the pubkey hex in display_group_ids
        (not the keyhash20 that lives in group_id), so this is the value we need
        to match against.

    All other output types:
        Uses coinbases.address directly.
        In dashboard CSVs P2PKH/P2WPKH rows store the address in display_group_ids;
        P2SH/P2WSH/P2TR/Other rows store the address in both group_id and
        display_group_ids.
    """
    coinbases_qname = qualify(schema, "coinbases")

    cur.execute(
        f"""
        -- P2PK: extract pubkey hex from the script
        -- Compressed P2PK:   21 <33-byte pubkey> ac  → scripthex length 70
        -- Uncompressed P2PK: 41 <65-byte pubkey> ac  → scripthex length 134
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
            END AS identifier
        FROM {coinbases_qname} c
        WHERE c.scripttype = 'pubkey'
          AND c.scripthex IS NOT NULL AND c.scripthex <> ''

        UNION

        -- All other types: use address (P2PKH, P2WPKH, P2SH, P2WSH, P2TR, Other)
        SELECT DISTINCT c.address AS identifier
        FROM {coinbases_qname} c
        WHERE c.scripttype <> 'pubkey'
          AND c.address IS NOT NULL AND c.address <> ''
        """
    )
    return {row[0] for row in cur.fetchall() if row[0]}


def list_snapshot_csv_paths(out_dir: Path) -> list[Path]:
    """Return paths to all snapshot CSVs under active and archived folders.

    Expected structure:
      - out_dir/<height>/dashboard_pubkeys_ge_1btc.csv
      - out_dir/archived/<height>/dashboard_pubkeys_ge_1btc.csv
    """
    paths_by_height_and_path: list[tuple[int, str, Path]] = []
    if not out_dir.exists():
        return []

    search_roots = [out_dir, out_dir / "archived"]
    for root in search_roots:
        if not root.exists() or not root.is_dir():
            continue
        for child in root.iterdir():
            if not child.is_dir() or not child.name.isdigit():
                continue
            csv_path = child / "dashboard_pubkeys_ge_1btc.csv"
            if csv_path.exists():
                paths_by_height_and_path.append((int(child.name), str(csv_path), csv_path))

    paths_by_height_and_path.sort(key=lambda item: (item[0], item[1]))
    return [item[2] for item in paths_by_height_and_path]


def update_csv(
    csv_path: Path,
    miner_ids: set[str],
    dry_run: bool,
) -> tuple[int, int]:
    """Update rows in a single snapshot CSV.

    Sets identity = 'Miner' for rows where identity is empty or 'unidentified'
    and any of the
    following match an entry in miner_ids:
      - group_id (covers P2SH / P2WSH / P2TR / Other address-keyed rows)
      - any pipe-delimited token in display_group_ids:
          * P2PK rows: display_group_ids = pubkey hex  (group_id is keyhash20)
          * P2PKH / P2WPKH rows: display_group_ids = address (group_id is keyhash20)

    Returns (total_rows_checked, rows_updated).
    """
    rows: list[dict] = []
    fieldnames: list[str] = []

    with csv_path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = list(reader.fieldnames or [])
        for row in reader:
            rows.append(row)

    updated = 0
    for row in rows:
        identity = (row.get("identity") or "").strip()
        if identity and identity.lower() != "unidentified":
            continue
        # group_id match: works for P2SH / P2WSH / P2TR / Other
        group_id = (row.get("group_id") or "").strip()
        matched = group_id in miner_ids
        # display_group_ids token match: works for P2PK (pubkey hex) and
        # P2PKH / P2WPKH (address), both of which have keyhash20 in group_id
        if not matched:
            for token in (row.get("display_group_ids") or "").split("|"):
                token = token.strip()
                if token and token in miner_ids:
                    matched = True
                    break
        if matched:
            if not dry_run:
                row["identity"] = "Miner"
            updated += 1

    if updated > 0 and not dry_run:
        with csv_path.open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)

    return len(rows), updated


def main() -> None:
    args = parse_args()

    conn = connect(args.env_file)
    try:
        with conn.cursor() as cur:
            print("Fetching miner group_ids from coinbases table...")
            miner_ids = fetch_miner_group_ids(cur, args.schema)
            print(f"  {len(miner_ids):,} unique miner group_ids found")
    finally:
        conn.close()

    out_dir = Path(args.out_dir)
    csv_paths = list_snapshot_csv_paths(out_dir)
    print(f"Found {len(csv_paths):,} snapshot CSV(s) under {out_dir} (including archived)")
    print()

    total_checked = 0
    total_updated = 0
    for csv_path in csv_paths:
        checked, updated = update_csv(csv_path, miner_ids, args.dry_run)
        total_checked += checked
        total_updated += updated
        if updated:
            tag = "[DRY RUN] " if args.dry_run else ""
            print(f"{tag}{csv_path.parent.name}: {updated:,}/{checked:,} rows labeled Miner")

    print()
    tag = "[DRY RUN] " if args.dry_run else ""
    print(
        f"{tag}Done — {total_updated:,} rows updated across "
        f"{len(csv_paths):,} CSV(s) ({total_checked:,} rows checked total)"
    )


if __name__ == "__main__":
    main()
