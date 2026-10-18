import { expect, test } from 'bun:test'
import { renderPalette, variantString } from './ptyxis'
import type { ColorScheme } from '../src/types'

test('partial legacy schemes still generate all 16 required ANSI colors', () => {
  const palette = renderPalette({ background: '#123456', foreground: '#abcdef' } as ColorScheme)
  expect(palette).toContain('Background=#123456\n')
  expect(palette).toContain('Cursor=#abcdef\n')
  expect(palette.match(/^Color\d+=#[a-f\d]{6}$/gm)).toHaveLength(16)
})

test('invalid colors cannot insert palette sections or keys', () => {
  const palette = renderPalette({ background: '#000000\n[Dark]', red: 'red' } as ColorScheme)
  expect(palette).not.toContain('[Dark]')
  expect(palette).toContain('Background=#0c0c0c\n')
  expect(palette).toContain('Color1=#c50f1f\n')
})

test('GVariant strings preserve quotes and backslashes without shell evaluation', () => {
  expect(variantString("Font's \\ Mono")).toBe("'Font\\'s \\\\ Mono'")
})
