import { useEffect, useState } from 'react'
import { APPEARANCE_CONTROLS, CHROME_COLORS } from '../../lib/appearance'
import type { ProfileDefaults } from '../../types'

const controls = APPEARANCE_CONTROLS.filter(control => control.group === 'Layout')
const groups = ['Text and spacing', 'Highlights', 'Status and window controls'] as const


export function NativeAppearanceControls({ defaults, onPatch }: {
  defaults: ProfileDefaults
  onPatch: (body: { defaults: Partial<ProfileDefaults> }) => void
}) {
  const [connection, setConnection] = useState('Connecting live styles…')
  const [styleError, setStyleError] = useState(false)
  useEffect(() => {
    let stopped = false
    const controller = new AbortController()
    const refresh = () => fetch('/api/appearance', { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error('Live style controller unavailable'); return response.json() })
      .then(status => {
        if (stopped) return
        const error = status.error || status.native?.styleError
        setStyleError(Boolean(error))
        setConnection(error || (status.native?.state === 'running' ? 'Live styles connected · no restart needed' : 'Styles saved · ready for your next Terminal window'))
      }).catch(() => { if (!stopped) { setStyleError(true); setConnection('Cannot reach the live style controller') } })
    void refresh()
    const timer = setInterval(refresh, 2000)
    return () => { stopped = true; controller.abort(); clearInterval(timer) }
  }, [])
  return <section aria-label="Terminal appearance">
    <h3>Terminal appearance</h3>
    <p className="panel-subtitle">Updates your open windows live, keeping your shells and running jobs in place.</p>
    <p role={styleError ? 'alert' : 'status'}>{connection}</p>
    {controls.map(({ key, label, min, max, fallback }) => <div className="control-group" key={key}>
      <div className="control-label">
        <label htmlFor={key}>{label}</label>
        <span className="control-value">{defaults[key] ?? fallback}px</span>
      </div>
      <input id={key} type="range" className="slider" min={min} max={max} step={1}
        value={defaults[key] ?? fallback}
        onChange={e => onPatch({ defaults: { [key]: Number(e.target.value) } })} />
    </div>)}
    <div className="control-group">
      <label className="control-label" htmlFor="close-button-shape">Close button shape</label>
      <select id="close-button-shape" className="select-input" value={defaults.closeButtonShape ?? 'circle'}
        onChange={e => onPatch({ defaults: { closeButtonShape: e.target.value as ProfileDefaults['closeButtonShape'] } })}>
        <option value="circle">Circle</option>
        <option value="rounded">Rounded</option>
        <option value="square">Square</option>
      </select>
    </div>
    <div className="control-group">
      <label className="control-label" htmlFor="close-button-alignment">Close button vertical alignment</label>
      <select id="close-button-alignment" className="select-input" value={defaults.closeButtonAlignment ?? 'center'}
        onChange={e => onPatch({ defaults: { closeButtonAlignment: e.target.value as ProfileDefaults['closeButtonAlignment'] } })}>
        <option value="start">Top</option><option value="center">Center</option><option value="end">Bottom</option>
      </select>
    </div>
    {groups.map(group => <details key={group} className="control-group">
      <summary>{group}</summary>
      {APPEARANCE_CONTROLS.filter(control => control.group === group).map(({ key, label, min, max, fallback, unit }) =>
        <div className="control-group" key={key}>
          <div className="control-label"><label htmlFor={key}>{label}</label><span className="control-value">{defaults[key] ?? fallback}{unit}</span></div>
          <input id={key} className="slider" type="range" min={min} max={max} step={1} value={defaults[key] ?? fallback}
            onChange={e => onPatch({ defaults: { [key]: Number(e.target.value) } })} />
        </div>)}
      {group === 'Highlights' && CHROME_COLORS.map(({ key, label, fallback }) => <div className="color-row" key={key}>
        <label htmlFor={key}>{label}</label>
        <input id={key} type="color" value={defaults[key] ?? fallback} onChange={e => onPatch({ defaults: { [key]: e.target.value } })} />
      </div>)}
    </details>)}
    <div className="control-group">
      <label className="control-label" htmlFor="background-frame-rate">Background frame rate</label>
      <select id="background-frame-rate" className="select-input" value={defaults.backgroundFrameRate ?? 24}
        onChange={e => onPatch({ defaults: { backgroundFrameRate: Number(e.target.value) } })}>
        <option value={12}>12 fps · Lower load</option>
        <option value={24}>24 fps · Balanced</option>
        <option value={30}>30 fps</option>
        <option value={60}>60 fps · Higher load</option>
      </select>
      <p className="panel-subtitle">Limits animated backgrounds without reducing text responsiveness or changing clip sharpness.</p>
    </div>
    <div className="control-group toggle-row">
      <div className="toggle-info"><h4 id="status-bar-label">Show status bar</h4>
        <p>Background details and shortcuts. Errors always remain visible.</p></div>
      <label className="toggle">
        <input type="checkbox" checked={defaults.showStatusBar ?? true} aria-labelledby="status-bar-label"
          onChange={e => onPatch({ defaults: { showStatusBar: e.target.checked } })} />
        <span className="toggle-track" />
      </label>
    </div>
  </section>
}
