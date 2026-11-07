'use strict'

/**
 * Boots the real Electron main process against a mocked `electron` module.
 * This exercises settings, FFmpeg discovery, the local media server, IPC
 * handlers, probing, size estimation and a real export without needing a GUI.
 */
const Module = require('node:module')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert')

const ROOT = path.resolve(__dirname, '..')
const userData = path.join(os.tmpdir(), 'nicetools-main-test')
fs.rmSync(userData, { recursive: true, force: true })
fs.mkdirSync(userData, { recursive: true })

process.env.NICETOOLS_FFMPEG = path.join(ROOT, 'resources', 'ffmpeg', 'bin', 'ffmpeg.exe')
process.env.ELECTRON_RUN_AS_NODE = ''

const windows = []
const handlers = new Map()
const sent = []
const displays = [{ workArea: { x: 0, y: 0, width: 1360, height: 860 } }]

function makeWebContents() {
  const wc = new EventEmitter()
  wc.sent = []
  wc.send = (channel, payload) => {
    wc.sent.push({ channel, payload })
    sent.push({ channel, payload })
  }
  wc.setWindowOpenHandler = () => {}
  wc.getURL = () => 'file:///test/index.html'
  wc.toggleDevTools = () => {}
  wc.openDevTools = () => {}
  return wc
}

class FakeBrowserWindow extends EventEmitter {
  constructor(options) {
    super()
    this.options = options
    this.webContents = makeWebContents()
    this.visible = false
    this.maximized = false
    this.fullscreen = false
    windows.push(this)
  }
  loadFile() {
    setTimeout(() => this.webContents.emit('did-finish-load'), 5)
    return Promise.resolve()
  }
  loadURL() {
    setTimeout(() => this.webContents.emit('did-finish-load'), 5)
    return Promise.resolve()
  }
  show() {
    this.visible = true
    this.emit('ready-to-show')
  }
  focus() {}
  isMaximized() {
    return this.maximized
  }
  isFullScreen() {
    return this.fullscreen
  }
  isMinimized() {
    return false
  }
  restore() {}
  isVisible() {
    return this.visible
  }
  isDestroyed() {
    return false
  }
  getNormalBounds() {
    return { x: 20, y: 20, width: 1360, height: 860 }
  }
  static getAllWindows() {
    return windows
  }
  static fromWebContents() {
    return windows[0] || null
  }
}

const fakeApp = {
  isPackaged: false,
  name: 'NiceTools',
  setName() {},
  setAppUserModelId() {},
  getVersion() {
    return '0.1.0-test'
  },
  getPath(name) {
    if (name === 'userData') return userData
    if (name === 'temp') return os.tmpdir()
    return os.tmpdir()
  },
  getAppPath() {
    return path.join(ROOT, 'app')
  },
  commandLine: { appendSwitch() {} },
  requestSingleInstanceLock() {
    return true
  },
  whenReady() {
    return Promise.resolve()
  },
  on() {},
  once() {},
  quit() {},
  exit() {}
}

const fakeElectron = {
  app: fakeApp,
  BrowserWindow: FakeBrowserWindow,
  Menu: { setApplicationMenu() {} },
  nativeTheme: { themeSource: 'light' },
  screen: { getAllDisplays: () => displays },
  session: { defaultSession: { setPermissionRequestHandler() {} } },
  shell: {
    showItemInFolder() {},
    async openPath() {
      return ''
    },
    async openExternal() {},
    async trashItem(p) {
      fs.rmSync(p, { force: true })
    }
  },
  dialog: {
    async showOpenDialog() {
      return { canceled: true, filePaths: [] }
    },
    async showSaveDialog() {
      return { canceled: true }
    }
  },
  ipcMain: {
    handle(channel, fn) {
      handlers.set(channel, fn)
    }
  }
}

const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return fakeElectron
  return originalLoad.call(this, request, parent, isMain)
}

function call(channel, ...args) {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`no ipc handler: ${channel}`)
  return fn({ sender: { send() {} } }, ...args)
}

function waitFor(predicate, timeoutMs, label) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tick = async () => {
      let value
      try {
        value = await predicate()
      } catch (err) {
        if (Date.now() - start > timeoutMs) return reject(err)
        setTimeout(tick, 60)
        return
      }
      if (value) return resolve(value)
      if (Date.now() - start > timeoutMs) return reject(new Error(`timeout: ${label}`))
      setTimeout(tick, 60)
    }
    tick()
  })
}

async function main() {
  require('../app/main.js')

  await waitFor(() => handlers.has('ffmpeg:status'), 8000, 'ipc registered')
  const status = await waitFor(
    async () => {
      const res = await call('ffmpeg:status')
      return res.ok && res.data.connected ? res.data : null
    },
    20000,
    'ffmpeg connected'
  )
  assert.ok(status.ffmpegPath.includes('ffmpeg.exe'))
  assert.ok(status.version, 'ffmpeg version parsed')
  console.log('  ok  main boot + ffmpeg discovery')

  const appInfo = await call('app:info')
  assert.strictEqual(appInfo.ok, true)
  assert.strictEqual(appInfo.data.version, '0.1.0-test')

  const open = await call('media:open', path.join(ROOT, 'test-media', 'sample-8s.mp4'))
  assert.strictEqual(open.ok, true, open.error)
  assert.ok(open.data.info.duration > 7)
  assert.match(open.data.url, /^http:\/\/127\.0\.0\.1:\d+\/m\//)
  console.log('  ok  ipc media open + url')

  const range = await fetch(open.data.url, { headers: { Range: 'bytes=0-1023' } })
  assert.strictEqual(range.status, 206)
  const bytes = Buffer.from(await range.arrayBuffer())
  assert.strictEqual(bytes.length, 1024)
  console.log('  ok  media server range')

  const keys = await call('media:keyframes', open.data.info.path)
  assert.ok(keys.ok && keys.data.length >= 2)
  const est = await call('media:estimate', {
    sources: [{ path: open.data.info.path, in: 0, out: 3 }],
    format: 'copy',
    includeVideo: true,
    includeAudio: true,
    quality: 'balanced'
  })
  assert.ok(est.ok && est.data.bytes > 10000, est.error)
  console.log('  ok  keyframes + size estimate')

  const started = await call('export:start', {
    kind: 'trim',
    sources: [{ path: open.data.info.path, in: 0, out: 3 }],
    outputDir: path.join(ROOT, 'test-output', 'main'),
    baseName: 'main-smoke',
    includeVideo: true,
    includeAudio: true,
    format: 'copy',
    quality: 'balanced',
    encoder: 'x264',
    faststart: true
  })
  assert.strictEqual(started.ok, true, started.error)
  const progress = await waitFor(
    () => sent.find((e) => e.channel === 'export:progress' && e.payload.phase === 'done'),
    30000,
    'export done'
  )
  assert.ok(fs.existsSync(progress.payload.outputs[0]))
  assert.ok(progress.payload.outputBytes > 10000)
  const saved = await call('export:status', started.data.jobId)
  assert.strictEqual(saved.data.phase, 'done')
  console.log('  ok  export job via ipc')

  const settings = await call('settings:get')
  assert.strictEqual(settings.ok, true)
  assert.ok(Array.isArray(settings.data.recentFiles))

  console.log('\nmain process smoke passed')
  process.exit(0)
}

main().catch((err) => {
  console.error('\nMAIN SMOKE FAILED')
  console.error(err)
  process.exit(1)
})
