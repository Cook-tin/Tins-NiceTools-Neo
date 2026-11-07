'use strict'

const QUALITY = {
  high: { crf: 18, cq: 20, bpp: 0.12 },
  balanced: { crf: 21, cq: 24, bpp: 0.078 },
  small: { crf: 24, cq: 28, bpp: 0.045 }
}

function even(n) {
  const v = Math.max(2, Math.round(Number(n) || 0))
  return v % 2 === 0 ? v : v - 1
}

function ts(value) {
  return Math.max(0, Number(value) || 0).toFixed(3)
}

function pickContainer(info, includeAudio) {
  const videoCodec = info.video ? info.video.codec : ''
  const audioCodec = includeAudio && info.audio ? info.audio.codec : ''
  const mp4Video = ['h264', 'hevc', 'av1', 'mpeg4'].includes(videoCodec)
  const mp4Audio = !audioCodec || ['aac', 'mp3', 'ac3', 'eac3', 'alac'].includes(audioCodec)
  return mp4Video && mp4Audio ? 'mp4' : 'mkv'
}

function audioExtension(format) {
  if (format === 'mp3') return 'mp3'
  if (format === 'wav') return 'wav'
  if (format === 'flac') return 'flac'
  return 'm4a'
}

function canCopyAudioToM4a(info) {
  return info.audio && ['aac', 'alac'].includes(info.audio.codec)
}

function mapArgs(includeVideo, includeAudio) {
  const args = []
  if (includeVideo) args.push('-map', '0:v:0?')
  if (includeAudio) args.push('-map', '0:a:0?')
  if (!includeVideo) args.push('-vn')
  if (!includeAudio) args.push('-an')
  args.push('-sn', '-dn')
  return args
}

function faststartArgs(ext, enabled) {
  return enabled && (ext === 'mp4' || ext === 'm4a') ? ['-movflags', '+faststart'] : []
}

function trimCopyArgs(info, source, options) {
  const { includeVideo, includeAudio, output, faststart } = options
  if (!includeVideo && !includeAudio) throw new Error('至少需要保留视频或音频')
  const duration = Math.max(0.001, source.out - source.in)
  if (!includeVideo) {
    return audioArgs(info, source, { audioFormat: options.audioFormat || 'm4a', output })
  }
  const ext = pickContainer(info, includeAudio)
  const args = []
  if (source.in > 0.0005) args.push('-ss', ts(source.in))
  args.push('-i', source.path, '-t', ts(duration))
  args.push(...mapArgs(true, includeAudio && info.hasAudio))
  args.push('-map_metadata', '0', '-map_chapters', '-1')
  args.push('-c', 'copy')
  args.push(...faststartArgs(ext, faststart))
  args.push(output)
  return { args, ext }
}

function encoderArgs(quality, useNvenc, useQsv) {
  const q = QUALITY[quality] || QUALITY.balanced
  if (useNvenc) {
    return [
      '-c:v',
      'h264_nvenc',
      '-preset',
      'p4',
      '-rc',
      'vbr',
      '-cq',
      String(q.cq),
      '-b:v',
      '0',
      '-pix_fmt',
      'yuv420p'
    ]
  }
  if (useQsv) {
    return [
      '-c:v',
      'h264_qsv',
      '-preset',
      'veryfast',
      '-global_quality',
      String(q.cq + 2),
      '-look_ahead',
      '0',
      '-pix_fmt',
      'nv12'
    ]
  }
  return [
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    String(q.crf),
    '-pix_fmt',
    'yuv420p'
  ]
}

function encodeVideoArgs(info, source, options) {
  const { includeVideo, includeAudio, output, faststart, quality, useNvenc, useQsv, crop } = options
  if (!includeVideo && !includeAudio) throw new Error('至少需要保留视频或音频')
  if (!includeVideo) {
    return audioArgs(info, source, { audioFormat: options.audioFormat || 'm4a', output })
  }
  const duration = Math.max(0.001, source.out - source.in)
  const args = []
  if (source.in > 0.0005) args.push('-ss', ts(source.in))
  args.push('-i', source.path, '-t', ts(duration))
  args.push(...mapArgs(true, includeAudio && info.hasAudio))
  args.push('-map_metadata', '0', '-map_chapters', '-1')
  if (crop && info.video) {
    const c = normalizeCrop(crop, info.video.displayWidth, info.video.displayHeight)
    args.push('-vf', `crop=${c.width}:${c.height}:${c.x}:${c.y}`)
  }
  args.push(...encoderArgs(quality, useNvenc, useQsv))
  if (includeAudio && info.hasAudio) {
    args.push('-c:a', 'aac', '-b:a', '192k')
  }
  args.push(...faststartArgs('mp4', faststart))
  args.push(output)
  return { args, ext: 'mp4' }
}

function normalizeCrop(crop, width, height) {
  const W = Math.max(2, Math.round(width))
  const H = Math.max(2, Math.round(height))
  let w = Math.min(W, even(crop.width))
  let h = Math.min(H, even(crop.height))
  let x = Math.max(0, Math.min(W - w, Math.round(crop.x)))
  let y = Math.max(0, Math.min(H - h, Math.round(crop.y)))
  x = x - (x % 2)
  y = y - (y % 2)
  if (x + w > W) w = even(W - x)
  if (y + h > H) h = even(H - y)
  return { x, y, width: w, height: h }
}

function audioArgs(info, source, options) {
  const { audioFormat, output, includeVideo } = options
  const duration = Math.max(0.001, source.out - source.in)
  const args = []
  if (source.in > 0.0005) args.push('-ss', ts(source.in))
  args.push('-i', source.path, '-t', ts(duration))
  args.push('-map', '0:a:0?', '-vn', '-sn', '-dn')
  args.push('-map_metadata', '0')
  if (includeVideo) {
    // Not supported: audio-only export with video included.
  }
  if (audioFormat === 'mp3') {
    args.push('-c:a', 'libmp3lame', '-b:a', '192k')
  } else if (audioFormat === 'wav') {
    args.push('-c:a', 'pcm_s16le')
  } else if (audioFormat === 'flac') {
    args.push('-c:a', 'flac', '-compression_level', '5')
  } else if (canCopyAudioToM4a(info)) {
    args.push('-c:a', 'copy')
  } else {
    args.push('-c:a', 'aac', '-b:a', '192k')
  }
  args.push(...faststartArgs(audioExtension(audioFormat), true))
  args.push(output)
  return { args, ext: audioExtension(audioFormat) }
}

function gifArgs(info, source, gif, output, crop) {
  const duration = Math.max(0.001, source.out - source.in)
  const fps = Math.max(5, Math.min(30, Number(gif.fps) || 15))
  const width = Math.max(160, Math.min(1280, Number(gif.width) || 480))
  const colors = Math.max(32, Math.min(256, Number(gif.colors) || 128))
  const dither = colors >= 200 ? 'sierra2_4a' : 'bayer:bayer_scale=5'
  let cropFilter = ''
  if (crop && info.video) {
    const c = normalizeCrop(crop, info.video.displayWidth, info.video.displayHeight)
    cropFilter = `crop=${c.width}:${c.height}:${c.x}:${c.y},`
  }
  const filter =
    `[0:v]${cropFilter}fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];` +
    `[s0]palettegen=max_colors=${colors}:stats_mode=diff[p];` +
    `[s1][p]paletteuse=dither=${dither}:diff_mode=rectangle[gif]`
  const args = []
  if (source.in > 0.0005) args.push('-ss', ts(source.in))
  args.push('-i', source.path, '-t', ts(duration))
  args.push('-filter_complex', filter, '-map', '[gif]', '-an', '-sn', '-dn')
  args.push('-loop', gif.loop ? '0' : '-1')
  args.push(output)
  return { args, ext: 'gif' }
}

function concatListLine(filePath) {
  const normalized = String(filePath).replace(/\\/g, '/')
  return `file '${normalized.replace(/'/g, "'\\''")}'`
}

function concatCopyArgs(listFile, output, faststart) {
  return {
    args: [
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listFile,
      '-map',
      '0:v:0?',
      '-map',
      '0:a:0?',
      '-c',
      'copy',
      '-map_metadata',
      '0',
      ...(faststart && /\.mp4$/i.test(output) ? ['-movflags', '+faststart'] : []),
      output
    ],
    ext: 'mp4'
  }
}

function concatEncodeArgs(infos, sources, options) {
  const { output, quality, useNvenc, includeAudio, faststart } = options
  let target = infos[0].video || { displayWidth: 1920, displayHeight: 1080, fps: 30 }
  for (const info of infos) {
    if (!info.video) continue
    if (info.video.displayWidth * info.video.displayHeight > target.displayWidth * target.displayHeight) {
      target = info.video
    }
  }
  const W = even(target.displayWidth)
  const H = even(target.displayHeight)
  const FPS = Math.min(60, Math.max(15, Math.round(Math.max(...infos.map((i) => (i.video ? i.video.fps : 30))))))
  const inputs = []
  const filters = []
  for (let i = 0; i < sources.length; i += 1) {
    const source = sources[i]
    const info = infos[i]
    inputs.push('-i', source.path)
    const start = ts(source.in)
    const end = ts(source.out)
    filters.push(
      `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
        `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${FPS},` +
        `trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${i}]`
    )
    if (includeAudio) {
      if (info.hasAudio) {
        filters.push(
          `[${i}:a]aresample=48000,aformat=channel_layouts=stereo,` +
            `atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${i}]`
        )
      } else {
        const dur = Math.max(0.001, source.out - source.in)
        filters.push(
          `anullsrc=r=48000:cl=stereo,atrim=duration=${ts(dur)},asetpts=PTS-STARTPTS[a${i}]`
        )
      }
    }
  }
  const concatInputs = []
  for (let i = 0; i < sources.length; i += 1) {
    concatInputs.push(`[v${i}]`)
    if (includeAudio) concatInputs.push(`[a${i}]`)
  }
  filters.push(
    `${concatInputs.join('')}concat=n=${sources.length}:v=1:a=${includeAudio ? 1 : 0}[v]` +
      (includeAudio ? '[a]' : '')
  )
  const args = [...inputs, '-filter_complex', filters.join(';'), '-map', '[v]']
  if (includeAudio) args.push('-map', '[a]')
  args.push(...encoderArgs(quality, useNvenc))
  if (includeAudio) args.push('-c:a', 'aac', '-b:a', '192k')
  args.push(...faststartArgs('mp4', faststart))
  args.push(output)
  return { args, ext: 'mp4' }
}

module.exports = {
  QUALITY,
  even,
  ts,
  pickContainer,
  audioExtension,
  canCopyAudioToM4a,
  trimCopyArgs,
  encodeVideoArgs,
  audioArgs,
  gifArgs,
  normalizeCrop,
  concatListLine,
  concatCopyArgs,
  concatEncodeArgs,
  mapArgs
}
