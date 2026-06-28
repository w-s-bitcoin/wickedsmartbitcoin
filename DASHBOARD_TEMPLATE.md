# Dashboard Template Contract

Use this contract for every new chart dashboard under `webapps/<slug>/`.

## Required Shared Files

Every standard dashboard page must load these shared files before the dashboard app script:

- `../shared/dashboard_embed_modal.js`
- `dashboard_manifest.js`
- `../shared/dashboard_components.js`
- `../shared/dashboard_charting.js`
- `../shared/dashboard_export.js`
- `../shared/dashboard_shared.css`
- `../shared/dashboard_controls.css`

Dashboard-specific CSS may come after the shared CSS. Dashboard-specific JS should come after the shared JS.

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

Playback keyboard overrides should use `window.WSBDashboardComponents.bindPlaybackKeyboardShortcuts()` and keep dashboard-specific play/pause/range state local.

Repeated canvas chart math should use `window.WSBDashboardCharting` before adding dashboard-local helpers:

- plot rectangles and value-to-pixel mapping
- linear/log y-axis ticks
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

New dashboards should match existing UOA/DCA behavior:

- custom calendar with year and month selection
- rolling-current-date persistence when the end date is today
- drag/scrub range interactions
- keyboard playback overrides for Space, Left, and Right
- fullscreen hides title/modal controls but keeps playback visible when applicable
- deterministic export frame building when a dashboard supports video download
- shared download estimates through `window.WSBDashboardExport.estimateDownload()`
- footer URL drawing through `window.WSBDashboardExport.drawFooterUrl()`
- no MP4 export paths; deterministic WebM is the standard video export
- copy/restore controls use shared visual classes and state classes

## Validation

Generate the starter files with:

```bash
./scripts/create_dashboard.sh <slug> "Dashboard Title"
```

Run:

```bash
./scripts/check_dashboard_contract.sh webapps/<slug>
```

The checker should pass before committing a new dashboard.
