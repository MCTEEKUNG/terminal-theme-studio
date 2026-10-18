import { useState, useEffect, useCallback } from 'react'
import type { SavedTheme } from '../types'

async function checkResponse(response: Response) {
  if (!response.ok) throw new Error('Could not update your collection. Try again.')
}

export function useThemes(onSettingsChange?: () => void) {
  const [themes, setThemes] = useState<SavedTheme[]>([])

  const reload = useCallback(() => {
    fetch('/api/themes').then(r => r.json()).then(setThemes).catch(() => {})
  }, [])

  useEffect(() => { reload() }, [reload])

  const save = useCallback(async (name: string) => {
    await checkResponse(await fetch('/api/themes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    }))
    reload()
  }, [reload])

  const apply = useCallback(async (name: string) => {
    await checkResponse(await fetch(`/api/themes/${encodeURIComponent(name)}/apply`, { method: 'POST' }))
    onSettingsChange?.()
  }, [onSettingsChange])

  const remove = useCallback(async (name: string) => {
    await checkResponse(await fetch(`/api/themes/${encodeURIComponent(name)}`, { method: 'DELETE' }))
    reload()
  }, [reload])

  return { themes, save, apply, remove }
}
