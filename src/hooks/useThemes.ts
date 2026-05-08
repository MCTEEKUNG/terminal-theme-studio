import { useState, useEffect, useCallback } from 'react'
import type { SavedTheme } from '../types'

export function useThemes() {
  const [themes, setThemes] = useState<SavedTheme[]>([])

  const reload = useCallback(() => {
    fetch('/api/themes').then(r => r.json()).then(setThemes).catch(() => {})
  }, [])

  useEffect(() => { reload() }, [reload])

  const save = useCallback(async (name: string) => {
    await fetch('/api/themes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    })
    reload()
  }, [reload])

  const apply = useCallback(async (name: string) => {
    await fetch(`/api/themes/${encodeURIComponent(name)}/apply`, { method: 'POST' })
  }, [])

  const remove = useCallback(async (name: string) => {
    await fetch(`/api/themes/${encodeURIComponent(name)}`, { method: 'DELETE' })
    reload()
  }, [reload])

  return { themes, save, apply, remove }
}
