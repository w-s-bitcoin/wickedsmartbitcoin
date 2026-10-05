#!/usr/bin/env python3
"""Delivery tests use disposable local Git remotes and fixture-only exporters."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "webapps/quantum_exposure/pipeline"))
sys.path.insert(0, str(ROOT / "scripts"))
import quantum_v2_delivery as delivery
import immutable_generation as publication
from quantum_runtime import runtime_dependency_copies
from test_quantum_immutable_generation import seed


def git(repo, *args):
    result = subprocess.run(["git", "-c", "commit.gpgsign=false", *args], cwd=repo,
                            check=True, text=True, capture_output=True)
    return result.stdout.strip()


class DeliveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="quantum-delivery-fixture-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.data = self.root / "stage"
        self.data.mkdir()
        self.metadata = seed(self.data)
        self.metadata.update(request_id=7, snapshot_blockheight=1000)
        self.marker = json.loads(publication.publish_immutable_generation(self.data, reason="fixture",
                            metadata=self.metadata, generation_id="request-7"))
        self.remote = self.root / "remote.git"
        git(self.root, "init", "--bare", "--initial-branch=main", str(self.remote))
        self.repo = self.root / "standalone"
        git(self.root, "clone", str(self.remote), str(self.repo))
        git(self.repo, "config", "user.name", "Fixture")
        git(self.repo, "config", "user.email", "fixture@example.invalid")
        (self.repo / "README.md").write_text("Unrelated original\n")
        git(self.repo, "add", "README.md")
        git(self.repo, "commit", "-m", "Fixture initial")
        git(self.repo, "push", "origin", "main")
        self.runtime = self.root / "runtime/webapps/quantum_exposure"
        self.runtime.mkdir(parents=True)
        shared = self.runtime.parent / "shared"
        shared.mkdir()
        (self.runtime / "dashboard.html").write_text('<script src="dashboard_app.js"></script><link rel="stylesheet" href="../shared/dashboard_shared.css">')
        (self.runtime / "dashboard_app.js").write_text("// runtime fixture\n")
        (shared / "dashboard_shared.css").write_text("body{color:white}\n")
        (shared / "webapp_data_auto_refresh.js").write_text("// refresh fixture\n")

    def deliver(self):
        return delivery.deliver_standalone(self.data, self.repo, 7, runtime_dir=self.runtime)

    def test_clean_delivery_and_retry_receipt(self):
        receipt = self.deliver()
        self.assertEqual(receipt["status"], "delivered")
        self.assertEqual(receipt["accepted_generation_id"], "request-7")
        self.assertEqual(git(self.repo, "status", "--porcelain"), "")
        self.assertEqual(self.deliver()["commit"], receipt["commit"])
        self.assertEqual((self.repo / "README.md").read_text(), "Unrelated original\n")
        self.assertTrue((self.repo / "webapps/shared/dashboard_shared.css").is_file())
        self.assertEqual((self.repo / delivery.DATA_REL / "latest_snapshot.txt").read_text().strip(), "1000")

    def test_destination_attempt_records_all_retries_and_child_cpu_separately(self):
        state = self.root / 'private-state'
        first = delivery.DeliveryAttempt(state, 7, 'website', provenance={'implementation_sha256': 'fixture'})
        self.assertEqual(json.loads(first.path.read_text())['status'], 'running')
        subprocess.run([sys.executable, '-c', 'sum(i*i for i in range(1000000))'], check=True)
        failed = first.finish(error='fixture transport unavailable', supervisor_pid=12345)
        second = delivery.DeliveryAttempt(state, 7, 'website', provenance={'implementation_sha256': 'fixture'})
        complete = second.finish(receipt={'commit': 'accepted', 'generation_id': 'request-7'})
        self.assertNotEqual(first.path, second.path)
        self.assertEqual(len(list((state/'delivery-attempts').glob('*.json'))), 2)
        self.assertEqual(json.loads(first.path.read_text()), failed)
        self.assertEqual(json.loads(second.path.read_text()), complete)
        self.assertGreater(failed['wall_seconds'], 0)
        self.assertGreater(failed['child_user_seconds']+failed['child_system_seconds'], 0)
        self.assertTrue(failed['child_cpu_incomplete'])
        self.assertEqual(complete['receipt']['commit'], 'accepted')
        self.assertIn('excludes analysis/export', complete['scope'])
        self.assertNotIn('peak_private_memory_bytes', complete)

    def test_ordinary_rollback_restores_coherent_data_and_runtime_without_rewriting_history(self):
        previous_commit=self.deliver()['commit']
        previous_runtime={target.relative_to(self.repo).as_posix():publication.file_sha256(source)
                          for source,target in runtime_dependency_copies(self.runtime,self.repo)}
        next_data=self.root/'next-generation'
        delivery.prepare_output(self.data,next_data,2000)
        metadata=seed(next_data,2000)
        metadata.update(snapshot_blockheight=2000,request_id=8)
        next_marker=delivery.finish_output(next_data,metadata,'request-8')
        (self.runtime/'dashboard_app.js').write_text('// next accepted runtime revision\n')
        (self.runtime.parent/'shared/dashboard_shared.css').write_text('body{color:gold}\n')
        next_commit=delivery.deliver_standalone(next_data,self.repo,8,runtime_dir=self.runtime)['commit']
        self.assertNotEqual(previous_commit,next_commit)
        self.assertNotEqual(publication.file_sha256(self.repo/'webapps/quantum_exposure/dashboard_app.js'),
                            previous_runtime['webapps/quantum_exposure/dashboard_app.js'])
        self.assertEqual((self.repo/delivery.DATA_REL/'latest_snapshot.txt').read_text().strip(),'2000')

        # Operator procedure after pausing automation: restore the exact prior
        # aliases, pointer and complete accepted runtime in an ordinary commit.
        # Preserve both generations' immutable objects/manifests for in-flight
        # readers and investigation; no reset, force push or history rewrite.
        owned_paths=sorted(set(previous_runtime)|{
            (delivery.DATA_REL/name).as_posix() for name in self.marker['artifacts']
            if not name.startswith('archived/')
        }|{(delivery.DATA_REL/'published_generation.json').as_posix()})
        git(self.repo,'restore',f'--source={previous_commit}','--staged','--worktree','--',*owned_paths)
        git(self.repo,'commit','-m','Restore accepted Quantum generation request-7 and compatible runtime')
        rollback_commit=git(self.repo,'rev-parse','HEAD')
        git(self.repo,'push','origin','HEAD:main')
        self.assertEqual(git(self.repo,'rev-parse',f'{rollback_commit}^'),next_commit)
        git(self.repo,'merge-base','--is-ancestor',next_commit,rollback_commit)

        # Verify what a new reader gets from the remote, not only local files.
        restored=self.root/'rollback-reader'
        git(self.root,'clone',str(self.remote),str(restored))
        restored_data=restored/delivery.DATA_REL
        self.assertEqual(git(restored,'rev-parse','HEAD'),rollback_commit)
        self.assertEqual(git(restored,'status','--porcelain'),'')
        self.assertEqual(json.loads((restored_data/'published_generation.json').read_text()),self.marker)
        publication.validate_immutable_generation(restored_data,self.marker)
        publication.validate_immutable_generation(restored_data,next_marker)
        self.assertEqual(json.loads((restored_data/'generations/request-8/manifest.json').read_text()),next_marker)
        self.assertEqual(json.loads(git(restored,'show',f'{next_commit}:{delivery.DATA_REL}/published_generation.json')),next_marker)
        for logical,artifact in self.marker['artifacts'].items():
            if not logical.startswith('archived/'):
                self.assertEqual(publication.file_sha256(restored_data/logical),artifact['sha256'],logical)
        for relative,checksum in previous_runtime.items():
            self.assertEqual(publication.file_sha256(restored/relative),checksum,relative)
        self.assertEqual((restored/'README.md').read_text(),'Unrelated original\n')

    def test_unrelated_dirty_files_block_without_mutation(self):
        (self.repo / "README.md").write_text("User's edit\n")
        git(self.repo, "add", "README.md")
        with self.assertRaisesRegex(RuntimeError, "unrelated or unowned"):
            self.deliver()
        self.assertEqual((self.repo / "README.md").read_text(), "User's edit\n")
        self.assertFalse((self.repo / delivery.DATA_REL).exists())

    def test_unpublished_source_commit_blocks_without_mutation(self):
        (self.repo / "README.md").write_text("User's committed edit\n")
        git(self.repo, "add", "README.md")
        git(self.repo, "commit", "-m", "Unpublished source work")
        before = git(self.repo, "rev-parse", "HEAD")
        remote = git(self.repo, "rev-parse", "origin/main")
        with self.assertRaisesRegex(RuntimeError, "unrelated unpublished commits"):
            self.deliver()
        self.assertEqual(git(self.repo, "rev-parse", "HEAD"), before)
        self.assertEqual(git(self.repo, "rev-parse", "origin/main"), remote)
        self.assertFalse((self.repo / delivery.DATA_REL).exists())

    def test_owned_interrupted_copy_can_resume(self):
        original = delivery._git
        def fail_commit(repo, *args, **kwargs):
            if args[0] == "commit":
                raise RuntimeError("fixture interruption")
            return original(repo, *args, **kwargs)
        with patch.object(delivery, "_git", side_effect=fail_commit):
            with self.assertRaisesRegex(RuntimeError, "fixture interruption"):
                self.deliver()
        self.assertTrue(git(self.repo, "status", "--porcelain"))
        self.assertEqual(self.deliver()["status"], "delivered")
        self.assertEqual(git(self.repo, "status", "--porcelain"), "")

    def test_modified_owned_file_blocks_resume(self):
        original = delivery._git
        def fail_commit(repo, *args, **kwargs):
            if args[0] == "commit":
                raise RuntimeError("fixture interruption")
            return original(repo, *args, **kwargs)
        with patch.object(delivery, "_git", side_effect=fail_commit):
            with self.assertRaises(RuntimeError):
                self.deliver()
        target = self.repo / "webapps/quantum_exposure/dashboard_app.js"
        target.write_text("// subsequent manual edit\n")
        with self.assertRaisesRegex(RuntimeError, "differs from retained"):
            self.deliver()
        self.assertEqual(target.read_text(), "// subsequent manual edit\n")

    def test_manual_index_edit_blocks_resume_even_with_owned_worktree(self):
        original = delivery._git
        def fail_commit(repo, *args, **kwargs):
            if args[0] == "commit":
                raise RuntimeError("fixture interruption")
            return original(repo, *args, **kwargs)
        with patch.object(delivery, "_git", side_effect=fail_commit):
            with self.assertRaises(RuntimeError):
                self.deliver()
        relative = "webapps/quantum_exposure/dashboard_app.js"
        target = self.repo / relative
        retained = target.read_text()
        target.write_text("// staged manual edit\n")
        git(self.repo, "add", "--", relative)
        target.write_text(retained)
        with self.assertRaisesRegex(RuntimeError, "staged change differs"):
            self.deliver()
        self.assertEqual(git(self.repo, "show", ":" + relative), "// staged manual edit")
        self.assertEqual(target.read_text(), retained)

    def test_generated_commit_can_retry_after_push_failure(self):
        original = delivery._git
        def fail_push(repo, *args, **kwargs):
            if args[0] == "push":
                return subprocess.CompletedProcess(args, 1, "", "fixture unavailable")
            return original(repo, *args, **kwargs)
        with patch.object(delivery, "_git", side_effect=fail_push):
            with self.assertRaisesRegex(RuntimeError, "verified remote receipt"):
                self.deliver()
        self.assertEqual(git(self.repo, "status", "--porcelain"), "")
        self.assertEqual(self.deliver()["status"], "delivered")

    def test_conflicting_remote_merge_preserves_generated_commit_without_leaving_operation(self):
        original = delivery._git
        def fail_push(repo, *args, **kwargs):
            if args[0] == "push":
                return subprocess.CompletedProcess(args, 1, "", "fixture unavailable")
            return original(repo, *args, **kwargs)
        with patch.object(delivery, "_git", side_effect=fail_push):
            with self.assertRaisesRegex(RuntimeError, "verified remote receipt"):
                self.deliver()
        generated_commit = git(self.repo, "rev-parse", "HEAD")
        other = self.root / "concurrent-source"
        git(self.root, "clone", str(self.remote), str(other))
        git(other, "config", "user.name", "Fixture")
        git(other, "config", "user.email", "fixture@example.invalid")
        relative = "webapps/quantum_exposure/dashboard_app.js"
        target = other / relative
        target.parent.mkdir(parents=True)
        target.write_text("// concurrent source edit\n")
        git(other, "add", "--", relative)
        git(other, "commit", "-m", "Concurrent source change")
        git(other, "push", "origin", "main")
        remote_commit = git(other, "rev-parse", "HEAD")
        with self.assertRaisesRegex(RuntimeError, "remote merge failed"):
            self.deliver()
        self.assertEqual(git(self.repo, "rev-parse", "HEAD"), generated_commit)
        self.assertEqual(git(self.repo, "status", "--porcelain"), "")
        self.assertEqual(git(self.repo, "rev-parse", "origin/main"), remote_commit)
        self.assertFalse((self.repo / ".git/MERGE_HEAD").exists())

    def test_website_complete_boundary_and_verified_remote(self):
        staging = self.root / "deploy-staging"
        called = []
        def fixture_deployer(repo):
            stage = staging / "quantum-000000000007"
            self.assertTrue((stage / ".complete").is_file())
            staged = stage / "files" / delivery.DATA_REL
            publication.validate_immutable_generation(staged, self.marker)
            publication.copy_immutable_generation(staged, repo / delivery.DATA_REL)
            git(repo, "add", "--", str(delivery.DATA_REL))
            git(repo, "commit", "-m", "Fixture deployment")
            git(repo, "push", "origin", "main")
            called.append(True)
        with patch.object(delivery, "STAGING_ROOT", staging), patch.object(delivery, "_invoke_deployer", side_effect=fixture_deployer):
            receipt = delivery.deliver_website(self.data, self.repo, 7)
            retry = delivery.deliver_website(self.data, self.repo, 7)
        self.assertEqual(len(called), 1)
        self.assertEqual(receipt["commit"], retry["commit"])

    def test_prepare_and_finish_preserve_compact_history(self):
        next_data = self.root / "next"
        delivery.prepare_output(self.data, next_data, 2000)
        self.assertTrue((next_data / "1000/dashboard_pubkeys_aggregates.csv").is_file())
        self.assertTrue((next_data / "1000/dashboard_script_corrections.csv").is_file())
        self.assertFalse((next_data / "1000/dashboard_pubkeys_ge_1btc.csv").exists())
        next_metadata = seed(next_data, 2000)
        next_metadata.update(snapshot_blockheight=2000, request_id=8)
        marker = delivery.finish_output(next_data, next_metadata, "request-8")
        self.assertIn("1000/dashboard_pubkeys_aggregates.csv", marker["artifacts"])
        self.assertIn("1000/dashboard_script_corrections.csv", marker["artifacts"])
        self.assertNotIn("1000/dashboard_pubkeys_ge_1btc.csv", marker["artifacts"])
        self.assertIn("2000/dashboard_pubkeys_ge_1btc.csv", marker["artifacts"])
        self.assertEqual(marker["metadata"]["request_id"], 8)

    def test_two_generations_retain_local_archives_and_age_compact_history(self):
        legacy = self.root / "legacy-local"
        legacy.mkdir()
        seed(legacy, 500)
        (legacy / "archived").mkdir()
        (legacy / "500").rename(legacy / "archived/500")
        seed(legacy, 1000)
        previous = legacy
        with patch.object(delivery, "RECENT_SNAPSHOT_COUNT", 2):
            for height in (2000, 3000):
                current = self.root / f"generation-{height}"
                delivery.prepare_output(previous, current, height)
                metadata = seed(current, height)
                metadata["snapshot_blockheight"] = height
                marker = delivery.finish_output(current, metadata, f"retention-{height}")
                self.assertTrue(marker["capabilities"]["archives"])
                self.assertIn("archived/500/dashboard_pubkeys_aggregates.csv", marker["artifacts"])
                self.assertIn("archived/500/dashboard_script_corrections.csv", marker["artifacts"])
                self.assertFalse((current / "archived/500/dashboard_pubkeys_ge_1btc.csv").exists())
                previous = current
        self.assertIn("archived/1000/dashboard_pubkeys_aggregates.csv", marker["artifacts"])
        self.assertNotIn("1000/dashboard_pubkeys_aggregates.csv", marker["artifacts"])
        self.assertIn("2000/dashboard_pubkeys_aggregates.csv", marker["artifacts"])
        self.assertIn("3000/dashboard_pubkeys_aggregates.csv", marker["artifacts"])
        (self.repo / ".gitignore").write_text("webapps/quantum_exposure/webapp_data/archived/\n")
        git(self.repo, "add", ".gitignore")
        git(self.repo, "commit", "-m", "Fixture archive policy")
        git(self.repo, "push", "origin", "main")
        receipt = delivery.deliver_standalone(previous, self.repo, runtime_dir=self.runtime)
        self.assertEqual(receipt["status"], "delivered")
        self.assertFalse((self.repo / delivery.DATA_REL / "archived").exists())
        publication.validate_immutable_generation(self.repo / delivery.DATA_REL, marker)


if __name__ == "__main__":
    unittest.main()
