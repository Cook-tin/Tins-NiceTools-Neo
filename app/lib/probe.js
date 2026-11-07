'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { capture } = require('./proc')
const { fileFingerprint } = require('./util')
const logger = require('./logger')

function toNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function parseFps(value, fallback = 30) {
  if (!value || typeof value !== 'string') return fallback
  if (value.includes('/')) {
    const [a, b] = value.split('/').map(Number)
    if (Number.isFinite(a) && Number.isFinite(b) && b > 0 && a > 0) return a / b
    return fallback
  }
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function normalizeRotation(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n === 0) return 0
  const rounded = Math.round(n / 90) * 90
  return ((rounded % 360) + 360) % 360
}

function readRotation(stream) {
  const side = Array.isArray(stream.side_data_list) ? stream.side_data_list : []
  for (const item of side) {
    if (item && item.rotation !== undefined) return normalizeRotation(item.rotation)
  }
  if (stream.tags && stream.tags.rotate !== undefined) return normalizeRotation(stream.tags.rotate)
  return 0
}

class ProbeService {
  constructor(getPaths) {
    this.getPaths = getPaths
    this.cache = new Map()
    this.keyframeCache = new Map()
  }

  async info(filePath) {
    const fp = fileFingerprint(filePath)
    const cached = this.cache.get(fp)
    if (cached) return cached

    const { ffprobePath } = this.getPaths()
    if (!ffprobePath) throw new Error('FFprobe 尚未连接')

    const result = await capture(
      ffprobePath,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
      { timeout: 45000 }
    )
    if (result.code !== 0) {
      throw new Error('无法读取视频信息：' + (result.stderr.trim().split('\n').pop() || '未知错误'))
    }
    let json
    try {
      json = JSON.parse(result.stdout)
    } catch {
      throw new Error('无法解析视频信息')
    }

    const streams = Array.isArray(json.streams) ? json.streams : []
    const format = json.format || {}
    const stat = fs.statSync(filePath)

    const videos = []
    const audios = []
    for (const stream of streams) {
      if (stream.codec_type === 'video') {
        if (stream.disposition && stream.disposition.attached_pic === 1) continue
        const rotation = readRotation(stream)
        const width = toNumber(stream.width)
        const height = toNumber(stream.height)
        if (!width || !height) continue
        const swap = rotation === 90 || rotation === 270
        const colorTransfer = stream.color_transfer || ''
        const colorPrimaries = stream.color_primaries || ''
        const pixFmt = stream.pix_fmt || ''
        videos.push({
          index: toNumber(stream.index, 0),
          codec: stream.codec_name || 'unknown',
          profile: stream.profile || '',
          width,
          height,
          displayWidth: swap ? height : width,
          displayHeight: swap ? width : height,
          fps: parseFps(stream.avg_frame_rate && stream.avg_frame_rate !== '0/0' ? stream.avg_frame_rate : stream.r_frame_rate),
          bitrate: toNumber(stream.bit_rate),
          pixFmt,
          colorSpace: stream.color_space || '',
          colorTransfer,
          colorPrimaries,
          isHDR: ['smpte2084', 'arib-std-b67'].includes(colorTransfer),
          is10Bit: /10|12|p010|p016/.test(pixFmt),
          rotation,
          duration: toNumber(stream.duration, toNumber(format.duration))
        })
      } else if (stream.codec_type === 'audio') {
        audios.push({
          index: toNumber(stream.index, 0),
          codec: stream.codec_name || 'unknown',
          sampleRate: toNumber(stream.sample_rate),
          channels: toNumber(stream.channels, 2),
          channelLayout: stream.channel_layout || '',
          bitrate: toNumber(stream.bit_rate),
          duration: toNumber(stream.duration, toNumber(format.duration))
        })
      }
    }

    if (!videos.length && !audios.length) {
      throw new Error('文件中没有可用的视频或音频轨道')
    }

    const duration =
      toNumber(format.duration) ||
      Math.max(0, ...videos.map((v) => v.duration), ...audios.map((a) => a.duration))

    const info = {
      path: filePath,
      name: path.basename(filePath),
      ext: path.extname(filePath).replace('.', '').toLowerCase(),
      size: toNumber(format.size, stat.size),
      mtime: Math.round(stat.mtimeMs),
      duration,
      bitrate: toNumber(format.bit_rate),
      formatName: format.format_name || '',
      video: videos[0] || null,
      audio: audios[0] || null,
      videos,
      audios,
      hasVideo: videos.length > 0,
      hasAudio: audios.length > 0
    }

    this.cache.set(fp, info)
    if (this.cache.size > 64) {
      const first = this.cache.keys().next().value
      this.cache.delete(first)
    }
    return info
  }

  async keyframes(filePath) {
    const fp = fileFingerprint(filePath)
    const cached = this.keyframeCache.get(fp)
    if (cached) return cached

    const { ffprobePath } = this.getPaths()
    if (!ffprobePath) return [0]

    let result
    try {
      result = await capture(
        ffprobePath,
        [
          '-v',
          'error',
          '-select_streams',
          'v:0',
          '-show_entries',
          'packet=pts_time,flags',
          '-of',
          'csv=p=0',
          filePath
        ],
        { timeout: 90000, maxOutput: 48 * 1024 * 1024 }
      )
    } catch (err) {
      logger.warn('keyframe probe failed', err.message)
      return [0]
    }
    if (result.code !== 0) return [0]

    const times = new Set([0])
    const lines = result.stdout.split(/\r?\n/)
    for (const line of lines) {
      if (!line) continue
      const comma = line.indexOf(',')
      if (comma < 0) continue
      const pts = Number(line.slice(0, comma))
      const flags = line.slice(comma + 1)
      if (Number.isFinite(pts) && pts >= 0 && flags.includes('K')) {
        times.add(Math.round(pts * 1000) / 1000)
      }
      if (times.size > 12000) break
    }
    const list = [...times].sort((a, b) => a - b)
    this.keyframeCache.set(fp, list)
    return list
  }
}

function snapToKeyframe(keyframes, time, direction = 'previous') {
  if (!Array.isArray(keyframes) || !keyframes.length) return 0
  if (direction === 'next') {
    const next = keyframes.find((k) => k >= time - 0.0005)
    return next === undefined ? keyframes[keyframes.length - 1] : next
  }
  let best = keyframes[0]
  for (const k of keyframes) {
    if (k <= time + 0.0005) best = k
    else break
  }
  return best
}

module.exports = { ProbeService, snapToKeyframe, parseFps, normalizeRotation }
