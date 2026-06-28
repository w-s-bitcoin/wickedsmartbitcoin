#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

CHROME_BIN="${CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
if [[ ! -x "$CHROME_BIN" ]]; then
  echo "Chrome not found at: $CHROME_BIN" >&2
  echo "Set CHROME_BIN to a Chromium-compatible browser binary." >&2
  exit 2
fi

if [[ "$#" -gt 0 ]]; then
  dashboards=("$@")
else
  dashboards=()
  while IFS= read -r dashboard; do
    [[ "$dashboard" == "webapps/casascius_explorer" ]] && continue
    dashboards+=("$dashboard")
  done < <(find webapps -mindepth 1 -maxdepth 1 -type d -exec test -f '{}/dashboard.html' ';' -print | sort)
fi

if [[ "${#dashboards[@]}" -eq 0 ]]; then
  echo "No dashboards found." >&2
  exit 1
fi

port="$(
  python3 - <<'PY'
import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()
PY
)"

profile_dir="/tmp/wsb-dashboard-smoke-profile-$$"
server_log="/tmp/wsb-dashboard-smoke-server-$$.log"
"${PYTHON_BIN:-python3}" -m http.server "$port" --bind 127.0.0.1 >"$server_log" 2>&1 &
server_pid="$!"

cleanup() {
  kill "$server_pid" >/dev/null 2>&1 || true
  wait "$server_pid" >/dev/null 2>&1 || true
  rm -rf "$profile_dir"
}
trap cleanup EXIT

python3 - "$port" <<'PY'
import sys, time, urllib.request
port = sys.argv[1]
url = f"http://127.0.0.1:{port}/"
for _ in range(50):
    try:
        urllib.request.urlopen(url, timeout=0.2).read(1)
        break
    except Exception:
        time.sleep(0.1)
else:
    raise SystemExit("Local smoke server did not start")
PY

for dashboard in "${dashboards[@]}"; do
  scripts/check_dashboard_contract.sh "$dashboard" >/dev/null
  slug="$(basename "$dashboard")"
  url="http://127.0.0.1:${port}/${dashboard}/dashboard.html"
  dom_file="/tmp/wsb-dashboard-smoke-${slug}-$$.html"
  chrome_log="/tmp/wsb-dashboard-smoke-${slug}-chrome-$$.log"
  set +e
  python3 - "$CHROME_BIN" "$profile_dir" "${SMOKE_BUDGET_MS:-7000}" "${SMOKE_TIMEOUT_SEC:-20}" "$url" "$dom_file" "$chrome_log" <<'PY'
import subprocess
import sys

chrome, profile, budget, timeout, url, dom_file, chrome_log = sys.argv[1:]
cmd = [
    chrome,
    "--headless=new",
    "--disable-gpu",
    f"--user-data-dir={profile}",
    "--window-size=1440,1000",
    f"--virtual-time-budget={budget}",
    "--dump-dom",
    url,
]
with open(dom_file, "w") as out, open(chrome_log, "w") as err:
    try:
        result = subprocess.run(cmd, stdout=out, stderr=err, timeout=float(timeout))
    except subprocess.TimeoutExpired:
        out.flush()
        try:
            with open(dom_file, "r") as check:
                if "<body" in check.read().lower():
                    raise SystemExit(0)
        except OSError:
            pass
        raise SystemExit(124)
if result.returncode != 0:
    raise SystemExit(result.returncode)
PY
  chrome_status="$?"
  set -e
  if [[ "$chrome_status" -eq 124 ]]; then
    echo "Smoke failure in $dashboard: Chrome timed out; see $chrome_log" >&2
    exit 1
  elif [[ "$chrome_status" -ne 0 ]]; then
    echo "Smoke failure in $dashboard: Chrome exited $chrome_status; see $chrome_log" >&2
    exit 1
  fi
  if ! grep -Fqi "<body" "$dom_file"; then
    echo "Smoke failure in $dashboard: Chrome did not return a document body" >&2
    exit 1
  fi
  if grep -Fqi "This site can't be reached" "$dom_file"; then
    echo "Smoke failure in $dashboard: Chrome could not load $url" >&2
    exit 1
  fi
  echo "Smoke passed: $dashboard"
done
