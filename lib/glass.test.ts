import { expect, test } from 'bun:test'
import { glassBlurAmount } from './glass'

test('glass blur supports off and full strength, defaults old themes, and rejects invalid settings', () => {
  expect(glassBlurAmount(undefined)).toBe(16)
  expect(glassBlurAmount(0)).toBe(0)
  expect(glassBlurAmount(60)).toBe(60)
  for (const value of [-1, 61, NaN, Infinity, 2.5, '30', {}, true]) {
    expect(() => glassBlurAmount(value)).toThrow()
  }
})
