#!/usr/bin/env python3
"""Publish the marker for one fully finalized Quantum dashboard generation.

``latest_snapshot.txt`` deliberately remains an internal pipeline pointer: a
few build steps need the new height before normalization, corrections, and
index regeneration have finished.  Browsers watch the marker written here
instead.  The marker is replaced atomically only after the orchestrator has
completed every data mutation for the generation.
"""

from __future__ import annotations

import csv
import hashlib
import json
import os
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path


PUBLICATION_MARKER_FILENAME = "published_generation.json"
PUBLICATION_MARKER_FORMAT = 1
REQUIRED_SNAPSHOT_CSV_HEADERS = {
    "dashboard_snapshot_meta.csv": {
        "snapshot_blockheight",
        "snapshot_time",
        "one_year_ago_blockheight",
        "one_year_ago_block_time",
    },
    "dashboard_pubkeys_aggregates.csv": {
        "balance_filter",
        "script_type_filter",
        "spend_activity_filter",
        "pubkey_count",
        "utxo_count",
        "supply_sats",
        "exposed_pubkey_count",
        "exposed_utxo_count",
        "exposed_supply_sats",
        "estimated_migration_blocks",
    },
    "dashboard_pubkeys_ge_1btc_top100.csv": {
        "display_group_ids",
        "exposed_supply_sats_by_script_type",
        "spend_activity",
        "exposed_utxo_count",
        "first_exposed_blockheight",
        "last_spend_blockheight",
        "details",
        "identity",
        "first_exposed_unix_time",
        "last_spend_unix_time",
    },
    "dashboard_pubkeys_ge_1btc.csv": {
        "display_group_ids",
        "exposed_supply_sats_by_script_type",
        "spend_activity",
        "exposed_utxo_count",
        "first_exposed_blockheight",
        "last_spend_blockheight",
        "details",
        "identity",
        "first_exposed_unix_time",
        "last_spend_unix_time",
    },
}
REQUIRED_SNAPSHOT_FILES = tuple(REQUIRED_SNAPSHOT_CSV_HEADERS)
HISTORICAL_ECO_REQUIRED_HEADERS = {
    "snapshot",
    "balance_filter",
    "script_type_filter",
    "spend_activity_filter",
    "pubkey_count",
    "utxo_count",
    "supply_sats",
    "exposed_pubkey_count",
    "exposed_utxo_count",
    "exposed_supply_sats",
    "estimated_migration_blocks",
}
ARCHIVED_INDEX_HEADERS = ("snapshot_blockheight", "snapshot_time")
HISTORICAL_ECO_HEADERS = (
    "snapshot",
    "balance_filter",
    "script_type_filter",
    "spend_activity_filter",
    "pubkey_count",
    "utxo_count",
    "supply_sats",
    "exposed_pubkey_count",
    "exposed_utxo_count",
    "exposed_supply_sats",
    "estimated_migration_blocks",
)
HISTORICAL_BALANCE_FILTERS = {"all", "ge1", "ge10", "ge100", "ge1000"}
HISTORICAL_SCRIPT_TYPES = {"All", "P2PK", "P2PKH", "P2SH", "P2WPKH", "P2WSH", "P2TR"}
HISTORICAL_SPEND_ACTIVITIES = {"all", "never_spent", "inactive", "active"}


def _historical_preview_artifact(webapp_data_dir: Path) -> dict[str, int | str]:
    """Describe the exact historical CSV consumed by the homepage preview."""

    path = Path(webapp_data_dir) / "historical_eco.csv"
    rows = _read_complete_csv_rows(path, HISTORICAL_ECO_REQUIRED_HEADERS)
    heights: list[int] = []
    for row in rows:
        raw_height = str(row.get("snapshot") or "").strip()
        if not raw_height.isdigit():
            raise RuntimeError(
                "Quantum historical preview contains an invalid snapshot height: "
                f"{raw_height!r}."
            )
        heights.append(int(raw_height))
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return {
        "path": path.name,
        "sha256": digest,
        "rows": len(rows),
        "first_snapshot": min(heights),
        "latest_snapshot": max(heights),
    }


def _read_complete_csv_rows(
    path: Path,
    required_headers: set[str],
    *,
    allow_empty: bool = False,
) -> list[dict[str, str | None]]:
    """Read a modest CSV while rejecting malformed rows anywhere in the file."""
    try:
        with path.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            headers = [str(value or "") for value in (reader.fieldnames or [])]
            if (
                not headers
                or any(not value.strip() for value in headers)
                or len(headers) != len(set(headers))
            ):
                raise RuntimeError(f"Quantum generation CSV has invalid headers: {path}")
            missing_headers = sorted(required_headers.difference(headers))
            if missing_headers:
                raise RuntimeError(
                    f"Quantum generation CSV is missing required headers in {path}: "
                    + ", ".join(missing_headers)
                )

            rows: list[dict[str, str | None]] = []
            for row in reader:
                if (
                    None in row
                    or any(value is None for value in row.values())
                    or not any(str(value or "").strip() for value in row.values())
                ):
                    raise RuntimeError(f"Quantum generation CSV has an incomplete row: {path}")
                rows.append(row)
    except (OSError, UnicodeError, csv.Error) as exc:
        raise RuntimeError(f"Could not read finalized Quantum CSV: {path}") from exc

    if not rows and not allow_empty:
        raise RuntimeError(f"Quantum generation CSV has no complete data rows: {path}")
    return rows


def _validate_archive_bundle(webapp_data_dir: Path) -> None:
    """Require archive catalogs and payload directories to describe one reality."""
    archived_index_path = webapp_data_dir / "archived_index.csv"
    historical_archived_path = webapp_data_dir / "historical_archived.csv"
    archived_dir = webapp_data_dir / "archived"
    archived_dir_heights = {
        int(entry.name)
        for entry in archived_dir.iterdir()
        if entry.is_dir() and entry.name.isdigit()
    } if archived_dir.is_dir() else set()

    index_exists = archived_index_path.is_file()
    history_exists = historical_archived_path.is_file()
    if not index_exists and not history_exists:
        if archived_dir_heights:
            raise RuntimeError(
                "Refusing to publish Quantum generation because archived snapshot "
                "directories exist without archive catalogs."
            )
        return
    if index_exists != history_exists:
        raise RuntimeError(
            "Refusing to publish Quantum generation because archived_index.csv and "
            "historical_archived.csv must either both exist or both be omitted."
        )

    archived_index_rows = _read_complete_csv_rows(
        archived_index_path,
        set(ARCHIVED_INDEX_HEADERS),
        allow_empty=True,
    )
    archived_heights: list[int] = []
    for row in archived_index_rows:
        raw_height = str(row.get("snapshot_blockheight") or "").strip()
        raw_time = str(row.get("snapshot_time") or "").strip()
        if not raw_height.isdigit() or not raw_time:
            raise RuntimeError(
                "Refusing to publish Quantum generation because archived_index.csv "
                f"contains an incomplete entry: {row!r}."
            )
        archived_heights.append(int(raw_height))
    if len(archived_heights) != len(set(archived_heights)):
        raise RuntimeError("Quantum archived_index.csv contains duplicate snapshot heights.")
    if archived_heights != sorted(archived_heights, reverse=True):
        raise RuntimeError("Quantum archived_index.csv is not ordered newest-first.")
    if set(archived_heights) != archived_dir_heights:
        missing_dirs = sorted(set(archived_heights).difference(archived_dir_heights))
        unindexed_dirs = sorted(archived_dir_heights.difference(archived_heights))
        details: list[str] = []
        if missing_dirs:
            details.append("missing directories " + ", ".join(map(str, missing_dirs)))
        if unindexed_dirs:
            details.append("unindexed directories " + ", ".join(map(str, unindexed_dirs)))
        raise RuntimeError(
            "Refusing to publish an incoherent Quantum archive bundle ("
            + "; ".join(details)
            + ")."
        )

    historical_archived_rows = _read_complete_csv_rows(
        historical_archived_path,
        HISTORICAL_ECO_REQUIRED_HEADERS,
        allow_empty=True,
    )
    archived_history_heights: set[int] = set()
    archived_history_keys: set[tuple[str, str, str, str]] = set()
    for row in historical_archived_rows:
        raw_height = str(row.get("snapshot") or "").strip()
        if not raw_height.isdigit():
            raise RuntimeError(
                "Refusing to publish Quantum generation because historical_archived.csv "
                f"contains invalid snapshot height {raw_height!r}."
            )
        archived_history_heights.add(int(raw_height))
        key = (
            raw_height,
            str(row.get("balance_filter") or "").strip(),
            str(row.get("script_type_filter") or "").strip(),
            str(row.get("spend_activity_filter") or "").strip(),
        )
        if key in archived_history_keys:
            raise RuntimeError(
                "Quantum historical_archived.csv contains duplicate filter row "
                f"{key!r}."
            )
        archived_history_keys.add(key)
    if archived_history_heights != set(archived_heights):
        raise RuntimeError(
            "Refusing to publish Quantum generation because historical_archived.csv "
            "coverage does not match archived_index.csv."
        )
    missing_toplines = [
        height
        for height in archived_heights
        if (str(height), "all", "All", "all") not in archived_history_keys
    ]
    if missing_toplines:
        raise RuntimeError(
            "Refusing to publish Quantum generation because historical_archived.csv "
            "has no all/All/all topline row for archived snapshots: "
            + ", ".join(map(str, missing_toplines))
        )


def _scan_full_exposure_identifiers(path: Path) -> tuple[int, set[str]]:
    """Validate the full export while retaining only its stable row identifiers."""
    required_headers = REQUIRED_SNAPSHOT_CSV_HEADERS["dashboard_pubkeys_ge_1btc.csv"]
    identifiers: set[str] = set()
    row_count = 0
    try:
        with path.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            headers = [str(value or "") for value in (reader.fieldnames or [])]
            if (
                not headers
                or any(not value.strip() for value in headers)
                or len(headers) != len(set(headers))
            ):
                raise RuntimeError(f"Quantum generation CSV has invalid headers: {path}")
            missing_headers = sorted(required_headers.difference(headers))
            if missing_headers:
                raise RuntimeError(
                    f"Quantum generation CSV is missing required headers in {path}: "
                    + ", ".join(missing_headers)
                )

            for row in reader:
                if None in row or any(value is None for value in row.values()):
                    raise RuntimeError(f"Quantum generation CSV has an incomplete row: {path}")
                identifier = str(row.get("display_group_ids") or "").strip()
                if not identifier:
                    raise RuntimeError(
                        f"Quantum full exposure CSV has a blank display_group_ids value: {path}"
                    )
                if identifier in identifiers:
                    raise RuntimeError(
                        f"Quantum full exposure CSV has a duplicate display group {identifier!r}: {path}"
                    )
                identifiers.add(identifier)
                row_count += 1
    except (OSError, UnicodeError, csv.Error) as exc:
        raise RuntimeError(f"Could not read finalized Quantum CSV: {path}") from exc

    if row_count == 0:
        raise RuntimeError(f"Quantum generation CSV has no complete data rows: {path}")
    return row_count, identifiers


def read_latest_snapshot_height(webapp_data_dir: Path) -> int:
    latest_path = webapp_data_dir / "latest_snapshot.txt"
    try:
        value = latest_path.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise RuntimeError(f"Could not read latest snapshot pointer: {latest_path}") from exc
    if not value.isdigit():
        raise RuntimeError(f"Latest snapshot pointer is not a block height: {value!r}")
    return int(value)


def read_published_snapshot_height(webapp_data_dir: Path) -> int | None:
    """Return the browser-visible snapshot height, failing closed on bad markers."""
    marker_path = Path(webapp_data_dir) / PUBLICATION_MARKER_FILENAME
    if not marker_path.exists():
        return None
    try:
        marker_text = marker_path.read_text(encoding="utf-8")
    except OSError as exc:
        raise RuntimeError(f"Could not read publication marker: {marker_path}") from exc
    marker = _validate_marker_text(marker_text)
    return int(marker["snapshot_blockheight"])


def _validate_final_generation(webapp_data_dir: Path, snapshot_height: int) -> None:
    latest_pointer_height = read_latest_snapshot_height(webapp_data_dir)
    if latest_pointer_height != snapshot_height:
        raise RuntimeError(
            "Refusing to publish Quantum generation because latest_snapshot.txt "
            f"points to {latest_pointer_height}, expected {snapshot_height}."
        )

    snapshot_dir = webapp_data_dir / str(snapshot_height)
    missing = [
        str(snapshot_dir / filename)
        for filename in REQUIRED_SNAPSHOT_FILES
        if not (snapshot_dir / filename).is_file()
    ]
    if missing:
        raise RuntimeError(
            "Refusing to publish an incomplete Quantum generation; missing: "
            + ", ".join(missing)
        )

    metadata_rows = _read_complete_csv_rows(
        snapshot_dir / "dashboard_snapshot_meta.csv",
        REQUIRED_SNAPSHOT_CSV_HEADERS["dashboard_snapshot_meta.csv"],
    )
    if len(metadata_rows) != 1:
        raise RuntimeError(
            "Refusing to publish Quantum generation because dashboard_snapshot_meta.csv "
            f"has {len(metadata_rows)} data rows; expected exactly one."
        )
    metadata_height = str(
        metadata_rows[0].get("snapshot_blockheight") or ""
    ).strip()
    if metadata_height != str(snapshot_height):
        raise RuntimeError(
            "Refusing to publish Quantum generation because dashboard_snapshot_meta.csv "
            f"identifies snapshot {metadata_height!r}, expected {snapshot_height}."
        )

    aggregate_rows = _read_complete_csv_rows(
        snapshot_dir / "dashboard_pubkeys_aggregates.csv",
        REQUIRED_SNAPSHOT_CSV_HEADERS["dashboard_pubkeys_aggregates.csv"],
    )
    aggregate_keys = [
        (
            str(row.get("balance_filter") or "").strip(),
            str(row.get("script_type_filter") or "").strip(),
            str(row.get("spend_activity_filter") or "").strip(),
        )
        for row in aggregate_rows
    ]
    if len(aggregate_keys) != len(set(aggregate_keys)):
        raise RuntimeError(
            "Refusing to publish Quantum generation because the aggregate CSV "
            "contains duplicate filter combinations."
        )
    if ("all", "All", "all") not in set(aggregate_keys):
        raise RuntimeError(
            "Refusing to publish Quantum generation because the aggregate CSV "
            "does not contain the canonical all/All/all topline row."
        )
    aggregate_key_set = set(aggregate_keys)
    required_topline_keys = (
        {(balance, "All", "all") for balance in HISTORICAL_BALANCE_FILTERS}
        | {("all", script_type, "all") for script_type in HISTORICAL_SCRIPT_TYPES}
        | {("all", "All", activity) for activity in HISTORICAL_SPEND_ACTIVITIES}
    )
    missing_topline_keys = sorted(required_topline_keys.difference(aggregate_key_set))
    if missing_topline_keys:
        raise RuntimeError(
            "Refusing to publish Quantum generation because the aggregate CSV is "
            "missing required filter toplines: "
            + ", ".join(repr(key) for key in missing_topline_keys)
        )
    historical_aggregate_keys = {
        key
        for key in aggregate_key_set
        if key[0] in HISTORICAL_BALANCE_FILTERS
        and key[1] in HISTORICAL_SCRIPT_TYPES
        and key[2] in HISTORICAL_SPEND_ACTIVITIES
    }

    top100_path = snapshot_dir / "dashboard_pubkeys_ge_1btc_top100.csv"
    full_path = snapshot_dir / "dashboard_pubkeys_ge_1btc.csv"
    top100_rows = _read_complete_csv_rows(
        top100_path,
        REQUIRED_SNAPSHOT_CSV_HEADERS["dashboard_pubkeys_ge_1btc_top100.csv"],
    )
    top100_identifiers = [
        str(row.get("display_group_ids") or "").strip() for row in top100_rows
    ]
    if any(not identifier for identifier in top100_identifiers):
        raise RuntimeError("Refusing to publish a Quantum top-100 CSV with a blank display group.")
    if len(top100_identifiers) != len(set(top100_identifiers)):
        raise RuntimeError("Refusing to publish a Quantum top-100 CSV with duplicate display groups.")

    full_count, full_identifiers = _scan_full_exposure_identifiers(full_path)
    expected_top100_count = min(100, full_count)
    if len(top100_rows) != expected_top100_count:
        raise RuntimeError(
            "Refusing to publish Quantum generation because the top-100 exposure CSV "
            f"has {len(top100_rows)} rows; expected {expected_top100_count} for a "
            f"full export containing {full_count} rows."
        )
    missing_top100_identifiers = sorted(set(top100_identifiers).difference(full_identifiers))
    if missing_top100_identifiers:
        raise RuntimeError(
            "Refusing to publish Quantum generation because top-100 display groups "
            "are absent from the full export: "
            + ", ".join(repr(value) for value in missing_top100_identifiers[:5])
        )

    historical_path = webapp_data_dir / "historical_eco.csv"
    historical_rows = _read_complete_csv_rows(
        historical_path,
        HISTORICAL_ECO_REQUIRED_HEADERS,
    )
    history_keys: set[tuple[str, str, str, str]] = set()
    historical_heights: set[int] = set()
    for row in historical_rows:
        raw_height = str(row.get("snapshot") or "").strip()
        if not raw_height.isdigit():
            raise RuntimeError(
                f"Refusing to publish Quantum generation with invalid historical height {raw_height!r}."
            )
        height = int(raw_height)
        historical_heights.add(height)
        history_key = (
            raw_height,
            str(row.get("balance_filter") or "").strip(),
            str(row.get("script_type_filter") or "").strip(),
            str(row.get("spend_activity_filter") or "").strip(),
        )
        if history_key in history_keys:
            raise RuntimeError(
                "Refusing to publish Quantum generation because historical_eco.csv "
                f"contains duplicate filter row {history_key!r}."
            )
        history_keys.add(history_key)

    latest_history_filter_keys = {
        (balance_filter, script_type, spend_activity)
        for height, balance_filter, script_type, spend_activity in history_keys
        if height == str(snapshot_height)
    }
    if latest_history_filter_keys != historical_aggregate_keys:
        missing_from_history = sorted(
            historical_aggregate_keys.difference(latest_history_filter_keys)
        )
        unexpected_in_history = sorted(
            latest_history_filter_keys.difference(historical_aggregate_keys)
        )
        details: list[str] = []
        if missing_from_history:
            details.append(
                "missing " + ", ".join(repr(key) for key in missing_from_history[:8])
            )
        if unexpected_in_history:
            details.append(
                "unexpected " + ", ".join(repr(key) for key in unexpected_in_history[:8])
            )
        raise RuntimeError(
            "Refusing to publish Quantum generation because the latest historical "
            "filter rows do not match the finalized aggregate CSV ("
            + "; ".join(details)
            + ")."
        )

    if snapshot_height not in historical_heights:
        raise RuntimeError(
            "Refusing to publish Quantum generation because historical_eco.csv "
            f"does not contain latest snapshot {snapshot_height}."
        )

    index_path = webapp_data_dir / "snapshots_index.csv"
    index_rows = _read_complete_csv_rows(
        index_path,
        {"snapshot_blockheight", "snapshot_time"},
    )
    indexed_heights: list[int] = []
    for row in index_rows:
        raw_height = str(row.get("snapshot_blockheight") or "").strip()
        raw_time = str(row.get("snapshot_time") or "").strip()
        if not raw_height.isdigit() or not raw_time:
            raise RuntimeError(
                "Refusing to publish Quantum generation because snapshots_index.csv "
                f"contains an incomplete entry: {row!r}."
            )
        indexed_heights.append(int(raw_height))
    if len(indexed_heights) != len(set(indexed_heights)):
        raise RuntimeError(
            "Refusing to publish Quantum generation because snapshots_index.csv "
            "contains duplicate snapshot heights."
        )
    if indexed_heights != sorted(indexed_heights, reverse=True):
        raise RuntimeError(
            "Refusing to publish Quantum generation because snapshots_index.csv "
            "is not ordered newest-first."
        )
    if indexed_heights[0] != snapshot_height:
        raise RuntimeError(
            "Refusing to publish Quantum generation because snapshots_index.csv "
            f"does not lead with latest snapshot {snapshot_height}."
        )
    missing_active_dirs = [
        height for height in indexed_heights if not (webapp_data_dir / str(height)).is_dir()
    ]
    if missing_active_dirs:
        raise RuntimeError(
            "Refusing to publish Quantum generation because indexed active snapshot "
            "directories are missing: "
            + ", ".join(str(height) for height in missing_active_dirs)
        )
    missing_history = sorted(set(indexed_heights).difference(historical_heights))
    if missing_history:
        raise RuntimeError(
            "Refusing to publish Quantum generation because historical_eco.csv has no "
            "coverage for active indexed snapshots: "
            + ", ".join(str(height) for height in missing_history)
        )
    missing_topline_history = [
        height
        for height in indexed_heights
        if (str(height), "all", "All", "all") not in history_keys
    ]
    if missing_topline_history:
        raise RuntimeError(
            "Refusing to publish Quantum generation because historical_eco.csv has no "
            "all/All/all topline row for active snapshots: "
            + ", ".join(str(height) for height in missing_topline_history)
        )

    _validate_archive_bundle(webapp_data_dir)


def _atomic_write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            newline="",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temp_path = Path(handle.name)
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temp_path, 0o644)
        os.replace(temp_path, path)
        temp_path = None
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


def write_empty_archive_catalogs(webapp_data_dir: Path) -> None:
    """Atomically install a coherent archive-free catalog pair."""
    data_dir = Path(webapp_data_dir)
    _atomic_write_text(
        data_dir / "archived_index.csv",
        ",".join(ARCHIVED_INDEX_HEADERS) + "\n",
    )
    _atomic_write_text(
        data_dir / "historical_archived.csv",
        ",".join(HISTORICAL_ECO_HEADERS) + "\n",
    )


def _validate_marker_text(marker_text: str) -> dict:
    try:
        marker = json.loads(marker_text)
    except json.JSONDecodeError as exc:
        raise RuntimeError("Quantum publication marker is not valid JSON.") from exc
    if not isinstance(marker, dict) or marker.get("format") != PUBLICATION_MARKER_FORMAT:
        raise RuntimeError("Quantum publication marker has an unsupported format.")
    height = marker.get("snapshot_blockheight")
    if isinstance(height, bool) or not isinstance(height, int) or height < 0:
        raise RuntimeError("Quantum publication marker has an invalid snapshot height.")
    if not str(marker.get("generation_id") or "").strip():
        raise RuntimeError("Quantum publication marker has no generation id.")
    historical_artifact = marker.get("artifacts", {}).get("historical_eco.csv")
    if historical_artifact is not None:
        if not isinstance(historical_artifact, dict):
            raise RuntimeError("Quantum publication marker has an invalid historical preview artifact.")
        expected_path = str(historical_artifact.get("path") or "")
        expected_hash = str(historical_artifact.get("sha256") or "").lower()
        rows = historical_artifact.get("rows")
        first_snapshot = historical_artifact.get("first_snapshot")
        latest_snapshot = historical_artifact.get("latest_snapshot")
        if (
            expected_path != "historical_eco.csv"
            or len(expected_hash) != 64
            or any(character not in "0123456789abcdef" for character in expected_hash)
            or isinstance(rows, bool)
            or not isinstance(rows, int)
            or rows <= 0
            or isinstance(first_snapshot, bool)
            or not isinstance(first_snapshot, int)
            or first_snapshot < 0
            or isinstance(latest_snapshot, bool)
            or not isinstance(latest_snapshot, int)
            or latest_snapshot < first_snapshot
            or latest_snapshot != height
        ):
            raise RuntimeError("Quantum publication marker has incomplete historical preview evidence.")
    return marker


def copy_generation_marker(source_data_dir: Path, target_data_dir: Path) -> str:
    """Atomically copy a validated marker after all target data files exist."""

    source_path = Path(source_data_dir) / PUBLICATION_MARKER_FILENAME
    try:
        marker_text = source_path.read_text(encoding="utf-8")
    except OSError as exc:
        raise RuntimeError(f"Could not read publication marker: {source_path}") from exc
    marker = _validate_marker_text(marker_text)
    target_dir = Path(target_data_dir)
    # A schema-valid marker is not sufficient: do not advance the standalone
    # publication boundary until its latest pointer, index, and required
    # snapshot files all describe the same complete generation.
    _validate_final_generation(target_dir, marker["snapshot_blockheight"])
    expected_artifact = marker.get("artifacts", {}).get("historical_eco.csv")
    if expected_artifact is not None and _historical_preview_artifact(target_dir) != expected_artifact:
        raise RuntimeError(
            "Refusing to publish the Quantum marker because the target historical preview "
            "does not match its artifact evidence."
        )
    _atomic_write_text(target_dir / PUBLICATION_MARKER_FILENAME, marker_text)
    return marker_text


def publish_generation_marker(
    webapp_data_dir: Path,
    *,
    reason: str,
    now: datetime | None = None,
    generation_id: str | None = None,
) -> str:
    """Validate and atomically publish the current finalized generation.

    Returns the exact marker text.  Validation happens before the old marker is
    touched, so a failed or partial run keeps browsers on the prior generation.
    """

    data_dir = Path(webapp_data_dir)
    snapshot_height = read_latest_snapshot_height(data_dir)
    _validate_final_generation(data_dir, snapshot_height)

    published_at = now or datetime.now(timezone.utc)
    if published_at.tzinfo is None:
        published_at = published_at.replace(tzinfo=timezone.utc)
    published_at = published_at.astimezone(timezone.utc)
    marker = {
        "format": PUBLICATION_MARKER_FORMAT,
        "generation_id": generation_id or uuid.uuid4().hex,
        "published_at_utc": published_at.isoformat(timespec="seconds").replace("+00:00", "Z"),
        "reason": str(reason),
        "snapshot_blockheight": snapshot_height,
        "artifacts": {
            "historical_eco.csv": _historical_preview_artifact(data_dir),
        },
    }
    marker_text = json.dumps(marker, sort_keys=True, separators=(",", ":")) + "\n"
    _validate_marker_text(marker_text)
    _atomic_write_text(data_dir / PUBLICATION_MARKER_FILENAME, marker_text)
    return marker_text
