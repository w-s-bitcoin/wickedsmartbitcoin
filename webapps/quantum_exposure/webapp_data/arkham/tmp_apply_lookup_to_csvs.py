import argparse

from arkham_entity_search import (
    DATA_DIR,
    GE1_CSV_NAME,
    LOOKUP_JSON_FILE,
    TOP100_CSV_NAME,
    list_snapshot_csvs,
    load_existing_lookup,
    merge_lookup_into_snapshots,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Apply Arkham lookup identities to ge1 and top100 CSVs without API calls"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview row updates without writing CSV files",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    lookup = load_existing_lookup(LOOKUP_JSON_FILE)

    ge1_csvs = list_snapshot_csvs(DATA_DIR, GE1_CSV_NAME)
    top100_csvs = list_snapshot_csvs(DATA_DIR, TOP100_CSV_NAME)
    merge_targets = ge1_csvs + [p for p in top100_csvs if p not in set(ge1_csvs)]

    print(f"lookup entries loaded      : {len(lookup):,}")
    print(f"merge target CSVs         : {len(merge_targets):,}")
    print(f"dry run mode              : {'yes' if args.dry_run else 'no'}")

    merge_lookup_into_snapshots(lookup, merge_targets, dry_run=args.dry_run)


if __name__ == "__main__":
    main()