#!/usr/bin/env python3
"""Exercise the EOE static reference builder with isolated file fixtures."""

import csv
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest


BUILDER_PATH = Path(__file__).with_name("build_eoe_live_reference.py")
spec = importlib.util.spec_from_file_location("eoe_live_reference", BUILDER_PATH)
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class EoeLiveReferenceTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="wsb-eoe-reference-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / "assets").mkdir()
        self.output = self.root / "reference"

    def csv(self, filename, headers, rows):
        path = self.root / "assets" / filename
        with path.open("w", newline="") as stream:
            writer = csv.writer(stream)
            writer.writerow(headers)
            writer.writerows(rows)
        return path

    def prices(self, rows=((100, 0, 0), (110, 0.00076392, 1), (130, 16865.981509234683, 2), (150, 99, 3))):
        return self.csv("btcusd_10m_prices.csv", ["timestamp", "price", "price_height"], rows)

    def blocks(self, rows, filename="block_data_0_99999.csv"):
        return self.csv(filename, ["block_height", "timestamp"], rows)

    def build(self):
        return builder.build_reference(self.root, self.output)

    def records(self, manifest):
        records = []
        for chunk in manifest["chunks"]:
            payload = (self.output / chunk["path"]).read_bytes()
            self.assertEqual(len(payload), chunk["count"] * 16)
            self.assertEqual(hashlib.sha256(payload).hexdigest(), chunk["sha256"])
            self.assertEqual(chunk["path"], f"{chunk['start']}-{chunk['sha256'][:16]}.bin")
            records.extend(struct.iter_unpack("<IId", payload))
        return records

    def test_nearest_utc_ties_precision_zero_and_no_extrapolation(self):
        self.prices()
        times = [90, 100, 105, 111, 120, 130, 145, 151]
        self.blocks(enumerate(times))
        manifest = self.build()
        self.assertEqual((manifest["schema_version"], manifest["chunk_size"], manifest["record_bytes"]), (1, 4096, 16))
        self.assertEqual((manifest["first_height"], manifest["last_height"]), (0, 7))
        self.assertEqual(self.records(manifest), [
            (90, 0, 0), (100, 100, 0), (105, 100, 0),
            (111, 110, 0.00076392), (120, 110, 0.00076392),
            (130, 130, 16865.981509234683), (145, 150, 99), (151, 0, 0),
        ])

    def test_chunks_align_to_height_and_timestamps_may_reverse(self):
        self.prices()
        self.blocks([(4094, 130), (4095, 100), (4096, 120), (4097, 110), (4098, 150)])
        manifest = self.build()
        self.assertEqual([(c["start"], c["count"]) for c in manifest["chunks"]], [(4094, 2), (4096, 3)])
        self.assertEqual((manifest["first_height"], manifest["last_height"]), (4094, 4098))
        self.assertEqual([r[0] for r in self.records(manifest)], [130, 100, 120, 110, 150])

    def test_build_is_deterministic_and_does_not_modify_source(self):
        self.prices()
        self.blocks([(0, 100), (1, 130)])
        source_before = {p.name: p.read_bytes() for p in (self.root / "assets").iterdir()}
        first = self.build()
        output_before = {p.name: p.read_bytes() for p in self.output.iterdir()}
        self.assertEqual(self.build(), first)
        self.assertEqual({p.name: p.read_bytes() for p in self.output.iterdir()}, output_before)
        self.assertEqual({p.name: p.read_bytes() for p in (self.root / "assets").iterdir()}, source_before)
        self.assertEqual(json.loads((self.output / "manifest.json").read_bytes()), first)

    def test_duplicate_conflicting_missing_or_unordered_heights_retain_last_manifest(self):
        self.prices()
        self.blocks([(0, 100), (1, 110)])
        installed = self.build()
        marker = (self.output / "manifest.json").read_bytes()
        for rows in [[(0, 100), (0, 100)], [(0, 100), (0, 130)], [(0, 100), (2, 130)], [(1, 110), (0, 100)]]:
            with self.subTest(rows=rows):
                self.blocks(rows)
                with self.assertRaisesRegex(ValueError, "contiguous, unique, and increasing"):
                    self.build()
                self.assertEqual((self.output / "manifest.json").read_bytes(), marker)
                self.records(installed)

    def test_incomplete_or_invalid_sources_cannot_publish(self):
        self.blocks([(0, 100)])
        invalid_prices = [[], [(100, "NaN", 0)], [(100, "Infinity", 0)], [(100, -1, 0)],
                          [(100, 1, 0), (100, 2, 1)], [(110, 1, 0), (100, 2, 1)],
                          [(0, 1, 0)], [(2**32, 1, 0)], [(100, "", 0)]]
        for rows in invalid_prices:
            with self.subTest(rows=rows):
                self.prices(rows)
                with self.assertRaises(ValueError):
                    self.build()
                self.assertFalse((self.output / "manifest.json").exists())
        self.prices()
        for rows in [[], [(0, 0)], [(0, 2**32)], [(100000, 100)], [(0.5, 100)]]:
            with self.subTest(rows=rows):
                self.blocks(rows)
                with self.assertRaises(ValueError):
                    self.build()
                self.assertFalse((self.output / "manifest.json").exists())

    def test_cli_uses_only_explicit_fixture_paths(self):
        self.prices()
        self.blocks([(0, 100), (1, 110)])
        completed = subprocess.run([sys.executable, str(BUILDER_PATH), "--source-root", str(self.root),
                                    "--output-dir", str(self.output)], capture_output=True, text=True)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("2 blocks, 1 chunks, 32 binary bytes", completed.stdout)
        self.assertEqual(len(self.records(json.loads((self.output / "manifest.json").read_bytes()))), 2)


if __name__ == "__main__":
    unittest.main()
