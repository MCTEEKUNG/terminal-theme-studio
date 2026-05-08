import type { WTSettings, ColorScheme, ProfileDefaults } from '../types'

const BUILT_IN_SCHEMES = new Set([
  'Campbell', 'Campbell Powershell', 'Vintage',
  'One Half Dark', 'One Half Light',
  'Solarized Dark', 'Solarized Light',
  'Tango Dark', 'Tango Light'
])

export function mergeDefaults(settings: WTSettings, patch: Partial<ProfileDefaults>): WTSettings {
  return {
    ...settings,
    profiles: {
      ...settings.profiles,
      defaults: { ...settings.profiles.defaults, ...patch }
    }
  }
}

export function upsertScheme(settings: WTSettings, scheme: ColorScheme): WTSettings {
  const idx = settings.schemes.findIndex(s => s.name === scheme.name)
  const schemes = idx >= 0
    ? settings.schemes.map((s, i) => i === idx ? scheme : s)
    : [...settings.schemes, scheme]
  return { ...settings, schemes }
}

export function getActiveScheme(settings: WTSettings): ColorScheme | undefined {
  const name = settings.profiles.defaults.colorScheme
  return settings.schemes.find(s => s.name === name)
}

export function isBuiltInScheme(name: string): boolean {
  return BUILT_IN_SCHEMES.has(name)
}
