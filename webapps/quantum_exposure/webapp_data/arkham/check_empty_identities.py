#!/usr/bin/env python3
"""Quick check: count empty identity rows in each merge-target CSV."""

import csv
from pathlib import Path
from arkham_entity_search import (
    list_merge_target_csvs,
    MISSING_IDENTITY_VALUES,
    SCRIPT_DIR,
)

DATA_DIR = SCRIPT_DIR.parent

def count_missing_identities_in_csv(csv_path: Path) -> int:
    if not csv_path.exists():
        return -1
    
    count = 0
    with csv_path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            identity = (row.get("identity") or "").strip().lower()
            if identity in MISSING_IDENTITY_VALUES:
                count += 1
    
    return count

merge_target_csvs = list_merge_target_csvs(DATA_DIR)

print(f"Checking {len(merge_target_csvs)} merge-target CSVs for empty identities...\n")
print(f"{'Height':<12} {'File':<40} {'Missing Identities':>20}")
print("-" * 75)

total_missing_rows = 0
all_missing_addresses = set()

for csv_path in merge_target_csvs:
    height = csv_path.parent.name
    filename = csv_path.name
    missing_count = count_missing_identities_in_csv(csv_path)
    
    if missing_count >= 0:
        total_missing_rows += missing_count

        # Also collect the actual addresses with missing identities
        if csv_path.exists():
            with csv_path.open(newline="", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    identity = (row.get("identity") or "").strip().lower()
                    if identity in MISSING_IDENTITY_VALUES:
                        # Extract the first token from display_group_ids as the address key
                        display_group_ids = row.get("display_group_ids") or ""
                        tokens = [t.strip() for t in display_group_ids.split("|") if t.strip()]
                        if tokens:
                            all_missing_addresses.add(tokens[0])

        print(f"{height:<12} {filename:<40} {missing_count:>20,}")
    else:
        print(f"{height:<12} {filename:<40} {'[not found]':>20}")

print("-" * 75)
print(f"{'TOTAL ROWS':<12} {'':<40} {total_missing_rows:>20,}")
print(f"{'DISTINCT ADDRESSES':<12} {'':<40} {len(all_missing_addresses):>20,}")
