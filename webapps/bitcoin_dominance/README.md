# Bitcoin Dominance

## Tooltip styling

Both chart panels use `WSBDashboardComponents.getPlotlyHoverlabel()` for the
shared opaque surface, border, neutral text, and 12px IBM Plex Mono. Plotly keeps
its native geometry: a unified date and series list on `#dominanceChart`, and a
point tooltip showing price, supply, and market cap on `#snapshotChart`. Native
swatches and pointer geometry are intentional engine exceptions to the shared
HTML tooltip's layout. Control help and About use the shared dashboard styles.

Check both panels in light and dark themes. Hover a history date and a market-cap
bar. When BTC price is enabled, confirm its value appears alongside the selected
dominance series. Existing live-update behavior retains the active tooltip.

This note covers tooltip adoption only; other dashboard standards have not been
re-audited as part of this styling change.
