# Wicked Smart Bitcoin

Live site: https://wickedsmartbitcoin.com  
Repository: https://github.com/w-s-bitcoin/wickedsmartbitcoin

Wicked Smart Bitcoin is a static site that publishes Bitcoin data visualizations as shareable pages.

## What This Repo Contains

- Static frontend files (HTML/CSS/JS)
- Interactive dashboard webapps (embedded via iframes and accessible as clean standalone URLs)
- Visualization metadata manifest
- Data update scripts for each dashboard
- No backend, database, or runtime API dependency for the static site itself

## Current Architecture (High Level)

- `index.html`: home/discovery page (grid, search, favorites, menu, homepage KPIs)
- `view.html`: standalone visualization shell used for local deep-link rendering
- `404.html`: production standalone shell entry (GitHub Pages fallback for clean paths)
- `assets/image_list.json`: source of visualization metadata
- `assets/top_kpis.json`: homepage KPI data (block height, epoch, subsidy, circulating supply, target hashrate, difficulty)
- `webapps/`: self-contained interactive dashboards, each with their own data, app JS, and update scripts

Each dashboard has a dedicated root-level HTML entry point (e.g. `node_count.html`, `bitcoin_dominance.html`) that bootstraps the iframe shell directly, enabling clean production URLs like `/node_count` without routing through the home page modal.

## Dashboards

### Node Count (`/node_count`)
Plotly-based dashboard tracking Bitcoin full node count over time and current software version distribution.
- History chart with adjustable range (30d / 90d / 180d / 1y / All) and rolling average smoothing
- Software versions panel with a bar chart and sortable table (configurable top-N versions)
- KPI chips: Total, Non-listening, Listening, Knots, Core v30, BIP-110 node counts
- Click/double-click interactive legend for toggling and isolating history series
- Draggable panel resizer (wide layout) and per-panel resize handles (stacked layout)
- Swap panel order button; all layout state persisted in localStorage
- Copy Link and Restore Defaults buttons in the topbar

### Bitcoin Dominance (`/bitcoin_dominance`)
Plotly-based dashboard showing cryptocurrency dominance history and a top-10 market-cap snapshot.
- Dominance history chart with range (30d / 90d / 180d / 1y / All) and smoothing (None / 7d / 30d) controls
- Top-10 market-cap snapshot panel with ranked bar chart
- Toggles: Include stablecoins, Stacked dominance, Show BTC price, panel visibility per panel
- Two-panel resizable layout with swap support

### DCA Cost Basis (`/dca_cost_basis`)
Interactive DCA (dollar-cost averaging) dashboard comparing historical Bitcoin price against cost basis.
- Cadence selector (Daily / Weekly / Monthly DCA), Range (1Y / 2Y / 4Y / 8Y / All), Scale (Linear / Log)
- Halvings overlay toggle
- Plotly chart with cost basis and current price overlay
- KPI chips: Block Height, Price, In Profit %, At a Loss %

### Bitcoin Net Worth (`/bitcoin_net_worth`)
Interactive dashboard for tracking personal net worth in Bitcoin terms.
- Demo and Live modes with local persistence for live entries
- Snapshot history with editable assets and liabilities
- Net worth, assets, and liabilities charts with filtering and date-range controls
- Optional live-data encryption lock/unlock flow
- Export/import support for local CSV or encrypted data files

### UoA BTC/USD (`/uoa`)
Dual-chart unit-of-account dashboard for monitoring Bitcoin pricing in both directions.
- Left panel: USDBTC (sats per $1) on a log-scale historical line chart
- Right panel: BTCUSD ($ per 1 BTC) on a log-scale historical line chart
- Prominent current conversion readouts with synchronized as-of date

### BIP-110 Signaling (`/bip110_signaling`)
Dual-canvas dashboard tracking SegWit and BIP-110 miner signaling over time.
- Two independently resizable chart panels (SegWit signaling + BIP-110 signaling)
- Fill-to-viewport toggle per panel
- Swap panel order support; panel heights persisted in localStorage

### Quantum Exposure (`/quantum_exposure`)
Research dashboard analyzing Bitcoin UTXO quantum vulnerability across all script types.
- Identifies exposed UTXOs where public keys are visible on-chain (P2PK, P2PKH, P2SH, P2WPKH, P2WSH, P2TR, bare multisig)
- KPI panel: total supply, exposed supply (BTC + % of total), exposed public key count, exposed UTXO count, migration effort estimate
- Supply breakdown bar (Never Spent / Inactive / Active / Non-Exposed / Unmined)
- Script type bars showing exposed balance per script type, broken down by spend activity
- Historical stacked area chart across block-height snapshots (50,000-block intervals published; 1,000-block intervals archived)
- Top exposures list: scrollable per-address table sorted by exposed balance, with identity labels, detail tags, script types, and UTXO counts
- Snapshot selector: navigate any available block height; full filter + snapshot state serialized into URL fragment
- Filters: balance floor, script type, spend activity tier, inactive threshold, detail tag, identity group/tag (full mode)
- Light/dark theme toggle with system preference detection
- Ships as a standalone offline-capable bundle for local use with a full PostgreSQL pipeline backend (separate repo, not included here)

## Shared Dashboard Foundation

All dashboards share a common visual language and infrastructure in `webapps/shared/`:
- `shared/dashboard_shared.css`: topbar, chip, toggle, control, panel shell, loader, and resizer styles
- `shared/dashboard_embed_modal.js`: embedded-in-modal detection and `--modal-controls-clearance` CSS variable management
- Fonts: `Space Grotesk` for UI/headings, `IBM Plex Mono` for dense metadata, chips, and chart labels
- Design tokens: black backgrounds, `rgba(255,255,255,0.14)` borders, `14px` panel radius, dashboard-specific accent color

## Key User Features

- Fast grid/list browsing on home page with search and favorites
- Standalone deep-link visualization pages with clean URLs
- Interactive dashboards with draggable panel resizers, range/smoothing controls, and swappable panel order
- All layout preferences and control state persisted in localStorage
- Shareable dashboard links (state serialized into URL)
- Light and dark theme support across dashboards
- Keyboard and touch-friendly interactions throughout
- Homepage KPI bar showing live Bitcoin network stats (block height, epoch progress, subsidy, circulating supply, target hashrate, difficulty)

## Local Development

```bash
git clone https://github.com/w-s-bitcoin/wickedsmartbitcoin
cd wickedsmartbitcoin
python3 -m http.server 8080
```

Open:

- Home: `http://localhost:8080`
- Standalone deep link: `http://localhost:8080/view.html#<visualization_slug>`
- Dashboard direct: `http://localhost:8080/node_count.html`


## Repository Layout

```text
.
├── index.html
├── view.html
├── 404.html
├── node_count.html
├── bitcoin_dominance.html
├── bip110_signaling.html
├── dca_cost_basis.html
├── bitcoin_net_worth.html
├── uoa.html
├── quantum_exposure.html
├── assets/
├── js/
├── webapps/
│   ├── shared/
│   ├── node_count/
│   ├── bitcoin_dominance/
│   ├── dca_cost_basis/
│   ├── bitcoin_net_worth/
│   ├── uoa/
│   ├── bip110_signaling/
│   └── quantum_exposure/
```

For JavaScript internals and editing guidance, see `js/js_README.md`.  
For dashboard layout conventions and shared patterns, see `webapps/README.md`.

## Donation

Lightning address: `wicked@getalby.com`

![Lightning Donation QR](assets/lightning_donation_qr.png)

## License

© 2025 Wicked Smart Bitcoin. Reuse of charts requires attribution.
