#!/usr/bin/env python3
"""Check producer preflight against rewritten automation commits in fixture repos."""

import importlib.util
import os
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
AUTOMATION_DIR = ROOT / "scripts" / "automation"
sys.path.insert(0, str(AUTOMATION_DIR))
from _git_sync_guard import can_stage_across_rewritten_data_tip


def git(repo: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args], cwd=repo, check=True, capture_output=True, text=True,
        env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
    )
    return result.stdout.strip()


def commit(repo: Path, message: str = "Update data") -> None:
    git(repo, "add", "--all")
    git(repo, "-c", "commit.gpgsign=false", "commit", "-m", message)


def load_runner(name: str, path: Path, env_path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, {"dotenv": types.SimpleNamespace(load_dotenv=lambda **_: None)}), patch.dict(
        os.environ, {"ANIMATIONS_ENV_FILE": str(env_path)}
    ):
        spec.loader.exec_module(module)
    return module


class AutomationGitSyncGuardTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="wsb-git-sync-guard-")
        root = Path(self.temporary.name)
        self.remote = root / "remote.git"
        self.local = root / "local"
        self.peer = root / "peer"
        git(root, "init", "--bare", str(self.remote))
        git(root, "init", "-b", "main", str(self.local))
        for repo in (self.local,):
            git(repo, "config", "user.name", "Fixture")
            git(repo, "config", "user.email", "fixture@example.test")
        (self.local / "README.md").write_text("source\n")
        data = self.local / "assets" / "daily_price.csv"
        data.parent.mkdir(parents=True)
        data.write_text("base\n")
        (self.local / "assets" / "last_updated.txt").write_text("Last updated on October 07, 2026 at 14:00 UTC\n")
        commit(self.local, "Initial source")
        git(self.local, "remote", "add", "origin", str(self.remote))
        git(self.local, "push", "-u", "origin", "main")
        git(root, "clone", "-q", str(self.remote), str(self.peer))
        git(self.peer, "config", "user.name", "Fixture")
        git(self.peer, "config", "user.email", "fixture@example.test")
        git(self.peer, "checkout", "main")
        data.write_text("local publication\n")
        (self.local / "assets" / "last_updated.txt").write_text("Last updated on October 07, 2026 at 15:12 UTC\n")
        commit(self.local)
        (self.peer / "assets" / "daily_price.csv").write_text("remote publication\n")
        (self.peer / "assets" / "last_updated.txt").write_text("Last updated on October 07, 2026 at 15:01 UTC\n")
        commit(self.peer)
        git(self.peer, "push", "origin", "main")
        git(self.local, "fetch", "origin")

    def tearDown(self):
        self.temporary.cleanup()

    def test_both_producers_merge_rewritten_tip_and_preserve_newer_data(self):
        local_before = git(self.local, "rev-parse", "HEAD")
        remote_before = git(self.local, "rev-parse", "origin/main")
        self.assertTrue(can_stage_across_rewritten_data_tip(self.local, "main", 1, 1))
        for name in ("_run_onchain.py", "_run_1h.py"):
            with self.subTest(runner=name):
                git(self.local, "reset", "--hard", local_before)
                runner = load_runner(name, AUTOMATION_DIR / name, self.local / "missing.env")
                self.assertTrue(runner.git_pull_rebase(self.local))
                self.assertEqual((self.local / "assets" / "daily_price.csv").read_text(), "local publication\n")
                self.assertEqual((self.local / "assets" / "last_updated.txt").read_text(), "Last updated on October 07, 2026 at 15:12 UTC\n")
                self.assertEqual(git(self.local, "rev-list", "--parents", "-n", "1", "HEAD").split()[1:], [local_before, remote_before])
                self.assertEqual(git(self.local, "log", "-1", "--format=%s"), "Merge remote-tracking branch 'origin/main'")
                git(self.local, "merge-base", "--is-ancestor", "origin/main", "HEAD")
        self.assertEqual(git(self.local, "rev-parse", "origin/main"), remote_before)

    def test_older_local_generation_is_rejected(self):
        (self.local / "assets" / "last_updated.txt").write_text("Last updated on October 07, 2026 at 14:59 UTC\n")
        git(self.local, "add", "assets/last_updated.txt")
        git(self.local, "-c", "commit.gpgsign=false", "commit", "--amend", "--no-edit")
        self.assertFalse(can_stage_across_rewritten_data_tip(self.local, "main", 1, 1))

    def test_different_data_path_sets_are_rejected(self):
        extra = self.local / "assets" / "top_kpis.json"
        extra.write_text("{}\n")
        git(self.local, "add", "assets/top_kpis.json")
        git(self.local, "-c", "commit.gpgsign=false", "commit", "--amend", "--no-edit")
        self.assertFalse(can_stage_across_rewritten_data_tip(self.local, "main", 1, 1))

    def test_source_change_disguised_as_data_commit_is_rejected(self):
        (self.local / "README.md").write_text("changed source\n")
        git(self.local, "add", "README.md")
        git(self.local, "-c", "commit.gpgsign=false", "commit", "--amend", "--no-edit")
        self.assertFalse(can_stage_across_rewritten_data_tip(self.local, "main", 1, 1))

    def test_dirty_worktree_is_rejected(self):
        (self.local / "scratch.txt").write_text("unrelated work\n")
        self.assertFalse(can_stage_across_rewritten_data_tip(self.local, "main", 1, 1))

    def test_unrelated_commit_and_non_main_branch_are_rejected(self):
        self.assertFalse(can_stage_across_rewritten_data_tip(self.local, "dev/work", 1, 1))
        self.assertFalse(can_stage_across_rewritten_data_tip(self.local, "main", 1, 2))
        git(self.local, "-c", "commit.gpgsign=false", "commit", "--amend", "-m", "Manual work")
        self.assertFalse(can_stage_across_rewritten_data_tip(self.local, "main", 1, 1))


if __name__ == "__main__":
    unittest.main()
