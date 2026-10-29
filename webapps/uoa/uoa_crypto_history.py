"""Explicit alternative-cryptocurrency coverage; public daily USD observations.

Coin Metrics PriceUSD supplies the main series. CoinGecko history through
DefiLlama fills only earlier trading dates (and TON, unavailable from CM).
No invented pre-trading prices, interpolation, or FX spike filtering.
"""
import csv
import json
import math
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

GROUP = "alternative_cryptocurrencies"
# Popular currencies are an explicit, reviewed list, not automatic FX discovery.
# The 2026-10-29 review retained popular names below $10B at the user's request.
COINS = {
    "ETH": ("Ethereum", "ethereum", 2015),
    "BCH": ("Bitcoin Cash", "bitcoin-cash", 2017),
    "LTC": ("Litecoin", "litecoin", 2011),
    "BNB": ("BNB", "binancecoin", 2017),
    "XRP": ("XRP", "ripple", 2012),
    "SOL": ("Solana", "solana", 2020),
    "TRX": ("TRON", "tron", 2017),
    "ZEC": ("Zcash", "zcash", 2016),
    "HYPE": ("Hyperliquid", "hyperliquid", 2024),
    "DOGE": ("Dogecoin", "dogecoin", 2013),
    "XMR": ("Monero", "monero", 2014),
    "ADA": ("Cardano", "cardano", 2017),
    "LINK": ("Chainlink", "chainlink", 2017),
    "AVAX": ("Avalanche", "avalanche-2", 2020),
    "DOT": ("Polkadot", "polkadot", 2019),
    "TON": ("Toncoin", "the-open-network", 2019),
    "SHIB": ("Shiba Inu", "shiba-inu", 2020),
    "SUI": ("Sui", "sui", 2022),
    "XLM": ("Stellar", "stellar", 2014),
}
CM = "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics"
LLAMA = "https://coins.llama.fi/chart/coingecko:"


def fetch_json(url):
    for attempt in range(3):
        try:
            req = Request(url, headers={"User-Agent": "wickedsmartbitcoin-uoa-history/1.0"})
            with urlopen(req, timeout=60) as response:
                return json.load(response)
        except Exception:
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def positive_price(value):
    try:
        price = float(value)
        return price if math.isfinite(price) and price > 0 else None
    except (ValueError, TypeError):
        return None


def coinmetrics_history(code, start=None, fetch=fetch_json):
    params = {"assets": code.lower(), "metrics": "PriceUSD", "frequency": "1d", "page_size": 10000}
    if start:
        params["start_time"] = start
    url, result = CM + "?" + urlencode(params), {}
    while url:
        data = fetch(url)
        if not isinstance(data.get("data"), list):
            raise ValueError(f"Invalid Coin Metrics history for {code}")
        for row in data["data"]:
            if row.get("asset") != code.lower():
                raise ValueError("Unexpected history asset")
            day = date.fromisoformat(row["time"][:10]).isoformat()
            if positive_price(row.get("PriceUSD")) is not None:
                result[day] = str(row["PriceUSD"])
        url = data.get("next_page_url")
        if url and not url.startswith(CM + "?"):
            raise ValueError("Unexpected history pagination URL")
    return result


def earlier_history(code, start, end, fetch=fetch_json):
    """Daily observations only; bound requests to the provider's 500-point cap."""
    coin_id = COINS[code][1]
    cursor, finish = date.fromisoformat(start), date.fromisoformat(end)
    result = {}
    while cursor <= finish:
        count = min(500, (finish - cursor).days + 1)
        timestamp = int(datetime.combine(cursor, datetime.min.time(), timezone.utc).timestamp())
        url = LLAMA + coin_id + "?" + urlencode({"start": timestamp, "span": count, "period": "1d", "searchWidth": "1d"})
        body = fetch(url)
        coin = body.get("coins", {}).get("coingecko:" + coin_id)
        if coin is None and isinstance(body.get("coins"), dict):
            # A valid empty window precedes the provider's first trade.
            cursor += timedelta(days=count)
            continue
        if not isinstance(coin, dict) or not isinstance(coin.get("prices"), list):
            raise ValueError(f"Invalid early history for {code}")
        # DefiLlama retains the legacy GRAM label for this exact CoinGecko ID.
        symbols = {"TON", "TONCOIN", "GRAM"} if code == "TON" else {code}
        if coin.get("symbol", "").upper() not in symbols:
            raise ValueError(f"Unexpected early history symbol for {code}")
        for row in coin["prices"]:
            day = datetime.fromtimestamp(row["timestamp"], timezone.utc).date()
            if cursor <= day < cursor + timedelta(days=count) and positive_price(row.get("price")) is not None:
                result[day.isoformat()] = str(row["price"])
        cursor += timedelta(days=count)
    return result


def recover_missing_observations(code, values, start=None, fetch=fetch_json):
    """Recover intraday observations omitted by the daily chart endpoint.

    Keep the returned quote's actual UTC date, never the requested date or a
    neighboring day's price. This is source retrieval, not gap interpolation.
    """
    first = max(date.fromisoformat(min(values)), date.fromisoformat(start)) if start else date.fromisoformat(min(values))
    last = date.fromisoformat(max(values))
    missing = [(first + timedelta(days=i)).isoformat() for i in range((last - first).days + 1)
               if (first + timedelta(days=i)).isoformat() not in values]
    coin_id = "coingecko:" + COINS[code][1]
    result = dict(values)
    for offset in range(0, len(missing), 50):
        days = set(missing[offset:offset + 50])
        stamps = [int(datetime.fromisoformat(day + "T12:00:00+00:00").timestamp()) for day in sorted(days)]
        url = "https://coins.llama.fi/batchHistorical?" + urlencode({"coins": json.dumps({coin_id: stamps}), "searchWidth": "12h"})
        body = fetch(url)
        if not isinstance(body.get("coins"), dict):
            raise ValueError(f"Invalid missing-day response for {code}")
        for row in body["coins"].get(coin_id, {}).get("prices", []):
            day = datetime.fromtimestamp(row["timestamp"], timezone.utc).date().isoformat()
            if day in days and positive_price(row.get("price")) and float(row.get("confidence", 0)) >= 0.8:
                result[day] = str(row["price"])
    return result


def prepare(rows, metadata, *, full=False, fetch=fetch_json, today=None):
    """Prepare the entire replacement in memory; a failed coin aborts publication."""
    today = today or datetime.now(timezone.utc).date().isoformat()
    if not rows or any(a["date"] >= b["date"] for a, b in zip(rows, rows[1:])):
        raise ValueError("Expected nonempty chronological FX rows")
    previous = metadata.get("alternative_crypto_history", {})
    histories, details = {}, {}
    for code, (name, coin_id, year) in COINS.items():
        column = code.lower() + "usd"
        prior = previous.get(code, {})
        existing = {row["date"]: row[column] for row in rows if positive_price(row.get(column)) is not None}
        complete = not full and prior.get("full_history") and existing
        start = (date.fromisoformat(prior["last_observation"]) - timedelta(days=35)).isoformat() if complete else None
        main = coinmetrics_history(code, start=start, fetch=fetch) if code != "TON" else {}
        if code != "TON" and not main:
            raise ValueError(f"No Coin Metrics observations for {code}")
        if complete:
            combined = dict(existing)
            combined.update(main if code != "TON" else earlier_history(code, start, today, fetch))
            early_end = prior.get("early_source_end")
        else:
            early_end = (date.fromisoformat(min(main)) - timedelta(days=1)).isoformat() if main else today
            combined = earlier_history(code, f"{year}-01-01", early_end, fetch)
            combined.update(main)
        combined = {day: value for day, value in sorted(combined.items()) if day <= today}
        if not combined:
            raise ValueError(f"No valid history for {code}")
        combined = recover_missing_observations(code, combined, start if complete else None, fetch)
        first, last = min(combined), max(combined)
        if (date.fromisoformat(today) - date.fromisoformat(last)).days > 7:
            raise ValueError(f"Stale history for {code}: {last}")
        histories[code] = combined
        details[code] = {"full_history": True, "first_observation": first, "last_observation": last,
                         "observations": len(combined), "early_source_end": early_end,
                         "missing_calendar_days": (date.fromisoformat(last) - date.fromisoformat(first)).days + 1 - len(combined),
                         "sources": ["CoinGecko via DefiLlama"] + (["Coin Metrics PriceUSD"] if main else [])}
        print(f"  {code}: {first} through {last}, {len(combined)} daily observations", flush=True)
    result = json.loads(json.dumps(metadata))
    result["currency_groups"] = [group for group in result.get("currency_groups", []) if group.get("id") != GROUP]
    result["currency_groups"].append({"id": GROUP, "label": "Alternative cryptocurrencies"})
    result["pairs"] = [pair for pair in result.get("pairs", []) if pair.get("base") not in COINS]
    for code, (name, coin_id, year) in COINS.items():
        result.setdefault("currencies", {})[code] = {"name": name, "code": code, "symbol": code,
            "symbol_position": "right", "minor_unit": 8, "groups": [GROUP], "asset_type": "alternative_cryptocurrency"}
        result["pairs"].append({"id": code + "/USD", "base": code, "quote": "USD",
            "display_name": name + " / US Dollar", "dataset": "daily_fx_rates.csv",
            "dataset_columns": ["date", code.lower() + "usd"], "pair_column_value": None,
            "quote_assumption": "USD per token; observed daily prices, no pre-trading backfill",
            "rate_source": "; ".join(details[code]["sources"])})
    result["alternative_crypto_history"] = details
    result["alternative_crypto_selection"] = {
        "review_date": "2026-10-29", "market_cap_source": "https://www.coingecko.com/",
        "policy": "Non-stablecoin cryptocurrencies above $10B plus explicitly retained popular currencies below the cutoff; excludes wrapped/staked duplicates and tokenized credit. Explicit reviewed list, not automatic FX discovery."}
    # Preserve every unrelated FX string exactly, and never forward-fill crypto.
    output = []
    for row in rows:
        out = dict(row)
        for code in COINS:
            out[code.lower() + "usd"] = histories[code].get(row["date"], "")
        output.append(out)
    result["generated_at_utc"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return output, result


def install(output_dir, rows, metadata, publish_marker):
    """Payloads first, producer marker last, after all fetches/validation succeed."""
    directory = Path(output_dir)
    directory.mkdir(parents=True, exist_ok=True)
    csv_path, json_path = directory / "daily_fx_rates.csv", directory / "uoa_pairs.json"
    with csv_path.with_suffix(".csv.tmp").open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]), lineterminator="\n")
        writer.writeheader(); writer.writerows(rows)
    json_path.with_suffix(".json.tmp").write_text(json.dumps(metadata, indent=2) + "\n")
    csv_path.with_suffix(".csv.tmp").replace(csv_path)
    json_path.with_suffix(".json.tmp").replace(json_path)
    publish_marker(directory)
