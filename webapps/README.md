# Webapps Dashboard Conventions

This folder contains standalone dashboard-style webapps that are intended to feel like part of the same product family. Use this file as the baseline when adding a new dashboard so layout, spacing, typography, controls, and resizing behavior stay consistent.

Current dashboards:

- `bip110_signaling/`: dual canvas dashboard for SegWit and BIP-110 signaling
- `node_count/`: Plotly-based history chart plus software-version panel
- `bitcoin_dominance/`: Plotly-based BTC dominance history plus latest market-cap snapshot panel

## Shared foundation files

Common dashboard shell/layout rules are centralized in `webapps/shared/` and should be referenced by every dashboard.

- `shared/dashboard_shared.css`
  - Shared topbar/title/info-popover/chip/control/toggle shell rules
  - Shared compact action controls (swap button + resize-handle baseline)
  - Shared loader styling and animation
  - Shared embedded-modal wrap padding behavior
- `shared/dashboard_embed_modal.js`
  - Shared embedded-in-modal detection and `--modal-controls-clearance` updates
  - Auto-applies on load and listens for window + parent resize events

### Required `<head>` includes for new dashboards

Add these references in every dashboard HTML file (path is relative to each dashboard folder):

```html
<script src="../shared/dashboard_embed_modal.js"></script>
<link rel="stylesheet" href="../shared/dashboard_shared.css" />
```

Map the shared accent token in dashboard-local `:root`:

```css
:root {
  --dashboard-accent: var(--accent);
}
```

For dashboards that use `--signal` as the accent token:

```css
:root {
  --dashboard-accent: var(--signal);
}
```

## Core visual language

These values are already established in the current dashboards and should be treated as the default system unless a dashboard has a strong reason to diverge.

### Fonts

- Primary UI and headings: `Space Grotesk`
- Dense metadata, chips, table text, tooltips, and chart-adjacent labels: `IBM Plex Mono`
- Fallbacks in current dashboards:
  - `"Space Grotesk", "Helvetica Neue", sans-serif`
  - `"IBM Plex Mono", monospace`

Recommended split:

- Use `Space Grotesk` for titles, toggles, and general UI labels.
- Use `IBM Plex Mono` for small technical text, chips, timestamps, tables, and chart annotation text.

### Base colors and shell

Shared baseline tokens used by both dashboards:

- Page background: `#000`
- Panel background: `#000` or near-black panel token
- Foreground text: `#f1f5f7`
- Muted text: `#95a6ae`
- Panel border: `rgba(255, 255, 255, 0.14)`
- Secondary border usage: `rgba(255, 255, 255, 0.06)` to `rgba(255, 255, 255, 0.18)`
- Radius: `14px` for top-level surfaces, `10px` for popovers, `6px` for compact controls

Accent color is dashboard-specific, but it should be a single clear accent that drives hover, focus, and active states.

- `bip110_signaling`: signal orange (`--signal`)
- `node_count`: orange accent (`--accent`)

### Page padding and spacing

Default outer page padding should remain:

- `--wrap-pad: clamp(8px, 1.4vw, 12px)`

Current spacing conventions:

- Gap between topbar and main content: `10px`
- Gap between stacked panels: `10px`
- Topbar padding: `10px 12px`
- Standard panel header padding: `10px 12px 0`
- Table/list lower padding: usually `12px`
- Inline control gaps: `6px`, `8px`, or `10px` depending on density

Do not casually increase top padding inside panels. Small changes there noticeably bloat the layout.

## Topbar conventions

The topbar is a compact control strip, not a hero section.

Use this shape by default:

- Background: black
- Border: `1px solid rgba(255, 255, 255, 0.14)`
- Border radius: `14px`
- Padding: `10px 12px`
- Internal row gap: `6px` to `8px`

Title treatment:

- Font: `Space Grotesk`
- Weight: `700`
- Size: `clamp(1.05rem, 2vw, 1.5rem)`
- Slight letter spacing is acceptable: around `0.015em`

Support text under the title should be muted and compact. For technical source text or timestamps, prefer `IBM Plex Mono` around `0.82rem` to `0.9rem`.

## Chip and control conventions

Shared chip styling already in use:

- Border radius: `999px`
- Border: `1px solid rgba(255, 255, 255, 0.14)`
- Background: transparent or `rgba(0, 0, 0, 0.4)` for select-like controls
- Padding: `5px 9px`
- Font size: `0.8rem`
- Font family: `IBM Plex Mono`

Control rows should:

- Wrap cleanly
- Align vertically centered
- Use `gap: 10px`
- Separate from the title area with a subtle top border

Hover and focus behavior should only tint border/text/background with the dashboard accent. Avoid heavy fills or large glow effects.

## Panel shell conventions

Use one of these panel shells depending on the dashboard type:

- Plotly/data panels: `.panel`
- Canvas-driven panels: `.card`

Shared shell traits:

- Border: `1px solid rgba(255, 255, 255, 0.14)`
- Radius: `14px`
- Background: `#000`
- `overflow: hidden`
- `min-height: 0`
- Layout should usually be `display: flex` with `flex-direction: column` or a tightly controlled grid

If a panel has a header above a chart, keep the top spacing tight. Current node-count panel headers use `padding: 10px 12px 0` specifically so the chart can start close to the header.

## Layout patterns

### Wide layout

For two-panel dashboards, prefer a wide layout that uses most of the viewport height.

Current node-count default:

- Two panels in a grid
- Column template: `minmax(0, 1.6fr) 20px minmax(0, 1fr)`
- Center column reserved for the draggable panel resizer
- Outer wrapper fills viewport height with `grid-template-rows: auto 1fr`

### Stacked layout

When the layout stacks vertically:

- Use a single column
- Keep explicit `gap: 10px` between panels
- Preserve independent panel heights per panel, not just per position
- Replace the vertical splitter with panel-local resize handles where needed

Current node-count breakpoint:

- Stack at `max-width: 1100px`

If a future dashboard stacks at a different breakpoint, document why.

## Panel resizing and persistence

This is one of the main areas where future dashboards should copy the current implementation patterns rather than re-inventing them.

### General rules

- Resizing should use pointer events with pointer capture.
- Dragging down should increase height. Do not invert behavior based on panel position.
- Persist manual sizing in `localStorage`.
- Persist sizes by panel identity, not only by visible slot position.
- If panel order can swap, heights must follow the panel they belong to.

### Node Count specifics

Node Count currently persists:

- `panelsSwapped`
- wide-layout panel split percentage
- stacked-layout panel split percentage
- per-panel manual heights for the history and software panels
- software chart/table split percentages for wide and stacked layouts

Important node-count sizing values:

- Main panel split bounds: `34` to `72`
- Stacked main panel split bounds: `10` to `90`
- Software chart split bounds: `32` to `78`
- Software chart minimum height: `156px`
- Software table minimum height: `calc(header + row + 12px)`
- Stacked software chart target height: `260px`

### BIP110 specifics

BIP110 currently persists:

- `panelsSwapped`
- per-panel manual heights for SegWit and BIP-110
- filled-panel state for each chart

Important BIP110 sizing values:

- Minimum manual panel height: `220px`
- Viewport pad when filling available height: `24px`
- Default panel canvas height: `max(300px, 44svh)`
- Solo/filled canvas height: `max(600px, 88svh)`

## Chart spacing guidance

Chart margins should be treated as intentional. Extra empty space at the top or bottom is usually a regression, not a neutral change.

### Plotly defaults from Node Count

Current chart margins:

- History chart: `{ l: 64, r: 24, t: 16, b: 40 }`
- Software chart: `{ l: 64, r: 18, t: 6, b: 62 }`

Use these as the first-pass defaults for future Plotly dashboards.

Rules:

- Only reserve bottom margin for labels that actually exist.
- Keep top margin small when the panel already has its own title/header above the chart.
- Left margin around `64px` works well when the y-axis has ticks plus a title.
- Prefer transparent Plotly `paper_bgcolor` and `plot_bgcolor` inside black panels.

### Node Count chart/panel composition

The current node-count composition is a good default for mixed chart + table dashboards:

- Panel header at top
- Compact legend directly below the header when needed
- Chart flexes to fill remaining space
- A dedicated internal resizer separates the software chart from the version table
- Table header stays sticky

## Resizer and affordance styling

Current compact resize and panel action controls use:

- `20px` square footprint
- `6px` radius
- Border: `1px solid rgba(255, 255, 255, 0.25)`
- Background: `rgba(0, 0, 0, 0.72)`
- Accent-colored border on hover/focus

For disabled states:

- Use subdued text around `#888` or `rgba(214, 225, 230, 0.5)` depending on the control family
- Reduce border contrast
- Keep cursor `default` for disabled download-style controls
- Do not leave hover styling active on disabled controls

## Mobile and embedded behavior

Dashboards may appear standalone or inside the shared modal.

Required behaviors:

- Respect modal clearance using `--modal-controls-clearance`
- Add the `embedded-in-modal` body class when hosted inside the modal container
- Keep info popovers usable on smaller screens by relaxing absolute positioning when necessary
- Tighten corner radii slightly on smaller screens if needed, but do not redesign the layout entirely

Use `shared/dashboard_embed_modal.js` for this behavior instead of re-implementing embed-clearance scripts per dashboard.

Current mobile adjustments are intentionally modest. Prefer preserving the desktop visual language instead of creating a separate mobile theme.

## Data and loading patterns

Recommended expectations for future dashboards:

- Include a lightweight loader inside each major panel if data fetch or phased rendering is visible
- Use compact loader text in `IBM Plex Mono`
- Keep loading overlays black and semi-transparent, not blurred glass
- Persist user controls that materially affect layout or reading state
- Share timezone preference behavior through `js/25_dashboard_timezone_preferences.js` when timestamps are shown

## Implementation checklist for a new dashboard

Before calling a new dashboard finished, check all of the following:

- The dashboard references `../shared/dashboard_shared.css` and `../shared/dashboard_embed_modal.js`.
- Shared shell rules are reused; duplicated copies of shared rules were not pasted into the dashboard file.
- Fonts match the established `Space Grotesk` and `IBM Plex Mono` split.
- Outer padding uses the existing `clamp(8px, 1.4vw, 12px)` pattern.
- Topbar is compact and bordered, not oversized.
- Panels use black backgrounds, subtle borders, and `14px` radius.
- Chart top and bottom margins are intentionally tuned, not left at library defaults.
- Stacked layout includes a visible gap between panels.
- Resizing works in the intuitive direction.
- Manual sizes persist correctly across reloads.
- If panels can swap, each panel keeps its own saved height.
- Disabled actions are truly disabled in both styling and behavior.
- Mobile and embedded modal states were checked explicitly.

## Practical recommendation

Always start with the shared foundation files in `webapps/shared/`, then layer dashboard-specific rules only where needed.

If a new dashboard is closer to a chart + controls + panel workflow, start by copying the shell and spacing patterns from `node_count/dashboard.html`.

If a new dashboard is closer to a pair of custom-rendered visual panels, start from `bip110_signaling/dashboard.html`.

Use those as implementation baselines, then document any intentional deviations in the new dashboard itself so this file can stay the shared default reference.