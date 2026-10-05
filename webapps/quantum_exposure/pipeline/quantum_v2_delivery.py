"""Explicit staging and independently retryable Quantum destinations.

Importing this module does no work. Delivery entry points perform real Git
publication only when explicitly called by the configured coordinator.
"""
from __future__ import annotations

import csv
import json
import os
from pathlib import Path
import re
import resource
import subprocess
import sys
import tempfile
import time
import uuid
from datetime import datetime, timezone

from immutable_generation import (
    _safe_relative, copy_immutable_generation, file_sha256, publish_immutable_generation,
    validate_immutable_generation,
)
from pipeline_paths import QUANTUM_DIR
from publish_generation import (
    _atomic_write_text, ARCHIVED_INDEX_HEADERS, HISTORICAL_ECO_HEADERS,
    PUBLICATION_MARKER_FILENAME, write_empty_archive_catalogs,
)
from quantum_runtime import copy_file_if_changed, runtime_dependency_copies, sync_generation_to_standalone
from quantum_subprocess import GIT_RESOURCE_CONFIG, run_group, run_supervisor
import regenerate_snapshot_indexes as indexes
import quantum_archive_summaries as archive_summaries

DATA_REL = Path("webapps/quantum_exposure/webapp_data")
STAGING_ROOT = Path("/tmp/animations_deploy_staging")
AUTOMATION_GIT_CONFIG = (
    "-c", "url.https://github.com/.insteadOf=git@github.com:",
    "-c", "credential.helper=", "-c", "credential.helper=!/opt/homebrew/bin/gh auth git-credential",
    "-c", "commit.gpgsign=false",
)
COMPACT_FILES = ("dashboard_snapshot_meta.csv", "dashboard_pubkeys_aggregates.csv",
                 "dashboard_script_corrections.csv",
                 "dashboard_pubkeys_ge_1btc_top100.csv", "snapshot_diff_summary.txt", "analysis_versions.json")
RECENT_SNAPSHOT_COUNT = 21
HISTORICAL_ANCHOR_INTERVAL = 50_000


class DeliveryAttempt:
    """Private, durable timing records, separate from projection/export budgets."""
    def __init__(self, state_dir: Path, request_id: int, destination: str, *, provenance: dict):
        if destination not in ('website', 'standalone'):
            raise ValueError('Unknown delivery destination')
        self.started = time.monotonic()
        self.children = resource.getrusage(resource.RUSAGE_CHILDREN)
        self.worker = resource.getrusage(resource.RUSAGE_SELF)
        identifier = uuid.uuid4().hex
        self.path = Path(state_dir) / 'delivery-attempts' / f'{int(request_id)}-{destination}-{identifier}.json'
        self.record = {'version': 'quantum-delivery-attempt-v1', 'attempt_id': identifier,
                       'request_id': int(request_id), 'destination': destination, 'status': 'running',
                       'started_at': datetime.now(timezone.utc).isoformat(), **provenance,
                       'scope': 'destination validation, copy, Git and remote receipt; excludes analysis/export',
                       'child_cpu_scope': 'waited child processes and their waited descendants only',
                       'git_resource_settings': list(GIT_RESOURCE_CONFIG)}
        self._write()

    def _write(self):
        _atomic_write_text(self.path, json.dumps(self.record, sort_keys=True) + '\n')

    def finish(self, *, receipt=None, error=None, supervisor_pid=None):
        children, worker = (resource.getrusage(kind) for kind in (resource.RUSAGE_CHILDREN, resource.RUSAGE_SELF))
        self.record.update(status='failed' if error else 'complete',
            finished_at=datetime.now(timezone.utc).isoformat(), wall_seconds=time.monotonic()-self.started,
            child_user_seconds=max(0., children.ru_utime-self.children.ru_utime),
            child_system_seconds=max(0., children.ru_stime-self.children.ru_stime),
            worker_cpu_seconds=max(0., worker.ru_utime+worker.ru_stime-self.worker.ru_utime-self.worker.ru_stime))
        if receipt is not None:
            self.record['receipt'] = receipt
        if error is not None:
            self.record['error'] = error
        if supervisor_pid is not None:
            self.record.update(supervisor_still_running_pid=supervisor_pid,
                               child_cpu_incomplete=True)
        self._write()
        return self.record


def _check(guard):
    if guard is not None:
        guard()


def _guarded_rows(rows, guard):
    for number, row in enumerate(rows):
        if number % 256 == 0:
            _check(guard)
        yield row
    _check(guard)


def _marker(data_dir: Path, *, guard=None) -> dict:
    chunks = []
    _check(guard)
    with (data_dir / PUBLICATION_MARKER_FILENAME).open('rb') as handle:
        while chunk := handle.read(1024 * 1024):
            _check(guard)
            chunks.append(chunk)
    _check(guard)
    result = json.loads(b''.join(chunks))
    _check(guard)
    return result


def _copy_prepared_file(source: Path, target: Path, *, guard=None) -> None:
    """Copy a staged dependency atomically, checking cancellation per MiB."""
    _check(guard)
    if (target.is_file() and source.stat().st_size == target.stat().st_size
            and file_sha256(source, guard=guard) == file_sha256(target, guard=guard)):
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as handle:
        temporary = Path(handle.name)
    try:
        with source.open('rb') as origin, temporary.open('wb') as destination:
            while chunk := origin.read(1024 * 1024):
                _check(guard)
                destination.write(chunk)
                _check(guard)
        os.chmod(temporary, 0o644)
        _check(guard)
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)


def _source_path(data_dir: Path, logical: str, marker: dict) -> Path:
    if marker.get("format") == 2:
        artifact = marker.get("artifacts", {}).get(logical)
        if not artifact:
            return data_dir / "__not_in_published_generation__"
        return data_dir / _safe_relative(artifact["path"])
    return data_dir / _safe_relative(logical)


def prepare_output(previous_data_dir: Path, new_output_dir: Path, target_height: int, *, guard=None) -> None:
    """Copy compact published history only, preserving its intentional gaps."""
    _check(guard)
    previous, output = Path(previous_data_dir).resolve(), Path(new_output_dir).resolve()
    if previous == output or previous in output.parents or output in previous.parents:
        raise RuntimeError("A new generation must use a separate staging directory")
    output.mkdir(parents=True, exist_ok=True)
    marker = _marker(previous, guard=guard) if (previous / PUBLICATION_MARKER_FILENAME).is_file() else {}
    if marker.get("format") == 2:
        validate_immutable_generation(previous, marker, guard=guard)
    active_index = _source_path(previous, "snapshots_index.csv", marker)
    active_heights = []
    if active_index.is_file():
        with active_index.open(newline="") as handle:
            active_heights = sorted({int(row["snapshot_blockheight"]) for row in _guarded_rows(csv.DictReader(handle), guard)
                                     if int(row["snapshot_blockheight"]) < target_height})
    # The new target occupies one recent slot. Keep the existing long-range
    # chart anchors, and move older intervening compact snapshots to archives.
    retained = set(active_heights[-(RECENT_SNAPSHOT_COUNT - 1):])
    retained.update(height for height in active_heights if height % HISTORICAL_ANCHOR_INTERVAL == 0)
    for height in active_heights:
        for filename in COMPACT_FILES:
            _check(guard)
            logical = f"{height}/{filename}"
            source = _source_path(previous, logical, marker)
            if source.is_file():
                destination = output / logical if height in retained else output / "archived" / logical
                _copy_prepared_file(source, destination, guard=guard)
    for filename in ("identity_groups.json",):
        _check(guard)
        source = _source_path(previous, filename, marker)
        if source.is_file():
            _copy_prepared_file(source, output / filename, guard=guard)

    # Keep local compact archive evidence where published, never copy raw/full
    # archive exports. Public bundles separately prune these capabilities.
    archived_index = _source_path(previous, "archived_index.csv", marker)
    if archived_index.is_file():
        with archived_index.open(newline="") as handle:
            archived = {int(row["snapshot_blockheight"]) for row in _guarded_rows(csv.DictReader(handle), guard)}
    else:
        archived = set()
    # Legacy local checkouts deliberately advertise empty public archive
    # catalogs while retaining ignored folders. Import only compact files from
    # those established archive directories during the first v2 transition.
    if marker.get("format") != 2 and (previous / "archived").is_dir():
        archived.update(int(path.name) for path in _guarded_rows((previous / "archived").iterdir(), guard)
                        if path.is_dir() and path.name.isdigit())
    for height in sorted(archived):
        if height >= target_height or height in retained:
            continue
        for filename in COMPACT_FILES:
            _check(guard)
            logical = f"archived/{height}/{filename}"
            source = _source_path(previous, logical, marker)
            if source.is_file():
                _copy_prepared_file(source, output / logical, guard=guard)
    # A legacy distribution may retain historical chart rows after its detailed
    # archive folders were removed. Preserve their original evidence separately;
    # never advertise a fabricated archived snapshot in archived_index.csv.
    complete_heights = {int(path.name) for root in (output, output/'archived')
                        if root.is_dir() for path in _guarded_rows(root.iterdir(), guard)
                        if path.is_dir() and path.name.isdigit()
                        and (path/'dashboard_snapshot_meta.csv').is_file()
                        and (path/'dashboard_pubkeys_aggregates.csv').is_file()}
    archive_summaries.stage(previous,output,marker,lambda logical:_source_path(previous,logical,marker),
                            target_height=target_height,complete_heights=complete_heights,guard=guard)
    _check(guard)


def finish_output(new_output_dir: Path, metadata: dict, generation: str, *, guard=None) -> dict:
    """Create coherent catalogs from the actual staged aggregate files and seal."""
    _check(guard)
    output = Path(new_output_dir).resolve()
    height = int(metadata["snapshot_blockheight"])
    if not (output / str(height) / "dashboard_pubkeys_ge_1btc.csv").is_file():
        raise RuntimeError("The new target has no finalized full detail export")
    _atomic_write_text(output / "latest_snapshot.txt", str(height) + "\n", guard=guard)
    active_rows, historical_rows, archive_rows, archive_history = [], [], [], []
    for root, index_rows, history in ((output, active_rows, historical_rows), (output / "archived", archive_rows, archive_history)):
        if not root.is_dir():
            continue
        for snapshot in sorted((path for path in _guarded_rows(root.iterdir(), guard) if path.is_dir() and path.name.isdigit()),
                               key=lambda path: int(path.name), reverse=True):
            _check(guard)
            snapshot_height = int(snapshot.name)
            if snapshot_height > height:
                raise RuntimeError("Staging includes a snapshot later than this target")
            stamp = indexes.get_snapshot_time_from_meta(snapshot, guard=guard)
            if not stamp:
                raise RuntimeError(f"Snapshot {snapshot_height} has no timestamp")
            aggregate = indexes.load_aggregates_for_snapshot(snapshot, guard=guard)
            if not aggregate:
                raise RuntimeError(f"Snapshot {snapshot_height} has no aggregate export")
            index_rows.append({"snapshot_blockheight": str(snapshot_height), "snapshot_time": stamp})
            history.extend(indexes.generate_historical_eco_rows(snapshot_height, aggregate,
                            include_other=indexes.snapshot_has_exact_export(snapshot, guard=guard), guard=guard))
    _check(guard)
    for name, fields, rows in (
        ("snapshots_index.csv", ARCHIVED_INDEX_HEADERS, active_rows),
        ("archived_index.csv", ARCHIVED_INDEX_HEADERS, archive_rows),
        ("historical_eco.csv", HISTORICAL_ECO_HEADERS, sorted(historical_rows, key=lambda row: (int(row["snapshot"]), row["balance_filter"]))),
        ("historical_archived.csv", HISTORICAL_ECO_HEADERS, sorted(archive_history, key=lambda row: (int(row["snapshot"]), row["balance_filter"]))),
    ):
        _check(guard)
        _atomic_write_text(output / name, indexes.serialize_csv_rows(fields, rows, guard=guard), guard=guard)
    provenance = dict(metadata)
    provenance.setdefault("block_hash", provenance.get("snapshot_block_hash", ""))
    text = publish_immutable_generation(output, reason="quantum_v2_worker", metadata=provenance,
                                        generation_id=generation, include_archives=True, guard=guard)
    return json.loads(text)


def _git(repo: Path, *args: str, check=True) -> subprocess.CompletedProcess:
    env = os.environ.copy()
    env["GIT_TERMINAL_PROMPT"] = "0"
    result = run_group(["git", *AUTOMATION_GIT_CONFIG, *GIT_RESOURCE_CONFIG, *args], cwd=repo, env=env,
                            capture_output=True, text=True, timeout=300)
    if check and result.returncode:
        raise RuntimeError(f"Git {args[0]} failed: {result.stderr.strip()}")
    return result


def _remote_receipt(repo: Path, expected: dict, *, fetch=True) -> dict | None:
    if fetch:
        _git(repo, "fetch", "origin", "main")
    commit = _git(repo, "rev-parse", "origin/main").stdout.strip()
    result = _git(repo, "show", f"{commit}:{(DATA_REL / PUBLICATION_MARKER_FILENAME).as_posix()}", check=False)
    if result.returncode:
        return None
    accepted = json.loads(result.stdout)
    exact = accepted.get("generation_id") == expected["generation_id"]
    accepted_order = (int(accepted["snapshot_blockheight"]), int(accepted.get("metadata", {}).get("request_id", 0)))
    expected_order = (int(expected["snapshot_blockheight"]), int(expected.get("metadata", {}).get("request_id", 0)))
    if not exact and accepted_order <= expected_order:
        return None
    if exact and accepted != expected:
        raise RuntimeError("Remote reused a generation ID with different manifest content")
    return {"generation_id": expected["generation_id"], "accepted_generation_id": accepted["generation_id"],
            "accepted_height": accepted["snapshot_blockheight"], "commit": commit,
            "status": "delivered" if exact else "superseded"}


def _require_main(repo: Path) -> None:
    if _git(repo, "branch", "--show-current").stdout.strip() != "main":
        raise RuntimeError("Quantum delivery requires the configured main worktree")


def _invoke_deployer(production_repo: Path) -> None:
    script = production_repo / "scripts/automation/_git_deploy.py"
    if not script.is_file() or '"quantum"' not in script.read_text():
        raise RuntimeError("Production deployer does not have Quantum source support")
    env = os.environ.copy()
    env["ANIMATIONS_DEPLOY_SOURCE"] = "quantum"
    run_supervisor([sys.executable, str(script)], cwd=production_repo, env=env, check=True, timeout=900)


def deliver_website(data_dir: Path, production_repo: Path, request_id: int) -> dict:
    """Stage complete immutable output, use existing production guards, verify Git."""
    source, repo = Path(data_dir).resolve(), Path(production_repo).resolve()
    expected = _marker(source)
    validate_immutable_generation(source, expected)
    if int(expected.get("metadata", {}).get("request_id", -1)) != int(request_id):
        raise RuntimeError("Delivery request does not match manifest provenance")
    _require_main(repo)
    receipt = _remote_receipt(repo, expected)
    if receipt:
        return receipt
    stage = STAGING_ROOT / f"quantum-{int(request_id):012d}"
    target = stage / "files" / DATA_REL
    if (stage / ".complete").exists():
        if _marker(target) != expected:
            raise RuntimeError("Complete staged request is bound to another generation")
        validate_immutable_generation(target, expected)
    else:
        copy_immutable_generation(source, target)
        _atomic_write_text(stage / ".complete", json.dumps({"generation_id": expected["generation_id"], "request_id": int(request_id)}) + "\n")
    _invoke_deployer(repo)
    receipt = _remote_receipt(repo, expected)
    if receipt is None:
        raise RuntimeError("Website deploy did not produce a verified remote generation receipt")
    return receipt


def _dirty_paths(repo: Path) -> list[str]:
    entries = _git(repo, "status", "--porcelain=v1", "-z", "--untracked-files=all").stdout.split("\0")
    paths = []
    for entry in entries:
        if not entry:
            continue
        if len(entry) < 4 or entry[2] != " " or "R" in entry[:2] or "C" in entry[:2]:
            raise RuntimeError("Unsupported rename/conflict in standalone worktree")
        paths.append(entry[3:])
    return paths


def _require_owned_local_history(repo: Path) -> None:
    # A clean worktree can still contain unpublished source commits. Only
    # generated commits from this delivery path may ride along with its push.
    subjects = _git(repo, "log", "--format=%s", "origin/main..HEAD").stdout.splitlines()
    if any(not (re.fullmatch(r"Publish Quantum generation [A-Za-z0-9_-]+", subject)
                or subject == "Merge remote-tracking branch 'origin/main'") for subject in subjects):
        raise RuntimeError("Standalone has unrelated unpublished commits; publish or reconcile them separately")


def _require_owned_index(repo: Path, expected_paths: dict[str, str]) -> None:
    staged = _git(repo, "diff", "--cached", "--name-only", "-z").stdout.split("\0")
    for relative in filter(None, staged):
        if relative not in expected_paths:
            raise RuntimeError(f"Standalone has an unrelated staged change: {relative}")
        entries = _git(repo, "ls-files", "--stage", "-z", "--", relative).stdout.split("\0")
        entries = [entry.split("\t", 1)[0].split() for entry in entries if entry]
        # Compare the index itself: an owned worktree file does not grant
        # permission to overwrite a different manual edit staged underneath it.
        worktree_blob = _git(repo, "hash-object", "--no-filters", "--", relative).stdout.strip()
        if len(entries) != 1 or entries[0] != ["100644", worktree_blob, "0"]:
            raise RuntimeError(f"Standalone staged change differs from retained output: {relative}")


def _merge_standalone_remote(repo: Path) -> None:
    result = _git(repo, "merge", "--no-edit", "origin/main", check=False)
    if result.returncode:
        # The entry point rejects an existing user-owned Git operation. Undo
        # only a merge started here, leaving generated commits retryable.
        merge_head = _git(repo, "rev-parse", "--verify", "MERGE_HEAD", check=False)
        if not merge_head.returncode:
            _git(repo, "merge", "--abort")
        raise RuntimeError(f"Standalone remote merge failed: {result.stderr.strip()}")


def deliver_standalone(data_dir: Path, standalone_repo: Path, request_id: int | None = None,
                       *, runtime_dir: Path = QUANTUM_DIR) -> dict:
    """Ordinary fetch/merge/commit/push; never force, reset, or stage unrelated work."""
    source, repo = Path(data_dir).resolve(), Path(standalone_repo).resolve()
    expected = _marker(source)
    validate_immutable_generation(source, expected)
    if request_id is not None and int(expected.get("metadata", {}).get("request_id", -1)) != int(request_id):
        raise RuntimeError("Delivery request does not match manifest provenance")
    _require_main(repo)
    for name in ("MERGE_HEAD", "rebase-merge", "rebase-apply"):
        operation = Path(_git(repo, "rev-parse", "--git-path", name).stdout.strip())
        if (operation if operation.is_absolute() else repo / operation).exists():
            raise RuntimeError("Finish the existing standalone Git operation before delivery")
    receipt = _remote_receipt(repo, expected)
    if receipt:
        return receipt
    _require_owned_local_history(repo)
    files = dict(runtime_dependency_copies(runtime_dir, repo))
    expected_paths = {target.relative_to(repo).as_posix(): file_sha256(origin) for origin, target in files.items()}
    for logical, artifact in expected["artifacts"].items():
        if not logical.startswith("archived/"):
            expected_paths[(DATA_REL / _safe_relative(logical)).as_posix()] = artifact["sha256"]
        expected_paths[(DATA_REL / _safe_relative(artifact["path"])).as_posix()] = artifact["sha256"]
    generation_manifest = DATA_REL / "generations" / expected["generation_id"] / "manifest.json"
    pointer_hash = file_sha256(source / PUBLICATION_MARKER_FILENAME)
    expected_paths[generation_manifest.as_posix()] = pointer_hash
    expected_paths[(DATA_REL / PUBLICATION_MARKER_FILENAME).as_posix()] = pointer_hash
    ledger = source / ".standalone-delivery.json"
    dirty = _dirty_paths(repo)
    if dirty:
        previous = json.loads(ledger.read_text()) if ledger.is_file() else None
        if not previous or previous.get("generation_id") != expected["generation_id"] or previous.get("paths") != expected_paths:
            raise RuntimeError("Standalone has unrelated or unowned worktree changes")
        for relative in dirty:
            path = repo / relative
            if (relative not in expected_paths or not path.is_file() or path.is_symlink()
                    or path.stat().st_mode & 0o111 or file_sha256(path) != expected_paths[relative]):
                raise RuntimeError(f"Standalone change differs from retained staged output: {relative}")
        _require_owned_index(repo, expected_paths)
    else:
        _merge_standalone_remote(repo)
    _atomic_write_text(ledger, json.dumps({"generation_id": expected["generation_id"], "paths": expected_paths}, sort_keys=True) + "\n")
    sync_generation_to_standalone(source, repo, runtime_dir=runtime_dir)
    for relative in _dirty_paths(repo):
        if relative not in expected_paths:
            raise RuntimeError(f"Standalone acquired an unrelated edit: {relative}")
    # Named paths, rather than a sweep of the worktree; Git can need a bounded
    # argv on large generations, so add paths in small batches.
    paths = sorted(expected_paths)
    for offset in range(0, len(paths), 100):
        _git(repo, "add", "--", *paths[offset:offset + 100])
    changed = _git(repo, "diff", "--cached", "--quiet", check=False)
    if changed.returncode == 1:
        _git(repo, "commit", "-m", f"Publish Quantum generation {expected['generation_id']}")
    elif changed.returncode:
        raise RuntimeError("Could not inspect standalone index")
    for attempt in range(2):
        _git(repo, "fetch", "origin", "main")
        receipt = _remote_receipt(repo, expected, fetch=False)
        if receipt:
            return receipt
        _require_owned_local_history(repo)
        _merge_standalone_remote(repo)
        pushed = _git(repo, "push", "origin", "HEAD:main", check=False)
        if not pushed.returncode:
            receipt = _remote_receipt(repo, expected)
            if receipt:
                return receipt
        if attempt:
            raise RuntimeError("Standalone push did not produce a verified remote receipt; retained outputs can retry")
    raise RuntimeError("Unreachable standalone delivery state")
