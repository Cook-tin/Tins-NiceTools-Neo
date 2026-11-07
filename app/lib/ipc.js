'use strict'

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const { ipcMain, dialog, shell, app, BrowserWindow, nativeImage } = require('electron')
const logger = require('./logger')
const mcsounds = require('./mcsounds')

const VIDEO_EXTS = new Set([
  'mp4',
  'mov',
  'mkv',
  'webm',
  'avi',
  'm4v',
  'ts',
  'mts',
  'm2ts',
  'flv',
  'wmv',
  'mpg',
  'mpeg',
  '3gp',
  'ogv',
  'mxf',
  'vob',
  'asf',
  'f4v',
  'rmvb',
  'dv',
  'm2v'
])
const AUDIO_EXTS = new Set([
  'mp3',
  'm4a',
  'aac',
  'wav',
  'flac',
  'ogg',
  'opus',
  'wma',
  'aiff',
  'aif',
  'amr',
  'mka',
  'ape',
  'wv',
  'caf'
])
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'avif', 'heic', 'tif', 'tiff'])

function isMediaPath(filePath) {
  const ext = String(filePath).split('.').pop().toLowerCase()
  return VIDEO_EXTS.has(ext) || AUDIO_EXTS.has(ext)
}

function ok(data) {
  return { ok: true, data }
}

function fail(error) {
  return { ok: false, error: error && error.message ? error.message : String(error) }
}

function handler(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return ok(await fn(event, ...args))
    } catch (err) {
      logger.warn(`ipc ${channel} failed`, err.message)
      return fail(err)
    }
  })
}

function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map((n) => Number(n) || 0)
  const pb = String(b || '0').split('.').map((n) => Number(n) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x > y) return 1
    if (x < y) return -1
  }
  return 0
}

async function downloadFile(url, dest, onProgress) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'NiceTools-Updater' },
    redirect: 'follow',
    signal: AbortSignal.timeout(10 * 60 * 1000)
  })
  if (!res.ok) throw new Error(`下载更新失败（${res.status}）`)
  const total = Number(res.headers.get('content-length')) || 0
  const hash = crypto.createHash('sha256')
  const reader = res.body.getReader()
  const out = fs.createWriteStream(dest)
  let received = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = Buffer.from(value)
      hash.update(chunk)
      received += chunk.length
      if (!out.write(chunk)) {
        await new Promise((resolve) => out.once('drain', resolve))
      }
      if (onProgress) onProgress(total ? received / total : 0, received, total)
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())))
  } catch (err) {
    out.destroy()
    throw err
  }
  return { bytes: received, sha256: hash.digest('hex') }
}

function registerIpc({ settings, ffmpeg, probe, media, exporter, litenx, server, getWindow, updateNotice }) {
  handler('app:info', async () => ({
    version: app.getVersion(),
    edition: 'Neo',
    name: 'NiceTools Neo',
    platform: process.platform,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    userData: app.getPath('userData'),
    logPath: logger.filePath(),
    packaged: app.isPackaged
  }))

  handler('update:notice', async () => {
    if (!updateNotice) return null
    const notice = {
      version: app.getVersion(),
      zipPath: String(updateNotice.zipPath || ''),
      updated: true
    }
    updateNotice = null
    return {
      ...notice,
      zipExists: Boolean(notice.zipPath && fs.existsSync(notice.zipPath))
    }
  })

  handler('update:show-package', async (_e, zipPath) => {
    if (typeof zipPath !== 'string' || !zipPath || !fs.existsSync(zipPath)) {
      return false
    }
    shell.showItemInFolder(zipPath)
    return true
  })

  handler('app:open-external', async (_e, url) => {
    if (typeof url !== 'string' || !/^https:\/\//i.test(url)) throw new Error('无效的链接')
    await shell.openExternal(url)
    return true
  })

  handler('settings:get', async () => settings.get())

  handler('settings:update', async (_e, patch) => {
    const next = settings.update(patch)
    return next
  })

  handler('ffmpeg:status', async () => ffmpeg.status())

  handler('ffmpeg:choose', async (_e, inputPath) => {
    let target = inputPath
    if (!target) {
      const result = await dialog.showOpenDialog(getWindow(), {
        title: '选择 ffmpeg.exe',
        properties: ['openFile'],
        filters: [
          { name: 'FFmpeg', extensions: ['exe'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      })
      if (result.canceled || !result.filePaths.length) return ffmpeg.status()
      target = result.filePaths[0]
    }
    return ffmpeg.choose(target)
  })

  handler('ffmpeg:download', async () => {
    if (ffmpeg.downloading) return ffmpeg.status()
    ffmpeg
      .download()
      .then((status) => {
        getWindow()?.webContents.send('ffmpeg:status', status)
        getWindow()?.webContents.send('ffmpeg:download-done', status)
      })
      .catch((err) => {
        getWindow()?.webContents.send('ffmpeg:status', ffmpeg.status())
        getWindow()?.webContents.send('ffmpeg:download-error', err.message || '下载失败')
      })
    return { started: true }
  })

  handler('ffmpeg:cancel-download', async () => {
    ffmpeg.cancelDownload()
    return true
  })

  handler('ffmpeg:open-folder', async () => {
    if (ffmpeg.ffmpegPath) shell.showItemInFolder(ffmpeg.ffmpegPath)
    return true
  })

  handler('dialog:open-media', async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: '打开视频或音频',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: '视频与音频',
          extensions: [...VIDEO_EXTS, ...AUDIO_EXTS]
        },
        { name: '视频', extensions: [...VIDEO_EXTS] },
        { name: '音频', extensions: [...AUDIO_EXTS] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    if (result.canceled) return []
    return result.filePaths
  })

  handler('dialog:open-image', async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: '打开图片',
      properties: ['openFile'],
      filters: [
        { name: '图片', extensions: [...IMAGE_EXTS] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    if (result.canceled) return []
    return result.filePaths
  })

  handler('engine:info', async () => {
    return litenx.info()
  })

  handler('dialog:save-output', async (_e, opts = {}) => {
    const defaultPath =
      typeof opts.defaultPath === 'string' ? opts.defaultPath : path.join(app.getPath('videos'), 'output.mp4')
    const ext = String(opts.ext || path.extname(defaultPath).slice(1) || 'mp4').replace('.', '')
    const filters = [{ name: `${ext.toUpperCase()} 文件`, extensions: [ext] }]
    const result = await dialog.showSaveDialog(getWindow(), {
      title: '导出到…',
      defaultPath,
      filters,
      properties: ['createDirectory', 'showOverwriteConfirmation']
    })
    if (result.canceled || !result.filePath) return null
    return result.filePath
  })

  handler('dialog:choose-folder', async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: '选择文件夹',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })

  handler('image:open', async (_e, filePath) => {
    if (typeof filePath !== 'string' || !filePath) throw new Error('无效的图片路径')
    const ext = path.extname(filePath).slice(1).toLowerCase()
    if (!IMAGE_EXTS.has(ext)) throw new Error('不支持的图片格式')
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new Error('文件不存在')
    const stat = fs.statSync(filePath)
    const image = nativeImage.createFromPath(filePath)
    const size = image.isEmpty() ? { width: 0, height: 0 } : image.getSize()
    return {
      path: filePath,
      name: path.basename(filePath),
      size: stat.size,
      width: size.width,
      height: size.height,
      url: server.urlFor(filePath)
    }
  })

  handler('media:open', async (_e, filePath) => {
    if (typeof filePath !== 'string' || !filePath) throw new Error('无效的文件路径')
    if (!isMediaPath(filePath)) throw new Error('不支持的文件格式')
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new Error('文件不存在')
    const info = await probe.info(filePath)
    settings.addRecent(info)
    return { info, url: server.urlFor(filePath) }
  })

  handler('media:probe', async (_e, filePath) => {
    if (typeof filePath !== 'string' || !isMediaPath(filePath)) throw new Error('不支持的文件格式')
    if (!fs.existsSync(filePath)) throw new Error('文件不存在')
    return probe.info(filePath)
  })

  handler('media:url', async (_e, filePath) => {
    if (typeof filePath !== 'string' || !isMediaPath(filePath)) throw new Error('不支持的文件格式')
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new Error('文件不存在')
    return server.urlFor(filePath)
  })

  handler('media:keyframes', async (_e, filePath) => {
    if (typeof filePath !== 'string' || !fs.existsSync(filePath)) return [0]
    return probe.keyframes(filePath)
  })

  handler('media:thumbs', async (_e, filePath, opts) => {
    if (typeof filePath !== 'string' || !fs.existsSync(filePath)) return []
    const info = await probe.info(filePath)
    return media.thumbnails(info, opts || {})
  })

  handler('media:waveform', async (_e, filePath, buckets) => {
    if (typeof filePath !== 'string' || !fs.existsSync(filePath)) return []
    const info = await probe.info(filePath)
    return media.waveform(info, buckets)
  })

  handler('media:estimate', async (_e, req) => {
    if (!req || !Array.isArray(req.sources)) throw new Error('无效的估算请求')
    return media.estimate(req)
  })

  handler('media:proxy', async (_e, filePath) => {
    if (typeof filePath !== 'string' || !fs.existsSync(filePath)) throw new Error('文件不存在')
    const info = await probe.info(filePath)
    const win = getWindow()
    return media.buildProxy(info, (p) => {
      win?.webContents.send('media:proxy-progress', {
        path: filePath,
        progress: p.duration ? Math.min(1, p.time / p.duration) : 0
      })
    })
  })

  handler('memory:info', async () => {
    const metrics = app.getAppMetrics()
    let mainMemory = null
    try {
      mainMemory = await process.getProcessMemoryInfo()
    } catch {
      /* ignore */
    }
    const appWorkingSet = metrics.reduce(
      (sum, item) => sum + (Number(item.memory && item.memory.workingSetSize) || 0) * 1024,
      0
    )
    return {
      system: {
        total: os.totalmem(),
        free: os.freemem()
      },
      app: {
        workingSet: appWorkingSet,
        privateBytes:
          metrics.reduce(
            (sum, item) => sum + (Number(item.memory && item.memory.privateBytes) || 0) * 1024,
            0
          ) || (mainMemory ? mainMemory.private * 1024 : 0),
        processes: metrics.length,
        mainPrivate: mainMemory ? mainMemory.private * 1024 : 0
      }
    }
  })

  handler('memory:optimize', async () => {
    const snapshot = async () => {
      const metrics = app.getAppMetrics()
      const appWorkingSet = metrics.reduce(
        (sum, item) => sum + (Number(item.memory && item.memory.workingSetSize) || 0) * 1024,
        0
      )
      return {
        system: { total: os.totalmem(), free: os.freemem() },
        app: { workingSet: appWorkingSet, processes: metrics.length }
      }
    }
    const start = await snapshot()
    const win = getWindow()
    try {
      await win?.webContents.session.clearCache()
    } catch {
      /* cache clearing is best effort */
    }
    const helper = path.join(path.dirname(process.execPath), 'NiceToolsMem.exe')
    const pids = [...new Set([process.pid, ...app.getAppMetrics().map((item) => item.pid)])]
      .map(String)
      .filter(Boolean)
    if (fs.existsSync(helper) && pids.length) {
      await new Promise((resolve) => {
        const child = spawn(helper, pids, { windowsHide: true, stdio: 'ignore' })
        const timer = setTimeout(() => {
          try {
            child.kill()
          } catch {
            /* ignore */
          }
          resolve()
        }, 8000)
        child.once('error', () => {
          clearTimeout(timer)
          resolve()
        })
        child.once('close', () => {
          clearTimeout(timer)
          resolve()
        })
      })
    }
    await new Promise((r) => setTimeout(r, 250))
    const end = await snapshot()
    return { before: start, after: end, helper: fs.existsSync(helper) }
  })

  handler('export:start', async (_e, spec) => {
    if (!spec || typeof spec !== 'object') throw new Error('无效的导出任务')
    const jobId = exporter.start(spec)
    return { jobId }
  })

  handler('export:cancel', async (_e, jobId) => {
    return exporter.cancel(jobId)
  })

  handler('export:status', async (_e, jobId) => {
    return exporter.getStatus(jobId)
  })

  handler('shell:show', async (_e, filePath) => {
    if (typeof filePath === 'string' && fs.existsSync(filePath)) shell.showItemInFolder(filePath)
    return true
  })

  handler('shell:open', async (_e, filePath) => {
    if (typeof filePath !== 'string') throw new Error('无效路径')
    const result = await shell.openPath(filePath)
    if (result) throw new Error(result)
    return true
  })

  handler('app:open-log', async () => {
    const p = logger.filePath()
    if (p && fs.existsSync(p)) shell.showItemInFolder(p)
    return true
  })

  handler('update:check', async () => {
    const current = app.getVersion()
    const feed = String(settings.get().updateFeed || '').trim()
    if (!feed) return { configured: false, current, available: false }
    try {
      const res = await fetch(feed, {
        headers: { 'User-Agent': 'NiceTools-Updater' },
        redirect: 'follow',
        signal: AbortSignal.timeout(20000)
      })
      if (!res.ok) throw new Error(`更新源返回 ${res.status}`)
      const manifest = await res.json()
      const latest = String(manifest.version || '')
      const url = manifest.url ? new URL(manifest.url, feed).toString() : ''
      return {
        configured: true,
        current,
        latest,
        available: Boolean(latest) && compareVersions(latest, current) > 0,
        url,
        sha256: manifest.sha256 || '',
        notes: manifest.notes || '',
        publishedAt: manifest.publishedAt || ''
      }
    } catch (err) {
      return { configured: true, current, available: false, error: err.message }
    }
  })

  handler('update:download', async (event, opts = {}) => {
    if (!opts.url) throw new Error('没有更新下载地址')
    const dest = path.join(
      os.tmpdir(),
      `NiceTools-update-${Date.now()}.zip`
    )
    const result = await downloadFile(opts.url, dest, (progress, received, total) => {
      try {
        if (!event.sender.isDestroyed()) {
          event.sender.send('update:progress', { progress, received, total })
        }
      } catch {
        /* ignore */
      }
    })
    if (opts.sha256 && result.sha256.toLowerCase() !== String(opts.sha256).toLowerCase()) {
      await fsp.unlink(dest).catch(() => {})
      throw new Error('更新包校验失败（SHA256 不匹配）')
    }
    return { path: dest, bytes: result.bytes, sha256: result.sha256 }
  })

  handler('update:pick-package', async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: '选择 NiceTools 更新包',
      properties: ['openFile'],
      filters: [{ name: 'NiceTools 更新包', extensions: ['zip'] }]
    })
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })

  handler('update:install', async (_e, zipPath) => {
    if (!zipPath || !fs.existsSync(zipPath)) throw new Error('更新包不存在')
    const installDir = path.dirname(process.execPath)
    const updater2 = path.join(installDir, 'NiceToolsUpdater2.exe')
    const updater = fs.existsSync(updater2)
      ? updater2
      : path.join(installDir, 'NiceToolsUpdater.exe')
    if (!fs.existsSync(updater)) throw new Error('找不到更新程序，请重新解压完整便携包')
    const child = spawn(
      updater,
      [
        '--pid',
        String(process.pid),
        '--zip',
        zipPath,
        '--dir',
        installDir,
        '--exe',
        path.join(installDir, 'NiceTools.exe')
      ],
      { detached: true, stdio: 'ignore', windowsHide: true }
    )
    child.unref()
    setTimeout(() => app.quit(), 500)
    return { ok: true }
  })

  handler('recent:remove', async (_e, filePath) => {
    return settings.removeRecent(filePath)
  })

  handler('recent:clear', async () => {
    return settings.clearRecent()
  })

  handler('mcsounds', (_e, req) => mcsounds.handle(req))
  mcsounds.registerDrag()
}

module.exports = { registerIpc, isMediaPath, VIDEO_EXTS, AUDIO_EXTS }
