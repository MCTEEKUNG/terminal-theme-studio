import { useState, useEffect, useRef, useCallback } from 'react'
import type { StudioState, ProfileDefaults, ColorScheme } from '../types'
import { mergeDefaults, upsertScheme } from '../lib/settings'

const WS_URL = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`
type SettingsPatch = { defaults?: Partial<ProfileDefaults>; scheme?: ColorScheme }
export type StudioRequest = (route: string, options?: RequestInit, transition?: boolean) => Promise<any>
const cancelled = () => new DOMException('Collection changed', 'AbortError')

export function useSettings() {
  const [session, setSession] = useState<StudioState | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const revisionRef = useRef<string | null>(null)
  const requestsRef = useRef(new Map<AbortController, boolean>())
  const patchVersionRef = useRef(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingPatchRef = useRef<SettingsPatch>({})
  const savingRef = useRef(false)

  const cancelPending = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = null
    pendingPatchRef.current = {}
    patchVersionRef.current++
    savingRef.current = false
    setSaveState('idle')
  }, [])

  const acceptSession = useCallback((next: StudioState) => {
    const changed = revisionRef.current !== next.revision
    if (changed) {
      revisionRef.current = next.revision
      cancelPending()
      for (const [controller, transition] of requestsRef.current) if (!transition) controller.abort()
    }
    setError(null)
    setSession(previous => !changed && savingRef.current && previous
      ? { ...next, settings: previous.settings } : next)
  }, [cancelPending])

  useEffect(() => {
    let disposed = false
    let ws: WebSocket
    let retry: ReturnType<typeof setTimeout>
    const controller = new AbortController()
    fetch('/api/state', { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error('Settings unavailable'); return response.json() })
      .then(data => { if (!disposed && revisionRef.current === null) acceptSession(data) })
      .catch(() => { if (!disposed && revisionRef.current === null) setError('Cannot connect to server. Make sure you ran: bun run dev') })

    function connect() {
      if (disposed) return
      ws = new WebSocket(WS_URL)
      ws.onmessage = event => {
        const message = JSON.parse(event.data)
        if (message.type === 'session-update') { acceptSession(message.session); return }
        if (message.revision !== revisionRef.current) return
        setSession(previous => {
          if (!previous) return previous
          if (message.type === 'playlist-update') return { ...previous, playlist: message.playlist }
          if (message.type === 'conversion-settings-update') return { ...previous, conversionSettings: message.conversionSettings }
          if (message.type === 'settings-update' && !savingRef.current) return { ...previous, settings: message.settings }
          return previous
        })
      }
      ws.onclose = () => { if (!disposed) retry = setTimeout(connect, 1000) }
    }
    connect()
    return () => {
      disposed = true
      controller.abort()
      clearTimeout(retry)
      ws?.close()
      cancelPending()
      for (const controller of requestsRef.current.keys()) controller.abort()
    }
  }, [acceptSession, cancelPending])

  // Every callback is bound to the Collection/mode that rendered it. A late
  // conversion cannot silently acquire the new Collection's revision.
  const revision = session?.revision
  const request: StudioRequest = useCallback(async (route, options = {}, transition = false) => {
    if (!revision || revision !== revisionRef.current) throw cancelled()
    if (transition) cancelPending()
    const controller = new AbortController()
    requestsRef.current.set(controller, transition)
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal
    try {
      const headers = new Headers(options.headers)
      headers.set('X-Studio-Revision', revision)
      if (options.body) headers.set('Content-Type', 'application/json')
      const response = await fetch(route, { ...options, headers, signal })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'Could not save changes')
      if (!transition && (signal.aborted || revision !== revisionRef.current)) throw cancelled()
      if (data.session && revision === revisionRef.current) acceptSession(data.session)
      else if (!transition && data.playlist) setSession(previous => previous && { ...previous, playlist: data.playlist })
      else if (!transition && route === '/api/conversion-settings' && options.method === 'PUT')
        setSession(previous => previous && { ...previous, conversionSettings: data })
      return data
    } finally { requestsRef.current.delete(controller) }
  }, [revision, acceptSession, cancelPending])

  const patch = useCallback((body: SettingsPatch) => {
    if (revision !== revisionRef.current) return
    setSaveState('saving')
    savingRef.current = true
    const version = ++patchVersionRef.current
    setSession(previous => {
      if (!previous) return previous
      let settings = previous.settings
      if (body.defaults) settings = mergeDefaults(settings, body.defaults)
      if (body.scheme) settings = upsertScheme(settings, body.scheme)
      return { ...previous, settings }
    })
    const pending = pendingPatchRef.current
    pendingPatchRef.current = { ...pending, ...body,
      ...(body.defaults ? { defaults: { ...pending.defaults, ...body.defaults,
        ...(body.defaults.font ? { font: { ...pending.defaults?.font, ...body.defaults.font } } : {}),
        ...(body.defaults.unfocusedAppearance ? { unfocusedAppearance: { ...pending.defaults?.unfocusedAppearance, ...body.defaults.unfocusedAppearance } } : {}),
      } } : {}) }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      const updates = pendingPatchRef.current
      pendingPatchRef.current = {}
      try {
        await request('/api/settings', { method: 'PATCH', body: JSON.stringify(updates) })
        if (version === patchVersionRef.current) { savingRef.current = false; setSaveState('saved') }
      } catch {
        if (version === patchVersionRef.current) { savingRef.current = false; setSaveState('error') }
      }
    }, 150)
  }, [revision, request])

  return { session, settings: session?.settings ?? null, error, patch, request, saveState }
}
