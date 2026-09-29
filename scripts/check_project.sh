#!/usr/bin/env bash
# Portable checks only: no browser, production updater, or external database.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
PYTHON_BIN="${PYTHON_BIN:-python3}"

# Fixture tests make commits in disposable repositories. Ignore a contributor's
# global hardware signing requirement for those commits only.
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0=commit.gpgsign
export GIT_CONFIG_VALUE_0=false

bash scripts/check_all_dashboards.sh

"$PYTHON_BIN" -m unittest \
  scripts.test_sync_main_data_to_dev \
  scripts.test_stage4_pipeline_blockers \
  scripts.test_automation_deploy \
  scripts.test_hourly_casascius_workspace \
  scripts.test_pages_build

"$PYTHON_BIN" scripts/test_incremental_publication_markers.py
"$PYTHON_BIN" scripts/test_stage4_publication_markers.py
"$PYTHON_BIN" scripts/test_quantum_publication_marker.py

echo "All portable project checks passed."
