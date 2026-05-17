# Optimize CPU and RAM — Design

**Date:** 2026-05-17
**Scope:** Targeted hotspot fixes in dev mode (`bun run dev`). No new dependencies, no architecture changes.

## Goal

Reduce CPU and RAM during normal use of `terminal-theme-studio` (slider drags, theme switching, video background paths) without changing the user-facing feature set. Each change is independently revertible.

## Cost Surfaces Identified

1. **Server-side ffmpeg processes are not cancelled.** `BackgroundPanel` debounces requests by 800ms client-side, but if the user types a video path with pauses longer than 800ms between characters, each request spawns a real ffmpeg subprocess. The client-side `AbortController` only closes the HTTP connection — `Bun.spawn` keeps running. Multiple concurrent ffmpeg processes are the largest avoidable CPU spike. (`server.ts:163`, `BackgroundPanel.tsx:51`)

2. **`TerminalPreview` re-renders fully on every keystroke and slider tick.** `useSettings.patch` calls `setSettings(...)` synchronously on every input event and only debounces the network write. The preview rebuilds every inline style object and re-runs `darken()` on each render. Slider drags produce ~60 full re-renders per second. (`useSettings.ts:48-69`, `TerminalPreview.tsx`)

3. **Disk roundtrip per PATCH on server.** Every PATCH reads `settings.json`, parses it, merges, stringifies, and writes. With slider drags driving frequent PATCHes (debounced 150ms), this is a stream of disk reads + JSON parses that the in-memory cache can eliminate. (`server.ts:75-95`)

4. **Looping `<video>` element keeps decoding when conversion fails or is pending.** If ffmpeg is missing or conversion fails, the original video stays in the DOM with `autoPlay loop`, decoding continuously. Even when conversion succeeds, the video element briefly autoplays while ffmpeg is also reading the file. (`TerminalPreview.tsx:100-107`)

5. **Dead code.** `hexToRgba` in `TerminalPreview.tsx:195` is never called. `ColorsPanel.tsx` is not in `Sidebar.NAV_ITEMS` and not imported anywhere — unreachable.

## Changes

### Change 1 — Cancel in-flight ffmpeg on new request (`server.ts`)

- Maintain a single active `Bun.Subprocess` reference at module scope.
- On a new `POST /api/convert-gif`: if a previous subprocess is still running, call `proc.kill()` before spawning the new one.
- Detect client disconnect via `req.signal` and kill the subprocess on abort.
- Write ffmpeg output to a temp file (e.g. `<target>.tmp.gif`) and rename to the final path only on exit code 0, so killed processes never leave partial GIFs.

**Why:** Eliminates concurrent ffmpeg processes — the largest CPU spike in normal interactive use.

### Change 2 — Memoize `TerminalPreview` and derive styles once

- Wrap `TerminalPreview` in `React.memo`. Its only prop is `settings`; React.memo's default shallow compare is sufficient because `useSettings.patch` produces a new top-level reference only when settings actually change.
- Move all derived values (`bg`, `fg`, `green`, `brightGreen`, `blue`, `yellow`, `red`, `cyan`, `brightBlack`, `cursorColor`, `titleBg`, `fontSize`, `fontFamily`, `stretchSize`, `objectFit`, `alignment`, `bodyStyle`, `opacity`, `bgImage`, `bgImageOpacity`) into a single `useMemo` keyed on `settings`.
- Keep the small `<Prompt>` subcomponent as-is — it's already a stable function reference.

**Why:** Currently each slider tick re-creates every inline style object (different reference identity → React re-applies styles to every DOM node). Memoization stabilizes references and skips the work entirely when settings haven't changed.

### Change 3 — In-memory settings cache on server (`server.ts`)

- Read settings once at startup; keep in a module-scope `let cachedSettings: WTSettings`.
- `readSettings()` returns the cache.
- `writeSettings(next)` updates cache, then writes file.
- `fs.watch` callback re-reads from disk (existing 200ms debounce stays) to handle edits made by external editors / Windows Terminal itself.
- `skipWsRef` pattern on the client already handles the round-trip echo.

**Why:** Eliminates one disk read + JSON parse per PATCH. Small files, but each settings save during a slider drag avoids the syscall.

### Change 4 — Don't render `<video>` for the background

- Since video paths are auto-converted to GIF and `backgroundImage` is rewritten to the `.gif` path on success, the `<video>` element only appears transiently (during conversion) or persistently (when conversion fails / ffmpeg is missing).
- Remove the `<video>` branch from `TerminalPreview.tsx` entirely. When `bgImage` is a video path (i.e. not yet converted), render no media layer — fall through to the solid scheme background. Once `BackgroundPanel`'s conversion succeeds and rewrites `bgImage` to a `.gif`, the existing image branch renders it.
- The conversion status badge in `BackgroundPanel` already communicates the state to the user; no additional UI needed.

**Why:** Background video decoding is expensive and redundant — the converted GIF replaces it on success, and on failure the user shouldn't be paying for a continuously decoding video they can't use.

### Change 5 — Remove dead code

- Delete `hexToRgba` from `TerminalPreview.tsx` (unused — verified by grep).
- Delete `src/components/panels/ColorsPanel.tsx`. Verify it's not imported anywhere in `src/` before deletion.

**Why:** Less code to load, parse, and reason about. Cleanup, not perf, but in scope for "best quality."

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Killing in-flight ffmpeg leaves partial GIF files | Write to `<target>.tmp.gif`, rename to final path only on exit 0. Clean up tmp on kill. |
| `useMemo` dep list goes stale and preview shows wrong colors | Depend on the whole `settings` object — same change cadence as today, no risk of missing a key. |
| Server cache diverges from disk if an external editor writes between our `writeSettings` and `fs.watch` firing | `fs.watch` always re-reads to repopulate the cache within the existing 200ms debounce window. Acceptable; this is the same window where the client would have shown stale data anyway. |
| Removing `<video>` removes the ability to "just play a video as background" without GIF conversion | Acceptable — the app's contract is GIF conversion; this is documented in the BackgroundPanel help text. |
| `ColorsPanel` was intentionally hidden for future use | Check `git log -- src/components/panels/ColorsPanel.tsx` before deletion. If recent intentional work, leave it and just note in summary. |

## Testing

**Automated:**
- `bun test src/lib/settings.test.ts` — must still pass.

**Manual verification:**
- Drag the Window Opacity slider while React DevTools Profiler is open — confirm `TerminalPreview` does not re-render on every tick.
- Paste a video path in BackgroundPanel, then immediately replace it with a different video path. Run `tasklist /fi "imagename eq ffmpeg.exe"` (Windows) and confirm at most one ffmpeg process at a time.
- Paste a PNG / GIF path — confirm preview renders correctly (regression check).
- Click a preset theme — confirm preview updates immediately.
- Edit `settings.json` in another editor — confirm preview picks up the change (WS watcher still works).

## Out of Scope

- Production build optimization (user confirmed dev mode only)
- ColorsPanel revival or rewrite
- Sidebar's stale `activeThemeName` indicator
- Server input validation hardening
- Vite config changes
