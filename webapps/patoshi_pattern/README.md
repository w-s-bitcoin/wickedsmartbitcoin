# Patoshi Pattern

## Tooltip styling

Block and difficulty-epoch details use `WSBDashboardComponents.renderTooltip()`
and the shared `wsb-tooltip--record` surface: an opaque background, neutral
values, a record title, and aligned labels/values. Miner identity uses a small
series swatch, including confidence-mode colors. Signed difficulty adjustments
retain positive/negative semantic color. The optional confidence value stays
neutral. About and control help use shared dashboard styles.

Hover a block marker on `#patoshiChart` to inspect `#chartTooltip`; hover a
difficulty-period marker for the epoch variant. Repeat in light/dark themes
and with confidence coloring enabled. Chart placement remains clamped to the
viewport. The spent-rewards side panel and settings dialogs do not implement
a separate data-tooltip renderer.

This note covers tooltip adoption only; other dashboard standards have not been
re-audited as part of this styling change.
