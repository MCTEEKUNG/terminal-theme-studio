# Ubuntu / Studio Terminal and Ptyxis

## Use Studio Terminal as the main terminal

Run `bun run install:ubuntu` once from this checkout. It installs a **Terminal**
application-menu icon, a `~/.local/bin/studio-terminal` launcher, and
the `terminal-theme-studio.service` systemd user service. The service starts
with the graphical session and serves the editor at <http://localhost:5555/>.
The launcher also starts it on demand if it is stopped. No manual dev server
is needed for normal use. Keep this checkout in place, or reinstall after
moving it.

The main app uses the standard Ubuntu terminal icon and the display name
**Terminal**, so searching `ter` finds it. Ptyxis stays installed as
**Terminal (Ptyxis)** through a per-user desktop-entry override, keeping it
available as a fallback. Internal app IDs and default-terminal selection do
not depend on the display name.

The installer chooses `com.themestudio.Terminal.desktop` through Ubuntu's
`xdg-terminal-exec` configuration for this account. Ubuntu's existing
Ctrl+Alt+T shortcut uses that default. Commands, titles, working directories
and hold-after-command behavior are advertised in the desktop entry. This
does not change the legacy system-wide `/usr/bin/x-terminal-emulator`
alternative, which some older applications hard-code.

Useful commands:

```bash
~/.local/bin/studio-terminal                       # add a tab / open the app
~/.local/bin/studio-terminal --new-window          # separate window
~/.local/bin/studio-terminal --working-directory ~/Documents
~/.local/bin/studio-terminal --hold -- bash -c 'echo hello'
systemctl --user status terminal-theme-studio
journalctl --user -u terminal-theme-studio
```

Each tab has its own PTY and shell. New tabs inherit the selected tab's current
directory. Use **Ctrl+Shift+T** for a new tab, **Ctrl+Shift+W** or a middle mouse click on a tab to close it,
**Ctrl+PageUp/PageDown** or **Alt+1…9** to switch, **Ctrl+Shift+C/V** to copy/paste,
and **F11** for fullscreen. Tabs can be reordered by dragging.

Closing a tab or window checks foreground, background, stopped and directly
executed processes. If work is active, the default response is **Keep
Running**. Confirming closes the selected session and sends a normal hangup;
detached `nohup`/`setsid` processes retain their usual behavior. Completed
commands close their tab unless launched with `--hold`.

The controller and native GUI run in separate systemd scopes when opened
from the editor. Restarting the controller does not terminate native shells.
The GUI reconnects automatically and retains the last background while offline.

Original default-terminal preferences are saved under
`.desktop-integration-backup/original.json`. To restore the original default
without removing Studio Terminal, run:

```bash
python3 native/install.py --restore-default
```

This restores those preference files to their pre-installation contents.
For development with Vite, stop the installed controller first to free port
5555, then run `bun run dev`. Resume normal use with
`systemctl --user start terminal-theme-studio` after stopping the dev server.

## Existing Ptyxis integration

On Linux, when neither `WT_SETTINGS_PATH` nor `LOCALAPPDATA` is set, the
server applies settings to the default Ptyxis profile through GSettings.
Run `bun run dev` as your desktop user in the GNOME session. Ptyxis,
GSettings and dconf must be installed and the session bus must be accessible.

- Theme colors and background opacity apply to the default profile.
- Font family, size and weight apply globally to Ptyxis. Missing fonts use
  a monospace fallback.
- Ptyxis does not provide GIF/video backgrounds. Use **Open Studio Terminal**
  in the editor for a native GTK/VTE terminal with a real shell and animated
  backgrounds. The existing Ptyxis integration remains available for colors,
  fonts and opacity.
- Custom palettes live in `$XDG_DATA_HOME/org.gnome.Ptyxis/palettes/`
  (normally `~/.local/share/org.gnome.Ptyxis/palettes/`). Two palette files
  alternate to refresh colors in an open terminal.
- `/api/terminal` reports the selected backend and the last sync status.
  Windows Terminal configuration still uses `WT_SETTINGS_PATH` or
  `LOCALAPPDATA`. The local JSON file remains the saved editor state on Linux.

The first sync saves the existing Ptyxis dconf values to
`.ptyxis-backup/original.dconf` without overwriting an existing backup.
To restore the original configuration, stop the studio server, then run from
the project directory:

```bash
dconf reset -f /org/gnome/Ptyxis/
dconf load /org/gnome/Ptyxis/ < .ptyxis-backup/original.dconf
```

The reset also removes any Ptyxis preference changes made since that backup.
Studio palette files can be removed after restoring the configuration.

## Native Studio Terminal

After installation, open the application icon, use `bun run terminal`, or click
**Open Studio Terminal** in the editor. It opens the current user's shell in
the caller's working directory, with normal PTY behavior, resizing and scrollback.
The gear button in the native header opens Theme Studio settings.

The native window follows the editor and playlist at roughly 400ms intervals.
Videos play directly from their original files through GStreamer, muted and
looping. GIFs animate through GdkPixbuf. Background opacity, alignment,
stretch mode, colors, fonts and unfocused opacity update while the shell stays
open. Playlist pause stops clip advancement; the displayed clip keeps looping.
The glass effect applies to Studio Terminal, without adding backgrounds inside Ptyxis windows.

The title bar, tabs and terminal backing use a coordinated translucent tint
with subtle highlights. **Background Opacity** controls this tint. Video/GIF
and text are not blurred or faded as a whole window. On GNOME, actual backdrop
frosting is supplied by **Blur my Shell**, restricted to the Terminal WM classes.
Its application opacity stays at 255 so it never fades text or the clip.
**Opacity & Transparency → Glass Blur** changes the GNOME backdrop strength live
from 0 (off) to 60. The independent `glassBlur` setting is persisted with the theme
and restored by the controller on login; it never changes the video filter or
application opacity. The panel reports compositor configuration errors.

Tabs and window controls share one compact, flat title bar with no separate title/subtitle row. Tabs use rounded glass styling and can be dragged to reorder. Right-click a tab (or focus its label and press
Shift+F10) to rename it, restore its automatic shell title, or close it. Custom
names remain local to that tab until it closes. Empty names restore automatic
naming. The web Opacity panel also controls tab roundness, top bar height, tab spacing,
and status-bar visibility. Existing windows apply these settings on the next state
poll (about 400 ms), preserving shell PIDs and running jobs. Errors stay visible
even when the normal status bar is hidden. `native/appearance.css` is reloaded
within one second when edited; invalid CSS retains the last working stylesheet
and reports an error through native status. Window appearance is data-driven;
Python behavior changes still require one restart. Older native instances must
close and reopen once to load this live-appearance support. The web status card
identifies those instances. Controller restarts do not interrupt their shells.

The previous `backgroundImageBlur` value is ignored: it must not soften the clip.

This machine has Blur my Shell 75 installed from extensions.gnome.org with
application blur enabled, initial sigma 16, brightness 1, dynamic opacity disabled,
and the whitelist `com.themestudio.Terminal`, `StudioTerminal`, `studio-terminal`
and `terminal.py` (the WM class used by already-open older instances).
All other extension components have blur disabled. Original extension settings
and the enabled-extension list are saved in `.desktop-integration-backup/`.
Disable only this effect with `gnome-extensions disable blur-my-shell@aunetx`.
New machines need that GNOME extension in addition to the native dependencies.

The native window reads settings from the local server. Shell input is handled
inside VTE and is never exposed through HTTP or WebSockets. It keeps its shell
and last background running if the server disconnects and reconnects when the
server returns. Runtime status and errors are under `.native-runtime/`.

Required Ubuntu packages (already available on this machine):

```bash
sudo apt install python3-gi python3-gi-cairo gir1.2-gtk-3.0 gir1.2-vte-2.91 \
  gir1.2-gstreamer-1.0 gstreamer1.0-plugins-base gstreamer1.0-plugins-good \
  gstreamer1.0-libav
```

Verify shell input/output, live settings, video looping, GIF animation and
media-error recovery with
`xvfb-run -a python3 -m unittest native/test_terminal.py native/test_cli.py`.
The tests also cover independent tabs, actual close-dialog cancellation,
busy-job detection, single-instance forwarding, command quoting, caller PATH,
working directories and new windows. They need `ffmpeg`, `xvfb` and
`dbus-run-session` in addition to the runtime packages.

Animation performance: native playback defaults to 24 fps, adjustable under
Terminal appearance → Background frame rate (12–60). Frames are dropped before
CPU color conversion and scaling, audio/text decoding is disabled, and only the
media rectangle is invalidated. Hidden tabs pause their pipeline. Unchanged
chrome CSS and fonts are retained. Web previews resolve playlist GIF caches to
the original video and pause videos when offscreen or in a hidden browser tab.

Live layout: close-button size and shape are editable in the web Terminal
appearance section. GTK alignment is applied to existing widgets on every style
update instead of being fixed at construction. `native/appearance.json` holds
the default close-button size, shape and alignment; both it and `appearance.css`
are watched while the app runs. Invalid layout/CSS keeps the last working
appearance. These appearance edits preserve shells and running processes.
Python behavior changes are distinct from appearance configuration changes.

### Web-controlled appearance

All appearance controls on the web apply to open windows: palette/ANSI colors,
cursor and selection colors, terminal font, transparency and GNOME glass, media
placement/opacity/frame rate, tabs, close buttons, toolbar spacing and text,
hover/selection highlights, status text and window-control styling.

`src/lib/appearance.ts` is the numeric control catalogue shared by the inspector,
preview, validation and native stylesheet renderer. `lib/live-appearance.ts`
updates a marked block in `native/appearance.css` and the close-button alignment
in `native/appearance.json`. It preserves hand-authored styles outside that block,
uses atomic file replacement and skips writes for playlist-only changes. The
existing GTK file watcher applies the generated styles without replacing windows,
VTE widgets or shell processes. `/api/appearance` reports style errors and runtime
status. Restarting only the Bun controller is safe while shells run.

The content inset surrounds the terminal canvas and status area; VTE retains its
base internal text inset. Extra status padding is in addition to its base margins.
Actual minimum heights/widths also depend on the selected font and button sizes.
The web preview is sample output, while the open native window remains the source
of truth for GTK font metrics and compositor glass.

For future appearance work, add data to this catalogue and live stylesheet/layout
path instead of setting new visual properties only in widget constructors.
Behavior changes to Python are a separate kind of update, not an appearance
setting; arbitrary Python code is never executed from web settings.

### Play full videos in a playlist

In Background → Playlist → Switch to next clip, choose **Play full video — then next clip**.
This global option applies to existing and newly imported videos. Their manual durations
are preserved and become active again when choosing **After a set duration**. Images
and GIFs always use their individual durations. Conversion no longer overwrites a
user's manual duration with the source length.

Native playback advances on GStreamer EOS. A per-playback token rejects duplicate
or stale notifications from multiple tabs/windows. Repeat-one restarts the same
video after EOS. The controller uses cached ffprobe duration metadata when there is
no compatible running native player, so already-open older terminals still work
without being terminated. When a compatible native window opens, it takes over EOS
handling automatically. If it closes, duration scheduling resumes. Probing is
asynchronous, timeout-limited, and invalidated if a source file changes.
