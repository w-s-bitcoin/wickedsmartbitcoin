import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
JSON_PATH = ROOT / "identity_groups.json"
SUGGESTIONS_PATH = ROOT / "tmp_identity_group_suggestions.csv"


def main() -> None:
    data = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    groups = data["groups"]

    existing_group_for: dict[str, str] = {}
    for group_name, identities in groups.items():
        for identity in identities:
            existing_group_for.setdefault(identity, group_name)

    added = 0
    already_same = 0
    already_other = 0
    missing_group = 0
    skipped_unidentified = 0

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


if __name__ == "__main__":
    main()
