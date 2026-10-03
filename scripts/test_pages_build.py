#!/usr/bin/env python3
"""Check dashboard scaffolding and Pages packaging without production data."""

from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


class PagesBuildTest(unittest.TestCase):
    def test_generated_dashboard_passes_contract_and_requires_action_wiring(self):
        with tempfile.TemporaryDirectory(prefix="wsb-dashboard-scaffold-") as temporary:
            root = Path(temporary)
            generated = subprocess.run(
                ["bash", str(ROOT / "scripts/create_dashboard.sh"), "example", "Example Dashboard"],
                cwd=root,
                capture_output=True,
                text=True,
            )
            self.assertEqual(generated.returncode, 0, generated.stdout + generated.stderr)
            check = ["bash", str(ROOT / "scripts/check_dashboard_contract.sh"), "webapps/example"]
            valid = subprocess.run(check, cwd=root, capture_output=True, text=True)
            self.assertEqual(valid.returncode, 0, valid.stdout + valid.stderr)

            app = root / "webapps/example/dashboard_app.js"
            app.write_text(app.read_text().replace("initDashboardRuntime", "missingRuntime"))
            invalid = subprocess.run(check, cwd=root, capture_output=True, text=True)
            self.assertNotEqual(invalid.returncode, 0)
            self.assertIn("copy link buttons must use", invalid.stderr)

    def test_runtime_manifest_and_data_pruning(self):
        with tempfile.TemporaryDirectory(prefix="wsb-pages-build-") as temporary:
            root = Path(temporary)
            (root / "scripts").mkdir()
            shutil.copy2(ROOT / "scripts/build_pages_dist.sh", root / "scripts")

            fixtures = {
                "index.html": "<!doctype html><title>Fixture</title>",
                "assets/top_kpis.json": "{}",
                "webapps/shared/dashboard_share.js": "window.WSBDashboardShare = {};",
                "assets/block_data_0_99999.csv": "raw input",
                "assets/btcusd_10m_prices.csv": "raw input",
                "webapps/example/dashboard.html": (
                    '<script src="dashboard_manifest.js"></script>'
                    '<script src="dashboard_app.js"></script>'
                ),
                "webapps/example/dashboard_manifest.js": (
                    'window.WSBDashboardManifest = {slug: "example"};'
                ),
                "webapps/example/dashboard_app.js": (
                    'document.title = window.WSBDashboardManifest.slug;'
                ),
                "webapps/example/webapp_data/series.csv": "value\n1\n",
                "webapps/example/webapp_data/__pycache__/helper.pyc": "cache",
                "webapps/example/webapp_data/helper.py": "pipeline helper",
                "webapps/example/pipeline/update.py": "pipeline",
                "webapps/bip110_signaling/webapp_data/miner_attributions.json": "{}",
                "webapps/bip110_signaling/webapp_data/segwit_miners.json": "{}",
                "webapps/casascius_explorer/assets/items/legacy.js": "legacy image",
                "webapps/casascius_explorer/assets/all_front.png": "runtime image",
                "webapps/quantum_exposure/webapp_data/snapshots_index.csv": (
                    "snapshot_blockheight,snapshot_time\n200,2\n100,1\n"
                ),
                "webapps/quantum_exposure/webapp_data/archived_index.csv": (
                    "snapshot_blockheight,snapshot_time\n50,0\n"
                ),
                "webapps/quantum_exposure/webapp_data/historical_archived.csv": (
                    "snapshot,balance_filter\n50,all\n"
                ),
                "webapps/quantum_exposure/webapp_data/archived/50/data.csv": "archive",
                "webapps/quantum_exposure/webapp_data/arkham/private.csv": "enrichment",
                "webapps/quantum_exposure/webapp_data/200/dashboard_pubkeys_ge_1btc.csv": "current full rows",
                "webapps/quantum_exposure/webapp_data/100/dashboard_pubkeys_ge_1btc.csv": "old full rows",
                "webapps/quantum_exposure/webapp_data/100/dashboard_pubkeys_ge_1btc_top100.csv": "old compact rows",
            }
            for name, content in fixtures.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content)

            result = subprocess.run(
                ["bash", str(root / "scripts/build_pages_dist.sh")],
                cwd=root,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            dist = root / "dist"

            kept = (
                "index.html",
                "assets/top_kpis.json",
                "webapps/shared/dashboard_share.js",
                "webapps/example/dashboard.html",
                "webapps/example/dashboard_manifest.js",
                "webapps/example/dashboard_app.js",
                "webapps/example/webapp_data/series.csv",
                "webapps/bip110_signaling/webapp_data/miner_attributions.json",
                "webapps/casascius_explorer/assets/all_front.png",
                "webapps/quantum_exposure/webapp_data/200/dashboard_pubkeys_ge_1btc.csv",
                "webapps/quantum_exposure/webapp_data/100/dashboard_pubkeys_ge_1btc_top100.csv",
            )
            for name in kept:
                with self.subTest(kept=name):
                    self.assertTrue((dist / name).is_file(), name)
                    self.assertEqual((dist / name).read_text(), fixtures[name])

            pruned = (
                "assets/block_data_0_99999.csv",
                "assets/btcusd_10m_prices.csv",
                "webapps/example/pipeline",
                "webapps/example/webapp_data/__pycache__",
                "webapps/example/webapp_data/helper.py",
                "webapps/bip110_signaling/webapp_data/segwit_miners.json",
                "webapps/casascius_explorer/assets/items",
                "webapps/quantum_exposure/webapp_data/archived",
                "webapps/quantum_exposure/webapp_data/arkham",
                "webapps/quantum_exposure/webapp_data/100/dashboard_pubkeys_ge_1btc.csv",
            )
            for name in pruned:
                with self.subTest(pruned=name):
                    self.assertFalse((dist / name).exists(), name)

            quantum = dist / "webapps/quantum_exposure/webapp_data"
            for name in ("archived_index.csv", "historical_archived.csv"):
                with self.subTest(archive_catalog=name):
                    self.assertEqual(len((quantum / name).read_text().splitlines()), 1)

            # Packaging must never rewrite the source data during pruning.
            for name, content in fixtures.items():
                with self.subTest(source=name):
                    self.assertEqual((root / name).read_text(), content)


if __name__ == "__main__":
    unittest.main()
