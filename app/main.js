'use strict'

const { app, BrowserWindow, Menu, nativeTheme, screen, session, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const logger = require('./lib/logger')
const { Settings } = require('./lib/settings')
const { FfmpegService } = require('./lib/ffmpeg')
const { ProbeService } = require('./lib/probe')
const { MediaService } = require('./lib/media')
const { ExportManager } = require('./lib/exporter')
const { LiteNXEngine } = require('./lib/litenx')
const { MediaServer } = require('./lib/server')
const { registerIpc, isMediaPath } = require('./lib/ipc')
const { killAll } = require('./lib/proc')

app.setName('NiceTools Neo')
app.setAppUserModelId('com.tin.nicetools.neo')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.commandLine.appendSwitch('js-flags', '--expose-gc')

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

let mainWindow = null
let pendingFile = null
let settings = null
let ffmpeg = null
let server = null
let exporter = null
let updateNotice = null

function findUpdateNotice(argv) {
  const args = Array.isArray(argv) ? argv.slice(1) : []
  if (!args.includes('--updated')) return null
  const index = args.indexOf('--update-zip')
  const zipPath = index >= 0 && args[index + 1] ? args[index + 1] : ''
  return { zipPath, updated: true }
}

function findUpdateMarker() {
  const marker = path.join(path.dirname(process.execPath), 'update-notice.json')
  try {
    if (!fs.existsSync(marker)) return null
    const data = JSON.parse(fs.readFileSync(marker, 'utf8'))
    try {
      fs.unlinkSync(marker)
    } catch {
      /* ignore */
    }
    if (!data || (data.to && data.to !== app.getVersion())) return null
    return { zipPath: '', updated: true, marker: true }
  } catch {
    return null
  }
}

const updateMarkerNotice = findUpdateMarker()
updateNotice = findUpdateNotice(process.argv) || updateMarkerNotice

function findMediaArg(argv) {
  const args = Array.isArray(argv) ? argv.slice(1) : []
  for (const arg of args) {
    if (!arg || arg.startsWith('--')) continue
    try {
      if (fs.existsSync(arg) && fs.statSync(arg).isFile() && isMediaPath(arg)) return arg
    } catch {
      /* ignore */
    }
  }
  return null
}

function boundsVisible(bounds) {
  if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) return false
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea
    return (
      bounds.x < area.x + area.width &&
      bounds.x + bounds.width > area.x &&
      bounds.y < area.y + area.height &&
      bounds.y + bounds.height > area.y
    )
  })
}

function createWindow() {
  const saved = settings.get().windowBounds
  const useSaved = saved && saved.width >= 1080 && saved.height >= 700 && boundsVisible(saved)
  const options = {
    width: useSaved ? saved.width : 1360,
    height: useSaved ? saved.height : 860,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    backgroundColor: '#ffffff',
    title: 'NiceTools',
    titleBarStyle: 'hidden',
    titleBarOverlay:
      process.platform === 'win32'
        ? { color: '#ffffff', symbolColor: '#111111', height: 52 }
        : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false
    }
  }
  if (useSaved) {
    options.x = saved.x
    options.y = saved.y
  }
  const iconPath = path.join(__dirname, 'assets', 'icon.png')
  if (fs.existsSync(iconPath)) options.icon = iconPath

  mainWindow = new BrowserWindow(options)

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow) return
    mainWindow.show()
    mainWindow.focus()
  })

  const showFallback = setTimeout(() => {
    try {
      if (mainWindow && !mainWindow.isVisible()) {
        logger.warn('window did not become ready, showing anyway')
        mainWindow.show()
      }
    } catch {
      /* ignore */
    }
  }, 3500)
  mainWindow.once('closed', () => clearTimeout(showFallback))

  mainWindow.on('close', () => {
    try {
      if (!mainWindow.isMaximized() && !mainWindow.isFullScreen()) {
        settings.update({ windowBounds: mainWindow.getNormalBounds() })
      }
    } catch {
      /* ignore */
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url).catch(() => {})
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault()
  })

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      mainWindow.webContents.toggleDevTools()
    }
  })

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    logger.error('renderer gone', details)
  })

  mainWindow.webContents.on('did-finish-load', () => {
    if (!mainWindow) return
    if (pendingFile) {
      const file = pendingFile
      pendingFile = null
      mainWindow.webContents.send('app:open-file', file)
    }
  })

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))

  if (process.env.NICETOOLS_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

async function boot() {
  nativeTheme.themeSource = 'light'
  settings = new Settings()
  server = new MediaServer()
  await server.start()
  ffmpeg = new FfmpegService(settings)
  const probe = new ProbeService(() => ({
    ffmpegPath: ffmpeg.ffmpegPath,
    ffprobePath: ffmpeg.ffprobePath
  }))
  const media = new MediaService({
    getPaths: () => ({ ffmpegPath: ffmpeg.ffmpegPath, ffprobePath: ffmpeg.ffprobePath }),
    probe,
    server
  })
  exporter = new ExportManager({
    getPaths: () => ({ ffmpegPath: ffmpeg.ffmpegPath, ffprobePath: ffmpeg.ffprobePath }),
    probe,
    settings
  })
  const litenx = new LiteNXEngine({ ffmpeg, settings })

  ffmpeg.on('status', (status) => send('ffmpeg:status', status))
  exporter.on('progress', (progress) => send('export:progress', progress))

  registerIpc({
    settings,
    ffmpeg,
    probe,
    media,
    exporter,
    litenx,
    server,
    updateNotice: updateNotice || findUpdateNotice(process.argv),
    getWindow: () => mainWindow
  })

  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => callback(false))

  pendingFile = findMediaArg(process.argv)
  createWindow()

  try {
    if (process.env.NICETOOLS_FFMPEG && fs.existsSync(process.env.NICETOOLS_FFMPEG)) {
      await ffmpeg.choose(process.env.NICETOOLS_FFMPEG)
    } else {
      await ffmpeg.refresh()
    }
  } catch (err) {
    logger.error('ffmpeg init failed', err)
  }
  send('ffmpeg:status', ffmpeg.status())
}

if (gotLock) {
  app.on('second-instance', (event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
      const file = findMediaArg(commandLine)
      if (file) mainWindow.webContents.send('app:open-file', file)
    }
  })

  app.on('open-file', (event, filePath) => {
    event.preventDefault()
    if (mainWindow) mainWindow.webContents.send('app:open-file', filePath)
    else pendingFile = filePath
  })

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null)
    boot().catch((err) => {
      logger.error('boot failed', err)
    })
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0 && settings) {
        pendingFile = null
        createWindow()
      }
    })
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('before-quit', () => {
    if (exporter) {
      for (const job of exporter.jobs.values()) {
        job.cancelled = true
        if (job.handle) {
          try {
            job.handle.cancel()
          } catch {
            /* ignore */
          }
        }
      }
    }
    if (server) server.close()
    killAll()
  })

  process.on('uncaughtException', (err) => {
    logger.error('uncaught exception', err)
  })
  process.on('unhandledRejection', (err) => {
    logger.error('unhandled rejection', err)
  })
}
