#!/usr/bin/env python3
"""
Generate ECO mode optimized files for Quantum Exposure dashboard:
1. Top 50 CSV files for fast initial load
2. Update historical_lite.csv with new snapshots
"""

import json
import csv
from pathlib import Path

QUANTUM_EXPOSURE_DIR = Path(__file__).parent
WEBAPP_DATA_DIR = QUANTUM_EXPOSURE_DIR / "webapp_data"

# Fields for historical_lite.csv
HISTORICAL_LITE_FIELDNAMES = [
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

BALANCE_FILTERS = ["all", "ge1", "ge10", "ge100", "ge1000"]
SCRIPT_TYPES = ["All", "P2PK", "P2PKH", "P2SH", "P2WPKH", "P2WSH", "P2TR"]
SPEND_ACTIVITIES = ["all", "never_spent", "inactive", "active"]


def get_exposed_supply(row):
    """Extract total exposed supply from the JSON column."""
    try:
        data = json.loads(row.get("exposed_supply_sats_by_script_type", "{}"))
        return sum(data.values())
    except (json.JSONDecodeError, TypeError):
        return 0


def generate_top50_for_snapshot(snapshot_dir):
    """Generate top_50 CSV for a single snapshot directory."""
    ge1_csv_path = snapshot_dir / "dashboard_pubkeys_ge_1btc.csv"
    top50_csv_path = snapshot_dir / "dashboard_pubkeys_ge_1btc_top50.csv"

    if not ge1_csv_path.exists():
        return None

    try:
        with open(ge1_csv_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            rows = list(reader)

        if not rows:
            return None

        # Sort by exposed supply descending
        rows_sorted = sorted(rows, key=lambda r: get_exposed_supply(r), reverse=True)
        top50_rows = rows_sorted[:50]

        # Write top 50
        if top50_rows:
            with open(top50_csv_path, "w", encoding="utf-8", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=reader.fieldnames)
                writer.writeheader()
                writer.writerows(top50_rows)

            total_rows = len(rows)
            return {"status": "generated", "count": len(top50_rows), "total": total_rows}
        return None
    except Exception as e:
        return {"status": "error", "error": str(e)}


def get_snapshot_height(snapshot_dir):
    """Extract snapshot blockheight from meta CSV."""
    meta_path = snapshot_dir / "dashboard_snapshot_meta.csv"
    if not meta_path.exists():
        try:
            return int(snapshot_dir.name)
        except ValueError:
            return None

    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                return int(row.get("snapshot_blockheight", 0))
    except Exception:
        return None
    return None


def read_existing_snapshots_in_historical_lite():
    """Get set of snapshot heights already in historical_lite.csv."""
    historical_lite_path = WEBAPP_DATA_DIR / "historical_lite.csv"
    if not historical_lite_path.exists():
        return set()

    try:
        existing = set()
        with open(historical_lite_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                try:
                    snapshot = int(row.get("snapshot", 0))
                    existing.add(snapshot)
                except ValueError:
                    pass
        return existing
    except Exception as e:
        print(f"  ✗ Error reading historical_lite.csv: {e}")
        return set()


def load_aggregates_for_snapshot(snapshot_dir):
    """Load aggregates CSV and return as dict of rows."""
    aggregates_path = snapshot_dir / "dashboard_pubkeys_aggregates.csv"
    if not aggregates_path.exists():
        return None

    try:
        rows = []
        with open(aggregates_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                rows.append(row)
        return rows
    except Exception as e:
        print(f"  ✗ Error reading aggregates from {snapshot_dir.name}: {e}")
        return None


def generate_historical_lite_rows(snapshot_height, aggregates_rows):
    """Generate historical_lite.csv rows for a snapshot."""
    if not aggregates_rows:
        return []

    output_rows = []
    for agg_row in aggregates_rows:
        balance_filter = agg_row.get("balance_filter", "").strip()
        script_type_filter = agg_row.get("script_type_filter", "").strip()
        spend_activity_filter = agg_row.get("spend_activity_filter", "").strip()

        # Only include valid filter combinations
        if (
            balance_filter in BALANCE_FILTERS
            and script_type_filter in SCRIPT_TYPES
            and spend_activity_filter in SPEND_ACTIVITIES
        ):
            output_rows.append(
                {
                    "snapshot": str(snapshot_height),
                    "balance_filter": balance_filter,
                    "script_type_filter": script_type_filter,
                    "spend_activity_filter": spend_activity_filter,
                    "pubkey_count": agg_row.get("pubkey_count", "0"),
                    "utxo_count": agg_row.get("utxo_count", "0"),
                    "supply_sats": agg_row.get("supply_sats", "0"),
                    "exposed_pubkey_count": agg_row.get("exposed_pubkey_count", "0"),
                    "exposed_utxo_count": agg_row.get("exposed_utxo_count", "0"),
                    "exposed_supply_sats": agg_row.get("exposed_supply_sats", "0"),
                    "estimated_migration_blocks": agg_row.get(
                        "estimated_migration_blocks", "0.00"
                    ),
                }
            )

    return output_rows


def append_to_historical_lite(new_rows):
    """Append rows to historical_lite.csv."""
    historical_lite_path = WEBAPP_DATA_DIR / "historical_lite.csv"

    try:
        # Read existing rows
        existing_rows = []
        if historical_lite_path.exists():
            with open(historical_lite_path, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                existing_rows = list(reader)

        # Combine and write back (sorted by snapshot for clarity)
        combined_rows = existing_rows + new_rows
        combined_rows.sort(
            key=lambda r: (int(r.get("snapshot", 0)), r.get("balance_filter", ""))
        )

        with open(historical_lite_path, "w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=HISTORICAL_LITE_FIELDNAMES)
            writer.writeheader()
            writer.writerows(combined_rows)

        return len(new_rows)
    except Exception as e:
        print(f"  ✗ Error writing to historical_lite.csv: {e}")
        return 0


def main():
    """Main execution."""
    if not WEBAPP_DATA_DIR.exists():
        print(f"Error: {WEBAPP_DATA_DIR} not found")
        return

    # Find all numeric snapshot directories
    snapshot_dirs = sorted(
        [d for d in WEBAPP_DATA_DIR.iterdir() if d.is_dir() and d.name.isdigit()],
        key=lambda x: int(x.name),
    )

    if not snapshot_dirs:
        print("No snapshot directories found")
        return

    print(f"Found {len(snapshot_dirs)} snapshot directories\n")

    # Phase 1: Generate top_50 CSV files
    print("=== Generating Top 50 CSV Files ===")
    top50_count = 0
    for snapshot_dir in snapshot_dirs:
        result = generate_top50_for_snapshot(snapshot_dir)
        if result:
            if result.get("status") == "generated":
                print(
                    f"  ✓ {snapshot_dir.name}: {result['count']} / {result['total']} rows"
                )
                top50_count += 1
            elif result.get("status") == "error":
                print(f"  ✗ {snapshot_dir.name}: {result['error']}")
        else:
            print(f"  ⊘ {snapshot_dir.name}: Skipped (no data)")

    # Phase 2: Update historical_lite.csv with new snapshots
    print("\n=== Updating historical_lite.csv ===")
    existing_snapshots = read_existing_snapshots_in_historical_lite()
    print(f"  Current snapshots in historical_lite.csv: {len(existing_snapshots)}")

    new_snapshots = []
    new_rows_all = []

    for snapshot_dir in snapshot_dirs:
        snapshot_height = get_snapshot_height(snapshot_dir)
        if snapshot_height is None:
            continue

        if snapshot_height in existing_snapshots:
            continue

        aggregates = load_aggregates_for_snapshot(snapshot_dir)
        if aggregates:
            new_rows = generate_historical_lite_rows(snapshot_height, aggregates)
            if new_rows:
                new_snapshots.append(snapshot_height)
                new_rows_all.extend(new_rows)

    if new_snapshots:
        rows_added = append_to_historical_lite(new_rows_all)
        print(f"  ✓ Added {len(new_snapshots)} snapshots ({rows_added} rows)")
        print(f"    Snapshots: {new_snapshots}")
    else:
        print("  ✓ No new snapshots to add (database up-to-date)")

    # Summary
    print(
        f"\n✅ Complete!"
    )
    print(f"  Generated top_50 files: {top50_count}")
    print(
        f"  Historical lite snapshots: {len(existing_snapshots) + len(new_snapshots)}"
    )


if __name__ == "__main__":
    main()
