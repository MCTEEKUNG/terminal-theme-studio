import type { ReactNode } from 'react'
import type { ActivePanel } from '../App'
import type { TerminalConnection, WTSettings } from '../types'
import { SavedLooks, type SidebarProps } from './Sidebar'
import { TerminalPreview } from './TerminalPreview'
import { NativeTerminalLauncher } from './NativeTerminalLauncher'
import { StudioIcon } from './StudioIcon'

interface Props extends SidebarProps {
  settings: WTSettings
  terminal: TerminalConnection | null
  saveState: 'idle' | 'saving' | 'saved' | 'error'
  children: ReactNode
}
const tabs: { id: ActivePanel; label: string; icon: 'palette' | 'font' | 'opacity' | 'background' }[] = [
  { id: 'themes', label: 'Themes', icon: 'palette' },
  { id: 'font', label: 'Type', icon: 'font' },
  { id: 'opacity', label: 'Glass', icon: 'opacity' },
  { id: 'background', label: 'Background', icon: 'background' },
]

export function ImpeccableStudio({ settings, terminal, saveState, children, ...collection }: Props) {
  const isPtyxis = terminal?.backend === 'ptyxis'
  return <div className="impeccable-app">
    <header className="im-studio-header">
      <a href="#im-settings" className="im-brand"><StudioIcon name="terminal" size={25} /><h1>Theme Studio</h1></a>
      <span className="im-header-divider" aria-hidden="true" />
      <span className="im-header-description">Terminal appearance</span>
      <span className={`im-save-state ${saveState}`} role="status">
        <StudioIcon name="check" size={15} />
        {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Save failed. Change a setting to retry.' : saveState === 'saved' ? 'Changes saved' : 'Changes apply automatically'}
      </span>
    </header>
    <div className="im-workspace">
      <section className="im-inspector" id="im-settings" aria-label="Appearance settings">
        <nav className="im-tabs" aria-label="Appearance categories">
          {tabs.map(tab => <button key={tab.id} type="button" aria-current={collection.activePanel === tab.id ? 'page' : undefined}
            aria-label={tab.id === 'font' ? 'Typography' : tab.id === 'opacity' ? 'Transparency' : tab.label}
            onClick={() => collection.onPanelChange(tab.id)}><StudioIcon name={tab.icon} /><span>{tab.label}</span></button>)}
        </nav>
        <div className="im-inspector-scroll">
          <a className="im-preview-jump" href="#im-preview">View terminal preview <StudioIcon name="arrow" size={15} /></a>
          <div className="im-controls">{children}</div>
          <SavedLooks {...collection} vectorIcons />
        </div>
      </section>
      <main className="im-preview-area" id="im-preview">
        <div className="im-preview-toolbar"><span>Terminal preview</span><span className={`im-connection ${terminal?.state === 'error' ? 'failed' : ''}`}><i />{terminal?.state === 'connected' ? (isPtyxis ? 'Ptyxis connected' : 'Windows Terminal connected') : terminal?.state === 'error' ? 'Connection error' : 'Connecting…'}</span></div>
        <TerminalPreview settings={settings} isPtyxis={isPtyxis} specimen />
        <a className="im-preview-jump" href="#im-settings">Back to appearance settings <StudioIcon name="arrow" size={15} /></a>
        {isPtyxis && <details className="im-terminal-details"><summary>Use this look in your terminal</summary>
          <NativeTerminalLauncher />
          <p className="im-integration-note">{terminal?.error ?? 'Colors and opacity use the default Ptyxis profile. Font changes apply to all Ptyxis profiles.'}</p>
        </details>}
      </main>
    </div>
  </div>
}
