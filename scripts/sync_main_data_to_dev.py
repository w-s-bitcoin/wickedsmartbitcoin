#!/usr/bin/env python3
"""Mirror production data into a local dev worktree without disturbing dirty code.

The production deploy branch deliberately rewrites its latest automation commit,
so replaying those commits directly is not idempotent. This tool instead builds a
data-only snapshot commit on top of the current dev HEAD with Git plumbing, then
fast-forwards the dev branch when its dirty paths do not overlap the snapshot.
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path, PurePosixPath


DEFAULT_DEV_BRANCH = "dev/work"
DEFAULT_LOCK_PATH = Path("/tmp/animations_dev_data_sync.lock")
SYNC_SOURCE_REF = "refs/automation/dev-data-sync-main"
SYNC_COMMIT_PREFIX = "Sync production data"
STALE_LOCK_SECONDS = 6 * 3600
COMMAND_TIMEOUT_SECONDS = 180
BLOCK_DATA_RE = re.compile(r"^assets/block_data_\d+_\d+\.csv$")
ASSET_DATA_PATHS = {
    "assets/btcusd_10m_prices.csv",
    "assets/daily_price.csv",
    "assets/last_updated.txt",
    "assets/top_kpis.json",
}
CASASCIUS_DATA_PATHS = {
    "webapps/casascius_explorer/assets/right_panel_data.js",
    "webapps/casascius_explorer/data/casascius_explorer.csv",
    "webapps/casascius_explorer/data/casascius_explorer_update_state.json",
}


class SyncError(RuntimeError):
    pass


@dataclass(frozen=True)
class SyncOutcome:
    status: str
    source_commit: str
    dev_commit: str
    paths: tuple[str, ...] = ()


def run_git(
    repo: Path,
    args: list[str],
    *,
    env: dict[str, str] | None = None,
    input_text: str | None = None,
    check: bool = True,
    timeout: int = COMMAND_TIMEOUT_SECONDS,
) -> subprocess.CompletedProcess[str]:
    command_env = os.environ.copy()
    command_env.setdefault("GIT_TERMINAL_PROMPT", "0")
    if env:
        command_env.update(env)
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=str(repo),
            env=command_env,
            input=input_text,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise SyncError(f"git {' '.join(args)} timed out after {timeout}s") from exc
    if check and result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or f"exit {result.returncode}"
        raise SyncError(f"git {' '.join(args)} failed: {detail}")
    return result


def git_text(repo: Path, args: list[str], **kwargs) -> str:
    return run_git(repo, args, **kwargs).stdout.strip()


def git_nul_paths(repo: Path, args: list[str]) -> set[str]:
    result = subprocess.run(
        ["git", *args],
        cwd=str(repo),
        env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
        capture_output=True,
        timeout=COMMAND_TIMEOUT_SECONDS,
        check=False,
    )
    if result.returncode != 0:
        detail = result.stderr.decode(errors="replace").strip() or f"exit {result.returncode}"
        raise SyncError(f"git {' '.join(args)} failed: {detail}")
    return {
        value.decode("utf-8", errors="surrogateescape")
        for value in result.stdout.split(b"\0")
        if value
    }


def resolve_commit(repo: Path, ref: str) -> str:
    return git_text(repo, ["rev-parse", "--verify", f"{ref}^{{commit}}"])


def optional_ref(repo: Path, ref: str) -> str | None:
    result = run_git(repo, ["rev-parse", "--verify", f"{ref}^{{commit}}"], check=False)
    return result.stdout.strip() if result.returncode == 0 else None


def is_data_path(raw_path: str) -> bool:
    path = PurePosixPath(raw_path)
    parts = path.parts
    if raw_path in ASSET_DATA_PATHS or BLOCK_DATA_RE.fullmatch(raw_path):
        return True
    if raw_path in CASASCIUS_DATA_PATHS:
        return True
    return len(parts) >= 4 and parts[0] == "webapps" and parts[2] == "webapp_data"


def changed_data_paths(repo: Path, baseline: str, source_commit: str) -> list[str]:
    changed = git_nul_paths(
        repo,
        ["diff", "--no-renames", "--name-only", "-z", baseline, source_commit],
    )
    return sorted(path for path in changed if is_data_path(path))


def dirty_paths(repo: Path) -> set[str]:
    paths = set()
    paths.update(git_nul_paths(repo, ["diff", "--name-only", "-z"]))
    paths.update(git_nul_paths(repo, ["diff", "--cached", "--name-only", "-z"]))
    paths.update(git_nul_paths(repo, ["ls-files", "--others", "--exclude-standard", "-z"]))
    return paths


def paths_overlap(left: str, right: str) -> bool:
    return left == right or left.startswith(f"{right}/") or right.startswith(f"{left}/")


def overlapping_paths(dirty: set[str], updates: set[str]) -> list[str]:
    return sorted(
        dirty_path
        for dirty_path in dirty
        if any(paths_overlap(dirty_path, update_path) for update_path in updates)
    )


def ensure_no_git_operation(repo: Path) -> None:
    for marker in ("MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "REBASE_HEAD"):
        marker_path = Path(git_text(repo, ["rev-parse", "--git-path", marker]))
        if not marker_path.is_absolute():
            marker_path = repo / marker_path
        if marker_path.exists():
            raise SyncError(f"dev worktree has an active Git operation ({marker}); deferring data sync")
    index_lock = Path(git_text(repo, ["rev-parse", "--git-path", "index.lock"]))
    if not index_lock.is_absolute():
        index_lock = repo / index_lock
    if index_lock.exists():
        raise SyncError("dev worktree index is locked; deferring data sync")


def ensure_source_object(dev_repo: Path, source_repo: Path, source_ref: str, source_commit: str) -> str:
    present = run_git(dev_repo, ["cat-file", "-e", f"{source_commit}^{{commit}}"], check=False)
    if present.returncode == 0:
        return source_commit
    run_git(dev_repo, ["fetch", "--no-tags", str(source_repo), source_ref])
    fetched = resolve_commit(dev_repo, "FETCH_HEAD")
    if fetched != source_commit:
        raise SyncError(f"source moved during sync ({source_commit[:12]} -> {fetched[:12]}); retrying later")
    return fetched


def source_tree_entry(repo: Path, source_commit: str, path: str) -> tuple[str, str] | None:
    result = run_git(repo, ["ls-tree", source_commit, "--", path])
    line = result.stdout.strip()
    if not line:
        return None
    metadata, actual_path = line.split("\t", 1)
    mode, object_type, object_id = metadata.split()
    if actual_path != path or object_type != "blob":
        raise SyncError(f"unsupported source tree entry for {path}: {line}")
    return mode, object_id


def create_data_snapshot_commit(
    repo: Path,
    dev_head: str,
    source_commit: str,
    paths: list[str],
) -> str | None:
    descriptor, index_name = tempfile.mkstemp(prefix="wsb-dev-data-index-", dir="/tmp")
    os.close(descriptor)
    index_path = Path(index_name)
    index_path.unlink(missing_ok=True)
    index_env = {"GIT_INDEX_FILE": str(index_path)}
    try:
        run_git(repo, ["read-tree", dev_head], env=index_env)
        for path in paths:
            entry = source_tree_entry(repo, source_commit, path)
            if entry is None:
                run_git(repo, ["update-index", "--force-remove", "--", path], env=index_env)
                continue
            mode, object_id = entry
            run_git(
                repo,
                ["update-index", "--add", "--cacheinfo", mode, object_id, path],
                env=index_env,
            )

        snapshot_tree = git_text(repo, ["write-tree"], env=index_env)
        dev_tree = git_text(repo, ["rev-parse", f"{dev_head}^{{tree}}"])
        if snapshot_tree == dev_tree:
            return None

        short_source = source_commit[:12]
        identity_env = {
            "GIT_AUTHOR_NAME": "WSB Data Sync",
            "GIT_AUTHOR_EMAIL": "automation@wickedsmartbitcoin.local",
            "GIT_COMMITTER_NAME": "WSB Data Sync",
            "GIT_COMMITTER_EMAIL": "automation@wickedsmartbitcoin.local",
        }
        return git_text(
            repo,
            ["commit-tree", snapshot_tree, "-p", dev_head],
            env=identity_env,
            input_text=f"{SYNC_COMMIT_PREFIX} from main {short_source}\n",
        )
    finally:
        index_path.unlink(missing_ok=True)


def snapshot_commit_paths(repo: Path, dev_head: str, snapshot_commit: str) -> set[str]:
    return git_nul_paths(
        repo,
        ["diff", "--no-renames", "--name-only", "-z", dev_head, snapshot_commit],
    )


def update_sync_ref(repo: Path, source_commit: str) -> None:
    run_git(repo, ["update-ref", SYNC_SOURCE_REF, source_commit])


def synchronize(
    source_repo: Path,
    source_ref: str,
    dev_repo: Path,
    dev_branch: str,
    *,
    dry_run: bool = False,
) -> SyncOutcome:
    source_repo = source_repo.resolve()
    dev_repo = dev_repo.resolve()
    if not source_repo.is_dir() or not dev_repo.is_dir():
        raise SyncError("source or dev repository directory is missing")

    source_commit = resolve_commit(source_repo, source_ref)
    source_commit = ensure_source_object(dev_repo, source_repo, source_ref, source_commit)
    current_branch = git_text(dev_repo, ["symbolic-ref", "--quiet", "--short", "HEAD"])
    if current_branch != dev_branch:
        raise SyncError(f"dev worktree is on {current_branch!r}, expected {dev_branch!r}; deferring data sync")
    ensure_no_git_operation(dev_repo)

    dev_head = resolve_commit(dev_repo, "HEAD")
    last_source = optional_ref(dev_repo, SYNC_SOURCE_REF)
    baseline = last_source or git_text(dev_repo, ["merge-base", dev_head, source_commit])
    candidates = changed_data_paths(dev_repo, baseline, source_commit)
    if not candidates:
        if not dry_run:
            update_sync_ref(dev_repo, source_commit)
        return SyncOutcome("up-to-date", source_commit, dev_head)

    snapshot_commit = create_data_snapshot_commit(dev_repo, dev_head, source_commit, candidates)
    if snapshot_commit is None:
        if not dry_run:
            update_sync_ref(dev_repo, source_commit)
        return SyncOutcome("up-to-date", source_commit, dev_head)

    update_paths = snapshot_commit_paths(dev_repo, dev_head, snapshot_commit)
    overlap = overlapping_paths(dirty_paths(dev_repo), update_paths)
    if overlap:
        print("⏭️ Dev data sync deferred; uncommitted work overlaps production data paths:")
        for path in overlap:
            print(f"   - {path}")
        return SyncOutcome("deferred-overlap", source_commit, dev_head, tuple(sorted(update_paths)))

    if dry_run:
        return SyncOutcome("would-sync", source_commit, dev_head, tuple(sorted(update_paths)))

    ensure_no_git_operation(dev_repo)
    if resolve_commit(dev_repo, "HEAD") != dev_head:
        raise SyncError("dev HEAD changed during data sync; deferring until the next deploy")
    if git_text(dev_repo, ["symbolic-ref", "--quiet", "--short", "HEAD"]) != dev_branch:
        raise SyncError("dev branch changed during data sync; deferring until the next deploy")

    merge = run_git(dev_repo, ["merge", "--ff-only", snapshot_commit], check=False)
    if merge.returncode != 0:
        detail = merge.stderr.strip() or merge.stdout.strip() or f"exit {merge.returncode}"
        raise SyncError(f"dev data fast-forward was refused without changing the worktree: {detail}")

    merged_head = resolve_commit(dev_repo, "HEAD")
    if merged_head != snapshot_commit:
        raise SyncError("dev data sync did not land at the expected snapshot commit")
    update_sync_ref(dev_repo, source_commit)
    return SyncOutcome("synced", source_commit, merged_head, tuple(sorted(update_paths)))


def acquire_lock(path: Path) -> bool:
    path.parent.mkdir(parents=True, exist_ok=True)
    while True:
        try:
            descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            with os.fdopen(descriptor, "w") as handle:
                handle.write(f"{os.getpid()}\n{int(time.time())}\n")
            return True
        except FileExistsError:
            try:
                lines = path.read_text().splitlines()
                pid = int(lines[0])
                os.kill(pid, 0)
                age = time.time() - path.stat().st_mtime
                if age <= STALE_LOCK_SECONDS:
                    return False
            except (OSError, ValueError, IndexError):
                pass
            path.unlink(missing_ok=True)


def parse_args() -> argparse.Namespace:
    script_repo = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-repo", type=Path, default=script_repo)
    parser.add_argument("--source-ref", default="HEAD")
    parser.add_argument("--dev-repo", type=Path, default=script_repo.parent / "wickedsmartbitcoin-dev")
    parser.add_argument("--dev-branch", default=DEFAULT_DEV_BRANCH)
    parser.add_argument("--lock-path", type=Path, default=DEFAULT_LOCK_PATH)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not acquire_lock(args.lock_path):
        print(f"⏭️ Dev data sync already running; leaving {args.dev_branch} untouched.")
        return 0
    try:
        outcome = synchronize(
            args.source_repo,
            args.source_ref,
            args.dev_repo,
            args.dev_branch,
            dry_run=args.dry_run,
        )
        if outcome.status == "synced":
            print(
                f"✅ Synced {len(outcome.paths)} production data file(s) into {args.dev_branch} "
                f"at {outcome.dev_commit[:12]}; uncommitted non-data work was preserved in place."
            )
        elif outcome.status == "would-sync":
            print(f"ℹ️ Dry run: would sync {len(outcome.paths)} data file(s) into {args.dev_branch}.")
        elif outcome.status == "up-to-date":
            print(f"✅ {args.dev_branch} production data is already current.")
        return 0
    except SyncError as exc:
        print(f"⚠️ Dev data sync skipped safely: {exc}")
        return 0
    finally:
        args.lock_path.unlink(missing_ok=True)


if __name__ == "__main__":
    raise SystemExit(main())
