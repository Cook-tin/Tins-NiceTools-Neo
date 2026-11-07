;(function () {
  const NT = (window.NT = window.NT || {})

  const state = {
    screen: 'boot',
    app: null,
    settings: null,
    ffmpeg: null,
    engineInfo: null,
    recent: [],
    project: null,
    image: null,
    homeTool: 'video',
    hubTab: 'convert',

    mode: 'trim',
    inPoint: 0,
    outPoint: 0,
    playhead: 0,
    autoSnap: true,
    loopPreview: false,
    previewMode: false,

    crop: null,
    cropAspect: null,

    splitPoints: [],
    multiClips: [],
    activeClip: 0,

    audioAction: 'extract',
    audioFormat: 'm4a',

    gif: { fps: 15, width: 480, loop: true, colors: 128 },

    format: 'copy',
    quality: 'balanced',
    includeVideo: true,
    includeAudio: true,
    replaceOriginal: false,
    outputPath: null,

    estimate: null,
    estimating: false,
    estimateToken: 0,

    pendingMode: null,
    pendingAudioAction: null,
    convert: {
      file: null,
      info: null,
      url: null,
      format: 'mp4',
      quality: 'balanced',
      outputPath: null,
      estimate: null,
      estimating: false
    },
    proxyBusy: false,
    proxyProgress: 0,

    dragDepth: 0
  }

  const listeners = new Set()

  function setState(patch) {
    if (!patch) return
    Object.assign(state, patch)
    for (const fn of listeners) {
      try {
        fn(patch)
      } catch (err) {
        console.error(err)
      }
    }
  }

  function subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }

  function defaultFormatForMode(mode, settings) {
    if (mode === 'gif') return 'gif'
    if (mode === 'audio') return 'audio'
    if (mode === 'crop') return 'h264'
    return (settings && settings.defaultFormat) || 'copy'
  }

  function resetForMedia(info, mode, url) {
    if (NT.History) NT.History.reset()
    const duration = Number(info.duration) || 0
    const displayWidth = info.video ? info.video.displayWidth : 0
    const displayHeight = info.video ? info.video.displayHeight : 0
    const settings = state.settings || {}
    const resolvedMode = mode || 'trim'
    const pending = state.pendingAudioAction
    let audioAction =
      resolvedMode === 'audio' && pending === 'trim'
        ? 'trim'
        : resolvedMode === 'audio' && pending === 'remove'
          ? 'remove'
          : 'extract'
    if (!info.hasVideo && audioAction === 'remove') audioAction = 'extract'
    const format =
      resolvedMode === 'audio' && audioAction === 'remove'
        ? settings.defaultFormat || 'copy'
        : defaultFormatForMode(resolvedMode, settings)

    setState({
      screen: 'editor',
      project: {
        info,
        url,
        keyframes: [],
        thumbs: [],
        waveform: null,
        proxyUrl: null,
        previewError: false
      },
      mode: resolvedMode,
      previewMode: false,
      inPoint: 0,
      outPoint: duration,
      playhead: 0,
      crop: {
        x: 0,
        y: 0,
        width: displayWidth,
        height: displayHeight
      },
      cropAspect: null,
      splitPoints: [],
      multiClips:
        resolvedMode === 'multi'
          ? [
              {
                path: info.path,
                info,
                name: info.name,
                duration: info.duration,
                in: 0,
                out: info.duration,
                url
              }
            ]
          : [],
      activeClip: 0,
      audioAction,
      audioFormat: 'm4a',
      gif: { fps: 15, width: 480, loop: true, colors: 128 },
      format,
      quality: settings.defaultQuality || 'balanced',
      includeVideo: true,
      includeAudio: Boolean(info.hasAudio),
      replaceOriginal: Boolean(settings.replaceOriginal),
      outputPath: null,
      estimate: null,
      estimating: false,
      estimateToken: 0,
      pendingAudioAction: null,
      proxyBusy: false,
      proxyProgress: 0
    })
  }

  NT.state = state
  NT.setState = setState
  NT.subscribe = subscribe
  NT.resetForMedia = resetForMedia
  NT.defaultFormatForMode = defaultFormatForMode
})()
