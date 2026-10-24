# Epoch-Over-Epoch Growth

The dashboard aligns Bitcoin's halving epochs by block count. Its current view
compares live BTC/USD with the historical price nearest the timestamp of the
block exactly 210,000 heights earlier. Historical playback compares each
published daily price with the previous epoch's nearest daily block count.
It shares the site shell, calendar, range/playback controls, timezone chip,
Copy Link, reset/undo, atomic refresh, and deterministic PNG/video export helpers.
The homepage preview uses the same model and renderer without axes or labels.
Date/range buttons, playback, calendar selection, and download settings use
`shared/dashboard_playback.css`, the same stylesheet as Moving Average. Their
dimensions, typography, borders, themes, and interaction states are shared.

## Data and calculations

`assets/daily_price.csv` and `assets/daily_price_metadata.json` remain the shared
historical publication. No new database query or scheduled job is required.
The model validates payload hash, row count, dates, timestamps, prices, heights,
and generation progression. The shared adapters prepare, validate, recheck the
marker, then install a complete candidate. Failed refreshes retain the previous
view. Installation defers during export, slider interaction, and panel resizing.
Hidden previews install complete data and defer painting until visible.

- An observation is the published USD price and corresponding block height for
  a UTC day. The latest row may be the producer's unfinished current day.
  Display timezone changes do not regroup observations.
- Epoch is `floor(block_height / 210000) + 1`. Epoch block count is
  `block_height % 210000 + 1`, consistently from 1 through 210,000, including
  halving boundaries. Genesis is epoch 1, count 1.
- Select the previous epoch's observation with the smallest absolute difference
  in block count. The first chronological observation wins exact ties, including
  repeated block heights. The price is a measured daily sample, not interpolation.
- Growth is `(price / previous_price - 1) * 100`. A measured zero or negative
  growth remains distinct from an unavailable comparison. Zero prices mean
  **Not Valued**, and never become an invented market price or growth percentage.
- Playback includes observations only through its selected day. Previous epochs
  remain visible, including observations earlier than the animation's Start date,
  because those are the comparison basis. Start controls animation duration;
  End and the moving end handle identify the displayed observation.
- Historical playback and earlier video motion frames use published daily prices
  and block heights. Exports ending at the latest date refresh the chain/reference
  pair and capture the newest available quote for their final frame. Historical
  selected or paused End dates remain historical.

### Current comparison and lookup generation

`eoe_growth_live.js` keeps the shared `bitcoin_spot_price.js` feed (2140data.io
WebSocket primary) and subscribes to `bitcoin_chain_tip.js` for mempool.space's
public block WebSocket, with that helper's REST fallback. Each accepted block
immediately requests its exact historical reference; it does not wait for a
Pages deployment or another price tick. `assets/top_kpis.json` supplies the
published block fallback until a usable network tip arrives. No new server,
producer, or historical price source is introduced.
For height H it reads the exact H−210,000 block's timestamp and the nearest
timestamped price from the existing `assets/btcusd_10m_prices.csv`; an earlier
sample wins a tie. It never joins on that CSV's `price_height`. Early history
can have daily samples or gaps, so hover text identifies the actual matched
price timestamp. Zero/unvalued or out-of-coverage references do not invent a
comparison. Block timestamps need not increase with height.

The pure-file `scripts/build_eoe_live_reference.py` reads `assets/block_data_*.csv`
and the price CSV. Each record stores two uint32 UTC-second timestamps and one
float64 price in little-endian order. Height is implicit in the record offset.
Chunks cover at most 4,096 consecutive heights (64 KiB), with SHA-256 hashes in
`webapp_data/reference/manifest.json` and content-hash filenames. Payloads are
written before the atomic manifest replacement; failed generation preserves
the previous complete local manifest. These derived local files are ignored
by Git. No credentials, database access, or production producer execution is
involved.

The existing Pages build regenerates these chunks **before pruning the raw
CSVs**, so every successful deployment, including automated data pushes,
includes references built from that checkout's exact input files. A generation
failure fails the build rather than publishing an incomplete reference set.
The builder's fixture tests run in the portable project checks. For a fresh
local checkout or after updating raw CSVs, generate the preview files with:

```bash
python3 scripts/build_eoe_live_reference.py
```

Daily history loads independently. A network block triggers a lookup immediately;
the adapter also checks the reference manifest every visible minute. It loads
only the required chunk, verifies its hash, then rechecks the current tip and
manifest before installing a complete pair. Network-tip refreshes do not fetch
or wait on `top_kpis.json`. It caches up to three chunks. New quote ticks reuse that pair; canvas repaints are limited to
once per second. Failed or superseded requests retain the last complete pair;
missing initial references leave the published daily view usable. A newer daily
publication supersedes an older quote or older tip. A validated same-height block
replacement or shorter authoritative chain can update the current pair; an
initial lagging network tip cannot displace a newer publication. During a shorter
reorg, the current projection omits published heights beyond the replacement tip
without changing the historical model. Hidden/offline views pause lookup work;
visibility, focus, or reconnection resumes it. Hidden views defer painting.
Playback, paused playback, and earlier ranges do not use the live projection.
The homepage preview follows the same current comparison.

Current and previous-epoch markers match the KPI prices at the exact aligned
block count. The green price dot means a quote arrived within 60 seconds; gray
means retained or published. Updated follows the accepted quote and displays
its paired block height; the Updated tooltip identifies live network, retained
network, or published block provenance separately from quote freshness and shows
the block timestamp. The End date control still identifies the daily playback boundary.

The reference notebook is `Projects/animations/EOE Growth/eoe_growth.ipynb`.
Its nearest-epoch calculation is retained. Its zero-based chart offset and
occasionally zero count KPI are reconciled into the one-based count above.
The supplied March 19, 2026 image is the visual reference; it supersedes the
older notebook's palette limits. That image shows an intraday block/price;
the published daily close for that date differs, so it is not fabricated to
match the image's numerical snapshot.

## Chart and exports

The price axis is fixed logarithmic USD, from the Not Valued baseline through
$10M. A fixed scale preserves epoch comparisons and playback geometry; this
metric does not offer a LIN toggle. The plotting-only unvalued sentinel never
enters calculations. All samples are retained. Hover identifies the actual
sample date, price, and growth for each available epoch, and never describes future
space as an observation. Current values also appear in accessible KPI text.
Tooltip growth percentages follow the growth palette with contrast adjustments
for small text in each theme; unavailable growth stays neutral.

Bands use the supplied image's logarithmic color scale from at most 10% to at
least 100,000,000%. Zero and negative growth clamp to the lower color endpoint
while retaining their signed numerical values. Unavailable comparisons have no
band. Contrast-adjusted KPI text does not change the colorbar or band mapping.
On narrow screens, left epoch labels are omitted to avoid price-axis collisions;
the right labels, KPIs, and hover still identify epochs.

Landscape exports reproduce the reference composition: Bitcoin wordmark at top
left, centered headline, date/height and epoch KPIs, white epoch price paths,
growth bands, logarithmic legend, and the creator/donation footer. Portrait and
square rearrange that composition to fit. Dark is the default export theme;
light is also available. Both formats await bundled fonts and decoded branding.
The footer uses the original apple artwork and current Lightning QR/address,
`wicked@primal.net`. Its URL shrinks to the measured gap between the creator and
donation sections; portrait and square place the URL on a separate row.

PNG always renders at 3840 × 2160 landscape, 2160 × 3840 portrait, or
2160 × 2160 square, regardless of the video quality selection. Video uses the
shared encoder at 30 output frames/second with selectable sampling speed and
quality. The optional opening hold shows the final selected snapshot for one
second before historical motion, followed by a three-second final hold, matching
the established animation controls. Paused exports end at the visible date.
Cancellation, unsupported encoding, and asset failures restore usable controls.

For a latest-date export, PNG captures the current comparison after fonts and
branding are ready. Video refreshes the chain/reference pair and samples the quote
when the final motion frame begins, freezing that complete frame through the
ending hold. The opening hold captures its own snapshot and does not freeze the
ending early. A background tab waits until visible before capturing the current
comparison, so the shared feeds can resume. Failed refreshes retain the last
complete available comparison; without one, the export uses its published daily
snapshot. No live data is added
to an export ending on an earlier selected or paused date.

The video setting **4x speed before first EOE value** is enabled by default,
matching the notebook's faster opening. It samples the initial period without
a finite growth value at four times the selected playback speed, then resumes
the selected speed at the first measured EOE value. Zero and negative growth
are measured values. The first measured frame and selected start/end are
retained; the optional one-second/three-second holds keep their full durations.
The setting is remembered with the other download preferences, and estimates
use the same frame sequence as the video. It does not change PNGs or dashboard
playback, and has no effect on ranges starting after the first EOE value.

Preferences use `eoe_growth_dashboard_state_v1`; export settings use
`eoe_growth_download_settings_v1`. Copied state includes explicit defaults,
range, paused frame, speed, panel height, and timezone. URL state overrides
saved preferences. Reset/undo affects this dashboard's analytical preferences.

Above 1100px wide, the chart automatically fills the remaining viewport height,
leaving the shared outer padding below it. Dragging the resize handle (or using
its arrow keys) switches to a saved manual height; Restore Defaults returns to
automatic sizing. Older saved defaults migrate to automatic sizing while custom
heights remain manual. Narrow layouts keep their existing chart heights.

Video downloads use the shared deterministic exporter: H.264 MP4 when supported
at the selected dimensions, with genuine WebM selected before rendering when
MP4 is unavailable. The filename follows the actual container. Frame timing,
quality, branding, and frozen live snapshots are the same in either format.

## Validation

From the repository root:

```bash
node --test scripts/test_eoe_growth_model.mjs
node --test scripts/test_eoe_growth_live.mjs
python3 scripts/test_dashboard_chain_live_browser.py
python3 scripts/test_eoe_live_reference.py
python3 scripts/test_eoe_growth_live_browser.py
python3 scripts/test_eoe_growth_browser.py
python3 scripts/test_eoe_growth_browser.py --fast-intro-only
python3 scripts/test_dashboard_control_parity.py
bash scripts/check_dashboard_contract.sh webapps/eoe_growth
python3 scripts/test_pages_build.py
bash scripts/build_pages_dist.sh
```

The model suite checks halving boundaries, exact ties, missing/unvalued and
negative/zero growth, historical no-lookahead, generation validation, and an
independent notebook-style calculation over the full published dataset.
The live adapter suite also checks immediate block-driven references while Pages
is unavailable, same-height replacements and shorter reorgs, malformed blocks,
manifest/chunk races, retention, and hidden/resume behavior. The shared-chain
browser regression drives the actual socket helper in the dashboard and preview.
The existing live-export browser suite isolates the published-chain fallback.
The isolated browser suite freezes publication bytes and injects fetch failures
and races without changing live data. It exercises playback, shared state over
conflicting storage, reset/undo, responsive light/dark layouts at 1440/1024/390/320,
4K PNG in every orientation, and actual video decoding. `CHROME_BIN` can select a
Chrome executable; review artifacts are written outside the repository.
The focused `--fast-intro-only` mode checks the new checkbox's persistence,
estimates, and decoded videos across the first measured growth value.

Physical touch devices have not been tested. A selectable chart data table and
richer shared calendar keyboard navigation remain site-wide improvements in
the shared standards; all essential current values are available as text.
