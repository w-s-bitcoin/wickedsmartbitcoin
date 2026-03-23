#!/usr/bin/env python
# coding: utf-8

import csv
import json
import os
import sys
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
X_MAX = 20

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
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

def export_block_points_bin(path: Path, rows, *, period_size: int):
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = bytearray()
    min_h = None
    max_h = None

    for row in rows:
        h = int(row["height"])
        sig = 1 if int(row.get("is_signaling", 0)) == 1 else 0
        payload.extend(h.to_bytes(4, byteorder="little", signed=False))
        payload.append(sig)
        min_h = h if min_h is None else min(min_h, h)
        max_h = h if max_h is None else max(max_h, h)

    path.write_bytes(payload)
    return {
        "rows": len(rows),
        "start_height": int(min_h) if min_h is not None else 0,
        "end_height": int(max_h) if max_h is not None else 0,
        "period_size": int(period_size),
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
    return label

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

rpc = AuthServiceProxy(
    f"http://{quote(rpc_user, safe='')}:{quote(rpc_password, safe='')}@127.0.0.1:8332",
    timeout=120,
)

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

    # Fetch releases for both repos
    bip110_releases = fetch_all_releases("dathonohm", "bitcoin")
    core_releases = fetch_all_releases("bitcoin", "bitcoin")

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
    return {"bip110": bip110_map, "core": core_map}

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
    return {"release_time_utc": "", "github_url": "", "tag_name": ""}

# --- Patch for missing BIP110 datetimes/urls ---
# No longer needed: fallback now handled in fetch_github_release_metadata and get_release_metadata.

def patch_missing_release_metadata(bip110_release_rows):
    return bip110_release_rows

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

    dedup = {}
    for label, h, period in points:
        prev = dedup.get(label)
        if prev is None or h > prev[0]:
            dedup[label] = (h, period)

    return [(label, hp[0], hp[1]) for label, hp in dedup.items()]


# Dynamic update: BIP-110 datasets (changes over time)
current_height = int(rpc.getblockcount())
current_hash = rpc.getblockhash(current_height)
current_time_utc = datetime.fromtimestamp(int(rpc.getblockheader(current_hash)["time"]), tz=timezone.utc)
date_str = current_time_utc.strftime("%Y-%m-%d %H:%M UTC")

bip110_total_periods = (BIP110_SIGNAL_END - BIP110_START) // PERIOD_SIZE
bip110_scan_end = min(current_height + 1, BIP110_SIGNAL_END)
bip110_signal = [0] * bip110_total_periods

for h in range(BIP110_START, bip110_scan_end):
    bh = rpc.getblockhash(h)
    version = int(rpc.getblockheader(bh)["version"])
    if (version & (1 << 4)) != 0:
        idx = (h - BIP110_START) // PERIOD_SIZE
        if 0 <= idx < bip110_total_periods:
            bip110_signal[idx] += 1

effective_height = clamp(current_height, BIP110_START, BIP110_SIGNAL_END)
blocks_into_window = effective_height - BIP110_START
completed_periods = int(clamp(blocks_into_window // PERIOD_SIZE, 0, bip110_total_periods))
in_window = (current_height >= BIP110_START) and (current_height < BIP110_SIGNAL_END)
has_inprogress = in_window and (completed_periods < bip110_total_periods)
blocks_into_current_period = int((blocks_into_window % PERIOD_SIZE) if has_inprogress else 0)
current_period_index = int(completed_periods + 1) if has_inprogress else None

bip110_period_rows = []
for period in range(1, X_MAX + 1):
    in_signaling_window = period <= bip110_total_periods
    period_start = BIP110_START + (period - 1) * PERIOD_SIZE if in_signaling_window else ""
    period_end = period_start + PERIOD_SIZE - 1 if in_signaling_window else ""

    signal = 0
    elapsed = 0
    status = "future"

    if in_signaling_window and period <= completed_periods:
        signal = int(bip110_signal[period - 1])
        elapsed = PERIOD_SIZE
        status = "completed"
    elif has_inprogress and current_period_index is not None and period == int(current_period_index):
        elapsed = int(blocks_into_current_period)
        signal = int(clamp(float(bip110_signal[period - 1]), 0.0, float(elapsed)))
        status = "in_progress"
    elif in_signaling_window:
        status = "future"

    if period > bip110_total_periods:
        status = "post_window"

    bip110_period_rows.append({
        "period": period,
        "period_start_height": period_start,
        "period_end_height": period_end,
        "status": status,
        "signal_blocks": signal,
        "elapsed_blocks": elapsed,
    })

export_csv(
    webapp_dir / "bip110_periods.csv",
    bip110_period_rows,
    ["period", "period_start_height", "period_end_height", "status", "signal_blocks", "elapsed_blocks"],
)

bip110_plot_max_height = None
if current_height < BIP110_START:
    bip110_plot_max_height = BIP110_START - 1
elif current_height < BIP110_SIGNAL_END:
    bip110_plot_max_height = current_height
else:
    bip110_plot_max_height = BIP110_SIGNAL_END - 1

bip110_block_rows = []
if bip110_plot_max_height is not None and bip110_plot_max_height >= BIP110_START:
    for period in range(1, bip110_total_periods + 1):
        period_start = BIP110_START + (period - 1) * PERIOD_SIZE
        period_end = period_start + PERIOD_SIZE - 1
        if period_start > bip110_plot_max_height:
            break
        effective_end = min(period_end, bip110_plot_max_height)

        for h in range(period_start, effective_end + 1):
            bh = rpc.getblockhash(h)
            version = int(rpc.getblockheader(bh)["version"])
            bip110_block_rows.append({
                "period": period,
                "height": h,
                "y_in_period": h - period_start,
                "is_signaling": int((version & (1 << 4)) != 0),
            })

bip110_blocks_meta = export_block_points_bin(
    webapp_dir / "bip110_block_points.bin",
    bip110_block_rows,
    period_size=PERIOD_SIZE,
)

static_release_points = []
for label, height, period in bip110_releases:
    if period is None or not (1 <= period <= BIP110_LAST_PERIOD):
        continue
    static_release_points.append((str(label), int(height), int(period)))

dynamic_release_points = build_dynamic_release_points(current_height)

release_point_map = {label: (height, period) for label, height, period in static_release_points}
for label, height, period in dynamic_release_points:
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
    dy = -55 if label.lower() in ["core:v30.1"] else 55

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


# Static datasets + split metadata
force_refresh_segwit = False

segwit_required = [
    webapp_dir / "segwit_periods.csv",
    webapp_dir / "segwit_releases.csv",
    webapp_dir / "segwit_month_ticks.csv",
    webapp_dir / "segwit_block_points.bin",
]
needs_segwit_rebuild = force_refresh_segwit or any(not p.exists() for p in segwit_required)

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
            version = int(rpc.getblockheader(bh)["version"])
            segwit_block_rows.append({
                "period": period,
                "height": h,
                "y_in_period": h - period_start,
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
            "release_time_utc": "",
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
    rows = segwit_bin.stat().st_size // 5
    segwit_blocks_meta = {
        "rows": int(rows),
        "start_height": int(SEGWIT_START),
        "end_height": int(SEGWIT_START + rows - 1),
        "period_size": int(PERIOD_SIZE),
    }
    print("SegWit datasets unchanged (already present).")

chart_static_path = webapp_dir / "chart_static.json"
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
                {"period": 20, "text": "Max Activation Height (965,664)", "rotation": 90},
            ],
            "footer": {
                "source_url": "https://wickedsmartbitcoin.com/bip110_signaling",
            },
        },
        "datasets": {
            "segwit_blocks": segwit_blocks_meta,
        },
    }

    with chart_static_path.open("w", encoding="utf-8") as f:
        json.dump(chart_static, f, separators=(",", ":"), ensure_ascii=True)
    print("Wrote static chart bundle.")
else:
    with chart_static_path.open("r", encoding="utf-8") as f:
        chart_static = json.load(f)
    print("Static chart bundle unchanged.")

bip110_metadata = {
    "generated_utc": datetime.now(timezone.utc).isoformat(),
    "source_block_height": int(current_height),
    "source_block_time_utc": date_str,
    "state": state,
    "datasets": {
        "bip110_blocks": bip110_blocks_meta,
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

