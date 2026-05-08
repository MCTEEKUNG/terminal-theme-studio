import type { WTSettings, ProfileDefaults, FontSettings } from '../../types'

interface Props {
  settings: WTSettings
  onPatch: (body: { defaults: Partial<ProfileDefaults> }) => void
}

const WEIGHTS: FontSettings['weight'][] = [
  'thin', 'extra-light', 'light', 'semi-light', 'normal', 'semi-bold', 'bold', 'extra-bold'
]

export function FontPanel({ settings, onPatch }: Props) {
  const font = settings.profiles.defaults.font ?? { face: 'Cascadia Code', size: 12, weight: 'normal' }

  function patchFont(patch: Partial<FontSettings>) {
    onPatch({ defaults: { font: { ...font, ...patch } } })
  }

  return (
    <div>
      <div className="panel-title">Font</div>

      <div className="control-group">
        <div className="control-label"><span>Font Face</span></div>
        <input
          className="text-input"
          type="text"
          value={font.face}
          placeholder="e.g. Cascadia Code, Consolas, JetBrains Mono"
          onChange={e => patchFont({ face: e.target.value })}
        />
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4 }}>
          Type any font installed on your system
        </div>
      </div>

      <div className="control-group">
        <div className="control-label">
          <span>Font Size</span>
          <span className="control-value">{font.size}pt</span>
        </div>
        <input
          type="range" className="slider" min={8} max={32} step={1}
          value={font.size}
          onChange={e => patchFont({ size: Number(e.target.value) })}
        />
      </div>

      <div className="control-group">
        <div className="control-label"><span>Font Weight</span></div>
        <select
          className="select-input"
          value={font.weight}
          onChange={e => patchFont({ weight: e.target.value as FontSettings['weight'] })}
        >
          {WEIGHTS.map(w => (
            <option key={w} value={w}>{w.charAt(0).toUpperCase() + w.slice(1)}</option>
          ))}
        </select>
      </div>
    </div>
  )
}
