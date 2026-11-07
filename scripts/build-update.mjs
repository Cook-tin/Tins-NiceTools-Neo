/**
 * Builds an offline update zip from dist/NiceTools.
 *
 * The update package contains NiceToolsUpdater2.exe (which does NOT delete
 * the selected package) and update-notice.json for the post-update prompt.
 *
 * Usage: node scripts/build-update.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')
const dist = path.join(root, 'dist', 'NiceTools')
const pkgPath = path.join(dist, 'resources', 'app', 'package.json')
const markerPath = path.join(dist, 'update-notice.json')
const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')

if (!fs.existsSync(pkgPath)) {
  throw new Error('dist/NiceTools is missing — run npm run build first')
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
const version = String(pkg.version || '').trim()
if (!version) throw new Error('app/package.json has no version')
if (!fs.existsSync(path.join(dist, 'NiceToolsUpdater2.exe'))) {
  throw new Error('NiceToolsUpdater2.exe is missing — run npm run build:native')
}

const update = path.join(root, 'dist', `NiceTools-Neo-update-${version}.zip`)
fs.writeFileSync(markerPath, JSON.stringify({ to: version }), 'utf8')
try {
  fs.rmSync(update, { force: true })
  execFileSync(tar, ['-a', '-c', '-f', update, '-C', dist, '.'], { stdio: 'inherit' })
  console.log(`[update] ${update}`)
  console.log(`[update] ${(fs.statSync(update).size / 1024 / 1024).toFixed(1)} MB`)
} finally {
  fs.rmSync(markerPath, { force: true })
}
