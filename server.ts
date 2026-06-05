import { readFileSync, writeFileSync, existsSync, watch, unlinkSync, renameSync } from 'fs'
import path from 'path'
import type { WTSettings, SavedTheme, ColorScheme, ProfileDefaults, PlaylistItem, PlaylistConfig } from './src/types'
import { mergeDefaults, upsertScheme } from './src/lib/settings'

const WT_SETTINGS_PATH = path.join(
  process.env.LOCALAPPDATA ?? '',
  'Packages',
  'Microsoft.WindowsTerminal_8wekyb3d8bbwe',
  'LocalState',
  'settings.json'
)

const THEMES_PATH = path.join(import.meta.dir, 'themes.json')
const PLAYLIST_PATH = path.join(import.meta.dir, 'playlist.json')

if (!existsSync(WT_SETTINGS_PATH)) {
  console.error(`Windows Terminal settings.json not found at:\n  ${WT_SETTINGS_PATH}`)
  process.exit(1)
}

const clients = new Set<import('bun').ServerWebSocket<unknown>>()

let activeFfmpeg: { proc: import('bun').Subprocess; tmpPath: string } | null = null

function killActiveFfmpeg(): void {
  if (!activeFfmpeg) return
  try { activeFfmpeg.proc.kill() } catch {}
  try {
    if (existsSync(activeFfmpeg.tmpPath)) unlinkSync(activeFfmpeg.tmpPath)
  } catch {}
  activeFfmpeg = null
}

let cachedSettings: WTSettings = JSON.parse(readFileSync(WT_SETTINGS_PATH, 'utf-8'))

function readSettings(): WTSettings {
  return cachedSettings
}

function writeSettings(settings: WTSettings): void {
  writeFileSync(WT_SETTINGS_PATH, JSON.stringify(settings, null, 4), 'utf-8')
  cachedSettings = settings
}

function reloadSettingsFromDisk(): void {
  try {
    cachedSettings = JSON.parse(readFileSync(WT_SETTINGS_PATH, 'utf-8'))
  } catch {}
}

function readThemes(): SavedTheme[] {
  if (!existsSync(THEMES_PATH)) return []
  return JSON.parse(readFileSync(THEMES_PATH, 'utf-8'))
}

function writeThemes(themes: SavedTheme[]): void {
  writeFileSync(THEMES_PATH, JSON.stringify(themes, null, 2), 'utf-8')
}

// ── Playlist engine ──────────────────────────────────────────

const DEFAULT_PLAYLIST: PlaylistConfig = {
  mode: 'single', items: [], isPlaying: false, currentIndex: 0, defaultDurationSec: 10,
}

function readPlaylist(): PlaylistConfig {
  if (!existsSync(PLAYLIST_PATH)) return { ...DEFAULT_PLAYLIST }
  try { return JSON.parse(readFileSync(PLAYLIST_PATH, 'utf-8')) } catch { return { ...DEFAULT_PLAYLIST } }
}

function writePlaylist(pl: PlaylistConfig): void {
  writeFileSync(PLAYLIST_PATH, JSON.stringify(pl, null, 2), 'utf-8')
}

function broadcastPlaylist(pl: PlaylistConfig): void {
  const msg = JSON.stringify({ type: 'playlist-update', playlist: pl })
  clients.forEach(ws => { try { ws.send(msg) } catch {} })
}

let playlistTimer: ReturnType<typeof setTimeout> | null = null

function stopPlaylistTimer(): void {
  if (playlistTimer) { clearTimeout(playlistTimer); playlistTimer = null }
}

function findNextReadyIndex(items: PlaylistItem[], from: number): number {
  const n = items.length
  for (let i = 1; i <= n; i++) {
    const idx = (from + i) % n
    if (items[idx]?.status === 'ready') return idx
  }
  return -1
}

function applyItemBackground(gifPath: string): void {
  try {
    let s = readSettings()
    s = mergeDefaults(s, { backgroundImage: gifPath })
    writeSettings(s)
  } catch {}
}

function scheduleAdvance(pl: PlaylistConfig): void {
  stopPlaylistTimer()
  if (!pl.isPlaying || pl.items.length === 0) return
  const item = pl.items[pl.currentIndex]
  if (!item || item.status !== 'ready') return
  const delay = item.durationSec * 1000
  playlistTimer = setTimeout(() => {
    const current = readPlaylist()
    if (!current.isPlaying || current.items.length === 0) return
    const nextIdx = findNextReadyIndex(current.items, current.currentIndex)
    if (nextIdx === -1) return
    const nextItem = current.items[nextIdx]
    if (nextItem.gifPath) applyItemBackground(nextItem.gifPath)
    const updated: PlaylistConfig = { ...current, currentIndex: nextIdx }
    writePlaylist(updated)
    broadcastPlaylist(updated)
    scheduleAdvance(updated)
  }, delay)
}

// Resume timer if server restarts while playlist was playing
;(function resumePlaylistOnStart() {
  const pl = readPlaylist()
  if (pl.isPlaying && pl.items.length > 0) scheduleAdvance(pl)
}())

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
    const tmpPath = `${gifPath}.${crypto.randomUUID()}.tmp`

    // Cancel any in-flight conversion before starting a new one
    killActiveFfmpeg()

    try {
      const proc = Bun.spawn([
        'ffmpeg', '-y', '-i', videoPath,
        '-vf', 'fps=12,scale=640:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=256[p];[s1][p]paletteuse=dither=bayer',
        '-loop', '0',
        '-f', 'gif',
        tmpPath,
      ], { stderr: 'pipe' })

      activeFfmpeg = { proc, tmpPath }

      const onAbort = () => killActiveFfmpeg()
      req.signal.addEventListener('abort', onAbort)

      let exitCode: number
      let stderrPromise: Promise<string>
      try {
        // Drain stderr concurrently — ffmpeg is verbose and will deadlock if the
        // pipe buffer fills while we're blocking on proc.exited.
        stderrPromise = new Response(proc.stderr).text().catch(() => '')
        exitCode = await proc.exited
      } finally {
        req.signal.removeEventListener('abort', onAbort)
        // If activeFfmpeg still points at us, clear it (we're done)
        if (activeFfmpeg?.proc === proc) activeFfmpeg = null
      }

      if (exitCode !== 0) {
        if (existsSync(tmpPath)) { try { unlinkSync(tmpPath) } catch {} }
        if (req.signal.aborted) return new Response(null, { status: 499, headers: addCors() })
        const detail = await stderrPromise
        return json({ error: 'ffmpeg failed', detail }, 500)
      }

      // Atomic rename to final path
      try {
        if (existsSync(gifPath)) unlinkSync(gifPath)
        renameSync(tmpPath, gifPath)
      } catch (err) {
        if (existsSync(tmpPath)) { try { unlinkSync(tmpPath) } catch {} }
        return json({ error: 'rename failed', detail: String(err) }, 500)
      }

      // Parse source video duration from ffmpeg stderr for accurate playlist timing
      const stderrText = await stderrPromise
      const durMatch = stderrText.match(/Duration:\s+(\d+):(\d+):(\d+(?:\.\d+)?)/)
      let durationSec: number | undefined
      if (durMatch) {
        const secs = parseInt(durMatch[1]) * 3600 + parseInt(durMatch[2]) * 60 + parseFloat(durMatch[3])
        if (secs > 0) durationSec = Math.round(secs * 10) / 10
      }

      return json({ gifPath, ...(durationSec !== undefined ? { durationSec } : {}) })
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

  // ── Playlist ────────────────────────────────────────────────

  if (method === 'GET' && pathname === '/api/playlist') {
    return json(readPlaylist())
  }

  if (method === 'PATCH' && pathname === '/api/playlist') {
    let body: Partial<PlaylistConfig>
    try { body = await req.json() } catch { return json({ error: 'invalid body' }, 400) }
    const pl = readPlaylist()
    const updated: PlaylistConfig = { ...pl, ...body }
    writePlaylist(updated)
    broadcastPlaylist(updated)
    if (!updated.isPlaying) stopPlaylistTimer()
    return json({ playlist: updated })
  }

  if (method === 'POST' && pathname === '/api/playlist/items') {
    let body: { sourcePath: string }
    try { body = await req.json() } catch { return json({ error: 'invalid body' }, 400) }
    const sourcePath = body.sourcePath?.trim()
    if (!sourcePath) return json({ error: 'sourcePath required' }, 400)
    const isVideo = /\.(mp4|webm|ogg|mov|avi|mkv)$/i.test(sourcePath)
    const isImage = /\.(png|jpg|jpeg|webp|bmp|gif)$/i.test(sourcePath)
    if (!isVideo && !isImage) return json({ error: 'unsupported file type' }, 400)
    const pl = readPlaylist()
    const newItem: PlaylistItem = {
      id: crypto.randomUUID(),
      sourcePath,
      gifPath: isImage ? sourcePath : null,
      status: isImage ? 'ready' : 'idle',
      durationSec: pl.defaultDurationSec,
    }
    // Point currentIndex at the new item when not playing
    const newIndex = pl.items.length
    const updated: PlaylistConfig = {
      ...pl,
      items: [...pl.items, newItem],
      currentIndex: pl.isPlaying ? pl.currentIndex : newIndex,
    }
    // Auto-preview: apply image background immediately when not playing
    if (!pl.isPlaying && isImage && newItem.gifPath) {
      applyItemBackground(newItem.gifPath)
    }
    writePlaylist(updated)
    broadcastPlaylist(updated)
    return json({ playlist: updated }, 201)
  }

  if (method === 'POST' && pathname === '/api/playlist/play') {
    const pl = readPlaylist()
    const readyAtCurrent = pl.items[pl.currentIndex]?.status === 'ready'
    const firstReadyIdx = readyAtCurrent ? pl.currentIndex : pl.items.findIndex(i => i.status === 'ready')
    if (firstReadyIdx === -1) return json({ error: 'no ready items' }, 400)
    const item = pl.items[firstReadyIdx]
    if (item.gifPath) applyItemBackground(item.gifPath)
    const updated: PlaylistConfig = { ...pl, isPlaying: true, currentIndex: firstReadyIdx }
    writePlaylist(updated)
    broadcastPlaylist(updated)
    scheduleAdvance(updated)
    return json({ playlist: updated })
  }

  if (method === 'POST' && pathname === '/api/playlist/pause') {
    stopPlaylistTimer()
    const pl = readPlaylist()
    const updated: PlaylistConfig = { ...pl, isPlaying: false }
    writePlaylist(updated)
    broadcastPlaylist(updated)
    return json({ playlist: updated })
  }

  if (method === 'POST' && pathname === '/api/playlist/next') {
    const pl = readPlaylist()
    if (pl.items.length === 0) return json({ error: 'empty playlist' }, 400)
    stopPlaylistTimer()
    const nextIdx = findNextReadyIndex(pl.items, pl.currentIndex)
    if (nextIdx === -1) return json({ error: 'no ready items' }, 400)
    const nextItem = pl.items[nextIdx]
    if (nextItem.gifPath) applyItemBackground(nextItem.gifPath)
    const updated: PlaylistConfig = { ...pl, currentIndex: nextIdx }
    writePlaylist(updated)
    broadcastPlaylist(updated)
    if (pl.isPlaying) scheduleAdvance(updated)
    return json({ playlist: updated })
  }

  if (method === 'POST' && pathname === '/api/playlist/prev') {
    const pl = readPlaylist()
    if (pl.items.length === 0) return json({ error: 'empty playlist' }, 400)
    stopPlaylistTimer()
    const n = pl.items.length
    let prevIdx = -1
    for (let i = 1; i <= n; i++) {
      const idx = (pl.currentIndex - i + n) % n
      if (pl.items[idx]?.status === 'ready') { prevIdx = idx; break }
    }
    if (prevIdx === -1) return json({ error: 'no ready items' }, 400)
    const prevItem = pl.items[prevIdx]
    if (prevItem.gifPath) applyItemBackground(prevItem.gifPath)
    const updated: PlaylistConfig = { ...pl, currentIndex: prevIdx }
    writePlaylist(updated)
    broadcastPlaylist(updated)
    if (pl.isPlaying) scheduleAdvance(updated)
    return json({ playlist: updated })
  }

  if (method === 'POST' && pathname === '/api/playlist/jump') {
    let body: { index: number }
    try { body = await req.json() } catch { return json({ error: 'invalid body' }, 400) }
    const pl = readPlaylist()
    const { index } = body
    if (index < 0 || index >= pl.items.length) return json({ error: 'index out of range' }, 400)
    stopPlaylistTimer()
    const item = pl.items[index]
    if (item.gifPath && item.status === 'ready') applyItemBackground(item.gifPath)
    const updated: PlaylistConfig = { ...pl, currentIndex: index }
    writePlaylist(updated)
    broadcastPlaylist(updated)
    if (pl.isPlaying && item.status === 'ready') scheduleAdvance(updated)
    return json({ playlist: updated })
  }

  const plItemMatch = pathname.match(/^\/api\/playlist\/items\/([^/]+)$/)

  if (method === 'PATCH' && plItemMatch) {
    const id = decodeURIComponent(plItemMatch[1])
    let body: Partial<PlaylistItem>
    try { body = await req.json() } catch { return json({ error: 'invalid body' }, 400) }
    const pl = readPlaylist()
    const idx = pl.items.findIndex(i => i.id === id)
    if (idx === -1) return json({ error: 'item not found' }, 404)
    const updatedItem: PlaylistItem = { ...pl.items[idx], ...body }
    const items = pl.items.map((it, i) => i === idx ? updatedItem : it)
    const updated: PlaylistConfig = { ...pl, items }
    writePlaylist(updated)
    broadcastPlaylist(updated)
    // Auto-preview: apply background whenever current item becomes ready
    if (updatedItem.status === 'ready' && updatedItem.gifPath && pl.currentIndex === idx) {
      applyItemBackground(updatedItem.gifPath)
      if (pl.isPlaying) scheduleAdvance(updated)
    }
    return json({ playlist: updated })
  }

  if (method === 'DELETE' && plItemMatch) {
    const id = decodeURIComponent(plItemMatch[1])
    const pl = readPlaylist()
    const idx = pl.items.findIndex(i => i.id === id)
    if (idx === -1) return json({ error: 'item not found' }, 404)
    const items = pl.items.filter(i => i.id !== id)
    let { currentIndex, isPlaying } = pl
    if (items.length === 0) { currentIndex = 0; isPlaying = false; stopPlaylistTimer() }
    else if (idx < currentIndex) currentIndex = Math.max(0, currentIndex - 1)
    else if (idx === currentIndex) currentIndex = Math.min(currentIndex, items.length - 1)
    const updated: PlaylistConfig = { ...pl, items, currentIndex, isPlaying }
    writePlaylist(updated)
    broadcastPlaylist(updated)
    return json({ playlist: updated })
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
