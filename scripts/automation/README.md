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
The DCA Cost Basis producer reads the newly staged `daily_price.csv` when the
hourly run has one, so its price, snapshot timestamp, and block height describe
the same generation. It reads the published checkout file when the source has
not changed.

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
A rejected push
causes one reconciliation and retry using the retained outputs. Changes in this
area must preserve both concurrent source-code updates and generated data.

After success, `scripts/sync_main_data_to_dev.py` creates a data snapshot commit
on `dev/work`. It preserves unrelated development edits and defers overlapping
data edits. It does not merge source-code changes from main.

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
