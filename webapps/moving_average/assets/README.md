# Moving Average export reference

Export fonts and the Bitcoin wordmark now live in
[`shared/export_assets/`](../../shared/export_assets/README.md), with their
provenance and licenses. Moving Average uses the
[shared branding helper](../../README.md#export-typography-and-branding) for
PNG and WebM output; keep shared assets out of this dashboard-local directory.

The notebook is
`Projects/animations/200 DMA & 200 WMA/200_dma_200_wma.ipynb`. It uses Matplotlib
at 96 DPI: 16-point ticks/statistics correspond to 21⅓ output pixels and
18-point bold chart titles correspond to 24 output pixels at 1080p. Its large
heading is a separate pre-rendered `misc/title.png` rather than notebook text.
The browser uses bundled DejaVu Sans Bold for its headline under the shared
export standard. It retains the notebook-inspired layout and uses the original
1873 × 394 Bitcoin wordmark. The notebook used a 200 × 43 derivative
(`bitcoin-logo-sm.jpg`) at position (1670, 32) in a 1920 × 1080 frame.

To prevent layout movement between frames, the notebook reserves margins with
invisible text before `tight_layout()` and pastes fixed-size chart images at
fixed positions. The browser renderer uses fixed plot rectangles and text
anchors to preserve those same constraints directly.
