#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT/dist"

copy_path() {
  local rel_path="$1"
  local src="$ROOT/$rel_path"
  local dest="$DIST/$rel_path"

  if [[ ! -e "$src" ]]; then
    return 0
  fi

  mkdir -p "$(dirname "$dest")"
  cp -R "$src" "$dest"
}

rm -rf "$DIST"
mkdir -p "$DIST"

# Root files served directly by GitHub Pages.
for html_file in "$ROOT"/*.html; do
  [[ -f "$html_file" ]] || continue
  copy_path "$(basename "$html_file")"
done
copy_path "manifest.json"
copy_path "CNAME"
copy_path ".nojekyll"

# Homepage runtime.
copy_path "assets"
copy_path "js"

# Shared dashboard runtime.
copy_path "webapps/shared"

# Per-dashboard runtime. Pipeline/script directories are stripped below.
for app_dir in "$ROOT"/webapps/*; do
  [[ -d "$app_dir" ]] || continue
  app_name="$(basename "$app_dir")"
  [[ "$app_name" == "shared" ]] && continue

  copy_path "webapps/$app_name/dashboard.html"
  copy_path "webapps/$app_name/dashboard_app.js"
  copy_path "webapps/$app_name/dashboard.css"
  copy_path "webapps/$app_name/preview.html"
  copy_path "webapps/$app_name/preview_app.js"
  copy_path "webapps/$app_name/standalone_bootstrap.js"
  copy_path "webapps/$app_name/standalone_app.js"
  copy_path "webapps/$app_name/casascius_explorer.js"
  copy_path "webapps/$app_name/casascius_explorer.css"
  copy_path "webapps/$app_name/METHODOLOGY.pdf"
  copy_path "webapps/$app_name/assets"
  copy_path "webapps/$app_name/coins_and_bars"
  copy_path "webapps/$app_name/data"
  copy_path "webapps/$app_name/icons"
  copy_path "webapps/$app_name/preview_assets"
  copy_path "webapps/$app_name/webapp_data"
done

# First-pass deploy pruning: remove files that are either pipeline-only or raw
# inputs that should not be served by the browser.
rm -f "$DIST"/assets/block_data_*.csv
rm -f "$DIST"/assets/btcusd_10m_prices.csv
rm -rf "$DIST"/webapps/*/pipeline
rm -rf "$DIST"/webapps/*/scripts
rm -rf "$DIST"/webapps/*/gradings
rm -rf "$DIST"/webapps/quantum_exposure/webapp_data/archived
rm -rf "$DIST"/webapps/quantum_exposure/webapp_data/arkham

# Quantum Pages ships compact aggregates/top-100 rows for historical snapshots.
# Keep the full >=1 BTC table only for the current snapshot, where explicit
# address search or table expansion can request it on demand.
QUANTUM_DATA="$DIST/webapps/quantum_exposure/webapp_data"
QUANTUM_INDEX="$QUANTUM_DATA/snapshots_index.csv"
if [[ -f "$QUANTUM_INDEX" ]]; then
  QUANTUM_CURRENT_SNAPSHOT="$(awk -F, 'NR == 2 { gsub(/\r/, "", $1); print $1; exit }' "$QUANTUM_INDEX")"
  if [[ ! "$QUANTUM_CURRENT_SNAPSHOT" =~ ^[0-9]+$ ]]; then
    echo "Could not determine current Quantum snapshot from $QUANTUM_INDEX" >&2
    exit 1
  fi
  find "$QUANTUM_DATA" -mindepth 2 -maxdepth 2 -name "dashboard_pubkeys_ge_1btc.csv" \
    ! -path "$QUANTUM_DATA/$QUANTUM_CURRENT_SNAPSHOT/dashboard_pubkeys_ge_1btc.csv" -delete
  if [[ ! -f "$QUANTUM_DATA/$QUANTUM_CURRENT_SNAPSHOT/dashboard_pubkeys_ge_1btc.csv" ]]; then
    echo "Missing current Quantum full-row snapshot: $QUANTUM_CURRENT_SNAPSHOT" >&2
    exit 1
  fi
fi

rm -f "$DIST"/webapps/bip110_signaling/webapp_data/bip110_miners.json
rm -f "$DIST"/webapps/bip110_signaling/webapp_data/bip110_signal_miners.json
rm -f "$DIST"/webapps/bip110_signaling/webapp_data/bip110_node_miners.json
rm -f "$DIST"/webapps/bip110_signaling/webapp_data/bip110_node_signal_miners.json
rm -f "$DIST"/webapps/bip110_signaling/webapp_data/segwit_miners.json

BIP110_ATTRIBUTIONS="$DIST/webapps/bip110_signaling/webapp_data/miner_attributions.json"
if [[ -d "$DIST/webapps/bip110_signaling/webapp_data" && ! -f "$BIP110_ATTRIBUTIONS" ]]; then
  echo "Missing required BIP-110 runtime file: $BIP110_ATTRIBUTIONS" >&2
  exit 1
fi

find "$DIST" -name "__pycache__" -type d -prune -exec rm -rf {} +
find "$DIST" -name "*.py" -type f -delete
find "$DIST" -name "*.pyc" -type f -delete
find "$DIST" -name ".DS_Store" -type f -delete

echo "Built $DIST"
du -sh "$DIST"
