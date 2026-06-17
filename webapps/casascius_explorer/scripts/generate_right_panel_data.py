#!/usr/bin/env python3
import csv
import json
import math
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_JS = ROOT / "assets" / "casascius_data_manifest.js"
APP_JS = ROOT / "casascius_explorer.js"
TRACKER_CSV = ROOT / "data" / "casascius_explorer.csv"
OUT_JS = ROOT / "assets" / "right_panel_data.js"
ALL_ITEMS_GROUP_KEY = "all:coins-bars"
DASH = "\u2014"
S3_HALF_SERIES2_ESTIMATED_COUNT = 45
S3_ONE_GOLD_RIM_ESTIMATED_COUNT = 700
SHARED_STATS_SLUGS = {
    "cas_10btc_2012_silver_gold_b": "cas_10btc_2012_silver",
}
S3_ONE_SILVER_VARIANT_SLUGS_BY_ADDRESS = {
    "1Ag6z4rQCA3czTJUYb4qKbtZrnKyecC8RK": "cas_1btc_2013_gold_rim_silver",
}
MINTAGE_NOTES = {
    "cas_0p5btc_2013_silver_s25": "An estimated 45 half-BTC coins were made with the Series 2 sticker and are assumed to be the ones with the earliest indexes.",
    "cas_0p5btc_2013_silver_s3": "An estimated 45 half-BTC coins were made with the Series 2 sticker and are assumed to be the ones with the earliest indexes.",
    "cas_1btc_2013_gold_rim_silver": "Gold-rim mintage is estimated from the latest 700 Series 3 1 BTC silver indexes; exact serial split is unknown.",
    "cas_10btc_2012_silver": "Mintage figures represent both 2012 10 BTC Series 2 Silver Coin with and without Gold B; specific numbers are unknown.",
    "cas_10btc_2012_silver_gold_b": "Mintage figures represent both 2012 10 BTC Series 2 Silver Coin with and without Gold B; specific numbers are unknown.",
}
BITNICKEL_MATERIAL = "Nickel Plated Alloy"


def read_coins():
    text = MANIFEST_JS.read_text()
    match = re.search(r"const COINS = (\[.*\]);\s*$", text, re.S)
    if not match:
        raise RuntimeError("Could not find COINS array")
    return json.loads(match.group(1))


def read_tracker_type_slugs():
    text = APP_JS.read_text()
    match = re.search(r"const TRACKER_TYPE_SLUGS = \{(.*?)\n  \};", text, re.S)
    if not match:
        raise RuntimeError("Could not find TRACKER_TYPE_SLUGS")
    return dict(re.findall(r"'([^']+)':\s*'([^']+)'", match.group(1)))


def finite_number(value):
    try:
        number = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def tracker_slug_for_row(row, s3_one_gold_rim_min_index, s3_half_series2_max_index, type_slugs):
    if row.get("Type") == "S3-COIN-1-AG":
        override_slug = S3_ONE_SILVER_VARIANT_SLUGS_BY_ADDRESS.get(str(row.get("Address") or "").strip())
        if override_slug:
            return override_slug
        index = finite_number(row.get("Index"))
        return "cas_1btc_2013_gold_rim_silver" if index is not None and index >= s3_one_gold_rim_min_index else "cas_1btc_2013_silver"
    if row.get("Type") == "S3-COIN-0.5-AG":
        index = finite_number(row.get("Index"))
        return "cas_0p5btc_2013_silver_s25" if index is not None and index <= s3_half_series2_max_index else "cas_0p5btc_2013_silver_s3"
    return type_slugs.get(row.get("Type"))


def read_tracker_entries(type_slugs):
    with TRACKER_CSV.open(newline="") as csvfile:
        rows = list(csv.DictReader(csvfile))
    all_unfunded_count = sum(
        1 for row in rows
        if str(row.get("Status") or "").strip().lower() in ("unfunded", "unloaded")
    )
    s3_one_indexes = sorted(
        index for index in (finite_number(row.get("Index")) for row in rows if row.get("Type") == "S3-COIN-1-AG")
        if index is not None
    )
    s3_half_indexes = sorted(
        index for index in (finite_number(row.get("Index")) for row in rows if row.get("Type") == "S3-COIN-0.5-AG")
        if index is not None
    )
    s3_one_gold_rim_min_index = s3_one_indexes[max(0, len(s3_one_indexes) - S3_ONE_GOLD_RIM_ESTIMATED_COUNT)] if s3_one_indexes else math.inf
    s3_half_series2_max_index = s3_half_indexes[min(len(s3_half_indexes), S3_HALF_SERIES2_ESTIMATED_COUNT) - 1] if s3_half_indexes else -math.inf
    entries = []
    for row in rows:
        slug = tracker_slug_for_row(row, s3_one_gold_rim_min_index, s3_half_series2_max_index, type_slugs)
        if not slug or not row.get("Address"):
            continue
        entries.append({
            "slug": slug,
            "status": str(row.get("Status") or "").lower(),
            "value": finite_number(row.get("Value")),
            "createBlock": finite_number(row.get("Create Block")),
            "createTime": finite_number(row.get("Create Time")),
            "redeemBlock": finite_number(row.get("Redeem Block")),
            "redeemTime": finite_number(row.get("Redeem Time")),
        })
    return entries, all_unfunded_count


def mm_text(value):
    if value is None:
        return ""
    number = float(value)
    return str(int(number)) if number.is_integer() else ("%s" % number).rstrip("0").rstrip(".")


def format_integer(value):
    if value is None or not math.isfinite(value):
        return DASH
    return f"{int(value):,}"


def denomination_value(coin):
    explicit_raw = coin.get("denominationBtc")
    explicit = finite_number(explicit_raw)
    if explicit_raw is not None and explicit is not None and explicit >= 0:
        return explicit
    match = re.search(r"([\d.]+)\s*BTC", str(coin.get("label") or ""), re.I)
    return float(match.group(1)) if match else math.inf


def series_value(coin):
    explicit = finite_number(coin.get("version"))
    if explicit is not None:
        return explicit
    match = re.search(r"Series\s*([\d.]+)", str(coin.get("series") or coin.get("label") or ""), re.I)
    return float(match.group(1)) if match else 0


def object_shape(coin):
    return "bar" if coin.get("shape") == "bar" else "coin"


def numeric_range_text(values, formatter=mm_text):
    numbers = [float(value) for value in values if value is not None and math.isfinite(float(value))]
    if not numbers:
        return DASH
    minimum = min(numbers)
    maximum = max(numbers)
    return formatter(minimum) if minimum == maximum else f"{formatter(minimum)} - {formatter(maximum)}"


def btc_denomination_text(value):
    if value is None or not math.isfinite(value):
        return DASH
    if 0 < value < 0.0001:
        sats = round(value * 100000000)
        return f"{format_integer(sats)} {'sat' if sats == 1 else 'sats'}"
    return f"{mm_text(value)} BTC"


def btc_denomination_range_text(values):
    numbers = [float(value) for value in values if value is not None and math.isfinite(float(value))]
    if not numbers:
        return "-"
    minimum = min(numbers)
    maximum = max(numbers)
    return btc_denomination_text(minimum) if minimum == maximum else f"{btc_denomination_text(minimum)} - {btc_denomination_text(maximum)}"


def weight_grams_value(coin):
    match = re.search(r"([\d.]+)\s*g", str(coin.get("weight") or ""), re.I)
    return float(match.group(1)) if match else math.nan


def dimensions_only_text(coin):
    if object_shape(coin) == "bar":
        return f"{mm_text(coin.get('widthMm'))} mm x {mm_text(coin.get('heightMm'))} mm x {mm_text(coin.get('thicknessMm'))} mm"
    return f"{mm_text(coin.get('diameterMm'))} mm x {mm_text(coin.get('thicknessMm'))} mm"


def material_descriptor(coin):
    text = str(coin.get("label") or "")
    text = re.sub(r"^\s*[\d.]+ BTC\s*", "", text, flags=re.I)
    text = re.sub(r"\b[\d.]+ BTC\b\s*", "", text, flags=re.I)
    text = re.sub(r"\b20\d{2}\b", "", text, flags=re.I)
    text = re.sub(r"Series\s*[\d.]+", "", text, flags=re.I)
    text = re.sub(r"\b(?:coin|bar)\b", "", text, flags=re.I)
    text = re.sub(r"\s+", " ", text).strip()
    if object_shape(coin) == "bar":
        text = re.sub(r"\bGold\b", "Gold Plated Alloy", text, count=1, flags=re.I)
    if denomination_value(coin) == 25:
        text = re.sub(r"\bGold-Plated\b", "Gold Plated Alloy", text, count=1, flags=re.I)
    return text


def is_mule_coin(coin):
    return bool(re.search(r"mule", str(coin.get("slug") or ""), re.I) or re.search(r"mule", str(coin.get("label") or ""), re.I))


def right_panel_material_descriptor(coin):
    if re.search(r"bitnickel", str(coin.get("slug") or ""), re.I):
        return BITNICKEL_MATERIAL
    return material_descriptor(coin)


def first_created(rows):
    candidates = [row for row in rows if row["createBlock"] is not None or row["createTime"] is not None]
    return min(candidates, key=lambda row: (row["createBlock"] if row["createBlock"] is not None else math.inf, row["createTime"] if row["createTime"] is not None else math.inf), default={})


def latest_redeemed(rows):
    candidates = [row for row in rows if row["redeemTime"] is not None or row["redeemBlock"] is not None]
    return max(candidates, key=lambda row: (row["redeemTime"] or 0, row["redeemBlock"] or 0), default={})


def info_for_rows(rows):
    active = sum(1 for row in rows if row["status"] == "active")
    redeemed = sum(1 for row in rows if row["status"] == "redeemed")
    unfunded = sum(1 for row in rows if row["status"] in ("unfunded", "unloaded"))
    first = first_created(rows)
    latest = latest_redeemed(rows)
    return {
        "minted": active + redeemed,
        "active": active,
        "redeemed": redeemed,
        "unfunded": unfunded,
        "firstBlock": first.get("createBlock"),
        "firstTime": first.get("createTime"),
        "lastBlock": latest.get("redeemBlock"),
        "lastTime": latest.get("redeemTime"),
    }


def info_for_coin(coin, rows):
    info = info_for_rows(rows)
    slug = coin.get("slug")
    is_mule = is_mule_coin(coin)
    if is_mule:
        info.update({
            "minted": DASH,
            "active": DASH,
            "redeemed": DASH,
        })
    info.update({
        "slug": slug,
        "type": "Coin" if object_shape(coin) == "coin" else "Bar",
        "material": right_panel_material_descriptor(coin) or DASH,
        "series": "Mule" if is_mule else coin.get("series") or f"Series {mm_text(series_value(coin))}",
        "year": str(coin.get("year") or DASH),
        "denomination": btc_denomination_range_text(row["value"] for row in rows) if coin.get("slug") == "cas_bar_diy_gold_s2" else (f"{mm_text(denomination_value(coin))} BTC" if math.isfinite(denomination_value(coin)) else DASH),
        "dimensions": dimensions_only_text(coin) or DASH,
        "weight": coin.get("weight") or DASH,
        "statsMode": "dash" if coin.get("nonFundedStats") or is_mule else "counts",
    })
    if slug in MINTAGE_NOTES:
        info["mintageNote"] = MINTAGE_NOTES[slug]
    return info


def all_info(coins, rows, all_unfunded_count=None):
    info = info_for_rows(rows)
    if all_unfunded_count is not None:
        info["unfunded"] = all_unfunded_count
    info.update({
        "type": "All Coins & Bars",
        "material": "Mixed",
        "series": "All",
        "year": numeric_range_text(finite_number(coin.get("year")) for coin in coins),
        "denomination": f"{numeric_range_text(denomination_value(coin) for coin in coins)} BTC",
        "dimensions": "Mixed",
        "weight": f"{numeric_range_text(weight_grams_value(coin) for coin in coins)} g",
        "statsMode": "counts",
    })
    return info


def clean_numbers(value):
    if isinstance(value, dict):
        return {key: clean_numbers(item) for key, item in value.items()}
    if isinstance(value, list):
        return [clean_numbers(item) for item in value]
    if isinstance(value, float):
        if not math.isfinite(value):
            return None
        return int(value) if value.is_integer() else value
    return value


def main():
    coins = read_coins()
    type_slugs = read_tracker_type_slugs()
    entries, all_unfunded_count = read_tracker_entries(type_slugs)
    rows_by_slug = {}
    for entry in entries:
        rows_by_slug.setdefault(entry["slug"], []).append(entry)

    items = {ALL_ITEMS_GROUP_KEY: all_info(coins, entries, all_unfunded_count)}
    for coin in coins:
        stats_slug = SHARED_STATS_SLUGS.get(coin["slug"], coin["slug"])
        items[coin["slug"]] = info_for_coin(coin, rows_by_slug.get(stats_slug, []))

    payload = clean_numbers({
        "allKey": ALL_ITEMS_GROUP_KEY,
        "items": items,
    })
    OUT_JS.write_text(
        "window.CASASCIUS_RIGHT_PANEL_DATA = "
        + json.dumps(payload, separators=(",", ":"), sort_keys=True)
        + ";\n"
    )
    print(f"Wrote {OUT_JS.relative_to(ROOT)} with {len(items)} right-panel records")


if __name__ == "__main__":
    main()
