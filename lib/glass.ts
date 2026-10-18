import path from 'path'
import os from 'os'
import type { WTSettings } from '../src/types'

export function glassBlurAmount(value: unknown): number {
  const amount = value ?? 16
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0 || amount > 60) {
    throw new Error('Glass blur must be a whole number between 0 and 60')
  }
  return amount
}

export function createGlassBridge(enabled: boolean) {
  const status: { state: 'idle' | 'connected' | 'error'; amount?: number; error?: string } = { state: 'idle' }
  let lastApplied: number | undefined
  const schemaDir = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'),
    'gnome-shell/extensions/blur-my-shell@aunetx/schemas')
  function schedule(settings: WTSettings) {
    if (!enabled) return
    try {
      const amount = glassBlurAmount(settings.profiles.defaults.glassBlur)
      if (amount === lastApplied) return
      const result = Bun.spawnSync(['python3', path.join(import.meta.dir, '../native/glass.py'), schemaDir, String(amount)],
        { stdout: 'pipe', stderr: 'pipe' })
      if (result.exitCode !== 0) throw new Error(result.stderr.toString().trim() || 'Could not update GNOME glass blur')
      lastApplied = amount
      status.state = 'connected'
      status.amount = amount
      delete status.error
    } catch (error) {
      status.state = 'error'
      status.error = String(error)
    }
  }
  return { status, schedule }
}
