import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { TerminalPreview } from '../src/components/TerminalPreview'
import type { WTSettings } from '../src/types'

test('Windows preview displays the exact GIF selected for Terminal', () => {
  const gif = 'C:\\cache\\clip-12fps.gif'
  const settings = { profiles: { defaults: { backgroundImage: gif }, list: [] }, schemes: [] } as WTSettings
  const html = renderToStaticMarkup(<TerminalPreview settings={settings} />)
  expect(html).toContain(encodeURIComponent(gif))
  expect(html).not.toContain('<video')
})
