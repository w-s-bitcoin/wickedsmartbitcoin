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


# These overrides apply only to Git commands launched by production automation.
# Manual Git keeps the maintainer's YubiKey SSH authentication and signing.
AUTOMATION_GIT_CONFIG = (
    "-c", "url.https://github.com/.insteadOf=git@github.com:",
    "-c", "credential.helper=",
    "-c", "credential.helper=!/opt/homebrew/bin/gh auth git-credential",
    "-c", "commit.gpgsign=false",
)


def automation_git_command(cmd):
    return ["git", *AUTOMATION_GIT_CONFIG, *cmd[1:]] if cmd and cmd[0] == "git" else cmd


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
            automation_git_command(cmd),
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


def _staged_output_paths(run_dirs: list[Path]) -> set[str]:
    return {
        src.relative_to(run_dir / "files").as_posix()
        for run_dir in run_dirs
        for src in (run_dir / "files").rglob("*")
        if src.is_file()
    }


def _git_file_state(path: str, *, index: bool) -> tuple[str, str] | None:
    args = ["ls-files", "--stage", "-z", "--", path] if index else ["ls-tree", "-z", "HEAD", "--", path]
    rc, out, err = run(["git", *args], cwd=REPO, timeout=30)
    if rc != 0:
        raise RuntimeError(err or out or f"Cannot inspect {path}")
    entries = [entry for entry in out.split("\0") if entry]
    if not entries:
        return None
    fields = entries[0].split("\t", 1)[0].split()
    if len(entries) != 1 or len(fields) != 3 or (index and fields[2] != "0"):
        raise RuntimeError(f"Cannot recover conflicted path: {path}")
    return fields[0], fields[1] if index else fields[2]


def _disk_file_state(path: Path) -> tuple[str, str] | None:
    if path.is_symlink():
        raise RuntimeError(f"Cannot recover a symlink: {path}")
    if not path.exists():
        return None
    if not path.is_file():
        raise RuntimeError(f"Cannot recover a non-file path: {path}")
    rc, object_id, err = run(["git", "hash-object", "--no-filters", "--", str(path)], cwd=REPO, timeout=30)
    if rc != 0:
        raise RuntimeError(err or object_id or f"Cannot hash {path}")
    mode = "100755" if path.stat().st_mode & 0o111 else "100644"
    return mode, object_id


def _recover_retained_outputs(paths: list[str], retained_runs: list[Path]) -> bool:
    """Return another source's verified leftovers to HEAD without consuming its stage."""
    recoverable: list[tuple[str, tuple[str, str] | None, tuple[str, str] | None]] = []
    try:
        for path in paths:
            candidates = [run_dir / "files" / path for run_dir in retained_runs]
            states = {_disk_file_state(candidate) for candidate in candidates if candidate.exists()}
            states.discard(None)
            if not states:
                return False
            head_state = _git_file_state(path, index=False)
            index_state = _git_file_state(path, index=True)
            disk_state = _disk_file_state(REPO / path)
            # Both the working file and index must be either the untouched HEAD
            # version or an exact retained artifact, including executable mode.
            allowed = states | {head_state}
            if index_state not in allowed or disk_state not in allowed:
                return False
            recoverable.append((path, head_state, index_state))
    except RuntimeError as exc:
        print(f"⛔ Could not verify retained deployment outputs: {exc}")
        return False

    for path, head_state, index_state in recoverable:
        if head_state is not None or index_state is not None:
            rc, out, err = run(
                ["git", "restore", "--source=HEAD", "--staged", "--worktree", "--", path],
                cwd=REPO,
                timeout=30,
            )
            if rc != 0:
                print(f"⛔ Could not restore retained deployment output {path}: {err or out}")
                return False
        else:
            (REPO / path).unlink(missing_ok=True)
        print(f"ℹ️ Restored {path} to HEAD; its generated output remains staged for a later retry.")
    return True


def _ensure_only_deploy_changes(deploy_paths: set[str], *, retained_runs: list[Path] | None = None) -> bool:
    """Refuse to stash, reset, or publish unrelated production work."""
    changed_paths: set[str] = set()
    for args in (
        ["diff", "--name-only", "--no-renames", "-z"],
        ["diff", "--cached", "--name-only", "--no-renames", "-z"],
        ["ls-files", "--others", "--exclude-standard", "-z"],
    ):
        rc, out, err = run(["git", *args], cwd=REPO, timeout=30)
        if rc != 0:
            print(f"⛔ Could not inspect production worktree changes: {err or out}")
            return False
        changed_paths.update(path for path in out.split("\0") if path)
    unrelated = sorted(changed_paths - deploy_paths)
    if unrelated:
        if retained_runs and _recover_retained_outputs(unrelated, retained_runs):
            return True
        print("⛔ Unrelated production worktree changes found; leaving them untouched:")
        for path in unrelated:
            print(f"   {path}")
        return False
    return True


def _apply_staged_outputs(source: str | None = None, *, run_dirs: list[Path] | None = None) -> int:
    applied_files = 0
    if run_dirs is None:
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

    print(f"ℹ️ Applied staged output files: {applied_files}")
    if skipped_bip110_files:
        print(f"ℹ️ Skipped finalized BIP-110 dashboard staged files: {skipped_bip110_files}")
    return applied_files


def _discard_published_staging(run_dirs: list[Path]) -> None:
    for run_dir in run_dirs:
        shutil.rmtree(run_dir, ignore_errors=True)


def can_deploy() -> bool:
    return _sync_with_origin()


def _reconciled_origin_main() -> str | None:
    """Capture an explicit push lease whose remote history is in local HEAD."""
    rc, expected, err = run(
        ["git", "rev-parse", "--verify", "refs/remotes/origin/main^{commit}"],
        cwd=REPO,
        timeout=30,
    )
    if rc != 0:
        print(f"⛔ Could not capture the reconciled origin/main commit: {err or expected}")
        return None
    rc, out, err = run(
        ["git", "merge-base", "--is-ancestor", expected, "HEAD"], cwd=REPO, timeout=30
    )
    if rc != 0:
        print("⛔ origin/main changed before its push lease was captured; staging retained for the next deploy.")
        if err or out:
            print(err or out)
        return None
    return expected


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
        if get_current_branch() != "main":
            print("⛔ Deploy automation only runs from main.")
            return 1

        # Keep the selected generations available until GitHub accepts them.
        # A concurrent origin update can require resetting an automation commit
        # and reapplying these exact outputs before retrying the push.
        run_dirs = _list_stage_run_dirs_for_source(deploy_source)
        deploy_paths = _staged_output_paths(run_dirs) | {"assets/last_updated.txt"}
        retained_runs = [path for path in _list_stage_run_dirs() if path not in run_dirs]
        if not _ensure_only_deploy_changes(deploy_paths, retained_runs=retained_runs):
            return 1
        if not _sync_with_origin_preserving_worktree():
            return 1

        for attempt in range(2):
            expected_main = _reconciled_origin_main()
            if expected_main is None:
                return 1
            _apply_staged_outputs(run_dirs=run_dirs)
            assets = REPO / "assets"
            assets.mkdir(parents=True, exist_ok=True)
            ts = datetime.now(timezone.utc).strftime("Last updated on %B %d, %Y at %H:%M UTC")
            (assets / "last_updated.txt").write_text(ts)
            print(f"✅ Wrote timestamp to: {assets / 'last_updated.txt'}  ({ts})")

            if not _ensure_only_deploy_changes(deploy_paths):
                return 1
            # Some selected paths may be skipped because BIP-110 is finalized.
            # Only copied/existing outputs need to be added to the index.
            add_paths = sorted(path for path in deploy_paths if (REPO / path).is_file())
            rc, out, err = run(["git", "add", "--", *add_paths], cwd=REPO, timeout=90)
            if rc != 0:
                print(f"❌ git add failed: {err or out}")
                return 1
            rc, out, err = run(["git", "diff", "--cached", "--quiet"], cwd=REPO, timeout=30)
            if rc not in {0, 1}:
                print(f"❌ git diff --cached failed: {err or out}")
                return 1
            has_changes = rc == 1
            rc, last_msg, err = run(["git", "log", "-1", "--pretty=%s"], cwd=REPO, timeout=30)
            if rc != 0:
                print(f"❌ git log failed: {err or last_msg}")
                return 1
            amend_last = last_msg.strip() in AUTO_DEPLOY_SUBJECTS
            if has_changes:
                commit_args = ["--amend", "--no-edit"] if amend_last else ["-m", AUTO_DEPLOY_COMMIT_MESSAGE]
                rc, out, err = run(["git", "commit", *commit_args], cwd=REPO, timeout=90)
                if rc != 0:
                    print(f"❌ git commit failed: {err or out}")
                    return 1
            else:
                counts = get_ahead_behind("main")
                if counts is None:
                    return 1
                if counts == (0, 0):
                    print("✅ No unpublished deploy changes.")
                    break
                # The previous push may have failed after committing. Even if
                # this retry has identical files, its commit still needs a push.

            push_cmd = ["git", "push"]
            if amend_last:
                # Background fetches in another worktree can advance origin/main
                # after reconciliation. Bind the lease to this accepted commit.
                push_cmd.append(f"--force-with-lease=refs/heads/main:{expected_main}")
            push_cmd.extend(["origin", "main"])
            rc, out, err = run(push_cmd, cwd=REPO, timeout=PUSH_TIMEOUT_SECONDS)
            if rc == 0:
                print("✅ Snapshot committed and pushed to origin/main")
                break
            if out:
                print(out)
            if err:
                print(err)
            if attempt:
                print("❌ git push failed after retry; staged outputs retained for the next deploy.")
                return 1
            print("⚠️ Initial git push failed; reconciling origin and reapplying staged outputs for one retry.")
            if not _ensure_only_deploy_changes(deploy_paths):
                return 1
            if not _sync_with_origin_preserving_worktree():
                return 1

        _discard_published_staging(run_dirs)
        sync_published_data_to_dev("HEAD")
        if deploy_source == "onchain":
            _clear_onchain_pending()
        print("=" * 60)
        return 0
    finally:
        release_lock(LOCK_DEPLOY)


if __name__ == "__main__":
    raise SystemExit(main())
