# clean_new_webapp_data.py

Script to clean newly added `webapp_data` CSVs for the Quantum Exposure dashboard.

## Purpose

When new block height snapshots are added to `webapp_data/`, their CSV files may contain:
- Unwanted/legacy columns that should be removed
- Identity labels that need normalization
- Inconsistencies with existing CSV files

This script automates the cleanup process to ensure all CSVs follow the canonical structure and labeling conventions.

## What It Does

1. **Removes unwanted columns** (if present):
   - `group_id` (normalized to `display_group_ids`)
   - `display_group_id` (normalized to `display_group_ids`)
   - `script_types`
   - `exposed_supply_sats` (present in aggregates, not ge1_btc)
   - `first_exposed_time` / `last_exposed_time` (should be blockheights)

2. **Normalizes column names**:
   - Converts old column names to canonical names
   - Ensures all canonical columns are present in correct order

3. **Cleans identity labels** using established patterns:
   - Removes parenthetical content: `"Entity (USA)"` → `"Entity"`
   - Normalizes abbreviations: `"Management"` → `"Mgmt"`, `"Lbank"` → `"LBank"`
   - Strips repeated suffixes: `"Exchange"`, `"Deposit"`, `"Custody"`, `"Inflows"`
   - Handles special values: `"CoinJoin Address"` → `"unidentified"`, `"Satoshi Nakamoto"` → `"Miner"`
   - Collapses whitespace

4. **Validates consistency**:
   - Verifies all columns are canonical
   - Confirms no unwanted columns remain
   - Checks against reference identity values from existing CSVs

## Canonical Structure

The cleaned CSV files will have exactly these columns in this order:

```
display_group_ids
exposed_supply_sats_by_script_type
spend_activity
exposed_utxo_count
first_exposed_blockheight
last_spend_blockheight
details
identity
```

## Usage

### Clean a single snapshot:
```bash
python3 clean_new_webapp_data.py 943974
```

### Clean multiple specific snapshots:
```bash
python3 clean_new_webapp_data.py 943974 943100 942500
```

### Clean a range of snapshots:
```bash
python3 clean_new_webapp_data.py 943000:943974
```

### Combine ranges and individual snapshots:
```bash
python3 clean_new_webapp_data.py 943000:943100 943974 942500:942600
```

## Output

The script reports:

- **✓ Success**: How many rows were processed and what was cleaned
- **⊘ Skipped**: Snapshots with no ge1_btc CSV file
- **✗ Error**: Any processing errors

Example output:
```
=== Cleaning 3 Snapshots ===

Loading reference identities from existing CSVs...
  Found 348 unique identities

=== Processing Snapshots ===
  ✓ 943974: Cleaned 150113 rows
      Removed columns: script_types, exposed_supply_sats
      Cleaned 42 identity labels
  ✓ 943100: Cleaned 45000 rows
  ⊘ 942500: No ge1_btc CSV at 942500

=== Validating Consistency ===
  ✓ All snapshots are consistent!

=== Summary ===
  Total processed: 2/3
  Validation issues: 0

✓ Cleanup completed successfully!
```

## Exit Codes

- **0**: Success (all processed cleanly with no validation issues)
- **1**: One or more validation issues found

## Files Modified

The script modifies in-place:
```
webapp_data/[blockheight]/dashboard_pubkeys_ge_1btc.csv
```

The modifications are:
- Removed unwanted columns
- Reordered columns to canonical order
- Normalized identity labels
- Preserved all meaningful data

## Integration with Build Pipeline

After adding new snapshots to `webapp_data/`, run:
```bash
python3 webapps/quantum_exposure/pipeline/clean_new_webapp_data.py [new_blockheights]
```

Then regenerate derived files:
```bash
python3 webapps/quantum_exposure/pipeline/generate_eco_files.py
```

This ensures:
1. Raw ge1_btc files are clean and consistent
2. Top 50 files are generated with correct columns
3. historical_lite.csv is updated with new snapshots

## Troubleshooting

**"No ge1_btc CSV at [height]"**
- The snapshot directory exists but `dashboard_pubkeys_ge_1btc.csv` is missing
- Check the snapshot was fully downloaded/generated

**"Extra columns: ..."**
- Validation found columns that shouldn't be in the final CSV
- Rerun the script; it should have removed them
- If not removed, check for read/write permission issues

**"Unknown identities: ..."**
- New identity values were found that aren't in other ge1_btc files
- This is normal for new data; the identities are preserved
- They'll be added to the reference set for future validation

## Implementation Notes

- The script uses the same `clean_identity_label()` function logic as `arkham_entity_search.py`
- Reference identities are built from all existing ge1_btc CSVs at runtime
- Column normalization handles both old and new column naming conventions
- All file I/O is UTF-8 encoded
- CSV fields are preserved exactly; no data transformation except column removal
