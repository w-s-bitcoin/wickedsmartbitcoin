# Unit of Account

The dashboard converts selected currency pairs through USD using published
`assets/daily_price.csv`, `webapp_data/daily_fx_rates.csv`, and `uoa_pairs.json`.
`uoa_webapp_data_update.py` produces the FX publication; frontend fixes do not
require running it or changing publication markers.

## Alternative cryptocurrencies

ETH, BCH, and LTC first appeared in the October 26, 2026 automated data commit
`8f0d2bb72d`, through Frankfurter's automatically discovered currency catalog.
They initially had only 42 daily rows beginning September 18. FX discovery now
requires ISO numeric currency metadata, with explicit non-ISO fiat exceptions;
cryptocurrency coverage is reviewed separately in `uoa_crypto_history.py`.

The **Show alternative cryptocurrencies** checkbox sits above **Show Monetary
Metals** and defaults to off. The **Alternative cryptocurrencies** UoA Group
explicitly enables it. Turning it off while in that group returns to All and
resolves a hidden selected currency to the existing BTC/fiat fallback. It is
included in saved settings, share links, reset/undo, and refresh state. Explicit
crypto pair links enable the filter; codes such as DOGE and HYPE work in direct
pair URLs, search, and shares. BTC remains available in every group.

The October 29 review includes non-stablecoins above $10 billion in circulating
market cap plus popular currencies below that threshold, as requested. Stablecoins,
wrapped/staked duplicates, and tokenized private credit are excluded. The reviewed
list is explicit; market-cap changes do not silently add or remove currencies.
[CoinGecko market caps](https://www.coingecko.com/) informed the review.

All available daily history from the chosen public sources is imported. Main
series use [Coin Metrics PriceUSD](https://coverage.coinmetrics.io/asset-metrics/PriceUSD);
earlier coverage and TON use CoinGecko history through the
[DefiLlama public API](https://github.com/DefiLlama/api-docs/blob/main/llms-free.txt).
Missing daily-chart observations are recovered with same-date intraday quotes
where available. No pre-trading prices, interpolation, or neighboring-day fills
are invented. Availability starts at the first observed price, not necessarily
the network launch. Remaining source gaps are counted in `uoa_pairs.json`.

| Currency | Earliest available price | Unavailable days within coverage |
| --- | --- | --- |
| ETH | 2015-08-07 | 0 |
| BCH | 2017-08-01 | 0 |
| LTC | 2013-04-01 | 0 |
| BNB | 2017-07-15 | 0 |
| XRP | 2013-08-04 | 5 |
| SOL | 2020-04-10 | 0 |
| TRX | 2017-11-09 | 0 |
| ZEC | 2016-10-29 | 0 |
| HYPE | 2024-11-29 | 0 |
| DOGE | 2013-12-15 | 2 |
| XMR | 2014-05-20 | 0 |
| ADA | 2017-10-18 | 0 |
| LINK | 2017-09-29 | 0 |
| AVAX | 2020-09-22 | 0 |
| DOT | 2020-08-19 | 0 |
| TON | 2021-08-27 | 0 |
| SHIB | 2020-08-01 | 32 |
| SUI | 2023-05-03 | 0 |
| XLM | 2014-08-06 | 1 |

The initial import contains 60905 observations through October 28, 2026.
Cryptocurrency prices use published observations and are not sent to the fiat
quote scanner. BTC's existing live feed remains available. Current-day records
are not fabricated when the daily source has not reported them.

The normal UOA producer refreshes a 35-day revision window and retains earlier
history. Crypto series bypass FX forward-filling and spike cleanup. A failed
crypto fetch/validation aborts the new generation before any payload is installed.
Both payloads precede the publication marker. A focused backfill can be staged
without running the full FX producer or any production jobs:

```bash
UOA_WEBAPP_DATA_DIR=/tmp/uoa-crypto-review python3 webapps/uoa/uoa_webapp_data_update.py --crypto-only --full-crypto-history
python3 -m unittest scripts.test_uoa_crypto_history
python3 scripts/test_uoa_crypto_browser.py --data-dir /tmp/uoa-crypto-review
```

## Live prices

`../shared/uoa_live_quotes.js` requests only the selected legs. BTC uses the
shared spot feed, metals use Gold API, and supported fiat uses indicative
TradingView FX quotes. Newer quotes overlay the latest published row, or append
one provisional row dated to the quote when publication is behind. Missing
legs retain their published value; accepted quotes survive outages until a
newer publication supersedes them. CUP keeps its informal-market published rate.

LBP explicitly requests `FX_IDC:USDLBP` and inverts it to USD per LBP. On
2026-10-29 the public scanner returned USDLBP = 89,500 but LBPUSD = 0.000007
(implying 142,857 LBP per dollar). Preferring the latter caused a false ~37.4%
LBP depreciation. The published history was near 89,600 LBP/USD;
[Banque du Liban's reference series](https://www.bdl.gov.lb/economicandfinancialdatasub.php?code=9&docId=161&filecode=90)
also reports 89,500. Do not fall back to the inconsistent LBPUSD symbol when
USDLBP is unavailable; retain the accepted quote or published value instead.

## PNG and video exports

A PNG ending at the latest published date captures the latest accepted selected
pair quotes when rendering begins, including a provisional quote-date endpoint.
PNG resolution is 2160 quality in all orientations. An earlier End date remains
historical.

PNG and video share a 1440-quality logical layout. Output resolution changes the
raster density, not the proportions of titles, values, axes, lines, or markers.
Charts render at the target pixel density and text is drawn directly onto the
output canvas; a 2160 PNG is not an enlarged lower-resolution image. Export
font sizes are fixed independently of the browser viewport and device pixel
ratio. Devaluations and redenominations retain the dashboard's five-point stars,
with export-sized fills/outlines that remain legible after video downsampling.
Markers appear only once their event date enters the visible frame.

Video uses the shared daily frame planner and deterministic MP4/WebM encoder.
With holds enabled, the opening one-second hold captures the current final
view once. Historical motion frames use published values. At the final motion
frame, the exporter captures the newest accepted pair quotes again and keeps
that complete projection unchanged throughout the three-second ending hold.
With holds disabled, the final motion frame still captures live quotes. A
single-date video follows the same opening/final snapshot policy. If no newer
usable quotes exist, the published values remain the fallback.

Exports pin the published row generation and defer publication installation;
quote reception can continue while encoding. Earlier and paused export ranges
end at the visible date, and duration estimates use that same range. Export
surfaces have separate date inputs so historical frame labels do not inherit
the interactive End control. Live endpoints keep their actual quote date.

## Validation and remaining adoption

Run from the repository root:

```bash
node scripts/test_uoa_live_quotes.mjs
python3 scripts/test_uoa_live_quotes_browser.py
bash scripts/check_dashboard_contract.sh webapps/uoa
```

The browser regression uses frozen source data and fake market responses. It
checks LBP direction, selected-only requests, retained quotes, provisional live
PNG endpoints in all orientations, actual video encoding with changing quotes,
opening/ending freeze behavior, no-hold exports, and historical exports. It
also checks five-point star geometry, event timing, and matching PNG/video
layout proportions in every orientation across desktop/mobile and DPR changes. It
decodes video with FFmpeg when available. Set `UOA_EXPORT_OUTPUT` to an external
directory to retain PNG/video inspection artifacts; set `CHROME_BIN` if needed.

Remaining standards adoption outside this change: the older exporter still uses
the application font families and best-effort font readiness, rather than fully adopting
the shared bundled headline/body typography contract. Playback, control layout,
and broader chart accessibility have not been migrated in this focused update.
