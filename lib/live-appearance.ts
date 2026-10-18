import { readFileSync, writeFileSync, renameSync } from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import type { ProfileDefaults, WTSettings } from '../src/types'
import { appearanceNumbers } from '../src/lib/appearance'
import { validateAppearance } from './appearance'

const START = '/* BEGIN WEB APPEARANCE */'
const END = '/* END WEB APPEARANCE */'
const BLOCK = /\n?\/\* BEGIN WEB APPEARANCE \*\/[\s\S]*?\/\* END WEB APPEARANCE \*\/\n?/g
function color(value: string | undefined, fallback: string) { return /^#[0-9a-f]{6}$/i.test(value ?? '') ? value! : fallback }
function rgba(hex: string, amount: number) {
  return `rgba(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(',')},${amount / 100})`
}

export function renderLiveAppearance(defaults: ProfileDefaults) {
  const a = appearanceNumbers(defaults)
  const hover = color(defaults.chromeHoverColor, '#ffffff')
  const accent = color(defaults.tabAccentColor, '#ffffff')
  const scope = '__WINDOW__ #studio-terminal-header'
  return `${START}
__WINDOW__ #studio-terminal-tabs box.vertical { padding: ${a.terminalPadding}px; }
${scope} { padding: ${a.headerPaddingY}px ${a.headerPaddingX}px; font-size: ${a.chromeFontSize}px; }
${scope} .terminal-tab { padding: 0; }
${scope} .terminal-tab > box { min-width: ${a.tabMinimumWidth}px; padding: ${a.tabPaddingY}px ${a.tabPaddingX}px; }
${scope} .terminal-tab:hover { background-color: ${rgba(hover, a.tabHoverOpacity)}; }
${scope} .terminal-tab:checked { background-color: ${rgba(hover, a.activeTabOpacity)}; border-color: ${rgba(accent, a.activeTabBorderOpacity)}; }
${scope} button:hover { background-color: ${rgba(hover, a.buttonHoverOpacity)}; }
${scope} .terminal-tab button:hover { background-color: ${rgba(hover, a.closeButtonHoverOpacity)}; }
${scope} button.titlebutton { min-width: ${a.windowButtonSize}px; min-height: ${a.windowButtonSize}px; border-radius: ${a.windowButtonRadius}px; padding: 0; margin: 0; }
__WINDOW__ #studio-terminal-footer { font-size: ${a.statusFontSize}px; padding: ${a.statusPaddingY}px ${a.statusPaddingX}px; }
${END}`
}

function atomicWrite(filename: string, data: string) {
  const temporary = `${filename}.web.tmp`
  writeFileSync(temporary, data, 'utf8')
  renameSync(temporary, filename)
}

// Uses the already-running GTK CSS/JSON watcher. No shell process is relaunched.
export function createLiveAppearanceBridge(enabled: boolean, directory = path.join(import.meta.dir, '../native')) {
  const status: { state: 'idle' | 'connected' | 'error'; revision?: string; error?: string } = { state: 'idle' }
  let applied = ''
  function schedule(settings: WTSettings) {
    if (!enabled) return
    try {
      const defaults = settings.profiles.defaults
      validateAppearance(defaults)
      const css = renderLiveAppearance(defaults)
      const revision = createHash('sha256').update(css + (defaults.closeButtonAlignment ?? '')).digest('hex').slice(0, 12)
      if (revision === applied) return
      const cssPath = path.join(directory, 'appearance.css')
      const existing = readFileSync(cssPath, 'utf8')
      const next = `${existing.replace(BLOCK, '\n').trimEnd()}\n\n${css}\n`
      if (next !== existing) atomicWrite(cssPath, next)
      if (defaults.closeButtonAlignment) {
        const layoutPath = path.join(directory, 'appearance.json')
        const original = readFileSync(layoutPath, 'utf8')
        const layout = JSON.parse(original)
        layout.closeButton = { ...layout.closeButton, valign: defaults.closeButtonAlignment }
        const rendered = JSON.stringify(layout, null, 2) + '\n'
        if (rendered !== original) atomicWrite(layoutPath, rendered)
      }
      applied = revision
      status.state = 'connected'
      status.revision = revision
      delete status.error
    } catch (error) { status.state = 'error'; status.error = String(error) }
  }
  return { status, schedule }
}
