#!/usr/bin/env python3
"""Fixture-only immutable publication, exact values, isolation and retry tests."""
import csv
import copy
import io
import json
import shutil
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
PIPELINE = ROOT / "webapps/quantum_exposure/pipeline"
sys.path.insert(0, str(PIPELINE))
import immutable_generation as publication
import quantum_v2_analysis as analysis
import normalize_snapshot_csvs as normalizer
import sync_identity_consensus_from_snapshots as identities
import quantum_runtime as runtime
import quantum_archive_summaries as archive_summaries
from publish_generation import publish_generation_marker


def seed(directory: Path, height=1000):
    rows = [dict(group_id="group-a", script_type="P2PK", current_supply_sats=60_000_000,
                 current_utxo_count=2, exposed_supply_sats=60_000_000, exposed_utxo_count=2,
                 first_received_blockheight=100, first_exposed_blockheight=200, first_exposed_time=1_300_000_000),
            dict(group_id="group-a", script_type="P2PKH", current_supply_sats=60_000_000,
                 current_utxo_count=3, exposed_supply_sats=60_000_000, exposed_utxo_count=3,
                 first_received_blockheight=100, first_exposed_blockheight=200, first_exposed_time=1_300_000_000)]
    analysis.export_snapshot(rows, snapshot_height=height, snapshot_time=1_700_000_000,
                             output_dir=directory, block_hash="a" * 64, source_generation="fixture")
    (directory / "latest_snapshot.txt").write_text(str(height))
    subprocess.run([sys.executable, str(PIPELINE / "regenerate_snapshot_indexes.py"), "--data-dir", str(directory)],
                   check=True, capture_output=True, text=True)
    return dict(block_hash="a" * 64, **{key: "fixture-v1" for key in publication.VERSION_KEYS})


def seed_archive_summaries(directory: Path, heights=(100, 200), target_height=1000):
    """Retained legacy rows deliberately include unreconciled exposure totals."""
    previous_catalogs = {name: (directory / name).read_bytes() if (directory / name).is_file() else None
                        for name in ('historical_archived.csv', 'archived_index.csv')}
    history = io.StringIO(newline='')
    writer = csv.DictWriter(history, fieldnames=publication.HISTORICAL_ECO_HEADERS)
    writer.writeheader()
    for height in heights:
        for script in ('All', 'P2PK'):
            writer.writerow(dict(snapshot=height, balance_filter='all', script_type_filter=script,
                spend_activity_filter='all', pubkey_count='2', utxo_count='3', supply_sats='100',
                exposed_pubkey_count='4', exposed_utxo_count='5', exposed_supply_sats='200',
                estimated_migration_blocks='0.000000000001'))
    index = io.StringIO(newline='')
    writer = csv.writer(index)
    writer.writerow(publication.ARCHIVED_INDEX_HEADERS)
    for height in reversed(heights):
        writer.writerow((height, 1_300_000_000 + height))
    original = {'historical_archived.csv': history.getvalue().encode(), 'archived_index.csv': index.getvalue().encode()}
    for name, payload in original.items():
        (directory / name).write_bytes(payload)
    archive_summaries.stage(directory, directory, {}, lambda logical: directory / logical,
                            target_height=target_height, complete_heights=[])
    # Conventional catalogs continue to describe actual snapshot folders only.
    for name, fields in (('historical_archived.csv', publication.HISTORICAL_ECO_HEADERS),
                         ('archived_index.csv', publication.ARCHIVED_INDEX_HEADERS)):
        (directory / name).write_bytes(previous_catalogs[name] or (','.join(fields) + '\n').encode())
    return original


def publish_legacy_fixture(directory: Path):
    """Use the actual legacy marker writer with its historical family coverage."""
    path = directory / 'historical_eco.csv'
    with path.open(newline='') as handle:
        reader = csv.DictReader(handle)
        fields = reader.fieldnames
        rows = [row for row in reader if row['script_type_filter'] != 'Other']
    with path.open('w', newline='') as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    return publish_generation_marker(directory, reason='legacy rollback fixture', generation_id='legacy-fixture')


class ImmutablePublicationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="quantum-immutable-fixture-")
        self.addCleanup(self.temp.cleanup)
        self.data = Path(self.temp.name) / "stage"
        self.data.mkdir()
        self.metadata = seed(self.data)

    def publish(self):
        return publication.publish_immutable_generation(self.data, metadata=self.metadata,
                                                       reason="fixture", generation_id="fixture-run")

    def test_implementation_identity_ignores_data_but_tracks_runtime_and_migrations(self):
        repo = Path(self.temp.name) / 'source'
        app = repo / 'webapps/quantum_exposure'
        files = {'webapps/quantum_exposure/dashboard.html': '<script src="dashboard_app.js"></script>',
                 'webapps/quantum_exposure/dashboard_app.js': 'const version=1;',
                 'webapps/quantum_exposure/preview_app.js': 'const preview=1;',
                 'webapps/shared/webapp_data_auto_refresh.js': 'const refresh=1;',
                 'webapps/quantum_exposure/pipeline/worker.py': 'VERSION=1',
                 'webapps/quantum_exposure/pipeline/migrations/001.sql': 'SELECT 1;',
                 'scripts/automation/_git_deploy.py': 'VERSION=1',
                 'scripts/build_pages_dist.sh': 'true'}
        for relative, body in files.items():
            path = repo / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(body)
        initial = runtime.implementation_fingerprint(repo)
        (app / 'webapp_data').mkdir()
        (app / 'webapp_data/latest_snapshot.txt').write_text('2000')
        self.assertEqual(runtime.implementation_fingerprint(repo), initial)
        for relative in ('webapps/quantum_exposure/dashboard_app.js',
                         'webapps/quantum_exposure/pipeline/migrations/001.sql'):
            path = repo / relative
            body = path.read_text()
            path.write_text(body + '\nchanged')
            self.assertNotEqual(runtime.implementation_fingerprint(repo), initial)
            path.write_text(body)

    def test_exact_manifest_and_idempotent_publication(self):
        text = self.publish()
        marker = json.loads(text)
        self.assertEqual(marker["format"], 2)
        self.assertEqual(len(marker["artifacts"]), 11)
        self.assertEqual(marker['metadata']['methodology_by_snapshot']['1000']['subset_correction_version'],
                         publication.SUBSET_CORRECTION_VERSION)
        self.assertIn('1000/dashboard_script_corrections.csv',marker['artifacts'])
        self.assertEqual(marker['metadata']['methodology_by_snapshot']['1000']['export_version'], 'quantum-csv-v2')
        self.assertEqual(marker["artifacts"]["1000/dashboard_pubkeys_ge_1btc.csv"]["rows"], 1)
        publication.validate_immutable_generation(self.data, marker)
        self.assertEqual(self.publish(), text)
        self.assertEqual((self.data / "generations/fixture-run/manifest.json").read_text(), text)

    def test_old_generation_is_immutable_after_source_changes(self):
        marker = json.loads(self.publish())
        logical = "1000/dashboard_pubkeys_ge_1btc.csv"
        asset = self.data / marker["artifacts"][logical]["path"]
        original = asset.read_bytes()
        (self.data / logical).write_text("partial next export")
        self.assertEqual(asset.read_bytes(), original)
        publication.validate_immutable_generation(self.data, marker)

    def test_same_size_corruption_rejected(self):
        marker = json.loads(self.publish())
        asset = self.data / marker["artifacts"]["1000/dashboard_pubkeys_ge_1btc.csv"]["path"]
        content = asset.read_bytes()
        asset.write_bytes(content.replace(b"60000000", b"70000000", 1))
        with self.assertRaisesRegex(RuntimeError, "verification"):
            publication.validate_immutable_generation(self.data, marker)

    def test_missing_required_mapping_rejected(self):
        marker = json.loads(self.publish())
        del marker["artifacts"]["1000/dashboard_pubkeys_aggregates.csv"]
        with self.assertRaisesRegex(RuntimeError, "required artifacts"):
            publication.validate_immutable_generation(self.data, marker)

    def test_script_corrections_are_required_and_conserve_exact_rollups(self):
        path=self.data/'1000/dashboard_script_corrections.csv'
        original=path.read_bytes()
        path.unlink()
        with self.assertRaises(FileNotFoundError):
            self.publish()
        path.write_bytes(original)
        with path.open(newline='') as handle:
            reader=csv.DictReader(handle)
            fields=reader.fieldnames
            rows=list(reader)
        self.assertTrue(rows)
        rows[0]['exposed_pubkey_count_correction']=str(int(rows[0]['exposed_pubkey_count_correction'])+1)
        with path.open('w',newline='') as handle:
            writer=csv.DictWriter(handle,fieldnames=fields)
            writer.writeheader();writer.writerows(rows)
        with self.assertRaisesRegex(RuntimeError,'reconcile'):
            self.publish()
        path.write_bytes(original)
        marker=json.loads(self.publish())
        del marker['artifacts']['1000/dashboard_script_corrections.csv']
        with self.assertRaisesRegex(RuntimeError,'required artifacts'):
            publication.validate_immutable_generation(self.data,marker)

    def test_zero_value_exposed_utxo_retains_exact_detail_count(self):
        rows=[dict(group_id='zero-exposure-value',script_type='P2PKH',current_supply_sats=100_000_000,
                   current_utxo_count=1,exposed_supply_sats=0,exposed_utxo_count=0),
              dict(group_id='zero-exposure-value',script_type='P2WPKH',current_supply_sats=0,
                   current_utxo_count=1,exposed_supply_sats=0,exposed_utxo_count=1)]
        analysis.export_snapshot(rows,snapshot_height=1000,snapshot_time=1_700_000_000,
                                 output_dir=self.data,block_hash='a'*64,source_generation='fixture')
        subprocess.run([sys.executable,str(PIPELINE/'regenerate_snapshot_indexes.py'),'--data-dir',str(self.data)],
                       check=True,capture_output=True,text=True)
        marker=json.loads(self.publish())
        publication.validate_immutable_generation(self.data,marker)
        with (self.data/'1000/dashboard_pubkeys_ge_1btc.csv').open(newline='') as handle:
            detail=list(csv.DictReader(handle))
        self.assertEqual(len(detail),1)
        self.assertEqual(int(detail[0]['exposed_supply_sats']),0)
        self.assertEqual(int(detail[0]['exposed_utxo_count']),1)

    def test_retained_legacy_provenance_is_not_relabelled(self):
        old = self.data / '500'
        old.mkdir()
        (old / 'dashboard_snapshot_meta.csv').write_text('snapshot_blockheight,snapshot_time\n500,1300000000\n')
        shutil.copyfile(self.data / '1000/dashboard_pubkeys_aggregates.csv', old / 'dashboard_pubkeys_aggregates.csv')
        index = self.data / 'snapshots_index.csv'
        index.write_text(index.read_text() + '500,1300000000\n')
        # Existing history coverage validation requires its retained rows too.
        history = self.data / 'historical_eco.csv'
        lines = history.read_text().splitlines()
        history.write_text('\n'.join(lines + [line.replace('1000,', '500,', 1) for line in lines[1:]]) + '\n')
        marker = json.loads(self.publish())
        legacy = marker['metadata']['methodology_by_snapshot']['500']
        self.assertEqual(legacy['methodology_version'], 'legacy-v1-unreconciled')
        self.assertNotIn('block_hash', legacy)
        self.assertEqual(marker['metadata']['methodology_by_snapshot']['1000']['export_version'], 'quantum-csv-v2')

    def test_public_bundle_prunes_old_full_objects_without_mutating_source(self):
        previous = json.loads(self.publish())
        old_full = previous["artifacts"]["1000/dashboard_pubkeys_ge_1btc.csv"]["path"]
        metadata = seed(self.data, 2000)
        publication.publish_immutable_generation(self.data, metadata=metadata, reason="fixture", generation_id="next-run")
        bundle = Path(self.temp.name) / "public"
        shutil.copytree(self.data, bundle)
        publication.prepare_public_bundle(bundle)
        current = json.loads((bundle / "published_generation.json").read_text())
        historical = json.loads((bundle / "generations/fixture-run/manifest.json").read_text())
        self.assertFalse(historical["capabilities"]["current_full"])
        self.assertNotIn("1000/dashboard_pubkeys_ge_1btc.csv", historical["artifacts"])
        # Equal fixture data may share the same content-addressed object; it
        # must remain whenever the current table still references those bytes.
        referenced = {entry["path"] for entry in current["artifacts"].values()} | {entry["path"] for entry in historical["artifacts"].values()}
        self.assertEqual((bundle / old_full).exists(), old_full in referenced)
        publication.validate_immutable_generation(bundle, current)
        publication.validate_immutable_generation(bundle, historical)
        self.assertEqual(json.loads((self.data / "generations/fixture-run/manifest.json").read_text()), previous)

    def test_top100_values_must_match_full(self):
        path = self.data / "1000/dashboard_pubkeys_ge_1btc_top100.csv"
        path.write_text(path.read_text().replace("60000000", "70000000", 1))
        with self.assertRaisesRegex(RuntimeError, "Top-100 values"):
            self.publish()
        self.assertFalse((self.data / "published_generation.json").exists())

    def test_historical_values_must_match_snapshot(self):
        path = self.data / "historical_eco.csv"
        path.write_text(path.read_text().replace("120000000", "120000001", 1))
        with self.assertRaisesRegex(RuntimeError, "Historical aggregate value"):
            self.publish()

    def test_copy_is_verified_and_reuses_matching_objects(self):
        text = self.publish()
        target = Path(self.temp.name) / "destination"
        publication.copy_immutable_generation(self.data, target)
        marker = json.loads(text)
        obj = target / marker["artifacts"]["historical_eco.csv"]["path"]
        before = obj.stat().st_mtime_ns
        publication.copy_immutable_generation(self.data, target)
        self.assertEqual(obj.stat().st_mtime_ns, before)
        self.assertEqual((target / "published_generation.json").read_text(), text)

    def test_hash_and_artifact_copy_stop_between_megabyte_chunks(self):
        path = self.data / 'large.bin'
        path.write_bytes(b'x' * (3 * 1024 * 1024))
        class BudgetExpired(Exception):
            pass
        for action in (lambda guard: publication.file_sha256(path, guard=guard),
                       lambda guard: publication._store_artifact(self.data, path.name, guard=guard)):
            calls = []
            def guard():
                calls.append(None)
                if len(calls) == 2:
                    raise BudgetExpired('same caller deadline')
            with self.assertRaisesRegex(BudgetExpired, 'same caller deadline'):
                action(guard)
            self.assertEqual(len(calls), 2)
        objects = self.data / 'generations/objects'
        self.assertEqual(list(objects.iterdir()), [])
        self.assertFalse((self.data / 'published_generation.json').exists())

    def test_interrupted_atomic_copy_preserves_destination_and_removes_temporary(self):
        source = self.data / 'large.bin'
        source.write_bytes(b'x' * (3 * 1024 * 1024))
        target = Path(self.temp.name) / 'isolated' / 'target.bin'
        target.parent.mkdir()
        target.write_bytes(b'previous complete bytes')
        calls = []
        def guard():
            calls.append(None)
            if len(calls) == 3:
                raise TimeoutError('copy deadline')
        with self.assertRaisesRegex(TimeoutError, 'copy deadline'):
            publication._copy_file(source, target, guard=guard)
        self.assertEqual(target.read_bytes(), b'previous complete bytes')
        self.assertEqual(list(target.parent.iterdir()), [target])

    def test_exact_detail_validation_checks_guard_every_256_rows(self):
        detail = self.data / '1000/dashboard_pubkeys_ge_1btc.csv'
        with detail.open(newline='') as handle:
            reader = csv.DictReader(handle)
            fields, row = reader.fieldnames, next(reader)
        with detail.open('w', newline='') as handle:
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            writer.writerows(dict(row) for _ in range(600))
        # Only a bounded prefix may be examined before the guard's exception;
        # reaching final conservation would instead report the repeated totals.
        processed = []
        original = publication._supply
        def supply(row):
            processed.append(None)
            return original(row)
        def guard():
            if len(processed) >= 257:  # one top row, then 256 detail rows
                raise TimeoutError('detail deadline')
        with mock.patch.object(publication, '_supply', side_effect=supply):
            with self.assertRaisesRegex(TimeoutError, 'detail deadline'):
                publication.validate_exact_snapshot(self.data, 1000, guard=guard)
        self.assertEqual(len(processed), 257)

    def test_artifact_row_count_is_guarded_after_copy(self):
        path = self.data / 'many.csv'
        path.write_text('value\n' + '1\n' * 600)
        consumed = []
        original = csv.reader
        def reader(*args, **kwargs):
            for row in original(*args, **kwargs):
                consumed.append(None)
                yield row
        def guard():
            if len(consumed) >= 257:  # header plus the first 256 data rows
                raise TimeoutError('row-count deadline')
        with mock.patch.object(publication.csv, 'reader', side_effect=reader):
            with self.assertRaisesRegex(TimeoutError, 'row-count deadline'):
                publication._store_artifact(self.data, path.name, guard=guard)
        # The shared guarded iterator fetches one lookahead row before checking
        # the next 256-row block; that row is never counted or processed.
        self.assertEqual(len(consumed), 258)
        # A complete unreferenced object is safe to reuse; no partial object or
        # falsely advertised marker may be left by the interrupted count.
        objects = [path for path in (self.data / 'generations/objects').rglob('*') if path.is_file()]
        self.assertEqual(len(objects), 1)
        self.assertEqual(objects[0].read_bytes(), path.read_bytes())
        self.assertFalse((self.data / 'published_generation.json').exists())

    def test_marker_last_guard_preserves_previous_publication_and_retry(self):
        previous = self.publish()
        marker = self.data / 'published_generation.json'
        immutable = self.data / 'generations/next-run/manifest.json'
        def guard():
            # Fail at the final pre-replace check, after complete bytes have
            # actually been flushed. The private manifest may safely remain.
            if immutable.exists() and any(path.stat().st_size > 0 for path in
                    self.data.glob('.published_generation.json.*.tmp')):
                raise TimeoutError('publication deadline')
        for _ in range(2):  # new seal and the idempotent retry path
            with self.assertRaisesRegex(TimeoutError, 'publication deadline'):
                publication.publish_immutable_generation(self.data, metadata=self.metadata,
                    reason='guarded fixture', generation_id='next-run', guard=guard)
            self.assertTrue(immutable.is_file())
            self.assertEqual(marker.read_text(), previous)
            self.assertEqual(list(self.data.glob('.published_generation.json.*.tmp')), [])
        resumed = publication.publish_immutable_generation(self.data, metadata=self.metadata,
            reason='guarded fixture', generation_id='next-run', guard=lambda: None)
        self.assertEqual(marker.read_text(), resumed)
        self.assertEqual(immutable.read_text(), resumed)

    def test_guarded_sealing_and_copy_preserve_exact_artifact_bytes(self):
        # Seal equivalent pristine roots at one time, then compare every file.
        other = Path(self.temp.name) / 'guarded'
        shutil.copytree(self.data, other)
        now = publication.datetime.now(publication.timezone.utc)
        calls = []
        def guard():
            calls.append(None)
        with mock.patch.object(publication, 'datetime') as clock:
            clock.now.return_value = now
            original = self.publish()
            guarded = publication.publish_immutable_generation(other, metadata=self.metadata,
                reason='fixture', generation_id='fixture-run', guard=guard)
        self.assertEqual(guarded, original)
        self.assertGreater(len(calls), 20)
        def files(root):
            return {path.relative_to(root): path.read_bytes() for path in root.rglob('*') if path.is_file()}
        self.assertEqual(files(other), files(self.data))
        target = Path(self.temp.name) / 'guarded-copy'
        self.assertEqual(publication.copy_immutable_generation(other, target, guard=guard), original)
        manifest = json.loads(original)
        for logical, artifact in manifest['artifacts'].items():
            self.assertEqual((target / logical).read_bytes(), (other / artifact['path']).read_bytes())
        publication.validate_immutable_generation(target, manifest, guard=guard)

    def test_normalizer_preserves_exact_v2_fields(self):
        row = {"current_supply_sats": "120000000", "group_id": "group-a",
               "exposed_utxo_count_by_script_type": '{"P2PK":2,"P2PKH":3}'}
        normalized = normalizer.normalize_column_names(row, list(row))
        for key, value in row.items():
            self.assertEqual(normalized[key], value)
        self.assertEqual(normalizer.normalize_column_names({"group_id": "legacy"}, ["group_id"])["display_group_ids"], "legacy")

    def test_identity_inputs_are_unique(self):
        archived = self.data / "archived/500/dashboard_pubkeys_ge_1btc.csv"
        archived.parent.mkdir(parents=True)
        archived.write_text("fixture")
        old = identities.WEBAPP_DATA_DIR, identities.ARCHIVED_DATA_DIR
        try:
            identities.WEBAPP_DATA_DIR = self.data
            identities.ARCHIVED_DATA_DIR = self.data / "archived"
            paths = identities.list_snapshot_csvs()
        finally:
            identities.WEBAPP_DATA_DIR, identities.ARCHIVED_DATA_DIR = old
        self.assertEqual(len(paths), 2)
        self.assertEqual(len(set(paths)), 2)


class ArchiveSummaryTests(unittest.TestCase):
    def setUp(self):
        ImmutablePublicationTests.setUp(self)
        self.original = seed_archive_summaries(self.data)

    def publish(self):
        return publication.publish_immutable_generation(self.data, metadata=self.metadata,
            reason='summary fixture', generation_id='summary-run', include_archives=True)

    def test_summary_provenance_preserves_exact_bytes_without_fabricating_snapshots(self):
        marker = json.loads(self.publish())
        metadata = marker['metadata']['archive_summaries']
        self.assertEqual(metadata['snapshot_heights'], [100, 200])
        self.assertEqual(metadata['rows'], 4)
        self.assertEqual(metadata['snapshot_times'], {'100': '1300000100', '200': '1300000200'})
        self.assertTrue(marker['capabilities']['archive_summaries'])
        for height in ('100', '200'):
            provenance = marker['metadata']['methodology_by_snapshot'][height]
            self.assertEqual(provenance['methodology_version'], 'legacy-v1-unreconciled')
            self.assertEqual(provenance['artifact_coverage'], 'historical-summary-only')
            self.assertNotIn('block_hash', provenance)
            self.assertFalse((self.data / height).exists())
            self.assertFalse((self.data / 'archived' / height).exists())
        for kind, filename in (('history', 'historical_archived.csv'), ('index', 'archived_index.csv')):
            logical = metadata['sources'][0][kind + '_artifact']
            self.assertEqual((self.data / marker['artifacts'][logical]['path']).read_bytes(), self.original[filename])
        publication.validate_immutable_generation(self.data, marker)
        self.assertEqual(self.publish(), (self.data / 'published_generation.json').read_text())

    def test_archive_summary_validation_uses_the_same_caller_guard(self):
        marker = json.loads(self.publish())
        phase = []
        original = archive_summaries.validate
        def guarded_validation(*args, **kwargs):
            self.assertIs(kwargs.get('guard'), guard)
            phase.append('archive validation')
            return original(*args, **kwargs)
        def guard():
            if phase:
                raise TimeoutError('archive validation deadline')
        with mock.patch.object(archive_summaries, 'validate', side_effect=guarded_validation):
            with self.assertRaisesRegex(TimeoutError, 'archive validation deadline'):
                publication.validate_immutable_generation(self.data, marker, guard=guard)
        self.assertEqual(phase, ['archive validation'])
        self.assertEqual(json.loads((self.data / 'published_generation.json').read_text()), marker)

    def test_forged_rehashed_rows_cannot_override_preserved_source_evidence(self):
        marker = json.loads(self.publish())
        path = self.data / archive_summaries.FILE
        path.write_bytes(path.read_bytes().replace(b',200,0.000000000001', b',201,0.000000000001', 1))
        forged = copy.deepcopy(marker)
        forged['artifacts'][archive_summaries.FILE] = publication._store_artifact(self.data, archive_summaries.FILE)
        with self.assertRaisesRegex(RuntimeError, 'retained original evidence'):
            publication.validate_immutable_generation(self.data, forged)

    def test_summary_source_corruption_and_invalid_coverage_rejected(self):
        marker = json.loads(self.publish())
        source = marker['metadata']['archive_summaries']['sources'][0]['history_artifact']
        path = self.data / marker['artifacts'][source]['path']
        original = path.read_bytes()
        path.write_bytes(original.replace(b',200,', b',201,', 1))
        with self.assertRaisesRegex(RuntimeError, 'verification'):
            publication.validate_immutable_generation(self.data, marker)
        path.write_bytes(original)
        changes = (
            lambda m: m['metadata']['archive_summaries'].update(snapshot_heights=[200, 100]),
            lambda m: m['metadata']['archive_summaries'].update(snapshot_heights=[100, 1000]),
            lambda m: m['metadata']['archive_summaries'].update(snapshot_times={'100': '1', '200': '2'}),
            lambda m: m['metadata']['archive_summaries'].update(sources=[None]),
            lambda m: m['metadata']['archive_summaries']['sources'][0].update(history_artifact=[]),
            lambda m: m['artifacts'][archive_summaries.FILE].update(rows=5),
            lambda m: m['capabilities'].update(archive_summaries=False),
            lambda m: m['metadata']['methodology_by_snapshot']['100'].update(methodology_version='quantum-v2'),
            lambda m: m['metadata'].pop('archive_summaries'),
        )
        for change in changes:
            malformed = copy.deepcopy(marker)
            change(malformed)
            with self.assertRaises(RuntimeError):
                publication.validate_immutable_generation(self.data, malformed)

    def test_full_replacement_has_priority_and_public_bundle_omits_summary_evidence(self):
        # Restoring a real snapshot after preparing the legacy history removes
        # only that height from the summary-only chart, without changing rows.
        seed(self.data, 100)
        self.metadata = seed(self.data, 1000)
        marker = json.loads(self.publish())
        self.assertEqual(marker['metadata']['archive_summaries']['snapshot_heights'], [200])
        self.assertEqual(marker['metadata']['methodology_by_snapshot']['100']['export_version'], 'quantum-csv-v2')
        publication.validate_immutable_generation(self.data, marker)
        bundle = Path(self.temp.name) / 'public'
        shutil.copytree(self.data, bundle)
        publication.prepare_public_bundle(bundle)
        public = json.loads((bundle / 'published_generation.json').read_text())
        self.assertFalse(public['capabilities']['archive_summaries'])
        self.assertNotIn('archive_summaries', public['metadata'])
        self.assertNotIn('200', public['metadata']['methodology_by_snapshot'])
        self.assertIn('100', public['metadata']['methodology_by_snapshot'])
        self.assertFalse((bundle / archive_summaries.FILE).exists())
        self.assertFalse((bundle / archive_summaries.STAGED_METADATA).exists())
        self.assertFalse((bundle / archive_summaries.SOURCE_PREFIX).exists())
        for logical, artifact in marker['artifacts'].items():
            if logical == archive_summaries.FILE or logical.startswith(archive_summaries.SOURCE_PREFIX):
                self.assertNotIn(logical, public['artifacts'])
                self.assertFalse((bundle / artifact['path']).exists())
        publication.validate_immutable_generation(bundle, public)
        self.assertEqual(json.loads((self.data / 'published_generation.json').read_text()), marker)
        publication.validate_immutable_generation(self.data, marker)


    def test_public_pruning_survives_legacy_or_absent_marker_rollback(self):
        legacy_marker = publish_legacy_fixture(self.data).encode()
        restored_aliases = {name: (self.data / name).read_bytes() for name in
                           ('latest_snapshot.txt', 'snapshots_index.csv', 'historical_eco.csv')}
        full_current = (self.data / '1000/dashboard_pubkeys_ge_1btc.csv').read_bytes()
        metadata = seed(self.data, 2000)
        future = json.loads(publication.publish_immutable_generation(self.data, metadata=metadata,
            reason='later fixture', generation_id='later-run', include_archives=True))
        source_hashes = {path.relative_to(self.data): publication.file_sha256(path)
                         for path in self.data.rglob('*') if path.is_file()}
        for marker_present in (True, False):
            with self.subTest(marker_present=marker_present):
                bundle = Path(self.temp.name) / ('legacy-public' if marker_present else 'markerless-public')
                shutil.copytree(self.data, bundle)
                for name, payload in restored_aliases.items():
                    (bundle / name).write_bytes(payload)
                pointer = bundle / 'published_generation.json'
                if marker_present:
                    pointer.write_bytes(legacy_marker)
                else:
                    pointer.unlink()
                publication.prepare_public_bundle(bundle)
                if marker_present:
                    self.assertEqual(pointer.read_bytes(), legacy_marker)
                else:
                    self.assertFalse(pointer.exists())
                self.assertEqual((bundle / '1000/dashboard_pubkeys_ge_1btc.csv').read_bytes(), full_current)
                for name, payload in restored_aliases.items():
                    self.assertEqual((bundle / name).read_bytes(), payload)
                self.assertFalse((bundle / archive_summaries.FILE).exists())
                self.assertFalse((bundle / archive_summaries.STAGED_METADATA).exists())
                self.assertFalse((bundle / archive_summaries.SOURCE_PREFIX).exists())
                retained = json.loads((bundle / 'generations/later-run/manifest.json').read_text())
                self.assertFalse(retained['capabilities']['current_full'])
                self.assertFalse(retained['capabilities']['archive_summaries'])
                self.assertNotIn('archive_summaries', retained['metadata'])
                self.assertNotIn('2000/dashboard_pubkeys_ge_1btc.csv', retained['artifacts'])
                for logical, artifact in future['artifacts'].items():
                    if logical == archive_summaries.FILE or logical.startswith(archive_summaries.SOURCE_PREFIX):
                        self.assertNotIn(logical, retained['artifacts'])
                        self.assertFalse((bundle / artifact['path']).exists())
                publication.validate_immutable_generation(bundle, retained)
        self.assertEqual(source_hashes, {path.relative_to(self.data): publication.file_sha256(path)
                                        for path in self.data.rglob('*') if path.is_file()})


if __name__ == "__main__":
    unittest.main()
