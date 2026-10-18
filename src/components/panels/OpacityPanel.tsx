import { useEffect, useState } from 'react'
import { NativeAppearanceControls } from './NativeAppearanceControls'
import type { WTSettings, ProfileDefaults } from '../../types'

interface Props {
  plain?: boolean
  settings: WTSettings
  onPatch: (body: { defaults: Partial<ProfileDefaults> }) => void
  isPtyxis?: boolean
}

export function OpacityPanel({ settings, onPatch, isPtyxis, plain }: Props) {
  const d = settings.profiles.defaults
  const opacity = d.opacity ?? 100
  const [glassError, setGlassError] = useState<string | null>(null)
  useEffect(() => {
    if (!isPtyxis) return
    let cancelled = false
    const check = () => fetch('/api/glass').then(r => {
      if (!r.ok) throw new Error('Glass controller unavailable')
      return r.json()
    }).then(status => {
      if (!cancelled) setGlassError(status.state === 'error' ? status.error : null)
    }).catch(() => { if (!cancelled) setGlassError('Cannot connect to the glass controller') })
    void check()
    const timer = setInterval(check, 2000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [isPtyxis])
  const useAcrylic = d.useAcrylic ?? false
  const unfocusedOpacity = d.unfocusedAppearance?.opacity ?? 100

  return (
    <div>
      <h2 className="panel-title">{plain ? 'Transparency' : 'Let a little light in.'}</h2><p className="panel-subtitle">Balance the background with comfortable, readable text.</p>

      <div className="control-group">
        <div className="control-label">
          <span>{isPtyxis ? 'Background Opacity' : 'Window Opacity'}</span>
          <span className="control-value">{opacity}%</span>
        </div>
        <input
          type="range" className="slider" min={10} max={100} aria-label="Background opacity"
          value={opacity}
          onChange={e => onPatch({ defaults: { opacity: Number(e.target.value) } })}
        />
      </div>

      {!isPtyxis && <div className="control-group">
        <div className="toggle-row">
          <div className="toggle-info">
            <h4>Use Acrylic (Blur)</h4>
            <p>Frosted glass effect — blur is OS-controlled</p>
          </div>
          <label className="toggle">
            <input
              type="checkbox" aria-label="Use acrylic blur"
              checked={useAcrylic}
              onChange={e => onPatch({ defaults: { useAcrylic: e.target.checked } })}
            />
            <span className="toggle-track" />
          </label>
        </div>
      </div>}
      {isPtyxis && <div className="control-group">
        <div className="toggle-info">
          <div className="control-label">
            <label htmlFor="glass-blur">Glass Blur</label>
            <span className="control-value">{d.glassBlur ?? 16}{(d.glassBlur ?? 16) === 0 ? ' · Off' : ''}</span>
          </div>
          <input id="glass-blur" type="range" className="slider" min={0} max={60} step={1}
            value={d.glassBlur ?? 16}
            aria-describedby="glass-blur-help"
            onChange={e => onPatch({ defaults: { glassBlur: Number(e.target.value) } })}
          />
          <p id="glass-blur-help">GNOME blurs what is behind Terminal. Background Opacity adjusts the glass tint; text and video stay sharp.</p>
          {glassError && <p role="alert">{glassError}</p>}
        </div>
      </div>}

      <div className="control-group">
        <div className="control-label">
          <span>{isPtyxis ? 'Unfocused Background (Studio Terminal)' : 'Unfocused Window Opacity'}</span>
          <span className="control-value">{unfocusedOpacity}%</span>
        </div>
        <input
          aria-label="Unfocused opacity" type="range" className="slider" min={10} max={100}
          value={unfocusedOpacity}
          onChange={e => onPatch({
            defaults: { unfocusedAppearance: { opacity: Number(e.target.value) } }
          })}
        />
      </div>
      {isPtyxis && <NativeAppearanceControls defaults={d} onPatch={onPatch} />}
    </div>
  )
}
