#!/usr/bin/env python
# coding: utf-8

import csv
import filecmp
import hashlib
import io
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:
    def load_dotenv(dotenv_path=None):
        if not dotenv_path:
            return False
        path = Path(dotenv_path)
        if not path.exists():
            return False
        for raw_line in path.read_text().splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            value = value.strip().strip("\"'")
            os.environ.setdefault(key.strip(), value)
        return True

try:
    import papermill as pm
except ImportError:
    pm = None

AUTOMATION_DIR = Path(__file__).resolve().parent
DEFAULT_MAIN_DIR = Path("/Users/wicked/Projects/animations")
DEFAULT_ENV_PATH = DEFAULT_MAIN_DIR / ".env"
ENV_PATH = Path(os.getenv("ANIMATIONS_ENV_FILE", str(DEFAULT_ENV_PATH))).expanduser()
load_dotenv(dotenv_path=ENV_PATH)

LOCK_PATH = Path("/tmp/animations_1h.lock")
LOCK_ONCHAIN = Path("/tmp/animations_onchain.lock")
ONCHAIN_PENDING = Path("/tmp/animations_onchain_pending")
STAGING_ROOT = Path("/tmp/animations_deploy_staging")
STAGING_SOURCE = "1h"
STAGE_COMPLETE_SENTINEL = ".complete"
MAIN_DIR = Path(os.getenv("MAIN_DIR", str(DEFAULT_MAIN_DIR))).expanduser()
GIT_DEPLOY_SCRIPT = AUTOMATION_DIR / "_git_deploy.py"
REPO_DIR = Path(os.getenv("ANIMATIONS_REPO_DIR", str(AUTOMATION_DIR.parents[1]))).expanduser()
ASSETS_DIR = REPO_DIR / "assets"

BITCOIN_METRICS_DIR = MAIN_DIR / "*Bitcoin Metrics"
BITCOIN_METRICS_NOTEBOOK = BITCOIN_METRICS_DIR / "bitcoin_metrics.ipynb"

WEBAPP_SCRIPT_JOBS = [
    {
        "script": REPO_DIR / "webapps" / "node_count" / "node_count_webapp_data_update.py",
        "env_var": "NODE_COUNT_WEBAPP_DATA_DIR",
        "repo_dest_dir": REPO_DIR / "webapps" / "node_count" / "webapp_data",
    },
    {
        "script": REPO_DIR / "webapps" / "bitcoin_dominance" / "btcd_webapp_data_update.py",
        "env_var": "BTCD_WEBAPP_DATA_DIR",
        "repo_dest_dir": REPO_DIR / "webapps" / "bitcoin_dominance" / "webapp_data",
    },
    {
        "script": REPO_DIR / "webapps" / "dca_cost_basis" / "dca_cost_basis_webapp_data_update.py",
        "env_var": "DCA_COST_BASIS_WEBAPP_DATA_DIR",
        "repo_dest_dir": REPO_DIR / "webapps" / "dca_cost_basis" / "webapp_data",
    },
    {
        "script": REPO_DIR / "webapps" / "dca_comparison" / "comparison_webapp_data_update.py",
        "env_var": "DCA_COMPARISON_WEBAPP_DATA_DIR",
        "repo_dest_dir": REPO_DIR / "webapps" / "dca_comparison" / "webapp_data",
    },
    {
        "script": REPO_DIR / "webapps" / "uoa" / "uoa_webapp_data_update.py",
        "env_var": "UOA_WEBAPP_DATA_DIR",
        "repo_dest_dir": REPO_DIR / "webapps" / "uoa" / "webapp_data",
    },
    {
        "script": REPO_DIR / "webapps" / "patoshi_pattern" / "patoshi_webapp_data_update.py",
        "env_var": "PATOSHI_WEBAPP_DATA_DIR",
        "repo_dest_dir": REPO_DIR / "webapps" / "patoshi_pattern" / "webapp_data",
    },
]

CASASCIUS_WEBAPP_DIR = REPO_DIR / "webapps" / "casascius_explorer"
CASASCIUS_DEPLOY_FILES = [
    CASASCIUS_WEBAPP_DIR / "data" / "casascius_explorer.csv",
    CASASCIUS_WEBAPP_DIR / "data" / "casascius_explorer_update_state.json",
    CASASCIUS_WEBAPP_DIR / "assets" / "right_panel_data.js",
]

AUTO_DEPLOY_COMMIT_MESSAGE = "Update data"


def fmt_duration(seconds: float) -> str:
    s = int(round(seconds))
    m, s = divmod(s, 60)
    h, m = divmod(m, 60)
    if h:
        return f"{h}h {m}m {s}s"
    if m:
        return f"{m}m {s}s"
    return f"{s}s"


def run(cmd, cwd=None):
    return subprocess.run(cmd, cwd=cwd, check=True, text=True, capture_output=True)


def run_soft(cmd, cwd=None):
    return subprocess.run(cmd, cwd=cwd, check=False, text=True, capture_output=True)


def create_stage_run_dir() -> Path:
    STAGING_ROOT.mkdir(parents=True, exist_ok=True)
    run_id = f"{STAGING_SOURCE}-{datetime.now().strftime('%Y%m%d%H%M%S')}-{os.getpid()}"
    run_dir = STAGING_ROOT / run_id
    (run_dir / "files").mkdir(parents=True, exist_ok=True)
    return run_dir


def mark_stage_run_complete(run_dir: Path) -> None:
    """Atomically expose a fully staged hourly run to the deploy process."""
    sentinel = run_dir / STAGE_COMPLETE_SENTINEL
    temporary = run_dir / f"{STAGE_COMPLETE_SENTINEL}.tmp-{os.getpid()}"
    with temporary.open("w", encoding="utf-8") as handle:
        handle.write("complete\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, sentinel)


def stage_file(run_dir: Path, source_file: Path, repo_dest_file: Path) -> bool:
    if not source_file.exists():
        return False
    rel_path = repo_dest_file.relative_to(REPO_DIR)
    staged_dest = run_dir / "files" / rel_path
    staged_dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source_file, staged_dest)
    return True


def stage_tree(run_dir: Path, source_dir: Path, repo_dest_dir: Path) -> int:
    if not source_dir.exists():
        return 0
    changed = 0
    for src in source_dir.rglob("*"):
        if not src.is_file():
            continue
        rel = src.relative_to(source_dir)
        dst = repo_dest_dir / rel
        if stage_file(run_dir, src, dst):
            changed += 1
    return changed


def acquire_lock() -> None:
    if LOCK_PATH.exists():
        try:
            pid = int(LOCK_PATH.read_text().strip())
            os.kill(pid, 0)  # raises if process is dead
            # Process is alive — check age before giving up
            age = time.time() - LOCK_PATH.stat().st_mtime
            if age > 6 * 3600:
                LOCK_PATH.unlink(missing_ok=True)
                print(f"🧹 Cleaned up stale lock (long-running pid {pid}): {LOCK_PATH}")
            else:
                print(f"⛔ Lock exists (pid {pid} still running), aborting: {LOCK_PATH}")
                sys.exit(1)
        except (ValueError, ProcessLookupError):
            # PID is invalid or process is dead — lock is definitely stale
            LOCK_PATH.unlink(missing_ok=True)
            print(f"🧹 Cleaned up stale lock (dead process): {LOCK_PATH}")
        except PermissionError:
            # Process exists but owned by another user — fall back to age check
            age = time.time() - LOCK_PATH.stat().st_mtime
            if age > 6 * 3600:
                LOCK_PATH.unlink(missing_ok=True)
                print(f"🧹 Cleaned up stale lock (age): {LOCK_PATH}")
            else:
                print(f"⛔ Lock exists, aborting: {LOCK_PATH}")
                sys.exit(1)
    LOCK_PATH.write_text(str(os.getpid()))


def release_lock() -> None:
    LOCK_PATH.unlink(missing_ok=True)


def is_lock_active(path: Path) -> bool:
    """Return True only if the lock file exists AND the recorded PID is still running."""
    if not path.exists():
        return False
    try:
        pid = int(path.read_text().strip())
        os.kill(pid, 0)
        return True
    except (ValueError, ProcessLookupError):
        return False
    except PermissionError:
        return True  # process exists, owned by another user


def has_onchain_priority_work() -> bool:
    if is_lock_active(LOCK_ONCHAIN):
        return True
    if STAGING_ROOT.exists():
        for run_dir in STAGING_ROOT.iterdir():
            if run_dir.is_dir() and run_dir.name.startswith("onchain-") and (run_dir / "files").exists():
                return True
    if ONCHAIN_PENDING.exists():
        try:
            pid = int(ONCHAIN_PENDING.read_text().splitlines()[0].strip())
            os.kill(pid, 0)
            return True
        except (IndexError, ValueError, ProcessLookupError):
            pass
        except PermissionError:
            return True

        age = time.time() - ONCHAIN_PENDING.stat().st_mtime
        if age <= 30 * 60:
            print(f"🧹 Cleaned up inactive onchain priority marker: {ONCHAIN_PENDING}")
            ONCHAIN_PENDING.unlink(missing_ok=True)
            return False
        ONCHAIN_PENDING.unlink(missing_ok=True)
        print(f"🧹 Cleaned up stale onchain priority marker: {ONCHAIN_PENDING}")
    return False


def git_pull_rebase(repo_dir: Path) -> bool:
    try:
        res = run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=str(repo_dir))
        branch = res.stdout.strip() or "main"
        run(["git", "fetch", "origin"], cwd=str(repo_dir))

        counts = run(["git", "rev-list", "--left-right", "--count", f"origin/{branch}...HEAD"], cwd=str(repo_dir))
        behind_str, ahead_str = counts.stdout.strip().split()
        behind = int(behind_str)
        ahead = int(ahead_str)

        if ahead == 0 and behind == 0:
            print(f"✅ Repo already matches origin/{branch}")
            return True

        if ahead == 0:
            run(["git", "merge", "--ff-only", f"origin/{branch}"], cwd=str(repo_dir))
            print(f"✅ Fast-forwarded to origin/{branch}")
            return True

        local_only = run(
            ["git", "log", "--format=%s", f"origin/{branch}..HEAD"],
            cwd=str(repo_dir),
        )
        local_subjects = [line.strip() for line in local_only.stdout.splitlines() if line.strip()]
        preview = ", ".join(local_subjects[:3])
        if len(local_subjects) > 3:
            preview += ", ..."

        print(
            f"⚠️ Skipping git sync: {branch} has {ahead} local-only commit(s); "
            "rebasing automation onto a working branch is unsafe."
        )
        if behind:
            print(f"⚠️ origin/{branch} is also ahead by {behind} commit(s).")
        if preview:
            print(f"ℹ️ Local-only commits: {preview}")
        return False
    except subprocess.CalledProcessError as e:
        try:
            subprocess.run(["git", "rebase", "--abort"], cwd=str(repo_dir))
        except Exception:
            pass
        print("⚠️ Failed to sync from origin before running; skipping this update. Output:\n"
              f"STDOUT:\n{e.stdout}\nSTDERR:\n{e.stderr}")
        return False


def copy_if_changed(src: Path, dst: Path, run_dir: Path) -> bool:
    if not src.exists():
        return False
    if dst.exists() and filecmp.cmp(str(src), str(dst), shallow=False):
        return False
    return stage_file(run_dir, src, dst)


DAILY_PRICE_TIMESTAMP_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$"
)


def build_daily_price_metadata(raw: bytes) -> dict[str, object]:
    """Validate and bind the exact daily-price CSV bytes for publication."""
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise RuntimeError("daily_price.csv is not valid UTF-8") from exc
    try:
        reader = csv.DictReader(io.StringIO(text, newline=""), strict=True)
        rows = list(reader)
        fieldnames = set(reader.fieldnames or ())
    except csv.Error as exc:
        raise RuntimeError(f"daily_price.csv is not valid CSV: {exc}") from exc
    required = {"date", "timestamp", "block_height", "price", "daily_high"}
    missing = sorted(required - fieldnames)
    if missing or not rows:
        detail = ", ".join(missing) if missing else "no data rows"
        raise RuntimeError(f"daily_price.csv cannot be published: {detail}")

    previous_day = None
    previous_height = None
    first_day = None
    latest_day = None
    latest_timestamp = ""
    latest_height = None

    for row_number, row in enumerate(rows, start=2):
        if None in row:
            raise RuntimeError(f"daily_price.csv row {row_number} has extra CSV fields")

        timestamp_text = str(row.get("timestamp") or "").strip()
        if not DAILY_PRICE_TIMESTAMP_RE.fullmatch(timestamp_text):
            raise RuntimeError(f"daily_price.csv row {row_number} has an invalid timestamp")
        try:
            parsed_timestamp = datetime.fromisoformat(
                timestamp_text[:-1] + "+00:00"
                if timestamp_text.endswith("Z")
                else timestamp_text
            )
        except ValueError as exc:
            raise RuntimeError(
                f"daily_price.csv row {row_number} has an invalid timestamp"
            ) from exc
        if parsed_timestamp.tzinfo is None:
            parsed_timestamp = parsed_timestamp.replace(tzinfo=timezone.utc)
        elif parsed_timestamp.utcoffset() is None:
            raise RuntimeError(f"daily_price.csv row {row_number} has an invalid timezone")
        utc_day = parsed_timestamp.astimezone(timezone.utc).date()
        date_text = str(row.get("date") or "").strip()
        parsed_date = None
        for date_format in ("%m/%d/%y", "%m/%d/%Y", "%Y-%m-%d"):
            try:
                parsed_date = datetime.strptime(date_text, date_format).date()
                break
            except ValueError:
                continue
        if parsed_date is None or parsed_date != utc_day:
            raise RuntimeError(
                f"daily_price.csv row {row_number} date does not match its UTC timestamp day"
            )
        if previous_day is not None:
            expected_day = previous_day + timedelta(days=1)
            if utc_day != expected_day:
                raise RuntimeError(
                    f"daily_price.csv row {row_number} UTC day {utc_day.isoformat()} "
                    f"is not the expected consecutive day {expected_day.isoformat()}"
                )

        height_text = str(row.get("block_height") or "").strip()
        try:
            height = int(height_text)
        except ValueError as exc:
            raise RuntimeError(
                f"daily_price.csv row {row_number} has an invalid block height"
            ) from exc
        if height < 0:
            raise RuntimeError(f"daily_price.csv row {row_number} has a negative block height")
        if previous_height is not None and height < previous_height:
            raise RuntimeError(f"daily_price.csv row {row_number} block height decreases")

        for column in ("price", "daily_high"):
            value_text = str(row.get(column) or "").strip()
            try:
                value = float(value_text)
            except ValueError as exc:
                raise RuntimeError(
                    f"daily_price.csv row {row_number} has an invalid {column}"
                ) from exc
            if not math.isfinite(value) or value < 0:
                raise RuntimeError(
                    f"daily_price.csv row {row_number} has a non-finite or negative {column}"
                )

        if first_day is None:
            first_day = utc_day
        previous_day = utc_day
        previous_height = height
        latest_day = utc_day
        latest_timestamp = timestamp_text
        latest_height = height

    if first_day is None or latest_day is None or latest_height is None:
        raise RuntimeError("daily_price.csv has invalid boundaries")

    return {
        "schema_version": 1,
        "artifact": {
            "path": "assets/daily_price.csv",
            "sha256": hashlib.sha256(raw).hexdigest(),
            "rows": len(rows),
        },
        "first_date": first_day.isoformat(),
        "latest_date": latest_day.isoformat(),
        "latest_timestamp": latest_timestamp,
        "latest_block_height": latest_height,
    }


def stage_daily_price_metadata(source_csv: Path, run_dir: Path) -> bool:
    """Stage a deterministic publication marker bound to daily_price.csv."""
    marker = build_daily_price_metadata(source_csv.read_bytes())
    generated_dir = run_dir / "generated_assets"
    generated_dir.mkdir(parents=True, exist_ok=True)
    generated_marker = generated_dir / "daily_price_metadata.json"
    generated_marker.write_text(
        json.dumps(marker, separators=(",", ":"), ensure_ascii=True) + "\n",
        encoding="utf-8",
    )
    return copy_if_changed(
        generated_marker,
        ASSETS_DIR / "daily_price_metadata.json",
        run_dir,
    )


def sync_dir_changed(source_dir: Path, dest_dir: Path, run_dir: Path) -> int:
    if not source_dir.exists():
        return 0
    changed = 0
    for src in source_dir.rglob("*"):
        if not src.is_file():
            continue
        rel = src.relative_to(source_dir)
        dst = dest_dir / rel
        if copy_if_changed(src, dst, run_dir):
            changed += 1
    return changed


def phase_casascius_data(run_dir: Path) -> None:
    print("\n=== Phase 3: Casascius Explorer Data ===")
    if not CASASCIUS_WEBAPP_DIR.exists():
        print(f"⏭️ Skipped missing Casascius webapp dir: {CASASCIUS_WEBAPP_DIR}")
        return

    workspace_dir = run_dir / "tmp_webapps" / "casascius_explorer_workspace"
    if workspace_dir.exists():
        shutil.rmtree(workspace_dir)
    shutil.copytree(CASASCIUS_WEBAPP_DIR, workspace_dir)

    script = workspace_dir / "scripts" / "casascius_explorer_webapp_data_update.py"
    script_env = os.environ.copy()
    script_env["CASASCIUS_EXPLORER_ENV_FILE"] = str(ENV_PATH)
    ran = run_script(script, env=script_env)
    if not ran:
        print("🗂️ Casascius job skipped: updater failed")
        return

    staged_files = 0
    for repo_file in CASASCIUS_DEPLOY_FILES:
        rel = repo_file.relative_to(CASASCIUS_WEBAPP_DIR)
        workspace_file = workspace_dir / rel
        if copy_if_changed(workspace_file, repo_file, run_dir):
            staged_files += 1

    print(f"✅ Casascius Explorer staged for deploy. Changed files: {staged_files}")



def run_script(script_path: Path, env: dict[str, str] | None = None) -> bool:
    if not script_path.exists():
        print(f"⏭️ Skipped missing script: {script_path}")
        return False

    t0 = time.perf_counter()
    try:
        subprocess.run([sys.executable, str(script_path)], check=True, env=env)
        elapsed = fmt_duration(time.perf_counter() - t0)
        print(f"✅ Executed ({elapsed}): {script_path.name}")
        return True
    except Exception as e:
        elapsed = fmt_duration(time.perf_counter() - t0)
        print(f"❌ Error ({elapsed}): {script_path.name}: {e}")
        return False


def run_notebook(nb_path: Path) -> bool:
    if not nb_path.exists():
        print(f"⏭️ Skipped missing notebook: {nb_path}")
        return False
    if pm is None:
        print("⏭️ Skipped notebook: papermill is unavailable")
        return False

    output_path = nb_path.with_name(nb_path.stem + "_executed.ipynb")
    t0 = time.perf_counter()
    try:
        pm.execute_notebook(
            input_path=str(nb_path),
            output_path=str(output_path),
            log_output=False,
            progress_bar=False,
            kernel_name="python3",
        )
        elapsed = fmt_duration(time.perf_counter() - t0)
        print(f"✅ Executed ({elapsed}): {nb_path.name}")
        return True
    except Exception as e:
        elapsed = fmt_duration(time.perf_counter() - t0)
        print(f"❌ Error ({elapsed}): {nb_path.name}: {e}")
        return False



def phase_bitcoin_metrics(run_dir: Path) -> None:
    print("\n=== Phase 1: Bitcoin Metrics ===")
    run_notebook(BITCOIN_METRICS_NOTEBOOK)

    changed = 0
    changed += int(copy_if_changed(BITCOIN_METRICS_DIR / "btcusd_10m_prices.csv", ASSETS_DIR / "btcusd_10m_prices.csv", run_dir))
    daily_price_csv = BITCOIN_METRICS_DIR / "daily_price.csv"
    changed += int(copy_if_changed(daily_price_csv, ASSETS_DIR / "daily_price.csv", run_dir))
    changed += int(stage_daily_price_metadata(daily_price_csv, run_dir))

    # Chunked files only. Intentionally exclude full block_data.csv.
    for src in sorted(BITCOIN_METRICS_DIR.glob("block_data_*_*.csv")):
        if copy_if_changed(src, ASSETS_DIR / src.name, run_dir):
            changed += 1

    print(f"✅ Bitcoin Metrics staged for deploy. Changed asset files: {changed}")


def phase_webapp_data(run_dir: Path) -> None:
    print("\n=== Phase 2: Webapp Data ===")
    ran_count = 0
    staged_files = 0
    for job in WEBAPP_SCRIPT_JOBS:
        script = job["script"]
        env_var = job["env_var"]
        repo_dest_dir = job["repo_dest_dir"]
        staged_output_dir = run_dir / "tmp_webapps" / script.stem
        script_env = os.environ.copy()
        script_env[env_var] = str(staged_output_dir)
        ran = run_script(script, env=script_env)
        ran_count += int(ran)
        if ran:
            staged_files += stage_tree(run_dir, staged_output_dir, repo_dest_dir)
        status = "updated" if ran else "skipped"
        print(f"🗂️ Webapp job {status}: {script.name}")

    print(f"✅ Webapp scripts complete. Jobs executed: {ran_count}/{len(WEBAPP_SCRIPT_JOBS)} | Files staged: {staged_files}")


def trigger_git_deploy() -> None:
    if not GIT_DEPLOY_SCRIPT.exists():
        print(f"⚠️ Missing git deploy script: {GIT_DEPLOY_SCRIPT}")
        return

    if has_onchain_priority_work():
        print("⏭️ Skipping deploy: onchain dashboard update is pending — it has priority.")
        return

    print("Triggering git deployment...")
    deploy_env = os.environ.copy()
    deploy_env["ANIMATIONS_DEPLOY_SOURCE"] = STAGING_SOURCE
    subprocess.run([sys.executable, str(GIT_DEPLOY_SCRIPT)], check=False, env=deploy_env)


def main() -> None:
    start_time = datetime.now()
    print(f"Script started at: {start_time.strftime('%Y-%m-%d %H:%M:%S')}")

    if has_onchain_priority_work():
        print("⏭️ Skipping hourly update start: onchain dashboard update is pending.")
        return

    acquire_lock()
    try:
        run_dir = create_stage_run_dir()
        print(f"Staging run dir: {run_dir}")
        if not git_pull_rebase(REPO_DIR):
            print("⏭️ Skipping data update: repo could not be synced cleanly from origin.")
            return
        phase_bitcoin_metrics(run_dir)
        phase_webapp_data(run_dir)
        phase_casascius_data(run_dir)
        mark_stage_run_complete(run_dir)
        print(f"✅ Hourly staging transaction complete: {run_dir}")
    finally:
        release_lock()

    trigger_git_deploy()

    end_time = datetime.now()
    elapsed_time = end_time - start_time
    total_seconds = int(elapsed_time.total_seconds())
    minutes = total_seconds // 60
    seconds = total_seconds % 60
    print(f"Script finished at: {end_time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Execution time: {minutes} minute(s) and {seconds} second(s)")
    print()


if __name__ == "__main__":
    main()
