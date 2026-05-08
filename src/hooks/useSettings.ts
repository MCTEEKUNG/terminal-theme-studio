import { useState, useEffect, useRef, useCallback } from 'react'
import type { WTSettings, ProfileDefaults, ColorScheme } from '../types'

const WS_URL = `ws://${location.host}/ws`

export function useSettings() {
  const [settings, setSettings] = useState<WTSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skipWsRef = useRef(false)

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
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

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      skipWsRef.current = true
      fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
    }, 150)
  }, [])

  const refetch = useCallback(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(setSettings)
      .catch(() => {})
  }, [])

  return { settings, error, patch, refetch }
}
