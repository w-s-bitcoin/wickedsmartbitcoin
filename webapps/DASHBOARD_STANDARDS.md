# Shared dashboard standards

Use this as the behavior and review contract for new dashboards and changes to
existing ones. [README.md](README.md) covers integration and styling;
[DASHBOARD_TEMPLATE.md](../DASHBOARD_TEMPLATE.md) covers required shell wiring.
Read the target dashboard's own notes for its calculation and data contracts.

## Adoption and scope

- New dashboards follow the applicable standards below. Features such as
  playback, live quotes, multiple panels, or exports are required only when the
  dashboard needs them.
- For older dashboards, update the affected feature and track remaining gaps.
  A small edit does not require a whole-dashboard redesign. Record discovered
  gaps in the dashboard's README, with the affected behavior and a verification
  example; distinguish unfinished adoption from an intentional exception.
- Preserve established calculations, routes, saved-state keys, and data
  contracts. Explain intentional exceptions in the dashboard's README. Existing
  user authorization governs the work; documenting an exception does not itself
  require another approval.
- Use shared helpers first. If the same behavior needs a new helper, extract it
  with explicit inputs and test its consumers; do not copy a complete dashboard
  to inherit one feature. A reference implementation is not automatically a
  shared API or evidence that every older dashboard already conforms.
- Keep Casascius's custom shell, Net Worth's personal-data behavior, and the
  frozen Quantum archive contracts intact.

## Chart axes and number formatting

- Choose date ticks from the available **plot width**, after reserving label
  gutters. Align them to calendar boundaries. Daily Bitcoin history uses UTC;
  a different source calendar must be documented. Changing the displayed
  timestamp timezone must not silently regroup historical observations.
- When a history chart needs multi-year spacing, use **2, 4, 8, 16… years**.
  Anchor ticks to January 1 of years divisible by the interval. Short ranges
  may use annual, monthly, weekly, or daily ticks. This is a date-axis rule;
  price/value axes keep intervals appropriate to their units and scale.
- Keep each axis's date labels unambiguous across year boundaries. For export
  year/month axes, default to `YYYY` when all ticks are year starts; otherwise
  use `MM-YYYY` consistently, including January. Intraday charts need time labels.
- Check actual label bounds after fonts load. Coarsen crowded ticks, reserve
  gutters, or choose an appropriate label orientation. Keep gridlines at their
  true dates/values. In animation, avoid edge clamping that makes labels appear
  fixed while their dates move. No clipped, duplicated, or overlapping labels.
- Use round value ticks and enough precision to distinguish adjacent values.
  KPIs, axis labels, and tooltips have different precision needs. For USD price
  KPIs, default to two decimals at $1 and above and cents below $1, retaining
  extra precision for tiny nonzero values. Do not impose USD formatting on
  percentages, ratios, other currencies, sats, or counts. Missing values are
  not zero.
- Keep data clear of chart edges and handle flat, single-point, empty, and
  nonpositive ranges deliberately. Document a metric's zero baseline and LOG
  behavior; changing scale must not change the underlying values.

## Visual consistency and interactions

- Use the shared compact shell, theme tokens, fonts, controls, and modal
  clearance. A series keeps its identity across panels, tooltips, previews,
  themes, and exports; adjust contrast as needed. Do not use color alone to
  identify a series, selection, or feed status.
- In the first dashboard card, place the title above KPIs and visible selectors
  below them. The selectors row uses the shared full-width divider: a 1px
  `--panel-border` line with 6px padding above the controls, matching DCA Cost
  Basis in both themes. Use the shared `.topbar` controls rule for custom
  selector layouts too.
- Keep plot rectangles, title anchors, KPI positions, and label gutters stable
  during playback and live updates. Changing digit counts must not move panels.
  Layout may adapt when viewport, orientation, or enabled panels change.
- Match apparent line weight across dense and sparse charts without dropping
  meaningful data. Any aggregation or downsampling needs an explicit method
  that preserves the metric's important features; stroke styling must not alter
  the calculation.
- Related time-series panels share a hover date where their visible ranges
  overlap. Show one tooltip in the active panel, keep it inside the plot and
  clear of labels, and clear guides on leave, drag, or playback. Tooltip values
  must agree with the visible interpolation and scale; never imply an unobserved
  value is an actual recorded sample. Empty future space has no sample tooltip.
- For two-state LOG/LIN controls, either half toggles the panel exactly once.
  Use the shared 700 ms scale transition and tick morphing; labels move with
  their values, shared ticks stay visible, and zero does not flash. Reversals
  continue smoothly, panels remain independent, and reduced motion is immediate.
  Persist/share/export only the selected endpoint scale.
- Hiding an optional series removes its dependent controls, KPI, and dedicated
  panel where appropriate, preserves its settings, and lets visible panels use
  the freed space. Do not leave interactive empty panels behind.
- Homepage chart previews show series without titles, axes, gridlines, or
  reserved label gutters. Reuse the dashboard's model and selections appropriate
  to the preview; keep iframe nodes mounted through filtering and sorting.

## Controls, mobile, and state

- Reuse the shared date, playback, export, timezone, Copy Link, and reset
  controls. Invalid input keeps the last valid view and gives local feedback.
  Valid bounds come from the complete available dataset, not the playback frame.
- Keep controls usable at 320px and 390px widths. Wrap or deliberately scroll
  dense control groups rather than shrinking text and targets until unusable.
  Every action must remain reachable; opening menus must not clip their options.
  Preserve normal page scrolling and provide alternatives to drag-only actions.
- Provide accessible control names, visible focus, correct selected/expanded
  state, keyboard operation, and focus return when menus close. Playback
  shortcuts must not intercept text entry or menu navigation. Announce validation
  and loading errors without announcing every incoming quote. Verify shared
  widgets too; reuse alone does not establish keyboard accessibility.
- Each chart needs a meaningful accessible name and nearby units/current values.
  Hover must not be the only way to discover essential information. See the
  open improvements below for richer chart data access.
- Keep saved preferences, transient interaction state, and shareable analytical
  state distinct. Share links include explicit defaults and all view-defining
  selections, including a paused frame when supported; URL state wins over
  storage. Validate old/malformed state and preserve compatible legacy links.
- Restore Defaults resets that dashboard's preferences and offers undo through
  the shared reset UI. Keep the state snapshot and restoration in the dashboard.
  It must not erase unrelated site preferences or personal holdings.
  Persist resizes by panel identity so sizes follow panels when reordered.

## History, playback, and live data

- Document what an observation means: source, units, sampling calendar, missing
  values, formula, and treatment of the unfinished current period. Share this
  model between dashboard, preview, hover, and export.
- Historical frames use only information available at that date. Never use
  future samples to fill an unfinished window or fabricate missing observations.
  A missing result, insufficient history, and a measured zero are distinct.
- During playback, the visible date, end handle, KPIs, and range length agree.
  Pause freezes the visible selection; stop restores the selected playback range.
  Preserve the user's playback target separately from the current frame.
- For fixed-duration rolling windows, document early-history bounds. Where a
  window is meant to fill over time, keep its initial span anchored and leave
  future space empty before switching to a trailing window. Period calculations
  still use their real calendar boundaries and complete-history requirements.
- Keep live quotes as a current overlay on published history. Historical and
  paused views remain reproducible from their published generation. Retain the
  last usable quote through outages, label its status, and let a newer valid
  publication supersede it according to the feed contract.
- Distinguish live, delayed, retained, and published values with accessible text
  as well as status dots. An Updated time describes the data actually displayed;
  separately identify the published snapshot/block when it differs.
- Refresh atomically: prepare → validate → marker recheck → commit. Keep the last
  complete view on failure; preserve selections, chart state, and playback.
  Defer conflicting installation during a drag/export, then recheck. Hidden
  frames may install complete data and paint when visible. Theme and resize
  handlers render cached data, with no fetch or periodic iframe reload.
- First-load failure, no matching data, insufficient history, refresh failure,
  and feed delay need distinct messages. Use shared loaders for initial loading;
  routine refresh must not blank a good chart or lock unrelated controls.

<a id="png-and-webm-exports"></a>

## PNG and video exports

Video downloads prefer H.264 MP4 for broad player compatibility and retain WebM
as a capability fallback.

- **PNG resolution is fixed at 2160 quality**, independent of viewport size,
  device pixel ratio, and the video quality selector. Use
  `WSBDashboardExport.getDimensions({ quality: "2160", orientation })`:

  | Orientation | PNG pixels |
  | --- | --- |
  | Landscape | 3840 × 2160 (4K) |
  | Portrait | 2160 × 3840 (rotated 4K) |
  | Square | 2160 × 2160 (the square version of the 2160-quality policy) |

  Render charts and text at the target resolution; do not upscale a screenshot.
  A video quality selection must never silently reduce PNG resolution.
- **Use one export typography treatment**, supplied by
  `WSBDashboardExportBranding`: DejaVu Sans Bold for the headline and panel headings, and regular
  DejaVu Sans for labels, dates, and KPIs. Preserve tabular digits and a consistent
  title → panel heading → data label hierarchy. The shared URL footer uses bundled
  IBM Plex Mono Medium (500). Await `ready()` before measuring or rendering;
  use the bundled headline face rather than a locally installed font so output
  stays consistent across machines. Keep the interactive shell's existing
  Space Grotesk/IBM Plex Mono styling.
- **Use consistent branding:** reuse the existing Bitcoin wordmark with its
  original lettering and aspect ratio, plus the dashboard's canonical
  `https://wickedsmartbitcoin.com/<slug>` footer through the branding helper's
  `drawWordmark()` and `drawFooter()` methods.
  Match the reference's dark/light treatment and keep both mark and footer
  readable, clear of chart content, and inside the output. Use the same
  typography and branding for a dashboard's PNG and video exports. The footer
  includes the shared Wicked creator apple/handle and the site's current
  Lightning donation QR/address. Reserve space for the whole strip, reduce the
  URL font to fit in landscape. Portrait and square omit that URL and use the
  reclaimed space for the chart above a compact creator/donation footer.
- **Keep each dashboard's own composition.** Panel count, arrangement, chart
  types, legend placement, and meaningful metric colors stay dashboard-specific.
  Place the shared headline, wordmark, and footer around that composition;
  the standard does not impose Moving Average's three-panel layout or exact
  coordinates. Apply this policy to new exporters and export features being
  updated; track remaining older-export gaps under the adoption policy above.
- Export the selected series, units, dates, scales, and theme, subject to explicit
  export settings and the dashboard's documented live/published data policy.
  PNG captures the selected view. A paused animation export ends at its visible
  date, not a hidden future playback target; estimates use that same range.
  Controls must recover after success, cancellation, or failure, and unsupported
  export capabilities need a clear message.
- Use the shared deterministic video encoder, dimensions, estimates, and footer.
  All dashboards encode at `WSBDashboardExport.VIDEO_FPS` (30 fps), independent
  of playback speed. Use the same constant for duration estimates and holds.
  Use `renderProgress(button, fraction)` from preparation through encoding for
  the shared orange ring/stop-square animation; keep its node between updates.
  See [the progress lifecycle contract](README.md#video-cadence-and-download-progress).
  `encodeVideo()` selects H.264 MP4 at the requested dimensions when supported;
  genuine WebM is the fallback chosen before any frame is rendered.
  `encodeWebM()` remains the explicit WebM-only API. Use `videoExtension(blob)`
  for download filenames so the extension always matches the container.
  H.264 uses a larger bitrate budget for chart detail and encodes directly from
  the rendered canvas; it never transcodes a completed WebM. Both codecs are
  lossy, so validate decoded quality rather than claiming identical pixels.
  Keep video resolution selectable. Wait for fonts and decoded images before
  drawing; report an asset-loading failure instead of silently omitting branding
  or exporting with an unintended font. Give the export its own deliberate
  composition with stable geometry; do not enlarge a low-resolution screenshot.
- Submit each rendered frame once with deterministic timestamps and quality-mode
  encoding. The shared exporter bounds the encoder queue, yields while waiting,
  and validates that every submitted timestamp has exactly one encoded frame.
  Cancellation or failure closes the encoder and restores controls. Never
  restart rendering in another format after encoding has begun, because live
  final-frame snapshots must remain frozen.
- Apply the same axis and calculation rules to interactive and exported charts.
  Tick counts may differ with plot width. Validate every offered orientation and
  decode a real PNG/video; a successful download click does not prove correctness.
- Freeze the data/settings used by an export. For dashboards offering a live
  final frame, use published historical frames and capture one quote at the
  start of the final frame, holding that quote and derived values through the
  ending pause. Dashboards with published-only exports retain that policy. Do
  not mix publication generations halfway through a render.
- Moving Average's 30-degree labels, notebook-specific margins, prior-N-close
  SMA, and 16px interactive inset remain local contracts. They do not follow
  automatically from the shared export resolution, typography, and branding.

## Implementation references

| Concern | Shared implementation or reference |
| --- | --- |
| Shell, theme, controls | [dashboard_shared.css](shared/dashboard_shared.css), [dashboard_controls.css](shared/dashboard_controls.css), [dashboard_embed_modal.js](shared/dashboard_embed_modal.js) |
| Date-range, playback, and download control styling | [dashboard_playback.css](shared/dashboard_playback.css) — shared by Moving Average and EOE, including sizing, interaction states, and responsive rules |
| Dates, menus, playback keys, reset, timezone, loaders | [dashboard_components.js](shared/dashboard_components.js), [timezone preferences](../js/11_dashboard_timezone_preferences.js) |
| Plot geometry, calendar/value ticks, formatting, scale transitions | [dashboard_charting.js](shared/dashboard_charting.js) — `createCalendarTicks()` supplies shared UTC calendar selection |
| Share encoding and shell forwarding | [dashboard_share.js](shared/dashboard_share.js) |
| Publication refresh and previews | [webapp_data_auto_refresh.js](shared/webapp_data_auto_refresh.js), [preview_shared.js](shared/preview_shared.js) |
| Video encoding, dimensions, estimates, footer | [dashboard_export.js](shared/dashboard_export.js) |
| Export typography and branding | [dashboard_export_branding.js](shared/dashboard_export_branding.js) — bundled DejaVu Sans regular/bold, IBM Plex Mono Medium footer, and Bitcoin wordmark; [assets, licenses, and provenance](shared/export_assets/README.md) |
| Calendar label layout, bounded hover, stable export composition | [Moving Average charts](moving_average/moving_average_charts.js), [export renderer](moving_average/moving_average_export.js), [behavior notes](moving_average/README.md) — dashboard-specific presentation using shared calendar ticks |

Use the shared charting module's `createCalendarTicks()` for UTC date axes;
its [API guide](README.md#calendar-tick-selection) explains count-based selection
with measured label checks and span-based selection for stable export intervals.
Keep label text, rotation, and positioning with each renderer.
The export module encodes video and supplies dimensions and estimates; PNG
callers still request 2160 quality explicitly. Use the
[shared branding API](README.md#export-typography-and-branding) for font loading,
font roles, the wordmark, and canonical footer. Its assets and licenses live in
`shared/export_assets/` and are included by the Pages build. Moving Average uses
these helpers for both formats, including its bundled bold headline. Dashboard
renderers retain their composition, sizes, positions, and label policies.

## Acceptance evidence

Run focused checks for the feature changed; add a regression when it protects a
meaningful invariant. The [root README](../README.md#validation) lists commands.
`check_dashboard_contract.sh` checks source wiring, and browser smoke checks
document loading. Neither proves visual or behavioral compliance.

| Change | Evidence to collect |
| --- | --- |
| Axes, layout, controls | Actual rendered chart at 1440/1024px desktop and 390/320px mobile widths; dark/light; standalone and embedded; smallest/largest values and shortest/longest ranges; no clipped/overlapping labels or unreachable controls |
| Multi-year date ticks | Uniform 2/4/8… year gaps, calendar alignment, and correct spacing as plot width changes; check gridline positions as well as labels |
| Interaction or state | Keyboard/focus and pointer/touch behavior; reload persistence; shared link over conflicting stored preferences; reset/undo; reduced motion when animated |
| Playback or calculations | Early/insufficient history, calendar boundaries, pause/seek/resume/stop, no lookahead, and agreement between chart, KPIs, hover, and exports |
| Refresh or quotes | Isolated failure/race fixtures, last-good retention, publication supersession, hidden/resume behavior, and interaction/export deferral; never mutate live datasets for a test |
| Downloads | Real decoded output; exact PNG dimensions in the table above even after selecting a lower video quality; loaded reference fonts and wordmark; canonical URL footer; correct end date; readable labels; stable geometry; supported themes/orientations; failure recovery |
| Shared helper or packaging | Relevant consumer suites; Pages build tests/artifact inspection for new runtime dependencies |
| Authorized publication | Verify the deployed assets and changed behavior on the live route at desktop/mobile widths; separate a pushed commit from a verified deployment |

Record what was checked, any skipped coverage, and remaining adoption gaps.
Viewport emulation verifies responsive layout; identify separately whether a
physical touch device was tested. Screenshots should show the changed result.

## Open improvements to discuss

These are follow-up candidates, not claims of existing shared support or a
requirement to implement all of them during unrelated work.

1. **Calendar axis adoption:** use `createCalendarTicks()` when updating older
   UTC date axes, with local label policies and collision checks. Moving Average
   already uses it for its dashboard and exports; track other adoption gaps in
   the affected dashboard's README.
2. **Keyboard and touch access:** improve the shared date picker's focus and
   keyboard navigation, add larger invisible touch targets where compact controls
   need them, and choose a consistent tap/keyboard chart inspection interaction.
3. **Accessible data and methodology:** decide which charts need a selectable
   data table or CSV download, and standardize a concise source/formula/freshness
   explanation in the existing info popover.
4. **Export branding adoption:** use `WSBDashboardExportBranding` when updating
   older exporters, preserving dashboard-owned composition and keeping the
   encoder separate. Moving Average already uses the shared fonts and branding;
   record remaining adoption gaps in each affected dashboard's README.
5. **Reusable review fixtures and scaffold:** create a small shared dataset and
   browser harness covering tiny/large values, flat/empty history, long spans,
   stale feeds, and viewport changes. Improve the generator's incomplete theme,
   preview, and shell setup. Extend checks gradually without claiming a green
   wiring check means every visual standard has been tested.
