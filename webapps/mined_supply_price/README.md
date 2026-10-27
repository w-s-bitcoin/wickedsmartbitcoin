# Mined Supply & Price

The dashboard uses the published `assets/daily_price.csv` and its matching
`assets/daily_price_metadata.json`. Each UTC day contributes its observed block
height, issued supply, and BTC/USD price. Zero price means no quoted price was
available, not a free Bitcoin. The unfinished latest day is provisional and
follows the hourly source publication. The producer of both files is the
existing hourly daily-price pipeline; this dashboard does not regenerate them.

The latest dashboard and preview use `shared/bitcoin_spot_price.js`. A quote
newer than the published observation overlays its price without changing the
published height or supply. The Price dot is green for a recent quote, gray for
a retained or published value; its accessible description identifies the
source. Updated shows the quote time beside the published block height.
Historical selections and playback remain on published daily prices.

The donut shows the issued share of Bitcoin's 20,999,999.9769 BTC scheduled
maximum. Each blue ring sector represents issuance in a halving era. The
donut retains the reference's first ten fixed halving dividers: completed ones
use the ring outline color and future ones use gray. The moving mined boundary
has no radial outline. The price
area uses the same epoch colors as the donut and a logarithmic vertical scale,
with a white observed-price boundary. No price is interpolated from future
samples. Year ticks follow UTC dates mapped to the associated published block
height; the horizontal price axis is block height, following the notebook.
The range always begins at genesis (January 3, 2009). Zero-price history draws a flat Not Valued
baseline. The positive-price line and area start separately at the first valued
observation, with no connecting stroke from the Not Valued baseline.

The shell uses the same shared date range, calendar, playback button group,
download settings, timezone, Copy Link, and reset components as EOE Growth and
Moving Average. The timeline has one editable End handle. Start is locked; older saved start
dates normalize to genesis for the dashboard, PNG, and video.

Exports use the reference image's header, donut, price area, halving labels, and
shared creator/donation footer. PNG always renders at 2160 quality. Video uses
published daily frames through the selected date, samples the full range into
about 30 seconds at 1x, and includes each halving boundary. The optional holds
add one second at the start and three at the end. The selected date and all
historical video frames stay on one captured data generation. Latest-view PNGs
capture one quote after export assets load; a latest-view video captures one
quote at its final motion frame and holds it through the ending pause.
MP4 is preferred, with WebM when H.264 is unavailable.

Square and portrait exports keep every KPI at the top, with datetime above
Block Height at the upper left. The donut sits above the price chart. Square
halving labels use smaller type to stay below the price line.
All three layouts share the same donut heading placement, fixed halving
dividers, unoutlined mined boundary, and separated Not Valued baseline in PNG
and video. Chart text and line weights scale with the export resolution.

The reference notebook is a visual and calculation reference only. Its old
machine paths, network calls, and file-deletion steps are not dashboard inputs.

Check the dashboard, preview, three export orientations, Block Height header
clearance, isolated live/retained/historical prices, PNG decoding and short
video encoding/decoding in all three layouts,
mobile widths, and standalone expansion with
`python3 scripts/test_mined_supply_price_browser.py` from the repository root.
Add `--artifacts /private/tmp/mined-supply-exports` to save each PNG, video, and
decoded final video frame for visual inspection.

Chart inspection uses `shared/dashboard_chart_tooltip.js` and the shared compact
tooltip style: 12px Space Grotesk, an 8px radius, theme-aware surfaces, bold
values, and bounded placement inside the active plot. Price guides snap to real
observations (including Not Valued), with precise small-price formatting.
Supply sectors show issued/remaining BTC. Tooltips clear on leave, drag, scroll, resize, playback, and export;
they are omitted from previews and exported frames. The browser suites check
values, bounds, styles, and cleanup at desktop/mobile widths in both themes.
