# Moving Average

This dashboard uses the existing published `assets/daily_price.csv` and
`assets/daily_price_metadata.json`, plus the shared browser-side Bitcoin spot
feed. It does not introduce a producer, copied dataset, or scheduler. The same
calculation and data validation module serves the dashboard and homepage preview.
The homepage grid preview balances the white price lines' apparent thickness
with a heavier stroke in its sparse 200-day panel. The interactive dashboard
applies the same visual balancing to custom windows: the price stroke blends
from 1.3 to 2.2 pixels as daily point spacing increases from one to two pixels.
This follows the visible time span and panel width, stays constant during
LOG/LIN transitions, and preserves every price sample. Moving-average strokes
stay at 2.2 pixels; their cyan and orange colors remain the same in both themes.
The homepage grid preview shows only the chart series, without grid lines,
labels, ticks, or panel titles, and does not reserve space for those decorations.
The full dashboard and exports retain their axes and labels.
Long history ranges use calendar-aligned year ticks spaced by powers of two
(2, 4, 8 years, and so on), adapting to the available width in both the dashboard
and downloads. Shorter ranges retain annual, monthly, weekly, or daily ticks.

## Calculation semantics

The reference is `Projects/animations/200 DMA & 200 WMA/200_dma_200_wma.ipynb`,
particularly cells 2 and 3. Its averages exclude the observation on the plotted
date. This differs from the common convention of including that day's close.
The default lines are a 200-day SMA and a 200-week SMA. Each line can use a simple
moving average (SMA) or exponential moving average (EMA); the second can also be
set to None. Older saved or shared selections without a type remain SMA. Labels
combine period, unit, and type, such as `200D SMA` or `200W EMA`.

Historical SMA points and playback retain the reference convention:

- **N days:** arithmetic mean of the preceding N daily prices. The active
  date's price is excluded.
- **N weeks:** arithmetic mean of the preceding N Sunday prices, each strictly
  earlier than the active date. This is a weekly simple moving average, not an
  average of N × 7 daily prices or a weighted moving average. The reference
  series plots Sundays and its latest endpoint. Playback evaluates that endpoint
  using only Sunday prices already available on the selected historical date.
- **N months:** arithmetic mean of the preceding N calendar month-end prices,
  each strictly earlier than the active date. February therefore closes on the
  28th or 29th as appropriate. This extends the reference's period-close approach
  to calendar months; it never substitutes 30-day periods.

Historical EMA uses the same daily, Sunday, or calendar-month-end observations,
strictly before the active date. Its smoothing factor is `alpha = 2 / (N + 1)`.
The seed is the arithmetic mean of the first N completed observations; every
subsequent completed observation updates it as
`EMA = alpha × close + (1 − alpha) × previous EMA`. The seed is calculated from
the first nonzero published history, independent of the visible chart range.
An EMA therefore retains decreasing influence from observations older than its
N-unit chart window. It is not restarted when the user seeks or changes the
visible range. None produces aligned null values and omits that average.

All dates, Sunday boundaries, and month ends use UTC. For the historical
calculation, a price dated Sunday or month-end enters the corresponding average
on the next day. The current/latest endpoint includes the current price as an
unfinished period, as described below. Both calculations retain the complete
history gate: N prior observations and a complete N-unit time span since the
first nonzero price. Earlier dates return `null`, allowing price and the other
average to continue displaying independently.

Each right-hand chart contains price and the enabled moving averages, as in the
reference. Until the price history covers the selected period, its horizontal
axis stays fixed from **October 6, 2009** through that date plus the period.
Price grows from left to right as playback advances, leaving future dates empty.
For example, the early 200-day window spans October 6, 2009–April 24, 2010,
and the 200-week window spans October 6, 2009–August 6, 2013.
Future axis space has no hover tooltip.

Once the active date reaches the end of that initial window, the chart follows
the ordinary trailing span from active date minus the period through active
date. Subtracting calendar months clamps the day to the destination month's
last day: May 31 minus three months is February 28, or February 29 in a leap
year. Dashboard, homepage preview, PNG, and WebM share these display bounds.
The SMA/EMA calculations and their complete-history gates remain unchanged.

The minimum period is 3. Limits are calculated from the complete latest
publication and remain fixed during playback. The daily limit is the number of
days from the first nonzero price through the latest date, excluding the latest
observation. Weekly limits use complete seven-day spans and available prior
Sunday closes. Monthly limits use calendar subtraction and available prior
month-end closes. A maximum selection must be computable at the latest date.
Period inputs and unit menus follow DCA Comparison's compact amount/cadence
control. Numbers use thousands separators and resize to their content; invalid
edits retain the last valid average and show feedback. Unit menus support mouse,
touch, arrow keys, Home/End, Enter/Space, Escape, and ordinary Tab navigation.

## Live current price and averages

The dashboard and homepage preview use `shared/bitcoin_spot_price.js`. Its primary
source is `wss://2140data.io/`, followed by `https://2140data.io/price`, then the
shared Coinbase socket and public REST fallbacks. The feed pauses hidden tabs
and rejects invalid or stale timed quotes. If a connection fails, the last
accepted price remains visible until a newer quote or published snapshot replaces
it. The BTCUSD status dot is green for a quote received within 60 seconds and
gray for a retained or published price.

Quotes update the current Bitcoin price and the enabled moving average
endpoints. For an N-period SMA, the current/latest endpoint is:

`(current price + sum of the N−1 most recent prior period closes) / N`

The prior closes are daily prices for days, Sunday prices for weeks, or calendar
month-end prices for months. The current price represents the unfinished period.
For example, a current 3-week average uses the current price and the two most
recent prior Sunday closes. An accepted price change of $300 changes that
3-week endpoint by $100. Completed historical points keep the reference formula
using N prior closes, and historical playback never incorporates future quotes.

For EMA, the current endpoint is
`alpha × current price + (1 − alpha) × historical EMA at the active date`.
Every quote starts from that same historical EMA, so successive intraday quotes
do not compound as if each tick were a completed day, week, or month. A $300
price change moves a 3-period EMA endpoint by $150 (`alpha = 0.5`). Once a UTC
day closes, only a published close enters historical calculations; a provisional
quote never rewrites the published history.

The latest view uses the current endpoint formula even when the latest published
price is the fallback, so a feed outage or new publication does not switch the
calculation method. When publication is one day behind, the live view can append
one provisional current UTC-day row. It never fills gaps in older data or
persists provisional prices into the dataset. Complete-window requirements still
apply, and selectable maximum periods remain calculated from the published
history while quotes arrive. The BTCUSD and both moving average KPIs display
cents below $1 (for example, $0.0007 becomes `0.07¢`) and dollars at $1 or above.
Both use two decimal places, with extra precision for values below `0.01¢` so
tiny early prices do not round to zero. Dashboard playback, PNG, and WebM use
the same KPI formatter.

The homepage preview uses the same current endpoint calculation. PNG exports
capture the displayed price and averages when export starts. A WebM ending at
the current/latest date uses published prices and reference historical averages
for its opening hold and historical motion, then captures the newest quote once
at the start of its final motion frame. That quote and its calculated current
average endpoints stay fixed through the final hold. Historical and paused
selections continue to use published prices and historical calculations.

## Image and video exports

Downloads use a dedicated canvas composition modeled on the original notebook
animation: black background in dark mode, a tall logarithmic history panel,
two linear trailing windows, cyan/orange title underlines, the Bitcoin wordmark
in the upper right, and the dashboard URL in the footer. Selected averages,
scales, date range, theme, and orientation remain effective. EMA labels identify
the exponential calculation; choosing None removes the second line and expands
the remaining trailing window. Portrait and square exports adapt the same
composition to their available space.

PNG downloads always use 2160-pixel quality: **3840 × 2160** landscape,
**2160 × 3840** portrait, or **2160 × 2160** square. The quality selector controls
WebM resolution. Both formats wait for bundled DejaVu Sans regular/bold fonts
and the Bitcoin wordmark to load before drawing. The headline uses locally
installed Arial Black when available, with bundled DejaVu Sans Bold as its
fallback; the selected face is resolved before capture begins. The wordmark
already includes its original lettering.

The [shared export standard](../DASHBOARD_STANDARDS.md#png-and-webm-exports)
now adopts these PNG dimensions and branding while requiring bundled DejaVu Sans
Bold for headlines across machines. The current optional Arial Black headline
is a remaining adoption gap: when this export feature is next updated, use the
bundled headline and verify both fonts/branding and decoded output. Keep this
dashboard's own composition and calculation semantics.

The export renderer uses fixed panel rectangles, fixed title/KPI anchors, and
tabular digits, so changing prices, dates, or tick widths cannot move the
surrounding layout. It retains the notebook's 1% left time margin and 2% value
padding in the selected scale's transformed space. All three plots reserve a
fixed gutter on the right for their y-axis labels. Each chart uses `YYYY` when
all its date ticks mark the start of a year; otherwise every tick uses
`MM-YYYY`, including January. Labels angle 30 degrees down to the right.
Calendar-aligned ticks move with their
dates without clamping labels to chart edges; a range within one month gets a
single date label. WebM continues to use
the shared deterministic encoder and the frozen final-price behavior above.

## Publication and failure behavior

Playback controls and range sliders follow Days Since ATH. During playback the
end date, range length, and end handle advance together; the orange track shows
the remaining interval. Dragging the end handle pauses and resumes playback,
while dragging the start handle edits the visible range. Stop restores the
original selected range. Video exports and their estimates end at the visible
date, including when paused. Scale settings, chosen periods, and the playback
target remain available in saved and shared state.

The controls retain the reference dimensions on mobile. At widths of 360px or
less, range presets scroll horizontally so every button remains reachable.
Data installation is deferred during a slider drag or video export and rechecked
after release; ordinary playback can continue through complete data refreshes.

`prepareCandidate()` reads the publication marker, checks the SHA-256 hash of
the exact CSV bytes, verifies row count, first/latest dates, latest timestamp,
and block height, and constructs a detached model. Initial loads reread the
marker before returning. Dashboard and preview refresh controllers supply their
own final marker recheck before committing a candidate.

Leading zero prices are omitted from the chart timeline. Missing, duplicate,
out-of-order dates, nonfinite or negative prices, and zero prices after the
first nonzero price reject the candidate. Missing observations are never
silently converted into shorter or unevenly spaced windows. Failed or regressed
publications leave the previously accepted model untouched.

`calculate()` returns an array aligned with the positive daily price rows. For
weekly/monthly rendering, `isSampleDate()` identifies the reference period-close
points; the active playback endpoint can be appended with its causal value.
Lines connect those sample points as in the reference. Hover values between
weekly/monthly points follow that visible interpolation without a prefix;
the active endpoint and KPI use the historical calculation during playback and
the current endpoint calculation in the latest view.
Interactive and preview panels leave 16 pixels above and below the visible data
range on both LIN and LOG scales. Tiny plots cap that inset at a
quarter of their height; flat data stays centered in a nonzero axis range.
Clicking either half of a LOG/LIN control switches that panel to the other scale.
Each toggle animates that panel natively over 700 ms using the half-cosine
easing and normalized coordinate blend from `Price On This Day/price_on_this_day.ipynb`.
Price and average lines morph with the axis; tick labels and gridlines move with
their values while the linear and logarithmic tick sets crossfade. Shared ticks
remain visible, and crowded labels fade to keep the intermediate axis readable.
The linear `$0` tick fades once in each direction; its opacity does not rise
again when moving logarithmic labels clear its position.
The fixed data margins remain unchanged throughout. Rapid toggles reverse from
the currently drawn position, and each panel can transition independently.
Reduced-motion preferences switch scales immediately. Saved/shared settings and
exports use the selected final scale, never a temporary animation position.
Hovering highlights the same date with a dashed guide in every chart whose
visible span contains that date. Only the chart under the pointer shows a
tooltip, positioned within that chart's visible bounds. Guides use UoA's thin,
muted dashed style. The tooltip sits 10px beside the date guide, centered on the
pointer vertically, and flips left near the right edge without width-change
jitter. The tooltip stays inside the plot, leaving the y-axis labels clear. Guides clear when the
pointer leaves the plot, during dragging, and when playback resumes.
Tooltip typography, padding, date spacing, borders, and theme backgrounds match
UoA; each value row uses its corresponding chart line's color.
Calculation results are cached per model for up to 16 combinations of type,
period, unit, and historical/current calculation. Historical and current arrays
are separate; live projections do not mutate the published rows, sums, or cache.

Run the focused calculation and publication checks from the repository root:

```bash
node --test scripts/test_moving_average_model.mjs
python3 scripts/test_moving_average_browser.py
python3 scripts/test_moving_average_export_browser.py
```

These cover SMA reference parity, EMA seeds and recurrence, exclusion of the
active observation, current endpoint updates for all units, None, calendar month
ends and leap years, no lookahead, complete-window limits, invalid/missing data,
payload mismatch, generation races, and stale publications.
The export regression decodes real PNG/WebM downloads, checks 4K image and
selected video dimensions, verifies stable header/plot geometry across widely
different historical values, and covers light mode, square/portrait layouts,
and EMA/None. It writes review images, short videos, and recorded geometry to a
temporary directory; use `--output-dir /tmp/moving-average-review` to choose it.
The full-history sample holds each of four September 2024 dates for 15 frames
and saves its decoded final frame for comparison with the reference image.
