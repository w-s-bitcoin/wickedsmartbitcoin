# Target & Block Hashes

A block-by-block implementation of `target_and_block_hashes.ipynb`, using the
existing dashboard shell, date picker, playback controls, settings, timezone,
share/reset, tooltip, atomic refresh, PNG and deterministic MP4/WebM components.
The route is `/target_and_block_hashes` (`.html` on a local HTTP server).

## Data and calculations

`scripts/build_target_hashes.py` reads only committed `assets/block_data_*.csv`.
It never imports the notebook, reads `.env`, queries PostgreSQL/RPC, runs a
producer, or changes production scheduling. Run it once before local use:

```bash
python3 scripts/build_target_hashes.py
```

The Pages build runs this same packager before pruning the raw CSVs. Generated
`webapp_data/` is ignored in the source checkout. Each immutable, content-addressed
chunk holds up to 100,000 consecutive records: little-endian uint32 timestamp
and the complete 32-byte display-order hash. The manifest retains every change
in the source target and difficulty, chunk counts/hashes, and the last block's
timestamp. Payloads precede an atomic manifest replacement. Invalid input leaves
the previous manifest usable. The browser verifies SHA-256 and record bounds,
rechecks the manifest, and installs a complete generation through shared refresh.
Existing immutable chunks are cached; an unchanged generation is not reparsed.

Every block is plotted; no sampling hides low hashes or changes the cloud.
The horizontal coordinate is `-log16(hash)` on the reference's fixed -64…-30
range. The vertical coordinate is block height. The target uses the CSV's
notebook-derived target (including its original floating-point rounding), not a
new consensus-target calculation. Target hashrate is `2^256 / target / 600`,
formatted in MH/s through EH/s as in the notebook. Difficulty uses two-place
formatting of the actual source float, matching Python's reference formatting.

The green trail records exact lexicographic minima of all 32 hash bytes through
the selected height; future blocks cannot affect a historical minimum. Point
opacity follows the notebook's target-to-hash gap formula, with the mean
running-minimum gap calculated through the displayed height. This deliberately
avoids the notebook's full-dataset lookahead in earlier frames. Halving diamonds
use the actual hashes at multiples of 210,000. Early frames retain the reference's
minimum 32,256-block plotting span. The notebook's inclusive `.loc[:height+1]`
minimum lookup is corrected to stop at the selected block.

Miner timestamps may reverse. They are preserved rather than sorted or used to
reject a valid newer height. Calendar selection chooses the last block whose
UTC miner date matches the selected day (or the latest earlier date when empty).
The slider, block-count input and share state retain exact heights. Start stays
at genesis because this chart accumulates the complete history.

## Interaction and exports

Search block height beside Target Hashrate, then press Enter or the target
button. This reuses Patoshi's search pill, now styled in shared controls. A ring
marks the exact block and the shared tooltip remains beside it until cleared.
The tooltip hash matches the green marker for the displayed record-low block,
blue for halving blocks, and orange for other blocks. Record-low green takes
precedence when a block qualifies for both markers.
Pointer hover does not trigger inspection. Searching beyond the visible height
advances the view to that block; searching within it leaves the endpoint intact.
Clear or Escape removes the selection. Invalid heights keep the prior selection.
Search survives refresh, share links and reset undo. It is hidden during motion
or exports; PNG/video retain the requested reference composition.

The shared daily-history controller accepts the optional block timeline adapter;
its other consumers keep their existing behavior. Playback and exports advance
144 blocks per frame at 1x, scaling with the speed setting. Deterministic frame
plans preserve endpoints and halving blocks; optional opening/ending holds show
the final selected frame for 1/3 seconds at the shared 30 fps. PNG is always
2160 quality, independent of the video setting. Each export retains one immutable
data generation and uses the shared progress/cancel and encoder pipeline.

Landscape exports reproduce the supplied composition: three hash rows,
leading-zero brackets, statistics and legend inside the plot, white target,
orange points, green record-low trail, blue halving diamonds, and the shared
creator/donation/URL footer. There is intentionally no additional headline or
Bitcoin wordmark, since neither appears in this reference. Hash digits use
bundled DejaVu Sans Mono through the shared branding helper; other export labels
use the existing DejaVu Sans. The approved current footer uses
`wicked@primal.net`. Square/portrait preserve the same chart structure above the
shared compact footer. Video is lossy; it shares the PNG renderer and geometry.

On narrow screens, the chart scrolls horizontally at a minimum 760px width so
33 hash digits remain readable. Controls wrap using the shared styles. Searching
scrolls the selected point into the visible portion; the tooltip stays within
the viewport. The interactive chart reserves 16px below genesis, and its search
dot/ring are drawn without the series clipping rectangle.

Home previews load only the manifest and two verified 640×360 SVGs (about 127 KB
combined in the initial publication), not the 35 MB block chunks or full model.
The packager composites every block into a small density raster and preserves
the complete target boundary, exact record-low trail, and halving markers as
vector geometry. It crops to observed horizontal bounds with 16px side and 12px
top margins, and 3px below the data (6px when the record star is at genesis).
There are no hash labels, gridlines, statistics or branding.
Theme/resize use the decoded images; atomic preview refresh checks hashes and
rechecks the same publication marker before presenting a replacement. These
compact preview assets precede the manifest in the same payload-first build.


## Validation

```bash
python3 -m unittest scripts.test_target_hashes scripts.test_pages_build
bash scripts/check_dashboard_contract.sh webapps/target_and_block_hashes
python3 scripts/test_target_hashes_browser.py --artifacts /tmp/target-hashes-review
python3 scripts/test_price_distribution_browser.py
python3 scripts/test_dashboard_share_routes.py
bash scripts/check_project.sh
bash scripts/build_pages_dist.sh
```

Browser coverage includes the supplied reference at block 940536, exact hash and
statistics, historical record lows, pacing/holds, search/clear/invalid input,
reset undo, exact-height storage/URL precedence, failed refresh and corrupted
payload rejection, actual decoded 4K PNGs and short MP4/WebM clips in all three
orientations, dark/light at 1440/1024/390/320px, previews and standalone expansion.
