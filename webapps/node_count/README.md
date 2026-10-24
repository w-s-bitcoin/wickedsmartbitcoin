# Bitcoin Node Count

## Tooltip styling

History and software charts use `WSBDashboardComponents.getPlotlyHoverlabel()`
for the shared opaque surface, border, neutral text, and 12px IBM Plex Mono.
Plotly retains its native unified layout and series swatches, including software
bars split into non-BIP-110 and BIP-110 counts. This is an intentional engine
exception to the shared HTML tooltip's rounded box and label/value columns.
Control help and the About popover use the shared dashboard styles.

Check both `#historyChart` and `#softwareChart` in light and dark themes. Hover
a history date, then a software bar. The software tooltip is a unified rectangle
with its category title; it is not a separate pointed-tooltip design.

This note covers tooltip adoption only; other dashboard standards have not been
re-audited as part of this styling change.
