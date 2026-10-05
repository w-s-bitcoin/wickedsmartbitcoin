#!/usr/bin/env python3
"""Check dashboard scaffolding and Pages packaging without production data."""

from pathlib import Path
import json
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


class PagesBuildTest(unittest.TestCase):
    def test_quantum_legacy_rollback_prunes_retained_v2_archives_without_changing_marker(self):
        if __package__:
            from .test_quantum_immutable_generation import publication, seed, seed_archive_summaries, publish_legacy_fixture
        else:
            from test_quantum_immutable_generation import publication, seed, seed_archive_summaries, publish_legacy_fixture
        with tempfile.TemporaryDirectory(prefix='wsb-pages-quantum-rollback-') as temporary:
            root = Path(temporary)
            (root / 'scripts').mkdir()
            shutil.copy2(ROOT / 'scripts/build_pages_dist.sh', root / 'scripts')
            pipeline = root / 'webapps/quantum_exposure/pipeline'
            pipeline.mkdir(parents=True)
            for filename in ('immutable_generation.py', 'publish_generation.py', 'quantum_archive_summaries.py'):
                shutil.copy2(ROOT / 'webapps/quantum_exposure/pipeline' / filename, pipeline / filename)
            data = pipeline.parent / 'webapp_data'
            data.mkdir()
            seed(data, 1000)
            seed_archive_summaries(data)
            legacy_marker = publish_legacy_fixture(data).encode()
            legacy_files = {name: (data / name).read_bytes() for name in
                            ('latest_snapshot.txt', 'snapshots_index.csv', 'historical_eco.csv',
                             '1000/dashboard_pubkeys_ge_1btc.csv')}
            metadata = seed(data, 2000)
            future = json.loads(publication.publish_immutable_generation(data, metadata=metadata,
                reason='later fixture', generation_id='later-run', include_archives=True))
            for name, payload in legacy_files.items():
                (data / name).write_bytes(payload)
            for marker_present in (True, False):
                with self.subTest(marker_present=marker_present):
                    pointer = data / 'published_generation.json'
                    if marker_present:
                        pointer.write_bytes(legacy_marker)
                    else:
                        pointer.unlink()
                    original = {path.relative_to(data): publication.file_sha256(path)
                                for path in data.rglob('*') if path.is_file()}
                    result = subprocess.run(['bash', str(root / 'scripts/build_pages_dist.sh')], cwd=root,
                                            capture_output=True, text=True)
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                    output = root / 'dist/webapps/quantum_exposure/webapp_data'
                    if marker_present:
                        self.assertEqual((output / 'published_generation.json').read_bytes(), legacy_marker)
                    else:
                        self.assertFalse((output / 'published_generation.json').exists())
                    self.assertEqual((output / '1000/dashboard_pubkeys_ge_1btc.csv').read_bytes(),
                                     legacy_files['1000/dashboard_pubkeys_ge_1btc.csv'])
                    self.assertFalse((output / '2000/dashboard_pubkeys_ge_1btc.csv').exists())
                    self.assertFalse((output / 'historical_archive_summaries.csv').exists())
                    self.assertFalse((output / 'archive_summary_sources').exists())
                    self.assertFalse((output / '.archive_summary_provenance.json').exists())
                    retained = json.loads((output / 'generations/later-run/manifest.json').read_text())
                    publication.validate_immutable_generation(output, retained)
                    self.assertFalse(retained['capabilities']['archive_summaries'])
                    self.assertFalse(retained['capabilities']['current_full'])
                    for logical, artifact in future['artifacts'].items():
                        if 'archive_summar' in logical:
                            self.assertNotIn(logical, retained['artifacts'])
                            self.assertFalse((output / artifact['path']).exists())
                    self.assertEqual(original, {path.relative_to(data): publication.file_sha256(path)
                                                for path in data.rglob('*') if path.is_file()})

    def test_quantum_v2_build_keeps_verified_runtime_and_prunes_manifest_capabilities(self):
        # Exercise the actual shell build as well as the pure pruning helper.
        if __package__:
            from .test_quantum_immutable_generation import publication, seed, seed_archive_summaries
        else:
            from test_quantum_immutable_generation import publication, seed, seed_archive_summaries
        from quantum_runtime import runtime_dependency_copies
        with tempfile.TemporaryDirectory(prefix="wsb-pages-quantum-v2-") as temporary:
            root = Path(temporary)
            (root / "scripts").mkdir()
            shutil.copy2(ROOT / "scripts/build_pages_dist.sh", root / "scripts")
            pipeline = root / "webapps/quantum_exposure/pipeline"
            pipeline.mkdir(parents=True)
            for filename in ("immutable_generation.py", "publish_generation.py", "quantum_archive_summaries.py"):
                shutil.copy2(ROOT / "webapps/quantum_exposure/pipeline" / filename, pipeline / filename)
            for source, target in runtime_dependency_copies(ROOT / "webapps/quantum_exposure", root):
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
            for filename in ("preview.html", "preview_app.js", "standalone_app.js"):
                shutil.copy2(ROOT / "webapps/quantum_exposure" / filename, pipeline.parent / filename)
            shutil.copy2(ROOT / "webapps/shared/preview_shared.js", root / "webapps/shared/preview_shared.js")
            data = pipeline.parent / "webapp_data"
            data.mkdir()
            seed(data, 500)
            (data / "archived").mkdir()
            (data / "500").rename(data / "archived/500")
            metadata = seed(data, 1000)
            seed_archive_summaries(data, heights=(100, 200))
            publication.publish_immutable_generation(data, metadata=metadata, reason="fixture",
                                                       generation_id="first", include_archives=True)
            metadata = seed(data, 2000)
            publication.publish_immutable_generation(data, metadata=metadata, reason="fixture",
                                                       generation_id="second", include_archives=True)
            original = {path.relative_to(data): publication.file_sha256(path)
                        for path in data.rglob("*") if path.is_file()}
            result = subprocess.run(["bash", str(root / "scripts/build_pages_dist.sh")], cwd=root,
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            dist = root / "dist"
            output = dist / "webapps/quantum_exposure/webapp_data"
            marker = json.loads((output / "published_generation.json").read_text())
            publication.validate_immutable_generation(output, marker)
            self.assertFalse(marker["capabilities"]["archives"])
            self.assertFalse(marker["capabilities"]["archive_summaries"])
            self.assertNotIn('archive_summaries', marker['metadata'])
            self.assertFalse((output / 'historical_archive_summaries.csv').exists())
            self.assertFalse((output / 'archive_summary_sources').exists())
            self.assertTrue(marker["capabilities"]["current_full"])
            for height in ('1000','2000'):
                self.assertIn(f'{height}/dashboard_script_corrections.csv',marker['artifacts'])
                self.assertTrue((output/height/'dashboard_script_corrections.csv').is_file())
            self.assertNotIn("500", marker["metadata"]["methodology_by_snapshot"])
            self.assertEqual([path.parent.name for path in output.glob("*/dashboard_pubkeys_ge_1btc.csv")], ["2000"])
            self.assertFalse((output / "archived").exists())
            for manifest in output.glob("generations/*/manifest.json"):
                previous = json.loads(manifest.read_text())
                publication.validate_immutable_generation(output, previous)
                self.assertFalse(any(name.startswith("archived/") for name in previous["artifacts"]))
                self.assertFalse(any('archive_summar' in name for name in previous['artifacts']))
            for source, target in runtime_dependency_copies(ROOT / "webapps/quantum_exposure", dist):
                self.assertEqual(publication.file_sha256(source), publication.file_sha256(target))
            for filename in ("preview.html", "preview_app.js", "standalone_app.js"):
                self.assertEqual((dist / "webapps/quantum_exposure" / filename).read_bytes(),
                                 (ROOT / "webapps/quantum_exposure" / filename).read_bytes())
            self.assertTrue((dist / "webapps/shared/preview_shared.js").is_file())
            self.assertFalse((dist / "webapps/quantum_exposure/pipeline").exists())
            self.assertEqual(original, {path.relative_to(data): publication.file_sha256(path)
                                       for path in data.rglob("*") if path.is_file()})

    def test_generated_dashboard_passes_contract_and_requires_action_wiring(self):
        with tempfile.TemporaryDirectory(prefix="wsb-dashboard-scaffold-") as temporary:
            root = Path(temporary)
            generated = subprocess.run(
                ["bash", str(ROOT / "scripts/create_dashboard.sh"), "example", "Example Dashboard"],
                cwd=root,
                capture_output=True,
                text=True,
            )
            self.assertEqual(generated.returncode, 0, generated.stdout + generated.stderr)
            check = ["bash", str(ROOT / "scripts/check_dashboard_contract.sh"), "webapps/example"]
            valid = subprocess.run(check, cwd=root, capture_output=True, text=True)
            self.assertEqual(valid.returncode, 0, valid.stdout + valid.stderr)

            app = root / "webapps/example/dashboard_app.js"
            app.write_text(app.read_text().replace("initDashboardRuntime", "missingRuntime"))
            invalid = subprocess.run(check, cwd=root, capture_output=True, text=True)
            self.assertNotEqual(invalid.returncode, 0)
            self.assertIn("copy link buttons must use", invalid.stderr)

    def test_runtime_manifest_and_data_pruning(self):
        with tempfile.TemporaryDirectory(prefix="wsb-pages-build-") as temporary:
            root = Path(temporary)
            (root / "scripts").mkdir()
            shutil.copy2(ROOT / "scripts/build_pages_dist.sh", root / "scripts")

            fixtures = {
                "index.html": "<!doctype html><title>Fixture</title>",
                "assets/top_kpis.json": "{}",
                "webapps/shared/dashboard_share.js": "window.WSBDashboardShare = {};",
                "assets/block_data_0_99999.csv": "raw input",
                "assets/btcusd_10m_prices.csv": "raw input",
                "webapps/example/dashboard.html": (
                    '<script src="dashboard_manifest.js"></script>'
                    '<script src="dashboard_app.js"></script>'
                ),
                "webapps/example/dashboard_manifest.js": (
                    'window.WSBDashboardManifest = {slug: "example"};'
                ),
                "webapps/example/dashboard_app.js": (
                    'document.title = window.WSBDashboardManifest.slug;'
                ),
                "webapps/example/webapp_data/series.csv": "value\n1\n",
                "webapps/example/webapp_data/__pycache__/helper.pyc": "cache",
                "webapps/example/webapp_data/helper.py": "pipeline helper",
                "webapps/example/pipeline/update.py": "pipeline",
                "webapps/bip110_signaling/webapp_data/miner_attributions.json": "{}",
                "webapps/bip110_signaling/webapp_data/segwit_miners.json": "{}",
                "webapps/casascius_explorer/assets/items/legacy.js": "legacy image",
                "webapps/casascius_explorer/assets/all_front.png": "runtime image",
                "webapps/quantum_exposure/webapp_data/snapshots_index.csv": (
                    "snapshot_blockheight,snapshot_time\n200,2\n100,1\n"
                ),
                "webapps/quantum_exposure/webapp_data/archived_index.csv": (
                    "snapshot_blockheight,snapshot_time\n50,0\n"
                ),
                "webapps/quantum_exposure/webapp_data/historical_archive_summaries.csv": "unsealed archive summary",
                "webapps/quantum_exposure/webapp_data/.archive_summary_provenance.json": "unsealed provenance",
                "webapps/quantum_exposure/webapp_data/archive_summary_sources/original.csv": "unsealed evidence",
                "webapps/quantum_exposure/webapp_data/historical_archived.csv": (
                    "snapshot,balance_filter\n50,all\n"
                ),
                "webapps/quantum_exposure/webapp_data/archived/50/data.csv": "archive",
                "webapps/quantum_exposure/webapp_data/arkham/private.csv": "enrichment",
                "webapps/quantum_exposure/webapp_data/200/dashboard_pubkeys_ge_1btc.csv": "current full rows",
                "webapps/quantum_exposure/webapp_data/100/dashboard_pubkeys_ge_1btc.csv": "old full rows",
                "webapps/quantum_exposure/webapp_data/100/dashboard_pubkeys_ge_1btc_top100.csv": "old compact rows",
            }
            for name, content in fixtures.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content)

            result = subprocess.run(
                ["bash", str(root / "scripts/build_pages_dist.sh")],
                cwd=root,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            dist = root / "dist"

            kept = (
                "index.html",
                "assets/top_kpis.json",
                "webapps/shared/dashboard_share.js",
                "webapps/example/dashboard.html",
                "webapps/example/dashboard_manifest.js",
                "webapps/example/dashboard_app.js",
                "webapps/example/webapp_data/series.csv",
                "webapps/bip110_signaling/webapp_data/miner_attributions.json",
                "webapps/casascius_explorer/assets/all_front.png",
                "webapps/quantum_exposure/webapp_data/200/dashboard_pubkeys_ge_1btc.csv",
                "webapps/quantum_exposure/webapp_data/100/dashboard_pubkeys_ge_1btc_top100.csv",
            )
            for name in kept:
                with self.subTest(kept=name):
                    self.assertTrue((dist / name).is_file(), name)
                    self.assertEqual((dist / name).read_text(), fixtures[name])

            pruned = (
                "assets/block_data_0_99999.csv",
                "assets/btcusd_10m_prices.csv",
                "webapps/example/pipeline",
                "webapps/example/webapp_data/__pycache__",
                "webapps/example/webapp_data/helper.py",
                "webapps/bip110_signaling/webapp_data/segwit_miners.json",
                "webapps/casascius_explorer/assets/items",
                "webapps/quantum_exposure/webapp_data/archived",
                "webapps/quantum_exposure/webapp_data/archive_summary_sources",
                "webapps/quantum_exposure/webapp_data/historical_archive_summaries.csv",
                "webapps/quantum_exposure/webapp_data/.archive_summary_provenance.json",
                "webapps/quantum_exposure/webapp_data/arkham",
                "webapps/quantum_exposure/webapp_data/100/dashboard_pubkeys_ge_1btc.csv",
            )
            for name in pruned:
                with self.subTest(pruned=name):
                    self.assertFalse((dist / name).exists(), name)

            quantum = dist / "webapps/quantum_exposure/webapp_data"
            for name in ("archived_index.csv", "historical_archived.csv"):
                with self.subTest(archive_catalog=name):
                    self.assertEqual(len((quantum / name).read_text().splitlines()), 1)

            # Packaging must never rewrite the source data during pruning.
            for name, content in fixtures.items():
                with self.subTest(source=name):
                    self.assertEqual((root / name).read_text(), content)


if __name__ == "__main__":
    unittest.main()
