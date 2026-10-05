#!/usr/bin/env python3
"""Process-tree tests use sleeping fixture children and disposable lock paths."""
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'webapps/quantum_exposure/pipeline'))
import quantum_subprocess as processes

SPEC = importlib.util.spec_from_file_location('quantum_deploy_fixture', ROOT / 'scripts/automation/_git_deploy.py')
deploy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(deploy)

CHILD = """import os,signal,sys,time
from pathlib import Path
signal.signal(signal.SIGTERM, signal.SIG_IGN)
Path(sys.argv[1]).write_text(str(os.getpid()))
time.sleep(60)
"""
PARENT = """import subprocess,sys,time
subprocess.Popen([sys.executable,'-c',sys.argv[1],sys.argv[2]])
time.sleep(60)
"""


def wait_for(path, timeout=5):
    deadline = time.monotonic() + timeout
    while not path.is_file():
        if time.monotonic() >= deadline:
            raise AssertionError(f'Fixture child did not become ready: {path}')
        time.sleep(.01)


def alive(pid):
    result = subprocess.run(['ps', '-o', 'stat=', '-p', str(pid)], capture_output=True, text=True)
    return bool(result.stdout.strip()) and not result.stdout.strip().startswith('Z')


def supervisor_fixture(directory, ignore=False):
    root = Path(directory).resolve()
    if not root.name.startswith('quantum-process-fixture-'):
        raise ValueError('Supervisor requires its disposable fixture directory')
    os.environ['ANIMATIONS_DEPLOY_SOURCE'] = 'quantum'
    lock = root / 'deploy.lock'
    if not deploy.acquire_lock(lock):
        raise RuntimeError('Fixture lock unavailable')
    try:
        if ignore:
            signal.signal(signal.SIGTERM, signal.SIG_IGN)
            (root / 'ready').touch()
            time.sleep(60)
        else:
            with processes.cancellation_signals():
                deploy.run([sys.executable, '-c', PARENT, CHILD, str(root / 'grandchild.pid')], timeout=30)
    except processes.ProcessCancelled:
        pass
    finally:
        deploy.release_lock(lock)


class ProcessTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='quantum-process-fixture-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_group_timeout_terminates_ignoring_grandchild(self):
        pid_file = self.root / 'grandchild.pid'
        with patch.object(processes, 'TERMINATE_GRACE_SECONDS', .1):
            with self.assertRaises(subprocess.TimeoutExpired):
                processes.run_group([sys.executable, '-c', PARENT, CHILD, str(pid_file)],
                                    timeout=.5, capture_output=True, text=True)
        pid = int(pid_file.read_text())
        self.assertFalse(alive(pid), f'Grandchild {pid} escaped timeout cleanup')

    def test_cancellation_during_launch_cannot_escape_group_cleanup(self):
        created=[]
        original=subprocess.Popen
        def launch_then_cancel(*args,**kwargs):
            child=original(*args,**kwargs)
            created.append(child)
            os.kill(os.getpid(),signal.SIGTERM)
            return child
        with patch.object(processes.subprocess,'Popen',side_effect=launch_then_cancel):
            with self.assertRaises(processes.ProcessCancelled):
                processes.run_group([sys.executable,'-c','import time; time.sleep(60)'],timeout=5,
                                    capture_output=True,text=True)
        self.assertEqual(len(created),1)
        self.assertIsNotNone(created[0].returncode)
        self.assertFalse(alive(created[0].pid))

    def test_sigterm_retains_deploy_lock_until_children_are_stopped(self):
        child = subprocess.Popen([sys.executable, __file__, '--supervisor', str(self.root)],
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            pid_file = self.root / 'grandchild.pid'
            wait_for(pid_file)
            grandchild = int(pid_file.read_text())
            child.send_signal(signal.SIGTERM)
            time.sleep(.1)
            self.assertTrue(alive(grandchild))  # Ignoring TERM during grace.
            self.assertFalse(deploy.acquire_lock(self.root / 'deploy.lock'))
            child.wait(timeout=6)
            self.assertFalse(alive(grandchild))
            self.assertTrue(deploy.acquire_lock(self.root / 'deploy.lock'))
            deploy.release_lock(self.root / 'deploy.lock')
        finally:
            if child.poll() is None:
                child.kill()
                child.wait(timeout=5)

    def test_outer_timeout_cooperates_with_supervisor_cleanup(self):
        with self.assertRaises(subprocess.TimeoutExpired):
            processes.run_supervisor([sys.executable, __file__, '--supervisor', str(self.root)],
                                     timeout=.5, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.assertFalse(alive(int((self.root / 'grandchild.pid').read_text())))
        self.assertFalse((self.root / 'deploy.lock').exists())

    def test_unresponsive_supervisor_keeps_live_lock_and_reports_pid(self):
        with patch.object(processes, 'SUPERVISOR_GRACE_SECONDS', .1):
            with self.assertRaises(processes.SupervisorStillRunning) as caught:
                processes.run_supervisor([sys.executable, __file__, '--ignore-supervisor', str(self.root)],
                                         timeout=.5, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        child = next(item for item in processes._LIVE_SUPERVISORS if item.pid == caught.exception.pid)
        try:
            self.assertTrue(alive(child.pid))
            self.assertEqual(int((self.root / 'deploy.lock').read_text()), child.pid)
            self.assertFalse(deploy.acquire_lock(self.root / 'deploy.lock'))
        finally:
            child.kill()
            child.wait(timeout=5)
        self.assertTrue(deploy.acquire_lock(self.root / 'deploy.lock'))
        deploy.release_lock(self.root / 'deploy.lock')

    def test_resource_settings_are_scoped_to_quantum_commands(self):
        with patch.dict(os.environ, {'ANIMATIONS_DEPLOY_SOURCE': 'quantum'}):
            command = deploy.automation_git_command(['git', 'status'])
            for setting in processes.GIT_RESOURCE_CONFIG[1::2]:
                self.assertIn(setting, command)
        with patch.dict(os.environ, {'ANIMATIONS_DEPLOY_SOURCE': 'onchain'}):
            self.assertNotIn('pack.threads=1', deploy.automation_git_command(['git', 'status']))
        result = processes.run_group([sys.executable, '-c', 'print("fixture")'], timeout=5,
                                     capture_output=True, text=True)
        self.assertEqual(result.stdout, 'fixture\n')


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] in ('--supervisor', '--ignore-supervisor'):
        supervisor_fixture(sys.argv[2], ignore=sys.argv[1] == '--ignore-supervisor')
    else:
        unittest.main()
