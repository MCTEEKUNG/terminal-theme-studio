import { useState, useEffect, useRef, useCallback } from 'react'
import type { WTSettings, ProfileDefaults, ColorScheme } from '../types'

const WS_URL = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`

export function useSettings() {
  const [settings, setSettings] = useState<WTSettings | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const patchVersionRef = useRef(0)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skipWsRef = useRef(false)
  const pendingPatchRef = useRef<{ defaults?: Partial<ProfileDefaults>; scheme?: ColorScheme }>({})

  useEffect(() => {
    fetch('/api/settings')
      .then(r => { if (!r.ok) throw new Error('Settings unavailable'); return r.json() })
      .then(setSettings)
      .catch(() => setError('Cannot connect to server. Make sure you ran: bun run dev'))
  }, [])

  useEffect(() => {
    let cancelled = false
    let ws: WebSocket
    let retryDelay = 1000

    function connect() {
      if (cancelled) return
      ws = new WebSocket(WS_URL)
      ws.onopen = () => { retryDelay = 1000 }
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data as string) as { type: string; settings: WTSettings }
        if (msg.type === 'settings-update' && !skipWsRef.current) {
          setSettings(msg.settings)
        }
        skipWsRef.current = false
      }
      ws.onclose = () => {
        if (cancelled) return
        retryDelay = Math.min(retryDelay * 2, 5000)
        setTimeout(connect, retryDelay)
      }
    }
    connect()
    return () => {
      cancelled = true
      ws?.close()
    }
  }, [])

  const patch = useCallback((body: { defaults?: Partial<ProfileDefaults>; scheme?: ColorScheme }) => {
    setSaveState('saving')
    const version = ++patchVersionRef.current
    setSettings(prev => {
      if (!prev) return prev
      const next = { ...prev }
      if (body.defaults) {
        const merged: ProfileDefaults = { ...prev.profiles.defaults, ...body.defaults }
        if (body.defaults.unfocusedAppearance && prev.profiles.defaults.unfocusedAppearance) {
          merged.unfocusedAppearance = { ...prev.profiles.defaults.unfocusedAppearance, ...body.defaults.unfocusedAppearance }
        }
        if (body.defaults.font && prev.profiles.defaults.font) {
          merged.font = { ...prev.profiles.defaults.font, ...body.defaults.font }
        }
        next.profiles = { ...prev.profiles, defaults: merged }
      }
      if (body.scheme) {
        const idx = prev.schemes.findIndex(s => s.name === body.scheme!.name)
        next.schemes = idx >= 0
          ? prev.schemes.map((s, i) => i === idx ? body.scheme! : s)
          : [...prev.schemes, body.scheme!]
      }
      return next
    })

    const pending = pendingPatchRef.current
    pendingPatchRef.current = {
      ...pending, ...body,
      ...(body.defaults ? { defaults: {
        ...pending.defaults, ...body.defaults,
        ...(body.defaults.font ? { font: { ...pending.defaults?.font, ...body.defaults.font } } : {}),
      } } : {}),
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const updates = pendingPatchRef.current
      pendingPatchRef.current = {}
      skipWsRef.current = true
      fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      }).then(response => {
        if (!response.ok) throw new Error('Save failed')
        if (version === patchVersionRef.current) setSaveState('saved')
      }).catch(() => {
        pendingPatchRef.current = { ...updates, ...pendingPatchRef.current,
          defaults: { ...updates.defaults, ...pendingPatchRef.current.defaults } }
        skipWsRef.current = false
        if (version === patchVersionRef.current) setSaveState('error')
      })
    }, 150)
  }, [])

  const refetch = useCallback(() => {
    fetch('/api/settings')
      .then(r => { if (!r.ok) throw new Error('Settings unavailable'); return r.json() })
      .then(setSettings)
      .catch(() => {})
  }, [])

  return { settings, error, patch, refetch, saveState }
}
