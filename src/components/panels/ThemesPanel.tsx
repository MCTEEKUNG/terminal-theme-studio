import { ColorsPanel } from './ColorsPanel'
import { StudioIcon } from '../StudioIcon'
import { useState } from 'react'
import additionalThemes from '../../data/additionalThemes.json'
import type { WTSettings, ColorScheme, ProfileDefaults } from '../../types'

interface Props {
  settings: WTSettings
  onPatch: (body: { defaults?: Partial<ProfileDefaults>; scheme?: ColorScheme }) => void
  isPtyxis?: boolean
  plain?: boolean
}

export const PRESET_THEMES: ColorScheme[] = [
  {
    name: 'Tokyo Night',
    background: '#1a1b26', foreground: '#c0caf5',
    cursorColor: '#c0caf5', selectionBackground: '#33467c',
    black: '#15161e', brightBlack: '#414868',
    red: '#f7768e', brightRed: '#f7768e',
    green: '#9ece6a', brightGreen: '#9ece6a',
    yellow: '#e0af68', brightYellow: '#e0af68',
    blue: '#7aa2f7', brightBlue: '#7aa2f7',
    purple: '#bb9af7', brightPurple: '#bb9af7',
    cyan: '#7dcfff', brightCyan: '#7dcfff',
    white: '#a9b1d6', brightWhite: '#c0caf5',
  },
  {
    name: 'Dracula',
    background: '#282a36', foreground: '#f8f8f2',
    cursorColor: '#f8f8f2', selectionBackground: '#44475a',
    black: '#21222c', brightBlack: '#6272a4',
    red: '#ff5555', brightRed: '#ff6e6e',
    green: '#50fa7b', brightGreen: '#69ff94',
    yellow: '#f1fa8c', brightYellow: '#ffffa5',
    blue: '#bd93f9', brightBlue: '#d6acff',
    purple: '#ff79c6', brightPurple: '#ff92df',
    cyan: '#8be9fd', brightCyan: '#a4ffff',
    white: '#f8f8f2', brightWhite: '#ffffff',
  },
  {
    name: 'Nord',
    background: '#2e3440', foreground: '#d8dee9',
    cursorColor: '#d8dee9', selectionBackground: '#434c5e',
    black: '#3b4252', brightBlack: '#4c566a',
    red: '#bf616a', brightRed: '#bf616a',
    green: '#a3be8c', brightGreen: '#a3be8c',
    yellow: '#ebcb8b', brightYellow: '#ebcb8b',
    blue: '#81a1c1', brightBlue: '#88c0d0',
    purple: '#b48ead', brightPurple: '#b48ead',
    cyan: '#88c0d0', brightCyan: '#8fbcbb',
    white: '#e5e9f0', brightWhite: '#eceff4',
  },
  {
    name: 'One Dark',
    background: '#282c34', foreground: '#abb2bf',
    cursorColor: '#528bff', selectionBackground: '#3e4451',
    black: '#282c34', brightBlack: '#5c6370',
    red: '#e06c75', brightRed: '#e06c75',
    green: '#98c379', brightGreen: '#98c379',
    yellow: '#e5c07b', brightYellow: '#e5c07b',
    blue: '#61afef', brightBlue: '#61afef',
    purple: '#c678dd', brightPurple: '#c678dd',
    cyan: '#56b6c2', brightCyan: '#56b6c2',
    white: '#abb2bf', brightWhite: '#c8ccd4',
  },
  {
    name: 'Catppuccin Mocha',
    background: '#1e1e2e', foreground: '#cdd6f4',
    cursorColor: '#f5e0dc', selectionBackground: '#585b70',
    black: '#45475a', brightBlack: '#585b70',
    red: '#f38ba8', brightRed: '#f38ba8',
    green: '#a6e3a1', brightGreen: '#a6e3a1',
    yellow: '#f9e2af', brightYellow: '#f9e2af',
    blue: '#89b4fa', brightBlue: '#89b4fa',
    purple: '#cba6f7', brightPurple: '#cba6f7',
    cyan: '#89dceb', brightCyan: '#89dceb',
    white: '#bac2de', brightWhite: '#a6adc8',
  },
  {
    name: 'Gruvbox Dark',
    background: '#282828', foreground: '#ebdbb2',
    cursorColor: '#ebdbb2', selectionBackground: '#504945',
    black: '#282828', brightBlack: '#928374',
    red: '#cc241d', brightRed: '#fb4934',
    green: '#98971a', brightGreen: '#b8bb26',
    yellow: '#d79921', brightYellow: '#fabd2f',
    blue: '#458588', brightBlue: '#83a598',
    purple: '#b16286', brightPurple: '#d3869b',
    cyan: '#689d6a', brightCyan: '#8ec07c',
    white: '#a89984', brightWhite: '#ebdbb2',
  },
  {
    name: 'Cobalt2',
    background: '#193549', foreground: '#ffffff',
    cursorColor: '#f0cc09', selectionBackground: '#0050a4',
    black: '#000000', brightBlack: '#002240',
    red: '#ff2600', brightRed: '#ff2600',
    green: '#3ad900', brightGreen: '#3ad900',
    yellow: '#ffc600', brightYellow: '#ffc600',
    blue: '#0080ff', brightBlue: '#0080ff',
    purple: '#ff0080', brightPurple: '#ff0080',
    cyan: '#00b4d7', brightCyan: '#00d8eb',
    white: '#ffffff', brightWhite: '#ffffff',
  },
  {
    name: 'Synthwave',
    background: '#262335', foreground: '#ffffff',
    cursorColor: '#72f1b8', selectionBackground: '#463465',
    black: '#262335', brightBlack: '#495495',
    red: '#fe4450', brightRed: '#fe4450',
    green: '#72f1b8', brightGreen: '#72f1b8',
    yellow: '#f97e72', brightYellow: '#f97e72',
    blue: '#36f9f6', brightBlue: '#36f9f6',
    purple: '#ff7edb', brightPurple: '#ff7edb',
    cyan: '#03edf9', brightCyan: '#03edf9',
    white: '#ffffff', brightWhite: '#ffffff',
  },
  ...additionalThemes,
]

function ThemeCard({
  theme,
  isActive,
  onClick,
}: {
  theme: ColorScheme
  isActive: boolean
  onClick: () => void
}) {
  const swatchColors = [
    theme.background,
    theme.red,
    theme.green,
    theme.yellow,
    theme.blue,
    theme.purple,
    theme.cyan,
    theme.foreground,
  ]

  return (
    <button
      className={`theme-card ${isActive ? 'theme-card-active' : ''}`}
      onClick={onClick}
      title={`Apply ${theme.name}`}
      aria-pressed={isActive}
    >
      <div className="theme-mini-terminal" style={{ background: theme.background, color: theme.foreground }} aria-hidden="true">
        <div className="mini-dots"><i /><i /><i /></div>
        <div><span style={{ color: theme.green }}>❯</span> <span style={{ color: theme.blue }}>~/projects</span></div>
        <div><span style={{ color: theme.purple }}>const</span> mood = <span style={{ color: theme.yellow }}>'inspired'</span></div>
      </div>
      <div className="theme-swatch">
        {swatchColors.map((color, i) => (
          <div key={i} style={{ flex: 1, background: color }} />
        ))}
      </div>
      <div className="theme-card-footer">
        <span className="theme-card-name">{theme.name}</span>
        {isActive && <span className="theme-card-check"><StudioIcon name="check" size={13} /></span>}
      </div>
    </button>
  )
}

export function ThemesPanel({ settings, onPatch, plain }: Props) {
  const [query, setQuery] = useState('')
  const filtered = PRESET_THEMES.filter(theme => theme.name.toLowerCase().includes(query.trim().toLowerCase()))
  const currentScheme = settings.profiles.defaults.colorScheme ?? ''

  function applyTheme(theme: ColorScheme) {
    onPatch({ scheme: theme, defaults: { colorScheme: theme.name } })
  }

  return (
    <div className="themes-panel">
      <h2 className="panel-title">{plain ? 'Color themes' : 'A palette for your flow.'}</h2>
      <div className="current-theme"><span>Current theme</span><strong>{currentScheme || 'Terminal default'}</strong></div>
      <div className="theme-search"><span aria-hidden="true">⌕</span><input type="search" aria-label="Search themes" placeholder="Find a theme…" value={query} onChange={e => setQuery(e.target.value)} /></div>
      <div className="themes-count" role="status">{filtered.length} {filtered.length === 1 ? 'palette' : 'palettes'}{query && ` matching “${query}”`}</div>
      <div className="themes-grid">
        {filtered.map(theme => (
          <ThemeCard
            key={theme.name}
            theme={theme}
            isActive={currentScheme === theme.name}
            onClick={() => applyTheme(theme)}
          />
        ))}
      </div>
      {filtered.length === 0 && <div className="search-empty"><p>No themes found. Try another name.</p><button className="btn-secondary" onClick={() => setQuery('')}>Show all themes</button></div>}
      <details className="control-group"><summary>Customize palette colors</summary><ColorsPanel settings={settings} onPatch={onPatch} /></details>
      <p className="theme-tip">Make it yours with Typography, Transparency and Background. Save the full look to your collection.</p>
    </div>
  )
}
