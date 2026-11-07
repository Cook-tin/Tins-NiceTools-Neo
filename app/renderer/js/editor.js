;(function () {
  const NT = (window.NT = window.NT || {})
  const { icon } = NT
  const { fmt } = NT
  const { toast, openModal, confirmDialog } = NT.ui

  function $(sel, root) {
    return (root || document).querySelector(sel)
  }

  function $$(sel, root) {
    return Array.from((root || document).querySelectorAll(sel))
  }

  const POD = {
    video: null,
    frame: null,
    stage: null,
    cropLayer: null,
    still: null,
    stillCanvas: null,
    previewStatus: null,
    previewStatusText: null,
    previewStatusPercent: null,
    previewStatusFill: null,
    previewRetry: null,
    proxyBusy: false,
    proxyPromise: null,
    proxyFailed: false,
    proxyProgress: 0,
    timelinePane: null,
    modeTabs: null,
    modePanel: null,
    exportSettings: null,
    timeNow: null,
    timeTotal: null,
    playBtn: null,
    loopChip: null,
    volume: null,
    view: null,
    loadingTimer: null,
    assetToken: 0,
    raf: 0,
    rvfc: 0,
    playing: false,
    scrubbing: false,
    cropDrag: null,
    ro: null,
    estimateTimer: null,
    lastPlayheadPush: 0,
    mounted: false,
    currentJob: null,
    unsubs: [],
    exportUnsub: null
  }

  function project() {
    return NT.state.project
  }

  function duration() {
    return (project() && project().info && project().info.duration) || 0
  }

  function hasVideo() {
    return Boolean(project() && project().info && project().info.hasVideo)
  }

  function currentInfo() {
    return project() ? project().info : null
  }

  const DIRECT_VIDEO_CODECS = new Set(['h264', 'av1', 'vp8', 'vp9'])
  const DIRECT_AUDIO_CODECS = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac', 'pcm_s16le'])

  // Chromium's <video> support is narrower than FFmpeg's. Keep this decision
  // conservative: a false negative only costs a proxy, a false positive shows
  // the black preview error every time.
  function previewCompatibility(info) {
    if (!info || !info.hasVideo || !info.video) {
      return { direct: true, reason: '' }
    }
    const video = info.video
    if (video.isHDR || video.is10Bit) {
      return { direct: false, reason: video.isHDR ? 'hdr' : '10bit' }
    }
    if (!DIRECT_VIDEO_CODECS.has(video.codec)) {
      return { direct: false, reason: video.codec || 'video-codec' }
    }
    if (info.audio && !DIRECT_AUDIO_CODECS.has(info.audio.codec)) {
      return { direct: false, reason: info.audio.codec || 'audio-codec' }
    }
    const ext = String(info.ext || '').toLowerCase()
    const isWebm = ext === 'webm'
    const isMp4Family = ext === 'mp4' || ext === 'm4v' || ext === 'mov'
    if (isWebm) {
      return video.codec === 'h264'
        ? { direct: false, reason: 'container' }
        : { direct: true, reason: '' }
    }
    if (isMp4Family) {
      return video.codec === 'h264' || video.codec === 'av1'
        ? { direct: true, reason: '' }
        : { direct: false, reason: 'container' }
    }
    return { direct: false, reason: ext || 'container' }
  }

  function cropChanged() {
    const s = NT.state
    const info = currentInfo()
    if (!s.crop || !info || !info.video) return false
    const W = info.video.displayWidth
    const H = info.video.displayHeight
    return (
      s.crop.x > 0.5 ||
      s.crop.y > 0.5 ||
      s.crop.width < W - 0.5 ||
      s.crop.height < H - 0.5
    )
  }

  function effectiveSources() {
    const s = NT.state
    if (s.mode === 'multi') {
      return (s.multiClips || []).map((clip) => ({
        path: clip.path,
        in: clip.in || 0,
        out: clip.out === undefined ? clip.info.duration : clip.out
      }))
    }
    if (s.mode === 'split') {
      return [{ path: project().info.path, in: 0, out: duration() }]
    }
    return [{ path: project().info.path, in: s.inPoint, out: s.outPoint }]
  }

  function effectiveIncludes() {
    const s = NT.state
    if (s.format === 'gif') return { video: true, audio: false }
    if (s.format === 'audio') return { video: false, audio: true }
    if (cropChanged()) return { video: true, audio: s.includeAudio }
    return { video: s.includeVideo, audio: s.includeAudio }
  }

  function effectiveFormat() {
    const s = NT.state
    if (s.format === 'gif' || s.format === 'audio') return s.format
    if (s.format === 'h264') return 'h264'
    return cropChanged() ? 'h264' : 'copy'
  }

  function pickContainer(info, includeAudio) {
    const v = info && info.video ? info.video.codec : ''
    const a = includeAudio && info && info.audio ? info.audio.codec : ''
    const okV = ['h264', 'hevc', 'av1', 'mpeg4'].includes(v)
    const okA = !a || ['aac', 'mp3', 'ac3', 'eac3', 'alac'].includes(a)
    return okV && okA ? 'mp4' : 'mkv'
  }

  function outputExtension() {
    const s = NT.state
    const fmtKey = effectiveFormat()
    if (fmtKey === 'gif') return 'gif'
    if (fmtKey === 'audio') {
      if (s.audioFormat === 'mp3') return 'mp3'
      if (s.audioFormat === 'wav') return 'wav'
      if (s.audioFormat === 'flac') return 'flac'
      return 'm4a'
    }
    if (fmtKey === 'h264') return 'mp4'
    if (!s.includeVideo) return s.audioFormat === 'mp3' ? 'mp3' : 'm4a'
    return pickContainer(currentInfo(), s.includeAudio)
  }

  function outputBaseName() {
    return fmt.stripExt(project().info.name)
  }

  function outputSuffix() {
    const s = NT.state
    const fmtKey = effectiveFormat()
    if (fmtKey === 'gif') return '_gif'
    if (fmtKey === 'audio') return '_audio'
    if (cropChanged()) return '_crop'
    return '_trim'
  }

  function joinPath(dir, name) {
    if (!dir) return name
    return dir.replace(/[\\/]+$/, '') + '\\' + name
  }

  function defaultExportDir() {
    const settings = NT.state.settings || {}
    if (!settings.useDefaultExportPath) return ''
    const value = typeof settings.defaultExportPath === 'string' ? settings.defaultExportPath.trim() : ''
    return value
  }

  function computedOutput() {
    const s = NT.state
    if (!project()) return null
    const ext = outputExtension()
    const base = outputBaseName()
    const suffix = outputSuffix()
    const sourceDir = fmt.dirname(project().info.path)
    const preferredDir = !s.outputPath ? defaultExportDir() || sourceDir : fmt.dirname(s.outputPath)
    const name = `${base}${suffix}.${ext}`
    const autoPath = joinPath(preferredDir, name)
    return {
      ext,
      autoPath,
      path: s.outputPath || autoPath,
      name: s.outputPath ? fmt.basename(s.outputPath) : name,
      dir: s.outputPath ? fmt.dirname(s.outputPath) : preferredDir,
      sourceDir
    }
  }

  function snapPlayhead(t) {
    const s = NT.state
    if (!s.autoSnap) return t
    const d = duration()
    const pps = (NT.Timeline && NT.Timeline.pps) || 1
    const threshold = Math.min(0.2, Math.max(0.02, 7 / Math.max(0.1, pps)))
    let best = t
    let dist = threshold
    for (const candidate of [0, d, s.inPoint, s.outPoint]) {
      const delta = Math.abs(candidate - t)
      if (delta < dist) {
        dist = delta
        best = candidate
      }
    }
    return best
  }

  function clampSelection() {
    const s = NT.state
    const d = duration()
    let inPoint = fmt.clamp(s.inPoint, 0, Math.max(0, d - 0.05))
    let outPoint = fmt.clamp(s.outPoint, inPoint + 0.05, d)
    if (outPoint - inPoint < 0.05) outPoint = Math.min(d, inPoint + 0.05)
    return { inPoint, outPoint }
  }

  function setPlayhead(t, opts) {
    const d = duration()
    const raw = fmt.clamp(Number(t) || 0, 0, d)
    const clamped = !opts || opts.snap !== false ? snapPlayhead(raw) : raw
    NT.setState({ playhead: clamped })
    if (POD.video) {
      try {
        if (Math.abs(POD.video.currentTime - clamped) > 0.008) POD.video.currentTime = clamped
      } catch {
        /* ignore */
      }
    }
    NT.Timeline.setPlayhead(clamped)
    updateTimeNow(clamped)
  }

  async function selectClip(index) {
    const s = NT.state
    if (s.mode !== 'multi') return
    const clip = (s.multiClips || [])[Number(index)]
    if (!clip) return
    let url = clip.url
    if (!url) {
      try {
        url = await NT.api.call('media:url', clip.path)
      } catch {
        url = s.project && s.project.url
      }
      clip.url = url || ''
    }
    const wasPlaying = POD.video && !POD.video.paused
    const local = Number(clip.in) || 0
    NT.setState({
      activeClip: Number(index),
      playhead: local,
      inPoint: 0,
      outPoint: clip.info.duration,
      estimate: null,
      estimating: false
    })
    const project = POD.mounted ? NT.state.project : null
    if (project) {
      project.info = clip.info
      project.url = url
      project.keyframes = []
      project.thumbs = []
      project.waveform = null
      project.proxyUrl = null
      project.previewError = false
    }
    if (POD.video) {
      POD.video.pause()
      if (POD.video.src !== url) {
        const onMeta = () => {
          try {
            POD.video.currentTime = local
          } catch {
            /* ignore */
          }
          if (wasPlaying) POD.video.play().catch(() => {})
        }
        POD.video.addEventListener('loadedmetadata', onMeta, { once: true })
        POD.video.src = url
        POD.video.load()
      } else {
        try {
          POD.video.currentTime = local
        } catch {
          /* ignore */
        }
        if (wasPlaying) POD.video.play().catch(() => {})
      }
    }
    if (NT.Timeline) {
      NT.Timeline.setData({ thumbs: [], waveform: [], keyframes: [] })
      NT.Timeline.refresh()
      NT.Timeline.setPlayhead(local)
    }
    if (NT.renderTitlebar) NT.renderTitlebar('editor')
    if (typeof document !== 'undefined') document.title = `${clip.name} — NiceTools`
    renderModeTabs()
    renderPanel()
    renderExportCard()
    updateTransportDuration()
    updateTimeNow(local)
    renderCropLayer(true)
    void loadAssets(++POD.assetToken)
    scheduleEstimate(80)
  }

  function flashCut(t) {
    if (!NT.Timeline || !POD.timelinePane) return
    const tracks = POD.timelinePane.querySelector('.tl-tracks')
    if (!tracks) return
    const line = document.createElement('span')
    line.className = 'tl-cut-flash'
    line.style.left = `${t * (NT.Timeline.pps || 0)}px`
    tracks.appendChild(line)
    setTimeout(() => line.remove(), 620)
  }

  function splitAtPlayhead() {
    const s = NT.state
    if (!project()) return
    const d = duration()
    const t = fmt.clamp(Number(s.playhead) || 0, 0, d)
    if (t <= 0.05 || t >= d - 0.05) {
      toast('请把播放头移到中间再分割')
      return
    }
    if (t <= s.inPoint + 0.02 || t >= s.outPoint - 0.02) {
      if (t <= s.inPoint || t >= s.outPoint) {
        NT.setState({ inPoint: t, outPoint: d, playhead: t, estimate: null })
        setPlayhead(t, { snap: false })
        renderPanel()
        renderExportCard()
        NT.Timeline.refresh()
        if (s.mode === 'crop') renderCropLayer(true)
        flashCut(t)
        scheduleEstimate(80)
        toast('已从播放头分割，选中后半段')
        return
      }
      toast('播放头已经贴在选区边缘')
      return
    }
    NT.setState({ inPoint: t, playhead: t, estimate: null })
    setPlayhead(t, { snap: false })
    renderPanel()
    renderExportCard()
    NT.Timeline.refresh()
    if (s.mode === 'crop') renderCropLayer(true)
    flashCut(t)
    scheduleEstimate(80)
    toast('已分割，选中后半段')
  }

  function reorderClips(from, to) {
    const clips = [...(NT.state.multiClips || [])]
    if (from < 0 || from >= clips.length || to < 0 || to >= clips.length || from === to) return
    const active = clips[NT.state.activeClip || 0]
    const [moved] = clips.splice(from, 1)
    clips.splice(to, 0, moved)
    const activeIndex = Math.max(0, clips.indexOf(active))
    NT.setState({ multiClips: clips, activeClip: activeIndex, estimate: null })
    renderPanel()
    renderExportCard()
    NT.Timeline.refresh()
    scheduleEstimate(100)
  }

  function addVideoToTrack() {
    if (NT.openMultiDialog) NT.openMultiDialog()
  }

  function updateTimeNow(t) {
    if (POD.timeNow) POD.timeNow.textContent = fmt.formatClock(t, 2)
  }

  function updateTransportDuration() {
    if (POD.timeTotal) POD.timeTotal.textContent = `/ ${fmt.formatClock(duration(), 2)}`
  }

  function updatePlayState(playing) {
    POD.playing = playing
    if (POD.playBtn) {
      POD.playBtn.innerHTML = icon(playing ? 'pause' : 'play', 18)
      POD.playBtn.setAttribute('aria-label', playing ? '暂停' : '播放')
    }
    if (NT.Timeline && NT.Timeline.setPlaying) NT.Timeline.setPlaying(playing)
  }

  function togglePlay() {
    if (!POD.video) return
    if (POD.video.paused) {
      const s = NT.state
      const editable = NT.Timeline.isEditable()
      if (editable && (POD.video.currentTime < s.inPoint - 0.01 || POD.video.currentTime >= s.outPoint - 0.02)) {
        setPlayhead(s.inPoint)
      }
      POD.video.play().catch(() => {})
    } else {
      POD.video.pause()
    }
  }

  function applyPreviewMode() {
    const on = Boolean(NT.state.previewMode)
    const editorEl = POD.view ? POD.view.querySelector('.editor') : null
    if (editorEl) editorEl.classList.toggle('preview-mode', on)
    document.getElementById('app-body')?.classList.toggle('previewing', on)
    document.body.classList.toggle('previewing', on)
    if (POD.cropLayer) POD.cropLayer.hidden = on || NT.state.mode !== 'crop'
    if (NT.Timeline && NT.Timeline.setPreview) NT.Timeline.setPreview(on)
    if (NT.Timeline && NT.Timeline.setPlaying) NT.Timeline.setPlaying(POD.playing)
    requestAnimationFrame(() => {
      layoutStage()
      if (NT.Timeline) NT.Timeline.refresh()
    })
  }

  function togglePreview(force) {
    const next = typeof force === 'boolean' ? force : !NT.state.previewMode
    if (next === Boolean(NT.state.previewMode)) return
    NT.setState({ previewMode: next })
    applyPreviewMode()
  }

  function stepFrame(dir) {
    const info = currentInfo()
    const fps = info && info.video ? info.video.fps : 30
    setPlayhead(NT.state.playhead + dir / Math.max(1, fps))
  }

  function seekTo(t) {
    setPlayhead(t)
  }

  function updatePlayheadFromVideo() {
    if (!POD.video) return
    if (POD.scrubbing) return
    const t = POD.video.currentTime
    NT.Timeline.setPlayhead(t)
    updateTimeNow(t)
    const now = Date.now()
    if (now - POD.lastPlayheadPush > 90) {
      POD.lastPlayheadPush = now
      NT.state.playhead = t
    }
    const s = NT.state
    if (POD.playing && NT.Timeline.isEditable() && t >= s.outPoint - 0.015) {
      if (s.loopPreview) {
        setPlayhead(s.inPoint)
      } else {
        POD.video.pause()
        setPlayhead(s.outPoint)
      }
    }
  }

  function startRaf() {
    if (POD.raf || POD.rvfc) return
    const engine = (NT.state.settings && NT.state.settings.engine) || 'litenx'
    if (engine === 'litenx' && POD.video && POD.video.requestVideoFrameCallback) {
      const tick = () => {
        if (!POD.playing) return
        updatePlayheadFromVideo()
        POD.rvfc = POD.video.requestVideoFrameCallback(tick)
      }
      POD.rvfc = POD.video.requestVideoFrameCallback(tick)
      return
    }
    const tick = () => {
      updatePlayheadFromVideo()
      POD.raf = requestAnimationFrame(tick)
    }
    POD.raf = requestAnimationFrame(tick)
  }

  function stopRaf() {
    if (POD.raf) cancelAnimationFrame(POD.raf)
    POD.raf = 0
    if (POD.rvfc && POD.video && POD.video.cancelVideoFrameCallback) {
      try {
        POD.video.cancelVideoFrameCallback(POD.rvfc)
      } catch {
        /* ignore */
      }
    }
    POD.rvfc = 0
  }

  function layoutStage() {
    if (!POD.stage || !POD.frame) return
    const info = currentInfo()
    const ar = info && info.video ? info.video.displayWidth / info.video.displayHeight : 16 / 9
    const maxW = Math.max(160, POD.stage.clientWidth - 32)
    const maxH = Math.max(90, POD.stage.clientHeight - 32)
    let w = maxW
    let h = w / ar
    if (h > maxH) {
      h = maxH
      w = h * ar
    }
    POD.frame.style.width = `${Math.max(160, Math.round(w))}px`
    POD.frame.style.height = `${Math.max(90, Math.round(h))}px`
  }

  function renderModeTabs() {
    if (!POD.modeTabs) return
    const tabs = [
      { key: 'trim', label: '裁剪' },
      { key: 'crop', label: '画面' }
    ]
    POD.modeTabs.innerHTML = tabs
      .map(
        (tab) =>
          `<button class="mode-tab${NT.state.mode === tab.key ? ' active' : ''}" data-mode="${
            tab.key
          }" type="button">${tab.label}</button>`
      )
      .join('')
  }

  function renderPanel() {
    NT.renderModePanel(POD.modePanel)
    wireMultiPanel()
  }

  function wireMultiPanel() {
    if (NT.state.mode !== 'multi' || !POD.modePanel) return
    const list = POD.modePanel.querySelector('.clip-list')
    if (!list) return
    const rows = Array.from(list.querySelectorAll('.clip-item'))
    if (!rows.length) return

    rows.forEach((row) => {
      let pressTimer = 0
      let startX = 0
      let startY = 0
      let dragging = false
      let finished = false
      let fromIndex = Number(row.dataset.index)
      let targetIndex = fromIndex
      let ghost = null
      let dropLine = null
      let listRect = null
      let rowRect = null
      let pointerOffset = 0

      const cleanupDrag = () => {
        clearTimeout(pressTimer)
        row.classList.remove('pressing', 'dragging')
        list.classList.remove('drag-active')
        if (ghost) ghost.remove()
        if (dropLine) dropLine.remove()
        ghost = null
        dropLine = null
        rows.forEach((r) => {
          if (r !== row) r.style.transform = ''
        })
      }

      const finish = () => {
        if (finished) return
        finished = true
        if (!dragging) {
          row.classList.remove('pressing')
          return
        }
        POD.suppressClipClick = true
        setTimeout(() => {
          POD.suppressClipClick = false
        }, 260)
        const oldTops = rows.map((r) => r.getBoundingClientRect().top)
        const from = fromIndex
        const to = targetIndex
        cleanupDrag()
        dragging = false
        if (from !== to) {
          reorderClips(from, to)
          const nextRows = Array.from(POD.modePanel.querySelectorAll('.clip-item'))
          nextRows.forEach((r) => {
            const j = Number(r.dataset.index)
            let oldIndex = j
            if (j === to) oldIndex = from
            else if (from < to && j >= from && j < to) oldIndex = j + 1
            else if (from > to && j > to && j <= from) oldIndex = j - 1
            const oldTop = oldTops[oldIndex]
            const newTop = r.getBoundingClientRect().top
            if (oldTop === undefined) return
            const delta = oldTop - newTop
            if (!delta) return
            r.style.transition = 'none'
            r.style.transform = `translateY(${delta}px)`
            requestAnimationFrame(() => {
              r.style.transition = 'transform 0.32s cubic-bezier(.22,.9,.28,1.08)'
              r.style.transform = ''
              setTimeout(() => {
                r.style.transition = ''
              }, 360)
            })
          })
        }
      }

      const onMove = (e) => {
        if (!dragging) {
          if (Math.abs(e.clientX - startX) > 6 || Math.abs(e.clientY - startY) > 6) {
            clearTimeout(pressTimer)
          }
          return
        }
        e.preventDefault()
        if (ghost) {
          ghost.style.top = `${e.clientY - pointerOffset}px`
        }
        const others = rows.filter((r) => r !== row)
        let insertAt = others.length
        for (let i = 0; i < others.length; i += 1) {
          const rect = others[i].getBoundingClientRect()
          if (e.clientY < rect.top + rect.height / 2) {
            insertAt = i
            break
          }
        }
        targetIndex = insertAt
        const rowH = rowRect.height + 3
        rows.forEach((r) => {
          if (r === row) return
          const i = Number(r.dataset.index)
          let shift = 0
          if (fromIndex < targetIndex && i > fromIndex && i <= targetIndex) shift = -rowH
          else if (fromIndex > targetIndex && i >= targetIndex && i < fromIndex) shift = rowH
          r.style.transform = shift ? `translateY(${shift}px)` : ''
        })
        if (dropLine) {
          const listTop = listRect.top
          let top
          if (targetIndex < others.length) {
            top = others[targetIndex].getBoundingClientRect().top - listTop - 2
          } else {
            const last = others[others.length - 1]
            top = last ? last.getBoundingClientRect().bottom - listTop + 1 : 0
          }
          dropLine.style.top = `${Math.max(0, top)}px`
        }
      }

      const onUp = () => finish()

      row.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || e.target.closest('button')) return
        finished = false
        dragging = false
        startX = e.clientX
        startY = e.clientY
        fromIndex = Number(row.dataset.index)
        targetIndex = fromIndex
        row.classList.add('pressing')
        pressTimer = setTimeout(() => {
          const r = row.getBoundingClientRect()
          listRect = list.getBoundingClientRect()
          rowRect = r
          pointerOffset = startY - r.top
          ghost = row.cloneNode(true)
          ghost.className = 'clip-drag-ghost'
          ghost.style.width = `${r.width}px`
          ghost.style.height = `${r.height}px`
          ghost.style.left = `${r.left}px`
          ghost.style.top = `${r.top}px`
          document.body.appendChild(ghost)
          dropLine = document.createElement('div')
          dropLine.className = 'clip-drop-line'
          list.appendChild(dropLine)
          dragging = true
          row.classList.remove('pressing')
          row.classList.add('dragging')
          list.classList.add('drag-active')
          try {
            row.setPointerCapture(e.pointerId)
          } catch {
            /* pointer already released */
          }
        }, 240)
      })
      row.addEventListener('pointermove', onMove)
      row.addEventListener('pointerup', onUp)
      row.addEventListener('pointercancel', () => {
        finished = true
        cleanupDrag()
      })
      row.addEventListener('click', (e) => {
        if (POD.suppressClipClick) {
          e.preventDefault()
          e.stopPropagation()
        }
      }, true)
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          void selectClip(Number(row.dataset.index))
        }
      })
    })
  }

  function splitIsEmpty() {
    const s = NT.state
    return s.mode === 'split' && !s.splitPoints.length
  }

  function multiIsEmpty() {
    const s = NT.state
    return s.mode === 'multi' && !s.multiClips.length
  }

  function exportBlockReason() {
    if (!NT.state.ffmpeg || !NT.state.ffmpeg.connected) return '需要连接 FFmpeg 才能导出'
    if (splitIsEmpty()) return '至少添加 1 个分割点'
    if (multiIsEmpty()) return '至少添加 1 段视频'
    return ''
  }

  function updateExportBar() {
    const s = NT.state
    const estimateEl = document.getElementById('tb-estimate')
    if (estimateEl) {
      const bytes = s.estimate ? fmt.splitBytes(s.estimate.bytes) : null
      estimateEl.textContent = bytes ? `≈ ${bytes.value} ${bytes.unit}` : s.estimating ? '估算中…' : '≈ —'
      estimateEl.classList.toggle('busy', Boolean(s.estimating))
    }
    const btn = document.getElementById('tb-export')
    if (btn) {
      const connected = Boolean(s.ffmpeg && s.ffmpeg.connected)
      btn.innerHTML = `${icon(connected ? 'download' : 'link', 14)} ${connected ? '导出' : '连接 FFmpeg'}`
      btn.disabled = !project()
    }
  }

  function compactPath(value) {
    if (!value) return '—'
    const text = String(value)
    if (text.length <= 48) return text
    const parts = text.split(/[\\/]+/).filter(Boolean)
    if (parts.length <= 2) return text
    const head = /^[A-Za-z]:/.test(text) ? `${parts[0]}\\` : ''
    return `${head}…\\${parts.slice(-2).join('\\')}`
  }

  function exportSettingsHtml() {
    const s = NT.state
    const fmtKey = effectiveFormat()
    const isVideoOutput = fmtKey === 'copy' || fmtKey === 'h264'
    const out = computedOutput()
    const cropped = cropChanged()
    const usingDefaultDir = !s.outputPath && Boolean(defaultExportDir())
    const canReplace =
      (s.mode === 'trim' || s.mode === 'crop') &&
      isVideoOutput &&
      !s.outputPath &&
      !defaultExportDir()
    const qualityOptions = [
      { key: 'high', label: '高质量' },
      { key: 'balanced', label: '平衡' },
      { key: 'small', label: '小体积' }
    ]
    const formatOptions = cropped
      ? [
          { key: 'h264', label: 'H.264' },
          { key: 'gif', label: 'GIF' },
          { key: 'audio', label: '仅音频' }
        ]
      : [
          { key: 'copy', label: '原编码' },
          { key: 'h264', label: 'H.264' },
          { key: 'gif', label: 'GIF' },
          { key: 'audio', label: '仅音频' }
        ]

    const est = s.estimate
    const bytes = est ? fmt.splitBytes(est.bytes) : null
    const streamRow = isVideoOutput
      ? `<div class="row" style="min-height:32px;padding:4px 0;border:0">
          <span class="row-label">保留轨道</span>
          <span style="display:flex;gap:10px;align-items:center">
            ${
              cropped
                ? `<span class="row-value">视频</span>`
                : `<button class="chip-btn" data-act="toggle-video" style="border-color:${
                    s.includeVideo ? '#000' : 'var(--line)'
                  };color:${s.includeVideo ? '#000' : 'var(--text-3)'}">视频</button>`
            }
            <button class="chip-btn" data-act="toggle-audio" ${
              !currentInfo().hasAudio ? 'disabled' : ''
            } style="border-color:${s.includeAudio ? '#000' : 'var(--line)'};color:${
              s.includeAudio ? '#000' : 'var(--text-3)'
            }">音频</button>
          </span>
        </div>`
      : ''

    const qualityRow =
      fmtKey === 'h264'
        ? `<div class="row" style="min-height:32px;padding:4px 0;border:0">
            <span class="row-label">画质</span>
            <div class="seg" style="width:180px">
              ${qualityOptions
                .map(
                  (q) =>
                    `<button class="${s.quality === q.key ? 'active' : ''}" data-act="quality" data-value="${q.key}" type="button">${q.label}</button>`
                )
                .join('')}
            </div>
          </div>`
        : ''

    const audioRow =
      fmtKey === 'audio'
        ? `<div class="export-subrow">
            <span class="export-subrow-label">音频格式</span>
            <div class="seg" style="width:260px">
              <button class="${s.audioFormat === 'm4a' ? 'active' : ''}" data-act="audio-format" data-value="m4a" type="button">M4A</button>
              <button class="${s.audioFormat === 'mp3' ? 'active' : ''}" data-act="audio-format" data-value="mp3" type="button">MP3</button>
              <button class="${s.audioFormat === 'wav' ? 'active' : ''}" data-act="audio-format" data-value="wav" type="button">WAV</button>
              <button class="${s.audioFormat === 'flac' ? 'active' : ''}" data-act="audio-format" data-value="flac" type="button">FLAC</button>
            </div>
          </div>`
        : ''

    const gifOptions =
      fmtKey === 'gif'
        ? `<div class="export-gif-options">
            <div class="export-subrow">
              <span class="export-subrow-label">帧率</span>
              <div class="seg" style="width:190px">
                ${[10, 15, 20, 24]
                  .map(
                    (v) =>
                      `<button class="${s.gif.fps === v ? 'active' : ''}" data-act="gif-fps" data-value="${v}" type="button">${v}</button>`
                  )
                  .join('')}
              </div>
            </div>
            <div class="export-subrow">
              <span class="export-subrow-label">宽度</span>
              <div class="seg" style="width:150px">
                ${[320, 480, 640]
                  .map(
                    (v) =>
                      `<button class="${s.gif.width === v ? 'active' : ''}" data-act="gif-width" data-value="${v}" type="button">${v}</button>`
                  )
                  .join('')}
              </div>
            </div>
            <div class="export-subrow">
              <span class="export-subrow-label">颜色</span>
              <div class="seg" style="width:150px">
                ${[64, 128, 256]
                  .map(
                    (v) =>
                      `<button class="${s.gif.colors === v ? 'active' : ''}" data-act="gif-colors" data-value="${v}" type="button">${v}</button>`
                  )
                  .join('')}
              </div>
            </div>
            <div class="export-subrow">
              <span class="export-subrow-label">循环播放</span>
              <button class="switch${s.gif.loop ? ' on' : ''}" data-act="gif-loop" aria-label="循环播放" type="button"></button>
            </div>
          </div>`
        : ''

    return `<div class="seg dark export-format-seg">
        ${formatOptions
          .map(
            (opt) =>
              `<button class="${fmtKey === opt.key ? 'active' : ''}" data-act="format" data-value="${opt.key}" type="button">${opt.label}</button>`
          )
          .join('')}
      </div>
      ${audioRow}
      ${gifOptions}
      ${streamRow}
      ${qualityRow}
      <div class="estimate">
        <div class="estimate-main">
          <div class="estimate-value" id="estimate-value">${
            bytes ? `${bytes.value}<span class="unit">${bytes.unit}</span>` : '—'
          }</div>
          <div class="estimate-note" id="estimate-note">${
            s.estimating ? '正在估算…' : est ? est.note : '等待估算'
          }</div>
        </div>
        ${s.estimating ? '<div class="estimate-spinner"></div>' : ''}
      </div>
      <div class="output-row">
        <span class="output-name" title="${fmt.escapeHtml(out ? out.path : '')}">${
          out ? fmt.escapeHtml(out.name) : '—'
        }</span>
        <button class="output-folder" data-act="choose-output" title="更改导出位置" type="button">${icon(
          'folder',
          12
        )}</button>
      </div>
      <div class="output-path-row" title="${fmt.escapeHtml(out ? out.dir : '')}">
        <span class="output-path-label">位置${usingDefaultDir ? ' · 默认' : ''}</span>
        <span class="output-path" dir="ltr">${fmt.escapeHtml(compactPath(out ? out.dir : ''))}</span>
      </div>
      ${
        canReplace
          ? `<div class="replace-row">
              <span class="replace-copy">
                <strong>替换原视频</strong>
                <span>原文件移入回收站</span>
              </span>
              <button class="switch${s.replaceOriginal ? ' on' : ''}" data-act="toggle-replace" aria-label="替换原视频" type="button"></button>
            </div>`
          : ''
      }
      ${
        currentInfo().video &&
        currentInfo().video.isHDR &&
        fmtKey === 'h264'
          ? `<div class="export-warning">HDR 源转为 H.264 会丢失 HDR / 10bit 色彩</div>`
          : ''
      }
      ${
        cropped && fmtKey === 'h264'
          ? `<div class="export-hint">画面已裁剪，视频会自动使用 H.264；GIF 导出同样会应用画面裁剪。</div>`
          : ''
      }`
  }

  function renderExportCard() {
    updateExportBar()
    if (POD.exportSettings) {
      POD.exportSettings.innerHTML = `<div class="export-card">${exportSettingsHtml()}</div>`
    }
    const note = document.getElementById('export-footer-note')
    const start = document.getElementById('export-start')
    const reason = exportBlockReason()
    if (note) note.textContent = reason || '原编码最快；H.264 更精确，文件通常更小。'
    if (start) {
      start.disabled = Boolean(reason)
      start.textContent = reason ? '暂不可导出' : '开始导出'
    }
  }

  function openExportSettings() {
    if (!project()) return
    if (!NT.state.ffmpeg || !NT.state.ffmpeg.connected) {
      NT.openFfmpegSetup()
      return
    }
    let modalRef = null
    modalRef = openModal(
      `<div class="export-dialog-head">
        <div>
          <h2>导出</h2>
          <p>确认格式、轨道与保存位置</p>
        </div>
        <button class="modal-close" data-modal-close type="button">${icon('x', 15)}</button>
      </div>
      <div class="export-settings" id="export-settings"></div>
      <div class="export-settings-footer">
        <span class="footer-note" id="export-footer-note"></span>
        <span class="footer-actions">
          <button class="btn btn-ghost" data-modal-close type="button">取消</button>
          <button class="btn btn-primary" id="export-start" data-act="export-now" type="button">开始导出</button>
        </span>
      </div>`,
      {
        className: 'export-settings-modal',
        closable: true,
        onClose: () => {
          POD.exportSettings = null
        }
      }
    )
    POD.exportSettings = document.getElementById('export-settings')
    renderExportCard()

    modalRef.modal.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]')
      if (!btn) return
      if (btn.dataset.act === 'export-now') {
        if (btn.disabled) return
        const spec = buildSpec()
        const problem = validateSpec(spec)
        if (problem) {
          toast(problem, 'error')
          return
        }
        POD.exportSettings = null
        modalRef.close(true)
        void startExport()
        return
      }
      handlePanelAction(btn.dataset.act, btn.dataset.value, btn.dataset.index, btn)
    })
  }

  function updateEstimateDom() {
    const s = NT.state
    updateExportBar()
    const valueEl = $('#estimate-value')
    const noteEl = $('#estimate-note')
    if (valueEl && noteEl) {
      if (s.estimate) {
        const bytes = fmt.splitBytes(s.estimate.bytes)
        valueEl.innerHTML = `${bytes.value}<span class="unit">${bytes.unit}</span>`
        noteEl.textContent = s.estimating ? '正在重新估算…' : s.estimate.note
      } else {
        valueEl.textContent = '—'
        noteEl.textContent = s.estimating ? '正在估算…' : '等待估算'
      }
    }
    const estimate = $('.estimate')
    if (estimate) {
      let spinner = estimate.querySelector('.estimate-spinner')
      if (s.estimating && !spinner) {
        spinner = document.createElement('div')
        spinner.className = 'estimate-spinner'
        estimate.appendChild(spinner)
      } else if (!s.estimating && spinner) {
        spinner.remove()
      }
    }
  }

  function estimateRequest() {
    const s = NT.state
    const inc = effectiveIncludes()
    const fmtKey = effectiveFormat()
    const sources = effectiveSources()
    const req = {
      sources,
      format: fmtKey,
      includeVideo: inc.video,
      includeAudio: inc.audio,
      quality: s.quality,
      audioFormat: s.audioFormat
    }
    if (cropChanged()) req.crop = s.crop
    if (fmtKey === 'gif') req.gif = s.gif
    return req
  }

  function scheduleEstimate(delay) {
    NT.state.estimateToken += 1
    clearTimeout(POD.estimateTimer)
    POD.estimateTimer = setTimeout(() => {
      void runEstimate()
    }, delay === undefined ? 260 : delay)
  }

  async function runEstimate() {
    if (!project()) return
    const s = NT.state
    const token = ++s.estimateToken
    NT.setState({ estimating: true })
    updateEstimateDom()
    try {
      const req = estimateRequest()
      if (!req.sources.length || !req.sources[0].path) throw new Error('没有可估算的片段')
      if (req.sources.some((src) => src.out <= src.in)) throw new Error('选区为空')
      const result = await NT.api.call('media:estimate', req)
      if (token !== NT.state.estimateToken) return
      NT.setState({ estimate: result, estimating: false })
      updateEstimateDom()
    } catch (err) {
      if (token !== NT.state.estimateToken) return
      NT.setState({ estimate: null, estimating: false })
      updateEstimateDom()
    }
  }

  function renderCropLayer(rebuild) {
    const s = NT.state
    if (!POD.cropLayer) return
    if (s.mode !== 'crop' || !hasVideo() || !s.crop || s.previewMode) {
      POD.cropLayer.hidden = true
      POD.cropLayer.innerHTML = ''
      POD.cropLayer.dataset.ready = ''
      return
    }
    POD.cropLayer.hidden = false
    if (rebuild || !POD.cropLayer.dataset.ready) {
      POD.cropLayer.innerHTML = `<div class="crop-rect" id="crop-rect">
          <span class="crop-handle" data-handle="nw"></span>
          <span class="crop-handle" data-handle="n"></span>
          <span class="crop-handle" data-handle="ne"></span>
          <span class="crop-handle" data-handle="e"></span>
          <span class="crop-handle" data-handle="se"></span>
          <span class="crop-handle" data-handle="s"></span>
          <span class="crop-handle" data-handle="sw"></span>
          <span class="crop-handle" data-handle="w"></span>
        </div>
        <div class="crop-badge" id="crop-badge">0 × 0</div>
        <div class="crop-toolbar">
          ${[
            ['free', '自由'],
            ['1:1', '1:1'],
            ['16:9', '16:9'],
            ['9:16', '9:16'],
            ['4:3', '4:3']
          ]
            .map(
              ([key, label]) =>
                `<button data-act="crop-aspect" data-value="${key}" class="${
                  (s.cropAspect || 'free') === key ? 'active' : ''
                }" type="button">${label}</button>`
            )
            .join('')}
        </div>`
      POD.cropLayer.dataset.ready = '1'
    }
    updateCropDom()
  }

  function updateCropDom() {
    const s = NT.state
    const info = currentInfo()
    if (!POD.cropLayer || !info || !info.video || !s.crop) return
    const W = info.video.displayWidth
    const H = info.video.displayHeight
    const rect = $('#crop-rect')
    if (!rect) return
    const c = s.crop
    rect.style.left = `${(c.x / W) * 100}%`
    rect.style.top = `${(c.y / H) * 100}%`
    rect.style.width = `${(c.width / W) * 100}%`
    rect.style.height = `${(c.height / H) * 100}%`
    const badge = $('#crop-badge')
    if (badge) badge.textContent = `${Math.round(c.width)} × ${Math.round(c.height)}`
    const label = $('#crop-size-label')
    if (label) label.textContent = `${Math.round(c.width)} × ${Math.round(c.height)}`
    const cw = $('#crop-w')
    const ch = $('#crop-h')
    if (cw) cw.value = String(Math.round(c.width))
    if (ch) ch.value = String(Math.round(c.height))
  }

  function ratioValue() {
    const a = NT.state.cropAspect
    if (!a || a === 'free') return null
    const [w, h] = a.split(':').map(Number)
    return w && h ? w / h : null
  }

  function clampCrop(rect, W, H) {
    const min = 16
    let width = Math.max(min, Math.min(W, rect.width))
    let height = Math.max(min, Math.min(H, rect.height))
    let x = Math.max(0, Math.min(W - width, rect.x))
    let y = Math.max(0, Math.min(H - height, rect.y))
    return { x, y, width, height }
  }

  function applyAspect(aspect) {
    const info = currentInfo()
    if (!info || !info.video) return
    const W = info.video.displayWidth
    const H = info.video.displayHeight
    NT.setState({ cropAspect: aspect, estimate: null })
    if (aspect === 'free') {
      updateCropDom()
      renderCropLayer(true)
      renderPanel()
      scheduleEstimate()
      return
    }
    const ratio = ratioValue()
    let width = W
    let height = width / ratio
    if (height > H) {
      height = H
      width = height * ratio
    }
    const crop = clampCrop(
      { x: (W - width) / 2, y: (H - height) / 2, width, height },
      W,
      H
    )
    NT.setState({ crop, estimate: null })
    renderCropLayer(true)
    renderPanel()
    scheduleEstimate()
  }

  function resetCrop() {
    const info = currentInfo()
    if (!info || !info.video) return
    NT.setState({
      crop: {
        x: 0,
        y: 0,
        width: info.video.displayWidth,
        height: info.video.displayHeight
      },
      cropAspect: null,
      estimate: null
    })
    renderCropLayer(true)
    renderPanel()
    scheduleEstimate()
  }

  function cropPointerDown(e) {
    if (NT.state.mode !== 'crop' || !hasVideo()) return
    if (e.button !== 0) return
    if (e.target.closest('.crop-toolbar')) return
    const rect = e.target.closest('#crop-rect')
    if (!rect) return
    const handle = e.target.closest('[data-handle]')
    const info = currentInfo()
    const layerRect = POD.cropLayer.getBoundingClientRect()
    if (!layerRect.width || !layerRect.height) return
    if (NT.History) NT.History.begin('调整画面')
    POD.cropDrag = {
      handle: handle ? handle.dataset.handle : 'move',
      startX: e.clientX,
      startY: e.clientY,
      start: { ...NT.state.crop },
      W: info.video.displayWidth,
      H: info.video.displayHeight,
      layerW: layerRect.width,
      layerH: layerRect.height
    }
    POD.cropLayer.setPointerCapture?.(e.pointerId)
    e.preventDefault()
    e.stopPropagation()
  }

  function cropPointerMove(e) {
    const drag = POD.cropDrag
    if (!drag) return
    const dx = ((e.clientX - drag.startX) / drag.layerW) * drag.W
    const dy = ((e.clientY - drag.startY) / drag.layerH) * drag.H
    const ratio = ratioValue()
    const W = drag.W
    const H = drag.H
    const start = drag.start
    let next = { ...start }

    if (drag.handle === 'move') {
      next.x = fmt.clamp(start.x + dx, 0, W - start.width)
      next.y = fmt.clamp(start.y + dy, 0, H - start.height)
    } else {
      let left = start.x
      let top = start.y
      let right = start.x + start.width
      let bottom = start.y + start.height
      if (drag.handle.includes('w')) left = Math.min(right - 16, start.x + dx)
      if (drag.handle.includes('e')) right = Math.max(left + 16, start.x + start.width + dx)
      if (drag.handle.includes('n')) top = Math.min(bottom - 16, start.y + dy)
      if (drag.handle.includes('s')) bottom = Math.max(top + 16, start.y + start.height + dy)
      left = fmt.clamp(left, 0, W - 16)
      top = fmt.clamp(top, 0, H - 16)
      right = fmt.clamp(right, left + 16, W)
      bottom = fmt.clamp(bottom, top + 16, H)
      next = { x: left, y: top, width: right - left, height: bottom - top }

      if (ratio) {
        next = resizeWithRatio(next, drag.handle, start, ratio, W, H)
      }
    }
    next = clampCrop(next, W, H)
    NT.state.crop = next
    updateCropDom()
    if (NT.state.estimate) updateEstimateDom()
    scheduleEstimate(200)
  }

  function resizeWithRatio(rect, handle, start, ratio, W, H) {
    const cx = start.x + start.width / 2
    const cy = start.y + start.height / 2
    let width = rect.width
    let height = rect.height

    if (handle === 'e' || handle === 'w') {
      height = width / ratio
    } else if (handle === 'n' || handle === 's') {
      width = height * ratio
    } else {
      if (width / height > ratio) width = height * ratio
      else height = width / ratio
    }

    if (width > W) {
      width = W
      height = width / ratio
    }
    if (height > H) {
      height = H
      width = height * ratio
    }

    let x
    let y
    if (handle === 'move') {
      x = rect.x
      y = rect.y
    } else {
      if (handle.includes('w')) x = start.x + start.width - width
      else if (handle.includes('e')) x = start.x
      else x = cx - width / 2
      if (handle.includes('n')) y = start.y + start.height - height
      else if (handle.includes('s')) y = start.y
      else y = cy - height / 2
    }
    x = fmt.clamp(x, 0, W - width)
    y = fmt.clamp(y, 0, H - height)
    return { x, y, width, height }
  }

  function cropPointerUp() {
    if (!POD.cropDrag) return
    POD.cropDrag = null
    if (NT.History) NT.History.end(true)
    renderPanel()
    scheduleEstimate(120)
  }

  function onSelectionChange(opts) {
    const s = NT.state
    if (opts && typeof opts.seekTo === 'number') {
      setPlayhead(opts.seekTo)
    }
    const inInput = $('#trim-in')
    const outInput = $('#trim-out')
    if (inInput) inInput.value = fmt.formatClock(s.inPoint, 3)
    if (outInput) outInput.value = fmt.formatClock(s.outPoint, 3)
    const summary = $('.selection-summary .big')
    if (summary) summary.textContent = fmt.formatClock(s.outPoint - s.inPoint, 2)
    const summaryRange = $('.selection-summary .mono')
    if (summaryRange)
      summaryRange.textContent = `${fmt.formatClock(s.inPoint, 2)} → ${fmt.formatClock(s.outPoint, 2)}`
    NT.Timeline.refresh()
    scheduleEstimate()
  }

  function commitSelection() {
    renderPanel()
    scheduleEstimate(80)
  }

  function setInPoint(t) {
    const s = NT.state
    let next = fmt.clamp(t, 0, duration() - 0.05)
    next = Math.min(next, s.outPoint - 0.05)
    NT.setState({ inPoint: next })
    setPlayhead(next, { snap: false })
    NT.Timeline.refresh()
    onSelectionChange()
    renderPanel()
    scheduleEstimate(100)
  }

  function setOutPoint(t) {
    const s = NT.state
    const next = fmt.clamp(t, s.inPoint + 0.05, duration())
    NT.setState({ outPoint: next })
    setPlayhead(next, { snap: false })
    NT.Timeline.refresh()
    onSelectionChange()
    renderPanel()
    scheduleEstimate(100)
  }

  function addSplit(t) {
    if (NT.state.mode !== 'split') toggleMode('split')
    const s = NT.state
    const d = duration()
    const point = fmt.clamp(t, 0.05, d - 0.05)
    if (s.splitPoints.some((p) => Math.abs(p - point) < 0.05)) {
      toast('这个位置已经有一个分割点')
      return
    }
    const points = [...s.splitPoints, point].sort((a, b) => a - b)
    NT.setState({ splitPoints: points, mode: 'split' })
    renderModeTabs()
    renderPanel()
    renderExportCard()
    NT.Timeline.refresh()
    scheduleEstimate(100)
  }
  function removeSplit(index) {
    const points = [...NT.state.splitPoints]
    points.splice(index, 1)
    NT.setState({ splitPoints: points })
    renderPanel()
    renderExportCard()
    NT.Timeline.refresh()
    scheduleEstimate(100)
  }

  function toggleMode(mode) {
    const s = NT.state
    if (mode === s.mode) return
    if (mode === 'crop' && !hasVideo()) {
      toast('该工具需要视频文件')
      return
    }
    NT.setState({ mode, outputPath: null, estimate: null })
    renderModeTabs()
    renderPanel()
    renderExportCard()
    NT.Timeline.refresh()
    renderCropLayer(true)
    if (POD.modePanel) POD.modePanel.scrollTop = 0
    scheduleEstimate(100)
  }

  function handlePanelAction(action, value, index, target) {
    const s = NT.state
    if (action === 'set-in') setInPoint(s.playhead)
    else if (action === 'set-out') setOutPoint(s.playhead)
    else if (action === 'select-clip') {
      void selectClip(Number(index))
    } else if (action === 'toggle-snap') {
      NT.setState({ autoSnap: !s.autoSnap })
      renderPanel()
    } else if (action === 'add-clips') {
      if (NT.openMultiDialog) NT.openMultiDialog()
    } else if (action === 'clip-up' || action === 'clip-down') {
      const i = Number(index)
      const j = action === 'clip-up' ? i - 1 : i + 1
      const clips = [...s.multiClips]
      if (j >= 0 && j < clips.length) {
        ;[clips[i], clips[j]] = [clips[j], clips[i]]
        NT.setState({ multiClips: clips })
        renderPanel()
        renderExportCard()
        scheduleEstimate(120)
      }
    } else if (action === 'remove-clip') {
      const removedIndex = Number(index)
      const clips = s.multiClips.filter((_, i) => i !== removedIndex)
      const nextActive =
        removedIndex === (s.activeClip || 0)
          ? Math.max(0, Math.min(removedIndex, clips.length - 1))
          : Math.min(s.activeClip || 0, Math.max(0, clips.length - 1))
      NT.setState({ multiClips: clips, activeClip: nextActive, estimate: null })
      if (removedIndex === (s.activeClip || 0) && clips[nextActive]) {
        void selectClip(nextActive)
      } else {
        renderPanel()
        renderExportCard()
        NT.Timeline.refresh()
        scheduleEstimate(120)
      }
    } else if (action === 'add-split') {
      addSplit(s.playhead)
    } else if (action === 'remove-split') {
      removeSplit(Number(index))
    } else if (action === 'clear-splits') {
      NT.setState({ splitPoints: [] })
      renderPanel()
      renderExportCard()
      NT.Timeline.refresh()
      scheduleEstimate(100)
    } else if (action === 'crop-aspect') {
      applyAspect(value)
    } else if (action === 'crop-reset') {
      resetCrop()
    } else if (action === 'audio-action') {
      const patch = { audioAction: value, outputPath: null, estimate: null }
      if (value === 'remove') {
        patch.format = s.format === 'h264' ? 'h264' : 'copy'
        patch.includeVideo = true
        patch.includeAudio = false
      } else {
        patch.format = 'audio'
        patch.includeVideo = true
        patch.includeAudio = true
      }
      NT.setState(patch)
      renderPanel()
      renderExportCard()
      NT.Timeline.refresh()
      scheduleEstimate(100)
    } else if (action === 'audio-format') {
      NT.setState({ audioFormat: value, outputPath: null, estimate: null })
      renderPanel()
      renderExportCard()
      scheduleEstimate(100)
    } else if (action === 'gif-fps') {
      NT.setState({ gif: { ...s.gif, fps: Number(value) }, estimate: null })
      renderPanel()
      renderExportCard()
      scheduleEstimate(100)
    } else if (action === 'gif-width') {
      NT.setState({ gif: { ...s.gif, width: Number(value) }, estimate: null })
      renderPanel()
      renderExportCard()
      scheduleEstimate(100)
    } else if (action === 'gif-colors') {
      NT.setState({ gif: { ...s.gif, colors: Number(value) }, estimate: null })
      renderPanel()
      renderExportCard()
      scheduleEstimate(100)
    } else if (action === 'gif-loop') {
      NT.setState({ gif: { ...s.gif, loop: !s.gif.loop } })
      renderPanel()
      renderExportCard()
    } else if (action === 'format') {
      NT.setState({ format: value, outputPath: null, estimate: null })
      renderExportCard()
      renderPanel()
      scheduleEstimate(100)
    } else if (action === 'quality') {
      NT.setState({ quality: value, estimate: null })
      renderExportCard()
      scheduleEstimate(100)
    } else if (action === 'toggle-video') {
      if (s.mode === 'multi' || s.mode === 'split') {
        toast('该模式需要保留视频轨道')
        return
      }
      if (!s.includeAudio && s.includeVideo) {
        toast('视频和音频至少保留一项')
        return
      }
      NT.setState({ includeVideo: !s.includeVideo, estimate: null })
      renderExportCard()
      scheduleEstimate(100)
    } else if (action === 'toggle-audio') {
      if (!currentInfo().hasAudio) return
      if (!s.includeVideo && s.includeAudio) {
        toast('视频和音频至少保留一项')
        return
      }
      NT.setState({ includeAudio: !s.includeAudio, estimate: null })
      renderExportCard()
      scheduleEstimate(100)
    } else if (action === 'toggle-replace') {
      NT.setState({ replaceOriginal: !s.replaceOriginal })
      renderExportCard()
    } else if (action === 'choose-output') {
      void chooseOutput()
    } else if (action === 'export') {
      if (!NT.state.ffmpeg || !NT.state.ffmpeg.connected) {
        if (NT.openFfmpegSetup) NT.openFfmpegSetup()
        return
      }
      void startExport()
    } else if (action === 'make-proxy') {
      void makeProxy()
    } else if (action === 'toggle-loop') {
      NT.setState({ loopPreview: !s.loopPreview })
      updateLoopChip()
    } else if (action === 'toggle-play') {
      togglePlay()
    } else if (action === 'seek-back') {
      setPlayhead(s.playhead - 1)
    } else if (action === 'seek-fwd') {
      setPlayhead(s.playhead + 1)
    } else if (action === 'mute') {
      if (!POD.video) return
      POD.video.muted = !POD.video.muted
      updateVolumeIcon()
    } else if (action === 'retry-video') {
      reloadVideo()
    }
  }

  function updateLoopChip() {
    if (!POD.loopChip) return
    POD.loopChip.classList.toggle('on', NT.state.loopPreview)
  }

  function updateVolumeIcon() {
    const muteBtn = $('[data-act="mute"]')
    if (muteBtn) muteBtn.innerHTML = icon(POD.video && POD.video.muted ? 'volumeX' : 'volume', 17)
  }

  function setVideoVisible(visible) {
    if (!POD.video) return
    POD.video.style.opacity = visible ? '' : '0'
  }

  function setAudioMuted(muted) {
    if (!POD.video) return
    POD.video.muted = Boolean(muted)
    updateVolumeIcon()
  }

  async function chooseOutput() {
    const out = computedOutput()
    if (!out) return
    try {
      const filePath = await NT.api.call('dialog:save-output', {
        defaultPath: out.path,
        ext: out.ext
      })
      if (filePath) {
        NT.setState({ outputPath: filePath })
        renderExportCard()
        scheduleEstimate(80)
      }
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  function buildSpec() {
    const s = NT.state
    const inc = effectiveIncludes()
    const fmtKey = effectiveFormat()
    const sources = effectiveSources()
    const out = computedOutput()
    const kind =
      fmtKey === 'gif'
        ? 'gif'
        : fmtKey === 'audio'
          ? 'audio'
          : s.mode === 'crop' && cropChanged()
            ? 'crop'
            : 'trim'
    const spec = {
      kind,
      sources,
      outputDir: out ? out.dir : '',
      baseName: outputBaseName(),
      outputPath: s.outputPath || undefined,
      includeVideo: inc.video,
      includeAudio: inc.audio,
      format: fmtKey,
      quality: s.quality,
      encoder: s.settings && s.settings.encoder ? s.settings.encoder : 'auto',
      engine: (s.settings && s.settings.engine) || 'litenx',
      audioFormat: s.audioFormat,
      audioAction: fmtKey === 'audio' ? 'extract' : s.audioAction,
      faststart: !s.settings || s.settings.faststart !== false,
      replaceOriginal:
        Boolean(s.replaceOriginal) &&
        (kind === 'trim' || kind === 'crop') &&
        !s.outputPath
    }
    if (cropChanged()) spec.crop = s.crop
    if (fmtKey === 'gif') spec.gif = s.gif
    return spec
  }

  function validateSpec(spec) {
    const s = NT.state
    if (!project()) return '没有打开文件'
    if (!spec.sources.length) return '没有可导出的片段'
    if (spec.sources.some((src) => !src.path || src.out - src.in < 0.02)) return '选区太短'
    if (!spec.includeVideo && !spec.includeAudio) return '视频和音频至少保留一项'
    if ((spec.crop || spec.format === 'gif') && !currentInfo().hasVideo) {
      return '此文件没有视频轨道'
    }
    if (spec.format === 'audio' && !currentInfo().hasAudio) return '此文件没有音频轨道'
    if (!NT.state.ffmpeg || !NT.state.ffmpeg.connected) return 'FFmpeg 尚未连接'
    return null
  }

  async function startExport() {
    const spec = buildSpec()
    const problem = validateSpec(spec)
    if (problem) {
      toast(problem, 'error')
      return
    }
    if (spec.replaceOriginal) {
      const ok = await confirmDialog({
        title: '替换原视频？',
        message: `导出完成后，<b>${fmt.escapeHtml(
          project().info.name
        )}</b> 会被移入回收站，新文件使用原文件名。此操作可以在回收站中撤销。`,
        confirmText: '替换原视频',
        icon: 'alert'
      })
      if (!ok) return
    }
    try {
      const res = await NT.api.call('export:start', spec)
      if (NT.openExportModal) {
        NT.openExportModal(res.jobId, spec, {
          onDone: (result) => {
            if (spec.replaceOriginal) {
              if (NT.goHome) NT.goHome()
              toast('已替换原视频，原文件在回收站')
            } else {
              if (spec.sources[0] && NT.refreshRecent) NT.refreshRecent()
            }
            void result
          }
        })
      }
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  function showPreviewStatus(text, options = {}) {
    if (!POD.previewStatus) return
    POD.previewStatus.hidden = false
    POD.previewStatus.classList.toggle('is-error', Boolean(options.error))
    POD.previewStatus.classList.toggle('is-done', Boolean(options.done))
    if (POD.previewStatusText) POD.previewStatusText.textContent = text
    if (POD.previewStatusFill) {
      POD.previewStatusFill.style.width = `${Math.round(
        Math.max(0, Math.min(1, Number(options.progress) || 0)) * 100
      )}%`
    }
    if (POD.previewStatusPercent) {
      POD.previewStatusPercent.textContent =
        options.busy && options.progress > 0 ? `${Math.round(options.progress * 100)}%` : ''
    }
    if (POD.previewRetry) POD.previewRetry.hidden = !options.retry
  }

  function hidePreviewStatus() {
    if (POD.previewStatus) POD.previewStatus.hidden = true
  }

  function captureFrame() {
    const video = POD.video
    if (!video || video.readyState < 2 || !video.videoWidth) return false
    let canvas = POD.stillCanvas
    if (!canvas) {
      canvas = document.createElement('canvas')
      POD.stillCanvas = canvas
    }
    const width = Math.min(960, video.videoWidth)
    const height = Math.round((video.videoHeight / video.videoWidth) * width)
    if (!width || !height) return false
    canvas.width = width
    canvas.height = height
    try {
      const ctx = canvas.getContext('2d')
      ctx.drawImage(video, 0, 0, width, height)
      return true
    } catch {
      return false
    }
  }

  function showStill() {
    if (!POD.still) return
    if (captureFrame() && POD.stillCanvas) {
      try {
        POD.still.src = POD.stillCanvas.toDataURL('image/jpeg', 0.84)
        POD.still.hidden = false
        return
      } catch {
        /* fall through to thumbnail */
      }
    }
    const thumb = project() && project().thumbs && project().thumbs[0]
    if (thumb && thumb.url) {
      POD.still.src = thumb.url
      POD.still.hidden = false
    }
  }

  function hideStill() {
    if (POD.still) POD.still.hidden = true
  }

  function switchToProxy() {
    if (!project() || !project().proxyUrl) return
    const proxyUrl = project().proxyUrl
    if (POD.video.src === proxyUrl) return
    const time = Number(POD.video.currentTime) || Number(NT.state.playhead) || 0
    const wasPlaying = !POD.video.paused
    hideStill()
    hidePreviewStatus()
    POD.video.src = proxyUrl
    POD.video.load()
    const onReady = () => {
      POD.video.removeEventListener('loadedmetadata', onReady)
      try {
        POD.video.currentTime = Math.min(time, POD.video.duration || time)
      } catch {
        /* ignore */
      }
      if (wasPlaying) POD.video.play().catch(() => {})
      hideStill()
      hidePreviewStatus()
      updateTransportDuration()
    }
    POD.video.addEventListener('loadedmetadata', onReady)
  }

  async function ensureProxy(options = {}) {
    if (!project() || !currentInfo() || !currentInfo().hasVideo) return null
    if (project().proxyUrl) {
      if (project().previewError) switchToProxy()
      return project().proxyUrl
    }
    if (POD.proxyPromise) return POD.proxyPromise
    const sourcePath = project().info.path
    POD.proxyBusy = true
    POD.proxyFailed = false
    POD.proxyProgress = 0
    showPreviewStatus('正在准备兼容预览', { busy: true, progress: 0 })

    const task = (async () => {
      try {
        const result = await NT.api.call('media:proxy', sourcePath)
        if (!project() || project().info.path !== sourcePath) return null
        project().proxyUrl = result.url
        if (options.auto || result.cached) {
          switchToProxy()
        } else {
          showPreviewStatus('兼容预览已准备完成', { done: true })
          setTimeout(() => {
            if (!POD.proxyBusy) hidePreviewStatus()
          }, 1800)
        }
        return result.url
      } catch (err) {
        POD.proxyFailed = true
        if (project() && project().info.path === sourcePath) {
          showPreviewStatus('兼容预览生成失败，可以重试；导出不受影响', {
            error: true,
            retry: true
          })
        }
        return null
      } finally {
        POD.proxyBusy = false
        POD.proxyPromise = null
      }
    })()

    POD.proxyPromise = task
    return task
  }

  async function makeProxy() {
    if (POD.proxyBusy) return
    POD.proxyFailed = false
    await ensureProxy({ auto: true })
  }

  function clearLoading() {
    if (POD.loadingTimer) {
      clearTimeout(POD.loadingTimer)
      POD.loadingTimer = null
    }
    const loading = $('#stage-loading')
    if (loading) loading.remove()
  }

  function showVideoError() {
    clearLoading()
    if (!project() || !currentInfo() || !currentInfo().hasVideo) return
    project().previewError = true
    showStill()
    if (project().proxyUrl) {
      switchToProxy()
      return
    }
    if (POD.proxyFailed) {
      showPreviewStatus('当前编码不能直接预览；可以重试兼容预览，导出不受影响', {
        error: true,
        retry: true
      })
      return
    }
    showPreviewStatus('当前编码不能直接播放，正在准备兼容预览…', {
      busy: true,
      progress: POD.proxyProgress || 0
    })
    void ensureProxy({ auto: true })
  }

  function hideVideoError() {
    hidePreviewStatus()
  }

  function reloadVideo() {
    hideVideoError()
    hideStill()
    if (!project()) return
    POD.video.src = project().proxyUrl || project().url
    POD.video.load()
  }

  function setupVideo() {
    let lastCapture = 0
    POD.video.addEventListener('loadedmetadata', () => {
      updateTransportDuration()
      layoutStage()
      setPlayhead(0)
    })
    POD.video.addEventListener('loadeddata', () => {
      hideStill()
      clearLoading()
    })
    POD.video.addEventListener('timeupdate', () => {
      updatePlayheadFromVideo()
      const now = performance.now()
      if (now - lastCapture > 650) {
        lastCapture = now
        captureFrame()
      }
    })
    POD.video.addEventListener('play', () => {
      hideStill()
      updatePlayState(true)
      startRaf()
    })
    POD.video.addEventListener('pause', () => {
      updatePlayState(false)
      stopRaf()
      updatePlayheadFromVideo()
    })
    POD.video.addEventListener('ended', () => {
      updatePlayState(false)
      stopRaf()
    })
    POD.video.addEventListener('error', () => {
      showVideoError()
    })
    POD.video.addEventListener('volumechange', updateVolumeIcon)
    POD.video.addEventListener('click', () => {
      if (NT.state.mode !== 'crop' || NT.state.previewMode) togglePlay()
    })
    updatePlayState(false)
  }

  async function loadAssets(token) {
    const info = project().info
    const path = info.path
    const tasks = []
    if (info.hasVideo) {
      tasks.push(
        NT.api
          .call('media:keyframes', path)
          .then((keys) => {
            if (token !== POD.assetToken) return
            project().keyframes = keys || []
            NT.Timeline.setData({ keyframes: project().keyframes })
            NT.Timeline.refresh()
            renderPanel()
          })
          .catch(() => {})
      )
      tasks.push(
        NT.api
          .call('media:thumbs', path, { count: 48, height: 96 })
          .then((thumbs) => {
            if (token !== POD.assetToken) return
            project().thumbs = thumbs || []
            NT.Timeline.setData({ thumbs: project().thumbs })
            if (project().previewError) showStill()
          })
          .catch(() => {})
      )
    }
    if (info.hasAudio) {
      tasks.push(
        NT.api
          .call('media:waveform', path, 1200)
          .then((wave) => {
            if (token !== POD.assetToken) return
            project().waveform = wave || []
            NT.Timeline.setData({ waveform: project().waveform })
          })
          .catch(() => {})
      )
    }
    await Promise.all(tasks)
  }

  function mount() {
    const view = document.getElementById('view')
    if (!view || !project()) return
    destroy()
    POD.mounted = true
    const info = project().info
    const hasVid = info.hasVideo
    const displayW = info.video ? info.video.displayWidth : 0
    const displayH = info.video ? info.video.displayHeight : 0
    const meta = [
      fmt.formatShort(info.duration),
      hasVid ? `${displayW}×${displayH}` : '音频',
      hasVid ? `${info.video.fps.toFixed(2)} fps` : '',
      NT.codecLabel(info)
    ]
      .filter(Boolean)
      .join(' · ')

    view.className = 'view'
    view.innerHTML = `<div class="editor">
      <div class="editor-main">
        <section class="stage-col">
          <div class="stage" id="stage">
            <div class="video-frame" id="video-frame">
              <video id="preview-video" preload="auto" playsinline crossorigin="anonymous"></video>
              <img class="preview-still" id="preview-still" alt="" hidden />
              <div class="preview-status" id="preview-status" hidden>
                <span class="preview-status-spinner"></span>
                <span class="preview-status-text" id="preview-status-text">正在准备兼容预览</span>
                <span class="preview-status-percent" id="preview-status-percent"></span>
                <div class="preview-status-bar"><span id="preview-status-fill"></span></div>
                <button class="preview-status-retry" id="preview-retry" data-act="make-proxy" type="button" hidden>重试</button>
              </div>
              <div class="crop-layer" id="crop-layer" hidden></div>
            </div>
            <div class="stage-loading" id="stage-loading"><div class="spinner"></div><span>正在载入预览…</span></div>
            <button class="preview-exit" data-act="toggle-preview" type="button">${icon(
              'minimize',
              14
            )} 退出预览</button>
          </div>
          <div class="transport">
            <div class="transport-left">
              <span class="time-now" id="time-now">00:00.00</span>
              <span class="time-total" id="time-total">/ 00:00.00</span>
              <button class="loop-chip" data-act="toggle-loop" type="button">${icon('loop', 11)} 循环</button>
            </div>
            <div class="transport-center">
              <button class="play-btn" id="play-btn" data-act="toggle-play" aria-label="播放" type="button">${icon(
                'play',
                18
              )}</button>
            </div>
            <div class="transport-right">
              <button class="t-btn" data-act="mute" title="静音">${icon('volume', 17)}</button>
              <div class="vol"><input type="range" id="volume" min="0" max="1" step="0.01" value="1" aria-label="音量" /></div>
            </div>
          </div>
        </section>
        <aside class="inspector">
          <div class="mode-tabs" id="mode-tabs"></div>
          <div class="inspector-scroll" id="mode-panel"></div>
        </aside>
      </div>
      <section class="timeline-pane" id="timeline-pane"></section>
    </div>`

    POD.video = $('#preview-video')
    POD.frame = $('#video-frame')
    POD.stage = $('#stage')
    POD.cropLayer = $('#crop-layer')
    POD.still = $('#preview-still')
    POD.previewStatus = $('#preview-status')
    POD.previewStatusText = $('#preview-status-text')
    POD.previewStatusPercent = $('#preview-status-percent')
    POD.previewStatusFill = $('#preview-status-fill')
    POD.previewRetry = $('#preview-retry')
    POD.timelinePane = $('#timeline-pane')
    POD.modeTabs = $('#mode-tabs')
    POD.modePanel = $('#mode-panel')
    POD.exportSettings = null
    POD.timeNow = $('#time-now')
    POD.timeTotal = $('#time-total')
    POD.playBtn = $('#play-btn')
    POD.loopChip = $('.loop-chip')
    POD.volume = $('#volume')

    POD.view = view
    POD.video.volume = 1
    setupVideo()
    POD.video.src = project().proxyUrl || project().url
    if (hasVid && !project().proxyUrl && !previewCompatibility(info).direct) {
      setTimeout(() => {
        if (POD.mounted && project() && project().info.path === info.path) {
          void ensureProxy({ auto: true })
        }
      }, 220)
    }
    if (!hasVid) {
      POD.video.style.opacity = '0'
      const audioStage = document.createElement('div')
      audioStage.className = 'audio-stage'
      audioStage.innerHTML = `${icon('music', 30)}<div class="audio-stage-name">${fmt.escapeHtml(
        info.name
      )}</div><div class="audio-stage-sub">音频文件 · 使用下方时间轴预览与裁剪</div>`
      POD.frame.appendChild(audioStage)
    }
    updateTransportDuration()
    updateLoopChip()

    NT.Timeline.destroy()
    NT.Timeline.mount(POD.timelinePane)
    renderModeTabs()
    renderPanel()
    renderExportCard()
    renderCropLayer(true)
    applyPreviewMode()
    if (POD.modePanel) POD.modePanel.scrollTop = 0

    POD.video.addEventListener('loadeddata', () => {
      clearLoading()
    })
    POD.video.addEventListener('canplay', () => {
      clearLoading()
    })
    POD.loadingTimer = setTimeout(() => {
      clearLoading()
    }, 4500)

    POD.video.addEventListener('loadedmetadata', () => {
      layoutStage()
    })

    POD.volume.addEventListener('input', () => {
      POD.video.volume = Number(POD.volume.value)
      if (POD.video.volume > 0) POD.video.muted = false
    })

    POD.ro = new ResizeObserver(() => {
      layoutStage()
      if (NT.state.mode === 'crop') updateCropDom()
    })
    POD.ro.observe(POD.stage)

    POD.cropLayer.addEventListener('pointerdown', cropPointerDown)
    POD.cropLayer.addEventListener('pointermove', cropPointerMove)
    POD.cropLayer.addEventListener('pointerup', cropPointerUp)
    POD.cropLayer.addEventListener('pointercancel', cropPointerUp)

    view.addEventListener('click', onEditorClick)
    view.addEventListener('change', onEditorChange)

    POD.modePanel.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('#trim-in, #trim-out')) {
        e.preventDefault()
        e.target.blur()
      }
    })

    POD.unsubs.push(
      NT.api.on('media:proxy-progress', (payload) => {
        if (!project() || !payload || payload.path !== project().info.path || !POD.proxyBusy) return
        POD.proxyProgress = Math.max(0, Math.min(1, Number(payload.progress) || 0))
        showPreviewStatus(`正在准备兼容预览… ${Math.round(POD.proxyProgress * 100)}%`, {
          busy: true,
          progress: POD.proxyProgress
        })
      })
    )

    document.addEventListener('keydown', onGlobalKeydown)
    document.addEventListener('keyup', onGlobalKeyup, true)
    window.addEventListener('resize', layoutStage)

    NT.Timeline.refresh()
    updatePlayheadFromVideo()
    setTimeout(layoutStage, 60)
    Promise.resolve().then(() => {
      renderCropLayer(true)
      void loadAssets(++POD.assetToken)
      scheduleEstimate(80)
    })

    if (NT.state.mode === 'multi' && NT.state.multiClips.length > 1) {
      renderPanel()
    }

    const hint = $('.tb-meta')
    if (hint && !hint.textContent) hint.textContent = meta
  }

  function onEditorClick(e) {
    const target = e.target.closest('[data-act]')
    if (target && target.closest('#mode-panel')) {
      handlePanelAction(target.dataset.act, target.dataset.value, target.dataset.index, target)
      return
    }
    if (target && target.dataset.act === 'toggle-preview') {
      togglePreview()
      return
    }
    if (target && target.closest('#crop-layer')) {
      handlePanelAction(target.dataset.act, target.dataset.value, target.dataset.index, target)
      return
    }
    if (target) {
      handlePanelAction(target.dataset.act, target.dataset.value, target.dataset.index, target)
      return
    }
    const modeTab = e.target.closest('[data-mode]')
    if (modeTab) {
      toggleMode(modeTab.dataset.mode)
    }
  }

  function onEditorChange(e) {
    const target = e.target
    if (target.id === 'trim-in') {
      const value = fmt.parseTime(target.value)
      if (value === null) {
        target.value = fmt.formatClock(NT.state.inPoint, 3)
        return
      }
      setInPoint(value)
    } else if (target.id === 'trim-out') {
      const value = fmt.parseTime(target.value)
      if (value === null) {
        target.value = fmt.formatClock(NT.state.outPoint, 3)
        return
      }
      setOutPoint(value)
    } else if (target.id === 'volume') {
      POD.video.volume = Number(target.value)
    }
  }

  function onEditorKeydown(e) {
    if (e.target.matches('input, textarea, select')) return
    if (e.key === 'Enter') {
      e.preventDefault()
      togglePlay()
    }
  }

  function onGlobalKeydown(e) {
    if (!POD.mounted) return
    const tag = (e.target.tagName || '').toLowerCase()
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return
    if (document.querySelector('.overlay')) return
    if (e.key === 'Escape' && NT.state.previewMode) {
      e.preventDefault()
      togglePreview(false)
      return
    }
    if (e.code === 'Space') {
      e.preventDefault()
      if (e.repeat) return
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur()
      togglePlay()
      return
    }
    if (tag === 'button' && e.key === 'Enter') return
    if (e.ctrlKey || e.metaKey) {
      if (e.key.toLowerCase() === 'e') {
        e.preventDefault()
        if (NT.state.ffmpeg && NT.state.ffmpeg.connected) openExportSettings()
        else if (NT.openFfmpegSetup) NT.openFfmpegSetup()
      } else if (e.key.toLowerCase() === 'k') {
        e.preventDefault()
        splitAtPlayhead()
      }
      return
    }
    const s = NT.state
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      setPlayhead(s.playhead - (e.shiftKey ? 1 : 1 / Math.max(1, currentInfo().video ? currentInfo().video.fps : 30)))
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      setPlayhead(s.playhead + (e.shiftKey ? 1 : 1 / Math.max(1, currentInfo().video ? currentInfo().video.fps : 30)))
    } else if (e.key.toLowerCase() === 'i') {
      e.preventDefault()
      setInPoint(s.playhead)
    } else if (e.key.toLowerCase() === 'o') {
      e.preventDefault()
      setOutPoint(s.playhead)
    }
  }

  function onGlobalKeyup(e) {
    if (!POD.mounted) return
    const tag = (e.target.tagName || '').toLowerCase()
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return
    if (e.code === 'Space') {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  function unsubscribeAll() {
    for (const fn of POD.unsubs) {
      try {
        fn()
      } catch {
        /* ignore */
      }
    }
    POD.unsubs = []
  }

  function destroy() {
    stopRaf()
    clearLoading()
    clearTimeout(POD.estimateTimer)
    POD.estimateTimer = null
    POD.assetToken += 1
    POD.proxyBusy = false
    POD.proxyPromise = null
    POD.proxyFailed = false
    POD.stillCanvas = null
    if (POD.ro) POD.ro.disconnect()
    POD.ro = null
    if (POD.view) {
      POD.view.removeEventListener('click', onEditorClick)
      POD.view.removeEventListener('change', onEditorChange)
      POD.view = null
    }
    if (POD.video) {
      try {
        POD.video.pause()
        POD.video.removeAttribute('src')
        POD.video.load()
      } catch {
        /* ignore */
      }
    }
    document.removeEventListener('keydown', onGlobalKeydown)
    document.removeEventListener('keyup', onGlobalKeyup, true)
    window.removeEventListener('resize', layoutStage)
    NT.Timeline.destroy()
    document.getElementById('app-body')?.classList.remove('previewing')
    document.body.classList.remove('previewing')
    unsubscribeAll()
    POD.mounted = false
    POD.playing = false
    POD.cropDrag = null
  }

  NT.Editor = {
    mount,
    destroy,
    seek: setPlayhead,
    seekTo: setPlayhead,
    togglePlay,
    togglePreview,
    onSelectionChange,
    commitSelection,
    removeSplit,
    addSplit,
    setInPoint,
    setOutPoint,
    setVideoVisible,
    setAudioMuted,
    selectClip,
    splitAtPlayhead,
    reorderClips,
    addVideoToTrack,
    startExport,
    openExportSettings,
    updateExportBar,
    refresh: () => {
      if (!POD.mounted) return
      renderModeTabs()
      renderPanel()
      renderExportCard()
      NT.Timeline.refresh()
      renderCropLayer(true)
      scheduleEstimate(80)
    },
    refreshExport: () => {
      if (!POD.mounted) return
      renderExportCard()
      scheduleEstimate(50)
    },
    get mounted() {
      return POD.mounted
    }
  }
})()
