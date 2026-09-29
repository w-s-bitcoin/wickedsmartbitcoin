# Production data automation

These entry points run from the production `main` checkout:

| File | Trigger | Work |
| --- | --- | --- |
| `_run_1h.py` | Hourly cron, at :02 in the maintainer's local schedule | Bitcoin metrics notebook; Node Count, Dominance, DCA Cost Basis, DCA Comparison, UoA, Patoshi, and Casascius updates |
| `_run_onchain.py` | External `01 - CoreToPSQL.py` after new block ingestion | Current-chain top KPIs and issuance data; BIP-110 analysis only until its finalization height |
| `_git_deploy.py` | Called by either runner | Publish staged data on main, then mirror published data into dev |

The configured hourly cron checks PostgreSQL readiness, uses a nonblocking
`flock`, and has a 55-minute timeout. Bitcoin's `blocknotify` invokes the
external ingestion wrapper; the onchain runner is not a cron entry. These
scheduler/caller settings live on the production host, outside this repository.

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
in the scheduled user's keychain. Check `gh auth status` when publication fails.
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
