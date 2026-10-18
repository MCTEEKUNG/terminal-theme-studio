import { existsSync, mkdirSync, openSync, readFileSync, closeSync } from 'fs'
import path from 'path'
import type { WTSettings, PlaylistConfig } from '../src/types'

const runtime = path.join(import.meta.dir, '../.native-runtime')
const statusFile = path.join(runtime, 'status.json')
let launch: import('bun').Subprocess | null = null

export function nativeMediaPath(settings: WTSettings, playlist: PlaylistConfig): string | null {
  const background = settings.profiles.defaults.backgroundImage
  if (!background) return null
  // Play original videos directly, avoiding the GIF conversion's size and frame rate.
  const item = playlist.items.find(item => item.gifPath === background || item.sourcePath === background)
  return item?.sourcePath ?? background
}

export function nativeStatus() {
  if (existsSync(statusFile)) {
    try {
      const saved = JSON.parse(readFileSync(statusFile, 'utf-8'))
      if (saved.state === 'running' && Date.now() / 1000 - saved.updatedAt < 5) {
        process.kill(saved.pid, 0)
        return saved
      }
      if (saved.state === 'stopped' && (!launch || launch.exitCode === 0)) return saved
    } catch {}
  }
  const starting = launch?.exitCode === null && !launch.signalCode
  return { state: starting ? 'starting' : 'stopped', error: launch?.exitCode ? 'Native terminal exited. See .native-runtime/terminal.log.' : undefined }
}

export function openNativeTerminal() {
  if (process.platform !== 'linux') throw new Error('Studio Terminal currently requires Ubuntu/Linux')
  const status = nativeStatus()
  if (status.state === 'starting') return status
  mkdirSync(runtime, { recursive: true })
  const log = openSync(path.join(runtime, 'terminal.log'), 'a', 0o600)
  try {
    const command = ['/usr/bin/python3', path.join(import.meta.dir, '../native/terminal.py'), '--present',
      '--server', `http://127.0.0.1:${process.env.PORT ?? 3001}`, '--status-file', statusFile]
    // A controller restart must never terminate the user's shells. Give the
    // GUI its own session scope when launched by the systemd controller.
    const isolated = process.env.INVOCATION_ID
      ? ['systemd-run', '--user', '--scope', '--quiet', '--collect', '--', ...command]
      : command
    launch = Bun.spawn(isolated,
      { stdout: log, stderr: log, stdin: 'ignore' })
  } finally { closeSync(log) }
  return status.state === 'running' ? status : { state: 'starting' }
}
