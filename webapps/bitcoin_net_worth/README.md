# Bitcoin Net Worth

The dashboard uses local browser records and optional user exports. Development
checks must use synthetic data and must not read or commit personal holdings.
See the root README for quote, valuation, and persistence contracts.

## Hover tooltips

KPI pie slices use the shared `wsb-tooltip` shell and escaped labeled rows from
`WSBDashboardComponents.renderTooltip()`. History charts keep their canvas
rendering, using `getTooltipTheme()` and a single `drawHistoryTooltip()` painter.
That painter converts the chart's backing-buffer coordinates into CSS pixels,
so the 12px font, padding, swatches, and rounded corners match at different
pixel densities. Numeric values stay neutral; only explicit percentage changes
use positive/negative colors. Narrow charts stack label/value rows as needed.
The two history charts retain their shared hovered snapshot date; hovering either
chart updates both, using each chart's matching saved snapshot when available.

The shared title-help handler also covers controls inside the settings dialog.
Review the Net Worth and Assets & Liabilities charts with both axis modes, the
LTA ratio, all three KPI pies, and dark/light themes at desktop/mobile widths.
Further dashboard-standard adoption is separate: hover history selection still
uses the existing mouse interaction and saved snapshot dates.
