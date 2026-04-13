import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
JSON_PATH = ROOT.parent / "identity_groups.json"
SUGGESTIONS_PATH = ROOT / "tmp_identity_group_suggestions.csv"


def main() -> None:
    data = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    groups = data["groups"]

    removed_duplicates = 0
    removed_cross_group_duplicates = 0
    globally_seen = set()
    for group_name, identities in groups.items():
        deduped = []
        seen = set()
        for identity in identities:
            if identity in seen:
                removed_duplicates += 1
                continue
            if identity in globally_seen:
                removed_cross_group_duplicates += 1
                continue
            seen.add(identity)
            globally_seen.add(identity)
            deduped.append(identity)
        groups[group_name] = deduped

    existing_group_for: dict[str, str] = {}
    for group_name, identities in groups.items():
        for identity in identities:
            existing_group_for.setdefault(identity, group_name)

    seen_suggestions: set[tuple[str, str]] = set()

    added = 0
    already_same = 0
    already_other = 0
    missing_group = 0
    skipped_unidentified = 0
    duplicate_suggestion_rows = 0

    with SUGGESTIONS_PATH.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            identity = (row.get("identity") or "").strip()
            suggested_group = (row.get("suggested_group") or "").strip()
            if not identity:
                continue
            if suggested_group.lower() == "unidentified":
                skipped_unidentified += 1
                continue
            if suggested_group not in groups:
                missing_group += 1
                continue

            suggestion_key = (identity, suggested_group)
            if suggestion_key in seen_suggestions:
                duplicate_suggestion_rows += 1
                continue
            seen_suggestions.add(suggestion_key)

            current_group = existing_group_for.get(identity)
            if current_group == suggested_group:
                already_same += 1
                continue
            if current_group is not None and current_group != suggested_group:
                already_other += 1
                continue

            groups[suggested_group].append(identity)
            existing_group_for[identity] = suggested_group
            added += 1

    JSON_PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"updated {JSON_PATH}")
    print(f"added {added}")
    print(f"already_same {already_same}")
    print(f"already_other {already_other}")
    print(f"missing_group {missing_group}")
    print(f"skipped_unidentified {skipped_unidentified}")
    print(f"duplicate_suggestion_rows {duplicate_suggestion_rows}")
    print(f"removed_existing_duplicates {removed_duplicates}")
    print(f"removed_cross_group_duplicates {removed_cross_group_duplicates}")


if __name__ == "__main__":
    main()
