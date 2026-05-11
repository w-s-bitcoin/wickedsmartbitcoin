#!/usr/bin/env python3
"""One-time historical FX spike cleaner.

Usage:
    python3 webapps/uoa/fx_spike_cleanup_standalone.py
    python3 webapps/uoa/fx_spike_cleanup_standalone.py --columns lbpusd clpusd

This script applies the same transient-spike cleanup logic used by the
ongoing updater, directly to webapp_data/daily_fx_rates.csv.
"""

import argparse
from pathlib import Path

import pandas as pd

from uoa_webapp_data_update import clean_transient_spike_outliers


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="One-time historical FX spike cleanup")
    parser.add_argument(
        "--columns",
        nargs="+",
        default=None,
        help="Specific source columns to clean (e.g., lbpusd clpusd). Defaults to all *usd columns.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    webapp_dir = Path(__file__).resolve().parent / "webapp_data"
    csv_path = webapp_dir / "daily_fx_rates.csv"

    if not csv_path.exists():
        raise RuntimeError(f"Missing file: {csv_path}")

    df = pd.read_csv(csv_path)
    if "date" not in df.columns:
        raise RuntimeError("daily_fx_rates.csv missing required date column")

    if args.columns:
        requested = [str(col).strip().lower() for col in args.columns if str(col).strip()]
        spike_columns = [col for col in df.columns if col.lower() in set(requested)]
        missing = sorted(set(requested) - {col.lower() for col in spike_columns})
        if missing:
            print(f"Warning: requested columns not found and will be skipped: {', '.join(missing)}")
    else:
        spike_columns = [col for col in df.columns if col != "date" and col.lower().endswith("usd")]

    if not spike_columns:
        raise RuntimeError("No matching FX source columns found to clean")

    print(f"Cleaning source columns: {', '.join(spike_columns)}")

    cleaned_df, spike_fixes = clean_transient_spike_outliers(
        df,
        spike_columns,
        max_spike_days=21,
        spike_factor=1.3,
        anchor_tolerance=2.5,
        baseline_window=45,
        recovery_window=7,
        merge_gap_days=1,
        max_anchor_gap_days=60,
    )

    total_runs = sum(spike_fixes.values()) if spike_fixes else 0
    if total_runs == 0:
        print("No transient spike runs detected; no file changes made.")
        return

    cleaned_df.to_csv(csv_path, index=False)

    top_cols = sorted(spike_fixes.items(), key=lambda kv: kv[1], reverse=True)[:12]
    top_text = ", ".join(f"{col}:{count}" for col, count in top_cols)

    print("Historical FX spike cleanup complete")
    print(f"  Cleaned runs total: {total_runs}")
    print(f"  Columns touched: {len(spike_fixes)}")
    print(f"  Top columns: {top_text}")
    print(f"  Updated file: {csv_path}")


if __name__ == "__main__":
    main()
