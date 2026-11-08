import { useState, useEffect, useCallback } from 'react'
import type { SavedTheme } from '../types'
import type { StudioRequest } from './useSettings'

export function useThemes(request: StudioRequest) {
  const [themes, setThemes] = useState<SavedTheme[]>([])

  const reload = useCallback(() => {
    fetch('/api/themes').then(r => r.json()).then(setThemes).catch(() => {})
  }, [])

  useEffect(() => { reload() }, [reload])

  const save = useCallback(async (name: string) => {
    await request('/api/themes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    })
    reload()
  }, [reload, request])

  const apply = useCallback(async (name: string) => {
    await request(`/api/themes/${encodeURIComponent(name)}/apply`, { method: 'POST' }, true)
  }, [request])

  const remove = useCallback(async (name: string) => {
    await request(`/api/themes/${encodeURIComponent(name)}`, { method: 'DELETE' })
    reload()
  }, [reload, request])

  return { themes, save, apply, remove }
}
