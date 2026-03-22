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

- Production deep links: `/node_count`, `/btcmap`, `/bip110_signaling`, etc.
- Production deep links also include `/bitcoin_dominance`
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
9. `08_module_btcmap.js`
10. `09_module_bitcoin_vs_gold_bvg.js`
11. `10_module_days_at_a_loss_dal.js`
12. `11_module_price_on_this_day_potd.js`
13. `12_module_dominance_usd_btc.js`
14. `13_module_never_look_back_price_nlbp.js`
15. `14_module_target_block_hashes_length_32_64.js`
16. `15_module_halving_view.js`
17. `16_module_price_of_price_of.js`
18. `17_module_unit_of_account_uoa.js`
19. `19_module_monthly_yearly_returns_myr.js`
20. `20_buy_me_button_thanks_overlay.js`
21. `21_slideshow_core_ui_fullscreen.js`
22. `22_bootstrap_fetch_init_global_exports.js`
23. `23_event_bindings_global_modal_menu.js`

Additional standalone-only file:

24. `24_bip110_standalone_bootstrap.js` (used by `bip110_signaling.html` only)
25. `26_node_count_standalone_bootstrap.js` (used by `node_count.html` only)
26. `28_bitcoin_dominance_standalone_bootstrap.js` (used by `bitcoin_dominance.html` only)

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

### Feature-family modules

- `08_module_btcmap.js`: BTC Map region/view handling
- `09_module_bitcoin_vs_gold_bvg.js`: BVG year handling
- `10_module_days_at_a_loss_dal.js`: DAL scale handling
- `11_module_price_on_this_day_potd.js`: POTD scale handling
- `12_module_dominance_usd_btc.js`: Bitcoin Dominance filename helpers
- `13_module_never_look_back_price_nlbp.js`: NLBP scale handling
- `14_module_target_block_hashes_length_32_64.js`: hash-length mode handling
- `15_module_halving_view.js`: halving view handling
- `16_module_price_of_price_of.js`: Price-Of options/meta/sort/index handling
- `17_module_unit_of_account_uoa.js`: UOA options/meta/sort/group handling
- `19_module_monthly_yearly_returns_myr.js`: monthly/yearly return window handling

### Overlays/bootstrap/events

- `20_buy_me_button_thanks_overlay.js`: donate overlay and method UI
- `21_slideshow_core_ui_fullscreen.js`: slideshow logic/fullscreen behavior
- `22_bootstrap_fetch_init_global_exports.js`: image manifest fetch, representative card rewrites, deep-link resolution, init sequence
- `23_event_bindings_global_modal_menu.js`: event wiring for keyboard/mouse/touch/menu/controls
- `24_bip110_standalone_bootstrap.js`: self-contained standalone controller for BIP110 page
- `26_node_count_standalone_bootstrap.js`: self-contained standalone controller for Node Count page
- `28_bitcoin_dominance_standalone_bootstrap.js`: self-contained standalone controller for Bitcoin Dominance page

## Where To Edit (Cheat Sheet)

- Routing/deep-link behavior: `05`, `07`, `22`, and standalone bootstraps `24`, `26`, `28`
- Grid rendering/filter/favorites card UI: `06`
- Modal visibility/controls/swipes: `07`
- Control dropdown logic by family: relevant `08-19` module + `23` bindings
- Slideshow behavior: `21` + `23`
- Donate overlay behavior: `20` (+ route sync touchpoints in `22`/`23`)

## Notes About Removed Features

- Card-level "N visualizations" count labels were removed from home cards.
- Any new feature work should not reintroduce count-label assumptions in grid rendering.

## Quick Debug Checklist

- Confirm script order is unchanged
- Confirm `assets/image_list.json` contains expected filenames/meta
- Confirm swap flow updates content + URL + metadata consistently
- Confirm event handlers exist in `23_event_bindings_global_modal_menu.js`
- Confirm relevant DOM IDs exist in loaded shell (`index.html` vs `view.html`/`404.html`)
