import os
import json
import requests
import pandas as pd
import numpy as np
from io import StringIO
from datetime import datetime, timezone
from pathlib import Path

here = Path(__file__).resolve().parent
webapp_data_dir = here / "webapp_data"
webapp_data_dir.mkdir(parents=True, exist_ok=True)

print(f"Webapp data output directory: {webapp_data_dir}")

# Download and process node count history
def fetch_node_history():
    url = "https://luke.dashjr.org/programs/bitcoin/files/charts/data/history.txt"
    cols = ["timestamp", "listening", "est_unreachable", "knots_count", "core_v30_count", "bip110_count"]
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    text = resp.text
    cleaned_lines = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        cleaned_lines.append(" ".join(parts[:6]))
    df = pd.read_csv(
        StringIO("\n".join(cleaned_lines)),
        sep=r"\s+", header=None, names=cols, engine="python"
    )
    for col in cols[1:]:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    df["total_count"] = df["listening"] + df["est_unreachable"]
    df["datetime"] = pd.to_datetime(df["timestamp"], unit="s", utc=True)
    df["date"] = df["datetime"].dt.strftime("%Y-%m-%d")

    # Remove transient bad samples where both totals and unreachable collapse near zero.
    df = df.sort_values("timestamp").reset_index(drop=True)
    local_total_med = df["total_count"].rolling(window=9, center=True, min_periods=3).median()
    local_unreach_med = df["est_unreachable"].rolling(window=9, center=True, min_periods=3).median()
    min_total_floor = 2000
    min_unreach_floor = 2000
    outlier_mask = (
        (df["total_count"] <= min_total_floor)
        & (df["est_unreachable"] <= min_unreach_floor)
        & (df["total_count"] < (local_total_med * 0.25))
        & (df["est_unreachable"] < (local_unreach_med * 0.25))
    ).fillna(False)

    removed = int(outlier_mask.sum())
    if removed:
        print(f"Removed {removed} near-zero outlier rows from node history.")
        df = df.loc[~outlier_mask].copy()

    return df

node_history_df = fetch_node_history()
node_history_csv = webapp_data_dir / "bitcoin_node_history.csv"
node_history_df.to_csv(node_history_csv, index=False)
print(f"Wrote: {node_history_csv}")

# Fetch and process node software user agent data
def fetch_node_software_data():
    SOFTWARE_HTML_URL = "https://luke.dashjr.org/programs/bitcoin/files/charts/software.html"
    UAINFO_JSON_URL   = "https://luke.dashjr.org/programs/bitcoin/files/charts/data/uainfo.json"
    import re
    UA_PARENS_RE = re.compile(r"\([^)]*\)")
    MAPPABLE_UAS_RE = re.compile(r"var\s+mappable_uas\s*=\s*\{(.*?)\};", re.S | re.I)
    def canonicalize_ua(ua: str) -> str:
        if not ua:
            return ""
        s = UA_PARENS_RE.sub("", ua)
        s = re.sub(r"/{2,}", "/", s).strip()
        if not s.startswith("/"):
            s = "/" + s
        if not s.endswith("/"):
            s = s + "/"
        return s
    def extract_main_version(ua: str):
        m = re.search(r"Satoshi:(\d+)(?:\.(\d+))?", ua or "")
        if not m:
            return None
        major = int(m.group(1))
        minor = m.group(2)
        if major == 0 and minor:
            return f"v0.{minor}"
        return f"v{major}"
    def extract_sub_version(ua: str):
        m = re.search(r"Satoshi:(\d+)\.(\d+)(?:\.(\d+))?", ua or "")
        if not m:
            return None
        major = int(m.group(1))
        minor = int(m.group(2))
        patch = m.group(3)
        if major == 0:
            return f"v0.{minor}.{patch}" if patch is not None else f"v0.{minor}"
        return f"v{major}.{minor}.{patch}" if patch is not None else f"v{major}.{minor}"
    def ua_first_token(ua: str) -> str:
        s = (ua or "").strip("/")
        if not s:
            return ""
        return s.split("/", 1)[0].split(":", 1)[0]
    def to_int(val) -> int:
        if val is None:
            return 0
        if isinstance(val, bool):
            return int(val)
        if isinstance(val, (int, float)):
            return int(val)
        if isinstance(val, str):
            m = re.search(r"[-+]?\d+", val.replace(",", ""))
            return int(m.group(0)) if m else 0
        return 0
    def fetch_text(url: str) -> str:
        r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
        r.raise_for_status()
        return r.text
    def fetch_json(url: str):
        r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
        r.raise_for_status()
        return r.json()
    def extract_mappable_uas(software_html: str) -> dict:
        m = MAPPABLE_UAS_RE.search(software_html)
        if not m:
            return {}
        body = m.group(1)
        body = re.sub(r"//.*?$", "", body, flags=re.M)
        body = re.sub(r"/\*.*?\*/", "", body, flags=re.S)
        body_quoted_keys = re.sub(
            r"(\s*)([A-Za-z0-9_.\-]+)\s*:",
            lambda mo: f'{mo.group(1)}"{mo.group(2)}":',
            body,
        )
        body_jsonish = body_quoted_keys.replace("'", '"')
        body_jsonish = re.sub(r",\s*([}\]])", r"\1", body_jsonish)
        try:
            return json.loads("{" + body_jsonish + "}")
        except json.JSONDecodeError:
            mapping = {}
            for line in body.splitlines():
                line = line.strip().strip(",")
                if not line or ":" not in line:
                    continue
                k, v = line.split(":", 1)
                k = k.strip().strip('",\' ')
                v = v.strip().strip('",\' ')
                if k:
                    mapping[k] = v
            return mapping
    def classify_label_from_page_rules(ua: str, mappable_uas: dict) -> str:
        ua_str = ua or ""
        ua_lc = ua_str.lower()
        if "bip110" in ua_lc:
            return "BIP110"
        if "Knots:" in ua_str:
            return "Bitcoin Knots"
        token = ua_first_token(ua_str)
        t_lc = token.lower()
        for mk, mv in mappable_uas.items():
            if mk.lower() == t_lc:
                return mv.strip()
        if "Bitcoin Core" in ua_str:
            return "Bitcoin Core"
        if "knots" in t_lc:
            return "Bitcoin Knots"
        if t_lc == "bitcoinj":
            return "other"
        if re.match(r"^Bither1\.[\d.]+$", token):
            return "Bither"
        if token == "Classic":
            return "Bitcoin Classic"
        return "other"
    def normalize_uainfo_items(payload):
        if isinstance(payload, dict) and "items" in payload:
            items = payload["items"]
        elif isinstance(payload, list):
            items = payload
        elif isinstance(payload, dict):
            items = [{"ua": k, **(v if isinstance(v, dict) else {"count": v})} for k, v in payload.items()]
        else:
            items = []
        for it in items:
            if not isinstance(it, dict):
                continue
            raw_ua = str(it.get("ua") or it.get("user_agent") or it.get("version") or "").strip()
            ua = canonicalize_ua(raw_ua)
            cobj = it.get("count", it) if isinstance(it, dict) else {}
            listening = to_int(cobj.get("listening") if isinstance(cobj, dict) else it.get("listening"))
            est_unreach = to_int(cobj.get("est_unreachable") if isinstance(cobj, dict) else it.get("est_unreachable"))
            yield {"ua": ua, "listening": listening, "est_unreachable": est_unreach}
    def build_rows_like_page(mappable_uas: dict) -> pd.DataFrame:
        payload = fetch_json(UAINFO_JSON_URL)
        rows = []
        for rec in normalize_uainfo_items(payload):
            ua = rec["ua"]
            listening = rec["listening"]
            est_unreach = rec["est_unreachable"]
            total = listening + est_unreach
            if total <= 0:
                continue
            label = classify_label_from_page_rules(ua, mappable_uas)
            if label == "other" and listening == 0:
                continue
            rows.append({
                "ua": ua,
                "software": label,
                "main_version": extract_main_version(ua),
                "sub_version": extract_sub_version(ua),
                "listening": int(listening),
                "est_unreachable": int(est_unreach),
                "total_count": int(total),
            })
        return pd.DataFrame(rows)
    html = fetch_text(SOFTWARE_HTML_URL)
    mappable_uas = extract_mappable_uas(html)
    df = build_rows_like_page(mappable_uas)
    return df

node_software_df = fetch_node_software_data()
node_software_csv = webapp_data_dir / "node_software_counts_with_reachability.csv"
node_software_df.to_csv(node_software_csv, index=False)
print(f"Wrote: {node_software_csv}")

# Split node count history into weekly periods and export summary and per-block data
PERIOD_SIZE = 7  # days per period (can adjust as needed)
node_history_df["week"] = node_history_df["datetime"].dt.isocalendar().week
node_history_df["year"] = node_history_df["datetime"].dt.isocalendar().year

periods = node_history_df.groupby(["year", "week"]).agg({
    "datetime": ["min", "max"],
    "total_count": ["mean", "max", "min"]
}).reset_index()
periods.columns = ["year", "week", "start_date", "end_date", "mean_count", "max_count", "min_count"]
periods["period"] = range(1, len(periods) + 1)

periods_csv = webapp_data_dir / "node_count_periods.csv"
periods.to_csv(periods_csv, index=False)
print(f"Wrote: {periods_csv}")

# Export per-block data for frontend (CSV)
blocks_csv = webapp_data_dir / "node_count_blocks.csv"
node_history_df.to_csv(blocks_csv, index=False)
print(f"Wrote: {blocks_csv}")

# Group node software/version data and export for webapp
software_norm = node_software_df.copy()
software_norm["software"] = software_norm["software"].fillna("other").astype(str)
software_norm["main_version"] = software_norm["main_version"].fillna("unknown").astype(str)
software_norm["sub_version"] = software_norm["sub_version"].fillna("unknown").astype(str)
software_lc = software_norm["software"].str.lower()
is_core = software_lc.str.contains("core", regex=False)
is_knots = software_lc.str.contains("knots", regex=False)
is_bip110 = software_lc.str.contains("bip110", regex=False)
software_norm.loc[is_core, "software"] = "Bitcoin Core"
software_norm.loc[is_knots, "software"] = "Bitcoin Knots"
software_norm.loc[is_bip110, "software"] = "BIP110"
is_other = ~(is_core | is_knots | is_bip110)
software_norm.loc[is_other, "software"] = "other"
software_norm.loc[is_other, "sub_version"] = software_norm.loc[is_other, "main_version"]
software_grouped = (
    software_norm
    .groupby(["software", "main_version", "sub_version"], as_index=False)
    .agg({"listening": "sum", "est_unreachable": "sum", "total_count": "sum"})
    .sort_values(["software", "total_count"], ascending=[True, False], ignore_index=True)
)
software_grouped["percent"] = software_grouped["total_count"] / software_grouped["total_count"].sum() * 100.0
software_grouped_csv = webapp_data_dir / "node_software_counts_grouped.csv"
software_grouped.to_csv(software_grouped_csv, index=False)
print(f"Wrote: {software_grouped_csv}")

# Example: Fetch Bitcoin Core releases from GitHub API
# (Extend as needed for other node software)
import time

def fetch_github_releases(repo, max_pages=2):
    releases = []
    url = f"https://api.github.com/repos/{repo}/releases?per_page=100"
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "node-count-webapp"}
    for _ in range(max_pages):
        resp = requests.get(url, headers=headers, timeout=20)
        if resp.status_code != 200:
            break
        data = resp.json()
        releases.extend(data)
        # Pagination
        if 'next' in resp.links:
            url = resp.links['next']['url']
            time.sleep(1)
        else:
            break
    return releases

core_releases = fetch_github_releases("bitcoin/bitcoin")
release_rows = []
for rel in core_releases:
    tag = rel.get("tag_name")
    published = rel.get("published_at")
    url = rel.get("html_url")
    if tag and published:
        release_rows.append({
            "software": "Bitcoin Core",
            "version": tag,
            "release_time_utc": published,
            "github_url": url
        })
releases_csv = webapp_data_dir / "node_software_releases.csv"
pd.DataFrame(release_rows).to_csv(releases_csv, index=False)
print(f"Wrote: {releases_csv}")

# Chart/static config for frontend
chart_static = {
    "chart": {
        "figure_size_inches": [14, 8],
        "period_size": 7,  # days per period
        "titles": {
            "node_count": "Bitcoin Node Count by Software & Version",
        },
        "axis_labels": {
            "y": "Node Count",
            "x_bottom": "Weekly Periods",
        },
        "colors": {
            "background": "black",
            "foreground": "white",
            "core": "#f7931a",
            "knots": "#39d98a",
            "bip110": "#4169e1",
            "other": "#8ea3ad",
        },
        "bar": {
            "width": 0.5,
        },
        "footer": {
            "source_url": "https://wickedsmartbitcoin.com/node_count",
        },
    },
}
chart_static_path = webapp_data_dir / "chart_static.json"
with chart_static_path.open("w", encoding="utf-8") as f:
    json.dump(chart_static, f, separators=(",", ":"), ensure_ascii=True)
print(f"Wrote: {chart_static_path}")

# Write webapp_data refresh timestamp and print summary
last_updated_path = webapp_data_dir / "last_updated.txt"
updated_text = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
last_updated_path.write_text(updated_text + "\n", encoding="utf-8")
print(f"Wrote: {last_updated_path}")

# Print summary of all files in webapp_data_dir
print("\nCreated/updated files:")
for p in sorted(webapp_data_dir.glob("*")):
    if p.is_file():
        print(f"  - {p.name} ({p.stat().st_size:,} bytes)")
