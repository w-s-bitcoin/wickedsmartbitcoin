#!/usr/bin/env python3
"""
Fill in missing identity and details in ge1_btc CSVs by matching across snapshots.

When the same display_group_ids appears in multiple snapshots, they should have
the same identity and details values. This script:

1. Scans all ge1_btc CSVs to build a master identity/detail map
2. For each display_group_ids, uses the most complete/authoritative source
3. Updates all CSVs to fill in missing values from the master map
4. Reports what was filled in
"""

import sys
import csv
from pathlib import Path
from collections import defaultdict
from pipeline_paths import QUANTUM_DIR

QUANTUM_EXPOSURE_DIR = QUANTUM_DIR
WEBAPP_DATA_DIR = QUANTUM_EXPOSURE_DIR / "webapp_data"
ARCHIVED_DATA_DIR = WEBAPP_DATA_DIR / "archived"

# Canonical column names for ge1_btc files
CANONICAL_COLUMNS = [
    "display_group_ids",
    "exposed_supply_sats_by_script_type",
    "spend_activity",
    "exposed_utxo_count",
    "first_exposed_blockheight",
    "last_spend_blockheight",
    "details",
    "identity",
]

TARGET_FILES = (
    "dashboard_pubkeys_ge_1btc.csv",
    "dashboard_pubkeys_ge_1btc_top100.csv",
)


def load_all_ge1_btc_data():
    """
    Load all ge1_btc CSVs and return a map of:
    display_group_ids -> {"identity": str, "details": str}
    
    Prefers entries with non-empty identity values.
    """
    master_map = defaultdict(lambda: {"identity": "", "details": ""})
    
    # Scan all active + archived snapshot directories
    for _, snapshot_dir, _ in list_snapshot_targets(include_archived=True):
        
        ge1_csv = snapshot_dir / "dashboard_pubkeys_ge_1btc.csv"
        if not ge1_csv.exists():
            continue
        
        try:
            with open(ge1_csv, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    group_id = row.get("display_group_ids", "").strip()
                    identity = row.get("identity", "").strip()
                    details = row.get("details", "").strip()
                    
                    if not group_id:
                        continue
                    
                    # Update if this source has a non-empty identity
                    # (prefer non-empty values over empty ones)
                    if identity and not master_map[group_id]["identity"]:
                        master_map[group_id]["identity"] = identity
                    
                    # Update details similarly
                    if details and not master_map[group_id]["details"]:
                        master_map[group_id]["details"] = details
        
        except Exception as e:
            print(f"  ⚠ Error reading {snapshot_dir}: {e}")
    
    return dict(master_map)


def update_snapshot_csv_with_master_map(snapshot_dir, snapshot_label, master_map, filename):
    """
    Update a snapshot CSV using the master identity/details map.
    
    Returns dict with:
    - status: 'success', 'skipped', or 'error'
    - rows_processed: number of rows
    - identities_filled: number of rows with identity filled in
    - details_filled: number of rows with details filled in
    - details: explanation
    """
    ge1_csv = snapshot_dir / filename
    
    if not ge1_csv.exists():
        return {
            "status": "skipped",
            "details": f"No {filename} at {snapshot_label}",
        }
    
    try:
        # Read the CSV
        with open(ge1_csv, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            fieldnames = list(reader.fieldnames or [])
            rows = list(reader)
        
        if not rows:
            return {
                "status": "skipped",
                "details": "No data rows in CSV",
            }
        
        # Process rows
        identities_filled = 0
        details_filled = 0
        
        for row in rows:
            group_id = row.get("display_group_ids", "").strip()
            
            if group_id not in master_map:
                continue
            
            # Fill in missing/placeholder identity.
            identity_value = row.get("identity", "").strip()
            master_identity = master_map[group_id]["identity"].strip()
            should_fill_identity = (not identity_value) or (identity_value.lower() == "unidentified")
            if should_fill_identity and master_identity and master_identity.lower() != "unidentified":
                row["identity"] = master_identity
                identities_filled += 1
            
            # Fill in missing details
            if not row.get("details", "").strip():
                if master_map[group_id]["details"]:
                    row["details"] = master_map[group_id]["details"]
                    details_filled += 1
        
        # Write back to CSV
        with open(ge1_csv, "w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames or CANONICAL_COLUMNS)
            writer.writeheader()
            writer.writerows(rows)
        
        return {
            "status": "success",
            "rows_processed": len(rows),
            "identities_filled": identities_filled,
            "details_filled": details_filled,
            "details": f"Processed {len(rows)} rows",
        }
    
    except Exception as e:
        return {
            "status": "error",
            "details": f"Error processing {filename}: {str(e)}",
        }


def update_snapshot_with_master_map(snapshot_dir, snapshot_label, master_map):
    """
    Update all supported snapshot CSVs using the master identity/details map.

    Returns aggregate stats across files.
    """
    totals = {
        "status": "success",
        "rows_processed": 0,
        "identities_filled": 0,
        "details_filled": 0,
        "details": "",
    }

    file_summaries = []
    has_success = False
    for filename in TARGET_FILES:
        result = update_snapshot_csv_with_master_map(snapshot_dir, snapshot_label, master_map, filename)
        if result["status"] == "error":
            totals["status"] = "error"
            file_summaries.append(f"{filename}: {result['details']}")
            continue
        if result["status"] == "success":
            has_success = True
            totals["rows_processed"] += result["rows_processed"]
            totals["identities_filled"] += result["identities_filled"]
            totals["details_filled"] += result["details_filled"]
            file_summaries.append(
                f"{filename}: {result['rows_processed']} rows"
            )
        else:
            file_summaries.append(f"{filename}: skipped")

    if totals["status"] != "error" and not has_success:
        totals["status"] = "skipped"

    totals["details"] = "; ".join(file_summaries)
    return totals


def main():
    """Main execution."""
    # Parse block heights from arguments, or use all (active + archived) if none provided
    if len(sys.argv) == 1:
        targets = list_snapshot_targets(include_archived=True)
    else:
        snapshot_heights = []
        for arg in sys.argv[1:]:
            if ":" in arg:
                # Range format: start:end
                try:
                    start, end = map(int, arg.split(":"))
                    snapshot_heights.extend(range(start, end + 1))
                except ValueError:
                    print(f"Invalid range format: {arg}")
                    sys.exit(1)
            else:
                # Single height
                try:
                    snapshot_heights.append(int(arg))
                except ValueError:
                    print(f"Invalid block height: {arg}")
                    sys.exit(1)

        requested_heights = sorted(set(snapshot_heights))
        targets = list_snapshot_targets_for_heights(requested_heights)

    print(f"=== Filling Identity & Details in {len(targets)} Snapshot Targets ===\n")
    
    # Load master map from all ge1_btc CSVs
    print("Building master identity/details map from all snapshots...")
    master_map = load_all_ge1_btc_data()
    print(f"  Found {len(master_map)} unique display_group_ids with identity/details\n")
    
    # Update each snapshot
    print("=== Processing Snapshots ===")
    results = {}
    success_count = 0
    total_filled = 0

    for height, snapshot_dir, location in targets:
        label = f"{location}/{height}" if location == "archived" else str(height)
        result = update_snapshot_with_master_map(snapshot_dir, label, master_map)
        results[label] = result
        
        status_symbol = {
            "success": "✓",
            "skipped": "⊘",
            "error": "✗",
        }.get(result["status"], "?")
        
        print(f"  {status_symbol} {label}: {result['details']}")
        
        if result["status"] == "success":
            success_count += 1
            filled_count = result["identities_filled"] + result["details_filled"]
            if filled_count > 0:
                details = []
                if result["identities_filled"]:
                    details.append(f"filled {result['identities_filled']} identities")
                if result["details_filled"]:
                    details.append(f"filled {result['details_filled']} details")
                print(f"      → {', '.join(details)}")
                total_filled += filled_count
    
    # Summary
    print(f"\n=== Summary ===")
    print(f"  Total processed: {success_count}/{len(targets)}")
    print(f"  Total fields filled: {total_filled}")

    if success_count == len(targets):
        print("\n✓ Fill completed successfully!")
        return 0
    else:
        print(f"\n⚠ Fill completed with {len(targets) - success_count} skipped/error(s)")
        return 1


def list_snapshot_targets(include_archived=True):
    """Return sorted snapshot targets as (height, dir_path, location)."""
    targets = []

    for snapshot_dir in WEBAPP_DATA_DIR.iterdir():
        if not snapshot_dir.is_dir() or not snapshot_dir.name.isdigit():
            continue
        targets.append((int(snapshot_dir.name), snapshot_dir, "active"))

    if include_archived and ARCHIVED_DATA_DIR.exists() and ARCHIVED_DATA_DIR.is_dir():
        for snapshot_dir in ARCHIVED_DATA_DIR.iterdir():
            if not snapshot_dir.is_dir() or not snapshot_dir.name.isdigit():
                continue
            targets.append((int(snapshot_dir.name), snapshot_dir, "archived"))

    targets.sort(key=lambda item: (item[0], item[2]))
    return targets


def list_snapshot_targets_for_heights(snapshot_heights):
    """Resolve requested heights to active/archived snapshot directory targets."""
    requested = set(snapshot_heights)
    targets = [item for item in list_snapshot_targets(include_archived=True) if item[0] in requested]
    targets.sort(key=lambda item: (item[0], item[2]))
    return targets


if __name__ == "__main__":
    sys.exit(main())
