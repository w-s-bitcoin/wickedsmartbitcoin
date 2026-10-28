# JS Architecture Guide (Wicked Smart Bitcoin)

This project uses ordered plain-JS files with shared globals (no bundler/import/export).
Load order matters.

Read [`../AGENTS.md`](../AGENTS.md) for contributor safeguards and [`../README.md`](../README.md) for setup and checks. Dashboard-specific code and conventions live in [`../webapps/README.md`](../webapps/README.md).

## Current Routing Model

- `index.html`: home grid/discovery experience
- `view.html`: standalone visualization shell for local deep links
- `404.html`: production standalone shell (GitHub Pages fallback for clean routes)
- Root `/<slug>.html` files: dedicated standalone modal shells that load a dashboard iframe through its local controller

Current dashboard slugs: `bip110_signaling`, `bitcoin_dominance`, `bitcoin_net_worth`, `casascius_explorer`, `days_since_ath`, `dca_comparison`, `dca_cost_basis`, `eoe_growth`, `issuance_rate`, `mined_supply_price`, `price_distribution`, `moving_average`, `node_count`, `patoshi_pattern`, `quantum_exposure`, and `uoa`.

### URL behavior

- Production deep links: `/<slug>` (for example `/node_count`)
- Local dedicated shell: `/<slug>.html`
- Local generic shell: `/view.html#<slug>`
- Embedded dashboard: `/webapps/<slug>/dashboard.html`
- Home page remains `/`

Use an HTTP server for local work. Python's static server does not reproduce GitHub Pages' clean-route fallback behavior. Quantum Exposure also redirects direct top-level dashboard opens on `localhost` through the generic shell; `127.0.0.1` can be used to inspect its dashboard document directly.

## Script Load Order

The homepage loads the following deferred classic scripts in this order:

1. `00_constants.js`
2. `01_dom_elements.js`
3. `02_global_state.js`
4. `03_lazy_image_loading.js`
5. `04_persistence_cookies_localstorage.js`
6. `05_core_helpers_url_image_src_geometry.js`
7. `06_grid_layout_filter_render.js`
8. `07_modal_open_close_swipes.js`
9. `08_buy_me_button_thanks_overlay.js`
10. `09_bootstrap_fetch_init_global_exports.js`
11. `10_event_bindings_global_modal_menu.js`
12. `11_dashboard_timezone_preferences.js`
13. `../webapps/shared/bitcoin_chain_tip.js`
14. `12_homepage_kpis.js`

`view.html` and `404.html` load `00` through `10`; timezone preferences and homepage KPIs are not part of those documents' script lists. Dashboard iframe documents load their own shared helpers and app code. Browser globals are per document, so an iframe must load any shared helper it uses.

Dashboard-local standalone files live alongside each dashboard. Most use `webapps/*/standalone_bootstrap.js`; Quantum Exposure uses `webapps/quantum_exposure/standalone_app.js`. Preserve the existing load order and shared names unless updating every caller in the same change.

## Visualization navigation

Most visualization-family swaps follow this flow:

1. Compute the target filename from control state
2. Update the displayed modal content (image or embed)
3. Update URL to the canonical route
4. Rekey/update current card metadata if needed
5. Update current grid thumb when relevant
6. Keep favorites and controls synchronized

## Core State Contracts

- `imageList`: normalized display cards after bootstrap rewrites
- `visibleImages`: filtered subset (search/favorites/archive visibility)
- `currentIndex`: active modal index within `visibleImages`
- `cardByFilename`: DOM map for card updates/rekey operations

`assets/image_list.json` is the discovery manifest. Set `"archived": true` on an entry to show the archive badge on its card. Runtime bootstrap normalizes its entries; `DASHBOARD_CARD_PREVIEW_SPECS` in `06_grid_layout_filter_render.js` maps dashboard filenames to preview iframe URLs. Route maps also exist in `05_core_helpers_url_image_src_geometry.js` and the standalone controllers. A new dashboard needs all three integrations plus its root shell.

The circular archive button beside the starred filter includes or hides archived
dashboards, alongside the search and favorites filters. Archives are shown by
default; `showArchivedDashboards` in localStorage remembers the choice. Hidden
archives are excluded from homepage and standalone previous/next navigation,
including saved navigation snapshots. Their direct URLs remain available.

## File Responsibilities

### Platform/core

- `00_constants.js`: constants, prefixes, option defaults
- `01_dom_elements.js`: shared DOM references
- `02_global_state.js`: mutable runtime state
- `03_lazy_image_loading.js`: thumbnail lazy loading and defer/resume behavior
- `04_persistence_cookies_localstorage.js`: storage-backed preferences
- `05_core_helpers_url_image_src_geometry.js`: URL helpers, image src helpers, geometry/pan/zoom utilities
- `06_grid_layout_filter_render.js`: grid/list render, filtering, favorites UI on cards
- `07_modal_open_close_swipes.js`: modal open/close lifecycle, controls visibility, swipe/gesture behavior

### Overlays/bootstrap/events

- `08_buy_me_button_thanks_overlay.js`: donate overlay and method UI
- `09_bootstrap_fetch_init_global_exports.js`: image manifest fetch, representative card rewrites, deep-link resolution, init sequence
- `10_event_bindings_global_modal_menu.js`: event wiring for keyboard/mouse/touch/menu/controls
- `11_dashboard_timezone_preferences.js`: shared dashboard timezone preference handling
- `12_homepage_kpis.js`: live network snapshot with published fallback, elapsed block timer, supply/halving/difficulty progress, and separate local clock. Failed or invalid updates retain the last complete snapshot and its actual block timestamp.

The landing page uses `assets/homepage.css`, scoped to `.homepage`, after the shared `assets/styles.css`. Its compact network snapshot shows the latest received block, issued supply, blocks until the next halving, and blocks until the next difficulty adjustment. The block timestamp and progress percentages sit directly beneath the bars. Timestamps and the separate footer clock follow the selected time zone. Dashboards have separate publication schedules.

The difficulty card compares blocks mined in the current 2,016-block epoch with
the 10-minute target pace at the latest block timestamp. Green marks the number
of blocks ahead of schedule; red marks the gap when behind. Hovering or focusing
the bar reveals the block difference. The heading shows
the projected next adjustment with an up/down arrow. The onchain top-KPI payload
publishes `difficulty_epoch_start_timestamp` for exact comparisons. Older
payloads infer that start from their rounded projection until replaced; a cold
live tip without a same-epoch anchor leaves the comparison unavailable.

`webapps/shared/bitcoin_chain_tip.js` subscribes to the public mempool.space
block WebSocket. Its initial block list catches up on arrival; new block events
update all four cards together without waiting for Pages deployment. Heartbeats
check the connection independently of block arrival, so a long block interval
does not falsely mark the feed stale. Reconnects use bounded backoff, and the
public blocks REST endpoint provides a fallback when the socket is unavailable.
Hidden/offline pages pause live work and catch up when resumed. Normal tab
resumption keeps the complete snapshot visible without an outage warning while
the socket reconnects. An actual socket failure, connection timeout, or browser
offline event shows the retained-data warning until the feed confirms recovery.

`assets/top_kpis.json` still refreshes every minute as the fallback and actual
issuance anchor. A delayed publication cannot rewind a newer live tip. Supply
adds the scheduled subsidy difference in integer satoshis, across any halving
boundaries, to the published actual total. The caption and tooltip label this
estimate until a publication matches the live height and timestamp. This is an
estimate because miners can claim less than the scheduled subsidy; a reorg
through the anchor also requires a matching publication to reconcile actual
issuance. With only a live block available, block/countdown cards work while
supply waits for its published anchor. Disconnects retain the last received
block and show that the live connection is unavailable. A validated replacement
block can change the timestamp at the same height or move the tip backward;
in-flight REST responses cannot overwrite a newer socket event.

The block card's cube icon opens the displayed block on mempool.space in a new
tab. Its link follows the displayed height through live updates, publications,
and reorganizations, retaining the last displayed block during feed failures.
It becomes keyboard-accessible when the first block loads.

The block card's elapsed counter updates every second while visible, using the
displayed block's miner timestamp rather than fetch or page-load time. Its bar
fills at 10 minutes, then expands its scale with the elapsed time. Tick marks
remain at every 10-minute interval; compact labels stay to the right of the
block height and thin out on narrow cards to avoid overlap. The counter and bar
use separate colors: the bar's bands are bright green for 0–10 minutes, dark green
for 10–20, orange for 20–30, dark orange for 30–40, and red beyond 40 minutes.
The counter stays bright green until 20 minutes, orange until 40, then red. Its
orange uses the same `--brand` color as the other bars in both themes. This
measures elapsed time, not an estimate of the next block.
Timestamps ahead of the browser clock show a negative counter and a gray bar
extending left from zero, occupying at most 20% of the meter width. The gray
bar and its reserved space shrink together, moving zero left as the countdown
falls. At zero that space disappears; green elapsed time then grows right from
the left edge with the full meter width available. The right-hand tick marks and labels
always describe elapsed time. The separate left-hand countdown scale is held
at the larger of ten minutes or the initial lead so the gray bar keeps shrinking
even for longer offsets. Moving the local clock farther back expands that
countdown scale. A new timestamp resets it. A new received block resets the counter;
failed refreshes preserve the prior timestamp and let its counter continue.
Waking the page catches up immediately without adding per-second data fetches.

### Dashboard-local standalone controllers

- `webapps/<slug>/standalone_bootstrap.js`: dashboard-specific iframe shell navigation, favorites, state links, and overlays
- `webapps/quantum_exposure/standalone_app.js`: Quantum Exposure's equivalent controller

Each controller maintains a local route map. Before adding or changing a slug, locate current consumers from the repository root:

```bash
rg -n 'localStandaloneBySlug|DASHBOARD_CARD_PREVIEW_SPECS' js webapps --glob '*.js'
```

## Data refresh and iframe lifecycle

The homepage, preview frames, and modal dashboards have separate lifecycles. `06_grid_layout_filter_render.js` manages preview iframe creation, visibility, and sizing. `09_bootstrap_fetch_init_global_exports.js` coordinates bootstrap and wake behavior. A normal data refresh must not reload a preview frame or navigate an open modal.

The first Pages deployment after midnight UTC refreshes dark/light card images
from the actual preview pages and published data in its completed `dist/`
artifact. Later deployments reuse that UTC day's images from
`.cache/card-fallbacks`; the workflow's cache key and the generator's manifest
date both prevent reuse from an earlier day. Local builds use the same daily
cache, configurable with `WSB_CARD_FALLBACK_CACHE_DIR`.
Data and source changes keep that day's captured images; newly added cards use
their committed fallback until the next UTC day's capture.

On a fresh capture, the script reads `DASHBOARD_CARD_PREVIEW_SPECS`, waits for a
validated, painted preview, and blocks external market feeds. Every build
installs the day's content-hashed image URLs into `DASHBOARD_CARD_FALLBACKS` and
versions the homepage script containing that map. Theme changes select the
corresponding image without reloading frames. The committed
`assets/card_fallbacks/` images remain emergency/source-checkout fallbacks
(`slug.png` for dark and `slug.light.png` for light);
builds never rewrite those source files.

The card keeps its saved image underneath the preview until the live chart is
available, then fades the opaque preview in over 200 ms. Reduced motion makes
the switch immediate. Failed cold starts retain the saved image and can recover
in place. Saved images can lag subsequent publications and live quotes during
the day; the live preview's existing data refresh and quote feeds stay current.

Each card title includes a question-mark button that reveals its catalog
description over the chart on hover or keyboard focus. Clicking/tapping pins or
dismisses it; Escape, focus leaving the button, and outside taps dismiss it too.
The overlay stays inside its chart and supports scrolling for longer text.
Title updates must preserve the button by updating `card.titleText`.

Dashboard refresh uses `webapps/shared/webapp_data_auto_refresh.js`. Adapters prepare and validate a detached generation, the controller rechecks publication markers, and only then does the adapter install it. Existing data and user controls stay intact if fetching or validation fails. Hidden dashboards can install complete data and defer presentation until visible.

Live previews use `webapps/shared/preview_shared.js` and its `createDataRefresher()` adapter (`prepare`, `commit`, `present`). Static previews use `initStaticPreview()`. Resize and theme events render cached data; they do not initiate payload fetches. Marker/payload semantics are documented in the webapps guide and tested by the publication and browser regression scripts under `scripts/`.

Theme state uses `quantum-research-dashboard-theme` in localStorage and the `quantum-dashboard-theme` message; new sessions default to dark. Keep existing storage keys and shared message formats compatible so homepage, standalone shells, and embedded dashboards agree.

## Where To Edit (Cheat Sheet)

- Routing/deep-link behavior: `05`, `09`, `10`, and each dashboard-local standalone controller (`webapps/*/standalone_bootstrap.js`, plus `webapps/quantum_exposure/standalone_app.js`)
- Grid rendering/filter/favorites card UI: `06`
- Preview refresh lifecycle: `06`, `09`, `webapps/shared/preview_shared.js`, and the target `preview_app.js`
- Modal visibility/controls/swipes: `07`
- Donate overlay behavior: `08` (+ route sync touchpoints in `09`/`10`)
- Dashboard refresh lifecycle: `webapps/shared/webapp_data_auto_refresh.js` and the target dashboard adapter
- Shared dashboard controls/charting/export: `webapps/shared/dashboard_components.js`, `dashboard_charting.js`, and `dashboard_export.js`

## Notes About Removed Features

- Card-level "N visualizations" count labels were removed from home cards.
- Any new feature work should not reintroduce count-label assumptions in grid rendering.

## Quick Debug Checklist

- Confirm script order is unchanged
- Confirm `assets/image_list.json` contains expected filenames/meta
- Confirm swap flow updates content + URL + metadata consistently
- Confirm event handlers exist in `10_event_bindings_global_modal_menu.js`
- Confirm relevant DOM IDs exist in loaded shell (`index.html` vs `view.html`/`404.html`)
- Confirm refresh preserves open modal content, user controls, scroll/focus, and the last complete chart during failed or superseded requests
- Run `scripts/check_all_dashboards.sh`; use focused `scripts/test_homepage_preview_refresh.py` or dashboard refresh suites for lifecycle changes
