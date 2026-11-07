'use strict'

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const TMP = path.join(ROOT, 'test-output', 'tmp')
fs.mkdirSync(TMP, { recursive: true })
process.env.TEMP = TMP
process.env.TMP = TMP

require('./mock-electron')
const assert = require('node:assert')
const fsp = require('node:fs/promises')

const { Settings } = require('../app/lib/settings')
const { ProbeService } = require('../app/lib/probe')
const { MediaService } = require('../app/lib/media')
const { ExportManager } = require('../app/lib/exporter')
const { MediaServer } = require('../app/lib/server')
const { trimCopyArgs, encodeVideoArgs, audioArgs, gifArgs } = require('../app/lib/commands')
const { capture } = require('../app/lib/proc')

const FFMPEG = path.join(ROOT, 'resources', 'ffmpeg', 'bin', 'ffmpeg.exe')
const FFPROBE = path.join(ROOT, 'resources', 'ffmpeg', 'bin', 'ffprobe.exe')
const MEDIA_30 = path.join(ROOT, 'test-media', 'sample-30s.mp4')
const MEDIA_8 = path.join(ROOT, 'test-media', 'sample-8s.mp4')
const OUT = path.join(ROOT, 'test-output', 'engine')

let passed = 0
const results = []

function check(name, fn) {
  return (async () => {
    try {
      await fn()
      passed += 1
      results.push(`  ok  ${name}`)
      console.log(`  ok  ${name}`)
    } catch (err) {
      results.push(`FAIL  ${name}: ${err.message}`)
      console.error(`FAIL  ${name}`)
      throw err
    }
  })()
}

function runExport(exporter, spec) {
  return new Promise((resolve, reject) => {
    const jobId = exporter.start(spec)
    const onProgress = (p) => {
      if (p.jobId !== jobId) return
      if (p.phase === 'done') {
        exporter.off('progress', onProgress)
        resolve(p)
      } else if (p.phase === 'error') {
        exporter.off('progress', onProgress)
        reject(new Error(p.message))
      } else if (p.phase === 'cancelled') {
        exporter.off('progress', onProgress)
        reject(new Error('cancelled'))
      }
    }
    exporter.on('progress', onProgress)
  })
}

async function probe(file) {
  const r = await capture(
    FFPROBE,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
    { timeout: 30000 }
  )
  assert.strictEqual(r.code, 0, r.stderr)
  return JSON.parse(r.stdout)
}

async function main() {
  await fsp.rm(OUT, { recursive: true, force: true })
  await fsp.mkdir(OUT, { recursive: true })

  const settings = new Settings()
  settings.update({ encoder: 'x264', nvencAvailable: false, faststart: true })
  const probeService = new ProbeService(() => ({ ffmpegPath: FFMPEG, ffprobePath: FFPROBE }))
  const server = new MediaServer()
  await server.start()
  const media = new MediaService({
    getPaths: () => ({ ffmpegPath: FFMPEG, ffprobePath: FFPROBE }),
    probe: probeService,
    server
  })
  const exporter = new ExportManager({
    getPaths: () => ({ ffmpegPath: FFMPEG, ffprobePath: FFPROBE }),
    probe: probeService,
    settings
  })

  await check('probe metadata', async () => {
    const info = await probeService.info(MEDIA_30)
    assert.ok(Math.abs(info.duration - 30) < 0.2, `duration=${info.duration}`)
    assert.strictEqual(info.video.width, 1280)
    assert.strictEqual(info.video.height, 720)
    assert.ok(Math.abs(info.video.fps - 30) < 0.01)
    assert.strictEqual(info.audio.codec, 'aac')
    assert.strictEqual(info.audio.sampleRate, 48000)
  })

  await check('keyframes', async () => {
    const keys = await probeService.keyframes(MEDIA_30)
    assert.ok(keys.length >= 14, `keyframes=${keys.length}`)
    assert.strictEqual(keys[0], 0)
    assert.ok(keys.includes(4), `keys=${keys.slice(0, 6).join(',')}`)
  })

  await check('trim copy (keyframe start)', async () => {
    const info = await probeService.info(MEDIA_30)
    const built = trimCopyArgs(
      info,
      { path: MEDIA_30, in: 4, out: 8 },
      { includeVideo: true, includeAudio: true, output: path.join(OUT, 'copy.mp4'), faststart: true }
    )
    const r = await capture(FFMPEG, built.args, { timeout: 60000 })
    assert.strictEqual(r.code, 0, r.stderr)
    const out = await probe(path.join(OUT, 'copy.mp4'))
    const duration = Number(out.format.duration)
    assert.ok(Math.abs(duration - 4) < 0.2, `duration=${duration}`)
    assert.strictEqual(out.streams.filter((s) => s.codec_type === 'audio').length, 1)
  })

  await check('trim encode', async () => {
    const info = await probeService.info(MEDIA_30)
    const built = encodeVideoArgs(
      info,
      { path: MEDIA_30, in: 3.5, out: 8 },
      {
        includeVideo: true,
        includeAudio: true,
        output: path.join(OUT, 'encode.mp4'),
        quality: 'balanced',
        useNvenc: false,
        faststart: true
      }
    )
    const r = await capture(FFMPEG, built.args, { timeout: 120000 })
    assert.strictEqual(r.code, 0, r.stderr)
    const out = await probe(path.join(OUT, 'encode.mp4'))
    assert.ok(Math.abs(Number(out.format.duration) - 4.5) < 0.2)
    assert.strictEqual(out.streams.find((s) => s.codec_type === 'video').codec_name, 'h264')
  })

  await check('crop', async () => {
    const info = await probeService.info(MEDIA_30)
    const built = encodeVideoArgs(
      info,
      { path: MEDIA_30, in: 1, out: 4 },
      {
        includeVideo: true,
        includeAudio: true,
        output: path.join(OUT, 'crop.mp4'),
        quality: 'balanced',
        useNvenc: false,
        faststart: true,
        crop: { x: 320, y: 180, width: 640, height: 360 }
      }
    )
    const r = await capture(FFMPEG, built.args, { timeout: 120000 })
    assert.strictEqual(r.code, 0, r.stderr)
    const out = await probe(path.join(OUT, 'crop.mp4'))
    const v = out.streams.find((s) => s.codec_type === 'video')
    assert.strictEqual(v.width, 640)
    assert.strictEqual(v.height, 360)
  })

  await check('gif', async () => {
    const info = await probeService.info(MEDIA_30)
    const built = gifArgs(
      info,
      { path: MEDIA_30, in: 2, out: 5 },
      { fps: 12, width: 320, loop: true, colors: 128 },
      path.join(OUT, 'clip.gif')
    )
    const r = await capture(FFMPEG, built.args, { timeout: 120000 })
    assert.strictEqual(r.code, 0, r.stderr)
    const out = await probe(path.join(OUT, 'clip.gif'))
    assert.strictEqual(out.streams.find((s) => s.codec_type === 'video').width, 320)
  })

  await check('audio extract (copy)', async () => {
    const info = await probeService.info(MEDIA_30)
    const built = audioArgs(
      info,
      { path: MEDIA_30, in: 2, out: 7 },
      { audioFormat: 'm4a', output: path.join(OUT, 'audio.m4a') }
    )
    const r = await capture(FFMPEG, built.args, { timeout: 60000 })
    assert.strictEqual(r.code, 0, r.stderr)
    const out = await probe(path.join(OUT, 'audio.m4a'))
    assert.strictEqual(out.streams.length, 1)
    assert.strictEqual(out.streams[0].codec_type, 'audio')
    assert.ok(Math.abs(Number(out.format.duration) - 5) < 0.2)
  })

  await check('exporter trim copy with snap', async () => {
    const p = await runExport(exporter, {
      kind: 'trim',
      sources: [{ path: MEDIA_30, in: 3.5, out: 8 }],
      outputDir: OUT,
      baseName: 'exp-trim',
      includeVideo: true,
      includeAudio: true,
      format: 'copy',
      quality: 'balanced',
      encoder: 'auto',
      faststart: true
    })
    assert.ok(p.outputs && p.outputs.length === 1)
    const out = await probe(p.outputs[0])
    assert.ok(Math.abs(Number(out.format.duration) - 6) < 0.3, `duration=${out.format.duration}`)
  })

  await check('exporter mute (video only)', async () => {
    const p = await runExport(exporter, {
      kind: 'audio',
      audioAction: 'remove',
      sources: [{ path: MEDIA_8, in: 1, out: 4 }],
      outputDir: OUT,
      baseName: 'exp-mute',
      includeVideo: true,
      includeAudio: false,
      format: 'copy',
      quality: 'balanced',
      encoder: 'auto',
      faststart: true
    })
    const out = await probe(p.outputs[0])
    assert.strictEqual(out.streams.filter((s) => s.codec_type === 'audio').length, 0)
    assert.ok(Number(out.format.duration) > 3.5 && Number(out.format.duration) < 4.3)
  })

  await check('exporter multi copy', async () => {
    const p = await runExport(exporter, {
      kind: 'multi',
      sources: [
        { path: MEDIA_8, in: 0, out: 3 },
        { path: MEDIA_8, in: 5, out: 8 }
      ],
      outputDir: OUT,
      baseName: 'exp-concat',
      includeVideo: true,
      includeAudio: true,
      format: 'copy',
      quality: 'balanced',
      encoder: 'auto',
      faststart: true
    })
    const out = await probe(p.outputs[0])
    assert.ok(Math.abs(Number(out.format.duration) - 6) < 0.4, `duration=${out.format.duration}`)
  })

  await check('exporter multi encode (mixed size)', async () => {
    const p = await runExport(exporter, {
      kind: 'multi',
      sources: [
        { path: MEDIA_8, in: 0, out: 2 },
        { path: MEDIA_30, in: 0, out: 2 }
      ],
      outputDir: OUT,
      baseName: 'exp-concat-mixed',
      includeVideo: true,
      includeAudio: true,
      format: 'h264',
      quality: 'balanced',
      encoder: 'auto',
      faststart: true
    })
    const out = await probe(p.outputs[0])
    const v = out.streams.find((s) => s.codec_type === 'video')
    assert.strictEqual(v.width, 1280)
    assert.strictEqual(v.height, 720)
    assert.ok(Math.abs(Number(out.format.duration) - 4) < 0.4, `duration=${out.format.duration}`)
  })

  await check('exporter split', async () => {
    const p = await runExport(exporter, {
      kind: 'split',
      sources: [{ path: MEDIA_8, in: 0, out: 8 }],
      outputDir: OUT,
      baseName: 'exp-split',
      includeVideo: true,
      includeAudio: true,
      format: 'copy',
      quality: 'balanced',
      encoder: 'auto',
      faststart: true,
      splitPoints: [2, 4]
    })
    assert.strictEqual(p.outputs.length, 3)
    const durations = []
    for (const f of p.outputs) {
      const out = await probe(f)
      durations.push(Number(out.format.duration))
    }
    assert.ok(durations.every((d) => d > 1.5), durations.join(','))
  })

  await check('exporter replace original', async () => {
    const temp = path.join(OUT, 'replace-me.mp4')
    await fsp.copyFile(MEDIA_8, temp)
    const p = await runExport(exporter, {
      kind: 'trim',
      sources: [{ path: temp, in: 1, out: 5 }],
      outputDir: OUT,
      baseName: 'replace-me',
      includeVideo: true,
      includeAudio: true,
      format: 'copy',
      quality: 'balanced',
      encoder: 'auto',
      faststart: true,
      replaceOriginal: true
    })
    assert.ok(fs.existsSync(temp), 'original path should exist again')
    assert.strictEqual(path.resolve(p.outputs[0]), path.resolve(temp))
    const out = await probe(temp)
    assert.ok(Number(out.format.duration) > 4.5 && Number(out.format.duration) < 5.3)
  })

  await check('estimate copy close to actual', async () => {
    const info = await probeService.info(MEDIA_30)
    const estimate = await media.estimate({
      sources: [{ path: MEDIA_30, in: 4, out: 8 }],
      format: 'copy',
      includeVideo: true,
      includeAudio: true,
      quality: 'balanced'
    })
    const built = trimCopyArgs(
      info,
      { path: MEDIA_30, in: 4, out: 8 },
      { includeVideo: true, includeAudio: true, output: path.join(OUT, 'estimate.mp4'), faststart: true }
    )
    const r = await capture(FFMPEG, built.args, { timeout: 60000 })
    assert.strictEqual(r.code, 0, r.stderr)
    const actual = fs.statSync(path.join(OUT, 'estimate.mp4')).size
    const diff = Math.abs(actual - estimate.bytes) / actual
    assert.ok(diff < 0.15, `estimate=${estimate.bytes} actual=${actual} diff=${diff}`)
  })

  await check('thumbnails and waveform', async () => {
    const info = await probeService.info(MEDIA_8)
    const thumbs = await media.thumbnails(info, { count: 12, height: 72 })
    assert.strictEqual(thumbs.length, 12)
    assert.match(thumbs[0].url, /^http:\/\/127\.0\.0\.1:/)
    const wave = await media.waveform(info, 400)
    assert.strictEqual(wave.length, 400)
    assert.ok(Math.max(...wave) > 0.1)
  })

  await check('chinese path', async () => {
    const dir = path.join(OUT, '中文 目录')
    await fsp.mkdir(dir, { recursive: true })
    const file = path.join(dir, '测试 视频.mp4')
    await fsp.copyFile(MEDIA_8, file)
    const info = await probeService.info(file)
    const built = trimCopyArgs(
      info,
      { path: file, in: 1, out: 3 },
      { includeVideo: true, includeAudio: true, output: path.join(dir, '输出.mp4'), faststart: true }
    )
    const r = await capture(FFMPEG, built.args, { timeout: 60000 })
    assert.strictEqual(r.code, 0, r.stderr)
    assert.ok(fs.existsSync(path.join(dir, '输出.mp4')))
  })

  server.close()
  console.log(`\n${passed} checks passed`)
  process.exit(0)
}

main().catch((err) => {
  console.error('\nTEST FAILED')
  console.error(err)
  process.exit(1)
})
