#!/usr/bin/env python3
"""Run the Quantum Exposure snapshot pipeline when the next 1000-block interval is available.

Workflow:
1. Compute safe available freeze height from chain and archive tables.
2. Compare against the next 1000-block target after the latest local snapshot.
3. If due, run the full pipeline pinned to that freeze height.
4. Clean and fill identity/details for the new snapshot.
5. Archive eligible prior non-50k snapshots, deferring the browser-published one.
6. Refresh blockheight lookup and regenerate ECO/index outputs.
7. Publish the finalized marker and sync runtime/data/marker to the standalone repo.

Run in terminal with:
source /Users/wicked/Projects/repos/animations-dev/.venv/bin/activate
python /Users/wicked/Projects/repos/animations-dev/webapps/quantum_exposure/pipeline/run_daily_snapshot_pipeline.py
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import psycopg2
from dotenv import load_dotenv
from pipeline_paths import (
    PIPELINE_DIR,
    QUANTUM_DIR,
    REPO_ROOT,
    resolve_env_file,
    resolve_standalone_repo_dir,
)
from publish_generation import (
    PUBLICATION_MARKER_FILENAME,
    copy_generation_marker,
    publish_generation_marker,
    read_published_snapshot_height,
    write_empty_archive_catalogs,
)

WEBAPP_DATA_DIR = QUANTUM_DIR / "webapp_data"
ARCHIVED_SNAPSHOTS_DIR = WEBAPP_DATA_DIR / "archived"

DEFAULT_ENV_FILE = resolve_env_file()
INTERVAL = 1_000
KEEP_INTERVAL = 50_000
SCHEMA = "public"
STXO_NAME_RE = re.compile(r"^stxos_(\d+)_(\d+)_archive$")


@dataclass(frozen=True)
class StxoPartition:
    lo: int
    hi: int
    name: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run daily quantum exposure pipeline at 1000-block intervals"
    )
    parser.add_argument(
        "--env-file",
        default=str(Path(os.getenv("QUANTUM_PIPELINE_ENV_FILE", str(DEFAULT_ENV_FILE)))),
        help="Path to .env file for PostgreSQL credentials",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Run pipeline for next interval even if safe freeze check is not yet met",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show intended actions without running commands or deleting snapshots",
    )
    return parser.parse_args()


def connect_db() -> psycopg2.extensions.connection:
    conn = psycopg2.connect(
        host=os.getenv("POSTGRES_HOST"),
        database=os.getenv("POSTGRES_DB"),
        user=os.getenv("POSTGRES_USER"),
        password=os.getenv("POSTGRES_PASSWORD"),
    )
    conn.autocommit = False
    return conn


def qualify(schema: str, table: str) -> str:
    return f'"{schema}"."{table}"'


def fetch_one(cur, sql: str, params=None):
    cur.execute(sql, params or ())
    return cur.fetchone()


def list_stxo_partitions(cur) -> list[StxoPartition]:
    cur.execute(
        """
        SELECT tablename
        FROM pg_catalog.pg_tables
        WHERE schemaname = %s
          AND tablename ~ '^stxos_[0-9]+_[0-9]+_archive$'
        ORDER BY tablename;
        """,
        (SCHEMA,),
    )
    parts: list[StxoPartition] = []
    for (name,) in cur.fetchall():
        match = STXO_NAME_RE.match(name)
        if not match:
            continue
        parts.append(StxoPartition(int(match.group(1)), int(match.group(2)), name))
    parts.sort(key=lambda item: (item.lo, item.hi))
    if not parts:
        raise RuntimeError("No stxos_*_archive tables found")
    return parts


def compute_safe_freeze_height(cur) -> int:
    latest_part = list_stxo_partitions(cur)[-1]

    blockheader_tip = fetch_one(
        cur,
        f"SELECT MAX(blockheight) FROM {qualify(SCHEMA, 'blockheader')};",
    )[0]
    outputs_tip = fetch_one(
        cur,
        f"SELECT MAX(blockheight) FROM {qualify(SCHEMA, 'outputs')};",
    )[0]
    latest_stxo_block_max = fetch_one(
        cur,
        f"SELECT MAX(blockheight) FROM {qualify(SCHEMA, latest_part.name)};",
    )[0]
    latest_stxo_spending_max = fetch_one(
        cur,
        f"SELECT MAX(spendingblock) FROM {qualify(SCHEMA, latest_part.name)};",
    )[0]

    candidates = [
        int(blockheader_tip) if blockheader_tip is not None else None,
        int(outputs_tip) if outputs_tip is not None else None,
        int(latest_part.hi),
        int(latest_stxo_block_max) if latest_stxo_block_max is not None else None,
        int(latest_stxo_spending_max) if latest_stxo_spending_max is not None else None,
    ]
    candidates = [value for value in candidates if value is not None]
    if not candidates:
        raise RuntimeError("Could not determine safe freeze height")

    return min(candidates)


def get_chain_tip_height(cur) -> int:
    row = fetch_one(cur, f"SELECT MAX(blockheight) FROM {qualify(SCHEMA, 'blockheader')};")
    if row is None or row[0] is None:
        raise RuntimeError("Could not determine chain tip from blockheader")
    return int(row[0])


def latest_local_snapshot_height() -> int:
    heights: list[int] = []
    if not WEBAPP_DATA_DIR.exists():
        raise RuntimeError(f"Missing webapp data directory: {WEBAPP_DATA_DIR}")

    for entry in WEBAPP_DATA_DIR.iterdir():
        if not entry.is_dir() or not entry.name.isdigit():
            continue
        ge1_csv = entry / "dashboard_pubkeys_ge_1btc.csv"
        if ge1_csv.exists():
            heights.append(int(entry.name))

    if not heights:
        raise RuntimeError("No existing snapshot folders with dashboard_pubkeys_ge_1btc.csv found")

    return max(heights)


def run_command(command: list[str], cwd: Path, env: dict[str, str], dry_run: bool) -> None:
    rendered = " ".join(command)
    print(f"\n$ ({cwd}) {rendered}")
    if dry_run:
        return

    subprocess.run(command, cwd=cwd, env=env, check=True)


def archive_prior_non_50k_snapshots(target_height: int, dry_run: bool) -> list[int]:
    archived: list[int] = []
    published_height = read_published_snapshot_height(WEBAPP_DATA_DIR)
    if not dry_run:
        ARCHIVED_SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)

    for entry in WEBAPP_DATA_DIR.iterdir():
        if not entry.is_dir() or not entry.name.isdigit():
            continue

        height = int(entry.name)
        ge1_csv = entry / "dashboard_pubkeys_ge_1btc.csv"
        if not ge1_csv.exists():
            continue

        if height == target_height:
            continue
        # Keep the generation browsers are still reading in its active URL.
        # It becomes eligible on the following run, after a newer marker has
        # already been installed. This deliberately defers archive by one
        # generation instead of creating a marker-to-missing-directory window.
        if height == published_height:
            continue
        if height % KEEP_INTERVAL == 0:
            continue

        archived.append(height)
        if dry_run:
            continue

        archive_target = ARCHIVED_SNAPSHOTS_DIR / entry.name
        if archive_target.exists():
            shutil.rmtree(archive_target)
        shutil.move(str(entry), str(archive_target))

    archived.sort()
    return archived


def sync_to_standalone_repo(dry_run: bool) -> None:
    standalone_repo_dir = resolve_standalone_repo_dir()
    standalone_quantum_dir = standalone_repo_dir / "webapps" / "quantum_exposure"
    standalone_shared_dir = standalone_repo_dir / "webapps" / "shared"
    standalone_data_dir = standalone_quantum_dir / "webapp_data"

    if not standalone_quantum_dir.exists():
        print(f"Standalone sync skipped: target path not found: {standalone_quantum_dir}")
        return

    print(f"Syncing active files to standalone repo: {standalone_quantum_dir}")

    required_runtime_sources = [
        QUANTUM_DIR / "dashboard.html",
        QUANTUM_DIR / "dashboard_app.js",
        QUANTUM_DIR.parent / "shared" / "webapp_data_auto_refresh.js",
    ]
    missing_runtime_sources = [
        str(path) for path in required_runtime_sources if not path.is_file()
    ]
    if missing_runtime_sources:
        raise RuntimeError(
            "Standalone Quantum sync is missing required runtime files: "
            + ", ".join(missing_runtime_sources)
        )

    files_to_copy = [
        (QUANTUM_DIR / "dashboard.html", standalone_quantum_dir / "dashboard.html"),
        (QUANTUM_DIR / "dashboard_app.js", standalone_quantum_dir / "dashboard_app.js"),
        (
            QUANTUM_DIR.parent / "shared" / "webapp_data_auto_refresh.js",
            standalone_shared_dir / "webapp_data_auto_refresh.js",
        ),
        (WEBAPP_DATA_DIR / "latest_snapshot.txt", standalone_data_dir / "latest_snapshot.txt"),
        (WEBAPP_DATA_DIR / "snapshots_index.csv", standalone_data_dir / "snapshots_index.csv"),
        (WEBAPP_DATA_DIR / "historical_eco.csv", standalone_data_dir / "historical_eco.csv"),
        (WEBAPP_DATA_DIR / "blockheight_datetime_lookup.csv", standalone_data_dir / "blockheight_datetime_lookup.csv"),
    ]

    copied_count = 0
    for source, target in files_to_copy:
        if not source.exists():
            continue
        copied_count += 1
        if dry_run:
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)

    active_snapshot_dirs: list[str] = []
    for entry in WEBAPP_DATA_DIR.iterdir():
        if not entry.is_dir() or not entry.name.isdigit():
            continue
        if not (entry / "dashboard_pubkeys_ge_1btc.csv").exists():
            continue
        active_snapshot_dirs.append(entry.name)

    for snapshot_name in active_snapshot_dirs:
        source_snapshot_dir = WEBAPP_DATA_DIR / snapshot_name
        target_snapshot_dir = standalone_data_dir / snapshot_name

        if not dry_run:
            target_snapshot_dir.mkdir(parents=True, exist_ok=True)

        for source_file in source_snapshot_dir.iterdir():
            if source_file.is_dir():
                continue
            target_file = target_snapshot_dir / source_file.name
            if dry_run:
                continue
            shutil.copy2(source_file, target_file)

    # The standalone bundle intentionally omits the large archived snapshot
    # payloads. Install an explicit empty catalog pair instead of copying
    # source catalogs whose rows would point at absent directories. This runs
    # after regular copies and immediately before the marker boundary.
    standalone_archived_dir = standalone_data_dir / "archived"
    if not dry_run:
        write_empty_archive_catalogs(standalone_data_dir)
        if standalone_archived_dir.exists():
            shutil.rmtree(standalone_archived_dir)

    # This is the standalone publication boundary. Copy it only after every
    # referenced data file and snapshot directory has finished syncing, and use
    # an atomic replacement so readers see either the old or new generation.
    marker_source = WEBAPP_DATA_DIR / PUBLICATION_MARKER_FILENAME
    if marker_source.exists():
        copied_count += 1
        if not dry_run:
            copy_generation_marker(WEBAPP_DATA_DIR, standalone_data_dir)
    else:
        print(f"Standalone publication marker missing: {marker_source}")
        if not dry_run:
            raise RuntimeError("Refusing to finalize standalone sync without a publication marker.")

    # Keep the generation referenced by the old marker available throughout
    # the sync. Stale active directories are safe to remove only after the new
    # marker has been installed (or at the corresponding point in a dry run).
    deleted_count = 0
    if standalone_data_dir.exists():
        for entry in standalone_data_dir.iterdir():
            if not entry.is_dir() or not entry.name.isdigit():
                continue
            if entry.name in active_snapshot_dirs:
                continue
            deleted_count += 1
            if dry_run:
                continue
            shutil.rmtree(entry)

    print(f"Standalone sync copied files : {copied_count}")
    print(f"Standalone sync active snaps : {len(active_snapshot_dirs)}")
    print(f"Standalone sync removed snaps: {deleted_count}")


def main() -> None:
    args = parse_args()
    load_dotenv(dotenv_path=Path(args.env_file))

    latest_snapshot = latest_local_snapshot_height()
    next_interval = ((latest_snapshot // INTERVAL) + 1) * INTERVAL

    print("=== Fast interval preflight ===")
    print(f"Latest local snapshot     : {latest_snapshot:,}")
    print(f"Next 1000-block target    : {next_interval:,}")

    conn = connect_db()
    try:
        with conn.cursor() as cur:
            chain_tip = get_chain_tip_height(cur)

            print(f"Current chain tip         : {chain_tip:,}")
            if not args.force and chain_tip < next_interval:
                print("No pipeline run needed: next 1000-block interval has not passed yet.")
                conn.rollback()
                return

            if args.force and chain_tip < next_interval:
                print("Force mode enabled: continuing even though chain tip is below next interval target.")

            print("Interval reached: continuing with freeze safety checks...")
            safe_freeze = compute_safe_freeze_height(cur)
        conn.rollback()
    finally:
        conn.close()

    print("=== Freeze validation ===")
    print(f"Safe freeze height        : {safe_freeze:,}")

    if not args.force and safe_freeze < next_interval:
        print("No pipeline run needed: safe freeze has not reached next 1000 interval yet.")
        return

    if args.force and safe_freeze < next_interval:
        print("Force mode enabled: continuing even though safe freeze is below next interval target.")

    runtime_env = os.environ.copy()
    runtime_env["QUANTUM_PIPELINE_ENV_FILE"] = str(Path(args.env_file))
    runtime_env["FREEZE_HEIGHT"] = str(next_interval)
    runtime_env["RUN_ANALYSIS"] = "1"
    runtime_env["PYTHON_BIN"] = sys.executable

    run_command(
        ["bash", "run_exposure_table_build.sh"],
        cwd=PIPELINE_DIR,
        env=runtime_env,
        dry_run=args.dry_run,
    )

    run_command(
        [sys.executable, str(PIPELINE_DIR / "normalize_snapshot_csvs.py"), str(next_interval)],
        cwd=PIPELINE_DIR,
        env=runtime_env,
        dry_run=args.dry_run,
    )

    run_command(
        [sys.executable, str(PIPELINE_DIR / "sync_display_group_identity_details.py"), str(next_interval)],
        cwd=PIPELINE_DIR,
        env=runtime_env,
        dry_run=args.dry_run,
    )

    run_command(
        [sys.executable, str(PIPELINE_DIR / "sync_identity_consensus_from_snapshots.py"), str(next_interval)],
        cwd=PIPELINE_DIR,
        env=runtime_env,
        dry_run=args.dry_run,
    )

    expected_ge1_csv = WEBAPP_DATA_DIR / str(next_interval) / "dashboard_pubkeys_ge_1btc.csv"
    if not args.dry_run and not expected_ge1_csv.exists():
        raise RuntimeError(f"Pipeline completed but snapshot output is missing: {expected_ge1_csv}")

    # Diff summary must run after identity consensus and before archiving so the
    # report uses final labels while the prior snapshot is still in the live dir.
    run_command(
        [sys.executable, str(PIPELINE_DIR / "summarize_snapshot_diff.py"), str(next_interval)],
        cwd=PIPELINE_DIR,
        env=runtime_env,
        dry_run=args.dry_run,
    )

    archived_snapshots = archive_prior_non_50k_snapshots(next_interval, dry_run=args.dry_run)
    if archived_snapshots:
        print(f"Archived non-50k snapshots: {archived_snapshots}")
    else:
        print("No non-50k snapshots needed archiving.")

    run_command(
        [sys.executable, str(PIPELINE_DIR / "update_blockheight_datetime_lookup.py")],
        cwd=PIPELINE_DIR,
        env=runtime_env,
        dry_run=args.dry_run,
    )

    run_command(
        [sys.executable, str(PIPELINE_DIR / "regenerate_snapshot_indexes.py")],
        cwd=PIPELINE_DIR,
        env=runtime_env,
        dry_run=args.dry_run,
    )

    # Only this orchestrator publishes a browser-visible generation. The
    # analysis step updates latest_snapshot.txt earlier because downstream
    # corrections need it, but that internal pointer is not a publication
    # signal. Any failure above leaves the old published marker untouched.
    print("\n=== Publishing finalized dashboard generation ===")
    if args.dry_run:
        print(f"[dry-run] would update {WEBAPP_DATA_DIR / PUBLICATION_MARKER_FILENAME}")
    else:
        marker_text = publish_generation_marker(
            WEBAPP_DATA_DIR,
            reason="daily_snapshot_pipeline",
        )
        print(f"Published generation marker: {marker_text.strip()}")

    # The standalone repo receives all generation files first and the marker
    # last, preventing a deployed reader from observing a partial sync.
    print("\n=== Final standalone repo sync ===")
    sync_to_standalone_repo(dry_run=args.dry_run)

    print("\nDaily 1000-block pipeline flow completed successfully.")


if __name__ == "__main__":
    main()
