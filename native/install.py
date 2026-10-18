#!/usr/bin/python3
"""Install the per-user desktop app/controller and optionally choose it as default."""
import argparse
import base64
import json
import os
import re
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parent.parent
HOME = Path.home()
CONFIG = Path(os.environ.get('XDG_CONFIG_HOME', HOME / '.config'))
DATA = Path(os.environ.get('XDG_DATA_HOME', HOME / '.local/share'))
BACKUP = ROOT / '.desktop-integration-backup'
ENTRY = 'com.themestudio.Terminal.desktop'


def fallback_entry(contents):
    """Rename only the entry's main display name, preserving its launch actions."""
    output = []
    main_section = False
    for line in contents.splitlines():
        if line.startswith('['):
            main_section = line == '[Desktop Entry]'
        if main_section and re.match(r'^Name(?:\[[^]]+\])?=', line):
            continue
        output.append(line)
        if line == '[Desktop Entry]':
            output.append('Name=Terminal (Ptyxis)')
    return '\n'.join(output) + '\n'


def run(*args):
    return subprocess.check_output(args, text=True).strip()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--make-default', action='store_true')
    parser.add_argument('--restore-default', action='store_true')
    args = parser.parse_args()
    BACKUP.mkdir(exist_ok=True)
    manifest_path = BACKUP / 'original.json'
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {'files': {}, 'settings': {}}

    def save():
        manifest_path.write_text(json.dumps(manifest, indent=2))

    def backup(path):
        key = str(path)
        if key not in manifest['files']:
            manifest['files'][key] = {'existed': path.exists(), 'data': base64.b64encode(path.read_bytes()).decode() if path.exists() else ''}
            save()

    default_paths = [CONFIG / name for name in ('xdg-terminals.list', 'ubuntu-xdg-terminals.list', 'gnome-xdg-terminals.list')]
    schema = 'org.gnome.desktop.default-applications.terminal'
    if args.restore_default:
        for path in default_paths:
            original = manifest['files'].get(str(path))
            if original:
                if original['existed']:
                    path.write_bytes(base64.b64decode(original['data']))
                else:
                    path.unlink(missing_ok=True)
        for key, value in manifest['settings'].items():
            subprocess.run(['gsettings', 'set', schema, key, value], check=True)
        print('Original Ubuntu default-terminal preference restored.')
        return

    bun = shutil.which('bun')
    if not bun:
        raise SystemExit('Bun is required. Run this installer in the project environment.')
    subprocess.run([bun, 'run', 'build'], cwd=ROOT, check=True)
    launcher = HOME / '.local/bin/studio-terminal'
    launcher.parent.mkdir(parents=True, exist_ok=True)
    if launcher.is_symlink() and launcher.resolve() == ROOT / 'native/launch.py':
        pass
    elif launcher.exists() or launcher.is_symlink():
        raise SystemExit(f'Refusing to overwrite unrelated launcher: {launcher}')
    else:
        launcher.symlink_to(ROOT / 'native/launch.py')
    (ROOT / 'native/launch.py').chmod(0o755)

    icon = DATA / 'icons/hicolor/scalable/apps/com.themestudio.Terminal.svg'
    desktop = DATA / 'applications' / ENTRY
    service = CONFIG / 'systemd/user/terminal-theme-studio.service'
    for target in (icon, desktop, service):
        target.parent.mkdir(parents=True, exist_ok=True)
        backup(target)
    shutil.copyfile(ROOT / 'native/com.themestudio.Terminal.svg', icon)
    desktop.write_text(f'''[Desktop Entry]
Type=Application
Name=Terminal
GenericName=Terminal Emulator
Comment=Ubuntu terminal with animated backgrounds and live themes
Exec="{launcher}" --new-window
TryExec={launcher}
Icon=org.gnome.Ptyxis
Terminal=false
StartupNotify=true
StartupWMClass=StudioTerminal
Categories=System;TerminalEmulator;
Keywords=terminal;shell;bash;theme;video;
Actions=new-window;new-tab;settings;
X-TerminalArgExec=--
X-ExecArg=--
X-TerminalArgTitle=--title
X-TerminalArgDir=--working-directory
X-TerminalArgHold=--hold

[Desktop Action new-window]
Name=New Window
Exec="{launcher}" --new-window

[Desktop Action new-tab]
Name=New Tab
Exec="{launcher}"

[Desktop Action settings]
Name=Theme Settings
Exec="{launcher}" --settings
''')
    original_entry = Path('/usr/share/applications/org.gnome.Ptyxis.desktop')
    if original_entry.exists():
        fallback = DATA / 'applications/org.gnome.Ptyxis.desktop'
        backup(fallback)
        source = fallback.read_text() if fallback.exists() else original_entry.read_text()
        fallback.write_text(fallback_entry(source))
    # All files remain in this checkout; do not move it without reinstalling.
    service.write_text(f'''[Unit]
Description=Studio Terminal theme and playlist controller
PartOf=graphical-session.target
After=graphical-session-pre.target

[Service]
Type=simple
WorkingDirectory={ROOT}
Environment=PORT=5555
ExecStart="{bun}" "{ROOT / 'server.ts'}"
Restart=on-failure
RestartSec=2
TimeoutStopSec=15

[Install]
WantedBy=graphical-session.target
''')
    subprocess.run(['desktop-file-validate', str(desktop)], check=True)
    subprocess.run(['update-desktop-database', str(DATA / 'applications')], check=True)
    variables = [name for name in ('DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'XDG_CURRENT_DESKTOP', 'PATH') if name in os.environ]
    if variables:
        subprocess.run(['systemctl', '--user', 'import-environment', *variables], check=True)
    subprocess.run(['systemctl', '--user', 'daemon-reload'], check=True)
    subprocess.run(['systemctl', '--user', 'enable', 'terminal-theme-studio.service'], check=True)
    subprocess.run(['systemctl', '--user', 'restart', 'terminal-theme-studio.service'], check=True)

    if args.make_default:
        for path in default_paths:
            backup(path)
            previous = path.read_text() if path.exists() else ''
            other_entries = [line for line in previous.splitlines() if line.strip() != ENTRY]
            path.write_text(ENTRY + '\n' + '\n'.join(other_entries) + ('\n' if other_entries else ''))
        for key, value in (('exec', 'xdg-terminal-exec'), ('exec-arg', '--')):
            if key not in manifest['settings']:
                manifest['settings'][key] = run('gsettings', 'get', schema, key)
                save()
            subprocess.run(['gsettings', 'set', schema, key, value], check=True)
        selected = run('xdg-terminal-exec', '--print-id')
        if selected.split(':')[0] != ENTRY:
            raise SystemExit(f'Default selection did not apply: {selected}')
        print('Ubuntu default terminal:', selected)
    print('Desktop launcher:', desktop)
    print('Controller: systemctl --user status terminal-theme-studio')


if __name__ == '__main__':
    main()
