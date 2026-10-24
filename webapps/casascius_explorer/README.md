# Casascius Explorer

Casascius has a custom application and shell. Its runtime is
`casascius_explorer.js` and `casascius_explorer.css`; do not apply the general
dashboard shell stylesheet to it. Public coin metadata and generated assets
have their own producers and are not UI test fixtures.

## Hover tooltips

`dashboard.html` loads the scoped shared `dashboard_tooltips.css`, shared
components, and IBM Plex Mono without importing general shell layout rules.
Expanded balance and price charts use the shared tooltip shell and escaped
labeled rows. Series colors appear as small swatches; original sale prices
retain star markers and repeated sale counts remain visible.

Open the balance thumbnail (`[data-balance-chart-open]`) or price thumbnail
(`[data-selected-price-chart-open]`) in the right information panel, then hover
`.balance-chart-full-canvas`. Check both themes and BTC/USD units. The shared
native-title help also applies to secondary popup controls.
Further dashboard-standard adoption is separate: chart inspection retains its
existing pointer interaction and this application retains its custom shell.
