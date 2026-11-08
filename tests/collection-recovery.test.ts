import { test, expect } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

test('legacy video Collection recovers only its matching playlist and remembers folder/mode round trips', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'studio-recovery-'))
  const settingsPath = path.join(directory, 'settings.json')
  const photo = path.join(directory, 'photo.png')
  const items = [1, 2].map(n => ({ id: `clip-${n}`, sourcePath: path.join(directory, `clip-${n}.mp4`),
    gifPath: path.join(directory, `clip-${n}.gif`), status: 'ready', durationSec: 8 }))
  const saved = [
    { name: 'Photo', settings: { defaults: { backgroundImage: photo } } },
    { name: 'Videos', settings: { defaults: { backgroundImage: items[1].gifPath, backgroundImageOpacity: 0.3 } } },
  ]
  writeFileSync(settingsPath, JSON.stringify({ profiles: { defaults: { backgroundImage: photo }, list: [] } }))
  writeFileSync(path.join(directory, 'themes.json'), JSON.stringify(saved))
  writeFileSync(path.join(directory, 'playlist.json'), JSON.stringify({ mode: 'single', items: [] }))
  writeFileSync(path.join(directory, 'playlist.json.pre-collections.bak'), JSON.stringify({ mode: 'single', items, durationMode: 'full-video', playbackMode: 'shuffle' }))
  const child = Bun.spawn([process.execPath, path.join(import.meta.dir, '../server.ts')], {
    env: { ...process.env, PORT: '0', WT_SETTINGS_PATH: settingsPath, THEME_STUDIO_DATA_DIR: directory }, stdout: 'pipe', stderr: 'pipe',
  })
  const stderr = new Response(child.stderr).text()
  try {
    const reader = child.stdout.getReader()
    let output = ''
    while (!output.includes('http://localhost:')) {
      const { done, value } = await reader.read()
      if (done) throw new Error(await stderr)
      output += new TextDecoder().decode(value)
    }
    const base = `http://127.0.0.1:${output.match(/localhost:(\d+)/)![1]}`
    const request = async (route: string, body?: object, method = 'POST') => {
      const response = await fetch(base + route, body ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
      expect(response.ok).toBe(true)
      return response.json()
    }
    const recovered = await request('/api/themes')
    expect(recovered[0]).toEqual(saved[0])
    expect(recovered[1].settings.playlist).toMatchObject({ mode: 'playlist', items, currentIndex: 1, isPlaying: false, folderPath: directory })
    expect(JSON.parse(readFileSync(`${settingsPath}`, 'utf8')).profiles.defaults.backgroundImage).toBe(photo)
    await request('/api/themes/Videos/apply', {})
    expect((await request('/api/playlist')).items).toEqual(items)
    await request('/api/playlist', { mode: 'single' }, 'PATCH')
    await request('/api/settings', { defaults: { backgroundImage: photo } }, 'PATCH')
    await request('/api/playlist', { mode: 'playlist' }, 'PATCH')
    expect((await request('/api/playlist')).folderPath).toBe(directory)
    expect((await request('/api/settings')).profiles.defaults.backgroundImage).toBe(items[1].gifPath)
    await request('/api/playlist', { mode: 'single' }, 'PATCH')
    expect((await request('/api/settings')).profiles.defaults.backgroundImage).toBe(photo)
    await request('/api/themes/Photo/apply', {})
    expect((await request('/api/playlist')).items).toEqual([])
    expect((await request('/api/settings')).profiles.defaults.backgroundImage).toBe(photo)
  } finally { child.kill(); await child.exited; await stderr; rmSync(directory, { recursive: true, force: true }) }
}, 10000)
