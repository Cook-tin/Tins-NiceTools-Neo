/**
 * Downloads the official Electron win32-x64 runtime.
 * Set NICETOOLS_ELECTRON_URL to use a mirror when the default URL is unavailable.
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { execFileSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')
const cacheDir = path.join(root, '.cache')
const zipPath = path.join(cacheDir, 'electron-v44.7.0-win32-x64.zip')
const outDir = path.join(root, 'runtime-electron')
const version = '44.7.0'
const url =
  process.env.NICETOOLS_ELECTRON_URL ||
  `https://github.com/electron/electron/releases/download/v${version}/electron-v${version}-win32-x64.zip`

async function main() {
  await fsp.mkdir(cacheDir, { recursive: true })
  if (!fs.existsSync(zipPath) || fs.statSync(zipPath).size < 100 * 1024 * 1024) {
    console.log('[electron] downloading', url)
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
    const total = Number(res.headers.get('content-length')) || 158293649
    let received = 0
    let last = 0
    const stream = Readable.fromWeb(res.body)
    stream.on('data', (c) => {
      received += c.length
      const mb = received / 1024 / 1024
      if (mb - last > 15) {
        last = mb
        console.log(`[electron] ${mb.toFixed(1)} MB (${((received / total) * 100).toFixed(1)}%)`)
      }
    })
    await pipeline(stream, fs.createWriteStream(zipPath))
  }
  console.log('[electron] extracting…')
  await fsp.rm(outDir, { recursive: true, force: true })
  await fsp.mkdir(outDir, { recursive: true })
  execFileSync('tar.exe', ['-xf', zipPath, '-C', outDir], { stdio: 'inherit' })
  const exe = path.join(outDir, 'electron.exe')
  console.log('[electron] exe exists:', fs.existsSync(exe), fs.existsSync(exe) ? fs.statSync(exe).size : '')
}

main().catch((e) => {
  console.error('[electron] FAILED', e)
  process.exit(1)
})
