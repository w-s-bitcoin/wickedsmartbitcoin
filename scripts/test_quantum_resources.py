#!/usr/bin/env python3
"""Private-memory guard fixtures; Darwin allocation test does not touch a DB."""
import ctypes
import os
from pathlib import Path
import platform
import sys
import unittest
from unittest.mock import Mock, patch
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "webapps/quantum_exposure/pipeline"))
import quantum_resources as resources


class ResourceTests(unittest.TestCase):
    def test_region_abi_and_shared_exclusion(self):
        self.assertEqual(ctypes.sizeof(resources._DarwinRegion), 96)
        region = resources._DarwinRegion()
        region.private_pages_resident, region.pages_swapped_out = 17, 3
        for mode in (4, 5, 7):
            region.share_mode = mode
            self.assertEqual(resources._private_region_pages(region), (0, 0))
        for mode in (1, 2, 6, 8):
            region.share_mode = mode
            self.assertEqual(resources._private_region_pages(region), (17, 3))

    def test_guard_uses_private_bytes_not_shared_footprint(self):
        conn = Mock()
        conn.get_backend_pid.return_value = 12345
        usage = {'physical_footprint_bytes': 8 * 1024**3, 'private_memory_bytes': 10 * 1024**2}
        with patch.object(resources, 'process_usage', return_value=usage):
            monitor = resources.ResourceMonitor(conn)
            monitor.stop_event.wait = lambda _: monitor.stop_event.set()
            monitor._sample()
        conn.cancel.assert_not_called()
        self.assertFalse(monitor.exceeded)
        self.assertEqual(monitor.peak_combined_private, 20 * 1024**2)

    def test_private_limit_cancels_backend(self):
        conn = Mock()
        conn.get_backend_pid.return_value = 12345
        usage = {'physical_footprint_bytes': 5 * 1024**3, 'private_memory_bytes': 3 * 1024**3}
        with patch.object(resources, 'process_usage', return_value=usage):
            monitor = resources.ResourceMonitor(conn)
            monitor.stop_event.wait = lambda _: monitor.stop_event.set()
            monitor._sample()
        conn.cancel.assert_called_once()
        self.assertTrue(monitor.exceeded)
        self.assertEqual(monitor.limit_bytes, 4 * 1024**3)

    def test_lost_measurement_cancels_instead_of_disabling_guard(self):
        conn = Mock()
        conn.get_backend_pid.return_value = 12345
        with patch.object(resources, 'process_usage', return_value={'private_memory_bytes': 1}):
            monitor = resources.ResourceMonitor(conn)
        with patch.object(resources, 'process_usage', side_effect=OSError('fixture denied')):
            monitor._sample()
        conn.cancel.assert_called_once()
        self.assertEqual(monitor.measurement_error, 'fixture denied')

    def test_disk_reserve_refuses_before_work_and_validates_configuration(self):
        conn=Mock(); conn.get_backend_pid.return_value=12345
        with patch.object(resources,'process_usage',return_value={'private_memory_bytes':1}), \
             patch.object(resources.shutil,'disk_usage',return_value=SimpleNamespace(free=99)):
            with self.assertRaisesRegex(RuntimeError,'no processing started'):
                resources.ResourceMonitor(conn,disk_paths=['/private/tmp'],minimum_free_bytes=100)
            with self.assertRaises(ValueError):
                resources.ResourceMonitor(conn,minimum_free_bytes=100)
            with self.assertRaises(ValueError):
                resources.ResourceMonitor(conn,disk_paths=['/private/tmp'],minimum_free_bytes=True)
        conn.cancel.assert_not_called()

    def test_disk_reserve_cancels_mid_query_and_records_minimum(self):
        conn=Mock(); conn.get_backend_pid.return_value=12345
        with patch.object(resources,'process_usage',return_value={'private_memory_bytes':1}), \
             patch.object(resources.shutil,'disk_usage',side_effect=[SimpleNamespace(free=200),SimpleNamespace(free=99),SimpleNamespace(free=90)]):
            monitor=resources.ResourceMonitor(conn,disk_paths=['/private/tmp'],minimum_free_bytes=100)
            monitor._sample_disk(); monitor._sample_disk()
        self.assertTrue(monitor.disk_exceeded)
        self.assertEqual(list(monitor.disk_minimum_free.values()),[90])
        conn.cancel.assert_called_once()

    def test_lost_disk_measurement_cancels_and_final_metrics_preserve_failure(self):
        conn=Mock(); conn.get_backend_pid.return_value=12345
        with patch.object(resources,'process_usage',return_value={'private_memory_bytes':1}), \
             patch.object(resources.shutil,'disk_usage',return_value=SimpleNamespace(free=200)):
            monitor=resources.ResourceMonitor(conn,disk_paths=['/private/tmp'],minimum_free_bytes=100)
        with patch.object(resources.shutil,'disk_usage',side_effect=OSError('fixture volume disappeared')):
            monitor._sample_disk()
            monitor._sample_disk(cancel=False)
        self.assertEqual(monitor.disk_measurement_error,'fixture volume disappeared')
        self.assertTrue(monitor.stop_event.is_set())
        conn.cancel.assert_called_once()

    @unittest.skipUnless(platform.system() == 'Darwin', 'Darwin proc region integration')
    def test_touched_200_mib_private_allocation_is_measured(self):
        before = resources.process_usage(os.getpid())
        size = 200 * 1024**2
        memory = bytearray(size)
        for offset in range(0, size, os.sysconf('SC_PAGE_SIZE')):
            memory[offset] = 1
        after = resources.process_usage(os.getpid())
        increase = after['private_memory_bytes'] - before['private_memory_bytes']
        self.assertGreaterEqual(increase, 190 * 1024**2)
        self.assertLess(increase, 225 * 1024**2)
        self.assertGreater(after['cpu_seconds'], before['cpu_seconds'])
        print(f'Private 200MiB allocation measured: {increase / 1024**2:.2f} MiB', flush=True)


if __name__ == '__main__':
    unittest.main()
