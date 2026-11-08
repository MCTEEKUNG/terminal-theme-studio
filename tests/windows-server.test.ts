import { expect, test } from 'bun:test'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

test('controller reads/writes JSONC, broadcasts replacements and imports/converts Windows media paths', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'studio-integration-'))
  const settingsPath = path.join(directory, 'settings.json')
  const original = '{\n// retain this comment\n"profiles":{"defaults":{},"list":[{"name":"untouched"}]},\n"actions":[],\n}'
  writeFileSync(settingsPath, original)
  const child = Bun.spawn([process.execPath, path.join(import.meta.dir, '../server.ts')], {
    env: { ...process.env, PORT: '0', WT_SETTINGS_PATH: settingsPath, THEME_STUDIO_DATA_DIR: directory },
    stdout: 'pipe', stderr: 'pipe',
  })
  const stderr = new Response(child.stderr).text()
  let socket: WebSocket | undefined
  try {
    const reader = child.stdout.getReader()
    const ready = (async () => {
      let output = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) throw new Error(`Server exited: ${await stderr}`)
        output += new TextDecoder().decode(value)
        const match = output.match(/http:\/\/localhost:(\d+)/)
        if (match) return `http://127.0.0.1:${match[1]}`
      }
    })()
    let timer: ReturnType<typeof setTimeout>
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Server startup timed out')), 10000) })
    const base = await Promise.race([ready, timeout]).finally(() => clearTimeout(timer))
    const request = async (route: string, body?: unknown, method = 'POST') => {
      const response = await fetch(`${base}${route}`, body === undefined ? undefined : {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const data = await response.json()
      expect(response.ok).toBe(true)
      return data
    }
    expect((await request('/api/settings')).schemes).toEqual([])
    if (process.platform === 'win32') expect((await request('/api/terminal')).state).toBe('connected')
    await request('/api/settings', { defaults: { opacity: 75 } }, 'PATCH')
    expect((await request('/api/settings')).profiles.defaults.opacity).toBe(75)
    expect(readFileSync(settingsPath, 'utf8')).toContain('// retain this comment')
    expect(readFileSync(`${settingsPath}.theme-studio.bak`, 'utf8')).toBe(original)
    await request('/api/themes', { name: 'Windows test look' })
    expect((await request('/api/themes'))[0].settings.defaults.opacity).toBe(75)

    socket = new WebSocket(base.replace('http:', 'ws:') + '/ws')
    await new Promise<void>((resolve, reject) => { socket!.onopen = () => resolve(); socket!.onerror = reject })
    // Multiple replacements must remain visible through the directory watcher.
    for (const opacity of [66, 67]) {
      const changed = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Settings update not broadcast')), 5000)
        socket!.onmessage = event => {
          const message = JSON.parse(event.data)
          if (message.type === 'settings-update' && message.settings.profiles.defaults.opacity === opacity) {
            clearTimeout(timer)
            resolve()
          }
        }
      })
      writeFileSync(`${settingsPath}.replacement`, JSON.stringify({ profiles: { defaults: { opacity }, list: [{ name: 'untouched' }] }, actions: [] }))
      renameSync(`${settingsPath}.replacement`, settingsPath)
      await changed
    }
    const media = path.join(directory, 'media space ภาพ')
    mkdirSync(media)
    const video = path.join(media, 'clip ทดสอบ.mp4')
    const generated = Bun.spawnSync(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=16x16:r=10', '-t', '0.5', '-c:v', 'libx264', video])
    expect(generated.exitCode).toBe(0)
    await request('/api/playlist', { mode: 'playlist' }, 'PATCH')
    const imported = await request('/api/playlist/import-folder', { folderPath: `"${media}"` })
    expect(imported.added).toBe(1)
    expect(imported.playlist.folderPath).toBe(media)
    await request('/api/playlist', { mode: 'single' }, 'PATCH')
    await request('/api/playlist', { mode: 'playlist' }, 'PATCH')
    expect((await request('/api/playlist')).folderPath).toBe(media)
    expect((await request('/api/playlist')).items).toEqual(imported.playlist.items)
    expect((await request('/api/playlist/import-folder', { folderPath: media })).skipped).toBe(1)
    const converted = await request('/api/convert-gif', { path: `"${video}"` })
    expect(converted.gifPath.endsWith('.gif')).toBe(true)
    expect(readFileSync(converted.gifPath).subarray(0, 3).toString()).toBe('GIF')
    expect(converted.conversionSettings).toEqual({ fps: 12, width: 640 })
    const firstModified = statSync(converted.gifPath).mtimeMs
    const reused = await request('/api/convert-gif', { path: video })
    expect(reused.cached).toBe(true)
    expect(statSync(converted.gifPath).mtimeMs).toBe(firstModified)
    expect((await request(`/api/media/variants?path=${encodeURIComponent(video)}`)).variants).toContainEqual({
      fps: 12, width: 640, gifPath: converted.gifPath, bytes: statSync(converted.gifPath).size,
    })
    expect(await request('/api/conversion-settings')).toEqual({ fps: 12, width: 640 })
    const originalGif = readFileSync(converted.gifPath)
    const probe = (file: string) => {
      const result = Bun.spawnSync(['ffprobe', '-v', 'error', '-count_frames', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,nb_read_frames', '-of', 'json', file])
      expect(result.exitCode).toBe(0)
      return JSON.parse(result.stdout.toString()).streams[0]
    }
    expect(probe(converted.gifPath).width).toBe(640)

    // Concurrent identical work shares one encoding; missing outputs are rebuilt.
    const parallelSettings = { fps: 24, width: 128 }
    const simultaneous = await Promise.all([1, 2].map(() => request('/api/convert-gif', { path: video, settings: parallelSettings })))
    expect(simultaneous[0].cached).toBe(false)
    expect(simultaneous[1].cached).toBe(false)
    expect(simultaneous[0].gifPath).toBe(simultaneous[1].gifPath)
    rmSync(simultaneous[0].gifPath)
    expect((await request(`/api/media/variants?path=${encodeURIComponent(video)}`)).variants.some((v: { fps: number }) => v.fps === 24)).toBe(false)
    const rebuilt = await request('/api/convert-gif', { path: video, settings: parallelSettings })
    expect(rebuilt.cached).toBe(false)
    expect(rebuilt.gifPath).toBe(simultaneous[0].gifPath)

    // A changed source cannot reuse the old source fingerprint.
    const changedSource = path.join(media, 'changed.mp4')
    copyFileSync(video, changedSource)
    const oldTime = new Date(Date.now() - 60000)
    utimesSync(changedSource, oldTime, oldTime)
    const beforeChange = await request('/api/convert-gif', { path: changedSource, settings: parallelSettings })
    utimesSync(changedSource, new Date(), new Date())
    expect((await request(`/api/media/variants?path=${encodeURIComponent(changedSource)}`)).variants).toEqual([])
    const afterChange = await request('/api/convert-gif', { path: changedSource, settings: parallelSettings })
    expect(afterChange.cached).toBe(false)
    expect(afterChange.gifPath).not.toBe(beforeChange.gifPath)

    // A late result from an earlier FPS cannot overwrite a newer clip selection.
    const itemRoute = `/api/playlist/items/${imported.playlist.items[0].id}`
    await request(itemRoute, { conversionSettings: parallelSettings }, 'PATCH')
    const staleQuality = await fetch(`${base}${itemRoute}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedConversion: { fps: 12, width: 640 }, status: 'ready', gifPath: converted.gifPath }) })
    expect(staleQuality.status).toBe(409)
    expect((await request('/api/playlist')).items[0]).toMatchObject({ status: 'idle', conversionSettings: parallelSettings })

    await request('/api/conversion-settings', { fps: 30, width: 128 }, 'PUT')
    expect(JSON.parse(readFileSync(path.join(directory, 'conversion-settings.json'), 'utf8'))).toEqual({ fps: 30, width: 128 })
    expect((await request('/api/playlist')).items[0]).toMatchObject({ status: 'idle', conversionSettings: { fps: 30, width: 128 } })
    const oldResult = await fetch(`${base}${itemRoute}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedConversion: parallelSettings, status: 'ready', gifPath: rebuilt.gifPath }) })
    expect(oldResult.status).toBe(409)
    for (const invalid of [{ fps: 0, width: 640 }, { fps: 61, width: 640 }, { fps: '30', width: 640 },
      { fps: 30, width: 0 }, { fps: 30, width: 4096 }, { fps: 'source' }, null]) {
      const response = await fetch(`${base}/api/conversion-settings`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(invalid),
      })
      expect(response.status).toBe(400)
    }
    expect(await request('/api/conversion-settings')).toEqual({ fps: 30, width: 128 })
    const smoother = await request('/api/convert-gif', { path: video })
    expect(smoother.gifPath).not.toBe(converted.gifPath)
    expect(probe(smoother.gifPath)).toMatchObject({ width: 128, height: 128, nb_read_frames: '15' })
    await request(itemRoute, { expectedConversion: { fps: 30, width: 128 }, status: 'ready', gifPath: smoother.gifPath }, 'PATCH')
    expect((await request('/api/settings')).profiles.defaults.backgroundImage).toBe(smoother.gifPath)
    expect((await request(`/api/preview/source?path=${encodeURIComponent(smoother.gifPath)}`)).path).toBe(video)
    expect(readFileSync(converted.gifPath)).toEqual(originalGif)

    await request('/api/conversion-settings', { fps: 'source', width: 'source' }, 'PUT')
    const sourceQuality = await request('/api/convert-gif', { path: video })
    expect(sourceQuality.gifPath).not.toBe(smoother.gifPath)
    expect(probe(sourceQuality.gifPath)).toMatchObject({ width: 16, height: 16, nb_read_frames: '5' })
    expect(await request('/api/conversion-settings')).toEqual({ fps: 'source', width: 'source' })
    const oldPlaylist = await request('/api/playlist')
    const { conversionSettings: _legacyQuality, ...legacyItem } = oldPlaylist.items[0]
    await request('/api/playlist', { items: [legacyItem] }, 'PATCH')
    await request('/api/conversion-settings', { fps: 'source', width: 'source' }, 'PUT')
    expect((await request('/api/playlist')).items[0]).toMatchObject({ status: 'idle', conversionSettings: { fps: 'source', width: 'source' } })
    await request(`/api/playlist/items/${imported.playlist.items[0].id}`, { status: 'ready', gifPath: converted.gifPath }, 'PATCH')
    expect((await request('/api/settings')).profiles.defaults.backgroundImage).toBe(converted.gifPath)
    await request('/api/playlist/play', {})
    expect((await request('/api/playlist')).isPlaying).toBe(true)
    await request('/api/themes', { name: 'Playing playlist' })
    await request('/api/themes/Windows%20test%20look/apply', {})
    expect(await request('/api/playlist')).toMatchObject({ mode: 'single', isPlaying: false, items: [] })
    expect((await request('/api/settings')).profiles.defaults).toEqual({ opacity: 75 })
    expect(await request('/api/conversion-settings')).toEqual({ fps: 12, width: 640 })
    expect((await request('/api/settings')).profiles.defaults.opacity).toBe(75)
    expect((await request('/api/settings')).profiles.list).toEqual([{ name: 'untouched' }])
    await request('/api/themes/Playing%20playlist/apply', {})
    expect(await request('/api/playlist')).toMatchObject({ mode: 'playlist', isPlaying: true, items: imported.playlist.items.map((item: { id: string }) => ({ id: item.id, status: 'ready', gifPath: converted.gifPath })) })
    expect(await request('/api/conversion-settings')).toEqual({ fps: 'source', width: 'source' })
    await request('/api/themes/Windows%20test%20look/apply', {})

    // A short running timer must not repaint an image after switching away.
    await request('/api/playlist', { mode: 'playlist' }, 'PATCH')
    await request('/api/playlist/items', { sourcePath: path.join(media, 'first.png') })
    await request('/api/playlist/items', { sourcePath: path.join(media, 'second.png') })
    const clips = (await request('/api/playlist')).items.map((item: object) => ({ ...item, durationSec: 0.1 }))
    await request('/api/playlist', { items: clips, playbackMode: 'repeat-one' }, 'PATCH')
    await request('/api/playlist/play', {})
    const oldRevision = (await request('/api/state')).revision
    await request('/api/themes/Windows%20test%20look/apply', {})
    await Bun.sleep(350)
    expect((await request('/api/settings')).profiles.defaults).toEqual({ opacity: 75 })
    expect((await request('/api/playlist')).isPlaying).toBe(false)
    for (const [route, body, method] of [
      ['/api/settings', { defaults: { backgroundImage: 'late.gif' } }, 'PATCH'],
      ['/api/playlist', { mode: 'playlist', isPlaying: true, items: clips }, 'PATCH'],
      ['/api/conversion-settings', { fps: 60, width: 1920 }, 'PUT'],
    ] as const) {
      const response = await fetch(`${base}${route}`, { method,
        headers: { 'Content-Type': 'application/json', 'X-Studio-Revision': oldRevision }, body: JSON.stringify(body) })
      expect(response.status).toBe(409)
    }
    expect((await request('/api/settings')).profiles.defaults).toEqual({ opacity: 75 })

    const oldBrowser = await fetch(`${base}/api/settings`, { method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' }, body: JSON.stringify({ defaults: { opacity: 10 } }) })
    expect(oldBrowser.status).toBe(409)

    // Single mode cannot start playback or let playlist item edits repaint it.
    expect((await fetch(`${base}/api/playlist/play`, { method: 'POST' })).status).toBe(409)
    const inactive = await request('/api/playlist/items', { sourcePath: path.join(media, 'inactive.png') })
    await request(`/api/playlist/items/${inactive.playlist.items[0].id}`, { status: 'ready', gifPath: 'inactive.gif' }, 'PATCH')
    expect((await request('/api/settings')).profiles.defaults).toEqual({ opacity: 75 })
    await request('/api/playlist', { mode: 'single', isPlaying: true }, 'PATCH')
    expect((await request('/api/playlist')).isPlaying).toBe(false)

    // Legacy snapshots have no mode/quality: deterministic Single defaults.
    const themesFile = path.join(directory, 'themes.json')
    const saved = JSON.parse(readFileSync(themesFile, 'utf8'))
    writeFileSync(themesFile, JSON.stringify([...saved, { name: 'Legacy', settings: { defaults: { font: { face: 'Consolas' } } } }]))
    await request('/api/settings', { defaults: { font: { face: 'Other', size: 22, weight: 'bold' }, useAcrylic: true } }, 'PATCH')
    await request('/api/themes/Legacy/apply', {})
    expect((await request('/api/settings')).profiles.defaults).toEqual({ font: { face: 'Consolas' } })
    expect(await request('/api/playlist')).toMatchObject({ mode: 'single', isPlaying: false, items: [] })
    expect(await request('/api/conversion-settings')).toEqual({ fps: 12, width: 640 })

    await request('/api/settings', { defaults: { colorScheme: { dark: 'Campbell', light: 'Vintage' } } }, 'PATCH')
    await request('/api/themes', { name: 'Built-in pair' })
    await request('/api/settings', { scheme: { name: 'Campbell', background: '#123456' } }, 'PATCH')
    await request('/api/settings', { scheme: { name: 'Vintage', background: '#234567' } }, 'PATCH')
    await request('/api/themes', { name: 'Custom pair' })
    await request('/api/themes/Built-in%20pair/apply', {})
    expect((await request('/api/settings')).schemes).toEqual([])
    await request('/api/themes/Custom%20pair/apply', {})
    expect((await request('/api/settings')).schemes).toEqual([{ name: 'Campbell', background: '#123456' }, { name: 'Vintage', background: '#234567' }])

    // A real active FFmpeg and a queued conversion are both cancelled on apply.
    const longVideo = path.join(media, 'long.mp4')
    expect(Bun.spawnSync(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=32x32:r=10', '-t', '120', '-c:v', 'libx264', longVideo]).exitCode).toBe(0)
    await request('/api/conversion-settings', { fps: 60, width: 1920 }, 'PUT')
    const convert = () => fetch(`${base}/api/convert-gif`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: longVideo }) })
    const running = convert()
    const cache = path.join(directory, '.playlist-cache')
    const started = Date.now()
    while (!readdirSync(cache).some(name => name.endsWith('.tmp'))) {
      if (Date.now() - started > 5000) throw new Error('FFmpeg did not start')
      await Bun.sleep(10)
    }
    const queued = fetch(`${base}/api/convert-gif`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: longVideo, settings: { fps: 30, width: 1920 } }) })
    await Bun.sleep(30)
    await request('/api/themes/Windows%20test%20look/apply', {})
    expect((await running).status).toBe(409)
    expect((await queued).status).toBe(409)
    expect(readdirSync(cache).some(name => name.startsWith('long-'))).toBe(false)
    // New-session conversions still work after the old queue is drained.
    expect((await request('/api/convert-gif', { path: video })).gifPath).toBe(converted.gifPath)
  } finally {
    socket?.close()
    child.kill()
    await child.exited
    await stderr
    rmSync(directory, { recursive: true, force: true })
  }
}, 30000)
