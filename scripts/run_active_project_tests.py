#!/usr/bin/env python3
"""Run current portable checks without the deprecated Quantum research suite."""

from __future__ import annotations

import sys
import unittest


MODULES = (
    "scripts.test_sync_main_data_to_dev",
    "scripts.test_stage4_pipeline_blockers",
    "scripts.test_automation_deploy",
    "scripts.test_hourly_casascius_workspace",
    "scripts.test_pages_build",
    "scripts.test_onchain_kpis",
)


def active_tests(suite: unittest.TestSuite) -> tuple[unittest.TestSuite, int]:
    selected = unittest.TestSuite()
    archived = 0
    for test in suite:
        if isinstance(test, unittest.TestSuite):
            nested, count = active_tests(test)
            selected.addTests(nested)
            archived += count
        elif "quantum" in test.id().lower():
            archived += 1
        else:
            selected.addTest(test)
    return selected, archived


def main() -> int:
    suite = unittest.defaultTestLoader.loadTestsFromNames(MODULES)
    selected, archived = active_tests(suite)
    print(f"Running active project checks ({archived} archived Quantum tests excluded).", flush=True)
    return 0 if unittest.TextTestRunner().run(selected).wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main())
