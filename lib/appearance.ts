import type { ProfileDefaults } from '../src/types'
import { APPEARANCE_CONTROLS, CHROME_COLORS } from '../src/lib/appearance'

export function validateAppearance(defaults: Partial<ProfileDefaults>) {
  for (const { key, min, max } of [...APPEARANCE_CONTROLS, { key: 'backgroundFrameRate', min: 12, max: 60 }] as const) {
    if (!(key in defaults)) continue
    const value = defaults[key]
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      throw new Error(`${key} must be a whole number between ${min} and ${max}`)
    }
  }
  for (const { key } of CHROME_COLORS) {
    if (key in defaults && !/^#[0-9a-f]{6}$/i.test(defaults[key] ?? '')) throw new Error(`${key} must be a hex color`)
  }
  if ('closeButtonAlignment' in defaults && !['start', 'center', 'end'].includes(defaults.closeButtonAlignment ?? '')) {
    throw new Error('Unknown close button alignment')
  }
  if ('closeButtonShape' in defaults && !['circle', 'rounded', 'square'].includes(defaults.closeButtonShape ?? '')) {
    throw new Error('Unknown close button shape')
  }
  if ('showStatusBar' in defaults && typeof defaults.showStatusBar !== 'boolean') {
    throw new Error('showStatusBar must be true or false')
  }
}
