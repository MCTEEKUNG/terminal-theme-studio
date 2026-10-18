import { appearanceNumbers } from '../lib/appearance'
import { memo, useMemo, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { WTSettings } from '../types'
import { getActiveScheme } from '../lib/settings'

interface Props {
  settings: WTSettings
  isPtyxis?: boolean
  specimen?: boolean
}

const VIDEO_EXTS = /\.(mp4|webm|ogg|mov|mkv|avi)$/i

function isVideo(p: string) { return VIDEO_EXTS.test(p) }
function fileUrl(p: string) { return `/api/file?path=${encodeURIComponent(p)}` }

function alignmentToCss(a: string | undefined): string {
  const map: Record<string, string> = {
    topLeft: 'top left', topRight: 'top right',
    bottomLeft: 'bottom left', bottomRight: 'bottom right',
  }
  return map[a ?? ''] ?? (a ?? 'center')
}

function PreviewMedia({ path, opacity, size, alignment }: { path: string; opacity: number; size: string; alignment: string }) {
  const [source, setSource] = useState<{ input: string; path: string } | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/preview/source?path=${encodeURIComponent(path)}`, { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error('Preview unavailable'); return response.json() })
      .then(result => { if (!controller.signal.aborted) setSource({ input: path, path: result.path }) })
      .catch(() => { /* Avoid decoding a large generated GIF when the controller is offline. */ })
    return () => controller.abort()
  }, [path])
  const resolved = source?.input === path ? source.path : null
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let inView = true
    const sync = () => {
      if (document.hidden || !inView) video.pause()
      else void video.play().catch(() => {})
    }
    const observer = new IntersectionObserver(entries => { inView = entries[0]?.isIntersecting ?? false; sync() })
    observer.observe(video)
    document.addEventListener('visibilitychange', sync)
    sync()
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', sync); video.pause() }
  }, [resolved])
  if (!resolved) return null
  if (isVideo(resolved)) return <video ref={videoRef} className="wt-bg-media" src={fileUrl(resolved)} muted loop playsInline
    preload="metadata" aria-hidden="true" style={{ opacity, objectPosition: alignment,
      objectFit: size === '100% 100%' ? 'fill' : size === 'auto' ? 'none' : size === 'cover' ? 'cover' : 'contain' }} />
  return <div className="wt-bg-media" style={{ backgroundImage: `url('${fileUrl(resolved)}')`, backgroundSize: size,
    backgroundPosition: alignment, backgroundRepeat: 'no-repeat', opacity }} />
}

function TerminalPreviewInner({ settings, isPtyxis, specimen }: Props) {
  const d = settings.profiles.defaults
  const scheme = getActiveScheme(settings)
  const appearance = appearanceNumbers(d)
  const hoverColor = d.chromeHoverColor ?? '#ffffff'
  const tint = (color: string, amount: number) => `color-mix(in srgb, ${color} ${amount}%, transparent)`
  const previewVars = { '--preview-close-hover': tint(hoverColor, appearance.closeButtonHoverOpacity),
    '--preview-button-hover': tint(hoverColor, appearance.buttonHoverOpacity) } as CSSProperties

  const view = useMemo(() => {
    const font = d.font ?? { face: 'Cascadia Code', size: 12 }
    const opacity = (d.opacity ?? 100) / 100
    const bgImage = d.backgroundImage || null
    const bgImageOpacity = d.backgroundImageOpacity ?? 1

    const bg = scheme?.background ?? '#0d1117'
    const fg = scheme?.foreground ?? '#e6edf3'
    const green = scheme?.green ?? '#3fb950'
    const brightGreen = scheme?.brightGreen ?? '#56d364'
    const blue = scheme?.blue ?? '#58a6ff'
    const yellow = scheme?.yellow ?? '#d29922'
    const red = scheme?.red ?? '#ff7b72'
    const cyan = scheme?.cyan ?? '#39c5cf'
    const brightBlack = scheme?.brightBlack ?? '#6e7681'
    const cursorColor = scheme?.cursorColor ?? blue

    const titleBg = darken(bg, 0.18)
    const fontSize = (font as { face: string; size: number }).size
    const fontFamily = `'${font.face}', 'Cascadia Code', Consolas, 'Courier New', monospace`

    const stretchSize =
      d.backgroundImageStretchMode === 'fill' ? '100% 100%'
      : d.backgroundImageStretchMode === 'uniform' ? 'contain'
      : d.backgroundImageStretchMode === 'none' ? 'auto'
      : 'contain'

    const alignment = alignmentToCss(d.backgroundImageAlignment)

    const bodyStyle: CSSProperties = {
      backgroundColor: isPtyxis ? `color-mix(in srgb, ${bg} ${opacity * 100}%, transparent)` : bg,
      backdropFilter: isPtyxis ? `blur(${d.glassBlur ?? 16}px) saturate(1.1)` : undefined,
      color: fg,
      fontFamily,
      fontSize: `${fontSize * 4 / 3}px`,
      fontWeight: d.font?.weight?.includes('bold') ? (d.font.weight === 'semi-bold' ? 600 : d.font.weight === 'extra-bold' ? 800 : 700) : d.font?.weight === 'thin' ? 100 : d.font?.weight?.includes('light') ? 300 : 400,
      opacity: isPtyxis ? 1 : opacity,
      position: 'relative',
      ...(isPtyxis ? { padding: appearanceNumbers(d).terminalPadding + 12, lineHeight: 1.2 } : {}),
      overflow: 'hidden',
    }

    return {
      bg, fg, green, brightGreen, blue, yellow, red, cyan, brightBlack, cursorColor,
      titleBg, bgImage, bgImageOpacity, stretchSize, alignment, bodyStyle,
    }
  }, [settings, isPtyxis])

  const {
    bg, fg, green, brightGreen, blue, yellow, red, cyan, brightBlack, cursorColor,
    titleBg, bgImage, bgImageOpacity, stretchSize, alignment, bodyStyle,
  } = view

  return (
    <section id="live-preview" className="terminal-preview" aria-label="Terminal preview">
      <div className="preview-label">
        <span className="preview-live-dot" />
        <h2>Live preview</h2><span className="preview-mode">{isPtyxis ? 'Bash' : 'PowerShell'}</span>
      </div>
      <div className="preview-heading"><h3>{scheme?.name || 'Your terminal'}</h3>{!specimen && <p>A little more you, in every line.</p>}</div>

      <div className="screen">
      <div className="wt-window" style={isPtyxis ? previewVars : undefined}>
        <div className="desktop-bg" />

        <div className="wt-titlebar" style={{ background: isPtyxis ? bodyStyle.backgroundColor : titleBg, height: isPtyxis ? 'auto' : undefined, minHeight: isPtyxis ? appearance.headerHeight - 5 : undefined,
          ...(isPtyxis ? { padding: `${appearance.headerPaddingY}px ${appearance.headerPaddingX}px`, fontSize: appearance.chromeFontSize } : {}) }}>
          <div className="wt-tabstrip" style={isPtyxis ? { alignItems: 'center', gap: d.tabSpacing ?? 4 } : undefined}>
            <div className="wt-tab" style={{ background: isPtyxis ? tint(hoverColor, appearance.activeTabOpacity) : bg, color: fg,
              ...(isPtyxis ? { borderRadius: d.tabCornerRadius ?? 9, border: `1px solid ${tint(d.tabAccentColor ?? '#ffffff', appearance.activeTabBorderOpacity)}`,
                padding: `${appearance.tabPaddingY}px ${appearance.tabPaddingX}px`, minWidth: appearance.tabMinimumWidth, fontSize: appearance.chromeFontSize, alignItems: 'center', alignSelf: 'stretch' } : {}) }}>
              <span className="wt-tab-icon" style={{ color: brightBlack }}>❯_</span>
              {isPtyxis ? 'Terminal' : 'PowerShell'}
              {isPtyxis && <span className="wt-tab-close" aria-hidden="true" style={{ width: d.closeButtonSize ?? 24, height: d.closeButtonSize ?? 24,
                borderRadius: d.closeButtonShape === 'square' ? 0 : d.closeButtonShape === 'rounded' ? 6 : '50%',
                alignSelf: d.closeButtonAlignment === 'start' ? 'flex-start' : d.closeButtonAlignment === 'end' ? 'flex-end' : 'center' }}>×</span>}
            </div>
            <span className="wt-newtab" style={{ color: brightBlack }}>+</span>
          </div>
          <div className="wt-wincontrols">
            <span className="wt-ctrl" style={isPtyxis ? { width: appearance.windowButtonSize, height: appearance.windowButtonSize, borderRadius: appearance.windowButtonRadius, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' } : undefined}>─</span>
            <span className="wt-ctrl" style={isPtyxis ? { width: appearance.windowButtonSize, height: appearance.windowButtonSize, borderRadius: appearance.windowButtonRadius, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' } : undefined}>□</span>
            <span className="wt-ctrl wt-close" style={isPtyxis ? { width: appearance.windowButtonSize, height: appearance.windowButtonSize, borderRadius: appearance.windowButtonRadius, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' } : undefined}>✕</span>
          </div>
        </div>

        <div className="wt-body" style={bodyStyle}>
          {bgImage && <PreviewMedia path={bgImage} opacity={bgImageOpacity} size={stretchSize} alignment={alignment} />}

          <div className="wt-content">
            <div className="tl" style={{ color: brightBlack }}>{isPtyxis ? 'Ubuntu' : 'Windows PowerShell'}</div>
            <div className="tl" style={{ color: brightBlack, marginBottom: 6 }}>
              {isPtyxis ? 'Ptyxis · Bash' : 'Copyright (C) Microsoft Corporation.'}
            </div>

            <div className="tl">
              <Prompt blue={blue} green={green} fg={fg} isPtyxis={isPtyxis} />
              <span style={{ color: cyan }}>git status</span>
            </div>
            <div className="tl" style={{ color: green }}>On branch main</div>
            <div className="tl" style={{ color: fg, opacity: 0.75 }}>Changes not staged for commit:</div>
            <div className="tl">
              <span style={{ color: brightBlack }}>        modified:   </span>
              <span style={{ color: red }}>src/App.tsx</span>
            </div>
            <div className="tl" style={{ marginBottom: 6 }}>
              <span style={{ color: brightBlack }}>        modified:   </span>
              <span style={{ color: red }}>src/index.css</span>
            </div>

            <div className="tl">
              <Prompt blue={blue} green={green} fg={fg} isPtyxis={isPtyxis} />
              <span style={{ color: cyan }}>ls .</span>
            </div>
            <div className="tl tl-row" style={{ gap: 20, marginBottom: 6 }}>
              <span style={{ color: blue }}>Documents</span>
              <span style={{ color: blue }}>Downloads</span>
              <span style={{ color: blue }}>Desktop</span>
              <span style={{ color: brightGreen }}>Projects</span>
              <span style={{ color: yellow }}>README.md</span>
            </div>

            <div className="tl">
              <Prompt blue={blue} green={green} fg={fg} isPtyxis={isPtyxis} />
              <span
                style={{
                  background: cursorColor,
                  color: bg,
                  padding: '0 1px',
                  animation: 'blink 1.2s step-end infinite',
                }}
              >
                █
              </span>
            </div>
          </div>
        </div>
        {isPtyxis && (d.showStatusBar ?? true) && <div className="wt-statusbar" style={{ background: bodyStyle.backgroundColor, color: fg, padding: `${appearance.statusPaddingY}px ${10 + appearance.statusPaddingX + appearance.terminalPadding}px`, fontSize: appearance.statusFontSize }}>
          Background · Ctrl+Shift+T new tab · Ctrl+Shift+C/V · F11
        </div>}
      </div>
      </div>
      <div className="preview-settings" aria-label="Preview settings">
        <span><b>{d.font?.face ?? 'Cascadia Code'}</b> {d.font?.size ?? 12}pt</span>
        <span>{d.opacity ?? 100}% opacity</span>
        <span className="preview-palette" aria-label="Active palette">{(specimen ? [bg, red, green, yellow, blue, scheme?.purple ?? blue, cyan, fg] : [red, green, yellow, blue, cyan]).map((color, i) => <i key={i} style={{ background: color }} />)}</span>
      </div>
      <p className="preview-note">Sample output · Open your terminal to see the full experience.</p>
    </section>
  )
}

export const TerminalPreview = memo(TerminalPreviewInner)

function Prompt({ blue, green, fg, isPtyxis }: { blue: string; green: string; fg: string; isPtyxis?: boolean }) {
  return (
    <span>
      <span style={{ color: blue }}>{isPtyxis ? 'user@ubuntu:' : 'PS '}</span>
      <span style={{ color: green }}>{isPtyxis ? '~' : 'C:\\Users\\ASUS'}</span>
      <span style={{ color: fg }}>{isPtyxis ? '$ ' : '> '}</span>
    </span>
  )
}

function darken(hex: string, factor: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  const r = clamp(parseInt(hex.slice(1, 3), 16) * (1 - factor))
  const g = clamp(parseInt(hex.slice(3, 5), 16) * (1 - factor))
  const b = clamp(parseInt(hex.slice(5, 7), 16) * (1 - factor))
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

