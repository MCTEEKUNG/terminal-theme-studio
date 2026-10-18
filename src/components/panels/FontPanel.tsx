import type { WTSettings, ProfileDefaults, FontSettings } from '../../types'

interface Props {
  plain?: boolean
  settings: WTSettings
  onPatch: (body: { defaults: Partial<ProfileDefaults> }) => void
}

const WEIGHTS: FontSettings['weight'][] = [
  'thin', 'extra-light', 'light', 'semi-light', 'normal', 'semi-bold', 'bold', 'extra-bold'
]

export function FontPanel({ settings, onPatch, plain }: Props) {
  const font = settings.profiles.defaults.font ?? { face: 'Cascadia Code', size: 12, weight: 'normal' }

  function patchFont(patch: Partial<FontSettings>) {
    onPatch({ defaults: { font: { ...font, ...patch } } })
  }

  return (
    <div>
      <h2 className="panel-title">{plain ? 'Typography' : 'Type that feels right.'}</h2><p className="panel-subtitle">Tune the rhythm of your terminal. Watch your changes in the live preview.</p>

      <div className="control-group">
        <div className="control-label"><label htmlFor="font-face">Font family</label></div>
        <input
          id="font-face" className="text-input"
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
          <label htmlFor="font-size">Font size</label>
          <span className="control-value">{font.size}pt</span>
        </div>
        <input
          id="font-size" type="range" className="slider" min={8} max={32} step={1}
          value={font.size}
          onChange={e => patchFont({ size: Number(e.target.value) })}
        />
      </div>

      <div className="control-group">
        <div className="control-label"><label htmlFor="font-weight">Font weight</label></div>
        <select
          id="font-weight" className="select-input"
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
