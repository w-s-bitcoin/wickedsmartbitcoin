#!/usr/bin/env python3

import os
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path
from datetime import datetime, timezone

REPO = Path(__file__).resolve().parents[2]
STAGING_ROOT = Path("/tmp/animations_deploy_staging")
HOURLY_STAGE_COMPLETE_SENTINEL = ".complete"
LOCK_1H = Path("/tmp/animations_1h.lock")
LOCK_1D = Path("/tmp/animations_1d.lock")
LOCK_ONCHAIN = Path("/tmp/animations_onchain.lock")
LOCK_DEPLOY = Path("/tmp/animations_git_deploy.lock")
ONCHAIN_PENDING = Path("/tmp/animations_onchain_pending")
AUTO_DEPLOY_COMMIT_MESSAGE = "Update data"
LEGACY_DEPLOY_COMMIT_MESSAGE = "Updated images"
AUTO_DEPLOY_SUBJECTS = (AUTO_DEPLOY_COMMIT_MESSAGE, LEGACY_DEPLOY_COMMIT_MESSAGE)
FETCH_TIMEOUT_SECONDS = 120
PUSH_TIMEOUT_SECONDS = 300
GIT_SSH_CONNECT_TIMEOUT_SECONDS = 10
GIT_SSH_SERVER_ALIVE_INTERVAL_SECONDS = 15
GIT_SSH_SERVER_ALIVE_COUNT_MAX = 4
ONCHAIN_DEPLOY_WAIT_SECONDS = 120
BIP110_WEBAPP_DATA_REL = Path("webapps/bip110_signaling/webapp_data")
BIP110_FINAL_UPDATE_HEIGHT = 967_679
STAGED_PUBLICATION_MARKERS = {
    Path("assets/daily_price_metadata.json"),
    Path("webapps/bip110_signaling/webapp_data/bip110_metadata.json"),
    Path("webapps/bitcoin_dominance/webapp_data/published_generation.json"),
    Path("webapps/casascius_explorer/assets/right_panel_data.js"),
    Path("webapps/dca_comparison/webapp_data/published_generation.json"),
    Path("webapps/dca_comparison/webapp_data/last_updated.txt"),
    Path("webapps/dca_cost_basis/webapp_data/dca_cost_basis_metadata.json"),
    Path("webapps/issuance_rate/webapp_data/published_generation.json"),
    Path("webapps/node_count/webapp_data/published_generation.json"),
    Path("webapps/patoshi_pattern/webapp_data/patoshi_metadata.json"),
    Path("webapps/quantum_exposure/webapp_data/published_generation.json"),
    Path("webapps/uoa/webapp_data/last_updated.txt"),
}
DEV_DATA_SYNC_SCRIPT = Path(
    os.getenv("ANIMATIONS_DEV_DATA_SYNC_SCRIPT", str(REPO / "scripts" / "sync_main_data_to_dev.py"))
).expanduser()
DEV_REPO = Path(
    os.getenv("ANIMATIONS_DEV_REPO_DIR", str(REPO.parent / "wickedsmartbitcoin-dev"))
).expanduser()
DEV_BRANCH = os.getenv("ANIMATIONS_DEV_BRANCH", "dev/work").strip() or "dev/work"
DEV_DATA_SYNC_TIMEOUT_SECONDS = 10 * 60
DEV_DATA_SYNC_ENABLED = os.getenv("ANIMATIONS_SYNC_DEV_DATA", "1").strip().lower() not in {
    "0",
    "false",
    "no",
    "off",
}


def acquire_lock(path: Path, stale_seconds: int = 6 * 3600, wait_seconds: int = 0) -> bool:
    deadline = datetime.now(timezone.utc).timestamp() + wait_seconds
    if path.exists():
        while path.exists():
            try:
                pid = int(path.read_text().strip())
                os.kill(pid, 0)
                age = datetime.now(timezone.utc).timestamp() - path.stat().st_mtime
                if age > stale_seconds:
                    path.unlink(missing_ok=True)
                    print(f"ℹ️ Removed stale lock (age): {path}")
                    break
                if datetime.now(timezone.utc).timestamp() >= deadline:
                    print(f"⛔ Deploy already running (pid {pid}): {path}")
                    return False
                print(f"⏳ Waiting for active deploy to finish (pid {pid}).")
                time.sleep(5)
            except (ValueError, ProcessLookupError):
                path.unlink(missing_ok=True)
                print(f"ℹ️ Removed stale lock (dead process): {path}")
                break
            except PermissionError:
                if datetime.now(timezone.utc).timestamp() >= deadline:
                    print(f"⛔ Deploy lock exists and is owned by another user: {path}")
                    return False
                print(f"⏳ Waiting for deploy lock owned by another user: {path}")
                time.sleep(5)

    path.write_text(str(os.getpid()))
    return True


def release_lock(path: Path) -> None:
    path.unlink(missing_ok=True)


def run(cmd: list[str], cwd: Path | None = None, timeout: int | None = None) -> tuple[int, str, str]:
    env = os.environ.copy()
    env.setdefault("GIT_TERMINAL_PROMPT", "0")
    env.setdefault(
        "GIT_SSH_COMMAND",
        (
            "ssh "
            f"-o BatchMode=yes "
            f"-o ConnectTimeout={GIT_SSH_CONNECT_TIMEOUT_SECONDS} "
            f"-o ServerAliveInterval={GIT_SSH_SERVER_ALIVE_INTERVAL_SECONDS} "
            f"-o ServerAliveCountMax={GIT_SSH_SERVER_ALIVE_COUNT_MAX}"
        ),
    )
    try:
        p = subprocess.run(
            cmd,
            cwd=str(cwd) if cwd else None,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env,
        )
        return p.returncode, p.stdout.strip(), p.stderr.strip()
    except subprocess.TimeoutExpired as e:
        stdout = (e.stdout or "").strip()
        stderr = (e.stderr or "").strip()
        message = f"Command timed out after {timeout}s"
        if stderr:
            message = f"{message}\n{stderr}"
        return 124, stdout, message


def get_current_branch() -> str | None:
    rc, out, err = run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=REPO, timeout=30)
    if rc != 0:
        print("❌ Failed to determine current branch")
        if out:
            print(out)
        if err:
            print(err)
        return None
    return out.strip() or None


def fetch_origin() -> bool:
    rc, out, err = run(["git", "fetch", "origin"], cwd=REPO, timeout=FETCH_TIMEOUT_SECONDS)
    if rc == 0:
        return True
    print("⛔ git fetch origin failed; skipping deploy to avoid pushing stale history.")
    if out:
        print(out)
    if err:
        print(err)
    return False


def get_ahead_behind(branch: str) -> tuple[int, int] | None:
    rc, out, err = run(
        ["git", "rev-list", "--left-right", "--count", f"origin/{branch}...HEAD"],
        cwd=REPO,
        timeout=30,
    )
    if rc != 0:
        print(f"❌ Failed to compare HEAD with origin/{branch}")
        if out:
            print(out)
        if err:
            print(err)
        return None
    parts = out.split()
    if len(parts) != 2:
        print(f"❌ Unexpected rev-list output: {out!r}")
        return None
    behind = int(parts[0])
    ahead = int(parts[1])
    return ahead, behind


def get_local_only_subjects(branch: str) -> list[str] | None:
    rc, out, err = run(["git", "log", "--format=%s", f"origin/{branch}..HEAD"], cwd=REPO, timeout=30)
    if rc != 0:
        print(f"❌ Failed to inspect local-only commits against origin/{branch}")
        if out:
            print(out)
        if err:
            print(err)
        return None
    return [line.strip() for line in out.splitlines() if line.strip()]


def _preview_subjects(subjects: list[str]) -> str:
    preview = ", ".join(subjects[:3])
    if len(subjects) > 3:
        preview += ", ..."
    return preview


def _is_allowed_local_subject(subject: str, branch: str) -> bool:
    if subject in AUTO_DEPLOY_SUBJECTS:
        return True
    # Allow sync merge commits created by deploy reconciliation.
    if subject.startswith(f"Merge remote-tracking branch 'origin/{branch}'"):
        return True
    return False


def _reconcile_with_origin(branch: str, ahead: int, behind: int) -> bool:
    if behind == 0:
        return True

    if ahead == 0:
        print(f"ℹ️ Local branch is behind origin/{branch} by {behind} commit(s); fast-forwarding.")
        rc, out, err = run(["git", "merge", "--ff-only", f"origin/{branch}"], cwd=REPO, timeout=60)
        if rc != 0:
            print(f"⛔ git merge --ff-only origin/{branch} failed; skipping deploy.")
            if out:
                print(out)
            if err:
                print(err)
            return False
        return True

    local_subjects = get_local_only_subjects(branch)
    if local_subjects is None:
        return False

    non_auto_subjects = [subject for subject in local_subjects if not _is_allowed_local_subject(subject, branch)]
    if non_auto_subjects:
        print(
            f"⛔ Local branch diverged from origin/{branch} ({ahead} ahead, {behind} behind) with non-automation commits; skipping deploy."
        )
        print(f"ℹ️ Local-only commits: {_preview_subjects(non_auto_subjects)}")
        return False

    print(
        f"ℹ️ Local branch diverged from origin/{branch} ({ahead} ahead, {behind} behind) with automation-only commits; "
        "resetting to origin before applying staged outputs."
    )
    rc, out, err = run(
        ["git", "reset", "--hard", f"origin/{branch}"],
        cwd=REPO,
        timeout=60,
    )
    if rc != 0:
        print(f"⛔ git reset --hard origin/{branch} failed; skipping deploy.")
        if out:
            print(out)
        if err:
            print(err)
        return False
    return True


def _sync_with_origin() -> bool:
    branch = get_current_branch()
    if not branch:
        return False

    if branch != "main":
        print(f"⛔ Current branch is {branch}; deploy automation only pushes from main.")
        return False

    if not fetch_origin():
        return False

    counts = get_ahead_behind(branch)
    if counts is None:
        return False
    ahead, behind = counts

    if not _reconcile_with_origin(branch, ahead, behind):
        return False

    counts = get_ahead_behind(branch)
    if counts is None:
        return False
    ahead, behind = counts
    if behind:
        print(f"⛔ Branch still behind origin/{branch} after reconciliation; skipping deploy.")
        return False

    local_subjects = get_local_only_subjects(branch)
    if local_subjects is None:
        return False
    non_auto_subjects = [subject for subject in local_subjects if not _is_allowed_local_subject(subject, branch)]
    if non_auto_subjects:
        print("⛔ Local branch has non-automation commits not present on origin/main; skipping deploy.")
        print(f"ℹ️ Local-only commits: {_preview_subjects(non_auto_subjects)}")
        return False

    return True


def _sync_with_origin_preserving_worktree() -> bool:
    rc, out, err = run(["git", "status", "--porcelain"], cwd=REPO, timeout=30)
    if rc != 0:
        print("❌ git status failed")
        if out:
            print(out)
        if err:
            print(err)
        return False

    has_changes = bool(out.strip())
    if not has_changes:
        return _sync_with_origin()

    stash_name = f"automation-pre-sync-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"
    rc, stash_out, stash_err = run(["git", "stash", "push", "-u", "-m", stash_name], cwd=REPO, timeout=60)
    if rc != 0:
        print("❌ git stash push failed")
        if stash_out:
            print(stash_out)
        if stash_err:
            print(stash_err)
        return False

    sync_ok = _sync_with_origin()

    rc, pop_out, pop_err = run(["git", "stash", "pop"], cwd=REPO, timeout=60)
    if rc != 0:
        print("❌ git stash pop failed after sync; resolve manually before next deploy.")
        if pop_out:
            print(pop_out)
        if pop_err:
            print(pop_err)
        return False

    return sync_ok


def _list_stage_run_dirs() -> list[Path]:
    if not STAGING_ROOT.exists():
        return []
    run_dirs = [
        p
        for p in STAGING_ROOT.iterdir()
        if p.is_dir()
        and (p / "files").exists()
        and (
            not p.name.startswith("1h-")
            or (p / HOURLY_STAGE_COMPLETE_SENTINEL).is_file()
        )
    ]
    return sorted(run_dirs, key=lambda p: p.name)


def _list_stage_run_dirs_for_source(source: str | None = None) -> list[Path]:
    run_dirs = _list_stage_run_dirs()
    if source in {"onchain", "1h"}:
        return [p for p in run_dirs if p.name.startswith(f"{source}-")]
    return run_dirs


def _has_onchain_stage() -> bool:
    return bool(_list_stage_run_dirs_for_source("onchain"))


def _onchain_pending_is_current() -> bool:
    if not ONCHAIN_PENDING.exists():
        return False
    if _has_onchain_stage():
        return True
    try:
        pid = int(ONCHAIN_PENDING.read_text().splitlines()[0].strip())
        os.kill(pid, 0)
        return True
    except (IndexError, ValueError, ProcessLookupError):
        pass
    except PermissionError:
        return True

    age = datetime.now(timezone.utc).timestamp() - ONCHAIN_PENDING.stat().st_mtime
    if age <= 30 * 60:
        ONCHAIN_PENDING.unlink(missing_ok=True)
        print(f"ℹ️ Removed inactive onchain priority marker: {ONCHAIN_PENDING}")
        return False
    ONCHAIN_PENDING.unlink(missing_ok=True)
    print(f"ℹ️ Removed stale onchain priority marker: {ONCHAIN_PENDING}")
    return False


def _clear_onchain_pending() -> None:
    ONCHAIN_PENDING.unlink(missing_ok=True)


def _bip110_dashboard_finalized() -> bool:
    metadata_path = REPO / BIP110_WEBAPP_DATA_REL / "bip110_metadata.json"
    if not metadata_path.exists():
        return False
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        source_height = int(metadata.get("source_block_height"))
    except Exception as exc:
        print(f"ℹ️ Could not inspect BIP-110 finalization state: {exc}")
        return False
    return source_height >= BIP110_FINAL_UPDATE_HEIGHT


def _is_bip110_webapp_data_path(rel: Path) -> bool:
    return rel == BIP110_WEBAPP_DATA_REL or BIP110_WEBAPP_DATA_REL in rel.parents


def _apply_staged_outputs(source: str | None = None) -> int:
    applied_files = 0
    run_dirs = _list_stage_run_dirs_for_source(source)
    if not run_dirs:
        return applied_files

    skip_bip110_data = _bip110_dashboard_finalized()
    skipped_bip110_files = 0
    for run_dir in run_dirs:
        files_dir = run_dir / "files"
        staged_files = [src for src in files_dir.rglob("*") if src.is_file()]
        staged_files.sort(
            key=lambda src: (
                src.relative_to(files_dir) in STAGED_PUBLICATION_MARKERS,
                src.relative_to(files_dir).as_posix(),
            )
        )
        for src in staged_files:
            rel = src.relative_to(files_dir)
            if skip_bip110_data and _is_bip110_webapp_data_path(rel):
                skipped_bip110_files += 1
                continue
            dest = REPO / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest)
            applied_files += 1
        shutil.rmtree(run_dir, ignore_errors=True)

    print(f"ℹ️ Applied staged output files: {applied_files}")
    if skipped_bip110_files:
        print(f"ℹ️ Skipped finalized BIP-110 dashboard staged files: {skipped_bip110_files}")
    return applied_files


def can_deploy() -> bool:
    return _sync_with_origin()


def sync_published_data_to_dev(source_ref: str) -> None:
    """Best-effort mirror of published data that never blocks production deploys."""
    if not DEV_DATA_SYNC_ENABLED:
        print("ℹ️ Dev data sync disabled by ANIMATIONS_SYNC_DEV_DATA.")
        return
    if not DEV_DATA_SYNC_SCRIPT.is_file():
        print(f"⚠️ Dev data sync skipped; helper is missing: {DEV_DATA_SYNC_SCRIPT}")
        return
    if not DEV_REPO.is_dir():
        print(f"⚠️ Dev data sync skipped; repository is missing: {DEV_REPO}")
        return

    print(f"ℹ️ Syncing published data into {DEV_BRANCH} without stashing dev work.")
    try:
        rc, out, err = run(
            [
                sys.executable,
                str(DEV_DATA_SYNC_SCRIPT),
                "--source-repo",
                str(REPO),
                "--source-ref",
                source_ref,
                "--dev-repo",
                str(DEV_REPO),
                "--dev-branch",
                DEV_BRANCH,
            ],
            cwd=REPO,
            timeout=DEV_DATA_SYNC_TIMEOUT_SECONDS,
        )
    except Exception as exc:
        print(f"⚠️ Dev data sync failed safely after the production deploy: {exc}")
        return

    if out:
        print(out)
    if err:
        print(err)
    if rc != 0:
        print(f"⚠️ Dev data sync exited {rc}; production main remains deployed and unchanged.")


def main() -> int:
    deploy_source = os.getenv("ANIMATIONS_DEPLOY_SOURCE", "").strip().lower()
    if deploy_source not in {"onchain", "1h"}:
        deploy_source = None

    print("=" * 60)
    print("Git deployment triggered from run script")
    if deploy_source:
        print(f"Deploy source: {deploy_source}")
    print("=" * 60)

    deploy_wait = ONCHAIN_DEPLOY_WAIT_SECONDS if deploy_source == "onchain" else 0
    if not acquire_lock(LOCK_DEPLOY, wait_seconds=deploy_wait):
        return 1

    try:
        if deploy_source == "onchain":
            if LOCK_1D.exists():
                print("⛔ Daily run script is active. Aborting onchain git deployment.")
                return 1
        else:
            if LOCK_1H.exists() or LOCK_1D.exists() or LOCK_ONCHAIN.exists() or _onchain_pending_is_current() or _has_onchain_stage():
                print("⛔ Onchain-priority or run script work is active. Aborting lower-priority git deployment.")
                return 1

        if not REPO.exists():
            print(f"❌ Repo directory missing: {REPO}")
            return 1

        if not can_deploy():
            return 1

        applied_files = _apply_staged_outputs(deploy_source)
        if deploy_source == "onchain" and applied_files == 0:
            _clear_onchain_pending()

        assets = REPO / "assets"
        assets.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("Last updated on %B %d, %Y at %H:%M UTC")
        (assets / "last_updated.txt").write_text(ts)
        print(f"✅ Wrote timestamp to: {assets / 'last_updated.txt'}  ({ts})")

        if not _sync_with_origin_preserving_worktree():
            return 1

        run(["git", "add", "-A"], cwd=REPO, timeout=90)
        rc, out, err = run(["git", "diff", "--cached", "--quiet"], cwd=REPO, timeout=30)
        if rc == 0:
            print("✅ No deploy changes to commit.")
            sync_published_data_to_dev("origin/main")
            if deploy_source == "onchain":
                _clear_onchain_pending()
            return 0

        rc, last_msg, err = run(["git", "log", "-1", "--pretty=%s"], cwd=REPO, timeout=30)
        amend_last = (rc == 0 and last_msg.strip() in AUTO_DEPLOY_SUBJECTS)

        if amend_last:
            rc, out, err = run(["git", "commit", "--amend", "--no-edit"], cwd=REPO, timeout=90)
            if rc != 0:
                print("❌ git commit --amend failed")
                if out:
                    print(out)
                if err:
                    print(err)
                return 1
            push_cmd = ["git", "push", "--force-with-lease", "origin", "main"]
        else:
            rc, out, err = run(["git", "commit", "-m", AUTO_DEPLOY_COMMIT_MESSAGE], cwd=REPO, timeout=90)
            if rc != 0:
                print("❌ git commit failed")
                if out:
                    print(out)
                if err:
                    print(err)
                return 1
            push_cmd = ["git", "push", "origin", "main"]

        rc, out, err = run(push_cmd, cwd=REPO, timeout=PUSH_TIMEOUT_SECONDS)

        if rc != 0:
            print("⚠️ Initial git push failed; attempting one fetch/reconcile/retry.")
            if out:
                print(out)
            if err:
                print(err)

            if not _sync_with_origin_preserving_worktree():
                return 1

            rc, out, err = run(push_cmd, cwd=REPO, timeout=PUSH_TIMEOUT_SECONDS)
            if rc != 0:
                print("❌ git push failed after retry")
                if out:
                    print(out)
                if err:
                    print(err)
                return 1

        if amend_last:
            print("✅ Snapshot amended into latest automation commit and force-pushed to origin/main")
        else:
            print("✅ Snapshot committed and pushed to origin/main")
        sync_published_data_to_dev("HEAD")
        if deploy_source == "onchain":
            _clear_onchain_pending()
        print("=" * 60)
        return 0
    finally:
        release_lock(LOCK_DEPLOY)


if __name__ == "__main__":
    raise SystemExit(main())
