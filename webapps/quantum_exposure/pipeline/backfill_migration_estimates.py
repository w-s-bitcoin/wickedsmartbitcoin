#!/usr/bin/env python3
"""One-time backfill for estimated_migration_blocks under generic PQ assumptions.

Assumptions:
- Fixed PQ input payloads (script-type aware, with multisig m-of-n adjustment)
- One output per migration transaction
- No change output
- Maximum 10,000 inputs per transaction

This script rewrites:
- webapp_data/<snapshot>/dashboard_pubkeys_aggregates.csv
- webapp_data/archived/<snapshot>/dashboard_pubkeys_aggregates.csv

Then rebuilds:
- webapp_data/historical_eco.csv
- webapp_data/historical_archived.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Tuple

from pipeline_paths import QUANTUM_DIR

WEBAPP_DATA_DIR = QUANTUM_DIR / "webapp_data"

PQ_MAX_INPUTS_PER_TX = 10_000
PQ_TX_OVERHEAD_VBYTES = 11
PQ_OUTPUT_VBYTES = 34
PQ_INPUT_VBYTES_BY_SCRIPT_TYPE = {
    "P2PK": 363,
    "P2PKH": 383,
    "P2SH": 420,
    "P2WPKH": 127,
    "P2WSH": 230,
    "P2TR": 123,
    "Other": 383,
}

BALANCE_MIN_SATS = {
    "ge1": 100_000_000,
    "ge10": 1_000_000_000,
    "ge100": 10_000_000_000,
    "ge1000": 100_000_000_000,
}

SCRIPT_TYPES_ORDER = ["P2PK", "P2PKH", "P2SH", "P2WPKH", "P2WSH", "P2TR", "Other"]
KNOWN_SCRIPT_TYPES = set(SCRIPT_TYPES_ORDER)
SPEND_ACTIVITIES = {"active", "inactive", "never_spent"}

HISTORICAL_FIELDNAMES = [
    "snapshot",
    "balance_filter",
    "script_type_filter",
    "spend_activity_filter",
    "pubkey_count",
    "utxo_count",
    "supply_sats",
    "exposed_pubkey_count",
    "exposed_utxo_count",
    "exposed_supply_sats",
    "estimated_migration_blocks",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backfill migration estimates using generic PQ assumptions")
    parser.add_argument(
        "--webapp-data-dir",
        default=str(WEBAPP_DATA_DIR),
        help="Path to quantum_exposure/webapp_data",
    )
    parser.add_argument("--snapshot", help="Single snapshot height to backfill (checks active and archived)")
    parser.add_argument("--all", action="store_true", help="Backfill all snapshots")
    parser.add_argument("--dry-run", action="store_true", help="Show changes without writing files")
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


def get_row_script_types(supply_by_script: Dict[str, int]) -> List[str]:
    derived = [script for script in SCRIPT_TYPES_ORDER if to_int(supply_by_script.get(script)) > 0]
    return derived or ["Other"]


def get_row_exposed_supply_sats(row: dict, supply_by_script: Dict[str, int]) -> int:
    total = sum(to_int(value) for value in supply_by_script.values())
    if total > 0:
        return total
    return to_int(row.get("exposed_supply_sats"))


def pq_input_vbytes_for_script_type(script_type: str) -> int:
    return int(PQ_INPUT_VBYTES_BY_SCRIPT_TYPE.get(script_type, PQ_INPUT_VBYTES_BY_SCRIPT_TYPE["Other"]))


def parse_multisig_mn(raw_details: str | None) -> tuple[int, int] | None:
    """Parse 'm-of-n multisig' detail string into (m, n), or None if not multisig."""
    import re
    if not raw_details:
        return None
    match = re.match(r"^(\d+)-of-(\d+)\s+multisig$", str(raw_details).strip(), re.IGNORECASE)
    if not match:
        return None
    m, n = int(match.group(1)), int(match.group(2))
    if m < 1 or n < 1 or m > n:
        return None
    return m, n


def pq_effective_input_vbytes(script_type: str, mn: tuple[int, int] | None) -> int:
    """Return per-input vbytes using multisig m/n detail for P2SH/P2WSH when available.

    P2SH m-of-n:  41 + m*73 + n*34  (scriptSig: OP_0 + m sigs + redeemScript)
    P2WSH m-of-n: ceil((m*73 + n*34 + 170) / 4)  (segwit discount)
    """
    if mn and script_type == "P2SH":
        m, n = mn
        return 41 + m * 73 + n * 34
    if mn and script_type == "P2WSH":
        m, n = mn
        return math.ceil((m * 73 + n * 34 + 170) / 4)
    return pq_input_vbytes_for_script_type(script_type)


def estimate_group_input_vbytes_from_script_mix(
    utxo_count: int,
    supply_by_script: Dict[str, int],
    mn: tuple[int, int] | None = None,
) -> float:
    if utxo_count <= 0:
        return 0.0

    script_types = get_row_script_types(supply_by_script)

    has_p2pk = "P2PK" in script_types
    non_p2pk_types = [script_type for script_type in script_types if script_type != "P2PK"]
    if has_p2pk and non_p2pk_types:
        remaining_utxos = max(0, utxo_count - 1)
        if remaining_utxos == 0:
            return float(pq_input_vbytes_for_script_type("P2PK"))

        weighted_non_p2pk = [
            (script_type, max(0, to_int(supply_by_script.get(script_type, 0))))
            for script_type in non_p2pk_types
        ]
        total_non_p2pk_sats = sum(item[1] for item in weighted_non_p2pk)

        if total_non_p2pk_sats <= 0:
            avg_input = sum(
                pq_effective_input_vbytes(st, mn) for st, _ in weighted_non_p2pk
            ) / max(len(weighted_non_p2pk), 1)
            return pq_input_vbytes_for_script_type("P2PK") + (remaining_utxos * avg_input)

        allocations = []
        for script_type, sats in weighted_non_p2pk:
            exact = (remaining_utxos * sats) / total_non_p2pk_sats
            base = math.floor(exact)
            allocations.append({"script_type": script_type, "base": base, "fraction": exact - base})

        assigned = sum(item["base"] for item in allocations)
        remainder = max(0, remaining_utxos - assigned)
        allocations.sort(key=lambda item: item["fraction"], reverse=True)
        for item in allocations:
            if remainder <= 0:
                break
            item["base"] += 1
            remainder -= 1

        non_p2pk_vbytes = sum(
            item["base"] * pq_effective_input_vbytes(item["script_type"], mn)
            for item in allocations
        )
        return pq_input_vbytes_for_script_type("P2PK") + non_p2pk_vbytes

    weighted = []
    for script_type in script_types:
        weighted.append((script_type, max(0, to_int(supply_by_script.get(script_type, 0)))))

    total_sats = sum(item[1] for item in weighted)
    if total_sats <= 0:
        avg_input = sum(
            pq_effective_input_vbytes(st, mn) for st, _ in weighted
        ) / max(len(weighted), 1)
        return utxo_count * avg_input

    allocations = []
    for script_type, sats in weighted:
        exact = (utxo_count * sats) / total_sats
        base = math.floor(exact)
        allocations.append({"script_type": script_type, "base": base, "fraction": exact - base})

    assigned = sum(item["base"] for item in allocations)
    remainder = max(0, utxo_count - assigned)
    allocations.sort(key=lambda item: item["fraction"], reverse=True)
    for item in allocations:
        if remainder <= 0:
            break
        item["base"] += 1
        remainder -= 1

    return sum(
        item["base"] * pq_effective_input_vbytes(item["script_type"], mn)
        for item in allocations
    )


def estimate_blocks_for_group_row(
    utxo_count: int,
    supply_by_script: Dict[str, int],
    mn: tuple[int, int] | None = None,
) -> float:
    if utxo_count <= 0:
        return 0.0
    tx_count = math.ceil(utxo_count / PQ_MAX_INPUTS_PER_TX)
    input_vbytes = estimate_group_input_vbytes_from_script_mix(utxo_count, supply_by_script, mn=mn)
    total_vbytes = (
        input_vbytes
        + (tx_count * (PQ_TX_OVERHEAD_VBYTES + PQ_OUTPUT_VBYTES))
    )
    return (total_vbytes * 4) / 4_000_000.0


def estimate_blocks_from_aggregate_row(
    row: dict,
    inferred_input_vbytes: float | None = None,
) -> float:
    utxo_count = to_int(row.get("exposed_utxo_count"))
    if utxo_count <= 0:
        return 0.0

    exposed_pubkeys = max(0, to_int(row.get("exposed_pubkey_count")))
    min_tx_from_groups = min(exposed_pubkeys, utxo_count)
    tx_count = max(math.ceil(utxo_count / PQ_MAX_INPUTS_PER_TX), min_tx_from_groups)

    if inferred_input_vbytes is None:
        script_type_filter = str(row.get("script_type_filter") or "").strip()
        per_input = pq_input_vbytes_for_script_type(script_type_filter)
        input_vbytes = utxo_count * per_input
    else:
        input_vbytes = inferred_input_vbytes

    total_vbytes = (
        input_vbytes
        + (tx_count * (PQ_TX_OVERHEAD_VBYTES + PQ_OUTPUT_VBYTES))
    )
    return (total_vbytes * 4) / 4_000_000.0


def build_ge1_estimates(ge1_path: Path) -> Dict[Tuple[str, str, str], float]:
    estimates: Dict[Tuple[str, str, str], float] = defaultdict(float)

    with ge1_path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            supply_by_script = parse_script_supply_map(row.get("exposed_supply_sats_by_script_type", ""))
            exposed_supply = get_row_exposed_supply_sats(row, supply_by_script)
            if exposed_supply < BALANCE_MIN_SATS["ge1"]:
                continue

            spend_activity = str(row.get("spend_activity") or "").strip()
            if spend_activity not in SPEND_ACTIVITIES:
                continue

            mn = parse_multisig_mn(row.get("details"))
            row_estimate = estimate_blocks_for_group_row(
                to_int(row.get("exposed_utxo_count")),
                supply_by_script,
                mn=mn,
            )
            script_types = get_row_script_types(supply_by_script)

            for balance_filter, min_sats in BALANCE_MIN_SATS.items():
                if exposed_supply < min_sats:
                    continue

                estimates[(balance_filter, "All", "all")] += row_estimate
                estimates[(balance_filter, "All", spend_activity)] += row_estimate

                for script_type in script_types:
                    estimates[(balance_filter, script_type, "all")] += row_estimate
                    estimates[(balance_filter, script_type, spend_activity)] += row_estimate

    return estimates


def format_blocks(value: float) -> str:
    return f"{value:.2f}"


def apply_snapshot_correction(snapshot_dir: Path, dry_run: bool) -> Tuple[int, int, bool]:
    ge1_path = snapshot_dir / "dashboard_pubkeys_ge_1btc.csv"
    aggregates_path = snapshot_dir / "dashboard_pubkeys_aggregates.csv"

    if not aggregates_path.exists():
        return 0, 0, False

    ge1_estimates: Dict[Tuple[str, str, str], float] = {}
    if ge1_path.exists():
        ge1_estimates = build_ge1_estimates(ge1_path)

    with aggregates_path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        rows = list(reader)
        fieldnames = reader.fieldnames or []

    if not fieldnames:
        return 0, 0, False

    by_key: Dict[Tuple[str, str, str], dict] = {}
    for row in rows:
        key = (
            str(row.get("balance_filter") or "").strip(),
            str(row.get("script_type_filter") or "").strip(),
            str(row.get("spend_activity_filter") or "").strip(),
        )
        by_key[key] = row

    changed_rows = 0
    target_rows = 0

    for row in rows:
        balance_filter = str(row.get("balance_filter") or "").strip()
        script_type_filter = str(row.get("script_type_filter") or "").strip()
        spend_activity_filter = str(row.get("spend_activity_filter") or "").strip()

        current_value = str(row.get("estimated_migration_blocks") or "0").strip()
        corrected_value = current_value

        if balance_filter in BALANCE_MIN_SATS and ge1_estimates:
            key = (balance_filter, script_type_filter, spend_activity_filter)
            corrected_value = format_blocks(ge1_estimates.get(key, 0.0))
            target_rows += 1
        elif balance_filter == "all":
            inferred_input_vbytes = None
            if script_type_filter == "All":
                weighted_input_vbytes = 0.0
                for script_type in SCRIPT_TYPES_ORDER:
                    script_row = by_key.get((balance_filter, script_type, spend_activity_filter))
                    if not script_row:
                        continue
                    script_utxos = to_int(script_row.get("exposed_utxo_count"))
                    weighted_input_vbytes += script_utxos * pq_input_vbytes_for_script_type(script_type)
                if weighted_input_vbytes > 0:
                    inferred_input_vbytes = weighted_input_vbytes

            corrected_value = format_blocks(
                estimate_blocks_from_aggregate_row(row, inferred_input_vbytes=inferred_input_vbytes)
            )
            target_rows += 1

        if corrected_value != current_value:
            row["estimated_migration_blocks"] = corrected_value
            changed_rows += 1

    if changed_rows > 0 and not dry_run:
        with aggregates_path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)

    return changed_rows, target_rows, True


def list_snapshot_dirs(webapp_data_dir: Path, target_snapshot: str | None, all_snapshots: bool) -> List[Path]:
    active_root = webapp_data_dir
    archived_root = webapp_data_dir / "archived"

    if target_snapshot:
        candidates = [
            active_root / target_snapshot,
            archived_root / target_snapshot,
        ]
        found = [path for path in candidates if path.is_dir()]
        if not found:
            raise FileNotFoundError(
                f"Snapshot {target_snapshot} not found under active or archived webapp_data"
            )
        return found

    if not all_snapshots:
        raise ValueError("Specify either --snapshot <height> or --all")

    snapshots: List[Path] = []
    for root in (active_root, archived_root):
        if not root.is_dir():
            continue
        for path in root.iterdir():
            if path.is_dir() and path.name.isdigit():
                snapshots.append(path)

    snapshots.sort(key=lambda p: int(p.name))
    return snapshots


def rows_from_aggregates_for_historical(snapshot_dir: Path) -> List[dict]:
    aggregates_path = snapshot_dir / "dashboard_pubkeys_aggregates.csv"
    if not aggregates_path.exists():
        return []

    rows_out: List[dict] = []
    with aggregates_path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            rows_out.append(
                {
                    "snapshot": snapshot_dir.name,
                    "balance_filter": row.get("balance_filter", ""),
                    "script_type_filter": row.get("script_type_filter", ""),
                    "spend_activity_filter": row.get("spend_activity_filter", ""),
                    "pubkey_count": row.get("pubkey_count", "0"),
                    "utxo_count": row.get("utxo_count", "0"),
                    "supply_sats": row.get("supply_sats", "0"),
                    "exposed_pubkey_count": row.get("exposed_pubkey_count", "0"),
                    "exposed_utxo_count": row.get("exposed_utxo_count", "0"),
                    "exposed_supply_sats": row.get("exposed_supply_sats", "0"),
                    "estimated_migration_blocks": row.get("estimated_migration_blocks", "0.00"),
                }
            )

    return rows_out


def rebuild_historical_csv(snapshot_dirs: List[Path], output_path: Path, dry_run: bool) -> Tuple[int, bool]:
    all_rows: List[dict] = []
    for snapshot_dir in snapshot_dirs:
        all_rows.extend(rows_from_aggregates_for_historical(snapshot_dir))

    all_rows.sort(key=lambda r: (int(r.get("snapshot", 0)), r.get("balance_filter", ""), r.get("script_type_filter", ""), r.get("spend_activity_filter", "")))

    if dry_run:
        return len(all_rows), False

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=HISTORICAL_FIELDNAMES)
        writer.writeheader()
        writer.writerows(all_rows)
    return len(all_rows), True


def main() -> None:
    args = parse_args()
    webapp_data_dir = Path(args.webapp_data_dir).resolve()

    snapshot_dirs = list_snapshot_dirs(webapp_data_dir, args.snapshot, args.all)

    total_scanned = 0
    total_processed = 0
    total_changed_rows = 0
    changed_snapshots = 0

    for snapshot_dir in snapshot_dirs:
        total_scanned += 1
        changed_rows, target_rows, processed = apply_snapshot_correction(snapshot_dir, args.dry_run)
        if not processed:
            continue

        total_processed += 1
        total_changed_rows += changed_rows
        if changed_rows > 0:
            changed_snapshots += 1

        mode = "DRY-RUN" if args.dry_run else "UPDATED"
        print(
            f"[{mode}] snapshot {snapshot_dir.name}: target rows={target_rows}, changed rows={changed_rows}"
        )

    active_snapshots = [p for p in snapshot_dirs if p.parent == webapp_data_dir]
    archived_snapshots = [p for p in snapshot_dirs if p.parent.name == "archived"]

    eco_rows, eco_written = rebuild_historical_csv(
        active_snapshots,
        webapp_data_dir / "historical_eco.csv",
        args.dry_run,
    )
    arch_rows, arch_written = rebuild_historical_csv(
        archived_snapshots,
        webapp_data_dir / "historical_archived.csv",
        args.dry_run,
    )

    mode = "DRY-RUN" if args.dry_run else "DONE"
    print(
        f"[{mode}] snapshots scanned={total_scanned}, processed={total_processed}, "
        f"snapshots changed={changed_snapshots}, rows changed={total_changed_rows}"
    )
    print(
        f"[{mode}] historical_eco rows={eco_rows} {'(written)' if eco_written else '(not written)'}"
    )
    print(
        f"[{mode}] historical_archived rows={arch_rows} {'(written)' if arch_written else '(not written)'}"
    )


if __name__ == "__main__":
    main()
