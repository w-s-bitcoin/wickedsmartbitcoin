#!/usr/bin/env python3
"""Exercise publication against temporary local Git repositories only."""

from __future__ import annotations

import contextlib
import importlib.util
import io
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "automation_deploy_under_test", ROOT / "scripts" / "automation" / "_git_deploy.py"
)
assert SPEC is not None and SPEC.loader is not None
deploy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(deploy)


class AutomationDeployTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="wsb-deploy-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.remote = self.root / "origin.git"
        self.repo = self.root / "production"
        self.git("init", "--bare", str(self.remote), cwd=self.root)
        self.git("init", "-b", "main", str(self.repo), cwd=self.root)
        self.git("config", "user.name", "Test User")
        self.git("config", "user.email", "test@example.com")
        self.write(self.repo / "app.js", "original application\n")
        self.write(self.repo / "assets" / "daily_price.csv", "old generation\n")
        self.git("add", "-A")
        self.git("commit", "-m", "Initial code")
        self.git("remote", "add", "origin", str(self.remote))
        self.git("push", "-u", "origin", "main")
        self.staging = self.root / "staging"
        self.run_dir = self.staging / "1h-20260101000000-1"
        self.write(self.run_dir / "files" / "assets" / "daily_price.csv", "new generation\n")
        self.write(self.run_dir / ".complete", "complete\n")

        patches = mock.patch.multiple(
            deploy,
            REPO=self.repo,
            STAGING_ROOT=self.staging,
            LOCK_1H=self.root / "1h.lock",
            LOCK_1D=self.root / "1d.lock",
            LOCK_ONCHAIN=self.root / "onchain.lock",
            LOCK_DEPLOY=self.root / "deploy.lock",
            ONCHAIN_PENDING=self.root / "onchain.pending",
        )
        patches.start()
        self.addCleanup(patches.stop)
        env = mock.patch.dict(os.environ, {"ANIMATIONS_DEPLOY_SOURCE": "1h"})
        env.start()
        self.addCleanup(env.stop)
        self.dev_sync = mock.patch.object(deploy, "sync_published_data_to_dev").start()
        self.addCleanup(mock.patch.stopall)

    def git(self, *args: str, cwd: Path | None = None) -> str:
        result = subprocess.run(
            ["git", *args], cwd=cwd or self.repo, capture_output=True, text=True,
            check=True, env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
        )
        return result.stdout.strip()

    @staticmethod
    def write(path: Path, text: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def run_deploy(self) -> int:
        with contextlib.redirect_stdout(io.StringIO()):
            return deploy.main()

    def remote_file(self, path: str) -> str:
        return self.git("show", f"main:{path}", cwd=self.remote)

    def push_concurrent_code(self) -> None:
        contributor = self.root / "contributor"
        self.git("clone", "--branch", "main", str(self.remote), str(contributor), cwd=self.root)
        self.git("config", "user.name", "Contributor", cwd=contributor)
        self.git("config", "user.email", "contributor@example.com", cwd=contributor)
        self.write(contributor / "app.js", "concurrent application update\n")
        self.git("add", "app.js", cwd=contributor)
        self.git("commit", "-m", "Concurrent code update", cwd=contributor)
        self.git("push", "origin", "main", cwd=contributor)

    def test_rejected_push_reapplies_generation_after_concurrent_code_update(self):
        self.assert_concurrent_push_recovery()

    def test_rejected_amended_push_reapplies_generation_after_concurrent_code_update(self):
        self.publish_previous_automation_generation()
        self.assert_concurrent_push_recovery()

    def test_background_fetch_cannot_weaken_amended_push_lease(self):
        self.publish_previous_automation_generation()
        self.assert_concurrent_push_recovery(advance_tracking_ref=True)

    def publish_previous_automation_generation(self):
        self.write(self.repo / "assets" / "daily_price.csv", "previous automation generation\n")
        self.git("add", "assets/daily_price.csv")
        self.git("commit", "-m", "Update data")
        self.git("push", "origin", "main")

    def assert_concurrent_push_recovery(self, *, advance_tracking_ref: bool = False):
        original_run = deploy.run
        push_results = []
        accepted_remote = self.git("rev-parse", "origin/main")

        def run_with_concurrent_push(cmd, **kwargs):
            if cmd[:2] == ["git", "push"]:
                self.assertTrue(self.run_dir.is_dir(), "staging must survive until publication")
                if not push_results:
                    self.push_concurrent_code()
                    if advance_tracking_ref:
                        self.git("fetch", "origin")
                        self.assertNotEqual(self.git("rev-parse", "origin/main"), accepted_remote)
                        self.assertIn(f"--force-with-lease=refs/heads/main:{accepted_remote}", cmd)
                result = original_run(cmd, **kwargs)
                push_results.append(result[0])
                return result
            return original_run(cmd, **kwargs)

        with mock.patch.object(deploy, "run", side_effect=run_with_concurrent_push):
            self.assertEqual(self.run_deploy(), 0)
        self.assertEqual(len(push_results), 2)
        self.assertNotEqual(push_results[0], 0)
        self.assertEqual(push_results[1], 0)
        self.assertEqual(self.remote_file("assets/daily_price.csv"), "new generation")
        self.assertEqual(self.remote_file("app.js"), "concurrent application update")
        self.assertFalse(self.run_dir.exists())
        self.assertEqual(self.git("status", "--porcelain"), "")
        self.dev_sync.assert_called_once_with("HEAD")

    def test_dirty_code_is_preserved_and_never_published(self):
        self.write(self.repo / "app.js", "unfinished local application\n")
        self.assertEqual(self.run_deploy(), 1)
        self.assertEqual((self.repo / "app.js").read_text(), "unfinished local application\n")
        self.assertEqual(self.remote_file("app.js"), "original application")
        self.assertEqual(self.remote_file("assets/daily_price.csv"), "old generation")
        self.assertTrue(self.run_dir.is_dir())
        self.dev_sync.assert_not_called()

    def test_unrelated_staged_and_untracked_files_are_never_published(self):
        self.write(self.repo / "app.js", "unfinished staged application\n")
        self.git("add", "app.js")
        self.write(self.repo / "private-notes.txt", "local notes\n")
        before_head = self.git("rev-parse", "HEAD")
        self.assertEqual(self.run_deploy(), 1)
        self.assertEqual(self.git("rev-parse", "HEAD"), before_head)
        self.assertEqual(self.git("show", ":app.js"), "unfinished staged application")
        self.assertEqual((self.repo / "private-notes.txt").read_text(), "local notes\n")
        self.assertEqual(self.remote_file("app.js"), "original application")
        self.assertTrue(self.run_dir.is_dir())
        self.dev_sync.assert_not_called()

    def test_dirty_code_is_preserved_before_divergence_reconciliation(self):
        self.write(self.repo / "assets" / "daily_price.csv", "unpublished older generation\n")
        self.git("add", "assets/daily_price.csv")
        self.git("commit", "-m", "Update data")
        self.push_concurrent_code()
        self.write(self.repo / "app.js", "unfinished local application\n")
        before_head = self.git("rev-parse", "HEAD")

        self.assertEqual(self.run_deploy(), 1)
        self.assertEqual(self.git("rev-parse", "HEAD"), before_head)
        self.assertEqual((self.repo / "app.js").read_text(), "unfinished local application\n")
        self.assertEqual(self.remote_file("app.js"), "concurrent application update")
        self.assertTrue(self.run_dir.is_dir())
        self.dev_sync.assert_not_called()

    def test_failed_publication_retains_staging_for_later_success(self):
        hook = self.remote / "hooks" / "pre-receive"
        self.write(hook, "#!/bin/sh\nexit 1\n")
        hook.chmod(0o755)
        self.assertEqual(self.run_deploy(), 1)
        self.assertTrue(self.run_dir.is_dir())
        self.assertEqual(self.remote_file("assets/daily_price.csv"), "old generation")
        self.dev_sync.assert_not_called()

        hook.unlink()
        self.assertEqual(self.run_deploy(), 0)
        self.assertFalse(self.run_dir.exists())
        self.assertEqual(self.remote_file("assets/daily_price.csv"), "new generation")
        self.dev_sync.assert_called_once_with("HEAD")

    def test_git_add_failure_keeps_stage_without_publishing(self):
        original_run = deploy.run

        def fail_add(cmd, **kwargs):
            if cmd[:2] == ["git", "add"]:
                return 1, "", "simulated index failure"
            return original_run(cmd, **kwargs)

        with mock.patch.object(deploy, "run", side_effect=fail_add):
            self.assertEqual(self.run_deploy(), 1)
        self.assertTrue(self.run_dir.is_dir())
        self.assertEqual(self.remote_file("assets/daily_price.csv"), "old generation")
        self.dev_sync.assert_not_called()

        self.assertEqual(self.run_deploy(), 0)
        self.assertFalse(self.run_dir.exists())
        self.assertEqual(self.remote_file("assets/daily_price.csv"), "new generation")
        self.dev_sync.assert_called_once_with("HEAD")

    def fail_hourly_before_commit(self, *, fail_command: str) -> None:
        original_run = deploy.run

        def fail_command_run(cmd, **kwargs):
            if cmd[:2] == ["git", fail_command]:
                return 1, "", f"simulated {fail_command} failure"
            return original_run(cmd, **kwargs)

        with mock.patch.object(deploy, "run", side_effect=fail_command_run):
            self.assertEqual(self.run_deploy(), 1)

    def make_onchain_stage(self) -> Path:
        onchain_run = self.staging / "onchain-20260101000001-2"
        self.write(onchain_run / "files" / "assets" / "top_kpis.json", '{"height":123}\n')
        return onchain_run

    def test_onchain_recovers_unstaged_hourly_outputs_after_add_failure(self):
        self.assert_other_source_recovery(fail_command="add")

    def test_onchain_recovers_staged_hourly_outputs_after_commit_failure(self):
        self.assert_other_source_recovery(fail_command="commit")

    def assert_other_source_recovery(self, *, fail_command: str):
        binary_path = "webapps/example/webapp_data/new.bin"
        staged_binary = self.run_dir / "files" / binary_path
        staged_binary.parent.mkdir(parents=True)
        staged_binary.write_bytes(b"\x00\xff\x01retained binary\n")
        self.fail_hourly_before_commit(fail_command=fail_command)
        onchain_run = self.make_onchain_stage()

        with mock.patch.dict(os.environ, {"ANIMATIONS_DEPLOY_SOURCE": "onchain"}):
            self.assertEqual(self.run_deploy(), 0)
        self.assertEqual(self.remote_file("assets/daily_price.csv"), "old generation")
        self.assertEqual(self.remote_file("assets/top_kpis.json"), '{"height":123}')
        self.assertTrue(self.run_dir.is_dir())
        self.assertFalse(onchain_run.exists())
        self.assertFalse((self.repo / binary_path).exists())
        self.assertEqual(self.git("status", "--porcelain"), "")

        self.assertEqual(self.run_deploy(), 0)
        self.assertEqual(self.remote_file("assets/daily_price.csv"), "new generation")
        self.assertEqual((self.repo / binary_path).read_bytes(), b"\x00\xff\x01retained binary\n")
        self.assertFalse(self.run_dir.exists())

    def test_other_source_recovery_preserves_manual_worktree_edit(self):
        self.fail_hourly_before_commit(fail_command="commit")
        self.make_onchain_stage()
        self.write(self.repo / "assets" / "daily_price.csv", "manual worktree edit\n")
        with mock.patch.dict(os.environ, {"ANIMATIONS_DEPLOY_SOURCE": "onchain"}):
            self.assertEqual(self.run_deploy(), 1)
        self.assertEqual((self.repo / "assets" / "daily_price.csv").read_text(), "manual worktree edit\n")
        self.assertEqual(self.git("show", ":assets/daily_price.csv"), "new generation")
        self.assertTrue(self.run_dir.is_dir())
        self.dev_sync.assert_not_called()

    def test_other_source_recovery_preserves_manual_index_edit(self):
        self.fail_hourly_before_commit(fail_command="commit")
        self.make_onchain_stage()
        self.write(self.repo / "assets" / "daily_price.csv", "manual index edit\n")
        self.git("add", "assets/daily_price.csv")
        self.write(self.repo / "assets" / "daily_price.csv", "new generation\n")
        with mock.patch.dict(os.environ, {"ANIMATIONS_DEPLOY_SOURCE": "onchain"}):
            self.assertEqual(self.run_deploy(), 1)
        self.assertEqual((self.repo / "assets" / "daily_price.csv").read_text(), "new generation\n")
        self.assertEqual(self.git("show", ":assets/daily_price.csv"), "manual index edit")
        self.assertTrue(self.run_dir.is_dir())
        self.dev_sync.assert_not_called()

    def test_other_source_recovery_does_not_mutate_a_development_branch(self):
        self.fail_hourly_before_commit(fail_command="add")
        self.make_onchain_stage()
        self.git("switch", "-c", "dev/work")
        before_status = self.git("status", "--porcelain")
        with mock.patch.dict(os.environ, {"ANIMATIONS_DEPLOY_SOURCE": "onchain"}):
            self.assertEqual(self.run_deploy(), 1)
        self.assertEqual(self.git("status", "--porcelain"), before_status)
        self.assertEqual((self.repo / "assets" / "daily_price.csv").read_text(), "new generation\n")
        self.assertTrue(self.run_dir.is_dir())
        self.dev_sync.assert_not_called()


if __name__ == "__main__":
    unittest.main()
