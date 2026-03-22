# Dashboard Quick Tips

Use this as the fast-path checklist when building a new dashboard in `webapps/`.

## 1. Start from the shared shell

Always include:

```html
<script src="../shared/dashboard_embed_modal.js"></script>
<link rel="stylesheet" href="../shared/dashboard_shared.css" />
```

Set your accent token in local `:root`:

```css
:root {
  --dashboard-accent: var(--accent);
}
```

## 2. Keep layout behavior predictable

- Use a two-panel wide layout plus stacked/mobile fallback.
- Persist sizes by panel identity (not panel slot).
- If panel order is swappable, heights must follow the panel, not the position.
- Use pointer capture for all drag-resize interactions.
- Drag down should always increase panel height.

## 3. Persist all user-impacting state

Persist at minimum:

- panel visibility toggles
- panel swap order
- panel split ratios/heights
- timezone preference (if timestamps are shown)
- chart options that materially change what users see

## 4. Match the standard refresh behavior

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

## 5. Plotly defaults that work well

Use these as first-pass defaults:

- transparent chart backgrounds (`paper_bgcolor` and `plot_bgcolor`)
- hover labels with mono font and dark background
- narrow top margins (panels already have headers)
- explicit left margin if y-axis labels are dense
- disable noisy modebar actions users do not need

Recommended baseline margins from existing dashboards:

- history-style chart: `{ l: 64, r: 24, t: 16, b: 40 }`
- compact category/bar panel: `{ l: 64, r: 18, t: 6, b: 62 }`

## 6. Home page card preview integration

If the dashboard needs live grid/list quick views:

1. Add a preview mapping entry in `js/06_grid_layout_filter_render.js`:
   - `url: "webapps/<dashboard>/dashboard.html?preview=card"`
   - virtual preview scene width/height
2. Add `preview=card` mode in dashboard HTML/CSS:
   - hide topbar/KPI-only sections
   - show panel area only
   - remove controls not needed in tiny preview
3. Keep card DOM nodes mounted during filtering.

Important:

- Do not re-append mounted preview card nodes during filter/favorites/archive toggles.
- Reparenting iframe-backed cards can trigger reload lag.

## 7. Card-preview CSS rules to remember

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

## 8. Embedded modal behavior

Dashboards can render standalone or in modal iframes.

- rely on `dashboard_embed_modal.js` for modal clearance behavior
- avoid dashboard-specific hacks for modal top padding unless absolutely necessary
- verify both contexts before shipping

## 9. Final QA checklist

Before shipping a new dashboard:

- desktop wide layout works
- mobile stacked layout works
- swap + resize + persistence all work after reload
- timezone display updates in place
- wake refresh behavior works after tab sleep
- card quick view does not reload when toggling favorites/archive/search
- modal-embedded and standalone rendering both look correct
- no console errors during init, resize, filter, and refresh

## 10. Recommended build order

1. Data loading + parsing
2. Static panel shell and topbar
3. First chart render (no resizing yet)
4. Panel visibility toggles
5. Resize interactions + persistence
6. Refresh/wake behavior
7. Card preview mode (`preview=card`)
8. Home page integration
9. Final spacing and typography polish
