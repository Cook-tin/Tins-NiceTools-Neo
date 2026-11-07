'use strict'

const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { shell } = require('electron')
const logger = require('./logger')
const { runJob, makeTempDir } = require('./proc')
const { snapToKeyframe } = require('./probe')
const {
  trimCopyArgs,
  encodeVideoArgs,
  audioArgs,
  gifArgs,
  concatCopyArgs,
  concatEncodeArgs,
  concatListLine,
  pickContainer,
  audioExtension,
  normalizeCrop
} = require('./commands')
const { sanitizeBaseName, uniquePath, safeUnlink } = require('./util')

class CancelledError extends Error {
  constructor() {
    super('已取消')
    this.name = 'CancelledError'
  }
}

function friendlyError(stderr) {
  const text = String(stderr || '')
  if (/No such file or directory/i.test(text)) return '找不到源文件，可能已被移动或删除'
  if (/Permission denied|Access is denied/i.test(text)) return '没有写入权限，请换一个输出位置'
  if (/Invalid data found|moov atom not found|Malformed/i.test(text)) return '文件损坏或格式不受支持'
  if (/Unknown encoder|Encoder not found/i.test(text)) return '当前 FFmpeg 不支持所选编码器'
  if (/No space left/i.test(text)) return '磁盘空间不足'
  if (/Error initializing output stream|Could not open/i.test(text)) return '无法创建输出文件，请检查路径'
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  return lines.length ? lines[lines.length - 1].slice(0, 240) : '导出失败'
}

class ExportManager extends EventEmitter {
  constructor({ getPaths, probe, settings }) {
    super()
    this.getPaths = getPaths
    this.probe = probe
    this.settings = settings
    this.jobs = new Map()
  }

  start(spec) {
    const jobId = 'job_' + crypto.randomBytes(6).toString('hex')
    const job = {
      id: jobId,
      spec,
      cancelled: false,
      handle: null,
      tempDir: null,
      startedAt: Date.now()
    }
    this.jobs.set(jobId, job)
    this.emitProgress({
      jobId,
      phase: 'preparing',
      progress: 0,
      message: '准备中…'
    })
    this.execute(job)
      .then((result) => {
        this.emitProgress({
          jobId,
          phase: 'done',
          progress: 1,
          outputs: result.outputs,
          outputBytes: result.bytes,
          message: result.message || '导出完成'
        })
      })
      .catch((err) => {
        if (err instanceof CancelledError || job.cancelled) {
          this.emitProgress({ jobId, phase: 'cancelled', progress: 0, message: '已取消' })
        } else {
          logger.error('export failed', jobId, err)
          this.emitProgress({
            jobId,
            phase: 'error',
            progress: 0,
            message: err.message || '导出失败'
          })
        }
      })
      .finally(() => {
        if (job.tempDir) safeUnlink(job.tempDir)
        job.handle = null
        setTimeout(() => this.jobs.delete(jobId), 10 * 60 * 1000)
      })
    return jobId
  }

  cancel(jobId) {
    const job = this.jobs.get(jobId)
    if (!job) return false
    job.cancelled = true
    if (job.handle) {
      try {
        job.handle.cancel()
      } catch {
        /* ignore */
      }
    }
    return true
  }

  emitProgress(progress) {
    const job = this.jobs.get(progress.jobId)
    if (job) job.lastProgress = progress
    this.emit('progress', progress)
  }

  getStatus(jobId) {
    const job = this.jobs.get(jobId)
    return job ? job.lastProgress || null : null
  }

  checkCancelled(job) {
    if (job.cancelled) throw new CancelledError()
  }

  async execute(job) {
    const spec = job.spec || {}
    const { ffmpegPath } = this.getPaths()
    if (!ffmpegPath) throw new Error('FFmpeg 尚未连接')
    if (!Array.isArray(spec.sources) || !spec.sources.length) throw new Error('没有选择片段')

    job.tempDir = makeTempDir()
    const infos = []
    for (const source of spec.sources) {
      if (!source || !source.path) throw new Error('片段路径无效')
      if (!fs.existsSync(source.path)) throw new Error(`文件不存在：${source.path}`)
      const info = await this.probe.info(source.path)
      infos.push(info)
    }
    this.checkCancelled(job)

    const first = infos[0]
    const outputDir = spec.outputDir || path.dirname(first.path)
    await fsp.mkdir(outputDir, { recursive: true }).catch(() => {
      throw new Error('无法创建输出文件夹')
    })

    const kind = spec.kind
    if (kind === 'trim' || kind === 'crop' || kind === 'gif' || kind === 'audio' || kind === 'transcode') {
      return this.executeSingle(job, spec, infos, outputDir)
    }
    if (kind === 'multi') {
      return this.executeMulti(job, spec, infos, outputDir)
    }
    if (kind === 'split') {
      return this.executeSplit(job, spec, infos, outputDir)
    }
    throw new Error('未知的导出类型')
  }

  async executeSingle(job, spec, infos, outputDir) {
    const info = infos[0]
    const source = spec.sources[0]
    const requestedEncoder = this.settings.get().encoder
    const engine = spec.engine || this.settings.get().engine || 'litenx'
    const useNvenc =
      requestedEncoder === 'software'
        ? false
        : requestedEncoder === 'nvenc'
          ? this.settings.get().nvencAvailable === true
          : engine === 'litenx' && this.settings.get().nvencAvailable === true
    const useQsv =
      !useNvenc &&
      requestedEncoder !== 'software' &&
      requestedEncoder !== 'nvenc' &&
      (engine === 'litenx' || requestedEncoder === 'qsv') &&
      this.settings.get().qsvAvailable === true
    let start = Math.max(0, Math.min(Number(source.in) || 0, info.duration))
    let end = Math.max(start + 0.001, Math.min(Number(source.out) || info.duration, info.duration))
    let keyframeNotice = ''

    if (spec.format === 'copy' && spec.kind !== 'gif') {
      const keys = await this.probe.keyframes(info.path)
      const snapped = snapToKeyframe(keys, start)
      if (Math.abs(snapped - start) > 0.0006) {
        start = snapped
        keyframeNotice = `起点已对齐到关键帧 ${start.toFixed(3)}s`
        this.emitProgress({
          jobId: job.id,
          phase: 'preparing',
          progress: 0.02,
          message: keyframeNotice
        })
      }
    }

    const normalizedSource = { path: source.path, in: start, out: end }
    const base = sanitizeBaseName(spec.baseName || path.basename(info.path, path.extname(info.path)))
    let built
    let suffix = '_trim'
    if (spec.kind === 'gif') {
      suffix = '_gif'
      const out = this.resolveOutput(spec, outputDir, base, 'gif', 'gif')
      built = gifArgs(info, normalizedSource, spec.gif || {}, out.path, spec.crop)
      built.output = out.path
    } else if (spec.kind === 'transcode') {
      suffix = '_converted'
      if (spec.format === 'audio') {
        const af = spec.audioFormat || 'mp3'
        const out = this.resolveOutput(spec, outputDir, base, audioExtension(af), suffix)
        built = audioArgs(info, normalizedSource, { audioFormat: af, output: out.path })
        built.output = out.path
      } else if (spec.format === 'h264') {
        const ext = spec.container === 'mov' ? 'mov' : 'mp4'
        const out = this.resolveOutput(spec, outputDir, base, ext, suffix)
        built = encodeVideoArgs(info, normalizedSource, {
          includeVideo: true,
          includeAudio: spec.includeAudio !== false && info.hasAudio,
          output: out.path,
          faststart: spec.faststart !== false,
          quality: spec.quality,
          useNvenc,
          useQsv,
          engine
        })
        built.output = out.path
      } else {
        const ext = spec.container === 'mkv' ? 'mkv' : 'mp4'
        const out = this.resolveOutput(spec, outputDir, base, ext, suffix)
        built = trimCopyArgs(info, normalizedSource, {
          includeVideo: true,
          includeAudio: spec.includeAudio !== false && info.hasAudio,
          output: out.path,
          faststart: spec.faststart !== false
        })
        built.output = out.path
      }
    } else if (spec.kind === 'audio') {
      suffix = '_audio'
      const action = spec.audioAction || 'extract'
      if (action === 'remove') {
        const ext = spec.format === 'h264' ? 'mp4' : pickContainer(info, false)
        const out = this.resolveOutput(spec, outputDir, base, ext, suffix)
        built =
          spec.format === 'h264'
            ? encodeVideoArgs(info, normalizedSource, {
                includeVideo: true,
                includeAudio: false,
                output: out.path,
                faststart: spec.faststart !== false,
                quality: spec.quality,
                useNvenc,
                useQsv
              })
            : trimCopyArgs(info, normalizedSource, {
                includeVideo: true,
                includeAudio: false,
                output: out.path,
                faststart: spec.faststart !== false
              })
        built.output = out.path
      } else {
        const af = spec.audioFormat || 'm4a'
        const ext = audioExtension(af)
        const out = this.resolveOutput(spec, outputDir, base, ext, suffix)
        built = audioArgs(info, normalizedSource, { audioFormat: af, output: out.path })
        built.output = out.path
      }
    } else if (spec.kind === 'crop') {
      suffix = '_crop'
      const out = this.resolveOutput(spec, outputDir, base, 'mp4', suffix)
      built = encodeVideoArgs(info, normalizedSource, {
        includeVideo: true,
        includeAudio: spec.includeAudio !== false,
        output: out.path,
        faststart: spec.faststart !== false,
        quality: spec.quality,
        useNvenc,
        useQsv,
        crop: spec.crop
      })
      built.output = out.path
    } else if (spec.includeVideo === false) {
      const af = spec.audioFormat || 'm4a'
      const out = this.resolveOutput(spec, outputDir, base, audioExtension(af), suffix)
      built = audioArgs(info, normalizedSource, { audioFormat: af, output: out.path })
      built.output = out.path
    } else {
      const ext = spec.format === 'h264' ? 'mp4' : pickContainer(info, spec.includeAudio !== false)
      const out = this.resolveOutput(spec, outputDir, base, ext, suffix)
      if (spec.format === 'h264') {
        built = encodeVideoArgs(info, normalizedSource, {
          includeVideo: spec.includeVideo !== false,
          includeAudio: spec.includeAudio !== false,
          output: out.path,
          faststart: spec.faststart !== false,
          quality: spec.quality,
          useNvenc,
          useQsv,
          crop: spec.crop
        })
      } else {
        built = trimCopyArgs(info, normalizedSource, {
          includeVideo: spec.includeVideo !== false,
          includeAudio: spec.includeAudio !== false,
          output: out.path,
          faststart: spec.faststart !== false,
          audioFormat: 'm4a'
        })
      }
      built.output = out.path
    }

    this.checkCancelled(job)
    const duration = Math.max(0.001, normalizedSource.out - normalizedSource.in)
    await this.runOne(job, built.args, {
      duration,
      phase: 'encoding',
      from: 0.03,
      to: 0.94,
      message: spec.kind === 'gif' ? '正在生成 GIF…' : spec.kind === 'transcode' ? '正在转换…' : '正在导出…'
    })

    this.emitProgress({
      jobId: job.id,
      phase: 'finalizing',
      progress: 0.97,
      message: '正在完成…'
    })

    if (spec.replaceOriginal && (spec.kind === 'trim' || spec.kind === 'crop')) {
      const replaced = await this.replaceOriginal(
        job,
        info,
        built.output,
        path.extname(built.output).slice(1)
      )
      const stat = await fsp.stat(replaced.path).catch(() => null)
      return {
        outputs: [replaced.path],
        bytes: stat ? stat.size : 0,
        message: replaced.message
      }
    }

    const stat = await fsp.stat(built.output).catch(() => null)
    return {
      outputs: [built.output],
      bytes: stat ? stat.size : 0,
      message: keyframeNotice || '导出完成'
    }
  }

  async executeMulti(job, spec, infos, outputDir) {
    if (spec.includeVideo === false) throw new Error('多段拼接需要保留视频轨道')
    if (infos.some((i) => !i.hasVideo)) throw new Error('多段拼接目前需要所有文件都包含视频')
    const sources = spec.sources.map((s, i) => ({
      path: s.path,
      in: Math.max(0, Math.min(Number(s.in) || 0, infos[i].duration)),
      out: Math.max(0.001, Math.min(Number(s.out) || infos[i].duration, infos[i].duration))
    }))
    const base = sanitizeBaseName(spec.baseName || path.basename(infos[0].path, path.extname(infos[0].path)))
    const useNvenc =
      (this.settings.get().encoder === 'auto' || this.settings.get().encoder === 'nvenc') &&
      this.settings.get().nvencAvailable === true
    const compatible =
      spec.format === 'copy' &&
      infos.every((info) => this.compatibleWith(infos[0], info)) &&
      sources.every((s) => s.out > s.in)

    const totalDuration = sources.reduce((sum, s) => sum + Math.max(0.001, s.out - s.in), 0)
    let output
    if (compatible) {
      const ext = pickContainer(infos[0], spec.includeAudio !== false)
      output = this.resolveOutput(spec, outputDir, base, ext, '_concat').path
      const sameExt = new Set(infos.map((i) => i.ext)).size === 1
      const allFull =
        sameExt && sources.every((s, i) => s.in <= 0.001 && s.out >= infos[i].duration - 0.05)
      const listFile = path.join(job.tempDir, 'concat.txt')
      const lines = []
      if (allFull) {
        for (const s of sources) lines.push(concatListLine(s.path))
      } else {
        for (let i = 0; i < sources.length; i += 1) {
          this.checkCancelled(job)
          const part = path.join(job.tempDir, `part-${String(i).padStart(3, '0')}.${ext}`)
          const built = trimCopyArgs(infos[i], sources[i], {
            includeVideo: true,
            includeAudio: spec.includeAudio !== false && infos[i].hasAudio,
            output: part,
            faststart: false
          })
          const from = 0.02 + (i / sources.length) * 0.62
          const to = 0.02 + ((i + 1) / sources.length) * 0.62
          await this.runOne(job, built.args, {
            duration: Math.max(0.001, sources[i].out - sources[i].in),
            phase: 'extracting',
            from,
            to,
            message: `正在提取第 ${i + 1}/${sources.length} 段…`
          })
          lines.push(concatListLine(part))
        }
      }
      await fsp.writeFile(listFile, lines.join('\n') + '\n', 'utf8')
      const concat = concatCopyArgs(listFile, output, spec.faststart !== false)
      await this.runOne(job, concat.args, {
        duration: totalDuration,
        phase: 'concat',
        from: allFull ? 0.03 : 0.66,
        to: 0.95,
        message: '正在拼接…'
      })
    } else {
      output = this.resolveOutput(spec, outputDir, base, 'mp4', '_concat').path
      const built = concatEncodeArgs(infos, sources, {
        output,
        quality: spec.quality,
        useNvenc,
        includeAudio: spec.includeAudio !== false,
        faststart: spec.faststart !== false
      })
      await this.runOne(job, built.args, {
        duration: totalDuration,
        phase: 'encoding',
        from: 0.03,
        to: 0.95,
        message: '正在重新编码并拼接…'
      })
    }

    this.checkCancelled(job)
    this.emitProgress({ jobId: job.id, phase: 'finalizing', progress: 0.97, message: '正在完成…' })
    const stat = await fsp.stat(output).catch(() => null)
    return {
      outputs: [output],
      bytes: stat ? stat.size : 0,
      message: compatible ? '无损拼接完成' : '已重新编码并拼接完成'
    }
  }

  async executeSplit(job, spec, infos, outputDir) {
    if (spec.includeVideo === false) throw new Error('分割需要保留视频轨道')
    const info = infos[0]
    const base = sanitizeBaseName(spec.baseName || path.basename(info.path, path.extname(info.path)))
    const useNvenc =
      (this.settings.get().encoder === 'auto' || this.settings.get().encoder === 'nvenc') &&
      this.settings.get().nvencAvailable === true
    const points = (spec.splitPoints || [])
      .map((p) => Math.max(0, Math.min(Number(p) || 0, info.duration)))
      .sort((a, b) => a - b)
    const cuts = [0, ...points.filter((p) => p > 0.05 && p < info.duration - 0.05), info.duration]
    const unique = []
    for (const p of cuts) {
      if (!unique.length || p - unique[unique.length - 1] > 0.05) unique.push(p)
    }
    if (unique.length < 2) throw new Error('请先添加分割点')
    if (spec.format === 'copy') {
      const keys = await this.probe.keyframes(info.path)
      for (let i = 1; i < unique.length - 1; i += 1) {
        unique[i] = snapToKeyframe(keys, unique[i])
      }
      unique.sort((a, b) => a - b)
    }

    const outputs = []
    const total = Math.max(0.001, info.duration)
    const ext = spec.format === 'copy' ? pickContainer(info, spec.includeAudio !== false) : 'mp4'
    for (let i = 0; i < unique.length - 1; i += 1) {
      this.checkCancelled(job)
      if (unique[i + 1] - unique[i] < 0.05) continue
      const source = { path: info.path, in: unique[i], out: unique[i + 1] }
      const out = this.resolveOutput(spec, outputDir, base, ext, '', i + 1)
      let built
      if (spec.format === 'copy') {
        built = trimCopyArgs(info, source, {
          includeVideo: spec.includeVideo !== false,
          includeAudio: spec.includeAudio !== false,
          output: out.path,
          faststart: spec.faststart !== false
        })
      } else {
        built = encodeVideoArgs(info, source, {
          includeVideo: spec.includeVideo !== false,
          includeAudio: spec.includeAudio !== false,
          output: out.path,
          faststart: spec.faststart !== false,
          quality: spec.quality,
          useNvenc
        })
      }
      const from = (unique[i] / total) * 0.94
      const to = (unique[i + 1] / total) * 0.94
      await this.runOne(job, built.args, {
        duration: source.out - source.in,
        phase: 'encoding',
        from,
        to,
        message: `正在导出第 ${i + 1} 段…`
      })
      outputs.push(out.path)
    }

    this.emitProgress({ jobId: job.id, phase: 'finalizing', progress: 0.97, message: '正在完成…' })
    let bytes = 0
    for (const p of outputs) {
      const stat = await fsp.stat(p).catch(() => null)
      if (stat) bytes += stat.size
    }
    return { outputs, bytes, message: `已导出 ${outputs.length} 段` }
  }

  resolveOutput(spec, outputDir, base, ext, suffix, index) {
    let target
    if (spec.outputPath) {
      const parsed = path.parse(spec.outputPath)
      const name = index ? `${parsed.name}_${index}` : parsed.name
      target = path.join(parsed.dir, `${name}.${ext}`)
    } else {
      const name = index ? `${base}_${index}` : `${base}${suffix}`
      target = uniquePath(outputDir, name, `.${ext}`)
    }
    const dir = path.dirname(target)
    fs.mkdirSync(dir, { recursive: true })
    if (!spec.outputPath && fs.existsSync(target)) {
      target = uniquePath(dir, path.basename(target, path.extname(target)), `.${ext}`)
    }
    return { path: target }
  }

  async replaceOriginal(job, info, produced, ext) {
    const dir = path.dirname(info.path)
    const base = path.basename(info.path, path.extname(info.path))
    const finalPath = path.join(dir, `${base}.${ext}`)
    try {
      this.emitProgress({
        jobId: job.id,
        phase: 'finalizing',
        progress: 0.985,
        message: '正在替换原视频（原文件移入回收站）…'
      })
      let trashed = false
      let lastError = null
      for (let attempt = 0; attempt < 6 && !trashed; attempt += 1) {
        try {
          await shell.trashItem(info.path)
          trashed = true
        } catch (err) {
          lastError = err
          await new Promise((resolve) => setTimeout(resolve, 250))
        }
      }
      if (!trashed) throw lastError || new Error('trash failed')
      await fsp.rename(produced, finalPath)
      return { path: finalPath, message: '已替换原视频（原文件在回收站）' }
    } catch (err) {
      logger.warn('replace original failed', err)
      const fallback = uniquePath(dir, `${base}_export`, `.${ext}`)
      await fsp.rename(produced, fallback)
      return {
        path: fallback,
        message: '原视频替换失败，已保留导出文件：' + path.basename(fallback)
      }
    }
  }

  compatibleWith(a, b) {
    if (!a.video || !b.video) return false
    const va = a.video
    const vb = b.video
    if (va.codec !== vb.codec || va.width !== vb.width || va.height !== vb.height) return false
    if (va.pixFmt !== vb.pixFmt) return false
    if (va.profile && vb.profile && va.profile !== vb.profile) return false
    if (va.rotation !== vb.rotation) return false
    if (Math.abs(va.fps - vb.fps) > 0.02) return false
    const aa = a.audio
    const ba = b.audio
    if (Boolean(aa) !== Boolean(ba)) return false
    if (aa && ba) {
      if (aa.codec !== ba.codec || aa.sampleRate !== ba.sampleRate || aa.channels !== ba.channels) return false
    }
    return true
  }

  async runOne(job, args, opts) {
    this.checkCancelled(job)
    const { ffmpegPath } = this.getPaths()
    const duration = Math.max(0.001, opts.duration || 0)
    const from = opts.from ?? 0.03
    const to = opts.to ?? 0.94
    let lastEmit = 0
    const result = await runJob(ffmpegPath, args, {
      duration,
      label: `export:${job.id}`,
      onStart: (handle) => {
        job.handle = handle
      },
      onProgress: (p) => {
        if (job.cancelled) return
        const ratio = Math.max(0, Math.min(1, p.time / duration))
        const progress = from + (to - from) * ratio
        const now = Date.now()
        if (now - lastEmit < 120) return
        lastEmit = now
        const speed = p.speed || 0
        const eta = speed > 0 ? Math.max(0, (duration - p.time) / speed) : undefined
        this.emitProgress({
          jobId: job.id,
          phase: opts.phase || 'encoding',
          progress: Math.min(0.99, progress),
          speed,
          eta,
          message: opts.message || '正在导出…'
        })
      }
    })
    job.handle = null
    this.checkCancelled(job)
    if (result.code !== 0) {
      logger.error('ffmpeg export failed', {
        args: args.slice(-10),
        stderr: String(result.stderr || '').slice(-3000)
      })
      throw new Error(friendlyError(result.stderr))
    }
    return result
  }
}

module.exports = { ExportManager, friendlyError }
