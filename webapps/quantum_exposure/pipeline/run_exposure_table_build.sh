#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3}"
RUN_ANALYSIS="${RUN_ANALYSIS:-1}"
FREEZE_HEIGHT="${FREEZE_HEIGHT:-}"

declare -a PHASE_PIDS=()
declare -a PHASE_LABELS=()

run_job() {
    local label="$1"
    shift

    printf '\n[%s] starting\n' "$label"
    (
        cd "$ROOT_DIR"
        exec "$@"
    ) &

    PHASE_PIDS+=("$!")
    PHASE_LABELS+=("$label")
}

wait_for_phase() {
    local failed=0
    local index pid status

    for index in "${!PHASE_PIDS[@]}"; do
        pid="${PHASE_PIDS[$index]}"
        if wait "$pid"; then
            printf '[%s] finished\n' "${PHASE_LABELS[$index]}"
        else
            status=$?
            printf '[%s] failed with exit code %s\n' "${PHASE_LABELS[$index]}" "$status" >&2
            failed=1
        fi
    done

    if [[ "$failed" -ne 0 ]]; then
        for pid in "${PHASE_PIDS[@]}"; do
            kill "$pid" 2>/dev/null || true
        done
        exit 1
    fi

    PHASE_PIDS=()
    PHASE_LABELS=()
}

printf 'Using Python: %s\n' "$PYTHON_BIN"
printf 'Workspace: %s\n' "$ROOT_DIR"
if [[ -n "$FREEZE_HEIGHT" ]]; then
    printf 'Requested freeze height: %s\n' "$FREEZE_HEIGHT"
fi

printf '\n== Phase 1: root build ==\n'
cd "$ROOT_DIR"
if [[ -n "$FREEZE_HEIGHT" ]]; then
    "$PYTHON_BIN" run_key_outputs_all.py --freeze-height "$FREEZE_HEIGHT"
else
    "$PYTHON_BIN" run_key_outputs_all.py
fi

printf '\n== Phase 2: independent branches ==\n'
run_job "exposed_keyhash20" "$PYTHON_BIN" run_exposed_keyhash20.py
run_job "exposed_p2sh_address" "$PYTHON_BIN" run_exposed_script_address.py --table exposed_p2sh_address --scripttype scripthash
run_job "exposed_p2wsh_address" "$PYTHON_BIN" run_exposed_script_address.py --table exposed_p2wsh_address --scripttype witness_v0_scripthash
run_job "active_p2tr_outputs" "$PYTHON_BIN" run_active_p2tr_outputs.py
run_job "active_bare_ms_outputs" "$PYTHON_BIN" run_active_bare_ms_outputs.py
wait_for_phase

printf '\n== Phase 3: dependent branches ==\n'
run_job "active_key_outputs" "$PYTHON_BIN" run_active_key_outputs.py
run_job "active_p2sh_outputs" "$PYTHON_BIN" run_active_script_hash_outputs.py --table active_p2sh_outputs --scripttype scripthash --exposed-table exposed_p2sh_address
run_job "active_p2wsh_outputs" "$PYTHON_BIN" run_active_script_hash_outputs.py --table active_p2wsh_outputs --scripttype witness_v0_scripthash --exposed-table exposed_p2wsh_address
wait_for_phase

if [[ "$RUN_ANALYSIS" == "1" ]]; then
    printf '\n== Phase 4: dashboard analysis ==\n'
    "$PYTHON_BIN" run_dashboard_analysis.py

    printf '\n== Phase 5: correct aggregate pubkey counts (>=1 BTC) ==\n'
    "$PYTHON_BIN" correct_aggregated_pubkey_counts.py --snapshot "$(cat ../webapp_data/latest_snapshot.txt)"
else
    printf '\nSkipping dashboard analysis because RUN_ANALYSIS=%s\n' "$RUN_ANALYSIS"
fi