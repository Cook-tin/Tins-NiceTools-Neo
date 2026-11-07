'use strict'

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const logger = require('./logger')

const TEMP_ROOT = path.join(os.tmpdir(), 'nicetools-run')
const activeChildren = new Set()

function makeTempDir() {
  fs.mkdirSync(TEMP_ROOT, { recursive: true })
  return fs.mkdtempSync(path.join(TEMP_ROOT, 'job-'))
}

function track(child) {
  activeChildren.add(child)
  child.once('close', () => activeChildren.delete(child))
  child.once('error', () => activeChildren.delete(child))
}

function killAll() {
  for (const child of [...activeChildren]) killTree(child)
  activeChildren.clear()
}

function killTree(child) {
  if (!child || child.killed) return
  try {
    child.kill()
  } catch {
    /* ignore */
  }
  const pid = child.pid
  if (!pid) return
  setTimeout(() => {
    if (child.exitCode !== null || child.signalCode !== null) return
    try {
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true
      })
      killer.on('error', () => {})
    } catch {
      /* ignore */
    }
  }, 1200)
}

function readChunk(file, offset) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
    const stat = fs.fstatSync(fd)
    if (stat.size <= offset) return { text: '', offset, size: stat.size }
    const length = stat.size - offset
    const buf = Buffer.alloc(length)
    fs.readSync(fd, buf, 0, length, offset)
    return { text: buf.toString('utf8'), offset: stat.size, size: stat.size }
  } catch {
    return { text: '', offset, size: offset }
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd)
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Runs a process with output redirected to files (no pipes: safer in sandboxed
 * and locked-down Windows environments) and returns captured stdout/stderr.
 */
async function capture(bin, args, opts = {}) {
  const { timeout = 30000, maxOutput = 96 * 1024 * 1024 } = opts
  const dir = makeTempDir()
  const outFile = path.join(dir, 'stdout.txt')
  const errFile = path.join(dir, 'stderr.txt')
  const outFd = fs.openSync(outFile, 'w')
  const errFd = fs.openSync(errFile, 'w')

  let child
  try {
    child = spawn(bin, args, {
      windowsHide: true,
      stdio: ['ignore', outFd, errFd],
      cwd: opts.cwd
    })
  } finally {
    fs.closeSync(outFd)
    fs.closeSync(errFd)
  }

  track(child)

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    killTree(child)
  }, Math.max(1000, timeout))

  try {
    const result = await new Promise((resolve, reject) => {
      child.on('error', reject)
      child.on('close', (code, signal) => resolve({ code, signal }))
    })
    const outStat = await fsp.stat(outFile).catch(() => ({ size: 0 }))
    const errStat = await fsp.stat(errFile).catch(() => ({ size: 0 }))
    const stdout = fs.readFileSync(outFile, { encoding: 'utf8' }).slice(0, maxOutput)
    const stderr = fs.readFileSync(errFile, { encoding: 'utf8' }).slice(-64000)
    logger.info(
      `run ${path.basename(bin)} code=${result.code} out=${outStat.size} err=${errStat.size}`
    )
    return { code: result.code, signal: result.signal, stdout, stderr, timedOut }
  } catch (err) {
    logger.error('run failed', bin, args, err)
    throw err
  } finally {
    clearTimeout(timer)
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Runs ffmpeg with `-progress pipe:1` and polls the redirected stdout file for
 * progress. The callback receives {time, speed}.
 */
async function runJob(bin, args, opts = {}) {
  const { duration = 0, onProgress, label = 'ffmpeg' } = opts
  const dir = makeTempDir()
  const outFile = path.join(dir, 'progress.txt')
  const errFile = path.join(dir, 'stderr.txt')
  const outFd = fs.openSync(outFile, 'w')
  const errFd = fs.openSync(errFile, 'w')

  const fullArgs = ['-hide_banner', '-y', '-nostdin', '-progress', 'pipe:1', '-nostats', ...args]
  let child
  try {
    child = spawn(bin, fullArgs, {
      windowsHide: true,
      stdio: ['ignore', outFd, errFd],
      cwd: opts.cwd
    })
  } finally {
    fs.closeSync(outFd)
    fs.closeSync(errFd)
  }

  track(child)

  let offset = 0
  let pending = ''
  let lastTime = 0
  let lastSpeed = 0
  let timer = null

  const pump = () => {
    const chunk = readChunk(outFile, offset)
    offset = chunk.offset
    if (chunk.text) {
      pending += chunk.text
      const lines = pending.split('\n')
      pending = lines.pop() || ''
      for (const line of lines) {
        const eq = line.indexOf('=')
        if (eq < 0) continue
        const key = line.slice(0, eq).trim()
        const value = line.slice(eq + 1).trim()
        if (key === 'out_time_us' || key === 'out_time_ms') {
          const us = Number(value)
          if (Number.isFinite(us) && us >= 0) {
            lastTime = us / 1e6
            if (typeof onProgress === 'function') {
              try {
                onProgress({ time: lastTime, speed: lastSpeed, duration })
              } catch {
                /* ignore */
              }
            }
          }
        } else if (key === 'speed') {
          const sp = Number(String(value).replace('x', ''))
          if (Number.isFinite(sp)) lastSpeed = sp
        }
      }
    }
  }

  timer = setInterval(pump, 160)

  let cancelled = false
  const handle = {
    child,
    cancel() {
      cancelled = true
      killTree(child)
    }
  }
  if (typeof opts.onStart === 'function') opts.onStart(handle)

  try {
    const code = await new Promise((resolve, reject) => {
      child.on('error', reject)
      child.on('close', (c) => resolve(c))
    })
    pump()
    const stderr = fs.readFileSync(errFile, { encoding: 'utf8' }).slice(-64000)
    logger.info(`${label} finished code=${code} last=${lastTime.toFixed(2)}s`)
    return { code, stderr, cancelled, lastTime }
  } catch (err) {
    logger.error(`${label} spawn failed`, err)
    throw err
  } finally {
    clearInterval(timer)
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

module.exports = { capture, runJob, killTree, killAll, makeTempDir }
