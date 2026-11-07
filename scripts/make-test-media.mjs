/**
 * Generates deterministic sample footage used by the engine tests.
 * Usage: node scripts/make-test-media.mjs [--force]
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')
const ffmpeg = path.join(root, 'resources', 'ffmpeg', 'bin', 'ffmpeg.exe')
const outDir = path.join(root, 'test-media')
const force = process.argv.includes('--force')

if (!fs.existsSync(ffmpeg)) {
  console.error('FFmpeg not found. Run node scripts/fetch-ffmpeg.mjs first.')
  process.exit(1)
}
fs.mkdirSync(outDir, { recursive: true })

const jobs = [
  {
    file: 'sample-30s.mp4',
    args: [
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=1280x720:rate=30:duration=30',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000:duration=30',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-g',
      '60',
      '-keyint_min',
      '60',
      '-sc_threshold',
      '0',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-shortest'
    ]
  },
  {
    file: 'sample-8s.mp4',
    args: [
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=640x360:rate=25:duration=8',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=660:sample_rate=44100:duration=8',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-g',
      '50',
      '-keyint_min',
      '50',
      '-sc_threshold',
      '0',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '96k',
      '-shortest'
    ]
  }
]

for (const job of jobs) {
  const target = path.join(outDir, job.file)
  if (!force && fs.existsSync(target) && fs.statSync(target).size > 100_000) {
    console.log('[media] exists:', job.file)
    continue
  }
  console.log('[media] generating:', job.file)
  execFileSync(ffmpeg, ['-y', '-v', 'error', ...job.args, target], { stdio: 'inherit' })
}
console.log('[media] done')
