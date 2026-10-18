// One control catalogue for the web UI, backend validation and GTK style renderer.
export const APPEARANCE_CONTROLS = [
  { key: 'tabCornerRadius', label: 'Tab roundness', min: 0, max: 20, fallback: 9, group: 'Layout', unit: 'px' },
  { key: 'headerHeight', label: 'Top bar height', min: 36, max: 64, fallback: 44, group: 'Layout', unit: 'px' },
  { key: 'closeButtonSize', label: 'Close button size', min: 18, max: 36, fallback: 24, group: 'Layout', unit: 'px' },
  { key: 'tabSpacing', label: 'Space between tabs', min: 0, max: 12, fallback: 4, group: 'Layout', unit: 'px' },
  { key: 'terminalPadding', label: 'Terminal content inset', min: 0, max: 40, fallback: 0, group: 'Text and spacing', unit: 'px' },
  { key: 'chromeFontSize', label: 'Top bar text size', min: 10, max: 24, fallback: 14, group: 'Text and spacing', unit: 'px' },
  { key: 'tabMinimumWidth', label: 'Minimum tab width', min: 0, max: 320, fallback: 0, group: 'Text and spacing', unit: 'px' },
  { key: 'tabPaddingX', label: 'Tab horizontal padding', min: 0, max: 24, fallback: 8, group: 'Text and spacing', unit: 'px' },
  { key: 'tabPaddingY', label: 'Tab vertical padding', min: 0, max: 12, fallback: 2, group: 'Text and spacing', unit: 'px' },
  { key: 'headerPaddingX', label: 'Top bar horizontal padding', min: 0, max: 24, fallback: 7, group: 'Text and spacing', unit: 'px' },
  { key: 'headerPaddingY', label: 'Top bar vertical padding', min: 0, max: 12, fallback: 3, group: 'Text and spacing', unit: 'px' },
  { key: 'tabHoverOpacity', label: 'Tab hover highlight', min: 0, max: 60, fallback: 6, group: 'Highlights', unit: '%' },
  { key: 'activeTabOpacity', label: 'Selected tab highlight', min: 0, max: 60, fallback: 9, group: 'Highlights', unit: '%' },
  { key: 'activeTabBorderOpacity', label: 'Selected tab border', min: 0, max: 100, fallback: 13, group: 'Highlights', unit: '%' },
  { key: 'buttonHoverOpacity', label: 'Toolbar button hover', min: 0, max: 70, fallback: 7, group: 'Highlights', unit: '%' },
  { key: 'closeButtonHoverOpacity', label: 'Close button hover', min: 0, max: 70, fallback: 14, group: 'Highlights', unit: '%' },
  { key: 'statusFontSize', label: 'Status bar text size', min: 8, max: 20, fallback: 12, group: 'Status and window controls', unit: 'px' },
  { key: 'statusPaddingX', label: 'Status bar extra horizontal padding', min: 0, max: 24, fallback: 0, group: 'Status and window controls', unit: 'px' },
  { key: 'statusPaddingY', label: 'Status bar extra vertical padding', min: 0, max: 12, fallback: 0, group: 'Status and window controls', unit: 'px' },
  { key: 'windowButtonSize', label: 'Window control size', min: 18, max: 36, fallback: 24, group: 'Status and window controls', unit: 'px' },
  { key: 'windowButtonRadius', label: 'Window control roundness', min: 0, max: 24, fallback: 9, group: 'Status and window controls', unit: 'px' },
] as const

export type AppearanceKey = typeof APPEARANCE_CONTROLS[number]['key']
export type AppearanceNumbers = Partial<Record<AppearanceKey, number>>
export function appearanceNumbers(input: AppearanceNumbers) {
  return Object.fromEntries(APPEARANCE_CONTROLS.map(c => [c.key,
    typeof input[c.key] === 'number' && Number.isFinite(input[c.key])
      ? Math.max(c.min, Math.min(c.max, Math.round(input[c.key]!))) : c.fallback])) as Record<AppearanceKey, number>
}
export const CHROME_COLORS = [
  { key: 'tabAccentColor', label: 'Selected tab border color', fallback: '#ffffff' },
  { key: 'chromeHoverColor', label: 'Hover highlight color', fallback: '#ffffff' },
] as const
