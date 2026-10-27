# Price Distribution

The orange history and horizontal distribution use the existing published
`assets/daily_price.csv`, validated against `assets/daily_price_metadata.json`.
The hourly daily-price pipeline owns these files. No new producer, notebook
execution, database job, or data regeneration is required.

Each UTC day contributes one observation. The distribution starts at January 3, 2009 and includes the selected
End date; each positive price enters exactly one lower-inclusive, upper-exclusive
power-of-ten band. Zero means Not Valued, and its history segment is disconnected
from positive prices. Counts are calculated from the actual rows, including
early history, rather than the notebook's hard-coded 275 days. The default
thirteen bands span Not Valued through $10M–$100M. An observation outside these
bands extends the domain without consulting future data. Network Age is elapsed
UTC days since January 3, 2009, inclusive, independent of the end-date control.

The reference's log-price history aligns with the distribution's price bands in
landscape. Horizontal positions represent UTC dates. The four historical
halvings use their actual dates and dashed lines up to the observed price.
The reference intentionally omits numerical axes; visible band labels and
bounded hover tooltips identify prices, dates, and counts. Preview cards retain
the line and bars without titles, axes, dividers, or labels.

The latest day's unfinished observation is provisional. The shared BTC/USD feed
updates its price and moves that one observation between bands when needed.
Completed days never change with a quote. A green dot means a recent quote;
gray identifies retained or published values, with accessible source text.
Updated follows the accepted quote, alongside the published block height.
Historical and paused views use published prices. Latest PNGs freeze one quote;
a video's final frame and ending hold share one captured quote.

The shell uses the same shared end-date calendar, timeline, playback,
export settings, timezone, Copy Link, and reset/undo components as the other
dashboards. Its controller and shell stylesheet are shared with Mined Supply
& Price. URL state takes priority over saved preferences. Publication refresh
prepares and validates a complete candidate, rechecks the marker, and commits
without losing the selection or playback. Drag and export defer installation;
a failure retains the last complete generation.

Landscape exports follow the reference: metadata/wordmark at upper left, price
and network-age KPIs across the top, price history on the left, and thirteen
price bands on the right. Square and portrait retain top KPIs and stacked Date /
Block Height, with history above the distribution and smaller halving labels.
Stacked exports fit the history's vertical scale to observed prices, leaving a
small upper inset instead of space for empty distribution bands. The bar chart
reserves only the measured label width and the outer margin on the right.
All layouts use the shared bundled export fonts and creator/donation footer.
PNG is always 2160 quality. Video uses the shared deterministic MP4 encoder with
WebM fallback, selectable resolution, and optional start/end holds.

Validation from the repository root:

```bash
bash scripts/check_all_dashboards.sh
python3 scripts/test_price_distribution_browser.py --artifacts /private/tmp/price-distribution-exports
python3 scripts/test_mined_supply_price_browser.py
python3 scripts/test_pages_build.py
bash scripts/build_pages_dist.sh
```

The focused suite uses an isolated spot-feed fixture and read-only published
history. It checks band boundaries/count totals, historical/live isolation,
shared controls, playback, all three decoded PNG/video layouts, frozen final
quotes, export failure recovery, mobile widths, and standalone expansion.
Physical touch-device testing is not part of the desktop browser checks.

Start is fixed at January 3, 2009 in both charts and exports. The start date is
a disabled display, with no start slider handle or movable range. Older links
and preferences with a later start are normalized to genesis; only End changes.

Chart inspection uses `shared/dashboard_chart_tooltip.js` and the shared compact
tooltip style: 12px Space Grotesk, an 8px radius, theme-aware surfaces, bold
values, and bounded placement inside the active plot. Price guides snap to real
observations (including Not Valued), with precise small-price formatting.
Distribution bars show days and percentage. Tooltips clear on leave, drag, scroll, resize, playback, and export;
they are omitted from previews and exported frames. The browser suites check
values, bounds, styles, and cleanup at desktop/mobile widths in both themes.

Hovering a daily price marks its chronological position within the corresponding
price-range bar with a white line. Hovering a distribution row preserves the
orange history inside that price range and dims the rest along with the other
bars, values, and range labels to 20% opacity, clipping crossing
segments at exact log-price band boundaries. Not Valued remains a separate
segment. The history tooltip lists Block then Price; bar tooltips list Days
and Share. These linked hover effects are absent from previews and exports.
