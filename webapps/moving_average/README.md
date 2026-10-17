# Moving Average

This dashboard uses the existing published `assets/daily_price.csv` and
`assets/daily_price_metadata.json`, plus the shared browser-side Bitcoin spot
feed. It does not introduce a producer, copied dataset, or scheduler. The same
calculation and data validation module serves the dashboard and homepage preview.

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
reference. Its horizontal span runs from the active date minus its corresponding
selected period through the active date. Subtracting calendar months clamps the
day to the last day of the destination month: May 31 minus three months is
February 28, or February 29 in a leap year. During early playback, empty space
before the first price represents unavailable history; the requested span stays
fixed.

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
history while quotes arrive. The BTCUSD and both moving average KPIs always
display two decimal places.

The homepage preview uses the same current endpoint calculation. PNG exports
capture the displayed price and averages when export starts. A WebM ending at
the current/latest date uses published prices and reference historical averages
for its opening hold and historical motion, then captures the newest quote once
at the start of its final motion frame. That quote and its calculated current
average endpoints stay fixed through the final hold. Historical and paused
selections continue to use published prices and historical calculations.

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
All panels leave 16 pixels above and below the visible data range on both LIN
and LOG scales, including previews and exports. Tiny plots cap that inset at a
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
```

These cover SMA reference parity, EMA seeds and recurrence, exclusion of the
active observation, current endpoint updates for all units, None, calendar month
ends and leap years, no lookahead, complete-window limits, invalid/missing data,
payload mismatch, generation races, and stale publications.
