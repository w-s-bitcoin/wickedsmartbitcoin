#!/usr/bin/env python3
"""Regression coverage for the external Stage 4 hourly publication handoff."""

from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts import sync_main_data_to_dev as syncer


RUN_ALL_DIR = Path(
    os.getenv("ANIMATIONS_RUN_ALL_DIR", "/Users/wicked/Projects/animations/_Run_All")
).expanduser()


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load test module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@unittest.skipUnless(RUN_ALL_DIR.is_dir(), "external animation pipeline is unavailable")
class HourlyPublicationPipelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.hourly = load_module("wsb_test_run_1h", RUN_ALL_DIR / "_run_1h.py")
        cls.deploy = load_module("wsb_test_git_deploy", RUN_ALL_DIR / "_git_deploy.py")

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="wsb-hourly-stage-test-")
        self.staging_root = Path(self.temporary.name)
        self.deploy.STAGING_ROOT = self.staging_root

    def tearDown(self):
        self.temporary.cleanup()

    def make_run(self, name: str, *, completed: bool = False) -> Path:
        run_dir = self.staging_root / name
        files_dir = run_dir / "files"
        files_dir.mkdir(parents=True)
        (files_dir / "payload.txt").write_text(name, encoding="utf-8")
        if completed:
            (run_dir / self.deploy.HOURLY_STAGE_COMPLETE_SENTINEL).write_text(
                "complete\n", encoding="utf-8"
            )
        return run_dir

    def test_source_less_deploy_never_lists_incomplete_hourly_runs(self):
        self.make_run("1h-20260101000000-1")
        partial = self.make_run("1h-20260101000001-2")
        (partial / ".complete.tmp-2").write_text("partial\n", encoding="utf-8")
        self.make_run("1h-20260101000002-3", completed=True)
        self.make_run("onchain-20260101000003-4")

        self.assertEqual(
            [path.name for path in self.deploy._list_stage_run_dirs_for_source(None)],
            ["1h-20260101000002-3", "onchain-20260101000003-4"],
        )
        self.assertEqual(
            [path.name for path in self.deploy._list_stage_run_dirs_for_source("1h")],
            ["1h-20260101000002-3"],
        )

    def test_atomic_completion_sentinel_exposes_run_only_after_success(self):
        run_dir = self.make_run("1h-20260101000000-1")
        self.assertEqual(self.deploy._list_stage_run_dirs(), [])

        self.hourly.mark_stage_run_complete(run_dir)

        self.assertEqual(self.deploy._list_stage_run_dirs(), [run_dir])
        self.assertEqual((run_dir / ".complete").read_text(encoding="utf-8"), "complete\n")
        self.assertEqual(list(run_dir.glob(".complete.tmp-*")), [])

    def test_hourly_marker_builder_matches_transition_builder_exactly(self):
        data = (ROOT / syncer.DAILY_PRICE_PATH).read_bytes()
        hourly_marker = self.hourly.build_daily_price_metadata(data)
        transition_marker = json.loads(syncer.build_daily_price_publication_marker(data))
        self.assertEqual(hourly_marker, transition_marker)

    def test_hourly_marker_builder_rejects_invalid_series_semantics(self):
        valid = (
            "date,timestamp,price,daily_high,block_height\n"
            "1/3/09,2009-01-03 23:59:59,0.0,0.0,0\n"
            "1/4/09,2009-01-04 23:59:59,10.0,11.0,1\n"
            "1/5/09,2009-01-05 12:00:00,12.0,13.0,2\n"
        ).encode("utf-8")
        cases = (
            valid.replace(
                b"1/4/09,2009-01-04 23:59:59",
                b"1/6/09,2009-01-06 23:59:59",
            ),
            valid.replace(b",12.0,13.0,2\n", b",12.0,13.0,0\n"),
            valid.replace(b",10.0,11.0,1\n", b",not-a-price,11.0,1\n"),
            valid.replace(b",10.0,11.0,1\n", b",-10.0,11.0,1\n"),
            valid.replace(b",10.0,11.0,1\n", b",NaN,11.0,1\n"),
            valid.replace(b",10.0,11.0,1\n", b",10.0,-11.0,1\n"),
            valid.replace(b",10.0,11.0,1\n", b",10.0,Infinity,1\n"),
            valid.replace(b"2009-01-04 23:59:59", b"not-a-timestamp       "),
            valid.replace(b"1/4/09,2009-01-04", b"1/8/09,2009-01-04"),
        )
        for document in cases:
            with self.subTest(document=document):
                with self.assertRaises(RuntimeError):
                    self.hourly.build_daily_price_metadata(document)

    def test_all_preview_publication_markers_apply_after_their_payloads(self):
        expected = {
            Path("assets/daily_price_metadata.json"),
            Path("webapps/bip110_signaling/webapp_data/bip110_metadata.json"),
            Path("webapps/bitcoin_dominance/webapp_data/published_generation.json"),
            Path("webapps/casascius_explorer/assets/right_panel_data.js"),
            Path("webapps/dca_comparison/webapp_data/published_generation.json"),
            Path("webapps/dca_cost_basis/webapp_data/dca_cost_basis_metadata.json"),
            Path("webapps/issuance_rate/webapp_data/published_generation.json"),
            Path("webapps/node_count/webapp_data/published_generation.json"),
            Path("webapps/quantum_exposure/webapp_data/published_generation.json"),
        }
        self.assertTrue(
            expected.issubset(self.deploy.STAGED_PUBLICATION_MARKERS),
            expected.difference(self.deploy.STAGED_PUBLICATION_MARKERS),
        )


if __name__ == "__main__":
    unittest.main()
