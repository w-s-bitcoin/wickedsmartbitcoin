# Production data automation

These scripts run from the production `main` checkout of this repository. The
hourly cron entry invokes `_run_1h.py`; Bitcoin Core's `blocknotify` pipeline
invokes `_run_onchain.py` from `01 - CoreToPSQL.py`. Both runners stage outputs
under `/tmp/animations_deploy_staging` and invoke `_git_deploy.py` to publish
data on `main`. The deploy script also mirrors published data into `dev/work`.

The animation source tree remains at `/Users/wicked/Projects/animations`.
`MAIN_DIR` and `ANIMATIONS_ENV_FILE` can override the source root and `.env`
location. `ANIMATIONS_REPO_DIR` can override the runner's repository checkout;
without it, each runner uses the checkout containing its script. The deploy
script always operates on the checkout containing `_git_deploy.py`.

The historical daily cleanup notebook and its disabled cron entry remain
outside this pipeline. Do not add runtime logs, notebooks with saved outputs,
generated images, or the animation `.env` to this directory.

## Unattended Git access

Onchain, hourly, and deploy runner Git commands use HTTPS through the GitHub CLI
credential helper and disable commit signing only for generated data commits.
Manual Git keeps the maintainer's YubiKey SSH authentication and signing.

The production account must stay logged in to `gh` with repository write access
in the scheduled user's keychain. Check `gh auth status` when publication fails.
Never store a token in this repository, script arguments, or logs.
