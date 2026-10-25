# DCA Cost Basis

The dashboard models equal-dollar recurring purchases (daily, Fridays for weekly,
and the first of each month for monthly). The orange curve is invested dollars
divided by accumulated BTC for each possible starting date. The price history's
red/green segments indicate whether that purchase window's cost basis is above
or below the current valuation price. Published rows remain the historical source;
the shared spot feed adjusts only the unfinished current purchase.

## Downloads

The image button beside the animation button exports the visible date as PNG at
2160 quality: 3840×2160 landscape, 2160×3840 portrait, or 2160×2160 square. Video
quality does not reduce PNG resolution. Both formats use the same canvas renderer
in `dca_cost_basis_export.js`, with export scale, theme, and orientation from the
existing settings menu. The selected cadence and halving visibility are retained.

The landscape composition follows `dca_cost_basis.ipynb` and the supplied March
13, 2026 reference: black background, bundled DejaVu typography, Bitcoin wordmark,
white/orange headline, right-side prices, duration axis, halving labels/callouts,
and the notebook's orange/green/red series colors. The duration axis deliberately
uses elapsed purchase-window lengths, not calendar dates. Square and portrait
layouts omit the website URL and tighten the chart's bottom margin above the
compact creator/donation banner. Light exports use white backgrounds
around the apple and QR while preserving the Bitcoin coin's original orange.
The shared footer supplies the current
`assets/qr_lightning.png` and `wicked@primal.net` donation address, as in EOE Growth.

Exports capture cadence, date range, halving visibility, timezone, and the
installed data generation. PNG captures the visible quote once; paused frames
stay historical. Video and its estimate end at the visible date. Historical
frames use published data; a video ending at the latest published day captures
one current quote when its final motion frame begins and retains its price,
cost basis, timestamp, and published block height through the ending hold.
The shared encoder chooses H.264 MP4 or a genuine WebM capability fallback.
Asset or encoding failures restore the controls and report an error; PNG does
not require video encoding support.

## Verification

From the repository root:

```bash
node --test scripts/test_dca_export.mjs
node scripts/test_dca_live_price.mjs
bash scripts/check_dashboard_contract.sh webapps/dca_cost_basis
python3 scripts/test_export_footer_browser.py dca_cost_basis
python3 scripts/test_dca_live_price_browser.py
python3 scripts/test_dca_scale_browser.py
python3 scripts/test_pages_build.py
```

Set `CHROME_BIN` if Chrome is not installed at its usual macOS location. Browser
export checks use isolated fixtures and decode real video frames. Review PNG and
video outputs in all three orientations and both themes, including short ranges,
log scale, and a paused historical date. Never run the data producer to validate
these presentation changes.

## Remaining standards adoption

The interactive chart keeps its existing SVG composition (legend and a second
starting-date axis); the reference composition applies to downloads. The legacy
shell retains local playback CSS overrides and existing control IDs. Full shell
migration and richer accessible chart-data views remain separate work. Verify
any future migration against saved settings, share links, keyboard playback,
mobile controls, and both standalone and embedded routes.
