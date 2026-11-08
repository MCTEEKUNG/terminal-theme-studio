import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'
import path from 'path'
import { validateGifConversionSettings, type GifConversionSettings } from '../src/lib/gif-conversion'

export interface GifVariant extends GifConversionSettings { gifPath: string; bytes: number }
interface Record extends GifConversionSettings {
  sourcePath: string
  sourceSize?: number
  sourceMtime?: number
  outputMtime?: number
  bytes?: number
  durationSec?: number
}
const identity = (file: string) => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file)
const abortError = () => new DOMException('Conversion cancelled', 'AbortError')

export function createGifConverter(directory: string) {
  mkdirSync(directory, { recursive: true })
  const records = new Map<string, Record>()
  const legacy = new Map<string, string>()
  const inspecting = new Map<string, Promise<void>>()
  for (const file of readdirSync(directory).filter(file => file.endsWith('.gif.json'))) {
    try {
      const record = JSON.parse(readFileSync(path.join(directory, file), 'utf8'))
      if (typeof record?.sourcePath === 'string') records.set(path.join(directory, file.slice(0, -5)), record)
    } catch {}
  }
  let queue = Promise.resolve()
  type Result = { gifPath: string; conversionSettings: GifConversionSettings; durationSec?: number; cached: boolean }
  const jobs = new Map<string, { promise: Promise<Result>; controller: AbortController; users: number }>()

  function store(file: string, record: Record) {
    const temporary = `${file}.${crypto.randomUUID()}.json.tmp`
    try { writeFileSync(temporary, JSON.stringify(record)); renameSync(temporary, `${file}.json`) }
    finally { if (existsSync(temporary)) unlinkSync(temporary) }
    records.set(file, record)
  }

  function valid(file: string, record: Record, source: ReturnType<typeof statSync>): boolean {
    try {
      validateGifConversionSettings(record)
      const output = statSync(file)
      if (!output.isFile() || output.size < 14 || output.mtimeMs < source.mtimeMs) return false
      if (record.sourceSize !== undefined && (record.sourceSize !== source.size || record.sourceMtime !== source.mtimeMs
        || record.bytes !== output.size || record.outputMtime !== output.mtimeMs)) return false
      const fd = openSync(file, 'r')
      const header = Buffer.alloc(6)
      try { readSync(fd, header, 0, 6, 0) } finally { closeSync(fd) }
      if (!['GIF87a', 'GIF89a'].includes(header.toString())) return false
      if (record.sourceSize === undefined) store(file, { ...record, sourceSize: source.size, sourceMtime: source.mtimeMs, bytes: output.size, outputMtime: output.mtimeMs })
      return true
    } catch { return false }
  }

  async function inspectLegacy(sourcePath: string, file: string) {
    if (records.has(file) || !existsSync(file) || !existsSync(sourcePath)) return
    if (statSync(sourcePath).mtimeMs > statSync(file).mtimeMs) return
    if (!inspecting.has(file)) inspecting.set(file, (async () => {
      try {
        const proc = Bun.spawn(['ffprobe', '-v', 'error', '-count_packets', '-select_streams', 'v:0',
          '-show_entries', 'stream=width,nb_read_packets:format=duration', '-of', 'json', file], { stdout: 'pipe', stderr: 'ignore' })
        const text = await new Response(proc.stdout).text()
        if (await proc.exited !== 0) return
        const probe = JSON.parse(text)
        const rate = Number(probe.streams[0].nb_read_packets) / Number(probe.format.duration)
        const fps = Math.round(rate)
        const width = probe.streams[0].width
        if (Math.abs(rate - fps) > 0.35) return
        validateGifConversionSettings({ fps, width })
        const record = { sourcePath, fps, width }
        if (valid(file, record, statSync(sourcePath))) records.set(file, records.get(file) ?? record)
      } catch { /* Unverified older output is not offered as a reusable variant. */ }
    })())
    await inspecting.get(file)
  }

  async function variants(sourcePath: string): Promise<GifVariant[]> {
    if (!existsSync(sourcePath)) return []
    await Promise.all([...legacy].filter(([, source]) => identity(source) === identity(sourcePath))
      .map(([file, source]) => inspectLegacy(source, file)))
    const source = statSync(sourcePath)
    return [...records].filter(([file, record]) => identity(record.sourcePath) === identity(sourcePath) && valid(file, record, source))
      .map(([gifPath]) => { const record = records.get(gifPath)!; return { gifPath, fps: record.fps, width: record.width, bytes: record.bytes! } })
  }

  async function cached(source: string, settings: GifConversionSettings): Promise<Result | undefined> {
    const variant = (await variants(source)).find(variant => variant.fps === settings.fps && variant.width === settings.width)
    if (variant) return { gifPath: variant.gifPath, conversionSettings: settings, durationSec: records.get(variant.gifPath)?.durationSec, cached: true }
  }

  async function execute(source: string, settings: GifConversionSettings, signal: AbortSignal): Promise<Result> {
    const previous = queue
    let release!: () => void
    queue = new Promise<void>(resolve => { release = resolve })
    let temporary: string | undefined
    try {
      await previous
      if (signal.aborted) throw abortError()
      const reuse = await cached(source, settings)
      if (signal.aborted) throw abortError()
      if (reuse) return reuse
      const before = statSync(source)
      const key = createHash('sha256').update(JSON.stringify([identity(source), before.size, before.mtimeMs, settings.fps, settings.width])).digest('hex').slice(0, 16)
      const output = path.join(directory, `${path.basename(source, path.extname(source))}-${key}.gif`)
      temporary = `${output}.${crypto.randomUUID()}.tmp`
      const worker = path.resolve(import.meta.dir, '../native/gif-worker/target/release', process.platform === 'win32' ? 'studio-gif-worker.exe' : 'studio-gif-worker')
      if (!existsSync(worker)) throw new Error('GIF worker missing. Run bun run build:worker')
      const proc = Bun.spawn([worker, source, temporary, String(settings.fps), String(settings.width)], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
      const cancel = () => { try { proc.stdin.write('cancel\n'); proc.stdin.end() } catch {} }
      signal.addEventListener('abort', cancel, { once: true })
      if (signal.aborted) cancel()
      const stdout = new Response(proc.stdout).text()
      const stderr = new Response(proc.stderr).text()
      let code: number
      try { code = await proc.exited } finally { signal.removeEventListener('abort', cancel); proc.stdin.end() }
      const [out, error] = await Promise.all([stdout, stderr])
      if (signal.aborted) throw abortError()
      if (code !== 0) throw new Error(error.trim() || 'Could not prepare this clip')
      const after = statSync(source)
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('Source changed while preparing; try again')
      const { durationSec } = JSON.parse(out)
      renameSync(temporary, output)
      const result = statSync(output)
      store(output, { sourcePath: source, ...settings, sourceSize: before.size, sourceMtime: before.mtimeMs,
        bytes: result.size, outputMtime: result.mtimeMs, durationSec })
      return { gifPath: output, conversionSettings: settings, durationSec, cached: false }
    } finally {
      if (temporary && existsSync(temporary)) unlinkSync(temporary)
      release()
    }
  }

  async function convert(source: string, settings: GifConversionSettings, signal: AbortSignal): Promise<Result> {
    if (signal.aborted) throw abortError()
    const reuse = await cached(source, settings)
    if (signal.aborted) throw abortError()
    if (reuse) return reuse
    const info = statSync(source)
    const key = JSON.stringify([identity(source), info.size, info.mtimeMs, settings.fps, settings.width])
    let job = jobs.get(key)
    if (!job || job.controller.signal.aborted) {
      const controller = new AbortController()
      job = { controller, users: 0, promise: execute(source, settings, controller.signal) }
      const current = job
      jobs.set(key, current)
      void current.promise.finally(() => { if (jobs.get(key) === current) jobs.delete(key) }).catch(() => {})
    }
    const current = job
    current.users++
    return new Promise<Result>((resolve, reject) => {
      let finished = false
      const finish = () => {
        if (finished) return false
        finished = true
        signal.removeEventListener('abort', cancel)
        if (--current.users === 0) current.controller.abort()
        return true
      }
      const cancel = () => {
        if (!finish()) return
        // Await actual process teardown before reporting cancellation.
        void current.promise.catch(() => {}).then(() => reject(abortError()))
      }
      signal.addEventListener('abort', cancel, { once: true })
      if (signal.aborted) cancel()
      current.promise.then(result => { if (finish()) resolve(result) }, error => { if (finish()) reject(error) })
    })
  }

  return { variants, convert,
    sourceFor(file: string) { return records.get(file)?.sourcePath ?? legacy.get(file) },
    registerLegacy(source: string, file: string) { legacy.set(file, source) } }
}
