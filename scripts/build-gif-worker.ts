import { existsSync, statSync } from 'fs'
import path from 'path'

const root = path.resolve(import.meta.dir, '../native/gif-worker')
const binary = path.join(root, 'target/release', process.platform === 'win32' ? 'studio-gif-worker.exe' : 'studio-gif-worker')
const sources = ['Cargo.toml', 'src/main.rs'].map(file => path.join(root, file))
if (!existsSync(binary) || sources.some(file => statSync(file).mtimeMs > statSync(binary).mtimeMs)) {
  const build = Bun.spawn(['cargo', 'build', '--release', '--manifest-path', path.join(root, 'Cargo.toml')], { stdout: 'inherit', stderr: 'inherit' })
  if (await build.exited !== 0) process.exit(1)
}
