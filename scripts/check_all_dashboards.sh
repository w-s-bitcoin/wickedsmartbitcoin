#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

run_smoke=0
if [[ "${1:-}" == "--smoke" ]]; then
  run_smoke=1
fi

echo "Checking dashboard scripts..."
bash -n scripts/create_dashboard.sh scripts/check_dashboard_contract.sh scripts/smoke_dashboards.sh scripts/check_all_dashboards.sh

echo "Checking dashboard contracts..."
while IFS= read -r dashboard; do
  [[ "$dashboard" == "webapps/casascius_explorer" ]] && continue
  scripts/check_dashboard_contract.sh "$dashboard" >/dev/null
done < <(find webapps -mindepth 1 -maxdepth 1 -type d -exec test -f '{}/dashboard.html' ';' -print | sort)

echo "Checking shared component wiring..."
if grep -R "navigator.clipboard.writeText" webapps --include='dashboard_app.js' >/dev/null; then
  echo "Direct clipboard writes found in dashboard apps; use WSBDashboardComponents.copyDashboardLink()." >&2
  exit 1
fi

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Checking whitespace..."
  git diff --check
fi

if [[ "$run_smoke" -eq 1 ]]; then
  echo "Running browser smoke checks..."
  scripts/smoke_dashboards.sh
fi

echo "All dashboard checks passed."
