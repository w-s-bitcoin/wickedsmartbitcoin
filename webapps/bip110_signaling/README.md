# BIP-110 Signaling

This dashboard includes finalized BIP-110 data and historical SegWit comparisons.
Tooltip work does not regenerate or change those datasets.

## Tooltip styling

Main chart and chain-block tooltips use the shared `wsb-tooltip--record` surface
and label/value structure. Signaling and non-signaling counts stay neutral;
small swatches identify their series. The version hexadecimal digit containing
the signaling bit remains orange and bold because it identifies the actual
protocol bit, not a numeric gain or loss. Miner icons and missing/loading status
remain part of the block detail display.

The period grid, miner timeline, timeline chain preview, and full chain split
all use `renderTooltipHtml()` and `#periodGridTooltip`, so secondary views follow
the same styling. The period-grid explanation uses the wrapping help variant.
Existing placement, pinned state, mobile activation, and viewport bounds remain
owned by the dashboard.

Verification routes in either theme:

- Hover a bar or block stripe on `#bip110Canvas`, `#bip110NodeCanvas`, or
  `#segwitCanvas` (enable its panel if hidden): `#tooltip`.
- Open `#periodGridBtn`, hover a mined `.period-grid-cell`:
  `#periodGridTooltip`. With the SegWit dataset selected, hover
  `#periodGridLowActivityLegendItem` for wrapping help when it is visible.
- Open `#minerTimelineBtn`, hover `.miner-timeline-block`,
  `.miner-timeline-latest-block`, or `.miner-timeline-chain-split-cube`.
- Open `#chainSplitBtn`, hover `.chain-split-cube`. The embedded main chain
  view uses `.miner-timeline-chain-split-cube` under `#mainChainSplit`.

The leaderboard uses the shared control help where applicable; it has no
separate chart tooltip renderer. Other dashboard standards have not been
re-audited as part of this styling change.
