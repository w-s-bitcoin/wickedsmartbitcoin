"""Node producer regressions using isolated fixtures, without network access."""

import csv
import hashlib
import importlib.util
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path
from unittest.mock import patch

try:
    from webapps.node_count import node_count_webapp_data_update as updater
except ModuleNotFoundError as error:
    if error.name not in {"pandas", "requests"}:
        raise
    updater = None


def observation(instant, *, listening=20000, unreachable=80000, knots=13040):
    instant = datetime.fromisoformat(instant).replace(tzinfo=timezone.utc)
    return {
        "timestamp": int(instant.timestamp()),
        "listening": listening,
        "est_unreachable": unreachable,
        "knots_count": knots,
        "core_v30_count": None,
        "bip110_count": None,
        "total_count": listening + unreachable,
        "datetime": instant,
        "date": instant.strftime("%Y-%m-%d"),
    }


@unittest.skipIf(updater is None, "pandas and requests are required for node producer tests")
class NodeCountProducerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="wsb-node-producer-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.network = patch(
            "requests.sessions.Session.request",
            side_effect=AssertionError("Node producer tests must not access the network"),
        )
        self.network.start()
        self.addCleanup(self.network.stop)

    def frame(self, rows):
        return updater.validate_history_frame(
            updater.pd.DataFrame(rows, columns=updater.HISTORY_COLUMNS)
        )

    def publication(self):
        archive = self.frame([
            observation("2017-04-27T23:06:00", unreachable=70000, knots=None),
            observation("2026-10-22T23:59:59", knots=13040),
        ])
        current = self.frame([
            observation("2026-10-22T00:00:00", unreachable=140000, knots=97298),
            observation("2026-10-22T23:59:59", knots=90000),
            observation("2026-10-23T00:00:00", unreachable=81000, knots=13764),
            observation("2026-10-24T00:00:00", unreachable=82000, knots=13838),
        ])
        archive_path = self.root / "audited-history.csv"
        archive.to_csv(archive_path, index=False)
        data_dir = self.root / "publication"
        updater.write_history_tables(current, data_dir)
        # Deliberate CRLFs and quoting verify repair never reserializes software.
        software = {
            "node_software_counts_grouped.csv": (
                b'software,main_version,sub_version,listening,est_unreachable,total_count,percent\r\n'
                b'"Bitcoin Knots",v29,v29.2,100,200,300,100\r\n'
            ),
            "node_software_counts_with_reachability.csv": (
                b'software,main_version,sub_version,listening,est_unreachable,total_count\r\n'
                b'"Bitcoin Knots",v29,v29.2,100,200,300\r\n'
            ),
        }
        for name, payload in software.items():
            (data_dir / name).write_bytes(payload)
        updater.publish_generation(current, data_dir)
        return archive_path, data_dir, archive, current, software

    def assert_publication_marker(self, data_dir, history):
        marker = json.loads((data_dir / "published_generation.json").read_text())
        self.assertEqual(marker["schema_version"], 1)
        self.assertEqual(marker["generation_id"], marker["published_at_utc"])
        self.assertEqual(
            (data_dir / "last_updated.txt").read_text(),
            marker["generation_id"] + "\n",
        )
        self.assertIsNotNone(datetime.fromisoformat(marker["published_at_utc"]).utcoffset())
        self.assertEqual(
            marker["latest_history_datetime"], history.iloc[-1]["datetime"].isoformat()
        )
        self.assertEqual(set(marker["artifacts"]), set(updater.PUBLISHED_ARTIFACTS))
        for name, artifact in marker["artifacts"].items():
            payload = (data_dir / name).read_bytes()
            self.assertEqual(artifact["sha256"], hashlib.sha256(payload).hexdigest())
            self.assertEqual(
                artifact["rows"], len(list(csv.DictReader(StringIO(payload.decode()))))
            )

    def test_import_does_not_fetch_or_write(self):
        spec = importlib.util.spec_from_file_location(
            "webapps.node_count._producer_import_test", updater.__file__
        )
        module = importlib.util.module_from_spec(spec)
        with patch.object(updater.requests, "get") as fetch, \
                patch.object(Path, "mkdir") as mkdir, \
                patch.object(updater.pd.DataFrame, "to_csv") as write_csv, \
                patch.object(updater.tempfile, "mkstemp") as temporary_file, \
                patch.object(Path, "write_text") as write_text:
            spec.loader.exec_module(module)
        for operation in (fetch, mkdir, write_csv, temporary_file, write_text):
            operation.assert_not_called()

    def test_missing_counts_survive_validation_and_merge(self):
        archive = self.frame([observation("2017-04-27T23:06:00", knots=None)])
        fetched = updater.parse_node_history("# Original source omitted software counts\n"
                                             "1493334360 20000 80000\n"
                                             "1493420760 20000 81000\n")
        merged = updater.merge_history_frames(archive, fetched)
        self.assertEqual(len(merged), 2)
        for field in ("knots_count", "core_v30_count", "bip110_count"):
            self.assertTrue(merged[field].isna().all(), field)
        self.assertEqual(merged["total_count"].tolist(), [100000, 101000])

    def test_malformed_source_count_is_rejected(self):
        with self.assertRaises(ValueError):
            updater.parse_node_history("1792713600 20000 80000 invalid 100 200\n")

    def test_missing_or_malformed_archive_fails_before_fetch_or_output(self):
        checkout = self.root / "checkout"
        archive_path = checkout / "webapp_data" / "bitcoin_node_history.csv"
        archive_path.parent.mkdir(parents=True)
        stage = self.root / "stage"
        valid = observation("2026-10-22T00:00:04")
        invalid_rows = [
            {**valid, "date": "2026-10-21"},
            {**valid, "total_count": 99999},
            {**valid, "knots_count": 1.5},
        ]
        for row in [None, *invalid_rows]:
            with self.subTest(row=row):
                if row is None:
                    archive_path.unlink(missing_ok=True)
                else:
                    updater.pd.DataFrame([row]).to_csv(archive_path, index=False)
                with patch.object(updater, "here", checkout), \
                        patch.dict(os.environ, {"NODE_COUNT_WEBAPP_DATA_DIR": str(stage)}), \
                        patch.object(sys, "argv", ["node_count_webapp_data_update.py"]), \
                        patch.object(updater, "fetch_node_history") as fetch:
                    with self.assertRaises((FileNotFoundError, ValueError)):
                        updater.main()
                fetch.assert_not_called()
                self.assertFalse(stage.exists())

    def test_offline_repair_restores_history_and_coherent_tables(self):
        archive_path, data_dir, archive, current, software = self.publication()
        with patch.dict(os.environ, {"NODE_COUNT_WEBAPP_DATA_DIR": str(data_dir)}), \
                patch.object(sys, "argv", ["node_count_webapp_data_update.py",
                                          "--repair-history-from", str(archive_path)]), \
                redirect_stdout(StringIO()):
            updater.main()

        history = updater.read_history(data_dir / "bitcoin_node_history.csv")
        expected = updater.pd.concat([archive, current.iloc[2:]], ignore_index=True)
        updater.pd.testing.assert_frame_equal(history, expected, check_dtype=False)
        blocks = updater.pd.read_csv(data_dir / "node_count_blocks.csv")
        updater.pd.testing.assert_frame_equal(
            updater.validate_history_frame(blocks[updater.HISTORY_COLUMNS]),
            history,
            check_dtype=False,
        )
        self.assertEqual(blocks["week"].tolist(), [17, 43, 43, 43])
        self.assertEqual(blocks["year"].tolist(), [2017, 2026, 2026, 2026])
        periods = updater.pd.read_csv(data_dir / "node_count_periods.csv")
        self.assertEqual(periods["period"].tolist(), [1, 2])
        self.assertEqual(periods["mean_count"].tolist(), [90000, 101000])
        self.assertEqual(periods["min_count"].tolist(), [90000, 100000])
        self.assertEqual(periods["max_count"].tolist(), [90000, 102000])
        self.assertEqual(
            updater.pd.to_datetime(periods["start_date"], utc=True).tolist(),
            [history.iloc[0]["datetime"], history.iloc[1]["datetime"]],
        )
        self.assertEqual(
            updater.pd.to_datetime(periods["end_date"], utc=True).tolist(),
            [history.iloc[0]["datetime"], history.iloc[-1]["datetime"]],
        )
        for name, payload in software.items():
            self.assertEqual((data_dir / name).read_bytes(), payload)
        self.assert_publication_marker(data_dir, history)

    def test_invalid_publication_leaves_every_file_unchanged(self):
        archive_path, data_dir, _, _, _ = self.publication()
        marker_path = data_dir / "published_generation.json"
        original_marker = json.loads(marker_path.read_text())
        for corruption in ("schema", "hash", "rows"):
            with self.subTest(corruption=corruption):
                marker = json.loads(json.dumps(original_marker))
                if corruption == "schema":
                    marker["schema_version"] = 999
                else:
                    artifact = marker["artifacts"]["bitcoin_node_history.csv"]
                    artifact["sha256" if corruption == "hash" else "rows"] = (
                        "0" * 64 if corruption == "hash" else 999
                    )
                marker_path.write_text(json.dumps(marker))
                before = {path.name: path.read_bytes() for path in data_dir.iterdir()}
                with self.assertRaisesRegex(ValueError, "Cannot repair"):
                    updater.repair_history(archive_path, data_dir)
                self.assertEqual(
                    {path.name: path.read_bytes() for path in data_dir.iterdir()}, before
                )

    def test_staged_run_reads_checkout_archive_and_keeps_existing_days(self):
        checkout = self.root / "checkout"
        archive_path = checkout / "webapp_data" / "bitcoin_node_history.csv"
        archive_path.parent.mkdir(parents=True)
        archive = self.frame([
            observation("2017-04-27T23:06:00", knots=None),
            observation("2026-10-22T00:00:04", knots=13040),
        ])
        archive.to_csv(archive_path, index=False)
        archive_bytes = archive_path.read_bytes()
        stage = self.root / "empty-stage"
        fetched = self.frame([
            observation("2026-10-22T00:00:00", knots=97298),
            observation("2026-10-23T00:00:00", knots=13764),
        ])
        software = updater.pd.DataFrame([{
            "software": "Bitcoin Knots", "main_version": "v29", "sub_version": "v29.2",
            "listening": 100, "est_unreachable": 200, "total_count": 300,
        }])
        with patch.object(updater, "here", checkout), \
                patch.dict(os.environ, {"NODE_COUNT_WEBAPP_DATA_DIR": str(stage)}), \
                patch.object(sys, "argv", ["node_count_webapp_data_update.py"]), \
                patch.object(updater, "fetch_node_history", return_value=fetched), \
                patch.object(updater, "fetch_node_software_data", return_value=software), \
                patch.object(updater, "fetch_github_releases", return_value=[]), \
                redirect_stdout(StringIO()):
            updater.main()
        result = updater.read_history(stage / "bitcoin_node_history.csv")
        expected = updater.pd.concat([archive, fetched.iloc[-1:]], ignore_index=True)
        updater.pd.testing.assert_frame_equal(result, expected, check_dtype=False)
        self.assertEqual(archive_path.read_bytes(), archive_bytes)
        self.assert_publication_marker(stage, result)


if __name__ == "__main__":
    unittest.main()
