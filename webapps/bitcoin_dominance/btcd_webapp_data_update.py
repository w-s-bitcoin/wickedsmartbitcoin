from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import requests


STABLE_KEYS = [
    "XUSDCoinoUSD",
    "USNBTNuBits",
    "USDTTether",
    "USDCUSD Coin",
    "BUSDBinance USD",
    "DAIDai",
    "USTTerraUSD",
    "USDTTether USDt",
    "USDCUSDC",
    "BUSDBUSD",
    "TUSDTrueUSD",
    "INNBCLInnovative Bioresearch Classic",
    "VOLTElectric",
    "LUNCTerra Classic",
]

DEFAULT_TOP_N = 10
FIRST_REAL_STABLE_DATE = "2017-07-16"

COINGECKO_MARKETS_URL = "https://api.coingecko.com/api/v3/coins/markets"
CSV_COLUMNS = [
    "Date",
    "Rank",
    "Primary Key",
    "Name",
    "Symbol",
    "Market Cap",
    "Price",
    "Circulating Supply",
    "Snapshot Type",
]


def to_float(value: object) -> float:
    if value is None:
        return 0.0
    s = str(value).strip()
    if s in {"", "--", "nan", "None"}:
        return 0.0
    cleaned = s.replace("$", "").replace(",", "")
    numeric = "".join(ch for ch in cleaned if ch.isdigit() or ch in {".", "-"})
    if numeric in {"", "-", ".", "-."}:
        return 0.0
    try:
        return float(numeric)
    except Exception:
        return 0.0


def normalize_dataset(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()

    if "Snapshot Type" not in out.columns:
        out["Snapshot Type"] = "historical"

    original_price = out["Price"].astype(str)

    out["Rank"] = pd.to_numeric(out["Rank"], errors="coerce").fillna(999999).astype(int)
    out["Symbol"] = out["Symbol"].astype(str).str.upper().str.strip()

    for col in ["Price", "Market Cap", "Circulating Supply"]:
        out[col] = out[col].apply(to_float)

    out["Primary Key"] = out.apply(
        lambda r: (
            f"{r['Symbol']}{str(r['Primary Key'])[len(str(r['Symbol'])):]}"
            if str(r["Primary Key"]).startswith(str(r["Symbol"]))
            else f"{r['Symbol']}{str(r['Primary Key']).replace(str(r['Symbol']), '', 1)}"
        )
        if str(r["Primary Key"]).strip()
        else str(r["Symbol"]),
        axis=1,
    )

    out["Primary Key"] = [
        pk.split(" [")[0] if " [" in str(pk) else str(pk) for pk in out["Primary Key"].tolist()
    ]

    if "Name" not in out.columns:
        out["Name"] = ""

    def derive_name(primary_key: object, symbol: object) -> str:
        pk = str(primary_key or "").strip()
        sym = str(symbol or "").strip()
        if pk.lower() in {"", "nan", "none"}:
            return ""
        if sym and pk.startswith(sym):
            return pk[len(sym):].strip()
        if sym:
            return pk.replace(sym, "", 1).strip()
        return pk

    name_raw = out["Name"].astype(str).str.strip()
    missing_name = out["Name"].isna() | name_raw.str.lower().isin({"", "nan", "none"})
    out.loc[missing_name, "Name"] = out.loc[missing_name].apply(
        lambda r: derive_name(r["Primary Key"], r["Symbol"]),
        axis=1,
    )
    out["Name"] = out["Name"].astype(str).str.strip()
    out["Name"] = [n.split(" [")[0] if " [" in n else n for n in out["Name"].tolist()]
    out.loc[out["Name"].str.lower().isin({"", "nan", "none"}), "Name"] = out["Symbol"]

    out = out[original_price != "--"].copy()
    out = out.drop_duplicates(subset=["Date", "Primary Key"], keep="last")
    out = out.sort_values(["Date", "Rank", "Primary Key"]).reset_index(drop=True)
    return out


def clean_stable_marketcap_outliers(
    df: pd.DataFrame,
    stable_keys: list[str],
    spike_ratio: float = 4.0,
    neighbor_ratio_cap: float = 1.8,
    block_jump_ratio: float = 2.5,
    block_hold_ratio: float = 2.0,
    max_block_days: int = 14,
    stable_gt_btc: bool = True,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    out = df.copy()
    out["Date"] = pd.to_datetime(out["Date"], errors="coerce")
    out["Market Cap"] = pd.to_numeric(out["Market Cap"], errors="coerce")
    out = out.sort_values(["Primary Key", "Date"]).reset_index(drop=True)

    stable_mask = out["Primary Key"].isin(stable_keys)
    outlier_mask = pd.Series(False, index=out.index)

    for _pk, idx in out[stable_mask].groupby("Primary Key").groups.items():
        sub = out.loc[idx].copy().reset_index()
        s = sub["Market Cap"].astype(float).to_numpy()
        d = sub["Date"]
        n = len(sub)
        local_outliers = np.zeros(n, dtype=bool)

        if n >= 3:
            prev_s = pd.Series(s).shift(1)
            next_s = pd.Series(s).shift(-1)
            valid_neighbors = prev_s.notna() & next_s.notna() & (prev_s > 0) & (next_s > 0)
            neighbor_close = (np.maximum(prev_s, next_s) / np.minimum(prev_s, next_s)) <= neighbor_ratio_cap
            spike_up = (pd.Series(s) / prev_s >= spike_ratio) & (pd.Series(s) / next_s >= spike_ratio)
            local_outliers |= (valid_neighbors & neighbor_close & spike_up).to_numpy()

        i = 1
        while i < n - 1:
            pre = s[i - 1]
            cur = s[i]
            if np.isfinite(pre) and np.isfinite(cur) and pre > 0 and (cur / pre) >= block_jump_ratio:
                start = i
                j = i
                while j < n and np.isfinite(s[j]) and s[j] >= pre * block_hold_ratio:
                    if pd.notna(d.iloc[j]) and pd.notna(d.iloc[start]):
                        if (d.iloc[j] - d.iloc[start]).days > max_block_days:
                            break
                    j += 1

                if j < n and np.isfinite(s[j]) and s[j] > 0:
                    post = s[j]
                    pre_post_close = (max(pre, post) / min(pre, post)) <= neighbor_ratio_cap
                    block_peak = np.nanmax(s[start:j]) if j > start else np.nan
                    if pre_post_close and np.isfinite(block_peak) and (block_peak / max(pre, post)) >= spike_ratio:
                        local_outliers[start:j] = True
                        i = j
                        continue
            i += 1

        outlier_mask.loc[sub["index"].to_numpy()] = local_outliers

    btc_by_date = out.loc[out["Primary Key"] == "BTCBitcoin", ["Date", "Market Cap"]].dropna()
    btc_by_date = btc_by_date.groupby("Date")["Market Cap"].max()
    btc_on_date = out["Date"].map(btc_by_date)

    btc_cap_outliers = (
        stable_mask
        & out["Market Cap"].notna()
        & btc_on_date.notna()
        & (out["Market Cap"] > btc_on_date)
    )

    if stable_gt_btc:
        outlier_mask = outlier_mask | btc_cap_outliers

    out.loc[outlier_mask, "Market Cap"] = np.nan
    out["Market Cap"] = out.groupby("Primary Key")["Market Cap"].transform(
        lambda x: x.interpolate(method="linear", limit_area="inside")
    )

    # If a flagged outlier still cannot be interpolated (for example, no valid points on one
    # side of the series), remove it entirely so it cannot contaminate downstream rankings.
    unresolved_outliers = outlier_mask & out["Market Cap"].isna()

    reason = pd.Series("spike_pattern", index=out.index)
    reason.loc[btc_cap_outliers] = "stable_gt_btc"

    flagged = out.loc[outlier_mask, ["Date", "Primary Key", "Name", "Market Cap"]].copy()
    flagged["BTC Market Cap"] = flagged["Date"].map(btc_by_date)
    flagged["Outlier Type"] = reason.loc[outlier_mask].values
    flagged["Interpolation Filled"] = ~out.loc[outlier_mask, "Market Cap"].isna().values
    flagged = flagged.sort_values(["Primary Key", "Date"]).reset_index(drop=True)

    out = out.loc[~unresolved_outliers].copy().reset_index(drop=True)

    out["Date"] = out["Date"].dt.strftime("%Y-%m-%d")
    flagged["Date"] = pd.to_datetime(flagged["Date"], errors="coerce").dt.strftime("%Y-%m-%d")

    return out, flagged


def get_filtered_df(df_all: pd.DataFrame, include_stables: bool = False) -> pd.DataFrame:
    if include_stables:
        return df_all.copy()
    return df_all[~df_all["Primary Key"].isin(STABLE_KEYS)].copy()


def build_topn_daily(source_df: pd.DataFrame, top_n: int = DEFAULT_TOP_N) -> pd.DataFrame:
    out = source_df.sort_values(["Date", "Rank", "Primary Key"]).groupby("Date", as_index=False).head(top_n)
    keep_cols = [
        "Date",
        "Rank",
        "Primary Key",
        "Name",
        "Symbol",
        "Market Cap",
        "Price",
        "Circulating Supply",
        "Snapshot Type",
    ]
    out = out[keep_cols].copy()
    out["Is Stable"] = out["Primary Key"].isin(STABLE_KEYS)
    return out.reset_index(drop=True)


def compute_btcd_wide_for_dates(
    source_df: pd.DataFrame,
    target_dates: list[str],
    stable_keys: list[str] | None = None,
) -> pd.DataFrame:
    """Compute btcd_top10 for each date. If stable_keys is provided, also compute stabled_top10."""
    extra_cols = ["stabled_top10"] if stable_keys is not None else []
    if not target_dates:
        return pd.DataFrame(columns=["Date", "btcd_top10"] + extra_cols)

    rows: list[dict[str, object]] = []

    for date in target_dates:
        ddf = source_df[source_df["Date"] == date].copy()
        ddf = ddf[pd.to_numeric(ddf["Market Cap"], errors="coerce").notna()]
        ddf = ddf.sort_values(["Rank", "Primary Key"]).head(DEFAULT_TOP_N)
        row: dict[str, object] = {"Date": date}

        if len(ddf) == 0:
            row["btcd_top10"] = np.nan
            if stable_keys is not None:
                row["stabled_top10"] = np.nan
            rows.append(row)
            continue

        mcap = ddf["Market Cap"].astype(float).to_numpy()
        pks = ddf["Primary Key"].to_numpy()
        total = float(mcap.sum())
        btc_sum = float(mcap[pks == "BTCBitcoin"].sum())
        row["btcd_top10"] = (btc_sum / total) if (total > 0 and btc_sum > 0) else np.nan

        if stable_keys is not None:
            stable_mask = np.isin(pks, stable_keys)
            stable_sum = float(mcap[stable_mask].sum())
            row["stabled_top10"] = (stable_sum / total) if (total > 0 and stable_sum > 0) else np.nan

        rows.append(row)

    out = pd.DataFrame(rows)
    return out.sort_values("Date").reset_index(drop=True)


def compute_top10_components_for_dates(
    source_df: pd.DataFrame,
    target_dates: list[str],
    stable_keys: list[str],
) -> pd.DataFrame:
    """Return top10 market-cap components (BTC, stables, others) for each date."""
    cols = ["Date", "btc_mcap_top10", "stable_mcap_top10", "other_mcap_top10"]
    if not target_dates:
        return pd.DataFrame(columns=cols)

    rows: list[dict[str, float | str]] = []
    stable_set = set(stable_keys)

    for date in target_dates:
        ddf = source_df[source_df["Date"] == date].copy()
        ddf = ddf[pd.to_numeric(ddf["Market Cap"], errors="coerce").notna()]
        ddf = ddf.sort_values(["Rank", "Primary Key"]).head(DEFAULT_TOP_N)

        if ddf.empty:
            rows.append({
                "Date": date,
                "btc_mcap_top10": np.nan,
                "stable_mcap_top10": np.nan,
                "other_mcap_top10": np.nan,
            })
            continue

        mcap = ddf["Market Cap"].astype(float).to_numpy()
        pks = ddf["Primary Key"].astype(str).to_numpy()
        btc_sum = float(mcap[pks == "BTCBitcoin"].sum())
        stable_sum = float(mcap[np.isin(pks, list(stable_set))].sum())
        total = float(mcap.sum())
        other_sum = max(total - btc_sum - stable_sum, 0.0)

        rows.append({
            "Date": date,
            "btc_mcap_top10": btc_sum,
            "stable_mcap_top10": stable_sum,
            "other_mcap_top10": other_sum,
        })

    return pd.DataFrame(rows).sort_values("Date").reset_index(drop=True)


def smooth_stable_component_outliers(components: pd.DataFrame, jump_ratio: float = 2.0) -> pd.DataFrame:
    """Remove persistent >=2x day-over-day stable mcap jumps and fill from surrounding points."""
    if components.empty:
        return components

    out = components.copy()
    out["Date"] = pd.to_datetime(out["Date"], errors="coerce")
    out["stable_mcap_top10"] = pd.to_numeric(out["stable_mcap_top10"], errors="coerce")
    s = out["stable_mcap_top10"].to_numpy(dtype=float)
    n = len(s)
    outlier = np.zeros(n, dtype=bool)

    # Anything positive before the known first real stable date is treated as outlier noise.
    first_real_ts = pd.to_datetime(FIRST_REAL_STABLE_DATE)
    pre_real_mask = (out["Date"] < first_real_ts).to_numpy() & np.isfinite(s) & (s > 0)
    outlier |= pre_real_mask

    i = 1
    while i < n:
        prev = s[i - 1]
        cur = s[i]
        cur_date = out.loc[i, "Date"]
        if pd.notna(cur_date) and cur_date.strftime("%Y-%m-%d") == FIRST_REAL_STABLE_DATE:
            i += 1
            continue

        if np.isfinite(prev) and np.isfinite(cur) and prev > 0 and cur > 0 and (cur / prev) >= jump_ratio:
            baseline = prev
            j = i
            while j < n:
                v = s[j]
                if not np.isfinite(v) or v <= 0 or v < baseline * jump_ratio:
                    break
                outlier[j] = True
                j += 1
            i = max(j, i + 1)
            continue
        i += 1

    if outlier.any():
        out.loc[outlier, "stable_mcap_top10"] = np.nan
        # For each contiguous outlier block, use the average of surrounding points.
        idx = np.flatnonzero(outlier)
        start = 0
        while start < len(idx):
            block_start = idx[start]
            end = start
            while end + 1 < len(idx) and idx[end + 1] == idx[end] + 1:
                end += 1
            block_end = idx[end]

            left_i = block_start - 1
            right_i = block_end + 1
            left_val = s[left_i] if left_i >= 0 and np.isfinite(s[left_i]) else np.nan
            right_val = s[right_i] if right_i < n and np.isfinite(s[right_i]) else np.nan

            if np.isfinite(left_val) and np.isfinite(right_val):
                fill_val = float((left_val + right_val) / 2.0)
            elif np.isfinite(left_val):
                fill_val = float(left_val)
            elif np.isfinite(right_val):
                fill_val = float(right_val)
            else:
                fill_val = np.nan

            out.loc[block_start:block_end, "stable_mcap_top10"] = fill_val
            start = end + 1

            out["Date"] = pd.to_datetime(out["Date"], errors="coerce").dt.strftime("%Y-%m-%d")
    return out


def compute_dominance_from_components(components: pd.DataFrame) -> pd.DataFrame:
    """Compute BTC/stable/other top10 dominance from market-cap components."""
    if components.empty:
        return pd.DataFrame(columns=["Date", "btcd_top10", "stabled_top10", "otherd_top10"])

    out = components.copy()
    for col in ["btc_mcap_top10", "stable_mcap_top10", "other_mcap_top10"]:
        out[col] = pd.to_numeric(out[col], errors="coerce")

    total = out["btc_mcap_top10"] + out["stable_mcap_top10"] + out["other_mcap_top10"]
    valid = total > 0

    res = pd.DataFrame({"Date": out["Date"]})
    res["btcd_top10"] = np.where(valid, out["btc_mcap_top10"] / total, np.nan)
    res["stabled_top10"] = np.where(valid, out["stable_mcap_top10"] / total, np.nan)
    res["otherd_top10"] = np.where(valid, out["other_mcap_top10"] / total, np.nan)
    return res.sort_values("Date").reset_index(drop=True)


def split_timeseries_historical_and_current_day(
    df: pd.DataFrame,
    today_str: str,
    columns: list[str],
) -> tuple[pd.DataFrame, pd.DataFrame]:
    out = df.copy()
    for col in columns:
        if col not in out.columns:
            out[col] = np.nan
    out = out[columns].copy()
    out["Date"] = pd.to_datetime(out["Date"], errors="coerce").dt.strftime("%Y-%m-%d")
    out = out.dropna(subset=["Date"]).drop_duplicates(subset=["Date"], keep="last")
    out = out.sort_values("Date").reset_index(drop=True)

    historical = out[out["Date"] < today_str].copy().reset_index(drop=True)
    current_day = out[out["Date"] >= today_str].copy().reset_index(drop=True)
    return historical, current_day


def write_csv_if_changed(df: pd.DataFrame, path: Path) -> bool:
    csv_text = df.to_csv(index=False)
    if path.exists():
        existing = path.read_text(encoding="utf-8")
        if existing == csv_text:
            return False
    path.write_text(csv_text, encoding="utf-8")
    return True


def fetch_live_snapshot(
    date_str: str,
    allowed_primary_keys: set[str] | None = None,
    pages: int = 2,
    per_page: int = 250,
) -> list[list]:
    """Fetch today's live market data from CoinGecko and return rows matching the CSV schema."""
    headers = {"Accept": "application/json", "User-Agent": "Mozilla/5.0"}
    rows: list[list] = []

    for page in range(1, pages + 1):
        params = {
            "vs_currency": "usd",
            "order": "market_cap_desc",
            "per_page": per_page,
            "page": page,
            "sparkline": "false",
        }
        try:
            resp = requests.get(COINGECKO_MARKETS_URL, params=params, headers=headers, timeout=30)
            resp.raise_for_status()
            payload = resp.json()
        except Exception as e:
            print(f"CoinGecko fetch failed on page {page}: {e}")
            break

        if not payload:
            break

        for coin in payload:
            try:
                symbol = str(coin.get("symbol") or "").upper().strip()
                name = str(coin.get("name") or "").strip()
                if not symbol or not name:
                    continue
                rank = int(coin.get("market_cap_rank") or 999999)
                market_cap = float(coin.get("market_cap") or 0)
                price = float(coin.get("current_price") or 0)
                supply = float(coin.get("circulating_supply") or 0)
                primary_key = f"{symbol}{name}"
                if allowed_primary_keys is not None and primary_key not in allowed_primary_keys:
                    continue
                rows.append([date_str, rank, primary_key, name, symbol, market_cap, price, supply, "live"])
            except Exception:
                continue

        time.sleep(0.25)

    return rows


def update_source_csv_with_live_data(source_csv: Path) -> None:
    """Fetch today's live CoinGecko snapshot and upsert it into the source CSV."""
    if not source_csv.exists():
        print(f"Source CSV not found, skipping live update: {source_csv}")
        return

    today_str = datetime.now(timezone.utc).date().isoformat()
    df = pd.read_csv(source_csv)

    if "Snapshot Type" not in df.columns:
        df["Snapshot Type"] = "historical"

    # Build allowlist from CMC historical rows only, so CoinGecko-exclusive coins
    # don't pollute the dataset.
    historical = df[df["Snapshot Type"].astype(str).str.lower() == "historical"]
    allowed_keys: set[str] | None = set(historical["Primary Key"].dropna().astype(str).tolist()) or None
    print(f"Known CMC token keys for live filter: {len(allowed_keys):,}" if allowed_keys else "No CMC filter applied.")

    print(f"Fetching live CoinGecko snapshot for {today_str}...")
    live_rows = fetch_live_snapshot(today_str, allowed_primary_keys=allowed_keys)

    if not live_rows:
        print("Live snapshot unavailable; source CSV unchanged.")
        return

    # Drop any existing rows for today and replace with fresh live data.
    df = df[df["Date"].astype(str) != today_str].copy()
    df_live = pd.DataFrame(live_rows, columns=CSV_COLUMNS)
    df = pd.concat([df, df_live], ignore_index=True)
    df.to_csv(source_csv, index=False)
    print(f"Updated {source_csv.name} with {len(live_rows)} live rows for {today_str}.")


def write_webapp_data(source_csv: Path, output_dir: Path) -> None:
    if not source_csv.exists():
        raise FileNotFoundError(f"Source CSV not found: {source_csv}")

    output_dir.mkdir(parents=True, exist_ok=True)

    # Remove legacy artifacts from earlier export formats.
    legacy_files = [
        "top100_daily_excl_stables.csv",
        "top100_daily_incl_stables.csv",
        "btcd_timeseries_by_n_excl_stables.csv",
        "btcd_timeseries_by_n_incl_stables.csv",
    ]
    for name in legacy_files:
        p = output_dir / name
        if p.exists():
            p.unlink()

    df_raw = pd.read_csv(source_csv)
    df_all = normalize_dataset(df_raw)

    df_all_clean, stable_outliers = clean_stable_marketcap_outliers(
        df_all,
        STABLE_KEYS,
        spike_ratio=4.0,
        neighbor_ratio_cap=1.8,
        block_jump_ratio=2.5,
        block_hold_ratio=2.0,
        max_block_days=14,
        stable_gt_btc=True,
    )

    df_excl = get_filtered_df(df_all_clean, include_stables=False)
    today_str = datetime.now(timezone.utc).date().isoformat()

    # Snapshot-only granular files (top 10), no historical rows.
    available_dates = sorted(df_excl["Date"].dropna().unique().tolist())
    latest_snapshot_date = max([d for d in available_dates if d <= today_str], default=(available_dates[-1] if available_dates else None))
    if latest_snapshot_date is None:
        top10_excl_today = pd.DataFrame(columns=[
            "Date",
            "Rank",
            "Primary Key",
            "Name",
            "Symbol",
            "Market Cap",
            "Price",
            "Circulating Supply",
            "Snapshot Type",
            "Is Stable",
        ])
        top10_incl_today = top10_excl_today.copy()
    else:
        top10_excl_today = build_topn_daily(df_excl[df_excl["Date"] == latest_snapshot_date].copy(), top_n=DEFAULT_TOP_N)
        top10_incl_today = build_topn_daily(df_all_clean[df_all_clean["Date"] == latest_snapshot_date].copy(), top_n=DEFAULT_TOP_N)

    # Timeseries are split into mostly-static historical files + intraday current-day files.
    ts_hist_path = output_dir / "btcd_timeseries_historical.csv"
    ts_current_path = output_dir / "btcd_timeseries_current_day.csv"
    ts_incl_hist_path = output_dir / "btcd_timeseries_incl_stables_historical.csv"
    ts_incl_current_path = output_dir / "btcd_timeseries_incl_stables_current_day.csv"
    ts_cols = ["Date", "btcd_top10"]
    ts_incl_cols = ["Date", "btcd_top10", "stabled_top10", "otherd_top10"]

    # Recompute complete dominance series, then split into historical/current-day outputs.
    target_dates = [d for d in available_dates if d <= today_str]
    btcd_wide = compute_btcd_wide_for_dates(df_excl, target_dates=target_dates)

    # Recompute incl-stables full history each run so aggregate stable-jump smoothing has full context.
    available_dates_incl = sorted(df_all_clean["Date"].dropna().unique().tolist())
    target_dates_incl = [d for d in available_dates_incl if d <= today_str]
    components_incl = compute_top10_components_for_dates(df_all_clean, target_dates_incl, STABLE_KEYS)
    components_incl = smooth_stable_component_outliers(components_incl, jump_ratio=2.0)
    btcd_wide_incl = compute_dominance_from_components(components_incl)

    btcd_hist, btcd_current = split_timeseries_historical_and_current_day(btcd_wide, today_str, ts_cols)
    btcd_incl_hist, btcd_incl_current = split_timeseries_historical_and_current_day(btcd_wide_incl, today_str, ts_incl_cols)

    write_csv_if_changed(btcd_hist, ts_hist_path)
    write_csv_if_changed(btcd_current, ts_current_path)
    write_csv_if_changed(btcd_incl_hist, ts_incl_hist_path)
    write_csv_if_changed(btcd_incl_current, ts_incl_current_path)
    write_csv_if_changed(top10_excl_today, output_dir / "top10_daily_excl_stables.csv")
    write_csv_if_changed(top10_incl_today, output_dir / "top10_daily_incl_stables.csv")
    write_csv_if_changed(stable_outliers, output_dir / "stable_outliers.csv")

    latest_date = str(btcd_wide["Date"].dropna().max()) if not btcd_wide.empty else None
    chart_static = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "source_csv": str(source_csv),
        "latest_date": latest_date,
        "latest_snapshot_date": latest_snapshot_date,
        "stable_count": len(STABLE_KEYS),
        "default_top_n": DEFAULT_TOP_N,
        "records": {
            "df_all_clean": int(len(df_all_clean)),
            "btcd_timeseries_historical": int(len(btcd_hist)),
            "btcd_timeseries_current_day": int(len(btcd_current)),
            "btcd_timeseries_incl_stables_historical": int(len(btcd_incl_hist)),
            "btcd_timeseries_incl_stables_current_day": int(len(btcd_incl_current)),
            "top10_daily_excl_stables": int(len(top10_excl_today)),
            "top10_daily_incl_stables": int(len(top10_incl_today)),
            "stable_outliers": int(len(stable_outliers)),
        },
        "outlier_rules": {
            "spike_ratio": 4.0,
            "neighbor_ratio_cap": 1.8,
            "block_jump_ratio": 2.5,
            "block_hold_ratio": 2.0,
            "max_block_days": 14,
            "stable_gt_btc": True,
            "stable_total_jump_ratio": 2.0,
        },
    }

    with (output_dir / "chart_static.json").open("w", encoding="utf-8") as f:
        json.dump(chart_static, f, indent=2)

    timestamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
    (output_dir / "last_updated.txt").write_text(timestamp, encoding="utf-8")

    print(f"Webapp data written to: {output_dir}")
    for p in sorted(output_dir.glob("*")):
        print(f" - {p.name}")


def main() -> None:
    here = Path(__file__).resolve().parent
    main_dir = Path(os.getenv("MAIN_DIR", "/Users/wicked/Projects/animations"))
    source_csv = main_dir / "Bitcoin Dominance" / "coinmarketcap_historical_data.csv"
    output_dir = here / "webapp_data"
    update_source_csv_with_live_data(source_csv)
    write_webapp_data(source_csv, output_dir)


if __name__ == "__main__":
    main()
