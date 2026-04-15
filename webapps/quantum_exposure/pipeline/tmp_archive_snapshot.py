#!/usr/bin/env python3
"""Temporarily archive one active snapshot and refresh generated artifacts."""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

from run_daily_snapshot_pipeline import sync_to_standalone_repo

PIPELINE_DIR = Path(__file__).resolve().parent
WEBAPP_DATA_DIR = PIPELINE_DIR.parent / "webapp_data"
ARCHIVED_DIR = WEBAPP_DATA_DIR / "archived"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Move one snapshot height into archived and refresh derived files"
    )
    parser.add_argument("height", type=int, help="Snapshot height to archive")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show actions without moving files or running refresh scripts",
    )
    parser.add_argument(
        "--skip-standalone-sync",
        action="store_true",
        help="Do not sync refreshed files into the standalone repo",
    )
    return parser.parse_args()


def run_script(script_name: str, dry_run: bool) -> None:
    command = [sys.executable, str(PIPELINE_DIR / script_name)]
    print("$", " ".join(command))
    if dry_run:
        return
    subprocess.run(command, cwd=PIPELINE_DIR, check=True)


def main() -> None:
    args = parse_args()
    height_str = str(args.height)

    source_dir = WEBAPP_DATA_DIR / height_str
    archived_target = ARCHIVED_DIR / height_str
    source_csv = source_dir / "dashboard_pubkeys_ge_1btc.csv"

    if not source_dir.is_dir() or not source_csv.exists():
        raise RuntimeError(f"Active snapshot not found for height {args.height}: {source_dir}")

    print(f"source snapshot: {source_dir}")
    print(f"archive target : {archived_target}")

    if archived_target.exists():
        raise RuntimeError(
            f"Archived snapshot already exists at {archived_target}. "
            "Remove it first or choose another height."
        )

    if args.dry_run:
        print("[dry-run] would move snapshot into archived")
    else:
        ARCHIVED_DIR.mkdir(parents=True, exist_ok=True)
        shutil.move(str(source_dir), str(archived_target))
        print("Moved snapshot into archived.")

    print("\nRefreshing generated files...")
    run_script("update_blockheight_datetime_lookup.py", args.dry_run)
    run_script("generate_eco_files.py", args.dry_run)

    if args.skip_standalone_sync:
        print("Standalone sync skipped by flag.")
    else:
        print("\nSyncing refreshed files to standalone repo...")
        sync_to_standalone_repo(dry_run=args.dry_run)

    print("\nDone.")


if __name__ == "__main__":
    main()