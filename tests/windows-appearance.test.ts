import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { TerminalPreview } from '../src/components/TerminalPreview'
import { ThemesPanel, PRESET_THEMES } from '../src/components/panels/ThemesPanel'
import { FontPanel } from '../src/components/panels/FontPanel'
import { parseSettings } from '../lib/terminal-settings'

test('Windows numeric font weights render in the preview and font control', () => {
  const settings = parseSettings('{"profiles":{"defaults":{"font":{"weight":650}}}}')
  expect(renderToString(createElement(TerminalPreview, { settings }))).toContain('font-weight:650')
  const control = renderToString(createElement(FontPanel, { settings, onPatch() {} }))
  expect(control).toContain('value="650" selected=""')
})

test('Windows light/dark color schemes render without treating the pair as a React child', () => {
  const settings = parseSettings('{"profiles":{"defaults":{"colorScheme":{"dark":"Dracula","light":"Campbell"}}}}')
  settings.schemes = PRESET_THEMES
  const html = renderToString(createElement(ThemesPanel, { settings, onPatch() {} }))
  expect(html).toContain('<strong>Dracula</strong>')
  expect(renderToString(createElement(TerminalPreview, { settings }))).toContain('Dracula')
})
