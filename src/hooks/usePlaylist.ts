import { useEffect, useCallback } from 'react'
import type { PlaylistConfig, PlaylistItem } from '../types'
import type { StudioRequest } from './useSettings'
import { DEFAULT_GIF_CONVERSION, type GifConversionSettings } from '../lib/gif-conversion'

const VIDEO_RE = /\.(mp4|webm|ogg|mov|avi|mkv)$/i
const DEFAULT_CONFIG: PlaylistConfig = {
  mode: 'single', items: [], isPlaying: false, currentIndex: 0, defaultDurationSec: 10, durationMode: 'fixed', playbackMode: 'loop',
}

export function usePlaylist(config: PlaylistConfig | undefined, request: StudioRequest, defaults = DEFAULT_GIF_CONVERSION) {
  const playlist = config ?? DEFAULT_CONFIG
  const candidate = playlist.mode === 'playlist'
    ? playlist.items.find(item => (item.status === 'idle' || item.status === 'converting') && VIDEO_RE.test(item.sourcePath)) : undefined
  const id = candidate?.id
  const sourcePath = candidate?.sourcePath
  const fps = (candidate?.conversionSettings ?? defaults).fps
  const width = (candidate?.conversionSettings ?? defaults).width

  useEffect(() => {
    if (!id || !sourcePath) return
    const controller = new AbortController()
    const settings: GifConversionSettings = { fps, width }
    const update = (body: Partial<PlaylistItem>) => request(`/api/playlist/items/${id}`, {
      method: 'PATCH', body: JSON.stringify({ ...body, expectedConversion: settings }), signal: controller.signal,
    })
    void (async () => {
      try {
        await update({ status: 'converting' })
        const data = await request('/api/convert-gif', {
          method: 'POST', body: JSON.stringify({ path: sourcePath, settings }), signal: controller.signal,
        })
        if (!controller.signal.aborted) await update({ status: 'ready', gifPath: data.gifPath, conversionSettings: settings, error: null })
      } catch (error) {
        if (!controller.signal.aborted && (error as Error).name !== 'AbortError') {
          await update({ status: 'error', error: (error as Error).message }).catch(() => {})
        }
      }
    })()
    return () => controller.abort()
  }, [id, sourcePath, fps, width, request])

  const command = useCallback(async (route: string, body?: unknown, method = 'POST', transition = false) => {
    try { return await request(route, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, transition) }
    catch (error) { return { error: (error as Error).name === 'AbortError' ? 'Collection changed' : (error as Error).message } }
  }, [request])
  const patchConfig = (updates: Partial<PlaylistConfig>) => command('/api/playlist', updates, 'PATCH', updates.mode !== undefined && updates.mode !== playlist.mode)
  const updateItem = (id: string, updates: Partial<PlaylistItem>) => command(`/api/playlist/items/${id}`, updates, 'PATCH')
  const moveItem = (id: string, direction: 'up' | 'down') => {
    const index = playlist.items.findIndex(item => item.id === id)
    const target = direction === 'up' ? index - 1 : index + 1
    if (index < 0 || target < 0 || target >= playlist.items.length) return
    const items = [...playlist.items]
    ;[items[index], items[target]] = [items[target], items[index]]
    const currentIndex = playlist.currentIndex === index ? target : playlist.currentIndex === target ? index : playlist.currentIndex
    return patchConfig({ items, currentIndex })
  }

  return { playlist, loading: !config, patchConfig, updateItem, moveItem,
    importFolder: (folderPath: string) => command('/api/playlist/import-folder', { folderPath }),
    removeItem: (id: string) => command(`/api/playlist/items/${id}`, undefined, 'DELETE'),
    play: () => command('/api/playlist/play'), pause: () => command('/api/playlist/pause'),
    next: () => command('/api/playlist/next'), prev: () => command('/api/playlist/prev'),
    jumpTo: (index: number) => command('/api/playlist/jump', { index }),
  }
}

export type UsePlaylistReturn = ReturnType<typeof usePlaylist>
