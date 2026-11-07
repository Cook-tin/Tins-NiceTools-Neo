'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { app } = require('electron')
const { capture, runJob } = require('./proc')
const { fileFingerprint } = require('./util')
const logger = require('./logger')

function hash(text) {
  return crypto.createHash('sha1').update(String(text)).digest('hex').slice(0, 20)
}

function previousKeyframe(keys, time) {
  let best = 0
  for (const k of keys) {
    if (k < time - 0.0005) best = k
    else break
  }
  return best
}

function even(n) {
  const v = Math.max(2, Math.round(Number(n) || 0))
  return v % 2 === 0 ? v : v - 1
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}

class MediaService {
  constructor({ getPaths, probe, server }) {
    this.getPaths = getPaths
    this.probe = probe
    this.server = server
    this.cacheRoot = path.join(app.getPath('userData'), 'cache')
    fs.mkdirSync(this.cacheRoot, { recursive: true })
  }

  async thumbnails(info, opts = {}) {
    if (!info.hasVideo) return []
    const count = Math.max(8, Math.min(160, Number(opts.count) || 64))
    const height = [72, 96, 120].includes(Number(opts.height)) ? Number(opts.height) : 96
    const key = hash(`${fileFingerprint(info.path)}|${count}|${height}`)
    const dir = path.join(this.cacheRoot, 'thumbs', key)
    await fsp.mkdir(dir, { recursive: true })
    const { ffmpegPath } = this.getPaths()
    if (!ffmpegPath) return []

    const items = Array.from({ length: count }, (_, i) => {
      const t = Math.min(
        Math.max(0.02, (info.duration * (i + 0.5)) / count),
        Math.max(0.02, info.duration - 0.04)
      )
      return { i, time: t, file: path.join(dir, `${String(i).padStart(3, '0')}.jpg`) }
    })

    await mapLimit(items, 4, async (item) => {
      if (fs.existsSync(item.file) && fs.statSync(item.file).size > 200) return
      const result = await capture(
        ffmpegPath,
        [
          '-v',
          'error',
          '-ss',
          item.time.toFixed(3),
          '-i',
          info.path,
          '-frames:v',
          '1',
          '-vf',
          `scale=-2:${height}`,
          '-q:v',
          '5',
          '-threads',
          '1',
          '-y',
          item.file
        ],
        { timeout: 25000 }
      ).catch(() => null)
      if (!result || result.code !== 0) {
        logger.warn('thumbnail failed', info.path, item.time)
      }
    })

    return items
      .filter((item) => fs.existsSync(item.file))
      .map((item) => ({
        index: item.i,
        time: item.time,
        url: this.server.urlFor(item.file, { cache: true })
      }))
  }

  async waveform(info, buckets = 1200) {
    if (!info.hasAudio) return []
    const size = Math.max(200, Math.min(4000, Number(buckets) || 1200))
    const key = hash(`${fileFingerprint(info.path)}|wave|${size}`)
    const dir = path.join(this.cacheRoot, 'waveform')
    await fsp.mkdir(dir, { recursive: true })
    const cacheFile = path.join(dir, `${key}.json`)
    try {
      const parsed = JSON.parse(await fsp.readFile(cacheFile, 'utf8'))
      if (Array.isArray(parsed) && parsed.length === size) return parsed
    } catch {
      /* ignore */
    }

    const { ffmpegPath } = this.getPaths()
    if (!ffmpegPath) return []
    const pcm = path.join(dir, `${key}.pcm`)
    const result = await capture(
      ffmpegPath,
      [
        '-v',
        'error',
        '-i',
        info.path,
        '-map',
        '0:a:0',
        '-ac',
        '1',
        '-ar',
        '8000',
        '-f',
        's16le',
        '-y',
        pcm
      ],
      { timeout: 180000, maxOutput: 1024 }
    ).catch(() => null)
    if (!result || result.code !== 0) {
      await fsp.rm(pcm, { force: true }).catch(() => {})
      return []
    }

    const buf = await fsp.readFile(pcm).catch(() => null)
    await fsp.rm(pcm, { force: true }).catch(() => {})
    if (!buf || buf.length < 2) return []
    const samples = Math.floor(buf.length / 2)
    const peaks = new Array(size).fill(0)
    for (let i = 0; i < samples; i += 1) {
      const v = Math.abs(buf.readInt16LE(i * 2)) / 32768
      const bucket = Math.min(size - 1, Math.floor((i / samples) * size))
      if (v > peaks[bucket]) peaks[bucket] = v
    }
    const rounded = peaks.map((v) => Math.round(v * 1000) / 1000)
    await fsp.writeFile(cacheFile, JSON.stringify(rounded), 'utf8').catch(() => {})
    return rounded
  }

  async estimate(req) {
    const sources = Array.isArray(req.sources) ? req.sources.filter((s) => s && s.path) : []
    if (!sources.length) throw new Error('没有可估算的片段')
    const infos = []
    for (const source of sources) {
      infos.push(await this.probe.info(source.path))
    }
    let duration = 0
    for (let i = 0; i < sources.length; i += 1) {
      const start = Math.max(0, Number(sources[i].in) || 0)
      const end = Math.max(start, Math.min(Number(sources[i].out) || infos[i].duration, infos[i].duration))
      duration += Math.max(0, end - start)
    }
    const format = req.format

    if (format === 'copy') {
      let bytes = 0
      let ok = true
      for (let i = 0; i < sources.length; i += 1) {
        const source = sources[i]
        const info = infos[i]
        const start = Math.max(0, Number(source.in) || 0)
        const end = Math.max(start, Number(source.out) || info.duration)
        const dur = Math.max(0.001, end - start)
        const indices = []
        if (req.includeVideo && info.video) indices.push(info.video.index)
        if (req.includeAudio && info.audio) indices.push(info.audio.index)
        if (!indices.length) continue
        const packets = await this.packetSizes(info.path, start, dur).catch(() => null)
        let sourceBytes = 0
        if (!packets) {
          ok = false
          sourceBytes = ((info.bitrate || 5_000_000) * dur) / 8
        } else {
          for (const p of packets) {
            if (indices.includes(p.stream)) sourceBytes += p.size
          }
        }
        const keys = await this.probe.keyframes(info.path).catch(() => [0])
        const preRoll = Math.max(0, start - previousKeyframe(keys, start))
        bytes += sourceBytes * ((dur + preRoll) / dur)
      }
      bytes *= 1.012
      return {
        bytes: Math.round(bytes),
        exact: ok,
        note: ok ? '无损复制 · 按实际数据包与关键帧预滚估算' : '无损复制 · 按码率粗略估算'
      }
    }

    if (format === 'h264') {
      const info = infos.reduce((best, item) => {
        const area = item.video ? item.video.displayWidth * item.video.displayHeight : 0
        const bestArea = best.video ? best.video.displayWidth * best.video.displayHeight : 0
        return area > bestArea ? item : best
      }, infos[0])
      const crop = req.crop
      const width = even(crop ? crop.width : info.video ? info.video.displayWidth : 1920)
      const height = even(crop ? crop.height : info.video ? info.video.displayHeight : 1080)
      const fps = Math.min(60, Math.max(15, info.video ? info.video.fps : 30))
      const bppMap = { high: 0.12, balanced: 0.078, small: 0.045 }
      const bpp = bppMap[req.quality] || bppMap.balanced
      const videoRate = width * height * fps * bpp
      const audioRate = req.includeAudio && info.hasAudio ? 192_000 : 0
      return {
        bytes: Math.round(((videoRate + audioRate) * duration) / 8),
        exact: false,
        note: 'H.264 重编码 · 按分辨率与画质模型估算'
      }
    }

    if (format === 'gif') {
      const info = infos[0]
      const gif = req.gif || { width: 480, fps: 15 }
      const ar = info.video ? info.video.displayHeight / info.video.displayWidth : 9 / 16
      const width = Number(gif.width) || 480
      const height = Math.max(2, Math.round(width * ar))
      const fps = Number(gif.fps) || 15
      const bytes = width * height * fps * duration * 0.055 + 1024
      return {
        bytes: Math.round(bytes),
        exact: false,
        note: 'GIF · 按尺寸与帧率粗略估算'
      }
    }

    if (format === 'audio') {
      const info = infos[0]
      const af = req.audioFormat || 'm4a'
      if (af === 'm4a' && info.audio && info.audio.codec === 'aac') {
        let bytes = 0
        for (let i = 0; i < sources.length; i += 1) {
          const source = sources[i]
          const start = Math.max(0, Number(source.in) || 0)
          const end = Math.max(start, Number(source.out) || infos[i].duration)
          const packets = await this.packetSizes(
            infos[i].path,
            start,
            Math.max(0.001, end - start)
          ).catch(() => null)
          if (packets) {
            for (const p of packets) if (p.stream === infos[i].audio.index) bytes += p.size
          } else {
            bytes += ((infos[i].audio.bitrate || 128_000) * (end - start)) / 8
          }
        }
        return { bytes: Math.round(bytes * 1.01), exact: true, note: 'M4A 原音轨 · 精确估算' }
      }
      const rate = af === 'mp3' ? 192_000 : 160_000
      return {
        bytes: Math.round((rate * duration) / 8),
        exact: false,
        note: af === 'mp3' ? 'MP3 192kbps · 按码率估算' : 'AAC 160kbps · 按码率估算'
      }
    }

    throw new Error('未知的导出格式')
  }

  async packetSizes(filePath, start, duration) {
    const { ffprobePath } = this.getPaths()
    if (!ffprobePath) return null
    const interval = `${Math.max(0, start).toFixed(3)}%+${Math.max(0.001, duration).toFixed(3)}`
    const result = await capture(
      ffprobePath,
      [
        '-v',
        'error',
        '-read_intervals',
        interval,
        '-show_entries',
        'packet=size,stream_index',
        '-of',
        'json',
        filePath
      ],
      { timeout: 30000, maxOutput: 96 * 1024 * 1024 }
    )
    if (result.code !== 0) return null
    try {
      const parsed = JSON.parse(result.stdout)
      const packets = Array.isArray(parsed.packets) ? parsed.packets : []
      return packets
        .map((p) => ({ size: Number(p.size) || 0, stream: Number(p.stream_index) }))
        .filter((p) => p.size > 0)
    } catch {
      return null
    }
  }

  async buildProxy(info, onProgress) {
    if (!info.hasVideo) throw new Error('没有视频轨道')
    const key = hash(`${fileFingerprint(info.path)}|proxy-v2`)
    const dir = path.join(this.cacheRoot, 'proxy')
    await fsp.mkdir(dir, { recursive: true })
    const out = path.join(dir, `${key}.mp4`)
    if (fs.existsSync(out) && fs.statSync(out).size > 10_000) {
      return { url: this.server.urlFor(out, { cache: true }), cached: true }
    }
    const { ffmpegPath } = this.getPaths()
    if (!ffmpegPath) throw new Error('FFmpeg 尚未连接')

    const baseFilter =
      "scale=w='min(1280,iw)':h=-2:flags=lanczos,setsar=1,format=yuv420p"
    const hdrFilter =
      "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p," +
      baseFilter
    const useHdrToneMap = Boolean(info.video && info.video.isHDR)

    const runProxy = async (filter) => {
      const args = [
        '-v',
        'error',
        '-i',
        info.path,
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        '-sn',
        '-dn',
        '-map_metadata',
        '-1',
        '-vf',
        filter,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '24',
        '-pix_fmt',
        'yuv420p'
      ]
      if (info.hasAudio) args.push('-c:a', 'aac', '-b:a', '128k')
      args.push('-movflags', '+faststart', out)
      return runJob(ffmpegPath, args, {
        duration: info.duration,
        label: 'proxy',
        onProgress: (p) => {
          if (typeof onProgress === 'function') onProgress(p)
        }
      })
    }

    let result = await runProxy(useHdrToneMap ? hdrFilter : baseFilter)
    if (result.code !== 0 && useHdrToneMap) {
      // Some FFmpeg builds do not include zscale. Keep preview working even
      // if HDR tone-mapping is unavailable.
      await fsp.rm(out, { force: true }).catch(() => {})
      result = await runProxy(baseFilter)
    }
    if (result.code !== 0) {
      await fsp.rm(out, { force: true }).catch(() => {})
      throw new Error('生成预览失败：' + (result.stderr.split('\n').pop() || 'FFmpeg 错误'))
    }
    return { url: this.server.urlFor(out, { cache: true }), cached: false }
  }
}

module.exports = { MediaService, even }
