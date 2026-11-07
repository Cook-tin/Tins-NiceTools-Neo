/**
 * Downloads a GPL FFmpeg build and places ffmpeg.exe / ffprobe.exe into
 * resources/ffmpeg/bin so the app (and the packaged installer) can use it.
 *
 * Usage: node scripts/fetch-ffmpeg.mjs [--force]
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const root = path.resolve(import.meta.dirname, '..')
const cacheDir = path.join(root, '.cache')
const zipPath = path.join(cacheDir, 'ffmpeg.zip')
const extractDir = path.join(cacheDir, 'ffmpeg-extract')
const destDir = path.join(root, 'resources', 'ffmpeg', 'bin')
const force = process.argv.includes('--force')

const MIRRORS = [
  {
    name: 'BtbN win64 gpl (official)',
    url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
    approx: 201_871_108
  },
  {
    name: 'gyan.dev essentials',
    url: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
    approx: 114_768_076
  }
]

if (process.env.NICETOOLS_FFMPEG_URL) {
  MIRRORS.unshift({
    name: 'NICETOOLS_FFMPEG_URL',
    url: process.env.NICETOOLS_FFMPEG_URL,
    approx: 0
  })
}

function log(...args) {
  console.log('[ffmpeg]', ...args)
}

async function exists(p) {
  try {
    await fsp.access(p)
    return true
  } catch {
    return false
  }
}

async function download(url, dest, approx) {
  log('downloading', url)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`)
  const total = Number(res.headers.get('content-length')) || approx || 0
  let received = 0
  let lastLog = 0
  const nodeStream = Readable.fromWeb(res.body)
  nodeStream.on('data', (chunk) => {
    received += chunk.length
    const mb = received / 1024 / 1024
    if (mb - lastLog > 10 || received === total) {
      lastLog = mb
      const pct = total ? ` (${((received / total) * 100).toFixed(1)}%)` : ''
      log(`  ${mb.toFixed(1)} MB${pct}`)
    }
  })
  await pipeline(nodeStream, fs.createWriteStream(dest))
  const stat = await fsp.stat(dest)
  if (stat.size < 10 * 1024 * 1024) throw new Error('downloaded file is too small')
  log('downloaded', (stat.size / 1024 / 1024).toFixed(1), 'MB')
}

async function walk(dir, results = []) {
  const entries = await fsp.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) await walk(full, results)
    else results.push(full)
  }
  return results
}

async function extract(zip) {
  await fsp.rm(extractDir, { recursive: true, force: true })
  await fsp.mkdir(extractDir, { recursive: true })
  log('extracting…')
  try {
    execFileSync('tar.exe', ['-xf', zip, '-C', extractDir], { stdio: 'inherit' })
  } catch (err) {
    log('tar failed, falling back to PowerShell Expand-Archive')
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${extractDir.replace(/'/g, "''")}' -Force`
      ],
      { stdio: 'inherit' }
    )
  }
}

async function main() {
  await fsp.mkdir(destDir, { recursive: true })
  const existing = path.join(destDir, 'ffmpeg.exe')
  if (!force && (await exists(existing))) {
    try {
      const out = execFileSync(existing, ['-version'], { encoding: 'utf8' })
      log('already present:', out.split('\n')[0])
      return
    } catch {
      log('existing binary is broken, re-downloading')
    }
  }

  await fsp.mkdir(cacheDir, { recursive: true })
  const validZip =
    (await exists(zipPath)) && (await fsp.stat(zipPath)).size > 10 * 1024 * 1024
  if (!validZip || force) {
    let lastError
    for (const mirror of MIRRORS) {
      try {
        await download(mirror.url, zipPath, mirror.approx)
        lastError = undefined
        break
      } catch (err) {
        lastError = err
        log('mirror failed:', err.message)
      }
    }
    if (lastError) throw lastError
  }

  await extract(zipPath)
  const files = await walk(extractDir)
  const wanted = ['ffmpeg.exe', 'ffprobe.exe']
  for (const name of wanted) {
    const found = files.find((f) => path.basename(f).toLowerCase() === name && f.includes(`${path.sep}bin${path.sep}`))
    const fallback = files.find((f) => path.basename(f).toLowerCase() === name)
    const src = found || fallback
    if (!src) throw new Error(`could not find ${name} in archive`)
    const dst = path.join(destDir, name)
    await fsp.copyFile(src, dst)
    log('installed', dst)
  }

  const version = execFileSync(path.join(destDir, 'ffmpeg.exe'), ['-version'], { encoding: 'utf8' })
  log(version.split('\n')[0])
  await fsp.rm(extractDir, { recursive: true, force: true })
}

main().catch((err) => {
  console.error('[ffmpeg] FAILED:', err)
  process.exit(1)
})
