import { useState, useEffect } from 'react'
import { ImpeccableStudio } from './components/ImpeccableStudio'
import './impeccable.css'
import type { TerminalConnection } from './types'
import { OpacityPanel } from './components/panels/OpacityPanel'
import { ThemesPanel } from './components/panels/ThemesPanel'
import { FontPanel } from './components/panels/FontPanel'
import { BackgroundPanel } from './components/panels/BackgroundPanel'
import { useSettings } from './hooks/useSettings'
import { useThemes } from './hooks/useThemes'
import { usePlaylist } from './hooks/usePlaylist'

export type ActivePanel = 'opacity' | 'themes' | 'font' | 'background'

export default function App() {
  const { settings, error, patch, refetch, saveState } = useSettings()
  const { themes, save, apply, remove } = useThemes(refetch)
  const playlist = usePlaylist()
  const [activePanel, setActivePanel] = useState<ActivePanel>('themes')
  const [terminal, setTerminal] = useState<TerminalConnection | null>(null)
  useEffect(() => {
    let cancelled = false
    async function refresh() {
      try {
        const response = await fetch('/api/terminal')
        if (!response.ok) throw new Error('Cannot read terminal connection')
        const connection = await response.json()
        if (!cancelled) setTerminal(connection)
      } catch {
        if (!cancelled) setTerminal(prev => prev ? { ...prev, state: 'error', error: 'Cannot reach terminal server' } : null)
      }
    }
    void refresh()
    const timer = setInterval(refresh, 2000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [])
  const isPtyxis = terminal?.backend === 'ptyxis'

  if (error) return <div className="connection-error" role="alert"><div className="brand-mark">❯_</div><h1>Let’s reconnect your terminal.</h1><p>{error}</p><button className="btn btn-primary" onClick={() => location.reload()}>Try again</button></div>
  if (!settings) return (
    <div className="loading">
      <span className="boot-brand">Theme Studio</span>
      <span>Connecting to terminal…</span>
    </div>
  )

  const panel = <>
    {activePanel === 'opacity' && <OpacityPanel plain settings={settings} onPatch={patch} isPtyxis={isPtyxis} />}
    {activePanel === 'themes' && <ThemesPanel plain settings={settings} onPatch={patch} isPtyxis={isPtyxis} />}
    {activePanel === 'font' && <FontPanel plain settings={settings} onPatch={patch} />}
    {activePanel === 'background' && <BackgroundPanel plain settings={settings} onPatch={patch} playlist={playlist} isPtyxis={isPtyxis} />}
  </>
  return (
    <ImpeccableStudio settings={settings} terminal={terminal} saveState={saveState}
      activePanel={activePanel} onPanelChange={setActivePanel} themes={themes}
      onSave={save} onApply={apply} onDelete={remove}
      canSave={saveState !== 'saving' && saveState !== 'error'}>
      {panel}
    </ImpeccableStudio>
  )
}
