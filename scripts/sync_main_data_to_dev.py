#!/usr/bin/env python3
"""Mirror production data into a local dev worktree without disturbing dirty code.

The production deploy branch deliberately rewrites its latest automation commit,
so replaying those commits directly is not idempotent. This tool instead builds a
data-only snapshot commit on top of the current dev HEAD with Git plumbing, then
fast-forwards the dev branch when its dirty paths do not overlap the snapshot.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path, PurePosixPath


DEFAULT_DEV_BRANCH = "dev/work"
DEFAULT_LOCK_PATH = Path("/tmp/animations_dev_data_sync.lock")
SYNC_SOURCE_REF = "refs/automation/dev-data-sync-main"
SYNC_COMMIT_PREFIX = "Sync production data"
STALE_LOCK_SECONDS = 6 * 3600
COMMAND_TIMEOUT_SECONDS = 180
BLOCK_DATA_RE = re.compile(r"^assets/block_data_\d+_\d+\.csv$")
ASSET_DATA_PATHS = {
    "assets/btcusd_10m_prices.csv",
    "assets/daily_price.csv",
    "assets/daily_price_metadata.json",
    "assets/last_updated.txt",
    "assets/top_kpis.json",
}
DAILY_PRICE_PATH = "assets/daily_price.csv"
DAILY_PRICE_MARKER_PATH = "assets/daily_price_metadata.json"
CASASCIUS_TRACKER_PATH = "webapps/casascius_explorer/data/casascius_explorer.csv"
CASASCIUS_RIGHT_PANEL_PATH = "webapps/casascius_explorer/assets/right_panel_data.js"
CASASCIUS_STATE_PATH = "webapps/casascius_explorer/data/casascius_explorer_update_state.json"
CASASCIUS_DATA_PATHS = {
    CASASCIUS_RIGHT_PANEL_PATH,
    CASASCIUS_TRACKER_PATH,
    CASASCIUS_STATE_PATH,
}
CASASCIUS_GENERATION_INPUTS = {CASASCIUS_TRACKER_PATH, CASASCIUS_RIGHT_PANEL_PATH}
ISSUANCE_DATA_PATH = "webapps/issuance_rate/webapp_data/issuance_rate_data.json"
ISSUANCE_PREVIEW_PATH = "webapps/issuance_rate/webapp_data/issuance_rate_preview.json"
ISSUANCE_MARKER_PATH = "webapps/issuance_rate/webapp_data/published_generation.json"
ISSUANCE_GENERATION_INPUTS = {ISSUANCE_DATA_PATH, ISSUANCE_PREVIEW_PATH}
NODE_DATA_DIR = "webapps/node_count/webapp_data"
NODE_HISTORY_PATH = f"{NODE_DATA_DIR}/bitcoin_node_history.csv"
NODE_GROUPED_PATH = f"{NODE_DATA_DIR}/node_software_counts_grouped.csv"
NODE_DETAIL_PATH = f"{NODE_DATA_DIR}/node_software_counts_with_reachability.csv"
NODE_LAST_UPDATED_PATH = f"{NODE_DATA_DIR}/last_updated.txt"
NODE_MARKER_PATH = f"{NODE_DATA_DIR}/published_generation.json"
NODE_GENERATION_INPUTS = {
    NODE_HISTORY_PATH,
    NODE_GROUPED_PATH,
    NODE_DETAIL_PATH,
    NODE_LAST_UPDATED_PATH,
}
DOMINANCE_DATA_DIR = "webapps/bitcoin_dominance/webapp_data"
DOMINANCE_CHART_STATIC_PATH = f"{DOMINANCE_DATA_DIR}/chart_static.json"
DOMINANCE_LOCAL_CSV_NAMES = (
    "btcd_timeseries_historical.csv",
    "btcd_timeseries_current_day.csv",
    "btcd_timeseries_incl_stables_historical.csv",
    "btcd_timeseries_incl_stables_current_day.csv",
    "top10_daily_excl_stables.csv",
    "top10_daily_incl_stables.csv",
)
DOMINANCE_LOCAL_CSV_PATHS = tuple(
    f"{DOMINANCE_DATA_DIR}/{name}" for name in DOMINANCE_LOCAL_CSV_NAMES
)
DOMINANCE_LAST_UPDATED_PATH = f"{DOMINANCE_DATA_DIR}/last_updated.txt"
DOMINANCE_MARKER_PATH = f"{DOMINANCE_DATA_DIR}/published_generation.json"
DOMINANCE_GENERATION_INPUTS = {
    DOMINANCE_CHART_STATIC_PATH,
    *DOMINANCE_LOCAL_CSV_PATHS,
    DOMINANCE_LAST_UPDATED_PATH,
}
BIP110_DATA_DIR = "webapps/bip110_signaling/webapp_data"
BIP110_PERIODS_PATH = f"{BIP110_DATA_DIR}/bip110_periods.csv"
BIP110_MARKER_PATH = f"{BIP110_DATA_DIR}/bip110_metadata.json"
BIP110_PERIOD_HEADERS = (
    "period",
    "period_start_height",
    "period_end_height",
    "status",
    "signal_blocks",
    "elapsed_blocks",
)
QUANTUM_DATA_DIR = "webapps/quantum_exposure/webapp_data"
QUANTUM_HISTORY_PATH = f"{QUANTUM_DATA_DIR}/historical_eco.csv"
QUANTUM_MARKER_PATH = f"{QUANTUM_DATA_DIR}/published_generation.json"
QUANTUM_HISTORY_HEADERS = (
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
DCA_COMPARISON_DATA_DIR = "webapps/dca_comparison/webapp_data"
DCA_COMPARISON_PREVIEW_PATH = f"{DCA_COMPARISON_DATA_DIR}/dca_comparison_preview.csv"
DCA_COMPARISON_MARKER_PATH = f"{DCA_COMPARISON_DATA_DIR}/published_generation.json"
DCA_COMPARISON_HEADERS = ("date", "BTC", "XAU")
DCA_COST_DATA_DIR = "webapps/dca_cost_basis/webapp_data"
DCA_COST_PREVIEW_PATH = f"{DCA_COST_DATA_DIR}/daily_dca.csv"
DCA_COST_MARKER_PATH = f"{DCA_COST_DATA_DIR}/dca_cost_basis_metadata.json"
DCA_COST_HEADERS = (
    "days_ago",
    "years_ago",
    "date_iso",
    "timestamp_utc",
    "block_height",
    "historical_price",
    "current_price",
    "dca_basis",
    "invested_usd",
    "btc_accum",
    "purchase_count",
    "is_price_above",
    "window_end_timestamp_utc",
)


class SyncError(RuntimeError):
    pass


@dataclass(frozen=True)
class SyncOutcome:
    status: str
    source_commit: str
    dev_commit: str
    paths: tuple[str, ...] = ()


def run_git(
    repo: Path,
    args: list[str],
    *,
    env: dict[str, str] | None = None,
    input_text: str | None = None,
    check: bool = True,
    timeout: int = COMMAND_TIMEOUT_SECONDS,
) -> subprocess.CompletedProcess[str]:
    command_env = os.environ.copy()
    command_env.setdefault("GIT_TERMINAL_PROMPT", "0")
    if env:
        command_env.update(env)
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=str(repo),
            env=command_env,
            input=input_text,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise SyncError(f"git {' '.join(args)} timed out after {timeout}s") from exc
    if check and result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or f"exit {result.returncode}"
        raise SyncError(f"git {' '.join(args)} failed: {detail}")
    return result


def run_git_bytes(
    repo: Path,
    args: list[str],
    *,
    env: dict[str, str] | None = None,
    input_bytes: bytes | None = None,
    check: bool = True,
    timeout: int = COMMAND_TIMEOUT_SECONDS,
) -> subprocess.CompletedProcess[bytes]:
    """Run Git without decoding blob contents used for publication hashes."""
    command_env = os.environ.copy()
    command_env.setdefault("GIT_TERMINAL_PROMPT", "0")
    if env:
        command_env.update(env)
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=str(repo),
            env=command_env,
            input=input_bytes,
            capture_output=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise SyncError(f"git {' '.join(args)} timed out after {timeout}s") from exc
    if check and result.returncode != 0:
        detail = (
            result.stderr.decode("utf-8", errors="replace").strip()
            or result.stdout.decode("utf-8", errors="replace").strip()
            or f"exit {result.returncode}"
        )
        raise SyncError(f"git {' '.join(args)} failed: {detail}")
    return result


def git_text(repo: Path, args: list[str], **kwargs) -> str:
    return run_git(repo, args, **kwargs).stdout.strip()


def git_nul_paths(repo: Path, args: list[str]) -> set[str]:
    result = subprocess.run(
        ["git", *args],
        cwd=str(repo),
        env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
        capture_output=True,
        timeout=COMMAND_TIMEOUT_SECONDS,
        check=False,
    )
    if result.returncode != 0:
        detail = result.stderr.decode(errors="replace").strip() or f"exit {result.returncode}"
        raise SyncError(f"git {' '.join(args)} failed: {detail}")
    return {
        value.decode("utf-8", errors="surrogateescape")
        for value in result.stdout.split(b"\0")
        if value
    }


def resolve_commit(repo: Path, ref: str) -> str:
    return git_text(repo, ["rev-parse", "--verify", f"{ref}^{{commit}}"])


def optional_ref(repo: Path, ref: str) -> str | None:
    result = run_git(repo, ["rev-parse", "--verify", f"{ref}^{{commit}}"], check=False)
    return result.stdout.strip() if result.returncode == 0 else None


def is_data_path(raw_path: str) -> bool:
    path = PurePosixPath(raw_path)
    parts = path.parts
    if raw_path in ASSET_DATA_PATHS or BLOCK_DATA_RE.fullmatch(raw_path):
        return True
    if raw_path in CASASCIUS_DATA_PATHS:
        return True
    return len(parts) >= 4 and parts[0] == "webapps" and parts[2] == "webapp_data"


def changed_data_paths(repo: Path, baseline: str, source_commit: str) -> list[str]:
    changed = git_nul_paths(
        repo,
        ["diff", "--no-renames", "--name-only", "-z", baseline, source_commit],
    )
    return sorted(path for path in changed if is_data_path(path))


def dirty_paths(repo: Path) -> set[str]:
    paths = set()
    paths.update(git_nul_paths(repo, ["diff", "--name-only", "-z"]))
    paths.update(git_nul_paths(repo, ["diff", "--cached", "--name-only", "-z"]))
    paths.update(git_nul_paths(repo, ["ls-files", "--others", "--exclude-standard", "-z"]))
    return paths


def paths_overlap(left: str, right: str) -> bool:
    return left == right or left.startswith(f"{right}/") or right.startswith(f"{left}/")


def overlapping_paths(dirty: set[str], updates: set[str]) -> list[str]:
    return sorted(
        dirty_path
        for dirty_path in dirty
        if any(paths_overlap(dirty_path, update_path) for update_path in updates)
    )


def ensure_no_git_operation(repo: Path) -> None:
    for marker in ("MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "REBASE_HEAD"):
        marker_path = Path(git_text(repo, ["rev-parse", "--git-path", marker]))
        if not marker_path.is_absolute():
            marker_path = repo / marker_path
        if marker_path.exists():
            raise SyncError(f"dev worktree has an active Git operation ({marker}); deferring data sync")
    index_lock = Path(git_text(repo, ["rev-parse", "--git-path", "index.lock"]))
    if not index_lock.is_absolute():
        index_lock = repo / index_lock
    if index_lock.exists():
        raise SyncError("dev worktree index is locked; deferring data sync")


def ensure_source_object(dev_repo: Path, source_repo: Path, source_ref: str, source_commit: str) -> str:
    present = run_git(dev_repo, ["cat-file", "-e", f"{source_commit}^{{commit}}"], check=False)
    if present.returncode == 0:
        return source_commit
    run_git(dev_repo, ["fetch", "--no-tags", str(source_repo), source_ref])
    fetched = resolve_commit(dev_repo, "FETCH_HEAD")
    if fetched != source_commit:
        raise SyncError(f"source moved during sync ({source_commit[:12]} -> {fetched[:12]}); retrying later")
    return fetched


def source_tree_entry(repo: Path, source_commit: str, path: str) -> tuple[str, str] | None:
    result = run_git(repo, ["ls-tree", source_commit, "--", path])
    line = result.stdout.strip()
    if not line:
        return None
    metadata, actual_path = line.split("\t", 1)
    mode, object_type, object_id = metadata.split()
    if actual_path != path or object_type != "blob":
        raise SyncError(f"unsupported source tree entry for {path}: {line}")
    return mode, object_id


def index_blob_bytes(repo: Path, path: str, index_env: dict[str, str]) -> bytes:
    """Read the exact bytes currently staged at *path* in a temporary index."""
    result = run_git_bytes(repo, ["show", f":{path}"], env=index_env, check=False)
    if result.returncode != 0:
        raise SyncError(f"cannot synthesize publication marker; candidate is missing {path}")
    return result.stdout


def write_index_blob(
    repo: Path,
    path: str,
    payload: bytes,
    index_env: dict[str, str],
) -> None:
    """Store *payload* as a regular-file blob in a temporary index."""
    result = run_git_bytes(repo, ["hash-object", "-w", "--stdin"], input_bytes=payload)
    object_id = result.stdout.decode("ascii").strip()
    if not re.fullmatch(r"[0-9a-f]{40,64}", object_id):
        raise SyncError(f"git hash-object returned an invalid object id for {path}")
    run_git(
        repo,
        ["update-index", "--add", "--cacheinfo", "100644", object_id, path],
        env=index_env,
    )


def build_issuance_publication_marker(data_bytes: bytes, preview_bytes: bytes) -> bytes:
    """Bind the exact old-main Issuance artifacts into the new marker format."""
    try:
        data = json.loads(data_bytes.decode("utf-8"))
        preview = json.loads(preview_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise SyncError(f"cannot synthesize Issuance marker from invalid JSON: {exc}") from exc

    if not isinstance(data, dict) or not isinstance(preview, dict):
        raise SyncError("cannot synthesize Issuance marker from non-object JSON")
    generated_utc = str(data.get("generated_utc") or "").strip()
    preview_generated_utc = str(preview.get("generated_utc") or "").strip()
    rows = data.get("rows")
    preview_rows = preview.get("rows")
    time_zone_daily = data.get("time_zone_daily")
    source = data.get("source")
    preview_source = preview.get("source")
    if not generated_utc or preview_generated_utc != generated_utc:
        raise SyncError("Issuance data and preview do not name the same generation")
    if not isinstance(rows, list) or not rows or not isinstance(preview_rows, list) or not preview_rows:
        raise SyncError("Issuance data and preview must both contain rows")
    if not isinstance(time_zone_daily, dict) or not time_zone_daily:
        raise SyncError("Issuance data is missing time-zone rows")
    if not isinstance(source, dict) or not isinstance(preview_source, dict):
        raise SyncError("Issuance data or preview is missing source metadata")
    if source != preview_source or data.get("chart") != preview.get("chart"):
        raise SyncError("Issuance data and preview source/chart metadata disagree")

    try:
        latest_height = int(source["latest_block_height"])
    except (KeyError, TypeError, ValueError) as exc:
        raise SyncError("Issuance data has an invalid latest block height") from exc
    first_date = str(rows[0].get("date") or "") if isinstance(rows[0], dict) else ""
    latest_date = str(rows[-1].get("date") or "") if isinstance(rows[-1], dict) else ""
    preview_latest_date = (
        str(preview_rows[-1].get("date") or "")
        if isinstance(preview_rows[-1], dict)
        else ""
    )
    if not first_date or not latest_date or preview_latest_date != latest_date:
        raise SyncError("Issuance data and preview do not end on the same date")

    previous_day = None
    previous_height = -1
    for index, row in enumerate(preview_rows):
        if not isinstance(row, dict):
            raise SyncError(f"Issuance preview row {index} is not an object")
        raw_date = str(row.get("date") or "").strip()
        try:
            row_day = datetime.strptime(raw_date, "%Y-%m-%d").date()
            height = int(row["height"])
            issuance_rate = float(row["issuance_rate"])
            target_rate = float(row["target_rate"])
        except (KeyError, TypeError, ValueError) as exc:
            raise SyncError(f"Issuance preview row {index} has invalid semantics") from exc
        if row_day.isoformat() != raw_date:
            raise SyncError(f"Issuance preview row {index} has an invalid UTC date")
        if previous_day is not None and row_day != previous_day + timedelta(days=1):
            raise SyncError(f"Issuance preview row {index} is not the next UTC day")
        if height < 0 or height < previous_height:
            raise SyncError(f"Issuance preview row {index} has a decreasing block height")
        if (
            not math.isfinite(issuance_rate)
            or issuance_rate < 0
            or not math.isfinite(target_rate)
            or target_rate < 0
        ):
            raise SyncError(f"Issuance preview row {index} has an invalid rate")
        previous_day = row_day
        previous_height = height

    preview_first_date = str(preview_rows[0]["date"])
    preview_first_height = int(preview_rows[0]["height"])
    preview_latest_height = int(preview_rows[-1]["height"])
    if preview_latest_height != latest_height:
        raise SyncError("Issuance preview does not end at the source block height")

    marker = {
        "schema_version": 1,
        "generated_utc": generated_utc,
        "latest_block_height": latest_height,
        "first_date": first_date,
        "latest_date": latest_date,
        "row_count": len(rows),
        "time_zone_count": len(time_zone_daily),
        "data_sha256": hashlib.sha256(data_bytes).hexdigest(),
        "preview_sha256": hashlib.sha256(preview_bytes).hexdigest(),
        "preview": {
            "path": "webapp_data/issuance_rate_preview.json",
            "sha256": hashlib.sha256(preview_bytes).hexdigest(),
            "rows": len(preview_rows),
            "first_date": preview_first_date,
            "latest_date": preview_latest_date,
            "first_height": preview_first_height,
            "latest_height": preview_latest_height,
        },
    }
    return (json.dumps(marker, separators=(",", ":"), ensure_ascii=True) + "\n").encode("utf-8")


def parse_csv_blob(path: str, payload: bytes) -> list[dict[str, str]]:
    try:
        text = payload.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise SyncError(f"cannot synthesize publication marker; {path} is not UTF-8") from exc
    try:
        return list(csv.DictReader(io.StringIO(text, newline=""), strict=True))
    except csv.Error as exc:
        raise SyncError(f"cannot synthesize publication marker from invalid CSV {path}: {exc}") from exc


DAILY_PRICE_TIMESTAMP_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$"
)


def validate_daily_price_csv(data_bytes: bytes) -> dict[str, object]:
    """Validate and summarize the exact daily-price artifact used by a marker.

    Timestamps without an explicit offset are the pipeline's historical UTC
    format. Offset-aware timestamps are normalized to UTC before enforcing one
    row per consecutive UTC calendar day.
    """
    rows = parse_csv_blob(DAILY_PRICE_PATH, data_bytes)
    if not rows:
        raise SyncError("cannot synthesize daily-price marker from empty data")

    required = {"date", "timestamp", "block_height", "price", "daily_high"}
    missing = sorted(required - set(rows[0]))
    if missing:
        raise SyncError(
            "cannot synthesize daily-price marker; missing columns: " + ", ".join(missing)
        )

    previous_day = None
    previous_height = None
    first_day = None
    latest_day = None
    latest_timestamp = ""
    latest_height = None

    for row_number, row in enumerate(rows, start=2):
        if None in row:
            raise SyncError(
                f"cannot synthesize daily-price marker; row {row_number} has extra CSV fields"
            )

        timestamp_text = str(row.get("timestamp") or "").strip()
        if not DAILY_PRICE_TIMESTAMP_RE.fullmatch(timestamp_text):
            raise SyncError(
                f"cannot synthesize daily-price marker; row {row_number} has an invalid timestamp"
            )
        try:
            parsed_timestamp = datetime.fromisoformat(
                timestamp_text[:-1] + "+00:00"
                if timestamp_text.endswith("Z")
                else timestamp_text
            )
        except ValueError as exc:
            raise SyncError(
                f"cannot synthesize daily-price marker; row {row_number} has an invalid timestamp"
            ) from exc
        if parsed_timestamp.tzinfo is None:
            parsed_timestamp = parsed_timestamp.replace(tzinfo=timezone.utc)
        elif parsed_timestamp.utcoffset() is None:
            raise SyncError(
                f"cannot synthesize daily-price marker; row {row_number} has an invalid timezone"
            )
        utc_day = parsed_timestamp.astimezone(timezone.utc).date()
        date_text = str(row.get("date") or "").strip()
        parsed_date = None
        for date_format in ("%m/%d/%y", "%m/%d/%Y", "%Y-%m-%d"):
            try:
                parsed_date = datetime.strptime(date_text, date_format).date()
                break
            except ValueError:
                continue
        if parsed_date is None or parsed_date != utc_day:
            raise SyncError(
                "cannot synthesize daily-price marker; "
                f"row {row_number} date does not match its UTC timestamp day"
            )
        if previous_day is not None:
            expected_day = previous_day + timedelta(days=1)
            if utc_day != expected_day:
                raise SyncError(
                    "cannot synthesize daily-price marker; "
                    f"row {row_number} UTC day {utc_day.isoformat()} is not the expected "
                    f"consecutive day {expected_day.isoformat()}"
                )

        height_text = str(row.get("block_height") or "").strip()
        try:
            height = int(height_text)
        except ValueError as exc:
            raise SyncError(
                f"cannot synthesize daily-price marker; row {row_number} has an invalid block height"
            ) from exc
        if height < 0:
            raise SyncError(
                f"cannot synthesize daily-price marker; row {row_number} has a negative block height"
            )
        if previous_height is not None and height < previous_height:
            raise SyncError(
                f"cannot synthesize daily-price marker; row {row_number} block height decreases"
            )

        for column in ("price", "daily_high"):
            value_text = str(row.get(column) or "").strip()
            try:
                value = float(value_text)
            except ValueError as exc:
                raise SyncError(
                    f"cannot synthesize daily-price marker; row {row_number} has an invalid {column}"
                ) from exc
            if not math.isfinite(value) or value < 0:
                raise SyncError(
                    f"cannot synthesize daily-price marker; row {row_number} has a non-finite or negative {column}"
                )

        if first_day is None:
            first_day = utc_day
        previous_day = utc_day
        previous_height = height
        latest_day = utc_day
        latest_timestamp = timestamp_text
        latest_height = height

    if first_day is None or latest_day is None or latest_height is None:
        raise SyncError("cannot synthesize daily-price marker from invalid boundaries")

    return {
        "rows": len(rows),
        "first_date": first_day.isoformat(),
        "latest_date": latest_day.isoformat(),
        "latest_timestamp": latest_timestamp,
        "latest_block_height": latest_height,
    }


def build_daily_price_publication_marker(data_bytes: bytes) -> bytes:
    """Bind the exact hourly daily-price artifact to its Stage 4 marker."""
    summary = validate_daily_price_csv(data_bytes)

    marker = {
        "schema_version": 1,
        "artifact": {
            "path": DAILY_PRICE_PATH,
            "sha256": hashlib.sha256(data_bytes).hexdigest(),
            "rows": summary["rows"],
        },
        "first_date": summary["first_date"],
        "latest_date": summary["latest_date"],
        "latest_timestamp": summary["latest_timestamp"],
        "latest_block_height": summary["latest_block_height"],
    }
    return (json.dumps(marker, separators=(",", ":"), ensure_ascii=True) + "\n").encode("utf-8")


def validate_daily_price_publication_marker(data_bytes: bytes, marker_bytes: bytes) -> None:
    """Require a source-provided marker to bind the exact validated CSV bytes."""
    try:
        marker = json.loads(marker_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise SyncError("daily-price publication marker is not valid UTF-8 JSON") from exc
    if not isinstance(marker, dict):
        raise SyncError("daily-price publication marker is not an object")

    expected = json.loads(build_daily_price_publication_marker(data_bytes))
    artifact = marker.get("artifact")
    if not isinstance(artifact, dict):
        raise SyncError("daily-price publication marker has no artifact object")
    expected_artifact = expected["artifact"]
    if any(artifact.get(key) != value for key, value in expected_artifact.items()):
        raise SyncError("daily-price publication marker does not match the exact CSV artifact")
    for key in (
        "schema_version",
        "first_date",
        "latest_date",
        "latest_timestamp",
        "latest_block_height",
    ):
        if marker.get(key) != expected[key]:
            raise SyncError(f"daily-price publication marker has an invalid {key}")


def parse_casascius_right_panel_blob(payload: bytes) -> dict:
    prefix = "window.CASASCIUS_RIGHT_PANEL_DATA = "
    try:
        source = payload.decode("utf-8").strip()
    except UnicodeDecodeError as exc:
        raise SyncError("cannot synthesize Casascius marker from non-UTF-8 right-panel data") from exc
    if not source.startswith(prefix) or not source.endswith(";"):
        raise SyncError("cannot synthesize Casascius marker from invalid right-panel script")
    try:
        document = json.loads(source[len(prefix):-1])
    except json.JSONDecodeError as exc:
        raise SyncError(f"cannot synthesize Casascius marker from invalid JSON: {exc}") from exc
    if not isinstance(document, dict) or not isinstance(document.get("items"), dict):
        raise SyncError("cannot synthesize Casascius marker without right-panel items")
    return document


def build_casascius_right_panel_marker(
    tracker_bytes: bytes,
    right_panel_bytes: bytes,
    *,
    allow_replace_existing: bool = False,
) -> bytes:
    """Bind the exact Casascius tracker to its marker-last right-panel script."""
    rows = parse_csv_blob(CASASCIUS_TRACKER_PATH, tracker_bytes)
    if not rows:
        raise SyncError("cannot synthesize Casascius marker from an empty tracker")
    document = parse_casascius_right_panel_blob(right_panel_bytes)

    status_counts = {"active": 0, "redeemed": 0, "unfunded": 0}
    unknown_statuses: set[str] = set()
    for row in rows:
        status = str(row.get("Status") or "").strip().lower()
        if status == "active":
            status_counts["active"] += 1
        elif status == "redeemed":
            status_counts["redeemed"] += 1
        elif status in {"unfunded", "unloaded"}:
            status_counts["unfunded"] += 1
        else:
            unknown_statuses.add(status or "<blank>")
    if unknown_statuses:
        raise SyncError(
            "cannot synthesize Casascius marker with unknown tracker statuses: "
            + ", ".join(sorted(unknown_statuses))
        )

    def latest_integer(field: str) -> int | None:
        values: list[int] = []
        for row in rows:
            raw = str(row.get(field) or "").strip()
            if not raw:
                continue
            try:
                values.append(int(raw))
            except ValueError as exc:
                raise SyncError(f"Casascius tracker has an invalid {field} value") from exc
        return max(values, default=None)

    items = document["items"]
    all_key = str(document.get("allKey") or "all-items")
    all_info = items.get(all_key)
    if not isinstance(all_info, dict):
        raise SyncError("Casascius right-panel data is missing the all-items summary")
    expected_summary = {
        "active": status_counts["active"],
        "redeemed": status_counts["redeemed"],
        "unfunded": status_counts["unfunded"],
        "minted": status_counts["active"] + status_counts["redeemed"],
    }
    for key, expected in expected_summary.items():
        try:
            actual = int(all_info[key])
        except (KeyError, TypeError, ValueError) as exc:
            raise SyncError(f"Casascius right-panel summary has an invalid {key}") from exc
        if actual != expected:
            raise SyncError(
                f"Casascius right-panel summary disagrees for {key}: "
                f"panel={actual}, tracker={expected}"
            )

    latest_create_block = latest_integer("Create Block")
    latest_create_time = latest_integer("Create Time")
    latest_redeem_block = latest_integer("Redeem Block")
    latest_redeem_time = latest_integer("Redeem Time")
    for key, expected in (("lastBlock", latest_redeem_block), ("lastTime", latest_redeem_time)):
        actual = all_info.get(key)
        if expected is None:
            if actual not in (None, "", "—"):
                raise SyncError(f"Casascius right-panel summary has an unexpected {key}")
        else:
            try:
                if int(actual) != expected:
                    raise SyncError(f"Casascius right-panel summary disagrees for {key}")
            except (TypeError, ValueError) as exc:
                raise SyncError(f"Casascius right-panel summary has an invalid {key}") from exc

    publication = {
        "schemaVersion": 1,
        "tracker": {
            "path": "data/casascius_explorer.csv",
            "sha256": hashlib.sha256(tracker_bytes).hexdigest(),
            "rows": len(rows),
            "statusCounts": status_counts,
            "latestCreateBlock": latest_create_block,
            "latestCreateTime": latest_create_time,
            "latestRedeemBlock": latest_redeem_block,
            "latestRedeemTime": latest_redeem_time,
        },
        "rightPanelItems": len(items),
    }

    existing = document.get("publication")
    if isinstance(existing, dict):
        tracker = existing.get("tracker") if isinstance(existing.get("tracker"), dict) else {}
        coherent = (
            int(existing.get("schemaVersion") or 0) == 1
            and int(existing.get("rightPanelItems") or -1) == len(items)
            and tracker.get("path") == publication["tracker"]["path"]
            and str(tracker.get("sha256") or "").lower() == publication["tracker"]["sha256"]
            and int(tracker.get("rows") or -1) == len(rows)
            and tracker.get("statusCounts") == status_counts
            and tracker.get("latestCreateBlock") == latest_create_block
            and tracker.get("latestCreateTime") == latest_create_time
            and tracker.get("latestRedeemBlock") == latest_redeem_block
            and tracker.get("latestRedeemTime") == latest_redeem_time
        )
        if coherent:
            return right_panel_bytes
        if not allow_replace_existing:
            raise SyncError("Casascius source marker does not match its tracker")

    document["publication"] = publication
    output = (
        "window.CASASCIUS_RIGHT_PANEL_DATA = "
        + json.dumps(document, separators=(",", ":"), sort_keys=True, ensure_ascii=True)
        + ";\n"
    )
    return output.encode("utf-8")


def marker_timestamp(path: str, payload: bytes) -> str:
    try:
        value = payload.decode("utf-8").strip()
    except UnicodeDecodeError as exc:
        raise SyncError(f"cannot synthesize publication marker; {path} is not UTF-8") from exc
    if not value:
        raise SyncError(f"cannot synthesize publication marker; {path} is empty")
    return value


def build_node_publication_marker(
    history_bytes: bytes,
    grouped_bytes: bytes,
    detail_bytes: bytes,
    last_updated_bytes: bytes,
) -> bytes:
    """Bind the three Node Count dashboard artifacts to one generation."""
    history_rows = parse_csv_blob(NODE_HISTORY_PATH, history_bytes)
    grouped_rows = parse_csv_blob(NODE_GROUPED_PATH, grouped_bytes)
    detail_rows = parse_csv_blob(NODE_DETAIL_PATH, detail_bytes)
    if not history_rows or not grouped_rows or not detail_rows:
        raise SyncError("cannot synthesize Node Count marker from empty companion data")

    latest_raw = str(history_rows[-1].get("datetime") or "").strip()
    try:
        latest_history_datetime = datetime.fromisoformat(
            latest_raw.replace("Z", "+00:00")
        ).isoformat()
    except ValueError as exc:
        raise SyncError("Node Count history has an invalid latest datetime") from exc

    def total(rows: list[dict[str, str]], label: str) -> float:
        try:
            return sum(float(row["total_count"]) for row in rows)
        except (KeyError, TypeError, ValueError) as exc:
            raise SyncError(f"Node Count {label} has invalid total_count values") from exc

    if abs(total(grouped_rows, "grouped software") - total(detail_rows, "software detail")) > 0.5:
        raise SyncError("Node Count grouped and detailed software totals disagree")

    published_at = marker_timestamp(NODE_LAST_UPDATED_PATH, last_updated_bytes)
    artifacts = {
        "bitcoin_node_history.csv": {
            "sha256": hashlib.sha256(history_bytes).hexdigest(),
            "rows": len(history_rows),
        },
        "node_software_counts_grouped.csv": {
            "sha256": hashlib.sha256(grouped_bytes).hexdigest(),
            "rows": len(grouped_rows),
        },
        "node_software_counts_with_reachability.csv": {
            "sha256": hashlib.sha256(detail_bytes).hexdigest(),
            "rows": len(detail_rows),
        },
    }
    marker = {
        "schema_version": 1,
        "generation_id": published_at,
        "published_at_utc": published_at,
        "latest_history_datetime": latest_history_datetime,
        "artifacts": artifacts,
    }
    return json.dumps(marker, separators=(",", ":"), ensure_ascii=True).encode("utf-8")


def build_dominance_publication_marker(
    chart_static_bytes: bytes,
    csv_blobs: dict[str, bytes],
    last_updated_bytes: bytes,
) -> bytes:
    """Bind Bitcoin Dominance's seven local artifacts; price stays external."""
    try:
        chart_static = json.loads(chart_static_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise SyncError(f"cannot synthesize Dominance marker from invalid chart metadata: {exc}") from exc
    if not isinstance(chart_static, dict):
        raise SyncError("cannot synthesize Dominance marker from non-object chart metadata")

    latest_date = str(chart_static.get("latest_date") or "").strip()
    latest_snapshot_date = str(chart_static.get("latest_snapshot_date") or "").strip()
    records = chart_static.get("records")
    if not latest_date or not latest_snapshot_date or not isinstance(records, dict):
        raise SyncError("Dominance chart metadata is missing latest dates or record counts")

    rows_by_name = {
        name: parse_csv_blob(f"{DOMINANCE_DATA_DIR}/{name}", csv_blobs[name])
        for name in DOMINANCE_LOCAL_CSV_NAMES
    }
    required_nonempty = {
        "btcd_timeseries_historical.csv",
        "btcd_timeseries_incl_stables_historical.csv",
        "top10_daily_excl_stables.csv",
        "top10_daily_incl_stables.csv",
    }
    for name, rows in rows_by_name.items():
        record_key = name.removesuffix(".csv")
        try:
            expected_rows = int(records[record_key])
        except (KeyError, TypeError, ValueError) as exc:
            raise SyncError(f"Dominance chart metadata has no valid row count for {name}") from exc
        if len(rows) != expected_rows or (name in required_nonempty and not rows):
            raise SyncError(
                f"Dominance companion row count disagrees for {name}: "
                f"metadata={expected_rows}, candidate={len(rows)}"
            )

    for historical_name, current_name in (
        ("btcd_timeseries_historical.csv", "btcd_timeseries_current_day.csv"),
        (
            "btcd_timeseries_incl_stables_historical.csv",
            "btcd_timeseries_incl_stables_current_day.csv",
        ),
    ):
        combined = rows_by_name[historical_name] + rows_by_name[current_name]
        if str(combined[-1].get("Date") or "").strip() != latest_date:
            raise SyncError(f"Dominance timeseries does not end on {latest_date}: {current_name}")
    for snapshot_name in (
        "top10_daily_excl_stables.csv",
        "top10_daily_incl_stables.csv",
    ):
        if any(
            str(row.get("Date") or "").strip() != latest_snapshot_date
            for row in rows_by_name[snapshot_name]
        ):
            raise SyncError(f"Dominance snapshot dates disagree in {snapshot_name}")

    published_at = marker_timestamp(DOMINANCE_LAST_UPDATED_PATH, last_updated_bytes)
    artifacts = {
        "chart_static.json": {"sha256": hashlib.sha256(chart_static_bytes).hexdigest()},
        **{
            name: {
                "sha256": hashlib.sha256(csv_blobs[name]).hexdigest(),
                "rows": len(rows_by_name[name]),
            }
            for name in DOMINANCE_LOCAL_CSV_NAMES
        },
    }
    marker = {
        "schema_version": 1,
        "generation_id": published_at,
        "published_at_utc": published_at,
        "latest_date": latest_date,
        "latest_snapshot_date": latest_snapshot_date,
        "artifacts": artifacts,
    }
    return json.dumps(marker, separators=(",", ":"), ensure_ascii=True).encode("utf-8")


def parse_exact_csv_blob(
    path: str,
    payload: bytes,
    expected_headers: tuple[str, ...],
) -> list[dict[str, str]]:
    """Parse a publication-bound CSV without accepting partial rows."""
    try:
        text = payload.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise SyncError(f"cannot bind publication marker; {path} is not UTF-8") from exc
    try:
        reader = csv.DictReader(io.StringIO(text, newline=""), strict=True)
        headers = tuple(reader.fieldnames or ())
        if headers != expected_headers:
            raise SyncError(
                f"cannot bind publication marker; {path} has unexpected CSV headers"
            )
        rows: list[dict[str, str]] = []
        for row_number, row in enumerate(reader, start=2):
            if (
                None in row
                or any(value is None for value in row.values())
                or not any(str(value).strip() for value in row.values())
            ):
                raise SyncError(
                    f"cannot bind publication marker; {path} row {row_number} is incomplete"
                )
            rows.append({key: str(value) for key, value in row.items()})
    except csv.Error as exc:
        raise SyncError(f"cannot bind publication marker; {path} is invalid CSV: {exc}") from exc
    if not rows:
        raise SyncError(f"cannot bind publication marker; {path} has no data rows")
    return rows


def parse_marker_object(path: str, payload: bytes) -> dict:
    try:
        marker = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise SyncError(f"{path} is not valid UTF-8 JSON") from exc
    if not isinstance(marker, dict):
        raise SyncError(f"{path} is not a JSON object")
    return marker


def parse_nonnegative_integer(value: object, description: str) -> int:
    raw = str(value).strip()
    if not re.fullmatch(r"\d+", raw):
        raise SyncError(f"{description} is not a non-negative integer")
    return int(raw)


def summarize_bip110_periods(periods_bytes: bytes) -> dict[str, object]:
    """Validate and describe the exact BIP-110 preview CSV bytes."""
    rows = parse_exact_csv_blob(BIP110_PERIODS_PATH, periods_bytes, BIP110_PERIOD_HEADERS)
    first_period = None
    last_period = None
    start_height = None
    end_height = None
    previous_end = None

    for row_number, row in enumerate(rows, start=2):
        period = parse_nonnegative_integer(row["period"], f"BIP-110 row {row_number} period")
        start = parse_nonnegative_integer(
            row["period_start_height"], f"BIP-110 row {row_number} start height"
        )
        end = parse_nonnegative_integer(
            row["period_end_height"], f"BIP-110 row {row_number} end height"
        )
        signal = parse_nonnegative_integer(
            row["signal_blocks"], f"BIP-110 row {row_number} signal count"
        )
        elapsed = parse_nonnegative_integer(
            row["elapsed_blocks"], f"BIP-110 row {row_number} elapsed count"
        )
        if period < 1:
            raise SyncError(f"BIP-110 row {row_number} has an invalid period number")
        if end - start + 1 != 2016:
            raise SyncError(f"BIP-110 row {row_number} does not span 2,016 blocks")
        if first_period is not None and period != last_period + 1:
            raise SyncError(f"BIP-110 row {row_number} is not the next signaling period")
        if previous_end is not None and start != previous_end + 1:
            raise SyncError(f"BIP-110 row {row_number} is not height-contiguous")
        if elapsed > 2016 or signal > elapsed:
            raise SyncError(f"BIP-110 row {row_number} has impossible block counts")
        expected_status = "completed" if elapsed == 2016 else "in_progress" if elapsed else "future"
        if row["status"].strip() != expected_status:
            raise SyncError(f"BIP-110 row {row_number} status disagrees with elapsed blocks")

        if first_period is None:
            first_period = period
            start_height = start
        last_period = period
        end_height = end
        previous_end = end

    return {
        "path": "bip110_periods.csv",
        "sha256": hashlib.sha256(periods_bytes).hexdigest(),
        "rows": len(rows),
        "first_period": first_period,
        "last_period": last_period,
        "start_height": start_height,
        "end_height": end_height,
    }


def validate_bip110_publication_marker(periods_bytes: bytes, marker_bytes: bytes) -> None:
    """Require BIP-110 metadata to bind the exact candidate periods CSV."""
    marker = parse_marker_object(BIP110_MARKER_PATH, marker_bytes)
    source_height = marker.get("source_block_height")
    if isinstance(source_height, bool) or not isinstance(source_height, int) or source_height < 0:
        raise SyncError("BIP-110 publication marker has an invalid source block height")
    datasets = marker.get("datasets")
    artifact = datasets.get("bip110_periods") if isinstance(datasets, dict) else None
    if not isinstance(artifact, dict):
        raise SyncError("BIP-110 publication marker has no bip110_periods dataset evidence")
    expected = summarize_bip110_periods(periods_bytes)
    if any(artifact.get(key) != value for key, value in expected.items()):
        raise SyncError("BIP-110 publication marker does not match the exact periods CSV")


def build_bip110_publication_marker(periods_bytes: bytes, marker_bytes: bytes) -> bytes:
    """Add exact BIP-110 period evidence to a legacy dev-side marker."""
    marker = parse_marker_object(BIP110_MARKER_PATH, marker_bytes)
    source_height = marker.get("source_block_height")
    if isinstance(source_height, bool) or not isinstance(source_height, int) or source_height < 0:
        raise SyncError("BIP-110 publication marker has an invalid source block height")
    datasets = marker.get("datasets")
    if not isinstance(datasets, dict):
        raise SyncError("BIP-110 publication marker has no datasets object")
    datasets["bip110_periods"] = summarize_bip110_periods(periods_bytes)
    output = (json.dumps(marker, separators=(",", ":"), ensure_ascii=True) + "\n").encode("utf-8")
    validate_bip110_publication_marker(periods_bytes, output)
    return output


def summarize_quantum_history(history_bytes: bytes) -> dict[str, object]:
    """Validate and describe the exact Quantum homepage history CSV bytes."""
    rows = parse_exact_csv_blob(
        QUANTUM_HISTORY_PATH,
        history_bytes,
        QUANTUM_HISTORY_HEADERS,
    )
    previous_snapshot = None
    snapshots: list[int] = []
    keys: set[tuple[int, str, str, str]] = set()
    canonical_snapshots: set[int] = set()
    integer_fields = QUANTUM_HISTORY_HEADERS[4:10]

    for row_number, row in enumerate(rows, start=2):
        snapshot = parse_nonnegative_integer(
            row["snapshot"], f"Quantum history row {row_number} snapshot"
        )
        if previous_snapshot is not None and snapshot < previous_snapshot:
            raise SyncError(f"Quantum history row {row_number} decreases in snapshot height")
        balance = row["balance_filter"].strip()
        script_type = row["script_type_filter"].strip()
        activity = row["spend_activity_filter"].strip()
        if not balance or not script_type or not activity:
            raise SyncError(f"Quantum history row {row_number} has a blank filter")
        key = (snapshot, balance, script_type, activity)
        if key in keys:
            raise SyncError(f"Quantum history row {row_number} duplicates a filter row")
        keys.add(key)

        for field in integer_fields:
            try:
                value = float(row[field].strip())
            except ValueError as exc:
                raise SyncError(
                    f"Quantum history row {row_number} has an invalid {field}"
                ) from exc
            if not math.isfinite(value) or value < 0 or not value.is_integer():
                raise SyncError(f"Quantum history row {row_number} has an invalid {field}")
        try:
            migration_blocks = float(row["estimated_migration_blocks"].strip())
        except ValueError as exc:
            raise SyncError(
                f"Quantum history row {row_number} has invalid estimated migration blocks"
            ) from exc
        if not math.isfinite(migration_blocks) or migration_blocks < 0:
            raise SyncError(
                f"Quantum history row {row_number} has invalid estimated migration blocks"
            )

        if not snapshots or snapshots[-1] != snapshot:
            snapshots.append(snapshot)
        if balance == "all" and script_type == "All" and activity == "all":
            canonical_snapshots.add(snapshot)
        previous_snapshot = snapshot

    missing_canonical = sorted(set(snapshots).difference(canonical_snapshots))
    if missing_canonical:
        raise SyncError(
            "Quantum history has no all/All/all topline for snapshots: "
            + ", ".join(map(str, missing_canonical))
        )

    return {
        "path": "historical_eco.csv",
        "sha256": hashlib.sha256(history_bytes).hexdigest(),
        "rows": len(rows),
        "first_snapshot": snapshots[0],
        "latest_snapshot": snapshots[-1],
    }


def validate_quantum_publication_marker(history_bytes: bytes, marker_bytes: bytes) -> None:
    """Require a Quantum marker to bind the exact candidate history CSV."""
    marker = parse_marker_object(QUANTUM_MARKER_PATH, marker_bytes)
    if marker.get("format") != 1 or isinstance(marker.get("format"), bool):
        raise SyncError("Quantum publication marker has an unsupported format")
    generation_id = str(marker.get("generation_id") or "").strip()
    if not generation_id:
        raise SyncError("Quantum publication marker has no generation id")
    expected = summarize_quantum_history(history_bytes)
    snapshot_height = marker.get("snapshot_blockheight")
    if (
        isinstance(snapshot_height, bool)
        or not isinstance(snapshot_height, int)
        or snapshot_height != expected["latest_snapshot"]
    ):
        raise SyncError("Quantum publication marker does not identify the latest history snapshot")
    artifacts = marker.get("artifacts")
    artifact = artifacts.get("historical_eco.csv") if isinstance(artifacts, dict) else None
    if not isinstance(artifact, dict):
        raise SyncError("Quantum publication marker has no historical_eco artifact evidence")
    if any(artifact.get(key) != value for key, value in expected.items()):
        raise SyncError("Quantum publication marker does not match the exact historical CSV")


def build_quantum_publication_marker(history_bytes: bytes, marker_bytes: bytes) -> bytes:
    """Add exact Quantum history evidence to a legacy dev-side marker."""
    marker = parse_marker_object(QUANTUM_MARKER_PATH, marker_bytes)
    if marker.get("format") != 1 or isinstance(marker.get("format"), bool):
        raise SyncError("Quantum publication marker has an unsupported format")
    if not str(marker.get("generation_id") or "").strip():
        raise SyncError("Quantum publication marker has no generation id")
    artifacts = marker.get("artifacts")
    if not isinstance(artifacts, dict):
        raise SyncError("Quantum publication marker has no artifacts object")
    artifact = summarize_quantum_history(history_bytes)
    artifacts["historical_eco.csv"] = artifact
    marker["snapshot_blockheight"] = artifact["latest_snapshot"]
    output = (json.dumps(marker, separators=(",", ":"), ensure_ascii=True) + "\n").encode("utf-8")
    validate_quantum_publication_marker(history_bytes, output)
    return output


def parse_iso_calendar_date(value: object, description: str):
    raw = str(value).strip()
    try:
        parsed = datetime.strptime(raw, "%Y-%m-%d").date()
    except ValueError as exc:
        raise SyncError(f"{description} is not a valid ISO date") from exc
    if parsed.isoformat() != raw:
        raise SyncError(f"{description} is not a valid ISO date")
    return parsed


def parse_positive_finite(value: object, description: str) -> float:
    try:
        parsed = float(str(value).strip())
    except ValueError as exc:
        raise SyncError(f"{description} is not a positive finite number") from exc
    if not math.isfinite(parsed) or parsed <= 0:
        raise SyncError(f"{description} is not a positive finite number")
    return parsed


def summarize_dca_comparison_preview(preview_bytes: bytes) -> dict[str, object]:
    """Validate and describe the exact compact BTC/XAU preview artifact."""
    rows = parse_exact_csv_blob(
        DCA_COMPARISON_PREVIEW_PATH,
        preview_bytes,
        DCA_COMPARISON_HEADERS,
    )
    first_date = None
    latest_date = None
    previous_day = None
    for row_number, row in enumerate(rows, start=2):
        day = parse_iso_calendar_date(
            row["date"], f"DCA comparison row {row_number} date"
        )
        if previous_day is not None and day != previous_day + timedelta(days=1):
            raise SyncError(f"DCA comparison row {row_number} is not the next UTC day")
        parse_positive_finite(row["BTC"], f"DCA comparison row {row_number} BTC price")
        parse_positive_finite(row["XAU"], f"DCA comparison row {row_number} XAU price")
        if first_date is None:
            first_date = day.isoformat()
        latest_date = day.isoformat()
        previous_day = day

    return {
        "path": "webapp_data/dca_comparison_preview.csv",
        "sha256": hashlib.sha256(preview_bytes).hexdigest(),
        "rows": len(rows),
        "first_date": first_date,
        "latest_date": latest_date,
    }


def validate_dca_comparison_publication_marker(
    preview_bytes: bytes,
    marker_bytes: bytes,
) -> None:
    """Require the DCA Comparison marker to bind the exact preview CSV."""
    marker = parse_marker_object(DCA_COMPARISON_MARKER_PATH, marker_bytes)
    schema = marker.get("schema_version")
    if isinstance(schema, bool) or schema != 1:
        raise SyncError("DCA comparison publication marker has an unsupported schema")
    artifact = marker.get("artifact")
    if not isinstance(artifact, dict):
        raise SyncError("DCA comparison publication marker has no artifact evidence")
    expected = summarize_dca_comparison_preview(preview_bytes)
    if any(artifact.get(key) != value for key, value in expected.items()):
        raise SyncError("DCA comparison publication marker does not match the exact preview CSV")


def build_dca_comparison_publication_marker(preview_bytes: bytes) -> bytes:
    """Create a fresh minimal marker for a legacy payload-only update."""
    marker = {
        "schema_version": 1,
        "artifact": summarize_dca_comparison_preview(preview_bytes),
    }
    output = (json.dumps(marker, separators=(",", ":"), ensure_ascii=True) + "\n").encode("utf-8")
    validate_dca_comparison_publication_marker(preview_bytes, output)
    return output


def parse_dca_timestamp(value: object, description: str) -> datetime:
    raw = str(value).strip()
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as exc:
        raise SyncError(f"{description} is not a valid timestamp") from exc
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    if parsed.utcoffset() is None:
        raise SyncError(f"{description} is not a valid timestamp")
    return parsed.astimezone(timezone.utc)


def parse_nonnegative_finite(value: object, description: str) -> float:
    try:
        parsed = float(str(value).strip())
    except ValueError as exc:
        raise SyncError(f"{description} is not a non-negative finite number") from exc
    if not math.isfinite(parsed) or parsed < 0:
        raise SyncError(f"{description} is not a non-negative finite number")
    return parsed


def analyze_dca_cost_preview(
    preview_bytes: bytes,
) -> tuple[dict[str, object], dict[str, object]]:
    """Validate every consumed daily DCA column and return marker evidence."""
    rows = parse_exact_csv_blob(DCA_COST_PREVIEW_PATH, preview_bytes, DCA_COST_HEADERS)
    first_date = None
    latest_date = None
    previous_day = None
    previous_days_ago = None
    previous_height = None
    latest_current_price = None
    latest_window_end = None

    for row_number, row in enumerate(rows, start=2):
        days_ago = parse_nonnegative_integer(
            row["days_ago"], f"DCA cost row {row_number} days_ago"
        )
        height = parse_nonnegative_integer(
            row["block_height"], f"DCA cost row {row_number} block height"
        )
        is_price_above = parse_nonnegative_integer(
            row["is_price_above"], f"DCA cost row {row_number} price flag"
        )
        day = parse_iso_calendar_date(row["date_iso"], f"DCA cost row {row_number} date")
        row_timestamp = parse_dca_timestamp(
            row["timestamp_utc"], f"DCA cost row {row_number} timestamp"
        )
        window_end = parse_dca_timestamp(
            row["window_end_timestamp_utc"],
            f"DCA cost row {row_number} window-end timestamp",
        )
        if days_ago < 1:
            raise SyncError(f"DCA cost row {row_number} has an invalid days_ago value")
        if previous_day is not None and day <= previous_day:
            raise SyncError(f"DCA cost row {row_number} is not date-ordered")
        if previous_days_ago is not None and days_ago != previous_days_ago - 1:
            raise SyncError(f"DCA cost row {row_number} has a discontinuous days_ago value")
        if previous_height is not None and height < previous_height:
            raise SyncError(f"DCA cost row {row_number} has a decreasing block height")
        if is_price_above not in (0, 1):
            raise SyncError(f"DCA cost row {row_number} has an invalid price flag")
        if row_timestamp.date() != day or row_timestamp > window_end:
            raise SyncError(f"DCA cost row {row_number} has inconsistent timestamps")
        parse_nonnegative_finite(
            row["years_ago"], f"DCA cost row {row_number} years_ago"
        )
        parse_positive_finite(
            row["historical_price"], f"DCA cost row {row_number} historical price"
        )
        current_price = parse_positive_finite(
            row["current_price"], f"DCA cost row {row_number} current price"
        )
        parse_positive_finite(row["dca_basis"], f"DCA cost row {row_number} DCA basis")
        parse_positive_finite(
            row["invested_usd"], f"DCA cost row {row_number} invested USD"
        )
        parse_positive_finite(row["btc_accum"], f"DCA cost row {row_number} BTC accumulated")
        purchase_count = parse_nonnegative_integer(
            row["purchase_count"], f"DCA cost row {row_number} purchase count"
        )
        if purchase_count < 1:
            raise SyncError(f"DCA cost row {row_number} has an invalid purchase count")

        if first_date is None:
            first_date = day.isoformat()
        latest_date = day.isoformat()
        previous_day = day
        previous_days_ago = days_ago
        previous_height = height
        latest_current_price = current_price
        latest_window_end = window_end

    if previous_days_ago != 1:
        raise SyncError("DCA cost preview does not end at days_ago 1")
    artifact = {
        "path": "webapp_data/daily_dca.csv",
        "sha256": hashlib.sha256(preview_bytes).hexdigest(),
        "rows": len(rows),
        "first_date": first_date,
        "latest_date": latest_date,
    }
    semantics = {
        "latest_block_height": previous_height,
        "latest_price": latest_current_price,
        "latest_timestamp_utc": latest_window_end,
    }
    return artifact, semantics


def summarize_dca_cost_preview(preview_bytes: bytes) -> dict[str, object]:
    return analyze_dca_cost_preview(preview_bytes)[0]


def validate_dca_cost_legacy_bounds(
    marker: dict,
    summary: dict[str, object],
    semantics: dict[str, object],
) -> None:
    source = marker.get("source")
    if not isinstance(source, dict):
        raise SyncError("DCA cost metadata has no legacy source object")
    duration = source.get("duration_days")
    latest_height = source.get("latest_block_height")
    try:
        latest_price = float(source.get("latest_price"))
        latest_timestamp = parse_dca_timestamp(
            source.get("latest_timestamp_utc"), "DCA cost metadata latest timestamp"
        )
    except (TypeError, ValueError) as exc:
        raise SyncError("DCA cost metadata source values are invalid") from exc
    if (
        source.get("start_date") != summary["first_date"]
        or source.get("latest_date") != summary["latest_date"]
        or isinstance(duration, bool)
        or not isinstance(duration, int)
        or duration != summary["rows"]
        or isinstance(latest_height, bool)
        or not isinstance(latest_height, int)
        or latest_height != semantics["latest_block_height"]
        or not math.isfinite(latest_price)
        or not math.isclose(latest_price, semantics["latest_price"], rel_tol=1e-12, abs_tol=1e-9)
        or latest_timestamp != semantics["latest_timestamp_utc"]
    ):
        raise SyncError("DCA cost metadata source bounds do not match the exact daily CSV")


def validate_dca_cost_publication_marker(
    preview_bytes: bytes,
    marker_bytes: bytes,
) -> None:
    """Require DCA Cost metadata to bind the exact daily preview CSV."""
    marker = parse_marker_object(DCA_COST_MARKER_PATH, marker_bytes)
    schema = marker.get("schema_version")
    if isinstance(schema, bool) or schema != 1:
        raise SyncError("DCA cost publication marker has an unsupported schema")
    artifact = marker.get("artifact")
    if not isinstance(artifact, dict):
        raise SyncError("DCA cost publication marker has no artifact evidence")
    expected, semantics = analyze_dca_cost_preview(preview_bytes)
    validate_dca_cost_legacy_bounds(marker, expected, semantics)
    if any(artifact.get(key) != value for key, value in expected.items()):
        raise SyncError("DCA cost publication marker does not match the exact daily CSV")


def build_dca_cost_publication_marker(preview_bytes: bytes, marker_bytes: bytes) -> bytes:
    """Strengthen legacy DCA Cost metadata without dropping its dashboard fields."""
    marker = parse_marker_object(DCA_COST_MARKER_PATH, marker_bytes)
    schema = marker.get("schema_version")
    if isinstance(schema, bool) or schema not in (None, 1):
        raise SyncError("DCA cost publication marker has an unsupported schema")
    summary, semantics = analyze_dca_cost_preview(preview_bytes)
    validate_dca_cost_legacy_bounds(marker, summary, semantics)
    marker["schema_version"] = 1
    marker["artifact"] = summary
    output = (json.dumps(marker, separators=(",", ":"), ensure_ascii=True) + "\n").encode("utf-8")
    validate_dca_cost_publication_marker(preview_bytes, output)
    return output


def synthesize_transition_markers(
    repo: Path,
    changed_paths: list[str],
    index_env: dict[str, str],
) -> None:
    """Complete old-main data snapshots with markers required by new dev code."""
    changed = set(changed_paths)
    if DAILY_PRICE_PATH in changed or DAILY_PRICE_MARKER_PATH in changed:
        # Only enforce/synthesize this boundary once either side of the sync
        # already participates in Stage 4. Repositories predating the marker
        # continue to mirror their legacy asset set unchanged.
        marker_exists = DAILY_PRICE_MARKER_PATH in changed
        if not marker_exists:
            try:
                index_blob_bytes(repo, DAILY_PRICE_MARKER_PATH, index_env)
            except SyncError:
                pass
            else:
                marker_exists = True
        if marker_exists:
            data_bytes = index_blob_bytes(repo, DAILY_PRICE_PATH, index_env)
            if DAILY_PRICE_MARKER_PATH in changed:
                validate_daily_price_publication_marker(
                    data_bytes,
                    index_blob_bytes(repo, DAILY_PRICE_MARKER_PATH, index_env),
                )
            elif DAILY_PRICE_PATH in changed:
                marker_bytes = build_daily_price_publication_marker(data_bytes)
                write_index_blob(repo, DAILY_PRICE_MARKER_PATH, marker_bytes, index_env)

    if CASASCIUS_GENERATION_INPUTS.intersection(changed):
        marker_bytes = build_casascius_right_panel_marker(
            index_blob_bytes(repo, CASASCIUS_TRACKER_PATH, index_env),
            index_blob_bytes(repo, CASASCIUS_RIGHT_PANEL_PATH, index_env),
            allow_replace_existing=CASASCIUS_RIGHT_PANEL_PATH not in changed,
        )
        current_marker = index_blob_bytes(repo, CASASCIUS_RIGHT_PANEL_PATH, index_env)
        if marker_bytes != current_marker:
            write_index_blob(repo, CASASCIUS_RIGHT_PANEL_PATH, marker_bytes, index_env)

    if ISSUANCE_MARKER_PATH not in changed and ISSUANCE_GENERATION_INPUTS.intersection(changed):
        data_bytes = index_blob_bytes(repo, ISSUANCE_DATA_PATH, index_env)
        preview_bytes = index_blob_bytes(repo, ISSUANCE_PREVIEW_PATH, index_env)
        marker_bytes = build_issuance_publication_marker(data_bytes, preview_bytes)
        write_index_blob(repo, ISSUANCE_MARKER_PATH, marker_bytes, index_env)

    if NODE_MARKER_PATH not in changed and NODE_GENERATION_INPUTS.intersection(changed):
        marker_bytes = build_node_publication_marker(
            index_blob_bytes(repo, NODE_HISTORY_PATH, index_env),
            index_blob_bytes(repo, NODE_GROUPED_PATH, index_env),
            index_blob_bytes(repo, NODE_DETAIL_PATH, index_env),
            index_blob_bytes(repo, NODE_LAST_UPDATED_PATH, index_env),
        )
        write_index_blob(repo, NODE_MARKER_PATH, marker_bytes, index_env)

    if DOMINANCE_MARKER_PATH not in changed and DOMINANCE_GENERATION_INPUTS.intersection(changed):
        csv_blobs = {
            name: index_blob_bytes(repo, f"{DOMINANCE_DATA_DIR}/{name}", index_env)
            for name in DOMINANCE_LOCAL_CSV_NAMES
        }
        marker_bytes = build_dominance_publication_marker(
            index_blob_bytes(repo, DOMINANCE_CHART_STATIC_PATH, index_env),
            csv_blobs,
            index_blob_bytes(repo, DOMINANCE_LAST_UPDATED_PATH, index_env),
        )
        write_index_blob(repo, DOMINANCE_MARKER_PATH, marker_bytes, index_env)

    if BIP110_PERIODS_PATH in changed or BIP110_MARKER_PATH in changed:
        periods_bytes = index_blob_bytes(repo, BIP110_PERIODS_PATH, index_env)
        marker_bytes = index_blob_bytes(repo, BIP110_MARKER_PATH, index_env)
        if BIP110_MARKER_PATH in changed:
            # Main supplied this publication boundary. Validate it but retain
            # its exact bytes, including any forward-compatible fields.
            validate_bip110_publication_marker(periods_bytes, marker_bytes)
        elif BIP110_PERIODS_PATH in changed:
            write_index_blob(
                repo,
                BIP110_MARKER_PATH,
                build_bip110_publication_marker(periods_bytes, marker_bytes),
                index_env,
            )

    if QUANTUM_HISTORY_PATH in changed or QUANTUM_MARKER_PATH in changed:
        history_bytes = index_blob_bytes(repo, QUANTUM_HISTORY_PATH, index_env)
        marker_bytes = index_blob_bytes(repo, QUANTUM_MARKER_PATH, index_env)
        if QUANTUM_MARKER_PATH in changed:
            # Never rewrite a source-provided generation marker. Either it
            # describes the candidate bytes exactly or the whole sync fails.
            validate_quantum_publication_marker(history_bytes, marker_bytes)
        elif QUANTUM_HISTORY_PATH in changed:
            write_index_blob(
                repo,
                QUANTUM_MARKER_PATH,
                build_quantum_publication_marker(history_bytes, marker_bytes),
                index_env,
            )

    if DCA_COMPARISON_PREVIEW_PATH in changed or DCA_COMPARISON_MARKER_PATH in changed:
        preview_bytes = index_blob_bytes(repo, DCA_COMPARISON_PREVIEW_PATH, index_env)
        if DCA_COMPARISON_MARKER_PATH in changed:
            validate_dca_comparison_publication_marker(
                preview_bytes,
                index_blob_bytes(repo, DCA_COMPARISON_MARKER_PATH, index_env),
            )
        elif DCA_COMPARISON_PREVIEW_PATH in changed:
            write_index_blob(
                repo,
                DCA_COMPARISON_MARKER_PATH,
                build_dca_comparison_publication_marker(preview_bytes),
                index_env,
            )

    if DCA_COST_PREVIEW_PATH in changed or DCA_COST_MARKER_PATH in changed:
        preview_bytes = index_blob_bytes(repo, DCA_COST_PREVIEW_PATH, index_env)
        marker_bytes = index_blob_bytes(repo, DCA_COST_MARKER_PATH, index_env)
        if DCA_COST_MARKER_PATH in changed:
            source_marker = parse_marker_object(DCA_COST_MARKER_PATH, marker_bytes)
            is_legacy_marker = (
                "schema_version" not in source_marker and "artifact" not in source_marker
            )
            if is_legacy_marker:
                write_index_blob(
                    repo,
                    DCA_COST_MARKER_PATH,
                    build_dca_cost_publication_marker(preview_bytes, marker_bytes),
                    index_env,
                )
            else:
                validate_dca_cost_publication_marker(preview_bytes, marker_bytes)
        elif DCA_COST_PREVIEW_PATH in changed:
            raise SyncError(
                "DCA cost daily preview changed without its publication metadata"
            )


def create_data_snapshot_commit(
    repo: Path,
    dev_head: str,
    source_commit: str,
    paths: list[str],
) -> str | None:
    descriptor, index_name = tempfile.mkstemp(prefix="wsb-dev-data-index-", dir="/tmp")
    os.close(descriptor)
    index_path = Path(index_name)
    index_path.unlink(missing_ok=True)
    index_env = {"GIT_INDEX_FILE": str(index_path)}
    try:
        run_git(repo, ["read-tree", dev_head], env=index_env)
        for path in paths:
            entry = source_tree_entry(repo, source_commit, path)
            if entry is None:
                run_git(repo, ["update-index", "--force-remove", "--", path], env=index_env)
                continue
            mode, object_id = entry
            run_git(
                repo,
                ["update-index", "--add", "--cacheinfo", mode, object_id, path],
                env=index_env,
            )

        # During marker rollouts, production main can still update legacy data
        # without the publication evidence now required by dev/work. Complete
        # those boundaries only inside this temporary index from exact candidate
        # blobs. The normal dirty-path overlap check still runs before merge, so
        # no uncommitted worktree file is rewritten or stashed.
        synthesize_transition_markers(repo, paths, index_env)

        snapshot_tree = git_text(repo, ["write-tree"], env=index_env)
        dev_tree = git_text(repo, ["rev-parse", f"{dev_head}^{{tree}}"])
        if snapshot_tree == dev_tree:
            return None

        short_source = source_commit[:12]
        identity_env = {
            "GIT_AUTHOR_NAME": "WSB Data Sync",
            "GIT_AUTHOR_EMAIL": "automation@wickedsmartbitcoin.local",
            "GIT_COMMITTER_NAME": "WSB Data Sync",
            "GIT_COMMITTER_EMAIL": "automation@wickedsmartbitcoin.local",
        }
        return git_text(
            repo,
            ["commit-tree", snapshot_tree, "-p", dev_head],
            env=identity_env,
            input_text=f"{SYNC_COMMIT_PREFIX} from main {short_source}\n",
        )
    finally:
        index_path.unlink(missing_ok=True)


def snapshot_commit_paths(repo: Path, dev_head: str, snapshot_commit: str) -> set[str]:
    return git_nul_paths(
        repo,
        ["diff", "--no-renames", "--name-only", "-z", dev_head, snapshot_commit],
    )


def update_sync_ref(repo: Path, source_commit: str) -> None:
    run_git(repo, ["update-ref", SYNC_SOURCE_REF, source_commit])


def synchronize(
    source_repo: Path,
    source_ref: str,
    dev_repo: Path,
    dev_branch: str,
    *,
    dry_run: bool = False,
) -> SyncOutcome:
    source_repo = source_repo.resolve()
    dev_repo = dev_repo.resolve()
    if not source_repo.is_dir() or not dev_repo.is_dir():
        raise SyncError("source or dev repository directory is missing")

    source_commit = resolve_commit(source_repo, source_ref)
    source_commit = ensure_source_object(dev_repo, source_repo, source_ref, source_commit)
    current_branch = git_text(dev_repo, ["symbolic-ref", "--quiet", "--short", "HEAD"])
    if current_branch != dev_branch:
        raise SyncError(f"dev worktree is on {current_branch!r}, expected {dev_branch!r}; deferring data sync")
    ensure_no_git_operation(dev_repo)

    dev_head = resolve_commit(dev_repo, "HEAD")
    last_source = optional_ref(dev_repo, SYNC_SOURCE_REF)
    baseline = last_source or git_text(dev_repo, ["merge-base", dev_head, source_commit])
    candidates = changed_data_paths(dev_repo, baseline, source_commit)
    if not candidates:
        if not dry_run:
            update_sync_ref(dev_repo, source_commit)
        return SyncOutcome("up-to-date", source_commit, dev_head)

    snapshot_commit = create_data_snapshot_commit(dev_repo, dev_head, source_commit, candidates)
    if snapshot_commit is None:
        if not dry_run:
            update_sync_ref(dev_repo, source_commit)
        return SyncOutcome("up-to-date", source_commit, dev_head)

    update_paths = snapshot_commit_paths(dev_repo, dev_head, snapshot_commit)
    overlap = overlapping_paths(dirty_paths(dev_repo), update_paths)
    if overlap:
        print("⏭️ Dev data sync deferred; uncommitted work overlaps production data paths:")
        for path in overlap:
            print(f"   - {path}")
        return SyncOutcome("deferred-overlap", source_commit, dev_head, tuple(sorted(update_paths)))

    if dry_run:
        return SyncOutcome("would-sync", source_commit, dev_head, tuple(sorted(update_paths)))

    ensure_no_git_operation(dev_repo)
    if resolve_commit(dev_repo, "HEAD") != dev_head:
        raise SyncError("dev HEAD changed during data sync; deferring until the next deploy")
    if git_text(dev_repo, ["symbolic-ref", "--quiet", "--short", "HEAD"]) != dev_branch:
        raise SyncError("dev branch changed during data sync; deferring until the next deploy")

    merge = run_git(dev_repo, ["merge", "--ff-only", snapshot_commit], check=False)
    if merge.returncode != 0:
        detail = merge.stderr.strip() or merge.stdout.strip() or f"exit {merge.returncode}"
        raise SyncError(f"dev data fast-forward was refused without changing the worktree: {detail}")

    merged_head = resolve_commit(dev_repo, "HEAD")
    if merged_head != snapshot_commit:
        raise SyncError("dev data sync did not land at the expected snapshot commit")
    update_sync_ref(dev_repo, source_commit)
    return SyncOutcome("synced", source_commit, merged_head, tuple(sorted(update_paths)))


def acquire_lock(path: Path) -> bool:
    path.parent.mkdir(parents=True, exist_ok=True)
    while True:
        try:
            descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            with os.fdopen(descriptor, "w") as handle:
                handle.write(f"{os.getpid()}\n{int(time.time())}\n")
            return True
        except FileExistsError:
            try:
                lines = path.read_text().splitlines()
                pid = int(lines[0])
                os.kill(pid, 0)
                age = time.time() - path.stat().st_mtime
                if age <= STALE_LOCK_SECONDS:
                    return False
            except (OSError, ValueError, IndexError):
                pass
            path.unlink(missing_ok=True)


def parse_args() -> argparse.Namespace:
    script_repo = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-repo", type=Path, default=script_repo)
    parser.add_argument("--source-ref", default="HEAD")
    parser.add_argument("--dev-repo", type=Path, default=script_repo.parent / "wickedsmartbitcoin-dev")
    parser.add_argument("--dev-branch", default=DEFAULT_DEV_BRANCH)
    parser.add_argument("--lock-path", type=Path, default=DEFAULT_LOCK_PATH)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not acquire_lock(args.lock_path):
        print(f"⏭️ Dev data sync already running; leaving {args.dev_branch} untouched.")
        return 0
    try:
        outcome = synchronize(
            args.source_repo,
            args.source_ref,
            args.dev_repo,
            args.dev_branch,
            dry_run=args.dry_run,
        )
        if outcome.status == "synced":
            print(
                f"✅ Synced {len(outcome.paths)} production data file(s) into {args.dev_branch} "
                f"at {outcome.dev_commit[:12]}; uncommitted non-data work was preserved in place."
            )
        elif outcome.status == "would-sync":
            print(f"ℹ️ Dry run: would sync {len(outcome.paths)} data file(s) into {args.dev_branch}.")
        elif outcome.status == "up-to-date":
            print(f"✅ {args.dev_branch} production data is already current.")
        return 0
    except SyncError as exc:
        print(f"⚠️ Dev data sync skipped safely: {exc}")
        return 0
    finally:
        args.lock_path.unlink(missing_ok=True)


if __name__ == "__main__":
    raise SystemExit(main())
