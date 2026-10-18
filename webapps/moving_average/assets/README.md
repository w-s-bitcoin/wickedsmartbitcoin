# Moving Average export assets

These local assets reproduce the appearance of the original Moving Average
notebook without depending on a third-party font or image server during export.

- `bitcoin-wordmark.jpg`: the 1873 × 394 original Bitcoin wordmark from the
  maintainer’s existing animation assets,
  `Projects/animations/Wicked Smart Bitcoin/sponsor-icons/bitcoin-logo-orig.jpg`.
  The reference notebook uses its 200 × 43 derivative (`bitcoin-logo-sm.jpg`) at
  position (1670, 32) in a 1920 × 1080 frame. The original preserves the exact
  lettering and orange Bitcoin symbol with enough resolution for a 4K export.
- `DejaVuSans.ttf` and `DejaVuSans-Bold.ttf`: unmodified DejaVu Sans fonts
  distributed with Matplotlib. They match the notebook’s default chart and
  statistics typography. Copyright and redistribution terms are preserved in
  `LICENSE_DEJAVU`; these fonts are governed by that license rather than the
  repository’s MIT license.

The notebook is
`Projects/animations/200 DMA & 200 WMA/200_dma_200_wma.ipynb`. It uses Matplotlib
at 96 DPI: 16-point ticks/statistics correspond to 21⅓ output pixels and
18-point bold chart titles correspond to 24 output pixels at 1080p. Its large
heading is a separate pre-rendered `misc/title.png` rather than notebook text.
The browser uses the installed Arial Black face for that heading when available,
with bundled DejaVu Sans Bold as its offline fallback. No proprietary font file
is redistributed.

To prevent layout movement between frames, the notebook reserves margins with
invisible text before `tight_layout()` and pastes fixed-size chart images at
fixed positions. The browser renderer uses fixed plot rectangles and text
anchors to preserve those same constraints directly.
