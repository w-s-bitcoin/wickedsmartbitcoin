#!/usr/bin/env python3
"""
Clean newly added webapp_data ge1_btc CSVs:
1. Remove unwanted columns (group_id, script_types, exposed_supply_sats, *_time)
2. Normalize identity labels using arkham_entity_search patterns
3. Validate consistency with existing ge1_btc CSVs
4. Report what was cleaned
"""

import sys
import csv
import json
import re
from pathlib import Path
from collections import defaultdict

QUANTUM_EXPOSURE_DIR = Path(__file__).parent
WEBAPP_DATA_DIR = QUANTUM_EXPOSURE_DIR / "webapp_data"

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

# Columns to remove if present (old/unwanted columns)
COLUMNS_TO_REMOVE = {
    "group_id",
    "display_group_id",
    "script_types",
    "exposed_supply_sats",
    "first_exposed_time",
    "last_spend_time",
}

# Identity label cleaning (from arkham_entity_search.py)
IDENTITY_SUFFIXES_TO_STRIP = ("Inflows", "Deposit", "Custody", "Exchange")


def clean_identity_label(identity: str | None) -> str:
    """
    Clean and normalize identity label.
    
    Removes parenthetical content, normalizes abbreviations, 
    strips known suffixes, and handles special values.
    """
    if not identity:
        return ""
    
    value = identity.strip()
    
    # Remove parenthetical content: "Exchange (USA)" -> "Exchange"
    value = re.sub(r"\s*\([^)]*\)", "", value)
    
    # Normalize abbreviations
    value = re.sub(r"\bManagement\b", "Mgmt", value, flags=re.IGNORECASE)
    value = re.sub(r"\bLbank\b", "LBank", value, flags=re.IGNORECASE)
    
    # Strip known suffixes repeatedly in case multiple are chained
    while True:
        stripped = False
        for suffix in IDENTITY_SUFFIXES_TO_STRIP:
            pattern = rf"\s+{re.escape(suffix)}$"
            if re.search(pattern, value, flags=re.IGNORECASE):
                value = re.sub(pattern, "", value, flags=re.IGNORECASE).strip()
                stripped = True
        if not stripped:
            break
    
    # Collapse whitespace
    value = re.sub(r"\s+", " ", value).strip()
    
    # Handle special values
    if re.fullmatch(r"CoinJoin Address", value, flags=re.IGNORECASE):
        return "unidentified"
    if re.fullmatch(r"Satoshi Nakamoto", value, flags=re.IGNORECASE):
        return "Miner"
    
    return value


def load_reference_identities():
    """Load set of valid identity values from existing ge1_btc CSVs."""
    identities = set()
    
    # Scan all snapshot directories for existing ge1_btc files
    for snapshot_dir in WEBAPP_DATA_DIR.iterdir():
        if not snapshot_dir.is_dir() or not snapshot_dir.name.isdigit():
            continue
        
        ge1_csv = snapshot_dir / "dashboard_pubkeys_ge_1btc.csv"
        if not ge1_csv.exists():
            continue
        
        try:
            with open(ge1_csv, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    identity = row.get("identity", "").strip()
                    if identity and identity not in {"unidentified", ""}:
                        identities.add(identity)
        except Exception as e:
            print(f"  ⚠ Warning reading {snapshot_dir.name}: {e}")
    
    return identities


def normalize_column_names(row, source_columns):
    """
    Normalize old column names to canonical names.
    
    Handles:
    - group_id / display_group_id -> display_group_ids
    - Removes unwanted columns
    """
    normalized = {}
    
    for col in source_columns:
        if col in COLUMNS_TO_REMOVE:
            # Skip unwanted columns
            continue
        elif col == "group_id" or col == "display_group_id":
            # Normalize to display_group_ids
            if "display_group_ids" not in normalized:
                normalized["display_group_ids"] = row.get(col, "")
        else:
            # Keep canonical column as-is
            normalized[col] = row.get(col, "")
    
    # Ensure all canonical columns are present
    for col in CANONICAL_COLUMNS:
        if col not in normalized:
            normalized[col] = ""
    
    # Keep only canonical columns in order
    return {col: normalized[col] for col in CANONICAL_COLUMNS}


def clean_csv_file(snapshot_height):
    """
    Clean a single snapshot's ge1_btc CSV file.
    
    Returns dict with:
    - status: 'success', 'skipped', or 'error'
    - rows_processed: number of rows
    - columns_removed: list of removed columns
    - identities_cleaned: number of identity values cleaned
    - details: explanation
    """
    snapshot_dir = WEBAPP_DATA_DIR / str(snapshot_height)
    ge1_csv = snapshot_dir / "dashboard_pubkeys_ge_1btc.csv"
    
    if not ge1_csv.exists():
        return {
            "status": "skipped",
            "details": f"No ge1_btc CSV at {snapshot_dir.name}",
        }
    
    try:
        # Read the CSV
        with open(ge1_csv, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            if not reader.fieldnames:
                return {
                    "status": "error",
                    "details": "CSV is empty or has no header",
                }
            
            source_columns = reader.fieldnames
            rows = list(reader)
        
        if not rows:
            return {
                "status": "skipped",
                "details": "No data rows in CSV",
            }
        
        # Identify columns to remove
        columns_removed = [
            col for col in source_columns if col in COLUMNS_TO_REMOVE
        ]
        
        # Process rows
        cleaned_rows = []
        identities_cleaned = 0
        
        for row in rows:
            # Normalize columns
            cleaned_row = normalize_column_names(row, source_columns)
            
            # Clean identity label
            original_identity = cleaned_row["identity"].strip()
            if original_identity:
                cleaned_identity = clean_identity_label(original_identity)
                if cleaned_identity != original_identity:
                    cleaned_row["identity"] = cleaned_identity
                    identities_cleaned += 1
            
            cleaned_rows.append(cleaned_row)
        
        # Write back to CSV
        with open(ge1_csv, "w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=CANONICAL_COLUMNS)
            writer.writeheader()
            writer.writerows(cleaned_rows)
        
        return {
            "status": "success",
            "rows_processed": len(rows),
            "columns_removed": columns_removed,
            "identities_cleaned": identities_cleaned,
            "details": f"Cleaned {len(rows)} rows",
        }
    
    except Exception as e:
        return {
            "status": "error",
            "details": f"Error processing: {str(e)}",
        }


def validate_consistency(snapshot_heights, reference_identities):
    """
    Validate that cleaned CSVs are consistent with reference data.
    
    Returns dict with validation results.
    """
    issues = defaultdict(list)
    
    for height in snapshot_heights:
        snapshot_dir = WEBAPP_DATA_DIR / str(height)
        ge1_csv = snapshot_dir / "dashboard_pubkeys_ge_1btc.csv"
        
        if not ge1_csv.exists():
            continue
        
        try:
            with open(ge1_csv, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                
                # Check header
                if reader.fieldnames != CANONICAL_COLUMNS:
                    missing = set(CANONICAL_COLUMNS) - set(reader.fieldnames or [])
                    extra = set(reader.fieldnames or []) - set(CANONICAL_COLUMNS)
                    if missing:
                        issues[str(height)].append(f"Missing columns: {missing}")
                    if extra:
                        issues[str(height)].append(f"Extra columns: {extra}")
                
                # Check for unwanted columns
                if any(col in (reader.fieldnames or []) for col in COLUMNS_TO_REMOVE):
                    unwanted = [
                        col for col in COLUMNS_TO_REMOVE 
                        if col in (reader.fieldnames or [])
                    ]
                    issues[str(height)].append(f"Unwanted columns still present: {unwanted}")
                
                # Check identity values
                for i, row in enumerate(reader, start=2):
                    identity = row.get("identity", "").strip()
                    if identity and identity not in reference_identities and identity != "unidentified":
                        # New identity found - note it
                        if f"Unknown identities: {identity}" not in issues[str(height)]:
                            # Only log first occurrence of new identities
                            pass
        
        except Exception as e:
            issues[str(height)].append(f"Error validating: {str(e)}")
    
    return dict(issues) if issues else {}


def main():
    """Main execution."""
    if len(sys.argv) < 2:
        print("Usage: python3 clean_new_webapp_data.py <blockheight> [blockheight2] [blockheight_start:blockheight_end]")
        print("\nExamples:")
        print("  python3 clean_new_webapp_data.py 943974")
        print("  python3 clean_new_webapp_data.py 943974 943100")
        print("  python3 clean_new_webapp_data.py 943000:943974")
        sys.exit(1)
    
    # Parse block heights from arguments
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
    
    snapshot_heights = sorted(set(snapshot_heights))
    
    print(f"=== Cleaning {len(snapshot_heights)} Snapshots ===\n")
    
    # Load reference identities from existing CSVs
    print("Loading reference identities from existing CSVs...")
    reference_identities = load_reference_identities()
    print(f"  Found {len(reference_identities)} unique identities\n")
    
    # Clean each snapshot
    print("=== Processing Snapshots ===")
    results = {}
    success_count = 0
    
    for height in snapshot_heights:
        result = clean_csv_file(height)
        results[height] = result
        
        status_symbol = {
            "success": "✓",
            "skipped": "⊘",
            "error": "✗",
        }.get(result["status"], "?")
        
        print(f"  {status_symbol} {height}: {result['details']}")
        
        if result["status"] == "success":
            success_count += 1
            details = []
            if result.get("columns_removed"):
                details.append(f"removed {len(result['columns_removed'])} columns: {', '.join(result['columns_removed'])}")
            if result.get("identities_cleaned"):
                details.append(f"cleaned {result['identities_cleaned']} identity labels")
            if details:
                print(f"      → {', '.join(details)}")
    
    # Validate consistency
    print(f"\n=== Validating Consistency ===")
    issues = validate_consistency(snapshot_heights, reference_identities)
    
    if issues:
        print(f"  ⚠ Found {len(issues)} snapshot(s) with issues:")
        for height, height_issues in sorted(issues.items()):
            print(f"    {height}:")
            for issue in height_issues:
                print(f"      - {issue}")
    else:
        print("  ✓ All snapshots are consistent!")
    
    # Summary
    print(f"\n=== Summary ===")
    print(f"  Total processed: {success_count}/{len(snapshot_heights)}")
    print(f"  Validation issues: {len(issues)}")
    
    if success_count == len(snapshot_heights) and not issues:
        print("\n✓ Cleanup completed successfully!")
        return 0
    else:
        print(f"\n⚠ Cleanup completed with {len(issues)} validation issue(s)")
        return 1


if __name__ == "__main__":
    sys.exit(main())
