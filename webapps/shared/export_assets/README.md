# Shared dashboard export assets

[`dashboard_export_branding.js`](../dashboard_export_branding.js) loads these
local assets for PNG and WebM exports. They provide the same fonts and Bitcoin
wordmark across machines without a third-party font or image request at export
time. Each dashboard retains its own layout, sizes, positions, and metric colors.
The helper registers private CSS font family aliases for export rendering; the
font files are unmodified and the interactive shell's typography stays separate.

- `DejaVuSans.ttf` and `DejaVuSans-Bold.ttf`: unmodified DejaVu Sans fonts
  distributed with Matplotlib, originally bundled for the Moving Average
  notebook's chart/statistics typography. Regular (400) is used for labels,
  dates, and KPIs; bold (700) is used for headlines and panel headings.
  Copyright and redistribution terms are preserved in
  [`LICENSE_DEJAVU`](LICENSE_DEJAVU). These fonts are governed by that license
  rather than the repository's MIT license.
- `DejaVuSansMono.ttf`: unmodified DejaVu Sans Mono from
  [Matplotlib v3.10.7](https://github.com/matplotlib/matplotlib/blob/v3.10.7/lib/matplotlib/mpl-data/fonts/ttf/DejaVuSansMono.ttf),
  used for Target & Block Hashes hexadecimal rows via the shared `mono` font
  role. It uses the existing `LICENSE_DEJAVU`; the regular body, headings and
  URL-footer font roles are unchanged.
- `IBMPlexMono-Medium.ttf`: unmodified IBM Plex Mono Medium (500), used by the
  canonical URL footer. It comes from the official IBM Plex repository at
  commit `71f558992315a12ca1f06a2215d57962a1992162`:
  [font source](https://github.com/IBM/plex/blob/71f558992315a12ca1f06a2215d57962a1992162/packages/plex-mono/fonts/complete/ttf/IBMPlexMono-Medium.ttf)
  and [license source](https://github.com/IBM/plex/blob/71f558992315a12ca1f06a2215d57962a1992162/packages/plex-mono/LICENSE.txt).
  Copyright © 2017 IBM Corp.; Reserved Font Name "Plex". Its SIL Open Font
  License 1.1 is preserved in [`LICENSE_IBM_PLEX`](LICENSE_IBM_PLEX) and governs
  the font rather than the repository's MIT license.
- `bitcoin-wordmark.jpg`: the 1873 × 394 original Bitcoin wordmark from the
  maintainer's existing animation assets,
  `Projects/animations/Wicked Smart Bitcoin/sponsor-icons/bitcoin-logo-orig.jpg`.
  It retains the original lettering and orange Bitcoin symbol, with enough
  resolution for 4K output. The shared drawing helper preserves its aspect ratio
  and keeps the original orange coin and white Bitcoin glyph in both themes.
  Only the wordmark lettering/background invert for light exports.
- `wicked-apple.png`: the maintainer's unmodified 100 × 100 creator
  icon from `Projects/animations/Wicked Smart Bitcoin/sponsor-icons/wicked-apple-md.png`.
  Dark exports retain the source pixels. Light exports rematte only the
  outer black background and enclosed gaps between the limbs to white, preserving dark facial
  details. The derived canvas is cached during shared branding preparation. The shared footer
  pairs it with the creator name and `@w_s_bitcoin` handle.
  The Lightning QR is loaded from the existing canonical
  [`assets/qr_lightning.png`](../../../assets/qr_lightning.png),
  with the current `wicked@primal.net` address. It is not copied from the older
  reference image. Light exports replace its decorative black corner matte with
  a clean white border, preserving all QR modules and their quiet zone.
  The donation address stays to the right of the QR. Its visible right edge
  has the same outer margin as the left edge of the vertical CREATOR label
  in every PNG/video layout; measured text bounds avoid unused address padding.
  Landscape footers measure the URL between the two branding sections and
  reduce its font size to fit. Portrait and square omit the URL row for a
  compact creator/donation banner with less empty space below the chart.

The DejaVu fonts, their license, and the wordmark were moved unchanged from
`webapps/moving_average/assets/`. The reference notebook is
`Projects/animations/200 DMA & 200 WMA/200_dma_200_wma.ipynb`; dashboard-specific
composition notes remain in
[Moving Average's reference notes](../../moving_average/assets/README.md).

The Pages build includes this directory, including both font licenses and this
provenance file. Keep those notices with the assets when moving or redistributing
them. Do not create dashboard-specific copies or depend on locally installed
fonts for export output.
