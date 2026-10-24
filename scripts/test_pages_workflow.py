#!/usr/bin/env python3
"""Exercise the actual Pages workflow guards with a local, read-only gh fixture."""

from __future__ import annotations

import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import textwrap
import unittest


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/deploy-pages.yml"
RUN_SHA = "1234567890abcdef" * 2 + "12345678"
NEW_SHA = "fedcba0987654321" * 2 + "fedcba09"
REPOSITORY = "fixture-owner/pages-release"


def indented_body(source: str, marker: str) -> str:
    """Read one known YAML block without interpreting unrelated YAML syntax."""
    lines = source.splitlines()
    matches = [index for index, line in enumerate(lines) if line == marker]
    if len(matches) != 1:
        raise AssertionError(f"Expected one workflow marker {marker!r}; found {len(matches)}")
    start = matches[0] + 1
    indent = len(marker) - len(marker.lstrip())
    end = start
    while end < len(lines):
        line = lines[end]
        if line.strip() and not line.lstrip().startswith("#"):
            if len(line) - len(line.lstrip()) <= indent:
                break
        end += 1
    return "\n".join(lines[start:end])


def steps_in(job: str) -> list[str]:
    starts = list(re.finditer(r"^      - (?:name|uses|id): .+$", job, re.MULTILINE))
    return [job[item.start():starts[index + 1].start() if index + 1 < len(starts) else len(job)]
            for index, item in enumerate(starts)]


def field(block: str, key: str, indent: int = 8) -> str | None:
    matches = re.findall(rf"^ {{{indent}}}{re.escape(key)}: *(.*)$", block, re.MULTILINE)
    if len(matches) > 1:
        raise AssertionError(f"Repeated {key!r} in workflow block")
    return matches[0] if matches else None


def only_step(steps: list[str], key: str, value: str) -> str:
    matches = [step for step in steps if field(step, key) == value]
    if len(matches) != 1:
        raise AssertionError(f"Expected one step with {key}={value!r}; found {len(matches)}")
    return matches[0]


class PagesWorkflowTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = WORKFLOW.read_text()
        cls.build = indented_body(cls.source, "  build:")
        cls.deploy = indented_body(cls.source, "  deploy:")
        cls.build_steps = steps_in(cls.build)
        cls.deploy_steps = steps_in(cls.deploy)
        cls.guards = {}
        for name, steps in (("preflight", cls.build_steps), ("upload-check", cls.build_steps),
                            ("current", cls.deploy_steps)):
            step = only_step(steps, "id", name)
            if field(step, "run") != "|":
                raise AssertionError(f"{name} must expose the actual inline shell guard")
            cls.guards[name] = textwrap.dedent(indented_body(step, "        run: |")) + "\n"

    def run_guards(self, cases, run_sha=RUN_SHA):
        """Run extracted shell; each case changes the same fake remote ref."""
        results = []
        with tempfile.TemporaryDirectory(prefix="wsb-pages-workflow-") as temporary:
            root = Path(temporary)
            binary = root / "bin"
            binary.mkdir()
            fake_gh = binary / "gh"
            fake_gh.write_text("""#!/bin/bash
set -euo pipefail
if [[ "$#" != 4 || "$1" != api || "$2" != "repos/${EXPECTED_REPOSITORY}/git/ref/heads/main" || "$3" != --jq || "$4" != .object.sha ]]; then
  echo "Unexpected gh arguments" >&2
  exit 91
fi
printf '%s\\n' "$2" >> "$FAKE_GH_CALLS"
cat "$FAKE_GH_REF"
exit "$FAKE_GH_EXIT"
""")
            fake_gh.chmod(0o755)
            response_file = root / "remote-ref"
            calls = root / "gh-calls"
            output = root / "github-output"
            env = {
                "PATH": str(binary) + os.pathsep + os.defpath,
                "GITHUB_REPOSITORY": REPOSITORY,
                "EXPECTED_REPOSITORY": REPOSITORY,
                "GITHUB_SHA": run_sha,
                "GITHUB_OUTPUT": str(output),
                "GH_TOKEN": "local-fixture-only",
                "FAKE_GH_CALLS": str(calls),
                "FAKE_GH_REF": str(response_file),
            }
            for name, response, exit_code in cases:
                response_file.write_text(response)
                output.write_text("")
                env["FAKE_GH_EXIT"] = str(exit_code)
                result = subprocess.run(
                    [shutil.which("bash") or "/bin/bash", "--noprofile", "--norc", "-c", self.guards[name]],
                    cwd=root, env=env, capture_output=True, text=True, timeout=10,
                )
                results.append((result, output.read_text().splitlines()))
            self.assertEqual(calls.read_text().splitlines(),
                             [f"repos/{REPOSITORY}/git/ref/heads/main"] * len(cases),
                             "Each guard must independently query the current repository's exact main ref")
        return results

    def test_exact_current_commit_passes_each_guard(self):
        for name in self.guards:
            with self.subTest(guard=name):
                result, output = self.run_guards([(name, RUN_SHA + "\n", 0)])[0]
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(output, ["current=true"])

    def test_stale_and_force_amended_same_tree_commits_are_not_publishable(self):
        # Real same-tree history: matching source content does not make an old
        # commit or an amended sibling the current published generation.
        with tempfile.TemporaryDirectory(prefix="wsb-pages-history-") as temporary:
            root = Path(temporary)
            env = {
                **os.environ,
                "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull,
                "GIT_AUTHOR_NAME": "Fixture", "GIT_AUTHOR_EMAIL": "fixture@example.invalid",
                "GIT_COMMITTER_NAME": "Fixture", "GIT_COMMITTER_EMAIL": "fixture@example.invalid",
                "GIT_AUTHOR_DATE": "2000-01-01T00:00:00Z",
                "GIT_COMMITTER_DATE": "2000-01-01T00:00:00Z",
            }

            def git(*args, input=None):
                return subprocess.check_output(["git", *args], cwd=root, env=env,
                                               input=input, text=True, stderr=subprocess.PIPE).strip()

            git("init", "--bare", "--quiet")
            tree = git("mktree", input="")
            base = git("commit-tree", tree, input="base\n")
            run = git("commit-tree", tree, "-p", base, input="original generation\n")
            newer = git("commit-tree", tree, "-p", run, input="new generation\n")
            amended = git("commit-tree", tree, "-p", base, input="amended generation\n")
            self.assertEqual(len({run, newer, amended}), 3)
            for kind, head in (("newer descendant", newer), ("force-amended sibling", amended)):
                for name in self.guards:
                    with self.subTest(guard=name, remote=kind):
                        result, output = self.run_guards([(name, head + "\n", 0)], run_sha=run)[0]
                        self.assertEqual(result.returncode, 0, result.stderr)
                        self.assertEqual(output, ["current=false"])

    def test_missing_malformed_and_failed_ref_lookups_fail_closed(self):
        responses = (
            ("missing", "", 0), ("null", "null\n", 0), ("short", RUN_SHA[:12], 0),
            ("malformed", "not-a-commit\n", 0), ("nonhex", "z" * 40, 0),
            ("multiple refs", RUN_SHA + "\n" + NEW_SHA + "\n", 0),
            ("API failure", "", 1), ("API failure with valid-looking output", RUN_SHA, 1),
        )
        for name in self.guards:
            for label, response, status in responses:
                with self.subTest(guard=name, response=label):
                    result, output = self.run_guards([(name, response, status)])[0]
                    self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                    self.assertNotIn("current=true", output)

    def test_ref_is_rechecked_after_build_and_deployment_wait(self):
        results = self.run_guards([
            ("preflight", RUN_SHA, 0),
            ("upload-check", RUN_SHA, 0),
            ("current", NEW_SHA, 0),
        ])
        self.assertEqual([result.returncode for result, _ in results], [0, 0, 0])
        self.assertEqual([output for _, output in results],
                         [["current=true"], ["current=true"], ["current=false"]],
                         "A newer main commit while waiting must prevent stale deployment")

    def test_builds_are_independent_and_only_deployments_take_the_pages_lock(self):
        self.assertIsNone(field(self.source, "concurrency", indent=0),
                          "Workflow-wide concurrency queues builds behind stale runs")
        self.assertIsNone(field(self.build, "concurrency", indent=4),
                          "Independent builds must not wait on or cancel each other")
        concurrency = indented_body(self.deploy, "    concurrency:")
        self.assertEqual(field(concurrency, "group", indent=6), "pages")
        self.assertEqual(field(concurrency, "cancel-in-progress", indent=6), "false")
        self.assertEqual(field(concurrency, "queue", indent=6), "max",
                         "A delayed old build must not evict the newest pending deployment")

    def test_successful_publishable_build_is_rechecked_immediately_before_deployment(self):
        self.assertEqual(field(self.deploy, "needs", indent=4), "build")
        # Without always()/failure()/cancelled(), GitHub applies the normal
        # success() dependency gate as well as this publishable-output condition.
        self.assertEqual(field(self.deploy, "if", indent=4),
                         "needs.build.outputs.publishable == 'true'")
        outputs = indented_body(self.build, "    outputs:")
        self.assertEqual(field(outputs, "publishable", indent=6),
                         "${{ steps.upload-check.outputs.current }}")
        deployment = only_step(self.deploy_steps, "uses", "actions/deploy-pages@v4")
        index = self.deploy_steps.index(deployment)
        self.assertGreater(index, 0)
        self.assertEqual(field(self.deploy_steps[index - 1], "id"), "current",
                         "The main-ref guard must run inside the lock immediately before deploy")
        self.assertEqual(field(deployment, "if"), "steps.current.outputs.current == 'true'")
        self.assertIsNone(field(self.deploy_steps[index - 1], "if"),
                          "The locked deployment guard must not be conditionally bypassed")

    def test_build_keeps_immutable_checkout_checks_cache_and_upload_gate(self):
        checkout = only_step(self.build_steps, "uses", "actions/checkout@v4")
        self.assertIn(field(checkout, "ref", indent=10), (None, "${{ github.sha }}"),
                      "Checkout must remain pinned to this run's commit, never moving main")
        check = only_step(self.build_steps, "run", "bash scripts/check_project.sh")
        build = only_step(self.build_steps, "run", "bash scripts/build_pages_dist.sh")
        upload_check = only_step(self.build_steps, "id", "upload-check")
        upload = only_step(self.build_steps, "uses", "actions/upload-pages-artifact@v3")
        indices = [self.build_steps.index(step) for step in (checkout, check, build, upload_check, upload)]
        self.assertEqual(indices, sorted(indices), "Checks and final main-ref validation must precede upload")
        self.assertEqual(field(upload, "if"), "steps.upload-check.outputs.current == 'true'")
        self.assertEqual(field(upload, "path", indent=10), "dist")
        for step in (checkout, check, build, upload_check):
            self.assertEqual(field(step, "if"), "steps.preflight.outputs.current == 'true'")
        cache = only_step(self.build_steps, "uses", "actions/cache@v4")
        self.assertEqual(field(cache, "path", indent=10), "${{ env.WSB_CARD_FALLBACK_CACHE_DIR }}")
        self.assertIn("${{ steps.card-fallback-day.outputs.day }}", field(cache, "key", indent=10) or "")
        capture = only_step(self.build_steps, "run", "python3 scripts/test_card_fallbacks_browser.py")
        self.assertEqual(field(capture, "if"),
                         "steps.preflight.outputs.current == 'true' && steps.card-fallback-cache.outputs.cache-hit != 'true'")
        self.assertLess(self.build_steps.index(capture), self.build_steps.index(build))


if __name__ == "__main__":
    unittest.main()
