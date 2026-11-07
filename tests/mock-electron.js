'use strict'

const Module = require('node:module')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const userData = path.join(os.tmpdir(), 'nicetools-test-userdata')
fs.mkdirSync(userData, { recursive: true })

const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return {
      app: {
        getPath(name) {
          if (name === 'userData') return userData
          if (name === 'temp') return os.tmpdir()
          return os.tmpdir()
        },
        getAppPath() {
          return path.join(__dirname, '..', 'app')
        },
        getVersion() {
          return '0.1.0-test'
        },
        isPackaged: false,
        setName() {},
        setAppUserModelId() {},
        commandLine: { appendSwitch() {} },
        whenReady() {
          return Promise.resolve()
        },
        on() {},
        quit() {}
      },
      shell: {
        async trashItem(p) {
          fs.rmSync(p, { force: true })
        },
        showItemInFolder() {},
        async openPath() {
          return ''
        }
      },
      BrowserWindow: class {},
      ipcMain: { handle() {}, on() {} },
      dialog: {},
      nativeTheme: {},
      screen: { getAllDisplays: () => [] },
      session: {},
      Menu: {}
    }
  }
  return originalLoad.call(this, request, parent, isMain)
}

module.exports = { userData }
