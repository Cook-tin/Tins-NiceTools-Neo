'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')
const logger = require('./logger')

const DEFAULTS = {
  version: 1,
  ffmpegPath: null,
  ffmpegSource: null,
  firstRunDone: false,
  engine: 'litenx',
  defaultFormat: 'copy',
  defaultQuality: 'balanced',
  encoder: 'auto',
  faststart: true,
  replaceOriginal: false,
  openFolderAfterExport: false,
  useDefaultExportPath: false,
  defaultExportPath: '',
  lastOutputDir: null,
  updateFeed: '',
  recentFiles: [],
  windowBounds: null,
  nvencAvailable: null,
  qsvAvailable: null
}

class Settings {
  constructor() {
    this.file = path.join(app.getPath('userData'), 'settings.json')
    this.data = { ...DEFAULTS }
    this.load()
  }

  load() {
    try {
      if (fs.existsSync(this.file)) {
        const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'))
        this.data = { ...DEFAULTS, ...parsed }
        if (!Array.isArray(this.data.recentFiles)) this.data.recentFiles = []
        this.data.recentFiles = this.data.recentFiles
          .filter((f) => f && typeof f.path === 'string')
          .slice(0, 4)
      }
    } catch (err) {
      logger.warn('settings load failed', err)
      this.data = { ...DEFAULTS }
    }
  }

  get() {
    return this.data
  }

  update(patch) {
    if (!patch || typeof patch !== 'object') return this.data
    const allowed = Object.keys(DEFAULTS)
    for (const key of Object.keys(patch)) {
      if (allowed.includes(key)) this.data[key] = patch[key]
    }
    this.save()
    return this.data
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
      fs.renameSync(tmp, this.file)
    } catch (err) {
      logger.warn('settings save failed', err)
    }
  }

  addRecent(info) {
    const entry = {
      path: info.path,
      name: info.name,
      duration: info.duration,
      width: info.video ? info.video.displayWidth : 0,
      height: info.video ? info.video.displayHeight : 0,
      size: info.size,
      openedAt: Date.now()
    }
    const list = this.data.recentFiles.filter((f) => f.path !== info.path)
    list.unshift(entry)
    this.data.recentFiles = list.slice(0, 4)
    this.save()
    return this.data.recentFiles
  }

  removeRecent(filePath) {
    this.data.recentFiles = this.data.recentFiles.filter((f) => f.path !== filePath)
    this.save()
    return this.data.recentFiles
  }

  clearRecent() {
    this.data.recentFiles = []
    this.save()
    return this.data.recentFiles
  }
}

module.exports = { Settings, DEFAULTS }
