import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync, statSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { createLiveAppearanceBridge, renderLiveAppearance } from './live-appearance'
import { validateAppearance } from './appearance'
import type { WTSettings } from '../src/types'

test('live styles preserve authored CSS, replace one managed block and avoid playlist-only writes', () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'studio-style-'))
  const cssPath = path.join(folder, 'appearance.css')
  try {
    writeFileSync(cssPath, '__WINDOW__ { color: __FOREGROUND__; }\n')
    writeFileSync(path.join(folder, 'appearance.json'), JSON.stringify({ closeButton: { size: 24, shape: 'circle' } }))
    const settings: WTSettings = { profiles: { defaults: { terminalPadding: 18, closeButtonAlignment: 'end' }, list: [] }, schemes: [] }
    const bridge = createLiveAppearanceBridge(true, folder)
    bridge.schedule(settings)
    expect(bridge.status.state).toBe('connected')
    const css = readFileSync(cssPath, 'utf8')
    expect(css).toContain('__WINDOW__ { color: __FOREGROUND__; }')
    expect(css).toContain('padding: 18px')
    expect(JSON.parse(readFileSync(path.join(folder, 'appearance.json'), 'utf8')).closeButton).toEqual({ size: 24, shape: 'circle', valign: 'end' })
    const stamp = statSync(cssPath).mtimeMs
    settings.profiles.defaults.backgroundImage = '/next-clip.mp4'
    bridge.schedule(settings)
    expect(statSync(cssPath).mtimeMs).toBe(stamp)
    settings.profiles.defaults.chromeFontSize = 18
    bridge.schedule(settings)
    const updated = readFileSync(cssPath, 'utf8')
    expect(updated.match(/BEGIN WEB APPEARANCE/g)?.length).toBe(1)
    settings.profiles.defaults.chromeFontSize = 999
    bridge.schedule(settings)
    expect(bridge.status.state).toBe('error')
    expect(readFileSync(cssPath, 'utf8')).toBe(updated)
  } finally { rmSync(folder, { recursive: true, force: true }) }
})

test('appearance validation rejects CSS injection and unsupported layout values', () => {
  expect(() => validateAppearance({ chromeHoverColor: '#fff; padding:900px' })).toThrow()
  expect(() => validateAppearance({ terminalPadding: -1 })).toThrow()
  expect(() => validateAppearance({ closeButtonAlignment: 'fill' as never })).toThrow()
  expect(renderLiveAppearance({ chromeHoverColor: '#ff0000', closeButtonHoverOpacity: 50 })).toContain('rgba(255,0,0,0.5)')
})
