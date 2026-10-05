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
"$PYTHON_BIN" scripts/test_quantum_v2_analysis.py
"$PYTHON_BIN" scripts/test_quantum_immutable_generation.py
"$PYTHON_BIN" scripts/test_quantum_v2_delivery.py
"$PYTHON_BIN" scripts/test_quantum_subprocess.py
"$PYTHON_BIN" scripts/test_quantum_v2_control.py
"$PYTHON_BIN" scripts/test_quantum_v2_worker.py
"$PYTHON_BIN" scripts/test_quantum_resources.py
"$PYTHON_BIN" scripts/test_quantum_scheduler.py
"$PYTHON_BIN" scripts/test_quantum_acceptance.py
"$PYTHON_BIN" scripts/test_quantum_live_export.py
"$PYTHON_BIN" scripts/test_quantum_script_hydration.py
"$PYTHON_BIN" scripts/test_quantum_canonical_seed.py
"$PYTHON_BIN" scripts/test_quantum_canonical_reducer.py
"$PYTHON_BIN" scripts/test_quantum_policy_cache.py
"$PYTHON_BIN" scripts/test_quantum_v2_validation.py
"$PYTHON_BIN" scripts/test_quantum_null_script_indexes.py
"$PYTHON_BIN" scripts/test_measure_quantum_seed.py
node scripts/test_quantum_browser_contract.mjs

echo "All portable project checks passed."
