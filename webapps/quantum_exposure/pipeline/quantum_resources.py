"""Measure the actual worker and PostgreSQL backend, with a memory cancel guard.

Darwin physical footprint can charge the entire PostgreSQL shared-buffer mapping
to a backend. The cancel guard instead sums private resident pages and non-shared
swapped pages from PROC_PIDREGIONINFO. Raw footprint/RSS remain diagnostic only.
WAL/temp counters are database/cluster-wide
and explicitly labelled; they must not be presented as exclusively Quantum I/O.
"""
from __future__ import annotations

import ctypes
import errno
import os
import platform
from pathlib import Path
import shutil
import subprocess
import threading
import time


class _DarwinUsage(ctypes.Structure):
    _fields_ = [('uuid', ctypes.c_ubyte * 16)] + [(name, ctypes.c_uint64) for name in (
        'user_time','system_time','pkg_idle_wkups','interrupt_wkups','pageins','wired_size',
        'resident_size','phys_footprint','proc_start_abstime','proc_exit_abstime',
        'child_user_time','child_system_time','child_pkg_idle_wkups','child_interrupt_wkups',
        'child_pageins','child_elapsed_abstime','diskio_bytesread','diskio_byteswritten',
        'cpu_time_qos_default','cpu_time_qos_maintenance','cpu_time_qos_background',
        'cpu_time_qos_utility','cpu_time_qos_legacy','cpu_time_qos_user_initiated',
        'cpu_time_qos_user_interactive','billed_system_time','serviced_system_time',
        'logical_writes','lifetime_max_phys_footprint','instructions','cycles',
        'billed_energy','serviced_energy','interval_max_phys_footprint','runnable_time')]


class _DarwinRegion(ctypes.Structure):
    # Public Darwin SDK sys/proc_info.h, struct proc_regioninfo (96 bytes).
    _fields_ = [(name, ctypes.c_uint32) for name in (
        'protection', 'max_protection', 'inheritance', 'flags')]
    _fields_ += [('offset', ctypes.c_uint64)]
    _fields_ += [(name, ctypes.c_uint32) for name in (
        'behavior', 'user_wired_count', 'user_tag', 'pages_resident',
        'pages_shared_now_private', 'pages_swapped_out', 'pages_dirtied',
        'ref_count', 'shadow_depth', 'share_mode', 'private_pages_resident',
        'shared_pages_resident', 'obj_id', 'depth')]
    _fields_ += [('address', ctypes.c_uint64), ('size', ctypes.c_uint64)]


def _private_region_pages(region) -> tuple[int, int]:
    # SM_SHARED, SM_TRUESHARED and SM_SHARED_ALIASED are backed by shared
    # objects (notably PostgreSQL mmap shared_buffers). COW regions retain
    # only their private resident pages; their swap is conservatively charged.
    if region.share_mode in (4, 5, 7):
        return 0, 0
    return int(region.private_pages_resident), int(region.pages_swapped_out)


def darwin_private_memory(pid: int, lib=None) -> dict:
    lib = lib or ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
    lib.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64, ctypes.c_void_p, ctypes.c_int]
    lib.proc_pidinfo.restype = ctypes.c_int
    address = resident = swapped = excluded = region_count = 0
    page_size = os.sysconf('SC_PAGE_SIZE')
    while address < 2**64:
        region = _DarwinRegion()
        ctypes.set_errno(0)
        size = lib.proc_pidinfo(pid, 7, address, ctypes.byref(region), ctypes.sizeof(region))
        if size != ctypes.sizeof(region):
            error = ctypes.get_errno()
            # EINVAL marks the end of the address map. A first-query failure,
            # a truncated result or denied access is not a zero-memory sample.
            if size == 0 and region_count and error == errno.EINVAL:
                break
            raise OSError(error, 'proc_pidinfo region enumeration failed')
        next_address = int(region.address + region.size)
        if not region.size or next_address <= address:
            raise OSError('proc_pidinfo returned a nonadvancing region')
        private, swap = _private_region_pages(region)
        resident += private
        swapped += swap
        if region.share_mode in (4, 5, 7):
            excluded += region.pages_resident
        region_count += 1
        address = next_address
    return {'private_resident_bytes': resident * page_size,
            'private_swapped_bytes': swapped * page_size,
            'private_memory_bytes': (resident + swapped) * page_size,
            # These are shared VM-object counters, not unique process RSS;
            # they may exceed the backend's currently mapped resident pages.
            'excluded_shared_object_resident_bytes': excluded * page_size,
            'memory_region_count': region_count}


def process_usage(pid: int) -> dict:
    if platform.system() == 'Darwin':
        lib = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
        value = _DarwinUsage()
        if lib.proc_pid_rusage(pid, 4, ctypes.byref(value)) != 0:
            raise OSError(ctypes.get_errno(), 'proc_pid_rusage failed')
        # rusage_info CPU times use Mach absolute ticks (24 MHz on this ARM
        # host), unlike getrusage timeval. Treating ticks as ns understates CPU.
        class Timebase(ctypes.Structure):
            _fields_ = [('numer',ctypes.c_uint32),('denom',ctypes.c_uint32)]
        timebase = Timebase()
        system = ctypes.CDLL('/usr/lib/libSystem.B.dylib')
        system.mach_timebase_info(ctypes.byref(timebase))
        seconds_per_tick = timebase.numer / timebase.denom / 1e9
        return {'pid':pid,'cpu_seconds':(value.user_time+value.system_time)*seconds_per_tick,
                'rss_bytes':value.resident_size,'physical_footprint_bytes':value.phys_footprint,
                'read_bytes':value.diskio_bytesread,'write_bytes':value.diskio_byteswritten,
                'peak_physical_footprint_bytes':value.lifetime_max_phys_footprint,
                **darwin_private_memory(pid, lib)}
    # Portable tests can run without Darwin; absence is explicit, never zero.
    return {'pid':pid,'measurement_unavailable':platform.system()}


def database_usage(conn) -> dict:
    with conn, conn.cursor() as cur:
        cur.execute('SELECT pg_stat_clear_snapshot()')
        cur.execute('''SELECT pg_current_wal_lsn()::text,temp_bytes,temp_files,blks_read,blks_hit
            FROM pg_stat_database WHERE datname=current_database()''')
        row = cur.fetchone()
        return dict(zip(('cluster_wal_lsn','database_temp_bytes','database_temp_files',
                         'database_blocks_read','database_blocks_hit'),row))


def lower_priority(backend_pid: int):
    for pid in (os.getpid(), backend_pid):
        try:
            os.setpriority(os.PRIO_PROCESS,pid,10)
        except (OSError,AttributeError):
            pass


class ResourceMonitor:
    def __init__(self, conn, *, limit_bytes: int = 4*1024**3, sample_interval: float = 2.0,
                 disk_paths=(), minimum_free_bytes: int = 0):
        self.conn, self.limit_bytes = conn, limit_bytes
        if sample_interval <= 0:
            raise ValueError('Resource sample interval must be positive')
        self.sample_interval = sample_interval
        self.pids = (os.getpid(),conn.get_backend_pid())
        self.initial = {str(pid):process_usage(pid) for pid in self.pids}
        self.latest = dict(self.initial)
        self.peak_combined_footprint = 0
        self.peak_combined_private = 0
        self.stop_event = threading.Event()
        self.exceeded = False
        self.exceeded_sample = None
        self.memory_map_summary = None
        self.measurement_error = None
        if type(minimum_free_bytes) is not int or minimum_free_bytes < 0:
            raise ValueError('Disk reserve must be a nonnegative integer')
        self.minimum_free_bytes = minimum_free_bytes
        self.disk_paths = tuple(sorted({str(Path(path).resolve()) for path in disk_paths}))
        if minimum_free_bytes and not self.disk_paths:
            raise ValueError('Disk reserve requires explicit storage paths')
        self.disk_minimum_free = {}
        self.disk_exceeded = False
        self.disk_measurement_error = None
        self._sample_disk(cancel=False)
        if self.disk_measurement_error:
            raise RuntimeError('Quantum disk reserve could not be measured; no processing started')
        if self.disk_exceeded:
            raise RuntimeError('Quantum disk reserve is unavailable; no processing started')
        self.started = time.monotonic()
        self.thread = threading.Thread(target=self._sample, name='quantum-resource-guard', daemon=True)

    def _sample(self):
        while not self.stop_event.is_set():
            try:
                sample = {str(pid):process_usage(pid) for pid in self.pids}
                self.latest = sample
                total = sum(row.get('physical_footprint_bytes',0) for row in sample.values())
                self.peak_combined_footprint = max(total,self.peak_combined_footprint)
                private = sum(row.get('private_memory_bytes',0) for row in sample.values())
                self.peak_combined_private = max(private,self.peak_combined_private)
                if private > self.limit_bytes and not self.exceeded:
                    self.exceeded = True
                    self.exceeded_sample = sample
                    self.conn.cancel()
                self._sample_disk()
            except OSError as exc:
                # Do not let a long-running query continue with a blind guard.
                self.measurement_error = str(exc)
                self.conn.cancel()
                self.stop_event.set()
            self.stop_event.wait(self.sample_interval)

    def _sample_disk(self, *, cancel=True):
        if not self.minimum_free_bytes:
            return
        try:
            for path in self.disk_paths:
                free = shutil.disk_usage(path).free
                self.disk_minimum_free[path] = min(free, self.disk_minimum_free.get(path, free))
                if free < self.minimum_free_bytes and not self.disk_exceeded:
                    self.disk_exceeded = True
                    if cancel:
                        self.conn.cancel()
        except OSError as error:
            self.disk_measurement_error = str(error)
            if cancel:
                self.conn.cancel()
                self.stop_event.set()

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self,*args):
        self.stop_event.set()
        self.thread.join(timeout=2)
        self._final_sample()
        if self.exceeded and platform.system()=='Darwin':
            try:
                result=subprocess.run(['/usr/bin/vmmap','-summary',str(self.pids[1])],capture_output=True,text=True,timeout=10)
                self.memory_map_summary=result.stdout or result.stderr
            except (OSError,subprocess.TimeoutExpired):
                pass

    def _final_sample(self):
        self._sample_disk(cancel=False)
        try:
            self.latest = {str(pid):process_usage(pid) for pid in self.pids}
            current = sum(row.get('physical_footprint_bytes',0) for row in self.latest.values())
            self.peak_combined_footprint = max(self.peak_combined_footprint,current)
            private = sum(row.get('private_memory_bytes',0) for row in self.latest.values())
            self.peak_combined_private = max(self.peak_combined_private,private)
            if private > self.limit_bytes:
                self.exceeded = True
                self.exceeded_sample = self.latest
        except OSError:
            pass

    def metrics(self) -> dict:
        self._final_sample()
        rows = {}
        for pid, last in self.latest.items():
            rows[pid] = dict(last)
            for key in ('cpu_seconds','read_bytes','write_bytes'):
                if key in last:
                    rows[pid][f'interval_{key}'] = last[key]-self.initial[pid][key]
        return {'wall_seconds':time.monotonic()-self.started,'processes':rows,
                'peak_combined_physical_footprint_bytes':self.peak_combined_footprint,
                'peak_combined_private_memory_bytes':self.peak_combined_private,
                'memory_limit_bytes':self.limit_bytes,'memory_limit_exceeded':self.exceeded,
                'memory_sample_interval_seconds':self.sample_interval,'memory_measurement_error':self.measurement_error,
                'minimum_free_disk_bytes':self.minimum_free_bytes,
                'observed_minimum_free_disk_bytes':self.disk_minimum_free,
                'disk_reserve_exceeded':self.disk_exceeded,'disk_measurement_error':self.disk_measurement_error,
                'exceeded_sample':self.exceeded_sample,'memory_map_summary':self.memory_map_summary,
                'memory_measure':'Darwin region private resident + non-shared swapped pages; shared mappings excluded; kernel page tables not included'}
