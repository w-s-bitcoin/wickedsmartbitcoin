#!/usr/bin/env python3
"""Current-chain KPI publication remains independent of archived BIP-110."""

import importlib.util
import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
RUNNER = ROOT / "scripts" / "automation" / "_run_onchain.py"


def load_runner():
    spec = importlib.util.spec_from_file_location("wsb_test_onchain_kpis", RUNNER)
    module = importlib.util.module_from_spec(spec)
    with tempfile.TemporaryDirectory(prefix="wsb-onchain-import-") as temporary:
        with patch.dict(sys.modules, {"dotenv": types.SimpleNamespace(load_dotenv=lambda **_: None)}), patch.dict(os.environ, {
            "ANIMATIONS_ENV_FILE": str(Path(temporary) / ".env"),
            "ANIMATIONS_REPO_DIR": str(ROOT),
        }):
            spec.loader.exec_module(module)
    return module


class OnchainKpiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.runner = load_runner()

    def test_current_tip_payload_does_not_use_archived_metadata(self):
        runner = self.runner
        snapshot = (968853, 1790522376, "17021ec5", 132757073449487.5, 2009013979155096)
        with patch.object(runner, "load_current_kpi_block", return_value=snapshot):
            payload = runner.build_top_kpis_payload()
        self.assertEqual(payload["block_height"], 968853)
        self.assertEqual(payload["block_time_utc"], "2026-09-27 15:19:36 UTC")
        self.assertEqual(payload["supply_btc"], 20090139.79155096)
        self.assertEqual(payload["subsidy_sats"], 312500000)
        self.assertEqual(payload["target_hex"], runner.target_hex_from_bits("17021ec5"))
        self.assertGreater(payload["target_hashrate_hps"], 0)
        self.assertEqual(payload["difficulty_display"], "132.76T")

    def test_archived_bip110_still_stages_kpis_and_runs_issuance(self):
        runner = self.runner
        with tempfile.TemporaryDirectory(prefix="wsb-onchain-stage-") as temporary:
            run_dir = Path(temporary) / "onchain-test"
            (run_dir / "files").mkdir(parents=True)
            with (
                patch.object(runner, "mark_onchain_pending"),
                patch.object(runner, "acquire_lock"),
                patch.object(runner, "release_lock"),
                patch.object(runner, "create_stage_run_dir", return_value=run_dir),
                patch.object(runner, "git_pull_rebase", return_value=True),
                patch.object(runner, "bip110_dashboard_finalized", return_value=True),
                patch.object(runner, "build_top_kpis_payload", return_value={"block_height": 968853}) as build,
                patch.object(runner, "run_script", return_value=True) as run_script,
                patch.object(runner, "ISSUANCE_RATE_WEBAPP_DATA_DIR", Path(temporary) / "no-cache"),
                patch.object(runner, "stage_tree", return_value=1),
                patch.object(runner, "trigger_git_deploy_if_safe") as deploy,
            ):
                self.assertEqual(runner.main(), 0)
            build.assert_called_once_with()
            run_script.assert_called_once()
            self.assertEqual(run_script.call_args.args[0], runner.ISSUANCE_RATE_SCRIPT)
            deploy.assert_called_with()
            self.assertEqual(deploy.call_count, 2)
            staged = run_dir / "files" / "assets" / "top_kpis.json"
            self.assertEqual(json.loads(staged.read_text()), {"block_height": 968853})
            self.assertFalse((run_dir / "files" / "webapps" / "bip110_signaling").exists())


if __name__ == "__main__":
    unittest.main()
