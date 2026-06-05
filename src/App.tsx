import { useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { OpacityPanel } from './components/panels/OpacityPanel'
import { ThemesPanel } from './components/panels/ThemesPanel'
import { FontPanel } from './components/panels/FontPanel'
import { BackgroundPanel } from './components/panels/BackgroundPanel'
import { TerminalPreview } from './components/TerminalPreview'
import { useSettings } from './hooks/useSettings'
import { useThemes } from './hooks/useThemes'

export type ActivePanel = 'opacity' | 'themes' | 'font' | 'background'

export default function App() {
  const { settings, error, patch, refetch } = useSettings()
  const { themes, save, apply, remove } = useThemes(refetch)
  const [activePanel, setActivePanel] = useState<ActivePanel>('themes')

  if (error) return <div className="error">{error}</div>
  if (!settings) return (
    <div className="loading">
      <span className="boot-brand">Theme Studio</span>
      <span>Connecting to terminal…</span>
    </div>
  )

  return (
    <div className="app">
      <Sidebar
        activePanel={activePanel}
        onPanelChange={setActivePanel}
        themes={themes}
        onSave={save}
        onApply={apply}
        onDelete={remove}
      />
      <div className="main">
        <div className="panel">
          {activePanel === 'opacity' && <OpacityPanel settings={settings} onPatch={patch} />}
          {activePanel === 'themes' && <ThemesPanel settings={settings} onPatch={patch} />}
          {activePanel === 'font' && <FontPanel settings={settings} onPatch={patch} />}
          {activePanel === 'background' && <BackgroundPanel settings={settings} onPatch={patch} />}
        </div>
        <TerminalPreview settings={settings} />
      </div>
    </div>
  )
}
