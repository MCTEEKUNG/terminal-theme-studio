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
    let body: { defaults?: Partial<ProfileDefaults>; scheme?: ColorScheme }
    try {
      body = await req.json()
    } catch {
      return json({ error: 'invalid JSON body' }, 400)
    }
    try {
      let settings = readSettings()
      if (body.defaults) settings = mergeDefaults(settings, body.defaults)
      if (body.scheme) settings = upsertScheme(settings, body.scheme)
      writeSettings(settings)
      return json({ ok: true })
    } catch (err) {
      return json({ error: 'write failed' }, 500)
    }
  }

  if (method === 'GET' && pathname === '/api/themes') {
    return json(readThemes())
  }

  if (method === 'POST' && pathname === '/api/themes') {
    let body: { name: string }
    try {
      body = await req.json()
    } catch {
      return json({ error: 'invalid JSON body' }, 400)
    }
    if (!body.name?.trim()) return json({ error: 'name required' }, 400)
    try {
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
    } catch (err) {
      return json({ error: 'write failed' }, 500)
    }
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
    try {
      let settings = readSettings()
      settings = mergeDefaults(settings, theme.settings.defaults)
      if (theme.settings.scheme) settings = upsertScheme(settings, theme.settings.scheme)
      writeSettings(settings)
      return json({ ok: true })
    } catch (err) {
      return json({ error: 'write failed' }, 500)
    }
  }

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

    try {
      const proc = Bun.spawn([
        'ffmpeg', '-y', '-i', videoPath,
        '-vf', 'fps=12,scale=640:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=256[p];[s1][p]paletteuse=dither=bayer',
        '-loop', '0',
        gifPath,
      ], { stderr: 'pipe' })

      // Drain stderr concurrently — ffmpeg is verbose and will deadlock if the
      // pipe buffer fills while we're blocking on proc.exited.
      const stderrPromise = new Response(proc.stderr).text().catch(() => '')
      const exitCode = await proc.exited
      if (exitCode !== 0) {
        const detail = await stderrPromise
        return json({ error: 'ffmpeg failed', detail }, 500)
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

  if (method === 'GET' && pathname === '/api/file') {
    const filePath = url.searchParams.get('path')
    if (!filePath) return json({ error: 'path required' }, 400)
    if (!existsSync(filePath)) return new Response('Not Found', { status: 404, headers: addCors() })

    const ext = path.extname(filePath).toLowerCase()
    const MIME: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
      '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogg': 'video/ogg',
      '.mov': 'video/mp4',
    }
    const mime = MIME[ext]
    if (!mime) return new Response('Unsupported media type', { status: 415, headers: addCors() })

    const h = addCors({ 'Content-Type': mime })
    h.set('Accept-Ranges', 'bytes')
    return new Response(Bun.file(filePath), { headers: h })
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
