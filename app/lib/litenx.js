'use strict'

const { capture } = require('./proc')
const logger = require('./logger')

const DECODE_LABELS = {
  d3d11va: 'D3D11VA',
  dxva2: 'DXVA2',
  cuda: 'CUDA',
  qsv: 'Intel QSV',
  vaapi: 'VA-API',
  videotoolbox: 'VideoToolbox',
  mediacodec: 'MediaCodec',
  vulkan: 'Vulkan'
}

const ENCODE_LABELS = {
  h264_nvenc: 'NVENC',
  hevc_nvenc: 'NVENC HEVC',
  av1_nvenc: 'NVENC AV1',
  h264_qsv: 'Intel QSV',
  hevc_qsv: 'Intel QSV HEVC',
  h264_amf: 'AMD AMF',
  hevc_amf: 'AMD AMF HEVC',
  h264_videotoolbox: 'VideoToolbox',
  hevc_videotoolbox: 'VideoToolbox HEVC',
  h264_mediacodec: 'MediaCodec',
  hevc_mediacodec: 'MediaCodec HEVC'
}

function platformPreview() {
  if (process.platform === 'darwin') return 'VideoToolbox + Chromium GPU'
  if (process.platform === 'win32') return 'D3D11VA + Chromium GPU'
  return 'VA-API + Chromium GPU'
}

class LiteNXEngine {
  constructor({ ffmpeg, settings }) {
    this.ffmpeg = ffmpeg
    this.settings = settings
    this.cached = null
  }

  async detectCapabilities() {
    const status = this.ffmpeg.status()
    if (!status.connected || !status.ffmpegPath) {
      return { decode: [], encode: [], preview: platformPreview() }
    }
    const decode = []
    try {
      const accel = await capture(
        status.ffmpegPath,
        ['-hide_banner', '-hwaccels'],
        { timeout: 15000 }
      )
      const lines = String(accel.stdout || '')
        .split(/\r?\n/)
        .map((line) => line.trim().toLowerCase())
      for (const [key, label] of Object.entries(DECODE_LABELS)) {
        if (lines.includes(key)) decode.push(label)
      }
    } catch (err) {
      logger.warn('litenx hwaccel detect failed', err.message)
    }
    const compiledEncode = []
    try {
      const encoders = await capture(
        status.ffmpegPath,
        ['-hide_banner', '-encoders'],
        { timeout: 15000 }
      )
      const text = String(encoders.stdout || '')
      for (const [key, label] of Object.entries(ENCODE_LABELS)) {
        if (text.includes(key)) compiledEncode.push(label)
      }
    } catch (err) {
      logger.warn('litenx encoder detect failed', err.message)
    }
    const encode = []
    if (status.nvencAvailable && compiledEncode.some((v) => v.includes('NVENC'))) {
      encode.push('NVENC')
    }
    if (status.qsvAvailable) encode.push('Intel QSV')
    return {
      decode: [...new Set(decode)],
      encode,
      encodeSupport: [...new Set(compiledEncode)],
      preview: platformPreview()
    }
  }

  async info() {
    const status = this.ffmpeg.status()
    const cacheKey = `${status.connected}|${status.version || ''}|${status.nvencAvailable}|${status.qsvAvailable}`
    if (this.cached && this.cachedKey === cacheKey) {
      return { ...this.cached, active: this.settings.get().engine || 'litenx' }
    }
    const caps = await this.detectCapabilities()
    const info = {
      name: 'LiteNX',
      version: '1.0.0',
      backend: status.connected ? `FFmpeg ${status.version || ''}`.trim() : 'FFmpeg 未连接',
      connected: Boolean(status.connected),
      platform: process.platform,
      decode: caps.decode,
      encode: caps.encode,
      encodeSupport: caps.encodeSupport || [],
      preview: caps.preview,
      gpu: caps.decode.some((v) => /D3D11|DXVA|CUDA|VA-API|VideoToolbox/.test(v)),
      note:
        process.platform === 'win32'
          ? 'Windows 使用 D3D11VA/DXVA2 解码、NVENC/QSV/AMF 编码；MediaCodec 与 VideoToolbox 在对应平台自动启用。未检测到可用硬件编码器时自动软件回退。'
          : process.platform === 'darwin'
            ? 'macOS 使用 VideoToolbox 硬件解码与编码。'
            : 'Linux 使用 VA-API 硬件解码；MediaCodec 在 Android 端预留。'
    }
    if (status.connected) {
      this.cached = info
      this.cachedKey = cacheKey
    }
    return { ...info, active: this.settings.get().engine || 'litenx' }
  }
}

module.exports = { LiteNXEngine }
