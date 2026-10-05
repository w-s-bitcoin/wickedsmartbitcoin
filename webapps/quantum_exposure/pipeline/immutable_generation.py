"""Immutable, verified Quantum exports. All operations require explicit roots.

This module never connects to a database, invokes a producer, or publishes Git.
The legacy format-1 writer remains available for old pipeline invocations.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import re
import shutil
import tempfile
import uuid
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path, PurePosixPath
import quantum_archive_summaries as archive_summaries

from publish_generation import (
    ARCHIVED_INDEX_HEADERS, HISTORICAL_ECO_HEADERS, PUBLICATION_MARKER_FILENAME,
    _atomic_write_text, _guarded_rows, _historical_preview_artifact, _validate_final_generation,
    read_latest_snapshot_height, HISTORICAL_SCRIPT_TYPES,
)

VERSION_KEYS = (
    "source_generation", "code_revision", "methodology_version", "parser_version",
    "label_version", "scenario_version", "export_version",
)
SUBSET_CORRECTION_VERSION = 'script-mask-mobius-wu-v1'
SCRIPT_CORRECTIONS_FILE = 'dashboard_script_corrections.csv'
SCRIPT_FAMILIES = ('P2PK', 'P2PKH', 'P2SH', 'P2WPKH', 'P2WSH', 'P2TR', 'Other')
SCRIPT_CORRECTION_FIELDS = ('balance_filter', 'script_mask', 'spend_activity_filter',
                            'pubkey_count_correction', 'exposed_pubkey_count_correction',
                            'migration_weight_wu_correction')


def _chunks(handle, guard=None):
    """Check the caller's existing budget before each bounded file operation."""
    while True:
        if guard is not None:
            guard()
        chunk = handle.read(1024 * 1024)
        if not chunk:
            return
        yield chunk


def _read_text(path: Path, *, guard=None) -> str:
    with path.open(encoding='utf-8') as handle:
        return ''.join(_chunks(handle, guard))


def _copy_file(source: Path, target: Path, *, guard=None) -> None:
    """Keep an old destination intact if a caller's guard interrupts a copy."""
    if guard is not None:
        guard()
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = None
    try:
        with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as handle:
            temp = Path(handle.name)
            with source.open('rb') as source_handle:
                for chunk in _chunks(source_handle, guard):
                    handle.write(chunk)
        os.chmod(temp, 0o644)
        if guard is not None:
            guard()
        os.replace(temp, target)
        temp = None
    finally:
        if temp is not None:
            temp.unlink(missing_ok=True)


def snapshot_methodologies(data_dir: Path, *, include_archives: bool, guard=None) -> dict:
    """Describe retained snapshots individually; new provenance is not retroactive."""
    result = {}
    catalogs = [(data_dir / 'snapshots_index.csv', '')]
    if include_archives and (data_dir / 'archived_index.csv').is_file():
        catalogs.append((data_dir / 'archived_index.csv', 'archived/'))
    for catalog, prefix in _guarded_rows(catalogs, guard):
        with catalog.open(newline='') as handle:
            heights = [row['snapshot_blockheight'] for row in _guarded_rows(csv.DictReader(handle), guard)]
        for height in _guarded_rows(heights, guard):
            directory = data_dir / _safe_relative(f'{prefix}{height}')
            with (directory / 'dashboard_snapshot_meta.csv').open(newline='') as handle:
                meta = next(_guarded_rows(csv.DictReader(handle), guard), {})
            versions = {}
            version_path = directory / 'analysis_versions.json'
            if version_path.is_file():
                versions = json.loads(_read_text(version_path, guard=guard))
                for key in (*VERSION_KEYS, 'subset_correction_version', 'block_hash', 'snapshot_block_hash'):
                    if key in versions and key in meta and str(versions[key]) != str(meta[key]):
                        raise RuntimeError(f'Snapshot version metadata disagrees: {height}, {key}')
            values = {**versions, **meta}
            if values.get('export_version') == 'quantum-csv-v2':
                item = {key: values[key] for key in (*VERSION_KEYS, 'grouping_version', 'block_hash',
                        'date_semantics', 'exposure_coverage', 'exposure_limitations', 'supply_semantics',
                        'subset_correction_version', 'detail_coverage') if key in values}
                item['provenance_status'] = 'versioned-export; independent validation recorded separately'
                item['activity_semantics'] = 'canonical group last-spend time with calendar-year cutoff'
            else:
                item = {'methodology_version': 'legacy-v1-unreconciled', 'export_version': 'legacy-csv-v1',
                        'provenance_status': 'retained legacy values; not independently reconciled',
                        'activity_semantics': 'retained legacy activity labels; sentinel spend dates are unknown'}
            if height in result:
                raise RuntimeError(f'Snapshot appears in both active and archived provenance: {height}')
            result[height] = item
    return result


def _safe_relative(value: str) -> Path:
    path = PurePosixPath(value)
    if not value or not path.parts or path.is_absolute() or ".." in path.parts or "\\" in value:
        raise RuntimeError(f"Unsafe generation artifact path: {value!r}")
    return Path(*path.parts)


def file_sha256(path: Path, *, guard=None) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in _chunks(handle, guard):
            digest.update(chunk)
    return digest.hexdigest()


def validate_script_corrections(snapshot: Path, provenance: dict, *, guard=None) -> None:
    """Validate compact signed corrections and their conservation against All."""
    version = provenance.get('subset_correction_version')
    if not version:
        return
    if version != SUBSET_CORRECTION_VERSION:
        raise RuntimeError('Unsupported script subset correction version')
    with (snapshot / 'dashboard_pubkeys_aggregates.csv').open(newline='') as handle:
        aggregates = list(_guarded_rows(csv.DictReader(handle), guard))
    expected_keys = {(tier, activity) for tier in ('all', 'ge1', 'ge10', 'ge100', 'ge1000')
                     for activity in ('all', 'never_spent', 'inactive', 'active')}
    buckets = {}
    for row in _guarded_rows(aggregates, guard):
        key = (row['balance_filter'], row['spend_activity_filter'])
        if key not in expected_keys:
            raise RuntimeError('Unknown script subset aggregate filter')
        values = []
        for field in ('pubkey_count', 'exposed_pubkey_count', 'migration_weight_wu'):
            if not re.fullmatch(r'\d+', row.get(field, '')):
                raise RuntimeError(f'Script subset aggregate requires nonnegative integer {field}')
            values.append(int(row[field]))
        bucket = buckets.setdefault(key, {'All': None, 'sum': [0, 0, 0], 'families': set()})
        family = row['script_type_filter']
        if family == 'All':
            if bucket['All'] is not None:
                raise RuntimeError('Duplicate script subset All aggregate')
            bucket['All'] = values
        elif family in SCRIPT_FAMILIES:
            if family in bucket['families']:
                raise RuntimeError('Duplicate script subset family aggregate')
            bucket['families'].add(family)
            bucket['sum'] = [a + b for a, b in zip(bucket['sum'], values)]
        else:
            raise RuntimeError('Unknown script subset aggregate family')
    with (snapshot / SCRIPT_CORRECTIONS_FILE).open(newline='') as handle:
        reader = csv.DictReader(handle)
        if tuple(reader.fieldnames or ()) != SCRIPT_CORRECTION_FIELDS:
            raise RuntimeError('Invalid script subset correction columns')
        seen = set()
        for row in _guarded_rows(reader, guard):
            mask_text = row.get('script_mask', '')
            if not re.fullmatch(r'\d+', mask_text):
                raise RuntimeError('Invalid script subset correction mask')
            mask = int(mask_text)
            key = (row['balance_filter'], row['spend_activity_filter'])
            if mask > 127 or mask.bit_count() < 2 or key not in buckets or (*key, mask) in seen:
                raise RuntimeError('Invalid or duplicate script subset correction key')
            seen.add((*key, mask))
            values = []
            for field in SCRIPT_CORRECTION_FIELDS[3:]:
                if not re.fullmatch(r'-?\d+', row.get(field, '')):
                    raise RuntimeError('Script subset corrections must be signed integers')
                values.append(int(row[field]))
            buckets[key]['sum'] = [a + b for a, b in zip(buckets[key]['sum'], values)]
    if set(buckets) != expected_keys:
        raise RuntimeError('Incomplete script subset aggregate filters')
    for bucket in buckets.values():
        if bucket['families'] != set(SCRIPT_FAMILIES) or bucket['All'] != bucket['sum']:
            raise RuntimeError('Script subset corrections do not reconcile with the exact All aggregate')


def _supply(row: dict) -> int:
    try:
        values = json.loads(row["exposed_supply_sats_by_script_type"])
        if not isinstance(values, dict) or any(type(v) is not int or v < 0 for v in values.values()):
            raise ValueError("noninteger or negative amount")
        return sum(values.values())
    except (ValueError, TypeError, KeyError) as exc:
        raise RuntimeError("Invalid exact exposure amount map") from exc


def validate_exact_snapshot(data_dir: Path, height: int, *, guard=None) -> None:
    """Verify values, rankings and conservation, beyond shape-only checks."""
    snapshot = data_dir / str(height)
    with (snapshot / "dashboard_pubkeys_ge_1btc_top100.csv").open(newline="") as handle:
        top = list(_guarded_rows(csv.DictReader(handle), guard))
    top_by_id = {row["display_group_ids"]: row for row in top}
    top_amounts = [_supply(row) for row in top]
    if top_amounts != sorted(top_amounts, reverse=True):
        raise RuntimeError("Top-100 exposure rows are not ranked by exposed amount")
    total_sats = total_utxos = 0
    exposed_buckets = {}
    with (snapshot / "dashboard_pubkeys_ge_1btc.csv").open(newline="") as handle:
        for row in _guarded_rows(csv.DictReader(handle), guard):
            amount = _supply(row)
            total_sats += amount
            utxos = int(row["exposed_utxo_count"])
            if utxos < 0:
                raise RuntimeError("Negative exposed UTXO count")
            total_utxos += utxos
            if "current_supply_sats" not in row or "exposed_utxo_count_by_script_type" not in row:
                raise RuntimeError("Immutable v2 detail requires exact group balance and script counts")
            balance = int(row["current_supply_sats"])
            amount_map = json.loads(row["exposed_supply_sats_by_script_type"])
            count_map = json.loads(row["exposed_utxo_count_by_script_type"])
            if any(type(value) is not int or value < 0 for value in count_map.values()) or sum(count_map.values()) != utxos:
                raise RuntimeError("Per-script UTXO counts do not equal detail total")
            if balance < 100_000_000 or utxos <= 0 or amount < 0 or amount > balance:
                raise RuntimeError("Detail row violates canonical GE1 exposure eligibility")
            selections = {"All": (amount, utxos)}
            selections.update({family: (value, count_map.get(family, 0)) for family, value in amount_map.items()})
            for tier, minimum in (("ge1", 100_000_000), ("ge10", 1_000_000_000), ("ge100", 10_000_000_000), ("ge1000", 100_000_000_000)):
                if balance < minimum:
                    continue
                for family, (selected_amount, selected_count) in selections.items():
                    for activity in ("all", row["spend_activity"]):
                        bucket = exposed_buckets.setdefault((tier, family, activity), [0, 0, 0])
                        bucket[0] += int(selected_count > 0)
                        bucket[1] += selected_count
                        bucket[2] += selected_amount
            identifier = row["display_group_ids"]
            if identifier in top_by_id:
                if any(row.get(key) != value for key, value in top_by_id[identifier].items()):
                    raise RuntimeError(f"Top-100 values differ from full export: {identifier}")
            elif top_amounts and amount > top_amounts[-1]:
                raise RuntimeError("Top-100 excludes an exposure larger than its smallest row")
    with (snapshot / "dashboard_pubkeys_aggregates.csv").open(newline="") as handle:
        aggregates = list(_guarded_rows(csv.DictReader(handle), guard))
    by_filter = {(r["balance_filter"], r["script_type_filter"], r["spend_activity_filter"]): r for r in aggregates}
    ge1 = by_filter[("ge1", "All", "all")]
    if (total_sats, total_utxos) != (int(ge1["exposed_supply_sats"]), int(ge1["exposed_utxo_count"])):
        raise RuntimeError("GE1 detail amounts/UTXOs do not equal canonical aggregate")
    for key, aggregate in _guarded_rows(by_filter.items(), guard):
        if key[0] == "all":
            continue  # Full detail intentionally omits sub-1 BTC groups.
        expected = exposed_buckets.get(key, [0, 0, 0])
        actual = [int(aggregate[column]) for column in ("exposed_pubkey_count", "exposed_utxo_count", "exposed_supply_sats")]
        if actual != expected:
            raise RuntimeError(f"Detail exposure filter values differ from canonical aggregate: {key}")
    with (data_dir / "historical_eco.csv").open(newline="") as handle:
        for row in _guarded_rows(csv.DictReader(handle), guard):
            if row["snapshot"] != str(height):
                continue
            key = (row["balance_filter"], row["script_type_filter"], row["spend_activity_filter"])
            expected = by_filter[key]
            for column in HISTORICAL_ECO_HEADERS[4:]:
                try:
                    equal = Decimal(row[column]) == Decimal(expected[column])
                except InvalidOperation:
                    equal = False
                if not equal:
                    raise RuntimeError(f"Historical aggregate value differs: {key}, {column}")


def _store_artifact(data_dir: Path, logical: str, *, content: bytes | None = None, guard=None) -> dict:
    """Copy and hash the same byte stream; reuse only verified immutable objects."""
    source = data_dir / _safe_relative(logical)
    object_root = data_dir / "generations" / "objects"
    object_root.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    byte_count = 0
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(dir=object_root, delete=False) as target:
            temp_path = Path(target.name)
            with (io.BytesIO(content) if content is not None else source.open("rb")) as handle:
                for chunk in _chunks(handle, guard):
                    target.write(chunk)
                    digest.update(chunk)
                    byte_count += len(chunk)
            target.flush()
            os.fsync(target.fileno())
        checksum = digest.hexdigest()
        relative = Path("generations") / "objects" / checksum[:2] / (checksum + source.suffix)
        destination = data_dir / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            if destination.stat().st_size != byte_count or file_sha256(destination, guard=guard) != checksum:
                raise RuntimeError(f"Existing immutable artifact is corrupt: {relative}")
            temp_path.unlink()
        else:
            os.chmod(temp_path, 0o644)
            if guard is not None:
                guard()
            os.replace(temp_path, destination)
        temp_path = None
        artifact = {"path": relative.as_posix(), "sha256": checksum, "bytes": byte_count}
        if source.suffix == ".csv":
            with destination.open(encoding="utf-8", newline="") as handle:
                reader = csv.reader(handle)
                next(reader, None)
                artifact["rows"] = sum(1 for _ in _guarded_rows(reader, guard))
        return artifact
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


def publish_immutable_generation(
    data_dir: Path, *, reason: str, metadata: dict, generation_id: str | None = None,
    include_archives: bool = False, include_historical_full: bool = False, guard=None,
) -> str:
    if guard is not None:
        guard()
    data_dir = Path(data_dir).resolve()
    metadata = dict(metadata)
    if not re.fullmatch(r"[a-f0-9]{64}", str(metadata.get("block_hash", ""))):
        raise RuntimeError("Immutable generation requires the canonical target block hash")
    if any(not str(metadata.get(key, "")).strip() for key in VERSION_KEYS):
        raise RuntimeError("Immutable generation requires all source/code/analysis/export versions")
    height = read_latest_snapshot_height(data_dir)
    _validate_final_generation(data_dir, height, historical_script_types=HISTORICAL_SCRIPT_TYPES | {"Other"}, guard=guard)
    validate_exact_snapshot(data_dir, height, guard=guard)
    metadata['methodology_by_snapshot'] = snapshot_methodologies(data_dir, include_archives=include_archives, guard=guard)
    summary = archive_summaries.staged_metadata(data_dir,include_archives=include_archives,
        complete_heights=metadata['methodology_by_snapshot'],target_height=height,guard=guard)
    metadata.pop('archive_summaries',None)
    if summary:
        metadata['archive_summaries']=summary
        for selected in _guarded_rows(summary['snapshot_heights'], guard):
            metadata['methodology_by_snapshot'][str(selected)]={
                'methodology_version':archive_summaries.METHOD,'export_version':'legacy-historical-summary-v1',
                'artifact_coverage':'historical-summary-only',
                'provenance_status':summary['provenance_status'],
                'activity_semantics':'retained legacy activity labels; no detailed spend dates available'}
    generation_id = generation_id or uuid.uuid4().hex
    if not re.fullmatch(r"[A-Za-z0-9_-]+", generation_id):
        raise RuntimeError("Invalid immutable generation identifier")
    manifest_path = data_dir / "generations" / generation_id / "manifest.json"
    # Durable workers use the same ID when retrying publication. Verify the old
    # immutable result instead of changing its publication timestamp or bytes.
    if manifest_path.exists():
        previous_text = _read_text(manifest_path, guard=guard)
        previous = json.loads(previous_text)
        if previous.get("metadata") != metadata or previous.get("snapshot_blockheight") != height:
            raise RuntimeError("Generation ID is already bound to different provenance")
        validate_immutable_generation(data_dir, previous, guard=guard)
        _atomic_write_text(data_dir / PUBLICATION_MARKER_FILENAME, previous_text, guard=guard)
        return previous_text

    logical_paths = {"latest_snapshot.txt", "snapshots_index.csv", "historical_eco.csv"}
    for optional in ("identity_groups.json",):
        if (data_dir / optional).is_file():
            logical_paths.add(optional)
    if summary:
        logical_paths.add(archive_summaries.FILE)
        for source in _guarded_rows(summary['sources'], guard):
            logical_paths.update(source[kind+'_artifact'] for kind in ('history','index'))
    indexes = [(data_dir / "snapshots_index.csv", "")]
    if include_archives and (data_dir / "archived_index.csv").is_file():
        indexes.append((data_dir / "archived_index.csv", "archived/"))
    for index, prefix in _guarded_rows(indexes, guard):
        with index.open(newline="") as handle:
            for row in _guarded_rows(csv.DictReader(handle), guard):
                selected = row["snapshot_blockheight"]
                validate_script_corrections(data_dir / f'{prefix}{selected}', metadata['methodology_by_snapshot'][selected], guard=guard)
                for required in ("dashboard_snapshot_meta.csv", "dashboard_pubkeys_aggregates.csv"):
                    if not (data_dir / f"{prefix}{selected}/{required}").is_file():
                        raise RuntimeError(f"Historical snapshot {selected} is missing {required}")
                for filename in ("dashboard_snapshot_meta.csv", "dashboard_pubkeys_aggregates.csv", SCRIPT_CORRECTIONS_FILE, "dashboard_pubkeys_ge_1btc_top100.csv", "snapshot_diff_summary.txt", "analysis_versions.json"):
                    logical = f"{prefix}{selected}/{filename}"
                    if (data_dir / logical).is_file():
                        logical_paths.add(logical)
                if selected == str(height) or include_historical_full:
                    logical = f"{prefix}{selected}/dashboard_pubkeys_ge_1btc.csv"
                    if (data_dir / logical).is_file():
                        logical_paths.add(logical)
    artifacts = {logical: _store_artifact(data_dir, logical, guard=guard) for logical in sorted(logical_paths)}
    for filename, headers in (("archived_index.csv", ARCHIVED_INDEX_HEADERS), ("historical_archived.csv", HISTORICAL_ECO_HEADERS)):
        content = None if include_archives and (data_dir / filename).is_file() else (",".join(headers) + "\n").encode()
        artifacts[filename] = _store_artifact(data_dir, filename, content=content, guard=guard)
    preview = _historical_preview_artifact(data_dir, guard=guard)
    artifacts["historical_eco.csv"].update({key: preview[key] for key in ("first_snapshot", "latest_snapshot")})
    manifest = {
        "format": 2, "generation_id": generation_id, "snapshot_blockheight": height,
        "published_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "reason": reason, "metadata": metadata, "artifacts": artifacts,
        "capabilities": {"archives": include_archives, "archive_summaries":bool(summary),
                         "historical_full": include_historical_full, "current_full": True},
    }
    text = json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n"
    validate_immutable_generation(data_dir, manifest, guard=guard)
    _atomic_write_text(manifest_path, text, guard=guard)
    _atomic_write_text(data_dir / PUBLICATION_MARKER_FILENAME, text, guard=guard)
    return text


def validate_immutable_generation(data_dir: Path, manifest: dict, *, guard=None) -> None:
    if guard is not None:
        guard()
    metadata = manifest.get("metadata", {})
    height = manifest.get("snapshot_blockheight")
    artifacts = manifest.get("artifacts")
    if (manifest.get("format") != 2 or not isinstance(artifacts, dict) or not artifacts
            or not re.fullmatch(r"[A-Za-z0-9_-]+", str(manifest.get("generation_id", "")))
            or type(height) is not int or height < 0
            or not isinstance(metadata, dict)
            or not re.fullmatch(r"[a-f0-9]{64}", str(metadata.get("block_hash", "")))
            or any(not str(metadata.get(key, "")).strip() for key in VERSION_KEYS)):
        raise RuntimeError("Invalid immutable Quantum manifest")
    required = {"latest_snapshot.txt", "snapshots_index.csv", "historical_eco.csv", "archived_index.csv", "historical_archived.csv"}
    required.update(f"{height}/{name}" for name in ("dashboard_snapshot_meta.csv", "dashboard_pubkeys_aggregates.csv", "dashboard_pubkeys_ge_1btc_top100.csv"))
    if manifest.get("capabilities", {}).get("current_full"):
        required.add(f"{height}/dashboard_pubkeys_ge_1btc.csv")
    for snapshot, provenance in _guarded_rows(metadata.get('methodology_by_snapshot', {}).items(), guard):
        version = provenance.get('subset_correction_version')
        if not version:
            continue
        if version != SUBSET_CORRECTION_VERSION:
            raise RuntimeError('Unsupported script subset correction version')
        prefix = str(snapshot) if f'{snapshot}/dashboard_snapshot_meta.csv' in artifacts else f'archived/{snapshot}'
        required.add(f'{prefix}/{SCRIPT_CORRECTIONS_FILE}')
    if not required.issubset(artifacts):
        raise RuntimeError("Immutable Quantum manifest is missing required artifacts")
    root = Path(data_dir).resolve()
    for logical, artifact in _guarded_rows(artifacts.items(), guard):
        logical_path = _safe_relative(logical)
        if logical_path.parts[0] == "generations" or logical == PUBLICATION_MARKER_FILENAME:
            raise RuntimeError("Logical artifact overlaps generation storage")
        if (not isinstance(artifact, dict) or type(artifact.get("bytes")) is not int or artifact["bytes"] < 0
                or not re.fullmatch(r"[a-f0-9]{64}", str(artifact.get("sha256", "")))
                or (logical.endswith(".csv") and (type(artifact.get("rows")) is not int or artifact["rows"] < 0))):
            raise RuntimeError(f"Invalid immutable artifact metadata: {logical}")
        relative = _safe_relative(artifact["path"])
        checksum = artifact["sha256"]
        expected_object = f"generations/objects/{checksum[:2]}/{checksum}{logical_path.suffix}"
        if relative.as_posix() != expected_object:
            raise RuntimeError("Immutable artifact is outside generation storage")
        path = root / relative
        if not path.resolve().is_relative_to(root):
            raise RuntimeError("Immutable artifact escapes generation storage")
        if not path.is_file() or path.stat().st_size != artifact["bytes"] or file_sha256(path, guard=guard) != artifact["sha256"]:
            raise RuntimeError(f"Immutable artifact failed verification: {logical}")
    if _read_text(root / artifacts["latest_snapshot.txt"]["path"], guard=guard).strip() != str(height):
        raise RuntimeError("Immutable latest pointer does not match manifest")
    summary=metadata.get('archive_summaries')
    summary_artifacts={name for name in artifacts if name==archive_summaries.FILE or name.startswith(archive_summaries.SOURCE_PREFIX)}
    if summary is not None:
        if manifest.get('capabilities',{}).get('archive_summaries') is not True or not manifest.get('capabilities',{}).get('archives'):
            raise RuntimeError('Archive summary capability is not declared')
        expected={archive_summaries.FILE}|archive_summaries.source_artifacts(summary,guard=guard)
        if expected!=summary_artifacts:
            raise RuntimeError('Archive summary source artifacts are incomplete or unexpected')
        if artifacts[archive_summaries.FILE]['rows']!=summary.get('rows'):
            raise RuntimeError('Archive summary artifact rows differ from declared coverage')
        complete={int(match[1]) for logical in artifacts
                  if (match:=re.fullmatch(r'(?:archived/)?([0-9]+)/dashboard_snapshot_meta\.csv',logical))}
        archive_summaries.validate(lambda logical:root/artifacts[logical]['path'],summary,
                                   complete_heights=complete,target_height=height,guard=guard)
        for selected in _guarded_rows(summary['snapshot_heights'], guard):
            provenance=metadata.get('methodology_by_snapshot',{}).get(str(selected),{})
            if provenance.get('methodology_version')!=archive_summaries.METHOD or provenance.get('artifact_coverage')!='historical-summary-only':
                raise RuntimeError('Archive summary methodology is missing or relabelled')
    elif summary_artifacts or manifest.get('capabilities',{}).get('archive_summaries'):
        raise RuntimeError('Archive summary artifacts lack explicit provenance')


def copy_immutable_generation(source_dir: Path, target_dir: Path, *, materialize_aliases: bool = True, guard=None) -> str:
    """Copy verified changed objects and marker last; delivery order is caller-owned."""
    source_dir, target_dir = Path(source_dir), Path(target_dir)
    text = _read_text(source_dir / PUBLICATION_MARKER_FILENAME, guard=guard)
    manifest = json.loads(text)
    validate_immutable_generation(source_dir, manifest, guard=guard)
    for artifact in _guarded_rows(manifest["artifacts"].values(), guard):
        relative = _safe_relative(artifact["path"])
        source, target = source_dir / relative, target_dir / relative
        if target.is_file() and target.stat().st_size == artifact["bytes"] and file_sha256(target, guard=guard) == artifact["sha256"]:
            continue
        # Content-addressed URL is not advertised until its copy is complete.
        _copy_file(source, target, guard=guard)
    validate_immutable_generation(target_dir, manifest, guard=guard)
    if materialize_aliases:
        # Keep conventional root filenames coherent for existing tooling, while
        # format-2 browsers resolve only the immutable URLs in the manifest.
        for logical, artifact in _guarded_rows(manifest["artifacts"].items(), guard):
            # Legacy archive trees are intentionally ignored/local. Compact
            # v2 archive data is resolved from its manifest objects and must
            # not overwrite or require staging those separate legacy folders.
            if logical.startswith("archived/"):
                continue
            target = target_dir / _safe_relative(logical)
            if target.is_file() and target.stat().st_size == artifact['bytes'] and file_sha256(target, guard=guard) == artifact['sha256']:
                continue
            _copy_file(target_dir / _safe_relative(artifact['path']), target, guard=guard)
    generation = str(manifest["generation_id"])
    if not re.fullmatch(r"[A-Za-z0-9_-]+", generation):
        raise RuntimeError("Invalid generation ID")
    _atomic_write_text(target_dir / "generations" / generation / "manifest.json", text, guard=guard)
    _atomic_write_text(target_dir / PUBLICATION_MARKER_FILENAME, text, guard=guard)
    return text


def prepare_public_bundle(data_dir: Path, *, guard=None) -> None:
    """Prune immutable archive/full-history capabilities in a disposable build.

    This operates only on the caller's explicit copied bundle. Historic compact
    generation manifests remain resolvable; no source datasets are modified.
    """
    data_dir = Path(data_dir).resolve()
    if guard is not None:
        guard()
    # An ordinary rollback can restore a legacy pointer (or its absence) while
    # retaining newer immutable objects for existing readers. Archive evidence
    # is still private to archive-capable distributions in that state.
    (data_dir/archive_summaries.FILE).unlink(missing_ok=True)
    (data_dir/archive_summaries.STAGED_METADATA).unlink(missing_ok=True)
    sources=data_dir/archive_summaries.SOURCE_PREFIX
    if sources.is_dir():shutil.rmtree(sources)
    pointer = data_dir / PUBLICATION_MARKER_FILENAME
    current = json.loads(_read_text(pointer, guard=guard)) if pointer.is_file() else None
    latest_height = str(current['snapshot_blockheight']) if current else (
        str(read_latest_snapshot_height(data_dir)) if (data_dir/'latest_snapshot.txt').is_file() else None)
    allowed_objects = set()
    manifests = sorted((data_dir / "generations").glob("*/manifest.json"))
    # Preserve a restored legacy marker byte-for-byte, including its identity
    # and historical artifact hash. Never synthesize a missing marker.
    if current and current.get('format') == 2:
        manifests.append(pointer)
    for path in _guarded_rows(manifests, guard):
        manifest = json.loads(_read_text(path, guard=guard))
        if manifest.get("format") != 2:
            continue
        artifacts = {
            logical: artifact for logical, artifact in manifest["artifacts"].items()
            if not logical.startswith(("archived/",archive_summaries.SOURCE_PREFIX))
            and logical!=archive_summaries.FILE and not (
                logical.endswith("/dashboard_pubkeys_ge_1btc.csv")
                and (latest_height is None or not logical.startswith(latest_height + "/"))
            )
        }
        for filename, headers in (("archived_index.csv", ARCHIVED_INDEX_HEADERS), ("historical_archived.csv", HISTORICAL_ECO_HEADERS)):
            artifacts[filename] = _store_artifact(data_dir, filename, content=(",".join(headers) + "\n").encode(), guard=guard)
        manifest["artifacts"] = artifacts
        manifest.get('metadata',{}).pop('archive_summaries',None)
        provenance = manifest.get('metadata', {}).get('methodology_by_snapshot', {})
        manifest['metadata']['methodology_by_snapshot'] = {height: value for height, value in provenance.items()
            if f'{height}/dashboard_snapshot_meta.csv' in artifacts}
        manifest["capabilities"] = {"archives": False, "archive_summaries":False,"historical_full": False,
                                    "current_full": str(manifest["snapshot_blockheight"]) == latest_height}
        validate_immutable_generation(data_dir, manifest, guard=guard)
        _atomic_write_text(path, json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n", guard=guard)
        allowed_objects.update(artifact["path"] for artifact in artifacts.values())
    for path in _guarded_rows((data_dir / "generations" / "objects").rglob("*"), guard):
        if path.is_file() and path.relative_to(data_dir).as_posix() not in allowed_objects:
            path.unlink()
