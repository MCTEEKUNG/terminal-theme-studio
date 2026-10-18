import { expect, test } from 'bun:test'
import { nativeMediaPath } from './native-terminal'
import type { WTSettings, PlaylistConfig } from '../src/types'

test('native playback resolves converted GIFs to original video and preserves standalone GIFs', () => {
  const settings = { profiles: { defaults: { backgroundImage: '/cache/clip.gif' } }, schemes: [] } as unknown as WTSettings
  const playlist = { items: [{ sourcePath: '/media/clip.mp4', gifPath: '/cache/clip.gif' }] } as PlaylistConfig
  expect(nativeMediaPath(settings, playlist)).toBe('/media/clip.mp4')
  settings.profiles.defaults.backgroundImage = '/media/standalone.gif'
  expect(nativeMediaPath(settings, playlist)).toBe('/media/standalone.gif')
  settings.profiles.defaults.backgroundImage = null
  expect(nativeMediaPath(settings, playlist)).toBeNull()
})
