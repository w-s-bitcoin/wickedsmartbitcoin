import csv
import os
import json
import re
import time
import argparse
from pathlib import Path

API_KEY = os.getenv("ARKHAM_API_KEY")
BASE_URL = "https://api.arkm.com"
SCRIPT_DIR = Path(__file__).resolve().parent
LOOKUP_JSON_FILE = SCRIPT_DIR / "arkham_btc_identity_lookup.json"
DATA_DIR = SCRIPT_DIR.parent
BATCH_SIZE = 1000
REQUEST_PAUSE_SECONDS = 1.0
MISSING_IDENTITY_VALUES = {"", "none", "null", "n/a", "na"}
QUERYABLE_IDENTITY_VALUES = MISSING_IDENTITY_VALUES | {"unidentified"}
KEYHASH20_RE = re.compile(r"^[0-9a-fA-F]{40}$")
BASE58_RE = re.compile(r"^[13][a-km-zA-HJ-NP-Z1-9]{25,62}$")
BECH32_RE = re.compile(r"^bc1[ac-hj-np-z02-9]{11,71}$")
IDENTITY_SOURCE_PRIORITY = {
    "arkhamEntity": 0,
    "predictedEntity": 1,
    "userEntity": 2,
    "arkhamLabel": 3,
    "userLabel": 4,
    None: 99,
}
IDENTITY_SUFFIXES_TO_STRIP = ("Inflows", "Deposit", "Custody", "Exchange")


class RateLimitExhausted(RuntimeError):
    pass


def chunked(items: list[str], size: int):
    for i in range(0, len(items), size):
        yield items[i:i + size]


def is_keyhash20(value: str) -> bool:
    return bool(KEYHASH20_RE.fullmatch(value))


def is_probable_btc_address(value: str) -> bool:
    lowered = value.lower()
    return bool(BASE58_RE.fullmatch(value) or BECH32_RE.fullmatch(lowered))


def clean_identity_label(identity: str | None) -> str:
    value = (identity or "").strip()
    if not value:
        return ""

    # Keep upstream normalization aligned with dashboard tag cleaning.
    value = re.sub(r"\s*\([^)]*\)", "", value)
    value = re.sub(r"\bManagement\b", "Mgmt", value, flags=re.IGNORECASE)
    value = re.sub(r"\bLbank\b", "LBank", value, flags=re.IGNORECASE)

    # Strip known suffixes repeatedly in case multiple are chained.
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
    return value


def load_existing_lookup(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}

    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"Expected lookup JSON object in {path}, found {type(data)}")
    return data


def load_candidate_addresses(csv_path: Path, existing_lookup: dict[str, dict]) -> list[str]:
    return load_candidate_addresses_with_skip(csv_path, existing_lookup, set())


def load_candidate_addresses_with_skip(
    csv_path: Path,
    existing_lookup: dict[str, dict],
    skip_addresses: set[str],
) -> list[str]:
    addresses = []
    seen = set(skip_addresses)

    # Keep identified addresses out of candidate queries.
    for address, entry in existing_lookup.items():
        if not isinstance(entry, dict):
            continue
        identity = clean_identity_label(entry.get("identity") or "")
        if identity and identity.lower() != "unidentified":
            seen.add(address)

    with csv_path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            identity = (row.get("identity") or "").strip().lower()
            if identity not in QUERYABLE_IDENTITY_VALUES:
                continue

            display_group_ids = row.get("display_group_ids") or ""
            for token in (item.strip() for item in display_group_ids.split("|") if item.strip()):
                if token in seen:
                    continue
                if is_keyhash20(token):
                    continue
                if not is_probable_btc_address(token):
                    continue

                seen.add(token)
                addresses.append(token)

    return addresses


def list_snapshot_csvs(data_dir: Path) -> list[Path]:
    snapshot_csvs = []
    for csv_path in data_dir.rglob("dashboard_pubkeys_ge_1btc.csv"):
        parent_name = csv_path.parent.name
        if not parent_name.isdigit():
            continue
        snapshot_csvs.append(csv_path)

    # Prefer active snapshots before archived for each height.
    snapshot_csvs.sort(
        key=lambda p: (
            int(p.parent.name),
            1 if "archived" in p.parts else 0,
            str(p),
        )
    )
    return snapshot_csvs


def ingest_existing_snapshot_identities(lookup: dict[str, dict], snapshot_csvs: list[Path]) -> tuple[int, int]:
    identity_counts: dict[str, dict[str, int]] = {}

    for csv_path in snapshot_csvs:
        with csv_path.open(newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                identity = clean_identity_label(row.get("identity") or "")
                if not identity or identity.lower() == "unidentified":
                    continue

                display_group_ids = row.get("display_group_ids") or ""
                for token in (item.strip() for item in display_group_ids.split("|") if item.strip()):
                    if is_keyhash20(token) or not is_probable_btc_address(token):
                        continue
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

        lookup[address] = {
            "address": address,
            "identity": best_identity,
            "identity_source": current_entry.get("identity_source") or "snapshot_consensus",
        }
        updates += 1

    return updates, conflicts


def extract_identity(record: dict) -> dict:
    best_name = None
    best_type = None

    for key, label in [
        ("arkhamEntity", "arkhamEntity"),
        ("predictedEntity", "predictedEntity"),
        ("userEntity", "userEntity"),
        ("arkhamLabel", "arkhamLabel"),
        ("userLabel", "userLabel"),
    ]:
        val = record.get(key)
        if isinstance(val, dict):
            name = val.get("name") or val.get("label") or val.get("id")
            if name:
                best_name = name
                best_type = label
                break

    return {
        "address": record.get("address"),
        "chain": record.get("chain"),
        "identity": best_name,
        "identity_source": best_type,
    }


def fetch_batch(addresses: list[str]) -> list[dict]:
    try:
        import requests
    except ImportError as exc:
        raise RuntimeError("The 'requests' package is required for live API calls. Install it or run with --dry-run.") from exc

    if not API_KEY:
        raise RuntimeError("ARKHAM_API_KEY is not set")

    url = f"{BASE_URL}/intelligence/address/batch/all"
    headers = {
        "API-Key": API_KEY,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    payload = {"addresses": addresses}

    last_error = None
    for attempt in range(1, 11):
        try:
            resp = requests.post(url, headers=headers, json=payload, timeout=60)
            if resp.status_code == 429:
                if attempt == 10:
                    raise RateLimitExhausted("Arkham rate limit persisted after 10 retries")
                retry_after = resp.headers.get("Retry-After")
                if retry_after and retry_after.isdigit():
                    wait_seconds = int(retry_after)
                else:
                    wait_seconds = min(300, max(15, attempt * 15))
                print(f"Rate limited on attempt {attempt}/10. Retrying in {wait_seconds}s...")
                time.sleep(wait_seconds)
                continue
            resp.raise_for_status()
            data = resp.json()
            break
        except RateLimitExhausted:
            raise
        except (requests.RequestException, ValueError) as exc:
            last_error = exc
            if attempt == 10:
                raise
            wait_seconds = attempt * 2
            print(f"Request failed on attempt {attempt}/10: {exc}. Retrying in {wait_seconds}s...")
            time.sleep(wait_seconds)
    else:
        raise RuntimeError(f"Failed to fetch Arkham batch: {last_error}")

    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("results", "items", "data"):
            if isinstance(data.get(key), list):
                return data[key]

        address_map = None
        if isinstance(data.get("addresses"), dict):
            address_map = data["addresses"]
        elif all(isinstance(v, dict) for v in data.values()):
            address_map = data

        flattened = []
        if isinstance(address_map, dict):
            for address, per_chain in address_map.items():
                if not isinstance(per_chain, dict):
                    continue

                if (
                    "address" in per_chain
                    or "chain" in per_chain
                    or any(
                        k in per_chain
                        for k in ("arkhamEntity", "predictedEntity", "userEntity", "arkhamLabel", "userLabel")
                    )
                ):
                    rec = dict(per_chain)
                    rec.setdefault("address", address)
                    flattened.append(rec)
                    continue

                for chain_name, record in per_chain.items():
                    if not isinstance(record, dict):
                        continue
                    rec = dict(record)
                    rec.setdefault("address", address)
                    rec.setdefault("chain", chain_name)
                    flattened.append(rec)

        if flattened:
            return flattened

    raise ValueError(f"Unexpected response shape: {type(data)} -> {data}")


def choose_best_record(address: str, normalized_records: list[dict]) -> dict | None:
    matches = [r for r in normalized_records if r.get("address") == address]
    if not matches:
        return None

    bitcoin_matches = [r for r in matches if (r.get("chain") or "").lower() == "bitcoin"]
    candidates = bitcoin_matches or matches

    def score(record: dict) -> tuple[int, int]:
        source_rank = IDENTITY_SOURCE_PRIORITY.get(record.get("identity_source"), 50)
        missing_identity = 1 if not record.get("identity") else 0
        return (missing_identity, source_rank)

    return min(candidates, key=score)


def update_lookup(lookup: dict[str, dict], batch_addresses: list[str], normalized_records: list[dict]) -> None:
    for address in batch_addresses:
        best = choose_best_record(address, normalized_records)
        identity = best.get("identity") if best else None
        identity_source = best.get("identity_source") if best else None
        cleaned_identity = clean_identity_label(identity)
        lookup[address] = {
            "address": address,
            "identity": cleaned_identity or "unidentified",
            "identity_source": identity_source or "",
        }


def write_lookup_files(lookup: dict[str, dict], dry_run: bool = False) -> None:
    if dry_run:
        print(f"[dry-run] would write lookup JSON with {len(lookup):,} entries")
        return

    ordered_addresses = sorted(lookup)
    ordered_lookup = {address: lookup[address] for address in ordered_addresses}
    LOOKUP_JSON_FILE.write_text(json.dumps(ordered_lookup, indent=2), encoding="utf-8")


def merge_lookup_into_snapshots(lookup: dict[str, dict], snapshot_csvs: list[Path], dry_run: bool = False) -> None:
    for csv_path in snapshot_csvs:
        if not csv_path.exists():
            continue

        rows = []
        with csv_path.open(newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            fieldnames = list(reader.fieldnames or [])
            for row in reader:
                rows.append(row)

        changed = 0
        for row in rows:
            display_group_ids = row.get("display_group_ids") or ""
            tokens = [t.strip() for t in display_group_ids.split("|") if t.strip()]

            best_identity = None
            any_queried = False

            for token in tokens:
                if is_keyhash20(token) or not is_probable_btc_address(token):
                    continue
                entry = lookup.get(token)
                if entry is None:
                    continue
                any_queried = True
                identity = entry.get("identity") or ""
                cleaned_identity = clean_identity_label(identity)
                if cleaned_identity and cleaned_identity.lower() != "unidentified":
                    best_identity = cleaned_identity
                    break

            existing = clean_identity_label(row.get("identity") or "")

            if best_identity:
                new_identity = best_identity
            elif any_queried and not existing:
                new_identity = "unidentified"
            else:
                new_identity = existing

            if new_identity != existing:
                row["identity"] = new_identity
                changed += 1

        if dry_run:
            print(f"  [dry-run] snapshot merge {csv_path.parent.name}: {changed:,} rows would update")
            continue

        with csv_path.open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)

        print(f"  snapshot merge {csv_path.parent.name}: {changed:,} rows updated")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Enrich Arkham identities for ge1 BTC dashboard snapshots")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview reconciliation and query counts without API calls or file writes",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    dry_run = args.dry_run

    snapshot_csvs = list_snapshot_csvs(DATA_DIR)
    if not snapshot_csvs:
        raise RuntimeError(f"No snapshot CSVs found under {DATA_DIR}/[blockheight]/dashboard_pubkeys_ge_1btc.csv")

    lookup = load_existing_lookup(LOOKUP_JSON_FILE)

    print(f"snapshot CSVs discovered   : {len(snapshot_csvs):,}")
    print(f"existing lookup entries    : {len(lookup):,}")
    print(f"dry run mode              : {'yes' if dry_run else 'no'}")

    # First reconcile known labels from all snapshots (including archived) and propagate globally.
    reconciled, conflicts = ingest_existing_snapshot_identities(lookup, snapshot_csvs)
    print(f"snapshot identity sync     : {reconciled:,} lookup entries refreshed")
    print(f"snapshot identity conflicts: {conflicts:,} addresses (resolved by most frequent label)")

    write_lookup_files(lookup, dry_run=dry_run)
    merge_lookup_into_snapshots(lookup, snapshot_csvs, dry_run=dry_run)

    total_queried = 0
    queried_this_run: set[str] = set()
    for csv_idx, source_csv in enumerate(snapshot_csvs, start=1):
        candidates = load_candidate_addresses_with_skip(source_csv, lookup, queried_this_run)
        print(
            f"[{csv_idx}/{len(snapshot_csvs)}] source {source_csv.parent.name}: "
            f"{len(candidates):,} unlabeled addresses left to query"
        )

        if not candidates:
            continue

        if dry_run:
            queried_this_run.update(candidates)
            total_queried += len(candidates)
            continue

        total_batches = (len(candidates) + BATCH_SIZE - 1) // BATCH_SIZE
        for batch_idx, batch in enumerate(chunked(candidates, BATCH_SIZE), start=1):
            print(
                f"  Fetching batch {batch_idx}/{total_batches} from {source_csv.parent.name} "
                f"with {len(batch)} addresses..."
            )
            try:
                records = fetch_batch(batch)
            except RateLimitExhausted as exc:
                write_lookup_files(lookup, dry_run=dry_run)
                merge_lookup_into_snapshots(lookup, snapshot_csvs, dry_run=dry_run)
                print(str(exc))
                print(f"Progress preserved in {LOOKUP_JSON_FILE}")
                return

            normalized = [extract_identity(r) for r in records]
            update_lookup(lookup, batch, normalized)
            total_queried += len(batch)
            queried_this_run.update(batch)

            # Immediately apply newly learned identities across all snapshots to avoid re-querying later.
            write_lookup_files(lookup, dry_run=dry_run)
            merge_lookup_into_snapshots(lookup, snapshot_csvs, dry_run=dry_run)

            identified = sum(1 for item in lookup.values() if item["identity"] != "unidentified")
            print(
                f"  lookup entries: {len(lookup):,} | identified: {identified:,} | "
                f"unidentified: {len(lookup) - identified:,}"
            )
            time.sleep(REQUEST_PAUSE_SECONDS)

    if dry_run:
        print("[dry-run] no API requests were sent")
        print("[dry-run] no lookup or snapshot files were modified")
    else:
        print(f"Saved lookup JSON to {LOOKUP_JSON_FILE}")
    print(f"Total newly queried addresses this run: {total_queried:,}")


if __name__ == "__main__":
    main()