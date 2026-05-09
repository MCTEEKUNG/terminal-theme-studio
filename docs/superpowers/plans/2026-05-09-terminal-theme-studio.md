# Terminal Theme Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Bun + React web app that edits Windows Terminal's `settings.json` in real time with a sidebar + panel UI, live terminal preview, and named theme presets.

**Architecture:** A Bun HTTP server on port 3001 reads/writes `settings.json` and `themes.json`; a React + Vite frontend on port 3000 calls it via REST and stays in sync via WebSocket. Changes are debounced 150ms then patched to the file, which Windows Terminal hot-reloads instantly.

**Tech Stack:** Bun, React 18, TypeScript, Vite 5, concurrently

---

## File Map

| File | Responsibility |
|------|---------------|
| `package.json` | Scripts: `dev` runs server + Vite concurrently |
| `vite.config.ts` | Proxy `/api` and `/ws` to `:3001` |
| `tsconfig.json` | TypeScript config |
| `index.html` | Vite entry |
| `server.ts` | Bun HTTP server — settings + themes API + WebSocket |
| `src/types.ts` | WTSettings, ColorScheme, ProfileDefaults, SavedTheme |
| `src/lib/settings.ts` | Pure fns: mergeDefaults, upsertScheme, getActiveScheme, isBuiltInScheme |
| `src/lib/settings.test.ts` | Bun tests for settings.ts |
| `src/hooks/useSettings.ts` | Fetch settings, optimistic patch, WS sync |
| `src/hooks/useThemes.ts` | Fetch/save/apply/delete themes |
| `src/index.css` | Global dark theme styles |
| `src/main.tsx` | React entry point |
| `src/App.tsx` | Layout shell — routes active panel, wires hooks |
| `src/components/Sidebar.tsx` | Category nav + theme preset list |
| `src/components/panels/OpacityPanel.tsx` | opacity, useAcrylic, unfocused opacity |
| `src/components/panels/ColorsPanel.tsx` | Active scheme, 20 color pickers |
| `src/components/panels/FontPanel.tsx` | Font face, size, weight |
| `src/components/panels/BackgroundPanel.tsx` | Image path, opacity, stretch, alignment |
| `src/components/TerminalPreview.tsx` | Fake terminal preview, live styles |

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/main.tsx`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "terminal-theme-studio",
  "version": "1.0.0",
  "scripts": {
    "dev": "concurrently \"bun server.ts\" \"vite\"",
    "build": "vite build"
  },
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "concurrently": "^8.2.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
cd C:\Users\ASUS\terminal-theme-studio
bun install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create vite.config.ts**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:3001',
      '/ws': { target: 'ws://localhost:3001', ws: true }
    }
  }
})
```

- [ ] **Step 5: Create index.html**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Terminal Theme Studio</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create src/main.tsx**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
```

- [ ] **Step 7: Commit**

```bash
git init
git add package.json tsconfig.json vite.config.ts index.html src/main.tsx bun.lockb
git commit -m "chore: scaffold Bun + React + Vite project"
```

---

## Task 2: TypeScript Types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Create src/types.ts**

```typescript
export interface ColorScheme {
  name: string
  background: string
  foreground: string
  cursorColor: string
  selectionBackground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  purple: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightPurple: string
  brightCyan: string
  brightWhite: string
}

export interface FontSettings {
  face: string
  size: number
  weight: 'normal' | 'bold' | 'thin' | 'light' | 'semi-light' | 'semi-bold' | 'extra-light' | 'extra-bold'
}

export interface ProfileDefaults {
  opacity?: number
  useAcrylic?: boolean
  unfocusedAppearance?: { opacity: number }
  colorScheme?: string
  font?: FontSettings
  backgroundImage?: string | null
  backgroundImageOpacity?: number
  backgroundImageStretchMode?: 'none' | 'fill' | 'uniform' | 'uniformToFill'
  backgroundImageAlignment?: 'center' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' | 'top' | 'bottom' | 'left' | 'right'
}

export interface WTSettings {
  $schema?: string
  $help?: string
  profiles: {
    defaults: ProfileDefaults
    list: unknown[]
  }
  schemes: ColorScheme[]
  [key: string]: unknown
}

export interface SavedTheme {
  name: string
  savedAt: string
  settings: {
    defaults: ProfileDefaults
    scheme: ColorScheme | undefined
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat: add Windows Terminal settings TypeScript types"
```

---

## Task 3: Settings Utilities + Tests

**Files:**
- Create: `src/lib/settings.ts`
- Create: `src/lib/settings.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/settings.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test'
import { mergeDefaults, upsertScheme, getActiveScheme, isBuiltInScheme } from './settings'
import type { WTSettings, ColorScheme } from '../types'

const baseScheme: ColorScheme = {
  name: 'Custom', background: '#0d1117', foreground: '#e6edf3',
  cursorColor: '#58a6ff', selectionBackground: '#264f78',
  black: '#0d1117', red: '#ff7b72', green: '#3fb950', yellow: '#d29922',
  blue: '#58a6ff', purple: '#bc8cff', cyan: '#39c5cf', white: '#b1bac4',
  brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364',
  brightYellow: '#e3b341', brightBlue: '#79c0ff', brightPurple: '#d2a8ff',
  brightCyan: '#56d4dd', brightWhite: '#f0f6fc'
}

const base: WTSettings = {
  profiles: { defaults: { opacity: 80, colorScheme: 'Custom' }, list: [] },
  schemes: [baseScheme]
}

describe('mergeDefaults', () => {
  it('merges patch into defaults', () => {
    const result = mergeDefaults(base, { opacity: 50 })
    expect(result.profiles.defaults.opacity).toBe(50)
    expect(result.profiles.defaults.colorScheme).toBe('Custom')
  })

  it('does not mutate original', () => {
    mergeDefaults(base, { opacity: 50 })
    expect(base.profiles.defaults.opacity).toBe(80)
  })
})

describe('upsertScheme', () => {
  it('updates existing scheme in-place', () => {
    const updated = { ...baseScheme, background: '#111111' }
    const result = upsertScheme(base, updated)
    expect(result.schemes[0].background).toBe('#111111')
    expect(result.schemes).toHaveLength(1)
  })

  it('appends new scheme', () => {
    const newScheme = { ...baseScheme, name: 'New' }
    const result = upsertScheme(base, newScheme)
    expect(result.schemes).toHaveLength(2)
    expect(result.schemes[1].name).toBe('New')
  })

  it('does not mutate original', () => {
    upsertScheme(base, { ...baseScheme, background: '#111111' })
    expect(base.schemes[0].background).toBe('#0d1117')
  })
})

describe('getActiveScheme', () => {
  it('returns scheme matching colorScheme name', () => {
    const result = getActiveScheme(base)
    expect(result?.name).toBe('Custom')
  })

  it('returns undefined when no match', () => {
    const noMatch = { ...base, profiles: { ...base.profiles, defaults: { colorScheme: 'Missing' } } }
    expect(getActiveScheme(noMatch)).toBeUndefined()
  })
})

describe('isBuiltInScheme', () => {
  it('returns true for Campbell', () => expect(isBuiltInScheme('Campbell')).toBe(true))
  it('returns true for One Half Dark', () => expect(isBuiltInScheme('One Half Dark')).toBe(true))
  it('returns false for custom name', () => expect(isBuiltInScheme('My Theme')).toBe(false))
})
```

- [ ] **Step 2: Run tests — expect failure**

```bash
bun test src/lib/settings.test.ts
```

Expected: Error — `Cannot find module './settings'`

- [ ] **Step 3: Implement src/lib/settings.ts**

```typescript
import type { WTSettings, ColorScheme, ProfileDefaults } from '../types'

const BUILT_IN_SCHEMES = new Set([
  'Campbell', 'Campbell Powershell', 'Vintage',
  'One Half Dark', 'One Half Light',
  'Solarized Dark', 'Solarized Light',
  'Tango Dark', 'Tango Light'
])

export function mergeDefaults(settings: WTSettings, patch: Partial<ProfileDefaults>): WTSettings {
  return {
    ...settings,
    profiles: {
      ...settings.profiles,
      defaults: { ...settings.profiles.defaults, ...patch }
    }
  }
}

export function upsertScheme(settings: WTSettings, scheme: ColorScheme): WTSettings {
  const idx = settings.schemes.findIndex(s => s.name === scheme.name)
  const schemes = idx >= 0
    ? settings.schemes.map((s, i) => i === idx ? scheme : s)
    : [...settings.schemes, scheme]
  return { ...settings, schemes }
}

export function getActiveScheme(settings: WTSettings): ColorScheme | undefined {
  const name = settings.profiles.defaults.colorScheme
  return settings.schemes.find(s => s.name === name)
}

export function isBuiltInScheme(name: string): boolean {
  return BUILT_IN_SCHEMES.has(name)
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
bun test src/lib/settings.test.ts
```

Expected: All 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/settings.ts src/lib/settings.test.ts
git commit -m "feat: settings utility functions with tests"
```

---

## Task 4: Bun Server

**Files:**
- Create: `server.ts`

- [ ] **Step 1: Create server.ts**

```typescript
import { readFileSync, writeFileSync, existsSync, watch } from 'fs'
import path from 'path'
import type { WTSettings, SavedTheme, ColorScheme, ProfileDefaults } from './src/types'
import { mergeDefaults, upsertScheme } from './src/lib/settings'

const WT_SETTINGS_PATH = path.join(
  process.env.LOCALAPPDATA ?? '',
  'Packages',
  'Microsoft.WindowsTerminal_8wekyb3d8bbwe',
  'LocalState',
  'settings.json'
)

const THEMES_PATH = path.join(import.meta.dir, 'themes.json')

if (!existsSync(WT_SETTINGS_PATH)) {
  console.error(`Windows Terminal settings.json not found at:\n  ${WT_SETTINGS_PATH}`)
  process.exit(1)
}

const clients = new Set<import('bun').ServerWebSocket<unknown>>()

function readSettings(): WTSettings {
  return JSON.parse(readFileSync(WT_SETTINGS_PATH, 'utf-8'))
}

function writeSettings(settings: WTSettings): void {
  writeFileSync(WT_SETTINGS_PATH, JSON.stringify(settings, null, 4), 'utf-8')
}

function readThemes(): SavedTheme[] {
  if (!existsSync(THEMES_PATH)) return []
  return JSON.parse(readFileSync(THEMES_PATH, 'utf-8'))
}

function writeThemes(themes: SavedTheme[]): void {
  writeFileSync(THEMES_PATH, JSON.stringify(themes, null, 2), 'utf-8')
}

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

function addCors(headers: HeadersInit = {}): Headers {
  const h = new Headers(headers as Record<string, string>)
  h.set('Access-Control-Allow-Origin', '*')
  h.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  h.set('Access-Control-Allow-Headers', 'Content-Type')
  return h
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: addCors({ 'Content-Type': 'application/json' })
  })
}

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const { pathname, method } = { pathname: url.pathname, method: req.method }

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: addCors() })
  }

  if (method === 'GET' && pathname === '/api/settings') {
    return json(readSettings())
  }

  if (method === 'PATCH' && pathname === '/api/settings') {
    const body = await req.json() as { defaults?: Partial<ProfileDefaults>; scheme?: ColorScheme }
    let settings = readSettings()
    if (body.defaults) settings = mergeDefaults(settings, body.defaults)
    if (body.scheme) settings = upsertScheme(settings, body.scheme)
    writeSettings(settings)
    return json({ ok: true })
  }

  if (method === 'GET' && pathname === '/api/themes') {
    return json(readThemes())
  }

  if (method === 'POST' && pathname === '/api/themes') {
    const body = await req.json() as { name: string }
    if (!body.name?.trim()) return json({ error: 'name required' }, 400)
    const settings = readSettings()
    const schemeName = settings.profiles.defaults.colorScheme ?? ''
    const scheme = settings.schemes.find(s => s.name === schemeName)
    const theme: SavedTheme = {
      name: body.name.trim(),
      savedAt: new Date().toISOString(),
      settings: { defaults: settings.profiles.defaults, scheme }
    }
    const themes = readThemes().filter(t => t.name !== theme.name)
    writeThemes([...themes, theme])
    return json(theme, 201)
  }

  const deleteMatch = pathname.match(/^\/api\/themes\/([^/]+)$/)
  if (method === 'DELETE' && deleteMatch) {
    const name = decodeURIComponent(deleteMatch[1])
    writeThemes(readThemes().filter(t => t.name !== name))
    return json({ ok: true })
  }

  const applyMatch = pathname.match(/^\/api\/themes\/([^/]+)\/apply$/)
  if (method === 'POST' && applyMatch) {
    const name = decodeURIComponent(applyMatch[1])
    const theme = readThemes().find(t => t.name === name)
    if (!theme) return json({ error: 'theme not found' }, 404)
    let settings = readSettings()
    settings = mergeDefaults(settings, theme.settings.defaults)
    if (theme.settings.scheme) settings = upsertScheme(settings, theme.settings.scheme)
    writeSettings(settings)
    return json({ ok: true })
  }

  return new Response('Not Found', { status: 404, headers: addCors() })
}

const server = Bun.serve({
  port: 3001,
  fetch(req, server) {
    const url = new URL(req.url)
    if (url.pathname === '/ws') {
      if (server.upgrade(req)) return
      return new Response('WebSocket upgrade failed', { status: 400 })
    }
    return handleRequest(req)
  },
  websocket: {
    open(ws) { clients.add(ws) },
    close(ws) { clients.delete(ws) },
    message() {}
  }
})

console.log(`Server running at http://localhost:${server.port}`)
```

- [ ] **Step 2: Smoke test the server**

```bash
bun server.ts
```

Expected output: `Server running at http://localhost:3001`

Open a second terminal and run:
```bash
curl http://localhost:3001/api/settings
```

Expected: JSON dump of your Windows Terminal settings.json

- [ ] **Step 3: Commit**

```bash
git add server.ts
git commit -m "feat: Bun HTTP server with settings + themes API and WebSocket"
```

---

## Task 5: useSettings + useThemes Hooks

**Files:**
- Create: `src/hooks/useSettings.ts`
- Create: `src/hooks/useThemes.ts`

- [ ] **Step 1: Create src/hooks/useSettings.ts**

```typescript
import { useState, useEffect, useRef, useCallback } from 'react'
import type { WTSettings, ProfileDefaults, ColorScheme } from '../types'

const WS_URL = `ws://${location.host}/ws`

export function useSettings() {
  const [settings, setSettings] = useState<WTSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skipWsRef = useRef(false)

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(setSettings)
      .catch(() => setError('Cannot connect to server. Make sure you ran: bun run dev'))
  }, [])

  useEffect(() => {
    let ws: WebSocket
    let retryDelay = 1000

    function connect() {
      ws = new WebSocket(WS_URL)
      ws.onopen = () => { retryDelay = 1000 }
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data as string) as { type: string; settings: WTSettings }
        if (msg.type === 'settings-update' && !skipWsRef.current) {
          setSettings(msg.settings)
        }
        skipWsRef.current = false
      }
      ws.onclose = () => {
        retryDelay = Math.min(retryDelay * 2, 5000)
        setTimeout(connect, retryDelay)
      }
    }
    connect()
    return () => ws?.close()
  }, [])

  const patch = useCallback((body: { defaults?: Partial<ProfileDefaults>; scheme?: ColorScheme }) => {
    setSettings(prev => {
      if (!prev) return prev
      const next = { ...prev }
      if (body.defaults) {
        next.profiles = { ...prev.profiles, defaults: { ...prev.profiles.defaults, ...body.defaults } }
      }
      if (body.scheme) {
        const idx = prev.schemes.findIndex(s => s.name === body.scheme!.name)
        next.schemes = idx >= 0
          ? prev.schemes.map((s, i) => i === idx ? body.scheme! : s)
          : [...prev.schemes, body.scheme!]
      }
      return next
    })

    if (debounceRef.current) clearTimeout(debounceRef.current)
    skipWsRef.current = true
    debounceRef.current = setTimeout(() => {
      fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
    }, 150)
  }, [])

  return { settings, error, patch }
}
```

- [ ] **Step 2: Create src/hooks/useThemes.ts**

```typescript
import { useState, useEffect, useCallback } from 'react'
import type { SavedTheme } from '../types'

export function useThemes() {
  const [themes, setThemes] = useState<SavedTheme[]>([])

  const reload = useCallback(() => {
    fetch('/api/themes').then(r => r.json()).then(setThemes).catch(() => {})
  }, [])

  useEffect(() => { reload() }, [reload])

  const save = useCallback(async (name: string) => {
    await fetch('/api/themes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    })
    reload()
  }, [reload])

  const apply = useCallback(async (name: string) => {
    await fetch(`/api/themes/${encodeURIComponent(name)}/apply`, { method: 'POST' })
  }, [])

  const remove = useCallback(async (name: string) => {
    await fetch(`/api/themes/${encodeURIComponent(name)}`, { method: 'DELETE' })
    reload()
  }, [reload])

  return { themes, save, apply, remove }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useSettings.ts src/hooks/useThemes.ts
git commit -m "feat: useSettings and useThemes hooks"
```

---

## Task 6: Global Styles

**Files:**
- Create: `src/index.css`

- [ ] **Step 1: Create src/index.css**

```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg-base: #0d1117;
  --bg-surface: #161b22;
  --bg-elevated: #21262d;
  --border: #30363d;
  --text-primary: #e6edf3;
  --text-secondary: #8b949e;
  --accent: #58a6ff;
  --accent-dim: #1f6feb;
  --success: #3fb950;
  --danger: #f85149;
  --radius: 6px;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  background: var(--bg-base);
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.5;
  height: 100vh;
  overflow: hidden;
}

#root { height: 100vh; }

.app {
  display: flex;
  height: 100vh;
}

/* Sidebar */
.sidebar {
  width: 180px;
  flex-shrink: 0;
  background: var(--bg-surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
}

.sidebar-header {
  padding: 14px 12px;
  border-bottom: 1px solid var(--border);
  color: var(--accent);
  font-weight: 600;
  font-size: 14px;
}

.sidebar-nav {
  padding: 8px 6px;
  flex: 1;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: var(--radius);
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 12px;
  border: none;
  background: none;
  width: 100%;
  text-align: left;
  transition: background 0.1s, color 0.1s;
}

.nav-item:hover { background: var(--bg-elevated); color: var(--text-primary); }
.nav-item.active { background: var(--accent-dim); color: #fff; }

.sidebar-themes {
  border-top: 1px solid var(--border);
  padding: 8px 6px 10px;
}

.section-label {
  color: var(--text-secondary);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 0 6px;
  margin-bottom: 6px;
}

.theme-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 8px;
  border-radius: 4px;
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 11px;
  border: none;
  background: none;
  width: 100%;
  text-align: left;
}

.theme-item:hover { background: var(--bg-elevated); color: var(--text-primary); }

.theme-item.active-theme {
  background: rgba(31, 111, 235, 0.15);
  border: 1px solid rgba(88, 166, 255, 0.3);
  color: var(--accent);
}

.theme-delete {
  opacity: 0;
  background: none;
  border: none;
  color: var(--danger);
  cursor: pointer;
  font-size: 12px;
  padding: 0 2px;
  line-height: 1;
}

.theme-item:hover .theme-delete { opacity: 1; }

.save-theme-form { display: flex; gap: 4px; margin-top: 6px; }

.save-theme-input {
  flex: 1;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-primary);
  padding: 4px 8px;
  font-size: 11px;
  outline: none;
}

.save-theme-input:focus { border-color: var(--accent); }

.btn {
  padding: 5px 10px;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  font-size: 11px;
  font-weight: 500;
}

.btn-primary { background: #238636; color: #fff; }
.btn-primary:hover { background: #2ea043; }
.btn-save { background: var(--bg-elevated); border: 1px solid var(--border); color: var(--text-primary); width: 100%; margin-top: 6px; padding: 6px; }
.btn-save:hover { border-color: var(--accent); color: var(--accent); }

/* Main area */
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.panel-title {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 18px;
  color: var(--text-primary);
}

/* Controls */
.control-group { margin-bottom: 18px; }

.control-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--text-secondary);
  font-size: 11px;
  margin-bottom: 6px;
}

.control-value { color: var(--accent); font-weight: 500; }

.slider {
  width: 100%;
  height: 4px;
  appearance: none;
  background: var(--bg-elevated);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}

.slider::-webkit-slider-thumb {
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--accent);
  border: 2px solid var(--bg-base);
  cursor: pointer;
}

.toggle-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.toggle-info h4 { font-size: 12px; color: var(--text-primary); }
.toggle-info p { font-size: 11px; color: var(--text-secondary); }

.toggle {
  position: relative;
  width: 34px;
  height: 18px;
  flex-shrink: 0;
}

.toggle input { opacity: 0; width: 0; height: 0; }

.toggle-track {
  position: absolute;
  inset: 0;
  background: var(--bg-elevated);
  border-radius: 9px;
  cursor: pointer;
  transition: background 0.2s;
  border: 1px solid var(--border);
}

.toggle input:checked + .toggle-track { background: var(--accent-dim); border-color: var(--accent); }

.toggle-track::after {
  content: '';
  position: absolute;
  left: 2px;
  top: 50%;
  transform: translateY(-50%);
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--text-secondary);
  transition: left 0.2s, background 0.2s;
}

.toggle input:checked + .toggle-track::after { left: 18px; background: #fff; }

/* Color pickers */
.color-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.color-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.color-swatch {
  width: 28px;
  height: 28px;
  border-radius: 4px;
  border: 1px solid var(--border);
  cursor: pointer;
  padding: 0;
  overflow: hidden;
}

.color-swatch input[type="color"] {
  width: 140%;
  height: 140%;
  margin: -20%;
  border: none;
  cursor: pointer;
  padding: 0;
}

.color-name { font-size: 11px; color: var(--text-secondary); }

/* Font controls */
.text-input {
  width: 100%;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-primary);
  padding: 7px 10px;
  font-size: 12px;
  outline: none;
}

.text-input:focus { border-color: var(--accent); }

.select-input {
  width: 100%;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-primary);
  padding: 7px 10px;
  font-size: 12px;
  outline: none;
  cursor: pointer;
}

.select-input:focus { border-color: var(--accent); }

/* Terminal preview */
.terminal-preview {
  border-top: 1px solid var(--border);
  height: 170px;
  flex-shrink: 0;
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.preview-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
}

.terminal-window {
  flex: 1;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  padding: 10px 12px;
  font-size: 12px;
  line-height: 1.7;
  overflow: hidden;
  background-size: cover;
  background-position: center;
}

.terminal-line { white-space: pre; }

/* Loading / error */
.loading, .error {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  color: var(--text-secondary);
}

.error { color: var(--danger); }

/* ANSI color grid */
.ansi-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.scheme-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}

.scheme-name { font-size: 12px; color: var(--text-primary); font-weight: 500; }
.scheme-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 10px;
  background: var(--bg-elevated);
  color: var(--text-secondary);
  border: 1px solid var(--border);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/index.css
git commit -m "feat: dark theme global CSS"
```

---

## Task 7: App Shell

**Files:**
- Create: `src/App.tsx`

- [ ] **Step 1: Create src/App.tsx**

```tsx
import { useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { OpacityPanel } from './components/panels/OpacityPanel'
import { ColorsPanel } from './components/panels/ColorsPanel'
import { FontPanel } from './components/panels/FontPanel'
import { BackgroundPanel } from './components/panels/BackgroundPanel'
import { TerminalPreview } from './components/TerminalPreview'
import { useSettings } from './hooks/useSettings'
import { useThemes } from './hooks/useThemes'

export type ActivePanel = 'opacity' | 'colors' | 'font' | 'background'

export default function App() {
  const { settings, error, patch } = useSettings()
  const { themes, save, apply, remove } = useThemes()
  const [activePanel, setActivePanel] = useState<ActivePanel>('opacity')

  if (error) return <div className="error">{error}</div>
  if (!settings) return <div className="loading">Connecting to server...</div>

  return (
    <div className="app">
      <Sidebar
        activePanel={activePanel}
        onPanelChange={setActivePanel}
        themes={themes}
        onSave={save}
        onApply={apply}
        onDelete={remove}
      />
      <div className="main">
        <div className="panel">
          {activePanel === 'opacity' && <OpacityPanel settings={settings} onPatch={patch} />}
          {activePanel === 'colors' && <ColorsPanel settings={settings} onPatch={patch} />}
          {activePanel === 'font' && <FontPanel settings={settings} onPatch={patch} />}
          {activePanel === 'background' && <BackgroundPanel settings={settings} onPatch={patch} />}
        </div>
        <TerminalPreview settings={settings} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/App.tsx
git commit -m "feat: App shell with panel routing"
```

---

## Task 8: Sidebar

**Files:**
- Create: `src/components/Sidebar.tsx`

- [ ] **Step 1: Create src/components/Sidebar.tsx**

```tsx
import { useState } from 'react'
import type { ActivePanel } from '../App'
import type { SavedTheme } from '../types'

const NAV_ITEMS: { id: ActivePanel; label: string; icon: string }[] = [
  { id: 'opacity', label: 'Opacity', icon: '◈' },
  { id: 'colors', label: 'Colors', icon: '🎨' },
  { id: 'font', label: 'Font', icon: 'Aa' },
  { id: 'background', label: 'Background', icon: '🖼' }
]

interface Props {
  activePanel: ActivePanel
  onPanelChange: (panel: ActivePanel) => void
  themes: SavedTheme[]
  onSave: (name: string) => Promise<void>
  onApply: (name: string) => Promise<void>
  onDelete: (name: string) => Promise<void>
}

export function Sidebar({ activePanel, onPanelChange, themes, onSave, onApply, onDelete }: Props) {
  const [saving, setSaving] = useState(false)
  const [themeName, setThemeName] = useState('')

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!themeName.trim()) return
    await onSave(themeName.trim())
    setThemeName('')
    setSaving(false)
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header">⚡ Theme Studio</div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map(item => (
          <button
            key={item.id}
            className={`nav-item ${activePanel === item.id ? 'active' : ''}`}
            onClick={() => onPanelChange(item.id)}
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-themes">
        <div className="section-label">Saved Themes</div>

        {themes.length === 0 && (
          <div style={{ color: 'var(--text-secondary)', fontSize: 11, padding: '4px 6px' }}>
            No saved themes yet
          </div>
        )}

        {themes.map(theme => (
          <div key={theme.name} className="theme-item" onClick={() => onApply(theme.name)}>
            <span>{theme.name}</span>
            <button
              className="theme-delete"
              onClick={(e) => { e.stopPropagation(); onDelete(theme.name) }}
              title="Delete theme"
            >
              ×
            </button>
          </div>
        ))}

        {saving ? (
          <form className="save-theme-form" onSubmit={handleSave}>
            <input
              className="save-theme-input"
              autoFocus
              placeholder="Theme name..."
              value={themeName}
              onChange={e => setThemeName(e.target.value)}
              onKeyDown={e => e.key === 'Escape' && setSaving(false)}
            />
            <button type="submit" className="btn btn-primary">✓</button>
          </form>
        ) : (
          <button className="btn btn-save" onClick={() => setSaving(true)}>
            + Save Current
          </button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat: Sidebar with nav and theme preset management"
```

---

## Task 9: OpacityPanel

**Files:**
- Create: `src/components/panels/OpacityPanel.tsx`

- [ ] **Step 1: Create src/components/panels/OpacityPanel.tsx**

```tsx
import type { WTSettings, ProfileDefaults } from '../../types'

interface Props {
  settings: WTSettings
  onPatch: (body: { defaults: Partial<ProfileDefaults> }) => void
}

export function OpacityPanel({ settings, onPatch }: Props) {
  const d = settings.profiles.defaults
  const opacity = d.opacity ?? 100
  const useAcrylic = d.useAcrylic ?? false
  const unfocusedOpacity = d.unfocusedAppearance?.opacity ?? 100

  return (
    <div>
      <div className="panel-title">Opacity & Transparency</div>

      <div className="control-group">
        <div className="control-label">
          <span>Window Opacity</span>
          <span className="control-value">{opacity}%</span>
        </div>
        <input
          type="range" className="slider" min={10} max={100}
          value={opacity}
          onChange={e => onPatch({ defaults: { opacity: Number(e.target.value) } })}
        />
      </div>

      <div className="control-group">
        <div className="toggle-row">
          <div className="toggle-info">
            <h4>Use Acrylic (Blur)</h4>
            <p>Frosted glass effect — blur is OS-controlled</p>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={useAcrylic}
              onChange={e => onPatch({ defaults: { useAcrylic: e.target.checked } })}
            />
            <span className="toggle-track" />
          </label>
        </div>
      </div>

      <div className="control-group">
        <div className="control-label">
          <span>Unfocused Window Opacity</span>
          <span className="control-value">{unfocusedOpacity}%</span>
        </div>
        <input
          type="range" className="slider" min={10} max={100}
          value={unfocusedOpacity}
          onChange={e => onPatch({
            defaults: { unfocusedAppearance: { opacity: Number(e.target.value) } }
          })}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/panels/OpacityPanel.tsx
git commit -m "feat: OpacityPanel with opacity and acrylic controls"
```

---

## Task 10: ColorsPanel

**Files:**
- Create: `src/components/panels/ColorsPanel.tsx`

- [ ] **Step 1: Create src/components/panels/ColorsPanel.tsx**

```tsx
import type { WTSettings, ColorScheme, ProfileDefaults } from '../../types'
import { getActiveScheme, isBuiltInScheme } from '../../lib/settings'

interface Props {
  settings: WTSettings
  onPatch: (body: { defaults?: Partial<ProfileDefaults>; scheme?: ColorScheme }) => void
}

const BASIC_COLORS: { key: keyof ColorScheme; label: string }[] = [
  { key: 'background', label: 'Background' },
  { key: 'foreground', label: 'Foreground' },
  { key: 'cursorColor', label: 'Cursor' },
  { key: 'selectionBackground', label: 'Selection' }
]

const ANSI_COLORS: { key: keyof ColorScheme; label: string }[] = [
  { key: 'black', label: 'Black' }, { key: 'brightBlack', label: 'Bright Black' },
  { key: 'red', label: 'Red' }, { key: 'brightRed', label: 'Bright Red' },
  { key: 'green', label: 'Green' }, { key: 'brightGreen', label: 'Bright Green' },
  { key: 'yellow', label: 'Yellow' }, { key: 'brightYellow', label: 'Bright Yellow' },
  { key: 'blue', label: 'Blue' }, { key: 'brightBlue', label: 'Bright Blue' },
  { key: 'purple', label: 'Purple' }, { key: 'brightPurple', label: 'Bright Purple' },
  { key: 'cyan', label: 'Cyan' }, { key: 'brightCyan', label: 'Bright Cyan' },
  { key: 'white', label: 'White' }, { key: 'brightWhite', label: 'Bright White' }
]

function ColorPicker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="color-row">
      <div className="color-swatch">
        <input type="color" value={value || '#000000'} onChange={e => onChange(e.target.value)} />
      </div>
      <span className="color-name">{label}</span>
    </div>
  )
}

export function ColorsPanel({ settings, onPatch }: Props) {
  const activeScheme = getActiveScheme(settings)
  const schemeName = settings.profiles.defaults.colorScheme ?? ''
  const isBuiltIn = isBuiltInScheme(schemeName)

  function handleColorChange(key: keyof ColorScheme, value: string) {
    let scheme: ColorScheme

    if (isBuiltIn || !activeScheme) {
      // Copy built-in scheme to "Custom" before editing
      scheme = { ...(activeScheme ?? defaultScheme), name: 'Custom', [key]: value }
      onPatch({ scheme, defaults: { colorScheme: 'Custom' } })
    } else {
      scheme = { ...activeScheme, [key]: value }
      onPatch({ scheme })
    }
  }

  if (!activeScheme && settings.schemes.length === 0) {
    return (
      <div>
        <div className="panel-title">Colors</div>
        <p style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
          No color schemes found. Windows Terminal will use defaults.
        </p>
      </div>
    )
  }

  const scheme = activeScheme ?? defaultScheme

  return (
    <div>
      <div className="panel-title">Color Scheme</div>

      <div className="scheme-header">
        <span className="scheme-name">{schemeName || 'Default'}</span>
        {isBuiltIn && <span className="scheme-badge">built-in → will copy to "Custom"</span>}
      </div>

      <div className="control-group">
        <div className="control-label"><span>Terminal Colors</span></div>
        <div className="color-grid">
          {BASIC_COLORS.map(({ key, label }) => (
            <ColorPicker
              key={key}
              label={label}
              value={(scheme[key] as string) || '#000000'}
              onChange={v => handleColorChange(key, v)}
            />
          ))}
        </div>
      </div>

      <div className="control-group">
        <div className="control-label"><span>ANSI Colors</span></div>
        <div className="ansi-grid">
          {ANSI_COLORS.map(({ key, label }) => (
            <ColorPicker
              key={key}
              label={label}
              value={(scheme[key] as string) || '#000000'}
              onChange={v => handleColorChange(key, v)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

const defaultScheme: ColorScheme = {
  name: 'Custom', background: '#0d1117', foreground: '#e6edf3',
  cursorColor: '#58a6ff', selectionBackground: '#264f78',
  black: '#0d1117', red: '#ff7b72', green: '#3fb950', yellow: '#d29922',
  blue: '#58a6ff', purple: '#bc8cff', cyan: '#39c5cf', white: '#b1bac4',
  brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364',
  brightYellow: '#e3b341', brightBlue: '#79c0ff', brightPurple: '#d2a8ff',
  brightCyan: '#56d4dd', brightWhite: '#f0f6fc'
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/panels/ColorsPanel.tsx
git commit -m "feat: ColorsPanel with 20 color pickers and built-in scheme copy"
```

---

## Task 11: FontPanel

**Files:**
- Create: `src/components/panels/FontPanel.tsx`

- [ ] **Step 1: Create src/components/panels/FontPanel.tsx**

```tsx
import type { WTSettings, ProfileDefaults, FontSettings } from '../../types'

interface Props {
  settings: WTSettings
  onPatch: (body: { defaults: Partial<ProfileDefaults> }) => void
}

const WEIGHTS: FontSettings['weight'][] = [
  'thin', 'extra-light', 'light', 'semi-light', 'normal', 'semi-bold', 'bold', 'extra-bold'
]

export function FontPanel({ settings, onPatch }: Props) {
  const font = settings.profiles.defaults.font ?? { face: 'Cascadia Code', size: 12, weight: 'normal' }

  function patchFont(patch: Partial<FontSettings>) {
    onPatch({ defaults: { font: { ...font, ...patch } } })
  }

  return (
    <div>
      <div className="panel-title">Font</div>

      <div className="control-group">
        <div className="control-label"><span>Font Face</span></div>
        <input
          className="text-input"
          type="text"
          value={font.face}
          placeholder="e.g. Cascadia Code, Consolas, JetBrains Mono"
          onChange={e => patchFont({ face: e.target.value })}
        />
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4 }}>
          Type any font installed on your system
        </div>
      </div>

      <div className="control-group">
        <div className="control-label">
          <span>Font Size</span>
          <span className="control-value">{font.size}pt</span>
        </div>
        <input
          type="range" className="slider" min={8} max={32} step={1}
          value={font.size}
          onChange={e => patchFont({ size: Number(e.target.value) })}
        />
      </div>

      <div className="control-group">
        <div className="control-label"><span>Font Weight</span></div>
        <select
          className="select-input"
          value={font.weight}
          onChange={e => patchFont({ weight: e.target.value as FontSettings['weight'] })}
        >
          {WEIGHTS.map(w => (
            <option key={w} value={w}>{w.charAt(0).toUpperCase() + w.slice(1)}</option>
          ))}
        </select>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/panels/FontPanel.tsx
git commit -m "feat: FontPanel with face, size, and weight controls"
```

---

## Task 12: BackgroundPanel

**Files:**
- Create: `src/components/panels/BackgroundPanel.tsx`

- [ ] **Step 1: Create src/components/panels/BackgroundPanel.tsx**

```tsx
import type { WTSettings, ProfileDefaults } from '../../types'

interface Props {
  settings: WTSettings
  onPatch: (body: { defaults: Partial<ProfileDefaults> }) => void
}

const STRETCH_MODES: ProfileDefaults['backgroundImageStretchMode'][] = [
  'none', 'fill', 'uniform', 'uniformToFill'
]

const ALIGNMENTS: ProfileDefaults['backgroundImageAlignment'][] = [
  'center', 'top', 'bottom', 'left', 'right',
  'topLeft', 'topRight', 'bottomLeft', 'bottomRight'
]

export function BackgroundPanel({ settings, onPatch }: Props) {
  const d = settings.profiles.defaults
  const bgImage = d.backgroundImage ?? ''
  const bgOpacity = d.backgroundImageOpacity ?? 1.0
  const stretchMode = d.backgroundImageStretchMode ?? 'uniformToFill'
  const alignment = d.backgroundImageAlignment ?? 'center'

  return (
    <div>
      <div className="panel-title">Background Image</div>

      <div className="control-group">
        <div className="control-label"><span>Image Path</span></div>
        <input
          className="text-input"
          type="text"
          value={bgImage}
          placeholder="C:\Users\ASUS\Pictures\wallpaper.png"
          onChange={e => onPatch({ defaults: { backgroundImage: e.target.value || null } })}
        />
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4 }}>
          Full path to image file. Clear to remove background.
        </div>
      </div>

      <div className="control-group">
        <div className="control-label">
          <span>Image Opacity</span>
          <span className="control-value">{Math.round(bgOpacity * 100)}%</span>
        </div>
        <input
          type="range" className="slider" min={0} max={100} step={1}
          value={Math.round(bgOpacity * 100)}
          onChange={e => onPatch({ defaults: { backgroundImageOpacity: Number(e.target.value) / 100 } })}
        />
      </div>

      <div className="control-group">
        <div className="control-label"><span>Stretch Mode</span></div>
        <select
          className="select-input"
          value={stretchMode}
          onChange={e => onPatch({ defaults: { backgroundImageStretchMode: e.target.value as ProfileDefaults['backgroundImageStretchMode'] } })}
        >
          {STRETCH_MODES.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      <div className="control-group">
        <div className="control-label"><span>Alignment</span></div>
        <select
          className="select-input"
          value={alignment}
          onChange={e => onPatch({ defaults: { backgroundImageAlignment: e.target.value as ProfileDefaults['backgroundImageAlignment'] } })}
        >
          {ALIGNMENTS.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/panels/BackgroundPanel.tsx
git commit -m "feat: BackgroundPanel with image path, opacity, stretch, alignment"
```

---

## Task 13: TerminalPreview

**Files:**
- Create: `src/components/TerminalPreview.tsx`

- [ ] **Step 1: Create src/components/TerminalPreview.tsx**

```tsx
import type { WTSettings } from '../types'
import { getActiveScheme } from '../lib/settings'

interface Props {
  settings: WTSettings
}

export function TerminalPreview({ settings }: Props) {
  const d = settings.profiles.defaults
  const scheme = getActiveScheme(settings)
  const font = d.font ?? { face: 'Cascadia Code', size: 12 }
  const opacity = (d.opacity ?? 100) / 100
  const bgImage = d.backgroundImage

  const style: React.CSSProperties = {
    backgroundColor: scheme?.background ?? '#0d1117',
    color: scheme?.foreground ?? '#e6edf3',
    fontFamily: `'${font.face}', 'Cascadia Code', Consolas, monospace`,
    fontSize: `${Math.min(font.size, 14)}px`,
    opacity,
    ...(bgImage ? {
      backgroundImage: `url('${bgImage.replace(/\\/g, '/')}')`,
      backgroundSize: d.backgroundImageStretchMode === 'fill' ? '100% 100%'
        : d.backgroundImageStretchMode === 'uniform' ? 'contain'
        : d.backgroundImageStretchMode === 'none' ? 'auto'
        : 'cover',
      backgroundPosition: d.backgroundImageAlignment ?? 'center',
      backgroundRepeat: 'no-repeat'
    } : {})
  }

  const promptColor = scheme?.green ?? '#3fb950'
  const accentColor = scheme?.blue ?? '#58a6ff'
  const cursor = { backgroundColor: scheme?.cursorColor ?? '#58a6ff' }

  return (
    <div className="terminal-preview">
      <div className="preview-label">Live Preview</div>
      <div className="terminal-window" style={style}>
        <div className="terminal-line" style={{ color: promptColor }}>ASUS@PC ~</div>
        <div className="terminal-line" style={{ color: scheme?.foreground ?? '#e6edf3', opacity: 0.6 }}>$ echo "Hello, World!"</div>
        <div className="terminal-line">Hello, World!</div>
        <div className="terminal-line" style={{ color: scheme?.foreground ?? '#e6edf3', opacity: 0.6 }}>$ ls</div>
        <div className="terminal-line" style={{ color: accentColor }}>Documents  Downloads  Desktop  Projects</div>
        <div className="terminal-line">
          <span style={{ color: promptColor }}>ASUS@PC ~ $ </span>
          <span style={{ ...cursor, color: style.backgroundColor, padding: '0 1px' }}>█</span>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/TerminalPreview.tsx
git commit -m "feat: TerminalPreview with live font, color, opacity, background"
```

---

## Task 14: Smoke Test End-to-End

- [ ] **Step 1: Run the app**

```bash
cd C:\Users\ASUS\terminal-theme-studio
bun run dev
```

Expected output:
```
[0] Server running at http://localhost:3001
[1] VITE v5.x.x  ready in NNN ms
[1]   ➜  Local:   http://localhost:3000/
```

- [ ] **Step 2: Open browser at http://localhost:3000**

Verify:
- App loads with sidebar showing Opacity / Colors / Font / Background nav
- Opacity sliders are visible and show current values from your settings.json

- [ ] **Step 3: Test instant apply — Opacity**

Drag the "Window Opacity" slider. Watch Windows Terminal in the background. It should dim/brighten within 150ms.

- [ ] **Step 4: Test instant apply — Colors**

Switch to Colors panel. Change the Background color. Windows Terminal background color should update.

- [ ] **Step 5: Test theme save/apply/delete**

1. Set a custom opacity (e.g. 70%)
2. Click "Save Current" → type "Test Theme" → press Enter
3. "Test Theme" should appear in the Saved Themes list
4. Change opacity to 100%
5. Click "Test Theme" in the sidebar — opacity should jump back to 70% and apply to the terminal
6. Hover "Test Theme" → click × to delete it → it disappears from the list

- [ ] **Step 6: Run all tests**

```bash
bun test
```

Expected: All tests in `src/lib/settings.test.ts` pass.

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat: terminal theme studio — complete implementation"
```
