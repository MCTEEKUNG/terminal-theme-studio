import { useState, useEffect } from 'react'
import type { WTSettings, ProfileDefaults } from '../../types'
import type { UsePlaylistReturn } from '../../hooks/usePlaylist'

interface Props {
  settings: WTSettings
  onPatch: (body: { defaults: Partial<ProfileDefaults> }) => void
  playlist: UsePlaylistReturn
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

export function BackgroundPanel({ settings, onPatch, playlist }: Props) {
  const d = settings.profiles.defaults
  const bgImage = d.backgroundImage ?? ''
  const bgOpacity = d.backgroundImageOpacity ?? 1.0
  const stretchMode = d.backgroundImageStretchMode ?? 'uniformToFill'
  const alignment = d.backgroundImageAlignment ?? 'center'

  const { playlist: config, patchConfig, addItem, removeItem, moveItem, updateItem, play, pause, next, prev, jumpTo, retryItem } = playlist

  const isPlaylistMode = config.mode === 'playlist'

  // Single-mode conversion state
  const [convertState, setConvertState] = useState<ConvertState>('idle')
  const [convertError, setConvertError] = useState('')

  // Playlist add-clip input
  const [addPath, setAddPath] = useState('')

  // Auto-convert video → GIF in single mode
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
    return () => { clearTimeout(timer); controller.abort() }
  }, [bgImage, onPatch])

  const isVideo = VIDEO_RE.test(bgImage)
  const label = getMediaLabel(bgImage)

  function handleAddItem() {
    const p = addPath.trim()
    if (!p) return
    addItem(p)
    setAddPath('')
  }

  return (
    <div>
      <div className="panel-title">Background</div>

      {/* Mode toggle */}
      <div className="playlist-tabs">
        <button
          className={`playlist-tab${!isPlaylistMode ? ' active' : ''}`}
          onClick={() => patchConfig({ mode: 'single' })}
        >
          Single
        </button>
        <button
          className={`playlist-tab${isPlaylistMode ? ' active' : ''}`}
          onClick={() => patchConfig({ mode: 'playlist' })}
        >
          Playlist
        </button>
      </div>

      {/* ── Single mode ── */}
      {!isPlaylistMode && (
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
      )}

      {/* ── Playlist mode ── */}
      {isPlaylistMode && (
        <>
          {/* Add clip */}
          <div className="control-group">
            <div className="control-label"><span>Add Clip</span></div>
            <div className="playlist-add-row">
              <input
                className="text-input"
                type="text"
                value={addPath}
                placeholder="C:\path\to\clip.mp4"
                onChange={e => setAddPath(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAddItem() }}
              />
              <button
                className="btn-secondary"
                disabled={!addPath.trim()}
                onClick={handleAddItem}
              >
                Add
              </button>
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4 }}>
              Images: PNG JPG GIF WebP — Videos: MP4 WebM OGG MOV (auto-converted to GIF)
            </div>
          </div>

          {/* Clip list */}
          <div className="playlist-list">
            {config.items.length === 0 ? (
              <div className="playlist-empty">No clips yet — add a video or image above.</div>
            ) : (
              config.items.map((item, idx) => (
                <div
                  key={item.id}
                  className={`playlist-item${idx === config.currentIndex && config.isPlaying ? ' current' : ''}`}
                >
                  <span
                    className={`playlist-status-dot ps-${item.status}`}
                    title={
                      item.status === 'ready' ? 'Ready' :
                      item.status === 'converting' ? 'Converting…' :
                      item.status === 'idle' ? 'Waiting to convert' :
                      item.error ?? 'Error'
                    }
                  />
                  <span
                    className="playlist-item-name"
                    title={item.sourcePath}
                    onClick={() => jumpTo(idx)}
                  >
                    {item.sourcePath.split(/[\\/]/).pop()}
                  </span>
                  {item.status === 'error' && (
                    <button
                      className="playlist-icon-btn"
                      onClick={() => retryItem(item.id)}
                      title={`Retry${item.error ? ': ' + item.error : ''}`}
                      style={{ fontSize: 12, color: 'var(--danger)' }}
                    >
                      ↻
                    </button>
                  )}
                  <input
                    className="playlist-duration-input"
                    type="number"
                    min={1}
                    value={item.durationSec}
                    onChange={e => updateItem(item.id, { durationSec: Math.max(1, Number(e.target.value)) })}
                    title="Duration in seconds"
                  />
                  <span className="playlist-duration-label">s</span>
                  <div className="playlist-item-btns">
                    <button
                      className="playlist-icon-btn"
                      disabled={idx === 0}
                      onClick={() => moveItem(item.id, 'up')}
                      title="Move up"
                    >↑</button>
                    <button
                      className="playlist-icon-btn"
                      disabled={idx === config.items.length - 1}
                      onClick={() => moveItem(item.id, 'down')}
                      title="Move down"
                    >↓</button>
                    <button
                      className="playlist-icon-btn danger"
                      onClick={() => removeItem(item.id)}
                      title="Remove"
                    >×</button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Playback controls */}
          {config.items.length > 0 && (
            <div className="playlist-controls">
              <button className="pl-ctrl-btn" onClick={() => prev()} title="Previous">⏮</button>
              <button
                className="pl-ctrl-btn primary"
                onClick={() => config.isPlaying ? pause() : play()}
                title={config.isPlaying ? 'Pause' : 'Play'}
              >
                {config.isPlaying ? '⏸' : '▶'}
              </button>
              <button className="pl-ctrl-btn" onClick={() => next()} title="Next">⏭</button>
              <span className="playlist-counter">
                {config.currentIndex + 1} / {config.items.length}
              </span>
            </div>
          )}

          {/* Default duration */}
          <div className="control-group" style={{ marginTop: 8 }}>
            <div className="control-label">
              <span>Default Duration</span>
              <span className="control-value">{config.defaultDurationSec}s</span>
            </div>
            <input
              type="range" className="slider" min={2} max={120} step={1}
              value={config.defaultDurationSec}
              onChange={e => patchConfig({ defaultDurationSec: Number(e.target.value) })}
            />
          </div>
        </>
      )}

      {/* Appearance — always visible */}
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
