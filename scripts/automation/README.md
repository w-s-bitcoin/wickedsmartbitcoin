# Production data automation

**Quantum is deprecated and archived — 2026-10-06.** Its scheduler is not
installed, and the external block-ingestion hook has been removed. The published
legacy snapshot is frozen at **961000**; no validated v2 snapshot was published.
The incomplete v2 projection stopped at anchor **962000**, with **262,192,306**
processed occurrences and creation cursor height **378478**. See the
[archived findings](../../quantum_exposure_findings.html). Quantum commands and
installation instructions below are historical reference only. Do not run them
or reconnect Quantum to production automation without a new project decision.

Production entry points use the `main` checkout. The retired Quantum worker
remains there as archive material:

| File | Trigger | Work |
| --- | --- | --- |
| `_run_1h.py` | User LaunchAgent, at :02 in the maintainer's local schedule | Bitcoin metrics notebook; Node Count, Dominance, DCA Cost Basis, DCA Comparison, UoA, Patoshi, and Casascius updates |
| `_run_onchain.py` | External `01 - CoreToPSQL.py` after new block ingestion | Current-chain top KPIs and issuance data; BIP-110 analysis only until its finalization height |
| `_git_deploy.py` | Called by either runner | Publish staged data on main, then mirror published data into dev |
| `webapps/quantum_exposure/pipeline/run_quantum_worker.py` | Retired; no scheduler installed | Historical design for projection and website/standalone delivery |

The configured hourly user LaunchAgent checks PostgreSQL readiness and the
external `.storage-maintenance` gate, uses a nonblocking `flock`, and has a
55-minute timeout. Bitcoin's `blocknotify` invokes the
external ingestion wrapper; the onchain runner is not a cron entry. These
scheduler/caller settings live on the production host, outside this repository.

Quantum is not invoked by either producer runner or by external block
ingestion. The retained worker and delivery code are inactive archive material.
The [Quantum operating guide](../../webapps/quantum_exposure/pipeline/OPERATIONS_V2.md)
documents the old design and its unfinished acceptance status.

## Local paths and configuration

The animation source tree remains at `/Users/wicked/Projects/animations`.
The runners load its external `.env`; do not copy it into this repository.

| Setting | Purpose |
| --- | --- |
| `MAIN_DIR` | External animation/notebook source root |
| `ANIMATIONS_ENV_FILE` | Override the external configuration file path |
| `ANIMATIONS_REPO_DIR` | Override the runner's producer/output checkout; defaults to the checkout containing the runner |
| `ANIMATIONS_SYNC_DEV_DATA` | Enable/disable the deployer's best-effort dev data mirror |
| `ANIMATIONS_DEV_REPO_DIR`, `ANIMATIONS_DEV_BRANCH` | Destination worktree and branch for that mirror |
| `ANIMATIONS_DEV_DATA_SYNC_SCRIPT` | Override the mirror helper path |

The sibling deployer always operates on the checkout containing
`_git_deploy.py`. Keep `ANIMATIONS_REPO_DIR` pointed at that same production
checkout. It is not an isolated-output or dry-run option.

All runners use shared `/tmp/animations_*` lock/priority paths and
`/tmp/animations_deploy_staging`. A development checkout shares these paths
with production on the same host. Do not run a second checkout's automation as
a test.

## Publication lifecycle

The hourly runner stages outputs and exposes a `.complete` marker after its
phases finish. The deployer ignores incomplete hourly stages. Casascius gets a
temporary workspace containing its updater, generator, and required data/code
inputs; its static image library is not copied.
Casascius overall summary counts include all tracker rows, even when their coin
type is unknown. Per-type summaries include only classified rows. Regenerate
the right-panel payload and its embedded publication metadata together with
`python3 webapps/casascius_explorer/scripts/generate_right_panel_data.py` after
changing the tracker or summary logic; this generator only reads local inputs.
The DCA Cost Basis producer reads the newly staged `daily_price.csv` when the
hourly run has one, so its price, snapshot timestamp, and block height describe
the same generation. It reads the published checkout file when the source has
not changed.
UoA runs before DCA Comparison, whose home-card preview reads the run's staged
Bitcoin and FX CSVs. If either producer has no staged replacement, Comparison
uses that input's last published file instead.

Onchain work has priority. Current-chain top KPIs are built from the complete
ingested `blockheader` snapshot and can publish before slower issuance work.
Finalized BIP-110 payloads are kept frozen according to the configured
finalization boundary; ending that analysis does not stop the other onchain
outputs.

The deployer selects staged generations, checks the production worktree,
reconciles main with origin, copies payloads before their publication markers,
and stages only selected output paths. Unrelated staged, unstaged, or untracked
work blocks publication. Staged generations are retained until publication
succeeds so failures can be retried.

A failed attempt can leave generated files in the worktree or index. Another
source's deployment recovers those leftovers only when their content and file
mode match a retained staged artifact or the existing HEAD version. It restores
those paths to HEAD and keeps their staged generation for a later retry. A
different manual edit blocks recovery.

A data publication creates an `Update data` commit or amends the latest
automation commit. Amended history is pushed with a lease bound to the origin
commit accepted during reconciliation, so a background fetch cannot weaken it.
A new or amended data commit uses
`WSB Data Sync <automation@wickedsmartbitcoin.local>` as both author and committer. Amendments
replace any previous personal author; automated recovery merges use the same
identity. These overrides apply only to automation subprocesses and leave manual
Git configuration and existing source commits unchanged. Consecutive data pushes
retain one data commit until a source change starts a new publication sequence.
A rejected push
causes one reconciliation and retry using the retained outputs. Changes in this
area must preserve both concurrent source-code updates and generated data.

If a prior data commit was amended upstream while production has a newer local
data commit, either producer may merge those sibling commits before staging.
This recovery is limited to clean `main` tips with a later local publication
timestamp. Changed data paths must either match exactly, or the remote paths
must be a subset whose payloads and modes already match the local tree. This
also covers an hourly amend that includes an earlier onchain publication.
The merge keeps the newer complete local generation and records upstream
ancestry; any other divergence still blocks the run for inspection.
Failed Git preflight does not create an onchain staging directory. Empty staging
directories from older failed runs do not hold priority over hourly work; active
onchain locks and nonempty unpublished outputs still do.

After success, `scripts/sync_main_data_to_dev.py` prepares and validates a
data-only snapshot, then installs it through a fast-forward on `dev/work`.
When the resulting checkout is clean and its complete tree matches the pinned
published main commit, the helper reuses that commit instead of retaining a
separate development snapshot. It also collapses an existing identical, clean
snapshot when no new data needs copying. The final branch update checks the
expected old commit and never writes the index or working files.

Staged, unstaged, or untracked development work keeps its snapshot history and
is preserved in place. Overlapping data edits defer the sync. Committed source
differences or locally completed publication markers also keep a separate
snapshot; the helper does not import source-code changes from main or discard
development changes to force the trees to match. Active merges, rebases, and
other Git operations defer syncing. Dirty work is rechecked after installation
so edits made during sync also prevent history cleanup.

## Pages build and deployment queue

`.github/workflows/deploy-pages.yml` runs on each push to `main`. Builds are
independent, with no workflow-wide lock or build cancellation. A delayed older
run cannot hold up or cancel a newer build. Before checkout and again before
artifact upload, each run reads the current `refs/heads/main` from GitHub and
compares the complete SHA with its triggering commit. Superseded runs skip the
remaining work. Checkout stays pinned to the triggering commit, so the artifact
and its deployment identity describe the same generation.

Only the `deploy` job uses concurrency group `pages`, preserving compatibility
with an earlier workflow still using that group. It does not cancel an active
deployment. `queue: max` keeps multiple pending jobs: GitHub orders jobs by when
they enter the queue, so the default single pending slot could let a delayed old
build displace the newest artifact. Once a deploy job obtains the slot, it reads
`main` again immediately before `deploy-pages`; outdated artifacts skip without
publishing, while API failures fail closed. Exact SHA equality also handles the
automation's amended commits; ancestry, timestamps, and commit subjects are not
freshness checks.

All source/publication checks, Pages packaging validation, and the daily image
cache/capture behavior still run for eligible builds. Build jobs have a
15-minute timeout. Deploy jobs have a five-minute limit, with four minutes for
the Pages action to complete or cancel its own deployment. GitHub scheduling
and service delays remain external; the guard is not an atomic compare-and-publish,
so a push after the final check can briefly leave an active deployment behind.
The next eligible serialized deployment then catches up.

The onchain runner still publishes top KPIs before slower issuance work and
publishes the completed secondary output afterward. Those pushes retain their
existing publication order; the workflow discards superseded artifacts.
The isolated workflow regressions are included in `scripts/check_project.sh`
and can be run directly with `python3 -m unittest scripts.test_pages_workflow`.

See [GitHub's concurrency behavior](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
for queue limits and ordering.

## Unattended Git access

Onchain, hourly, and deploy runner Git commands use HTTPS through the GitHub CLI
credential helper and disable commit signing only for generated data commits.
Manual Git keeps the maintainer's YubiKey SSH authentication and signing.

The production account must stay logged in to `gh` with repository write access
in the scheduled user's keychain. The host runs the hourly job using
`~/Library/LaunchAgents/com.wickedsmartbitcoin.hourly.plist` in the logged-in
GUI user session. A same-UID credential probe on 2026-10-04 succeeded there
and failed under cron; the old hourly cron entry was removed. The ten-minute
price logger remains in cron. Do not enable both hourly schedules. Check
`gh auth status` when publication fails.
Never store a token in this repository, script arguments, or logs.

## Development and checks

The runners have no CLI argument parser: even invoking them with `--help`
executes their production behavior. Read their source to inspect configuration.
Use the contributor checks instead:

```bash
bash scripts/check_project.sh
```

The focused tests use disposable local Git repositories and temporary
workspaces. They do not execute production producers or push to GitHub.

The normal frontend can be served from committed data with
`python3 -m http.server`. Production producers additionally require the
maintainer's database/network access and Python environment; dependencies vary
by producer and are not needed for frontend work.

Keep runtime logs outside the repository. The current hourly log remains at
`/Users/wicked/Projects/animations/_Run_All/cron_1h_log.txt`. Historical image
cleanup and its disabled daily runner remain external and are not part of
these entry points.
