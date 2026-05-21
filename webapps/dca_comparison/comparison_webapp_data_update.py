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
OUTPUT_COLUMNS = ["date", "spy", "qqq", "tlt"]
INDEX_SOURCES = {
    "spy": {"symbol": "SPY", "label": "SPY"},
    "qqq": {"symbol": "QQQ", "label": "QQQ"},
    "tlt": {"symbol": "TLT", "label": "TLT"},
}


def output_dir() -> Path:
    default_dir = Path(__file__).resolve().parent / "webapp_data"
    return Path(os.getenv("DCA_COMPARISON_WEBAPP_DATA_DIR", str(default_dir))).expanduser()


def date_to_epoch(iso: str) -> int:
    dt = datetime.strptime(iso, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    return int(dt.timestamp())


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
        writer = csv.DictWriter(f, fieldnames=OUTPUT_COLUMNS)
        writer.writeheader()
        for iso in dates:
            source = rows_by_date[iso]
            writer.writerow({
                "date": iso,
                "spy": fmt_price(source.get("spy")),
                "qqq": fmt_price(source.get("qqq")),
                "tlt": fmt_price(source.get("tlt")),
            })


def main() -> None:
    out_dir = output_dir()
    csv_path = out_dir / "market_indices.csv"
    rows_by_date = read_existing(csv_path)
    fetched_any = False

    for column, config in INDEX_SOURCES.items():
        data = fetch_yahoo_chart(config["symbol"], START_DATE)
        fetched_any = True
        for iso, price in data.items():
            rows_by_date.setdefault(iso, {"date": iso, "spy": "", "qqq": "", "tlt": ""})
            rows_by_date[iso][column] = fmt_price(price)
        print(f"Updated {config['label']}: {len(data):,} daily rows")

    if not fetched_any:
        raise RuntimeError("No index data was fetched")

    rows_by_date = fill_daily_calendar(rows_by_date, ["spy", "qqq", "tlt"])
    write_csv(csv_path, rows_by_date)
    (out_dir / "last_updated.txt").write_text(
        datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC") + "\n"
    )
    print(f"Wrote {csv_path}")


if __name__ == "__main__":
    main()
