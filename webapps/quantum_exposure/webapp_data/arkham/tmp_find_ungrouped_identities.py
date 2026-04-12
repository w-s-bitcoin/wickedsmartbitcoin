import csv
import json
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parent
IDENTITY_GROUPS_PATH = ROOT / "identity_groups.json"


def main() -> None:
    data = json.loads(IDENTITY_GROUPS_PATH.read_text(encoding="utf-8"))
    grouped = set()
    for items in data["groups"].values():
        grouped.update(items)

    ungrouped: dict[str, dict] = {}
    for csv_path in ROOT.rglob("dashboard_pubkeys_ge_1btc.csv"):
        try:
            height = int(csv_path.parent.name)
        except ValueError:
            continue

        with csv_path.open(newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                identity = (row.get("identity") or "").strip()
                if not identity or identity.lower() == "unidentified" or identity in grouped:
                    continue

                info = ungrouped.setdefault(
                    identity,
                    {
                        "count": 0,
                        "heights": set(),
                        "details": defaultdict(int),
                        "sample_display_group_ids": row.get("display_group_ids") or "",
                        "first_height": height,
                        "last_height": height,
                    },
                )
                info["count"] += 1
                info["heights"].add(height)

                detail = (row.get("details") or "").strip()
                if detail:
                    info["details"][detail] += 1

                info["first_height"] = min(info["first_height"], height)
                info["last_height"] = max(info["last_height"], height)

    rows = []
    for identity, info in sorted(ungrouped.items(), key=lambda item: (-item[1]["count"], item[0].lower())):
        top_details = sorted(info["details"].items(), key=lambda item: (-item[1], item[0]))[:3]
        rows.append(
            {
                "identity": identity,
                "count": info["count"],
                "first_height": info["first_height"],
                "last_height": info["last_height"],
                "height_count": len(info["heights"]),
                "top_details": top_details,
                "sample_display_group_ids": info["sample_display_group_ids"],
            }
        )

    print(f"ungrouped_count {len(rows)}")
    for row in rows:
        print(json.dumps(row, ensure_ascii=True))


if __name__ == "__main__":
    main()