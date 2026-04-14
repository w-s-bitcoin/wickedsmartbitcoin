from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd


DEFAULT_CONTRIBUTION_USD = 1.0
DEFAULT_START_DATE = "2011-06-05"


def parse_bool(value: object) -> bool:
    s = str(value).strip().lower()
    return s in {"1", "true", "t", "yes", "y"}


def load_price_history(csv_path: Path, start_date: str) -> tuple[pd.DataFrame, dict]:
    if not csv_path.exists():
        raise FileNotFoundError(f"Price history not found: {csv_path}")

    df = pd.read_csv(csv_path)
    if "timestamp" not in df.columns or "price" not in df.columns:
        raise ValueError("Source CSV must include at least 'timestamp' and 'price' columns")

    df = df.copy()
    df["timestamp_utc"] = pd.to_datetime(df["timestamp"], utc=True, errors="coerce")
    df["price"] = pd.to_numeric(df["price"], errors="coerce")
    df["block_height"] = pd.to_numeric(df.get("block_height", np.nan), errors="coerce")

    if "eod_utc" in df.columns:
        df["eod_utc"] = df["eod_utc"].apply(parse_bool)
    else:
        df["eod_utc"] = True

    df = df.dropna(subset=["timestamp_utc", "price"]).copy()
    df = df[df["price"] > 0].copy()
    df = df.sort_values("timestamp_utc").reset_index(drop=True)

    df["date_iso"] = df["timestamp_utc"].dt.strftime("%Y-%m-%d")

    latest_snapshot_row = df.iloc[-1]
    latest_snapshot_block = pd.to_numeric(latest_snapshot_row.get("block_height", np.nan), errors="coerce")
    latest_snapshot = {
        "timestamp_utc": pd.to_datetime(latest_snapshot_row["timestamp_utc"], utc=True, errors="coerce"),
        "date_iso": str(latest_snapshot_row["date_iso"]),
        "price": float(latest_snapshot_row["price"]),
        "block_height": int(latest_snapshot_block) if np.isfinite(latest_snapshot_block) else 0,
    }

    eod = df[df["eod_utc"]].copy()
    eod = eod.sort_values("timestamp_utc").drop_duplicates(subset=["date_iso"], keep="last")
    eod = eod.reset_index(drop=True)

    if eod.empty:
        raise ValueError("No end-of-day rows found after filtering.")

    start_ts = pd.to_datetime(start_date, utc=True, errors="coerce")
    if pd.isna(start_ts):
        raise ValueError(f"Invalid --start-date value: {start_date}")

    eod = eod[eod["timestamp_utc"] >= start_ts].copy().reset_index(drop=True)
    if eod.empty:
        raise ValueError(f"No rows on/after start date {start_date}")

    eod["weekday"] = eod["timestamp_utc"].dt.weekday
    eod["day"] = eod["timestamp_utc"].dt.day
    eod["block_height"] = eod["block_height"].ffill().fillna(0).astype(int)

    return eod, latest_snapshot


def compute_duration_series(
    df: pd.DataFrame,
    buy_mask_full: pd.Series,
    contribution_usd: float,
    latest_snapshot: dict | None = None,
    use_current_price_for_one_day: bool = False,
    carry_last_buy_forward: bool = False,
) -> pd.DataFrame:
    end_price = float(df.iloc[-1]["price"])
    end_timestamp = pd.to_datetime(df.iloc[-1]["timestamp_utc"], utc=True, errors="coerce")
    end_date_iso = str(df.iloc[-1]["date_iso"])
    end_block_height = int(df.iloc[-1]["block_height"])

    if latest_snapshot:
        snapshot_price = pd.to_numeric(latest_snapshot.get("price", np.nan), errors="coerce")
        snapshot_timestamp = pd.to_datetime(latest_snapshot.get("timestamp_utc", pd.NaT), utc=True, errors="coerce")
        snapshot_date_iso = str(latest_snapshot.get("date_iso", "") or "").strip()
        snapshot_block = pd.to_numeric(latest_snapshot.get("block_height", np.nan), errors="coerce")

        if np.isfinite(snapshot_price) and float(snapshot_price) > 0:
            end_price = float(snapshot_price)
        if not pd.isna(snapshot_timestamp):
            end_timestamp = snapshot_timestamp
        if snapshot_date_iso:
            end_date_iso = snapshot_date_iso
        if np.isfinite(snapshot_block):
            end_block_height = int(snapshot_block)

    buy_indices = np.array([], dtype=int)
    if carry_last_buy_forward:
        buy_indices = np.flatnonzero(buy_mask_full.to_numpy())

    rows: list[dict] = []
    n = len(df)

    for i in range(n):
        start_idx = n - 1 - i
        effective_start_idx = start_idx
        if carry_last_buy_forward and buy_indices.size > 0:
            prior_pos = int(np.searchsorted(buy_indices, start_idx, side="right") - 1)
            if prior_pos >= 0:
                effective_start_idx = int(buy_indices[prior_pos])

        window = df.iloc[effective_start_idx:].copy()
        window_buys = window[buy_mask_full.iloc[effective_start_idx:]].copy()
        purchase_count = int(len(window_buys))

        if purchase_count > 0:
            invested_usd = purchase_count * contribution_usd
            btc_accum = float((contribution_usd / window_buys["price"]).sum())
            dca_basis = invested_usd / btc_accum if btc_accum > 0 else np.nan
            is_price_above = 1 if end_price >= dca_basis else 0
        else:
            invested_usd = 0.0
            btc_accum = 0.0
            dca_basis = np.nan
            is_price_above = np.nan

        row = df.iloc[start_idx]
        days_ago = i + 1

        row_date_iso = row["date_iso"]
        row_timestamp = row["timestamp_utc"]
        row_block_height = int(row["block_height"])
        historical_price = float(row["price"])

        if use_current_price_for_one_day and days_ago == 1:
            # Treat the 1-day daily DCA row as a first buy at the latest available snapshot price.
            purchase_count = 1
            invested_usd = contribution_usd
            btc_accum = contribution_usd / end_price
            dca_basis = end_price
            is_price_above = 1
            row_date_iso = end_date_iso
            row_timestamp = end_timestamp
            row_block_height = end_block_height
            historical_price = end_price

        rows.append({
            "days_ago": days_ago,
            "years_ago": days_ago / 365.25,
            "date_iso": row_date_iso,
            "timestamp_utc": row_timestamp,
            "block_height": row_block_height,
            "historical_price": historical_price,
            "current_price": end_price,
            "dca_basis": dca_basis,
            "invested_usd": invested_usd,
            "btc_accum": btc_accum,
            "purchase_count": purchase_count,
            "is_price_above": is_price_above,
            "window_end_timestamp_utc": end_timestamp,
        })

    # Left-to-right chart orientation: oldest duration on the left, 1 day on the right.
    out = pd.DataFrame(rows).sort_values("days_ago", ascending=False).reset_index(drop=True)
    return out


def last_valid_number(series: pd.Series) -> float | None:
    valid = series[np.isfinite(series)]
    if valid.empty:
        return None
    return float(valid.iloc[-1])


def last_valid_row(df: pd.DataFrame) -> pd.Series | None:
    valid = df[np.isfinite(df["dca_basis"]) & (df["purchase_count"] > 0)]
    if valid.empty:
        return None
    return valid.iloc[-1]


def build_metadata(
    source_df: pd.DataFrame,
    daily_df: pd.DataFrame,
    weekly_df: pd.DataFrame,
    monthly_df: pd.DataFrame,
    contribution_usd: float,
    start_date: str,
    latest_snapshot: dict | None = None,
) -> dict:
    latest_row = source_df.iloc[-1]
    current_price = float(latest_row["price"])
    latest_timestamp_utc = pd.to_datetime(latest_row["timestamp_utc"], utc=True)
    latest_date_iso = str(latest_row["date_iso"])
    latest_block_height = int(latest_row["block_height"])

    if latest_snapshot:
        snapshot_price = pd.to_numeric(latest_snapshot.get("price", np.nan), errors="coerce")
        snapshot_timestamp = pd.to_datetime(latest_snapshot.get("timestamp_utc", pd.NaT), utc=True, errors="coerce")
        snapshot_date_iso = str(latest_snapshot.get("date_iso", "") or "").strip()
        snapshot_block = pd.to_numeric(latest_snapshot.get("block_height", np.nan), errors="coerce")

        if np.isfinite(snapshot_price) and float(snapshot_price) > 0:
            current_price = float(snapshot_price)
        if not pd.isna(snapshot_timestamp):
            latest_timestamp_utc = snapshot_timestamp
        if snapshot_date_iso:
            latest_date_iso = snapshot_date_iso
        if np.isfinite(snapshot_block):
            latest_block_height = int(snapshot_block)

    latest_date = pd.to_datetime(latest_date_iso, utc=True)

    def cadence_kpi(name: str, df: pd.DataFrame) -> dict:
        row = last_valid_row(df)
        if row is None:
            return {
                "name": name,
                "current_basis": None,
                "current_return_pct": None,
                "invested_usd": 0.0,
                "btc_accum": 0.0,
                "purchase_count": 0,
                "days_ago": None,
            }

        basis = float(row["dca_basis"])
        ret = ((current_price - basis) / basis) * 100.0 if basis > 0 else None
        return {
            "name": name,
            "current_basis": basis,
            "current_return_pct": ret,
            "invested_usd": float(row["invested_usd"]),
            "btc_accum": float(row["btc_accum"]),
            "purchase_count": int(row["purchase_count"]),
            "days_ago": int(row["days_ago"]),
        }

    halvings = [
        {"label": "1st Halving", "date": "2012-11-28"},
        {"label": "2nd Halving", "date": "2016-07-09"},
        {"label": "3rd Halving", "date": "2020-05-11"},
        {"label": "4th Halving", "date": "2024-04-20"},
    ]

    for h in halvings:
        h_date = pd.to_datetime(h["date"], utc=True)
        h["days_ago"] = int((latest_date - h_date).days + 1)

    return {
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "source": {
            "path": "assets/daily_price.csv",
            "start_date": start_date,
            "latest_date": latest_date_iso,
            "latest_timestamp_utc": latest_timestamp_utc.isoformat(),
            "latest_block_height": latest_block_height,
            "latest_price": current_price,
            "duration_days": int(len(source_df)),
        },
        "settings": {
            "contribution_usd": contribution_usd,
            "weekly_rule": "end_of_day_friday",
            "monthly_rule": "end_of_day_day_1",
            "daily_rule": "end_of_day_every_day",
        },
        "kpis": {
            "daily_dca": cadence_kpi("daily_dca", daily_df),
            "weekly_dca": cadence_kpi("weekly_dca", weekly_df),
            "monthly_dca": cadence_kpi("monthly_dca", monthly_df),
        },
        "halvings": halvings,
    }


def write_csv(df: pd.DataFrame, output_path: Path) -> None:
    save_df = df.copy()
    save_df["timestamp_utc"] = save_df["timestamp_utc"].dt.strftime("%Y-%m-%d %H:%M:%S")
    save_df["window_end_timestamp_utc"] = save_df["window_end_timestamp_utc"].dt.strftime("%Y-%m-%d %H:%M:%S")
    save_df.to_csv(output_path, index=False, float_format="%.10f")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build duration-based DCA cost basis webapp datasets.")
    parser.add_argument(
      "--contribution-usd",
      type=float,
      default=DEFAULT_CONTRIBUTION_USD,
      help="USD contribution amount used for each recurring purchase event.",
    )
    parser.add_argument(
      "--start-date",
      type=str,
      default=DEFAULT_START_DATE,
      help="Earliest UTC date to include (YYYY-MM-DD).",
    )
    args = parser.parse_args()

    here = Path(__file__).resolve().parent
    repo_root = here.parent.parent
    source_csv = repo_root / "assets" / "daily_price.csv"
    output_dir = here / "webapp_data"
    output_dir.mkdir(parents=True, exist_ok=True)

    source_df, latest_snapshot = load_price_history(source_csv, args.start_date)

    daily_mask = pd.Series(True, index=source_df.index)
    weekly_mask = source_df["weekday"] == 4
    monthly_mask = source_df["day"] == 1

    daily_dca = compute_duration_series(
        source_df,
        daily_mask,
        args.contribution_usd,
        latest_snapshot=latest_snapshot,
        use_current_price_for_one_day=True,
    )
    weekly_dca = compute_duration_series(
        source_df,
        weekly_mask,
        args.contribution_usd,
        latest_snapshot=latest_snapshot,
        carry_last_buy_forward=True,
    )
    monthly_dca = compute_duration_series(
        source_df,
        monthly_mask,
        args.contribution_usd,
        latest_snapshot=latest_snapshot,
        carry_last_buy_forward=True,
    )

    combined = source_df[["date_iso", "timestamp_utc", "price", "block_height"]].copy()
    combined["days_ago"] = np.arange(len(source_df), 0, -1)
    combined["daily_dca_basis"] = daily_dca["dca_basis"].values
    combined["weekly_dca_basis"] = weekly_dca["dca_basis"].values
    combined["monthly_dca_basis"] = monthly_dca["dca_basis"].values

    write_csv(daily_dca, output_dir / "daily_dca.csv")
    write_csv(weekly_dca, output_dir / "weekly_dca.csv")
    write_csv(monthly_dca, output_dir / "monthly_dca.csv")
    combined.to_csv(output_dir / "dca_series_combined.csv", index=False, float_format="%.10f")

    metadata = build_metadata(
      source_df,
      daily_dca,
      weekly_dca,
      monthly_dca,
      args.contribution_usd,
      args.start_date,
            latest_snapshot=latest_snapshot,
    )
    (output_dir / "dca_cost_basis_metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    print(f"Wrote: {output_dir / 'daily_dca.csv'}")
    print(f"Wrote: {output_dir / 'weekly_dca.csv'}")
    print(f"Wrote: {output_dir / 'monthly_dca.csv'}")
    print(f"Wrote: {output_dir / 'dca_series_combined.csv'}")
    print(f"Wrote: {output_dir / 'dca_cost_basis_metadata.json'}")


if __name__ == "__main__":
    main()
