#!/usr/bin/env python3
"""Update DCA comparison market-index datasets."""

import csv
import json
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen


START_DATE = "1971-02-05"
YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
OUTPUT_COLUMNS = ["date", "spy", "qqq", "tlt", "mstr"]
DCA_PREVIEW_COLUMNS = ["date", "BTC", "XAU"]
DCA_PREVIEW_RANGE_YEARS = 4
INDEX_SOURCES = {
    "spy": {"symbol": "SPY", "label": "SPY"},
    "qqq": {"symbol": "QQQ", "label": "QQQ"},
    "tlt": {"symbol": "TLT", "label": "TLT"},
    "mstr": {"symbol": "MSTR", "label": "MSTR"},
}


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def output_dir() -> Path:
    default_dir = Path(__file__).resolve().parent / "webapp_data"
    return Path(os.getenv("DCA_COMPARISON_WEBAPP_DATA_DIR", str(default_dir))).expanduser()


def date_to_epoch(iso: str) -> int:
    dt = datetime.strptime(iso, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    return int(dt.timestamp())


def normalize_iso_date(value: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    if len(raw) >= 10 and raw[4:5] == "-" and raw[7:8] == "-":
        return raw[:10]
    for fmt in ("%m/%d/%y", "%m/%d/%Y"):
        try:
            return datetime.strptime(raw, fmt).date().isoformat()
        except ValueError:
            continue
    return ""


def fetch_yahoo_chart(symbol: str, start_iso: str) -> dict[str, float]:
    now = int(time.time())
    params = {
        "period1": date_to_epoch(start_iso),
        "period2": now,
        "interval": "1d",
        "events": "history",
        "includeAdjustedClose": "true",
    }
    encoded_symbol = symbol.replace("^", "%5E")
    url = f"{YAHOO_CHART_URL.format(symbol=encoded_symbol)}?{urlencode(params)}"
    req = Request(url, headers={"User-Agent": "wickedsmartbitcoin-dca-comparison-refresh/1.0"})
    with urlopen(req, timeout=45) as response:
        payload = json.loads(response.read().decode("utf-8"))

    result = (payload.get("chart") or {}).get("result") or []
    if not result:
        error = (payload.get("chart") or {}).get("error")
        raise RuntimeError(f"Yahoo chart returned no data for {symbol}: {error}")

    chart = result[0]
    timestamps = chart.get("timestamp") or []
    quote = ((chart.get("indicators") or {}).get("quote") or [{}])[0]
    adj = ((chart.get("indicators") or {}).get("adjclose") or [{}])[0].get("adjclose") or []
    close = quote.get("close") or []
    values: dict[str, float] = {}
    for idx, ts in enumerate(timestamps):
        price = adj[idx] if idx < len(adj) and adj[idx] is not None else close[idx] if idx < len(close) else None
        if price is None:
            continue
        try:
            numeric = float(price)
        except (TypeError, ValueError):
            continue
        if numeric <= 0:
            continue
        iso = datetime.fromtimestamp(int(ts), tz=timezone.utc).date().isoformat()
        values[iso] = numeric
    if not values:
        raise RuntimeError(f"Yahoo chart returned no usable prices for {symbol}")
    return values


def read_existing(path: Path) -> dict[str, dict[str, str]]:
    if not path.exists():
        return {}
    with path.open(newline="") as f:
        reader = csv.DictReader(f)
        rows = {}
        for row in reader:
            iso = (row.get("date") or "").strip()
            if iso:
                rows[iso] = {key: (row.get(key) or "").strip() for key in OUTPUT_COLUMNS}
        return rows


def fmt_price(value: float | str | None) -> str:
    if value is None or value == "":
        return ""
    numeric = float(value)
    return f"{numeric:.6f}".rstrip("0").rstrip(".")


def read_column_csv(path: Path, date_column: str, value_column: str) -> dict[str, str]:
    if not path.exists():
        raise FileNotFoundError(f"Missing source file for DCA comparison preview: {path}")
    rows: dict[str, str] = {}
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            iso = normalize_iso_date(row.get(date_column, ""))
            value = fmt_price(row.get(value_column, ""))
            if iso and value:
                rows[iso] = value
    return rows


def subtract_calendar_years(iso: str, years: int) -> str:
    dt = datetime.strptime(iso, "%Y-%m-%d").date()
    try:
        start = dt.replace(year=dt.year - years)
    except ValueError:
        start = dt.replace(year=dt.year - years, day=28)
    return start.isoformat()


def write_dca_preview_csv(out_dir: Path) -> Path:
    root = repo_root()
    btc_by_date = read_column_csv(root / "assets" / "daily_price.csv", "date", "price")
    xau_by_date = read_column_csv(root / "webapps" / "uoa" / "webapp_data" / "daily_fx_rates.csv", "date", "xauusd")
    common_dates = sorted(set(btc_by_date) & set(xau_by_date))
    if not common_dates:
        raise RuntimeError("No overlapping BTC/XAU rows were available for DCA comparison preview")

    end_iso = common_dates[-1]
    start_iso = subtract_calendar_years(end_iso, DCA_PREVIEW_RANGE_YEARS)
    rows = [
        {"date": iso, "BTC": btc_by_date[iso], "XAU": xau_by_date[iso]}
        for iso in common_dates
        if iso >= start_iso
    ]
    preview_path = out_dir / "dca_comparison_preview.csv"
    with preview_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=DCA_PREVIEW_COLUMNS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    return preview_path


def fill_daily_calendar(rows_by_date: dict[str, dict[str, str]], columns: list[str]) -> dict[str, dict[str, str]]:
    dates = sorted(rows_by_date)
    if not dates:
        return rows_by_date
    start = datetime.strptime(dates[0], "%Y-%m-%d").date()
    end = max(datetime.now(timezone.utc).date(), datetime.strptime(dates[-1], "%Y-%m-%d").date())
    last_seen = {column: "" for column in columns}
    filled: dict[str, dict[str, str]] = {}
    current = start
    while current <= end:
        iso = current.isoformat()
        source = rows_by_date.get(iso, {})
        row = {"date": iso}
        for column in columns:
            value = source.get(column) or ""
            if value:
                last_seen[column] = fmt_price(value)
            row[column] = last_seen[column]
        filled[iso] = row
        current += timedelta(days=1)
    return filled


def write_csv(path: Path, rows_by_date: dict[str, dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    dates = sorted(rows_by_date)
    with path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=OUTPUT_COLUMNS, lineterminator="\n")
        writer.writeheader()
        for iso in dates:
            source = rows_by_date[iso]
            row = {"date": iso}
            for column in OUTPUT_COLUMNS:
                if column == "date":
                    continue
                row[column] = fmt_price(source.get(column))
            writer.writerow(row)


def main() -> None:
    out_dir = output_dir()
    csv_path = out_dir / "market_indices.csv"
    rows_by_date = read_existing(csv_path)
    fetched_any = False

    for column, config in INDEX_SOURCES.items():
        data = fetch_yahoo_chart(config["symbol"], START_DATE)
        fetched_any = True
        for iso, price in data.items():
            rows_by_date.setdefault(iso, {column: "" for column in OUTPUT_COLUMNS})
            rows_by_date[iso][column] = fmt_price(price)
        print(f"Updated {config['label']}: {len(data):,} daily rows")

    if not fetched_any:
        raise RuntimeError("No index data was fetched")

    rows_by_date = fill_daily_calendar(rows_by_date, ["spy", "qqq", "tlt", "mstr"])
    write_csv(csv_path, rows_by_date)
    preview_path = write_dca_preview_csv(out_dir)
    (out_dir / "last_updated.txt").write_text(
        datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC") + "\n"
    )
    print(f"Wrote {csv_path}")
    print(f"Wrote {preview_path}")


if __name__ == "__main__":
    main()
