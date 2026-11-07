'use strict'

const { contextBridge, ipcRenderer, webUtils } = require('electron')

const INVOKE_CHANNELS = new Set([
  'app:info',
  'app:open-external',
  'app:open-log',
  'settings:get',
  'settings:update',
  'ffmpeg:status',
  'ffmpeg:choose',
  'ffmpeg:download',
  'ffmpeg:cancel-download',
  'ffmpeg:open-folder',
  'dialog:open-media',
  'dialog:open-image',
  'dialog:save-output',
  'dialog:choose-folder',
  'image:open',
  'media:open',
  'media:probe',
  'media:url',
  'media:keyframes',
  'media:thumbs',
  'media:waveform',
  'media:estimate',
  'media:proxy',
  'export:start',
  'export:cancel',
  'export:status',
  'shell:show',
  'shell:open',
  'recent:remove',
  'recent:clear',
  'engine:info',
  'memory:info',
  'memory:optimize',
  'mcsounds',
  'update:notice',
  'update:show-package',
  'update:check',
  'update:download',
  'update:pick-package',
  'update:install'
])

const SEND_CHANNELS = new Set(['mcsounds:drag'])

contextBridge.exposeInMainWorld('nice', {
  invoke(channel, ...args) {
    if (!INVOKE_CHANNELS.has(channel)) {
      return Promise.reject(new Error('不允许的调用'))
    }
    return ipcRenderer.invoke(channel, ...args)
  },
  dragSync(channel, payload) {
    if (!SEND_CHANNELS.has(channel)) return null
    return ipcRenderer.sendSync(channel, payload)
  },
  getPathForFile(file) {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
  on(channel, callback) {
    const allowed = new Set([
      'ffmpeg:status',
      'ffmpeg:download-done',
      'ffmpeg:download-error',
      'export:progress',
      'media:proxy-progress',
      'update:progress',
      'app:open-file'
    ])
    if (!allowed.has(channel)) return () => {}
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }
})
