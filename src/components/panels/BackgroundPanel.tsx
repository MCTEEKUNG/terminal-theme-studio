import type { WTSettings, ProfileDefaults } from '../../types'

interface Props {
  settings: WTSettings
  onPatch: (body: { defaults: Partial<ProfileDefaults> }) => void
}

const STRETCH_MODES: ProfileDefaults['backgroundImageStretchMode'][] = [
  'none', 'fill', 'uniform', 'uniformToFill'
]

const ALIGNMENTS: ProfileDefaults['backgroundImageAlignment'][] = [
  'center', 'top', 'bottom', 'left', 'right',
  'topLeft', 'topRight', 'bottomLeft', 'bottomRight'
]

export function BackgroundPanel({ settings, onPatch }: Props) {
  const d = settings.profiles.defaults
  const bgImage = d.backgroundImage ?? ''
  const bgOpacity = d.backgroundImageOpacity ?? 1.0
  const stretchMode = d.backgroundImageStretchMode ?? 'uniformToFill'
  const alignment = d.backgroundImageAlignment ?? 'center'

  return (
    <div>
      <div className="panel-title">Background Image</div>

      <div className="control-group">
        <div className="control-label"><span>Image Path</span></div>
        <input
          className="text-input"
          type="text"
          value={bgImage}
          placeholder="C:\Users\ASUS\Pictures\wallpaper.png"
          onChange={e => onPatch({ defaults: { backgroundImage: e.target.value || null } })}
        />
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4 }}>
          Full path to image file. Clear to remove background.
        </div>
      </div>

      <div className="control-group">
        <div className="control-label">
          <span>Image Opacity</span>
          <span className="control-value">{Math.round(bgOpacity * 100)}%</span>
        </div>
        <input
          type="range" className="slider" min={0} max={100} step={1}
          value={Math.round(bgOpacity * 100)}
          onChange={e => onPatch({ defaults: { backgroundImageOpacity: Number(e.target.value) / 100 } })}
        />
      </div>

      <div className="control-group">
        <div className="control-label"><span>Stretch Mode</span></div>
        <select
          className="select-input"
          value={stretchMode}
          onChange={e => onPatch({ defaults: { backgroundImageStretchMode: e.target.value as ProfileDefaults['backgroundImageStretchMode'] } })}
        >
          {STRETCH_MODES.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      <div className="control-group">
        <div className="control-label"><span>Alignment</span></div>
        <select
          className="select-input"
          value={alignment}
          onChange={e => onPatch({ defaults: { backgroundImageAlignment: e.target.value as ProfileDefaults['backgroundImageAlignment'] } })}
        >
          {ALIGNMENTS.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>
    </div>
  )
}
