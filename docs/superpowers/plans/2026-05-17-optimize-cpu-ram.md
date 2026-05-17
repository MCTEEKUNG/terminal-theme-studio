# Optimize CPU and RAM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce CPU and RAM in `bun run dev` by eliminating four concrete hotspots (uncancelled ffmpeg, unmemoized preview re-renders, per-PATCH disk reads, redundant video decoding) and one dead-code item.

**Architecture:** Five independent, surgical changes. Three server-side (`server.ts`), two client-side (`useSettings.ts`, `TerminalPreview.tsx`). No new dependencies. Each task ends with a commit so any single change is independently revertible.

**Tech Stack:** Bun (server + test runner), Vite + React 18 (client), TypeScript strict mode.

**Spec:** `docs/superpowers/specs/2026-05-17-optimize-cpu-ram-design.md`

**Decision noted during planning:** The spec's Change 5 originally proposed deleting `src/components/panels/ColorsPanel.tsx`. Verification shows it was added in commit `0ee0ff7` as a deliberate, fully-implemented panel that simply isn't wired into `Sidebar.NAV_ITEMS` yet — likely in-progress. Per the spec's risk-mitigation guidance, this plan does **not** delete `ColorsPanel.tsx`. Only `hexToRgba` in `TerminalPreview.tsx` is removed.

---

## File Map

- `server.ts` — Tasks 1, 3 (ffmpeg cancellation + settings cache)
- `src/components/TerminalPreview.tsx` — Tasks 2, 4, 5 (memo + style memoization, drop `<video>` branch, remove `hexToRgba`)
- `src/lib/settings.test.ts` — Task 3 (existing tests must still pass; no new tests added here)

No new files are created.

---

## Task 1: Cancel in-flight ffmpeg on new request

**Files:**
- Modify: `server.ts` (handler for `POST /api/convert-gif`, lines ~149-186)

**What this does:** Keeps a module-level reference to the current ffmpeg subprocess. A new request kills the previous one before spawning. Client disconnect (via `req.signal`) also kills it. ffmpeg writes to a `.tmp.gif` first, renamed on success — so killed processes never leave half-written GIFs.

- [ ] **Step 1: Update the `fs` import**

At the top of `server.ts`, change:

```ts
import { readFileSync, writeFileSync, existsSync, watch } from 'fs'
```

to:

```ts
import { readFileSync, writeFileSync, existsSync, watch, unlinkSync, renameSync } from 'fs'
```

- [ ] **Step 2: Add module-level state for the active subprocess**

Just after the `clients` set declaration (around line 21), add:

```ts
let activeFfmpeg: { proc: import('bun').Subprocess; tmpPath: string } | null = null

function killActiveFfmpeg(): void {
  if (!activeFfmpeg) return
  try { activeFfmpeg.proc.kill() } catch {}
  try {
    if (existsSync(activeFfmpeg.tmpPath)) unlinkSync(activeFfmpeg.tmpPath)
  } catch {}
  activeFfmpeg = null
}
```

- [ ] **Step 3: Rewrite the `/api/convert-gif` handler to use cancellation and temp file**

Find the existing block in `server.ts`:

```ts
if (method === 'POST' && pathname === '/api/convert-gif') {
  ...
}
```

Replace its entire body with this version (the outer `if` line stays the same):

```ts
  if (method === 'POST' && pathname === '/api/convert-gif') {
    let body: { path: string }
    try { body = await req.json() } catch { return json({ error: 'invalid body' }, 400) }

    const videoPath = body.path?.trim()
    if (!videoPath) return json({ error: 'path required' }, 400)
    if (!existsSync(videoPath)) return json({ error: 'file not found' }, 404)
    if (!/\.(mp4|webm|ogg|mov|avi|mkv)$/i.test(videoPath)) {
      return json({ error: 'not a video file' }, 400)
    }

    const gifPath = videoPath.replace(/\.[^.]+$/, '.gif')
    const tmpPath = `${gifPath}.tmp`

    // Cancel any in-flight conversion before starting a new one
    killActiveFfmpeg()

    try {
      const proc = Bun.spawn([
        'ffmpeg', '-y', '-i', videoPath,
        '-vf', 'fps=12,scale=640:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=256[p];[s1][p]paletteuse=dither=bayer',
        '-loop', '0',
        tmpPath,
      ], { stderr: 'pipe' })

      activeFfmpeg = { proc, tmpPath }

      // Kill if the client disconnects
      const onAbort = () => killActiveFfmpeg()
      req.signal.addEventListener('abort', onAbort)

      // Drain stderr concurrently — ffmpeg is verbose and will deadlock if the
      // pipe buffer fills while we're blocking on proc.exited.
      const stderrPromise = new Response(proc.stderr).text().catch(() => '')
      const exitCode = await proc.exited

      req.signal.removeEventListener('abort', onAbort)

      // If we were superseded or aborted, activeFfmpeg has changed or is null
      const wasCurrent = activeFfmpeg?.proc === proc
      if (wasCurrent) activeFfmpeg = null

      if (exitCode !== 0) {
        if (existsSync(tmpPath)) { try { unlinkSync(tmpPath) } catch {} }
        // If we were cancelled, don't return an error response — the client
        // already moved on, and req.signal.aborted will be true.
        if (req.signal.aborted) return new Response(null, { status: 499 })
        const detail = await stderrPromise
        return json({ error: 'ffmpeg failed', detail }, 500)
      }

      // Atomic rename to final path
      try {
        if (existsSync(gifPath)) unlinkSync(gifPath)
        renameSync(tmpPath, gifPath)
      } catch (err) {
        return json({ error: 'rename failed', detail: String(err) }, 500)
      }

      return json({ gifPath })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('ENOENT') || msg.toLowerCase().includes('not found')) {
        return json({ error: 'ffmpeg_missing' }, 503)
      }
      return json({ error: 'conversion failed', detail: msg }, 500)
    }
  }
```

- [ ] **Step 4: Type-check and start the server to smoke-test**

Run from project root:

```
bun x tsc --noEmit
```

Expected: no errors.

Then start the dev server in one terminal:

```
bun server.ts
```

Expected: `Server running at http://localhost:3001`. Leave it running for the next step.

- [ ] **Step 5: Manual verification — single ffmpeg at a time**

Pre-req: ffmpeg installed on PATH; have any short `.mp4` file at e.g. `C:\Users\ASUS\Videos\sample.mp4`.

In a second terminal, fire two requests back-to-back (the second should kill the first):

```
curl -X POST http://localhost:3001/api/convert-gif -H "Content-Type: application/json" -d "{\"path\":\"C:\\\\Users\\\\ASUS\\\\Videos\\\\sample.mp4\"}" &
curl -X POST http://localhost:3001/api/convert-gif -H "Content-Type: application/json" -d "{\"path\":\"C:\\\\Users\\\\ASUS\\\\Videos\\\\sample.mp4\"}"
```

In a third terminal, immediately run:

```
tasklist /fi "imagename eq ffmpeg.exe"
```

Expected: At most one `ffmpeg.exe` row at any moment. The first curl returns `499` (or a closed-connection error from curl); the second returns `{ "gifPath": "..." }`.

Verify no `.tmp` files were left behind:

```
dir "C:\Users\ASUS\Videos\*.tmp"
```

Expected: `File Not Found`.

- [ ] **Step 6: Commit**

Stop the server (Ctrl-C). Then:

```
git add server.ts
git commit -m "perf(server): cancel in-flight ffmpeg on new convert request"
```

---

## Task 2: Memoize TerminalPreview and derive styles once

**Files:**
- Modify: `src/components/TerminalPreview.tsx`

**What this does:** Wraps the component in `React.memo` so it skips re-renders when the `settings` reference hasn't changed. Moves derived values into a single `useMemo` so style object identities are stable, avoiding DOM style reapplication.

- [ ] **Step 1: Add imports for `memo` and `useMemo`**

At the top of `src/components/TerminalPreview.tsx`, change the React import from:

```ts
import type { CSSProperties } from 'react'
```

to:

```ts
import { memo, useMemo, type CSSProperties } from 'react'
```

- [ ] **Step 2: Refactor `TerminalPreview` body to use `useMemo` and wrap with `memo`**

Replace the entire `export function TerminalPreview(...)` declaration with the version below. Keep the helper functions (`alignmentToCss`, `darken`, the `Prompt` component) above it. The function is renamed to a non-exported `TerminalPreviewInner` and a wrapped export is added at the bottom:

```ts
function TerminalPreviewInner({ settings }: Props) {
  const d = settings.profiles.defaults
  const scheme = getActiveScheme(settings)

  const view = useMemo(() => {
    const font = d.font ?? { face: 'Cascadia Code', size: 12 }
    const opacity = (d.opacity ?? 100) / 100
    const bgImage = d.backgroundImage || null
    const bgImageOpacity = d.backgroundImageOpacity ?? 1

    const bg = scheme?.background ?? '#0d1117'
    const fg = scheme?.foreground ?? '#e6edf3'
    const green = scheme?.green ?? '#3fb950'
    const brightGreen = scheme?.brightGreen ?? '#56d364'
    const blue = scheme?.blue ?? '#58a6ff'
    const yellow = scheme?.yellow ?? '#d29922'
    const red = scheme?.red ?? '#ff7b72'
    const cyan = scheme?.cyan ?? '#39c5cf'
    const brightBlack = scheme?.brightBlack ?? '#6e7681'
    const cursorColor = scheme?.cursorColor ?? blue

    const titleBg = darken(bg, 0.18)
    const fontSize = Math.min((font as { face: string; size: number }).size, 12)
    const fontFamily = `'${font.face}', 'Cascadia Code', Consolas, 'Courier New', monospace`

    const stretchSize =
      d.backgroundImageStretchMode === 'fill' ? '100% 100%'
      : d.backgroundImageStretchMode === 'uniform' ? 'contain'
      : d.backgroundImageStretchMode === 'none' ? 'auto'
      : 'cover'

    const objectFit: CSSProperties['objectFit'] =
      d.backgroundImageStretchMode === 'fill' ? 'fill'
      : d.backgroundImageStretchMode === 'uniform' ? 'contain'
      : d.backgroundImageStretchMode === 'none' ? 'none'
      : 'cover'

    const alignment = alignmentToCss(d.backgroundImageAlignment)

    const bodyStyle: CSSProperties = {
      backgroundColor: bg,
      color: fg,
      fontFamily,
      fontSize,
      opacity,
      position: 'relative',
      overflow: 'hidden',
    }

    return {
      bg, fg, green, brightGreen, blue, yellow, red, cyan, brightBlack, cursorColor,
      titleBg, bgImage, bgImageOpacity, stretchSize, objectFit, alignment, bodyStyle,
    }
  }, [settings])

  const {
    bg, fg, green, brightGreen, blue, yellow, red, cyan, brightBlack, cursorColor,
    titleBg, bgImage, bgImageOpacity, stretchSize, objectFit, alignment, bodyStyle,
  } = view

  return (
    <div className="terminal-preview">
      <div className="preview-label">Live Preview</div>

      <div className="wt-window">
        <div className="desktop-bg" />

        <div className="wt-titlebar" style={{ background: titleBg }}>
          <div className="wt-tabstrip">
            <div className="wt-tab" style={{ background: bg, color: fg }}>
              <span className="wt-tab-icon" style={{ color: brightBlack }}>❯_</span>
              PowerShell
            </div>
            <span className="wt-newtab" style={{ color: brightBlack }}>+</span>
          </div>
          <div className="wt-wincontrols">
            <span className="wt-ctrl">─</span>
            <span className="wt-ctrl">□</span>
            <span className="wt-ctrl wt-close">✕</span>
          </div>
        </div>

        <div className="wt-body" style={bodyStyle}>
          {bgImage && !isVideo(bgImage) && (
            <div
              className="wt-bg-media"
              style={{
                backgroundImage: `url('${fileUrl(bgImage)}')`,
                backgroundSize: stretchSize,
                backgroundPosition: alignment,
                backgroundRepeat: 'no-repeat',
                opacity: bgImageOpacity,
              }}
            />
          )}

          <div className="wt-content">
            <div className="tl" style={{ color: brightBlack }}>Windows PowerShell</div>
            <div className="tl" style={{ color: brightBlack, marginBottom: 6 }}>
              Copyright (C) Microsoft Corporation.
            </div>

            <div className="tl">
              <Prompt blue={blue} green={green} fg={fg} />
              <span style={{ color: cyan }}>git status</span>
            </div>
            <div className="tl" style={{ color: green }}>On branch main</div>
            <div className="tl" style={{ color: fg, opacity: 0.75 }}>Changes not staged for commit:</div>
            <div className="tl">
              <span style={{ color: brightBlack }}>        modified:   </span>
              <span style={{ color: red }}>src/App.tsx</span>
            </div>
            <div className="tl" style={{ marginBottom: 6 }}>
              <span style={{ color: brightBlack }}>        modified:   </span>
              <span style={{ color: red }}>src/index.css</span>
            </div>

            <div className="tl">
              <Prompt blue={blue} green={green} fg={fg} />
              <span style={{ color: cyan }}>ls .</span>
            </div>
            <div className="tl tl-row" style={{ gap: 20, marginBottom: 6 }}>
              <span style={{ color: blue }}>Documents</span>
              <span style={{ color: blue }}>Downloads</span>
              <span style={{ color: blue }}>Desktop</span>
              <span style={{ color: brightGreen }}>Projects</span>
              <span style={{ color: yellow }}>README.md</span>
            </div>

            <div className="tl">
              <Prompt blue={blue} green={green} fg={fg} />
              <span
                style={{
                  background: cursorColor,
                  color: bg,
                  padding: '0 1px',
                  animation: 'blink 1.2s step-end infinite',
                }}
              >
                █
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export const TerminalPreview = memo(TerminalPreviewInner)
```

Notes:
- The `<video>` branch has been deliberately removed in this step (covers Task 4 as part of the same edit, since the same lines are touched). If you'd rather split, keep the video branch here and remove it in Task 4 instead. This plan removes it now.
- `_` for unused `stretchSize` / `objectFit` / `alignment` would be a TypeScript hint; they're still passed into image-branch styles, so leave them.
- The `objectFit` and `alignment` vars are now only used by the image branch — that's fine; the memo computes them unconditionally for code simplicity.

- [ ] **Step 3: Type-check**

```
bun x tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run existing tests**

```
bun test
```

Expected: existing `settings.test.ts` suite passes (no behavior changes here).

- [ ] **Step 5: Manual verification — render churn**

Start the app:

```
bun run dev
```

Open `http://localhost:5555` in Chrome. Install React DevTools extension if not already installed. Open the **Profiler** tab in DevTools, click record, drag the Window Opacity slider for ~2 seconds, stop recording.

Expected: `TerminalPreview` (the memoized one) shows as **rendering only when settings shape actually changes** (i.e. essentially each PATCH cycle, not per drag-event). The unmemoized version before this change re-rendered on every event.

Also confirm visually: opacity slider still updates the preview, all colors still apply, font changes still apply, image background paths still render.

- [ ] **Step 6: Commit**

```
git add src/components/TerminalPreview.tsx
git commit -m "perf(preview): memoize TerminalPreview and stabilize style refs"
```

---

## Task 3: In-memory settings cache on server

**Files:**
- Modify: `server.ts` (the `readSettings` / `writeSettings` / `watch` block, lines ~23-50)

**What this does:** Eliminates one disk read + JSON parse per PATCH. The `fs.watch` debounce still handles external edits by re-reading and broadcasting.

- [ ] **Step 1: Add cached state and rewrite read/write helpers**

In `server.ts`, find this block:

```ts
function readSettings(): WTSettings {
  return JSON.parse(readFileSync(WT_SETTINGS_PATH, 'utf-8'))
}

function writeSettings(settings: WTSettings): void {
  writeFileSync(WT_SETTINGS_PATH, JSON.stringify(settings, null, 4), 'utf-8')
}
```

Replace it with:

```ts
let cachedSettings: WTSettings = JSON.parse(readFileSync(WT_SETTINGS_PATH, 'utf-8'))

function readSettings(): WTSettings {
  return cachedSettings
}

function writeSettings(settings: WTSettings): void {
  cachedSettings = settings
  writeFileSync(WT_SETTINGS_PATH, JSON.stringify(settings, null, 4), 'utf-8')
}

function reloadSettingsFromDisk(): void {
  try {
    cachedSettings = JSON.parse(readFileSync(WT_SETTINGS_PATH, 'utf-8'))
  } catch {}
}
```

- [ ] **Step 2: Update the `fs.watch` callback to refresh the cache**

Find:

```ts
let watchDebounce: ReturnType<typeof setTimeout> | null = null
watch(WT_SETTINGS_PATH, () => {
  if (watchDebounce) clearTimeout(watchDebounce)
  watchDebounce = setTimeout(() => {
    try {
      const settings = readSettings()
      const msg = JSON.stringify({ type: 'settings-update', settings })
      clients.forEach(ws => ws.send(msg))
    } catch {}
  }, 200)
})
```

Replace with:

```ts
let watchDebounce: ReturnType<typeof setTimeout> | null = null
watch(WT_SETTINGS_PATH, () => {
  if (watchDebounce) clearTimeout(watchDebounce)
  watchDebounce = setTimeout(() => {
    reloadSettingsFromDisk()
    try {
      const msg = JSON.stringify({ type: 'settings-update', settings: cachedSettings })
      clients.forEach(ws => ws.send(msg))
    } catch {}
  }, 200)
})
```

- [ ] **Step 3: Type-check**

```
bun x tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run existing tests**

```
bun test
```

Expected: pass (the settings cache is in `server.ts`, not in `src/lib/settings.ts`, so the unit tests are unaffected).

- [ ] **Step 5: Manual verification — cache stays consistent**

Start the dev server: `bun run dev`. Open `http://localhost:5555`.

1. Drag a slider in the OpacityPanel. Confirm the preview updates immediately (cache write).
2. Reload the page. Confirm the slider value persisted (disk write happened).
3. Open `%LOCALAPPDATA%\Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json` in a text editor, change the `opacity` value to something distinct (e.g., `42`), save. Within ~250ms, the slider in the app should jump to 42 (cache reloaded via `fs.watch`).

- [ ] **Step 6: Commit**

```
git add server.ts
git commit -m "perf(server): cache settings in-memory; avoid disk read per PATCH"
```

---

## Task 4: Remove `hexToRgba` dead code

**Files:**
- Modify: `src/components/TerminalPreview.tsx`

**What this does:** Removes the unused `hexToRgba` function. This is the only remaining piece of "Change 5" from the spec — `ColorsPanel.tsx` is being kept (see plan header).

Note: If Task 2's edit already touched the bottom of this file, this task may be trivial.

- [ ] **Step 1: Delete the function**

In `src/components/TerminalPreview.tsx`, find and delete this entire function (it's at the bottom of the file):

```ts
function hexToRgba(hex: string, alpha: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
```

- [ ] **Step 2: Confirm no references exist**

Run from project root (PowerShell):

```
Select-String -Path "src/**/*.ts","src/**/*.tsx" -Pattern "hexToRgba"
```

Expected: no matches.

- [ ] **Step 3: Type-check and test**

```
bun x tsc --noEmit
bun test
```

Expected: both clean.

- [ ] **Step 4: Commit**

```
git add src/components/TerminalPreview.tsx
git commit -m "chore: remove unused hexToRgba helper"
```

---

## Task 5: Final verification pass

**Files:** none modified.

- [ ] **Step 1: Full type-check + test**

```
bun x tsc --noEmit
bun test
```

Expected: both clean.

- [ ] **Step 2: End-to-end smoke**

Start `bun run dev`, open `http://localhost:5555`.

Walk through every panel:
1. **Themes** — click each preset, confirm preview updates.
2. **Opacity** — drag both sliders, toggle acrylic, confirm preview reflects changes.
3. **Font** — type a font name, change size, change weight.
4. **Background** — paste a PNG path, confirm preview renders. Paste a video path, confirm conversion runs and the path auto-updates to `.gif`.

Watch Task Manager → Details → look for `ffmpeg.exe`: should appear briefly, disappear when done. No lingering processes after closing the app.

- [ ] **Step 3: Confirm git log is clean**

```
git log --oneline -6
```

Expected (most recent first):
- `chore: remove unused hexToRgba helper`
- `perf(server): cache settings in-memory; avoid disk read per PATCH`
- `perf(preview): memoize TerminalPreview and stabilize style refs`
- `perf(server): cancel in-flight ffmpeg on new convert request`
- `docs: spec for CPU/RAM optimization pass`
- (prior commit)

---

## Spec Coverage Check

| Spec section | Plan task |
|---|---|
| Change 1: cancel in-flight ffmpeg | Task 1 |
| Change 2: memoize TerminalPreview | Task 2 |
| Change 3: in-memory settings cache | Task 3 |
| Change 4: drop `<video>` branch | Task 2 (folded into the same file edit) |
| Change 5: remove dead code (`hexToRgba`) | Task 4 |
| Change 5: delete `ColorsPanel.tsx` | **Deliberately skipped** — see plan header; recent in-progress feature |
| Testing — existing tests pass | Task 5 step 1 |
| Testing — slider profiler check | Task 2 step 5 |
| Testing — single ffmpeg at a time | Task 1 step 4 |
| Testing — image/preset regression | Task 5 step 2 |
