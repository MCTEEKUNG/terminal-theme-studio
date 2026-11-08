import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import path from 'path'
import { applyEdits, modify, parse, printParseErrorCode, type ParseError } from 'jsonc-parser'
import type { WTSettings } from '../src/types'

export function resolveSettingsPath(projectDir: string, env = process.env, platform = process.platform): string {
  if (env.WT_SETTINGS_PATH) {
    const file = path.resolve(env.WT_SETTINGS_PATH)
    if (!existsSync(file)) throw new Error(`WT_SETTINGS_PATH does not exist: ${file}`)
    return file
  }
  if (platform !== 'win32') return path.join(projectDir, 'wt-settings.json')
  const local = env.LOCALAPPDATA
  const candidates = local ? [
    path.join(local, 'Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json'),
    path.join(local, 'Packages/Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe/LocalState/settings.json'),
    path.join(local, 'Microsoft/Windows Terminal/settings.json'),
  ] : []
  const found = candidates.find(file => existsSync(file))
  if (found) return found
  throw new Error('Windows Terminal settings not found. Install/open Windows Terminal and save its settings once, or set WT_SETTINGS_PATH to an existing settings.json.')
}

export function parseSettings(text: string): WTSettings {
  const errors: ParseError[] = []
  const data = parse(text.replace(/^\uFEFF/, ''), errors, { allowTrailingComma: true })
  if (errors.length) throw new Error(`Invalid settings JSON: ${printParseErrorCode(errors[0].error)} at offset ${errors[0].offset}`)
  const isObject = (value: unknown) => value !== null && typeof value === 'object' && !Array.isArray(value)
  if (!isObject(data) || (data.profiles !== undefined && !isObject(data.profiles))
    || (data.profiles?.defaults !== undefined && !isObject(data.profiles.defaults))
    || (data.profiles?.list !== undefined && !Array.isArray(data.profiles.list))
    || (data.schemes !== undefined && !Array.isArray(data.schemes))) {
    throw new Error('Invalid Windows Terminal settings structure')
  }
  return { ...data, profiles: { ...data.profiles, defaults: data.profiles?.defaults ?? {}, list: data.profiles?.list ?? [] }, schemes: data.schemes ?? [] }
}

export function createSettingsStore(file: string) {
  // Only the non-Windows development fallback is created automatically.
  if (!existsSync(file)) {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, '{"profiles":{"defaults":{},"list":[]},"schemes":[]}\n', { flag: 'wx' })
  }
  let source = ''
  let current: WTSettings
  function read(): WTSettings {
    const text = readFileSync(file, 'utf8')
    const settings = parseSettings(text)
    source = text
    current = settings
    return settings
  }
  read()
  return {
    read,
    write(settings: WTSettings) {
      if (readFileSync(file, 'utf8') !== source) throw new Error('Settings changed on disk; retry your change')
      const bom = source.startsWith('\uFEFF') ? '\uFEFF' : ''
      let text = source.slice(bom.length)
      const formattingOptions = { insertSpaces: true, tabSize: 4, eol: text.includes('\r\n') ? '\r\n' : '\n' }
      const update = (keys: (string | number)[], before: unknown, after: unknown) => {
        if (JSON.stringify(before) !== JSON.stringify(after)) text = applyEdits(text, modify(text, keys, after, { formattingOptions }))
      }
      const before = current.profiles.defaults as Record<string, unknown>
      const after = settings.profiles.defaults as Record<string, unknown>
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        update(['profiles', 'defaults', key], before[key], after[key])
      }
      settings.schemes.forEach((scheme, index) => update(['schemes', index], current.schemes[index], scheme))
      for (let index = current.schemes.length - 1; index >= settings.schemes.length; index--) {
        update(['schemes', index], current.schemes[index], undefined)
      }
      if (bom + text === source) return
      parseSettings(text)
      const backup = `${file}.theme-studio.bak`
      if (!existsSync(backup)) copyFileSync(file, backup)
      const temporary = `${file}.${crypto.randomUUID()}.tmp`
      try {
        writeFileSync(temporary, bom + text, 'utf8')
        renameSync(temporary, file)
      } finally { if (existsSync(temporary)) unlinkSync(temporary) }
      read()
    },
  }
}

export function normalizeLocalPath(value: string): string {
  const unquoted = value.trim().replace(/^"(.*)"$/, '$1')
  return process.platform === 'win32'
    ? unquoted.replace(/%([^%]+)%/g, (token, key) => process.env[key] ?? token)
    : unquoted
}

export function windowsTerminalCommand(settingsPath: string): string[] {
  const preview = settingsPath.includes('Microsoft.WindowsTerminalPreview_')
  return [process.env.WT_EXECUTABLE || (preview ? 'wtp.exe' : 'wt.exe'), '-w', 'new']
}
