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

The Mined Supply KPI uses the same number of decimal places as the selected
block's subsidy, retaining trailing zeros throughout each epoch. For example,
a 3.125 BTC subsidy displays whole supply values as `20,000,000.000 BTC`;
6.25 BTC uses two decimal places, 12.5 BTC uses one, and 25/50 BTC use none.
The dashboard, mined-supply tooltips, and all PNG/video layouts share this format.

The homepage preview shows the donut and price area without text labels,
including the donut's percentage and BTC amount. Dashboard and export labels
remain visible.

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
published daily frames through the selected date: one frame per day at 1x,
encoded at 30 fps, with no fixed-duration cap. At 0.5x each day repeats twice;
2x/4x sample every second/fourth day while retaining halving boundaries, the last
Not Valued and first priced days, and the selected endpoint. The shared daily
frame planner also drives duration estimates.
This is daily history even though the price chart uses a block-height axis. The optional holds
show the final selected date for one second at the start and three at the end.
Latest-view exports check for a newer complete publication after export assets
load, refresh the live quote, then freeze one snapshot before rendering. The
opening hold, final motion frame, and ending hold reuse that same price,
timestamp, block height, and mined supply. Earlier video frames use published
history from that captured generation. Failed publication checks retain the
last complete history; unavailable quotes retain the last accepted quote unless
the publication is newer. Historical selections remain historical. PNGs use
the same preparation and snapshot policy.
MP4 is preferred, with WebM when H.264 is unavailable.

On the dashboard and in every PNG and video orientation, the Price KPI uses
cents (`¢`) for positive prices below $0.10, preserving small historical values (for example, $0.0007
becomes `0.07¢`). At $0.10 and above it uses dollars with two decimal places.
This dashboard-specific threshold intentionally differs from the shared $1 default;
unpriced history remains `Not valued`.

During the opening Not Valued interval, exported frames reserve the block-height
span through the actual last unpriced day, matching Price Distribution's growing
opening line. The baseline advances from genesis to the right edge as blocks
are mined; it reaches that edge on the final unpriced day. Later frames expand
the axis through their current block as before. The future boundary height sets
layout only: prices, supply, and KPIs use observations through the current frame.
Exports ending within the opening interval retain the same partial reveal.

Landscape PNG and video share one reference layout, scaled from 1920 × 1080
coordinates. The timestamp is above Block Height at the upper left; Epoch,
Block Subsidy, Mined Supply, and Price occupy fixed header columns. Regular
bundled DejaVu Sans matches the reference's KPI and annotation typography.
The donut is centered at (365, 613), with a 331-pixel outer radius and a
115-pixel inner radius at that reference size. Its two-line heading and smaller
center values retain their positions during playback. Year labels rotate 45°,
and the vertical halving labels have clearance from their divider lines.
The shared footer retains the site's current creator and donation details.

Square and portrait exports keep every KPI at the top, with datetime above
Block Height at the upper left. All three orientations share the landscape
reference's regular DejaVu Sans KPI sizes, muted label colors, and ungrouped
block height. The donut sits above the price chart in portrait and square;
its heading uses the reference typography and its center values scale in
proportion to its radius. Year labels rotate 45° with room above the footer.
Square halving labels use smaller type to stay below the price line, with the
same proportional clearance from the divider as the other orientations.
Each orientation scales one fixed composition for image and video output.
Each layout shares its donut heading placement between PNG and video, with
fixed halving dividers, an unoutlined mined boundary, and a separated Not Valued
baseline. Chart text and line weights scale with the export resolution.

The reference notebook is a visual and calculation reference only. Its old
machine paths, network calls, and file-deletion steps are not dashboard inputs.

Check the dashboard, preview, three export orientations, Block Height header
clearance, isolated live/retained/historical prices, PNG decoding and short
video encoding/decoding in all three layouts,
mobile widths, and standalone expansion with
`python3 scripts/test_mined_supply_price_browser.py` from the repository root.
Add `--artifacts /private/tmp/mined-supply-exports` to save each PNG, video, and
decoded final video frame for visual inspection.
The suite also renders an isolated March 13, 2026 reference snapshot in all
three orientations and both themes. It checks shared KPI fonts, header and
footer clearance, circle geometry, and matching normalized label positions
at PNG and video resolutions. With `--artifacts`, reference images are saved
as `<orientation>-reference-<theme>.png`; published data is never changed.

Chart inspection uses `shared/dashboard_chart_tooltip.js` and the shared compact
tooltip style: 12px Space Grotesk, an 8px radius, theme-aware surfaces, bold
values, and bounded placement inside the active plot. Price guides snap to real
observations (including Not Valued), with precise small-price formatting.
Supply sectors show issued/remaining BTC. Tooltips clear on leave, drag, scroll, resize, playback, and export;
they are omitted from previews and exported frames. The browser suites check
values, bounds, styles, and cleanup at desktop/mobile widths in both themes.
