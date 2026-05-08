import type { WTSettings } from '../types'
import { getActiveScheme } from '../lib/settings'

interface Props {
  settings: WTSettings
}

export function TerminalPreview({ settings }: Props) {
  const d = settings.profiles.defaults
  const scheme = getActiveScheme(settings)
  const font = d.font ?? { face: 'Cascadia Code', size: 12 }
  const opacity = (d.opacity ?? 100) / 100
  const bgImage = d.backgroundImage

  const style: React.CSSProperties = {
    backgroundColor: scheme?.background ?? '#0d1117',
    color: scheme?.foreground ?? '#e6edf3',
    fontFamily: `'${font.face}', 'Cascadia Code', Consolas, monospace`,
    fontSize: `${Math.min(font.size, 14)}px`,
    opacity,
    ...(bgImage ? {
      backgroundImage: `url('${bgImage.replace(/\\/g, '/')}')`,
      backgroundSize: d.backgroundImageStretchMode === 'fill' ? '100% 100%'
        : d.backgroundImageStretchMode === 'uniform' ? 'contain'
        : d.backgroundImageStretchMode === 'none' ? 'auto'
        : 'cover',
      backgroundPosition: d.backgroundImageAlignment ?? 'center',
      backgroundRepeat: 'no-repeat'
    } : {})
  }

  const promptColor = scheme?.green ?? '#3fb950'
  const accentColor = scheme?.blue ?? '#58a6ff'
  const cursor = { backgroundColor: scheme?.cursorColor ?? '#58a6ff' }

  return (
    <div className="terminal-preview">
      <div className="preview-label">Live Preview</div>
      <div className="terminal-window" style={style}>
        <div className="terminal-line" style={{ color: promptColor }}>ASUS@PC ~</div>
        <div className="terminal-line" style={{ color: scheme?.foreground ?? '#e6edf3', opacity: 0.6 }}>$ echo "Hello, World!"</div>
        <div className="terminal-line">Hello, World!</div>
        <div className="terminal-line" style={{ color: scheme?.foreground ?? '#e6edf3', opacity: 0.6 }}>$ ls</div>
        <div className="terminal-line" style={{ color: accentColor }}>Documents  Downloads  Desktop  Projects</div>
        <div className="terminal-line">
          <span style={{ color: promptColor }}>ASUS@PC ~ $ </span>
          <span style={{ ...cursor, color: style.backgroundColor, padding: '0 1px' }}>█</span>
        </div>
      </div>
    </div>
  )
}
