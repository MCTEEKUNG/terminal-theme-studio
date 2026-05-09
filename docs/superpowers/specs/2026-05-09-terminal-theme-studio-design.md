# Terminal Theme Studio — Design Spec

**Date:** 2026-05-09
**Status:** Approved

## Overview

A local web app for customizing Windows Terminal themes in real time. Changes are written instantly to Windows Terminal's `settings.json` so the terminal hot-reloads as you tweak. Named theme presets can be saved and switched between.

## Stack

- **Runtime:** Bun
- **Backend:** Bun HTTP server (`server.ts`) on port `3001`
- **Frontend:** React + Vite on port `3000` (Vite proxies `/api` and `/ws` to `3001`)
- **Start command:** `bun run dev` — runs Vite dev server and `bun server.ts` concurrently via a `dev` script in `package.json` using `concurrently`

## Architecture

```
React (Vite:3000) <--REST + WebSocket--> Bun server (3001) <--file I/O--> settings.json
                                                                        \--> themes.json
```

**Data flow for a change:**
1. User moves a slider / picks a color
2. React updates local state immediately
3. `useSettings` hook debounces 150ms then calls `PATCH /api/settings`
4. Bun server merges the patch into `settings.json` and writes it
5. Windows Terminal detects the file change and hot-reloads

**External change sync:**
- Bun watches `settings.json` with `fs.watch`
- On change, broadcasts updated settings over WebSocket `/ws`
- `useSettings` applies the update to React state

## API

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/settings` | Read current `settings.json` |
| `PATCH` | `/api/settings` | Merge partial update into `settings.json` |
| `GET` | `/api/themes` | List saved named themes |
| `POST` | `/api/themes` | Save current settings as a named theme |
| `DELETE` | `/api/themes/:name` | Delete a saved theme |
| `POST` | `/api/themes/:name/apply` | Apply a saved theme to `settings.json` |
| `WS` | `/ws` | Push external `settings.json` changes to browser |

## Settings.json Target Properties

All writes go to `profiles.defaults` (applies to all profiles) plus the `schemes` array for color schemes.

**Opacity:**
- `opacity` (integer 0–100) — window background opacity
- `useAcrylic` (boolean) — enable acrylic blur (OS-controlled intensity, no separate slider)
- `unfocusedAppearance.opacity` (integer 0–100) — opacity when window is unfocused

**Colors:**
- A named entry in `schemes[]` with: `name`, `background`, `foreground`, `cursorColor`, `selectionBackground`, plus 16 ANSI colors (`black`, `red`, `green`, `yellow`, `blue`, `purple`, `cyan`, `white`, and their `bright*` variants)
- `colorScheme` in `profiles.defaults` references the active scheme by name
- Editing a built-in scheme creates a copy named `"Custom"` before modifying; editing a user scheme modifies it in-place

**Font:**
- `font.face` (string) — font family name
- `font.size` (number) — point size
- `font.weight` (string) — `"normal"` | `"bold"` | `"thin"` | `"light"` | `"semi-light"` | `"semi-bold"` | `"extra-light"` | `"extra-bold"`

**Background Image:**
- `backgroundImage` (string) — file path or URL
- `backgroundImageOpacity` (float 0.0–1.0)
- `backgroundImageStretchMode` — `"none"` | `"fill"` | `"uniform"` | `"uniformToFill"`
- `backgroundImageAlignment` — `"center"` | `"topLeft"` | `"topRight"` | `"bottomLeft"` | `"bottomRight"` | `"top"` | `"bottom"` | `"left"` | `"right"`

## UI Layout

Sidebar + Panel layout. Three zones:

### Sidebar (160px, fixed)
- App title at top
- Category navigation: Opacity · Colors · Font · Background (icons + labels)
- Bottom section: saved themes list, "Save Current" button

### Main Panel (flex:1)
- Section heading matching active category
- Category-specific controls (sliders, toggles, color pickers, inputs)
- Controls write to `useSettings` on every change

### Terminal Preview (160px height, bottom strip)
- Fake terminal rendered in the browser using styled divs
- Updates reactively as settings change (background color, opacity, font face/size, background image)
- Labeled "Live Preview"

## Component Structure

```
terminal-theme-studio/
├── server.ts
├── src/
│   ├── App.tsx                      # Layout shell, active panel routing
│   ├── components/
│   │   ├── Sidebar.tsx              # Nav items + theme preset list
│   │   ├── panels/
│   │   │   ├── OpacityPanel.tsx     # opacity, useAcrylic, unfocusedOpacity sliders
│   │   │   ├── ColorsPanel.tsx      # color scheme editor (16 ANSI + fg/bg/cursor)
│   │   │   ├── FontPanel.tsx        # font face text input (type name), size slider, weight select
│   │   │   └── BackgroundPanel.tsx  # file picker, opacity slider, stretch/align selects
│   │   └── TerminalPreview.tsx      # Live styled fake terminal
│   ├── hooks/
│   │   └── useSettings.ts           # State, debounced PATCH, WebSocket sync
│   └── types.ts                     # WindowsTerminalSettings, ColorScheme, FontSettings types
├── themes.json                      # Saved named presets (gitignored or committed — user choice)
├── package.json
└── vite.config.ts                   # Proxy /api and /ws to :3001
```

## Theme Presets

`themes.json` is an array of objects:
```json
[
  {
    "name": "Dark Blue",
    "savedAt": "2026-05-09T10:00:00Z",
    "settings": {
      "defaults": { "opacity": 80, "useAcrylic": true, "colorScheme": "Dark Blue", "font": { "face": "Cascadia Code", "size": 12, "weight": "normal" }, "backgroundImage": null, "backgroundImageOpacity": 1.0 },
      "scheme": { "name": "Dark Blue", "background": "#0d1117", "foreground": "#e6edf3", ... }
    }
  }
]
```

Saving: user clicks "Save Current" → inline text input appears in the sidebar → user types name → Enter confirms → POSTs to `/api/themes`.
Applying: POSTs to `/api/themes/:name/apply` which merges the snapshot back into `settings.json`.
Deleting: DELETEs `/api/themes/:name`.

## Windows Terminal Settings.json Path

`%LOCALAPPDATA%\Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json`

The server resolves this path at startup using `process.env.LOCALAPPDATA`.

## Error Handling

- If `settings.json` is not found at startup, server logs a clear error with the expected path and exits
- If a PATCH produces invalid JSON, the server rejects it with 400 (never writes partial/broken JSON)
- If `themes.json` doesn't exist yet, it is created on first save
- WebSocket reconnects automatically on the frontend (exponential backoff, max 5s)
