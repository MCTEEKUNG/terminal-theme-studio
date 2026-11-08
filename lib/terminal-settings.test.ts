import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { createSettingsStore, normalizeLocalPath, parseSettings, resolveSettingsPath, windowsTerminalCommand } from './terminal-settings'
import { mergeDefaults, upsertScheme } from '../src/lib/settings'
import type { ColorScheme } from '../src/types'

test('detects Stable, Preview and unpackaged installs; explicit path wins and missing installs fail', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'studio-detection-'))
  const env = { LOCALAPPDATA: directory }
  const locations = [
    'Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json',
    'Packages/Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe/LocalState/settings.json',
    'Microsoft/Windows Terminal/settings.json',
  ].map(location => path.join(directory, location))
  try {
    expect(() => resolveSettingsPath(directory, env, 'win32')).toThrow('Windows Terminal settings not found')
    for (const file of [...locations].reverse()) {
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, '{}')
      expect(resolveSettingsPath(directory, env, 'win32')).toBe(file)
    }
    expect(resolveSettingsPath(directory, { ...env, WT_SETTINGS_PATH: locations[1] }, 'win32')).toBe(locations[1])
    expect(() => resolveSettingsPath(directory, { WT_SETTINGS_PATH: path.join(directory, 'missing.json') }, 'win32')).toThrow('does not exist')
    expect(resolveSettingsPath(directory, {}, 'linux')).toBe(path.join(directory, 'wt-settings.json'))
    expect(windowsTerminalCommand(locations[1])[0]).toBe(process.env.WT_EXECUTABLE || 'wtp.exe')
    expect(windowsTerminalCommand(locations[0])[0]).toBe(process.env.WT_EXECUTABLE || 'wt.exe')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('JSONC edits preserve comments, BOM, profiles, keybindings and the original backup', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'studio-settings-'))
  const file = path.join(directory, 'settings.json')
  const original = '\uFEFF{\r\n  // keep my settings\r\n  "profiles": {"defaults": {}, "list": [{"name":"PowerShell", "font":{"face":"Consolas"}}]},\r\n  "actions": [], // keep my shortcuts\r\n}\r\n'
  try {
    writeFileSync(file, original)
    const store = createSettingsStore(file)
    expect(store.read().schemes).toEqual([])
    store.write(mergeDefaults(store.read(), { opacity: 72, font: { face: 'Cascadia Code', size: 14, weight: 'normal' } }))
    let text = readFileSync(file, 'utf8')
    expect(text.startsWith('\uFEFF')).toBe(true)
    expect(text).toContain('// keep my settings')
    expect(text).toContain('// keep my shortcuts')
    expect(store.read().profiles.list).toEqual([{ name: 'PowerShell', font: { face: 'Consolas' } }])
    expect(store.read().profiles.defaults.opacity).toBe(72)
    const scheme = { name: 'New scheme', foreground: '#ffffff', background: '#000000' } as ColorScheme
    store.write(upsertScheme(store.read(), scheme))
    expect(store.read().schemes).toEqual([scheme])
    store.write(upsertScheme(store.read(), { ...scheme, background: '#123456' }))
    expect(store.read().schemes[0].background).toBe('#123456')
    expect(readFileSync(`${file}.theme-studio.bak`, 'utf8')).toBe(original)
    store.write(mergeDefaults(store.read(), { opacity: 80 }))
    expect(readFileSync(`${file}.theme-studio.bak`, 'utf8')).toBe(original)
    const replacement = store.read()
    store.write({ ...replacement, profiles: { ...replacement.profiles, defaults: { opacity: 90 } } })
    expect(store.read().profiles.defaults).toEqual({ opacity: 90 })
    expect(readFileSync(file, 'utf8')).toContain('// keep my shortcuts')
    const stale = store.read()
    text = readFileSync(file, 'utf8') + '// external editor\r\n'
    writeFileSync(file, text)
    expect(() => store.write(mergeDefaults(stale, { opacity: 50 }))).toThrow('changed on disk')
    expect(readFileSync(file, 'utf8')).toBe(text)
    writeFileSync(file, '{ broken')
    expect(() => store.read()).toThrow('Invalid settings JSON')
    expect(readFileSync(file, 'utf8')).toBe('{ broken')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('minimal settings are normalized in memory and invalid files are never replaced', () => {
  expect(parseSettings('{}').profiles.defaults).toEqual({})
  expect(parseSettings('{"profiles":{"defaults":{"font":{"face":"Consolas"}}}}').schemes).toEqual([])
  for (const text of ['null', '[]', '{"profiles":[]}', '{"schemes":{}}', '{"profiles":{"defaults":null}}']) {
    expect(() => parseSettings(text)).toThrow()
  }
  const directory = mkdtempSync(path.join(tmpdir(), 'studio-invalid-'))
  const file = path.join(directory, 'settings.json')
  try {
    writeFileSync(file, '{ broken')
    expect(() => createSettingsStore(file)).toThrow()
    expect(readFileSync(file, 'utf8')).toBe('{ broken')
    expect(existsSync(`${file}.theme-studio.bak`)).toBe(false)
  } finally { rmSync(directory, { recursive: true, force: true }) }
  expect(normalizeLocalPath(' "C:\\Users\\Test User\\ภาพ.gif" ')).toBe('C:\\Users\\Test User\\ภาพ.gif')
})
