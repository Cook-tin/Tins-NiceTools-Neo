/**
 * Assembles the portable Windows build:
 *   dist/NiceTools/NiceTools.exe  (native launcher)
 *   dist/NiceTools/NiceToolsCore.exe (Electron runtime)
 *   dist/NiceTools/resources/app  (NiceTools Neo itself)
 *   dist/NiceTools/ffmpeg/bin     (optional, GPL FFmpeg — skipped with --no-ffmpeg)
 * and packs everything into dist/NiceTools-Neo-portable.zip.
 *
 * Usage:
 *   node scripts/build-portable.mjs              # 带 FFmpeg（自用/完整包）
 *   node scripts/build-portable.mjs --no-ffmpeg  # 不带 FFmpeg（开源发行包）
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')
const runtime = path.join(root, 'runtime-electron')
const appDir = path.join(root, 'app')
const ffmpegDir = path.join(root, 'resources', 'ffmpeg')
const distRoot = path.join(root, 'dist')
const outDir = path.join(distRoot, 'NiceTools')
const zipPath = path.join(distRoot, 'NiceTools-Neo-portable.zip')
const withFfmpeg = !process.argv.includes('--no-ffmpeg')
const rcedit = path.join(root, '.cache', 'rcedit.exe')
const icon = path.join(root, 'build', 'icon.ico')
const pkg = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'))

function log(...args) {
  console.log('[build]', ...args)
}

function assertExists(p, hint) {
  if (!fs.existsSync(p)) throw new Error(`missing ${p}${hint ? ` — ${hint}` : ''}`)
}

async function main() {
  assertExists(path.join(runtime, 'electron.exe'), 'run scripts/fetch-electron.mjs first')
  assertExists(path.join(appDir, 'main.js'))
  if (withFfmpeg) {
    assertExists(path.join(ffmpegDir, 'bin', 'ffmpeg.exe'), 'run scripts/fetch-ffmpeg.mjs first')
    assertExists(path.join(ffmpegDir, 'bin', 'ffprobe.exe'))
  } else {
    log('no-ffmpeg: 发行包不内置 FFmpeg，用户需自行选择 ffmpeg.exe 或使用设置页下载')
  }

  log('cleaning dist…')
  fs.rmSync(distRoot, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })

  log('copying Electron runtime…')
  fs.cpSync(runtime, outDir, { recursive: true })
  const corePath = path.join(outDir, 'NiceToolsCore.exe')
  fs.renameSync(path.join(outDir, 'electron.exe'), corePath)
  const launcherSource = path.join(root, 'build', 'NiceToolsLauncher.exe')
  if (!fs.existsSync(launcherSource)) {
    log('launcher missing, compiling…')
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts', 'build-launcher.ps1')],
      { stdio: 'inherit' }
    )
  }
  assertExists(launcherSource, 'run the C# launcher build step first')
  const exePath = path.join(outDir, 'NiceTools.exe')
  fs.copyFileSync(launcherSource, exePath)
  const memoryHelper = path.join(root, 'build', 'NiceToolsMem.exe')
  if (fs.existsSync(memoryHelper)) {
    fs.copyFileSync(memoryHelper, path.join(outDir, 'NiceToolsMem.exe'))
  } else {
    log('memory helper missing — safe cleanup will skip process trim')
  }
  for (const name of ['NiceToolsUpdater.exe', 'NiceToolsUpdater2.exe']) {
    const updater = path.join(root, 'build', name)
    if (fs.existsSync(updater)) {
      fs.copyFileSync(updater, path.join(outDir, name))
    }
  }
  const electronLicense = path.join(outDir, 'LICENSE')
  if (fs.existsSync(electronLicense)) {
    fs.copyFileSync(electronLicense, path.join(outDir, 'LICENSE-Electron-MIT.txt'))
  }

  log('trimming locales…')
  const locales = path.join(outDir, 'locales')
  if (fs.existsSync(locales)) {
    for (const file of fs.readdirSync(locales)) {
      if (!['zh-CN.pak', 'en-US.pak'].includes(file)) {
        fs.rmSync(path.join(locales, file), { force: true })
      }
    }
  }

  log('copying application…')
  const appTarget = path.join(outDir, 'resources', 'app')
  fs.mkdirSync(appTarget, { recursive: true })
  fs.cpSync(appDir, appTarget, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(appDir, src)
      if (rel === 'index.html' || rel === 'shot.png' || rel === 'status.txt') return false
      if (rel.startsWith('..')) return false
      return true
    }
  })

  if (withFfmpeg) {
    log('copying FFmpeg…')
    fs.cpSync(ffmpegDir, path.join(outDir, 'ffmpeg'), { recursive: true })
  } else {
    log('skipping FFmpeg (--no-ffmpeg)')
  }

  for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md', 'NiceTools.cmd']) {
    if (fs.existsSync(path.join(root, file))) {
      fs.copyFileSync(path.join(root, file), path.join(outDir, file))
    }
  }

  log('packing zip…')
  execFileSync(
    path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'),
    ['-a', '-c', '-f', zipPath, '-C', distRoot, 'NiceTools'],
    { stdio: 'inherit' }
  )

  const size = fs.statSync(zipPath).size
  log(`portable folder: ${outDir}`)
  log(`zip: ${zipPath} (${(size / 1024 / 1024).toFixed(1)} MB)`)
}

main().catch((err) => {
  console.error('[build] FAILED:', err)
  process.exit(1)
})
