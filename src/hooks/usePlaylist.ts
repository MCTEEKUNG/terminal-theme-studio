import { useState, useEffect, useRef, useCallback } from 'react'
import type { PlaylistConfig, PlaylistItem } from '../types'

const WS_URL = `ws://${location.host}/ws`
const VIDEO_RE = /\.(mp4|webm|ogg|mov|avi|mkv)$/i

const DEFAULT_CONFIG: PlaylistConfig = {
  mode: 'single', items: [], isPlaying: false, currentIndex: 0, defaultDurationSec: 10, durationMode: 'fixed', playbackMode: 'loop',
}

export function usePlaylist() {
  const [playlist, setPlaylist] = useState<PlaylistConfig>(DEFAULT_CONFIG)
  const [loading, setLoading] = useState(true)
  const skipWsRef = useRef(false)
  const convertingIdRef = useRef<string | null>(null)

  // Initial fetch — reset any stuck 'converting' items from a previous session
  useEffect(() => {
    fetch('/api/playlist')
      .then(r => r.json())
      .then((data: PlaylistConfig) => {
        const hasStuck = data.items.some(i => i.status === 'converting')
        if (hasStuck) {
          const items = data.items.map(i =>
            i.status === 'converting' ? { ...i, status: 'idle' as const } : i
          )
          const fixed = { ...data, items }
          setPlaylist(fixed)
          fetch('/api/playlist', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items }),
          }).catch(() => {})
        } else {
          setPlaylist(data)
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  // WebSocket sync for playlist-update events
  useEffect(() => {
    let cancelled = false
    let ws: WebSocket
    let retryDelay = 1000

    function connect() {
      if (cancelled) return
      ws = new WebSocket(WS_URL)
      ws.onopen = () => { retryDelay = 1000 }
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data as string)
          if (msg.type === 'playlist-update') {
            if (skipWsRef.current) { skipWsRef.current = false; return }
            setPlaylist(msg.playlist)
          }
        } catch {}
      }
      ws.onclose = () => {
        if (cancelled) return
        retryDelay = Math.min(retryDelay * 2, 5000)
        setTimeout(connect, retryDelay)
      }
    }
    connect()
    return () => { cancelled = true; ws?.close() }
  }, [])

  // Auto-convert idle video items sequentially (one at a time)
  useEffect(() => {
    if (convertingIdRef.current) return
    const idleVideo = playlist.items.find(
      i => i.status === 'idle' && VIDEO_RE.test(i.sourcePath)
    )
    if (!idleVideo) return

    const id = idleVideo.id
    convertingIdRef.current = id

    // Optimistically mark converting in local state
    skipWsRef.current = true
    setPlaylist(prev => ({
      ...prev,
      items: prev.items.map(i => i.id === id ? { ...i, status: 'converting' as const } : i),
    }))
    fetch(`/api/playlist/items/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'converting' }),
    }).catch(() => {})

    fetch('/api/convert-gif', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: idleVideo.sourcePath }),
    })
      .then(r => r.json())
      .then((data: { gifPath?: string; durationSec?: number; error?: string }) => {
        convertingIdRef.current = null
        const patch = data.gifPath
          ? {
              status: 'ready' as const,
              gifPath: data.gifPath,
              error: null,
            }
          : {
              status: 'error' as const,
              error: data.error === 'ffmpeg_missing'
                ? 'ffmpeg not found — install from ffmpeg.org'
                : (data.error ?? 'Conversion failed'),
            }
        return fetch(`/api/playlist/items/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        }).then(r => r.json())
      })
      .then((result: { playlist?: PlaylistConfig }) => {
        if (result?.playlist) setPlaylist(result.playlist)
      })
      .catch(() => {
        convertingIdRef.current = null
        fetch(`/api/playlist/items/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'error', error: 'Network error' }),
        })
          .then(r => r.json())
          .then((result: { playlist?: PlaylistConfig }) => {
            if (result?.playlist) setPlaylist(result.playlist)
          })
          .catch(() => {})
      })
  }, [playlist.items])

  const patchConfig = useCallback(async (updates: Partial<PlaylistConfig>) => {
    const patch = updates.mode === 'single' ? { ...updates, isPlaying: false } : updates
    skipWsRef.current = true
    setPlaylist(prev => ({ ...prev, ...patch }))
    await fetch('/api/playlist', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).catch(() => {})
  }, [])

  const importFolder = useCallback(async (folderPath: string) => {
    const res = await fetch('/api/playlist/import-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath }),
    })
    const data: { playlist?: PlaylistConfig; added?: number; skipped?: number; scanned?: number; removedDuplicates?: number; error?: string } = await res.json()
    if (data.playlist) setPlaylist(data.playlist)
    return data
  }, [])

  const updateItem = useCallback(async (id: string, updates: Partial<PlaylistItem>) => {
    skipWsRef.current = true
    setPlaylist(prev => ({
      ...prev,
      items: prev.items.map(i => i.id === id ? { ...i, ...updates } : i),
    }))
    await fetch(`/api/playlist/items/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    }).catch(() => {})
  }, [])

  const removeItem = useCallback(async (id: string) => {
    const res = await fetch(`/api/playlist/items/${id}`, { method: 'DELETE' })
    const data: { playlist?: PlaylistConfig } = await res.json()
    if (data.playlist) {
      skipWsRef.current = true
      setPlaylist(data.playlist)
    }
  }, [])

  const moveItem = useCallback(async (id: string, direction: 'up' | 'down') => {
    let reordered: PlaylistConfig | null = null
    setPlaylist(prev => {
      const idx = prev.items.findIndex(i => i.id === id)
      if (idx === -1) return prev
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1
      if (swapIdx < 0 || swapIdx >= prev.items.length) return prev
      const items = [...prev.items]
      ;[items[idx], items[swapIdx]] = [items[swapIdx], items[idx]]
      let currentIndex = prev.currentIndex
      if (currentIndex === idx) currentIndex = swapIdx
      else if (currentIndex === swapIdx) currentIndex = idx
      reordered = { ...prev, items, currentIndex }
      return reordered
    })
    if (reordered) {
      await fetch('/api/playlist', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: (reordered as PlaylistConfig).items,
          currentIndex: (reordered as PlaylistConfig).currentIndex,
        }),
      }).catch(() => {})
    }
  }, [])

  const play = useCallback(async () => {
    const res = await fetch('/api/playlist/play', { method: 'POST' })
    const data: { playlist?: PlaylistConfig; error?: string } = await res.json()
    if (data.playlist) {
      skipWsRef.current = true
      setPlaylist(data.playlist)
    }
    return data
  }, [])

  const pause = useCallback(async () => {
    skipWsRef.current = true
    setPlaylist(prev => ({ ...prev, isPlaying: false }))
    await fetch('/api/playlist/pause', { method: 'POST' }).catch(() => {})
  }, [])

  const next = useCallback(async () => {
    const res = await fetch('/api/playlist/next', { method: 'POST' })
    const data: { playlist?: PlaylistConfig } = await res.json()
    if (data.playlist) {
      skipWsRef.current = true
      setPlaylist(data.playlist)
    }
  }, [])

  const prev = useCallback(async () => {
    const res = await fetch('/api/playlist/prev', { method: 'POST' })
    const data: { playlist?: PlaylistConfig } = await res.json()
    if (data.playlist) {
      skipWsRef.current = true
      setPlaylist(data.playlist)
    }
  }, [])

  const jumpTo = useCallback(async (index: number) => {
    const res = await fetch('/api/playlist/jump', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index }),
    })
    const data: { playlist?: PlaylistConfig } = await res.json()
    if (data.playlist) {
      skipWsRef.current = true
      setPlaylist(data.playlist)
    }
  }, [])

  const retryItem = useCallback(async (id: string) => {
    skipWsRef.current = true
    setPlaylist(prev => ({
      ...prev,
      items: prev.items.map(i => i.id === id
        ? { ...i, status: 'idle' as const, error: undefined }
        : i
      ),
    }))
    await fetch(`/api/playlist/items/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'idle', error: null }),
    }).catch(() => {})
  }, [])

  return { playlist, loading, patchConfig, importFolder, updateItem, removeItem, moveItem, play, pause, next, prev, jumpTo, retryItem }
}

export type UsePlaylistReturn = ReturnType<typeof usePlaylist>
