#!/usr/bin/env python3
"""Validate the Stage 3 Issuance and Patoshi publication boundaries."""

from __future__ import annotations

import csv
import hashlib
import json
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_csv_rows(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def validate_issuance() -> None:
    data_dir = ROOT / "webapps" / "issuance_rate" / "webapp_data"
    data_path = data_dir / "issuance_rate_data.json"
    preview_path = data_dir / "issuance_rate_preview.json"
    marker = json.loads((data_dir / "published_generation.json").read_text(encoding="utf-8"))
    data = json.loads(data_path.read_text(encoding="utf-8"))
    rows = data["rows"]

    assert marker["data_sha256"] == sha256(data_path)
    assert marker["preview_sha256"] == sha256(preview_path)
    assert marker["generated_utc"] == data["generated_utc"]
    assert marker["latest_block_height"] == data["source"]["latest_block_height"]
    assert marker["row_count"] == len(rows)
    assert marker["first_date"] == rows[0]["date"]
    assert marker["latest_date"] == rows[-1]["date"]
    assert marker["time_zone_count"] == len(data["time_zone_daily"])


def validate_patoshi() -> None:
    data_dir = ROOT / "webapps" / "patoshi_pattern" / "webapp_data"
    csv_path = data_dir / "patoshi_blocks.csv"
    metadata = json.loads((data_dir / "patoshi_metadata.json").read_text(encoding="utf-8"))
    assert metadata["data_sha256"] == sha256(csv_path)

    with csv_path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        first = next(reader)
        count = 1
        last = first
        for last in reader:
            count += 1
    assert metadata["block_count"] == count
    assert metadata["first_height"] == int(first["height"])
    assert metadata["last_height"] == int(last["height"])


def validate_node_count() -> None:
    data_dir = ROOT / "webapps" / "node_count" / "webapp_data"
    marker = json.loads((data_dir / "published_generation.json").read_text(encoding="utf-8"))
    expected_names = {
        "bitcoin_node_history.csv",
        "node_software_counts_grouped.csv",
        "node_software_counts_with_reachability.csv",
    }
    assert marker["schema_version"] == 1
    assert set(marker["artifacts"]) == expected_names

    rows_by_name: dict[str, list[dict[str, str]]] = {}
    for name in expected_names:
        path = data_dir / name
        rows = read_csv_rows(path)
        rows_by_name[name] = rows
        assert marker["artifacts"][name]["sha256"] == sha256(path)
        assert marker["artifacts"][name]["rows"] == len(rows)

    history = rows_by_name["bitcoin_node_history.csv"]
    assert history
    marker_latest = datetime.fromisoformat(marker["latest_history_datetime"].replace("Z", "+00:00"))
    csv_latest = datetime.fromisoformat(history[-1]["datetime"].replace("Z", "+00:00"))
    assert marker_latest == csv_latest


def validate_bitcoin_dominance() -> None:
    data_dir = ROOT / "webapps" / "bitcoin_dominance" / "webapp_data"
    marker = json.loads((data_dir / "published_generation.json").read_text(encoding="utf-8"))
    chart_path = data_dir / "chart_static.json"
    chart = json.loads(chart_path.read_text(encoding="utf-8"))
    expected_names = {
        "chart_static.json",
        "btcd_timeseries_historical.csv",
        "btcd_timeseries_current_day.csv",
        "btcd_timeseries_incl_stables_historical.csv",
        "btcd_timeseries_incl_stables_current_day.csv",
        "top10_daily_excl_stables.csv",
        "top10_daily_incl_stables.csv",
    }
    assert marker["schema_version"] == 1
    assert set(marker["artifacts"]) == expected_names
    assert marker["latest_date"] == chart["latest_date"]
    assert marker["latest_snapshot_date"] == chart["latest_snapshot_date"]

    rows_by_name: dict[str, list[dict[str, str]]] = {}
    for name in expected_names:
        path = data_dir / name
        artifact = marker["artifacts"][name]
        assert artifact["sha256"] == sha256(path)
        if name.endswith(".csv"):
            rows = read_csv_rows(path)
            rows_by_name[name] = rows
            assert artifact["rows"] == len(rows)

    records = chart["records"]
    record_names = {
        "btcd_timeseries_historical.csv": "btcd_timeseries_historical",
        "btcd_timeseries_current_day.csv": "btcd_timeseries_current_day",
        "btcd_timeseries_incl_stables_historical.csv": "btcd_timeseries_incl_stables_historical",
        "btcd_timeseries_incl_stables_current_day.csv": "btcd_timeseries_incl_stables_current_day",
        "top10_daily_excl_stables.csv": "top10_daily_excl_stables",
        "top10_daily_incl_stables.csv": "top10_daily_incl_stables",
    }
    for name, record_name in record_names.items():
        assert len(rows_by_name[name]) == records[record_name]

    for prefix in ("btcd_timeseries", "btcd_timeseries_incl_stables"):
        merged = rows_by_name[f"{prefix}_historical.csv"] + rows_by_name[f"{prefix}_current_day.csv"]
        assert merged
        assert merged[-1]["Date"] == marker["latest_date"]
    for name in ("top10_daily_excl_stables.csv", "top10_daily_incl_stables.csv"):
        assert rows_by_name[name]
        assert {row["Date"] for row in rows_by_name[name]} == {marker["latest_snapshot_date"]}


if __name__ == "__main__":
    validate_issuance()
    validate_patoshi()
    validate_node_count()
    validate_bitcoin_dominance()
    print("Stage 3 publication markers are coherent.")
