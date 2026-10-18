# Dashboard quick checklist

Start with [AGENTS.md](../AGENTS.md), then choose the relevant references:

| Need | Read |
| --- | --- |
| Chart, interaction, data, export, and review rules | [Shared dashboard standards](DASHBOARD_STANDARDS.md) |
| Shared scripts, theme, shell, routing, homepage integration | [Webapps guide](README.md) |
| Required scaffold files and control wiring | [Dashboard template](../DASHBOARD_TEMPLATE.md) |
| Architecture and test commands | [Repository README](../README.md) |
| Metric formulas, source data, and intentional exceptions | The target dashboard's README and current implementation |

## Build or update

1. Inspect the checkout and existing implementation. Reuse committed data or
   isolated fixtures; UI work does not require running a production producer.
2. Define the affected behavior and its calculation/data contract. For an older
   dashboard, adopt standards in that feature and track other gaps in its README.
3. Reuse shared shell, controls, theme, chart helpers, and refresh adapters. Use
   the [standards' implementation references](DASHBOARD_STANDARDS.md#implementation-references)
   to distinguish shared APIs from dashboard-local examples.
4. For a new dashboard, the generator provides a scaffold. Complete the real
   standalone shell, route maps, catalog, homepage preview, data adapter, and
   Pages packaging described in the webapps guide.
5. Preserve data generations, saved/share state, keyboard behavior, playback,
   and last-good rendering. Use shared atomic refresh rather than adding another
   polling loop or periodic iframe navigation.

## Verify and deliver

- Run the relevant contract and behavior checks from the repository root.
- Use the [acceptance matrix](DASHBOARD_STANDARDS.md#acceptance-evidence) for the
  feature changed. Check actual rendering at desktop/mobile widths and in both
  themes; a document-load smoke test is not a chart test.
- Inspect real exports when downloads change. Check live deployed behavior when
  publication is authorized, and distinguish that from local verification.
- Review the diff and status; preserve unrelated edits and generated data.
  Report checks, limitations, and remaining standards gaps.

The linked standards and integration guide own the detailed rules. Keep this
checklist short instead of duplicating implementation snippets that can drift.
