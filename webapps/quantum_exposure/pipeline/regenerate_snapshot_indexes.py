#!/usr/bin/env python3
"""
Generate ECO mode optimized files for Quantum Exposure dashboard:
1. Top 100 CSV files for fast initial load
2. Rebuild historical_eco.csv from current snapshots
"""

import json
import csv
import io
from pathlib import Path
from pipeline_paths import QUANTUM_DIR

QUANTUM_EXPOSURE_DIR = QUANTUM_DIR
WEBAPP_DATA_DIR = QUANTUM_EXPOSURE_DIR / "webapp_data"

# Fields for historical_eco.csv
HISTORICAL_ECO_FIELDNAMES = [
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

ECO_TOP_N = 100
ECO_TOP_FILENAME = f"dashboard_pubkeys_ge_1btc_top{ECO_TOP_N}.csv"

# Extra columns added to ECO subset CSVs for fast tooltip rendering
# (avoids loading the large lookup CSV during initial render).
ECO_EXTRA_COLUMNS = ["first_exposed_unix_time", "last_spend_unix_time"]


def get_exposed_supply(row):
    """Extract total exposed supply from the JSON column."""
    try:
        data = json.loads(row.get("exposed_supply_sats_by_script_type", "{}"))
        return sum(data.values())
    except (json.JSONDecodeError, TypeError):
        return 0


def serialize_csv_rows(fieldnames, rows):
    """Serialize CSV rows to a string for stable write-if-changed comparisons."""
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    return buffer.getvalue()


def write_text_if_changed(path, content):
    """Write text only when content differs from the existing file."""
    if path.exists():
        try:
            with open(path, "r", encoding="utf-8", newline="") as f:
                existing = f.read()
            if existing == content:
                return False
        except Exception:
            pass

    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(content)
    return True


def load_blockheight_datetime_lookup():
    """Load blockheight_datetime_lookup.csv into a {str(height): str(unix_time)} dict."""
    lookup_path = WEBAPP_DATA_DIR / "blockheight_datetime_lookup.csv"
    if not lookup_path.exists():
        print("  ⚠ blockheight_datetime_lookup.csv not found — unix times will be empty in ECO subset files")
        return {}

    lookup = {}
    try:
        with open(lookup_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                height = str(row.get("blockheight", "")).strip()
                unix_time = str(row.get("unix_time", "")).strip()
                if height and unix_time:
                    lookup[height] = unix_time
        print(f"  Loaded {len(lookup):,} blockheight→unix_time entries")
    except Exception as e:
        print(f"  ✗ Error loading blockheight_datetime_lookup.csv: {e}")
    return lookup


def enhance_ge1_csv_with_unix_times(ge1_csv_path, lookup_by_height=None):
    """Add unix_time columns to the full ge_1btc CSV using blockheight lookup.
    
    Returns True if file was modified, False if unchanged, None on error.
    """
    if not ge1_csv_path.exists():
        return None

    try:
        with open(ge1_csv_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            fieldnames = list(reader.fieldnames or [])
            rows = list(reader)

        if not rows:
            return False

        # Check if columns already exist
        has_unix_times = "first_exposed_unix_time" in fieldnames and "last_spend_unix_time" in fieldnames
        if has_unix_times:
            return False  # Already enhanced

        # Add unix times from lookup if available
        if lookup_by_height:
            for r in rows:
                first_h = str(r.get("first_exposed_blockheight", "")).strip()
                last_h = str(r.get("last_spend_blockheight", "")).strip()
                r["first_exposed_unix_time"] = lookup_by_height.get(first_h, "")
                r["last_spend_unix_time"] = lookup_by_height.get(last_h, "") if last_h else ""

        # Extend fieldnames with extra columns (if not already present).
        extra_cols = [c for c in ECO_EXTRA_COLUMNS if c not in fieldnames]
        enhanced_fieldnames = fieldnames + extra_cols
        enhanced_content = serialize_csv_rows(enhanced_fieldnames, rows)

        if write_text_if_changed(ge1_csv_path, enhanced_content):
            return True
        return False
    except Exception as e:
        print(f"    ✗ Error enhancing {ge1_csv_path.name}: {e}")
        return None


def generate_eco_subset_for_snapshot(snapshot_dir, lookup_by_height=None):
    """Generate the ECO subset CSV for a single snapshot directory.

    The file is regenerated only when the source ge1 CSV is newer or the ECO
    subset file does not exist. Writes are skipped if the serialized CSV content
    is unchanged.
    """
    ge1_csv_path = snapshot_dir / "dashboard_pubkeys_ge_1btc.csv"
    eco_subset_csv_path = snapshot_dir / ECO_TOP_FILENAME

    if not ge1_csv_path.exists():
        return None

    if eco_subset_csv_path.exists():
        source_mtime = ge1_csv_path.stat().st_mtime_ns
        target_mtime = eco_subset_csv_path.stat().st_mtime_ns
        if source_mtime <= target_mtime:
            return {"status": "skipped", "reason": "up_to_date"}

    try:
        with open(ge1_csv_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            rows = list(reader)

        if not rows:
            return None

        # Sort by exposed supply descending
        rows_sorted = sorted(rows, key=lambda r: get_exposed_supply(r), reverse=True)
        eco_rows = rows_sorted[:ECO_TOP_N]

        if eco_rows:
            # Embed unix times for fast tooltip rendering in ECO mode.
            if lookup_by_height:
                for r in eco_rows:
                    first_h = str(r.get("first_exposed_blockheight", "")).strip()
                    last_h = str(r.get("last_spend_blockheight", "")).strip()
                    r["first_exposed_unix_time"] = lookup_by_height.get(first_h, "")
                    r["last_spend_unix_time"] = lookup_by_height.get(last_h, "") if last_h else ""

            # Extend fieldnames with extra columns (if not already present).
            base_fieldnames = list(reader.fieldnames)
            extra_cols = [c for c in ECO_EXTRA_COLUMNS if c not in base_fieldnames]
            eco_fieldnames = base_fieldnames + extra_cols
            eco_content = serialize_csv_rows(eco_fieldnames, eco_rows)

            if not write_text_if_changed(eco_subset_csv_path, eco_content):
                return {"status": "unchanged", "count": len(eco_rows), "total": len(rows)}

            total_rows = len(rows)
            return {"status": "generated", "count": len(eco_rows), "total": total_rows}
        return None
    except Exception as e:
        return {"status": "error", "error": str(e)}


def get_snapshot_time_from_meta(snapshot_dir):
    """Read snapshot_time from dashboard_snapshot_meta.csv, or '' if not available."""
    meta_path = snapshot_dir / "dashboard_snapshot_meta.csv"
    if not meta_path.exists():
        return ""
    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                return str(row.get("snapshot_time", "")).strip()
    except Exception:
        pass
    return ""


def write_snapshots_index(snapshot_dirs, lookup_by_height=None):
    """Write snapshots_index.csv with snapshot_blockheight and snapshot_time columns.

    snapshot_time lets the dashboard populate dropdown labels immediately without
    loading any per-snapshot meta CSVs or the large blockheight_datetime_lookup.csv.
    """
    snapshots_index_path = WEBAPP_DATA_DIR / "snapshots_index.csv"

    rows = []
    for snapshot_dir in sorted(snapshot_dirs, key=lambda d: int(d.name), reverse=True):
        snapshot_height = get_snapshot_height(snapshot_dir)
        if snapshot_height is None:
            continue

        # Prefer snapshot_time from the per-snapshot meta CSV.
        snapshot_time = get_snapshot_time_from_meta(snapshot_dir)

        # Fall back to the global lookup CSV if meta is missing.
        if not snapshot_time and lookup_by_height:
            snapshot_time = lookup_by_height.get(str(snapshot_height), "")

        rows.append({
            "snapshot_blockheight": str(snapshot_height),
            "snapshot_time": snapshot_time,
        })

    try:
        content = serialize_csv_rows(["snapshot_blockheight", "snapshot_time"], rows)
        if write_text_if_changed(snapshots_index_path, content):
            print(f"  ✓ Written {len(rows)} snapshots to snapshots_index.csv")
        else:
            print(f"  ⊘ snapshots_index.csv unchanged ({len(rows)} snapshots)")
    except Exception as e:
        print(f"  ✗ Error writing snapshots_index.csv: {e}")


def write_archived_index(lookup_by_height=None):
    """Write archived_index.csv with snapshot_blockheight and snapshot_time for archived snapshots."""
    archived_dir = WEBAPP_DATA_DIR / "archived"
    archived_index_path = WEBAPP_DATA_DIR / "archived_index.csv"

    if not archived_dir.exists() or not archived_dir.is_dir():
        print("  ⊘ No archived/ directory found; skipping archived_index.csv")
        return

    archived_dirs = sorted(
        [d for d in archived_dir.iterdir() if d.is_dir() and d.name.isdigit()],
        key=lambda d: int(d.name),
        reverse=True,
    )

    if not archived_dirs:
        print("  ⊘ No archived snapshot directories found; skipping archived_index.csv")
        return

    rows = []
    for snapshot_dir in archived_dirs:
        snapshot_height = get_snapshot_height(snapshot_dir)
        if snapshot_height is None:
            continue

        snapshot_time = get_snapshot_time_from_meta(snapshot_dir)

        if not snapshot_time and lookup_by_height:
            snapshot_time = lookup_by_height.get(str(snapshot_height), "")

        rows.append({
            "snapshot_blockheight": str(snapshot_height),
            "snapshot_time": snapshot_time,
        })

    try:
        content = serialize_csv_rows(["snapshot_blockheight", "snapshot_time"], rows)
        if write_text_if_changed(archived_index_path, content):
            print(f"  ✓ Written {len(rows)} snapshots to archived_index.csv")
        else:
            print(f"  ⊘ archived_index.csv unchanged ({len(rows)} snapshots)")
    except Exception as e:
        print(f"  ✗ Error writing archived_index.csv: {e}")


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


def generate_historical_eco_rows(snapshot_height, aggregates_rows):
    """Generate historical_eco.csv rows for a snapshot."""
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


def rebuild_historical_eco(all_rows, output_path=None):
    """Fully rebuild historical_eco.csv (or a given path) from provided rows."""
    if output_path is None:
        output_path = WEBAPP_DATA_DIR / "historical_eco.csv"

    try:
        rows_sorted = list(all_rows)
        rows_sorted.sort(
            key=lambda r: (int(r.get("snapshot", 0)), r.get("balance_filter", ""))
        )

        content = serialize_csv_rows(HISTORICAL_ECO_FIELDNAMES, rows_sorted)
        if write_text_if_changed(output_path, content):
            return {"status": "written", "rows": len(rows_sorted)}
        return {"status": "unchanged", "rows": len(rows_sorted)}
    except Exception as e:
        print(f"  ✗ Error writing to {output_path.name}: {e}")
        return {"status": "error", "rows": 0}


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

    # Phase 0: Load blockheight datetime lookup for unix time embedding
    print("=== Loading Blockheight Datetime Lookup ===")
    lookup_by_height = load_blockheight_datetime_lookup()

    # Phase 0b: Enhance full ge_1btc CSV files with unix_time columns for FULL mode tooltip rendering
    print(f"\n=== Enhancing Full dashboard_pubkeys_ge_1btc.csv Files ===")
    full_enhanced_count = 0
    full_unchanged_count = 0
    for snapshot_dir in snapshot_dirs:
        ge1_path = snapshot_dir / "dashboard_pubkeys_ge_1btc.csv"
        result = enhance_ge1_csv_with_unix_times(ge1_path, lookup_by_height)
        if result is True:
            print(f"  ✓ {snapshot_dir.name}: Added unix_time columns")
            full_enhanced_count += 1
        elif result is False:
            print(f"  ⊘ {snapshot_dir.name}: Already has unix_time columns or no changes needed")
            full_unchanged_count += 1

    # Phase 0c: Enhance archived ge_1btc CSV files
    archived_dir = WEBAPP_DATA_DIR / "archived"
    archived_full_enhanced_count = 0
    archived_full_unchanged_count = 0
    if archived_dir.exists() and archived_dir.is_dir():
        archived_snapshot_dirs_phase0c = sorted(
            [d for d in archived_dir.iterdir() if d.is_dir() and d.name.isdigit()],
            key=lambda x: int(x.name),
        )
        if archived_snapshot_dirs_phase0c:
            print(f"\n=== Enhancing Full dashboard_pubkeys_ge_1btc.csv Files (Archived) ===")
            for snapshot_dir in archived_snapshot_dirs_phase0c:
                ge1_path = snapshot_dir / "dashboard_pubkeys_ge_1btc.csv"
                result = enhance_ge1_csv_with_unix_times(ge1_path, lookup_by_height)
                if result is True:
                    print(f"  ✓ archived/{snapshot_dir.name}: Added unix_time columns")
                    archived_full_enhanced_count += 1
                elif result is False:
                    print(f"  ⊘ archived/{snapshot_dir.name}: Already has unix_time columns or no changes needed")
                    archived_full_unchanged_count += 1

    # Phase 1: Generate ECO subset CSV files (with embedded unix times)
    print(f"\n=== Generating Top {ECO_TOP_N} CSV Files ===")
    eco_generated_count = 0
    eco_skipped_count = 0
    eco_unchanged_count = 0
    for snapshot_dir in snapshot_dirs:
        result = generate_eco_subset_for_snapshot(snapshot_dir, lookup_by_height)
        if result:
            if result.get("status") == "generated":
                print(
                    f"  ✓ {snapshot_dir.name}: {result['count']} / {result['total']} rows"
                )
                eco_generated_count += 1
            elif result.get("status") == "skipped":
                print(f"  ⊘ {snapshot_dir.name}: ECO subset up-to-date")
                eco_skipped_count += 1
            elif result.get("status") == "unchanged":
                print(f"  ⊘ {snapshot_dir.name}: ECO subset content unchanged")
                eco_unchanged_count += 1
            elif result.get("status") == "error":
                print(f"  ✗ {snapshot_dir.name}: {result['error']}")
        else:
            print(f"  ⊘ {snapshot_dir.name}: Skipped (no data)")

    # Phase 1b: Generate ECO subset CSV files for archived snapshots
    archived_dir = WEBAPP_DATA_DIR / "archived"
    archived_snapshot_dirs = []
    if archived_dir.exists() and archived_dir.is_dir():
        archived_snapshot_dirs = sorted(
            [d for d in archived_dir.iterdir() if d.is_dir() and d.name.isdigit()],
            key=lambda x: int(x.name),
        )

    if archived_snapshot_dirs:
        print(f"\n=== Generating Top {ECO_TOP_N} CSV Files (Archived) ===")
        archived_eco_generated_count = 0
        archived_eco_skipped_count = 0
        archived_eco_unchanged_count = 0
        for snapshot_dir in archived_snapshot_dirs:
            result = generate_eco_subset_for_snapshot(snapshot_dir, lookup_by_height)
            if result:
                if result.get("status") == "generated":
                    print(
                        f"  ✓ archived/{snapshot_dir.name}: {result['count']} / {result['total']} rows"
                    )
                    archived_eco_generated_count += 1
                elif result.get("status") == "skipped":
                    print(f"  ⊘ archived/{snapshot_dir.name}: ECO subset up-to-date")
                    archived_eco_skipped_count += 1
                elif result.get("status") == "unchanged":
                    print(f"  ⊘ archived/{snapshot_dir.name}: ECO subset content unchanged")
                    archived_eco_unchanged_count += 1
                elif result.get("status") == "error":
                    print(f"  ✗ archived/{snapshot_dir.name}: {result['error']}")
            else:
                print(f"  ⊘ archived/{snapshot_dir.name}: Skipped (no data)")

    # Phase 2: Rebuild historical_eco.csv from current snapshots only
    print("\n=== Rebuilding historical_eco.csv ===")
    included_snapshots = []
    historical_rows_all = []

    for snapshot_dir in snapshot_dirs:
        snapshot_height = get_snapshot_height(snapshot_dir)
        if snapshot_height is None:
            continue

        aggregates = load_aggregates_for_snapshot(snapshot_dir)
        if aggregates:
            rows = generate_historical_eco_rows(snapshot_height, aggregates)
            if rows:
                included_snapshots.append(snapshot_height)
                historical_rows_all.extend(rows)

    historical_result = rebuild_historical_eco(historical_rows_all)
    if historical_result["status"] == "written":
        print(
            f"  ✓ Rebuilt historical_eco.csv using {len(included_snapshots)} snapshots "
            f"({historical_result['rows']} rows)"
        )
    elif historical_result["status"] == "unchanged":
        print(
            f"  ⊘ historical_eco.csv unchanged "
            f"({len(included_snapshots)} snapshots, {historical_result['rows']} rows)"
        )

    # Phase 2b: Rebuild historical_archived.csv from archived snapshots
    print("\n=== Rebuilding historical_archived.csv ===")
    archived_dir = WEBAPP_DATA_DIR / "archived"
    archived_snapshot_dirs = []
    if archived_dir.exists() and archived_dir.is_dir():
        archived_snapshot_dirs = sorted(
            [d for d in archived_dir.iterdir() if d.is_dir() and d.name.isdigit()],
            key=lambda x: int(x.name),
        )

    included_archived_snapshots = []
    historical_archived_rows = []
    for snapshot_dir in archived_snapshot_dirs:
        snapshot_height = get_snapshot_height(snapshot_dir)
        if snapshot_height is None:
            continue
        aggregates = load_aggregates_for_snapshot(snapshot_dir)
        if aggregates:
            rows = generate_historical_eco_rows(snapshot_height, aggregates)
            if rows:
                included_archived_snapshots.append(snapshot_height)
                historical_archived_rows.extend(rows)

    if included_archived_snapshots:
        archived_result = rebuild_historical_eco(
            historical_archived_rows,
            output_path=WEBAPP_DATA_DIR / "historical_archived.csv",
        )
        if archived_result["status"] == "written":
            print(
                f"  ✓ Rebuilt historical_archived.csv using {len(included_archived_snapshots)} snapshots "
                f"({archived_result['rows']} rows)"
            )
        elif archived_result["status"] == "unchanged":
            print(
                f"  ⊘ historical_archived.csv unchanged "
                f"({len(included_archived_snapshots)} snapshots, {archived_result['rows']} rows)"
            )
    else:
        print("  ⊘ No archived snapshots found; skipping historical_archived.csv")

    # Phase 3: Regenerate snapshots_index.csv with snapshot_time column
    print("\n=== Updating snapshots_index.csv ===")
    write_snapshots_index(snapshot_dirs, lookup_by_height)

    # Phase 4: Regenerate archived_index.csv for archived snapshots
    print("\n=== Updating archived_index.csv ===")
    write_archived_index(lookup_by_height)

    # Summary
    print(
        f"\n✅ Complete!"
    )
    print(f"  Generated top_{ECO_TOP_N} files: {eco_generated_count}")
    print(f"  Skipped top_{ECO_TOP_N} files: {eco_skipped_count}")
    print(f"  Unchanged top_{ECO_TOP_N} files: {eco_unchanged_count}")
    print(f"  Historical eco snapshots: {len(included_snapshots)}")


if __name__ == "__main__":
    main()
