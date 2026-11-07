'use strict'

const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const { app } = require('electron')
const logger = require('./logger')
const { capture } = require('./proc')

const MIRRORS = [
  {
    name: 'BtbN GPL',
    url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
    size: 202 * 1024 * 1024
  },
  {
    name: 'gyan.dev Essentials',
    url: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
    size: 115 * 1024 * 1024
  }
]

if (process.env.NICETOOLS_FFMPEG_URL) {
  MIRRORS.unshift({
    name: 'NICETOOLS_FFMPEG_URL',
    url: process.env.NICETOOLS_FFMPEG_URL,
    size: 0
  })
}

function parseVersion(text) {
  const line = String(text || '')
    .split(/\r?\n/)
    .find((l) => /^ffmpeg version/i.test(l))
  if (!line) return null
  return line.replace(/^ffmpeg version\s*/i, '').slice(0, 90)
}

function candidateFfprobe(ffmpegPath) {
  const sibling = path.join(path.dirname(ffmpegPath), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
  return fs.existsSync(sibling) ? sibling : null
}

class FfmpegService extends EventEmitter {
  constructor(settings) {
    super()
    this.settings = settings
    this.ffmpegPath = null
    this.ffprobePath = null
    this.version = null
    this.source = null
    this.downloading = false
    this.downloadPercent = 0
    this.downloadReceived = 0
    this.downloadTotal = 0
    this.downloadMessage = ''
    this.error = null
    this.abortController = null
    this.nvencAvailable = settings.get().nvencAvailable === true
    this.qsvAvailable = settings.get().qsvAvailable === true
    this.ready = false
  }

  bundledCandidates() {
    const list = []
    const exeDir = path.dirname(process.execPath)
    list.push({ path: path.join(exeDir, 'ffmpeg', 'bin', 'ffmpeg.exe'), source: 'bundled' })
    list.push({ path: path.join(exeDir, 'resources', 'ffmpeg', 'bin', 'ffmpeg.exe'), source: 'bundled' })
    try {
      list.push({
        path: path.join(process.resourcesPath, 'ffmpeg', 'bin', 'ffmpeg.exe'),
        source: 'bundled'
      })
    } catch {
      /* ignore */
    }
    list.push({
      path: path.join(app.getAppPath(), '..', 'resources', 'ffmpeg', 'bin', 'ffmpeg.exe'),
      source: 'bundled'
    })
    return list
  }

  userDataCandidate() {
    return {
      path: path.join(app.getPath('userData'), 'ffmpeg', 'bin', 'ffmpeg.exe'),
      source: 'downloaded'
    }
  }

  pathCandidates() {
    const list = []
    const pathEnv = process.env.PATH || ''
    for (const dir of pathEnv.split(path.delimiter)) {
      if (!dir) continue
      list.push({ path: path.join(dir, 'ffmpeg.exe'), source: 'system' })
    }
    list.push({ path: 'C:\\ffmpeg\\bin\\ffmpeg.exe', source: 'system' })
    const local = process.env.LOCALAPPDATA
    if (local) {
      list.push({
        path: path.join(local, 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'),
        source: 'system'
      })
    }
    return list
  }

  async validate(ffmpegPath, source) {
    if (!ffmpegPath || !fs.existsSync(ffmpegPath)) return null
    const ffprobePath = candidateFfprobe(ffmpegPath)
    if (!ffprobePath) return null
    try {
      const r = await capture(ffmpegPath, ['-version'], { timeout: 10000 })
      if (r.code !== 0) return null
      const version = parseVersion(r.stdout)
      if (!version) return null
      return { ffmpegPath, ffprobePath, version, source }
    } catch (err) {
      logger.warn('ffmpeg validate failed', ffmpegPath, err.message)
      return null
    }
  }

  async refresh() {
    const seen = new Set()
    const configured = this.settings.get().ffmpegPath
    const candidates = []
    if (configured) {
      candidates.push({ path: configured, source: this.settings.get().ffmpegSource || 'custom' })
    }
    candidates.push(this.userDataCandidate())
    candidates.push(...this.bundledCandidates())
    candidates.push(...this.pathCandidates())

    for (const candidate of candidates) {
      if (!candidate.path || seen.has(candidate.path.toLowerCase())) continue
      seen.add(candidate.path.toLowerCase())
      const valid = await this.validate(candidate.path, candidate.source)
      if (valid) {
        this.ffmpegPath = valid.ffmpegPath
        this.ffprobePath = valid.ffprobePath
        this.version = valid.version
        this.source = valid.source
        this.error = null
        this.ready = true
        logger.info('ffmpeg located', valid.ffmpegPath, valid.version)
        this.detectNvenc()
        this.emitStatus()
        return this.status()
      }
    }
    this.ffmpegPath = null
    this.ffprobePath = null
    this.version = null
    this.source = null
    this.ready = true
    this.error = '未找到 FFmpeg'
    this.emitStatus()
    return this.status()
  }

  async detectNvenc() {
    if (!this.ffmpegPath) return
    try {
      const r = await capture(
        this.ffmpegPath,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'lavfi',
          '-i',
          'color=c=black:s=256x256:d=0.1',
          '-frames:v',
          '1',
          '-c:v',
          'h264_nvenc',
          '-f',
          'null',
          '-'
        ],
        { timeout: 20000 }
      )
      const ok = r.code === 0
      this.nvencAvailable = ok
      this.settings.update({ nvencAvailable: ok })
      logger.info('nvenc available', ok)
    } catch {
      this.nvencAvailable = false
    }
    try {
      const r = await capture(
        this.ffmpegPath,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'lavfi',
          '-i',
          'color=c=black:s=256x256:d=0.1',
          '-frames:v',
          '1',
          '-c:v',
          'h264_qsv',
          '-f',
          'null',
          '-'
        ],
        { timeout: 20000 }
      )
      const ok = r.code === 0
      this.qsvAvailable = ok
      this.settings.update({ qsvAvailable: ok })
      logger.info('qsv available', ok)
    } catch {
      this.qsvAvailable = false
    }
    this.emitStatus()
  }

  status() {
    return {
      connected: Boolean(this.ffmpegPath),
      ffmpegPath: this.ffmpegPath,
      ffprobePath: this.ffprobePath,
      version: this.version,
      source: this.source,
      downloading: this.downloading,
      downloadPercent: this.downloadPercent,
      downloadReceived: this.downloadReceived,
      downloadTotal: this.downloadTotal,
      downloadMessage: this.downloadMessage,
      nvencAvailable: this.nvencAvailable,
      qsvAvailable: this.qsvAvailable,
      error: this.error
    }
  }

  emitStatus() {
    this.emit('status', this.status())
  }

  async choose(inputPath) {
    let target = inputPath
    if (!target) throw new Error('未选择文件')
    const stat = await fsp.stat(target).catch(() => null)
    if (!stat) throw new Error('文件不存在')
    if (stat.isDirectory()) {
      const options = [
        path.join(target, 'ffmpeg.exe'),
        path.join(target, 'bin', 'ffmpeg.exe'),
        path.join(target, 'ffmpeg')
      ]
      target = options.find((p) => fs.existsSync(p))
      if (!target) throw new Error('该文件夹中没有找到 ffmpeg.exe')
    }
    const ffprobe = candidateFfprobe(target)
    if (!ffprobe) throw new Error('同目录下缺少 ffprobe.exe，请选择完整的 FFmpeg 目录')
    const valid = await this.validate(target, 'custom')
    if (!valid) throw new Error('无法运行该 FFmpeg，请确认它是 Windows x64 版本')
    this.settings.update({ ffmpegPath: valid.ffmpegPath, ffmpegSource: 'custom' })
    this.ffmpegPath = valid.ffmpegPath
    this.ffprobePath = valid.ffprobePath
    this.version = valid.version
    this.source = 'custom'
    this.error = null
    this.detectNvenc()
    this.emitStatus()
    return this.status()
  }

  async download() {
    if (this.downloading) return this.status()
    this.downloading = true
    this.downloadPercent = 0
    this.downloadReceived = 0
    this.downloadTotal = 0
    this.downloadMessage = '正在连接…'
    this.error = null
    this.emitStatus()

    const workDir = path.join(app.getPath('userData'), 'downloads')
    await fsp.mkdir(workDir, { recursive: true })
    const zipPath = path.join(workDir, 'ffmpeg.zip')
    const extractDir = path.join(workDir, 'extracted')
    let lastError = null

    try {
      for (const mirror of MIRRORS) {
        try {
          this.downloadMessage = `正在从 ${mirror.name} 下载…`
          this.emitStatus()
          await this.downloadFile(mirror.url, zipPath, mirror.size)
          lastError = null
          break
        } catch (err) {
          if (err.name === 'AbortError') throw err
          lastError = err
          logger.warn('ffmpeg mirror failed', mirror.name, err.message)
          this.downloadMessage = `${mirror.name} 失败，正在尝试下一个源…`
          this.emitStatus()
        }
      }
      if (lastError) throw lastError

      this.downloadMessage = '正在解压…'
      this.downloadPercent = 100
      this.emitStatus()
      await fsp.rm(extractDir, { recursive: true, force: true })
      await fsp.mkdir(extractDir, { recursive: true })
      await this.extractZip(zipPath, extractDir)

      const files = await this.walk(extractDir)
      const ffmpegSrc = files.find(
        (f) => path.basename(f).toLowerCase() === 'ffmpeg.exe' && f.includes(`${path.sep}bin${path.sep}`)
      ) || files.find((f) => path.basename(f).toLowerCase() === 'ffmpeg.exe')
      const ffprobeSrc = files.find(
        (f) => path.basename(f).toLowerCase() === 'ffprobe.exe' && f.includes(`${path.sep}bin${path.sep}`)
      ) || files.find((f) => path.basename(f).toLowerCase() === 'ffprobe.exe')
      if (!ffmpegSrc || !ffprobeSrc) throw new Error('压缩包中未找到 ffmpeg.exe / ffprobe.exe')

      const destDir = path.join(app.getPath('userData'), 'ffmpeg', 'bin')
      await fsp.mkdir(destDir, { recursive: true })
      await fsp.copyFile(ffmpegSrc, path.join(destDir, 'ffmpeg.exe'))
      await fsp.copyFile(ffprobeSrc, path.join(destDir, 'ffprobe.exe'))

      this.downloadMessage = '正在验证…'
      this.emitStatus()
      const valid = await this.validate(path.join(destDir, 'ffmpeg.exe'), 'downloaded')
      if (!valid) throw new Error('下载的 FFmpeg 无法运行')

      this.settings.update({ ffmpegPath: valid.ffmpegPath, ffmpegSource: 'downloaded' })
      this.ffmpegPath = valid.ffmpegPath
      this.ffprobePath = valid.ffprobePath
      this.version = valid.version
      this.source = 'downloaded'
      this.downloadMessage = '已完成'
      this.downloadPercent = 100
      this.detectNvenc()
      return this.status()
    } catch (err) {
      this.error = err.name === 'AbortError' ? '下载已取消' : err.message || '下载失败'
      this.downloadMessage = this.error
      throw err
    } finally {
      this.downloading = false
      this.abortController = null
      this.emitStatus()
      await fsp.rm(extractDir, { recursive: true, force: true }).catch(() => {})
      await fsp.rm(zipPath, { force: true }).catch(() => {})
    }
  }

  async downloadFile(url, dest, approxSize) {
    this.abortController = new AbortController()
    const res = await fetch(url, { redirect: 'follow', signal: this.abortController.signal })
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
    const total = Number(res.headers.get('content-length')) || approxSize || 0
    this.downloadTotal = total
    this.downloadReceived = 0
    let lastEmit = 0
    const stream = Readable.fromWeb(res.body)
    stream.on('data', (chunk) => {
      this.downloadReceived += chunk.length
      const pct = total ? Math.min(100, (this.downloadReceived / total) * 100) : 0
      this.downloadPercent = pct
      const now = Date.now()
      if (now - lastEmit > 180) {
        lastEmit = now
        this.emitStatus()
      }
    })
    await pipeline(stream, fs.createWriteStream(dest))
    const stat = await fsp.stat(dest)
    if (stat.size < 20 * 1024 * 1024) throw new Error('下载文件不完整')
    this.downloadReceived = stat.size
    this.downloadTotal = stat.size
    this.downloadPercent = 100
    this.emitStatus()
  }

  extractZip(zipPath, destDir) {
    return new Promise((resolve, reject) => {
      const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
      const bin = fs.existsSync(tar) ? tar : 'tar.exe'
      const child = spawn(bin, ['-xf', zipPath, '-C', destDir], {
        windowsHide: true,
        stdio: 'ignore'
      })
      child.on('error', (err) => reject(new Error('解压失败：' + err.message)))
      child.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`解压失败（tar 退出码 ${code}）`))
      })
    })
  }

  async walk(dir, out = []) {
    const entries = await fsp.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await this.walk(full, out)
      else out.push(full)
    }
    return out
  }

  cancelDownload() {
    if (this.abortController) {
      try {
        this.abortController.abort()
      } catch {
        /* ignore */
      }
    }
  }
}

module.exports = { FfmpegService }
