import { StudioIcon } from './StudioIcon'
import { useState } from 'react'
import type { ActivePanel } from '../App'
import type { SavedTheme } from '../types'

const NAV_ITEMS: { id: ActivePanel; label: string; glyph: string; hint: string }[] = [
  { id: 'themes', label: 'Color themes', glyph: '◈', hint: 'Find your palette' },
  { id: 'font', label: 'Typography', glyph: 'Aa', hint: 'Make every line yours' },
  { id: 'opacity', label: 'Transparency', glyph: '◐', hint: 'Light, blur & glass' },
  { id: 'background', label: 'Background', glyph: '▧', hint: 'Images & playlists' },
]

export interface SidebarProps {
  activePanel: ActivePanel
  onPanelChange: (panel: ActivePanel) => void
  themes: SavedTheme[]
  onSave: (name: string) => Promise<void>
  onApply: (name: string) => Promise<void>
  onDelete: (name: string) => Promise<void>
  canSave: boolean
}

export function Sidebar(props: SidebarProps) {
  const { activePanel, onPanelChange } = props
  return (
    <aside className="sidebar" aria-label="Studio navigation">
      <div className="sidebar-header">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">❯_</div>
          <div><div className="brand-text">Theme Studio</div><div className="brand-sub">Your terminal, your way.</div></div>
        </div>
      </div>
      <nav className="sidebar-nav" aria-label="Appearance settings">
        {NAV_ITEMS.map(item => (
          <button key={item.id} className={`nav-item ${activePanel === item.id ? 'active' : ''}`}
            aria-label={item.label}
            aria-current={activePanel === item.id ? 'page' : undefined} onClick={() => onPanelChange(item.id)}>
            <span className="nav-glyph" aria-hidden="true">{item.glyph}</span>
            <span><span className="nav-name">{item.label}</span><span className="nav-hint">{item.hint}</span></span>
          </button>
        ))}
      </nav>
      <SavedLooks {...props} />
      <div className="sidebar-footer">Made for your everyday shell.</div>
    </aside>
  )
}

export function SavedLooks({ themes, onSave, onApply, onDelete, canSave, vectorIcons = false }: { vectorIcons?: boolean } & Pick<SidebarProps, 'themes' | 'onSave' | 'onApply' | 'onDelete' | 'canSave'>) {
  const [saving, setSaving] = useState(false)
  const [themeName, setThemeName] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [failure, setFailure] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true)
    setFailure('')
    setMessage('')
    try { await action(); setMessage(success); return true }
    catch (error) { setFailure(error instanceof Error ? error.message : 'Action failed. Try again.'); return false }
    finally { setBusy(false) }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    const name = themeName.trim()
    if (!name || busy || !canSave) return
    if (await run(() => onSave(name), `Saved “${name}”.`)) {
      setThemeName('')
      setSaving(false)
    }
  }

  return (
      <section className="sidebar-themes" aria-label="Saved themes">
        <div className="saved-heading"><h2 className="section-label">Your collection</h2><span className="count-badge">{themes.length}</span></div>
        {themes.length === 0 && <p className="saved-empty">Found a look you love?<br />Save your settings here.</p>}
        <div className="saved-theme-list">
          {themes.map(theme => (
            <div key={theme.name} className="theme-item">
              <button type="button" className="theme-apply" disabled={busy}
                onClick={() => void run(() => onApply(theme.name), `Applied “${theme.name}”.`)}>
                <span className="saved-swatch" style={{ background: theme.settings.scheme?.blue ?? 'var(--amber)' }} />{theme.name}
              </button>
              <button className="theme-delete" disabled={busy} onClick={() => setDeleting(theme.name)} aria-label={`Delete ${theme.name}`} title="Delete saved theme">{vectorIcons ? <StudioIcon name="close" size={15} /> : '×'}</button>
              {deleting === theme.name && <div className="delete-confirm">
                <p>Delete “{theme.name}”?</p>
                <button className="btn-secondary" disabled={busy} onClick={() => setDeleting(null)}>Keep</button>
                <button className="btn-secondary danger" disabled={busy} onClick={async () => {
                  if (await run(() => onDelete(theme.name), `Deleted “${theme.name}”.`)) setDeleting(null)
                }}>Delete</button>
              </div>}
            </div>
          ))}
        </div>
        {saving ? (
          <form className="save-theme-form" onSubmit={handleSave}>
            <label className="sr-only" htmlFor="theme-name">Theme name</label>
            <input id="theme-name" className="save-theme-input" autoFocus placeholder="Name your theme" value={themeName}
              onChange={e => setThemeName(e.target.value)} onKeyDown={e => e.key === 'Escape' && setSaving(false)} />
            <button type="submit" className="btn btn-primary" disabled={busy || !canSave || !themeName.trim()}>{busy ? 'Saving…' : 'Save'}</button>
            <button type="button" className="cancel-save" onClick={() => setSaving(false)}>Cancel</button>
          </form>
        ) : <button className="btn btn-save" disabled={!canSave} title={canSave ? 'Save all appearance settings' : 'Wait for your settings to finish saving'} onClick={() => setSaving(true)}>{vectorIcons ? <><StudioIcon name="plus" size={16} />Save current look</> : '＋ Save current look'}</button>}
        {message && <p className="collection-message" role="status">{message}</p>}
        {failure && <p className="inline-error" role="alert">{failure}</p>}
      </section>
  )
}
