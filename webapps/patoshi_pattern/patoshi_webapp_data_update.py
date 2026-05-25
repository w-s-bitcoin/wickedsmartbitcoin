#!/usr/bin/env python3
"""Build compact Patoshi-pattern data for the web dashboard."""

from __future__ import annotations

import csv
import json
import math
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import NamedTuple


REPO_ROOT = Path(__file__).resolve().parents[2]
SOURCE_ROOT = Path("/Users/wicked/Projects/animations/Patoshi Patterns")
BLOCK_DATA_PATH = REPO_ROOT / "assets" / "block_data_0_99999.csv"
COINBASE_2009_PATH = SOURCE_ROOT / "Coinbase2009.csv"
COINBASE_2010_PATH = SOURCE_ROOT / "Coinbase2010.csv"
PATOSHI_ORIGINAL_BLOCKS_PATH = SOURCE_ROOT / "patoshi-pattern-blocks.csv"
PATOSHI_UPDATED_BLOCKS_PATH = SOURCE_ROOT / "patoshi-pattern-blocks-edit.csv"
OUTPUT_DIR = Path(os.getenv("PATOSHI_WEBAPP_DATA_DIR", str(Path(__file__).resolve().parent / "webapp_data"))).expanduser()
OUTPUT_CSV = OUTPUT_DIR / "patoshi_blocks.csv"
OUTPUT_META = OUTPUT_DIR / "patoshi_metadata.json"
ENV_PATH = Path("/Users/wicked/Projects/animations/.env")
SPENDING_HEIGHT_BATCH_SIZE = 5000


class CoinbaseSpendSource(NamedTuple):
    table: str
    height_column: str
    spent_column: str
    spending_column: str
    from_coinbase_column: str | None


def read_block_data() -> dict[int, dict[str, str]]:
    blocks: dict[int, dict[str, str]] = {}
    with BLOCK_DATA_PATH.open(newline="") as handle:
        for row in csv.DictReader(handle):
            height = int(row["block_height"])
            blocks[height] = row
    return blocks


def block_data_path_for_height(height: int) -> Path:
    bucket_start = (height // 100000) * 100000
    bucket_end = bucket_start + 99999
    return REPO_ROOT / "assets" / f"block_data_{bucket_start}_{bucket_end}.csv"


def read_block_times_for_heights(heights: set[int]) -> dict[int, tuple[int, str]]:
    by_height: dict[int, tuple[int, str]] = {}
    paths: dict[Path, set[int]] = {}
    for height in heights:
        if height < 0:
            continue
        paths.setdefault(block_data_path_for_height(height), set()).add(height)

    for path, wanted in paths.items():
        if not path.exists():
            continue
        with path.open(newline="") as handle:
            for row in csv.DictReader(handle):
                height = int(row["block_height"])
                if height not in wanted:
                    continue
                timestamp = int(row["timestamp"])
                dt = datetime.fromtimestamp(timestamp, timezone.utc).isoformat().replace("+00:00", "Z")
                by_height[height] = (timestamp, dt)
    return by_height


def read_coinbase_rows(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def read_patoshi_heights(path: Path) -> set[int]:
    heights = {0}
    with path.open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            raw = (row.get("Block Height") or "").strip()
            if raw:
                heights.add(int(raw))
    return heights


def target_hashrate(target_hex: str) -> float:
    target = int(target_hex, 16)
    if target <= 0:
        return 0.0
    return (2**256 / target) / 60 / 10


def read_existing_spending_state() -> tuple[dict[int, tuple[int, int | None]], int]:
    spend_state: dict[int, tuple[int, int | None]] = {}
    if OUTPUT_CSV.exists():
        with OUTPUT_CSV.open(newline="") as handle:
            for row in csv.DictReader(handle):
                raw_height = (row.get("height") or "").strip()
                raw_is_spent = (row.get("is_spent") or "").strip()
                raw_spending_height = (row.get("spending_height") or "").strip()
                if raw_height:
                    spend_state[int(raw_height)] = (
                        int(float(raw_is_spent)) if raw_is_spent else 0,
                        int(float(raw_spending_height)) if raw_spending_height else None,
                    )

    last_queried_height = -1
    if OUTPUT_META.exists():
        try:
            metadata = json.loads(OUTPUT_META.read_text())
            last_queried_height = int(metadata.get("spending_height_last_queried_height", -1))
        except (json.JSONDecodeError, TypeError, ValueError):
            last_queried_height = -1

    return spend_state, last_queried_height


def read_env_values() -> dict[str, str]:
    values = dict(os.environ)
    if not ENV_PATH.exists():
        return values
    for raw_line in ENV_PATH.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
            value = value[1:-1]
        values.setdefault(key.strip(), value)
    return values


def connect_postgres():
    try:
        import psycopg2  # type: ignore
    except ImportError as exc:
        return None, f"skipped: psycopg2 unavailable ({exc})"

    env = read_env_values()
    database = env.get("POSTGRES_DB") or env.get("PGDATABASE")
    user = env.get("POSTGRES_USER") or env.get("PGUSER")
    password = env.get("POSTGRES_PASSWORD") or env.get("PGPASSWORD")
    host = env.get("POSTGRES_HOST") or env.get("PGHOST") or "localhost"
    port = env.get("POSTGRES_PORT") or env.get("PGPORT") or "5432"
    if not database or not user:
        return None, "skipped: POSTGRES_DB/POSTGRES_USER not configured"

    try:
        return psycopg2.connect(
            host=host,
            port=port,
            database=database,
            user=user,
            password=password,
        ), "connected"
    except Exception as exc:  # pragma: no cover - depends on local archival DB availability.
        return None, f"skipped: postgres connection failed ({exc})"


def psql_base_command() -> tuple[list[str] | None, dict[str, str], str]:
    env_values = read_env_values()
    database = env_values.get("POSTGRES_DB") or env_values.get("PGDATABASE")
    user = env_values.get("POSTGRES_USER") or env_values.get("PGUSER")
    password = env_values.get("POSTGRES_PASSWORD") or env_values.get("PGPASSWORD")
    host = env_values.get("POSTGRES_HOST") or env_values.get("PGHOST") or "localhost"
    port = env_values.get("POSTGRES_PORT") or env_values.get("PGPORT") or "5432"
    if not database or not user:
        return None, {}, "skipped: POSTGRES_DB/POSTGRES_USER not configured"

    psql_env = dict(os.environ)
    if password:
        psql_env["PGPASSWORD"] = password
    return [
        "psql",
        "-h",
        host,
        "-p",
        port,
        "-U",
        user,
        "-d",
        database,
        "-At",
        "-F",
        "\t",
    ], psql_env, "connected via psql"


def run_psql_query(sql: str) -> tuple[list[list[str]], str | None]:
    base_command, psql_env, status = psql_base_command()
    if base_command is None:
        return [], status
    try:
        result = subprocess.run(
            [*base_command, "-c", sql],
            check=True,
            capture_output=True,
            env=psql_env,
            text=True,
        )
    except FileNotFoundError as exc:
        return [], f"skipped: psql unavailable ({exc})"
    except subprocess.CalledProcessError as exc:
        return [], f"skipped: psql query failed ({exc.stderr.strip() or exc})"

    rows = [line.split("\t") for line in result.stdout.splitlines() if line]
    return rows, status


def quote_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def pick_column(columns: set[str], *names: str) -> str | None:
    for name in names:
        if name in columns:
            return name
    return None


def resolve_coinbase_spend_source(cursor) -> CoinbaseSpendSource | None:
    cursor.execute(
        """
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = current_schema()
        """
    )
    columns_by_table: dict[str, set[str]] = {}
    for table_name, column_name in cursor.fetchall():
        columns_by_table.setdefault(str(table_name), set()).add(str(column_name).lower())

    columns = columns_by_table.get("coinbases")
    if not columns:
        return None
    height_column = pick_column(columns, "blockheight", "block_height", "height")
    spent_column = pick_column(columns, "isspent", "is_spent", "spent")
    spending_column = pick_column(columns, "spendingblock", "spending_block", "spending_height", "spent_height")
    if not height_column or not spent_column or not spending_column:
        return None
    from_coinbase_column = pick_column(columns, "fromcoinbase", "from_coinbase")
    return CoinbaseSpendSource("coinbases", height_column, spent_column, spending_column, from_coinbase_column)


def get_database_tip_height(cursor, fallback_height: int) -> int:
    for table, column in (
        ("blockheader", "blockheight"),
        ("blocks", "height"),
        ("headers", "height"),
    ):
        try:
            cursor.execute(f"SELECT COALESCE(MAX({quote_ident(column)}), -1) FROM {quote_ident(table)}")
            value = cursor.fetchone()[0]
            if value is not None and int(value) >= 0:
                return int(value)
        except Exception:
            cursor.connection.rollback()
    return fallback_height


def get_database_tip_height_with_psql(fallback_height: int) -> int:
    rows, status = run_psql_query("SELECT COALESCE(MAX(blockheight), -1) FROM blockheader")
    if status and status.startswith("skipped"):
        return fallback_height
    if rows and rows[0] and rows[0][0]:
        try:
            value = int(rows[0][0])
            if value >= 0:
                return value
        except ValueError:
            return fallback_height
    return fallback_height


def coerce_coinbase_spend_state(is_spent: object, spending_height: object) -> tuple[int, int | None]:
    raw_spent = str(is_spent).strip().lower()
    spent_value = raw_spent in {"t", "true", "1", "yes"}
    raw_height = str(spending_height).strip()
    spend_height_value = int(raw_height) if raw_height else None
    spent_flag = spent_value and spend_height_value is not None
    return (1 if spent_flag else 0, spend_height_value if spent_flag else None)


def query_coinbase_spend_state(cursor, source: CoinbaseSpendSource, heights: list[int]) -> dict[int, tuple[int, int | None]]:
    results: dict[int, tuple[int, int | None]] = {}
    if not heights:
        return results

    table = quote_ident(source.table)
    height_column = quote_ident(source.height_column)
    spent_column = quote_ident(source.spent_column)
    spending_column = quote_ident(source.spending_column)
    where = [f"{height_column} = ANY(%s)"]
    if source.from_coinbase_column:
        where.append(f"{quote_ident(source.from_coinbase_column)} = TRUE")

    for index in range(0, len(heights), SPENDING_HEIGHT_BATCH_SIZE):
        batch = heights[index:index + SPENDING_HEIGHT_BATCH_SIZE]
        sql = (
            f"SELECT {height_column}, MIN({spending_column}) FILTER (WHERE COALESCE({spent_column}, FALSE) AND {spending_column} IS NOT NULL) "
            f"FROM {table} "
            f"WHERE {' AND '.join(where)} "
            f"GROUP BY {height_column}"
        )
        cursor.execute(sql, [batch])
        for height, spending_height in cursor.fetchall():
            results[int(height)] = coerce_coinbase_spend_state(spending_height is not None, spending_height)
    return results


def query_coinbase_spend_state_with_psql(heights: list[int]) -> tuple[dict[int, tuple[int, int | None]], str]:
    results: dict[int, tuple[int, int | None]] = {}
    if not heights:
        return results, "queried: coinbases.isspent/spendingblock via psql"

    for index in range(0, len(heights), SPENDING_HEIGHT_BATCH_SIZE):
        batch = heights[index:index + SPENDING_HEIGHT_BATCH_SIZE]
        height_values = ",".join(str(int(height)) for height in batch)
        sql = (
            "SELECT blockheight, MIN(spendingblock) FILTER (WHERE COALESCE(isspent, FALSE) AND spendingblock IS NOT NULL) "
            "FROM coinbases "
            f"WHERE blockheight IN ({height_values}) AND fromcoinbase = TRUE "
            "GROUP BY blockheight"
        )
        rows, status = run_psql_query(sql)
        if status and status.startswith("skipped"):
            return results, status
        for row in rows:
            if len(row) < 2:
                continue
            results[int(row[0])] = coerce_coinbase_spend_state(bool(row[1]), row[1])
    return results, "queried: coinbases.isspent/spendingblock via psql"


def enrich_coinbase_spend_state(merged: list[dict[str, object]], fallback_tip_height: int) -> tuple[dict[int, tuple[int, int | None]], int, str]:
    spend_state, last_queried_height = read_existing_spending_state()
    conn, status = connect_postgres()
    if conn is None:
        heights = [int(row["height"]) for row in merged]
        psql_spend_state, psql_status = query_coinbase_spend_state_with_psql(heights)
        if psql_status.startswith("skipped"):
            return spend_state, last_queried_height, status if "psycopg2 unavailable" in status else psql_status
        spend_state.update(psql_spend_state)
        return spend_state, get_database_tip_height_with_psql(fallback_tip_height), psql_status

    try:
        with conn:
            with conn.cursor() as cursor:
                source = resolve_coinbase_spend_source(cursor)
                if source is None:
                    return spend_state, last_queried_height, "skipped: coinbases table with isspent/spendingblock columns not found"
                tip_height = get_database_tip_height(cursor, fallback_tip_height)
                heights = [int(row["height"]) for row in merged]
                spend_state.update(query_coinbase_spend_state(cursor, source, heights))
                return spend_state, tip_height, f"queried: {source.table}.{source.spent_column}/{source.spending_column}"
    finally:
        conn.close()


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    block_data = read_block_data()
    patoshi_original_heights = read_patoshi_heights(PATOSHI_ORIGINAL_BLOCKS_PATH)
    patoshi_updated_heights = read_patoshi_heights(PATOSHI_UPDATED_BLOCKS_PATH)

    rows: list[dict[str, object]] = [
        {
            "height": 0,
            "extranonce": 4,
            "is_spent": 0,
        }
    ]
    for path in (COINBASE_2009_PATH, COINBASE_2010_PATH):
        for row in read_coinbase_rows(path):
            raw_height = (row.get("Height") or "").strip()
            raw_extranonce = (row.get("ExtraNonceDecimal") or "").strip()
            if not raw_height or not raw_extranonce:
                continue
            rows.append(
                {
                    "height": int(raw_height),
                    "extranonce": int(raw_extranonce),
                    "is_spent": int((row.get("isSpent") or "0").strip() or "0"),
                }
            )

    seen: set[int] = set()
    merged: list[dict[str, object]] = []
    for row in sorted(rows, key=lambda item: int(item["height"])):
        height = int(row["height"])
        if height in seen or height not in block_data:
            continue
        seen.add(height)
        block = block_data[height]
        timestamp = int(block["timestamp"])
        dt = datetime.fromtimestamp(timestamp, timezone.utc)
        merged.append(
            {
                "height": height,
                "timestamp": timestamp,
                "datetime": dt.isoformat().replace("+00:00", "Z"),
                "extranonce": int(row["extranonce"]),
                "is_spent": int(row["is_spent"]),
                "patoshi": 1 if height in patoshi_updated_heights else 0,
                "patoshi_original": 1 if height in patoshi_original_heights else 0,
                "patoshi_updated": 1 if height in patoshi_updated_heights else 0,
                "difficulty": float(block["difficulty"]),
                "target_hashrate": round(target_hashrate(block["target"]), 8),
            }
        )

    spend_state, spending_tip_height, spending_query_status = enrich_coinbase_spend_state(
        merged,
        max(block_data),
    )
    for row in merged:
        is_spent, spending_height = spend_state.get(int(row["height"]), (int(row["is_spent"]), None))
        row["is_spent"] = is_spent
        row["spending_height"] = spending_height if is_spent and spending_height is not None else ""

    spending_block_times = read_block_times_for_heights({
        int(row["spending_height"])
        for row in merged
        if row["spending_height"] != ""
    })
    for row in merged:
        spending_height = row["spending_height"]
        timestamp, datetime_iso = spending_block_times.get(int(spending_height), ("", "")) if spending_height != "" else ("", "")
        row["spending_timestamp"] = timestamp
        row["spending_datetime"] = datetime_iso

    fields = [
        "height",
        "timestamp",
        "datetime",
        "extranonce",
        "is_spent",
        "spending_height",
        "spending_timestamp",
        "spending_datetime",
        "patoshi",
        "patoshi_original",
        "patoshi_updated",
        "difficulty",
        "target_hashrate",
    ]
    with OUTPUT_CSV.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(merged)

    start = merged[0]
    end = merged[-1]
    metadata = {
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": "Patoshi Pattern notebook CSVs plus assets/block_data_0_99999.csv",
        "block_count": len(merged),
        "patoshi_count": sum(1 for row in merged if row["patoshi"]),
        "patoshi_original_count": sum(1 for row in merged if row["patoshi_original"]),
        "patoshi_updated_count": sum(1 for row in merged if row["patoshi_updated"]),
        "spent_count": sum(1 for row in merged if row["is_spent"]),
        "spending_height_count": sum(1 for row in merged if row["spending_height"] != ""),
        "spent_without_spending_height_count": sum(1 for row in merged if row["is_spent"] and row["spending_height"] == ""),
        "spending_height_last_queried_height": spending_tip_height,
        "spending_height_query_status": spending_query_status,
        "first_height": start["height"],
        "last_height": end["height"],
        "first_datetime": start["datetime"],
        "last_datetime": end["datetime"],
        "max_extranonce": max(int(row["extranonce"]) for row in merged),
    }
    OUTPUT_META.write_text(json.dumps(metadata, indent=2) + "\n")


if __name__ == "__main__":
    main()
