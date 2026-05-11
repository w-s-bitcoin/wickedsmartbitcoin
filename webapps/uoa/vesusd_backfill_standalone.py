#!/usr/bin/env python3
"""Standalone VES/USD backfill utility.

Purpose:
- Fill sparse historical VES/USD values in webapp_data/daily_fx_rates.csv.
- Use Frankfurter v2 VES rates when available.
- Backfill older pre-VES periods using legacy VEF rates converted to VES-equivalent
  at 100000 VEF = 1 VES.

This script is intentionally standalone and does not modify uoa_pairs.json.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import time

import pandas as pd
import requests

API_BASE = "https://api.frankfurter.dev/v2"
LEGACY_SCOPE = "all"
VENEZUELA_REDENOM_FACTOR = 100000.0  # 100000 VEF = 1 VES (2018 redenomination)
VES_FIRST_REDENOM_DATE = "2018-05-29"
VES_REDENOMINATION_EVENT_DATES = ["2018-05-29", "2018-08-20", "2021-10-01"]


def fetch_currency_date_bounds(code: str) -> Tuple[Optional[str], Optional[str]]:
    """Return (start_date, end_date) for a currency code from Frankfurter scope=all metadata."""
    url = f"{API_BASE}/currency/{code}"
    params = {"scope": LEGACY_SCOPE}
    resp = requests.get(url, params=params, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    if not isinstance(data, dict):
        return None, None
    start_date = str(data.get("start_date") or "").strip() or None
    end_date = str(data.get("end_date") or "").strip() or None
    return start_date, end_date


def fetch_pair_rates_chunked(base: str, quote: str, start_iso: str, end_iso: str) -> List[Tuple[str, float]]:
    """Fetch pair rates in chunks with retries to avoid large-response parse issues."""
    start_dt = datetime.strptime(start_iso, "%Y-%m-%d").date()
    end_dt = datetime.strptime(end_iso, "%Y-%m-%d").date()

    ccy_start_iso, ccy_end_iso = fetch_currency_date_bounds(base)
    if ccy_start_iso:
        ccy_start_dt = datetime.strptime(ccy_start_iso, "%Y-%m-%d").date()
        start_dt = max(start_dt, ccy_start_dt)
    if ccy_end_iso:
        ccy_end_dt = datetime.strptime(ccy_end_iso, "%Y-%m-%d").date()
        end_dt = min(end_dt, ccy_end_dt)

    if start_dt > end_dt:
        return []

    by_date: Dict[str, float] = {}
    chunk_days = 365
    cur = start_dt
    while cur <= end_dt:
        chunk_end = min(cur + timedelta(days=chunk_days - 1), end_dt)
        chunk_rates = fetch_pair_rates_once(base, quote, cur.isoformat(), chunk_end.isoformat())
        for d, r in chunk_rates:
            by_date[d] = r
        cur = chunk_end + timedelta(days=1)

    return sorted(by_date.items(), key=lambda x: x[0])


def fetch_pair_rates_once(base: str, quote: str, start_iso: str, end_iso: str, retries: int = 3) -> List[Tuple[str, float]]:
    url = f"{API_BASE}/rates"
    params = {
        "from": start_iso,
        "to": end_iso,
        "base": base,
        "quotes": quote,
    }

    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            resp = requests.get(url, params=params, timeout=45)
            resp.raise_for_status()
            data = resp.json()

            rates: List[Tuple[str, float]] = []
            if isinstance(data, list):
                for row in data:
                    d = str(row.get("date") or "").strip()
                    q = str(row.get("quote") or "").upper().strip()
                    rv = row.get("rate")
                    if d and q == quote and isinstance(rv, (int, float)):
                        rates.append((d, float(rv)))
            return rates
        except requests.HTTPError as exc:  # pragma: no cover - network/runtime guarded
            # Frankfurter may return 422 for windows where the pair has no data yet.
            if exc.response is not None and exc.response.status_code == 422:
                return []
            last_error = exc
            if attempt < retries:
                time.sleep(0.4 * attempt)
        except Exception as exc:  # pragma: no cover - network/runtime guarded
            last_error = exc
            if attempt < retries:
                time.sleep(0.4 * attempt)

    raise RuntimeError(f"Failed {base}/{quote} for {start_iso}..{end_iso}: {last_error}")


def clean_ves_redenomination_lag_points(df: pd.DataFrame, event_dates: List[str]) -> Tuple[pd.DataFrame, int]:
    """Replace obvious post-event lag points with prior-day value.

    This does not apply redenomination scaling; it only fixes clearly bad points
    (missing/non-positive or extreme one-day scale breaks) after event dates.
    """
    if "vesusd" not in df.columns or "date" not in df.columns:
        return df, 0

    cleaned = df.copy()
    cleaned["vesusd"] = pd.to_numeric(cleaned["vesusd"], errors="coerce")
    cleaned["date"] = pd.to_datetime(cleaned["date"], errors="coerce")

    event_date_set = {pd.to_datetime(event_date).date() for event_date in event_dates}
    first_event = min(event_date_set) if event_date_set else None
    if first_event is None:
        return cleaned, 0

    vals = cleaned["vesusd"].tolist()
    dates = cleaned["date"].tolist()
    fixes = 0

    for idx in range(1, len(vals) - 1):
        d = dates[idx]
        if pd.isna(d):
            continue
        day = d.date()
        if day < first_event or day in event_date_set:
            continue

        prev_val = vals[idx - 1]
        cur_val = vals[idx]
        next_val = vals[idx + 1]
        ref_candidates = [v for v in (prev_val, next_val) if pd.notna(v) and v > 0]
        if not ref_candidates:
            continue

        ref_val = float(pd.Series(ref_candidates).median())
        is_bad = False
        if pd.isna(cur_val) or cur_val <= 0:
            is_bad = True
        else:
            ratio = float(cur_val) / ref_val
            if ratio < 0.05 or ratio > 20.0:
                is_bad = True

        if is_bad and pd.notna(prev_val) and prev_val > 0:
            vals[idx] = prev_val
            fixes += 1

    cleaned["vesusd"] = vals
    return cleaned, fixes


def main() -> None:
    webapp_dir = Path(__file__).resolve().parent / "webapp_data"
    csv_path = webapp_dir / "daily_fx_rates.csv"

    df = pd.read_csv(csv_path)
    if "date" not in df.columns:
        raise RuntimeError("daily_fx_rates.csv missing required date column")
    if "vesusd" not in df.columns:
        df["vesusd"] = pd.NA

    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    if df["date"].isna().all():
        raise RuntimeError("No valid dates in daily_fx_rates.csv")

    df = df.sort_values("date").reset_index(drop=True)
    start_iso = df["date"].iloc[0].strftime("%Y-%m-%d")
    end_iso = df["date"].iloc[-1].strftime("%Y-%m-%d")

    print("=" * 64)
    print("Standalone VES/USD backfill")
    print("=" * 64)
    print(f"Dataset date range: {start_iso} -> {end_iso}")

    # Pull direct VES quotes where available.
    print("\nFetching direct VES/USD history...")
    ves_rates = fetch_pair_rates_chunked("VES", "USD", start_iso, end_iso)
    print(f"  VES rows: {len(ves_rates)}")

    # Pull legacy VEF quotes for pre-VES era and convert to VES-equivalent.
    print("Fetching legacy VEF/USD history for backfill...")
    vef_rates = fetch_pair_rates_chunked("VEF", "USD", start_iso, end_iso)
    print(f"  VEF rows: {len(vef_rates)}")

    ves_map: Dict[str, float] = {d: r for d, r in ves_rates}
    first_redenom_dt = datetime.strptime(VES_FIRST_REDENOM_DATE, "%Y-%m-%d").date()

    converted = 0
    pre_vef_map: Dict[str, float] = {}
    for d, vef_usd in vef_rates:
        d_dt = datetime.strptime(d, "%Y-%m-%d").date()
        if d_dt >= first_redenom_dt:
            continue
        # Before the first redenomination event, force canonical source to
        # VEF-converted values to avoid mixed VES/VEF scale artifacts.
        converted_val = vef_usd / VENEZUELA_REDENOM_FACTOR
        ves_map[d] = converted_val
        pre_vef_map[d] = converted_val
        converted += 1

    print(f"  Added pre-VES synthetic rows from VEF conversion: {converted}")

    before_non_null = int(pd.to_numeric(df["vesusd"], errors="coerce").notna().sum())

    date_iso = df["date"].dt.strftime("%Y-%m-%d")
    mapped = date_iso.map(ves_map)
    # Prefer direct/converted backfill values when available.
    existing_numeric = pd.to_numeric(df["vesusd"], errors="coerce")
    df["vesusd"] = mapped.combine_first(existing_numeric)

    # Enforce strict pre-redenomination source policy across all days in the
    # window, including non-trading days, to avoid inheriting stale mixed scale.
    pre_mask = df["date"] < pd.to_datetime(VES_FIRST_REDENOM_DATE)
    pre_series = pd.to_numeric(date_iso.map(pre_vef_map), errors="coerce")
    df.loc[pre_mask, "vesusd"] = pre_series.loc[pre_mask]
    df.loc[pre_mask, "vesusd"] = pd.to_numeric(df.loc[pre_mask, "vesusd"], errors="coerce").ffill()
    df, fixed_lag_points = clean_ves_redenomination_lag_points(df, VES_REDENOMINATION_EVENT_DATES)

    after_non_null = int(pd.to_numeric(df["vesusd"], errors="coerce").notna().sum())
    gained = after_non_null - before_non_null

    out_df = df.copy()
    out_df["date"] = out_df["date"].dt.strftime("%Y-%m-%d")
    out_df.to_csv(csv_path, index=False)

    print("\nBackfill complete")
    print(f"  Non-null vesusd before: {before_non_null}")
    print(f"  Non-null vesusd after : {after_non_null}")
    print(f"  Net rows gained       : {gained}")
    print(f"  Cleaned lag points    : {fixed_lag_points}")
    print(f"  Updated file          : {csv_path}")


if __name__ == "__main__":
    main()
