# Days Since ATH

The dashboard reads the published daily price history and its publication
marker. Live quotes can project the current endpoint through the existing
`../shared/ath_live_price.js` helper; historical observations remain published. Do not
run producers or rewrite live data to test presentation changes.

## Export composition

PNG and video share the supplied Days Since ATH notebook/reference composition,
drawn directly at the output resolution from a fixed 1080-quality logical layout.
Landscape is 1920 × 1080 logical pixels: four large KPIs, two bordered panels,
orange series, a faint alternate price scale, halving guides, cycle labels, and
green current-ATH markers. Price uses block height horizontally; days uses UTC
dates. Portrait and square stack the panels beneath two rows of KPIs. Single
chart exports expand the selected panel. Scales, theme, date range and annotation
toggles remain honored. Compact panels reserve enough space for labels and markers.

The reference intentionally overrides the general export headline/axis treatment:
there is no separate headline, Bitcoin wordmark, grid or axis tick labels; KPI
headings use bundled DejaVu Serif, with bundled DejaVu Sans for numbers and chart
labels. The pre-market display floor is 0.0005, as in the notebook; this does not
change published prices or ATH calculations. Both formats retain the shared
creator/URL/donation footer with the current canonical Lightning QR and address.
The historical reference date reproduces its KPIs, but uses the published end-of-day
block height (940571), rather than the earlier 940548 in the supplied image.

PNG output is always 2160 quality. Video quality changes only pixel density;
viewport size and DPR do not change proportions. Historical frames remain based
on published rows. A latest-date PNG captures its quote after export assets load.
Video captures the newest accepted quote when the final motion frame starts and
freezes that quote and observed high through the ending hold, including single-day
videos. An explicit or paused latest date remains eligible; an earlier visible
playback date stays historical, even when playback originally targeted the latest
date. Selection, annotations, and published rows stay fixed for each export.
The Daily High KPI displays the observed high; drawdown
uses the captured spot quote when available, otherwise the published daily high.

Run `python3 scripts/test_export_scale_browser.py days_since_ath` for encoded
video/PNG proportion comparisons at every resolution and orientation. Add
`--theme light --mobile-video` to compare desktop PNG with narrow-screen DPR-2
video. Existing interaction and live-price regressions are
`scripts/test_days_issuance_scale_browser.py` and
`scripts/test_days_live_price_browser.py`; all use isolated browser fixtures.
The live-price suite also checks decoded 4K PNGs and real video encoding with
quotes arriving during asset loading and the ending hold, plus paused history.

Run `python3 scripts/test_days_export_browser.py` for reference-date KPI assertions
and review PNGs in `/tmp/wsb-days-reference`, covering all orientations, themes,
single-chart scales, genesis, cropped history and hidden annotations. No notebook
execution, production producer or live-data rewrite is required.
