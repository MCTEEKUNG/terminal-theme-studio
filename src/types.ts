import type { AppearanceNumbers } from './lib/appearance'
export interface ColorScheme {
  name: string
  background: string
  foreground: string
  cursorColor: string
  selectionBackground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  purple: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightPurple: string
  brightCyan: string
  brightWhite: string
}

export interface FontSettings {
  face: string
  size: number
  weight: 'normal' | 'bold' | 'thin' | 'light' | 'semi-light' | 'semi-bold' | 'extra-light' | 'extra-bold'
}

export interface TerminalConnection {
  backend: 'ptyxis' | 'windows-terminal'
  state: 'idle' | 'syncing' | 'connected' | 'error'
  profile?: string
  error?: string
}

export interface ProfileDefaults extends AppearanceNumbers {
  tabAccentColor?: string
  chromeHoverColor?: string
  closeButtonAlignment?: 'start' | 'center' | 'end'
  opacity?: number
  useAcrylic?: boolean
  unfocusedAppearance?: { opacity: number }
  colorScheme?: string
  font?: FontSettings
  backgroundImage?: string | null
  backgroundImageOpacity?: number
  backgroundImageBlur?: number
  glassBlur?: number
  backgroundFrameRate?: number
  tabCornerRadius?: number
  closeButtonSize?: number
  closeButtonShape?: 'circle' | 'rounded' | 'square'
  headerHeight?: number
  tabSpacing?: number
  showStatusBar?: boolean
  adjustIndistinguishableColors?: 'always' | 'indexed' | 'never'
  backgroundImageStretchMode?: 'none' | 'fill' | 'uniform' | 'uniformToFill'
  backgroundImageAlignment?: 'center' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' | 'top' | 'bottom' | 'left' | 'right'
}

export interface WTSettings {
  $schema?: string
  $help?: string
  profiles: {
    defaults: ProfileDefaults
    list: unknown[]
  }
  schemes: ColorScheme[]
  [key: string]: unknown
}

export interface SavedTheme {
  name: string
  savedAt: string
  settings: {
    defaults: ProfileDefaults
    scheme: ColorScheme | undefined
  }
}

export type PlaylistItemStatus = 'idle' | 'converting' | 'ready' | 'error'
export type PlaylistPlaybackMode = 'loop' | 'shuffle' | 'repeat-one'

export interface PlaylistItem {
  id: string
  sourcePath: string
  gifPath: string | null
  status: PlaylistItemStatus
  error?: string | null
  durationSec: number
}

export interface PlaylistConfig {
  mode: 'single' | 'playlist'
  items: PlaylistItem[]
  isPlaying: boolean
  currentIndex: number
  defaultDurationSec: number
  durationMode: 'fixed' | 'full-video'
  playbackMode: PlaylistPlaybackMode
}
