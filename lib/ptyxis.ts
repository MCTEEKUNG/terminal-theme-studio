import { mkdirSync, existsSync, writeFileSync } from 'fs'
import path from 'path'
import os from 'os'
import type { WTSettings, ColorScheme, TerminalConnection } from '../src/types'

const ANSI = ['#0c0c0c', '#c50f1f', '#13a10e', '#c19c00', '#0037da', '#881798', '#3a96dd', '#cccccc',
  '#767676', '#e74856', '#16c60c', '#f9f1a5', '#3b78ff', '#b4009e', '#61d6d6', '#f2f2f2']
const KEYS = ['black', 'red', 'green', 'yellow', 'blue', 'purple', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightPurple', 'brightCyan', 'brightWhite'] as const

function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[\da-f]{6}([\da-f]{2})?$/i.test(value) ? value : fallback
}

export function renderPalette(scheme?: ColorScheme): string {
  return ['[Palette]', 'Name=Terminal Theme Studio',
    `Background=${color(scheme?.background, '#0c0c0c')}`,
    `Foreground=${color(scheme?.foreground, '#cccccc')}`,
    `Cursor=${color(scheme?.cursorColor, color(scheme?.foreground, '#cccccc'))}`,
    ...KEYS.map((key, i) => `Color${i}=${color(scheme?.[key], ANSI[i])}`), ''].join('\n')
}

export function variantString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

function run(args: string[]): string {
  const result = Bun.spawnSync(args, { stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString().trim() || `${args[0]} failed`)
  return result.stdout.toString().trim()
}

export function createPtyxisBridge(enabled: boolean) {
  const status: TerminalConnection = { backend: enabled ? 'ptyxis' : 'windows-terminal', state: 'idle' }
  let pending: WTSettings | null = null
  let running = false
  let lastApplied = ''
  const paletteDir = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'), 'org.gnome.Ptyxis/palettes')
  const backupDir = path.join(import.meta.dir, '../.ptyxis-backup')

  async function drain() {
    if (running) return
    running = true
    while (pending) {
      const settings = pending
      pending = null
      try {
        const rawUuid = run(['gsettings', 'get', 'org.gnome.Ptyxis', 'default-profile-uuid'])
        const uuid = rawUuid.slice(1, -1)
        if (!/^[a-f\d-]+$/i.test(uuid)) throw new Error('No default Ptyxis profile found')
        const profile = `org.gnome.Ptyxis.Profile:/org/gnome/Ptyxis/Profiles/${uuid}/`
        status.profile = uuid
        const defaults = settings.profiles.defaults
        const palette = renderPalette(settings.schemes.find(s => s.name === defaults.colorScheme))
        const opacity = Math.max(0, Math.min(100, defaults.opacity ?? 100)) / 100
        const font = defaults.font
        if (!Number.isFinite(opacity)) throw new Error('Invalid opacity')
        if (font && (!font.face.trim() || /[\r\n\0]/.test(font.face) || !Number.isFinite(font.size) || font.size < 1 || font.size > 200)) {
          throw new Error('Invalid font settings')
        }
        const signature = JSON.stringify({ uuid, palette, opacity, font })
        if (signature === lastApplied) { status.state = 'connected'; delete status.error; continue }
        status.state = 'syncing'

        // Save the original desktop settings once, before the first write.
        mkdirSync(backupDir, { recursive: true })
        const backupFile = path.join(backupDir, 'original.dconf')
        if (!existsSync(backupFile)) writeFileSync(backupFile, run(['dconf', 'dump', '/org/gnome/Ptyxis/']) + '\n', { flag: 'wx' })
        mkdirSync(paletteDir, { recursive: true })
        // Alternate two IDs so Ptyxis resolves a fresh palette on each change.
        // Its directory monitor reloads palette files after 100ms.
        const currentPalette = run(['gsettings', 'get', profile, 'palette'])
        const slot = currentPalette === "'terminal-theme-studio-1'" ? 0 : 1
        const paletteId = `terminal-theme-studio-${slot}`
        writeFileSync(path.join(paletteDir, `${paletteId}.palette`), palette)
        await new Promise(resolve => setTimeout(resolve, 250))
        run(['gsettings', 'set', profile, 'palette', variantString(paletteId)])
        run(['gsettings', 'set', profile, 'opacity', String(opacity)])
        if (font) {
          const weights: Record<string, string> = { thin: 'Thin', 'extra-light': 'Ultra-Light', light: 'Light',
            'semi-light': 'Semi-Light', normal: 'Regular', 'semi-bold': 'Semi-Bold', bold: 'Bold', 'extra-bold': 'Ultra-Bold' }
          run(['gsettings', 'set', 'org.gnome.Ptyxis', 'font-name',
            variantString(`${font.face},monospace ${weights[font.weight] ?? 'Regular'} ${font.size}`)])
          run(['gsettings', 'set', 'org.gnome.Ptyxis', 'use-system-font', 'false'])
        }
        lastApplied = signature
        status.state = 'connected'
        delete status.error
      } catch (error) {
        status.state = 'error'
        status.error = error instanceof Error ? error.message : String(error)
        console.error('Ptyxis sync failed:', status.error)
      }
    }
    running = false
  }

  return {
    status,
    schedule(settings: WTSettings) {
      if (!enabled) return
      pending = structuredClone(settings)
      void drain()
    },
  }
}
