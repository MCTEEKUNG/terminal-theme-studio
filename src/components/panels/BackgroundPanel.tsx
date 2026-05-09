import { useState, useEffect } from 'react'
import type { WTSettings, ProfileDefaults } from '../../types'

interface Props {
  settings: WTSettings
  onPatch: (body: { defaults: Partial<ProfileDefaults> }) => void
}

const VIDEO_RE = /\.(mp4|webm|ogg|mov|avi|mkv)$/i
const IMAGE_RE = /\.(png|jpg|jpeg|webp|bmp|gif)$/i

function getMediaLabel(p: string): string {
  if (VIDEO_RE.test(p)) return 'VIDEO'
  if (/\.gif$/i.test(p)) return 'GIF'
  if (IMAGE_RE.test(p)) return 'IMAGE'
  return ''
}

const STRETCH_MODES: ProfileDefaults['backgroundImageStretchMode'][] = [
  'none', 'fill', 'uniform', 'uniformToFill'
]

const ALIGNMENTS: ProfileDefaults['backgroundImageAlignment'][] = [
  'center', 'top', 'bottom', 'left', 'right',
  'topLeft', 'topRight', 'bottomLeft', 'bottomRight'
]

type ConvertState = 'idle' | 'converting' | 'done' | 'error'

export function BackgroundPanel({ settings, onPatch }: Props) {
  const d = settings.profiles.defaults
  const bgImage = d.backgroundImage ?? ''
  const bgOpacity = d.backgroundImageOpacity ?? 1.0
  const stretchMode = d.backgroundImageStretchMode ?? 'uniformToFill'
  const alignment = d.backgroundImageAlignment ?? 'center'

  const [convertState, setConvertState] = useState<ConvertState>('idle')
  const [convertError, setConvertError] = useState('')

  // Auto-convert video → GIF whenever the path is a video
  useEffect(() => {
    if (!bgImage || !VIDEO_RE.test(bgImage)) {
      setConvertState('idle')
      setConvertError('')
      return
    }

    setConvertState('converting')
    setConvertError('')

    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/convert-gif', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: bgImage }),
          signal: controller.signal,
        })
        const data: { gifPath?: string; error?: string } = await res.json()
        if (!res.ok) {
          if (data.error === 'ffmpeg_missing') {
            setConvertError('ffmpeg not found — install it from ffmpeg.org and add it to PATH')
          } else {
            setConvertError(data.error ?? 'Conversion failed')
          }
          setConvertState('error')
        } else if (data.gifPath) {
          onPatch({ defaults: { backgroundImage: data.gifPath } })
          setConvertState('done')
        }
      } catch (e: unknown) {
        if ((e as Error)?.name === 'AbortError') return
        setConvertError('Network error')
        setConvertState('error')
      }
    }, 800)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [bgImage, onPatch])

  const isVideo = VIDEO_RE.test(bgImage)
  const label = getMediaLabel(bgImage)

  return (
    <div>
      <div className="panel-title">Background</div>

      <div className="control-group">
        <div className="control-label">
          <span>File Path</span>
          {label && !isVideo && <span className="control-value">{label}</span>}
          {isVideo && convertState === 'converting' && (
            <span className="convert-badge converting">⟳ Converting…</span>
          )}
          {isVideo && convertState === 'done' && (
            <span className="convert-badge done">✓ Converted to GIF</span>
          )}
          {isVideo && convertState === 'error' && (
            <span className="convert-badge error">✕ Error</span>
          )}
        </div>
        <input
          className="text-input"
          type="text"
          value={bgImage}
          placeholder="C:\Users\ASUS\Pictures\wallpaper.png"
          onChange={e => onPatch({ defaults: { backgroundImage: e.target.value || null } })}
        />
        {convertState === 'error' && convertError && (
          <div className="convert-error">{convertError}</div>
        )}
        {convertState !== 'error' && (
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4 }}>
            Images: PNG JPG GIF WebP — Videos: MP4 WebM OGG MOV (auto-converted to GIF)
          </div>
        )}
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
