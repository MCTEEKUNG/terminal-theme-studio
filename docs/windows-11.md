# Windows 11

## Start and stop

Run `start-windows.cmd` (double-click or PowerShell). It uses Windows PowerShell 5.1, finds Bun on PATH, installs dependencies/builds the UI when absent, builds the Rust worker when needed, and starts a hidden local controller. Install Rust stable with Cargo and the Windows C++ build tools before the first build (see [quick start](../README.md#windows-11-quick-start)). Normal launches need no Python, GTK or WSL.

```powershell
.\start-windows.cmd
.\start-windows.cmd -Stop
# Use a different port if 5555 is busy:
.\start-windows.cmd -Port 5556
.\start-windows.cmd -Port 5556 -Stop
```

Closing the browser leaves playlist playback running. Stopping the controller stops playlist advancement, but does not close terminal sessions. Logs are in `.windows-runtime/server-<port>.log` and `.windows-runtime/server-<port>.err.log`. After updating source code, stop the controller, run `bun install` and `bun run build`, then start again.

## Settings selection

Windows Terminal must have an existing settings file. Open Terminal, go to Settings, and save once. Auto-detection checks these locations in order:

1. `%LOCALAPPDATA%\Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json`
2. `%LOCALAPPDATA%\Packages\Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe\LocalState\settings.json`
3. `%LOCALAPPDATA%\Microsoft\Windows Terminal\settings.json`

Choose Preview or a portable install explicitly if both versions are installed:

```powershell
.\start-windows.cmd -SettingsPath 'D:\Terminal portable\settings\settings.json'
# For a portable installation, set its executable before starting:
$env:WT_EXECUTABLE = 'D:\Terminal portable\wt.exe'
.\start-windows.cmd -SettingsPath 'D:\Terminal portable\settings\settings.json'
```

For development / direct backend launches, set `$env:WT_SETTINGS_PATH` to the absolute settings path. These environment variables and `-SettingsPath` apply to that launch; stop a running controller before changing targets. To use a custom target with the Start menu/autostart shortcut, set `WT_SETTINGS_PATH` (and `WT_EXECUTABLE` if needed) in your Windows user environment, then sign out/in. The **Use this look in your terminal** section shows the selected file and offers **Open Windows Terminal** (`wt.exe`, or `wtp.exe` for Preview).

The controller preserves JSONC comments, BOM, trailing commas and unrelated settings. Missing `profiles.defaults` and `schemes` are handled. Numeric font weights and light/dark color-scheme pairs are supported (the preview displays the dark variant). Invalid JSON is reported instead of being replaced. A directory watcher follows changes even when Windows Terminal atomically replaces its file.

## Appearance and backgrounds

Settings apply to `profiles.defaults`; they affect profiles that inherit those properties. If a PowerShell, cmd or WSL profile already defines `colorScheme`, `font`, `opacity` or `backgroundImage`, reset that property in Terminal's per-profile Appearance page to inherit it. Studio preserves those overrides. Windows Terminal manages its own tabs, keyboard shortcuts and shell sessions.

For acrylic, enable Windows **Settings > Accessibility > Visual effects > Transparency effects**, enable **Use Acrylic** in Studio, and lower opacity below 100%. Blur strength is controlled by Windows. The web preview is an approximation, not a shell.

Paste File Explorer's **Copy as path** into Background or the playlist folder field. PNG/JPG/BMP/GIF backgrounds work without FFmpeg. Video conversion and duration detection require both `ffmpeg.exe` and `ffprobe.exe` on PATH (provided by `Gyan.FFmpeg.Essentials`). Reopen the launcher after installing them. GIF conversion reduces quality/frame rate and can create large files for long videos; the generated files live in `.playlist-cache/`, leaving source videos in place. Full-video mode on Windows advances on the detected source duration, rather than a player end event.

### Isolated Collections

**Save current look** stores the full appearance, active color schemes, Single/Playlist mode, folder path, clips, timing/playback options, playing/paused state, and default/per-clip quality. Applying a Collection replaces those values together and synchronizes every open Studio tab. Timers, queued/running conversions and pending edits from the previous Collection are cancelled; late requests are rejected. Single mode never auto-converts inactive playlist clips or advances its timer. Refresh existing browser tabs after upgrading to load the new Collection-aware controls.

Collections saved before this feature contain appearance only. At startup, a legacy Collection whose saved background matches a video in `playlist.json.pre-collections.bak` recovers that playlist and folder, paused at the matching clip. Other legacy Collections open in **Single**, with an empty playlist and default quality (12 FPS / 640px). Before the first upgrade, existing `themes.json`, `playlist.json`, and `conversion-settings.json` are preserved as `*.pre-collections.bak`; source media and cached GIFs are retained. Switching Single ↔ Playlist within a Collection retains its clips/folder and restores the Single background when returning.

### GIF frame rate and resolution

In **Background**, paste a **File path** for Single mode, or enter a **Folder path** and click **Load clips** in Playlist mode. **Default FPS** applies to all playlist videos: **Original** or **12, 15, 24, 30, 60 FPS**. Expand the size control for **Original size** or **480, 640, 960, 1280, 1920px** width; height follows the source aspect ratio. Changed videos are prepared automatically, with a progress indicator while work is pending, and the current background updates when its new GIF is ready. Initial defaults are 12 FPS / 640px.

Switching back to a prepared FPS/width reuses the existing file without encoding or duplicating it. Source changes or missing outputs invalidate that variant; **Prepare** appears for a single video when its output needs rebuilding. Legacy playlist GIFs are inspected and adopted when their source and quality can be verified. Older standalone GIFs with no source mapping need the original video path pasted once. Generated files and metadata live in `.playlist-cache/`; different sources and quality choices have separate paths.

The dependency-free Rust worker orchestrates FFmpeg/FFprobe, cancels unfinished jobs, and uses two passes to avoid buffering an entire scaled clip during palette generation. FFmpeg still performs native encoding; first-time preparation depends on clip length, FPS, resolution, and hardware. Repeated requests share in-flight work or reuse validated cached files.

**Original FPS** omits frame-rate resampling; **Original resolution** omits resizing. GIF still uses a 256-color palette and hundredths-of-a-second frame delays, so some source frame rates are rounded by the GIF encoder/player. Higher FPS/resolution increases file size and playback load.

## Shortcuts and sign-in startup

```powershell
bun run install:windows
bun run install:windows -- -AutoStart
# Remove the Start menu and sign-in shortcuts:
bun run install:windows -- -Uninstall
```

These are per-user shortcuts, not elevated scheduled tasks. The sign-in shortcut starts the controller without opening a browser. Keep the checkout in place; reinstall the shortcuts if you move it. Uninstalling shortcuts does not stop a running controller or delete themes/settings.

## Restore the original settings

Stop the controller, then copy its first-write backup over the selected settings file:

```powershell
.\start-windows.cmd -Stop
$settings = "$env:LOCALAPPDATA\Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json"
Copy-Item -LiteralPath "$settings.theme-studio.bak" -Destination $settings
```

The backup captures the file before Studio's first edit and is never overwritten. Restoring it also restores that point in time, including other settings changed since then.

## Development and checks

```powershell
bun install
bun run dev
bun run test
bun run typecheck
bun run build
```

Development uses Vite on 127.0.0.1:5555 and the backend on 127.0.0.1:3001. Stop the production controller first to free port 5555. Tests use temporary settings/data files and exercise comments/backups, file replacement events, GIF caching, Collection recovery, playlists and paths containing spaces/Thai characters. Rust, FFmpeg and FFprobe must be installed for the media checks. `bun run test` builds the worker before testing; before direct `bun test`, run `bun run build:worker`. Native GTK/VTE Python tests are Ubuntu-only. CI runs the TypeScript tests, typecheck and build on `windows-latest` (a Windows Server runner, not a Windows 11 desktop).

`bun run dev` remains the development command. For normal use, `start-windows.cmd -Port 5556` opens the production build on port 5556; after source changes, run `bun run build` and restart that controller (`start-windows.cmd -Port 5556 -Stop`, then start it again). If 5555 is occupied by another checkout, stop that checkout's server before running `bun run dev`.
