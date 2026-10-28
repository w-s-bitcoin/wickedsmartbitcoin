"""Isolated block packaging checks; no live data producers or services."""
import csv
import hashlib
import json
from pathlib import Path
import struct
import tempfile
import unittest

from scripts import build_target_hashes as builder

TARGET = '00000000ffff' + '0' * 52


class TargetHashesTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        (self.root / 'assets').mkdir()
        self.output = self.root / 'result'

    def source(self, rows):
        path = self.root / 'assets/block_data_0_99999.csv'
        with path.open('w', newline='') as stream:
            writer = csv.writer(stream)
            writer.writerow(['block_height', 'timestamp', 'block_hash', 'difficulty', 'target'])
            writer.writerows(rows)

    def test_exact_hashes_reversed_timestamps_and_determinism(self):
        hashes = ['0' * 63 + '2', '0' * 63 + '1']
        self.source([(0, 1231006505, hashes[0], 1, TARGET), (1, 1231006500, hashes[1], 1, TARGET)])
        manifest = builder.build(self.root, self.output)
        payload = (self.output / manifest['chunks'][0]['path']).read_bytes()
        self.assertEqual(list(struct.iter_unpack('<I32s', payload)), [(1231006505, bytes.fromhex(hashes[0])), (1231006500, bytes.fromhex(hashes[1]))])
        self.assertEqual(hashlib.sha256(payload).hexdigest(), manifest['chunks'][0]['sha256'])
        for theme in ('dark', 'light'):
            artifact = manifest['previews'][theme]
            preview = (self.output / artifact['path']).read_bytes()
            self.assertEqual(len(preview), artifact['bytes'])
            self.assertEqual(hashlib.sha256(preview).hexdigest(), artifact['sha256'])
            self.assertIn(b'width="640" height="360"', preview)
        self.assertEqual(manifest, builder.build(self.root, self.output))
        self.assertEqual(manifest['epochs'], [dict(height=0, difficulty=1, target=TARGET)])

    def test_invalid_source_keeps_published_marker_and_payload(self):
        self.source([(0, 1231006505, '0' * 63 + '1', 1, TARGET)])
        manifest = builder.build(self.root, self.output)
        before = (self.output / 'manifest.json').read_bytes()
        for row in [(2, 1231006505, '0' * 63 + '1', 1, TARGET),
                    (0, 1231006505, 'f' * 64, 1, TARGET),
                    (0, 1231006505, '0' * 64, 1, TARGET),
                    (0, 1231006505, '0' * 63 + '1', 'nan', TARGET)]:
            with self.subTest(row=row):
                self.source([row])
                with self.assertRaises(ValueError):
                    builder.build(self.root, self.output)
                self.assertEqual((self.output / 'manifest.json').read_bytes(), before)
                self.assertTrue((self.output / manifest['chunks'][0]['path']).exists())


if __name__ == '__main__':
    unittest.main()
