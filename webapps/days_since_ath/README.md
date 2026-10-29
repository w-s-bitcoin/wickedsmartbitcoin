# Days Since ATH

The dashboard reads the published daily price history and its publication
marker. Live quotes can project the current endpoint through the existing
`days_live_price.js` helper; historical observations remain published. Do not
run producers or rewrite live data to test presentation changes.

## Export composition

PNG and video share a fixed 720-quality logical composition for each
orientation and selected chart mode. PNG output is always 2160 quality; video
quality changes only the backing pixel density. Axis labels and the “Not
Valued” label use logical panel widths, independently of the output resolution
and screen DPR. Nested chart canvases use their actual rounded backing size
to set the drawing transform, so compositing does not shrink their contents.
The shared footer uses the same logical reservation in both formats.

Run `python3 scripts/test_export_scale_browser.py days_since_ath` for encoded
video/PNG proportion comparisons at every resolution and orientation. Add
`--theme light --mobile-video` to compare desktop PNG with narrow-screen DPR-2
video. Existing interaction and live-price regressions are
`scripts/test_days_issuance_scale_browser.py` and
`scripts/test_days_live_price_browser.py`; all use isolated browser fixtures.

Remaining standards adoption: chart labels still use application font families
with best-effort readiness, while shared footer assets use bundled export
fonts. This sizing change does not migrate the chart typography or controls.
