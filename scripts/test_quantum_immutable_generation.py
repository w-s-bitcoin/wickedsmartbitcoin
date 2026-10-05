#!/usr/bin/env python3
"""Fixture-only immutable publication, exact values, isolation and retry tests."""
import csv
import json
import shutil
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
PIPELINE = ROOT / "webapps/quantum_exposure/pipeline"
sys.path.insert(0, str(PIPELINE))
import immutable_generation as publication
import quantum_v2_analysis as analysis
import normalize_snapshot_csvs as normalizer
import sync_identity_consensus_from_snapshots as identities
import quantum_runtime as runtime


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


if __name__ == "__main__":
    unittest.main()
