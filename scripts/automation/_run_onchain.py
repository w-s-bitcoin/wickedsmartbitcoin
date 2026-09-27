#!/usr/bin/env python3

import os
import subprocess
import sys
import time
import json
import math
import shutil
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

LOCK_PATH = Path("/tmp/animations_onchain.lock")
LOCK_1D = Path("/tmp/animations_1d.lock")
ONCHAIN_PENDING = Path("/tmp/animations_onchain_pending")
STAGING_ROOT = Path("/tmp/animations_deploy_staging")
STAGING_SOURCE = "onchain"
GIT_FETCH_TIMEOUT_SECONDS = 45
GIT_SSH_CONNECT_TIMEOUT_SECONDS = 10
AUTOMATION_DIR = Path(__file__).resolve().parent
DEFAULT_MAIN_DIR = Path("/Users/wicked/Projects/animations")
DEFAULT_ENV_PATH = DEFAULT_MAIN_DIR / ".env"
ENV_PATH = Path(os.getenv("ANIMATIONS_ENV_FILE", str(DEFAULT_ENV_PATH))).expanduser()
load_dotenv(dotenv_path=ENV_PATH)

MAIN_DIR = Path(os.getenv("MAIN_DIR", str(DEFAULT_MAIN_DIR))).expanduser()
GIT_DEPLOY_SCRIPT = AUTOMATION_DIR / "_git_deploy.py"
REPO_DIR = Path(os.getenv("ANIMATIONS_REPO_DIR", str(AUTOMATION_DIR.parents[1]))).expanduser()

BIP110_SCRIPT = REPO_DIR / "webapps" / "bip110_signaling" / "bip110_webapp_data_update.py"
ISSUANCE_RATE_SCRIPT = REPO_DIR / "webapps" / "issuance_rate" / "issuance_rate_webapp_data_update.py"
ASSETS_DIR = REPO_DIR / "assets"
TOP_KPIS_JSON = ASSETS_DIR / "top_kpis.json"
BIP110_WEBAPP_DATA_DIR = REPO_DIR / "webapps" / "bip110_signaling" / "webapp_data"
ISSUANCE_RATE_WEBAPP_DATA_DIR = REPO_DIR / "webapps" / "issuance_rate" / "webapp_data"
TARGET_SUPPLY_CAP_SATS = 2_099_999_997_690_000
MAX_TARGET_HEX = "00000000FFFF0000000000000000000000000000000000000000000000000000"
MAX_TARGET_INT = int(MAX_TARGET_HEX, 16)
TARGET_BLOCK_INTERVAL_SECONDS = 600
BIP110_FINAL_UPDATE_HEIGHT = 967_679


def now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def fmt_duration(seconds: float) -> str:
    s = int(round(seconds))
    m, s = divmod(s, 60)
    h, m = divmod(m, 60)
    if h:
        return f"{h}h {m}m {s}s"
    if m:
        return f"{m}m {s}s"
    return f"{s}s"


def run(cmd, cwd=None, timeout=None):
    env = os.environ.copy()
    env.setdefault("GIT_TERMINAL_PROMPT", "0")
    env.setdefault(
        "GIT_SSH_COMMAND",
        f"ssh -o BatchMode=yes -o ConnectTimeout={GIT_SSH_CONNECT_TIMEOUT_SECONDS}",
    )
    return subprocess.run(
        cmd,
        cwd=cwd,
        check=True,
        text=True,
        capture_output=True,
        timeout=timeout,
        env=env,
    )


def run_soft(cmd, cwd=None):
    return subprocess.run(cmd, cwd=cwd, check=False, text=True, capture_output=True)


def create_stage_run_dir() -> Path:
    STAGING_ROOT.mkdir(parents=True, exist_ok=True)
    run_id = f"{STAGING_SOURCE}-{datetime.now().strftime('%Y%m%d%H%M%S')}-{os.getpid()}"
    run_dir = STAGING_ROOT / run_id
    (run_dir / "files").mkdir(parents=True, exist_ok=True)
    return run_dir


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
    count = 0
    for src in source_dir.rglob("*"):
        if not src.is_file():
            continue
        rel = src.relative_to(source_dir)
        if stage_file(run_dir, src, repo_dest_dir / rel):
            count += 1
    return count


def acquire_lock() -> None:
    if LOCK_PATH.exists():
        try:
            pid = int(LOCK_PATH.read_text().strip())
            os.kill(pid, 0)  # raises if process is dead
            # Process is alive — check age before giving up
            age = time.time() - LOCK_PATH.stat().st_mtime
            if age > 6 * 3600:
                LOCK_PATH.unlink(missing_ok=True)
                print(f"[Onchain] Stale lock removed (long-running pid {pid}).")
            else:
                print(f"[Onchain] Lock exists (pid {pid} still running), aborting.")
                sys.exit(1)
        except (ValueError, ProcessLookupError):
            # PID is invalid or process is dead — lock is definitely stale
            LOCK_PATH.unlink(missing_ok=True)
            print("[Onchain] Stale lock removed (dead process).")
        except PermissionError:
            # Process exists but owned by another user — fall back to age check
            age = time.time() - LOCK_PATH.stat().st_mtime
            if age > 6 * 3600:
                LOCK_PATH.unlink(missing_ok=True)
                print("[Onchain] Stale lock removed (age).")
            else:
                print("[Onchain] Lock exists, aborting.")
                sys.exit(1)
    LOCK_PATH.write_text(str(os.getpid()))


def release_lock() -> None:
    LOCK_PATH.unlink(missing_ok=True)


def mark_onchain_pending() -> None:
    ONCHAIN_PENDING.write_text(f"{os.getpid()}\n{datetime.now(timezone.utc).isoformat()}\n")


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


def git_pull_rebase(repo_dir: Path) -> bool:
    try:
        res = run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=str(repo_dir))
        branch = res.stdout.strip() or "main"
        run(["git", "fetch", "origin"], cwd=str(repo_dir), timeout=GIT_FETCH_TIMEOUT_SECONDS)

        counts = run(["git", "rev-list", "--left-right", "--count", f"origin/{branch}...HEAD"], cwd=str(repo_dir))
        behind_str, ahead_str = counts.stdout.strip().split()
        behind = int(behind_str)
        ahead = int(ahead_str)

        if ahead == 0 and behind == 0:
            print(f"[Onchain] Repo already matches origin/{branch}")
            return True

        if ahead == 0:
            run(["git", "merge", "--ff-only", f"origin/{branch}"], cwd=str(repo_dir))
            print(f"[Onchain] Fast-forwarded to origin/{branch}")
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
            f"[Onchain] Skipping git sync: {branch} has {ahead} local-only commit(s); "
            "rebasing automation onto a working branch is unsafe."
        )
        if behind:
            print(f"[Onchain] origin/{branch} is also ahead by {behind} commit(s).")
        if preview:
            print(f"[Onchain] Local-only commits: {preview}")
        return False
    except subprocess.TimeoutExpired:
        print(
            f"[Onchain] Timed out running git fetch origin after {GIT_FETCH_TIMEOUT_SECONDS}s; skipping this update."
        )
        return False
    except subprocess.CalledProcessError as e:
        try:
            subprocess.run(["git", "rebase", "--abort"], cwd=str(repo_dir))
        except Exception:
            pass
        print(f"[Onchain] Failed to sync from origin before running; skipping this update. | {e.stderr.strip()}")
        return False


def run_script(script_path: Path, env: dict[str, str] | None = None) -> bool:
    if not script_path.exists():
        print(f"[Onchain] Skipped: {script_path.name}")
        return False

    t0 = time.perf_counter()
    try:
        subprocess.run([sys.executable, str(script_path)], check=True, env=env, cwd=str(script_path.parent))
        elapsed = fmt_duration(time.perf_counter() - t0)
        print(f"[Onchain] Executed {script_path.name} | Time: {elapsed}")
        return True
    except Exception as e:
        elapsed = fmt_duration(time.perf_counter() - t0)
        print(f"[Onchain] Error: {script_path.name} | Time: {elapsed} | {e}")
        return False


def calc_epoch(height: int) -> int:
    return (height // 210000) + 1


def calc_epoch_complete(height: int) -> float:
    # Floor to 3 decimals so values never round up across thresholds.
    progress_in_epoch = height % 210000
    return (progress_in_epoch * 1000 // 210000) / 1000


def calc_subsidy_btc(height: int) -> float:
    return calc_subsidy_sats(height) / 100_000_000


def calc_subsidy_sats(height: int) -> int:
    halvings = height // 210000
    if halvings >= 64:
        return 0
    return 5_000_000_000 >> halvings


def calc_target_hashrate_hps(target_hex: str | None) -> float | None:
    cleaned_target = str(target_hex or "").strip().lower().removeprefix("0x")
    if not cleaned_target:
        return None

    try:
        target_int = int(cleaned_target, 16)
    except ValueError:
        return None

    if target_int <= 0:
        return None

    difficulty_from_target = MAX_TARGET_INT / target_int
    return difficulty_from_target * (2 ** 32) / TARGET_BLOCK_INTERVAL_SECONDS


def format_difficulty_display(difficulty: float | None) -> str:
    if not isinstance(difficulty, (int, float)) or difficulty <= 0:
        return "n/a"

    scales = [
        (1e18, "Q"),  # quintillions
        (1e15, "q"),  # quadrillions
        (1e12, "T"),  # trillions
        (1e9, "B"),   # billions
    ]
    for threshold, suffix in scales:
        if difficulty >= threshold:
            return f"{difficulty / threshold:.2f}{suffix}"

    return f"{difficulty:.2f}"


def load_current_kpi_block() -> tuple[int, int, str, float, int] | None:
    """Read one consistent snapshot of the latest fully ingested chain."""
    try:
        import psycopg2

        connection = psycopg2.connect(
            host=os.getenv("POSTGRES_HOST"),
            database=os.getenv("POSTGRES_DB", "bitcoin_data"),
            user=os.getenv("POSTGRES_USER"),
            password=os.getenv("POSTGRES_PASSWORD"),
            connect_timeout=10,
            options="-c default_transaction_read_only=on",
        )
        try:
            with connection.cursor() as cursor:
                cursor.execute("""
                    WITH totals AS (
                        SELECT MAX(blockheight) AS height,
                               COUNT(*) AS blocks,
                               COUNT(blocksubsidy) AS supply_rows,
                               SUM(blocksubsidy) AS issued_sats
                        FROM blockheader
                    )
                    SELECT tip.blockheight, tip.time, tip.bits, tip.difficulty,
                           totals.blocks, totals.supply_rows, totals.issued_sats
                    FROM totals
                    JOIN blockheader AS tip ON tip.blockheight = totals.height
                """)
                row = cursor.fetchone()
        finally:
            connection.close()
    except Exception as exc:
        print(f"[Onchain] Could not read current KPI block: {exc}")
        return None

    if not row:
        print("[Onchain] No ingested block available for top KPIs")
        return None
    try:
        height, block_time, bits, difficulty, block_count, supply_rows, issued_sats = row
        height = int(height)
        block_time = int(block_time)
        difficulty = float(difficulty)
        issued_sats = int(issued_sats)
        if (height < 0 or block_time <= 0 or int(block_count) != height + 1
                or int(supply_rows) != int(block_count)
                or not math.isfinite(difficulty) or difficulty <= 0
                or issued_sats < 0):
            raise ValueError("incomplete or invalid ingested chain")
        bits = str(bits).strip().lower().removeprefix("0x")
        if len(bits) != 8:
            raise ValueError("invalid compact target")
        int(bits, 16)
        return height, block_time, bits, difficulty, issued_sats
    except (TypeError, ValueError) as exc:
        print(f"[Onchain] Skipping invalid KPI block: {exc}")
        return None


def target_hex_from_bits(bits: str) -> str:
    compact = int(bits, 16)
    exponent = compact >> 24
    mantissa = compact & 0x007fffff
    if compact & 0x00800000 or mantissa == 0:
        raise ValueError("invalid compact target")
    target = (mantissa >> (8 * (3 - exponent))) if exponent <= 3 else (mantissa << (8 * (exponent - 3)))
    if target <= 0 or target > MAX_TARGET_INT:
        raise ValueError("compact target outside Bitcoin proof-of-work range")
    return f"{target:064x}"


def issued_subsidy_sats_through(height: int) -> int:
    completed_epochs, blocks_in_epoch = divmod(height + 1, 210_000)
    full = sum(210_000 * calc_subsidy_sats(epoch * 210_000) for epoch in range(completed_epochs))
    return full + blocks_in_epoch * calc_subsidy_sats(completed_epochs * 210_000)


def build_top_kpis_payload() -> dict | None:
    snapshot = load_current_kpi_block()
    if snapshot is None:
        return None
    block_height, block_timestamp, bits, difficulty, supply_sats = snapshot
    try:
        target_hex = target_hex_from_bits(bits)
    except ValueError as exc:
        print(f"[Onchain] Skipping invalid KPI target: {exc}")
        return None
    target_hashrate_hps = calc_target_hashrate_hps(target_hex)
    block_time_utc = datetime.fromtimestamp(block_timestamp, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    subsidy_sats = calc_subsidy_sats(block_height)
    issued_subsidy_sats = issued_subsidy_sats_through(block_height)
    return {
        "block_height": block_height,
        "block_time_utc": block_time_utc,
        "epoch": calc_epoch(block_height),
        "epoch_complete": calc_epoch_complete(block_height),
        "subsidy_btc": calc_subsidy_btc(block_height),
        "subsidy_sats": subsidy_sats,
        "supply_btc": round(supply_sats / 100_000_000, 8),
        "supply_target_complete": issued_subsidy_sats / TARGET_SUPPLY_CAP_SATS,
        "target_hex": target_hex,
        "target_hashrate_hps": target_hashrate_hps,
        "difficulty": difficulty,
        "difficulty_display": format_difficulty_display(difficulty),
    }


def stage_top_kpis_json(run_dir: Path, payload: dict) -> bool:
    try:
        temp_output = run_dir / "generated" / "top_kpis.json"
        temp_output.parent.mkdir(parents=True, exist_ok=True)
        temp_output.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        stage_file(run_dir, temp_output, TOP_KPIS_JSON)
        print(f"[Onchain] Staged top KPIs for deploy: {TOP_KPIS_JSON}")
        return True
    except Exception as e:
        print(f"[Onchain] Failed staging top KPIs JSON: {e}")
        return False


def bip110_dashboard_finalized(data_dir: Path = BIP110_WEBAPP_DATA_DIR) -> bool:
    metadata_path = data_dir / "bip110_metadata.json"
    if not metadata_path.exists():
        return False
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        source_height = int(metadata.get("source_block_height"))
    except Exception as e:
        print(f"[Onchain] Could not inspect BIP110 finalization state: {e}")
        return False
    return source_height >= BIP110_FINAL_UPDATE_HEIGHT


def trigger_git_deploy_if_safe(*, allow_active_onchain_lock: bool = False) -> None:
    if not GIT_DEPLOY_SCRIPT.exists():
        print("[Onchain] Missing deploy script.")
        return

    onchain_lock_blocks_deploy = is_lock_active(LOCK_PATH) and not allow_active_onchain_lock
    if is_lock_active(LOCK_1D) or onchain_lock_blocks_deploy:
        print("[Onchain] Skipping deploy: lock active.")
        return

    print("[Onchain] Triggering deploy.")
    deploy_env = os.environ.copy()
    deploy_env["ANIMATIONS_DEPLOY_SOURCE"] = STAGING_SOURCE
    subprocess.run([sys.executable, str(GIT_DEPLOY_SCRIPT)], check=False, cwd=str(GIT_DEPLOY_SCRIPT.parent), env=deploy_env)


def main() -> int:
    mark_onchain_pending()

    acquire_lock()
    try:
        run_dir = create_stage_run_dir()
        print(f"[Onchain] Staging run dir: {run_dir}")
        print(f"[Onchain] Start {now_str()}")
        if not git_pull_rebase(REPO_DIR):
            print("[Onchain] Skipping data update: repo could not be synced cleanly from origin.")
            return 1

        staged_bip110_data_dir = run_dir / "tmp_bip110_webapp_data"
        if bip110_dashboard_finalized():
            ran = False
            print(f"[Onchain] BIP110 finalized at height {BIP110_FINAL_UPDATE_HEIGHT:,}; skipping update.")
        else:
            if BIP110_WEBAPP_DATA_DIR.exists():
                shutil.copytree(BIP110_WEBAPP_DATA_DIR, staged_bip110_data_dir, dirs_exist_ok=True)
                print(f"[Onchain] Seeded BIP110 staged data from existing cache: {BIP110_WEBAPP_DATA_DIR}")
            script_env = os.environ.copy()
            script_env["BIP110_WEBAPP_DATA_DIR"] = str(staged_bip110_data_dir)
            ran = run_script(BIP110_SCRIPT, env=script_env)
            status = "updated" if ran else "skipped"
            print(f"[Onchain] BIP110 {status}")

        staged_count = 0
        if ran:
            staged_count += stage_tree(run_dir, staged_bip110_data_dir, BIP110_WEBAPP_DATA_DIR)
            print(f"[Onchain] Staged BIP110 data files: {staged_count}")

        # Top KPIs follow the ingested chain even after BIP-110 analysis ends.
        payload = build_top_kpis_payload()
        kpis_ok = bool(payload) and stage_top_kpis_json(run_dir, payload)
        print(f"[Onchain] Top KPIs {'staged' if kpis_ok else 'skipped'}")

        if ran or kpis_ok:
            print("[Onchain] Deploying BIP110 data before slower secondary onchain outputs.")
            trigger_git_deploy_if_safe(allow_active_onchain_lock=True)

        staged_issuance_rate_data_dir = run_dir / "tmp_issuance_rate_webapp_data"
        if ISSUANCE_RATE_WEBAPP_DATA_DIR.exists():
            shutil.copytree(ISSUANCE_RATE_WEBAPP_DATA_DIR, staged_issuance_rate_data_dir, dirs_exist_ok=True)
            print(f"[Onchain] Seeded issuance rate staged data from existing cache: {ISSUANCE_RATE_WEBAPP_DATA_DIR}")
        issuance_env = os.environ.copy()
        issuance_env["ISSUANCE_RATE_WEBAPP_DATA_DIR"] = str(staged_issuance_rate_data_dir)
        issuance_ran = run_script(ISSUANCE_RATE_SCRIPT, env=issuance_env)
        issuance_status = "updated" if issuance_ran else "skipped"
        print(f"[Onchain] Issuance rate {issuance_status}")
        if issuance_ran:
            issuance_staged_count = stage_tree(run_dir, staged_issuance_rate_data_dir, ISSUANCE_RATE_WEBAPP_DATA_DIR)
            print(f"[Onchain] Staged issuance rate data files: {issuance_staged_count}")
        print("[Onchain] Done.")
    finally:
        release_lock()

    trigger_git_deploy_if_safe()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
