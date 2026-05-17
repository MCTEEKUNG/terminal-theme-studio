import { memo, useMemo, type CSSProperties } from 'react'
import type { WTSettings } from '../types'
import { getActiveScheme } from '../lib/settings'

interface Props {
  settings: WTSettings
}

const VIDEO_EXTS = /\.(mp4|webm|ogg|mov)$/i

function isVideo(p: string) { return VIDEO_EXTS.test(p) }
function fileUrl(p: string) { return `/api/file?path=${encodeURIComponent(p)}` }

function alignmentToCss(a: string | undefined): string {
  const map: Record<string, string> = {
    topLeft: 'top left', topRight: 'top right',
    bottomLeft: 'bottom left', bottomRight: 'bottom right',
  }
  return map[a ?? ''] ?? (a ?? 'center')
}

function TerminalPreviewInner({ settings }: Props) {
  const d = settings.profiles.defaults
  const scheme = getActiveScheme(settings)

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
    const fontSize = Math.min((font as { face: string; size: number }).size, 12)
    const fontFamily = `'${font.face}', 'Cascadia Code', Consolas, 'Courier New', monospace`

    const stretchSize =
      d.backgroundImageStretchMode === 'fill' ? '100% 100%'
      : d.backgroundImageStretchMode === 'uniform' ? 'contain'
      : d.backgroundImageStretchMode === 'none' ? 'auto'
      : 'cover'

    const alignment = alignmentToCss(d.backgroundImageAlignment)

    const bodyStyle: CSSProperties = {
      backgroundColor: bg,
      color: fg,
      fontFamily,
      fontSize,
      opacity,
      position: 'relative',
      overflow: 'hidden',
    }

    return {
      bg, fg, green, brightGreen, blue, yellow, red, cyan, brightBlack, cursorColor,
      titleBg, bgImage, bgImageOpacity, stretchSize, alignment, bodyStyle,
    }
  }, [settings])

  const {
    bg, fg, green, brightGreen, blue, yellow, red, cyan, brightBlack, cursorColor,
    titleBg, bgImage, bgImageOpacity, stretchSize, alignment, bodyStyle,
  } = view

  return (
    <div className="terminal-preview">
      <div className="preview-label">
        <span className="preview-live-dot" />
        Live Preview
      </div>

      <div className="screen">
      <div className="wt-window">
        <div className="desktop-bg" />

        <div className="wt-titlebar" style={{ background: titleBg }}>
          <div className="wt-tabstrip">
            <div className="wt-tab" style={{ background: bg, color: fg }}>
              <span className="wt-tab-icon" style={{ color: brightBlack }}>❯_</span>
              PowerShell
            </div>
            <span className="wt-newtab" style={{ color: brightBlack }}>+</span>
          </div>
          <div className="wt-wincontrols">
            <span className="wt-ctrl">─</span>
            <span className="wt-ctrl">□</span>
            <span className="wt-ctrl wt-close">✕</span>
          </div>
        </div>

        <div className="wt-body" style={bodyStyle}>
          {bgImage && !isVideo(bgImage) && (
            <div
              className="wt-bg-media"
              style={{
                backgroundImage: `url('${fileUrl(bgImage)}')`,
                backgroundSize: stretchSize,
                backgroundPosition: alignment,
                backgroundRepeat: 'no-repeat',
                opacity: bgImageOpacity,
              }}
            />
          )}

          <div className="wt-content">
            <div className="tl" style={{ color: brightBlack }}>Windows PowerShell</div>
            <div className="tl" style={{ color: brightBlack, marginBottom: 6 }}>
              Copyright (C) Microsoft Corporation.
            </div>

            <div className="tl">
              <Prompt blue={blue} green={green} fg={fg} />
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
              <Prompt blue={blue} green={green} fg={fg} />
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
              <Prompt blue={blue} green={green} fg={fg} />
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
      </div>
      </div>
    </div>
  )
}

export const TerminalPreview = memo(TerminalPreviewInner)

function Prompt({ blue, green, fg }: { blue: string; green: string; fg: string }) {
  return (
    <span>
      <span style={{ color: blue }}>PS </span>
      <span style={{ color: green }}>C:\Users\ASUS</span>
      <span style={{ color: fg }}>&gt; </span>
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

