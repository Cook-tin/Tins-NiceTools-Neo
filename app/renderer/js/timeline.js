;(function () {
  const NT = (window.NT = window.NT || {})
  const { icon } = NT
  const { fmt } = NT

  const STEP_LIST = [
    0.04, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600
  ]

  const timeline = {
    mounted: false,
    container: null,
    scroll: null,
    content: null,
    ruler: null,
    thumbsEl: null,
    waveEl: null,
    keysEl: null,
    splitsEl: null,
    maskL: null,
    maskR: null,
    sel: null,
    handleL: null,
    handleR: null,
    playhead: null,
    tip: null,
    width: 900,
    zoom: 1,
    fitPps: 1,
    pps: 1,
    lastLayoutKey: '',
    drag: null,
    scrubbing: false,
    ro: null,
    raf: 0
  }

  function el(id) {
    return document.getElementById(id)
  }

  function duration() {
    return (NT.state.project && NT.state.project.info && NT.state.project.info.duration) || 0
  }

  function isEditable() {
    const s = NT.state
    if (s.mode === 'trim' || s.mode === 'crop' || s.mode === 'gif') return true
    if (s.mode === 'audio' && s.audioAction === 'trim') return true
    return false
  }

  function hintText() {
    const s = NT.state
    if (s.mode === 'trim') return '拖动两侧手柄 · 空格播放 · I / O 设入出点'
    if (s.mode === 'multi') return '在右侧添加片段并排序'
    if (s.mode === 'split') return '点击时间轴定位 · S 在播放头处分割'
    if (s.mode === 'crop') return '拖动两侧手柄选时间段 · 在画面上拖动裁剪框'
    if (s.mode === 'audio') {
      if (s.audioAction === 'trim') return '拖动两侧手柄选择音频片段'
      if (s.audioAction === 'remove') return '导出时移除声音'
      return '导出完整音轨'
    }
    if (s.mode === 'gif') return '拖动两侧手柄选择 GIF 片段'
    return ''
  }

  function clampTime(t) {
    const d = duration()
    return Math.max(0, Math.min(d, t))
  }

  function timeAtClientX(clientX) {
    const rect = timeline.content.getBoundingClientRect()
    return clampTime((clientX - rect.left) / timeline.pps)
  }

  function snapHandle(t, which) {
    const s = NT.state
    if (!s.autoSnap) return t
    const threshold = Math.min(0.2, Math.max(0.02, 8 / Math.max(0.1, timeline.pps)))
    const candidates = [0, duration(), s.playhead]
    if (which === 'in') candidates.push(s.outPoint)
    else candidates.push(s.inPoint)
    let best = t
    let dist = threshold
    for (const candidate of candidates) {
      const delta = Math.abs(candidate - t)
      if (delta < dist) {
        dist = delta
        best = candidate
      }
    }
    return best
  }

  function tickLabel(t, step) {
    const d = Math.floor(t)
    const h = Math.floor(d / 3600)
    const m = Math.floor((d % 3600) / 60)
    const s = d % 60
    if (step < 1) {
      return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(s).padStart(2, '0')}.${Math.round(
        (t % 1) * 10
      )}`
    }
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    return `${m}:${String(s).padStart(2, '0')}`
  }

  function chooseStep() {
    const target = 74 / timeline.pps
    for (const step of STEP_LIST) {
      if (step >= target) return step
    }
    return STEP_LIST[STEP_LIST.length - 1]
  }

  function layout() {
    if (!timeline.mounted) return
    const d = duration()
    if (!d) return
    timeline.width = Math.max(320, timeline.scroll.clientWidth)
    timeline.fitPps = timeline.width / d
    timeline.pps = timeline.fitPps * timeline.zoom
    const contentWidth = Math.max(240, d * timeline.pps)
    timeline.content.style.width = `${contentWidth}px`
    const key = `${contentWidth.toFixed(1)}|${timeline.pps.toFixed(4)}|${d.toFixed(3)}`
    if (key === timeline.lastLayoutKey) {
      updateSelection()
      updatePlayhead()
      return
    }
    timeline.lastLayoutKey = key

    const step = chooseStep()
    let html = ''
    let count = 0
    for (let t = 0; t <= d + step * 0.25 && count < 260; t += step) {
      const x = t * timeline.pps
      html += `<span class="tl-tick" style="left:${x}px">${tickLabel(t, step)}</span>`
      count += 1
    }
    if (timeline.pps > 12) {
      const minor = step / 5
      if (minor * timeline.pps > 8) {
        for (let t = minor; t < d && count < 800; t += minor) {
          const x = t * timeline.pps
          html += `<span class="tl-tick minor" style="left:${x}px"></span>`
          count += 1
        }
      }
    }
    timeline.ruler.innerHTML = html

    renderKeys()
    renderSplits()
    updateSelection()
    updatePlayhead()
    updateReadout()
  }

  function renderKeys() {
    if (!timeline.mounted) return
    const project = NT.state.project
    const keys = (project && project.keyframes) || []
    if (!keys.length) {
      timeline.keysEl.innerHTML = ''
      return
    }
    const max = 700
    const stride = Math.max(1, Math.ceil(keys.length / max))
    let html = ''
    for (let i = 0; i < keys.length; i += stride) {
      const k = keys[i]
      const x = k * timeline.pps
      if (x < 0 || x > timeline.content.clientWidth + 2) continue
      html += `<span class="tl-key${i === 0 ? ' major' : ''}" style="left:${x}px"></span>`
    }
    timeline.keysEl.innerHTML = html
  }

  function renderThumbs() {
    if (!timeline.mounted) return
    const project = NT.state.project
    const thumbs = (project && project.thumbs) || []
    if (!thumbs.length) {
      timeline.thumbsEl.innerHTML =
        Array.from({ length: 14 })
          .map(() => '<span class="tl-thumb-skeleton"></span>')
          .join('') + '<span class="tl-thumb-loading">正在生成缩略图…</span>'
      return
    }
    timeline.thumbsEl.innerHTML = thumbs
      .map(
        (thumb) =>
          `<span class="tl-thumb" style="background-image:url('${thumb.url}')"></span>`
      )
      .join('')
    if (timeline.preview) renderPreviewStrip()
  }

  function renderWaveform() {
    if (!timeline.mounted) return
    const project = NT.state.project
    const wave = (project && project.waveform) || []
    if (!wave.length) {
      timeline.waveEl.innerHTML = ''
      return
    }
    const n = wave.length
    const width = 1000
    const mid = 25
    const amp = 20
    const peak = Math.max(0.001, ...wave)
    const gain = Math.min(4, 0.75 / peak)
    const stride = Math.max(1, Math.ceil(n / 420))
    let path = ''
    for (let i = 0; i < n; i += stride) {
      const x = (i / (n - 1)) * width
      const v = Math.max(0, Math.min(1, wave[i] * gain))
      const h = v * amp
      path += `M${x.toFixed(1)} ${(mid - h).toFixed(1)}V${(mid + h).toFixed(1)}`
    }
    timeline.waveEl.innerHTML = `<svg viewBox="0 0 ${width} 50" preserveAspectRatio="none"><path d="M0 25H${width}" stroke="rgba(0,0,0,.1)" stroke-width="0.7" fill="none"/><path d="${path}" stroke="rgba(0,0,0,.32)" stroke-width="1.05" fill="none"/></svg>`
  }

  function updateSelection() {
    if (!timeline.mounted) return
    const s = NT.state
    const d = duration()
    const editable = isEditable()
    const left = Math.max(0, Math.min(s.inPoint, s.outPoint)) * timeline.pps
    const right = Math.max(s.inPoint, s.outPoint) * timeline.pps
    const width = Math.max(0, right - left)

    if (!editable) {
      timeline.maskL.style.display = 'none'
      timeline.maskR.style.display = 'none'
      timeline.sel.style.display = 'none'
      timeline.handleL.style.display = 'none'
      timeline.handleR.style.display = 'none'
    } else {
      timeline.maskL.style.display = 'block'
      timeline.maskR.style.display = 'block'
      timeline.sel.style.display = 'block'
      timeline.handleL.style.display = 'flex'
      timeline.handleR.style.display = 'flex'
      timeline.maskL.style.left = '0px'
      timeline.maskL.style.width = `${left}px`
      timeline.maskR.style.left = `${right}px`
      timeline.maskR.style.width = `${Math.max(0, timeline.content.clientWidth - right)}px`
      timeline.sel.style.left = `${left}px`
      timeline.sel.style.width = `${width}px`
      timeline.handleL.style.left = `${left}px`
      timeline.handleR.style.left = `${right}px`
    }
    void d
    updateReadout()
    updatePreview()
  }

  function updatePlayhead() {
    if (!timeline.mounted) return
    const s = NT.state
    const t = Math.max(0, Math.min(duration(), s.playhead || 0))
    timeline.playhead.style.transform = `translateX(${t * timeline.pps}px)`
    updateReadout()
    updatePreview()
  }

  function updateReadout() {
    if (!timeline.mounted) return
    const s = NT.state
    const d = duration()
    const current = Math.max(0, Math.min(d, Number(s.playhead) || 0))
    const selEl = el('tl-duration')
    const totalEl = el('tl-total')
    const hintEl = el('tl-hint')
    if (selEl) selEl.textContent = fmt.formatClock(current, 2)
    if (totalEl) totalEl.textContent = fmt.formatClock(d, 2)
    if (hintEl) hintEl.textContent = hintText()
  }

  function renderSplits() {
    if (!timeline.mounted) return
    const s = NT.state
    if (s.mode !== 'split' || !s.splitPoints.length) {
      timeline.splitsEl.innerHTML = ''
      return
    }
    timeline.splitsEl.innerHTML = s.splitPoints
      .map(
        (t, i) =>
          `<span class="tl-split" data-split-index="${i}" style="left:${t * timeline.pps}px" title="点击移除 ${fmt.formatClock(
            t,
            2
          )}"></span>`
      )
      .join('')
  }

  function seek(t) {
    const time = clampTime(t)
    NT.setState({ playhead: time })
    updatePlayhead()
    if (NT.Editor && NT.Editor.seek) NT.Editor.seek(time)
  }

  function onScrubStart(e) {
    if (e.button !== 0) return
    if (e.target.closest('.tl-handle') || e.target.closest('.tl-split')) return
    timeline.scrubbing = true
    timeline.scroll.setPointerCapture?.(e.pointerId)
    seek(timeAtClientX(e.clientX))
    e.preventDefault()
  }

  function onScrubMove(e) {
    if (!timeline.scrubbing) return
    seek(timeAtClientX(e.clientX))
  }

  function onScrubEnd() {
    timeline.scrubbing = false
  }

  function beginHandleDrag(e, which) {
    if (e.button !== 0) return
    const s = NT.state
    if (!isEditable()) return
    if (NT.History) NT.History.begin(which === 'in' ? '调整入点' : '调整出点')
    timeline.drag = {
      which,
      startX: e.clientX,
      startIn: s.inPoint,
      startOut: s.outPoint,
      moved: false
    }
    e.currentTarget.setPointerCapture?.(e.pointerId)
    e.preventDefault()
    e.stopPropagation()
  }

  function onHandleMove(e) {
    const drag = timeline.drag
    if (!drag) return
    const s = NT.state
    const delta = (e.clientX - drag.startX) / timeline.pps
    if (Math.abs(e.clientX - drag.startX) > 1) drag.moved = true
    const minGap = Math.min(0.05, duration())
    if (drag.which === 'in') {
      let next = fmt.clamp(drag.startIn + delta, 0, s.outPoint - minGap)
      next = snapHandle(next, 'in')
      next = fmt.clamp(next, 0, s.outPoint - minGap)
      if (next !== s.inPoint) {
        NT.setState({ inPoint: next })
        if (NT.Editor) NT.Editor.onSelectionChange({ seekTo: next })
      }
    } else {
      let next = fmt.clamp(drag.startOut + delta, s.inPoint + minGap, duration())
      next = snapHandle(next, 'out')
      next = fmt.clamp(next, s.inPoint + minGap, duration())
      if (next !== s.outPoint) {
        NT.setState({ outPoint: next })
        if (NT.Editor) NT.Editor.onSelectionChange({ seekTo: next })
      }
    }
    updateSelection()
    updatePlayhead()
  }

  function onHandleUp() {
    if (!timeline.drag) return
    const moved = timeline.drag.moved
    timeline.drag = null
    if (NT.History) NT.History.end(moved)
    if (moved && NT.Editor) NT.Editor.commitSelection()
  }

  function setZoom(next, anchorTime) {
    const d = duration()
    if (!d) return
    const oldPps = timeline.pps
    const center = anchorTime === undefined
      ? (timeline.scroll.scrollLeft + timeline.scroll.clientWidth / 2) / oldPps
      : anchorTime
    timeline.zoom = Math.max(0.1, Math.min(80, next))
    timeline.lastLayoutKey = ''
    layout()
    const newPps = timeline.pps
    const left = center * newPps - timeline.scroll.clientWidth / 2
    timeline.scroll.scrollLeft = timeline.zoom <= 1 ? 0 : Math.max(0, left)
    const zoomEl = el('tl-zoom')
    if (zoomEl) zoomEl.textContent = `${timeline.zoom >= 10 ? Math.round(timeline.zoom) : timeline.zoom.toFixed(1)}×`
  }

  function onWheel(e) {
    if (!timeline.mounted) return
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const rect = timeline.scroll.getBoundingClientRect()
      const anchor = (timeline.scroll.scrollLeft + (e.clientX - rect.left)) / timeline.pps
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0017))
      setZoom(timeline.zoom * factor, anchor)
      return
    }
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
    if (!delta) return
    e.preventDefault()
    timeline.scroll.scrollLeft += delta
  }

  function toggleExpand() {
    if (!timeline.container) return
    const expanded = timeline.container.classList.toggle('expanded')
    if (timeline.expandBtn) {
      timeline.expandBtn.innerHTML = icon(expanded ? 'minimize' : 'maximize', 12)
      timeline.expandBtn.title = expanded ? '收起时间轴' : '展开时间轴'
      timeline.expandBtn.classList.toggle('active', expanded)
    }
    requestAnimationFrame(() => {
      timeline.lastLayoutKey = ''
      layout()
    })
  }

  function renderPreviewStrip() {
    if (!timeline.mounted || !timeline.previewStrip) return
    const s = NT.state
    const d = duration()
    const thumbs = (NT.state.project && NT.state.project.thumbs) || []
    const count = Math.max(8, Math.min(26, Math.ceil((timeline.previewFilm.clientWidth || 900) / 64)))
    if (thumbs.length) {
      timeline.previewFilm.innerHTML = Array.from({ length: count })
        .map((_, i) => {
          const thumb = thumbs[Math.min(thumbs.length - 1, Math.round((i / count) * (thumbs.length - 1)))]
          return `<span style="background-image:url('${thumb.url}')"></span>`
        })
        .join('')
    } else {
      timeline.previewFilm.innerHTML = Array.from({ length: count })
        .map(() => '<span class="skeleton"></span>')
        .join('')
    }
    if (timeline.previewTotal) timeline.previewTotal.textContent = fmt.formatClock(d, 2)
    updatePreview()
  }

  function updatePreview() {
    if (!timeline.mounted || !timeline.previewStrip || timeline.previewStrip.hidden) return
    const s = NT.state
    const d = Math.max(0.001, duration())
    const t = Math.max(0, Math.min(d, s.playhead || 0))
    const pct = (t / d) * 100
    if (timeline.previewPlayhead) timeline.previewPlayhead.style.left = `${pct}%`
    if (timeline.previewCurrent) timeline.previewCurrent.textContent = fmt.formatClock(t, 2)
    const left = (Math.max(0, Math.min(s.inPoint, s.outPoint)) / d) * 100
    const right = (Math.max(s.inPoint, s.outPoint) / d) * 100
    if (timeline.previewSel) {
      timeline.previewSel.style.left = `${left}%`
      timeline.previewSel.style.width = `${Math.max(0, right - left)}%`
    }
    if (timeline.previewDimL) timeline.previewDimL.style.width = `${left}%`
    if (timeline.previewDimR) timeline.previewDimR.style.width = `${100 - right}%`
  }

  function setPreview(on) {
    timeline.preview = Boolean(on)
    if (!timeline.mounted) return
    if (timeline.previewStrip) timeline.previewStrip.hidden = !timeline.preview
    if (timeline.container) timeline.container.classList.toggle('preview-mode', timeline.preview)
    if (timeline.previewBtn) {
      timeline.previewBtn.innerHTML = icon(timeline.preview ? 'minimize' : 'maximize', 12)
      timeline.previewBtn.title = timeline.preview ? '退出放大预览' : '放大预览'
      timeline.previewBtn.classList.toggle('active', timeline.preview)
    }
    if (timeline.preview) renderPreviewStrip()
    requestAnimationFrame(() => {
      timeline.lastLayoutKey = ''
      layout()
    })
  }

  function setPlaying(playing) {
    if (timeline.previewPlayBtn) {
      timeline.previewPlayBtn.innerHTML = icon(playing ? 'pause' : 'play', 15)
      timeline.previewPlayBtn.setAttribute('aria-label', playing ? '暂停' : '播放')
    }
  }

  function seekPreview(clientX) {
    const wrap = el('preview-film-wrap')
    if (!wrap) return
    const rect = wrap.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)))
    if (NT.Editor && NT.Editor.seekTo) NT.Editor.seekTo(pct * duration())
  }


  function toggleVideoPreview() {
    timeline.videoVisible = !timeline.videoVisible
    if (timeline.videoTrack) timeline.videoTrack.classList.toggle('is-hidden', !timeline.videoVisible)
    if (timeline.videoToggle) {
      timeline.videoToggle.innerHTML = icon(timeline.videoVisible ? 'eye' : 'eyeOff', 13)
      timeline.videoToggle.classList.toggle('off', !timeline.videoVisible)
      timeline.videoToggle.title = timeline.videoVisible ? '隐藏画面' : '显示画面'
    }
    if (NT.Editor && NT.Editor.setVideoVisible) NT.Editor.setVideoVisible(timeline.videoVisible)
  }

  function toggleAudioPreview() {
    timeline.audioMuted = !timeline.audioMuted
    if (timeline.audioTrack) timeline.audioTrack.classList.toggle('is-muted', timeline.audioMuted)
    if (timeline.audioToggle) {
      timeline.audioToggle.innerHTML = icon(timeline.audioMuted ? 'volumeX' : 'volume', 13)
      timeline.audioToggle.classList.toggle('off', timeline.audioMuted)
      timeline.audioToggle.title = timeline.audioMuted ? '取消静音' : '静音'
    }
    if (NT.Editor && NT.Editor.setAudioMuted) NT.Editor.setAudioMuted(timeline.audioMuted)
  }

  let contextMenu = null
  let contextCleanup = null

  function closeTrackMenu() {
    if (contextCleanup) {
      contextCleanup()
      contextCleanup = null
    }
    if (contextMenu) {
      const node = contextMenu
      contextMenu = null
      node.classList.remove('open')
      setTimeout(() => node.remove(), 130)
    }
  }

  function openTrackMenu(clientX, clientY) {
    closeTrackMenu()
    const menu = document.createElement('div')
    menu.className = 'tl-context'
    menu.innerHTML = `<button class="tl-context-item" data-menu="add-video" type="button">${icon(
      'plus',
      14
    )}<span>添加视频</span></button>`
    document.body.appendChild(menu)
    const width = 168
    const height = 44
    const left = Math.max(8, Math.min(clientX, window.innerWidth - width - 8))
    const top = Math.max(8, Math.min(clientY, window.innerHeight - height - 8))
    menu.style.left = `${left}px`
    menu.style.top = `${top}px`
    contextMenu = menu
    requestAnimationFrame(() => menu.classList.add('open'))

    const onDocPointer = (e) => {
      if (!menu.contains(e.target)) closeTrackMenu()
    }
    const onKey = (e) => {
      if (e.key === 'Escape') closeTrackMenu()
    }
    const onScroll = () => closeTrackMenu()
    document.addEventListener('pointerdown', onDocPointer, true)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    contextCleanup = () => {
      document.removeEventListener('pointerdown', onDocPointer, true)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }

    menu.querySelector('[data-menu="add-video"]').addEventListener('click', () => {
      closeTrackMenu()
      if (NT.openMultiDialog) NT.openMultiDialog()
    })
  }

  function mount(container) {
    timeline.container = container
    const hasAudio = Boolean(
      NT.state.project && NT.state.project.info && NT.state.project.info.hasAudio
    )
    const hasVideo = Boolean(
      NT.state.project && NT.state.project.info && NT.state.project.info.hasVideo
    )
    container.classList.toggle('audio-only', !hasVideo)
    container.innerHTML = `<div class="timeline-card">
      <div class="tl-toolbar">
        <div class="tl-left">
          <div class="tl-readout"><span class="sel" id="tl-duration">00:00.00</span><span class="tl-sep">/</span><span id="tl-total">00:00.00</span></div>
          <span class="tl-hint" id="tl-hint"></span>
        </div>
        <div class="tl-right">
          <button class="tl-btn tl-split-btn" data-tl="split" title="分割 (Ctrl+K)" aria-label="分割">${icon(
            'split',
            12
          )}</button>
          <button class="tl-btn tl-preview-btn${NT.state.previewMode ? ' active' : ''}" data-tl="preview" title="${
            NT.state.previewMode ? '退出放大预览' : '放大预览'
          }" aria-label="放大预览">${icon(
            NT.state.previewMode ? 'minimize' : 'maximize',
            12
          )}</button>
          <span class="tl-toolbar-sep"></span>
          <button class="tl-btn" data-tl="zoom-out" title="缩小">${icon('minus', 13)}</button>
          <span class="tl-zoom" id="tl-zoom">1×</span>
          <button class="tl-btn" data-tl="zoom-in" title="放大">${icon('plus', 13)}</button>
          <button class="tl-btn" data-tl="fit" title="适应窗口" aria-label="适应窗口">${icon(
            'minimize',
            12
          )}</button>
        </div>
      </div>
      <div class="tl-body">
        <div class="tl-headers" id="tl-headers">
          <div class="tl-header-ruler"></div>
          <div class="tl-track-head video" ${hasVideo ? '' : 'hidden'}>
            <span class="tl-track-name">${icon('film', 12)}<span>画面</span></span>
            <button class="tl-track-toggle" data-tl="toggle-video-preview" title="显示/隐藏画面" type="button">${icon(
              'eye',
              13
            )}</button>
          </div>
          <div class="tl-track-head audio" id="tl-audio-head" ${hasAudio ? '' : 'hidden'}>
            <span class="tl-track-name">${icon('music', 12)}<span>音频</span></span>
            <button class="tl-track-toggle" data-tl="toggle-audio-preview" title="静音/取消静音" type="button">${icon(
              'volume',
              13
            )}</button>
          </div>
        </div>
        <div class="tl-scroll" id="tl-scroll">
          <div class="tl-content" id="tl-content">
            <div class="tl-ruler" id="tl-ruler"></div>
            <div class="tl-tracks" id="tl-tracks">
              <div class="tl-track tl-video-track" id="tl-video-track" ${hasVideo ? '' : 'hidden'}>
                <div class="tl-thumbs" id="tl-thumbs"></div>
                <div class="tl-keys" id="tl-keys"></div>
              </div>
              <div class="tl-track tl-audio-track" id="tl-audio-track" ${hasAudio ? '' : 'hidden'}>
                <div class="tl-wave" id="tl-wave"></div>
              </div>
              <div class="tl-mask" id="tl-mask-l"></div>
              <div class="tl-mask" id="tl-mask-r"></div>
              <div class="tl-selection" id="tl-sel"></div>
              <div class="tl-handle" id="tl-handle-l" data-handle="in" title="入点"></div>
              <div class="tl-handle" id="tl-handle-r" data-handle="out" title="出点"></div>
              <div class="tl-playhead" id="tl-playhead"></div>
            </div>
            <div class="tl-splits" id="tl-splits"></div>
            <div class="tl-tip" id="tl-tip" hidden></div>
          </div>
        </div>
      </div>
      <div class="preview-strip" id="preview-strip" hidden>
        <button class="preview-play" id="preview-play" type="button" aria-label="播放">${icon(
          'play',
          15
        )}</button>
        <div class="preview-film-wrap" id="preview-film-wrap">
          <div class="preview-film" id="preview-film"></div>
          <div class="preview-film-dim left" id="preview-dim-left"></div>
          <div class="preview-film-dim right" id="preview-dim-right"></div>
          <div class="preview-film-sel" id="preview-film-sel"></div>
          <div class="preview-film-playhead" id="preview-film-playhead"></div>
        </div>
        <div class="preview-strip-time"><span id="preview-current">00:00.00</span><span id="preview-total">00:00.00</span></div>
      </div>
    </div>`

    timeline.scroll = el('tl-scroll')
    timeline.content = el('tl-content')
    timeline.ruler = el('tl-ruler')
    timeline.thumbsEl = el('tl-thumbs')
    timeline.waveEl = el('tl-wave')
    timeline.keysEl = el('tl-keys')
    timeline.splitsEl = el('tl-splits')
    timeline.maskL = el('tl-mask-l')
    timeline.maskR = el('tl-mask-r')
    timeline.sel = el('tl-sel')
    timeline.handleL = el('tl-handle-l')
    timeline.handleR = el('tl-handle-r')
    timeline.playhead = el('tl-playhead')
    timeline.tip = el('tl-tip')
    timeline.videoTrack = el('tl-video-track')
    timeline.audioTrack = el('tl-audio-track')
    timeline.videoToggle = container.querySelector('[data-tl="toggle-video-preview"]')
    timeline.audioToggle = container.querySelector('[data-tl="toggle-audio-preview"]')
    timeline.previewBtn = container.querySelector('[data-tl="preview"]')
    timeline.previewStrip = el('preview-strip')
    timeline.previewFilm = el('preview-film')
    timeline.previewPlayhead = el('preview-film-playhead')
    timeline.previewSel = el('preview-film-sel')
    timeline.previewDimL = el('preview-dim-left')
    timeline.previewDimR = el('preview-dim-right')
    timeline.previewCurrent = el('preview-current')
    timeline.previewTotal = el('preview-total')
    timeline.previewPlayBtn = el('preview-play')
    timeline.videoVisible = true
    timeline.audioMuted = false
    timeline.mounted = true
    timeline.zoom = 1
    timeline.lastLayoutKey = ''
    timeline.width = timeline.scroll.clientWidth || 900

    timeline.content.addEventListener('pointerdown', onScrubStart)
    window.addEventListener('pointermove', onScrubMove)
    window.addEventListener('pointerup', onScrubEnd)
    window.addEventListener('pointercancel', onScrubEnd)
    timeline.handleL.addEventListener('pointerdown', (e) => beginHandleDrag(e, 'in'))
    timeline.handleR.addEventListener('pointerdown', (e) => beginHandleDrag(e, 'out'))
    window.addEventListener('pointermove', onHandleMove)
    window.addEventListener('pointerup', onHandleUp)
    window.addEventListener('pointercancel', onHandleUp)

    timeline.content.addEventListener('click', (e) => {
      const split = e.target.closest('.tl-split')
      if (split) {
        const index = Number(split.dataset.splitIndex)
        if (NT.Editor && NT.Editor.removeSplit) NT.Editor.removeSplit(index)
      }
    })

    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tl]')
      if (!btn) return
      if (btn.dataset.tl === 'zoom-in') setZoom(timeline.zoom * 1.6)
      else if (btn.dataset.tl === 'zoom-out') setZoom(timeline.zoom / 1.6)
      else if (btn.dataset.tl === 'fit') setZoom(1)
      else if (btn.dataset.tl === 'split') {
        if (NT.Editor && NT.Editor.splitAtPlayhead) NT.Editor.splitAtPlayhead()
      } else if (btn.dataset.tl === 'preview') {
        if (NT.Editor && NT.Editor.togglePreview) NT.Editor.togglePreview()
      } else if (btn.dataset.tl === 'toggle-video-preview') toggleVideoPreview()
      else if (btn.dataset.tl === 'toggle-audio-preview') toggleAudioPreview()
    })

    const previewWrap = el('preview-film-wrap')
    let previewScrubbing = false
    if (previewWrap) {
      previewWrap.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return
        previewScrubbing = true
        try {
          previewWrap.setPointerCapture(e.pointerId)
        } catch {
          /* synthetic pointer */
        }
        seekPreview(e.clientX)
        e.preventDefault()
      })
      previewWrap.addEventListener('pointermove', (e) => {
        if (!previewScrubbing) return
        seekPreview(e.clientX)
      })
      const endPreview = () => {
        previewScrubbing = false
      }
      previewWrap.addEventListener('pointerup', endPreview)
      previewWrap.addEventListener('pointercancel', endPreview)
    }
    const previewPlay = el('preview-play')
    if (previewPlay) {
      previewPlay.addEventListener('click', () => {
        if (NT.Editor && NT.Editor.togglePlay) NT.Editor.togglePlay()
      })
    }
    setPreview(Boolean(NT.state.previewMode))

    timeline.scroll.addEventListener('wheel', onWheel, { passive: false })

    timeline.ro = new ResizeObserver(() => {
      if (timeline.raf) return
      timeline.raf = requestAnimationFrame(() => {
        timeline.raf = 0
        if (!timeline.mounted) return
        if (timeline.zoom === 1) timeline.lastLayoutKey = ''
        layout()
      })
    })
    timeline.ro.observe(timeline.scroll)

    renderThumbs()
    requestAnimationFrame(() => {
      layout()
      const zoomEl = el('tl-zoom')
      if (zoomEl) zoomEl.textContent = '1×'
    })
  }

  function refresh() {
    if (!timeline.mounted) return
    layout()
    updateSelection()
    updatePlayhead()
    renderSplits()
  }

  function setData(patch) {
    if (!timeline.mounted) return
    if (patch.thumbs) renderThumbs()
    if (patch.waveform) renderWaveform()
    if (patch.keyframes) {
      renderKeys()
      timeline.lastLayoutKey = ''
    }
  }

  function setPlayhead(t) {
    if (!timeline.mounted) return
    const clamped = Math.max(0, Math.min(duration(), Number(t) || 0))
    timeline.playhead.style.transform = `translateX(${clamped * timeline.pps}px)`
    updateReadout()
    updatePreview()
  }

  function destroy() {
    closeTrackMenu()
    if (timeline.ro) timeline.ro.disconnect()
    timeline.ro = null
    window.removeEventListener('pointermove', onScrubMove)
    window.removeEventListener('pointerup', onScrubEnd)
    window.removeEventListener('pointercancel', onScrubEnd)
    window.removeEventListener('pointermove', onHandleMove)
    window.removeEventListener('pointerup', onHandleUp)
    window.removeEventListener('pointercancel', onHandleUp)
    if (timeline.scroll) timeline.scroll.removeEventListener('wheel', onWheel)
    timeline.mounted = false
    timeline.drag = null
    timeline.scrubbing = false
  }

  NT.Timeline = {
    mount,
    refresh,
    setData,
    setPlayhead,
    seek,
    destroy,
    isEditable,
    setPreview,
    setPlaying,
    get pps() {
      return timeline.pps
    }
  }
})()
