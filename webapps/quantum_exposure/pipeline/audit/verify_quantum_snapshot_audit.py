#!/usr/bin/env python3
"""Read-only Quantum snapshot reconciliation; never imports or runs producers.

The detail table contains only exposed groups meeting the producer's >=1 BTC
eligibility rule. The matching aggregate slice should cover those groups under
the same rule. Differences establish an inconsistency, not its cause.

Only selected snapshot CSVs are scanned. AST probes execute allow-listed pure
parser helpers, not module initialization or main(). Checked-in evidence records
the pre-fix baseline; a new run reports the current parser implementation.
"""
from __future__ import annotations

import argparse
import ast
import csv
import json
import re
from collections import Counter
from functools import lru_cache
from pathlib import Path


def integer(value: str | int | None) -> int:
    if value is None or value == "":
        return 0
    return int(value)


def script_supply(row: dict[str, str]) -> dict[str, int]:
    raw = row.get("exposed_supply_sats_by_script_type", "")
    if raw:
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise ValueError("Per-script supply must be a JSON object")
        return {str(key): integer(amount) for key, amount in value.items()}
    amount = integer(row.get("exposed_supply_sats"))
    script_type = row.get("script_type") or row.get("script_types") or "unknown"
    return {script_type: amount}


def reconcile_snapshot(data_dir: Path, height: str) -> dict:
    directory = data_dir / height
    if not directory.is_dir():
        directory = data_dir / "archived" / height
    detail_path = directory / "dashboard_pubkeys_ge_1btc.csv"
    aggregate_path = directory / "dashboard_pubkeys_aggregates.csv"
    totals = Counter()
    detail_activity: dict[str, Counter] = {}
    with detail_path.open(encoding="utf-8", newline="") as stream:
        reader = csv.DictReader(stream)
        if not reader.fieldnames:
            raise ValueError(f"Missing CSV header: {detail_path}")
        for row in reader:
            amounts = script_supply(row)
            supply = sum(amounts.values())
            utxos = integer(row.get("exposed_utxo_count"))
            totals["rows"] += 1
            totals["exposed_supply_sats"] += supply
            totals["exposed_utxo_count"] += utxos
            if len(amounts) > 1:
                totals["mixed_script_rows"] += 1
            if integer(row.get("last_spend_blockheight")) == 1:
                totals["sentinel_last_spend_rows"] += 1
                totals["sentinel_exposed_supply_sats"] += supply
                totals["sentinel_exposed_utxo_count"] += utxos
            activity = row.get("spend_activity") or "unknown"
            activity_totals = detail_activity.setdefault(activity, Counter())
            activity_totals["rows"] += 1
            activity_totals["exposed_supply_sats"] += supply
            activity_totals["exposed_utxo_count"] += utxos
    with aggregate_path.open(encoding="utf-8", newline="") as stream:
        matching = [
            row for row in csv.DictReader(stream)
            if row.get("balance_filter") == "ge1"
            and row.get("script_type_filter") == "All"
            and row.get("spend_activity_filter") == "all"
        ]
    if len(matching) != 1:
        raise ValueError(f"Expected exactly one ge1/All/all aggregate, found {len(matching)}: {aggregate_path}")
    aggregate = matching[0]
    aggregate_metrics = {
        metric: integer(aggregate.get(metric))
        for metric in ("exposed_pubkey_count", "exposed_utxo_count", "exposed_supply_sats")
    }
    return {
        "snapshot": int(height),
        "detail_path": str(detail_path),
        "aggregate_path": str(aggregate_path),
        "detail_csv_bytes": detail_path.stat().st_size,
        "detail": {key: totals[key] for key in (
            "rows", "exposed_supply_sats", "exposed_utxo_count", "mixed_script_rows",
            "sentinel_last_spend_rows", "sentinel_exposed_supply_sats", "sentinel_exposed_utxo_count",
        )},
        "detail_by_activity": dict(sorted(detail_activity.items())),
        "aggregate_slice": {"balance_filter": "ge1", "script_type_filter": "All", "spend_activity_filter": "all"},
        "aggregate": aggregate_metrics,
        "detail_minus_aggregate": {
            metric: totals[metric] - aggregate_metrics[metric]
            for metric in ("exposed_supply_sats", "exposed_utxo_count")
        },
    }


def probe_multisig_parser(pipeline_dir: Path) -> dict:
    source_path = pipeline_dir / "run_dashboard_analysis.py"
    module = ast.parse(source_path.read_text(encoding="utf-8"), filename=str(source_path))
    function_names = {"_decode_small_int_opcode", "_parse_multisig_threshold"}
    selected = [node for node in module.body if isinstance(node, ast.FunctionDef) and node.name in function_names]
    if {node.name for node in selected} != function_names:
        raise ValueError("Expected pure parser helpers are missing")
    namespace = {"re": re}
    source_files = [str(source_path)]
    implementation = "legacy-inline"
    calls_canonical = any(isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                          and node.func.id == "parse_multisig"
                          for function in selected for node in ast.walk(function))
    if calls_canonical:
        canonical_path = pipeline_dir / "quantum_v2_analysis.py"
        canonical = ast.parse(canonical_path.read_text(encoding="utf-8"), filename=str(canonical_path))
        helper_names = {"valid_pubkey", "parse_multisig"}
        if any(isinstance(node, ast.FunctionDef) and node.name == "_valid_multisig_pubkey"
               for node in canonical.body):
            helper_names.add("_valid_multisig_pubkey")
        helpers = [node for node in canonical.body if isinstance(node, ast.FunctionDef)
                   and node.name in helper_names]
        if {node.name for node in helpers} != helper_names:
            raise ValueError("Expected canonical pure parser helpers are missing")
        constants = [node for node in canonical.body if isinstance(node, ast.Assign)
                     and any(isinstance(target, ast.Name) and target.id == "SECP256K1_P" for target in node.targets)]
        if len(constants) != 1:
            raise ValueError("Expected secp256k1 field constant is missing")
        namespace["SECP256K1_P"] = ast.literal_eval(constants[0].value)
        namespace["lru_cache"] = lru_cache
        exec(compile(ast.Module(body=helpers, type_ignores=[]), str(canonical_path), "exec"), namespace)
        source_files.append(str(canonical_path))
        implementation = "canonical-v2"
    exec(compile(ast.Module(body=selected, type_ignores=[]), str(source_path), "exec"), namespace)
    parser = namespace["_parse_multisig_threshold"]
    invalid_vectors = [
        ("missing_pubkey", "5151ae"),
        ("one_byte_pubkey", "51010151ae"),
        ("invalid_33_byte_pubkey", "5121" + "00" * 33 + "51ae"),
    ]
    return {
        "source": str(source_path),
        "source_files": source_files,
        "implementation": implementation,
        "method": "AST extraction of allow-listed pure helpers; no producer imports or database access",
        "invalid_vectors": [
            {"name": name, "script_hex": script, "expected": None, "actual": parser(script)}
            for name, script in invalid_vectors
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, required=True, help="Quantum webapp_data directory to read")
    parser.add_argument("--snapshots", nargs="+", default=["961000", "850000", "500000"])
    parser.add_argument("--pipeline-dir", type=Path, help="Default: sibling pipeline directory")
    parser.add_argument("--skip-parser-probe", action="store_true")
    args = parser.parse_args()
    data_dir = args.data_dir.resolve()
    if any(not height.isdigit() for height in args.snapshots):
        parser.error("Snapshot heights must be nonnegative decimal integers")
    result = {
        "read_only": True,
        "data_dir": str(data_dir),
        "snapshots": [reconcile_snapshot(data_dir, height) for height in args.snapshots],
    }
    if not args.skip_parser_probe:
        result["parser_probe"] = probe_multisig_parser((args.pipeline_dir or data_dir.parent / "pipeline").resolve())
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
