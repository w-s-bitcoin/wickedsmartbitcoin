# DCA Comparison

Published Bitcoin, metal, and market-index history supplies the daily DCA model.
`../shared/comparison_live_price.js` overlays accepted quotes for selected assets
on the latest view. Earlier observations and published files remain unchanged.
Live quotes continue updating valuation and Updated even when the publication
is two or more days behind. In that case, one current valuation endpoint is
added without inventing purchases for the missing history or repricing earlier
purchases. The dashboard, homepage preview, PNG, and final video frame share
this policy. The block height still identifies the published snapshot.

## PNG and video exports

An export ending at the latest available date uses the selected assets' newest
accepted quotes. PNG captures after export assets are ready and defers publication
installation until rendering finishes. Its resolution is always 2160 quality.
Video captures separate snapshots for the opening hold and final motion frame;
each snapshot stays fixed throughout its hold. This also applies to a single-day
video, whose opening hold must not freeze the ending quote early. Historical
motion frames and earlier selected or paused dates use published prices. Exports
and duration estimates end at the visible playback date.

Run `python3 scripts/test_comparison_live_price_browser.py` for isolated live-price
and export regressions. It renders real PNG/video output with changing quotes,
checks asset-readiness timing, single-day ending holds, and historical frames.
The shared encoder and export-scale suites cover codec decoding and proportions.

Remaining standards adoption: this older export composition retains application
fonts and its existing chart axes. Broader typography and axis migration are
outside the live-price export change.
