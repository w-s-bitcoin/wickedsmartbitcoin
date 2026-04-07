# fill_identity_details.py

Script to cross-match and fill in missing `identity` and `details` values in ge1_btc CSVs across all snapshots.

## Problem It Solves

When the same `display_group_ids` (pubkey/address) appears in multiple block height snapshots, it **should have the same identity and details values**. However, new or updated snapshots may be missing this data even though it exists in other snapshots.

This script:
1. **Builds a master map** of `display_group_ids` → `{identity, details}` from all existing snapshots
2. **Fills in missing values** in each snapshot using data from other snapshots
3. **Ensures consistency** across all snapshots

## How It Works

### Step 1: Build Master Map
Scans all `ge1_btc.csv` files and for each `display_group_ids`, records:
- The first non-empty `identity` value found
- The first non-empty `details` value found

Prefers populated values over empty ones.

### Step 2: Apply to Snapshots
For each snapshot, updates rows where:
- `identity` is empty AND the master map has an identity → fills it in
- `details` is empty AND the master map has details → fills it in

Preserves any explicitly set values (doesn't overwrite).

## Usage

### Fill in missing data for all snapshots:
```bash
python3 fill_identity_details.py
```

### Fill specific snapshots:
```bash
python3 fill_identity_details.py 943974
python3 fill_identity_details.py 943974 942369 900000
python3 fill_identity_details.py 943000:943974
```

## Output

Example output:
```
=== Filling Identity & Details in 21 Snapshots ===

Building master identity/details map from all snapshots...
  Found 236342 unique display_group_ids with identity/details

=== Processing Snapshots ===
  ⊘ 0: No data rows in CSV
  ✓ 50000: Processed 41160 rows
  ✓ 500000: Processed 140788 rows
      → filled 2672 identities
  ✓ 943974: Processed 150113 rows
      → filled 111009 identities

=== Summary ===
  Total processed: 20/21
  Total fields filled: 9172

✓ Fill completed successfully!
```

## Why This Is Important

### Before Running Fill:
- 943974 had 150,113 total rows
- Only ~39,104 rows had identity data (26%)
- 111,009 rows were missing identity labels

### After Running Fill:
- Same 150,113 rows
- Now **111,009 rows have identity data (74%)**
- Cross-referenced from other snapshots (942369, 850000, etc.)
- Remaining 39,104 are genuinely unidentified in all snapshots

This ensures:
- **Consistency**: Same pubkey = same identity across all time periods
- **Completeness**: Best available identity data propagated to all snapshots
- **Auditability**: Only fills empty cells; never overwrites existing values

## Examples of Filled Data

Pubkeys from early Bitcoin blocks now properly identified:
- `04678afd...` → **Patoshi** (likely Satoshi's early mining)
- `0496b538...` → **Patoshi**
- `047211a8...` → **Patoshi**

Exchange addresses properly labeled across all snapshots:
- Binance deposit addresses now identified consistently
- Mining pool addresses consistently tracked
- CoinJoin operators properly labeled

## Integration with Data Pipeline

Typical workflow:

```bash
# 1. Add new snapshot data
# (copy files to webapp_data/[blockheight]/)

# 2. Clean the new data
python3 clean_new_webapp_data.py 943974

# 3. Fill in cross-snapshot identity/details
python3 fill_identity_details.py 943974

# 4. Generate derived files (top 50, historical_lite)
python3 generate_eco_files.py
```

Or to update everything after data changes:
```bash
python3 fill_identity_details.py          # All snapshots
python3 generate_eco_files.py             # Regenerate derived files
```

## Exit Codes

- **0**: Success (all snapshots processed and filled)
- **1**: One or more snapshots skipped or encountered errors

## Technical Notes

- **Non-destructive**: Only fills empty cells; never overwrites
- **Deterministic**: Always prefers first non-empty value found
- **Idempotent**: Running multiple times has same result as running once
- **Fast**: Single pass through all CSVs to build map, then single pass per snapshot
- **Safe**: Original column order and structure preserved
- **UTF-8**: All file I/O uses UTF-8 encoding

## Troubleshooting

**Q: Why do some rows still have no identity?**
A: Those rows are genuinely unidentified - they don't have identity data in any snapshot across the entire dataset.

**Q: Why does running Fill again show 0 fields filled?**
A: Idempotent behavior - all fillable fields were already filled on the first run. Running again won't find any new empty cells to fill.

**Q: Can I use this on a subset of snapshots?**
A: Yes, but the master map is always built from ALL snapshots. The subset argument just limits which snapshots get updated. The fill uses data from all snapshots to fill any specified subset.

**Q: Does this modify identity values that are already set?**
A: No. It only fills in truly empty cells. Any existing value (even `"unidentified"`) is preserved.
