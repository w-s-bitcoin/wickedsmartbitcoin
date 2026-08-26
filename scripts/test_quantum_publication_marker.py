#!/usr/bin/env python3
"""Regression checks for the Quantum finalized-generation publication marker."""

from __future__ import annotations

import csv
import hashlib
import importlib.util
import json
import shutil
import sys
import tempfile
import types
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PIPELINE_DIR = ROOT / "webapps" / "quantum_exposure" / "pipeline"
sys.path.insert(0, str(PIPELINE_DIR))

# The boundary helpers under test are filesystem-only, but the daily
# orchestrator also exposes DB entry points. Keep this regression runnable with
# the system Python used by CI even when optional pipeline dependencies live
# only in the onchain virtualenv.
if importlib.util.find_spec("psycopg2") is None:
    psycopg2_stub = types.ModuleType("psycopg2")
    psycopg2_stub.extensions = types.SimpleNamespace(connection=object)
    psycopg2_stub.connect = lambda *args, **kwargs: (_ for _ in ()).throw(
        RuntimeError("psycopg2 stub cannot connect")
    )
    sys.modules["psycopg2"] = psycopg2_stub
if importlib.util.find_spec("dotenv") is None:
    dotenv_stub = types.ModuleType("dotenv")
    dotenv_stub.load_dotenv = lambda *args, **kwargs: None
    sys.modules["dotenv"] = dotenv_stub

from publish_generation import (  # noqa: E402
    ARCHIVED_INDEX_HEADERS,
    HISTORICAL_BALANCE_FILTERS,
    HISTORICAL_ECO_HEADERS,
    HISTORICAL_SCRIPT_TYPES,
    HISTORICAL_SPEND_ACTIVITIES,
    PUBLICATION_MARKER_FILENAME,
    REQUIRED_SNAPSHOT_FILES,
    copy_generation_marker,
    publish_generation_marker,
    write_empty_archive_catalogs,
)
import archive_snapshot_and_refresh_indexes as archive_tool  # noqa: E402
import run_daily_snapshot_pipeline as daily_pipeline  # noqa: E402
import run_historical_dashboard_analysis as historical_pipeline  # noqa: E402


CSV_FIXTURES = {
    "dashboard_snapshot_meta.csv": (
        [
            "snapshot_blockheight",
            "snapshot_time",
            "one_year_ago_blockheight",
            "one_year_ago_block_time",
        ],
        lambda height: [str(height), "1785841728", "908551", "1754304844"],
    ),
    "dashboard_pubkeys_aggregates.csv": (
        [
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
        ],
        lambda _height: [
            "all",
            "All",
            "all",
            "2426912",
            "36997155",
            "331789879676662",
            "2432514",
            "36997155",
            "331789879676662",
            "6046.36",
        ],
    ),
    "dashboard_pubkeys_ge_1btc_top100.csv": (
        [
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
        ],
        lambda _height: [
            "34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo",
            '{"P2SH":24859759182984}',
            "inactive",
            "5085",
            "546288",
            "770774",
            "None",
            "Binance",
            "1539867558",
            "1673072134",
        ],
    ),
    "dashboard_pubkeys_ge_1btc.csv": (
        [
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
        ],
        lambda _height: [
            "3M219KR5vEneNb47ewrPfWyb5jQ2DjxRP6",
            '{"P2SH":18527491912571}',
            "active",
            "189",
            "549926",
            "959826",
            "None",
            "Binance",
            "1542118262",
            "1785150592",
        ],
    ),
}

HISTORICAL_ECO_HEADERS = [
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
]


def write_historical_eco_fixture(
    data_dir: Path,
    height: int,
    *,
    header_only: bool = False,
    row_height: int | None = None,
    additional_heights: tuple[int, ...] = (),
) -> None:
    with (data_dir / "historical_eco.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(HISTORICAL_ECO_HEADERS)
        if not header_only:
            heights = (height if row_height is None else row_height, *additional_heights)
            for fixture_height in heights:
                for balance_filter in sorted(HISTORICAL_BALANCE_FILTERS):
                    for script_type in sorted(HISTORICAL_SCRIPT_TYPES):
                        for spend_activity in sorted(HISTORICAL_SPEND_ACTIVITIES):
                            writer.writerow([
                                str(fixture_height),
                                balance_filter,
                                script_type,
                                spend_activity,
                                "59163976",
                                "165883314",
                                "2006549801041305",
                                "16304527",
                                "102558387",
                                "706189419650082",
                                "20316.62",
                            ])


def write_snapshot_fixture(
    data_dir: Path,
    height: int,
    filename: str,
    *,
    header_only: bool = False,
    metadata_height: int | None = None,
    omit_header: str | None = None,
    row_count: int | None = None,
) -> None:
    original_headers, row_factory = CSV_FIXTURES[filename]
    original_headers = list(original_headers)
    row = row_factory(metadata_height if metadata_height is not None else height)
    headers = list(original_headers)
    if omit_header is not None:
        omit_index = headers.index(omit_header)
        headers = headers[:omit_index] + headers[omit_index + 1 :]

    snapshot_dir = data_dir / str(height)
    snapshot_dir.mkdir(parents=True, exist_ok=True)
    with (snapshot_dir / filename).open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(headers)
        if not header_only:
            base_values = dict(zip(original_headers, row))
            if filename == "dashboard_pubkeys_aggregates.csv" and row_count is None:
                for balance_filter in sorted(HISTORICAL_BALANCE_FILTERS):
                    for script_type in sorted(HISTORICAL_SCRIPT_TYPES):
                        for spend_activity in sorted(HISTORICAL_SPEND_ACTIVITIES):
                            fixture_values = dict(base_values)
                            fixture_values.update(
                                balance_filter=balance_filter,
                                script_type_filter=script_type,
                                spend_activity_filter=spend_activity,
                            )
                            writer.writerow([fixture_values[header] for header in headers])
                return
            if row_count is None:
                row_count = {
                    "dashboard_pubkeys_ge_1btc_top100.csv": 100,
                    "dashboard_pubkeys_ge_1btc.csv": 120,
                }.get(filename, 1)
            for index in range(max(0, row_count)):
                fixture_values = dict(base_values)
                if filename in {
                    "dashboard_pubkeys_ge_1btc_top100.csv",
                    "dashboard_pubkeys_ge_1btc.csv",
                }:
                    fixture_values["display_group_ids"] = f"fixture-display-group-{index:03d}"
                writer.writerow([fixture_values[header] for header in headers])


def seed_snapshot_files(data_dir: Path, height: int) -> None:
    snapshot_dir = data_dir / str(height)
    snapshot_dir.mkdir(parents=True, exist_ok=True)
    for filename in REQUIRED_SNAPSHOT_FILES:
        write_snapshot_fixture(data_dir, height, filename)


def seed_complete_generation(data_dir: Path, height: int) -> None:
    seed_snapshot_files(data_dir, height)
    (data_dir / "latest_snapshot.txt").write_text(str(height), encoding="utf-8")
    (data_dir / "snapshots_index.csv").write_text(
        f"snapshot_blockheight,snapshot_time\n{height},1234567890\n",
        encoding="utf-8",
    )
    write_historical_eco_fixture(data_dir, height)


def assert_publication_rejected_without_marker_change(
    data_dir: Path,
    marker_path: Path,
    expected_marker: str,
    reason: str,
) -> None:
    try:
        publish_generation_marker(data_dir, reason=reason)
    except RuntimeError:
        pass
    else:
        raise AssertionError(f"Invalid Quantum generation was published: {reason}")
    if marker_path.read_text(encoding="utf-8") != expected_marker:
        raise AssertionError(f"Failed publication changed the prior marker: {reason}")


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="wsb-quantum-publish-") as temp_name:
        root = Path(temp_name)
        source = root / "source"
        target = root / "standalone"
        source.mkdir()
        target.mkdir()
        seed_complete_generation(source, 961_000)
        seed_complete_generation(target, 961_000)

        marker_path = source / PUBLICATION_MARKER_FILENAME
        old_marker = '{"format":1,"generation_id":"old","snapshot_blockheight":950000}\n'
        marker_path.write_text(old_marker, encoding="utf-8")

        # Incomplete generation validation must leave the already-published
        # marker byte-for-byte unchanged.
        missing_path = source / "961000" / REQUIRED_SNAPSHOT_FILES[-1]
        missing_path.unlink()
        assert_publication_rejected_without_marker_change(
            source,
            marker_path,
            old_marker,
            "test-missing-file",
        )
        write_snapshot_fixture(source, 961_000, REQUIRED_SNAPSHOT_FILES[-1])

        header_only_filename = "dashboard_pubkeys_ge_1btc_top100.csv"
        write_snapshot_fixture(source, 961_000, header_only_filename, header_only=True)
        assert_publication_rejected_without_marker_change(
            source,
            marker_path,
            old_marker,
            "test-header-only",
        )
        write_snapshot_fixture(source, 961_000, header_only_filename)

        missing_header_filename = "dashboard_pubkeys_aggregates.csv"
        write_snapshot_fixture(
            source,
            961_000,
            missing_header_filename,
            omit_header="balance_filter",
        )
        assert_publication_rejected_without_marker_change(
            source,
            marker_path,
            old_marker,
            "test-missing-header",
        )
        write_snapshot_fixture(source, 961_000, missing_header_filename)

        write_snapshot_fixture(source, 961_000, missing_header_filename, row_count=1)
        assert_publication_rejected_without_marker_change(
            source,
            marker_path,
            old_marker,
            "test-one-row-aggregate-truncation",
        )
        write_snapshot_fixture(source, 961_000, missing_header_filename)

        history_path = source / "historical_eco.csv"
        history_rows = list(csv.reader(history_path.open("r", encoding="utf-8", newline="")))
        history_rows.pop()
        with history_path.open("w", encoding="utf-8", newline="") as handle:
            csv.writer(handle).writerows(history_rows)
        assert_publication_rejected_without_marker_change(
            source,
            marker_path,
            old_marker,
            "test-latest-history-filter-truncation",
        )
        write_historical_eco_fixture(source, 961_000)

        top100_filename = "dashboard_pubkeys_ge_1btc_top100.csv"
        full_filename = "dashboard_pubkeys_ge_1btc.csv"
        write_snapshot_fixture(source, 961_000, top100_filename, row_count=2)
        write_snapshot_fixture(source, 961_000, full_filename, row_count=1)
        assert_publication_rejected_without_marker_change(
            source,
            marker_path,
            old_marker,
            "test-full-smaller-than-top100",
        )
        write_snapshot_fixture(source, 961_000, top100_filename)
        write_snapshot_fixture(source, 961_000, full_filename)

        write_snapshot_fixture(source, 961_000, top100_filename, row_count=99)
        assert_publication_rejected_without_marker_change(
            source,
            marker_path,
            old_marker,
            "test-truncated-top100",
        )
        write_snapshot_fixture(source, 961_000, top100_filename)

        top100_path = source / "961000" / top100_filename
        top100_rows = list(csv.reader(top100_path.open("r", encoding="utf-8", newline="")))
        top100_rows[1][0] = "fixture-display-group-not-in-full"
        with top100_path.open("w", encoding="utf-8", newline="") as handle:
            csv.writer(handle).writerows(top100_rows)
        assert_publication_rejected_without_marker_change(
            source,
            marker_path,
            old_marker,
            "test-top100-not-subset-of-full",
        )
        write_snapshot_fixture(source, 961_000, top100_filename)

        write_historical_eco_fixture(source, 961_000, header_only=True)
        assert_publication_rejected_without_marker_change(
            source,
            marker_path,
            old_marker,
            "test-header-only-history",
        )
        write_historical_eco_fixture(source, 961_000, row_height=960_999)
        assert_publication_rejected_without_marker_change(
            source,
            marker_path,
            old_marker,
            "test-history-missing-latest",
        )
        write_historical_eco_fixture(source, 961_000)

        # Every active height offered by snapshots_index.csv must have an
        # active directory and its canonical historical topline row. This is
        # deliberately a multi-snapshot fixture rather than a one-row proxy.
        (source / "snapshots_index.csv").write_text(
            "snapshot_blockheight,snapshot_time\n"
            "961000,1785841728\n"
            "950000,1779141269\n",
            encoding="utf-8",
        )
        assert_publication_rejected_without_marker_change(
            source,
            marker_path,
            old_marker,
            "test-indexed-active-directory-missing",
        )
        seed_snapshot_files(source, 950_000)
        assert_publication_rejected_without_marker_change(
            source,
            marker_path,
            old_marker,
            "test-history-missing-active-index-snapshot",
        )
        write_historical_eco_fixture(
            source,
            961_000,
            additional_heights=(950_000,),
        )

        metadata_filename = "dashboard_snapshot_meta.csv"
        write_snapshot_fixture(
            source,
            961_000,
            metadata_filename,
            metadata_height=960_999,
        )
        assert_publication_rejected_without_marker_change(
            source,
            marker_path,
            old_marker,
            "test-mismatched-metadata-height",
        )
        write_snapshot_fixture(source, 961_000, metadata_filename)

        marker_text = publish_generation_marker(
            source,
            reason="test-complete",
            now=datetime(2026, 8, 25, 12, 34, 56, tzinfo=timezone.utc),
            generation_id="deterministic-test-generation",
        )
        marker = json.loads(marker_text)
        if marker["snapshot_blockheight"] != 961_000:
            raise AssertionError(f"Unexpected published height: {marker!r}")
        if marker["generation_id"] != "deterministic-test-generation":
            raise AssertionError(f"Unexpected generation id: {marker!r}")
        if marker["published_at_utc"] != "2026-08-25T12:34:56Z":
            raise AssertionError(f"Unexpected publication time: {marker!r}")
        historical_artifact = marker.get("artifacts", {}).get("historical_eco.csv", {})
        historical_bytes = (source / "historical_eco.csv").read_bytes()
        if historical_artifact.get("sha256") != hashlib.sha256(historical_bytes).hexdigest():
            raise AssertionError(f"Historical preview hash is not publication-bound: {marker!r}")
        with (source / "historical_eco.csv").open("r", encoding="utf-8", newline="") as handle:
            historical_rows = list(csv.DictReader(handle))
        historical_heights = [int(row["snapshot"]) for row in historical_rows]
        if historical_artifact != {
            "path": "historical_eco.csv",
            "sha256": hashlib.sha256(historical_bytes).hexdigest(),
            "rows": len(historical_rows),
            "first_snapshot": min(historical_heights),
            "latest_snapshot": max(historical_heights),
        }:
            raise AssertionError(f"Historical preview bounds are incomplete: {marker!r}")

        target_marker_path = target / PUBLICATION_MARKER_FILENAME
        target_marker_path.write_text(old_marker, encoding="utf-8")
        target_missing_path = target / "961000" / REQUIRED_SNAPSHOT_FILES[0]
        target_missing_path.unlink()
        try:
            copy_generation_marker(source, target)
        except RuntimeError:
            pass
        else:
            raise AssertionError("Incomplete standalone generation was published.")
        if target_marker_path.read_text(encoding="utf-8") != old_marker:
            raise AssertionError("Failed standalone validation changed its prior marker.")

        write_snapshot_fixture(target, 961_000, REQUIRED_SNAPSHOT_FILES[0])
        (target / "archived_index.csv").write_text(
            ",".join(ARCHIVED_INDEX_HEADERS) + "\n930000,1700000000\n",
            encoding="utf-8",
        )
        with (target / "historical_archived.csv").open(
            "w", encoding="utf-8", newline=""
        ) as handle:
            writer = csv.writer(handle)
            writer.writerow(HISTORICAL_ECO_HEADERS)
            writer.writerow([
                "930000", "all", "All", "all", "1", "1", "1", "1", "1", "1", "1.00"
            ])
        try:
            copy_generation_marker(source, target)
        except RuntimeError:
            pass
        else:
            raise AssertionError("Standalone marker accepted an archive index with no payload.")
        if target_marker_path.read_text(encoding="utf-8") != old_marker:
            raise AssertionError("Archive mismatch validation changed the standalone marker.")
        write_empty_archive_catalogs(target)
        # The standalone copier installs data artifacts before it advances the
        # marker. A stale historical preview must now fail the exact artifact
        # gate; install the finalized source payload before the successful copy.
        shutil.copy2(source / "historical_eco.csv", target / "historical_eco.csv")
        copied = copy_generation_marker(source, target)
        if copied != marker_text:
            raise AssertionError("Standalone marker copy changed the generation signature.")
        if target_marker_path.read_text(encoding="utf-8") != marker_text:
            raise AssertionError("Standalone marker was not copied exactly.")
        if list(target.glob(f".{PUBLICATION_MARKER_FILENAME}.*.tmp")):
            raise AssertionError("Atomic publication left a temporary marker behind.")

        # Daily pruning must retain the generation referenced by the current
        # browser marker until a later run has advanced that boundary.
        archive_data = root / "archive-boundary"
        archive_data.mkdir()
        (archive_data / "latest_snapshot.txt").write_text("962000", encoding="utf-8")
        (archive_data / PUBLICATION_MARKER_FILENAME).write_text(
            '{"format":1,"generation_id":"published-old",'
            '"snapshot_blockheight":961000}\n',
            encoding="utf-8",
        )
        for height in (960_000, 961_000, 962_000):
            snapshot_dir = archive_data / str(height)
            snapshot_dir.mkdir()
            (snapshot_dir / "dashboard_pubkeys_ge_1btc.csv").write_text(
                "display_group_ids\nfixture\n",
                encoding="utf-8",
            )
        original_daily_data_dir = daily_pipeline.WEBAPP_DATA_DIR
        original_daily_archive_dir = daily_pipeline.ARCHIVED_SNAPSHOTS_DIR
        try:
            daily_pipeline.WEBAPP_DATA_DIR = archive_data
            daily_pipeline.ARCHIVED_SNAPSHOTS_DIR = archive_data / "archived"
            archived = daily_pipeline.archive_prior_non_50k_snapshots(962_000, dry_run=False)
        finally:
            daily_pipeline.WEBAPP_DATA_DIR = original_daily_data_dir
            daily_pipeline.ARCHIVED_SNAPSHOTS_DIR = original_daily_archive_dir
        if archived != [960_000]:
            raise AssertionError(f"Unexpected deferred archive set: {archived!r}")
        if not (archive_data / "961000").is_dir():
            raise AssertionError("Daily archive removed the currently published generation.")
        if not (archive_data / "archived" / "960000").is_dir():
            raise AssertionError("Daily archive failed to move an older eligible generation.")

        # The one-off archive tool must fail before mutation for either kind
        # of live pointer, even when latest and published temporarily differ.
        try:
            archive_tool.validate_archive_candidate(962_000, archive_data)
        except RuntimeError:
            pass
        else:
            raise AssertionError("Archive tool accepted the latest snapshot.")
        try:
            archive_tool.validate_archive_candidate(961_000, archive_data)
        except RuntimeError:
            pass
        else:
            raise AssertionError("Archive tool accepted the published snapshot.")

        historical_archived = historical_pipeline.archive_non_50k_snapshots(
            [961_000, 962_000],
            archive_data,
        )
        if historical_archived:
            raise AssertionError(
                "Historical rebuild archived a live published/latest generation: "
                f"{historical_archived!r}"
            )
        if not (archive_data / "961000").is_dir() or not (
            archive_data / "962000"
        ).is_dir():
            raise AssertionError("Historical rebuild removed a live active snapshot directory.")

        # Exercise the actual standalone sync path. The shared atomic-refresh
        # runtime must arrive before the marker, and the target's old published
        # directory must survive until that marker replacement has completed.
        monolith_root = root / "monolith"
        monolith_quantum = monolith_root / "webapps" / "quantum_exposure"
        monolith_shared = monolith_root / "webapps" / "shared"
        monolith_shared.mkdir(parents=True)
        shutil.copytree(source, monolith_quantum / "webapp_data")
        (monolith_quantum / "dashboard.html").write_text(
            '<script src="../shared/webapp_data_auto_refresh.js"></script>\n',
            encoding="utf-8",
        )
        (monolith_quantum / "dashboard_app.js").write_text(
            "// fixture dashboard\n",
            encoding="utf-8",
        )

        standalone_root = root / "standalone-repo"
        standalone_quantum = standalone_root / "webapps" / "quantum_exposure"
        standalone_data = standalone_quantum / "webapp_data"
        standalone_data.mkdir(parents=True)
        stale_height = 940_000
        (standalone_data / str(stale_height)).mkdir()
        stale_archive_height = 930_000
        (standalone_data / "archived" / str(stale_archive_height)).mkdir(parents=True)
        (standalone_data / "archived_index.csv").write_text(
            ",".join(ARCHIVED_INDEX_HEADERS)
            + f"\n{stale_archive_height},1700000000\n",
            encoding="utf-8",
        )
        with (standalone_data / "historical_archived.csv").open(
            "w", encoding="utf-8", newline=""
        ) as handle:
            writer = csv.writer(handle)
            writer.writerow(HISTORICAL_ECO_HEADERS)
            writer.writerow([
                str(stale_archive_height),
                "all",
                "All",
                "all",
                "1",
                "1",
                "1",
                "1",
                "1",
                "1",
                "1.00",
            ])
        stale_target_marker = (
            '{"format":1,"generation_id":"standalone-old",'
            f'"snapshot_blockheight":{stale_height}}}\n'
        )
        (standalone_data / PUBLICATION_MARKER_FILENAME).write_text(
            stale_target_marker,
            encoding="utf-8",
        )

        original_quantum_dir = daily_pipeline.QUANTUM_DIR
        original_sync_data_dir = daily_pipeline.WEBAPP_DATA_DIR
        original_resolver = daily_pipeline.resolve_standalone_repo_dir
        original_copy_marker = daily_pipeline.copy_generation_marker
        marker_boundary_observed = False

        def checked_marker_copy(source_data_dir: Path, target_data_dir: Path) -> str:
            nonlocal marker_boundary_observed
            shared_target = (
                standalone_root / "webapps" / "shared" / "webapp_data_auto_refresh.js"
            )
            if not shared_target.is_file():
                raise AssertionError("Standalone marker advanced before shared refresh runtime copy.")
            if not (standalone_data / str(stale_height)).is_dir():
                raise AssertionError("Standalone old generation was removed before marker replacement.")
            if (standalone_data / "archived").exists():
                raise AssertionError("Standalone marker advanced with archive payloads still present.")
            if (standalone_data / "archived_index.csv").read_text(
                encoding="utf-8"
            ) != ",".join(ARCHIVED_INDEX_HEADERS) + "\n":
                raise AssertionError("Standalone marker advanced with a non-empty archive index.")
            if (standalone_data / "historical_archived.csv").read_text(
                encoding="utf-8"
            ) != ",".join(HISTORICAL_ECO_HEADERS) + "\n":
                raise AssertionError("Standalone marker advanced with non-empty archive history.")
            marker_boundary_observed = True
            return original_copy_marker(source_data_dir, target_data_dir)

        try:
            daily_pipeline.QUANTUM_DIR = monolith_quantum
            daily_pipeline.WEBAPP_DATA_DIR = monolith_quantum / "webapp_data"
            daily_pipeline.resolve_standalone_repo_dir = lambda: standalone_root
            daily_pipeline.copy_generation_marker = checked_marker_copy

            try:
                daily_pipeline.sync_to_standalone_repo(dry_run=False)
            except RuntimeError:
                pass
            else:
                raise AssertionError("Standalone sync accepted a missing shared refresh runtime.")
            if (standalone_data / PUBLICATION_MARKER_FILENAME).read_text(
                encoding="utf-8"
            ) != stale_target_marker:
                raise AssertionError("Failed runtime validation advanced standalone marker.")

            shared_runtime_text = "// shared atomic refresh fixture\n"
            (monolith_shared / "webapp_data_auto_refresh.js").write_text(
                shared_runtime_text,
                encoding="utf-8",
            )
            daily_pipeline.sync_to_standalone_repo(dry_run=False)
        finally:
            daily_pipeline.QUANTUM_DIR = original_quantum_dir
            daily_pipeline.WEBAPP_DATA_DIR = original_sync_data_dir
            daily_pipeline.resolve_standalone_repo_dir = original_resolver
            daily_pipeline.copy_generation_marker = original_copy_marker

        if not marker_boundary_observed:
            raise AssertionError("Standalone sync did not reach its checked marker boundary.")
        shared_target = standalone_root / "webapps" / "shared" / "webapp_data_auto_refresh.js"
        if shared_target.read_text(encoding="utf-8") != shared_runtime_text:
            raise AssertionError("Standalone shared atomic-refresh runtime was not synchronized.")
        if (standalone_data / str(stale_height)).exists():
            raise AssertionError("Standalone stale generation was not pruned after marker replacement.")
        if (standalone_data / PUBLICATION_MARKER_FILENAME).read_text(
            encoding="utf-8"
        ) != marker_text:
            raise AssertionError("Standalone sync did not install the finalized source marker.")

    print("Quantum publication marker regression passed.")


if __name__ == "__main__":
    main()
