import { useEffect, useState } from 'react'
import type { GifConversionSettings } from '../../lib/gif-conversion'

interface Variant extends GifConversionSettings { gifPath: string; bytes: number }
interface Props {
  sourcePath?: string
  gifPath?: string | null
  settings?: GifConversionSettings
  fallback: GifConversionSettings
  label?: string
  status?: string
  onChange: (settings: GifConversionSettings) => void
}

export function GifConversionControls({ sourcePath, gifPath, settings, fallback, label = 'Clip', status, onChange }: Props) {
  const [variants, setVariants] = useState<Variant[]>([])
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    setLoaded(false)
    if (!sourcePath) { setVariants([]); return }
    const controller = new AbortController()
    fetch(`/api/media/variants?path=${encodeURIComponent(sourcePath)}`, { signal: controller.signal })
      .then(response => response.json())
      .then(data => { if (!controller.signal.aborted) { setVariants(data.variants ?? []); setLoaded(true) } })
      .catch(() => {})
    return () => controller.abort()
  }, [sourcePath, gifPath, status])
  const active = variants.find(variant => variant.gifPath === gifPath)
  const quality = settings ?? active ?? fallback
  const rates = [...new Set([12, 15, 24, 30, 60, ...(typeof quality.fps === 'number' ? [quality.fps] : []),
    ...variants.flatMap(variant => typeof variant.fps === 'number' ? [variant.fps] : [])])].sort((a, b) => a - b)
  const ready = (fps: number | 'source') => variants.some(variant => variant.fps === fps && variant.width === quality.width)
  const parse = (value: string) => value === 'source' ? 'source' as const : Number(value)
  return <div className="clip-quality">
    <label className="clip-fps">
      <span>{label === 'Default' ? 'Default FPS' : 'FPS'}</span>
      <select className="select-input" aria-label={`${label} FPS`} value={quality.fps}
        onChange={event => onChange({ fps: parse(event.target.value), width: quality.width })}>
        <option value="source">Original{ready('source') ? ' ✓' : ''}</option>
        {rates.map(fps => <option key={fps} value={fps}>{fps} FPS{ready(fps) ? ' ✓' : ''}</option>)}
      </select>
    </label>
    <details className="clip-size">
      <summary>{quality.width === 'source' ? 'Original size' : `${quality.width}px`}</summary>
      <select className="select-input" aria-label={`${label} width`} value={quality.width}
        onChange={event => onChange({ fps: quality.fps, width: parse(event.target.value) })}>
        <option value="source">Original size</option>
        {[...new Set([480, 640, 960, 1280, 1920, ...(typeof quality.width === 'number' ? [quality.width] : [])])].sort((a, b) => a - b)
          .map(width => <option key={width} value={width}>{width}px{variants.some(v => v.width === width && v.fps === quality.fps) ? ' ✓' : ''}</option>)}
      </select>
    </details>
    {sourcePath && (status === 'converting' || status === 'idle') && <span className="clip-preparing" role="status">{status === 'converting' ? 'Preparing…' : 'Queued'}</span>}
    {sourcePath && status === 'converting' && <div className="conversion-progress-indeterminate"><progress aria-label={`Preparing ${label}`} /></div>}
    {sourcePath && loaded && !ready(quality.fps) && status !== 'converting' && status !== 'idle' && <button
      type="button" className="btn-secondary" aria-label={`Prepare ${label}`} onClick={() => onChange(quality)}>Prepare</button>}
  </div>
}
