#!/usr/bin/env python3
"""Sync known identity labels into a snapshot without making Arkham API calls.

This mirrors the local pre-query reconciliation in
webapp_data/arkham/arkham_entity_search.py:
1. Build/update the local Arkham lookup from labels already present in snapshots.
2. Merge known lookup labels into the requested snapshot CSVs.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path

from pipeline_paths import QUANTUM_DIR


WEBAPP_DATA_DIR = QUANTUM_DIR / "webapp_data"
ARCHIVED_DATA_DIR = WEBAPP_DATA_DIR / "archived"
ARKHAM_LOOKUP_PATH = WEBAPP_DATA_DIR / "arkham" / "arkham_btc_identity_lookup.json"

GE1_CSV_NAME = "dashboard_pubkeys_ge_1btc.csv"
TOP100_CSV_NAME = "dashboard_pubkeys_ge_1btc_top100.csv"
MISSING_IDENTITY_VALUES = {"", "none", "null", "n/a", "na"}
IDENTITY_SUFFIXES_TO_STRIP = ("Inflows", "Deposit", "Custody", "Exchange")

KEYHASH20_RE = re.compile(r"^[0-9a-fA-F]{40}$")
BASE58_RE = re.compile(r"^[13][a-km-zA-HJ-NP-Z1-9]{25,62}$")
BECH32_RE = re.compile(r"^bc1[ac-hj-np-z02-9]{11,71}$")
COMPRESSED_PUBKEY_RE = re.compile(r"^(02|03)[0-9a-fA-F]{64}$")
UNCOMPRESSED_PUBKEY_RE = re.compile(r"^04[0-9a-fA-F]{128}$")


def is_keyhash20(value: str) -> bool:
    return bool(KEYHASH20_RE.fullmatch(value))


def is_probable_btc_address(value: str) -> bool:
    return bool(BASE58_RE.fullmatch(value) or BECH32_RE.fullmatch(value.lower()))


def is_probable_p2pkh_address(value: str) -> bool:
    return bool(BASE58_RE.fullmatch(value) and value.startswith("1"))


def is_probable_pubkey(value: str) -> bool:
    return bool(COMPRESSED_PUBKEY_RE.fullmatch(value) or UNCOMPRESSED_PUBKEY_RE.fullmatch(value))


def is_dsms_token(value: str) -> bool:
    return value.upper().endswith("(DSMS)")


def select_row_lookup_tokens(display_group_ids: str) -> list[str]:
    btc_tokens = []
    pubkey_tokens = []
    for token in (item.strip() for item in display_group_ids.split("|") if item.strip()):
        if is_dsms_token(token):
            continue
        if is_keyhash20(token):
            continue
        if not is_probable_btc_address(token):
            if is_probable_pubkey(token):
                pubkey_tokens.append(token)
            continue
        btc_tokens.append(token)

    if len(btc_tokens) == 1:
        return btc_tokens

    p2pkh_tokens = [token for token in btc_tokens if is_probable_p2pkh_address(token)]
    if p2pkh_tokens:
        return [p2pkh_tokens[0]]

    if btc_tokens:
        return [btc_tokens[0]]

    if pubkey_tokens:
        return [pubkey_tokens[0]]

    return []


def clean_identity_label(identity: str | None) -> str:
    value = (identity or "").strip()
    if not value:
        return ""

    value = re.sub(r"\s*\([^)]*\)", "", value)
    value = re.sub(r"\bManagement\b", "Mgmt", value, flags=re.IGNORECASE)
    value = re.sub(r"\bLbank\b", "LBank", value, flags=re.IGNORECASE)

    while True:
        stripped = False
        for suffix in IDENTITY_SUFFIXES_TO_STRIP:
            pattern = rf"\s+{re.escape(suffix)}$"
            if re.search(pattern, value, flags=re.IGNORECASE):
                value = re.sub(pattern, "", value, flags=re.IGNORECASE).strip()
                stripped = True
        if not stripped:
            break

    value = re.sub(r"\s+", " ", value).strip()

    if re.fullmatch(r"CoinJoin Address", value, flags=re.IGNORECASE):
        return "unidentified"
    if re.fullmatch(r"Satoshi Nakamoto", value, flags=re.IGNORECASE):
        return "Miner"
    if re.fullmatch(r"Dustin\s+Trammell\s+@druidian", value, flags=re.IGNORECASE):
        return "Dustin Trammell"
    return value


def is_missing_identity(identity: str | None) -> bool:
    return (identity or "").strip().lower() in MISSING_IDENTITY_VALUES


def build_lookup_entry(identity: str | None, identity_source: str | None = None) -> dict:
    cleaned_identity = clean_identity_label(identity)
    stored_identity = cleaned_identity or "unidentified"
    entry = {"identity": stored_identity}
    if stored_identity.lower() != "unidentified":
        cleaned_source = (identity_source or "").strip()
        if cleaned_source:
            entry["identity_source"] = cleaned_source
    return entry


def normalize_lookup_entry(address: str, entry: object) -> dict:
    if isinstance(entry, str):
        return build_lookup_entry(entry)
    if not isinstance(entry, dict):
        raise ValueError(f"Expected lookup entry object for {address}, found {type(entry)}")
    return build_lookup_entry(entry.get("identity"), entry.get("identity_source"))


def load_existing_lookup(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"Expected lookup JSON object in {path}, found {type(data)}")
    return {address: normalize_lookup_entry(address, entry) for address, entry in data.items()}


def write_lookup(path: Path, lookup: dict[str, dict], dry_run: bool) -> None:
    if dry_run:
        print(f"[dry-run] would write lookup JSON with {len(lookup):,} entries")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    ordered = {address: normalize_lookup_entry(address, lookup[address]) for address in sorted(lookup)}
    path.write_text(json.dumps(ordered, indent=2), encoding="utf-8")


def list_snapshot_csvs(file_name: str = GE1_CSV_NAME) -> list[Path]:
    csvs = []
    for root in (WEBAPP_DATA_DIR, ARCHIVED_DATA_DIR):
        if not root.exists():
            continue
        for csv_path in root.rglob(file_name):
            if csv_path.parent.name.isdigit():
                csvs.append(csv_path)
    csvs.sort(
        key=lambda path: (
            -int(path.parent.name),
            1 if "archived" in path.parts else 0,
            str(path),
        )
    )
    return csvs


def list_target_csvs(heights: list[int]) -> list[Path]:
    targets = []
    for height in heights:
        for root in (WEBAPP_DATA_DIR, ARCHIVED_DATA_DIR):
            snapshot_dir = root / str(height)
            for file_name in (GE1_CSV_NAME, TOP100_CSV_NAME):
                csv_path = snapshot_dir / file_name
                if csv_path.exists():
                    targets.append(csv_path)
    return targets


def ingest_existing_snapshot_identities(
    lookup: dict[str, dict],
    snapshot_csvs: list[Path],
) -> tuple[int, int]:
    identity_counts: dict[str, dict[str, int]] = {}

    for csv_path in snapshot_csvs:
        with csv_path.open(newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                identity = clean_identity_label(row.get("identity") or "")
                if not identity or identity.lower() == "unidentified":
                    continue
                for token in select_row_lookup_tokens(row.get("display_group_ids") or ""):
                    per_address = identity_counts.setdefault(token, {})
                    per_address[identity] = per_address.get(identity, 0) + 1

    conflicts = 0
    updates = 0
    for address, per_identity in identity_counts.items():
        ranked = sorted(per_identity.items(), key=lambda item: (-item[1], item[0].lower()))
        best_identity = ranked[0][0]
        if len(ranked) > 1:
            conflicts += 1

        current_entry = lookup.get(address) or {}
        current_identity = clean_identity_label(current_entry.get("identity") or "")
        if current_identity == best_identity:
            continue

        lookup[address] = build_lookup_entry(
            best_identity,
            current_entry.get("identity_source") or "snapshot_consensus",
        )
        updates += 1

    return updates, conflicts


def merge_lookup_into_csv(lookup: dict[str, dict], csv_path: Path, dry_run: bool) -> tuple[int, int]:
    with csv_path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = list(reader.fieldnames or [])
        rows = list(reader)

    changed = 0
    remaining_missing = 0
    for row in rows:
        display_group_ids = row.get("display_group_ids") or ""
        raw_tokens = [token.strip() for token in display_group_ids.split("|") if token.strip()]
        has_dsms = any(is_dsms_token(token) for token in raw_tokens)
        tokens = select_row_lookup_tokens(display_group_ids)

        best_identity = None
        any_queried = False
        for token in tokens:
            entry = lookup.get(token)
            if entry is None:
                continue
            any_queried = True
            identity = clean_identity_label(entry.get("identity") or "")
            if identity and identity.lower() != "unidentified":
                best_identity = identity
                break

        existing = clean_identity_label(row.get("identity") or "")
        if best_identity:
            new_identity = best_identity
        elif has_dsms:
            new_identity = "unidentified"
        elif any_queried and not existing:
            new_identity = "unidentified"
        else:
            new_identity = existing

        if new_identity != existing:
            row["identity"] = new_identity
            changed += 1

        if is_missing_identity(new_identity):
            remaining_missing += 1

    if dry_run:
        return changed, remaining_missing

    with csv_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    return changed, remaining_missing


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Sync snapshot identity labels from local snapshot consensus only"
    )
    parser.add_argument("heights", type=int, nargs="+", help="Snapshot height(s) to update")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without writing files")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    lookup = load_existing_lookup(ARKHAM_LOOKUP_PATH)
    all_ge1_csvs = list_snapshot_csvs(GE1_CSV_NAME)
    target_csvs = list_target_csvs(args.heights)

    if not all_ge1_csvs:
        raise RuntimeError(f"No snapshot CSVs found under {WEBAPP_DATA_DIR}")
    if not target_csvs:
        raise RuntimeError(f"No target GE1/top100 CSVs found for heights: {args.heights}")

    print("=== Local Snapshot Identity Consensus ===")
    print(f"all ge1 snapshot CSVs     : {len(all_ge1_csvs):,}")
    print(f"target CSVs               : {len(target_csvs):,}")
    print(f"existing lookup entries    : {len(lookup):,}")
    print(f"dry run mode              : {'yes' if args.dry_run else 'no'}")

    refreshed, conflicts = ingest_existing_snapshot_identities(lookup, all_ge1_csvs)
    print(f"snapshot identity sync     : {refreshed:,} lookup entries refreshed")
    print(f"snapshot identity conflicts: {conflicts:,} addresses (resolved by most frequent label)")

    write_lookup(ARKHAM_LOOKUP_PATH, lookup, args.dry_run)

    total_changed = 0
    total_missing = 0
    for csv_path in target_csvs:
        changed, missing = merge_lookup_into_csv(lookup, csv_path, args.dry_run)
        total_changed += changed
        total_missing += missing
        prefix = "[dry-run] " if args.dry_run else ""
        print(
            f"{prefix}{csv_path.parent.name}/{csv_path.name}: "
            f"{changed:,} rows updated | {missing:,} missing identities remain"
        )

    print(f"total rows updated         : {total_changed:,}")
    print(f"total missing identities   : {total_missing:,}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
