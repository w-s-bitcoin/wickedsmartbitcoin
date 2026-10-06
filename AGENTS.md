# Contributor and AI-agent instructions

These instructions apply throughout this repository. Read the
[README](README.md) for the architecture and choose the relevant deeper guide
before editing. Existing user authorization takes precedence over these
defaults; do not ask again for work the user has already authorized.

## Start with the checkout

- Inspect `git status --short --branch` before editing and before committing.
  Preserve unrelated changes; stage named files rather than sweeping the
  worktree into a commit.
- Work in the requested checkout. On the maintainer's machine, `main` is the
  production worktree and `dev/work` is a separate development worktree sharing
  the Git repository. A branch can be checked out in only one worktree.
- Automated data sync can advance `dev/work` while you work. Inspect new commits
  and diffs instead of resetting them away or assuming you created them.
- Source changes require an ordinary fetch/merge or other explicitly chosen Git
  operation. The production-to-dev helper synchronizes selected data only.
  Production's latest automation commit may be amended, so branch divergence
  alone does not mean file contents differ.
- Do not reset, clean, force-push, rewrite unrelated history, or operate on a
  neighboring production checkout as a routine way to resolve a conflict.
  Production publishing, scheduler edits, and database/data regeneration must
  be within the user's requested scope.

## Architecture boundaries

- This is a static site with plain JavaScript; there is no frontend package
  installation or bundler. Prefer existing helpers to new frameworks or
  dependencies.
- The homepage's numbered `js/` scripts share globals and load in order.
  Preserve their order, exported names, and shell DOM contracts.
- Routing spans root `<slug>.html` pages, `view.html`, `404.html`, homepage
  bootstrap/helpers, and dashboard standalone scripts. Check the affected
  entry points together. Local HTTP servers need `.html` URLs.
- Read [js/js_README.md](js/js_README.md) for homepage work.
  Read [webapps/README.md](webapps/README.md) and
  [DASHBOARD_TEMPLATE.md](DASHBOARD_TEMPLATE.md) for dashboard work.
- Reuse `webapps/shared/` controls, chart helpers, embedding, and
  deterministic WebM export; timezone preferences live in
  `js/11_dashboard_timezone_preferences.js`. Preserve theme, URL state,
  localStorage keys, keyboard behavior, iframe navigation, resizing, and
  playback unless the task calls for a change.
- Casascius has a custom application/shell and Quantum has a separate standalone
  controller. Do not force their filenames or markup into a generic pattern.
- `scripts/create_dashboard.sh` is a starter, not a complete homepage
  integration. New runtime files must also be included by the Pages build.

## Data and refresh contracts

- Treat `assets/`, `webapps/*/webapp_data/`, and Casascius `data/` as mixed
  source/generated areas; identify a file's producer before editing it.
  Do not regenerate large datasets just to validate a UI or documentation edit.
- Publication markers describe the exact payload generation. Update payloads
  first and markers last through the responsible producer. Never fabricate a
  hash or timestamp to make a check pass.
- Dashboard refresh follows prepare → validate → marker recheck → commit.
  Preserve the last complete visible generation when fetching or validation
  fails, and retain user selections, chart state, and playback.
- Preview adapters separate data installation from presentation. Hidden frames
  may install complete data but paint when visible; theme/resize handlers use
  cached data. Do not add periodic iframe navigation or full-page reloads.
- Use isolated fixtures or the existing browser fetch shims for race/failure
  tests. Do not rewrite live datasets under a running server to simulate an
  update.
- Preserve finalized BIP-110 data and the frozen Quantum archive URL and
  snapshot. Quantum analysis and per-block hooks are deprecated; do not restart
  them as part of routine work. GitHub Pages omits some raw/archive data by
  design; do not restore those files merely because a source checkout contains them.
- Keep personal Net Worth exports, credentials, `.env` files, logs, cache
  folders, and generated notebook outputs out of commits. Do not print secret
  configuration values while debugging.

## Production automation

Read [scripts/automation/README.md](scripts/automation/README.md) before changing
or invoking production jobs.

- `_run_1h.py`, `_run_onchain.py`, and `_git_deploy.py` are live production
  entry points, not smoke tests. They load local configuration, share staging
  and lock paths under `/tmp`, and can commit or push `main`. Running them
  from a development checkout is not an isolation mechanism.
- These runners do not parse CLI flags; even `--help` executes them. Inspect
  source instead. Some dashboard updaters also perform work at import time.
- Producer scripts may call PostgreSQL, Bitcoin RPC, or remote data services.
  Inspect entry points and defaults before running them. Use pure helpers,
  temporary directories, and disposable Git remotes for tests.
- Keep the deployer's main-branch guard, onchain priority, complete-hourly-stage
  marker, publication order, retryable staged outputs, and protection of
  unrelated worktree edits.
- Reserve `Update data`, `Updated images`, and `Sync production data ...`
  commit subjects for the automation that produces them. Deployment recovery
  uses automation subjects to distinguish generated history from source work.
- Data sync into dev must preserve dirty non-data work and defer overlapping
  data changes. It must not stash/reset a developer's work just to force a sync.
- Keep logs outside the repo. Never remove active lock files or staged runs
  simply to make a job proceed; inspect their owner and the relevant recovery
  logic.
- If a requested migration changes an entry point, inspect all actual callers:
  cron, the external block-ingestion caller, sibling deploy-script paths, and
  tests/docs. A Python file's location is not evidence of a scheduled job.

## Validation and delivery

Run commands from the repository root.

- Portable checks: `bash scripts/check_project.sh`. These use fixture repos and
  data validation, without running production producers.
- Dashboard contracts: `bash scripts/check_all_dashboards.sh` or
  `bash scripts/check_dashboard_contract.sh webapps/<slug>`.
- For rendering/refresh changes, run the relevant browser regressions listed in
  the README, setting `CHROME_BIN` as needed. The simple smoke script checks
  document loading only.
- For packaging changes, run `python3 scripts/test_pages_build.py` and
  `bash scripts/build_pages_dist.sh`; inspect the artifact when runtime
  dependencies changed. The build replaces ignored `dist/`; edit source files,
  never generated copies in `dist/`.
- Prefer focused checks tied to the change. Document skips, missing dependencies,
  and verification limits. If a publication check races an external data sync,
  confirm the generation has settled before retrying; do not alter markers.
- Review `git diff --check`, the final diff, and status. Do not include generated
  data or unrelated files just because a background job changed them.
- Report what changed, why, checks run, and remaining limitations. Commit,
  publish, or change production configuration only within the user's authorized
  scope.
