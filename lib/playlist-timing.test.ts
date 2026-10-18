import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { isDurationMode, playlistDuration } from './playlist-timing'
import type { PlaylistConfig, PlaylistItem } from '../src/types'

test('full video uses source duration, while fixed timing and images retain manual duration', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'studio-duration-'))
  const file = path.join(directory, 'video with spaces.mp4')
  const generate = (seconds: number) => {
    const process = Bun.spawnSync(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i',
      'color=c=black:s=16x16:r=10', '-t', String(seconds), '-c:v', 'libx264', file])
    expect(process.exitCode).toBe(0)
  }
  try {
    generate(1.4)
    const item = { sourcePath: file, durationSec: 50 } as PlaylistItem
    const config = { durationMode: 'full-video', defaultDurationSec: 10 } as PlaylistConfig
    expect(await playlistDuration(config, item)).toBeCloseTo(1.4, 2)
    expect(await playlistDuration({ ...config, durationMode: 'fixed' }, item)).toBe(50)
    expect(await playlistDuration(config, { ...item, sourcePath: '/image.png' })).toBe(50)
    // A replaced video must not keep its old cached length.
    generate(2.2)
    expect(await playlistDuration(config, item)).toBeCloseTo(2.2, 2)
    expect(await playlistDuration(config, { ...item, sourcePath: '/missing.mp4' })).toBeNull()
    expect(isDurationMode('full-video')).toBe(true)
    expect(isDurationMode('fixed')).toBe(true)
    expect(isDurationMode('invalid')).toBe(false)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
