"""Offline version workflow tests; no network, credentials, or production jobs."""

import base64
import copy
import json
from pathlib import Path
import unittest

from scripts.bump_site_version import LEDGER, plan_bump, publish_bump


ROOT = Path(__file__).resolve().parents[1]
HTML = '<header>unchanged</header><span id="version-info">(v0.4.0)</span>\n'
EMPTY_LEDGER = '{"schema_version": 1, "pull_requests": []}\n'


class FakeGitHub:
    def __init__(self):
        self.head = "base"
        self.trees = {"base-tree": {"index.html": HTML, LEDGER: EMPTY_LEDGER, "data.csv": "original"}}
        self.commits = {"base": {"tree": {"sha": "base-tree"}, "parents": []}}
        self.pull = {"merged": True, "base": {"ref": "main"}}
        self.writes = []
        self.before_update = None
        self.block_writes = False

    @property
    def files(self):
        return self.trees[self.commits[self.head]["tree"]["sha"]]

    def advance(self, updates):
        tree = f"external-tree-{len(self.trees)}"
        self.trees[tree] = {**self.files, **updates}
        commit = f"external-{len(self.commits)}"
        self.commits[commit] = {"tree": {"sha": tree}, "parents": [self.head]}
        self.head = commit

    def request(self, method, path, data=None):
        if method == "GET":
            if path.startswith("pulls/"):
                return copy.deepcopy(self.pull)
            if path == "git/ref/heads/main":
                return {"object": {"sha": self.head}}
            if path.startswith("git/commits/"):
                return self.commits[path.removeprefix("git/commits/")]
            if path.startswith("contents/"):
                name, commit = path.removeprefix("contents/").split("?ref=")
                content = self.trees[self.commits[commit]["tree"]["sha"]][name]
                return {"type": "file", "encoding": "base64", "content": base64.b64encode(content.encode()).decode()}
        self.writes.append((method, path, copy.deepcopy(data)))
        if method == "POST" and path == "git/trees":
            sha = f"tree-{len(self.trees)}"
            self.trees[sha] = {**self.trees[data["base_tree"]], **{item["path"]: item["content"] for item in data["tree"]}}
            return {"sha": sha}
        if method == "POST" and path == "git/commits":
            sha = f"commit-{len(self.commits)}"
            self.commits[sha] = {"tree": {"sha": data["tree"]}, "parents": data["parents"]}
            return {"sha": sha}
        if method == "PATCH" and path == "git/refs/heads/main":
            assert data["force"] is False
            if self.before_update:
                callback, self.before_update = self.before_update, None
                callback()
            if self.block_writes or self.commits[data["sha"]]["parents"] != [self.head]:
                raise RuntimeError("Reference update rejected")
            self.head = data["sha"]
            return {"object": {"sha": self.head}}
        raise AssertionError((method, path, data))


class SiteVersionTest(unittest.TestCase):
    def test_bump_preserves_markup_and_patch_carries_past_nine(self):
        version, files = plan_bump(HTML.replace("v0.4.0", "v2.7.9"), EMPTY_LEDGER, 12)
        self.assertEqual(version, "2.7.10")
        self.assertEqual(files["index.html"], HTML.replace("v0.4.0", "v2.7.10"))
        self.assertEqual(json.loads(files[LEDGER])["pull_requests"], [12])

    def test_duplicate_rerun_does_not_write(self):
        api = FakeGitHub()
        self.assertEqual(publish_bump(api, 12), "0.4.1")
        head, writes = api.head, len(api.writes)
        self.assertEqual(publish_bump(api, 12), "0.4.1")
        self.assertEqual((api.head, len(api.writes)), (head, writes))
        self.assertEqual(api.files["data.csv"], "original")
        tree_write = next(data for _, path, data in api.writes if path == "git/trees")
        self.assertEqual({item["path"] for item in tree_write["tree"]}, {"index.html", LEDGER})

    def test_concurrent_data_update_is_preserved(self):
        api = FakeGitHub()
        api.before_update = lambda: api.advance({"data.csv": "new publication", "other.html": "new source"})
        self.assertEqual(publish_bump(api, 13), "0.4.1")
        self.assertEqual(api.files["data.csv"], "new publication")
        self.assertEqual(api.files["other.html"], "new source")
        self.assertEqual(json.loads(api.files[LEDGER])["pull_requests"], [13])

    def test_concurrent_pr_bumps_each_count_once_even_out_of_order(self):
        api = FakeGitHub()
        def other_pr():
            _, updates = plan_bump(api.files["index.html"], api.files[LEDGER], 14)
            api.advance(updates)
        api.before_update = other_pr
        self.assertEqual(publish_bump(api, 13), "0.4.2")
        self.assertEqual(json.loads(api.files[LEDGER])["pull_requests"], [13, 14])

    def test_same_pr_winning_race_is_not_counted_twice(self):
        api = FakeGitHub()
        def same_pr():
            _, updates = plan_bump(api.files["index.html"], api.files[LEDGER], 13)
            api.advance(updates)
        api.before_update = same_pr
        self.assertEqual(publish_bump(api, 13), "0.4.1")
        self.assertEqual(json.loads(api.files[LEDGER])["pull_requests"], [13])

    def test_unmerged_and_wrong_branch_fail_before_writes(self):
        for pull in ({"merged": False, "base": {"ref": "main"}}, {"merged": True, "base": {"ref": "dev/work"}}):
            api = FakeGitHub()
            api.pull = pull
            with self.assertRaises(ValueError):
                publish_bump(api, 12)
            self.assertEqual(api.writes, [])

    def test_bad_inputs_fail_closed(self):
        for html, ledger, pr in ((HTML + HTML, EMPTY_LEDGER, 1), ("no version", EMPTY_LEDGER, 1),
                (HTML, '{"schema_version": 1, "pull_requests": [1,1]}', 2),
                (HTML, '{"schema_version": 1, "pull_requests": ["1"]}', 2),
                (HTML, EMPTY_LEDGER, 0), (HTML, EMPTY_LEDGER, True)):
            with self.subTest(html=html, ledger=ledger, pr=pr), self.assertRaises(ValueError):
                plan_bump(html, ledger, pr)

    def test_protection_failure_does_not_force_or_repeat(self):
        api = FakeGitHub()
        api.block_writes = True
        with self.assertRaisesRegex(RuntimeError, "rejected"):
            publish_bump(api, 12)
        self.assertEqual(api.head, "base")
        self.assertEqual(len([item for item in api.writes if item[0] == "PATCH"]), 1)

    def test_workflow_uses_trusted_main_and_dispatches_deployment(self):
        workflow = (ROOT / ".github/workflows/bump-site-version.yml").read_text()
        for required in ("pull_request_target:", "types: [closed]", "branches: [main]",
                "if: github.event.pull_request.merged == true", "ref: main", "persist-credentials: false",
                "cancel-in-progress: false", "queue: max", "--publish", "--pr \"$PR_NUMBER\"",
                "gh workflow run deploy-pages.yml", "--ref main"):
            self.assertIn(required, workflow)
        self.assertNotIn("pull_request.head", workflow)
        self.assertIn("workflow_dispatch:", (ROOT / ".github/workflows/deploy-pages.yml").read_text())


if __name__ == "__main__":
    unittest.main()
