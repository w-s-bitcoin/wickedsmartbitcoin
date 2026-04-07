# JS Architecture Guide (Wicked Smart Bitcoin)

This project uses ordered plain-JS files with shared globals (no bundler/import/export).
Load order matters.

## Current Routing Model

- `index.html`: home grid/discovery experience
- `view.html`: standalone visualization shell for local deep links
- `404.html`: production standalone shell (GitHub Pages fallback for clean routes)
- `bip110_signaling.html`: lean standalone bootstrap dedicated to BIP110 iframe startup
- `node_count.html`: lean standalone bootstrap dedicated to Node Count iframe startup
- `bitcoin_dominance.html`: lean standalone bootstrap dedicated to Bitcoin Dominance iframe startup

### URL behavior

- Production deep links: `/quantum_exposure`, `/bip110_signaling`, `/node_count`, `/bitcoin_dominance`
- Local standalone deep links: `/view.html#node_count`
- Home page remains `/`

## Script Load Order

Use this exact order where the full app shell is loaded:

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
13. `12_homepage_kpis.js`

Dashboard-local standalone files live alongside each dashboard. Most use `webapps/*/standalone_bootstrap.js`; Quantum Exposure now uses `webapps/quantum_exposure/standalone_app.js`.

## Practical Mental Model

Most visualization-family swaps follow this flow:

1. Compute the target filename from control state
2. Update the displayed modal content (image or embed)
3. Update URL to the canonical route
4. Rekey/update current card metadata if needed
5. Update current grid thumb when relevant
6. Keep favorites and controls synchronized

## Core State Contracts

- `imageList`: normalized display cards after bootstrap rewrites
- `visibleImages`: filtered subset (search/favorites)
- `currentIndex`: active modal index within `visibleImages`
- `cardByFilename`: DOM map for card updates/rekey operations

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
- `12_homepage_kpis.js`: homepage KPI hydration and refresh behavior

### Dashboard-local standalone controllers

- `webapps/bip110_signaling/standalone_bootstrap.js`: self-contained standalone controller for BIP110 page
- `webapps/node_count/standalone_bootstrap.js`: self-contained standalone controller for Node Count page
- `webapps/bitcoin_dominance/standalone_bootstrap.js`: self-contained standalone controller for Bitcoin Dominance page
- `webapps/quantum_exposure/standalone_app.js`: self-contained standalone controller for Quantum Exposure page

## Where To Edit (Cheat Sheet)

- Routing/deep-link behavior: `05`, `09`, `10`, and each dashboard-local standalone controller (`webapps/*/standalone_bootstrap.js`, plus `webapps/quantum_exposure/standalone_app.js`)
- Grid rendering/filter/favorites card UI: `06`
- Modal visibility/controls/swipes: `07`
- Donate overlay behavior: `08` (+ route sync touchpoints in `09`/`10`)

## Notes About Removed Features

- Card-level "N visualizations" count labels were removed from home cards.
- Any new feature work should not reintroduce count-label assumptions in grid rendering.

## Quick Debug Checklist

- Confirm script order is unchanged
- Confirm `assets/image_list.json` contains expected filenames/meta
- Confirm swap flow updates content + URL + metadata consistently
- Confirm event handlers exist in `10_event_bindings_global_modal_menu.js`
- Confirm relevant DOM IDs exist in loaded shell (`index.html` vs `view.html`/`404.html`)
