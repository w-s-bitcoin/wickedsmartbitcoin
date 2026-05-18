#!/usr/bin/env python3
"""Update UoA FX datasets from Frankfurter with maximum supported currency coverage."""

import argparse
import csv
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

try:
    import numpy as np
    import pandas as pd
except ModuleNotFoundError:
    np = None
    pd = None

try:
    import requests
except ModuleNotFoundError:
    class _UrlopenResponse:
        def __init__(self, status_code, text):
            self.status_code = status_code
            self.text = text

        def raise_for_status(self):
            if self.status_code >= 400:
                raise RuntimeError(f"HTTP {self.status_code}: {self.text[:200]}")

        def json(self):
            return json.loads(self.text)

    class _RequestsFallback:
        @staticmethod
        def get(url, params=None, timeout=30):
            if params:
                separator = "&" if "?" in url else "?"
                url = f"{url}{separator}{urlencode(params)}"
            req = Request(url, headers={"User-Agent": "wickedsmartbitcoin-uoa-refresh/1.0"})
            with urlopen(req, timeout=timeout) as response:
                body = response.read().decode("utf-8")
                return _UrlopenResponse(response.status, body)

    requests = _RequestsFallback()

# Configuration
API_BASE = "https://api.frankfurter.dev/v2"
START_DATE = "1999-01-01"
EXCLUDED_SOURCE_CURRENCIES = {"CNH", "MRO"}
CUP_INFORMAL_API_URL = "https://api.cambiocuba.money/api/v1/x-rates-by-date-range"
CUP_INFORMAL_PERIOD = "2Y"
CUP_INFORMAL_SOURCE_LABEL = "elTOQUE TRMI via CUP=X"
VES_REDENOMINATION_EVENTS = [
    {"date": "2018-05-29", "ratio": 100000, "ratioLabel": "100,000:1"},
    {"date": "2018-08-20", "ratio": 100000, "ratioLabel": "100,000:1"},
    {"date": "2021-10-01", "ratio": 1000000, "ratioLabel": "1,000,000:1"},
]
BYN_REDENOMINATION_EVENTS = [
    {"date": "2016-07-01", "ratio": 10000, "ratioLabel": "10,000:1"},
]
MRU_REDENOMINATION_EVENTS = [
    {"date": "2018-01-02", "ratio": 10, "ratioLabel": "10:1"},
]
CUP_REDENOMINATION_EVENTS = [
    {"date": "2021-01-01", "ratio": 1 / 24, "ratioLabel": "1:24"},
]
SYP_REDENOMINATION_EVENTS = [
    {"date": "2026-01-07", "ratio": 100, "ratioLabel": "100:1"},
]
ZMW_REDENOMINATION_EVENTS = [
    {"date": "2013-01-02", "ratio": 1000, "ratioLabel": "1,000:1"},
]
MZN_REDENOMINATION_EVENTS = [
    {"date": "2006-07-10", "ratio": 1000, "ratioLabel": "1,000:1"},
]
AZN_REDENOMINATION_EVENTS = [
    {"date": "2006-01-01", "ratio": 5000, "ratioLabel": "5,000:1"},
]
TJS_REDENOMINATION_EVENTS = [
    {"date": "2000-11-01", "ratio": 1000, "ratioLabel": "1,000:1"},
]
TMT_REDENOMINATION_EVENTS = [
    {"date": "2009-01-01", "ratio": 5000, "ratioLabel": "5,000:1"},
]
REDENOMINATION_EVENTS = {
    "VES": VES_REDENOMINATION_EVENTS,
    "BYN": BYN_REDENOMINATION_EVENTS,
    "MRU": MRU_REDENOMINATION_EVENTS,
    "CUP": CUP_REDENOMINATION_EVENTS,
    "SYP": SYP_REDENOMINATION_EVENTS,
    "ZMW": ZMW_REDENOMINATION_EVENTS,
    "MZN": MZN_REDENOMINATION_EVENTS,
    "AZN": AZN_REDENOMINATION_EVENTS,
    "TJS": TJS_REDENOMINATION_EVENTS,
    "TMT": TMT_REDENOMINATION_EVENTS,
}
NOTABLE_EVENTS = {    "VES": [
        {
            "date": "2013-02-19",
            "label": "VES devaluation ~65%",
        },
        {
            "date": "2016-03-08",
            "label": "VES devaluation ~70%",
        },
        {
            "date": "2018-02-06",
            "label": "VES devaluation ~250,000%",
        },
        {
            "date": "2018-08-20",
            "label": "VES devaluation ~50% + redenomination",
        },
    ],    "SDG": [
        {
            "date": "2021-02-25",
            "label": "SDG devaluation ~582%",
        }
    ],    "TMT": [
        {
            "date": "2015-01-06",
            "label": "TMT devaluation ~20%",
        }
    ],    "EGP": [
        {
            "date": "2016-11-04",
            "label": "EGP devaluation ~48%",
        },
        {
            "date": "2024-03-07",
            "label": "EGP devaluation ~55%",
        }
    ],    "ARS": [
        {
            "date": "2023-12-15",
            "label": "ARS devaluation ~54%",
        }
    ],    "AZN": [
        {
            "date": "2015-02-24",
            "label": "AZN devaluation ~34%",
        },
        {
            "date": "2015-12-22",
            "label": "AZN devaluation ~47%",
        }
    ],    "LYD": [
        {
            "date": "2021-02-09",
            "label": "LYD devaluation ~69%",
        }
    ],    "LBP": [
        {
            "date": "2023-02-03",
            "label": "LBP devaluation ~90%",
        },
        {
            "date": "2024-03-11",
            "label": "LBP devaluation ~83.3%",
        }
    ]
}
VES_FIRST_REDENOM_DATE = "2018-05-29"

CURRENCY_FORMAT_OVERRIDES = {
    "EUR": {"symbol": "€", "symbol_position": "left", "minor_unit": 2},
    "USD": {"symbol": "$", "symbol_position": "left", "minor_unit": 2},
    "ANG": {"symbol": "ƒ", "symbol_position": "left", "minor_unit": 2},
    "GBP": {"symbol": "£", "symbol_position": "left", "minor_unit": 2},
    "JPY": {"symbol": "¥", "symbol_position": "left", "minor_unit": 0},
    "CHF": {"symbol": "CHF", "symbol_position": "right", "minor_unit": 2},
    "CAD": {"symbol": "C$", "symbol_position": "left", "minor_unit": 2},
    "AUD": {"symbol": "A$", "symbol_position": "left", "minor_unit": 2},
    "NZD": {"symbol": "NZ$", "symbol_position": "left", "minor_unit": 2},
    "CNY": {"symbol": "¥", "symbol_position": "left", "minor_unit": 2},
    "INR": {"symbol": "₹", "symbol_position": "left", "minor_unit": 2},
    "SEK": {"symbol": "kr", "symbol_position": "right", "minor_unit": 2},
    "NOK": {"symbol": "kr", "symbol_position": "right", "minor_unit": 2},
    "DKK": {"symbol": "kr", "symbol_position": "right", "minor_unit": 2},
    "PLN": {"symbol": "zł", "symbol_position": "right", "minor_unit": 2},
    "HUF": {"symbol": "Ft", "symbol_position": "right", "minor_unit": 0},
    "CZK": {"symbol": "Kč", "symbol_position": "right", "minor_unit": 2},
    "RON": {"symbol": "lei", "symbol_position": "right", "minor_unit": 2},
    "TRY": {"symbol": "₺", "symbol_position": "left", "minor_unit": 2},
    "ILS": {"symbol": "₪", "symbol_position": "right", "minor_unit": 2},
    "MXN": {"symbol": "MX$", "symbol_position": "left", "minor_unit": 2},
    "SGD": {"symbol": "S$", "symbol_position": "left", "minor_unit": 2},
    "ZAR": {"symbol": "R", "symbol_position": "left", "minor_unit": 2},
    "HKD": {"symbol": "HK$", "symbol_position": "left", "minor_unit": 2},
    "KRW": {"symbol": "₩", "symbol_position": "left", "minor_unit": 0},
    "THB": {"symbol": "฿", "symbol_position": "left", "minor_unit": 2},
    "VES": {"symbol": "Bs ", "symbol_position": "left", "minor_unit": 2},
    "PEN": {"symbol": "S/", "symbol_position": "left", "minor_unit": 2},
    "PGK": {"symbol": "K", "symbol_position": "left", "minor_unit": 2},
    "LYD": {"symbol": "LD", "symbol_position": "left", "minor_unit": 2},
    "TTD": {"symbol": "TT$", "symbol_position": "left", "minor_unit": 2},
    "BOB": {"symbol": "Bs ", "symbol_position": "left", "minor_unit": 2},
    "GTQ": {"symbol": "Q ", "symbol_position": "left", "minor_unit": 2},
    "SBD": {"symbol": "SI$", "symbol_position": "left", "minor_unit": 2},
    "MOP": {"symbol": "MOP$", "symbol_position": "left", "minor_unit": 2},
    "BWP": {"symbol": "P", "symbol_position": "left", "minor_unit": 2},
    "SCR": {"symbol": "Rs", "symbol_position": "left", "minor_unit": 2},
    "MVR": {"symbol": "Rf", "symbol_position": "left", "minor_unit": 2},
    "NAD": {"symbol": "N$", "symbol_position": "left", "minor_unit": 2},
    "LSL": {"symbol": "M", "symbol_position": "left", "minor_unit": 2},
    "SLE": {"symbol": "Le ", "symbol_position": "left", "minor_unit": 2},
    "ZWG": {"symbol": "ZiG ", "symbol_position": "left", "minor_unit": 2},
    "HNL": {"symbol": "L ", "symbol_position": "left", "minor_unit": 2},
    "TWD": {"symbol": "NT$", "symbol_position": "left", "minor_unit": 2},
    "SRD": {"symbol": "Sr$", "symbol_position": "left", "minor_unit": 2},
    "UYU": {"symbol": "$U", "symbol_position": "left", "minor_unit": 2},
    "MRU": {"symbol": "UM ", "symbol_position": "left", "minor_unit": 2},
    "UAH": {"symbol": "₴", "symbol_position": "left", "minor_unit": 2},
    "MUR": {"symbol": "Rs ", "symbol_position": "left", "minor_unit": 2},
    "MZN": {"symbol": "MT ", "symbol_position": "left", "minor_unit": 2},
    "EGP": {"symbol": "£E", "symbol_position": "left", "minor_unit": 2},
    "GMD": {"symbol": "D", "symbol_position": "left", "minor_unit": 2},
    "ALL": {"symbol": "L", "symbol_position": "left", "minor_unit": 2},
    "XPF": {"symbol": "F", "symbol_position": "left", "minor_unit": 2},
    "BTN": {"symbol": "Nu. ", "symbol_position": "left", "minor_unit": 2},
    "SYP": {"symbol": "£S ", "symbol_position": "left", "minor_unit": 2},
    "BDT": {"symbol": "৳", "symbol_position": "left", "minor_unit": 2},
    "VUV": {"symbol": "Vt", "symbol_position": "left", "minor_unit": 2},
    "KGS": {"symbol": " сом", "symbol_position": "right", "minor_unit": 2},
    "RSD": {"symbol": " din", "symbol_position": "right", "minor_unit": 2},
    "RUB": {"symbol": " ₽", "symbol_position": "right", "minor_unit": 2},
    "DOP": {"symbol": "RD$", "symbol_position": "left", "minor_unit": 2},
    "AFN": {"symbol": "Af ", "symbol_position": "left", "minor_unit": 2},
    "MKD": {"symbol": "ден ", "symbol_position": "left", "minor_unit": 2},
    "NIO": {"symbol": "C$", "symbol_position": "left", "minor_unit": 2},
    "SZL": {"symbol": "E", "symbol_position": "left", "minor_unit": 2},
    "HTG": {"symbol": "G ", "symbol_position": "left", "minor_unit": 2},
    "NPR": {"symbol": "रू", "symbol_position": "left", "minor_unit": 2},
    "DZD": {"symbol": "DA ", "symbol_position": "left", "minor_unit": 2},
    "MDL": {"symbol": "L ", "symbol_position": "left", "minor_unit": 2},
    "ZMW": {"symbol": "K", "symbol_position": "left", "minor_unit": 2},
    "STN": {"symbol": "Db", "symbol_position": "left", "minor_unit": 2},
    "ERN": {"symbol": "Nfk ", "symbol_position": "left", "minor_unit": 2},
    "SVC": {"symbol": "₡", "symbol_position": "left", "minor_unit": 2},
    "CRC": {"symbol": "₡", "symbol_position": "left", "minor_unit": 2},
    "KZT": {"symbol": "₸", "symbol_position": "left", "minor_unit": 2},
    "MNT": {"symbol": "₮", "symbol_position": "left", "minor_unit": 2},
    "SSP": {"symbol": "£", "symbol_position": "left", "minor_unit": 2},
    "PYG": {"symbol": "₲", "symbol_position": "left", "minor_unit": 2},
    "GNF": {"symbol": "FG ", "symbol_position": "left", "minor_unit": 2},
    "KWD": {"symbol": "KD ", "symbol_position": "left", "minor_unit": 2},
    "BHD": {"symbol": "BD ", "symbol_position": "left", "minor_unit": 2},
    "JOD": {"symbol": "JD ", "symbol_position": "left", "minor_unit": 2},
    "LAK": {"symbol": "₭", "symbol_position": "left", "minor_unit": 2},
    "VND": {"symbol": "₫", "symbol_position": "left", "minor_unit": 2},
    "FKP": {"symbol": "£", "symbol_position": "left", "minor_unit": 2},
    "GGP": {"symbol": "£", "symbol_position": "left", "minor_unit": 2},
    "IMP": {"symbol": "£", "symbol_position": "left", "minor_unit": 2},
    "JEP": {"symbol": "£", "symbol_position": "left", "minor_unit": 2},
    "SHP": {"symbol": "£", "symbol_position": "left", "minor_unit": 2},
    "GIP": {"symbol": "£", "symbol_position": "left", "minor_unit": 2},
    "GEL": {"symbol": "₾", "symbol_position": "left", "minor_unit": 2},
    "KYD": {"symbol": "CI$", "symbol_position": "left", "minor_unit": 2},
    "BMD": {"symbol": "BD$", "symbol_position": "left", "minor_unit": 2},
    "BBD": {"symbol": "Bds$", "symbol_position": "left", "minor_unit": 2},
    "BZD": {"symbol": "BZ$", "symbol_position": "left", "minor_unit": 2},
    "WST": {"symbol": "WS$", "symbol_position": "left", "minor_unit": 2},
    "AWG": {"symbol": "ƒ", "symbol_position": "left", "minor_unit": 2},
    "BYN": {"symbol": "Br", "symbol_position": "left", "minor_unit": 2},
    "TOP": {"symbol": "T$", "symbol_position": "left", "minor_unit": 2},
    "XCD": {"symbol": "EC$", "symbol_position": "left", "minor_unit": 2},
    "PAB": {"symbol": "B/. ", "symbol_position": "left", "minor_unit": 2},
    "BSD": {"symbol": "B$", "symbol_position": "left", "minor_unit": 2},
    "BND": {"symbol": "B$", "symbol_position": "left", "minor_unit": 2},
    "FJD": {"symbol": "FJ$", "symbol_position": "left", "minor_unit": 2},
    "UZS": {"symbol": "сўм ", "symbol_position": "left", "minor_unit": 2},
    "UGX": {"symbol": "USh ", "symbol_position": "left", "minor_unit": 2},
    "NGN": {"symbol": "₦", "symbol_position": "left", "minor_unit": 2},
    "KHR": {"symbol": "៛", "symbol_position": "left", "minor_unit": 2},
    "GHS": {"symbol": "GH₵", "symbol_position": "left", "minor_unit": 2},
    "MGA": {"symbol": "Ar ", "symbol_position": "left", "minor_unit": 2},
    "MAD": {"symbol": "DH", "symbol_position": "right", "minor_unit": 2},
    "TJS": {"symbol": "SM ", "symbol_position": "left", "minor_unit": 2},
    "AOA": {"symbol": "Kz", "symbol_position": "left", "minor_unit": 2},
    "SOS": {"symbol": "S. ", "symbol_position": "left", "minor_unit": 2},
    "MWK": {"symbol": "K", "symbol_position": "left", "minor_unit": 2},
    "MMK": {"symbol": "K ", "symbol_position": "left", "minor_unit": 2},
    "CDF": {"symbol": "FC ", "symbol_position": "left", "minor_unit": 2},
    "BIF": {"symbol": "FBu", "symbol_position": "left", "minor_unit": 2},
    "PHP": {"symbol": "₱", "symbol_position": "left", "minor_unit": 2},
    "BRL": {"symbol": "R$", "symbol_position": "left", "minor_unit": 2},
    "JMD": {"symbol": "J$", "symbol_position": "left", "minor_unit": 2},
    "ETB": {"symbol": "Br ", "symbol_position": "left", "minor_unit": 2},
    "PKR": {"symbol": "Rs ", "symbol_position": "left", "minor_unit": 2},
    "KMF": {"symbol": "FC ", "symbol_position": "left", "minor_unit": 2},
    "AMD": {"symbol": "֏", "symbol_position": "left", "minor_unit": 2},
    "LKR": {"symbol": "Rs ", "symbol_position": "left", "minor_unit": 2},
    "DJF": {"symbol": "Fdj ", "symbol_position": "left", "minor_unit": 2},
    "LRD": {"symbol": "L$", "symbol_position": "left", "minor_unit": 2},
    "GYD": {"symbol": "G$", "symbol_position": "left", "minor_unit": 2},
    "IDR": {"symbol": "Rp", "symbol_position": "left", "minor_unit": 2},
    "MYR": {"symbol": "RM", "symbol_position": "left", "minor_unit": 2},
    "ISK": {"symbol": "kr", "symbol_position": "right", "minor_unit": 0},
    "QAR": {"symbol": "QR ", "symbol_position": "left", "minor_unit": 2},
    "AED": {"symbol": "Dh ", "symbol_position": "left", "minor_unit": 2},
    "SAR": {"symbol": "SR ", "symbol_position": "left", "minor_unit": 2},
    "TND": {"symbol": " DT", "symbol_position": "right", "minor_unit": 0},
}

CURRENCY_NAME_OVERRIDES = {
    "BAM": "Bosnia and Herzegovina convertible mark",
    "USD": "US Dollar",
    "VES": "Venezuelan Bolívar",
    "XAG": "silver",
    "XAU": "gold",
    "XPD": "palladium",
    "XPT": "platinum",
}

MANUAL_FX_SCALE_CORRECTIONS = [
    {
        "column": "sypusd",
        "start_date": "2026-01-05",
        "end_date": "2026-01-06",
        "factor": 0.5,
        "reason": "Correct SYP/USD pre-redenomination source-scale points.",
    },
    {
        "column": "cupusd",
        "start_date": START_DATE,
        "end_date": "2020-12-31",
        "clear": True,
        "reason": "Remove CUP/USD values before 2021 source coverage.",
    },
    {
        "column": "mznusd",
        "start_date": "2006-07-03",
        "end_date": "2006-07-09",
        "value": 0.000039,
        "reason": "Carry forward 2006-07-02 MZN/USD value through pre-redenomination source-scale spike.",
    },
    {
        "column": "aznusd",
        "start_date": "2006-01-01",
        "end_date": "2006-01-08",
        "value": 1.089,
        "reason": "Correct AZN/USD values immediately after 5,000:1 redenomination.",
    },
    {
        "column": "tjsusd",
        "start_date": "2000-01-02",
        "end_date": "2000-01-06",
        "value": 0.00069,
        "reason": "Carry forward 2000-01-01 TJS/USD value before source-scale correction.",
    },
    {
        "column": "tjsusd",
        "start_date": "2000-01-07",
        "end_date": "2000-10-31",
        "factor": 0.1,
        "reason": "Correct TJS/USD pre-redenomination source-scale values.",
    },
    {
        "column": "khrusd",
        "start_date": "2026-05-11",
        "end_date": "2026-05-11",
        "value": 0.00025,
        "reason": "Replace isolated bad upstream KHR/USD point; NBC and market sources stayed near 4012 KHR/USD.",
    },
    {
        "column": "lakusd",
        "start_date": "2026-05-11",
        "end_date": "2026-05-11",
        "value": 0.000046,
        "reason": "Replace isolated bad upstream LAK/USD point; market sources stayed near 21,900 LAK/USD.",
    },
]


def fetch_supported_currencies():
    """Fetch the full currency code -> name map from Frankfurter."""
    url = f"{API_BASE}/currencies"
    response = requests.get(url, timeout=30)
    response.raise_for_status()
    data = response.json()
    if isinstance(data, list):
        # v2 format: [{"iso_code": "USD", "name": "United States Dollar", ...}, ...]
        out = {}
        for row in data:
            code = str(row.get("iso_code") or "").upper().strip()
            name = str(row.get("name") or code).strip()
            if code:
                out[code] = name
        if out:
            return out
    if isinstance(data, dict):
        # v1 fallback format: {"USD": "United States Dollar", ...}
        return {str(code).upper(): str(name).strip() for code, name in data.items()}
    raise ValueError("Unexpected currencies response format")


def fetch_pair_rates(base_currency, quote_currency="USD", start_date=None, end_date=None):
    """Fetch historical rates for a currency pair from Frankfurter API"""
    start = start_date or START_DATE
    end = end_date or START_DATE
    print(f"  Fetching {base_currency}/{quote_currency}...")
    start_dt = datetime.strptime(start, "%Y-%m-%d").date()
    end_dt = datetime.strptime(end, "%Y-%m-%d").date()

    # Large full-history requests can occasionally return malformed JSON from upstream;
    # chunking keeps payload sizes stable and significantly improves reliability.
    span_days = (end_dt - start_dt).days
    chunk_days = 365 if span_days > 540 else (span_days + 1)

    by_date = {}
    chunk_start = start_dt
    while chunk_start <= end_dt:
        chunk_end = min(chunk_start + timedelta(days=chunk_days - 1), end_dt)
        try:
            chunk_rates = fetch_pair_rates_chunk(base_currency, quote_currency, chunk_start, chunk_end)
            for date_str, rate_value in chunk_rates:
                by_date[date_str] = rate_value
        except Exception as e:
            print(
                "    ERROR fetching "
                f"{base_currency}/{quote_currency} for {chunk_start.isoformat()}..{chunk_end.isoformat()}: {e}"
            )
            return []
        chunk_start = chunk_end + timedelta(days=1)

    rates = sorted(by_date.items(), key=lambda item: item[0])
    print(f"    Got {len(rates)} trading days")
    return rates


def fetch_pair_rates_chunk(base_currency, quote_currency, start_dt, end_dt, max_retries=3):
    """Fetch one date window for a single pair with retry on transient malformed responses."""
    url = f"{API_BASE}/rates"
    params = {
        "from": start_dt.isoformat(),
        "to": end_dt.isoformat(),
        "base": base_currency,
        "quotes": quote_currency,
    }

    last_error = None
    for attempt in range(1, max_retries + 1):
        try:
            response = requests.get(url, params=params, timeout=45)
            response.raise_for_status()
            data = response.json()

            rates = []
            if isinstance(data, list):
                for row in data:
                    date_str = str(row.get("date") or "").strip()
                    quote = str(row.get("quote") or "").upper().strip()
                    rate_value = row.get("rate")
                    if date_str and quote == quote_currency and isinstance(rate_value, (int, float)):
                        rates.append((date_str, float(rate_value)))
            elif isinstance(data, dict) and "rates" in data:
                # v1 fallback format
                for date_str, rates_dict in data["rates"].items():
                    if quote_currency in rates_dict:
                        rates.append((date_str, float(rates_dict[quote_currency])))

            return rates
        except Exception as exc:
            last_error = exc
            if attempt < max_retries:
                time.sleep(0.4 * attempt)

    raise last_error


def fetch_cup_informal_usd_rates(period=CUP_INFORMAL_PERIOD):
    """Fetch informal-market CUP/USD values and convert to USD per 1 CUP.

    The CUP=X/elTOQUE feed reports CUP per 1 USD. Our canonical `cupusd`
    column stores USD per 1 CUP, so each valid median is inverted.
    """
    print(f"  Fetching CUP/USD informal rate ({CUP_INFORMAL_SOURCE_LABEL}, period={period})...")
    response = requests.get(
        CUP_INFORMAL_API_URL,
        params={"trmi": "true", "period": period, "cur": "USD"},
        timeout=90,
    )
    response.raise_for_status()
    data = response.json()
    if not isinstance(data, list):
        raise ValueError("Unexpected CUP informal rate response format")

    rates = []
    for row in data:
        if not isinstance(row, dict):
            continue
        date_str = str(row.get("_id") or row.get("date") or "").strip()[:10]
        if not date_str:
            continue
        cup_per_usd = row.get("median")
        if not isinstance(cup_per_usd, (int, float)) or cup_per_usd <= 0:
            continue

        # The current public feed covers post-2021 data. If earlier rows are
        # added later, keep the source denomination as reported for that date;
        # chart-level redenomination handling will segment CUP values.
        rates.append((date_str, 1.0 / float(cup_per_usd)))

    rates = sorted(set(rates), key=lambda item: item[0])
    if not rates:
        raise ValueError("No valid CUP informal rates returned")
    print(f"    Got {len(rates)} daily medians ({rates[0][0]}..{rates[-1][0]})")
    return rates


def apply_cup_informal_rates(df, period=CUP_INFORMAL_PERIOD):
    """Overwrite available `cupusd` rows with informal-market CUP/USD data."""
    if "date" not in df.columns:
        raise ValueError("FX dataframe is missing date column")

    rates = fetch_cup_informal_usd_rates(period=period)
    rate_map = {date_value: rate for date_value, rate in rates}
    out = df.copy()
    if "cupusd" not in out.columns:
        out["cupusd"] = pd.NA

    date_iso = pd.to_datetime(out["date"], errors="coerce").dt.strftime("%Y-%m-%d")
    mapped = date_iso.map(rate_map)
    mask = mapped.notna()
    if mask.any():
        out.loc[mask, "cupusd"] = mapped[mask].astype(float)
        out["cupusd"] = pd.to_numeric(out["cupusd"], errors="coerce").ffill()
    return out, len(rates), rates[0][0], rates[-1][0]


def fill_missing_dates(df, start_date, end_date):
    """Forward-fill missing dates (weekends/holidays) in dataframe"""
    # Create a complete date range
    date_range = pd.date_range(start=start_date, end=end_date, freq='D')

    # Reindex to include all dates and forward-fill
    df_filled = df.reindex(date_range)
    df_filled = df_filled.fillna(method='ffill')

    # Reset index to have date as column
    df_filled = df_filled.reset_index()
    df_filled.columns = ['date']

    # Merge back the original data
    for col in df.columns:
        if col != 'date':
            df_filled[col] = df_filled['date'].apply(
                lambda d: df[df['date'] == d.strftime('%Y-%m-%d')][col].values[0]
                if not df[df['date'] == d.strftime('%Y-%m-%d')].empty
                else df_filled[col].iloc[0] if pd.notna(df_filled.loc[df_filled['date'] == d, col].values[0])
                else None
            )

    return df_filled


def clean_ves_redenomination_lag_points(df, event_dates):
    """Replace obvious stale-scale VES/USD lag points with prior-day values.

    Some post-redenomination days can sporadically retain pre-redenomination scale
    values from upstream. We detect large local scale breaks in log-space and
    replace those rows with the prior day's value.
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

    fixes = 0
    vals = cleaned["vesusd"].tolist()
    dates = cleaned["date"].tolist()

    # We only alter interior points with a valid previous day to preserve the
    # requested "fill with day before" behavior exactly.
    for idx in range(1, len(vals) - 1):
        date_val = dates[idx]
        if pd.isna(date_val):
            continue
        day = date_val.date()
        if day < first_event or day in event_date_set:
            continue

        prev_val = vals[idx - 1]
        cur_val = vals[idx]
        next_val = vals[idx + 1]

        # Use local neighborhood scale as reference; if current is wildly off,
        # treat it as a stale-scale lag point.
        ref_candidates = [v for v in (prev_val, next_val) if pd.notna(v) and v > 0]
        if not ref_candidates:
            continue
        ref_val = float(pd.Series(ref_candidates).median())
        if not pd.notna(ref_val) or ref_val <= 0:
            continue

        is_bad = False
        if pd.isna(cur_val) or cur_val <= 0:
            is_bad = True
        else:
            ratio = float(cur_val) / ref_val
            # Detect clear stale-scale mismatches while avoiding normal volatility.
            if ratio < 0.05 or ratio > 20.0:
                is_bad = True

        if is_bad and pd.notna(prev_val) and prev_val > 0:
            vals[idx] = prev_val
            fixes += 1

    cleaned["vesusd"] = vals
    return cleaned, fixes


def clean_transient_spike_outliers(
    df,
    value_columns,
    date_column="date",
    max_spike_days=21,
    spike_factor=6.0,
    anchor_tolerance=2.5,
    baseline_window=45,
    recovery_window=7,
    merge_gap_days=1,
    max_anchor_gap_days=60,
):
    """Clean transient multi-day spike outliers that revert quickly.

    A run is cleaned only when:
    - values in the run deviate strongly from the local rolling-median baseline,
    - the run is short (<= max_spike_days), and
    - values immediately before/after the run are reasonably consistent (anchor_tolerance),
      indicating a temporary spike rather than a structural regime shift.
    - post-run values recover near pre-run anchor within a bounded lookahead window.

    Replacement uses log-linear interpolation between the two anchors.
    """
    if not value_columns:
        return df, {}

    cleaned = df.copy()
    if date_column in cleaned.columns:
        cleaned[date_column] = pd.to_datetime(cleaned[date_column], errors="coerce")

    ves_event_dates = {
        pd.to_datetime(event["date"], errors="coerce").date()
        for event in VES_REDENOMINATION_EVENTS
    }

    fixes_by_column = {}
    for col in value_columns:
        if col not in cleaned.columns:
            continue

        series = pd.to_numeric(cleaned[col], errors="coerce")
        valid_mask = series.notna() & (series > 0)
        if int(valid_mask.sum()) < max(10, baseline_window // 2):
            continue

        baseline = series.where(valid_mask).rolling(
            window=baseline_window,
            min_periods=max(7, baseline_window // 3),
            center=True,
        ).median()

        ratio = pd.Series(1.0, index=series.index, dtype=float)
        both = valid_mask & baseline.notna() & (baseline > 0)
        ratio.loc[both] = (series.loc[both] / baseline.loc[both]).astype(float)
        log_dist = ratio.abs().apply(lambda x: abs(np.log(x)) if x > 0 else float("inf"))
        threshold = abs(np.log(spike_factor))
        candidate = both & (log_dist >= threshold)

        # Merge nearby candidate islands to capture multi-day spikes with small gaps.
        if merge_gap_days > 0 and candidate.any():
            cand_vals = candidate.to_numpy(dtype=bool).copy()  # Create a writable copy of the array
            n_vals = cand_vals.shape[0]
            i = 0
            while i < n_vals:
                if cand_vals[i]:
                    i += 1
                    continue
                gap_start = i
                while i < n_vals and not cand_vals[i]:
                    i += 1
                gap_end = i - 1
                gap_len = gap_end - gap_start + 1
                left_on = gap_start > 0 and cand_vals[gap_start - 1]
                right_on = i < n_vals and cand_vals[i]
                if left_on and right_on and gap_len <= merge_gap_days:
                    cand_vals[gap_start:gap_end + 1] = True
            candidate = pd.Series(cand_vals, index=candidate.index)

        fixed_runs = 0
        idx = 0
        n = len(series)
        while idx < n:
            if not bool(candidate.iloc[idx]):
                idx += 1
                continue

            run_start = idx
            while idx + 1 < n and bool(candidate.iloc[idx + 1]):
                idx += 1
            run_end = idx
            run_len = run_end - run_start + 1

            # Only short-lived anomalies are treated as spikes.
            if run_len > max_spike_days:
                idx += 1
                continue

            left = run_start - 1
            right = run_end + 1
            if left < 0 or right >= n:
                idx += 1
                continue

            # Search for right anchor near-by to ensure "comes back down" behavior.
            right_limit = min(n - 1, run_end + max_anchor_gap_days)
            while right <= right_limit:
                rv = series.iloc[right]
                if pd.notna(rv) and float(rv) > 0:
                    break
                right += 1
            if right > right_limit:
                idx += 1
                continue

            left_val = float(series.iloc[left]) if pd.notna(series.iloc[left]) else None
            right_val = float(series.iloc[right]) if pd.notna(series.iloc[right]) else None
            if left_val is None or right_val is None or left_val <= 0 or right_val <= 0:
                idx += 1
                continue

            anchor_ratio = max(left_val, right_val) / min(left_val, right_val)
            if anchor_ratio > anchor_tolerance:
                idx += 1
                continue

            # Preserve known step changes for VES redenominations.
            if col.lower() == "vesusd" and date_column in cleaned.columns:
                run_dates = cleaned.loc[run_start:run_end, date_column].dt.date
                if any(d in ves_event_dates for d in run_dates if pd.notna(d)):
                    idx += 1
                    continue

            run_values = series.iloc[run_start:run_end + 1]
            run_median = float(run_values.median()) if run_values.notna().any() else None
            if run_median is None or run_median <= 0:
                idx += 1
                continue

            ref = (left_val * right_val) ** 0.5
            if ref <= 0:
                idx += 1
                continue

            run_vs_ref = max(run_median / ref, ref / run_median)
            if run_vs_ref < spike_factor:
                idx += 1
                continue

            # Ensure post-run recovery is near pre-run anchor to avoid deleting regime shifts.
            recovery_slice = series.iloc[right:min(n, right + recovery_window)]
            recovery_vals = recovery_slice[(recovery_slice.notna()) & (recovery_slice > 0)]
            if recovery_vals.empty:
                idx += 1
                continue
            recovery_med = float(recovery_vals.median())
            recovery_ratio = max(recovery_med, left_val) / min(recovery_med, left_val)
            if recovery_ratio > anchor_tolerance:
                idx += 1
                continue

            # Log-linear bridge preserves positivity and avoids abrupt plateaus.
            left_log = np.log(left_val)
            right_log = np.log(right_val)
            span = run_len + 1
            for j in range(run_len):
                t = (j + 1) / span
                bridged = float(np.exp(left_log + (right_log - left_log) * t))
                series.iloc[run_start + j] = bridged

            fixed_runs += 1
            idx += 1

        cleaned[col] = series
        if fixed_runs:
            fixes_by_column[col] = fixed_runs

    return cleaned, fixes_by_column


def apply_manual_fx_scale_corrections(df, corrections=MANUAL_FX_SCALE_CORRECTIONS):
    """Apply known date-bounded source-scale corrections before writing webapp data."""
    if "date" not in df.columns or not corrections:
        return df, {}

    cleaned = df.copy()
    date_series = pd.to_datetime(cleaned["date"], errors="coerce")
    fixes_by_column = {}

    for correction in corrections:
        column = str(correction.get("column", "")).strip()
        if not column or column not in cleaned.columns:
            continue

        start_date = pd.to_datetime(correction.get("start_date"), errors="coerce")
        end_date = pd.to_datetime(correction.get("end_date"), errors="coerce")
        factor = correction.get("factor")
        value = correction.get("value")
        should_clear = correction.get("clear") is True
        has_factor = isinstance(factor, (int, float)) and factor > 0
        has_value = isinstance(value, (int, float)) and value > 0
        if pd.isna(start_date) or pd.isna(end_date) or not (has_factor or has_value or should_clear):
            continue

        mask = (date_series >= start_date) & (date_series <= end_date)
        if not mask.any():
            continue

        if should_clear:
            cleaned.loc[mask, column] = pd.NA
            fixes_by_column[column] = fixes_by_column.get(column, 0) + int(mask.sum())
            continue

        values = pd.to_numeric(cleaned.loc[mask, column], errors="coerce")
        valid_mask = values.notna()
        if not valid_mask.any():
            continue

        cleaned.loc[values[valid_mask].index, column] = float(value) if has_value else values[valid_mask] * float(factor)
        fixes_by_column[column] = fixes_by_column.get(column, 0) + int(valid_mask.sum())

    return cleaned, fixes_by_column


def merge_legacy_mro_history_into_mru(df):
    """Use legacy MRO/USD values to backfill MRU/USD before MRU source coverage begins."""
    if "mrousd" not in df.columns:
        return df, 0

    merged = df.copy()
    if "mruusd" not in merged.columns:
        merged["mruusd"] = pd.NA

    mro_values = pd.to_numeric(merged["mrousd"], errors="coerce")
    mru_values = pd.to_numeric(merged["mruusd"], errors="coerce")
    fill_mask = mru_values.isna() & mro_values.notna()
    if not fill_mask.any():
        return merged, 0

    merged.loc[fill_mask, "mruusd"] = mro_values.loc[fill_mask]
    return merged, int(fill_mask.sum())


def rebuild_vesusd_canonical(df, end_date_iso):
    """Rebuild vesusd from canonical source stitching to avoid mixed-scale artifacts.

    Era rules:
    - Before 2018-05-29: VEF/USD converted by 100000:1.
    - On/after 2018-05-29: direct VES/USD.
    """
    if "date" not in df.columns:
        return df, 0

    first_dt = datetime.strptime(VES_FIRST_REDENOM_DATE, "%Y-%m-%d").date()
    event_dates = {event["date"] for event in VES_REDENOMINATION_EVENTS}

    ves_rates = fetch_pair_rates("VES", "USD", start_date=START_DATE, end_date=end_date_iso)
    vef_rates = fetch_pair_rates("VEF", "USD", start_date=START_DATE, end_date=end_date_iso)
    direct_ves = {d: r for d, r in ves_rates}
    converted_vef = {d: (r / 100000.0) for d, r in vef_rates}

    canonical = {}
    for d in sorted(set(direct_ves.keys()) | set(converted_vef.keys())):
        d_dt = datetime.strptime(d, "%Y-%m-%d").date()
        if d_dt < first_dt:
            if d in converted_vef:
                canonical[d] = converted_vef[d]
        else:
            if d in direct_ves:
                canonical[d] = direct_ves[d]

    out = df.copy()
    out["date"] = pd.to_datetime(out["date"], errors="coerce")
    date_iso = out["date"].dt.strftime("%Y-%m-%d")
    mapped = pd.to_numeric(date_iso.map(canonical), errors="coerce")
    out["vesusd"] = mapped

    vals = out["vesusd"].tolist()
    dates = date_iso.tolist()
    fixes = 0
    for idx in range(1, len(vals)):
        d = dates[idx]
        cur = vals[idx]
        prev = vals[idx - 1]
        if d in event_dates:
            continue
        if pd.isna(cur) and pd.notna(prev) and prev > 0:
            vals[idx] = prev
            fixes += 1
            continue
        if pd.notna(cur) and cur <= 0 and pd.notna(prev) and prev > 0:
            vals[idx] = prev
            fixes += 1
            continue
        if pd.notna(cur) and cur > 0 and pd.notna(prev) and prev > 0:
            ratio = float(cur) / float(prev)
            if ratio < 0.01 or ratio > 100.0:
                vals[idx] = prev
                fixes += 1
    out["vesusd"] = pd.Series(vals, index=out.index).ffill()
    out["date"] = out["date"].dt.strftime("%Y-%m-%d")
    return out, fixes


def annotate_cup_informal_source(uoa_data):
    """Mark CUP/USD as an informal-market sourced series in metadata."""
    for pair in uoa_data.get("pairs", []):
        if pair.get("base") != "CUP" or pair.get("quote") != "USD":
            continue
        pair["rate_source"] = CUP_INFORMAL_SOURCE_LABEL
        pair["quote_assumption"] = "Informal-market TRMI median, stored as USD per CUP"
        pair["source_coverage_note"] = (
            f"CUP/USD is available from 2021-01-01 onward; {CUP_INFORMAL_SOURCE_LABEL} is applied where available."
        )
        break


def refresh_cup_only():
    """Refresh only the `cupusd` column using the informal-market source."""
    webapp_data_dir = Path(__file__).parent / "webapp_data"
    fx_rates_file = webapp_data_dir / "daily_fx_rates.csv"
    uoa_pairs_file = webapp_data_dir / "uoa_pairs.json"

    print("=" * 60)
    print("Updating CUP/USD informal-market rates only")
    print("=" * 60)

    rates = fetch_cup_informal_usd_rates()
    rate_map = {date_value: rate for date_value, rate in rates}
    tmp_file = fx_rates_file.with_suffix(fx_rates_file.suffix + ".tmp")
    with open(fx_rates_file, newline="", encoding="utf-8") as src, open(tmp_file, "w", newline="", encoding="utf-8") as dst:
        reader = csv.DictReader(src)
        fieldnames = list(reader.fieldnames or [])
        if "date" not in fieldnames:
            raise ValueError("daily_fx_rates.csv is missing date column")
        if "cupusd" not in fieldnames:
            fieldnames.append("cupusd")

        writer = csv.DictWriter(dst, fieldnames=fieldnames)
        writer.writeheader()
        applied_count = 0
        for row in reader:
            date_value = str(row.get("date") or "")[:10]
            if date_value in rate_map:
                row["cupusd"] = f"{rate_map[date_value]:.12g}"
                applied_count += 1
            writer.writerow({field: row.get(field, "") for field in fieldnames})
    tmp_file.replace(fx_rates_file)
    count = len(rates)
    first_date = rates[0][0]
    last_date = rates[-1][0]
    print(
        f"  Updated cupusd with {applied_count} of {count} informal daily medians "
        f"({first_date}..{last_date})"
    )

    with open(uoa_pairs_file, "r") as f:
        uoa_data = json.load(f)
    annotate_cup_informal_source(uoa_data)
    uoa_data["generated_at_utc"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    source_meta = uoa_data.setdefault("source", {})
    source_meta["cupusd_source"] = CUP_INFORMAL_SOURCE_LABEL
    source_meta["notes"] = (
        "Rates are business-day reference rates for 163 Frankfurter-supported currency pairs vs USD; "
        f"CUP/USD is overwritten with {CUP_INFORMAL_SOURCE_LABEL} where available; "
        "weekends and market holidays are forward-filled."
    )
    with open(uoa_pairs_file, "w") as f:
        json.dump(uoa_data, f, indent=2)
    print(f"  Updated CUP metadata in {uoa_pairs_file.name}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--cup-only",
        action="store_true",
        help="Refresh only cupusd from the informal-market CUP source.",
    )
    args = parser.parse_args()
    if args.cup_only:
        refresh_cup_only()
        return
    if pd is None or np is None:
        raise RuntimeError("Full refresh requires numpy and pandas; use --cup-only for the lightweight CUP refresh.")

    webapp_data_dir = Path(__file__).parent / "webapp_data"
    fx_rates_file = webapp_data_dir / "daily_fx_rates.csv"
    uoa_pairs_file = webapp_data_dir / "uoa_pairs.json"

    print("=" * 60)
    print("Updating FX Rates for Multiple Currency Pairs")
    print("=" * 60)

    # Load existing CSV to get current range and refresh from the latest stored day forward.
    print("\nLoading existing FX rates...")
    existing_df = pd.read_csv(fx_rates_file)
    existing_df['date'] = pd.to_datetime(existing_df['date'])
    min_date = existing_df['date'].min().strftime('%Y-%m-%d')
    max_date = existing_df['date'].max().strftime('%Y-%m-%d')
    print(f"  Current date range: {min_date} to {max_date}")

    fetch_start_date = max_date
    fetch_end_date = date.today().isoformat()
    print(f"  Refresh window: {fetch_start_date} to {fetch_end_date}")

    supported_currencies = fetch_supported_currencies()
    target_currencies = sorted(
        code for code in supported_currencies.keys()
        if code != "USD" and code not in EXCLUDED_SOURCE_CURRENCIES
    )
    print(f"  Frankfurter-supported currencies (excl. USD): {len(target_currencies)}")

    existing_columns = set(existing_df.columns)
    existing_currency_columns = {f"{code.lower()}usd" for code in target_currencies}
    missing_columns = sorted(col for col in existing_currency_columns if col not in existing_columns)
    if missing_columns:
        print(f"  New currency columns requiring full backfill: {len(missing_columns)}")

    # Fetch rates for new currencies
    print(f"\nFetching {len(target_currencies)} currency pairs from Frankfurter API...")
    all_rates = {}
    for currency in target_currencies:
        column_name = f"{currency.lower()}usd"
        start_for_currency = START_DATE if column_name in missing_columns else fetch_start_date
        rates = fetch_pair_rates(currency, "USD", start_date=start_for_currency, end_date=fetch_end_date)
        if rates:
            all_rates[currency] = rates

    if not all_rates:
        print("ERROR: Failed to fetch any rates!")
        return

    # Build combined dataframe
    print("\nBuilding combined FX rates dataframe...")

    df_combined = existing_df.copy()
    df_combined['date'] = pd.to_datetime(df_combined['date']).dt.strftime('%Y-%m-%d')
    date_range = pd.date_range(start=min_date, end=fetch_end_date, freq='D')
    df_combined = (
        df_combined.set_index(pd.to_datetime(df_combined['date']))
        .reindex(date_range)
        .ffill()
        .reset_index(drop=True)
    )
    df_combined['date'] = date_range.strftime('%Y-%m-%d')

    # Ensure all target columns exist in one shot to avoid dataframe fragmentation.
    target_columns = [f"{currency.lower()}usd" for currency in target_currencies]
    if missing_columns:
        missing_df = pd.DataFrame(pd.NA, index=df_combined.index, columns=missing_columns)
        df_combined = pd.concat([df_combined, missing_df], axis=1)

    # Apply refreshed rates in a frame-level update (non-null values only).
    refresh_map = {}
    for currency, rates in all_rates.items():
        column_name = f"{currency.lower()}usd"
        refresh_map[column_name] = {date_value: rate for date_value, rate in rates}

    if refresh_map:
        refresh_df = pd.DataFrame(index=df_combined.index)
        for column_name, rates_dict in refresh_map.items():
            refresh_df[column_name] = df_combined['date'].map(rates_dict)
        df_combined.update(refresh_df)

    df_combined, legacy_mro_fills = merge_legacy_mro_history_into_mru(df_combined)
    if legacy_mro_fills:
        print(f"  Backfilled MRU/USD from legacy MRO/USD history: {legacy_mro_fills} rows")

    # Keep only the canonical column order: date + discovered currency columns.
    df_combined = df_combined[['date', *target_columns]]

    print("  Forward-filling missing dates...")
    for col in df_combined.columns:
        if col != 'date':
            df_combined[col] = df_combined[col].ffill()

    # Use the informal free-float CUP/USD reference where the source has coverage.
    cup_rates_count = 0
    cup_rates_start = None
    cup_rates_end = None
    if "cupusd" in df_combined.columns:
        df_combined, cup_rates_count, cup_rates_start, cup_rates_end = apply_cup_informal_rates(df_combined)
        print(
            "  Applied informal CUP/USD rates: "
            f"{cup_rates_count} rows ({cup_rates_start}..{cup_rates_end})"
        )

    # Keep raw source values in vesusd; apply only targeted lag cleanup post-event.
    ves_event_dates = [event["date"] for event in VES_REDENOMINATION_EVENTS]
    df_combined, ves_fixes = clean_ves_redenomination_lag_points(df_combined, ves_event_dates)
    if ves_fixes:
        print(f"  Cleaned post-redenomination lag points: {ves_fixes}")

    # Apply known date-bounded source-scale fixes before general spike cleanup.
    df_combined, manual_fixes = apply_manual_fx_scale_corrections(df_combined)
    if manual_fixes:
        total_manual_fixes = sum(manual_fixes.values())
        manual_cols_text = ", ".join(f"{col}:{count}" for col, count in sorted(manual_fixes.items()))
        print(f"  Applied manual source-scale corrections: {total_manual_fixes} rows ({manual_cols_text})")

    # Remove transient spike outliers (single or multi-day) that quickly revert.
    spike_columns = [col for col in df_combined.columns if col != "date" and col.lower().endswith("usd")]
    df_combined, spike_fixes = clean_transient_spike_outliers(df_combined, spike_columns)
    if spike_fixes:
        total_spike_fixes = sum(spike_fixes.values())
        top_cols = sorted(spike_fixes.items(), key=lambda kv: kv[1], reverse=True)[:8]
        top_cols_text = ", ".join(f"{col}:{count}" for col, count in top_cols)
        print(f"  Cleaned transient spike runs: {total_spike_fixes} across {len(spike_fixes)} columns")
        print(f"    Top columns: {top_cols_text}")

    # Save updated CSV
    print(f"\nSaving updated CSV with {len(df_combined.columns)-1} currency pairs...")
    df_combined.to_csv(fx_rates_file, index=False)
    print(f"  Saved {len(df_combined)} rows to {fx_rates_file.name}")

    # Write the refresh timestamp used by the dashboard's Updated KPI.
    last_updated_file = webapp_data_dir / "last_updated.txt"
    last_updated_text = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    last_updated_file.write_text(last_updated_text + "\n", encoding="utf-8")
    print(f"  Wrote: {last_updated_file.name}")

    # Update uoa_pairs.json
    print("\nUpdating uoa_pairs.json...")
    with open(uoa_pairs_file, 'r') as f:
        uoa_data = json.load(f)

    # Rebuild currencies from source-supported set (plus BTC/USD), preserving BTC metadata.
    existing_currencies = uoa_data.get("currencies", {})
    btc_currency = existing_currencies.get("BTC", {
        "name": "Bitcoin",
        "code": "BTC",
        "symbol": "BTC",
        "symbol_position": "right",
        "minor_unit": 8,
    })
    usd_defaults = CURRENCY_FORMAT_OVERRIDES.get("USD", {"symbol": "$", "symbol_position": "left", "minor_unit": 2})
    currency_name = lambda code: CURRENCY_NAME_OVERRIDES.get(code, supported_currencies.get(code, code))

    rebuilt_currencies = {
        "BTC": btc_currency,
        "USD": {
            "name": currency_name("USD"),
            "code": "USD",
            "symbol": usd_defaults["symbol"],
            "symbol_position": usd_defaults["symbol_position"],
            "minor_unit": usd_defaults["minor_unit"],
        },
    }

    for code in target_currencies:
        fmt = CURRENCY_FORMAT_OVERRIDES.get(code, {"symbol": code, "symbol_position": "left", "minor_unit": 2})
        rebuilt_currencies[code] = {
            "name": currency_name(code),
            "code": code,
            "symbol": fmt["symbol"],
            "symbol_position": fmt["symbol_position"],
            "minor_unit": fmt["minor_unit"],
        }

    uoa_data["currencies"] = rebuilt_currencies

    # Update pairs list to reflect all available pairs.
    rebuilt_pairs = []
    for curr in target_currencies:
        pair = {
            "id": f"{curr.upper()}/USD",
            "base": curr.upper(),
            "quote": "USD",
            "display_name": f"{currency_name(curr)} / US Dollar",
            "dataset": "daily_fx_rates.csv",
            "dataset_columns": ["date", f"{curr.lower()}usd"],
            "pair_column_value": None,
            "quote_assumption": "USD-denominated FX rate"
        }
        if curr.upper() == "CUP":
            pair["rate_source"] = CUP_INFORMAL_SOURCE_LABEL
            pair["quote_assumption"] = "Informal-market TRMI median, stored as USD per CUP"
        rebuilt_pairs.append(pair)
    uoa_data["pairs"] = rebuilt_pairs
    annotate_cup_informal_source(uoa_data)

    # Update metadata
    uoa_data["generated_at_utc"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    uoa_data["source"]["end_date"] = fetch_end_date
    uoa_data["source"]["notes"] = (
        f"Rates are business-day reference rates for {len(target_currencies)} Frankfurter-supported currency pairs vs USD; "
        f"CUP/USD is overwritten with {CUP_INFORMAL_SOURCE_LABEL} where available; "
        "weekends and market holidays are forward-filled."
    )
    uoa_data["redenomination_events"] = REDENOMINATION_EVENTS
    uoa_data["notable_events"] = NOTABLE_EVENTS

    with open(uoa_pairs_file, 'w') as f:
        json.dump(uoa_data, f, indent=2)
    print(f"  Added {len(target_currencies)} source currencies to uoa_pairs.json")

    # Summary
    print("\n" + "=" * 60)
    print("SUCCESS!")
    print("=" * 60)
    print(f"CSV updated with {len(df_combined.columns)-1} currency pairs")
    print(f"Rows: {len(df_combined)} (dates with forward-filled missing values)")
    print(f"Source-supported currencies loaded: {', '.join(target_currencies)}")
    print("\nFiles updated:")
    print(f"  - {fx_rates_file.name}")
    print(f"  - {uoa_pairs_file.name}")


if __name__ == "__main__":
    main()
