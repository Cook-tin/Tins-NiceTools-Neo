'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')

let logFile = null

function file() {
  if (logFile) return logFile
  try {
    const dir = path.join(app.getPath('userData'), 'logs')
    fs.mkdirSync(dir, { recursive: true })
    logFile = path.join(dir, 'main.log')
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 2 * 1024 * 1024) {
      fs.renameSync(logFile, path.join(dir, 'main.old.log'))
    }
  } catch {
    logFile = null
  }
  return logFile
}

function write(level, args) {
  const line = `[${new Date().toISOString()}] [${level}] ${args
    .map((a) => {
      if (a instanceof Error) return a.stack || a.message
      if (typeof a === 'string') return a
      try {
        return JSON.stringify(a)
      } catch {
        return String(a)
      }
    })
    .join(' ')}\n`
  try {
    const f = file()
    if (f) fs.appendFileSync(f, line)
  } catch {
    /* ignore */
  }
  if (!app.isPackaged) process.stdout.write(line)
}

module.exports = {
  info: (...args) => write('info', args),
  warn: (...args) => write('warn', args),
  error: (...args) => write('error', args),
  filePath: () => file()
}
