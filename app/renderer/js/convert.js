;(function () {
  const NT = (window.NT = window.NT || {})
  const { icon } = NT
  const { fmt } = NT
  const { toast, openModal, confirmDialog } = NT.ui

  let activeJobId = ''

  const AUDIO_FORMATS = new Set(['mp3', 'm4a', 'wav', 'flac'])
  const FORMATS = [
    { key: 'mp4', title: 'MP4', sub: 'H.264 · 兼容优先', tag: '重新编码', icon: 'film' },
    { key: 'mkv', title: 'MKV', sub: '保留原编码 · 无损', tag: '极速', icon: 'layers' },
    { key: 'mov', title: 'MOV', sub: 'H.264 · 剪辑通用', tag: '重新编码', icon: 'film' },
    { key: 'm4a', title: 'M4A', sub: 'AAC · 苹果通用', tag: '音频', icon: 'music' },
    { key: 'mp3', title: 'MP3', sub: '兼容性最好', tag: '音频', icon: 'music' },
    { key: 'wav', title: 'WAV', sub: 'PCM · 无损音频', tag: '音频', icon: 'music' },
    { key: 'flac', title: 'FLAC', sub: '无损压缩', tag: '音频', icon: 'music' }
  ]

  let estimateToken = 0
  let estimateTimer = null

  function convert() {
    return NT.state.convert || {}
  }

  function patchConvert(patch) {
    NT.setState({ convert: { ...convert(), ...patch } })
  }

  function duration() {
    return (convert().info && convert().info.duration) || 0
  }

  function hasVideo() {
    return Boolean(convert().info && convert().info.hasVideo)
  }

  function hasAudio() {
    return Boolean(convert().info && convert().info.hasAudio)
  }

  function cleanBase(name) {
    return String(name || 'output').replace(/\.[^.]+$/, '')
  }

  function outputExt() {
    const f = convert().format
    return ['mp4', 'mkv', 'mov', 'm4a', 'mp3', 'wav', 'flac'].includes(f) ? f : 'mp4'
  }

  function computedOutput() {
    const c = convert()
    if (!c.file) return null
    const dir = fmt.dirname(c.file.path)
    const name = `${cleanBase(c.file.name)}_converted.${outputExt()}`
    const autoPath = dir ? `${dir}\\${name}` : name
    return {
      dir,
      name: c.outputPath ? fmt.basename(c.outputPath) : name,
      path: c.outputPath || autoPath,
      ext: outputExt(),
      autoPath
    }
  }

  function formatName(key, info) {
    if (key === 'mkv') return 'MKV · 原编码'
    if (key === 'mov') return 'MOV · H.264'
    if (key === 'm4a') return 'M4A · AAC'
    if (key === 'mp3') return 'MP3 · 192 kbps'
    if (key === 'wav') return 'WAV · PCM'
    if (key === 'flac') return 'FLAC · 无损'
    return 'MP4 · H.264'
  }

  function estimateRequest() {
    const c = convert()
    const isAudio = AUDIO_FORMATS.has(c.format)
    const key = c.format === 'mkv' ? 'copy' : isAudio ? 'audio' : 'h264'
    return {
      sources: [{ path: c.file.path, in: 0, out: duration() }],
      format: key,
      includeVideo: !isAudio,
      includeAudio: hasAudio(),
      quality: c.quality,
      audioFormat: isAudio ? c.format : 'm4a'
    }
  }

  function scheduleEstimate(delay) {
    clearTimeout(estimateTimer)
    estimateToken += 1
    estimateTimer = setTimeout(() => void runEstimate(), delay === undefined ? 180 : delay)
  }

  async function runEstimate() {
    const c = convert()
    if (!c.file || !c.info) return
    const token = ++estimateToken
    patchConvert({ estimating: true })
    render()
    try {
      const result = await NT.api.call('media:estimate', estimateRequest())
      if (token !== estimateToken) return
      patchConvert({ estimate: result, estimating: false })
    } catch {
      if (token !== estimateToken) return
      patchConvert({ estimate: null, estimating: false })
    }
    render()
  }

  function estimateText() {
    const c = convert()
    if (c.estimating) return '估算中…'
    if (!c.estimate) return '≈ —'
    const bytes = fmt.splitBytes(c.estimate.bytes)
    return `≈ ${bytes.value} ${bytes.unit}`
  }

  function formatCard(f) {
    const c = convert()
    const isAudio = AUDIO_FORMATS.has(f.key)
    const disabled = isAudio ? !hasAudio() : !hasVideo()
    return `<button class="convert-format${c.format === f.key ? ' active' : ''}" data-action="convert-format"
      data-value="${f.key}" type="button" ${disabled ? 'disabled' : ''}>
      <span class="convert-format-icon">${icon(f.icon, 18)}</span>
      <span class="convert-format-main">
        <span class="convert-format-title">${f.title}<em>${f.tag}</em></span>
        <span class="convert-format-sub">${f.sub}</span>
      </span>
      <span class="convert-format-check">${c.format === f.key ? icon('check', 13) : ''}</span>
    </button>`
  }

  function renderEmpty() {
    return `<div class="convert-folder-wrap">
      <div class="picker-stage convert-folder-stage">
        <div class="picker-folder has-recent" data-action="convert-pick" role="button" tabindex="0" aria-label="选择要转换的文件" aria-expanded="false">
          <span class="picker-sheet one"></span>
          <span class="picker-sheet two"></span>
          <span class="picker-folder-body">
            <span class="folder-glyph">${icon('folder', 58)}</span>
            <div class="picker-recent-panel">
              <div class="picker-recent-head"><span>支持的格式</span><span>点击文件夹选择</span></div>
              <div class="convert-folder-panel">
                <div class="convert-folder-group">
                  <span>视频</span>
                  <p>MP4 · MOV · MKV · WEBM · AVI · M4V · TS · FLV · WMV · MPG</p>
                </div>
                <div class="convert-folder-group">
                  <span>音频</span>
                  <p>MP3 · M4A · WAV · FLAC · AAC · OGG · OPUS · WMA</p>
                </div>
                <div class="convert-folder-group">
                  <span>输出</span>
                  <p>MP4 · MKV · MOV · M4A · MP3 · WAV · FLAC</p>
                </div>
              </div>
            </div>
          </span>
        </div>
      </div>
      <p class="convert-folder-hint">悬停查看支持格式，点击文件夹选择文件，也可以直接拖入。</p>
    </div>`
  }

  function renderLoaded() {
    const c = convert()
    const info = c.info
    const out = computedOutput()
    const meta = [
      fmt.formatShort(info.duration),
      info.video ? `${info.video.displayWidth}×${info.video.displayHeight}` : '音频',
      NT.codecLabel(info)
    ]
      .filter(Boolean)
      .join(' · ')
    const isAudio = !hasVideo()
    return `<div class="convert-file-card">
        <span class="convert-file-icon">${icon(isAudio ? 'music' : 'film', 20)}</span>
        <span class="convert-file-main">
          <span class="convert-file-name">${fmt.escapeHtml(c.file.name)}</span>
          <span class="convert-file-meta">${fmt.escapeHtml(meta)}</span>
        </span>
        <button class="btn btn-secondary btn-sm" data-action="convert-change" type="button">更换</button>
        <button class="btn btn-ghost btn-sm" data-action="convert-clear" type="button">取消选择</button>
      </div>

      <div class="convert-work">
        <section class="convert-section">
          <div class="convert-section-head"><h2>输出格式</h2><span>选择目标容器</span></div>
          <div class="convert-format-grid">${FORMATS.map(formatCard).join('')}</div>
        </section>

        <section class="convert-section convert-settings">
          <div class="convert-section-head"><h2>输出设置</h2><span>${formatName(c.format, info)}</span></div>
          ${
            c.format === 'mp4' || c.format === 'mov'
              ? `<div class="convert-row">
                  <span class="convert-row-label">画质</span>
                  <div class="seg" style="width:200px">
                    ${[
                      ['high', '高质量'],
                      ['balanced', '平衡'],
                      ['small', '小体积']
                    ]
                      .map(
                        ([k, label]) =>
                          `<button class="${c.quality === k ? 'active' : ''}" data-action="convert-quality" data-value="${k}" type="button">${label}</button>`
                      )
                      .join('')}
                  </div>
                </div>`
              : c.format === 'mkv'
                ? `<div class="convert-note">原编码直接换封装，不重新编码，速度最快、画质不变。</div>`
                : `<div class="convert-note">只导出声音：${
                    c.format === 'm4a'
                      ? 'AAC 192 kbps'
                      : c.format === 'wav'
                        ? 'PCM 无损'
                        : c.format === 'flac'
                          ? 'FLAC 无损压缩'
                          : 'MP3 192 kbps'
                  }，视频轨道会被移除。</div>`
          }
          <div class="convert-row">
            <span class="convert-row-label">保存到</span>
            <span class="convert-output">
              <span class="convert-output-name" title="${fmt.escapeHtml(out ? out.path : '')}">${
                out ? fmt.escapeHtml(out.name) : '—'
              }</span>
              <button class="output-folder" data-action="convert-choose-output" title="更改保存位置" type="button">${icon(
                'folder',
                12
              )}</button>
            </span>
          </div>
          <div class="convert-estimate">
            <span>预计大小</span>
            <b>${estimateText()}</b>
            <small>${c.estimate ? c.estimate.note : '等待估算'}</small>
          </div>
        </section>
      </div>`
  }

  let mountedTarget = null

  function render(view, opts) {
    const embedded = Boolean(opts && opts.embedded)
    const target = view || mountedTarget
    if (!target || !target.isConnected) return
    mountedTarget = target
    const c = convert()
    if (embedded) {
      target.classList.add('convert-module')
    } else {
      target.className = 'view convert-view'
    }
    const ff = NT.state.ffmpeg || {}
    target.innerHTML = `<div class="${embedded ? 'convert-module-page' : 'convert-page'}">
      <header class="convert-head">
        <div class="convert-heading">
          <span class="convert-kicker">${embedded ? 'FORMAT CONVERT' : 'TOOLBOX · 03'}</span>
          <h1>格式转换</h1>
          <p>换容器、换编码，或者只留下声音。</p>
        </div>
        <div class="convert-head-actions">
          <span class="convert-top-estimate" id="convert-estimate">${estimateText()}</span>
          <button class="btn btn-primary convert-export" data-action="convert-export" type="button" ${
            !c.file ? 'disabled' : ''
          }>${icon('download', 14)} ${ff.connected ? '导出' : '连接 FFmpeg'}</button>
        </div>
      </header>
      ${c.file ? renderLoaded() : renderEmpty()}
    </div>`
  }

  async function pick() {
    if (!NT.state.ffmpeg || !NT.state.ffmpeg.connected) {
      NT.openFfmpegSetup()
      return
    }
    try {
      const paths = await NT.api.call('dialog:open-media')
      if (paths && paths.length) await openPath(paths[0])
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  async function openPath(filePath, options = {}) {
    if (!filePath) return
    if (!NT.state.ffmpeg || !NT.state.ffmpeg.connected) {
      NT.openFfmpegSetup()
      return
    }
    NT.ui.busy(true, '正在读取文件…')
    try {
      const res = await NT.api.call('media:open', filePath)
      const preferred = AUDIO_FORMATS.has(options.preferredFormat)
        ? options.preferredFormat
        : 'm4a'
      const format = res.info.hasVideo ? 'mp4' : preferred
      activeJobId = ''
      patchConvert({
        file: { path: filePath, name: res.info.name },
        info: res.info,
        url: res.url,
        format,
        outputPath: null,
        estimate: null,
        estimating: true
      })
      render()
      scheduleEstimate(30)
    } catch (err) {
      toast(err.message || '无法打开文件', 'error')
    } finally {
      NT.ui.busy(false)
    }
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
        patchConvert({ outputPath: filePath })
        render()
      }
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  function buildSpec() {
    const c = convert()
    const out = computedOutput()
    const isAudio = AUDIO_FORMATS.has(c.format)
    const key = c.format === 'mkv' ? 'copy' : isAudio ? 'audio' : 'h264'
    return {
      kind: 'transcode',
      sources: [{ path: c.file.path, in: 0, out: duration() }],
      outputDir: out ? out.dir : '',
      baseName: cleanBase(c.file.name),
      outputPath: c.outputPath || undefined,
      includeVideo: !isAudio,
      includeAudio: hasAudio(),
      format: key,
      container: c.format,
      quality: c.quality,
      audioFormat: isAudio ? c.format : 'm4a',
      faststart: !NT.state.settings || NT.state.settings.faststart !== false
    }
  }

  function openExportConfirm() {
    const c = convert()
    if (!c.file) {
      toast('请先选择文件', 'error')
      return
    }
    if (AUDIO_FORMATS.has(c.format) && !hasAudio()) {
      toast('这个文件没有音频轨道', 'error')
      return
    }
    const out = computedOutput()
    const modal = openModal(
      `<h2>开始转换</h2>
       <p class="lead">确认输出信息后开始。需要修改可以关闭弹窗，在右侧工作页调整。</p>
       <div class="convert-confirm-list">
         <div><span>源文件</span><b title="${fmt.escapeHtml(c.file.path)}">${fmt.escapeHtml(
           c.file.name
         )}</b></div>
         <div><span>输出格式</span><b>${formatName(c.format, c.info)}</b></div>
         <div><span>保存到</span><b title="${fmt.escapeHtml(out ? out.path : '')}">${fmt.escapeHtml(
           out ? out.name : '—'
         )}</b></div>
         <div><span>预计大小</span><b>${estimateText()}</b></div>
       </div>
       <div class="modal-actions">
         <button class="btn btn-ghost" data-cancel type="button">取消</button>
         <button class="btn btn-primary" data-start type="button">开始转换</button>
       </div>`,
      { className: 'narrow convert-confirm-modal', closable: true }
    )
    modal.modal.querySelector('[data-cancel]').addEventListener('click', () => modal.close())
    modal.modal.querySelector('[data-start]').addEventListener('click', () => {
      modal.close(true)
      void startExport()
    })
  }

  async function startExport() {
    const c = convert()
    if (!c.file) {
      toast('请先选择文件', 'error')
      return
    }
    if (!NT.state.ffmpeg || !NT.state.ffmpeg.connected) {
      NT.openFfmpegSetup()
      return
    }
    if (AUDIO_FORMATS.has(c.format) && !hasAudio()) {
      toast('这个文件没有音频轨道', 'error')
      return
    }
    const spec = buildSpec()
    try {
      const res = await NT.api.call('export:start', spec)
      activeJobId = res.jobId
      if (NT.openExportModal) {
        NT.openExportModal(res.jobId, spec, {
          onDone: () => {
            activeJobId = ''
            if (NT.refreshRecent) NT.refreshRecent()
          }
        })
      }
    } catch (err) {
      activeJobId = ''
      toast(err.message, 'error')
    }
  }

  async function clearFile() {
    const c = convert()
    if (!c.file) return
    const running = Boolean(activeJobId)
    const ok = await confirmDialog({
      title: running ? '取消当前转换？' : '取消选择当前文件？',
      message: running
        ? '正在转换的任务会被停止，当前文件会从工作页移除。源文件不会被删除。'
        : '当前文件会从格式转换页移除，源文件不会被删除。',
      confirmText: running ? '取消并停止' : '取消选择',
      cancelText: '继续保留',
      icon: 'alert'
    })
    if (!ok) return
    if (activeJobId) {
      try {
        await NT.api.call('export:cancel', activeJobId)
      } catch {
        /* ignore */
      }
      activeJobId = ''
      NT.ui.closeTopModal()
    }
    estimateToken += 1
    clearTimeout(estimateTimer)
    patchConvert({
      file: null,
      info: null,
      url: null,
      format: 'mp4',
      quality: 'balanced',
      outputPath: null,
      estimate: null,
      estimating: false
    })
    render()
  }

  function action(name, el) {
    if (name === 'convert-pick' || name === 'convert-change') {
      void pick()
    } else if (name === 'convert-clear') {
      void clearFile()
    } else if (name === 'convert-format') {
      const key = el.dataset.value
      const c = convert()
      if (key === 'mp3' && !hasAudio()) {
        toast('这个文件没有音频轨道')
        return
      }
      if (key !== 'mp3' && !hasVideo()) {
        toast('这个文件没有视频轨道')
        return
      }
      patchConvert({ format: key, outputPath: null, estimate: null, estimating: true })
      render()
      scheduleEstimate(60)
    } else if (name === 'convert-quality') {
      patchConvert({ quality: el.dataset.value, estimate: null, estimating: true })
      render()
      scheduleEstimate(60)
    } else if (name === 'convert-choose-output') {
      void chooseOutput()
    } else if (name === 'convert-export') {
      openExportConfirm()
    }
  }

  NT.Convert = {
    render,
    renderInto: (container) => render(container, { embedded: true }),
    pick,
    openPath,
    clear: clearFile,
    action,
    startExport,
    openExportConfirm
  }
})()
