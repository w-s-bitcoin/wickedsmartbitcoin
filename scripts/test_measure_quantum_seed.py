#!/usr/bin/env python3
"""Pure/sample-database checks for the bounded read-only seed measurement tool."""
from __future__ import annotations

import os
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import measure_quantum_seed as sample
try:
    import psycopg2
except ImportError:
    psycopg2 = None

DSN = os.environ.get('QUANTUM_SEED_TEST_DSN', '')


def row(height=1, txid='a', amount=50, spent=None, family='pubkey'):
    return {'keyhash20': bytes.fromhex('11' * 20), 'script_type': family, 'blockheight': height,
            'transactionid': txid, 'vout': 0, 'amount': amount, 'address': 'address-a',
            'spendingblock': spent, 'source_row_bytes': 150}


class ReductionTests(unittest.TestCase):
    def test_mixed_families_history_genesis_and_zero_value_utxos(self):
        rows = [row(0, 'genesis', amount=5000), row(1, 'zero', amount=0),
                row(2, 'spent', amount=100, spent=9, family='pubkeyhash'),
                row(4, 'future', amount=50, spent=20, family='witness_v0_keyhash')]
        groups, report = sample.reduce_sample(rows, 'active_key_outputs', 10)
        self.assertEqual(report['distinct_reporting_groups'], 1)
        self.assertEqual(report['group_family_rows'], 3)
        self.assertEqual(report['by_family']['P2PK']['sample_current_utxos'], 1)
        self.assertEqual(report['by_family']['P2PK']['sample_current_balance_sats'], 0)
        self.assertEqual(report['by_family']['P2WPKH']['sample_current_balance_sats'], 50)
        self.assertEqual(groups[('11' * 20, 'P2PK')][2], 1)
        self.assertEqual(groups[('11' * 20, 'P2PKH')][3], 9)
        self.assertEqual(report['source_tuple_bytes'], 600)

    def test_bip30_removal_is_not_a_spend(self):
        rows = [row(2, 'same', amount=100, spent=8), row(5, 'same', amount=100)]
        groups, report = sample.reduce_sample(rows, 'active_key_outputs', 10, {(2, 'same', 0): 5})
        self.assertEqual(groups[('11' * 20, 'P2PK')], [100, 1, 2, None])


class FixtureMonitor:
    exceeded = False
    measurement_error = None

    def __init__(self, conn):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def metrics(self):
        return {'fixture_resource_sampling': True}


@unittest.skipUnless(DSN and psycopg2, 'Set QUANTUM_SEED_TEST_DSN to an explicit disposable fixture')
class SamplerFixture(unittest.TestCase):
    def setUp(self):
        args = psycopg2.extensions.parse_dsn(DSN)
        if not args.get('dbname', '').endswith('_fixture') or not args.get('host', '').startswith(('/tmp/', '/private/tmp/')):
            raise RuntimeError('Refusing setup outside explicit /tmp socket + *_fixture database')
        self.conn = psycopg2.connect(DSN)
        self.addCleanup(self.conn.close)
        with self.conn, self.conn.cursor() as cur:
            cur.execute('DROP SCHEMA public CASCADE')
            cur.execute('CREATE SCHEMA public')
            cur.execute('CREATE TABLE blockheader(blockheight bigint PRIMARY KEY,blockhash text,time bigint)')
            cur.execute('CREATE TABLE analysis_freeze(name text PRIMARY KEY,freeze_blockheight bigint)')
            cur.execute("INSERT INTO analysis_freeze VALUES('active_key_outputs',10)")
            cur.execute('''CREATE TABLE active_key_outputs(keyhash20 bytea,script_type text,blockheight bigint,
                transactionid text,vout integer,amount bigint,address text,spendingblock bigint,
                PRIMARY KEY(blockheight,transactionid,vout))''')
            cur.executemany('INSERT INTO active_key_outputs VALUES(%s,%s,%s,%s,%s,%s,%s,%s)',
                            [(bytes.fromhex('11' * 20), 'pubkeyhash', n, str(n), 0, n * 10, 'address-a', 9 if n == 2 else None)
                             for n in range(1, 6)])

    def run_sample(self, **kwargs):
        options = dict(table='active_key_outputs', height=10, start_height=1, end_height=4, row_limit=2,
                       monitor_factory=FixtureMonitor)
        options.update(kwargs)
        return sample.measure(self.conn, **options)

    def test_read_only_capped_window_and_keyset_resume(self):
        result = self.run_sample()
        self.assertEqual(result['status'], 'complete', result)
        self.assertTrue(self.conn.readonly)
        self.assertEqual(result['sample']['rows'], 2)
        self.assertEqual(result['sample']['last_occurrence'], [2, '2', 0])
        self.assertTrue(result['row_limit_reached'])
        resumed = self.run_sample(start_height=2, after_txid='2', after_vout=0)
        self.assertEqual(resumed['sample']['first_occurrence'], [3, '3', 0])
        self.assertEqual(resumed['sample']['last_occurrence'], [4, '4', 0])
        with self.conn, self.conn.cursor() as cur:
            cur.execute('SELECT count(*),sum(amount) FROM active_key_outputs')
            self.assertEqual(cur.fetchone(), (5, 150))

    def test_temporary_size_model_disappears_and_freeze_mismatch_fails(self):
        result = self.run_sample(temp_state=True)
        self.assertEqual(result['status'], 'complete', result)
        self.assertEqual(result['temporary_compact_size']['rows'], 1)
        self.assertGreater(result['temporary_compact_size']['heap_bytes'], 0)
        with self.conn, self.conn.cursor() as cur:
            cur.execute("SELECT to_regclass('pg_temp.quantum_seed_size_sample')")
            self.assertIsNone(cur.fetchone()[0])
        failed = self.run_sample(height=11)
        self.assertEqual(failed['status'], 'failed')
        self.assertIn('family freeze', failed['error'])


if __name__ == '__main__':
    unittest.main()
