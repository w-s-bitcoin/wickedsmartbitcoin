#!/usr/bin/env python3
"""Correct exposed_pubkey_count in dashboard_pubkeys_aggregates.csv using multisig thresholds.

Primary correction:
- Recompute balances >= 1 BTC (ge1/ge10/ge100/ge1000) from ge1 rows.

Approximation for all-balance rows:
- Add the additional pubkeys discovered by the ge1 correction into matching
    balance_filter=all rows for the same (script_type_filter, spend_activity_filter).
    This is a first-order approximation for additional multisig pubkeys above 1 BTC.

For rows with known multisig detail tags like "m-of-n multisig", each matching
row contributes n exposed pubkeys; otherwise each row contributes 1.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from collections import defaultdict
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

BALANCE_MIN_SATS = {
    "ge1": 100_000_000,
    "ge10": 1_000_000_000,
    "ge100": 10_000_000_000,
    "ge1000": 100_000_000_000,
}

SCRIPT_TYPES_ORDER = ["P2PK", "P2PKH", "P2SH", "P2WPKH", "P2WSH", "P2TR", "Other"]
KNOWN_SCRIPT_TYPES = set(SCRIPT_TYPES_ORDER)
MULTISIG_RE = re.compile(r"(\d+)\s*-\s*of\s*-\s*(\d+)\s+multisig", re.IGNORECASE)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Correct aggregate pubkey counts from ge1 rows")
    parser.add_argument(
        "--webapp-data-dir",
        default=str(Path(__file__).resolve().parents[1] / "webapp_data"),
        help="Path to quantum_exposure/webapp_data",
    )
    parser.add_argument("--snapshot", help="Single snapshot height to correct")
    parser.add_argument("--all", action="store_true", help="Correct all snapshot folders")
    parser.add_argument("--dry-run", action="store_true", help="Print planned updates without writing")
    return parser.parse_args()


def to_int(value) -> int:
    text = str(value or "").strip().replace(",", "")
    if not text:
        return 0
    try:
        return int(float(text))
    except ValueError:
        return 0


def parse_script_supply_map(raw_value: str) -> Dict[str, int]:
    if not raw_value:
        return {}
    try:
        payload = json.loads(raw_value)
    except json.JSONDecodeError:
        return {}

    normalized: Dict[str, int] = {}
    for script_type_raw, sats_raw in payload.items():
        script_type = script_type_raw if script_type_raw in KNOWN_SCRIPT_TYPES else "Other"
        normalized[script_type] = normalized.get(script_type, 0) + to_int(sats_raw)
    return normalized


def get_row_script_types(row: dict, supply_by_script: Dict[str, int]) -> List[str]:
    explicit = [
        value.strip()
        for value in str(row.get("script_types") or row.get("script_type") or "").split("|")
        if value.strip() in KNOWN_SCRIPT_TYPES
    ]
    unique_explicit = sorted(set(explicit), key=SCRIPT_TYPES_ORDER.index) if explicit else []
    if unique_explicit:
        return unique_explicit

    derived = [script for script in SCRIPT_TYPES_ORDER if to_int(supply_by_script.get(script)) > 0]
    return derived or ["Other"]


def get_row_exposed_supply_sats(row: dict, supply_by_script: Dict[str, int]) -> int:
    total = sum(to_int(value) for value in supply_by_script.values())
    if total > 0:
        return total
    return to_int(row.get("exposed_supply_sats"))


def get_threshold_pubkey_count(detail_value: str) -> int:
    detail = str(detail_value or "").strip()
    match = MULTISIG_RE.search(detail)
    if not match:
        return 1

    n_value = to_int(match.group(2))
    return max(1, n_value)


def list_snapshot_dirs(webapp_data_dir: Path, target_snapshot: str | None, all_snapshots: bool) -> List[Path]:
    if target_snapshot:
        snapshot_dir = webapp_data_dir / target_snapshot
        if not snapshot_dir.is_dir():
            raise FileNotFoundError(f"Snapshot directory not found: {snapshot_dir}")
        return [snapshot_dir]

    if not all_snapshots:
        raise ValueError("Specify either --snapshot <height> or --all")

    snapshots = [
        path for path in webapp_data_dir.iterdir()
        if path.is_dir() and path.name.isdigit()
    ]
    snapshots.sort(key=lambda p: int(p.name))
    return snapshots


def build_corrected_counts_from_ge1(ge1_path: Path) -> Dict[Tuple[str, str, str], int]:
    counts: Dict[Tuple[str, str, str], int] = defaultdict(int)

    with ge1_path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            supply_by_script = parse_script_supply_map(row.get("exposed_supply_sats_by_script_type", ""))
            exposed_supply = get_row_exposed_supply_sats(row, supply_by_script)
            if exposed_supply < BALANCE_MIN_SATS["ge1"]:
                continue

            script_types = get_row_script_types(row, supply_by_script)
            spend_activity = str(row.get("spend_activity") or "").strip()
            if spend_activity not in {"active", "inactive", "never_spent"}:
                continue

            pubkey_increment = get_threshold_pubkey_count(row.get("details", ""))

            for balance_filter, min_sats in BALANCE_MIN_SATS.items():
                if exposed_supply < min_sats:
                    continue

                counts[(balance_filter, "All", "all")] += pubkey_increment
                counts[(balance_filter, "All", spend_activity)] += pubkey_increment

                for script_type in script_types:
                    counts[(balance_filter, script_type, "all")] += pubkey_increment
                    counts[(balance_filter, script_type, spend_activity)] += pubkey_increment

    return counts


def apply_correction_to_aggregates(
    aggregates_path: Path,
    corrected_counts: Dict[Tuple[str, str, str], int],
    dry_run: bool,
) -> Tuple[int, int]:
    with aggregates_path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        rows = list(reader)
        fieldnames = reader.fieldnames or []

    if not fieldnames:
        return 0, 0

    changed_rows = 0
    target_rows = 0

    original_counts: Dict[Tuple[str, str, str], int] = {}
    for row in rows:
        balance_filter = str(row.get("balance_filter") or "").strip()
        script_type_filter = str(row.get("script_type_filter") or "").strip()
        spend_activity_filter = str(row.get("spend_activity_filter") or "").strip()
        key = (balance_filter, script_type_filter, spend_activity_filter)
        original_counts[key] = to_int(row.get("exposed_pubkey_count"))

    ge1_delta_by_slice: Dict[Tuple[str, str], int] = {}
    for (balance_filter, script_type_filter, spend_activity_filter), corrected_value in corrected_counts.items():
        if balance_filter != "ge1":
            continue
        original_ge1 = original_counts.get(("ge1", script_type_filter, spend_activity_filter), 0)
        ge1_delta_by_slice[(script_type_filter, spend_activity_filter)] = corrected_value - original_ge1

    for row in rows:
        balance_filter = str(row.get("balance_filter") or "").strip()
        script_type_filter = str(row.get("script_type_filter") or "").strip()
        spend_activity_filter = str(row.get("spend_activity_filter") or "").strip()

        current_value = to_int(row.get("exposed_pubkey_count"))
        corrected_value = current_value

        if balance_filter in BALANCE_MIN_SATS:
            key = (balance_filter, script_type_filter, spend_activity_filter)
            corrected_value = corrected_counts.get(key, 0)
            target_rows += 1
        elif balance_filter == "all":
            delta = ge1_delta_by_slice.get((script_type_filter, spend_activity_filter), 0)
            corrected_value = current_value + delta
            target_rows += 1

        if corrected_value != current_value:
            row["exposed_pubkey_count"] = str(corrected_value)
            changed_rows += 1

    if changed_rows > 0 and not dry_run:
        with aggregates_path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)

    return changed_rows, target_rows


def process_snapshot(snapshot_dir: Path, dry_run: bool) -> Tuple[int, int, bool]:
    ge1_path = snapshot_dir / "dashboard_pubkeys_ge_1btc.csv"
    aggregates_path = snapshot_dir / "dashboard_pubkeys_aggregates.csv"

    if not ge1_path.exists() or not aggregates_path.exists():
        return 0, 0, False

    corrected_counts = build_corrected_counts_from_ge1(ge1_path)
    changed_rows, target_rows = apply_correction_to_aggregates(aggregates_path, corrected_counts, dry_run=dry_run)
    return changed_rows, target_rows, True


def main() -> None:
    args = parse_args()
    webapp_data_dir = Path(args.webapp_data_dir).resolve()

    snapshot_dirs = list_snapshot_dirs(webapp_data_dir, args.snapshot, args.all)
    total_snapshots = 0
    processed_snapshots = 0
    changed_snapshots = 0
    total_changed_rows = 0

    for snapshot_dir in snapshot_dirs:
        total_snapshots += 1
        changed_rows, target_rows, processed = process_snapshot(snapshot_dir, dry_run=args.dry_run)
        if not processed:
            continue

        processed_snapshots += 1
        total_changed_rows += changed_rows
        if changed_rows > 0:
            changed_snapshots += 1

        mode = "DRY-RUN" if args.dry_run else "UPDATED"
        print(
            f"[{mode}] snapshot {snapshot_dir.name}: "
            f"target rows={target_rows}, changed rows={changed_rows}"
        )

    summary_mode = "DRY-RUN" if args.dry_run else "DONE"
    print(
        f"[{summary_mode}] snapshots scanned={total_snapshots}, "
        f"snapshots processed={processed_snapshots}, "
        f"snapshots changed={changed_snapshots}, "
        f"rows changed={total_changed_rows}"
    )


if __name__ == "__main__":
    main()
