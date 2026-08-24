#!/usr/bin/env python3

import subprocess
import tempfile
import unittest
from pathlib import Path

from scripts import sync_main_data_to_dev as syncer


class DevDataSyncTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(prefix="wsb-data-sync-test-")
        self.root = Path(self.temp_dir.name)
        self.main_repo = self.root / "wickedsmartbitcoin"
        self.dev_repo = self.root / "wickedsmartbitcoin-dev"
        self.git("init", "-b", "main", str(self.main_repo), cwd=self.root)
        self.git("config", "user.name", "Test User", cwd=self.main_repo)
        self.git("config", "user.email", "test@example.com", cwd=self.main_repo)

        self.write(self.main_repo / "assets" / "daily_price.csv", "date,price\n2026-01-01,1\n")
        self.write(
            self.main_repo / "webapps" / "example" / "webapp_data" / "values.csv",
            "date,value\n2026-01-01,1\n",
        )
        self.write(self.main_repo / "app.js", "const version = 1;\n")
        self.git("add", "-A", cwd=self.main_repo)
        self.git("commit", "-m", "Initial", cwd=self.main_repo)
        self.git("branch", syncer.DEFAULT_DEV_BRANCH, cwd=self.main_repo)
        self.git("worktree", "add", str(self.dev_repo), syncer.DEFAULT_DEV_BRANCH, cwd=self.main_repo)

    def tearDown(self):
        self.temp_dir.cleanup()

    @staticmethod
    def git(*args, cwd):
        return subprocess.run(
            ["git", *args],
            cwd=str(cwd),
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()

    @staticmethod
    def write(path: Path, content: str):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def commit_main_update(self, value: int, *, amend: bool = False):
        self.write(
            self.main_repo / "assets" / "daily_price.csv",
            f"date,price\n2026-01-01,{value}\n",
        )
        self.write(
            self.main_repo / "webapps" / "example" / "webapp_data" / "values.csv",
            f"date,value\n2026-01-01,{value}\n",
        )
        self.git("add", "-A", cwd=self.main_repo)
        if amend:
            self.git("commit", "--amend", "--no-edit", cwd=self.main_repo)
        else:
            self.git("commit", "-m", "Update data", cwd=self.main_repo)

    def synchronize(self):
        return syncer.synchronize(
            self.main_repo,
            "HEAD",
            self.dev_repo,
            syncer.DEFAULT_DEV_BRANCH,
        )

    def test_dirty_non_data_work_is_preserved(self):
        self.commit_main_update(2)
        self.write(self.main_repo / "app.js", "const version = 2;\n")
        self.git("add", "app.js", cwd=self.main_repo)
        self.git("commit", "--amend", "--no-edit", cwd=self.main_repo)
        self.write(self.dev_repo / "app.js", "const draft = 'keep me';\n")
        self.git("add", "app.js", cwd=self.dev_repo)
        self.write(self.dev_repo / "notes" / "unfinished.txt", "untracked draft\n")

        outcome = self.synchronize()

        self.assertEqual(outcome.status, "synced")
        self.assertEqual(
            (self.dev_repo / "assets" / "daily_price.csv").read_text(),
            "date,price\n2026-01-01,2\n",
        )
        self.assertEqual((self.dev_repo / "app.js").read_text(), "const draft = 'keep me';\n")
        self.assertEqual((self.dev_repo / "notes" / "unfinished.txt").read_text(), "untracked draft\n")
        self.assertEqual(self.git("show", "HEAD:app.js", cwd=self.dev_repo), "const version = 1;")
        status = self.git("status", "--short", cwd=self.dev_repo)
        self.assertIn("M  app.js", status)
        self.assertIn("?? notes/", status)

    def test_dirty_data_overlap_defers_without_changes(self):
        self.commit_main_update(2)
        self.write(self.dev_repo / "assets" / "daily_price.csv", "unfinished local data\n")
        original_head = self.git("rev-parse", "HEAD", cwd=self.dev_repo)

        outcome = self.synchronize()

        self.assertEqual(outcome.status, "deferred-overlap")
        self.assertEqual(self.git("rev-parse", "HEAD", cwd=self.dev_repo), original_head)
        self.assertEqual(
            (self.dev_repo / "assets" / "daily_price.csv").read_text(),
            "unfinished local data\n",
        )

    def test_amended_source_commit_is_resynchronized(self):
        self.commit_main_update(2)
        first = self.synchronize()
        self.assertEqual(first.status, "synced")

        self.commit_main_update(3, amend=True)
        second = self.synchronize()

        self.assertEqual(second.status, "synced")
        self.assertEqual(
            (self.dev_repo / "webapps" / "example" / "webapp_data" / "values.csv").read_text(),
            "date,value\n2026-01-01,3\n",
        )
        self.assertEqual(syncer.optional_ref(self.dev_repo, syncer.SYNC_SOURCE_REF), second.source_commit)


if __name__ == "__main__":
    unittest.main()
