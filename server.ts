import { readFileSync, writeFileSync, existsSync, watch, unlinkSync, renameSync, readdirSync, mkdirSync, copyFileSync } from 'fs'
import path from 'path'
import type { WTSettings, SavedTheme, ColorScheme, ProfileDefaults, PlaylistItem, PlaylistConfig, PlaylistPlaybackMode } from './src/types'
import { getActiveScheme, mergeDefaults, upsertScheme } from './src/lib/settings'
import { createPtyxisBridge } from './lib/ptyxis'
import { createGlassBridge, glassBlurAmount } from './lib/glass'
import { validateAppearance } from './lib/appearance'
import { createLiveAppearanceBridge } from './lib/live-appearance'
import { isDurationMode, isVideo, playlistDuration } from './lib/playlist-timing'
import { nativeMediaPath, nativeStatus, openNativeTerminal } from './lib/native-terminal'
import { createSettingsStore, normalizeLocalPath, resolveSettingsPath } from './lib/terminal-settings'
import { DEFAULT_GIF_CONVERSION, validateGifConversionSettings, type GifConversionSettings } from './src/lib/gif-conversion'
import { createGifConverter } from './lib/gif-converter'

const WT_SETTINGS_PATH = resolveSettingsPath(import.meta.dir)
const settingsStore = createSettingsStore(WT_SETTINGS_PATH)
const DATA_DIR = process.env.THEME_STUDIO_DATA_DIR || import.meta.dir
mkdirSync(DATA_DIR, { recursive: true })
const THEMES_PATH = path.join(DATA_DIR, 'themes.json')
const PLAYLIST_PATH = path.join(DATA_DIR, 'playlist.json')
const CONVERTED_GIF_DIR = path.join(DATA_DIR, '.playlist-cache')
const CONVERSION_SETTINGS_PATH = path.join(DATA_DIR, 'conversion-settings.json')
const gifConverter = createGifConverter(CONVERTED_GIF_DIR)
const terminalBridge = createPtyxisBridge(process.platform === 'linux' && !process.env.WT_SETTINGS_PATH && !process.env.LOCALAPPDATA)

const liveAppearanceBridge = createLiveAppearanceBridge(process.platform === 'linux' && !process.env.WT_SETTINGS_PATH && !process.env.LOCALAPPDATA)
const glassBridge = createGlassBridge(process.platform === 'linux' && !process.env.WT_SETTINGS_PATH && !process.env.LOCALAPPDATA)

const clients = new Set<import('bun').ServerWebSocket<unknown>>()
let studioRevision = crypto.randomUUID()
let conversionSession = new AbortController()

function resetSession(): void {
  stopPlaylistTimer()
  conversionSession.abort()
  conversionSession = new AbortController()
  studioRevision = crypto.randomUUID()
}

function studioState() {
  return { revision: studioRevision, settings: readSettings(), playlist: readPlaylist(), conversionSettings: readConversionSettings() }
}

function broadcast(message: Record<string, unknown>): void {
  const payload = JSON.stringify({ ...message, revision: studioRevision })
  clients.forEach(ws => { try { ws.send(payload) } catch {} })
}

let cachedSettings: WTSettings = settingsStore.read()
terminalBridge.schedule(cachedSettings)
glassBridge.schedule(cachedSettings)
liveAppearanceBridge.schedule(cachedSettings)

function readSettings(): WTSettings {
  cachedSettings = settingsStore.read()
  return cachedSettings
}

function writeSettings(settings: WTSettings): void {
  settingsStore.write(settings)
  cachedSettings = settings
  terminalBridge.schedule(settings)
  glassBridge.schedule(settings)
  liveAppearanceBridge.schedule(settings)
}

function reloadSettingsFromDisk(): void {
  try {
    cachedSettings = settingsStore.read()
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

function activeSchemeNames(defaults: ProfileDefaults): string[] {
  const selected = defaults.colorScheme
  if (typeof selected === 'string') return [selected]
  return selected ? [selected.dark, selected.light].filter((name): name is string => !!name)
    : process.platform === 'win32' ? ['Campbell'] : []
}

function readConversionSettings(): GifConversionSettings {
  if (!existsSync(CONVERSION_SETTINGS_PATH)) return { ...DEFAULT_GIF_CONVERSION }
  return validateGifConversionSettings(JSON.parse(readFileSync(CONVERSION_SETTINGS_PATH, 'utf8')))
}

function writeConversionSettings(settings: GifConversionSettings): void {
  const temporary = `${CONVERSION_SETTINGS_PATH}.${crypto.randomUUID()}.tmp`
  try {
    writeFileSync(temporary, JSON.stringify(settings, null, 2), 'utf8')
    renameSync(temporary, CONVERSION_SETTINGS_PATH)
  } finally { if (existsSync(temporary)) unlinkSync(temporary) }
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
    return normalizePlaylist(saved)
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

function normalizePlaylist(saved: Partial<PlaylistConfig> = {}): PlaylistConfig {
  const mode = saved.mode === 'playlist' ? 'playlist' : 'single'
  const items = saved.items ?? []
  return { ...DEFAULT_PLAYLIST, ...saved, mode, items,
    folderPath: typeof saved.folderPath === 'string' ? saved.folderPath : playlistFolder(items),
    currentIndex: Math.max(0, Math.min(saved.currentIndex ?? 0, items.length - 1)),
    isPlaying: mode === 'playlist' && items.some(item => item.status === 'ready') && saved.isPlaying === true,
    durationMode: isDurationMode(saved.durationMode) ? saved.durationMode : 'fixed',
    playbackMode: isPlaybackMode(saved.playbackMode) ? saved.playbackMode : 'loop' }
}

function resetConvertingItems(pl: PlaylistConfig): PlaylistConfig {
  return { ...pl, items: pl.items.map(item => item.status === 'converting' ? { ...item, status: 'idle' } : item) }
}

// Preserve the pre-isolation library before an old look can replace it. Old
// looks contain no evidence of which playlist or conversion settings they used.
if (readThemes().some(theme => !theme.settings.playlist)) {
  for (const file of [THEMES_PATH, PLAYLIST_PATH, CONVERSION_SETTINGS_PATH]) {
    const backup = `${file}.pre-collections.bak`
    if (existsSync(file) && !existsSync(backup)) copyFileSync(file, backup)
  }
}

function playlistFolder(items: PlaylistItem[]): string {
  if (!items.length) return ''
  let folder = path.dirname(items[0].sourcePath)
  for (const item of items) {
    while (path.relative(folder, item.sourcePath).startsWith('..') && path.dirname(folder) !== folder) folder = path.dirname(folder)
  }
  return folder
}

// Recover only legacy video looks whose saved GIF identifies an item in the
// preserved playlist. Image Collections keep their own empty Single state.
const recoveryFile = `${PLAYLIST_PATH}.pre-collections.bak`
let recoveryPlaylist = readPlaylist()
if (existsSync(recoveryFile)) {
  try { recoveryPlaylist = normalizePlaylist(JSON.parse(readFileSync(recoveryFile, 'utf8'))) } catch {}
}
const collectionLibrary = readThemes()
let recovered = false
for (const theme of collectionLibrary) {
  const index = recoveryPlaylist.items.findIndex(item => PLAYLIST_VIDEO_RE.test(item.sourcePath)
    && (item.gifPath === theme.settings.defaults.backgroundImage || item.sourcePath === theme.settings.defaults.backgroundImage))
  if (!theme.settings.playlist && index >= 0) {
    theme.settings.playlist = { ...resetConvertingItems(recoveryPlaylist), mode: 'playlist', isPlaying: false,
      currentIndex: index, folderPath: recoveryPlaylist.folderPath || playlistFolder(recoveryPlaylist.items) }
    theme.settings.conversionSettings ??= { ...DEFAULT_GIF_CONVERSION }
    recovered = true
  }
  for (const item of theme.settings.playlist?.items ?? []) {
    if (PLAYLIST_VIDEO_RE.test(item.sourcePath) && item.gifPath) gifConverter.registerLegacy(item.sourcePath, item.gifPath)
  }
}
for (const item of [...readPlaylist().items, ...recoveryPlaylist.items]) {
  if (PLAYLIST_VIDEO_RE.test(item.sourcePath) && item.gifPath) gifConverter.registerLegacy(item.sourcePath, item.gifPath)
}
// Old playlists did not record per-clip quality; do not assume their GIFs
// match a non-default setting saved by an older controller.
const savedQuality = readConversionSettings()
if (savedQuality.fps !== DEFAULT_GIF_CONVERSION.fps || savedQuality.width !== DEFAULT_GIF_CONVERSION.width) {
  const playlist = readPlaylist()
  const items = playlist.items.map(item => PLAYLIST_VIDEO_RE.test(item.sourcePath) && !item.conversionSettings
    ? { ...item, conversionSettings: savedQuality, status: 'idle' as const, error: null } : item)
  if (items.some((item, index) => item !== playlist.items[index])) writePlaylist({ ...playlist, items })
}
if (recovered) writeThemes(collectionLibrary)

function broadcastPlaylist(pl: PlaylistConfig): void {
  broadcast({ type: 'playlist-update', playlist: pl })
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
  if (readPlaylist().mode !== 'playlist') return
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
  if (current.mode !== 'playlist' || !current.isPlaying || current.items.length === 0) return
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
  if (pl.mode !== 'playlist' || !pl.isPlaying || pl.items.length === 0) return
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
  const pl = resetConvertingItems(readPlaylist())
  if (existsSync(PLAYLIST_PATH)) writePlaylist(pl)
  if (pl.isPlaying && pl.items.length > 0) scheduleAdvance(pl)
}())

let watchDebounce: ReturnType<typeof setTimeout> | null = null
// Windows Terminal saves by replacing the file; watch its directory to keep
// receiving changes after an atomic rename (including our own writes).
watch(path.dirname(WT_SETTINGS_PATH), (_event, filename) => {
  if (filename && filename.toString() !== path.basename(WT_SETTINGS_PATH)) return
  if (watchDebounce) clearTimeout(watchDebounce)
  watchDebounce = setTimeout(() => {
    reloadSettingsFromDisk()
    try {
      broadcast({ type: 'settings-update', settings: cachedSettings })
    } catch {}
  }, 200)
})

function addCors(headers: HeadersInit = {}): Headers {
  const h = new Headers(headers as Record<string, string>)
  h.set('Access-Control-Allow-Origin', '*')
  h.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
  h.set('Access-Control-Allow-Headers', 'Content-Type, X-Studio-Revision')
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

  if (method === 'GET' && pathname === '/api/health') return json({ app: 'terminal-theme-studio', pid: process.pid, projectDir: import.meta.dir })

  if (method === 'GET' && pathname === '/api/settings') {
    return json(readSettings())
  }

  if (method === 'GET' && pathname === '/api/appearance') return json({ ...liveAppearanceBridge.status, native: nativeStatus() })

  if (method === 'GET' && pathname === '/api/glass') return json(glassBridge.status)

  if (method === 'GET' && pathname === '/api/terminal') {
    if (process.platform === 'win32') {
      try {
        readSettings()
        return json({ backend: 'windows-terminal', state: 'connected', settingsPath: WT_SETTINGS_PATH })
      } catch (error) {
        return json({ backend: 'windows-terminal', state: 'error', error: String(error), settingsPath: WT_SETTINGS_PATH })
      }
    }
    return json(terminalBridge.status)
  }

  if (method === 'GET' && pathname === '/api/preview/source') {
    const requested = url.searchParams.get('path') ?? ''
    const item = readPlaylist().items.find(item => item.gifPath === requested || item.sourcePath === requested)
    if (item) return json({ path: item.sourcePath })
    const knownSource = gifConverter.sourceFor(requested)
    if (knownSource) return json({ path: knownSource })
    // Keep the original source of single-mode conversions across page reloads.
    if (path.dirname(path.resolve(requested)) === path.resolve(CONVERTED_GIF_DIR) && /\.gif$/i.test(requested)) {
      try {
        const metadata = JSON.parse(readFileSync(`${requested}.json`, 'utf8'))
        if (typeof metadata.sourcePath === 'string' && PLAYLIST_VIDEO_RE.test(metadata.sourcePath)) return json({ path: metadata.sourcePath })
      } catch { /* Older cached GIFs have no source metadata. */ }
    }
    return json({ path: requested })
  }

  // Read mutation bodies before touching state, then reject work from a replaced
  // Collection (including requests whose body arrived after the switch).
  const requestRevision = req.headers.get('X-Studio-Revision') ?? studioRevision
  let requestBody: any = {}
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
    const editsCollection = /^\/api\/(settings|playlist|themes|convert-gif|conversion-settings)(\/|$)/.test(pathname)
    if (editsCollection && req.headers.has('Sec-Fetch-Site') && !req.headers.has('X-Studio-Revision')) {
      return json({ error: 'Refresh Theme Studio to load Collection isolation before editing' }, 409)
    }
    if (req.body) {
      try { requestBody = await req.json() }
      catch { return json({ error: 'invalid JSON body' }, 400) }
    }
    if (requestRevision !== studioRevision) return json({ error: 'Collection changed; discard the previous edit' }, 409)
  }

  if (method === 'GET' && pathname === '/api/state') return json(studioState())

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
    body = requestBody
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
    if (origin && ![url.origin, 'http://localhost:5555', 'http://127.0.0.1:5555', `http://localhost:${process.env.PORT ?? 3001}`].includes(origin)) {
      return json({ error: 'Open the terminal from the local Theme Studio page' }, 403)
    }
    if (req.headers.get('x-theme-studio') !== 'native-terminal') return json({ error: 'Native launch header required' }, 403)
    try { return json(await openNativeTerminal(WT_SETTINGS_PATH)) }
    catch (error) { return json({ error: String(error) }, 500) }
  }

  if (method === 'PATCH' && pathname === '/api/settings') {
    const body: { defaults?: Partial<ProfileDefaults>; scheme?: ColorScheme } = requestBody
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
      if (typeof body.defaults?.backgroundImage === 'string') body.defaults.backgroundImage = normalizeLocalPath(body.defaults.backgroundImage)
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
    const body: { name: string } = requestBody
    if (!body.name?.trim()) return json({ error: 'name required' }, 400)
    try {
      const settings = readSettings()
      const scheme = getActiveScheme(settings)
      const theme: SavedTheme = {
        name: body.name.trim(),
        savedAt: new Date().toISOString(),
        settings: { defaults: settings.profiles.defaults, scheme,
          schemes: settings.schemes.filter(candidate => activeSchemeNames(settings.profiles.defaults).includes(candidate.name)),
          playlist: resetConvertingItems(readPlaylist()), conversionSettings: readConversionSettings() }
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
      settings = { ...settings, profiles: { ...settings.profiles, defaults: theme.settings.defaults } }
      if (theme.settings.schemes) {
        // Absence is meaningful: a saved built-in palette must not inherit a
        // same-named custom override introduced by a different Collection.
        const names = activeSchemeNames(theme.settings.defaults)
        settings = { ...settings, schemes: settings.schemes.filter(scheme => !names.includes(scheme.name)) }
      }
      for (const scheme of theme.settings.schemes ?? (theme.settings.scheme ? [theme.settings.scheme] : [])) settings = upsertScheme(settings, scheme)
      // Legacy looks did not record playlist state. Restore them as Single,
      // never borrow the currently active Collection's playlist or quality.
      const playlist = resetConvertingItems(normalizePlaylist(theme.settings.playlist))
      const conversionSettings = validateGifConversionSettings(theme.settings.conversionSettings ?? DEFAULT_GIF_CONVERSION)
      resetSession()
      writePlaylist(playlist)
      writeConversionSettings(conversionSettings)
      writeSettings(settings)
      scheduleAdvance(playlist)
      const session = studioState()
      broadcast({ type: 'session-update', session })
      return json({ ok: true, session })
    } catch (err) {
      return json({ error: 'write failed' }, 500)
    }
  }

  if (method === 'GET' && pathname === '/api/conversion-settings') {
    try { return json(readConversionSettings()) }
    catch { return json({ error: 'Cannot read conversion-settings.json. Check the saved FPS and width.' }, 500) }
  }

  if (method === 'PUT' && pathname === '/api/conversion-settings') {
    let settings: GifConversionSettings
    try { settings = validateGifConversionSettings(requestBody) }
    catch (error) { return json({ error: error instanceof Error ? error.message : 'Invalid conversion settings' }, 400) }
    try {
      const playlist = readPlaylist()
      const items = playlist.items.map(item => {
        if (!PLAYLIST_VIDEO_RE.test(item.sourcePath)) return item
        const quality = item.conversionSettings
        if (quality && quality.fps === settings.fps && quality.width === settings.width) return item
        return { ...item, conversionSettings: settings, status: 'idle' as const, error: null }
      })
      writeConversionSettings(settings)
      if (items.some((item, index) => item !== playlist.items[index])) {
        const updated = { ...playlist, items }
        writePlaylist(updated)
        if (updated.mode === 'playlist') scheduleAdvance(updated)
        broadcastPlaylist(updated)
      }
      broadcast({ type: 'conversion-settings-update', conversionSettings: settings })
      return json(settings)
    } catch { return json({ error: 'Could not save conversion settings' }, 500) }
  }

  if (method === 'POST' && pathname === '/api/convert-gif') {
    let body: { path: string; settings?: GifConversionSettings }
    body = requestBody

    const videoPath = typeof body.path === 'string' ? normalizeLocalPath(body.path) : ''
    if (!videoPath) return json({ error: 'path required' }, 400)
    if (!existsSync(videoPath)) return json({ error: 'file not found' }, 404)
    if (!/\.(mp4|webm|ogg|mov|avi|mkv)$/i.test(videoPath)) {
      return json({ error: 'not a video file' }, 400)
    }
    let conversionSettings: GifConversionSettings
    try { conversionSettings = validateGifConversionSettings(body.settings ?? readConversionSettings()) }
    catch { return json({ error: 'Cannot read GIF conversion settings. Save them again in Background.' }, 500) }

    const signal = AbortSignal.any([req.signal, conversionSession.signal])
    try {
      return json(await gifConverter.convert(videoPath, conversionSettings, signal))
    } catch (err: unknown) {
      return json({ error: err instanceof Error ? err.message : 'Could not prepare clip' }, signal.aborted ? 409 : 500)
    }
  }

  if (method === 'GET' && pathname === '/api/media/variants') {
    const input = normalizeLocalPath(url.searchParams.get('path') ?? '')
    const sourcePath = gifConverter.sourceFor(input) ?? input
    if (!sourcePath || !PLAYLIST_VIDEO_RE.test(sourcePath)) return json({ sourcePath, variants: [] })
    return json({ sourcePath, variants: await gifConverter.variants(sourcePath) })
  }

  if (method === 'GET' && pathname === '/api/file') {
    const filePath = normalizeLocalPath(url.searchParams.get('path') ?? '')
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
    body = requestBody
    const pl = readPlaylist()
    let updated: PlaylistConfig = normalizePlaylist({
      ...pl,
      ...body,
      durationMode: isDurationMode(body.durationMode) ? body.durationMode : pl.durationMode,
      playbackMode: isPlaybackMode(body.playbackMode) ? body.playbackMode : pl.playbackMode,
    })
    const modeChanged = updated.mode !== pl.mode
    if (modeChanged && pl.mode === 'single') updated.singleBackgroundImage = readSettings().profiles.defaults.backgroundImage ?? null
    if (modeChanged) { resetSession(); updated = resetConvertingItems(updated) }
    writePlaylist(updated)
    if (modeChanged && updated.mode === 'single' && updated.singleBackgroundImage !== undefined) {
      writeSettings(mergeDefaults(readSettings(), { backgroundImage: updated.singleBackgroundImage }))
    }
    if (modeChanged && updated.mode === 'playlist') {
      const item = updated.items[updated.currentIndex]
      if (item?.status === 'ready' && item.gifPath) applyItemBackground(item.gifPath)
    }
    broadcastPlaylist(updated)
    if (!updated.isPlaying) stopPlaylistTimer()
    else scheduleAdvance(updated)
    if (modeChanged) {
      const session = studioState()
      broadcast({ type: 'session-update', session })
      return json({ playlist: updated, session })
    }
    return json({ playlist: updated })
  }

  if (method === 'POST' && pathname === '/api/playlist/items') {
    let body: { sourcePath: string }
    body = requestBody
    const sourcePath = typeof body.sourcePath === 'string' ? normalizeLocalPath(body.sourcePath) : ''
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
    body = requestBody
    const folderPath = typeof body.folderPath === 'string' ? normalizeLocalPath(body.folderPath) : ''
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
      folderPath,
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
    if (pl.mode !== 'playlist') return json({ error: 'Playlist mode is not active' }, 409)
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
    body = requestBody
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
    body = requestBody
    const pl = readPlaylist()
    const idx = pl.items.findIndex(i => i.id === id)
    if (idx === -1) return json({ error: 'item not found' }, 404)
    if (body.conversionSettings) {
      try { body.conversionSettings = validateGifConversionSettings(body.conversionSettings) }
      catch (error) { return json({ error: String(error) }, 400) }
      if (body.status !== 'ready') { body.status = 'idle'; body.error = null }
    }
    if (requestBody.expectedConversion && JSON.stringify(requestBody.expectedConversion) !== JSON.stringify(pl.items[idx].conversionSettings ?? readConversionSettings())) {
      return json({ error: 'Clip quality changed' }, 409)
    }
    delete requestBody.expectedConversion
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
    open(ws) { clients.add(ws); ws.send(JSON.stringify({ type: 'session-update', session: studioState() })) },
    close(ws) { clients.delete(ws) },
    message() {}
  }
})

console.log(`Server running at http://localhost:${server.port}`)
console.log(`Settings: ${WT_SETTINGS_PATH}`)
