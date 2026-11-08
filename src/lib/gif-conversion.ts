export interface GifConversionSettings {
  fps: number | 'source'
  width: number | 'source'
}

export const DEFAULT_GIF_CONVERSION: GifConversionSettings = { fps: 12, width: 640 }

export function validateGifConversionSettings(value: unknown): GifConversionSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Conversion settings must be an object')
  const { fps, width } = value as GifConversionSettings
  if (fps !== 'source' && !(Number.isInteger(fps) && fps >= 1 && fps <= 60)) {
    throw new Error('FPS must be an integer from 1 to 60, or "source"')
  }
  if (width !== 'source' && !(Number.isInteger(width) && width >= 64 && width <= 3840)) {
    throw new Error('Width must be an integer from 64 to 3840, or "source"')
  }
  return { fps, width }
}
