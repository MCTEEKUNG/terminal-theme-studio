import type { WTSettings, ColorScheme, ProfileDefaults } from '../../types'
import { getActiveScheme, isBuiltInScheme } from '../../lib/settings'

interface Props {
  settings: WTSettings
  onPatch: (body: { defaults?: Partial<ProfileDefaults>; scheme?: ColorScheme }) => void
}

const BASIC_COLORS: { key: keyof ColorScheme; label: string }[] = [
  { key: 'background', label: 'Background' },
  { key: 'foreground', label: 'Foreground' },
  { key: 'cursorColor', label: 'Cursor' },
  { key: 'selectionBackground', label: 'Selection' }
]

const ANSI_COLORS: { key: keyof ColorScheme; label: string }[] = [
  { key: 'black', label: 'Black' }, { key: 'brightBlack', label: 'Bright Black' },
  { key: 'red', label: 'Red' }, { key: 'brightRed', label: 'Bright Red' },
  { key: 'green', label: 'Green' }, { key: 'brightGreen', label: 'Bright Green' },
  { key: 'yellow', label: 'Yellow' }, { key: 'brightYellow', label: 'Bright Yellow' },
  { key: 'blue', label: 'Blue' }, { key: 'brightBlue', label: 'Bright Blue' },
  { key: 'purple', label: 'Purple' }, { key: 'brightPurple', label: 'Bright Purple' },
  { key: 'cyan', label: 'Cyan' }, { key: 'brightCyan', label: 'Bright Cyan' },
  { key: 'white', label: 'White' }, { key: 'brightWhite', label: 'Bright White' }
]

function ColorPicker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="color-row">
      <div className="color-swatch">
        <input type="color" aria-label={label} value={value || '#000000'} onChange={e => onChange(e.target.value)} />
      </div>
      <span className="color-name">{label}</span>
    </div>
  )
}

export function ColorsPanel({ settings, onPatch }: Props) {
  const activeScheme = getActiveScheme(settings)
  const schemeName = settings.profiles.defaults.colorScheme ?? ''
  const isBuiltIn = isBuiltInScheme(schemeName)

  function handleColorChange(key: keyof ColorScheme, value: string) {
    let scheme: ColorScheme

    if (isBuiltIn || !activeScheme) {
      // Copy built-in scheme to "Custom" before editing
      scheme = { ...(activeScheme ?? defaultScheme), name: 'Custom', [key]: value }
      onPatch({ scheme, defaults: { colorScheme: 'Custom' } })
    } else {
      scheme = { ...activeScheme, [key]: value }
      onPatch({ scheme })
    }
  }

  if (!activeScheme && settings.schemes.length === 0) {
    return (
      <div>
        <div className="panel-title">Colors</div>
        <p style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
          No color schemes found. Windows Terminal will use defaults.
        </p>
      </div>
    )
  }

  const scheme = activeScheme ?? defaultScheme

  return (
    <div>
      <div className="panel-title">Color Scheme</div>

      <div className="scheme-header">
        <span className="scheme-name">{schemeName || 'Default'}</span>
        {isBuiltIn && <span className="scheme-badge">built-in → will copy to "Custom"</span>}
      </div>

      <div className="control-group">
        <div className="control-label"><span>Terminal Colors</span></div>
        <div className="color-grid">
          {BASIC_COLORS.map(({ key, label }) => (
            <ColorPicker
              key={key}
              label={label}
              value={(scheme[key] as string) || '#000000'}
              onChange={v => handleColorChange(key, v)}
            />
          ))}
        </div>
      </div>

      <div className="control-group">
        <div className="control-label"><span>ANSI Colors</span></div>
        <div className="ansi-grid">
          {ANSI_COLORS.map(({ key, label }) => (
            <ColorPicker
              key={key}
              label={label}
              value={(scheme[key] as string) || '#000000'}
              onChange={v => handleColorChange(key, v)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

const defaultScheme: ColorScheme = {
  name: 'Custom', background: '#0d1117', foreground: '#e6edf3',
  cursorColor: '#58a6ff', selectionBackground: '#264f78',
  black: '#0d1117', red: '#ff7b72', green: '#3fb950', yellow: '#d29922',
  blue: '#58a6ff', purple: '#bc8cff', cyan: '#39c5cf', white: '#b1bac4',
  brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364',
  brightYellow: '#e3b341', brightBlue: '#79c0ff', brightPurple: '#d2a8ff',
  brightCyan: '#56d4dd', brightWhite: '#f0f6fc'
}
