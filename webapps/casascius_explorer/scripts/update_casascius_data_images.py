#!/usr/bin/env python3
"""Refresh embedded Casascius coin image data from coins_and_bars PNGs."""

from __future__ import annotations

import base64
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_SOURCE = ROOT / "assets" / "casascius_data.js"
IMAGE_DIR = ROOT / "coins_and_bars"

IMAGE_FILES = {
    "cas_bar_diy_gold_s2": ("bar-diy-gold-s2-front.png", "bar-gold-back.png"),
    "cas_bar_100btc_gp": ("bar-100-gold-s1-front.png", "bar-gold-back.png"),
    "cas_bar_100btc_gp_s2": ("bar-100-gold-s2-front.png", "bar-gold-back.png"),
    "cas_bar_500btc_gp": ("bar-500-gold-s1-front.png", "bar-gold-back.png"),
    "cas_bar_500btc_gp_s2": ("bar-500-gold-s2-front.png", "bar-gold-back.png"),
    "cas_bar_1000btc_gp": ("bar-1000-gold-s1-front.png", "bar-gold-back.png"),
    "cas_0p1btc_2013_silver_s3": ("coin-0.1-silver-2013-front.png", "coin-0.1-silver-s3-back.png"),
    "cas_05btc_2013_brass": ("coin-0.5-brass-2013-front.png", "coin-0.5-brass-s2-back.png"),
    "cas_0p5btc_2013_silver_s25": ("coin-0.5-silver-2013-front.png", "coin-0.5-silver-s2-back.png"),
    "cas_0p5btc_2013_silver_s3": ("coin-0.5-silver-2013-front.png", "coin-0.5-silver-s3-back.png"),
    "cas_1btc_2011_s1": ("coin-1-brass-2011-front.png", "coin-1-brass-s1-back.png"),
    "cas_1btc_2011_s2": ("coin-1-brass-2011-front.png", "coin-1-brass-s2-back.png"),
    "cas_1btc_2012_s2": ("coin-1-brass-2012-front.png", "coin-1-brass-s2-back.png"),
    "cas_1btc_2013_brass": ("coin-1-brass-2013-front.png", "coin-1-brass-s2-back.png"),
    "cas_1btc_2013_gold_rim_silver": ("coin-1-silver_gold_rim-2013-front.png", "coin-1-silver_gold_rim-s3-back.png"),
    "cas_1btc_2013_silver": ("coin-1-silver-2013-front.png", "coin-1-silver-s3-back.png"),
    "cas_1btc_2011_mule_demo": ("coin-1-brass-mule-2011-front.png", "coin-1-brass-mule-back.png"),
    "cas_5btc_2012_bitnickel": ("coin-5-nickel-2012-front.png", "coin-5-nickel-s1-back.png"),
    "cas_5btc_2012_bitnickel_mule": ("coin-5-nickel-2012-front.png", "coin-5-nickel-mule-back.png"),
    "cas_5btc_2012_bitnickel_s2": ("coin-5-nickel-2012-front.png", "coin-5-nickel-s2-back.png"),
    "cas_10btc_2012_silver": ("coin-10-silver-2012-front.png", "coin-10-silver-s2-back.png"),
    "cas_10btc_2012_silver_gold_b": ("coin-10-silver_gold_b-2012-front.png", "coin-10-silver_gold_b-s2-back.png"),
    "cas_25btc_2011_gp": ("coin-25-gold-plated-2011-front.png", "coin-25-gold-plated-s1-back.png"),
    "cas_25btc_2011_gp_s2": ("coin-25-gold-plated-2011-front.png", "coin-25-gold-plated-s2-back.png"),
    "cas_1000btc_gold": ("coin-1000-gold-2012-front.png", "coin-1000-gold-2012-back.png"),
    "cas_aluminum_2013": ("coin-aluminum-2013-front.png", "coin-aluminum-2013-back.png"),
}


def data_url(filename: str) -> str:
    path = IMAGE_DIR / filename
    if not path.exists():
        raise SystemExit(f"Missing image: {path}")
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def load_coins(text: str) -> list[dict]:
    match = re.search(r"^const COINS = (\[.*?\]);$", text, re.M)
    if not match:
        raise SystemExit("Could not locate COINS array")
    return json.loads(match.group(1))


def bitnickel_mule_from(template: dict) -> dict:
    mule = {
        key: value
        for key, value in template.items()
        if key not in {"frontData", "backData", "backAddressFirstbits"}
    }
    mule.update({
        "slug": "cas_5btc_2012_bitnickel_mule",
        "label": "2012 Bitnickel Mule",
        "series": "Series 1/2 mule",
        "denominationBtc": 5,
    })
    return mule


def ensure_bitnickel_mule(coins: list[dict]) -> list[dict]:
    if any(coin.get("slug") == "cas_5btc_2012_bitnickel_mule" for coin in coins):
        return coins
    for index, coin in enumerate(coins):
        if coin.get("slug") == "cas_5btc_2012_bitnickel":
            return coins[: index + 1] + [bitnickel_mule_from(coin)] + coins[index + 1 :]
    raise SystemExit("Could not locate bitnickel template")


def aluminum_coin() -> dict:
    return {
        "slug": "cas_aluminum_2013",
        "label": "Aluminum Coin 2013",
        "groupLabel": "Aluminum Coin",
        "groupSort": 10000,
        "denominationBtc": None,
        "nonFundedStats": True,
        "allModeOnly": True,
        "metal": "aluminum",
        "diameterMm": 32.0,
        "thicknessMm": 1.3,
        "thicknessLabel": "1.3 mm",
        "weight": "2.7 g",
        "edgeStyle": "smooth",
        "edgeLabel": "plain edge assumed",
        "year": 2013,
        "version": 0,
        "series": "—",
        "faceDiameterScale": 1.0,
    }


def ensure_aluminum_coin(coins: list[dict]) -> list[dict]:
    for coin in coins:
        if coin.get("slug") == "cas_aluminum_2013":
            coin.update(aluminum_coin())
            return coins
    return [*coins, aluminum_coin()]


def normalize_labels(coins: list[dict]) -> list[dict]:
    labels = {
        "cas_1btc_2011_mule_demo": "2011 Brass Mule",
        "cas_5btc_2012_bitnickel_mule": "2012 Bitnickel Mule",
    }
    for coin in coins:
        slug = coin.get("slug")
        label = labels.get(slug)
        if label:
            coin["label"] = label
        if slug == "cas_1btc_2011_mule_demo":
            coin["denominationBtc"] = 1
        if slug == "cas_5btc_2012_bitnickel_mule":
            coin["denominationBtc"] = 5
    return coins


def main() -> int:
    text = DATA_SOURCE.read_text()
    coins = normalize_labels(ensure_aluminum_coin(ensure_bitnickel_mule(load_coins(text))))

    for coin in coins:
        slug = coin.get("slug")
        if slug not in IMAGE_FILES:
            raise SystemExit(f"No image mapping for {slug}")
        front, back = IMAGE_FILES[slug]
        coin["frontData"] = data_url(front)
        coin["backData"] = data_url(back)

    replacement = "const COINS = " + json.dumps(coins, separators=(",", ":")) + ";"
    updated, count = re.subn(
        r"^const COINS = \[.*?\];$",
        lambda _: replacement,
        text,
        count=1,
        flags=re.M,
    )
    if count != 1:
        raise SystemExit("Could not replace COINS array")
    DATA_SOURCE.write_text(updated)
    print(f"Wrote {len(coins)} entries to {DATA_SOURCE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
