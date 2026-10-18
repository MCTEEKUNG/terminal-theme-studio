import { readFileSync, writeFileSync, existsSync, watch, unlinkSync, renameSync, readdirSync, mkdirSync } from 'fs'
import { createHash } from 'crypto'
import path from 'path'
import type { WTSettings, SavedTheme, ColorScheme, ProfileDefaults, PlaylistItem, PlaylistConfig, PlaylistPlaybackMode } from './src/types'
import { mergeDefaults, upsertScheme } from './src/lib/settings'
import { createPtyxisBridge } from './lib/ptyxis'
import { createGlassBridge, glassBlurAmount } from './lib/glass'
import { validateAppearance } from './lib/appearance'
import { createLiveAppearanceBridge } from './lib/live-appearance'
import { isDurationMode, isVideo, playlistDuration } from './lib/playlist-timing'
import { nativeMediaPath, nativeStatus, openNativeTerminal } from './lib/native-terminal'

const WT_SETTINGS_PATH =
  process.env.WT_SETTINGS_PATH ??
  (process.env.LOCALAPPDATA
    ? path.join(
        process.env.LOCALAPPDATA,
        'Packages',
        'Microsoft.WindowsTerminal_8wekyb3d8bbwe',
        'LocalState',
        'settings.json'
      )
    : // Fallback for non-Windows dev environments: keep the real settings
      // file untouched and store them beside the project instead.
      path.join(import.meta.dir, 'wt-settings.json'))

const THEMES_PATH = path.join(import.meta.dir, 'themes.json')
const PLAYLIST_PATH = path.join(import.meta.dir, 'playlist.json')
const CONVERTED_GIF_DIR = path.join(import.meta.dir, '.playlist-cache')
const terminalBridge = createPtyxisBridge(process.platform === 'linux' && !process.env.WT_SETTINGS_PATH && !process.env.LOCALAPPDATA)

const liveAppearanceBridge = createLiveAppearanceBridge(process.platform === 'linux' && !process.env.WT_SETTINGS_PATH && !process.env.LOCALAPPDATA)
const glassBridge = createGlassBridge(process.platform === 'linux' && !process.env.WT_SETTINGS_PATH && !process.env.LOCALAPPDATA)

if (!existsSync(WT_SETTINGS_PATH)) {
  console.log(`Windows Terminal settings.json not found, creating starter file at:\n  ${WT_SETTINGS_PATH}`)
  writeFileSync(
    WT_SETTINGS_PATH,
    JSON.stringify({ profiles: { defaults: {}, list: [] }, schemes: [] }, null, 4),
    'utf-8'
  )
}

const clients = new Set<import('bun').ServerWebSocket<unknown>>()

let conversionQueue: Promise<void> = Promise.resolve()

async function acquireConversion(): Promise<() => void> {
  const previous = conversionQueue
  let release!: () => void
  conversionQueue = new Promise<void>(resolve => { release = resolve })
  await previous
  return release
}

let cachedSettings: WTSettings = JSON.parse(readFileSync(WT_SETTINGS_PATH, 'utf-8'))
terminalBridge.schedule(cachedSettings)
glassBridge.schedule(cachedSettings)
liveAppearanceBridge.schedule(cachedSettings)

function readSettings(): WTSettings {
  return cachedSettings
}

function writeSettings(settings: WTSettings): void {
  writeFileSync(WT_SETTINGS_PATH, JSON.stringify(settings, null, 4), 'utf-8')
  cachedSettings = settings
  terminalBridge.schedule(settings)
  glassBridge.schedule(settings)
  liveAppearanceBridge.schedule(settings)
}

function reloadSettingsFromDisk(): void {
  try {
    cachedSettings = JSON.parse(readFileSync(WT_SETTINGS_PATH, 'utf-8'))
    terminalBridge.schedule(cachedSettings)
    glassBridge.schedule(cachedSettings)
    liveAppearanceBridge.schedule(cachedSettings)
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
  mode: 'single', items: [], isPlaying: false, currentIndex: 0, defaultDurationSec: 10, durationMode: 'fixed', playbackMode: 'loop',
}

function isPlaybackMode(value: unknown): value is PlaylistPlaybackMode {
  return value === 'loop' || value === 'shuffle' || value === 'repeat-one'
}

function readPlaylist(): PlaylistConfig {
  if (!existsSync(PLAYLIST_PATH)) return { ...DEFAULT_PLAYLIST }
  try {
    const saved = JSON.parse(readFileSync(PLAYLIST_PATH, 'utf-8')) as Partial<PlaylistConfig>
    // Playlist files created before playback modes existed keep their original
    // behaviour: play every clip in order and then return to the first one.
    return { ...DEFAULT_PLAYLIST, ...saved, durationMode: isDurationMode(saved.durationMode) ? saved.durationMode : 'fixed', playbackMode: isPlaybackMode(saved.playbackMode) ? saved.playbackMode : 'loop' }
  } catch { return { ...DEFAULT_PLAYLIST } }
}

function writePlaylist(pl: PlaylistConfig): void {
  writeFileSync(PLAYLIST_PATH, JSON.stringify(pl, null, 2), 'utf-8')
}

const PLAYLIST_MEDIA_RE = /\.(mp4|webm|ogg|mov|avi|mkv|png|jpg|jpeg|webp|bmp|gif)$/i
const PLAYLIST_IMAGE_RE = /\.(png|jpg|jpeg|webp|bmp|gif)$/i
const PLAYLIST_VIDEO_RE = /\.(mp4|webm|ogg|mov|avi|mkv)$/i

function createPlaylistItems(sourcePaths: string[], defaultDurationSec: number): PlaylistItem[] {
  return sourcePaths.map(sourcePath => {
    const isImage = PLAYLIST_IMAGE_RE.test(sourcePath)
    return {
      id: crypto.randomUUID(),
      sourcePath,
      gifPath: isImage ? sourcePath : null,
      status: isImage ? 'ready' : 'idle',
      durationSec: defaultDurationSec,
    }
  })
}

function findMediaFiles(folderPath: string): string[] {
  const files: string[] = []
  const cachePath = path.resolve(CONVERTED_GIF_DIR).toLowerCase()
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory() && path.resolve(entryPath).toLowerCase() !== cachePath) visit(entryPath)
      else if (entry.isFile() && PLAYLIST_MEDIA_RE.test(entry.name)) files.push(entryPath)
    }
  }
  visit(folderPath)
  // GIFs made by older versions were written beside their source video.  Do
  // not re-import those derivative files; standalone GIFs remain supported.
  const videoStems = new Set(files
    .filter(filePath => PLAYLIST_VIDEO_RE.test(filePath))
    .map(filePath => path.join(path.dirname(filePath), path.basename(filePath, path.extname(filePath))).toLowerCase()))
  return files
    .filter(filePath => !/\.gif$/i.test(filePath) || !videoStems.has(
      path.join(path.dirname(filePath), path.basename(filePath, path.extname(filePath))).toLowerCase()
    ))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}

function isLegacyGeneratedGif(item: PlaylistItem, videoStems: Set<string>): boolean {
  if (!/\.gif$/i.test(item.sourcePath)) return false
  const stem = path.join(path.dirname(item.sourcePath), path.basename(item.sourcePath, path.extname(item.sourcePath))).toLowerCase()
  return videoStems.has(stem)
}

function getConvertedGifPath(videoPath: string): string {
  const stem = path.basename(videoPath, path.extname(videoPath))
  const hash = createHash('sha256').update(videoPath).digest('hex').slice(0, 12)
  return path.join(CONVERTED_GIF_DIR, `${stem}-${hash}.gif`)
}

function broadcastPlaylist(pl: PlaylistConfig): void {
  const msg = JSON.stringify({ type: 'playlist-update', playlist: pl })
  clients.forEach(ws => { try { ws.send(msg) } catch {} })
}

const playlistSession = crypto.randomUUID()
let playlistUsesEndEvents = false
let playlistTimerGeneration = 0
const playbackToken = () => `${playlistSession}:${playlistTimerGeneration}`
let playlistTimer: ReturnType<typeof setTimeout> | null = null

function stopPlaylistTimer(): void {
  playlistTimerGeneration++
  playlistUsesEndEvents = false
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

function findNextPlaybackIndex(pl: PlaylistConfig): number {
  const current = pl.items[pl.currentIndex]
  if (pl.playbackMode === 'repeat-one' && current?.status === 'ready') return pl.currentIndex

  if (pl.playbackMode === 'shuffle') {
    const candidates = pl.items
      .map((item, index) => ({ item, index }))
      .filter(({ item, index }) => item.status === 'ready' && index !== pl.currentIndex)
    if (candidates.length > 0) return candidates[Math.floor(Math.random() * candidates.length)].index
    return current?.status === 'ready' ? pl.currentIndex : -1
  }

  return findNextReadyIndex(pl.items, pl.currentIndex)
}

function applyItemBackground(gifPath: string): void {
  try {
    let s = readSettings()
    const defaults = s.profiles.defaults
    // Windows Terminal defaults to a cover-like crop when this field is
    // absent. Keep playlist transitions from unexpectedly filling the screen;
    // explicit WebUI choices are preserved.
    s = mergeDefaults(s, {
      backgroundImage: gifPath,
      backgroundImageStretchMode: defaults.backgroundImageStretchMode ?? 'uniform',
      backgroundImageAlignment: defaults.backgroundImageAlignment ?? 'center',
      backgroundImageOpacity: defaults.backgroundImageOpacity ?? 1,
    })
    writeSettings(s)
  } catch {}
}

function advancePlaylist(): void {
  const current = readPlaylist()
  if (!current.isPlaying || current.items.length === 0) return
  const nextIdx = findNextPlaybackIndex(current)
  if (nextIdx === -1) return
  const nextItem = current.items[nextIdx]
  if (nextItem.gifPath) applyItemBackground(nextItem.gifPath)
  const updated: PlaylistConfig = { ...current, currentIndex: nextIdx }
  writePlaylist(updated)
  broadcastPlaylist(updated)
  scheduleAdvance(updated)
}

function nativeEndEventsAvailable(): boolean {
  const status = nativeStatus()
  return status.state === 'running' && status.playlistEndEvents === true
}

function scheduleAdvance(pl: PlaylistConfig): void {
  stopPlaylistTimer()
  if (!pl.isPlaying || pl.items.length === 0) return
  const item = pl.items[pl.currentIndex]
  if (!item || item.status !== 'ready') return
  // The native player signals real end-of-stream. The duration fallback also
  // supports existing terminals and background playback without a native window.
  if (pl.durationMode === 'full-video' && isVideo(item.sourcePath) && nativeEndEventsAvailable()) {
    playlistUsesEndEvents = true
    const monitor = () => {
      playlistTimer = setTimeout(() => {
        if (nativeEndEventsAvailable()) monitor()
        else scheduleAdvance(readPlaylist())
      }, 1000)
    }
    monitor()
    return
  }
  const generation = playlistTimerGeneration
  void playlistDuration(pl, item).then(seconds => {
    if (generation !== playlistTimerGeneration) return
    if (seconds === null) {
      console.warn(`Cannot read video duration: ${item.sourcePath}; keeping this clip until Next is pressed.`)
      return
    }
    playlistTimer = setTimeout(advancePlaylist, Math.min(seconds * 1000, 2_147_483_647))
  })
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

  if (method === 'GET' && pathname === '/api/health') return json({ app: 'terminal-theme-studio', pid: process.pid })

  if (method === 'GET' && pathname === '/api/settings') {
    return json(readSettings())
  }

  if (method === 'GET' && pathname === '/api/appearance') return json({ ...liveAppearanceBridge.status, native: nativeStatus() })

  if (method === 'GET' && pathname === '/api/glass') return json(glassBridge.status)

  if (method === 'GET' && pathname === '/api/terminal') {
    return json(terminalBridge.status)
  }

  if (method === 'GET' && pathname === '/api/preview/source') {
    const requested = url.searchParams.get('path') ?? ''
    const item = readPlaylist().items.find(item => item.gifPath === requested || item.sourcePath === requested)
    return json({ path: item?.sourcePath ?? requested })
  }

  if (method === 'GET' && pathname === '/api/native/state') {
    const settings = readSettings()
    const pl = readPlaylist()
    if (!playlistUsesEndEvents && pl.isPlaying && pl.durationMode === 'full-video'
      && isVideo(pl.items[pl.currentIndex]?.sourcePath ?? '') && nativeEndEventsAvailable()) scheduleAdvance(pl)
    return json({ settings, mediaPath: nativeMediaPath(settings, pl),
      playlistPlayback: { token: playbackToken(), isPlaying: pl.isPlaying && pl.mode === 'playlist', durationMode: pl.durationMode } })
  }

  if (method === 'POST' && pathname === '/api/playlist/ended') {
    if (req.headers.get('X-Theme-Studio') !== 'native-terminal') return json({ error: 'native request required' }, 403)
    let body: { token?: string; mediaPath?: string }
    try { body = await req.json() } catch { return json({ error: 'invalid body' }, 400) }
    const pl = readPlaylist()
    const item = pl.items[pl.currentIndex]
    // Tokens prevent two windows/tabs or a delayed EOS from advancing twice.
    if (body.token !== playbackToken() || !pl.isPlaying || pl.mode !== 'playlist'
      || pl.durationMode !== 'full-video' || !item || !isVideo(item.sourcePath)
      || body.mediaPath !== item.sourcePath) return json({ advanced: false })
    advancePlaylist()
    return json({ advanced: true })
  }

  if (method === 'GET' && pathname === '/api/native/status') return json(nativeStatus())

  if (method === 'POST' && pathname === '/api/native/open') {
    // The native shell accepts keyboard input only in its own GTK window.
    // Require a same-origin UI request to launch that window.
    const origin = req.headers.get('origin')
    if (origin && !['http://localhost:5555', 'http://127.0.0.1:5555', 'http://localhost:3001', 'http://127.0.0.1:3001'].includes(origin)) {
      return json({ error: 'Open the terminal from the local Theme Studio page' }, 403)
    }
    if (req.headers.get('x-theme-studio') !== 'native-terminal') return json({ error: 'Native launch header required' }, 403)
    try { return json(openNativeTerminal()) }
    catch (error) { return json({ error: String(error) }, 500) }
  }

  if (method === 'PATCH' && pathname === '/api/settings') {
    let body: { defaults?: Partial<ProfileDefaults>; scheme?: ColorScheme }
    try {
      body = await req.json()
    } catch {
      return json({ error: 'invalid JSON body' }, 400)
    }
    try {
      if (body.defaults) {
        try { validateAppearance(body.defaults) }
        catch (error) { return json({ error: String(error) }, 400) }
      }
      if (body.defaults && 'glassBlur' in body.defaults) {
        try { glassBlurAmount(body.defaults.glassBlur) }
        catch (error) { return json({ error: String(error) }, 400) }
      }
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

    // Keep generated GIFs separate from the user's media folder so an import
    // never sees them as extra clips on a later scan.
    mkdirSync(CONVERTED_GIF_DIR, { recursive: true })
    const gifPath = getConvertedGifPath(videoPath)
    const tmpPath = `${gifPath}.${crypto.randomUUID()}.tmp`

    // Serialize requests from all tabs and modes without cancelling other work.
    const release = await acquireConversion()

    try {
      if (req.signal.aborted) return new Response(null, { status: 499, headers: addCors() })
      const proc = Bun.spawn([
        'ffmpeg', '-y', '-i', videoPath,
        '-vf', 'fps=12,scale=640:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=256[p];[s1][p]paletteuse=dither=bayer',
        '-loop', '0',
        '-f', 'gif',
        tmpPath,
      ], { stderr: 'pipe' })

      // An aborted request owns only this process, never another queued job.
      const onAbort = () => { try { proc.kill() } catch {} }
      req.signal.addEventListener('abort', onAbort)
      if (req.signal.aborted) onAbort()

      let exitCode: number
      let stderrPromise: Promise<string>
      try {
        // Drain stderr concurrently — ffmpeg is verbose and will deadlock if the
        // pipe buffer fills while we're blocking on proc.exited.
        stderrPromise = new Response(proc.stderr).text().catch(() => '')
        exitCode = await proc.exited
      } finally {
        req.signal.removeEventListener('abort', onAbort)
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
    } finally {
      if (existsSync(tmpPath)) { try { unlinkSync(tmpPath) } catch {} }
      release()
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
    const updated: PlaylistConfig = {
      ...pl,
      ...body,
      durationMode: isDurationMode(body.durationMode) ? body.durationMode : pl.durationMode,
      playbackMode: isPlaybackMode(body.playbackMode) ? body.playbackMode : pl.playbackMode,
    }
    writePlaylist(updated)
    broadcastPlaylist(updated)
    if (!updated.isPlaying) stopPlaylistTimer()
    else scheduleAdvance(updated)
    return json({ playlist: updated })
  }

  if (method === 'POST' && pathname === '/api/playlist/items') {
    let body: { sourcePath: string }
    try { body = await req.json() } catch { return json({ error: 'invalid body' }, 400) }
    const sourcePath = body.sourcePath?.trim()
    if (!sourcePath) return json({ error: 'sourcePath required' }, 400)
    if (!PLAYLIST_MEDIA_RE.test(sourcePath)) return json({ error: 'unsupported file type' }, 400)

    const pl = readPlaylist()
    const newItems = createPlaylistItems([sourcePath], pl.defaultDurationSec)

    // Point currentIndex at the first new item when not playing.
    const newIndex = pl.items.length
    const updated: PlaylistConfig = {
      ...pl,
      items: [...pl.items, ...newItems],
      currentIndex: pl.isPlaying ? pl.currentIndex : newIndex,
    }
    // Auto-preview the first newly added image when not playing.
    const previewItem = newItems.find(item => item.gifPath)
    if (!pl.isPlaying && previewItem?.gifPath) {
      applyItemBackground(previewItem.gifPath)
    }
    writePlaylist(updated)
    broadcastPlaylist(updated)
    return json({ playlist: updated }, 201)
  }

  if (method === 'POST' && pathname === '/api/playlist/import-folder') {
    let body: { folderPath: string }
    try { body = await req.json() } catch { return json({ error: 'invalid body' }, 400) }
    const folderPath = body.folderPath?.trim()
    if (!folderPath) return json({ error: 'folderPath required' }, 400)

    let mediaPaths: string[]
    try {
      mediaPaths = findMediaFiles(folderPath)
    } catch {
      return json({ error: 'folder not found or cannot be read' }, 404)
    }

    const pl = readPlaylist()
    // Clean up playlist entries that older versions imported from the GIFs
    // they had generated beside matching source videos. Files are not deleted.
    const videoStems = new Set(pl.items
      .filter(item => PLAYLIST_VIDEO_RE.test(item.sourcePath))
      .map(item => path.join(path.dirname(item.sourcePath), path.basename(item.sourcePath, path.extname(item.sourcePath))).toLowerCase()))
    const retainedItems = pl.items.filter(item => !isLegacyGeneratedGif(item, videoStems))
    const removedDuplicates = pl.items.length - retainedItems.length
    const existingPaths = new Set(retainedItems.map(item => item.sourcePath.toLowerCase()))
    const pathsToAdd = mediaPaths.filter(filePath => !existingPaths.has(filePath.toLowerCase()))
    const newItems = createPlaylistItems(pathsToAdd, pl.defaultDurationSec)
    const newIndex = retainedItems.length
    const currentItemId = pl.items[pl.currentIndex]?.id
    const retainedCurrentIndex = retainedItems.findIndex(item => item.id === currentItemId)
    const currentIndex = retainedItems.length === 0
      ? 0
      : retainedCurrentIndex >= 0
        ? retainedCurrentIndex
        : Math.min(pl.currentIndex, retainedItems.length - 1)
    const updated: PlaylistConfig = {
      ...pl,
      items: [...retainedItems, ...newItems],
      currentIndex: retainedItems.length === 0
        ? 0
        : (pl.isPlaying || newItems.length === 0 ? currentIndex : newIndex),
    }
    const previewItem = newItems.find(item => item.gifPath)
    if (!pl.isPlaying && previewItem?.gifPath) applyItemBackground(previewItem.gifPath)
    writePlaylist(updated)
    broadcastPlaylist(updated)
    return json({
      playlist: updated,
      added: newItems.length,
      skipped: mediaPaths.length - newItems.length,
      scanned: mediaPaths.length,
      removedDuplicates,
    }, 201)
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
    const nextIdx = findNextPlaybackIndex(pl)
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
    if (updatedItem.status === 'ready') updatedItem.error = null
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
    if (idx === pl.currentIndex) {
      const next = items[currentIndex]
      if (next?.gifPath) applyItemBackground(next.gifPath)
      scheduleAdvance(updated)
    }
    return json({ playlist: updated })
  }

  if (method === 'GET' && (pathname === '/' || pathname.startsWith('/assets/'))) {
    const root = path.join(import.meta.dir, 'dist')
    const file = path.resolve(root, pathname === '/' ? 'index.html' : `.${pathname}`)
    if (file.startsWith(root + path.sep) && existsSync(file)) return new Response(Bun.file(file))
  }
  return new Response('Not Found', { status: 404, headers: addCors() })
}

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env.PORT ?? 3001),
  fetch(req, server) {
    const url = new URL(req.url)
    // Conversion and queue waits can exceed Bun's default request idle timeout.
    if (url.pathname === '/api/convert-gif') server.timeout(req, 0)
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
