import { useState } from 'react'
import type { ActivePanel } from '../App'
import type { SavedTheme } from '../types'

const NAV_ITEMS: { id: ActivePanel; label: string; icon: string }[] = [
  { id: 'opacity', label: 'Opacity', icon: '◈' },
  { id: 'themes', label: 'Themes', icon: '🎨' },
  { id: 'font', label: 'Font', icon: 'Aa' },
  { id: 'background', label: 'Background', icon: '🖼' }
]

interface Props {
  activePanel: ActivePanel
  onPanelChange: (panel: ActivePanel) => void
  themes: SavedTheme[]
  onSave: (name: string) => Promise<void>
  onApply: (name: string) => Promise<void>
  onDelete: (name: string) => Promise<void>
}

export function Sidebar({ activePanel, onPanelChange, themes, onSave, onApply, onDelete }: Props) {
  const [saving, setSaving] = useState(false)
  const [themeName, setThemeName] = useState('')
  const [activeThemeName, setActiveThemeName] = useState<string | null>(null)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!themeName.trim()) return
    await onSave(themeName.trim())
    setThemeName('')
    setSaving(false)
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header">⚡ Theme Studio</div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map(item => (
          <button
            key={item.id}
            className={`nav-item ${activePanel === item.id ? 'active' : ''}`}
            onClick={() => onPanelChange(item.id)}
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-themes">
        <div className="section-label">Saved Themes</div>

        {themes.length === 0 && (
          <div style={{ color: 'var(--text-secondary)', fontSize: 11, padding: '4px 6px' }}>
            No saved themes yet
          </div>
        )}

        {themes.map(theme => (
          <button key={theme.name} type="button" className={`theme-item ${activeThemeName === theme.name ? 'active-theme' : ''}`} onClick={() => { onApply(theme.name); setActiveThemeName(theme.name) }}>
            <span>{theme.name}</span>
            <button
              className="theme-delete"
              onClick={(e) => { e.stopPropagation(); onDelete(theme.name) }}
              title="Delete theme"
            >
              ×
            </button>
          </button>
        ))}

        {saving ? (
          <form className="save-theme-form" onSubmit={handleSave}>
            <input
              className="save-theme-input"
              autoFocus
              placeholder="Theme name..."
              value={themeName}
              onChange={e => setThemeName(e.target.value)}
              onKeyDown={e => e.key === 'Escape' && setSaving(false)}
            />
            <button type="submit" className="btn btn-primary">✓</button>
          </form>
        ) : (
          <button className="btn btn-save" onClick={() => setSaving(true)}>
            + Save Current
          </button>
        )}
      </div>
    </div>
  )
}
