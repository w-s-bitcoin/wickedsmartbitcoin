#!/usr/bin/env python3
# coding: utf-8

import json
import os
from bisect import bisect_right
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import psycopg2
from dotenv import load_dotenv


HALVING_INTERVAL = 210_000
INITIAL_SUBSIDY = 50.0
TARGET_BLOCKS_PER_DAY = 144
GENESIS_DATE = datetime(2009, 1, 3, tzinfo=timezone.utc)
TIME_ZONE_OPTIONS = [
    "UTC",
    "Etc/GMT+12",
    "Pacific/Pago_Pago",
    "Pacific/Honolulu",
    "America/Anchorage",
    "America/Los_Angeles",
    "America/Denver",
    "America/Chicago",
    "America/New_York",
    "America/Halifax",
    "America/Argentina/Buenos_Aires",
    "America/Noronha",
    "Atlantic/Azores",
    "Europe/Berlin",
    "Europe/Helsinki",
    "Europe/Moscow",
    "Asia/Yerevan",
    "Asia/Karachi",
    "Asia/Urumqi",
    "Asia/Bangkok",
    "Asia/Hong_Kong",
    "Asia/Tokyo",
    "Australia/Sydney",
    "Pacific/Norfolk",
    "Pacific/Auckland",
    "Pacific/Tongatapu",
    "Pacific/Kiritimati",
]


def bitcoin_supply(height: int) -> float:
    reward = INITIAL_SUBSIDY
    supply = 0.0
    current_height = 0

    while current_height + HALVING_INTERVAL <= height:
        supply += HALVING_INTERVAL * reward
        current_height += HALVING_INTERVAL
        reward /= 2

    supply += (height + 1 - current_height) * reward
    return supply


def subsidy_for_epoch(epoch: int) -> float:
    return INITIAL_SUBSIDY / (2 ** max(0, int(epoch) - 1))


def iso_date(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).date().isoformat()


def build_time_zone_daily_rows(heights: list[int], timestamps: list[int], end_date: datetime) -> dict[str, dict[str, list[float]]]:
    start_day = GENESIS_DATE.date()
    end_day = end_date.date()
    result: dict[str, dict[str, list[float]]] = {}

    for zone_name in TIME_ZONE_OPTIONS:
        zone = ZoneInfo(zone_name)
        block_counts: dict[str, int] = {}
        end_heights: dict[str, int] = {}

        for height, timestamp in zip(heights, timestamps):
            local_day = datetime.fromtimestamp(timestamp, tz=timezone.utc).astimezone(zone).date()
            key = local_day.isoformat()
            block_counts[key] = block_counts.get(key, 0) + 1
            end_heights[key] = int(height)

        zone_rows: dict[str, list[float]] = {}
        previous_height = 0
        current_day = start_day
        while current_day <= end_day:
            key = current_day.isoformat()
            height = int(end_heights.get(key, previous_height))
            supply = bitcoin_supply(height)
            daily_issuance = 0.0 if height <= previous_height else bitcoin_supply(height) - bitcoin_supply(previous_height)
            subsidy = subsidy_for_epoch(int(height // HALVING_INTERVAL) + 1)
            target_issuance = TARGET_BLOCKS_PER_DAY * subsidy
            issuance_rate = 0.0 if supply <= 0 else daily_issuance * 365 / supply
            target_rate = 0.0 if supply <= 0 else target_issuance * 365 / supply
            zone_rows[key] = [
                int(block_counts.get(key, 0)),
                round(daily_issuance, 8),
                round(target_issuance, 8),
                round(issuance_rate, 10),
                round(target_rate, 10),
            ]
            previous_height = height
            current_day += timedelta(days=1)

        result[zone_name] = zone_rows

    return result


def main() -> None:
    here = Path(__file__).resolve().parent
    root = here.parent.parent
    env_path = Path(os.getenv("ISSUANCE_RATE_ENV_FILE", os.getenv("ANIMATIONS_ENV_FILE", str(root / ".env")))).expanduser()
    load_dotenv(dotenv_path=env_path)

    pg_host = os.getenv("PGHOST", "localhost")
    pg_database = os.getenv("PGDATABASE", "bitcoin_data")
    pg_user = os.getenv("PGUSER", os.getenv("RPC_USER", "wicked"))
    pg_password = os.getenv("PGPASSWORD", os.getenv("RPC_PASSWORD", ""))

    conn = psycopg2.connect(host=pg_host, database=pg_database, user=pg_user, password=pg_password)
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT blockheight, time FROM blockheader ORDER BY blockheight;")
            block_rows = cursor.fetchall()
    finally:
        conn.close()

    if not block_rows:
        raise RuntimeError("No blockheader rows returned from PostgreSQL.")

    heights = [int(row[0]) for row in block_rows]
    timestamps = [int(row[1]) for row in block_rows]
    latest_height = heights[-1]
    latest_time = datetime.fromtimestamp(timestamps[-1], tz=timezone.utc)
    next_halving_height = ((latest_height // HALVING_INTERVAL) + 1) * HALVING_INTERVAL
    next_halving_estimate = latest_time + timedelta(minutes=max(0, next_halving_height - latest_height) * 10)

    output_dir = Path(os.getenv("ISSUANCE_RATE_WEBAPP_DATA_DIR", str(here / "webapp_data"))).expanduser()
    output_dir.mkdir(parents=True, exist_ok=True)

    end_date = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    daily_rows = []
    block_idx = 0
    prev_supply = 0.0
    prev_epoch = 1
    current = GENESIS_DATE

    while current <= end_date:
        next_day_ts = int((current + timedelta(days=1)).timestamp())
        while block_idx + 1 < len(timestamps) and timestamps[block_idx + 1] < next_day_ts:
            block_idx += 1

        height = heights[block_idx]
        epoch = int(height // HALVING_INTERVAL) + 1
        subsidy = subsidy_for_epoch(epoch)
        supply = bitcoin_supply(height)
        daily_issuance = 0.0 if not daily_rows else supply - prev_supply
        issuance_rate = 0.0 if supply <= 0 else daily_issuance * 365 / supply

        if not daily_rows:
            target_issuance = TARGET_BLOCKS_PER_DAY * INITIAL_SUBSIDY
        elif epoch == prev_epoch:
            target_issuance = TARGET_BLOCKS_PER_DAY * subsidy_for_epoch(epoch)
        else:
            prev_height = daily_rows[-1]["height"]
            blocks_curr_epoch = height - ((epoch - 1) * HALVING_INTERVAL) + 1
            blocks_prev_epoch = height - blocks_curr_epoch - prev_height
            total_transition_blocks = max(1, blocks_prev_epoch + blocks_curr_epoch)
            target_issuance = (
                (blocks_prev_epoch / total_transition_blocks) * TARGET_BLOCKS_PER_DAY * subsidy_for_epoch(prev_epoch)
                + (blocks_curr_epoch / total_transition_blocks) * TARGET_BLOCKS_PER_DAY * subsidy_for_epoch(epoch)
            )

        target_rate = 0.0 if supply <= 0 else target_issuance * 365 / supply
        daily_rows.append({
            "date": iso_date(current),
            "height": int(height),
            "epoch": int(epoch),
            "subsidy": round(subsidy, 8),
            "supply": round(supply, 8),
            "daily_issuance": round(daily_issuance, 8),
            "issuance_rate": round(issuance_rate, 10),
            "target_issuance": round(target_issuance, 8),
            "target_rate": round(target_rate, 10),
        })

        prev_supply = supply
        prev_epoch = epoch
        current += timedelta(days=1)

    if daily_rows:
        rolling_start_ts = timestamps[-1] - 24 * 60 * 60
        rolling_start_idx = max(0, bisect_right(timestamps, rolling_start_ts) - 1)
        rolling_start_height = heights[rolling_start_idx]
        rolling_issuance = bitcoin_supply(latest_height) - bitcoin_supply(rolling_start_height)
        current_row = daily_rows[-1]
        current_supply = bitcoin_supply(latest_height)
        current_row["height"] = int(latest_height)
        current_row["epoch"] = int(latest_height // HALVING_INTERVAL) + 1
        current_row["subsidy"] = round(subsidy_for_epoch(current_row["epoch"]), 8)
        current_row["supply"] = round(current_supply, 8)
        current_row["daily_issuance"] = round(rolling_issuance, 8)
        current_row["issuance_rate"] = round(0.0 if current_supply <= 0 else rolling_issuance * 365 / current_supply, 10)
        current_row["rolling_24h_start_height"] = int(rolling_start_height)
        current_row["rolling_24h_start_time_utc"] = datetime.fromtimestamp(timestamps[rolling_start_idx], tz=timezone.utc).isoformat()

    time_zone_daily = build_time_zone_daily_rows(heights, timestamps, end_date)

    halving_frames = []
    for halving_idx in range(1, (latest_height // HALVING_INTERVAL) + 1):
        threshold = halving_idx * HALVING_INTERVAL
        frame_idx = next((idx for idx, row in enumerate(daily_rows) if row["height"] >= threshold), None)
        if frame_idx is None:
            continue
        halving_frames.append({
            "height": int(threshold),
            "frame": int(frame_idx + 1),
            "date": daily_rows[frame_idx]["date"],
            "label": f"{halving_idx}{'st' if halving_idx == 1 else 'nd' if halving_idx == 2 else 'rd' if halving_idx == 3 else 'th'} Halving",
        })

    payload = {
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "source": {
            "database": pg_database,
            "latest_block_height": int(latest_height),
            "latest_block_time_utc": latest_time.isoformat(),
            "next_halving_height": int(next_halving_height),
            "next_halving_estimated_time_utc": next_halving_estimate.isoformat(),
        },
        "chart": {
            "genesis_date": iso_date(GENESIS_DATE),
            "fifth_halving_estimate": iso_date(next_halving_estimate),
            "halving_interval": HALVING_INTERVAL,
            "target_blocks_per_day": TARGET_BLOCKS_PER_DAY,
        },
        "halvings": halving_frames,
        "rows": daily_rows,
        "time_zone_daily": time_zone_daily,
    }

    out_path = output_dir / "issuance_rate_data.json"
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"), ensure_ascii=True)

    print(f"Wrote {out_path}")
    print(f"Rows: {len(daily_rows):,}")
    print(f"Latest height: {latest_height:,}")
    print(f"Latest date: {daily_rows[-1]['date']}")


if __name__ == "__main__":
    main()
