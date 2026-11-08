import { useState, useEffect } from 'react'
import type { WTSettings, ProfileDefaults } from '../../types'
import type { UsePlaylistReturn } from '../../hooks/usePlaylist'
import { GifConversionControls } from './GifConversionControls'
import type { StudioRequest } from '../../hooks/useSettings'
import type { GifConversionSettings } from '../../lib/gif-conversion'

interface Props {
  plain?: boolean
  settings: WTSettings
  onPatch: (body: { defaults: Partial<ProfileDefaults> }) => void
  playlist: UsePlaylistReturn
  isPtyxis?: boolean
  request: StudioRequest
  conversionSettings: GifConversionSettings
}

const VIDEO_RE = /\.(mp4|webm|ogg|mov|avi|mkv)$/i
const IMAGE_RE = /\.(png|jpg|jpeg|webp|bmp|gif)$/i

function getMediaLabel(p: string): string {
  if (VIDEO_RE.test(p)) return 'VIDEO'
  if (/\.gif$/i.test(p)) return 'GIF'
  if (IMAGE_RE.test(p)) return 'IMAGE'
  return ''
}

const STRETCH_MODES: NonNullable<ProfileDefaults['backgroundImageStretchMode']>[] = [
  'none', 'fill', 'uniform', 'uniformToFill'
]

const ALIGNMENTS: NonNullable<ProfileDefaults['backgroundImageAlignment']>[] = [
  'center', 'top', 'bottom', 'left', 'right',
  'topLeft', 'topRight', 'bottomLeft', 'bottomRight'
]

type ConvertState = 'idle' | 'converting' | 'done' | 'error'

export function BackgroundPanel({ settings, onPatch, playlist, isPtyxis, plain, request, conversionSettings }: Props) {
  const d = settings.profiles.defaults
  const bgImage = d.backgroundImage ?? ''
  const bgOpacity = d.backgroundImageOpacity ?? 1.0
  const stretchMode = d.backgroundImageStretchMode ?? 'uniform'
  const alignment = d.backgroundImageAlignment ?? 'center'

  const { playlist: config, patchConfig, importFolder, removeItem, moveItem, updateItem, play, pause, next, prev, jumpTo } = playlist

  const isPlaylistMode = config.mode === 'playlist'

  // Single-mode conversion state
  const [convertState, setConvertState] = useState<ConvertState>('idle')
  const [convertError, setConvertError] = useState('')
  const [conversionAttempt, setConversionAttempt] = useState(0)
  const [sourceVideo, setSourceVideo] = useState<{ background: string; path: string } | null>(null)

  useEffect(() => {
    if (!bgImage || !/\.gif$/i.test(bgImage)) return
    const controller = new AbortController()
    fetch(`/api/preview/source?path=${encodeURIComponent(bgImage)}`, { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error('Source unavailable'); return response.json() })
      .then(data => {
        if (!controller.signal.aborted && typeof data.path === 'string' && VIDEO_RE.test(data.path)) {
          setSourceVideo({ background: bgImage, path: data.path })
        }
      }).catch(() => {})
    return () => controller.abort()
  }, [bgImage])

  // Playlist folder import
  const [folderPath, setFolderPath] = useState(config.folderPath ?? '')
  useEffect(() => { setFolderPath(config.folderPath ?? '') }, [config.folderPath])
  const [importStatus, setImportStatus] = useState('')
  const [isImporting, setIsImporting] = useState(false)

  // Auto-convert video → GIF in single mode
  useEffect(() => {
    if (isPlaylistMode || !bgImage || !VIDEO_RE.test(bgImage)) {
      setConvertState('idle')
      setConvertError('')
      return
    }
    setConvertState('converting')
    setConvertError('')
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const data = await request('/api/convert-gif', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: bgImage, settings: conversionSettings }),
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
        if (data.gifPath) {
          onPatch({ defaults: { backgroundImage: data.gifPath } })
          setConvertState('done')
        }
      } catch (e: unknown) {
        if ((e as Error)?.name === 'AbortError') return
        if (controller.signal.aborted) return
        setConvertError((e as Error).message)
        setConvertState('error')
      }
    }, 350)
    return () => { clearTimeout(timer); controller.abort() }
  }, [bgImage, onPatch, isPlaylistMode, request, conversionSettings.fps, conversionSettings.width, conversionAttempt])

  const isVideo = VIDEO_RE.test(bgImage)
  const label = getMediaLabel(bgImage)
  const singleSource = isVideo ? bgImage : sourceVideo?.background === bgImage ? sourceVideo.path : undefined

  async function setQuality(quality: GifConversionSettings) {
    try {
      await request('/api/conversion-settings', { method: 'PUT', body: JSON.stringify(quality) })
      if (!isPlaylistMode && singleSource) { setConversionAttempt(value => value + 1); onPatch({ defaults: { backgroundImage: singleSource } }) }
    } catch (error) { if ((error as Error).name !== 'AbortError') setConvertError((error as Error).message) }
  }

  async function handleImportFolder() {
    const path = folderPath.trim()
    if (!path || isImporting) return
    setIsImporting(true)
    setImportStatus('')
    try {
      const result = await importFolder(path)
      if (result.error) {
        setImportStatus(result.error)
        return
      }
      const cleanup = result.removedDuplicates
        ? ` Removed ${result.removedDuplicates} legacy generated GIF${result.removedDuplicates === 1 ? '' : 's'} from the playlist.`
        : ''
      setImportStatus(result.added
        ? `Added ${result.added} clip${result.added === 1 ? '' : 's'}${result.skipped ? ` — skipped ${result.skipped} already in the playlist` : ''}.${cleanup}`
        : `No new media files found${result.scanned ? ' — all matching files are already in the playlist' : ''}.${cleanup}`)
    } catch {
      setImportStatus('Could not import the folder. Check that the playlist server is running.')
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <div>
      <h2 className="panel-title">{plain ? 'Background' : 'Set the scene.'}</h2>

      {/* Mode toggle */}
      <div className="playlist-tabs">
        <button
          aria-pressed={!isPlaylistMode}
          className={`playlist-tab${!isPlaylistMode ? ' active' : ''}`}
          onClick={() => patchConfig({ mode: 'single', ...(isPlaylistMode ? { folderPath } : {}) })}
        >
          Single
        </button>
        <button
          aria-pressed={isPlaylistMode}
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
            <label htmlFor="background-path">File path</label>
            {label && !isVideo && <span className="control-value">{label}</span>}
            {isVideo && convertState === 'error' && (
              <span className="convert-badge error">✕ Error</span>
            )}
          </div>
          <input
            id="background-path" className="text-input"
            type="text"
            value={singleSource ?? bgImage}
            placeholder={isPtyxis ? '/home/you/Pictures/wallpaper.png' : 'C:/Users/you/Pictures/wallpaper.png'}
            onChange={e => onPatch({ defaults: { backgroundImage: e.target.value || null } })}
            onPaste={e => {
              e.preventDefault()
              onPatch({ defaults: { backgroundImage: e.clipboardData.getData('text').trim().replace(/^"(.*)"$/, '$1') || null } })
            }}
          />
          {convertState === 'error' && convertError && (
            <div className="convert-error">{convertError}</div>
          )}
          {singleSource && <GifConversionControls sourcePath={singleSource} gifPath={bgImage} settings={conversionSettings} fallback={conversionSettings}
            label="Single video" status={convertState === 'idle' && !isVideo ? 'ready' : convertState} onChange={setQuality} />}
        </div>
      )}

      {/* ── Playlist mode ── */}
      {isPlaylistMode && (
        <>
          {/* Import folder */}
          <div className="control-group">
            <div className="control-label">
              <label htmlFor="playlist-folder">Folder path</label>
              <span className="control-value">{config.items.length} clips</span>
            </div>
            <div className="playlist-add-row">
              <input
                id="playlist-folder" className="text-input"
                type="text"
                value={folderPath}
                placeholder={isPtyxis ? '/home/you/Videos' : 'C:/Users/you/Videos'}
                 onChange={e => setFolderPath(e.target.value)}
                 onBlur={() => { if (folderPath !== config.folderPath) void patchConfig({ folderPath }) }}
                onKeyDown={e => { if (e.key === 'Enter') handleImportFolder() }}
              />
              <button
                className="btn-secondary"
                disabled={!folderPath.trim() || isImporting}
                onClick={handleImportFolder}
              >
                 {isImporting ? 'Scanning…' : 'Load clips'}
              </button>
            </div>
            {importStatus && <div className="playlist-import-status" role="status">{importStatus}</div>}
          </div>

          <GifConversionControls fallback={conversionSettings} settings={conversionSettings} label="Default" onChange={setQuality} />
          {convertError && <p className="convert-error" role="alert">{convertError}</p>}
          {config.items.some(item => VIDEO_RE.test(item.sourcePath) && (item.status === 'idle' || item.status === 'converting')) && (
            <div className="conversion-progress" role="status">
              <div className="conversion-progress-heading">
                <span>Preparing clips</span>
                <span>{config.items.filter(item => VIDEO_RE.test(item.sourcePath) && item.status === 'ready').length} / {config.items.filter(item => VIDEO_RE.test(item.sourcePath)).length} clips ready</span>
              </div>
              <progress className="conversion-progress-bar" aria-label="Clips prepared" value={config.items.filter(item => VIDEO_RE.test(item.sourcePath) && item.status === 'ready').length} max={config.items.filter(item => VIDEO_RE.test(item.sourcePath)).length} />
            </div>
          )}

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
                       item.status === 'converting' ? 'Preparing…' :
                       item.status === 'idle' ? 'Queued' :
                      item.error ?? 'Error'
                    }
                  />
                  <button type="button"
                    className="playlist-item-name"
                    title={item.sourcePath}
                    onClick={() => jumpTo(idx)}
                  >
                    {item.sourcePath.split(/[\\/]/).pop()}
                  </button>
                  {item.status === 'error' && <span className="clip-preparing" title={item.error ?? ''}>Could not prepare</span>}
                  {config.durationMode === 'full-video' && VIDEO_RE.test(item.sourcePath) ? (
                    <span className="playlist-duration-label" title="Uses the full source video length">Full clip</span>
                  ) : <>
                  <input
                    className="playlist-duration-input"
                    type="number"
                    min={1}
                    value={item.durationSec}
                    onChange={e => updateItem(item.id, { durationSec: Math.max(1, Number(e.target.value)) })}
                    title="Duration in seconds"
                  />
                  <span className="playlist-duration-label">s</span>
                  </>}
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
              <div className="playlist-transport">
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
              <div className="playlist-playback-modes" role="group" aria-label="Playlist playback mode">
                <button
                  className={`playlist-mode-btn${config.playbackMode === 'loop' ? ' active' : ''}`}
                  onClick={() => patchConfig({ playbackMode: 'loop' })}
                  aria-pressed={config.playbackMode === 'loop'}
                  title="Play every clip in order, then return to the first clip"
                >↻ Loop all</button>
                <button
                  className={`playlist-mode-btn${config.playbackMode === 'shuffle' ? ' active' : ''}`}
                  onClick={() => patchConfig({ playbackMode: 'shuffle' })}
                  aria-pressed={config.playbackMode === 'shuffle'}
                  title="Choose a different ready clip at random each time"
                >⇄ Shuffle</button>
                <button
                  className={`playlist-mode-btn${config.playbackMode === 'repeat-one' ? ' active' : ''}`}
                  onClick={() => patchConfig({ playbackMode: 'repeat-one' })}
                  aria-pressed={config.playbackMode === 'repeat-one'}
                  title="Repeat only the current clip"
                >↻ One clip</button>
              </div>
            </div>
          )}

          <div className="control-group" style={{ marginTop: 8 }}>
            <label className="control-label" htmlFor="playlist-duration-mode">Switch to next clip</label>
            <select id="playlist-duration-mode" className="select-input"
              value={config.durationMode ?? 'fixed'}
              onChange={e => patchConfig({ durationMode: e.target.value as 'fixed' | 'full-video' })}>
              <option value="fixed">After a set duration</option>
              <option value="full-video">Play full video — then next clip</option>
            </select>
            <p className="panel-subtitle">{config.durationMode === 'full-video'
              ? 'Video length is detected automatically. Images and GIFs use their set duration.'
              : 'Each clip uses the duration set in the playlist.'}</p>
          </div>

          {/* Manual timing is only relevant in the fixed-duration mode. */}
          {config.durationMode !== 'full-video' && <div className="control-group" style={{ marginTop: 8 }}>
            <div className="control-label">
              <span>Default Duration</span>
              <span className="control-value">{config.defaultDurationSec}s</span>
            </div>
            <input
              aria-label="Default clip duration" type="range" className="slider" min={2} max={120} step={1}
              value={config.defaultDurationSec}
              onChange={e => patchConfig({ defaultDurationSec: Number(e.target.value) })}
            />
          </div>}
        </>
      )}

      {/* Appearance — always visible */}
      {isPtyxis && (
        <p className="panel-subtitle">Frosted glass softens the desktop behind Terminal. Your video and text stay sharp.</p>
      )}
      <div className="control-group">
        <div className="control-label">
          <span>Image Opacity</span>
          <span className="control-value">{Math.round(bgOpacity * 100)}%</span>
        </div>
        <input
          aria-label="Background image opacity" type="range" className="slider" min={0} max={100} step={1}
          value={Math.round(bgOpacity * 100)}
          onChange={e => onPatch({ defaults: { backgroundImageOpacity: Number(e.target.value) / 100 } })}
        />
        <button
          className="btn-secondary"
          style={{ width: '100%', marginTop: 6 }}
          onClick={() => onPatch({ defaults: {
            backgroundImageOpacity: 0.12,
            opacity: 100,
            adjustIndistinguishableColors: 'always',
          } })}
        >
          Improve Text Readability
        </button>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4 }}>
          Fades bright backgrounds and keeps terminal text fully opaque.
        </div>
      </div>

      <div className="control-group">
        <div className="control-label"><span>Stretch Mode</span></div>
        <select
          aria-label="Stretch mode" className="select-input"
          value={stretchMode}
          onChange={e => onPatch({ defaults: { backgroundImageStretchMode: e.target.value as ProfileDefaults['backgroundImageStretchMode'] } })}
        >
          {STRETCH_MODES.map(m => <option key={m} value={m}>{{ none: 'Original size', fill: 'Stretch to fill', uniform: 'Fit entire image', uniformToFill: 'Fill & crop' }[m]}</option>)}
        </select>
      </div>

      <div className="control-group">
        <div className="control-label"><span>Alignment</span></div>
        <select
          aria-label="Alignment" className="select-input"
          value={alignment}
          onChange={e => onPatch({ defaults: { backgroundImageAlignment: e.target.value as ProfileDefaults['backgroundImageAlignment'] } })}
        >
          {ALIGNMENTS.map(a => <option key={a} value={a}>{a.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())}</option>)}
        </select>
      </div>
    </div>
  )
}
