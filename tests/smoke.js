'use strict'

require('./mock-electron')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { capture, runJob } = require('../app/lib/proc')

const FFMPEG = path.resolve(__dirname, '..', 'resources', 'ffmpeg', 'bin', 'ffmpeg.exe')
const FFPROBE = path.resolve(__dirname, '..', 'resources', 'ffmpeg', 'bin', 'ffprobe.exe')
const MEDIA = path.resolve(__dirname, '..', 'test-media', 'sample-8s.mp4')
const OUT = path.resolve(__dirname, '..', 'test-output')

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const version = await capture(FFMPEG, ['-version'], { timeout: 10000 })
  assert.strictEqual(version.code, 0)
  assert.match(version.stdout, /ffmpeg version/)

  const probe = await capture(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', MEDIA], {
    timeout: 10000
  })
  assert.strictEqual(probe.code, 0)
  const duration = Number(probe.stdout.trim())
  assert.ok(duration > 7 && duration < 9, `duration ${duration}`)

  const out = path.join(OUT, 'smoke-copy.mp4')
  const progress = []
  const job = await runJob(
    FFMPEG,
    ['-ss', '1.000', '-i', MEDIA, '-t', '3.000', '-map', '0:v:0?', '-map', '0:a:0?', '-c', 'copy', '-y', out],
    { duration: 3, onProgress: (p) => progress.push(p.time) }
  )
  assert.strictEqual(job.code, 0, job.stderr)
  assert.ok(fs.existsSync(out))
  assert.ok(fs.statSync(out).size > 10000)
  assert.ok(progress.length > 0, 'progress callbacks fired')
  console.log('smoke ok', { duration, outSize: fs.statSync(out).size, progress: progress.length })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
