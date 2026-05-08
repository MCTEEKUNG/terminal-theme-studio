import { describe, it, expect } from 'bun:test'
import { mergeDefaults, upsertScheme, getActiveScheme, isBuiltInScheme } from './settings'
import type { WTSettings, ColorScheme } from '../types'

const baseScheme: ColorScheme = {
  name: 'Custom', background: '#0d1117', foreground: '#e6edf3',
  cursorColor: '#58a6ff', selectionBackground: '#264f78',
  black: '#0d1117', red: '#ff7b72', green: '#3fb950', yellow: '#d29922',
  blue: '#58a6ff', purple: '#bc8cff', cyan: '#39c5cf', white: '#b1bac4',
  brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364',
  brightYellow: '#e3b341', brightBlue: '#79c0ff', brightPurple: '#d2a8ff',
  brightCyan: '#56d4dd', brightWhite: '#f0f6fc'
}

const base: WTSettings = {
  profiles: { defaults: { opacity: 80, colorScheme: 'Custom' }, list: [] },
  schemes: [baseScheme]
}

describe('mergeDefaults', () => {
  it('merges patch into defaults', () => {
    const result = mergeDefaults(base, { opacity: 50 })
    expect(result.profiles.defaults.opacity).toBe(50)
    expect(result.profiles.defaults.colorScheme).toBe('Custom')
  })

  it('does not mutate original', () => {
    mergeDefaults(base, { opacity: 50 })
    expect(base.profiles.defaults.opacity).toBe(80)
  })
})

describe('upsertScheme', () => {
  it('updates existing scheme in-place', () => {
    const updated = { ...baseScheme, background: '#111111' }
    const result = upsertScheme(base, updated)
    expect(result.schemes[0].background).toBe('#111111')
    expect(result.schemes).toHaveLength(1)
  })

  it('appends new scheme', () => {
    const newScheme = { ...baseScheme, name: 'New' }
    const result = upsertScheme(base, newScheme)
    expect(result.schemes).toHaveLength(2)
    expect(result.schemes[1].name).toBe('New')
  })

  it('does not mutate original', () => {
    upsertScheme(base, { ...baseScheme, background: '#111111' })
    expect(base.schemes[0].background).toBe('#0d1117')
  })
})

describe('getActiveScheme', () => {
  it('returns scheme matching colorScheme name', () => {
    const result = getActiveScheme(base)
    expect(result?.name).toBe('Custom')
  })

  it('returns undefined when no match', () => {
    const noMatch = { ...base, profiles: { ...base.profiles, defaults: { colorScheme: 'Missing' } } }
    expect(getActiveScheme(noMatch)).toBeUndefined()
  })
})

describe('isBuiltInScheme', () => {
  it('returns true for Campbell', () => expect(isBuiltInScheme('Campbell')).toBe(true))
  it('returns true for One Half Dark', () => expect(isBuiltInScheme('One Half Dark')).toBe(true))
  it('returns false for custom name', () => expect(isBuiltInScheme('My Theme')).toBe(false))
})
