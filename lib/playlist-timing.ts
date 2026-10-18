import { statSync } from 'fs'
import type { PlaylistConfig, PlaylistItem } from '../src/types'

export const isVideo = (file: string) => /\.(mp4|webm|ogg|mov|avi|mkv)$/i.test(file)
export const isDurationMode = (value: unknown): value is PlaylistConfig['durationMode'] =>
  value === 'fixed' || value === 'full-video'

// Cache metadata, never decode a video just to find its length. Replacing a
// source file invalidates its entry; failed probes can be retried next time.
const durations = new Map<string, { signature: string; seconds: Promise<number | null> }>()
export async function videoDuration(file: string): Promise<number | null> {
  try {
    const stat = statSync(file)
    const signature = `${stat.size}:${stat.mtimeMs}`
    const cached = durations.get(file)
    if (cached?.signature === signature) return cached.seconds
    const seconds = (async () => {
      const process = Bun.spawn(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1', file], { stdout: 'pipe', stderr: 'ignore' })
      const timeout = setTimeout(() => process.kill(), 5000)
      try {
        const output = await new Response(process.stdout).text()
        const code = await process.exited
        const value = Number(output.trim())
        return code === 0 && Number.isFinite(value) && value > 0 ? value : null
      } finally { clearTimeout(timeout) }
    })().catch(() => null)
    if (durations.size >= 256) durations.delete(durations.keys().next().value!)
    durations.set(file, { signature, seconds })
    const value = await seconds
    if (value === null) durations.delete(file)
    return value
  } catch { return null }
}

export async function playlistDuration(pl: PlaylistConfig, item: PlaylistItem): Promise<number | null> {
  if (pl.durationMode === 'full-video' && isVideo(item.sourcePath)) return videoDuration(item.sourcePath)
  return Number.isFinite(item.durationSec) && item.durationSec > 0 ? item.durationSec : pl.defaultDurationSec
}
