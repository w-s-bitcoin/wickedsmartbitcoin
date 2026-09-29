#!/usr/bin/env python3
"""Exercise the hourly Casascius workspace without running its database updater."""

import csv
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "webapps/casascius_explorer"


class CasasciusWorkspaceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Import helpers with an isolated environment path so no operator .env
        # is read. The runner's main() is never invoked.
        with tempfile.TemporaryDirectory(prefix="wsb-hourly-import-") as temporary:
            spec = importlib.util.spec_from_file_location(
                "hourly_workspace_test", ROOT / "scripts/automation/_run_1h.py"
            )
            cls.hourly = importlib.util.module_from_spec(spec)
            with patch.dict(os.environ, {"ANIMATIONS_ENV_FILE": str(Path(temporary) / ".env")}):
                spec.loader.exec_module(cls.hourly)

    def test_minimal_workspace_generates_coherent_staged_right_panel(self):
        with tempfile.TemporaryDirectory(prefix="wsb-casascius-workspace-") as temporary:
            root = Path(temporary)
            source = root / "repo/webapps/casascius_explorer"
            source.mkdir(parents=True)
            for name in self.hourly.CASASCIUS_WORKSPACE_REQUIRED_FILES:
                destination = source / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(APP / name, destination)
            optional = {
                "data/casascius_graded.csv": "Address,Year\n",
                "data/casascius_explorer_update_state.json": '{"last_checked_height":0}\n',
            }
            for name, content in optional.items():
                (source / name).write_text(content)
            for name in (
                "gradings/large.png",
                "coins_and_bars/large.png",
                "preview_assets/large.png",
                "assets/items/legacy.js",
                "assets/all_front.png",
            ):
                path = source / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"static asset must not be copied")

            run_dir = root / "run"
            workspace = run_dir / "tmp_webapps/casascius_explorer_workspace"
            workspace.mkdir(parents=True)
            (workspace / "stale.txt").write_text("old workspace")

            def generate_only(script_path, env=None):
                self.assertEqual(script_path, workspace / "scripts/casascius_explorer_webapp_data_update.py")
                self.assertEqual(env["CASASCIUS_EXPLORER_ENV_FILE"], str(self.hourly.ENV_PATH))
                self.assertFalse((workspace / "stale.txt").exists())
                self.assertFalse((workspace / "gradings").exists())
                self.assertFalse((workspace / "coins_and_bars").exists())
                self.assertFalse((workspace / "preview_assets").exists())
                self.assertFalse((workspace / "assets/items").exists())
                self.assertFalse((workspace / "assets/all_front.png").exists())
                for name, content in optional.items():
                    self.assertEqual((workspace / name).read_text(), content)
                # This generator only reads local data. The actual updater is
                # deliberately replaced so the test cannot connect to Postgres.
                result = subprocess.run(
                    [sys.executable, str(workspace / "scripts/generate_right_panel_data.py")],
                    cwd=workspace,
                    capture_output=True,
                    text=True,
                )
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                return True

            deploy_files = [
                source / "data/casascius_explorer.csv",
                source / "data/casascius_explorer_update_state.json",
                source / "assets/right_panel_data.js",
            ]
            with (
                patch.object(self.hourly, "REPO_DIR", root / "repo"),
                patch.object(self.hourly, "CASASCIUS_WEBAPP_DIR", source),
                patch.object(self.hourly, "CASASCIUS_DEPLOY_FILES", deploy_files),
                patch.object(self.hourly, "run_script", side_effect=generate_only) as updater,
            ):
                self.hourly.phase_casascius_data(run_dir)
                updater.assert_called_once()

            staged = run_dir / "files/webapps/casascius_explorer/assets/right_panel_data.js"
            output = staged.read_text()
            self.assertEqual(output, (workspace / "assets/right_panel_data.js").read_text())
            self.assertFalse((source / "assets/right_panel_data.js").exists())
            prefix = "window.CASASCIUS_RIGHT_PANEL_DATA = "
            self.assertTrue(output.startswith(prefix))
            payload = json.loads(output[len(prefix):].strip().removesuffix(";"))
            tracker = (workspace / "data/casascius_explorer.csv").read_bytes()
            self.assertEqual(tracker, (APP / "data/casascius_explorer.csv").read_bytes())
            rows = list(csv.DictReader(io.StringIO(tracker.decode())))
            publication = payload["publication"]
            self.assertEqual(publication["tracker"]["sha256"], hashlib.sha256(tracker).hexdigest())
            self.assertEqual(publication["tracker"]["rows"], len(rows))
            self.assertEqual(publication["rightPanelItems"], len(payload["items"]))
            self.assertIn(payload["allKey"], payload["items"])
            self.assertGreater(len(payload["items"]), 1)

    def test_optional_inputs_can_be_absent_and_required_inputs_cannot(self):
        with tempfile.TemporaryDirectory(prefix="wsb-casascius-inputs-") as temporary:
            root = Path(temporary)
            source = root / "source"
            workspace = root / "workspace"
            for name in self.hourly.CASASCIUS_WORKSPACE_REQUIRED_FILES:
                path = source / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("required fixture")
            self.hourly.prepare_casascius_workspace(source, workspace)
            for name in self.hourly.CASASCIUS_WORKSPACE_OPTIONAL_FILES:
                self.assertFalse((workspace / name).exists())
            (source / "data/casascius_explorer.csv").unlink()
            with self.assertRaises(FileNotFoundError):
                self.hourly.prepare_casascius_workspace(source, workspace)


if __name__ == "__main__":
    unittest.main()
