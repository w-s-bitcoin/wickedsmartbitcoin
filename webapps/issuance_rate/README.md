# Issuance Rate

The dashboard and homepage preview show Bitcoin's scheduled subsidy supply and
annualized issuance. Historical rows and timezone-specific daily totals remain
on the existing node-produced publication pipeline. They are validated against
`webapp_data/published_generation.json`, including payload hashes and bounds,
then the marker is rechecked before a complete generation is installed.
Failures retain the last complete view.

## Live current view

`issuance_live.js` uses the shared `bitcoin_chain_tip.js` connection to
mempool.space. It fetches a bounded recent header window from the public
`/api/v1/blocks/<height>` endpoint, validates consecutive heights and parent
hashes, and confirms the canonical tip before installing the window. A new
WebSocket block linked to the verified cache can update the calculation without
waiting for Pages and normally makes no additional REST request. Gaps and
reorgs trigger bounded REST catch-up: at most 32 pages of up to 15 headers per
attempt. If that is insufficient, the last complete or published calculation
remains visible; rate limits use backoff. Hidden/offline views pause their requests and resume on return.
No service hosting, price feed, or producer change is needed.

The rolling window ends at the accepted block's miner timestamp. Starting at
that tip, the helper follows parent hashes to the first block whose timestamp
is at or before 24 hours earlier. With tip H and boundary B:

- Supply is the existing dashboard's scheduled subsidy total S(H), including
  genesis; it is distinct from actual claimed subsidy in the homepage supply KPI.
- Rolling issuance is S(H) minus S(B), and the block count is H minus B.
- Annualized issuance is rolling issuance times 365 divided by S(H).
- Target issuance is 144 times the current subsidy. On a halving day with a
  published adjacent previous-day boundary, the projection preserves the
  producer's weighting of old and new subsidies across that UTC day. Without
  that known boundary it uses the current subsidy target. The target rate uses
  the live scheduled supply denominator.

Following parent hashes handles miner timestamps that do not increase with
height. The unchanged producer uses a binary search over height-ordered miner
timestamps; around a timestamp inversion, its published boundary can differ
from the live helper's highest matching ancestor. The live method is explicit
in the rolling-window tooltip; it does not rewrite historical calculations.
A complete live projection updates the current row, or adds one current
UTC-day row when the publication is older. It never invents intermediate daily
history. Same-height replacements and shorter authoritative reorgs retain their
replacement-chain authority until reconciled. A matching publication supersedes
the provisional row; malformed, incomplete, failed, or superseded requests leave
the last complete calculation available.

Historical selections and playback retain the published dataset. An export
freezes the displayed rows at its start: historical frames use the publication,
and its current-date frame can include the live row available at capture time.
Later blocks do not change a render in progress. The live current view remains
separate from the stored published rows. The preview uses the
same projection and the shared prepare/validate/commit/present lifecycle; hidden
previews defer painting. Its canvas exposes the displayed height, date, and
live/retained/published provenance in accessible text and diagnostic data
attributes. A feed outage retains the last usable values without an alert.

## Validation and remaining adoption work

Focused checks are `node --test scripts/test_issuance_live.mjs`,
`python3 scripts/test_dashboard_chain_live_browser.py`, and
`bash scripts/check_dashboard_contract.sh webapps/issuance_rate`. The existing
stage-3 browser regression exercises publication atomicity and preservation of
state. Fixtures use isolated headers and publication bytes, never production
producer runs or rewritten live datasets.

The older preview's chart padding and the dashboard's existing export layout
remain unchanged by this live-feed update. Broader visual/accessibility migration
follows the shared dashboard standards separately; physical touch devices have
not been tested for this change.
