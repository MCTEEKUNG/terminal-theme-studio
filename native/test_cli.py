"""Single-instance desktop command dispatch in an isolated D-Bus/X session."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parent.parent


def worker():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        status, marker = root / 'status.json', root / 'command output.txt'
        common = ['/usr/bin/python3', str(ROOT / 'native/terminal.py'), '--server', 'http://127.0.0.1:1', '--status-file', str(status)]
        primary = subprocess.Popen([*common, '--working-directory', directory, '--hold', '--', '/bin/sh', '-c',
                                    'printf "%s" "$1" > "$2"', 'sh', 'spaces $ and quotes', str(marker)],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        try:
            for _ in range(80):
                if primary.poll() is not None:
                    raise AssertionError(primary.stderr.read())
                if marker.exists() and status.exists():
                    break
                time.sleep(.1)
            assert marker.read_text() == 'spaces $ and quotes'
            subprocess.run([*common, '--working-directory', directory, '--', '/bin/sleep', '30'], check=True, timeout=10)
            for _ in range(40):
                state = json.loads(status.read_text())
                if state.get('tabCount') == 2:
                    break
                time.sleep(.1)
            assert state['tabCount'] == 2, state
            assert state['pid'] == primary.pid
            assert all(tab['cwd'] == directory for tab in state['tabs'])
            executable = root / 'caller-path-tool'
            path_marker = root / 'caller-path-result'
            executable.write_text('#!/bin/sh\nprintf "%s" "$2" > "$1"\n')
            executable.chmod(0o755)
            env = dict(os.environ, PATH=directory + ':' + os.environ['PATH'])
            subprocess.run([*common, '--', executable.name, str(path_marker), 'caller path works'], env=env, check=True, timeout=10)
            for _ in range(30):
                if path_marker.exists():
                    break
                time.sleep(.1)
            assert path_marker.read_text() == 'caller path works'
            subprocess.run([*common, '--present'], check=True, timeout=10)
            subprocess.run([*common, '--new-window', '--working-directory', directory], check=True, timeout=10)
            for _ in range(40):
                state = json.loads(status.read_text())
                if state.get('windowCount') == 2:
                    break
                time.sleep(.1)
            assert state['windowCount'] == 2 and state['tabCount'] == 3, state
        finally:
            primary.terminate()
            try:
                primary.wait(5)
            except subprocess.TimeoutExpired:
                primary.kill()
                primary.wait()
            primary.stderr.close()


class DesktopDispatchTest(unittest.TestCase):
    def test_command_arguments_cwd_single_instance_and_new_window(self):
        env = dict(os.environ, GTK_USE_PORTAL='0', NO_AT_BRIDGE='1', HISTFILE=os.devnull)
        result = subprocess.run(['dbus-run-session', '--', 'xvfb-run', '-a', '/usr/bin/python3', __file__, '--worker'],
                                env=env, capture_output=True, text=True, timeout=35)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    if '--worker' in sys.argv:
        worker()
    else:
        unittest.main()
