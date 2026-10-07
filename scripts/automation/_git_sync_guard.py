"""Conservative recovery for two sibling automation data publications."""

from datetime import datetime, timezone
import re
import subprocess
from pathlib import Path


ASSET_DATA_PATHS = {
    "assets/btcusd_10m_prices.csv",
    "assets/daily_price.csv",
    "assets/daily_price_metadata.json",
    "assets/last_updated.txt",
    "assets/top_kpis.json",
}
CASASCIUS_DATA_PATHS = {
    "webapps/casascius_explorer/assets/right_panel_data.js",
    "webapps/casascius_explorer/data/casascius_explorer.csv",
    "webapps/casascius_explorer/data/casascius_explorer_update_state.json",
}
BLOCK_DATA_RE = re.compile(r"^assets/block_data_\d+_\d+\.csv$")


def _is_published_data_path(path: str) -> bool:
    parts = path.split("/")
    return (
        path in ASSET_DATA_PATHS
        or path in CASASCIUS_DATA_PATHS
        or bool(BLOCK_DATA_RE.fullmatch(path))
        or len(parts) >= 4 and parts[0] == "webapps" and parts[2] == "webapp_data"
    )


def _git_output(repo_dir: Path, *args: str) -> bytes | None:
    try:
        result = subprocess.run(
            ["git", *args], cwd=repo_dir, capture_output=True, check=False, timeout=30
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    return result.stdout if result.returncode == 0 else None


def can_stage_across_rewritten_data_tip(
    repo_dir: Path, branch: str, ahead: int, behind: int
) -> bool:
    """Allow preserving a newer local generation when origin rewrote its tip.

    This covers only two clean, sibling ``Update data`` commits. Both commits
    must touch the same published paths and the local publication timestamp must
    be later. Source code and all other Git histories are excluded.
    """
    if branch != "main" or (ahead, behind) != (1, 1):
        return False
    status = _git_output(repo_dir, "status", "--porcelain", "-z")
    if status is None or status:
        return False
    subjects = _git_output(repo_dir, "show", "-s", "--format=%s", "HEAD", "origin/main")
    if subjects is None or subjects.splitlines() != [b"Update data", b"Update data"]:
        return False
    parents = _git_output(repo_dir, "rev-parse", "HEAD^", "origin/main^")
    if parents is None or len(parents.splitlines()) != 2 or parents.splitlines()[0] != parents.splitlines()[1]:
        return False
    changed_sets = []
    for tip in ("HEAD", "origin/main"):
        changed = _git_output(repo_dir, "diff", "--no-renames", "--name-only", "-z", "HEAD^", tip)
        if changed is None or not changed:
            return False
        paths = changed.decode("utf-8", errors="surrogateescape").rstrip("\0").split("\0")
        if not all(_is_published_data_path(path) for path in paths):
            return False
        changed_sets.append(set(paths))
    if changed_sets[0] != changed_sets[1] or "assets/last_updated.txt" not in changed_sets[0]:
        return False
    timestamps = []
    for tip in ("HEAD", "origin/main"):
        raw = _git_output(repo_dir, "show", f"{tip}:assets/last_updated.txt")
        if raw is None:
            return False
        try:
            stamp = datetime.strptime(raw.decode("ascii").strip(), "Last updated on %B %d, %Y at %H:%M UTC")
        except (UnicodeDecodeError, ValueError):
            return False
        timestamps.append(stamp.replace(tzinfo=timezone.utc))
    return timestamps[0] > timestamps[1]


def merge_rewritten_data_tip(repo_dir: Path) -> bool:
    """Record remote ancestry while retaining the newer local data tree."""
    local = _git_output(repo_dir, "rev-parse", "HEAD")
    remote = _git_output(repo_dir, "rev-parse", "origin/main")
    if local is None or remote is None or not can_stage_across_rewritten_data_tip(repo_dir, "main", 1, 1):
        return False
    # Pin both commits: a concurrent fetch must not alter what was validated.
    if local != _git_output(repo_dir, "rev-parse", "HEAD") or remote != _git_output(repo_dir, "rev-parse", "origin/main"):
        return False
    try:
        result = subprocess.run(
            ["git", "-c", "commit.gpgsign=false", "merge", "--no-edit", "-s", "ours", "-m", "Merge remote-tracking branch 'origin/main'", remote.decode("ascii").strip()],
            cwd=repo_dir, capture_output=True, check=False, timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return result.returncode == 0
