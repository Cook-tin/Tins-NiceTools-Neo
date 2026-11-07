/**
 * Lightweight source check used by CI and `npm run check`.
 * No Electron or FFmpeg binaries are required.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')
const jsRoots = ['app', 'scripts', 'tests']
const ignored = new Set(['node_modules', '.git', 'dist', 'runtime-electron', '.cache'])

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(?:js|mjs|cjs)$/.test(entry.name)) out.push(full)
  }
  return out
}

let failed = 0
const files = []
for (const dir of jsRoots) {
  const full = path.join(root, dir)
  if (fs.existsSync(full)) walk(full, files)
}

for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
  } catch (err) {
    failed++
    console.error(`[syntax] ${path.relative(root, file)}`)
    process.stderr.write(String(err.stderr || err.message))
  }
}

for (const file of ['package.json', 'app/package.json']) {
  try {
    JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))
  } catch (err) {
    failed++
    console.error(`[json] ${file}: ${err.message}`)
  }
}

if (failed) {
  console.error(`[check] ${failed} problem(s)`)
  process.exit(1)
}
console.log(`[check] ${files.length} JavaScript files OK`)
