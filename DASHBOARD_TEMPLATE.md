# Dashboard Template Contract

Use this contract for every new chart dashboard under `webapps/<slug>/`.
Read [Shared dashboard standards](webapps/DASHBOARD_STANDARDS.md) for behavior
and acceptance evidence, then [webapps/README.md](webapps/README.md) for integration
details. This file specifies shell wiring; the generator and wiring check do not
establish that charts render correctly. Existing dashboards adopt standards in
the affected feature and record remaining gaps in their own README.

## Required Shared Files

Every standard dashboard page must load these shared files before the dashboard app script:

- `../shared/dashboard_embed_modal.js`
- `../shared/dashboard_share.js`
- `dashboard_manifest.js`
- `../shared/dashboard_components.js`
- `../shared/dashboard_charting.js`
- `../shared/dashboard_export.js`
- `../shared/dashboard_shared.css`
- `../shared/dashboard_controls.css`

Dashboard-specific CSS may come after the shared CSS. Dashboard-specific JS should come after the shared JS.
`dashboard_shared.css` imports `dashboard_tooltips.css`; custom shells that do
not use the shared layout load the tooltip stylesheet directly with
`dashboard_components.js`.

For PNG or WebM exports, also load `../shared/dashboard_export_branding.js`
after `dashboard_export.js` and before the dashboard's export renderer. See the
[shared export branding API](webapps/README.md#export-typography-and-branding).

## Required Dashboard Files

Each dashboard should include:

- `webapps/<slug>/dashboard_manifest.js`
- `webapps/<slug>/dashboard.html`
- `webapps/<slug>/dashboard_app.js`
- `webapps/<slug>/preview.html`
- `webapps/<slug>/preview_app.js`
- `webapps/<slug>/standalone_bootstrap.js`
- `<slug>.html` at the repository root when it is exposed as a standalone route

## Required Shared Component Wiring

For a standard analytics dashboard, use the existing shared class and ID names:

- `.topbar`
- `.title-row`
- `.title`
- `.info-wrap`, `.info-btn`, `.info-popover`
- `.title-actions`
- `.copy-link-btn`
- `.reset-dashboard-btn`

Dashboards with date windows should use:

- `#startDateBtn`
- `#endDateBtn`
- `#startDateInput`
- `#endDateInput`
- `#dateRangeSliderWrap`
- `#dateRangeStartSlider`
- `#dateRangeEndSlider`

Use `window.WSBDashboardComponents.createDatePicker()` or `bindDateRangePickers()` for custom calendar selection. Do not call native `showPicker()` for standard dashboard date buttons.

Copy/reset controls should use:

- `window.WSBDashboardComponents.buildShareUrl({ slug, state })`
- `window.WSBDashboardComponents.readShareState()`
- `window.WSBDashboardComponents.copyDashboardLink()`
- `window.WSBDashboardComponents.setResetButtonState()`
- `window.WSBDashboardComponents.bindDashboardActions()`

Dashboard title and description shell wiring should use:

- `window.WSBDashboardComponents.getDashboardManifest()`
- `window.WSBDashboardComponents.initDashboardRuntime()`

Settings button groups and two-chart export controls should use:

- `window.WSBDashboardComponents.getButtonGroupValue()`
- `window.WSBDashboardComponents.setButtonGroupValue()`
- `window.WSBDashboardComponents.toggleRequiredButtonGroupItem()`
- `window.WSBDashboardComponents.syncDependentButtonGroupAvailability()`
- `window.WSBDashboardComponents.setFloatingMenuOpen()`
- `window.WSBDashboardComponents.constrainFloatingMenuToViewport()`

Hover tooltip wiring applies to every main chart, alternate tab, drilldown,
record dialog, and settings/download panel:

- HTML: `wsb-tooltip` plus `wsb-tooltip--data`, `--record`, or `--help`.
- Content: `window.WSBDashboardComponents.renderTooltip({ title, rows, note })`;
  each plain-text row has `label`, `value`, optional series-swatch `color`, and
  optional `tone` for explicitly signed positive/negative outcomes.
- Plotly: `getPlotlyHoverlabel()`; retain native pointer/outline/swatches.
- Canvas: `getTooltipTheme()`; measure and draw in CSS pixels with one DPR scale.
- Title info and custom inline help share the same surface; native `title` and
  unbound `data-tooltip` help are handled by the shared runtime.

Use neutral labels/values, small series swatches, and wrapping record metadata
in the shared row layout. Keep placement/show-hide behavior local and avoid
appearance overrides. The [tooltip API](webapps/README.md#shared-hover-tooltips)
and [acceptance contract](webapps/DASHBOARD_STANDARDS.md#hover-tooltips) define
sizes, theme tokens, cleanup, and screenshots. Repeated-series panels such as
Moving Average use one active readout and shared guides in overlapping ranges;
complementary reciprocal panels such as UoA retain paired readouts with each
panel's units, reciprocal values, and inverse vertical placement. Do not link
independent metrics/populations/time bases or show stale/future values outside
valid ranges. Existing dashboards without chart hover need no new chart-hover
feature for this adoption.

Playback keyboard overrides should use `window.WSBDashboardComponents.bindPlaybackKeyboardShortcuts()` and keep dashboard-specific play/pause/range state local.

Repeated canvas chart math should use `window.WSBDashboardCharting` before adding dashboard-local helpers:

- plot rectangles and value-to-pixel mapping
- linear/log y-axis ticks
- UTC calendar x-axis ticks with `createCalendarTicks()`; keep label layout local
- grid lines and right-side tick labels
- standard number, currency, and date tick formatting

Dashboards with playback/export should use the established date-range classes:

- `.date-range-panel`
- `.date-range-play-row`
- `.date-range-playback-btn`
- `.date-range-download-settings-menu`

Updated timestamp KPIs should use the standard shared controller:

- HTML: `#updatedChipWrap`, `#chipUpdated`, `#updatedKpi`, `#updatedTimeZoneDropdown`, `#updatedTimeZoneDropdownTrigger`, `#updatedTimeZoneDropdownMenu`, `#updatedTimeZoneSelect`
- JS: `window.WSBDashboardComponents.createUpdatedTimeZoneChipController()`
- Use `setUpdated(value, { includeHeight: true, height })` when the chip should include block height.

## Behavior Expectations

Follow the [chart, interaction, state, and export standards](webapps/DASHBOARD_STANDARDS.md).
In particular, long history date axes use 2/4/8… year intervals as needed for the
plot width, and dashboard/export values follow the same calculation contract.
Document metric-specific choices instead of inheriting another dashboard's
formulas, layout, or exact visual constants accidentally.

Homepage grid previews show chart series without grid lines, labels, ticks, or
panel titles. Remove the margins reserved for those decorations while keeping
the full dashboard and exports unchanged.

New dashboards should match existing UOA/DCA behavior:

- custom calendar with year and month selection
- rolling-current-date persistence when the end date is today
- drag/scrub range interactions
- keyboard playback overrides for Space, Left, and Right
- fullscreen hides title/modal controls but keeps playback visible when applicable
- deterministic export frame building when a dashboard supports video download
- PNG exports use the [2160-quality dimensions, typography, and branding standard](webapps/DASHBOARD_STANDARDS.md#png-and-webm-exports), independent of video quality; each dashboard keeps its own composition
- shared download estimates through `window.WSBDashboardExport.estimateDownload()`
- bundled export fonts, Bitcoin wordmark, and canonical URL footer through `window.WSBDashboardExportBranding`; await `ready()` before measuring or drawing, and retain dashboard-owned sizes and positions
- no MP4 export paths; deterministic WebM is the standard video export
- copy/restore controls use shared visual classes and state classes
- copy links include every data/view control, including defaults, explicit dates,
  and the current playback frame; URL state overrides recipient storage
- standalone shells forward state through `WSBDashboardShare.buildDashboardSrc()`

## Validation

Generate the starter files with:

```bash
./scripts/create_dashboard.sh <slug> "Dashboard Title"
```

Run:

```bash
./scripts/check_dashboard_contract.sh webapps/<slug>
```

The checker should pass before committing a new dashboard. For tooltip work,
also capture each affected variant in dark/light at desktop/mobile widths,
including secondary dialogs, long content, and edges. Check the appropriate
single/paired readouts, reciprocal math and inverse placement where applicable,
leave/close cleanup, and CSS-pixel canvas sizing at DPR 1 and 2. Record the UI
steps/selectors needed to reopen conditional tips; a wiring check is not visual
verification.
