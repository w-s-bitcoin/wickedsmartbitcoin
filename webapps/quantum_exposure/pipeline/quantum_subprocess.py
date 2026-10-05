"""Bounded Quantum Git children; imports have no process or publication effects."""
from __future__ import annotations

from contextlib import contextmanager
import os
import signal
import subprocess
import threading


# Per-command settings: manual Git and other automation retain their own policy.
GIT_RESOURCE_CONFIG = (
    '-c', 'pack.threads=1', '-c', 'core.compression=1',
    '-c', 'pack.windowMemory=64m', '-c', 'pack.deltaCacheSize=64m',
    '-c', 'gc.auto=0', '-c', 'maintenance.auto=false',
)
TERMINATE_GRACE_SECONDS = 2.0
SUPERVISOR_GRACE_SECONDS = 10.0
_LIVE_SUPERVISORS = []


class ProcessCancelled(BaseException):
    """Cancellation must unwind cleanup, not become a retry of another command."""


class SupervisorStillRunning(RuntimeError):
    def __init__(self, pid):
        self.pid = pid
        super().__init__(f'Deploy supervisor {pid} has not acknowledged cancellation; '
                         'its active lock and staged output must be preserved')


@contextmanager
def cancellation_signals():
    """Let SIGTERM unwind Python cleanup before a supervisor releases its lock."""
    if threading.current_thread() is not threading.main_thread():
        yield
        return
    previous = signal.getsignal(signal.SIGTERM)
    def cancel(signum, frame):
        raise ProcessCancelled(f'Cancelled by signal {signum}')
    signal.signal(signal.SIGTERM, cancel)
    try:
        yield
    finally:
        signal.signal(signal.SIGTERM, previous)


@contextmanager
def _finish_launch_before_cancelling():
    """Publish the Popen handle before cancellation can unwind its owner."""
    if threading.current_thread() is not threading.main_thread():
        yield
        return
    pending = []
    previous = {sig: signal.getsignal(sig) for sig in (signal.SIGINT, signal.SIGTERM)}
    for sig in previous:
        signal.signal(sig, lambda signum, frame: pending.append(signum))
    try:
        yield
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)
    if pending:
        raise ProcessCancelled(f'Cancelled during child launch by signal {pending[0]}')


@contextmanager
def _uninterruptible_cleanup():
    # A second stop request must not skip killing children before lock release.
    if threading.current_thread() is not threading.main_thread():
        yield
        return
    previous = {sig: signal.getsignal(sig) for sig in (signal.SIGINT, signal.SIGTERM)}
    for sig in previous:
        signal.signal(sig, signal.SIG_IGN)
    try:
        yield
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)


def _signal_group(pid, signum):
    try:
        os.killpg(pid, signum)
    except ProcessLookupError:
        pass


def _stop_group(process):
    with _uninterruptible_cleanup():
        _signal_group(process.pid, signal.SIGTERM)
        try:
            process.communicate(timeout=TERMINATE_GRACE_SECONDS)
        except subprocess.TimeoutExpired:
            pass
        finally:
            # The direct child can exit before an ignoring grandchild. Always
            # clear the owned group, even when communicate returned promptly.
            _signal_group(process.pid, signal.SIGKILL)
            process.communicate()


def run_group(args, *, timeout, check=False, capture_output=False, **kwargs):
    """Run one command in an owned session, clearing its entire group on failure."""
    if capture_output:
        if 'stdout' in kwargs or 'stderr' in kwargs:
            raise ValueError('capture_output cannot be combined with stdout/stderr')
        kwargs.update(stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    with cancellation_signals():
        process = None
        try:
            with _finish_launch_before_cancelling():
                process = subprocess.Popen(args, start_new_session=True, **kwargs)
            stdout, stderr = process.communicate(timeout=timeout)
            # Auto-maintenance is disabled; no child of a completed command
            # may escape. Keep this inside the cancellation cleanup region.
            _signal_group(process.pid, signal.SIGKILL)
        except BaseException:
            if process is not None:
                _stop_group(process)
            raise
    result = subprocess.CompletedProcess(args, process.returncode, stdout, stderr)
    if check:
        result.check_returncode()
    return result


def run_supervisor(args, *, timeout, check=False, **kwargs):
    """Cancel a lock-owning supervisor cooperatively; never orphan its Git group.

    Its individual commands own separate groups and perform their own cleanup.
    If the supervisor cannot unwind, retain that live owner instead of killing
    it and allowing a competing publisher to acquire its abandoned lock.
    """
    if kwargs.get('stdout') == subprocess.PIPE or kwargs.get('stderr') == subprocess.PIPE:
        raise ValueError('Supervisor output must remain writable if cancellation is delayed')
    _LIVE_SUPERVISORS[:] = [child for child in _LIVE_SUPERVISORS if child.poll() is None]
    with cancellation_signals():
        process = None
        try:
            with _finish_launch_before_cancelling():
                process = subprocess.Popen(args, start_new_session=True, **kwargs)
            process.wait(timeout=timeout)
        except BaseException:
            if process is None:
                raise
            with _uninterruptible_cleanup():
                if process.poll() is None:
                    process.send_signal(signal.SIGTERM)
                try:
                    process.wait(timeout=SUPERVISOR_GRACE_SECONDS)
                except subprocess.TimeoutExpired:
                    _LIVE_SUPERVISORS.append(process)
                    raise SupervisorStillRunning(process.pid)
            raise
    result = subprocess.CompletedProcess(args, process.returncode)
    if check:
        result.check_returncode()
    return result
