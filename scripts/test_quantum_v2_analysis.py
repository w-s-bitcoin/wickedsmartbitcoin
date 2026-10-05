#!/usr/bin/env python3
"""Fixture-only canonical Quantum analysis tests; no PostgreSQL connections."""
from __future__ import annotations

import ast
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
from datetime import datetime, timezone

PIPELINE = Path(__file__).resolve().parents[1] / "webapps" / "quantum_exposure" / "pipeline"
sys.path.insert(0, str(PIPELINE))
import quantum_v2_analysis as q

PUBKEY = bytes.fromhex("0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798")
MULTISIG = b"\x51\x21" + PUBKEY + b"\x51\xae"
SNAPSHOT_TIME = int(datetime(2026, 10, 1, tzinfo=timezone.utc).timestamp())


def pushed(value: bytes) -> bytes:
    if len(value) <= 75:
        return bytes([len(value)]) + value
    return b"\x4c" + bytes([len(value)]) + value


def state(group="group-a", family="P2PKH", amount=100_000_000, count=1, exposed=None, **kwargs):
    return dict(group_id=group, script_type=family, current_supply_sats=amount,
                current_utxo_count=count, exposed_supply_sats=amount if exposed is None else exposed,
                exposed_utxo_count=count if exposed is None or exposed > 0 else 0,
                first_received_blockheight=100, first_exposed_blockheight=200,
                first_exposed_time=1_300_000_000, display_group_id="address:" + group,
                **kwargs)


class PolicyParsingTests(unittest.TestCase):
    def test_parser_curve_cache_reuses_keys_across_distinct_policies(self):
        uncompressed = bytes.fromhex('0479be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
                                     '483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8')
        other_policy = b'\x52\x21' + PUBKEY + b'\x41' + uncompressed + b'\x52\xae'
        invalid_policy = b'\x51\x21' + b'\x02' + b'\xff' * 32 + b'\x51\xae'
        scripts = [MULTISIG, MULTISIG.hex(), other_policy, other_policy.hex(), invalid_policy,
                   '5151ae', '5221' + PUBKEY.hex() + '51ae'] * 10
        with mock.patch.object(q, '_valid_multisig_pubkey', q.valid_pubkey):
            expected = [q.parse_multisig(script) for script in scripts]
        q._valid_multisig_pubkey.cache_clear()
        try:
            with mock.patch.object(q, 'valid_pubkey', wraps=q.valid_pubkey) as check:
                self.assertEqual([q.parse_multisig(script) for script in scripts], expected)
                self.assertEqual(check.call_count, 3)  # two valid and one invalid SEC key
                self.assertGreater(q._valid_multisig_pubkey.cache_info().hits, 50)
        finally:
            q._valid_multisig_pubkey.cache_clear()

    def test_parser_curve_cache_is_bounded_and_malformed_lengths_are_not_cached(self):
        q._valid_multisig_pubkey.cache_clear()
        try:
            for _ in range(3):
                self.assertIsNone(q.parse_multisig(b'\x51\x20' + b'\x00' * 32 + b'\x51\xae'))
            self.assertEqual(q._valid_multisig_pubkey.cache_info().currsize, 0)
            # Invalid uncompressed curve points avoid an expensive synthetic
            # exponentiation run while exercising eviction through the parser.
            for number in range(32769):
                key = b'\x04' + number.to_bytes(32, 'big') + b'\x00' * 32
                self.assertIsNone(q.parse_multisig(b'\x51\x41' + key + b'\x51\xae'))
            info = q._valid_multisig_pubkey.cache_info()
            self.assertEqual((info.maxsize, info.currsize, info.misses), (32768, 32768, 32769))
        finally:
            q._valid_multisig_pubkey.cache_clear()

    @unittest.skipUnless(shutil.which('openssl'), 'Optional independent OpenSSL curve oracle unavailable')
    def test_curve_membership_agrees_with_independent_openssl_decoder(self):
        algorithm = bytes.fromhex('301006072a8648ce3d020106052b8104000a')
        uncompressed = bytes.fromhex('0479be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
                                     '483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8')
        vectors = [PUBKEY, b'\x02' + b'\xff' * 32, uncompressed, uncompressed[:-1] + b'\x00']
        vectors.extend(bytes([2 + index % 2]) + hashlib.sha256(f'quantum-curve-fixture-{index}'.encode()).digest()
                       for index in range(12))
        for key in vectors:
            body = algorithm + bytes([3, len(key) + 1, 0]) + key
            result = subprocess.run([shutil.which('openssl'), 'pkey', '-pubin', '-inform', 'DER', '-noout'],
                                    input=bytes([0x30, len(body)]) + body, capture_output=True, timeout=5)
            with self.subTest(key=key.hex()):
                self.assertEqual(q.valid_pubkey(key), result.returncode == 0)

    def test_valid_keys_and_threshold(self):
        self.assertTrue(q.valid_pubkey(PUBKEY))
        self.assertEqual(q.parse_multisig(MULTISIG), (1, (PUBKEY,)))
        uncompressed = bytes.fromhex("0479be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
                                     "483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8")
        self.assertTrue(q.valid_pubkey(uncompressed))
        self.assertFalse(q.valid_pubkey(uncompressed[:-1] + b"\x00"))

    def test_missing_invalid_and_extra_keys_rejected(self):
        for script in ("5151ae", "51010151ae", "5121" + "00"*33 + "51ae",
                       "5221" + PUBKEY.hex() + "51ae", MULTISIG.hex() + "00"):
            with self.subTest(script=script):
                self.assertIsNone(q.parse_multisig(script))
        self.assertIsNone(q.parse_multisig(b"\x51\x00\x21" + PUBKEY + b"\x51\xae"))

    def test_p2sh_commitment(self):
        locking = b"\xa9\x14" + q.hash160(MULTISIG) + b"\x87"
        sig = b"\x00" + pushed(b"signature") + pushed(MULTISIG)
        self.assertEqual(q.committed_multisig(sig.hex(), "", locking.hex()), (1, (PUBKEY,)))
        self.assertIsNone(q.committed_multisig(sig.hex(), "", (b"\xa9\x14" + b"\x00"*20 + b"\x87").hex()))
        self.assertIsNone(q.committed_multisig((sig + b"\x4c").hex(), "", locking.hex()))

    def test_witness_must_be_final_committed_script(self):
        locking = b"\x00\x20" + hashlib.sha256(MULTISIG).digest()
        self.assertEqual(q.committed_multisig("", "<empty>,abcd," + MULTISIG.hex(), locking.hex()), (1, (PUBKEY,)))
        unrelated = b"\x75\x51"  # OP_DROP OP_TRUE; valid policy with a misleading argument.
        unrelated_lock = b"\x00\x20" + hashlib.sha256(unrelated).digest()
        self.assertIsNone(q.committed_multisig("", MULTISIG.hex() + "," + unrelated.hex(), unrelated_lock.hex()))
        self.assertIsNone(q.committed_multisig("", "<empty>,abcd," + MULTISIG.hex(), unrelated_lock.hex()))

    def test_nested_witness_commitments(self):
        redeem = b"\x00\x20" + hashlib.sha256(MULTISIG).digest()
        locking = b"\xa9\x14" + q.hash160(redeem) + b"\x87"
        self.assertEqual(q.committed_multisig(pushed(redeem).hex(), "<empty>,abcd," + MULTISIG.hex(), locking.hex()), (1, (PUBKEY,)))
        self.assertIsNone(q.committed_multisig((b"\x00" + pushed(redeem)).hex(), MULTISIG.hex(), locking.hex()))


class HistoricalOutputIsolationTests(unittest.TestCase):
    def test_relative_output_and_environment_survive_helper_cwd_change(self):
        # Extract only the orchestrator: importing the legacy producer requires
        # DB dependencies. Real child processes below are harmless fixture tools.
        source = PIPELINE / 'run_historical_dashboard_analysis.py'
        tree = ast.parse(source.read_text())
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef)
                        and node.name == 'run_main_pipeline_postprocess')
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            caller, helpers = root / 'caller', root / 'helpers'
            caller.mkdir()
            helpers.mkdir()
            fixture_script = '''import argparse, json, os
from pathlib import Path
parser = argparse.ArgumentParser()
parser.add_argument('--data-dir', type=Path, required=True)
parser.add_argument('heights', nargs='*')
args = parser.parse_args()
assert args.data_dir.is_absolute()
assert Path(os.environ['QUANTUM_PIPELINE_ENV_FILE']).is_absolute()
args.data_dir.mkdir(parents=True, exist_ok=True)
(args.data_dir / (Path(__file__).stem + '.json')).write_text(json.dumps({
    'data_dir': str(args.data_dir), 'environment': os.environ['QUANTUM_PIPELINE_ENV_FILE'],
    'cwd': str(Path.cwd())}))
'''
            names = ('normalize_snapshot_csvs.py', 'sync_display_group_identity_details.py',
                     'regenerate_snapshot_indexes.py')
            for name in names:
                (helpers / name).write_text(fixture_script)
            publish, archive = mock.Mock(return_value='fixture marker'), mock.Mock(return_value=[])
            namespace = dict(Path=Path, os=os, sys=sys, subprocess=subprocess, PIPELINE_DIR=helpers,
                             publish_generation_marker=publish, archive_non_50k_snapshots=archive)
            exec(compile(ast.Module(body=[function], type_ignores=[]), str(source), 'exec'), namespace)
            prior_cwd = Path.cwd()
            try:
                os.chdir(caller)
                namespace['run_main_pipeline_postprocess']([123000], Path('isolated'), Path('private.env'))
            finally:
                os.chdir(prior_cwd)
            expected = (caller / 'isolated').resolve()
            for name in names:
                record = json.loads((expected / (Path(name).stem + '.json')).read_text())
                self.assertEqual(record['data_dir'], str(expected))
                self.assertEqual(record['environment'], str((caller / 'private.env').resolve()))
                self.assertEqual(record['cwd'], str(helpers.resolve()))
            self.assertFalse((helpers / 'isolated').exists())
            archive.assert_called_once_with([123000], expected)
            publish.assert_called_once_with(expected, reason='historical_dashboard_analysis')


class CanonicalAnalysisTests(unittest.TestCase):
    def test_every_script_subset_matches_direct_group_selection(self):
        # Every global mask is checked against direct selection from source
        # group rows, across every tier/activity. The fixture includes all seven
        # families, distinct overlapping groups, zero-value live outputs,
        # unexposed members, retired history and nonlinear packing boundaries.
        rows = [state(group='a', family='P2PK', amount=60_000_000, count=252),
                state(group='a', family='P2PKH', amount=60_000_000, count=253),
                state(group='a', family='P2WPKH', amount=0, count=1)]
        for index, family in enumerate(q.SCRIPT_TYPES):
            rows.append(state(group='b', family=family, amount=20_000_000_000,
                              count=(868, 253, 1, 252, 10000, 1, 253)[index],
                              exposed=0 if index in (2, 4) else None,
                              last_spend_blockheight=800,
                              last_spend_time=q.calendar_cutoff(SNAPSHOT_TIME)))
            rows.append(state(group='c', family=family, amount=10_000, exposed=0))
        rows.extend([state(group='d', family='P2PK', amount=0, count=0,
                           last_spend_blockheight=900, last_spend_time=SNAPSHOT_TIME - 100),
                     state(group='d', family='P2WPKH', amount=200_000_000, count=10000),
                     state(group='e', family='P2SH', amount=0, count=1),
                     state(group='f', family='P2PKH', amount=60_000_000),
                     state(group='f', family='P2WPKH', amount=30_000_000)])
        rows.sort(key=lambda row: row['group_id'])
        groups = list(q.canonical_groups(rows, SNAPSHOT_TIME))
        with tempfile.TemporaryDirectory() as tmp:
            metadata = q.export_snapshot(rows, snapshot_height=1000, snapshot_time=SNAPSHOT_TIME,
                                         output_dir=Path(tmp))
            directory = Path(tmp) / '1000'
            with (directory / 'dashboard_pubkeys_aggregates.csv').open() as stream:
                aggregates = {(row['balance_filter'], row['script_type_filter'], row['spend_activity_filter']): row
                              for row in csv.DictReader(stream)}
            with (directory / q.SUBSET_CORRECTION_FILE).open() as stream:
                corrections = list(csv.DictReader(stream))
            self.assertEqual(metadata['subset_correction_version'], 'script-mask-mobius-wu-v1')
            self.assertEqual(len(corrections), len({(row['balance_filter'], row['script_mask'],
                                                     row['spend_activity_filter']) for row in corrections}))
            self.assertTrue(all(int(row['script_mask']).bit_count() >= 2 for row in corrections))
            for tier, minimum in q.TIERS:
                for activity in ('all',) + q.ACTIVITIES:
                    eligible = [group for group in groups if group['current_supply_sats'] >= minimum
                                and (activity == 'all' or group['spend_activity'] == activity)]
                    correction_rows = [row for row in corrections if row['balance_filter'] == tier
                                       and row['spend_activity_filter'] == activity]
                    for selected_mask in range(1, 128):
                        families = [family for family, bit in q.SCRIPT_MASKS.items() if selected_mask & bit]
                        base = [aggregates[(tier, family, activity)] for family in families]
                        actual = [sum(int(row[field]) for row in base) for field in
                                  ('pubkey_count', 'exposed_pubkey_count', 'migration_weight_wu')]
                        for row in correction_rows:
                            mask = int(row['script_mask'])
                            if mask & selected_mask == mask:
                                for index, field in enumerate(('pubkey_count_correction',
                                        'exposed_pubkey_count_correction', 'migration_weight_wu_correction')):
                                    actual[index] += int(row[field])
                        expected = [0, 0, 0]
                        for group in eligible:
                            selected = {family: values for family, values in group['slices'].items()
                                        if family in families}
                            expected[0] += bool(selected)
                            expected[1] += any(values['exposed_utxo_count'] > 0 for values in selected.values())
                            expected[2] += q.migration_weight(selected)
                        with self.subTest(tier=tier, activity=activity, mask=selected_mask):
                            self.assertEqual(actual, expected)
                            if selected_mask == 127:
                                all_row = aggregates[(tier, 'All', activity)]
                                self.assertEqual(actual, [int(all_row[field]) for field in
                                                 ('pubkey_count', 'exposed_pubkey_count', 'migration_weight_wu')])

    def test_subset_work_is_limited_to_exposed_families_actually_in_group(self):
        # The three live families below need only three singleton calls and one
        # shared weight call. The unexposed family cannot change transaction
        # weight, so it must not cause repeated calculations for its subsets.
        rows = [state(family='P2PK'), state(family='P2PKH'), state(family='P2WPKH', exposed=0)]
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(q, 'migration_weight', wraps=q.migration_weight) as weight:
            q.export_snapshot(rows, snapshot_height=1000, snapshot_time=SNAPSHOT_TIME, output_dir=Path(tmp))
            self.assertEqual(weight.call_count, 4)
            with (Path(tmp) / '1000' / q.SUBSET_CORRECTION_FILE).open() as stream:
                corrections = [row for row in csv.DictReader(stream)
                               if row['balance_filter'] == 'all' and row['spend_activity_filter'] == 'all']
            self.assertEqual({int(row['script_mask']) for row in corrections}, {3, 9, 10, 11})
            for row in corrections:
                if int(row['script_mask']) & q.SCRIPT_MASKS['P2WPKH']:
                    self.assertEqual(int(row['exposed_pubkey_count_correction']), 0)
                    self.assertEqual(int(row['migration_weight_wu_correction']), 0)

    def test_single_family_snapshot_has_empty_corrections_and_exact_weight(self):
        with tempfile.TemporaryDirectory() as tmp:
            q.export_snapshot([state()], snapshot_height=1000, snapshot_time=SNAPSHOT_TIME, output_dir=Path(tmp))
            directory = Path(tmp) / '1000'
            with (directory / q.SUBSET_CORRECTION_FILE).open() as stream:
                reader = csv.DictReader(stream)
                self.assertEqual(tuple(reader.fieldnames), q.SUBSET_CORRECTION_FIELDS)
                self.assertEqual(list(reader), [])
            with (directory / 'dashboard_pubkeys_aggregates.csv').open() as stream:
                row = next(row for row in csv.DictReader(stream) if row['balance_filter'] == 'all'
                           and row['script_type_filter'] == 'All' and row['spend_activity_filter'] == 'all')
            self.assertEqual(int(row['migration_weight_wu']), 772)
            self.assertEqual(row['estimated_migration_blocks'], '0.00')

    def test_zero_value_live_utxo_is_counted_in_all_tier(self):
        row = state(amount=0, count=1)
        group = next(q.canonical_groups([row], SNAPSHOT_TIME))
        self.assertEqual(group["current_utxo_count"], 1)
        self.assertEqual(group["current_supply_sats"], 0)
        with tempfile.TemporaryDirectory() as tmp:
            metadata = q.export_snapshot([row], snapshot_height=1000, snapshot_time=SNAPSHOT_TIME,
                                         output_dir=Path(tmp))
            self.assertEqual(metadata["detail_rows"], 0)
            with (Path(tmp) / "1000/dashboard_pubkeys_aggregates.csv").open() as handle:
                aggregate = next(record for record in csv.DictReader(handle)
                                 if record["balance_filter"] == "all" and record["script_type_filter"] == "All"
                                 and record["spend_activity_filter"] == "all")
            self.assertEqual(int(aggregate["utxo_count"]), 1)
            self.assertEqual(int(aggregate["exposed_utxo_count"]), 1)
            self.assertEqual(int(aggregate["supply_sats"]), 0)

    def test_ge1_detail_includes_zero_value_exposed_utxos(self):
        rows = [state(group='a', family='P2PKH', amount=100_000_000, exposed=0),
                state(group='a', family='P2WPKH', amount=0, count=3),
                state(group='b', family='P2PKH', amount=100_000_000, exposed=0)]
        with tempfile.TemporaryDirectory() as tmp:
            metadata = q.export_snapshot(rows, snapshot_height=1000, snapshot_time=SNAPSHOT_TIME,
                                         output_dir=Path(tmp))
            directory = Path(tmp) / '1000'
            self.assertEqual(metadata['detail_rows'], 1)
            self.assertIn('includes zero-value exposed outputs', metadata['detail_coverage'])
            with (directory / 'dashboard_pubkeys_ge_1btc.csv').open() as stream:
                detail = list(csv.DictReader(stream))
            with (directory / 'dashboard_pubkeys_ge_1btc_top100.csv').open() as stream:
                self.assertEqual(list(csv.DictReader(stream)), detail)
            self.assertEqual([row['group_id'] for row in detail], ['a'])
            self.assertEqual(detail[0]['exposed_supply_sats'], '0')
            self.assertEqual(detail[0]['exposed_utxo_count'], '3')
            self.assertEqual(json.loads(detail[0]['exposed_utxo_count_by_script_type']),
                             {'P2PKH': 0, 'P2WPKH': 3})
            with (directory / 'dashboard_pubkeys_aggregates.csv').open() as stream:
                aggregate = next(row for row in csv.DictReader(stream) if row['balance_filter'] == 'ge1'
                                 and row['script_type_filter'] == 'All' and row['spend_activity_filter'] == 'all')
            self.assertEqual(int(aggregate['exposed_pubkey_count']), len(detail))
            self.assertEqual(int(aggregate['exposed_utxo_count']), sum(int(row['exposed_utxo_count']) for row in detail))
            self.assertEqual(int(aggregate['exposed_supply_sats']), 0)
            self.assertEqual(int(aggregate['migration_weight_wu']), 3 * 273 + 178)

    def test_history_only_family_controls_group_activity(self):
        rows = [state(family="P2PK", amount=120_000_000),
                state(family="P2PKH", amount=0, count=0, last_spend_blockheight=900,
                      last_spend_time=SNAPSHOT_TIME - 100)]
        group = next(q.canonical_groups(rows, SNAPSHOT_TIME))
        self.assertEqual(group["spend_activity"], "active")
        self.assertEqual(group["last_spend_blockheight"], 900)
        self.assertEqual(set(group["slices"]), {"P2PK"})

    def test_history_only_family_does_not_count_as_current_script_membership(self):
        rows = [state(family="P2PK", amount=0, count=0, last_spend_blockheight=900,
                      last_spend_time=SNAPSHOT_TIME - 100),
                state(family="P2WPKH", amount=120_000_000)]
        with tempfile.TemporaryDirectory() as tmp:
            q.export_snapshot(rows, snapshot_height=1000, snapshot_time=SNAPSHOT_TIME, output_dir=Path(tmp))
            with (Path(tmp) / "1000/dashboard_pubkeys_aggregates.csv").open() as stream:
                aggregates = {row['script_type_filter']: row for row in csv.DictReader(stream)
                              if row['balance_filter'] == 'ge1' and row['spend_activity_filter'] == 'active'}
            self.assertEqual(int(aggregates['All']['pubkey_count']), 1)
            self.assertEqual(int(aggregates['P2WPKH']['pubkey_count']), 1)
            self.assertEqual(int(aggregates['P2PK']['pubkey_count']), 0)
            with (Path(tmp) / "1000/dashboard_pubkeys_ge_1btc.csv").open() as stream:
                detail = next(csv.DictReader(stream))
            self.assertEqual(detail['script_types'], 'P2WPKH')
            self.assertEqual(detail['last_spend_blockheight'], '900')

    def test_exact_activity_calendar_and_nonmonotonic_times(self):
        stamp = int(datetime(2024, 2, 29, tzinfo=timezone.utc).timestamp())
        expected = int(datetime(2023, 2, 28, tzinfo=timezone.utc).timestamp())
        self.assertEqual(q.calendar_cutoff(stamp), expected)
        self.assertEqual(q.classify_activity(expected, stamp), "inactive")
        self.assertEqual(q.classify_activity(expected + 1, stamp), "active")
        rows = [state(family="P2PK", last_spend_blockheight=500, last_spend_time=SNAPSHOT_TIME - 100),
                state(family="P2PKH", last_spend_blockheight=501, last_spend_time=SNAPSHOT_TIME - 200)]
        self.assertEqual(next(q.canonical_groups(rows, SNAPSHOT_TIME))["last_spend_time"], SNAPSHOT_TIME - 200)

    def test_missing_timestamp_fails(self):
        with self.assertRaisesRegex(ValueError, "Missing exact"):
            list(q.canonical_groups([state(last_spend_blockheight=1)], SNAPSHOT_TIME))

    def test_disclosure_and_funding_are_distinct(self):
        group = next(q.canonical_groups([state()], SNAPSHOT_TIME))
        self.assertEqual(group["first_received_blockheight"], 100)
        self.assertEqual(group["first_exposed_blockheight"], 200)

    def test_invalid_or_unordered_state_rejected(self):
        with self.assertRaisesRegex(ValueError, "duplicate"):
            list(q.canonical_groups([state(), state()], SNAPSHOT_TIME))
        with self.assertRaisesRegex(ValueError, "ordered"):
            list(q.canonical_groups([state(group="z"), state(group="a")], SNAPSHOT_TIME))
        with self.assertRaisesRegex(ValueError, "accounting"):
            list(q.canonical_groups([state(exposed=200_000_000)], SNAPSHOT_TIME))

    def test_export_group_threshold_counts_and_activity_reconcile(self):
        rows = [state(family="P2PK", amount=60_000_000, count=3),
                state(family="P2PKH", amount=60_000_000, count=5, last_spend_blockheight=900,
                      last_spend_time=SNAPSHOT_TIME - 100),
                state(group="group-b", amount=60_000_000),
                state(group="group-c", family="P2PK", amount=60_000_000),
                state(group="group-c", family="P2PKH", amount=60_000_000, exposed=0)]
        with tempfile.TemporaryDirectory() as tmp:
            result = q.export_snapshot(rows, snapshot_height=1000, snapshot_time=SNAPSHOT_TIME,
                                       output_dir=Path(tmp), block_hash="01"*32)
            directory = Path(tmp) / "1000"
            with (directory / "dashboard_pubkeys_ge_1btc.csv").open() as stream:
                details = list(csv.DictReader(stream))
            with (directory / "dashboard_pubkeys_aggregates.csv").open() as stream:
                aggregates = {tuple(row[name] for name in ("balance_filter", "script_type_filter", "spend_activity_filter")): row for row in csv.DictReader(stream)}
            self.assertEqual(result["detail_rows"], 2)
            self.assertEqual(len(aggregates), 160)
            canonical = aggregates[("ge1", "All", "all")]
            self.assertEqual(int(canonical["exposed_supply_sats"]), sum(int(row["exposed_supply_sats"]) for row in details))
            self.assertEqual(int(canonical["exposed_utxo_count"]), sum(int(row["exposed_utxo_count"]) for row in details))
            self.assertEqual(int(canonical["exposed_pubkey_count"]), 2)
            self.assertEqual(int(canonical["supply_sats"]), 240_000_000)
            self.assertEqual(aggregates[("ge1", "P2PK", "active")]["exposed_utxo_count"], "3")
            self.assertEqual(aggregates[("ge1", "P2PKH", "active")]["exposed_utxo_count"], "5")
            self.assertEqual(json.loads(details[0]["exposed_utxo_count_by_script_type"]), {"P2PK": 3, "P2PKH": 5})
            self.assertEqual(details[1]["current_supply_sats"], "120000000")
            self.assertFalse((Path(tmp) / "latest_snapshot.txt").exists())

    def test_top100_bounded_and_ranked(self):
        rows = [state(group=f"g{index:04}", amount=100_000_000 + index) for index in range(150)]
        with tempfile.TemporaryDirectory() as tmp:
            q.export_snapshot(rows, snapshot_height=1000, snapshot_time=SNAPSHOT_TIME, output_dir=Path(tmp))
            with (Path(tmp) / "1000/dashboard_pubkeys_ge_1btc_top100.csv").open() as stream:
                top = list(csv.DictReader(stream))
            self.assertEqual(len(top), 100)
            self.assertEqual(top[0]["group_id"], "g0149")
            self.assertEqual(top[-1]["group_id"], "g0050")

    def test_top100_ties_use_ascending_group_id(self):
        rows = [state(group=f"g{index:04}") for index in range(150)]
        with tempfile.TemporaryDirectory() as tmp:
            q.export_snapshot(rows, snapshot_height=1000, snapshot_time=SNAPSHOT_TIME, output_dir=Path(tmp))
            with (Path(tmp) / "1000/dashboard_pubkeys_ge_1btc_top100.csv").open() as stream:
                top = list(csv.DictReader(stream))
            self.assertEqual(top[0]["group_id"], "g0000")
            self.assertEqual(top[-1]["group_id"], "g0099")

    def test_migration_weight_scenario_and_transaction_capacity(self):
        self.assertEqual(q.migration_weight({"P2WPKH": {"exposed_utxo_count": 1}}), 273 + 178)
        self.assertEqual(q.migration_weight({"P2PKH": {"exposed_utxo_count": 1}}), 596 + 176)
        # Mixed transactions include an empty witness stack per legacy input.
        self.assertEqual(q.migration_weight({"P2PK": {"exposed_utxo_count": 1},
                                             "P2WPKH": {"exposed_utxo_count": 1},
                                             "Other": {"exposed_utxo_count": 1}}),
                         460 + 273 + 1532 + 176 + 2 + 2)
        self.assertEqual(q.migration_weight({"P2PK": {"exposed_utxo_count": 868},
                                             "P2WPKH": {"exposed_utxo_count": 1}}),
                         868 * 460 + 184 + 273 + 178)
        weight = q.migration_weight({"P2PKH": {"exposed_utxo_count": 10_000}})
        self.assertGreater(weight, 596 * 10_000 + 176)  # Must use multiple transactions.
        self.assertLess(weight, 596 * 10_000 + 10_000)

    def test_original_export_fields_remain_byte_identical(self):
        # Captured before optimizing migration weights; covers absent families,
        # zero exposure, mixed witness inputs and CompactSize/bulk packing.
        expected = {
            'analysis_versions.json': '5f60e081ab9e1a5ef3871c78a99f0e05a5575bdaa193a8ff28787a89ace49aca',
            'dashboard_pubkeys_aggregates.csv': '97f989d92441a18ee1570b71a37230224d2ddad62e4d4f6215e31708e2bd22e4',
            'dashboard_pubkeys_ge_1btc.csv': 'cf0e642e7c07e44e584476ef2f136bec0527cd100abfae0b1731944dd1543883',
            'dashboard_pubkeys_ge_1btc_top100.csv': '13911b6eb209bdff1fc207d4de7ee9511dd9b6a81ac84b44a920800588cf2917',
            'dashboard_snapshot_meta.csv': '7229ee67b5f6e98cfa9af74d604a58cd80d7207cc06cfa68db4b72fc8af9956a',
        }
        rows = []
        for number in range(12):
            for offset, family in enumerate(q.SCRIPT_TYPES):
                if (number + offset) % 3 == 0:
                    continue
                count = (0, 1, 252, 253, 868, 10000)[(number + offset) % 6]
                amount = count * (number + 1) * 1000000
                rows.append(state(group=f'fixture-{number:02}', family=family, amount=amount, count=count,
                                  exposed=0 if (number + offset) % 4 == 0 else amount,
                                  last_spend_blockheight=300 + number if offset % 2 else None,
                                  last_spend_time=SNAPSHOT_TIME - 86400 * (20 + number * 50) if offset % 2 else None))
        with tempfile.TemporaryDirectory() as tmp:
            q.export_snapshot(rows, snapshot_height=1000, snapshot_time=SNAPSHOT_TIME,
                              output_dir=Path(tmp), block_hash='01' * 32)
            actual = {}
            # Remove only newly added capability and coverage metadata to
            # retain the original byte-golden evidence for all prior content.
            for name in expected:
                path = Path(tmp) / '1000' / name
                if name == 'analysis_versions.json':
                    metadata = json.loads(path.read_text())
                    metadata.pop('subset_correction_version')
                    metadata.pop('detail_coverage')
                    payload = (json.dumps(metadata, indent=2, sort_keys=True) + '\n').encode()
                elif name in ('dashboard_pubkeys_aggregates.csv', 'dashboard_snapshot_meta.csv'):
                    with path.open(newline='') as stream:
                        reader = csv.DictReader(stream)
                        fields = [field for field in reader.fieldnames if field not in
                                  ('migration_weight_wu', 'subset_correction_version', 'detail_coverage')]
                        output = io.StringIO(newline='')
                        writer = csv.DictWriter(output, fieldnames=fields, extrasaction='ignore')
                        writer.writeheader()
                        writer.writerows(reader)
                    payload = output.getvalue().encode()
                else:
                    payload = path.read_bytes()
                actual[name] = hashlib.sha256(payload).hexdigest()
        self.assertEqual(expected, actual)


if __name__ == "__main__":
    unittest.main()
