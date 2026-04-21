#!/usr/bin/env python3
"""Summarize differences between a new snapshot and the prior 1000-block interval snapshot.

Outputs a human-readable report to stdout and mirrors it to
  webapp_data/<new_height>/snapshot_diff_summary.txt

Usage:
    python summarize_snapshot_diff.py <new_height>

The "prior" snapshot is the most recent 1000-block-interval snapshot that was
replaced by this run (i.e. the previous highest non-archived height below new_height
that is also a multiple of 1000, found either live or in the archived folder).
"""

from __future__ import annotations

import csv
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from pipeline_paths import QUANTUM_DIR

WEBAPP_DATA_DIR = QUANTUM_DIR / "webapp_data"
ARCHIVED_DIR = WEBAPP_DATA_DIR / "archived"
IDENTITY_GROUPS_PATH = WEBAPP_DATA_DIR / "identity_groups.json"

SATS_PER_BTC = 100_000_000
TENTH_BTC_SATS = SATS_PER_BTC // 10  # 10,000,000
MIN_TOP_MOVER_SATS = 100 * SATS_PER_BTC
INTERVAL = 1_000

# How many top movers to show per dimension
TOP_N = 10


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def row_exposed_supply_sats(row: dict) -> int:
    """Return exposed_supply_sats for a row.

    Older snapshots (pre-945000 schema) lack the ``exposed_supply_sats``
    column and store the breakdown only in ``exposed_supply_sats_by_script_type``.
    Fall back to summing that dict when the direct column is absent or zero.
    """
    direct = int(row.get("exposed_supply_sats") or 0)
    if direct:
        return direct
    return sum(
        parse_exposed_supply_sats_by_script_type(
            row.get("exposed_supply_sats_by_script_type") or ""
        ).values()
    )


def sats_to_btc(sats: int | float) -> float:
    return sats / SATS_PER_BTC


def fmt_btc(sats: int | float, sign: bool = False) -> str:
    """
    Format sats to BTC with intelligent rounding to match dashboard display:
    - 0 decimals if divisible by 100,000,000 (whole BTC)
    - 1 decimal if divisible by 10,000,000 (0.1 BTC increment)
    - 2 decimals otherwise
    """
    sats_int = int(sats)
    btc = sats_to_btc(sats_int)
    
    # Determine decimal places based on divisibility
    if sats_int % SATS_PER_BTC == 0:
        decimals = 0
    elif sats_int % TENTH_BTC_SATS == 0:
        decimals = 1
    else:
        decimals = 2
    
    fmt_str = f"{btc:+,.{decimals}f}" if sign else f"{btc:,.{decimals}f}"
    return f"{fmt_str:>14} BTC"


def fmt_pct(ratio: float, sign: bool = True) -> str:
    pct = ratio * 100.0
    prefix = "+" if sign and pct > 0 else ""
    return f"{prefix}{pct:.2f}%"


def fmt_pct_of_total(numerator: int, denominator: int) -> str:
    if denominator <= 0:
        return "0.00%"
    return f"{(numerator / denominator) * 100.0:.2f}%"


def parse_exposed_supply_sats_by_script_type(raw: str) -> dict[str, int]:
    if not raw:
        return {}
    normalized = raw.replace('""', '"').strip()
    try:
        payload = json.loads(normalized)
        if isinstance(payload, dict):
            return {k: int(float(v)) for k, v in payload.items() if v != ""}
    except (ValueError, TypeError):
        pass
    result: dict[str, int] = {}
    for match in re.findall(r'"([^"]+)"\s*:\s*([0-9]+)', normalized):
        result[match[0]] = int(match[1])
    return result


def read_ge1_csv(path: Path) -> list[dict]:
    if not path.exists():
        raise FileNotFoundError(f"ge1 CSV not found: {path}")
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def read_aggregates_csv(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def read_snapshot_utc_date(snapshot_dir: Path | None) -> str:
    """Return snapshot date in YYYY-MM-DD (UTC) from dashboard_snapshot_meta.csv."""
    if snapshot_dir is None:
        return "n/a"
    meta_path = snapshot_dir / "dashboard_snapshot_meta.csv"
    if not meta_path.exists():
        return "n/a"
    try:
        with meta_path.open(newline="", encoding="utf-8") as f:
            row = next(csv.DictReader(f), None)
        if not row:
            return "n/a"
        ts = int(row.get("snapshot_time") or 0)
        if ts <= 0:
            return "n/a"
        return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")
    except (ValueError, OSError, TypeError):
        return "n/a"


def load_identity_groups() -> dict[str, str]:
    """Return a dict mapping identity label -> group name."""
    if not IDENTITY_GROUPS_PATH.exists():
        return {}
    data = json.loads(IDENTITY_GROUPS_PATH.read_text(encoding="utf-8"))
    mapping: dict[str, str] = {}
    for group_name, members in data.get("groups", {}).items():
        for member in members:
            mapping[member] = group_name
    return mapping


def find_snapshot_dir(height: int) -> Path | None:
    """Find snapshot directory at the given height (live or archived)."""
    live = WEBAPP_DATA_DIR / str(height)
    if live.is_dir():
        return live
    archived = ARCHIVED_DIR / str(height)
    if archived.is_dir():
        return archived
    return None


def find_prior_interval_height(new_height: int) -> int | None:
    """Find the previous 1000-block interval snapshot that the new one replaced."""
    # Search backwards from new_height - INTERVAL
    candidate = ((new_height // INTERVAL) - 1) * INTERVAL
    while candidate > 0:
        d = find_snapshot_dir(candidate)
        if d is not None and (d / "dashboard_pubkeys_ge_1btc.csv").exists():
            return candidate
        candidate -= INTERVAL
    return None


def total_issued_supply_sats_at_height(height: int) -> int:
    """Return cumulative mined BTC supply in sats at a given block height."""
    if height <= 0:
        return 0

    remaining_blocks = int(height)
    era = 0
    total_sats = 0

    while remaining_blocks > 0:
        subsidy_sats = 50 * SATS_PER_BTC // (2**era)
        if subsidy_sats <= 0:
            break

        blocks_in_era = min(210_000, remaining_blocks)
        total_sats += blocks_in_era * subsidy_sats
        remaining_blocks -= blocks_in_era
        era += 1

    return total_sats


def resolve_total_supply_sats(height: int, agg_rows: list[dict], ge1_rows: list[dict]) -> int:
    """Resolve total BTC supply sats with multiple fallbacks for older archived snapshots."""
    for row in agg_rows:
        if (
            row.get("balance_filter", "") == "all"
            and row.get("script_type_filter", "") == "All"
            and row.get("spend_activity_filter", "") == "all"
        ):
            parsed = int(row.get("supply_sats") or 0)
            if parsed > 0:
                return parsed

    for row in ge1_rows:
        parsed = int(row.get("supply_sats") or row.get("total_supply_sats") or 0)
        if parsed > 0:
            return parsed

    return total_issued_supply_sats_at_height(height)


# ──────────────────────────────────────────────────────────────────────────────
# Computation helpers
# ──────────────────────────────────────────────────────────────────────────────

def aggregate_supply_by_script_type(rows: list[dict], agg_rows: list[dict] | None = None) -> dict[str, int]:
    """
    Get script type totals from aggregates if available, otherwise sum ge1 rows.
    """
    totals: dict[str, int] = {}
    script_types = ["P2PK", "P2PKH", "P2SH", "P2WPKH", "P2WSH", "P2TR"]
    
    if agg_rows:
        # Use aggregates
        for st in script_types:
            for row in agg_rows:
                if (
                    row.get("balance_filter", "") == "all"
                    and row.get("script_type_filter", "") == st
                    and row.get("spend_activity_filter", "") == "all"
                ):
                    totals[st] = int(row.get("exposed_supply_sats") or 0)
                    break
    else:
        # Fall back to summing ge1 rows
        totals_temp: dict[str, int] = defaultdict(int)
        for row in rows:
            for script_type, sats in parse_exposed_supply_sats_by_script_type(
                row.get("exposed_supply_sats_by_script_type") or ""
            ).items():
                totals_temp[script_type] += sats
        totals = dict(totals_temp)
    
    return totals


def aggregate_supply_by_spend_activity(rows: list[dict], agg_rows: list[dict] | None = None) -> dict[str, int]:
    """
    Get spend activity totals from aggregates if available, otherwise sum ge1 rows.
    """
    totals: dict[str, int] = {}
    activities = ["active", "inactive", "never_spent"]
    
    if agg_rows:
        # Use aggregates
        for activity in activities:
            for row in agg_rows:
                if (
                    row.get("balance_filter", "") == "all"
                    and row.get("script_type_filter", "") == "All"
                    and row.get("spend_activity_filter", "") == activity
                ):
                    totals[activity] = int(row.get("exposed_supply_sats") or 0)
                    break
    else:
        # Fall back to summing ge1 rows
        totals_temp: dict[str, int] = defaultdict(int)
        for row in rows:
            activity = (row.get("spend_activity") or "unknown").strip()
            sats = row_exposed_supply_sats(row)
            totals_temp[activity] += sats
        totals = dict(totals_temp)
    
    return totals


def aggregate_supply_by_identity(rows: list[dict]) -> dict[str, int]:
    totals: dict[str, int] = defaultdict(int)
    for row in rows:
        identity = (row.get("identity") or "").strip() or "unidentified"
        sats = row_exposed_supply_sats(row)
        totals[identity] += sats
    return dict(totals)


def aggregate_supply_by_group(
    rows: list[dict], identity_to_group: dict[str, str]
) -> dict[str, int]:
    totals: dict[str, int] = defaultdict(int)
    for row in rows:
        identity = (row.get("identity") or "").strip() or "unidentified"
        group = identity_to_group.get(identity, "Ungrouped / unidentified")
        sats = row_exposed_supply_sats(row)
        totals[group] += sats
    return dict(totals)


def dict_diff(old: dict[str, int], new: dict[str, int]) -> dict[str, int]:
    """Return {key: new_val - old_val} for all keys in either dict."""
    keys = set(old) | set(new)
    return {k: new.get(k, 0) - old.get(k, 0) for k in keys}


def top_movers(
    diff: dict[str, int],
    n: int,
    excluded_labels: set[str] | None = None,
) -> tuple[list[tuple[str, int]], list[tuple[str, int]]]:
    """Return (top_gainers, top_losers), each sorted by absolute change descending.

    Excludes labels passed in ``excluded_labels`` and ignores moves below 100 BTC.
    """
    blocked = excluded_labels or set()
    items = [
        (k, v)
        for k, v in diff.items()
        if abs(v) >= MIN_TOP_MOVER_SATS and k not in blocked
    ]
    gainers = sorted((item for item in items if item[1] > 0), key=lambda x: -x[1])[:n]
    losers = sorted((item for item in items if item[1] < 0), key=lambda x: x[1])[:n]
    return gainers, losers


# ──────────────────────────────────────────────────────────────────────────────
# Report formatting
# ──────────────────────────────────────────────────────────────────────────────

def section(title: str) -> str:
    width = 76
    line = "─" * width
    return f"\n{line}\n  {title}\n{line}"


def movers_table(
    gainers: list[tuple[str, int]],
    losers: list[tuple[str, int]],
    label: str,
    current_values: dict[str, int] | None = None,
) -> list[str]:
    lines: list[str] = []

    lines.append(f"  Largest increases ({label}):")
    if gainers:
        for name, sats in gainers:
            if current_values:
                current = current_values.get(name, 0)
                lines.append(f"    {fmt_btc(current):>20}  {fmt_btc(sats, sign=True):>20}   {name}")
            else:
                lines.append(f"    {fmt_btc(sats, sign=True):>20}   {name}")
    else:
        lines.append("    (none)")

    lines.append(f"\n  Largest decreases ({label}):")
    if losers:
        for name, sats in losers:
            if current_values:
                current = current_values.get(name, 0)
                lines.append(f"    {fmt_btc(current):>20}  {fmt_btc(sats, sign=True):>20}   {name}")
            else:
                lines.append(f"    {fmt_btc(sats, sign=True):>20}   {name}")
    else:
        lines.append("    (none)")

    return lines


# ──────────────────────────────────────────────────────────────────────────────
# Main report builder
# ──────────────────────────────────────────────────────────────────────────────

def build_report(new_height: int, prior_height: int) -> str:
    new_dir = find_snapshot_dir(new_height)
    prior_dir = find_snapshot_dir(prior_height)
    new_date_utc = read_snapshot_utc_date(new_dir)
    prior_date_utc = read_snapshot_utc_date(prior_dir)

    new_rows = read_ge1_csv(new_dir / "dashboard_pubkeys_ge_1btc.csv")
    prior_rows = read_ge1_csv(prior_dir / "dashboard_pubkeys_ge_1btc.csv")

    new_agg_rows = read_aggregates_csv(new_dir / "dashboard_pubkeys_aggregates.csv")
    prior_agg_rows = read_aggregates_csv(prior_dir / "dashboard_pubkeys_aggregates.csv")

    identity_to_group = load_identity_groups()
    lines: list[str] = []

    # ── Header ──
    lines.append("=" * 76)
    lines.append(f"  Quantum Exposure Snapshot Diff Report")
    lines.append(f"  Prior : block {prior_height:,}")
    lines.append(f"  New   : block {new_height:,}")
    lines.append(f"  Prior Date (UTC): {prior_date_utc}")
    lines.append(f"  New Date (UTC): {new_date_utc}")
    lines.append("=" * 76)

    # ── 1. Supply overview ──
    lines.append(section("1. Supply Overview"))

    def agg_total_sats(agg_rows: list[dict], spend_filter: str = "active") -> int:
        for row in agg_rows:
            if (
                row.get("balance_filter", "") == "all"
                and row.get("script_type_filter", "") == "All"
                and row.get("spend_activity_filter", "") == spend_filter
            ):
                return int(row.get("exposed_supply_sats") or 0)
        # Fall back to summing ge1 rows
        return 0

    def agg_supply_sats(agg_rows: list[dict]) -> int:
        for row in agg_rows:
            if (
                row.get("balance_filter", "") == "all"
                and row.get("script_type_filter", "") == "All"
                and row.get("spend_activity_filter", "") == "all"
            ):
                return int(row.get("supply_sats") or 0)
        return 0

    # Use aggregates if available; otherwise sum ge1 rows
    def total_exposed(agg_rows: list[dict], ge1_rows: list[dict], spend_filter: str) -> int:
        val = agg_total_sats(agg_rows, spend_filter)
        if val:
            return val
        return sum(
            row_exposed_supply_sats(r)
            for r in ge1_rows
            if (r.get("spend_activity") or "").strip() == spend_filter
            or spend_filter == "all"
        )

    prior_total_all = total_exposed(prior_agg_rows, prior_rows, "all")
    new_total_all = total_exposed(new_agg_rows, new_rows, "all")
    prior_supply_all = resolve_total_supply_sats(prior_height, prior_agg_rows, prior_rows)
    new_supply_all = resolve_total_supply_sats(new_height, new_agg_rows, new_rows)
    delta_total_supply = new_supply_all - prior_supply_all
    pct_total_supply_change = delta_total_supply / prior_supply_all if prior_supply_all else 0.0
    delta_total = new_total_all - prior_total_all
    pct_change = delta_total / prior_total_all if prior_total_all else 0.0

    prior_total_active = total_exposed(prior_agg_rows, prior_rows, "active")
    new_total_active = total_exposed(new_agg_rows, new_rows, "active")
    delta_active = new_total_active - prior_total_active

    prior_total_inactive = total_exposed(prior_agg_rows, prior_rows, "inactive")
    new_total_inactive = total_exposed(new_agg_rows, new_rows, "inactive")
    delta_inactive = new_total_inactive - prior_total_inactive

    prior_total_never_spent = total_exposed(prior_agg_rows, prior_rows, "never_spent")
    new_total_never_spent = total_exposed(new_agg_rows, new_rows, "never_spent")
    delta_never_spent = new_total_never_spent - prior_total_never_spent

    lines += [
        f"  {'':33} {'Prior':>18}  {'New':>18}  {'Change':>18}",
        f"  {'Total supply':33} {fmt_btc(prior_supply_all)}  {fmt_btc(new_supply_all)}  {fmt_btc(delta_total_supply, sign=True)}  ({fmt_pct(pct_total_supply_change)})",
        f"  {'Exposed supply':33} {fmt_btc(prior_total_all)}  {fmt_btc(new_total_all)}  {fmt_btc(delta_total, sign=True)}  ({fmt_pct(pct_change)})",
        f"  {'Exposed share of total supply':33} {fmt_pct_of_total(prior_total_all, prior_supply_all):>18}  {fmt_pct_of_total(new_total_all, new_supply_all):>18}",
        f"  {'  Active (key-reuse risk)':33} {fmt_btc(prior_total_active)}  {fmt_btc(new_total_active)}  {fmt_btc(delta_active, sign=True)}",
        f"  {'  Inactive (not recently spent)':33} {fmt_btc(prior_total_inactive)}  {fmt_btc(new_total_inactive)}  {fmt_btc(delta_inactive, sign=True)}",
        f"  {'  never_spent':33} {fmt_btc(prior_total_never_spent)}  {fmt_btc(new_total_never_spent)}  {fmt_btc(delta_never_spent, sign=True)}",
    ]

    # ── 2. UTXO / group counts ──
    prior_row_count = len(prior_rows)
    new_row_count = len(new_rows)
    lines.append("")
    lines.append(f"  Address groups tracked : {prior_row_count:>10,}  →  {new_row_count:>10,}  ({new_row_count - prior_row_count:+,})")

    prior_utxos = sum(int(r.get("exposed_utxo_count") or 0) for r in prior_rows)
    new_utxos = sum(int(r.get("exposed_utxo_count") or 0) for r in new_rows)
    lines.append(f"  Exposed UTXOs          : {prior_utxos:>10,}  →  {new_utxos:>10,}  ({new_utxos - prior_utxos:+,})")

    def agg_exposed_pubkey_count(agg_rows: list[dict]) -> int:
        for row in agg_rows:
            if (
                row.get("balance_filter", "") == "all"
                and row.get("script_type_filter", "") == "All"
                and row.get("spend_activity_filter", "") == "all"
            ):
                return int(row.get("exposed_pubkey_count") or 0)
        return 0

    prior_pubkeys = agg_exposed_pubkey_count(prior_agg_rows)
    new_pubkeys = agg_exposed_pubkey_count(new_agg_rows)
    lines.append(f"  Exposed Pubkeys        : {prior_pubkeys:>10,}  →  {new_pubkeys:>10,}  ({new_pubkeys - prior_pubkeys:+,})")

    # ── 3. By script type ──
    lines.append(section("2. Exposed Supply by Script Type"))

    prior_by_script = aggregate_supply_by_script_type(prior_rows, prior_agg_rows)
    new_by_script = aggregate_supply_by_script_type(new_rows, new_agg_rows)
    script_diff = dict_diff(prior_by_script, new_by_script)
    
    # Maintain specific script type order
    script_order = ["P2PK", "P2PKH", "P2SH", "P2WPKH", "P2WSH", "P2TR"]
    all_script_types = [st for st in script_order if st in prior_by_script or st in new_by_script]

    lines.append(f"  {'Script Type':20} {'Prior':>18}  {'New':>18}  {'Change':>18}")
    lines.append(f"  {'─'*20} {'─'*18}  {'─'*18}  {'─'*18}")
    for st in all_script_types:
        prior_v = prior_by_script.get(st, 0)
        new_v = new_by_script.get(st, 0)
        d = new_v - prior_v
        lines.append(f"  {st:20} {fmt_btc(prior_v):>18}  {fmt_btc(new_v):>18}  {fmt_btc(d, sign=True):>18}")

    # ── 4. By spend activity ──
    lines.append(section("3. Exposed Supply by Spend Activity"))

    prior_by_activity = aggregate_supply_by_spend_activity(prior_rows, prior_agg_rows)
    new_by_activity = aggregate_supply_by_spend_activity(new_rows, new_agg_rows)
    all_activities = sorted(set(prior_by_activity) | set(new_by_activity))

    lines.append(f"  {'Activity':20} {'Prior':>18}  {'New':>18}  {'Change':>18}")
    lines.append(f"  {'─'*20} {'─'*18}  {'─'*18}  {'─'*18}")
    for act in all_activities:
        prior_v = prior_by_activity.get(act, 0)
        new_v = new_by_activity.get(act, 0)
        d = new_v - prior_v
        lines.append(f"  {act:20} {fmt_btc(prior_v):>18}  {fmt_btc(new_v):>18}  {fmt_btc(d, sign=True):>18}")

    # ── 5. By identity group ──
    lines.append(section("4. Exposed Supply by Identity Group"))

    prior_by_group = aggregate_supply_by_group(prior_rows, identity_to_group)
    new_by_group = aggregate_supply_by_group(new_rows, identity_to_group)
    group_diff = dict_diff(prior_by_group, new_by_group)
    all_groups = sorted(set(prior_by_group) | set(new_by_group))

    col_w = max(42, max((len(g) for g in all_groups), default=0) + 2)
    lines.append(f"  {'Group':{col_w}} {'Prior':>18}  {'New':>18}  {'Change':>18}")
    lines.append(f"  {'─'*col_w} {'─'*18}  {'─'*18}  {'─'*18}")
    for grp in all_groups:
        prior_v = prior_by_group.get(grp, 0)
        new_v = new_by_group.get(grp, 0)
        d = new_v - prior_v
        lines.append(f"  {grp:{col_w}} {fmt_btc(prior_v)}  {fmt_btc(new_v)}  {fmt_btc(d, sign=True)}")

    # Top group movers
    group_gainers, group_losers = top_movers(
        group_diff,
        TOP_N,
        excluded_labels={"Ungrouped / unidentified"},
    )
    lines.append("")
    lines += movers_table(group_gainers, group_losers, "identity group", new_by_group)

    # ── 6. By individual identity ──
    lines.append(section("5. Top Identity Movers (nominal BTC change)"))

    prior_by_identity = aggregate_supply_by_identity(prior_rows)
    new_by_identity = aggregate_supply_by_identity(new_rows)
    identity_diff = dict_diff(prior_by_identity, new_by_identity)
    identity_gainers, identity_losers = top_movers(
        identity_diff,
        TOP_N,
        excluded_labels={"unidentified"},
    )
    lines += movers_table(identity_gainers, identity_losers, "individual identity", new_by_identity)

    # ── 7. New identities appearing / identities leaving ──
    lines.append(section("6. Identity Coverage Changes"))

    prior_identities = {
        (r.get("identity") or "").strip()
        for r in prior_rows
        if (r.get("identity") or "").strip() not in ("", "unidentified")
    }
    new_identities = {
        (r.get("identity") or "").strip()
        for r in new_rows
        if (r.get("identity") or "").strip() not in ("", "unidentified")
    }
    entered = sorted(new_identities - prior_identities)
    exited = sorted(prior_identities - new_identities)

    lines.append(f"  Previously unidentified addresses now labelled : {len(entered):,}")
    if entered:
        for ident in entered[:20]:
            lines.append(f"    + {ident}")
        if len(entered) > 20:
            lines.append(f"    ... and {len(entered) - 20} more")

    lines.append(f"\n  Identities no longer present in snapshot       : {len(exited):,}")
    if exited:
        for ident in exited[:20]:
            lines.append(f"    - {ident}")
        if len(exited) > 20:
            lines.append(f"    ... and {len(exited) - 20} more")

    # ── Footer ──
    lines.append("\n" + "=" * 76)
    lines.append(f"  End of snapshot diff report: block {prior_height:,} → block {new_height:,}")
    lines.append("=" * 76)

    return "\n".join(lines)


# ──────────────────────────────────────────────────────────────────────────────
# Entry point
# ──────────────────────────────────────────────────────────────────────────────

def main() -> None:
    if len(sys.argv) < 2:
        print(f"Usage: {Path(sys.argv[0]).name} <new_height>", file=sys.stderr)
        sys.exit(1)

    new_height = int(sys.argv[1])
    prior_height = find_prior_interval_height(new_height)

    if prior_height is None:
        print(
            f"No prior 1000-block interval snapshot found before height {new_height}. "
            "Nothing to diff.",
            file=sys.stderr,
        )
        sys.exit(0)

    print(f"Diffing snapshot {prior_height:,} → {new_height:,} ...")

    report = build_report(new_height, prior_height)

    print(report)

    # Write to the new snapshot folder.
    out_path = WEBAPP_DATA_DIR / str(new_height) / "snapshot_diff_summary.txt"
    # Also check archived in case the snapshot was already archived
    if not (WEBAPP_DATA_DIR / str(new_height)).exists():
        archived_new = ARCHIVED_DIR / str(new_height)
        if archived_new.exists():
            out_path = archived_new / "snapshot_diff_summary.txt"

    out_path.write_text(report, encoding="utf-8")
    print(f"\nDiff report saved to: {out_path}")


if __name__ == "__main__":
    main()
