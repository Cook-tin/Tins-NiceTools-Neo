'use strict'

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')

function exists(p) {
  try {
    fs.accessSync(p)
    return true
  } catch {
    return false
  }
}

function ensureDirSync(p) {
  fs.mkdirSync(p, { recursive: true })
  return p
}

function pad(n, width = 2) {
  return String(Math.floor(n)).padStart(width, '0')
}

function sanitizeBaseName(name) {
  return (
    String(name || 'video')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
      .replace(/[. ]+$/g, '')
      .trim()
      .slice(0, 80) || 'video'
  )
}

function uniquePath(dir, base, ext) {
  let candidate = path.join(dir, `${base}${ext}`)
  let i = 2
  while (exists(candidate)) {
    candidate = path.join(dir, `${base} (${i})${ext}`)
    i += 1
  }
  return candidate
}

function fileFingerprint(p) {
  const st = fs.statSync(p)
  return `${p}|${st.size}|${Math.round(st.mtimeMs)}`
}

function formatClock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}:${pad(m)}:${s.toFixed(3).padStart(6, '0')}`
  return `${pad(m)}:${s.toFixed(3).padStart(6, '0')}`
}

function formatStamp(date = new Date()) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours()
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function safeUnlink(p) {
  if (!p) return
  try {
    fs.rmSync(p, { force: true, recursive: true })
  } catch {
    /* ignore */
  }
}

async function atomicWrite(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  await fsp.writeFile(tmp, data, 'utf8')
  await fsp.rename(tmp, file)
}

module.exports = {
  exists,
  ensureDirSync,
  sanitizeBaseName,
  uniquePath,
  fileFingerprint,
  formatClock,
  formatStamp,
  safeUnlink,
  atomicWrite
}
