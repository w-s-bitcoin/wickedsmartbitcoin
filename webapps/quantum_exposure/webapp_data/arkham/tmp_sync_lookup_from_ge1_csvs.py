import argparse
import csv
import json
from pathlib import Path

from arkham_entity_search import (
    DATA_DIR,
    LOOKUP_JSON_FILE,
    build_lookup_entry,
    clean_identity_label,
    is_keyhash20,
    is_probable_btc_address,
    normalize_lookup_entry,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Sync Arkham BTC identity lookup JSON from ge1 BTC CSV identities"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview lookup updates without writing the JSON file",
    )
    return parser.parse_args()


def list_snapshot_csvs(data_dir: Path) -> list[Path]:
    snapshot_csvs = []
    for csv_path in data_dir.rglob("dashboard_pubkeys_ge_1btc.csv"):
        parent_name = csv_path.parent.name
        if not parent_name.isdigit():
            continue
        snapshot_csvs.append(csv_path)

    # Prefer older snapshots first so curated historical labels win if snapshots disagree.
    snapshot_csvs.sort(
        key=lambda p: (
            int(p.parent.name),
            1 if "archived" not in p.parts else 0,
            str(p),
        )
    )
    return snapshot_csvs


def load_lookup(path: Path) -> dict[str, dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"Expected JSON object in {path}")
    return {address: normalize_lookup_entry(address, entry) for address, entry in data.items()}


def collect_csv_identities(snapshot_csvs: list[Path]) -> tuple[dict[str, dict], int]:
    csv_identities: dict[str, dict] = {}
    conflicts = 0

    for csv_path in snapshot_csvs:
        snapshot_height = int(csv_path.parent.name)
        for row in csv.DictReader(csv_path.open(newline="", encoding="utf-8")):
            identity = clean_identity_label(row.get("identity") or "")
            if not identity or identity.lower() == "unidentified":
                continue

            display_group_ids = row.get("display_group_ids") or ""
            for token in (item.strip() for item in display_group_ids.split("|") if item.strip()):
                if is_keyhash20(token) or not is_probable_btc_address(token):
                    continue

                existing = csv_identities.get(token)
                if existing is None:
                    csv_identities[token] = {
                        "identity": identity,
                        "snapshot_height": snapshot_height,
                        "source_csv": str(csv_path.relative_to(DATA_DIR)),
                    }
                    continue

                if existing["identity"] != identity:
                    conflicts += 1

    return csv_identities, conflicts


def sync_lookup(lookup: dict[str, dict], csv_identities: dict[str, dict]) -> tuple[int, int, int]:
    updated = 0
    added = 0
    unchanged = 0

    for address, csv_entry in csv_identities.items():
        desired_identity = csv_entry["identity"]
        existing = lookup.get(address)
        current_identity = clean_identity_label((existing or {}).get("identity") or "")

        if current_identity == desired_identity:
            unchanged += 1
            continue

        if existing is None:
            added += 1
        else:
            updated += 1

        lookup[address] = build_lookup_entry(desired_identity, "ge1_csv_sync")

    return updated, added, unchanged


def write_lookup(path: Path, lookup: dict[str, dict]) -> None:
    ordered_lookup = {address: normalize_lookup_entry(address, lookup[address]) for address in sorted(lookup)}
    path.write_text(json.dumps(ordered_lookup, indent=2), encoding="utf-8")


def main() -> None:
    args = parse_args()
    snapshot_csvs = list_snapshot_csvs(DATA_DIR)
    lookup = load_lookup(LOOKUP_JSON_FILE)
    csv_identities, conflicts = collect_csv_identities(snapshot_csvs)
    updated, added, unchanged = sync_lookup(lookup, csv_identities)

    print(f"snapshot CSVs scanned       : {len(snapshot_csvs):,}")
    print(f"csv identities found       : {len(csv_identities):,}")
    print(f"csv identity conflicts     : {conflicts:,}")
    print(f"lookup entries updated     : {updated:,}")
    print(f"lookup entries added       : {added:,}")
    print(f"lookup entries unchanged   : {unchanged:,}")

    if args.dry_run:
        print("[dry-run] lookup JSON was not modified")
        return

    write_lookup(LOOKUP_JSON_FILE, lookup)
    print(f"saved lookup JSON          : {LOOKUP_JSON_FILE}")


if __name__ == "__main__":
    main()