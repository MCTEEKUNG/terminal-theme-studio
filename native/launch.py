#!/usr/bin/python3
"""Desktop/default-terminal entry point; start the controller before the UI."""
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request
import json
import webbrowser

ROOT = Path(__file__).resolve().parent.parent
SERVER = 'http://127.0.0.1:5555'


def healthy():
    try:
        with urllib.request.urlopen(SERVER + '/api/health', timeout=.5) as response:
            return json.load(response).get('app') == 'terminal-theme-studio'
    except (OSError, ValueError):
        return False


def ensure_controller():
    if healthy():
        return
    variables = [key for key in ('DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'XDG_CURRENT_DESKTOP') if key in os.environ]
    if variables:
        subprocess.run(['systemctl', '--user', 'import-environment', *variables], check=True, timeout=10)
    subprocess.run(['systemctl', '--user', 'start', 'terminal-theme-studio.service'], check=True, timeout=20)
    for _ in range(60):
        if healthy():
            return
        time.sleep(.1)
    raise RuntimeError('Theme Studio controller did not start. Check: systemctl --user status terminal-theme-studio')


def main():
    try:
        ensure_controller()
    except Exception as error:
        print(error, file=sys.stderr)
        # The shell remains usable even if controller startup fails.
    argv = sys.argv[1:]
    if '--settings' in argv:
        webbrowser.open(SERVER)
        return
    # Legacy callers use -e; preserve each following argument exactly.
    prefix = argv[:argv.index('--')] if '--' in argv else argv
    if '-e' in prefix:
        index = argv.index('-e')
        argv[index] = '--'
    os.execv('/usr/bin/python3', ['/usr/bin/python3', str(ROOT / 'native/terminal.py'), '--server', SERVER, *argv])


if __name__ == '__main__':
    main()
