#!/usr/bin/env python
# coding: utf-8

import csv
import concurrent.futures
import hashlib
import json
import os
import socket
import sys
import time
from datetime import datetime, timezone
from http.client import RemoteDisconnected
from pathlib import Path
from urllib.parse import quote

from bitcoinrpc.authproxy import AuthServiceProxy
from dotenv import load_dotenv

PERIOD_SIZE = 2016
SEGWIT_START = 439_488
SEGWIT_LAST_PERIOD = 20
BIP110_START = 927_360
BIP110_SIGNAL_END = 963_648
BIP110_LAST_PERIOD = 18
BIP110_MANDATORY_SIGNALING_HEIGHT = 961_632
BIP110_BLOCK_POINT_TAIL_REBUILD_DEPTH = 12
BIP110_MINER_TAIL_LOOKUP_DEPTH = 48
X_MAX = 20
BIP110_DASHBOARD_END = BIP110_START + (X_MAX * PERIOD_SIZE)
BIP110_FINAL_UPDATE_HEIGHT = BIP110_DASHBOARD_END - 1
SEGWIT_INITIAL_SIGNAL_MINER_SAMPLE_SIZE = None
SEGWIT_INITIAL_PERIOD2_SIGNAL_MINER_SAMPLE_SIZE = 15
SEGWIT_LATE_NONSIGNAL_MINER_SAMPLE_SIZE = None
LOW_ACTIVITY_WINDOW = 72
LOW_ACTIVITY_MAX_MEDIAN_RATIO = 0.35
LOW_ACTIVITY_MAX_BLOCK_SIZE = 250_000
LOW_ACTIVITY_MIN_MEDIAN_SIZE = 750_000
LOW_ACTIVITY_MIN_LOW_FEE_RATE = 10
LOW_ACTIVITY_CRITERIA_ID = (
    f"size<{LOW_ACTIVITY_MAX_BLOCK_SIZE}"
    f"&size<{LOW_ACTIVITY_MAX_MEDIAN_RATIO:g}*trailing{LOW_ACTIVITY_WINDOW}median"
    f"&trailing{LOW_ACTIVITY_WINDOW}median>{LOW_ACTIVITY_MIN_MEDIAN_SIZE}"
    f"&low_fee_rate>={LOW_ACTIVITY_MIN_LOW_FEE_RATE}"
)

SEGWIT_SIGNAL_COUNTS = [
    451, 487, 520, 521, 489, 468, 485, 537, 532, 582,
    614, 671, 698, 663, 622, 642, 825, 917, 1440, 2016,
]

def clamp(x, lo, hi):
    return max(lo, min(hi, x))

def truthy_env(name: str, default: str = "") -> bool:
    return str(os.getenv(name, default)).strip().lower() in {"1", "true", "yes", "on"}

def height_to_period(height: int, start_height: int, period_size: int) -> int:
    return ((height - start_height) // period_size) + 1

def export_csv(path: Path, rows, fieldnames):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        with tmp_path.open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames, lineterminator="\n")
            writer.writeheader()
            writer.writerows(rows)
            f.flush()
            os.fsync(f.fileno())
        tmp_path.replace(path)
    finally:
        try:
            tmp_path.unlink()
        except FileNotFoundError:
            pass

def atomic_write_json(path: Path, payload):
    """Replace a JSON publication boundary without exposing a partial file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        with tmp_path.open("w", encoding="utf-8") as f:
            json.dump(payload, f, separators=(",", ":"), ensure_ascii=True)
            f.flush()
            os.fsync(f.fileno())
        tmp_path.replace(path)
    finally:
        try:
            tmp_path.unlink()
        except FileNotFoundError:
            pass

def export_block_points_bin(path: Path, rows, *, period_size: int):
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = bytearray()
    min_h = None
    max_h = None
    record_size = 13

    for row in rows:
        h = int(row["height"])
        sig = 1 if int(row.get("is_signaling", 0)) == 1 else 0
        version = int(row.get("version", 0)) & 0xFFFFFFFF
        block_time = int(row.get("block_time", row.get("time", 0))) & 0xFFFFFFFF
        payload.extend(h.to_bytes(4, byteorder="little", signed=False))
        payload.append(sig)
        payload.extend(version.to_bytes(4, byteorder="little", signed=False))
        payload.extend(block_time.to_bytes(4, byteorder="little", signed=False))
        min_h = h if min_h is None else min(min_h, h)
        max_h = h if max_h is None else max(max_h, h)

    path.write_bytes(payload)
    return {
        "rows": len(rows),
        "start_height": int(min_h) if min_h is not None else 0,
        "end_height": int(max_h) if max_h is not None else 0,
        "period_size": int(period_size),
        "record_size": int(record_size),
    }

def read_block_points_bin(path: Path, *, start_height: int, period_size: int, record_size: int):
    if not path.exists():
        return []
    payload = path.read_bytes()
    rows = []
    size = int(record_size or 0)
    if size not in (5, 9, 13):
        return rows

    count = len(payload) // size
    for idx in range(count):
        offset = idx * size
        height = int.from_bytes(payload[offset:offset + 4], byteorder="little", signed=False)
        is_signaling = int(payload[offset + 4])
        version = int.from_bytes(payload[offset + 5:offset + 9], byteorder="little", signed=False) if size >= 9 else 0
        block_time = int.from_bytes(payload[offset + 9:offset + 13], byteorder="little", signed=False) if size >= 13 else 0
        rel = height - int(start_height)
        period = (rel // int(period_size)) + 1
        rows.append({
            "period": int(period),
            "height": int(height),
            "y_in_period": int(rel % int(period_size)),
            "version": int(version),
            "block_time": int(block_time),
            "is_signaling": int(is_signaling),
        })
    return rows

def build_bip110_block_rows_range(start_height, plot_max_height, rpc_get=None):
    if rpc_get is None:
        rpc_get = rpc_call
    rows = []
    if plot_max_height is None or plot_max_height < BIP110_START:
        return rows
    start = max(int(start_height), BIP110_START)
    end = min(int(plot_max_height), BIP110_FINAL_UPDATE_HEIGHT)
    if start > end:
        return rows

    for h in range(start, end + 1):
        bh = rpc_get("getblockhash", h)
        header = rpc_get("getblockheader", bh)
        version = int(header["version"])
        period = height_to_period(h, BIP110_START, PERIOD_SIZE)
        period_start = BIP110_START + (period - 1) * PERIOD_SIZE
        rows.append({
            "period": int(period),
            "height": int(h),
            "y_in_period": int(h - period_start),
            "version": version,
            "block_time": int(header.get("time", 0)),
            "is_signaling": int((version & (1 << 4)) != 0),
        })
    return rows

def load_or_update_bip110_block_rows(path: Path, plot_max_height, rpc_get=None, *, log_label="bip110"):
    if rpc_get is None:
        rpc_get = rpc_call
    if plot_max_height is None or plot_max_height < BIP110_START:
        return []

    target_end = min(int(plot_max_height), BIP110_FINAL_UPDATE_HEIGHT)
    cached_rows = read_block_points_bin(
        path,
        start_height=BIP110_START,
        period_size=PERIOD_SIZE,
        record_size=13,
    )
    cached_rows = [
        row
        for row in cached_rows
        if BIP110_START <= int(row.get("height", 0)) <= target_end
    ]

    is_contiguous = bool(cached_rows) and int(cached_rows[0]["height"]) == BIP110_START
    if is_contiguous:
        for prev, cur in zip(cached_rows, cached_rows[1:]):
            if int(cur["height"]) != int(prev["height"]) + 1:
                is_contiguous = False
                break

    if not is_contiguous:
        print(f"[{log_label}] rebuilding BIP-110 block points cache through {target_end:,}.")
        return build_bip110_block_rows_range(BIP110_START, target_end, rpc_get=rpc_get)

    cached_end = int(cached_rows[-1]["height"])
    tail_start = max(
        BIP110_START,
        min(cached_end, target_end) - max(0, BIP110_BLOCK_POINT_TAIL_REBUILD_DEPTH - 1),
    )
    prefix_rows = [row for row in cached_rows if int(row["height"]) < tail_start]
    refreshed_rows = build_bip110_block_rows_range(tail_start, target_end, rpc_get=rpc_get)
    if target_end > cached_end:
        print(f"[{log_label}] appended BIP-110 block points {cached_end + 1:,}-{target_end:,}.")
    return prefix_rows + refreshed_rows

def load_low_activity_block_cache(path: Path):
    if not path.exists():
        return {}, {}, {}, {}
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return {}, {}, {}, {}

    if not isinstance(data, dict):
        return {}, {}, {}, {}

    sizes_raw = data.get("sizes", {})
    times_raw = data.get("block_times", {})
    low_fee_rates_raw = data.get("low_fee_rates", {})
    block_hashes_raw = data.get("block_hashes", {})
    sizes = {}
    block_times = {}
    low_fee_rates = {}
    block_hashes = {}
    if isinstance(sizes_raw, dict):
        for height, size in sizes_raw.items():
            try:
                parsed_height = int(height)
                parsed_size = int(size)
            except (TypeError, ValueError):
                continue
            if parsed_size > 0:
                sizes[parsed_height] = parsed_size
    if isinstance(times_raw, dict):
        for height, block_time in times_raw.items():
            try:
                parsed_height = int(height)
                parsed_time = int(block_time)
            except (TypeError, ValueError):
                continue
            if parsed_time > 0:
                block_times[parsed_height] = parsed_time
    if isinstance(low_fee_rates_raw, dict):
        for height, fee_rate in low_fee_rates_raw.items():
            try:
                parsed_height = int(height)
                parsed_fee_rate = float(fee_rate)
            except (TypeError, ValueError):
                continue
            if parsed_fee_rate >= 0:
                low_fee_rates[parsed_height] = parsed_fee_rate
    if isinstance(block_hashes_raw, dict):
        for height, block_hash in block_hashes_raw.items():
            try:
                parsed_height = int(height)
            except (TypeError, ValueError):
                continue
            text = str(block_hash or "").strip()
            if text:
                block_hashes[parsed_height] = text
    return sizes, block_times, low_fee_rates, block_hashes

def load_low_fee_rate_cache(path: Path):
    if not path.exists():
        return {}, {}
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return {}, {}
    if not isinstance(data, dict):
        return {}, {}

    values = data.get("low_fee_rates", data)
    if not isinstance(values, dict):
        return {}, {}
    block_hashes_raw = data.get("block_hashes", {})

    low_fee_rates = {}
    block_hashes = {}
    for height, fee_rate in values.items():
        try:
            parsed_height = int(height)
            parsed_fee_rate = float(fee_rate)
        except (TypeError, ValueError):
            continue
        if parsed_fee_rate >= 0:
            low_fee_rates[parsed_height] = parsed_fee_rate
    if isinstance(block_hashes_raw, dict):
        for height, block_hash in block_hashes_raw.items():
            try:
                parsed_height = int(height)
            except (TypeError, ValueError):
                continue
            text = str(block_hash or "").strip()
            if text:
                block_hashes[parsed_height] = text
    return low_fee_rates, block_hashes

def write_low_fee_rate_cache(path: Path, target_heights, low_fee_rates, block_hashes=None):
    target_set = set(int(height) for height in target_heights)
    block_hashes = block_hashes or {}
    payload = {
        "source": "https://mempool.space/api/v1/blocks/:height extras.feeRange[0]",
        "low_fee_rates": {
            str(height): low_fee_rates[height]
            for height in sorted(target_set)
            if height in low_fee_rates
        },
        "block_hashes": {
            str(height): block_hashes[height]
            for height in sorted(target_set)
            if block_hashes.get(height)
        },
    }
    tmp_path = path.with_suffix(f"{path.suffix}.tmp")
    with tmp_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"), ensure_ascii=True)
    tmp_path.replace(path)
    return payload

def fetch_block_size_times(heights, existing_sizes=None):
    existing_sizes = existing_sizes or {}
    sizes = {}
    block_times = {}
    block_hashes = {}
    for height in heights:
        try:
            block_hash = rpc_call("getblockhash", int(height))
            if int(height) in existing_sizes:
                block_header = rpc_call("getblockheader", block_hash)
                block_size = int(existing_sizes[int(height)])
                block_time = int(block_header.get("time", 0))
            else:
                block = rpc_call("getblock", block_hash, 1)
                block_size = int(block.get("size", 0))
                block_time = int(block.get("time", 0))
        except Exception as exc:
            print(f"[low-activity-blocks] lookup failed at height {height}: {exc}")
            continue
        if block_size > 0:
            sizes[int(height)] = block_size
        if block_time > 0:
            block_times[int(height)] = block_time
        if block_hash:
            block_hashes[int(height)] = str(block_hash)
    return sizes, block_times, block_hashes

def median(values):
    if not values:
        return 0
    sorted_values = sorted(values)
    mid = len(sorted_values) // 2
    if len(sorted_values) % 2:
        return sorted_values[mid]
    return (sorted_values[mid - 1] + sorted_values[mid]) / 2

def export_low_activity_block_cache(path: Path, rows):
    target_heights = sorted(set(int(row["height"]) for row in rows))
    target_height_set = set(target_heights)
    sizes, block_times, low_fee_rates, block_hashes = load_low_activity_block_cache(path)
    sizes = {height: size for height, size in sizes.items() if height in target_height_set}
    block_times = {height: block_time for height, block_time in block_times.items() if height in target_height_set}
    low_fee_rates = {height: fee_rate for height, fee_rate in low_fee_rates.items() if height in target_height_set}
    block_hashes = {height: block_hash for height, block_hash in block_hashes.items() if height in target_height_set}
    fee_rate_cache_path = path.parent / "segwit_low_activity_fee_rates.json"
    cached_fee_rates, cached_fee_hashes = load_low_fee_rate_cache(fee_rate_cache_path)
    low_fee_rates.update({
        height: fee_rate
        for height, fee_rate in cached_fee_rates.items()
        if height in target_height_set
    })
    block_hashes.update({
        height: block_hash
        for height, block_hash in cached_fee_hashes.items()
        if height in target_height_set
    })

    cached_hashes_for_recheck = {
        height: block_hashes.get(height, "")
        for height in target_heights
        if height in sizes or height in block_times or height in low_fee_rates
    }
    stale_heights, postgres_hashes = find_stale_cached_block_heights(
        target_heights,
        cached_hashes_for_recheck,
        log_label="low-activity-blocks",
    )
    for height in stale_heights:
        sizes.pop(height, None)
        block_times.pop(height, None)
        low_fee_rates.pop(height, None)
        block_hashes.pop(height, None)
    for height, postgres_hash in postgres_hashes.items():
        if height not in stale_heights and not block_hashes.get(height):
            block_hashes[height] = postgres_hash

    missing = [height for height in target_heights if height not in sizes or height not in block_times]

    if missing:
        fetched_sizes, fetched_times, fetched_hashes = fetch_block_size_times(missing, existing_sizes=sizes)
        sizes.update(fetched_sizes)
        block_times.update(fetched_times)
        block_hashes.update(fetched_hashes)

    missing_fee_heights = [height for height in target_heights if height not in low_fee_rates]
    if missing_fee_heights:
        def persist_fee_batch(batch_fee_rates, batch_hashes):
            low_fee_rates.update(batch_fee_rates)
            block_hashes.update(batch_hashes)
            write_low_fee_rate_cache(fee_rate_cache_path, target_heights, low_fee_rates, block_hashes)

        fetched_fee_rates, fetched_fee_hashes = fetch_block_low_fee_rates(missing_fee_heights, on_batch=persist_fee_batch)
        low_fee_rates.update(fetched_fee_rates)
        block_hashes.update(fetched_fee_hashes)
        write_low_fee_rate_cache(fee_rate_cache_path, target_heights, low_fee_rates, block_hashes)

    low_activity = []
    size_window = []
    for height in target_heights:
        block_size = sizes.get(height)
        low_fee_rate = low_fee_rates.get(height)
        if not block_size or low_fee_rate is None:
            continue
        trailing_median = median(size_window[-LOW_ACTIVITY_WINDOW:])
        if (
            trailing_median > 0
            and trailing_median > LOW_ACTIVITY_MIN_MEDIAN_SIZE
            and block_size < LOW_ACTIVITY_MAX_BLOCK_SIZE
            and block_size < trailing_median * LOW_ACTIVITY_MAX_MEDIAN_RATIO
            and low_fee_rate >= LOW_ACTIVITY_MIN_LOW_FEE_RATE
        ):
            low_activity.append(height)
        size_window.append(block_size)

    payload = {
        "criteria": LOW_ACTIVITY_CRITERIA_ID,
        "window": LOW_ACTIVITY_WINDOW,
        "max_median_ratio": LOW_ACTIVITY_MAX_MEDIAN_RATIO,
        "max_block_size": LOW_ACTIVITY_MAX_BLOCK_SIZE,
        "min_median_size": LOW_ACTIVITY_MIN_MEDIAN_SIZE,
        "min_low_fee_rate": LOW_ACTIVITY_MIN_LOW_FEE_RATE,
        "fee_rate_source": "https://mempool.space/api/v1/blocks/:height extras.feeRange[0]",
        "checked": [str(height) for height in target_heights if height in sizes and height in block_times],
        "sizes": {str(height): sizes[height] for height in target_heights if height in sizes},
        "block_times": {str(height): block_times[height] for height in target_heights if height in block_times},
        "low_fee_rates": {str(height): low_fee_rates[height] for height in target_heights if height in low_fee_rates},
        "block_hashes": {str(height): block_hashes[height] for height in target_heights if block_hashes.get(height)},
        "low_activity": [str(height) for height in low_activity],
    }
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"), ensure_ascii=True)

    return {
        "checked": len(payload["checked"]),
        "rows": len(low_activity),
        "criteria": LOW_ACTIVITY_CRITERIA_ID,
        "window": LOW_ACTIVITY_WINDOW,
        "max_median_ratio": LOW_ACTIVITY_MAX_MEDIAN_RATIO,
        "max_block_size": LOW_ACTIVITY_MAX_BLOCK_SIZE,
        "min_median_size": LOW_ACTIVITY_MIN_MEDIAN_SIZE,
        "min_low_fee_rate": LOW_ACTIVITY_MIN_LOW_FEE_RATE,
        "fee_rate_source": "https://mempool.space/api/v1/blocks/:height extras.feeRange[0]",
    }

def build_release_url(label: str) -> str:
    raw = str(label or "")
    if ":" in raw:
        prefix, version = raw.split(":", 1)
    else:
        prefix, version = raw, ""
    prefix = prefix.lower()

    repo_map = {
        "core": "bitcoin/bitcoin",
        "knots": "bitcoinknots/bitcoin",
        "bip110": "dathonohm/bitcoin",
        "uasf": "UASF/bitcoin",
        "segwit2x": "btc1/bitcoin",
    }

    repo = repo_map.get(prefix)
    if repo and version:
        return f"https://github.com/{repo}/releases/tag/{version}"
    return ""

def segwit_display_label(label: str) -> str:
    if label in ["UASF:v0.14.0.uasfsegwit2", "UASF:v0.14.1-uasfsegwit0.3", "UASF:v0.14.2-uasfsegwit0.3"]:
        return ""
    if "uasfsegwit" in label.lower():
        version = label.split(":", 1)[1] if ":" in label else ""
        uasfsegwit_version = version.split("uasfsegwit")[1]
        version = version.split("uasfsegwit")[0]
        return f"UASF\n{version}\nuasfsegwit{uasfsegwit_version}"
    if label.lower().startswith("core"):
        version = label.split(":", 1)[1] if ":" in label else ""
        return f"Core\n{version}"
    if label.lower().startswith("uasf"):
        version = label.split(":", 1)[1] if ":" in label else ""
        return f"UASF\n{version}"
    if label.lower().startswith("segwit2x"):
        version = label.split(":", 1)[1] if ":" in label else ""
        return f"SegWit2x\n{version}"
    return label

def bip110_display_label(label: str) -> str:
    if label.lower().startswith("bip110"):
        version = label.split(":", 1)[1] if ":" in label else ""
        return f"BIP110\n{version}"
    if label.lower().startswith("core"):
        version = label.split(":", 1)[1] if ":" in label else ""
        return f"Core\n{version}"
    if label.lower().startswith("knots"):
        version = label.split(":", 1)[1] if ":" in label else ""
        match = re.match(r"^(v\d+\.\d+(?:\.\d+)?)\.knots(\d{8})$", version, re.IGNORECASE)
        if match:
            return f"Knots\n{match.group(1)}\n{match.group(2)}"
        return f"Knots\n{version.replace('.knots', '')}"
    return label

SEGWIT_RELEASE_TIMES_UTC = {
    "Core:v0.13.2": "2017-01-03 10:48 UTC",
    "UASF:v0.14.0rc1": "2017-02-17 20:59 UTC",
    "UASF:v0.14.0rc2": "2017-02-23 20:41 UTC",
    "UASF:v0.14.0rc3": "2017-02-28 12:56 UTC",
    "UASF:v0.14.0": "2017-03-07 10:52 UTC",
    "Core:v0.14.0": "2017-03-08 15:20 UTC",
    "UASF:v0.14.0.uasfsegwit": "2017-03-26 16:03 UTC",
    "UASF:v0.14.0.uasfsegwit1.1": "2017-03-28 16:04 UTC",
    "UASF:v0.14.1rc1": "2017-04-05 07:20 UTC",
    "UASF:v0.14.0.uasfsegwit3": "2017-04-07 14:32 UTC",
    "UASF:v0.14.0-uasfsegwit0.3": "2017-04-07 14:35 UTC",
    "UASF:v0.14.1rc2": "2017-04-14 10:50 UTC",
    "UASF:v0.14.1": "2017-04-20 19:45 UTC",
    "Core:v0.14.1": "2017-04-22 14:19 UTC",
    "UASF:v0.14.2rc1": "2017-06-01 20:03 UTC",
    "UASF:v0.14.2rc2": "2017-06-06 14:46 UTC",
    "UASF:v0.14.2": "2017-06-15 12:08 UTC",
    "UASF:v0.14.2-uasfsegwit1.0": "2017-07-10 16:29 UTC",
    "SegWit2x:v1.14.4": "2017-07-17 22:48 UTC",
}

BIP110_EXCLUDED_RELEASE_LABELS = {
    "core:v29.4",
}

def block_time_at_height(rpc, height: int) -> int:
    tip = int(rpc_call("getblockcount"))
    tip_hash = rpc_call("getblockhash", tip)
    tip_ts = int(rpc_call("getblockheader", tip_hash)["time"] )
    if height <= tip:
        h = rpc_call("getblockhash", int(height))
        return int(rpc_call("getblockheader", h)["time"] )
    return tip_ts + (height - tip) * 600

def height_at_or_before_timestamp(rpc, ts: int, lo: int, hi: int) -> int:
    best = lo
    while lo <= hi:
        mid = (lo + hi) // 2
        mid_ts = block_time_at_height(rpc, mid)
        if mid_ts <= ts:
            best = mid
            lo = mid + 1
        else:
            hi = mid - 1
    return best

def compute_month_ticks(rpc, start_height: int, num_periods: int, period_size: int, bar_width: float = 0.5):
    end_height = start_height + num_periods * period_size
    start_dt = datetime.fromtimestamp(block_time_at_height(rpc, start_height), tz=timezone.utc)
    end_dt = datetime.fromtimestamp(block_time_at_height(rpc, end_height), tz=timezone.utc)

    cur = datetime(start_dt.year, start_dt.month, 1, tzinfo=timezone.utc)
    if cur < start_dt:
        y = cur.year + (cur.month // 12)
        m = (cur.month % 12) + 1
        cur = datetime(y, m, 1, tzinfo=timezone.utc)

    ticks, labels = [], []
    used = set()

    while cur <= end_dt:
        ts = int(cur.timestamp())
        h = height_at_or_before_timestamp(rpc, ts, lo=start_height, hi=end_height)

        period_idx = 1 + (h - start_height) // period_size
        period_idx = int(clamp(period_idx, 1, num_periods))

        period_start = start_height + (period_idx - 1) * period_size
        frac = (h - period_start) / period_size
        frac = clamp(frac, 0.0, 1.0)

        x = period_idx + (frac - 0.5) * bar_width
        x = clamp(x, period_idx - bar_width / 2 + 1e-6, period_idx + bar_width / 2 - 1e-6)

        if period_idx not in used:
            used.add(period_idx)
            ticks.append(round(float(x), 6))
            labels.append(cur.strftime("%Y") if cur.month == 1 else cur.strftime("%b"))

        y = cur.year + (cur.month // 12)
        m = (cur.month % 12) + 1
        cur = datetime(y, m, 1, tzinfo=timezone.utc)

    return ticks, labels

here = Path(__file__).resolve().parent
main_dir_env = os.getenv("MAIN_DIR")
if main_dir_env:
    default_env_path = Path(main_dir_env).expanduser().resolve() / ".env"
else:
    default_env_path = here / ".env"
env_path = Path(os.getenv("ANIMATIONS_ENV_FILE", str(default_env_path))).expanduser()
load_dotenv(dotenv_path=env_path)

rpc_user = os.getenv("RPC_USER")
rpc_password = os.getenv("RPC_PASSWORD")
if not rpc_user or not rpc_password:
    raise RuntimeError("RPC_USER / RPC_PASSWORD not set in environment.")

BIP110_RPC_HOST = os.getenv("BIP110_RPC_HOST", "127.0.0.1")
BIP110_RPC_PORT = os.getenv("BIP110_RPC_PORT", "8335")
BIP110_RPC_USER = os.getenv("BIP110_RPC_USER", rpc_user)
BIP110_RPC_PASSWORD = os.getenv("BIP110_RPC_PASSWORD", rpc_password)
BIP110_NODE_SYNC_MAX_ATTEMPTS = int(os.getenv("BIP110_NODE_SYNC_MAX_ATTEMPTS", "6"))
BIP110_NODE_SYNC_RETRY_SECONDS = float(os.getenv("BIP110_NODE_SYNC_RETRY_SECONDS", "10"))

RPC_RETRY_EXCEPTIONS = (ConnectionError, OSError, RemoteDisconnected, socket.timeout, TimeoutError)

def _make_rpc(max_attempts: int = 10, retry_delay: float = 6.0) -> AuthServiceProxy:
    url = f"http://{quote(rpc_user, safe='')}:{quote(rpc_password, safe='')}@127.0.0.1:8332"
    last_err: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            conn = AuthServiceProxy(url, timeout=120)
            conn.getblockcount()  # verify RPC is actually responsive
            return conn
        except RPC_RETRY_EXCEPTIONS as exc:
            last_err = exc
            print(f"[bip110] RPC not ready (attempt {attempt}/{max_attempts}): {exc}")
            if attempt < max_attempts:
                time.sleep(retry_delay)
        except Exception as exc:
            raise RuntimeError(f"Bitcoin RPC error: {exc}") from exc
    raise RuntimeError(f"Bitcoin RPC unavailable after {max_attempts} attempts: {last_err}")

rpc = _make_rpc()

def rpc_call(method_name: str, *args, max_attempts: int = 3, retry_delay: float = 2.0):
    global rpc
    last_err: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            return getattr(rpc, method_name)(*args)
        except RPC_RETRY_EXCEPTIONS as exc:
            last_err = exc
            print(f"[bip110] RPC {method_name} failed (attempt {attempt}/{max_attempts}): {exc}")
            if attempt >= max_attempts:
                break
            rpc = _make_rpc(max_attempts=3, retry_delay=retry_delay)
            time.sleep(retry_delay)
    raise RuntimeError(f"Bitcoin RPC {method_name} unavailable after {max_attempts} attempts: {last_err}") from last_err

def _make_bip110_rpc() -> AuthServiceProxy:
    url = (
        f"http://{quote(BIP110_RPC_USER, safe='')}:{quote(BIP110_RPC_PASSWORD, safe='')}"
        f"@{BIP110_RPC_HOST}:{BIP110_RPC_PORT}"
    )
    return AuthServiceProxy(url, timeout=30)

def find_latest_common_height(bip110_rpc, max_height: int) -> int | None:
    upper = int(max_height)
    if upper < 0:
        return None

    try:
        if str(bip110_rpc.getblockhash(upper)) == str(rpc_call("getblockhash", upper)):
            return upper
    except Exception:
        pass

    lo = 0
    hi = upper
    latest_common = None
    while lo <= hi:
        mid = (lo + hi) // 2
        try:
            legacy_hash = str(rpc_call("getblockhash", mid))
            bip110_hash = str(bip110_rpc.getblockhash(mid))
        except Exception:
            hi = mid - 1
            continue

        if legacy_hash == bip110_hash:
            latest_common = mid
            lo = mid + 1
        else:
            hi = mid - 1
    return latest_common

def check_bip110_node_sync(legacy_height: int, legacy_hash: str) -> dict:
    max_attempts = max(1, BIP110_NODE_SYNC_MAX_ATTEMPTS)
    retry_seconds = max(0.0, BIP110_NODE_SYNC_RETRY_SECONDS)
    last_error = None
    bip110_height = None
    bip110_hash_at_legacy_height = None
    latest_common_height = None
    relation = "not_checked"
    attempts_used = 0

    for attempt in range(1, max_attempts + 1):
        attempts_used = attempt
        try:
            bip110_rpc = _make_bip110_rpc()
            bip110_height = int(bip110_rpc.getblockcount())
            print(
                f"[bip110] node sync check attempt {attempt}/{max_attempts}: "
                f"legacy={legacy_height:,} bip110={bip110_height:,}"
            )

            if bip110_height >= legacy_height:
                bip110_hash_at_legacy_height = str(bip110_rpc.getblockhash(legacy_height))
                if bip110_hash_at_legacy_height == str(legacy_hash):
                    relation = "bip110_ahead" if bip110_height > legacy_height else "same_tip"
                    print(f"[bip110] node sync check: in sync ({relation}).")
                    return {
                        "checked_utc": datetime.now(timezone.utc).isoformat(),
                        "in_sync": True,
                        "status": "in_sync",
                        "relation": relation,
                        "legacy_height": int(legacy_height),
                        "legacy_hash": str(legacy_hash),
                        "bip110_height": int(bip110_height),
                        "bip110_hash_at_legacy_height": bip110_hash_at_legacy_height,
                        "height_delta": int(bip110_height - legacy_height),
                        "blocks_behind": 0,
                        "latest_common_height": int(legacy_height),
                        "blocks_since_common_height": 0,
                        "attempts": int(attempt),
                        "max_attempts": int(max_attempts),
                        "retry_seconds": float(retry_seconds),
                        "error": None,
                    }
                relation = "hash_mismatch"
                last_error = (
                    f"BIP-110 hash at main height {legacy_height:,} was "
                    f"{bip110_hash_at_legacy_height}, expected {legacy_hash}"
                )
                break
            else:
                relation = "bip110_behind"
                last_error = f"BIP-110 node is behind main height {legacy_height:,}."
                try:
                    bip110_tip_hash = str(bip110_rpc.getblockhash(int(bip110_height)))
                    legacy_hash_at_bip110_tip = str(rpc_call("getblockhash", int(bip110_height)))
                    if bip110_tip_hash != legacy_hash_at_bip110_tip:
                        relation = "hash_mismatch"
                        common_search_height = min(int(legacy_height), int(bip110_height))
                        latest_common_height = find_latest_common_height(bip110_rpc, common_search_height)
                        last_error = (
                            f"BIP-110 tip hash at height {int(bip110_height):,} differs from the legacy hash; "
                            f"latest common height is {latest_common_height:,}."
                            if latest_common_height is not None
                            else f"BIP-110 tip hash at height {int(bip110_height):,} differs from the legacy hash."
                        )
                        break
                except Exception as exc:
                    last_error = f"{last_error} Hash comparison at BIP-110 tip failed: {exc}"
        except Exception as exc:
            relation = "rpc_error"
            last_error = str(exc)
            print(f"[bip110] node sync check failed (attempt {attempt}/{max_attempts}): {exc}")

        if attempt < max_attempts:
            time.sleep(retry_seconds)

    try:
        bip110_rpc = _make_bip110_rpc()
        if bip110_height is None:
            bip110_height = int(bip110_rpc.getblockcount())
        common_search_height = min(int(legacy_height), int(bip110_height))
        latest_common_height = find_latest_common_height(bip110_rpc, common_search_height)
        if latest_common_height is not None and relation == "bip110_behind":
            try:
                bip110_tip_hash = str(bip110_rpc.getblockhash(int(bip110_height)))
                legacy_hash_at_bip110_tip = str(rpc_call("getblockhash", int(bip110_height)))
                if bip110_tip_hash != legacy_hash_at_bip110_tip:
                    relation = "hash_mismatch"
                    last_error = (
                        f"BIP-110 tip hash at height {int(bip110_height):,} differs from the legacy hash; "
                        f"latest common height is {latest_common_height:,}."
                    )
            except Exception as exc:
                last_error = f"{last_error or ''} Latest common height check was incomplete: {exc}".strip()
    except Exception as exc:
        last_error = f"{last_error or ''} Latest common height check failed: {exc}".strip()

    print(f"[bip110] node sync check: out of sync ({relation}): {last_error}")
    height_delta = int(bip110_height - legacy_height) if bip110_height is not None else None
    blocks_behind = max(0, int(legacy_height - bip110_height)) if bip110_height is not None else None
    blocks_since_common = (
        int(legacy_height - latest_common_height)
        if latest_common_height is not None
        else None
    )
    return {
        "checked_utc": datetime.now(timezone.utc).isoformat(),
        "in_sync": False,
        "status": "out_of_sync",
        "relation": relation,
        "legacy_height": int(legacy_height),
        "legacy_hash": str(legacy_hash),
        "bip110_height": int(bip110_height) if bip110_height is not None else None,
        "bip110_hash_at_legacy_height": bip110_hash_at_legacy_height,
        "height_delta": height_delta,
        "blocks_behind": blocks_behind,
        "latest_common_height": int(latest_common_height) if latest_common_height is not None else None,
        "blocks_since_common_height": blocks_since_common,
        "attempts": int(attempts_used or max_attempts),
        "max_attempts": int(max_attempts),
        "retry_seconds": float(retry_seconds),
        "error": last_error,
    }

module_dir = here
if not (module_dir / "segwit_releases.py").exists() or not (module_dir / "bip110_releases.py").exists():
    main_dir = os.getenv("MAIN_DIR")
    if not main_dir:
        raise RuntimeError("Release modules missing locally and MAIN_DIR is not set for fallback.")
    fallback_dir = Path(main_dir).expanduser().resolve() / "Signaling Periods"
    if not (fallback_dir / "segwit_releases.py").exists() or not (fallback_dir / "bip110_releases.py").exists():
        raise RuntimeError("Release modules not found in local repo path or MAIN_DIR/Signaling Periods.")
    module_dir = fallback_dir

sys.path.insert(0, str(module_dir))
from segwit_releases import segwit_releases
from bip110_releases import bip110_releases

webapp_dir = Path(os.getenv("BIP110_WEBAPP_DATA_DIR", str(here / "webapp_data"))).expanduser()
webapp_dir.mkdir(parents=True, exist_ok=True)

def load_existing_bip110_metadata(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}

def existing_bip110_dashboard_is_finalized(path: Path) -> bool:
    metadata = load_existing_bip110_metadata(path)
    try:
        source_height = int(metadata.get("source_block_height"))
    except Exception:
        return False
    return source_height >= BIP110_FINAL_UPDATE_HEIGHT

for stale in ("segwit_block_points.csv", "bip110_block_points.csv"):
    stale_path = webapp_dir / stale
    if stale_path.exists():
        stale_path.unlink()

print(f"Using signaling module dir: {module_dir}")
print(f"Using webapp data dir: {webapp_dir}")


# --- GitHub Release Datetime and URL Fetcher ---
import requests
import re

def fetch_github_release_metadata(cache_path: Path | None = None, *, allow_network: bool = False):
    """
    Returns a dict mapping (repo, short_label) to dict with 'published_at', 'html_url', and 'tag_name'.
    For BIP110, matches tags containing the version string (e.g., v0.4, v0.4.1) anywhere in the tag.
    """
    empty = {"bip110": {}, "core": {}, "knots": {}}

    if cache_path and cache_path.exists() and not allow_network:
        try:
            with cache_path.open("r", encoding="utf-8") as f:
                cached = json.load(f)
            print(f"[bip110] Using cached release metadata from {cache_path.name}.")
            return {
                "bip110": cached.get("bip110", {}),
                "core": cached.get("core", {}),
                "knots": cached.get("knots", {}),
            }
        except Exception as exc:
            print(f"[bip110] Release metadata cache unreadable; using empty cache: {exc}")
            return empty

    if not allow_network:
        print("[bip110] Release metadata network refresh skipped.")
        return empty

    github_token = os.getenv("GITHUB_TOKEN")
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "bip110-release-updater",
    }
    if github_token:
        headers["Authorization"] = f"Bearer {github_token}"

    def fetch_all_releases(owner, repo):
        url = f"https://api.github.com/repos/{owner}/{repo}/releases?per_page=100"
        releases = []
        while url:
            r = requests.get(url, headers=headers, timeout=20)
            r.raise_for_status()
            releases.extend(r.json())
            # Pagination
            url = r.links.get('next', {}).get('url')
        return releases

    try:
        # Fetch releases for the release-marker repos
        bip110_releases = fetch_all_releases("dathonohm", "bitcoin")
        core_releases = fetch_all_releases("bitcoin", "bitcoin")
        knots_releases = fetch_all_releases("bitcoinknots", "bitcoin")
    except Exception as exc:
        if cache_path and cache_path.exists():
            try:
                with cache_path.open("r", encoding="utf-8") as f:
                    cached = json.load(f)
                print(f"[bip110] GitHub release refresh failed; using cached metadata: {exc}")
                return {
                    "bip110": cached.get("bip110", {}),
                    "core": cached.get("core", {}),
                    "knots": cached.get("knots", {}),
                }
            except Exception:
                pass
        print(f"[bip110] GitHub release refresh failed; release metadata unavailable: {exc}")
        return empty

    # For BIP110, match tags containing the version string (e.g., v0.4, v0.4.1) anywhere in the tag
    bip110_map = {}
    for rel in bip110_releases:
        tag = rel.get("tag_name")
        published = rel.get("published_at")
        url = rel.get("html_url")
        if tag and published:
            # Extract version patterns like v0.4, v0.4.1, etc.
            version_matches = re.findall(r"v0\.\d+(?:\.\d+)?", tag)
            for version in version_matches:
                bip110_map[version] = {"published_at": published, "html_url": url, "tag_name": tag}
    core_map = {}
    for rel in core_releases:
        tag = rel.get("tag_name")
        published = rel.get("published_at")
        url = rel.get("html_url")
        if tag and published:
            core_map[tag] = {"published_at": published, "html_url": url, "tag_name": tag}
    knots_map = {}
    for rel in knots_releases:
        tag = rel.get("tag_name")
        published = rel.get("published_at")
        url = rel.get("html_url")
        if tag and published and ".knots" in tag.lower():
            knots_map[tag] = {"published_at": published, "html_url": url, "tag_name": tag}
    payload = {"bip110": bip110_map, "core": core_map, "knots": knots_map}
    if cache_path:
        try:
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            with cache_path.open("w", encoding="utf-8") as f:
                json.dump(payload, f, separators=(",", ":"), ensure_ascii=True)
            print(f"[bip110] Refreshed release metadata cache at {cache_path.name}.")
        except Exception as exc:
            print(f"[bip110] Failed to write release metadata cache: {exc}")
    return payload

# Build a mapping from label to release metadata (datetime, url, tag)
release_metadata_map = fetch_github_release_metadata(
    webapp_dir / "release_metadata_cache.json",
    allow_network=truthy_env("BIP110_REFRESH_RELEASE_METADATA"),
)

def load_existing_release_metadata(path: Path):
    if not path.exists():
        return {}
    try:
        with path.open("r", newline="", encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
    except Exception:
        return {}
    metadata = {}
    for row in rows:
        label = str(row.get("label") or "").strip()
        if not label:
            continue
        metadata[label] = {
            "release_time_utc": str(row.get("release_time_utc") or "").strip(),
            "github_url": str(row.get("github_url") or "").strip(),
            "tag_name": str(row.get("github_tag") or "").strip(),
        }
    return metadata

existing_release_metadata_by_label = load_existing_release_metadata(webapp_dir / "bip110_releases.csv")

def get_release_metadata(label):
    if ":" in label:
        prefix, version = label.split(":", 1)
    else:
        prefix, version = label, ""
    prefix = prefix.lower()
    if prefix == "bip110":
        meta = release_metadata_map["bip110"].get(version)
        # Fallback: try to find a version substring match (e.g., v0.4 matches v0.4.1)
        if not meta:
            # Prefer the first key where version is a prefix (e.g., v0.4.1 startswith v0.4)
            for k, v in release_metadata_map["bip110"].items():
                if version and k.startswith(version):
                    meta = v
                    break
        if not meta:
            # Also try if the version is a prefix of the key (e.g., v0.4 startswith v0.4.1)
            for k, v in release_metadata_map["bip110"].items():
                if k and version.startswith(k):
                    meta = v
                    break
        if not meta:
            # As a last resort, match if the version string is anywhere in the key
            for k, v in release_metadata_map["bip110"].items():
                if version in k:
                    meta = v
                    break
        if meta:
            # Format datetime
            dt = meta["published_at"]
            try:
                dt_obj = datetime.fromisoformat(dt.replace("Z", "+00:00"))
                dt_fmt = dt_obj.strftime("%Y-%m-%d %H:%M UTC")
            except Exception:
                dt_fmt = dt
            return {"release_time_utc": dt_fmt, "github_url": meta["html_url"], "tag_name": meta["tag_name"]}
    elif prefix == "core":
        meta = release_metadata_map["core"].get(version)
        if meta:
            dt = meta["published_at"]
            try:
                dt_obj = datetime.fromisoformat(dt.replace("Z", "+00:00"))
                dt_fmt = dt_obj.strftime("%Y-%m-%d %H:%M UTC")
            except Exception:
                dt_fmt = dt
            return {"release_time_utc": dt_fmt, "github_url": meta["html_url"], "tag_name": meta["tag_name"]}
    elif prefix == "knots":
        meta = release_metadata_map["knots"].get(version)
        if meta:
            dt = meta["published_at"]
            try:
                dt_obj = datetime.fromisoformat(dt.replace("Z", "+00:00"))
                dt_fmt = dt_obj.strftime("%Y-%m-%d %H:%M UTC")
            except Exception:
                dt_fmt = dt
            return {"release_time_utc": dt_fmt, "github_url": meta["html_url"], "tag_name": meta["tag_name"]}
    fallback = existing_release_metadata_by_label.get(label)
    if fallback:
        return fallback
    return {"release_time_utc": "", "github_url": "", "tag_name": ""}

# --- Patch for missing BIP110 datetimes/urls ---
# No longer needed: fallback now handled in fetch_github_release_metadata and get_release_metadata.

def patch_missing_release_metadata(bip110_release_rows):
    return bip110_release_rows

MEMPOOL_BLOCKS_API = "https://mempool.space/api/v1/blocks"
MEMPOOL_REQUEST_TIMEOUT_SECONDS = (5, 20)
POSTGRES_BLOCK_HASH_RECHECK_INTERVAL = 100
MINER_ATTRIBUTION_LOOKUP_VERSION = 2

def skip_mempool_fetches():
    explicit_skip = os.getenv("BIP110_SKIP_MEMPOOL_FETCH")
    if explicit_skip is not None:
        return truthy_env("BIP110_SKIP_MEMPOOL_FETCH")
    return not truthy_env("BIP110_ENABLE_MEMPOOL_FETCH")

def mempool_skip_reason():
    if os.getenv("BIP110_SKIP_MEMPOOL_FETCH") is not None:
        return "BIP110_SKIP_MEMPOOL_FETCH"
    return "fast local-only mode"

def slugify_miner_name(value):
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())

def normalize_lookup_text(value):
    text = str(value or "").lower()
    return re.sub(r"[^a-z0-9]+", "", text)

OCEAN_SUB_MINER_ALIASES = {
    "pyblockdatum": "PyBLOCKDatum",
}


def canonical_ocean_sub_miner(value):
    sub_miner = str(value or "").strip()
    if not sub_miner:
        return ""
    return OCEAN_SUB_MINER_ALIASES.get(normalize_lookup_text(sub_miner), sub_miner)


def decode_coinbase_scriptsig_text(value):
    text = str(value or "").strip()
    if not text:
        return ""
    try:
        raw = bytes.fromhex(text)
    except ValueError:
        return ""
    decoded = "".join(chr(byte) if 32 <= byte <= 126 else " " for byte in raw)
    return re.sub(r"\s+", " ", decoded).strip()

def extract_printable_after_marker(raw, marker):
    lower_raw = raw.lower()
    marker_lower = marker.lower()
    idx = lower_raw.find(marker_lower)
    if idx < 0:
        return ""
    tail = raw[idx + len(marker):]
    if tail and 1 <= tail[0] <= 75:
        pushed = tail[1:1 + tail[0]]
        pushed_text = []
        for byte in pushed:
            if byte == 0 or byte < 32 or byte > 126:
                break
            pushed_text.append(chr(byte))
        if pushed_text:
            return "".join(pushed_text).strip(" /|:-")
    chars = []
    for byte in tail:
        if byte == 0 or byte < 32 or byte > 126:
            break
        chars.append(chr(byte))
    return "".join(chars).strip(" /|:-")

def normalize_miner_payload(miner):
    if not isinstance(miner, dict):
        text = str(miner or "").strip()
        return {"name": text, "slug": "", "pool": "", "sub_miner": ""} if text else {}
    name = str(miner.get("name") or "").strip()
    if not name:
        return {}
    return {
        "name": name,
        "slug": str(miner.get("slug") or "").strip().lower() or slugify_miner_name(name),
        "pool": str(miner.get("pool") or "").strip(),
        "sub_miner": str(miner.get("sub_miner") or miner.get("subMiner") or "").strip(),
        "hash": str(miner.get("hash") or miner.get("block_hash") or miner.get("id") or "").strip(),
        "source": str(miner.get("source") or "").strip(),
        "matched_tag": str(miner.get("matched_tag") or "").strip(),
    }

def is_placeholder_miner(miner):
    name = normalize_lookup_text((miner or {}).get("name") if isinstance(miner, dict) else miner)
    return name in {"unknown", "loading", "unavailable"}

def serialize_miner_payload(miner):
    normalized = normalize_miner_payload(miner)
    if not normalized:
        return {}
    return {
        key: value
        for key, value in normalized.items()
        if key in {"name", "slug", "pool", "sub_miner", "hash"} or value
    }

def ocean_miner_from_coinbase_scriptsig(scriptsig):
    try:
        raw = bytes.fromhex(str(scriptsig or "").strip())
    except ValueError:
        raw = b""
    sub_miner = extract_printable_after_marker(raw, b"< OCEAN.XYZ >") if raw else ""
    if sub_miner:
        normalized = normalize_lookup_text(sub_miner)
        if normalized not in {"ocean", "oceanxyz"}:
            canonical_sub_miner = canonical_ocean_sub_miner(sub_miner)
            return {
                "name": f"{canonical_sub_miner} (OCEAN)",
                "slug": "ocean",
                "pool": "OCEAN",
                "sub_miner": canonical_sub_miner,
                "source": "local_coinbase_tag",
                "matched_tag": f"OCEAN:{sub_miner}",
            }
    return None

def ocean_miner_from_coinbase_text(decoded_text):
    match = re.search(r"<\s*OCEAN\.XYZ\s*>\s*([^<>\x00\r\n]{1,48})", decoded_text, re.IGNORECASE)
    if not match:
        return None
    sub_miner = re.split(r"\s{2,}|\s+[A-Fa-f0-9]{6,}\b", match.group(1).strip())[0].strip(" /|:-")
    if not sub_miner:
        return {"name": "OCEAN", "slug": "ocean", "pool": "OCEAN", "sub_miner": ""}
    normalized = normalize_lookup_text(sub_miner)
    if normalized in {"ocean", "oceanxyz"}:
        return {"name": "OCEAN", "slug": "ocean", "pool": "OCEAN", "sub_miner": ""}
    canonical_sub_miner = canonical_ocean_sub_miner(sub_miner)
    return {
        "name": f"{canonical_sub_miner} (OCEAN)",
        "slug": "ocean",
        "pool": "OCEAN",
        "sub_miner": canonical_sub_miner,
        "source": "local_coinbase_tag",
        "matched_tag": f"OCEAN:{sub_miner}",
    }

def normalize_mempool_miner_attribution(block):
    extras = block.get("extras") if isinstance(block.get("extras"), dict) else {}
    pool = extras.get("pool")

    if isinstance(pool, dict):
        pool_name = str(pool.get("name") or "").strip()
        pool_slug = str(pool.get("slug") or "").strip().lower()
        miner_names = pool.get("minerNames")
        if pool_name.upper() == "OCEAN" or pool_slug == "ocean":
            if isinstance(miner_names, list):
                for value in miner_names:
                    text = str(value or "").strip()
                    normalized = text.replace(".", "").replace(" ", "").lower()
                    if text and normalized not in ("ocean", "oceanxyz"):
                        canonical_text = canonical_ocean_sub_miner(text)
                        return {
                            "name": f"{canonical_text} ({pool_name or 'OCEAN'})",
                            "slug": pool_slug,
                            "pool": pool_name or "OCEAN",
                            "sub_miner": canonical_text,
                            "source": "mempool.space",
                        }
            if pool_name:
                return {"name": pool_name, "slug": pool_slug, "pool": pool_name, "source": "mempool.space"}

    candidates = []
    if isinstance(pool, dict):
        candidates.append((pool.get("name"), pool.get("slug")))
    candidates.extend([
        (extras.get("poolName"), extras.get("poolSlug")),
        (extras.get("minerName"), extras.get("minerSlug")),
        (extras.get("miner"), extras.get("minerSlug")),
        (block.get("poolName"), block.get("poolSlug")),
        (block.get("miner"), block.get("minerSlug")),
    ])

    for value, slug in candidates:
        text = str(value or "").strip()
        if text:
            return {"name": text, "slug": str(slug or "").strip().lower(), "source": "mempool.space"}
    return {}

def load_existing_signal_miners(path: Path):
    if not path.exists():
        return {}
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return {}
    if not isinstance(data, dict):
        return {}

    miners = {}
    for height, miner in data.items():
        try:
            h = int(height)
        except (TypeError, ValueError):
            continue
        if isinstance(miner, dict):
            normalized = normalize_miner_payload(miner)
            if normalized:
                miners[h] = normalized
            continue
        text = str(miner or "").strip()
        if text:
            miners[h] = {"name": text, "slug": "", "pool": "", "sub_miner": ""}
    return miners

def postgres_connect():
    try:
        import psycopg2  # type: ignore
    except Exception as exc:
        print(f"[bip110] PostgreSQL lookup skipped: psycopg2 unavailable ({exc}).")
        return None

    database = os.getenv("POSTGRES_DB") or os.getenv("PGDATABASE")
    user = os.getenv("POSTGRES_USER") or os.getenv("PGUSER")
    password = os.getenv("POSTGRES_PASSWORD") or os.getenv("PGPASSWORD")
    host = os.getenv("POSTGRES_HOST") or os.getenv("PGHOST") or "localhost"
    port = os.getenv("POSTGRES_PORT") or os.getenv("PGPORT") or "5432"
    if not database or not user:
        print("[bip110] PostgreSQL lookup skipped: POSTGRES_DB/POSTGRES_USER not configured.")
        return None

    try:
        return psycopg2.connect(host=host, port=port, database=database, user=user, password=password)
    except Exception as exc:
        print(f"[bip110] PostgreSQL lookup skipped: {exc}.")
        return None

def fetch_postgres_block_hashes(heights):
    target_heights = sorted(set(int(height) for height in heights))
    if not target_heights:
        return {}

    conn = postgres_connect()
    if conn is None:
        return {}

    try:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT blockheight, blockhash
                    FROM blockheader
                    WHERE blockheight = ANY(%s)
                    """,
                    (target_heights,),
                )
                rows = cur.fetchall()
        finally:
            conn.close()
    except Exception as exc:
        print(f"[bip110] PostgreSQL block hash recheck skipped: {exc}.")
        return {}

    hashes = {}
    for height, block_hash in rows:
        text = str(block_hash or "").strip()
        if text:
            hashes[int(height)] = text
    return hashes

def fetch_postgres_coinbase_attribution_rows(heights):
    target_heights = sorted(set(int(height) for height in heights))
    if not target_heights:
        return {}

    conn = postgres_connect()
    if conn is None:
        return {}

    try:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        bh.blockheight,
                        bh.blockhash,
                        bh.coinbasescriptsig,
                        COALESCE(
                            array_agg(o.address ORDER BY o.vout)
                                FILTER (
                                    WHERE o.address IS NOT NULL
                                      AND o.address <> ''
                                      AND o.address <> 'OP_RETURN'
                                ),
                            '{}'
                        ) AS coinbase_addresses
                    FROM blockheader bh
                    LEFT JOIN outputs o
                        ON o.blockheight = bh.blockheight
                       AND o.transactionnum = 1
                       AND o.fromcoinbase = true
                    WHERE bh.blockheight = ANY(%s)
                    GROUP BY bh.blockheight, bh.blockhash, bh.coinbasescriptsig
                    """,
                    (target_heights,),
                )
                rows = cur.fetchall()
        finally:
            conn.close()
    except Exception as exc:
        print(f"[bip110] PostgreSQL coinbase attribution lookup skipped: {exc}.")
        return {}

    payload = {}
    for height, block_hash, scriptsig, addresses in rows:
        payload[int(height)] = {
            "hash": str(block_hash or "").strip(),
            "coinbase_scriptsig": str(scriptsig or "").strip(),
            "coinbase_text": decode_coinbase_scriptsig_text(scriptsig),
            "coinbase_addresses": [str(address or "").strip() for address in (addresses or []) if str(address or "").strip()],
        }
    return payload

def load_miner_attribution_lookup(path: Path):
    if not path.exists():
        return None
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    if int(data.get("version") or 0) != MINER_ATTRIBUTION_LOOKUP_VERSION:
        return None

    def load_mapping(raw):
        if not isinstance(raw, dict):
            return {}
        mapping = {}
        for key, miner in raw.items():
            normalized = normalize_miner_payload(miner)
            if key and normalized and not is_placeholder_miner(normalized):
                mapping[str(key)] = normalized
        return mapping

    return {
        "tag_map": load_mapping(data.get("tag_map")),
        "address_map": load_mapping(data.get("address_map")),
        "generated_utc": str(data.get("generated_utc") or ""),
    }

def write_miner_attribution_lookup(path: Path, tag_map, address_map):
    payload = {
        "version": MINER_ATTRIBUTION_LOOKUP_VERSION,
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "source": "learned from local blockheader.coinbasescriptsig, coinbase outputs, and existing dashboard miner labels",
        "tag_map": {
            tag: {key: value for key, value in serialize_miner_payload(miner).items() if key != "hash"}
            for tag, miner in sorted(tag_map.items())
            if tag and normalize_miner_payload(miner)
        },
        "address_map": {
            address: {key: value for key, value in serialize_miner_payload(miner).items() if key != "hash"}
            for address, miner in sorted(address_map.items())
            if address and normalize_miner_payload(miner)
        },
    }
    tmp_path = path.with_suffix(f"{path.suffix}.tmp")
    with tmp_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"), ensure_ascii=True)
    tmp_path.replace(path)
    return payload

def miner_key(miner):
    normalized = normalize_miner_payload(miner)
    if not normalized:
        return ""
    return "|".join([
        normalized.get("name", ""),
        normalized.get("slug", ""),
        normalized.get("pool", ""),
        normalized.get("sub_miner", ""),
    ])

def fetch_rpc_coinbase_attribution_rows(heights, rpc_get, *, log_label="blocks"):
    target_heights = sorted(set(int(height) for height in heights))
    rows = {}
    for height in target_heights:
        try:
            block_hash = str(rpc_get("getblockhash", height) or "").strip()
            block = rpc_get("getblock", block_hash, 2)
        except Exception as exc:
            print(f"[{log_label}] RPC coinbase attribution lookup skipped at height {height:,}: {exc}")
            continue

        txs = block.get("tx") if isinstance(block, dict) else []
        coinbase_tx = txs[0] if isinstance(txs, list) and txs and isinstance(txs[0], dict) else {}
        vins = coinbase_tx.get("vin") if isinstance(coinbase_tx, dict) else []
        vin0 = vins[0] if isinstance(vins, list) and vins and isinstance(vins[0], dict) else {}
        scriptsig = str(vin0.get("coinbase") or "").strip()

        coinbase_addresses = []
        vouts = coinbase_tx.get("vout") if isinstance(coinbase_tx, dict) else []
        for vout in vouts if isinstance(vouts, list) else []:
            script_pub_key = vout.get("scriptPubKey") if isinstance(vout, dict) else {}
            if not isinstance(script_pub_key, dict):
                continue
            candidates = []
            if script_pub_key.get("address"):
                candidates.append(script_pub_key.get("address"))
            addresses = script_pub_key.get("addresses")
            if isinstance(addresses, list):
                candidates.extend(addresses)
            for address in candidates:
                text = str(address or "").strip()
                if text and text != "OP_RETURN":
                    coinbase_addresses.append(text)

        rows[height] = {
            "hash": block_hash,
            "coinbase_scriptsig": scriptsig,
            "coinbase_text": decode_coinbase_scriptsig_text(scriptsig),
            "coinbase_addresses": coinbase_addresses,
        }
    return rows

def build_miner_attribution_learning(existing_miners, target_heights, lookup_path: Path, *, target_row_fetcher=None):
    cached_lookup = load_miner_attribution_lookup(lookup_path)
    if cached_lookup:
        fetch_rows = target_row_fetcher or fetch_postgres_coinbase_attribution_rows
        return (
            fetch_rows(target_heights),
            cached_lookup["tag_map"],
            cached_lookup["address_map"],
        )

    learning_heights = sorted(set(int(height) for height in existing_miners) | set(int(height) for height in target_heights))
    postgres_rows = fetch_postgres_coinbase_attribution_rows(learning_heights)
    miner_by_key = {}
    tag_counts = {}
    address_counts = {}

    for height, miner in existing_miners.items():
        normalized_miner = normalize_miner_payload(miner)
        key = miner_key(normalized_miner)
        if not key or is_placeholder_miner(normalized_miner):
            continue
        miner_by_key[key] = normalized_miner
        row = postgres_rows.get(int(height)) or {}
        decoded_text = row.get("coinbase_text") or ""
        lookup_text = normalize_lookup_text(decoded_text)
        if lookup_text:
            candidates = {
                normalized_miner.get("name", ""),
                normalized_miner.get("sub_miner", ""),
                normalized_miner.get("pool", ""),
                normalized_miner.get("name", "").replace(" (OCEAN)", ""),
                normalized_miner.get("name", "").replace(" Pool", ""),
            }
            for value in candidates:
                token = normalize_lookup_text(value)
                if len(token) >= 4 and token in lookup_text:
                    tag_counts.setdefault(token, {}).setdefault(key, 0)
                    tag_counts[token][key] += 1

        for address in row.get("coinbase_addresses") or []:
            if not address:
                continue
            address_counts.setdefault(address, {}).setdefault(key, 0)
            address_counts[address][key] += 1

    manual_tags = {
        "foundryusapool": "Foundry USA",
        "foundryusa": "Foundry USA",
        "maramadeinusa": "MARA Pool",
        "marapool": "MARA Pool",
        "antpool": "AntPool",
        "f2pool": "F2Pool",
        "spiderpool": "SpiderPool",
        "luxortech": "Luxor",
        "luxor": "Luxor",
        "viabtc": "ViaBTC",
        "binance": "Binance Pool",
        "secpool": "SECPOOL",
        "slush": "Braiins Pool",
        "braiins": "Braiins Pool",
        "sbi": "SBI Crypto",
        "sbicrypto": "SBI Crypto",
        "btccom": "BTC.com",
        "whitepool": "WhitePool",
        "ultimus": "ULTIMUSPOOL",
        "ultimuspool": "ULTIMUSPOOL",
        "publicpool": "Public Pool",
    }
    miner_by_name = {
        normalize_lookup_text(miner.get("name")): miner
        for miner in miner_by_key.values()
        if miner.get("name")
    }
    for tag, name in manual_tags.items():
        miner = miner_by_name.get(normalize_lookup_text(name))
        if miner:
            tag_counts.setdefault(tag, {}).setdefault(miner_key(miner), 0)
            tag_counts[tag][miner_key(miner)] += 1000

    def winner(counts, *, min_count=1):
        if not counts:
            return None
        ranked = sorted(counts.items(), key=lambda item: item[1], reverse=True)
        if ranked[0][1] < min_count:
            return None
        if len(ranked) > 1 and ranked[0][1] == ranked[1][1]:
            return None
        return ranked[0][0]

    tag_map = {
        tag: miner_by_key[key]
        for tag, counts in tag_counts.items()
        for key in [winner(counts)]
        if key and key in miner_by_key
    }
    address_map = {
        address: miner_by_key[key]
        for address, counts in address_counts.items()
        for key in [winner(counts, min_count=2)]
        if key and key in miner_by_key
    }
    write_miner_attribution_lookup(lookup_path, tag_map, address_map)
    if target_row_fetcher:
        target_rows = dict(postgres_rows)
        target_rows.update(target_row_fetcher(target_heights))
        return target_rows, tag_map, address_map
    return postgres_rows, tag_map, address_map

def attribute_miners_locally(heights, existing_miners, *, lookup_path: Path, log_label="blocks", target_row_fetcher=None):
    target_heights = sorted(set(int(height) for height in heights))
    if not target_heights:
        return {}

    postgres_rows, tag_map, address_map = build_miner_attribution_learning(
        existing_miners,
        target_heights,
        lookup_path,
        target_row_fetcher=target_row_fetcher,
    )
    locally_attributed = {}

    for height in target_heights:
        row = postgres_rows.get(height)
        if not row:
            continue
        block_hash = str(row.get("hash") or "").strip()
        decoded_text = row.get("coinbase_text") or ""
        ocean_miner = ocean_miner_from_coinbase_scriptsig(row.get("coinbase_scriptsig")) or ocean_miner_from_coinbase_text(decoded_text)
        if ocean_miner:
            miner = dict(ocean_miner)
            if block_hash:
                miner["hash"] = block_hash
            locally_attributed[height] = miner
            continue

        lookup_text = normalize_lookup_text(decoded_text)
        matched = None
        for tag, miner in sorted(tag_map.items(), key=lambda item: len(item[0]), reverse=True):
            if tag and tag in lookup_text:
                matched = (tag, miner)
                break
        if matched:
            tag, miner = matched
            local_miner = normalize_miner_payload(miner)
            local_miner["source"] = "local_coinbase_tag"
            local_miner["matched_tag"] = tag
            if block_hash:
                local_miner["hash"] = block_hash
            locally_attributed[height] = local_miner
            continue

        for address in row.get("coinbase_addresses") or []:
            miner = address_map.get(address)
            if miner:
                local_miner = normalize_miner_payload(miner)
                local_miner["source"] = "local_coinbase_address"
                local_miner["matched_tag"] = address
                if block_hash:
                    local_miner["hash"] = block_hash
                locally_attributed[height] = local_miner
                break

    if locally_attributed:
        print(
            f"[{log_label}] local coinbase attribution filled "
            f"{len(locally_attributed):,}/{len(target_heights):,} missing miner(s)."
        )
    return locally_attributed

def select_block_hash_recheck_heights(target_heights, cached_hashes):
    sorted_heights = sorted(set(int(height) for height in target_heights))
    if not sorted_heights:
        return []
    first_height = sorted_heights[0]
    last_height = sorted_heights[-1]
    return [
        height
        for height in sorted_heights
        if height in cached_hashes
        and (
            height == last_height
            or (height - first_height) % POSTGRES_BLOCK_HASH_RECHECK_INTERVAL == 0
        )
    ]

def find_stale_cached_block_heights(target_heights, cached_hashes, *, log_label):
    recheck_heights = select_block_hash_recheck_heights(target_heights, cached_hashes)
    postgres_hashes = fetch_postgres_block_hashes(recheck_heights)
    if not postgres_hashes:
        return set(), {}

    stale_heights = set()
    for height in recheck_heights:
        postgres_hash = str(postgres_hashes.get(height) or "").strip()
        if not postgres_hash:
            continue
        cached_hash = str(cached_hashes.get(height) or "").strip()
        if cached_hash and cached_hash != postgres_hash:
            stale_heights.add(height)

    if stale_heights:
        sample = ", ".join(f"{height:,}" for height in sorted(stale_heights)[:8])
        suffix = "..." if len(stale_heights) > 8 else ""
        print(
            f"[{log_label}] queued reanalysis for {len(stale_heights):,} block(s) "
            f"after PostgreSQL hash recheck: {sample}{suffix}"
        )
    return stale_heights, postgres_hashes

def invalidate_reorged_miner_attributions(miners, target_heights):
    cached_hashes = {
        height: str((miner or {}).get("hash") or "").strip()
        for height, miner in miners.items()
    }
    stale_heights, postgres_hashes = find_stale_cached_block_heights(target_heights, cached_hashes, log_label="bip110")
    for height in stale_heights:
        miners.pop(height, None)
    for height, postgres_hash in postgres_hashes.items():
        if height not in stale_heights and height in miners and not str((miners[height] or {}).get("hash") or "").strip():
            miners[height]["hash"] = postgres_hash
    return stale_heights

def extract_block_low_fee_rate(block):
    extras = block.get("extras") if isinstance(block.get("extras"), dict) else {}
    fee_range = extras.get("feeRange")
    if not isinstance(fee_range, list) or not fee_range:
        return None
    try:
        fee_rate = float(fee_range[0])
    except (TypeError, ValueError):
        return None
    return fee_rate if fee_rate >= 0 else None

def fetch_block_low_fee_rates(heights, *, on_batch=None):
    pending = set(int(h) for h in heights)
    total = len(pending)
    if pending and skip_mempool_fetches():
        print(f"[low-activity-blocks] mempool.space fee-rate lookup skipped by {mempool_skip_reason()} for {total:,} height(s).")
        return {}, {}
    low_fee_rates = {}
    block_hashes = {}
    headers = {
        "Accept": "application/json",
        "User-Agent": "bip110-low-activity-updater",
    }

    def fetch_batch(start_height):
        try:
            r = requests.get(f"{MEMPOOL_BLOCKS_API}/{start_height}", headers=headers, timeout=MEMPOOL_REQUEST_TIMEOUT_SECONDS)
            if r.status_code == 429:
                return {"rate_limited": True, "start_height": start_height, "seen": set(), "fees": {}, "hashes": {}}
            r.raise_for_status()
            payload = r.json()
        except Exception as exc:
            return {"error": str(exc), "start_height": start_height, "seen": {start_height}, "fees": {}, "hashes": {}}

        blocks = payload if isinstance(payload, list) else [payload]
        seen_heights = set()
        batch_fee_rates = {}
        batch_hashes = {}
        for block in blocks:
            if not isinstance(block, dict):
                continue
            try:
                height = int(block.get("height"))
            except (TypeError, ValueError):
                continue
            if height not in pending:
                continue

            seen_heights.add(height)
            block_hash = str(block.get("id") or block.get("hash") or block.get("block_hash") or "").strip()
            if block_hash:
                batch_hashes[height] = block_hash
            fee_rate = extract_block_low_fee_rate(block)
            if fee_rate is not None:
                batch_fee_rates[height] = fee_rate
        return {"start_height": start_height, "seen": seen_heights or {start_height}, "fees": batch_fee_rates, "hashes": batch_hashes}

    batch_starts = []
    cursor = max(pending) if pending else 0
    min_height = min(pending) if pending else 0
    while cursor >= min_height:
        batch_starts.append(cursor)
        cursor -= 15

    processed = 0
    rate_limited = False
    wave_size = 64
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        for offset in range(0, len(batch_starts), wave_size):
            wave_added = 0
            futures = {
                executor.submit(fetch_batch, start_height): start_height
                for start_height in batch_starts[offset:offset + wave_size]
            }
            for future in concurrent.futures.as_completed(futures):
                result = future.result()
                start_height = int(result.get("start_height") or futures[future])
                if result.get("rate_limited"):
                    print(f"[low-activity-blocks] mempool.space rate limited fee-rate lookup at height {start_height}; leaving remaining fee-rate data for a future run.")
                    rate_limited = True
                    break
                if result.get("error"):
                    print(f"[low-activity-blocks] mempool.space fee-rate lookup failed at height {start_height}: {result['error']}")

                seen_heights = set(result.get("seen") or {start_height})
                pending.difference_update(seen_heights)
                batch_fee_rates = result.get("fees") or {}
                batch_hashes = result.get("hashes") or {}
                if batch_fee_rates:
                    low_fee_rates.update(batch_fee_rates)
                    block_hashes.update(batch_hashes)
                    if on_batch:
                        on_batch(batch_fee_rates, batch_hashes)

                processed += len(seen_heights)
                if processed <= 15 or processed % 1500 < len(seen_heights) or not pending:
                    completed = total - len(pending)
                    print(f"[low-activity-blocks] fee-rate lookup progress: {completed:,}/{total:,} heights")
            if rate_limited:
                break

    if pending:
        fetched_heights = set(low_fee_rates)
        unresolved = sorted(pending - fetched_heights)
        if unresolved:
            completed = total - len(pending)
            print(f"[low-activity-blocks] fee-rate lookup progress: {completed:,}/{total:,} heights")

    return low_fee_rates, block_hashes

def write_block_miners_payload(path: Path, target_heights, miners):
    target_set = set(int(height) for height in target_heights)
    payload = {
        str(height): serialize_miner_payload(miners[height])
        for height in sorted(target_set)
        if miners.get(height, {}).get("name")
    }
    tmp_path = path.with_suffix(f"{path.suffix}.tmp")
    with tmp_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"), ensure_ascii=True)
    tmp_path.replace(path)
    return payload

MINER_ATTRIBUTION_ENCODING = ["name", "slug", "pool", "sub_miner", "hash"]

def compact_miner_attribution(miner):
    if isinstance(miner, str):
        miner = {"name": miner}
    if not isinstance(miner, dict):
        return None

    values = [
        str(miner.get("name") or "").strip(),
        str(miner.get("slug") or "").strip(),
        str(miner.get("pool") or "").strip(),
        str(miner.get("sub_miner") or miner.get("subMiner") or "").strip(),
        str(miner.get("hash") or "").strip(),
    ]
    if not values[0]:
        return None
    while values and values[-1] == "":
        values.pop()
    return values

def build_compact_miner_attribution_entries(miners):
    entries = {}
    heights = []
    normalized_items = []
    for raw_height, miner in (miners or {}).items():
        try:
            height = int(raw_height)
        except (TypeError, ValueError):
            continue
        normalized_items.append((height, miner))

    for height, miner in sorted(normalized_items, key=lambda item: item[0]):
        compact = compact_miner_attribution(miner)
        if not compact:
            continue
        entries[str(height)] = compact
        heights.append(height)
    return entries, heights

def write_compact_miner_attributions(path: Path, miner_maps):
    source_keys = {
        "segwit": "s",
        "bip110": "b",
        "bip110_node": "n",
    }
    miners_payload = {}
    dataset_meta = {}

    for dataset_name, alias in source_keys.items():
        entries, heights = build_compact_miner_attribution_entries(miner_maps.get(dataset_name, {}))
        miners_payload[alias] = entries
        meta = {
            "alias": alias,
            "rows": len(entries),
        }
        if heights:
            meta["start_height"] = min(heights)
            meta["end_height"] = max(heights)
        dataset_meta[dataset_name] = meta

    dataset_meta["bip110_signal"] = dict(dataset_meta.get("bip110", {"alias": "b", "rows": 0}))
    dataset_meta["bip110_signal"]["alias"] = "b"
    dataset_meta["bip110_node_signal"] = dict(dataset_meta.get("bip110_node", {"alias": "n", "rows": 0}))
    dataset_meta["bip110_node_signal"]["alias"] = "n"

    payload = {
        "version": 1,
        "encoding": MINER_ATTRIBUTION_ENCODING,
        "datasets": dataset_meta,
        "miners": miners_payload,
    }
    tmp_path = path.with_suffix(f"{path.suffix}.tmp")
    with tmp_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"), ensure_ascii=True)
    tmp_path.replace(path)
    content_hash = hashlib.sha256(path.read_bytes()).hexdigest()

    return {
        "version": 1,
        "encoding": MINER_ATTRIBUTION_ENCODING,
        "rows": sum(len(entries) for entries in miners_payload.values()),
        "source": "compact consolidated miner attribution maps",
        "sha256": content_hash,
        "datasets": dataset_meta,
    }

def fetch_block_miners(heights, *, log_label="blocks", on_batch=None):
    pending = set(int(h) for h in heights)
    if not pending:
        return {}
    total = len(pending)
    if skip_mempool_fetches():
        print(f"[{log_label}] mempool.space miner lookup skipped by {mempool_skip_reason()} for {total:,} height(s).")
        return {}
    miners = {}
    headers = {
        "Accept": "application/json",
        "User-Agent": "bip110-miner-attribution-updater",
    }

    def fetch_batch(start_height):
        try:
            r = requests.get(f"{MEMPOOL_BLOCKS_API}/{start_height}", headers=headers, timeout=MEMPOOL_REQUEST_TIMEOUT_SECONDS)
            if r.status_code == 429:
                return {"rate_limited": True, "start_height": start_height, "seen": set(), "miners": {}}
            r.raise_for_status()
            payload = r.json()
        except Exception as exc:
            return {"error": str(exc), "start_height": start_height, "seen": {start_height}, "miners": {}}

        blocks = payload if isinstance(payload, list) else [payload]
        seen_heights = set()
        batch_miners = {}
        for block in blocks:
            if not isinstance(block, dict):
                continue
            try:
                height = int(block.get("height"))
            except (TypeError, ValueError):
                continue
            if height not in pending:
                continue

            seen_heights.add(height)
            miner = normalize_mempool_miner_attribution(block)
            if miner.get("name"):
                block_hash = str(block.get("id") or block.get("hash") or block.get("block_hash") or "").strip()
                if block_hash:
                    miner["hash"] = block_hash
                batch_miners[height] = miner
        return {"start_height": start_height, "seen": seen_heights or {start_height}, "miners": batch_miners}

    batch_starts = []
    cursor = max(pending) if pending else 0
    min_height = min(pending) if pending else 0
    while cursor >= min_height:
        batch_starts.append(cursor)
        cursor -= 15

    processed = 0
    rate_limited = False
    wave_size = 64
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        for offset in range(0, len(batch_starts), wave_size):
            wave_added = 0
            futures = {
                executor.submit(fetch_batch, start_height): start_height
                for start_height in batch_starts[offset:offset + wave_size]
            }
            for future in concurrent.futures.as_completed(futures):
                result = future.result()
                start_height = int(result.get("start_height") or futures[future])
                if result.get("rate_limited"):
                    print(f"[{log_label}] mempool.space rate limited miner lookup at height {start_height}; leaving remaining miner data for a future run.")
                    rate_limited = True
                    break
                if result.get("error"):
                    print(f"[{log_label}] mempool.space miner lookup failed at height {start_height}: {result['error']}")

                seen_heights = set(result.get("seen") or {start_height})
                pending.difference_update(seen_heights)
                batch_miners = result.get("miners") or {}
                if batch_miners:
                    wave_added += len(batch_miners)
                    miners.update(batch_miners)
                    if on_batch:
                        on_batch(batch_miners)

                processed += len(seen_heights)
                if processed <= 15 or processed % 1500 < len(seen_heights) or not pending:
                    completed = total - len(pending)
                    print(f"[{log_label}] miner lookup progress: {completed:,}/{total:,} heights")
            if rate_limited:
                break
            if wave_added == 0:
                print(f"[{log_label}] miner lookup found no new attributions in the latest wave; leaving remaining miner data for a future run.")
                break

    return miners

def export_block_miners(
    path: Path,
    heights,
    *,
    log_label="blocks",
    return_payload: bool = False,
    fast_tail_only: bool = False,
):
    target_heights = sorted(set(int(h) for h in heights))
    target_set = set(target_heights)
    existing = load_existing_signal_miners(path)
    miners = {
        height: miner
        for height, miner in existing.items()
        if height in target_set
    }
    changed = False
    stale_heights = invalidate_reorged_miner_attributions(miners, target_heights)
    if stale_heights:
        changed = True
    for height in list(miners):
        miner = miners.get(height) or {}
        if (
            str(miner.get("source") or "") == "local_coinbase_tag"
            and str(miner.get("matched_tag") or "").startswith("OCEAN:")
            and not str(miner.get("sub_miner") or "").strip()
        ):
            miners.pop(height, None)
            changed = True

    lookup_heights = target_heights
    if fast_tail_only and target_heights:
        tail_start = max(target_heights[0], target_heights[-1] - BIP110_MINER_TAIL_LOOKUP_DEPTH + 1)
        lookup_heights = [height for height in target_heights if height >= tail_start]

    missing_heights = [height for height in lookup_heights if height not in miners]
    def persist_batch(batch_miners, *, persist: bool = False):
        nonlocal changed
        miners.update(batch_miners)
        changed = True
        if persist:
            write_block_miners_payload(path, target_heights, miners)

    local = attribute_miners_locally(
        missing_heights,
        miners,
        lookup_path=path.with_name("miner_attribution_lookup.json"),
        log_label=log_label,
    )
    if local:
        persist_batch(local)

    remaining_heights = [height for height in missing_heights if height not in miners]
    fetched = fetch_block_miners(
        remaining_heights,
        log_label=log_label,
        on_batch=lambda batch: persist_batch(batch, persist=True),
    )
    if fetched:
        miners.update(fetched)
        changed = True

    payload = None
    if changed or not path.exists():
        payload = write_block_miners_payload(path, target_heights, miners)
        rows = len(payload)
    else:
        rows = sum(1 for height in target_heights if miners.get(height, {}).get("name"))
    meta = {"rows": rows, "source": f"local coinbase tags/addresses with {MEMPOOL_BLOCKS_API} fallback"}
    if return_payload:
        return meta, miners, payload, changed
    return meta

def export_signal_miners(path: Path, heights):
    return export_block_miners(path, heights, log_label="bip110")

def export_bip110_miners(path: Path, heights, *, return_payload: bool = False):
    return export_block_miners(
        path,
        heights,
        log_label="bip110",
        return_payload=return_payload,
        fast_tail_only=truthy_env("BIP110_FAST_MINER_UPDATE", "1"),
    )


def select_segwit_miner_sample_heights(block_rows):
    return sorted(
        int(row["height"])
        for row in block_rows
        if 1 <= int(row.get("period", 0)) <= SEGWIT_LAST_PERIOD
    )

def parse_iso_utc(ts: str):
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except Exception:
        return None

def normalize_bip110_version(version: str) -> str:
    v = str(version or "").strip()
    if not v:
        return v
    if "rc" in v:
        return v
    m = re.match(r"^(v0\.\d+)(?:\.\d+)?$", v)
    return m.group(1) if m else v

def build_dynamic_release_points(current_height: int):
    start_ts = int(block_time_at_height(rpc, BIP110_START))
    end_ts = int(block_time_at_height(rpc, current_height))

    points = []

    for version, meta in release_metadata_map["bip110"].items():
        dt = parse_iso_utc(meta.get("published_at", ""))
        if not dt:
            continue
        ts = int(dt.timestamp())
        if ts < start_ts or ts > end_ts:
            continue

        norm_version = normalize_bip110_version(version)
        label = f"bip110:{norm_version}"
        h = int(height_at_or_before_timestamp(rpc, ts, lo=BIP110_START, hi=current_height))
        period = int(height_to_period(h, BIP110_START, PERIOD_SIZE))
        if 1 <= period <= BIP110_LAST_PERIOD:
            points.append((label, h, period))

    core_tag_re = re.compile(r"^v\d+\.\d+(?:\.\d+)?$")
    for version, meta in release_metadata_map["core"].items():
        if not core_tag_re.match(version):
            continue
        dt = parse_iso_utc(meta.get("published_at", ""))
        if not dt:
            continue
        ts = int(dt.timestamp())
        if ts < start_ts or ts > end_ts:
            continue

        label = f"core:{version}"
        h = int(height_at_or_before_timestamp(rpc, ts, lo=BIP110_START, hi=current_height))
        period = int(height_to_period(h, BIP110_START, PERIOD_SIZE))
        if 1 <= period <= BIP110_LAST_PERIOD:
            points.append((label, h, period))

    knots_tag_re = re.compile(r"^v\d+\.\d+(?:\.\d+)?\.knots\d{8}$", re.IGNORECASE)
    for version, meta in release_metadata_map["knots"].items():
        if not knots_tag_re.match(version):
            continue
        dt = parse_iso_utc(meta.get("published_at", ""))
        if not dt:
            continue
        ts = int(dt.timestamp())
        if ts < start_ts or ts > end_ts:
            continue

        label = f"knots:{version}"
        h = int(height_at_or_before_timestamp(rpc, ts, lo=BIP110_START, hi=current_height))
        period = int(height_to_period(h, BIP110_START, PERIOD_SIZE))
        if 1 <= period <= BIP110_LAST_PERIOD:
            points.append((label, h, period))

    dedup = {}
    for label, h, period in points:
        prev = dedup.get(label)
        if prev is None or h > prev[0]:
            dedup[label] = (h, period)

    return [(label, hp[0], hp[1]) for label, hp in dedup.items()]


bip110_total_periods = (BIP110_SIGNAL_END - BIP110_START) // PERIOD_SIZE


def format_bip110_progress(height, signal_counts):
    effective = clamp(height, BIP110_START, BIP110_SIGNAL_END)
    blocks_into_window_value = effective - BIP110_START
    completed = int(clamp(blocks_into_window_value // PERIOD_SIZE, 0, bip110_total_periods))
    in_active_window = (height >= BIP110_START) and (height < BIP110_SIGNAL_END)
    has_inprogress_period = in_active_window and (completed < bip110_total_periods)
    blocks_into_current = int(((blocks_into_window_value % PERIOD_SIZE) + 1) if has_inprogress_period else 0)
    current_period = int(completed + 1) if has_inprogress_period else None

    period_rows = []
    for period in range(1, X_MAX + 1):
        period_start = BIP110_START + (period - 1) * PERIOD_SIZE
        period_end = period_start + PERIOD_SIZE - 1
        elapsed = int(clamp(height - period_start + 1, 0, PERIOD_SIZE))
        raw_signal = signal_counts[period - 1] if period - 1 < len(signal_counts) else 0
        signal = int(clamp(float(raw_signal), 0.0, float(elapsed)))
        status = "completed" if elapsed == PERIOD_SIZE else "in_progress" if elapsed > 0 else "future"

        period_rows.append({
            "period": period,
            "period_start_height": period_start,
            "period_end_height": period_end,
            "status": status,
            "signal_blocks": signal,
            "elapsed_blocks": elapsed,
        })

    return {
        "completed_periods": completed,
        "current_period_index": current_period,
        "blocks_into_current_period": blocks_into_current,
        "period_rows": period_rows,
    }


def compute_bip110_progress(height, rpc_get=rpc_call):
    scan_end = min(height + 1, BIP110_DASHBOARD_END)
    signal_counts = [0] * X_MAX

    for block_height in range(BIP110_START, scan_end):
        block_hash = rpc_get("getblockhash", block_height)
        version = int(rpc_get("getblockheader", block_hash)["version"])
        if (version & (1 << 4)) != 0:
            idx = (block_height - BIP110_START) // PERIOD_SIZE
            if 0 <= idx < X_MAX:
                signal_counts[idx] += 1

    return format_bip110_progress(height, signal_counts)


def compute_bip110_progress_from_block_rows(height, block_rows):
    signal_counts = [0] * X_MAX
    for row in block_rows:
        block_height = int(row.get("height", 0))
        if block_height < BIP110_START or block_height >= BIP110_DASHBOARD_END:
            continue
        if int(row.get("is_signaling", 0)) != 1:
            continue
        idx = (block_height - BIP110_START) // PERIOD_SIZE
        if 0 <= idx < X_MAX:
            signal_counts[idx] += 1
    return format_bip110_progress(height, signal_counts)


def get_bip110_plot_max_height(height):
    if height < BIP110_START:
        return BIP110_START - 1
    if height < BIP110_DASHBOARD_END:
        return height
    return BIP110_FINAL_UPDATE_HEIGHT


def build_bip110_block_rows(plot_max_height, rpc_get=rpc_call):
    rows = []
    if plot_max_height is None or plot_max_height < BIP110_START:
        return rows
    for period in range(1, X_MAX + 1):
        period_start = BIP110_START + (period - 1) * PERIOD_SIZE
        period_end = period_start + PERIOD_SIZE - 1
        if period_start > plot_max_height:
            break
        effective_end = min(period_end, plot_max_height)

        for h in range(period_start, effective_end + 1):
            bh = rpc_get("getblockhash", h)
            header = rpc_get("getblockheader", bh)
            version = int(header["version"])
            rows.append({
                "period": period,
                "height": h,
                "y_in_period": h - period_start,
                "version": version,
                "block_time": int(header.get("time", 0)),
                "is_signaling": int((version & (1 << 4)) != 0),
            })
    return rows


def make_rpc_getter(conn, *, label: str, max_attempts: int = 3, retry_delay: float = 2.0, reconnect=None):
    def rpc_get(method_name: str, *args):
        nonlocal conn
        last_err: Exception | None = None
        for attempt in range(1, max_attempts + 1):
            try:
                return getattr(conn, method_name)(*args)
            except RPC_RETRY_EXCEPTIONS as exc:
                last_err = exc
                print(f"[{label}] RPC {method_name} failed (attempt {attempt}/{max_attempts}): {exc}")
                if attempt < max_attempts:
                    if reconnect is not None:
                        conn = reconnect()
                    time.sleep(retry_delay)
        raise RuntimeError(f"{label} RPC {method_name} unavailable after {max_attempts} attempts: {last_err}") from last_err
    return rpc_get


# Dynamic update: BIP-110 datasets (changes over time)
raw_node_tip_height = int(rpc_call("getblockcount"))
if raw_node_tip_height > BIP110_FINAL_UPDATE_HEIGHT and existing_bip110_dashboard_is_finalized(webapp_dir / "bip110_metadata.json"):
    print(
        f"[bip110] Dashboard finalized at height {BIP110_FINAL_UPDATE_HEIGHT:,}; "
        f"node tip is {raw_node_tip_height:,}. Skipping BIP-110 data update."
    )
    sys.exit(0)

node_tip_height = min(raw_node_tip_height, BIP110_FINAL_UPDATE_HEIGHT)
if raw_node_tip_height > BIP110_FINAL_UPDATE_HEIGHT:
    print(
        f"[bip110] Node tip {raw_node_tip_height:,} is beyond the latest activation period; "
        f"finalizing dashboard at height {BIP110_FINAL_UPDATE_HEIGHT:,}."
    )
candidate_bip110_plot_max_height = get_bip110_plot_max_height(node_tip_height)
bip110_blocks_path = webapp_dir / "bip110_block_points.bin"
candidate_bip110_block_rows = load_or_update_bip110_block_rows(
    bip110_blocks_path,
    candidate_bip110_plot_max_height,
    log_label="bip110",
)
candidate_bip110_miner_heights = [row["height"] for row in candidate_bip110_block_rows]
bip110_miners_path = webapp_dir / "bip110_miners.json"
bip110_signal_miners_path = webapp_dir / "bip110_signal_miners.json"
bip110_miners_meta, bip110_miners, _bip110_miner_payload, bip110_miners_changed = export_bip110_miners(
    bip110_miners_path,
    candidate_bip110_miner_heights,
    return_payload=True,
)

current_height = node_tip_height
bip110_plot_max_height = candidate_bip110_plot_max_height
if candidate_bip110_block_rows and candidate_bip110_plot_max_height not in bip110_miners:
    print(
        f"[bip110] publishing latest block {candidate_bip110_plot_max_height:,} "
        "without miner attribution; it will be retried on the next run."
    )

current_hash = rpc_call("getblockhash", current_height)
current_time_utc = datetime.fromtimestamp(int(rpc_call("getblockheader", current_hash)["time"]), tz=timezone.utc)
date_str = current_time_utc.strftime("%Y-%m-%d %H:%M:%S UTC")

bip110_progress = compute_bip110_progress_from_block_rows(current_height, candidate_bip110_block_rows)
completed_periods = bip110_progress["completed_periods"]
current_period_index = bip110_progress["current_period_index"]
blocks_into_current_period = bip110_progress["blocks_into_current_period"]
bip110_period_rows = bip110_progress["period_rows"]

bip110_periods_path = webapp_dir / "bip110_periods.csv"
export_csv(
    bip110_periods_path,
    bip110_period_rows,
    ["period", "period_start_height", "period_end_height", "status", "signal_blocks", "elapsed_blocks"],
)
bip110_periods_meta = {
    "path": bip110_periods_path.name,
    "sha256": hashlib.sha256(bip110_periods_path.read_bytes()).hexdigest(),
    "rows": len(bip110_period_rows),
    "first_period": min(int(row["period"]) for row in bip110_period_rows),
    "last_period": max(int(row["period"]) for row in bip110_period_rows),
    "start_height": min(int(row["period_start_height"]) for row in bip110_period_rows),
    "end_height": max(int(row["period_end_height"]) for row in bip110_period_rows),
}

bip110_block_rows = candidate_bip110_block_rows
bip110_miner_heights = [row["height"] for row in bip110_block_rows]
bip110_blocks_meta = export_block_points_bin(
    bip110_blocks_path,
    bip110_block_rows,
    period_size=PERIOD_SIZE,
)
if bip110_miners_changed or not bip110_signal_miners_path.exists():
    bip110_signal_miners_path.write_bytes(bip110_miners_path.read_bytes())
bip110_signal_miners_meta = dict(bip110_miners_meta)

static_release_points = []
for label, height, period in bip110_releases:
    if str(label).lower() in BIP110_EXCLUDED_RELEASE_LABELS:
        continue
    if period is None or not (1 <= period <= BIP110_LAST_PERIOD):
        continue
    static_release_points.append((str(label), int(height), int(period)))

dynamic_release_points = build_dynamic_release_points(current_height)

release_point_map = {label: (height, period) for label, height, period in static_release_points}
for label, height, period in dynamic_release_points:
    if str(label).lower() in BIP110_EXCLUDED_RELEASE_LABELS:
        continue
    if label not in release_point_map:
        release_point_map[label] = (height, period)

merged_release_points = sorted(
    [(label, hp[0], hp[1]) for label, hp in release_point_map.items()],
    key=lambda row: row[1],
)

bip110_release_rows = []
for label, height, period in merged_release_points:

    period_start = BIP110_START + (period - 1) * PERIOD_SIZE
    y = int(clamp(height - period_start, 0, PERIOD_SIZE))
    dy = -55 if label.lower() in ["core:v30.1", "knots:v29.3.knots20260210", "knots:v29.3.knots20260507"] else 55

    meta = get_release_metadata(label)
    bip110_release_rows.append({
        "label": label,
        "display_label": bip110_display_label(label),
        "height": int(height),
        "period": int(period),
        "y_in_period": y,
        "label_dy": int(dy),
        "label_anchor": "below" if dy < 0 else "above",
        "release_time_utc": meta["release_time_utc"],
        "github_url": meta["github_url"],
        "github_tag": meta["tag_name"],
    })

# PATCH missing datetimes/urls if needed
bip110_release_rows = patch_missing_release_metadata(bip110_release_rows)

export_csv(
    webapp_dir / "bip110_releases.csv",
    bip110_release_rows,
    ["label", "display_label", "height", "period", "y_in_period", "label_dy", "label_anchor", "release_time_utc", "github_url", "github_tag"],
)

ticks2, labels2 = compute_month_ticks(rpc, BIP110_START, X_MAX, PERIOD_SIZE, bar_width=0.5)
bip110_tick_rows = [{"x": float(x), "label": label} for x, label in zip(ticks2, labels2)]
export_csv(webapp_dir / "bip110_month_ticks.csv", bip110_tick_rows, ["x", "label"])

state = {
    "completed_periods": int(completed_periods),
    "current_period_index": int(current_period_index) if current_period_index is not None else None,
    "blocks_into_current_period": int(blocks_into_current_period),
    "bip110_total_periods": int(bip110_total_periods),
    "bip110_last_period": int(BIP110_LAST_PERIOD),
    "final_update_height": int(BIP110_FINAL_UPDATE_HEIGHT),
    "finalized": bool(current_height >= BIP110_FINAL_UPDATE_HEIGHT),
}

print(f"Current height: {current_height:,}")
if raw_node_tip_height != current_height:
    print(f"Raw node tip: {raw_node_tip_height:,}")
print(f"BIP-110 periods complete: {completed_periods}/{bip110_total_periods}")
print("Updated dynamic BIP-110 datasets.")

# Static datasets + split metadata
force_refresh_segwit = False

segwit_required = [
    webapp_dir / "segwit_periods.csv",
    webapp_dir / "segwit_releases.csv",
    webapp_dir / "segwit_month_ticks.csv",
    webapp_dir / "segwit_block_points.bin",
]
needs_segwit_version_rebuild = False
chart_static_path = webapp_dir / "chart_static.json"
existing_static = None
if chart_static_path.exists() and (webapp_dir / "segwit_block_points.bin").exists():
    try:
        with chart_static_path.open("r", encoding="utf-8") as f:
            existing_static = json.load(f)
        existing_segwit_meta = existing_static.get("datasets", {}).get("segwit_blocks", {})
        needs_segwit_version_rebuild = int(existing_segwit_meta.get("record_size") or 0) != 13
    except Exception:
        needs_segwit_version_rebuild = True
needs_segwit_rebuild = force_refresh_segwit or any(not p.exists() for p in segwit_required) or needs_segwit_version_rebuild

if needs_segwit_rebuild:
    print("Rebuilding static SegWit datasets...")

    segwit_period_rows = []
    for period, signal in enumerate(SEGWIT_SIGNAL_COUNTS, start=1):
        period_start = SEGWIT_START + (period - 1) * PERIOD_SIZE
        period_end = period_start + PERIOD_SIZE - 1
        segwit_period_rows.append({
            "period": period,
            "period_start_height": period_start,
            "period_end_height": period_end,
            "signal_blocks": int(signal),
        })

    export_csv(
        webapp_dir / "segwit_periods.csv",
        segwit_period_rows,
        ["period", "period_start_height", "period_end_height", "signal_blocks"],
    )

    segwit_block_rows = []
    for period in range(1, SEGWIT_LAST_PERIOD + 1):
        period_start = SEGWIT_START + (period - 1) * PERIOD_SIZE
        for h in range(period_start, period_start + PERIOD_SIZE):
            bh = rpc_call("getblockhash", h)
            header = rpc_call("getblockheader", bh)
            version = int(header["version"])
            segwit_block_rows.append({
                "period": period,
                "height": h,
                "y_in_period": h - period_start,
                "version": version,
                "block_time": int(header.get("time", 0)),
                "is_signaling": int((version & (1 << 1)) != 0),
            })

    segwit_blocks_meta = export_block_points_bin(
        webapp_dir / "segwit_block_points.bin",
        segwit_block_rows,
        period_size=PERIOD_SIZE,
    )

    segwit_release_rows = []
    for label, height in segwit_releases:
        if label in ["UASF:v0.14.0.uasfsegwit2", "UASF:v0.14.1-uasfsegwit0.3", "UASF:v0.14.2-uasfsegwit0.3"]:
            continue

        period = height_to_period(height, SEGWIT_START, PERIOD_SIZE)
        if not (1 <= period <= SEGWIT_LAST_PERIOD):
            continue

        period_start = SEGWIT_START + (period - 1) * PERIOD_SIZE
        y = int(clamp(height - period_start, 0, PERIOD_SIZE))
        dy = -55 if label.lower() in ["uasf:v0.14.0", "uasf:v0.14.0rc1", "uasf:v0.14.2rc2"] else 55
        display_label = segwit_display_label(label)
        if not display_label:
            continue

        segwit_release_rows.append({
            "label": label,
            "display_label": display_label,
            "height": int(height),
            "period": int(period),
            "y_in_period": y,
            "label_dy": int(dy),
            "label_anchor": "below" if dy < 0 else "above",
            "release_time_utc": SEGWIT_RELEASE_TIMES_UTC.get(label, ""),
            "github_url": build_release_url(label),
        })

    export_csv(
        webapp_dir / "segwit_releases.csv",
        segwit_release_rows,
        ["label", "display_label", "height", "period", "y_in_period", "label_dy", "label_anchor", "release_time_utc", "github_url"],
    )

    ticks1, labels1 = compute_month_ticks(rpc, SEGWIT_START, SEGWIT_LAST_PERIOD, PERIOD_SIZE, bar_width=0.5)
    segwit_tick_rows = [{"x": float(x), "label": label} for x, label in zip(ticks1, labels1)]
    export_csv(webapp_dir / "segwit_month_ticks.csv", segwit_tick_rows, ["x", "label"])
else:
    segwit_bin = webapp_dir / "segwit_block_points.bin"
    segwit_bin_size = segwit_bin.stat().st_size
    segwit_record_size = 5
    existing_static_path = webapp_dir / "chart_static.json"
    if existing_static_path.exists():
        try:
            with existing_static_path.open("r", encoding="utf-8") as f:
                existing_static = json.load(f)
            existing_rows = int(existing_static.get("datasets", {}).get("segwit_blocks", {}).get("rows") or 0)
            inferred_size = (segwit_bin_size // existing_rows) if existing_rows > 0 and segwit_bin_size % existing_rows == 0 else 0
            if inferred_size in (5, 9, 13):
                segwit_record_size = inferred_size
        except Exception:
            segwit_record_size = 5
    rows = segwit_bin_size // segwit_record_size
    segwit_blocks_meta = {
        "rows": int(rows),
        "start_height": int(SEGWIT_START),
        "end_height": int(SEGWIT_START + rows - 1),
        "period_size": int(PERIOD_SIZE),
        "record_size": int(segwit_record_size),
    }
    print("SegWit datasets unchanged (already present).")

if needs_segwit_rebuild:
    segwit_miner_sample_heights = select_segwit_miner_sample_heights(segwit_block_rows)
    segwit_miners_meta, segwit_miners, _segwit_miner_payload, _segwit_miners_changed = export_block_miners(
        webapp_dir / "segwit_miners.json",
        segwit_miner_sample_heights,
        log_label="segwit",
        return_payload=True,
    )
    segwit_low_activity_blocks_meta = export_low_activity_block_cache(
        webapp_dir / "segwit_low_activity_blocks.json",
        segwit_block_rows,
    )
else:
    existing_datasets = (existing_static or {}).get("datasets", {})
    segwit_miners = load_existing_signal_miners(webapp_dir / "segwit_miners.json")
    segwit_miners_meta = existing_datasets.get("segwit_miners", {
        "rows": 0,
        "source": "cached chart_static.json",
    })
    segwit_low_activity_blocks_meta = existing_datasets.get("segwit_low_activity_blocks", {
        "checked": 0,
        "rows": 0,
        "source": "cached chart_static.json",
    })

needs_chart_static_refresh = needs_segwit_rebuild or not chart_static_path.exists()

if needs_chart_static_refresh:
    chart_static = {
        "chart": {
            "figure_size_inches": [14, 8],
            "period_size": int(PERIOD_SIZE),
            "x_max": int(X_MAX),
            "titles": {
                "segwit": "SegWit (BIP-141) Signaling by Period",
                "bip110": "Reduced Data Temporary Softfork (BIP-110) Signaling by Period",
            },
            "axis_labels": {
                "y": "Block Count per Signaling Period",
                "x_bottom": "2,016 Block Signaling Periods",
            },
            "colors": {
                "background": "black",
                "foreground": "white",
                "signal": "#ff9800",
                "nonsignal": "#888",
                "threshold": "#00e676",
                "future": "#222",
                "marker": "#4169E1",
            },
            "bar": {
                "width": 0.5,
            },
            "signal_stripes": {
                "x_offset": 0.34,
                "halfwidth": 0.02,
                "linewidth": 0.27,
            },
            "thresholds": {
                "segwit": {"blocks": 1916, "pct": 95.0},
                "bip110": {"blocks": 1109, "pct": 55.0},
            },
            "special_period_labels": [
                {"period": 18, "text": "Mandatory Signaling Period", "rotation": 90},
                {"period": 19, "text": "Latest Lock-In Period", "rotation": 90},
                {"period": 20, "text": "Latest Activation Period", "rotation": 90},
            ],
            "footer": {
                "source_url": "https://wickedsmartbitcoin.com/bip110_signaling",
            },
        },
        "datasets": {
            "segwit_blocks": segwit_blocks_meta,
            "segwit_miners": segwit_miners_meta,
            "segwit_low_activity_blocks": segwit_low_activity_blocks_meta,
        },
    }

    with chart_static_path.open("w", encoding="utf-8") as f:
        json.dump(chart_static, f, separators=(",", ":"), ensure_ascii=True)
    print("Wrote static chart bundle.")
else:
    chart_static = existing_static
    if chart_static is None:
        with chart_static_path.open("r", encoding="utf-8") as f:
            chart_static = json.load(f)
    print("Static chart bundle unchanged.")

bip110_node_blocks_meta = None
bip110_node_miners_meta = None
bip110_node_signal_miners_meta = None
bip110_node_miners = load_existing_signal_miners(webapp_dir / "bip110_node_miners.json")
previous_bip110_metadata = load_existing_bip110_metadata(webapp_dir / "bip110_metadata.json")
previous_node_sync = previous_bip110_metadata.get("node_sync", {})
previous_node_datasets = {
    key: value
    for key, value in previous_bip110_metadata.get("datasets", {}).items()
    if key.startswith("bip110_node_") and isinstance(value, dict)
}

node_sync = check_bip110_node_sync(int(current_height), str(current_hash))
if node_sync.get("relation") == "rpc_error" and isinstance(previous_node_sync, dict):
    # Retain the last observed BIP-110 topology while clearly marking it stale.
    # Otherwise a temporary RPC outage discards the node heights/common ancestor,
    # collapsing a real split into a single-chain view on the next publish.
    for key in (
        "bip110_height",
        "bip110_hash_at_legacy_height",
        "latest_common_height",
        "height_delta",
        "blocks_behind",
        "blocks_since_common_height",
    ):
        if node_sync.get(key) is None and previous_node_sync.get(key) is not None:
            node_sync[key] = previous_node_sync[key]
    node_sync["status"] = "rpc_unavailable"
    node_sync["data_stale"] = True
    node_sync["last_successful_check_utc"] = (
        previous_node_sync.get("last_successful_check_utc")
        or previous_node_sync.get("checked_utc")
    )

try:
    bip110_node_height = node_sync.get("bip110_height")
    if bip110_node_height is not None and node_sync.get("status") != "rpc_unavailable":
        bip110_node_rpc = _make_bip110_rpc()
        bip110_node_get = make_rpc_getter(
            bip110_node_rpc,
            label="bip110-node",
            reconnect=_make_bip110_rpc,
        )
        bip110_node_height = int(bip110_node_height)
        bip110_node_plot_max_height = get_bip110_plot_max_height(bip110_node_height)
        bip110_node_blocks_path = webapp_dir / "bip110_node_block_points.bin"
        bip110_node_miners_path = webapp_dir / "bip110_node_miners.json"
        bip110_node_signal_miners_path = webapp_dir / "bip110_node_signal_miners.json"
        bip110_node_block_rows = load_or_update_bip110_block_rows(
            bip110_node_blocks_path,
            bip110_node_plot_max_height,
            rpc_get=bip110_node_get,
            log_label="bip110-node",
        )
        bip110_node_miner_heights = [row["height"] for row in bip110_node_block_rows]

        bip110_node_progress = compute_bip110_progress_from_block_rows(
            bip110_node_height,
            bip110_node_block_rows,
        )
        export_csv(
            webapp_dir / "bip110_node_periods.csv",
            bip110_node_progress["period_rows"],
            ["period", "period_start_height", "period_end_height", "status", "signal_blocks", "elapsed_blocks"],
        )
        bip110_node_blocks_meta = export_block_points_bin(
            bip110_node_blocks_path,
            bip110_node_block_rows,
            period_size=PERIOD_SIZE,
        )

        latest_common_height = node_sync.get("latest_common_height")
        if latest_common_height is None and node_sync.get("in_sync"):
            latest_common_height = current_height
        common_miner_heights = [
            height
            for height in bip110_node_miner_heights
            if latest_common_height is not None and int(height) <= int(latest_common_height)
        ]
        bip110_node_miners = {}
        if common_miner_heights:
            common_miner_height_set = set(common_miner_heights)
            bip110_node_miners.update({
                height: miner
                for height, miner in bip110_miners.items()
                if int(height) in common_miner_height_set
            })

        node_specific_miner_heights = [
            height
            for height in bip110_node_miner_heights
            if latest_common_height is None or int(height) > int(latest_common_height)
        ]
        if node_specific_miner_heights:
            node_specific_miner_height_set = set(node_specific_miner_heights)
            existing_node_miners = load_existing_signal_miners(bip110_node_miners_path)
            bip110_node_miners.update({
                height: miner
                for height, miner in existing_node_miners.items()
                if int(height) in node_specific_miner_height_set
            })

        missing_node_specific_miner_heights = [
            height
            for height in node_specific_miner_heights
            if int(height) not in bip110_node_miners
        ]
        if missing_node_specific_miner_heights:
            local_node_miners = attribute_miners_locally(
                missing_node_specific_miner_heights,
                bip110_miners,
                lookup_path=bip110_node_miners_path.with_name("miner_attribution_lookup.json"),
                log_label="bip110-node",
                target_row_fetcher=lambda heights: fetch_rpc_coinbase_attribution_rows(
                    heights,
                    bip110_node_get,
                    log_label="bip110-node",
                ),
            )
            bip110_node_miners.update(local_node_miners)

        bip110_node_miner_payload = write_block_miners_payload(
            bip110_node_miners_path,
            bip110_node_miner_heights,
            bip110_node_miners,
        )
        bip110_node_miners_meta = {
            "rows": len(bip110_node_miner_payload),
            "source": "legacy-chain miner attributions through latest common height; local BIP-110 node coinbase tags/addresses after split",
        }
        bip110_node_signal_miners_path.write_bytes(bip110_node_miners_path.read_bytes())
        bip110_node_signal_miners_meta = dict(bip110_node_miners_meta)
        print(f"[bip110] Exported BIP-110 node datasets through {bip110_node_plot_max_height:,}.")
except Exception as exc:
    print(f"[bip110] Skipped BIP-110 node dataset export: {exc}")

miner_attributions_meta = write_compact_miner_attributions(
    webapp_dir / "miner_attributions.json",
    {
        "segwit": segwit_miners,
        "bip110": bip110_miners,
        "bip110_node": bip110_node_miners,
    },
)

bip110_metadata = {
    "generated_utc": datetime.now(timezone.utc).isoformat(),
    "source_block_height": int(current_height),
    "source_block_hash": str(current_hash),
    "source_block_time_utc": date_str,
    "state": state,
    "node_sync": node_sync,
    "datasets": {
        "bip110_blocks": bip110_blocks_meta,
        "bip110_periods": bip110_periods_meta,
        "bip110_miners": bip110_miners_meta,
        "bip110_signal_miners": bip110_signal_miners_meta,
        "miner_attributions": miner_attributions_meta,
    },
}
if bip110_node_blocks_meta:
    bip110_metadata["datasets"]["bip110_node_blocks"] = bip110_node_blocks_meta
if bip110_node_miners_meta:
    bip110_metadata["datasets"]["bip110_node_miners"] = bip110_node_miners_meta
if bip110_node_signal_miners_meta:
    bip110_metadata["datasets"]["bip110_node_signal_miners"] = bip110_node_signal_miners_meta
if node_sync.get("status") == "rpc_unavailable":
    # The node files remain valid snapshots. Preserve their decoding metadata so
    # clients can continue showing both chains until the RPC becomes available.
    for key, value in previous_node_datasets.items():
        bip110_metadata["datasets"].setdefault(key, value)

legacy_chart_metadata = {
    **chart_static,
    **bip110_metadata,
    "datasets": {
        **chart_static.get("datasets", {}),
        **bip110_metadata.get("datasets", {}),
    },
}

# Keep the compatibility bundle coherent too, then publish the watched dynamic
# metadata last. Clients therefore cannot observe the new generation marker
# until all companion files (including the legacy metadata view) are complete.
atomic_write_json(webapp_dir / "chart_metadata.json", legacy_chart_metadata)
atomic_write_json(webapp_dir / "bip110_metadata.json", bip110_metadata)

print("Updated dynamic BIP-110 metadata.")
print("Refreshed legacy combined chart_metadata.json for compatibility.")

print("\nCreated/updated files:")
for p in sorted(webapp_dir.glob("*")):
    if p.is_file():
        print(f"  - {p.name} ({p.stat().st_size:,} bytes)")
