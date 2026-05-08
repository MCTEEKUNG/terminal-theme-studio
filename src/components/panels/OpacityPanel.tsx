import type { WTSettings, ProfileDefaults } from '../../types'

interface Props {
  settings: WTSettings
  onPatch: (body: { defaults: Partial<ProfileDefaults> }) => void
}

export function OpacityPanel({ settings, onPatch }: Props) {
  const d = settings.profiles.defaults
  const opacity = d.opacity ?? 100
  const useAcrylic = d.useAcrylic ?? false
  const unfocusedOpacity = d.unfocusedAppearance?.opacity ?? 100

  return (
    <div>
      <div className="panel-title">Opacity & Transparency</div>

      <div className="control-group">
        <div className="control-label">
          <span>Window Opacity</span>
          <span className="control-value">{opacity}%</span>
        </div>
        <input
          type="range" className="slider" min={10} max={100}
          value={opacity}
          onChange={e => onPatch({ defaults: { opacity: Number(e.target.value) } })}
        />
      </div>

      <div className="control-group">
        <div className="toggle-row">
          <div className="toggle-info">
            <h4>Use Acrylic (Blur)</h4>
            <p>Frosted glass effect — blur is OS-controlled</p>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={useAcrylic}
              onChange={e => onPatch({ defaults: { useAcrylic: e.target.checked } })}
            />
            <span className="toggle-track" />
          </label>
        </div>
      </div>

      <div className="control-group">
        <div className="control-label">
          <span>Unfocused Window Opacity</span>
          <span className="control-value">{unfocusedOpacity}%</span>
        </div>
        <input
          type="range" className="slider" min={10} max={100}
          value={unfocusedOpacity}
          onChange={e => onPatch({
            defaults: { unfocusedAppearance: { opacity: Number(e.target.value) } }
          })}
        />
      </div>
    </div>
  )
}
