import type { WTSettings, ColorScheme, ProfileDefaults } from '../types'

const BUILT_IN_SCHEMES = new Set([
  'Campbell', 'Campbell Powershell', 'Vintage',
  'One Half Dark', 'One Half Light',
  'Solarized Dark', 'Solarized Light',
  'Tango Dark', 'Tango Light'
])

export function mergeDefaults(settings: WTSettings, patch: Partial<ProfileDefaults>): WTSettings {
  const merged: ProfileDefaults = { ...settings.profiles.defaults, ...patch }
  if (patch.unfocusedAppearance && settings.profiles.defaults.unfocusedAppearance) {
    merged.unfocusedAppearance = {
      ...settings.profiles.defaults.unfocusedAppearance,
      ...patch.unfocusedAppearance
    }
  }
  if (patch.font && settings.profiles.defaults.font) {
    merged.font = { ...settings.profiles.defaults.font, ...patch.font }
  }
  return {
    ...settings,
    profiles: { ...settings.profiles, defaults: merged }
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
  const name = getSchemeName(settings)
  return settings.schemes.find(s => s.name === name)
}

export function getSchemeName(settings: WTSettings): string {
  const scheme = settings.profiles.defaults.colorScheme
  // The Studio preview uses the dark variant; the pair remains intact on disk.
  return typeof scheme === 'string' ? scheme : scheme?.dark ?? scheme?.light ?? ''
}

export function isBuiltInScheme(name: string): boolean {
  return BUILT_IN_SCHEMES.has(name)
}
