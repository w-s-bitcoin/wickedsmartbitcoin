#!/usr/bin/env python
# coding: utf-8

import csv
import concurrent.futures
import json
import os
import socket
import sys
import time
from datetime import datetime, timezone
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
BIP110_MONITOR_URL = "https://bip110.org/monitor"
X_MAX = 20
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

def height_to_period(height: int, start_height: int, period_size: int) -> int:
    return ((height - start_height) // period_size) + 1

def export_csv(path: Path, rows, fieldnames):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)

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

def load_low_activity_block_cache(path: Path):
    if not path.exists():
        return {}, {}, {}
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return {}, {}, {}

    if not isinstance(data, dict):
        return {}, {}, {}

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
            block_hash = rpc.getblockhash(int(height))
            if int(height) in existing_sizes:
                block_header = rpc.getblockheader(block_hash)
                block_size = int(existing_sizes[int(height)])
                block_time = int(block_header.get("time", 0))
            else:
                block = rpc.getblock(block_hash, 1)
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
    tip = int(rpc.getblockcount())
    tip_hash = rpc.getblockhash(tip)
    tip_ts = int(rpc.getblockheader(tip_hash)["time"] )
    if height <= tip:
        h = rpc.getblockhash(int(height))
        return int(rpc.getblockheader(h)["time"] )
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

def _make_rpc(max_attempts: int = 10, retry_delay: float = 6.0) -> AuthServiceProxy:
    url = f"http://{quote(rpc_user, safe='')}:{quote(rpc_password, safe='')}@127.0.0.1:8332"
    last_err: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            conn = AuthServiceProxy(url, timeout=120)
            conn.getblockcount()  # verify RPC is actually responsive
            return conn
        except (OSError, socket.timeout, TimeoutError) as exc:
            last_err = exc
            print(f"[bip110] RPC not ready (attempt {attempt}/{max_attempts}): {exc}")
            if attempt < max_attempts:
                time.sleep(retry_delay)
        except Exception as exc:
            raise RuntimeError(f"Bitcoin RPC error: {exc}") from exc
    raise RuntimeError(f"Bitcoin RPC unavailable after {max_attempts} attempts: {last_err}")

rpc = _make_rpc()

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

for stale in ("segwit_block_points.csv", "bip110_block_points.csv"):
    stale_path = webapp_dir / stale
    if stale_path.exists():
        stale_path.unlink()

print(f"Using signaling module dir: {module_dir}")
print(f"Using webapp data dir: {webapp_dir}")


# --- GitHub Release Datetime and URL Fetcher ---
import requests
import re

def fetch_github_release_metadata():
    """
    Returns a dict mapping (repo, short_label) to dict with 'published_at', 'html_url', and 'tag_name'.
    For BIP110, matches tags containing the version string (e.g., v0.4, v0.4.1) anywhere in the tag.
    """
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

    # Fetch releases for the release-marker repos
    bip110_releases = fetch_all_releases("dathonohm", "bitcoin")
    core_releases = fetch_all_releases("bitcoin", "bitcoin")
    knots_releases = fetch_all_releases("bitcoinknots", "bitcoin")

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
    return {"bip110": bip110_map, "core": core_map, "knots": knots_map}

# Build a mapping from label to release metadata (datetime, url, tag)
release_metadata_map = fetch_github_release_metadata()
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
    return {"release_time_utc": "", "github_url": "", "tag_name": ""}

# --- Patch for missing BIP110 datetimes/urls ---
# No longer needed: fallback now handled in fetch_github_release_metadata and get_release_metadata.

def patch_missing_release_metadata(bip110_release_rows):
    return bip110_release_rows

MEMPOOL_BLOCKS_API = "https://mempool.space/api/v1/blocks"
MEMPOOL_REQUEST_TIMEOUT_SECONDS = (5, 20)
POSTGRES_BLOCK_HASH_RECHECK_INTERVAL = 100

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
                        return {
                            "name": f"{text} ({pool_name or 'OCEAN'})",
                            "slug": pool_slug,
                            "pool": pool_name or "OCEAN",
                            "sub_miner": text,
                        }
            if pool_name:
                return {"name": pool_name, "slug": pool_slug, "pool": pool_name}

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
            return {"name": text, "slug": str(slug or "").strip().lower()}
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
            name = str(miner.get("name") or "").strip()
            if name:
                miners[h] = {
                    "name": name,
                    "slug": str(miner.get("slug") or "").strip().lower(),
                    "pool": str(miner.get("pool") or "").strip(),
                    "sub_miner": str(miner.get("sub_miner") or "").strip(),
                    "hash": str(miner.get("hash") or miner.get("block_hash") or miner.get("id") or "").strip(),
                }
            continue
        text = str(miner or "").strip()
        if text:
            miners[h] = {"name": text, "slug": "", "pool": "", "sub_miner": ""}
    return miners

def fetch_postgres_block_hashes(heights):
    target_heights = sorted(set(int(height) for height in heights))
    if not target_heights:
        return {}

    try:
        import psycopg2  # type: ignore
    except Exception as exc:
        print(f"[bip110] PostgreSQL block hash recheck skipped: psycopg2 unavailable ({exc}).")
        return {}

    database = os.getenv("POSTGRES_DB") or os.getenv("PGDATABASE")
    user = os.getenv("POSTGRES_USER") or os.getenv("PGUSER")
    password = os.getenv("POSTGRES_PASSWORD") or os.getenv("PGPASSWORD")
    host = os.getenv("POSTGRES_HOST") or os.getenv("PGHOST") or "localhost"
    port = os.getenv("POSTGRES_PORT") or os.getenv("PGPORT") or "5432"
    if not database or not user:
        print("[bip110] PostgreSQL block hash recheck skipped: POSTGRES_DB/POSTGRES_USER not configured.")
        return {}

    try:
        conn = psycopg2.connect(host=host, port=port, database=database, user=user, password=password)
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

def fetch_bip110_monitor_tip():
    headers = {
        "Accept": "text/html,application/xhtml+xml",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "User-Agent": "wickedsmartbitcoin-bip110-dashboard-updater",
    }
    fetched_utc = datetime.now(timezone.utc).isoformat()

    try:
        r = requests.get(BIP110_MONITOR_URL, headers=headers, timeout=20)
        r.raise_for_status()
        html = r.text
    except Exception as exc:
        return {
            "source": BIP110_MONITOR_URL,
            "fetched_utc": fetched_utc,
            "ok": False,
            "error": str(exc),
            "chain_tip": None,
            "indexed_tip": None,
        }

    def parse_monitor_field(field_name):
        pattern = (
            rf'data-monitor-field=["\']{re.escape(field_name)}["\'][^>]*>'
            r'\s*([0-9][0-9,]*)\s*<'
        )
        match = re.search(pattern, html, re.IGNORECASE)
        if not match:
            return None
        try:
            return int(match.group(1).replace(",", ""))
        except ValueError:
            return None

    chain_tip = parse_monitor_field("chain-tip")
    indexed_tip = parse_monitor_field("indexed-tip")

    if chain_tip is None:
        match = re.search(r'og/monitor\.png\?[^"\']*?\btip=(\d+)\b', html, re.IGNORECASE)
        if match:
            chain_tip = int(match.group(1))

    return {
        "source": BIP110_MONITOR_URL,
        "fetched_utc": fetched_utc,
        "ok": chain_tip is not None,
        "error": None if chain_tip is not None else "chain tip not found in monitor HTML",
        "chain_tip": chain_tip,
        "indexed_tip": indexed_tip,
    }

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
        str(height): miners[height]
        for height in sorted(target_set)
        if miners.get(height, {}).get("name")
    }
    tmp_path = path.with_suffix(f"{path.suffix}.tmp")
    with tmp_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"), ensure_ascii=True)
    tmp_path.replace(path)
    return payload

def fetch_block_miners(heights, *, log_label="blocks", on_batch=None):
    pending = set(int(h) for h in heights)
    if not pending:
        return {}
    total = len(pending)
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

def export_block_miners(path: Path, heights, *, log_label="blocks"):
    target_heights = sorted(set(int(h) for h in heights))
    existing = load_existing_signal_miners(path)
    miners = {
        height: miner
        for height, miner in existing.items()
        if height in target_heights
    }
    invalidate_reorged_miner_attributions(miners, target_heights)
    missing_heights = [height for height in target_heights if height not in miners]
    def persist_batch(batch_miners):
        miners.update(batch_miners)
        write_block_miners_payload(path, target_heights, miners)

    fetched = fetch_block_miners(missing_heights, log_label=log_label, on_batch=persist_batch)
    miners.update(fetched)

    payload = write_block_miners_payload(path, target_heights, miners)
    return {"rows": len(payload), "source": MEMPOOL_BLOCKS_API}

def export_signal_miners(path: Path, heights):
    return export_block_miners(path, heights, log_label="bip110")

def export_bip110_miners(path: Path, heights):
    return export_block_miners(path, heights, log_label="bip110")


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


def compute_bip110_progress(height):
    scan_end = min(height + 1, BIP110_SIGNAL_END)
    signal_counts = [0] * bip110_total_periods

    for block_height in range(BIP110_START, scan_end):
        block_hash = rpc.getblockhash(block_height)
        version = int(rpc.getblockheader(block_hash)["version"])
        if (version & (1 << 4)) != 0:
            idx = (block_height - BIP110_START) // PERIOD_SIZE
            if 0 <= idx < bip110_total_periods:
                signal_counts[idx] += 1

    effective = clamp(height, BIP110_START, BIP110_SIGNAL_END)
    blocks_into_window_value = effective - BIP110_START
    completed = int(clamp(blocks_into_window_value // PERIOD_SIZE, 0, bip110_total_periods))
    in_active_window = (height >= BIP110_START) and (height < BIP110_SIGNAL_END)
    has_inprogress_period = in_active_window and (completed < bip110_total_periods)
    blocks_into_current = int((blocks_into_window_value % PERIOD_SIZE) if has_inprogress_period else 0)
    current_period = int(completed + 1) if has_inprogress_period else None

    period_rows = []
    for period in range(1, X_MAX + 1):
        in_signaling_window = period <= bip110_total_periods
        period_start = BIP110_START + (period - 1) * PERIOD_SIZE if in_signaling_window else ""
        period_end = period_start + PERIOD_SIZE - 1 if in_signaling_window else ""

        signal = 0
        elapsed = 0
        status = "future"

        if in_signaling_window and period <= completed:
            signal = int(signal_counts[period - 1])
            elapsed = PERIOD_SIZE
            status = "completed"
        elif has_inprogress_period and current_period is not None and period == int(current_period):
            elapsed = int(blocks_into_current)
            signal = int(clamp(float(signal_counts[period - 1]), 0.0, float(elapsed)))
            status = "in_progress"
        elif in_signaling_window:
            status = "future"

        if period > bip110_total_periods:
            status = "post_window"

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


def get_bip110_plot_max_height(height):
    if height < BIP110_START:
        return BIP110_START - 1
    if height < BIP110_SIGNAL_END:
        return height
    return BIP110_SIGNAL_END - 1


def build_bip110_block_rows(plot_max_height):
    rows = []
    if plot_max_height is None or plot_max_height < BIP110_START:
        return rows
    for period in range(1, bip110_total_periods + 1):
        period_start = BIP110_START + (period - 1) * PERIOD_SIZE
        period_end = period_start + PERIOD_SIZE - 1
        if period_start > plot_max_height:
            break
        effective_end = min(period_end, plot_max_height)

        for h in range(period_start, effective_end + 1):
            bh = rpc.getblockhash(h)
            header = rpc.getblockheader(bh)
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


# Dynamic update: BIP-110 datasets (changes over time)
node_tip_height = int(rpc.getblockcount())
candidate_bip110_plot_max_height = get_bip110_plot_max_height(node_tip_height)
candidate_bip110_block_rows = build_bip110_block_rows(candidate_bip110_plot_max_height)
candidate_bip110_miner_heights = [row["height"] for row in candidate_bip110_block_rows]
bip110_miners_path = webapp_dir / "bip110_miners.json"
bip110_signal_miners_path = webapp_dir / "bip110_signal_miners.json"
export_bip110_miners(bip110_miners_path, candidate_bip110_miner_heights)
bip110_miners = load_existing_signal_miners(bip110_miners_path)

current_height = node_tip_height
bip110_plot_max_height = candidate_bip110_plot_max_height
if candidate_bip110_block_rows and candidate_bip110_plot_max_height not in bip110_miners:
    print(
        f"[bip110] publishing latest block {candidate_bip110_plot_max_height:,} "
        "without miner attribution; it will be retried on the next run."
    )

current_hash = rpc.getblockhash(current_height)
current_time_utc = datetime.fromtimestamp(int(rpc.getblockheader(current_hash)["time"]), tz=timezone.utc)
date_str = current_time_utc.strftime("%Y-%m-%d %H:%M:%S UTC")

bip110_progress = compute_bip110_progress(current_height)
completed_periods = bip110_progress["completed_periods"]
current_period_index = bip110_progress["current_period_index"]
blocks_into_current_period = bip110_progress["blocks_into_current_period"]
bip110_period_rows = bip110_progress["period_rows"]

export_csv(
    webapp_dir / "bip110_periods.csv",
    bip110_period_rows,
    ["period", "period_start_height", "period_end_height", "status", "signal_blocks", "elapsed_blocks"],
)

bip110_block_rows = build_bip110_block_rows(bip110_plot_max_height)
bip110_miner_heights = [row["height"] for row in bip110_block_rows]
bip110_blocks_meta = export_block_points_bin(
    webapp_dir / "bip110_block_points.bin",
    bip110_block_rows,
    period_size=PERIOD_SIZE,
)
bip110_miner_payload = write_block_miners_payload(bip110_miners_path, bip110_miner_heights, bip110_miners)
bip110_miners_meta = {"rows": len(bip110_miner_payload), "source": MEMPOOL_BLOCKS_API}
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
}

print(f"Current height: {current_height:,}")
print(f"BIP-110 periods complete: {completed_periods}/{bip110_total_periods}")
print("Updated dynamic BIP-110 datasets.")

bip110_monitor = fetch_bip110_monitor_tip()
chain_split_active = current_height >= BIP110_MANDATORY_SIGNALING_HEIGHT
chain_split_detected = (
    chain_split_active
    and bip110_monitor.get("chain_tip") is not None
    and int(bip110_monitor["chain_tip"]) != int(current_height)
)
chain_split_monitor = {
    "mandatory_signaling_height": int(BIP110_MANDATORY_SIGNALING_HEIGHT),
    "active": bool(chain_split_active),
    "detected": bool(chain_split_detected),
    "source_block_height": int(current_height),
    "bip110_chain_tip": int(bip110_monitor["chain_tip"]) if bip110_monitor.get("chain_tip") is not None else None,
    "bip110_indexed_tip": int(bip110_monitor["indexed_tip"]) if bip110_monitor.get("indexed_tip") is not None else None,
    "source": bip110_monitor.get("source", BIP110_MONITOR_URL),
    "fetched_utc": bip110_monitor.get("fetched_utc"),
    "ok": bool(bip110_monitor.get("ok")),
    "error": bip110_monitor.get("error"),
}
if chain_split_monitor["ok"]:
    print(f"BIP-110 monitor chain tip: {chain_split_monitor['bip110_chain_tip']:,}")
else:
    print(f"BIP-110 monitor chain tip unavailable: {chain_split_monitor['error']}")


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
            bh = rpc.getblockhash(h)
            header = rpc.getblockheader(bh)
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
    segwit_block_rows = read_block_points_bin(
        segwit_bin,
        start_height=SEGWIT_START,
        period_size=PERIOD_SIZE,
        record_size=segwit_record_size,
    )
    print("SegWit datasets unchanged (already present).")

segwit_miner_sample_heights = select_segwit_miner_sample_heights(segwit_block_rows)
segwit_miners_meta = export_block_miners(
    webapp_dir / "segwit_miners.json",
    segwit_miner_sample_heights,
    log_label="segwit",
)
segwit_low_activity_blocks_meta = export_low_activity_block_cache(
    webapp_dir / "segwit_low_activity_blocks.json",
    segwit_block_rows,
)

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
    with chart_static_path.open("r", encoding="utf-8") as f:
        chart_static = json.load(f)
    chart_static.setdefault("datasets", {})["segwit_miners"] = segwit_miners_meta
    chart_static.setdefault("datasets", {}).pop("segwit_empty_blocks", None)
    chart_static.setdefault("datasets", {}).pop("bip110_low_activity_blocks", None)
    chart_static.setdefault("datasets", {})["segwit_low_activity_blocks"] = segwit_low_activity_blocks_meta
    with chart_static_path.open("w", encoding="utf-8") as f:
        json.dump(chart_static, f, separators=(",", ":"), ensure_ascii=True)
    print("Static chart bundle refreshed with SegWit miner metadata.")

bip110_metadata = {
    "generated_utc": datetime.now(timezone.utc).isoformat(),
    "source_block_height": int(current_height),
    "source_block_hash": str(current_hash),
    "source_block_time_utc": date_str,
    "state": state,
    "chain_split_monitor": chain_split_monitor,
    "datasets": {
        "bip110_blocks": bip110_blocks_meta,
        "bip110_miners": bip110_miners_meta,
        "bip110_signal_miners": bip110_signal_miners_meta,
    },
}

with (webapp_dir / "bip110_metadata.json").open("w", encoding="utf-8") as f:
    json.dump(bip110_metadata, f, separators=(",", ":"), ensure_ascii=True)

legacy_chart_metadata = {
    **chart_static,
    **bip110_metadata,
    "datasets": {
        **chart_static.get("datasets", {}),
        **bip110_metadata.get("datasets", {}),
    },
}

with (webapp_dir / "chart_metadata.json").open("w", encoding="utf-8") as f:
    json.dump(legacy_chart_metadata, f, separators=(",", ":"), ensure_ascii=True)

print("Updated dynamic BIP-110 metadata.")
print("Refreshed legacy combined chart_metadata.json for compatibility.")

print("\nCreated/updated files:")
for p in sorted(webapp_dir.glob("*")):
    if p.is_file():
        print(f"  - {p.name} ({p.stat().st_size:,} bytes)")
