# Dashboard Quick Tips

Use this as the fast-path checklist when building a new dashboard in `webapps/`.

## 1. Start from the shared shell

Always include in `dashboard.html` `<head>`:

```html
<script src="../shared/dashboard_embed_modal.js"></script>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="../shared/dashboard_shared.css" />
```

Set your accent token in local `:root`:

```css
:root {
  --dashboard-accent: var(--accent);
}
```

Put all dashboard logic in a separate `dashboard_app.js` file (not inline in the HTML). Load it at the bottom of `<body>`.

## 2. Wire up the theme system

Every `dashboard_app.js` must start with this IIFE before any other code:

```javascript
(function () {
  const THEME_KEY = 'quantum-research-dashboard-theme';
  function applyTheme(t) {
    document.documentElement.dataset.theme = (t === 'light' ? 'light' : 'dark');
    document.dispatchEvent(new CustomEvent('dashboard-theme-change'));
  }
  try {
    const stored = localStorage.getItem(THEME_KEY);
    applyTheme(
      stored === 'light' || stored === 'dark'
        ? stored
        : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    );
  } catch (_) { applyTheme('dark'); }
  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'quantum-dashboard-theme') applyTheme(e.data.theme);
  });
  window.addEventListener('storage', function (e) {
    if (e.key === THEME_KEY && (e.newValue === 'light' || e.newValue === 'dark')) applyTheme(e.newValue);
  });
}());
document.addEventListener('dashboard-theme-change', function () {
  // re-render charts, update Plotly layout colors, etc.
});
```

Add `:root[data-theme="light"]` token overrides in the dashboard's local CSS. Copy the token set from `node_count/dashboard.html` as a starting point.

## 3. Create the standalone shell page

Copy an existing root-level `<dashboard>.html` (e.g. `node_count.html`) to `/<new_dashboard>.html`. Update:
- The `<title>` tag
- `<link rel="prefetch" href="webapps/<new_dashboard>/dashboard.html" />`
- The `<script src="webapps/<new_dashboard>/standalone_bootstrap.js">` tag at the end of `<body>`

The shell page must have `data-standalone-modal-shell="1"` on `<body>`. It loads `assets/styles.css` — not any dashboard-specific CSS.

Copy an existing `standalone_bootstrap.js` and update `STANDALONE_FILENAME`, `DASHBOARD_URL`, `getStandalonePath()`, and the `getMainRouteUrl()` slug guard for the new dashboard.

**Critical:** Add the new slug to `localStandaloneBySlug` in **every** existing `standalone_bootstrap.js` and in `quantum_exposure/standalone_app.js`. This map is used for local dev routing and must stay in sync across all files.

## 4. Keep layout behavior predictable

- Use a two-panel wide layout plus stacked/mobile fallback.
- Persist sizes by panel identity (not panel slot).
- If panel order is swappable, heights must follow the panel, not the position.
- Use pointer capture for all drag-resize interactions.
- Drag down should always increase panel height.

## 5. Persist all user-impacting state

Persist at minimum:

- panel visibility toggles
- panel swap order
- panel split ratios/heights
- timezone preference (if timestamps are shown)
- chart options that materially change what users see

## 6. Match the standard refresh behavior

For dashboard data refresh, use the same pattern everywhere:

- poll every 60s (`AUTO_REFRESH_MS = 60000`)
- force refresh at least hourly (`FORCE_REFRESH_MS = 3600000`)
- avoid duplicate requests with `refreshInFlight`
- check lightweight signature/stamp first, then reload only if changed
- trigger refresh on wake events:
  - `visibilitychange`
  - `focus`
  - `pageshow`
  - `online`
- if using phased rendering, re-enable topbar controls right after the first meaningful paint; do not keep controls locked while non-critical background datasets continue loading

## 7. Plotly defaults that work well

Use these as first-pass defaults:

- transparent chart backgrounds (`paper_bgcolor` and `plot_bgcolor`)
- hover labels with mono font and dark background
- narrow top margins (panels already have headers)
- explicit left margin if y-axis labels are dense
- disable noisy modebar actions users do not need

Recommended baseline margins from existing dashboards:

- history-style chart: `{ l: 64, r: 24, t: 16, b: 40 }`
- compact category/bar panel: `{ l: 64, r: 18, t: 6, b: 62 }`

## 8. Home page card preview integration

The card preview uses a separate `preview.html` + `preview_app.js` — not `?preview=card` on the main dashboard.

1. Create `preview.html` with minimal markup, load `../shared/preview_shared.js` then `preview_app.js` at end of `<body>`.
2. `preview_app.js` renders only the main chart. Call `window.WSBPreviewShared?.initThemeSync({ onThemeChanged: render })` during init.
3. Add a preview mapping entry in `js/06_grid_layout_filter_render.js`:
   - key: `'<dashboard>.png'` (must match the card image filename)
   - `url: 'webapps/<dashboard>/preview.html'`
   - `width: 1280, height: 720`
4. Keep card DOM nodes mounted during filtering.

Important:

- Do not re-append mounted preview card nodes during filter/favorites/archive toggles.
- Reparenting iframe-backed cards can trigger reload lag.

## 9. Card-preview CSS rules to remember

For panel-only preview mode:

- make root/`body` height 100%
- hide overflow
- set wrapper to full-height flex column
- set panel containers to `flex: 1 1 0; min-height: 0; width: 100%`
- set chart/canvas box to full height

This ensures:

- one visible panel can fill full card height
- two visible panels each span full width
- proportions remain consistent with scene scaling

## 10. Embedded modal behavior

Dashboards can render standalone or in modal iframes.

- rely on `dashboard_embed_modal.js` for modal clearance behavior
- avoid dashboard-specific hacks for modal top padding unless absolutely necessary
- verify both contexts before shipping

## 11. Final QA checklist

Before shipping a new dashboard:

- desktop wide layout works
- mobile stacked layout works
- swap + resize + persistence all work after reload
- dark and light themes render correctly in both standalone and modal contexts
- timezone display updates in place
- wake refresh behavior works after tab sleep
- first checkbox click works immediately after opening the dashboard (no ignored initial interaction)
- card quick view (preview.html) does not reload when toggling favorites/archive/search
- modal-embedded and standalone rendering both look correct
- no console errors during init, resize, filter, and refresh
- `localStandaloneBySlug` updated in all existing bootstrap files
- `DASHBOARD_CARD_PREVIEW_SPECS` entry added in `js/06_grid_layout_filter_render.js`

## 12. Recommended build order

1. `webapp_data/` — generate data files with the update script
2. Theme sync IIFE + dark/light token definitions
3. Static panel shell and topbar (no data yet)
4. Data loading + parsing
5. First chart render (no resizing yet)
6. Panel visibility toggles
7. Resize interactions + persistence
8. Refresh/wake behavior
9. Copy Link + Reset Dashboard topbar buttons
10. `preview.html` + `preview_app.js` card preview
11. Root-level `<dashboard>.html` shell page + `standalone_bootstrap.js`
12. `localStandaloneBySlug` update in all existing bootstraps
13. `DASHBOARD_CARD_PREVIEW_SPECS` entry in `js/06_grid_layout_filter_render.js`
14. Final spacing and typography polish
