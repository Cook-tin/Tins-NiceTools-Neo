;(function () {
  const NT = (window.NT = window.NT || {})
  const { icon } = NT
  const { fmt } = NT
  const { toast, openModal, closeAllModals, confirmDialog } = NT.ui

  const state = NT.state
  let ffmpegWarned = false
  let dragDepth = 0
  let pendingOpenPath = null
  let booted = false

  window.addEventListener('error', (event) => {
    console.error('[NiceTools] renderer error', event.error || event.message)
  })
  window.addEventListener('unhandledrejection', (event) => {
    console.error('[NiceTools] unhandled rejection', event.reason)
  })

  const MEDIA_EXTS = new Set([
    'mp4',
    'mov',
    'mkv',
    'webm',
    'avi',
    'm4v',
    'ts',
    'mts',
    'm2ts',
    'flv',
    'wmv',
    'mpg',
    'mpeg',
    '3gp',
    'ogv',
    'mp3',
    'm4a',
    'aac',
    'wav',
    'flac',
    'ogg',
    'opus',
    'wma',
    'aiff',
    'aif'
  ])

  const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'avif', 'heic', 'tif', 'tiff'])

  function isMediaPath(p) {
    const ext = String(p || '').split('.').pop().toLowerCase()
    return MEDIA_EXTS.has(ext)
  }

  function isImagePath(p) {
    const ext = String(p || '').split('.').pop().toLowerCase()
    return IMAGE_EXTS.has(ext)
  }

  function appShell() {
    const app = document.getElementById('app')
    app.innerHTML = `<header class="titlebar" id="titlebar"></header>
      <div class="app-body" id="app-body">
        <aside class="rail" id="rail" aria-label="工具"></aside>
        <main class="view" id="view"></main>
      </div>`
    const dropIcon = document.getElementById('drop-icon')
    if (dropIcon) dropIcon.innerHTML = NT.icon('film', 28)
  }

  function setLayoutMode(mode) {
    const body = document.getElementById('app-body')
    const rail = document.getElementById('rail')
    const immersive = mode === 'editor' || mode === 'image'
    if (body) body.classList.toggle('is-immersive', immersive)
    if (rail) rail.hidden = immersive
  }

  function estimateLabel() {
    const est = NT.state.estimate
    if (!est) return '≈ —'
    const bytes = fmt.splitBytes(est.bytes)
    return `≈ ${bytes.value} ${bytes.unit}`
  }

  function engineName() {
    return NT.state.settings && NT.state.settings.engine === 'ffmpeg' ? 'FFmpeg' : 'LiteNX'
  }

  function ffmpegChip() {
    const status = NT.state.ffmpeg || {}
    const engine = engineName()
    if (status.downloading) {
      const pct = Math.round(status.downloadPercent || 0)
      return `<button class="status-chip" data-action="ffmpeg" type="button"><span class="status-dot busy"></span>下载 FFmpeg ${pct}%</button>`
    }
    return `<button class="status-chip" data-action="ffmpeg" type="button"><span class="status-dot${
      status.connected ? '' : ' off'
    }"></span>${status.connected ? `${engine} 已连接` : `连接 ${engine}`}</button>`
  }

  function metaText(info) {
    if (!info) return ''
    const parts = [fmt.formatShort(info.duration)]
    if (info.video) {
      parts.push(`${info.video.displayWidth}×${info.video.displayHeight}`)
      parts.push(NT.codecLabel(info))
    } else {
      parts.push('音频')
    }
    return parts.filter(Boolean).join(' · ')
  }

  function renderTitlebar(screen) {
    const tb = document.getElementById('titlebar')
    if (!tb) return
    const appInfo = NT.state.app || {}
    const version = `${appInfo.version || '1.5.3'}${appInfo.edition ? ' ' + appInfo.edition : ''}`
    if (screen === 'editor' && NT.state.project) {
      const ff = NT.state.ffmpeg || {}
      tb.innerHTML = `<button class="tb-back" data-nav="back" aria-label="返回首页" type="button">${icon(
        'chevronLeft',
        17
      )}</button>
      <div class="tb-center">
        <span class="tb-title">${fmt.escapeHtml(NT.state.project.info.name)}</span>
        <span class="tb-meta">${fmt.escapeHtml(metaText(NT.state.project.info))}</span>
      </div>
      <div class="tb-actions">
        <span class="tb-estimate${NT.state.estimating ? ' busy' : ''}" id="tb-estimate">${estimateLabel()}</span>
        <button class="btn btn-primary tb-export" id="tb-export" data-action="open-export" type="button">${icon(
          'download',
          14
        )} ${ff.connected ? '导出' : `连接 ${engineName()}`}</button>
      </div>`
    } else if (screen === 'image' && NT.state.image) {
      tb.innerHTML = `<button class="tb-back" data-nav="back" aria-label="返回工具首页" type="button">${icon(
        'chevronLeft',
        17
      )}</button>
      <div class="tb-center">
        <span class="tb-title">${fmt.escapeHtml(NT.state.image.name)}</span>
        <span class="tb-meta">图片 · 图像裁剪</span>
      </div>
      <div class="tb-actions">
        <button class="btn btn-secondary btn-sm" data-action="change-image" type="button">${icon(
          'imageCrop',
          13
        )} 换一张</button>
        <button class="icon-btn" data-action="settings" aria-label="设置" type="button">${icon(
          'settings',
          17
        )}</button>
      </div>`
    } else {
      tb.innerHTML = `<div class="brand">
        <img class="brand-logo" src="./assets/logo.png" alt="NiceTools Neo" />
        <span class="brand-name">NiceTools Neo</span>
        <span class="brand-ver">v${fmt.escapeHtml(version)}</span>
      </div>
      <div class="tb-center"></div>
      <div class="tb-actions">
        ${ffmpegChip()}
      </div>`
    }
  }

  function rememberRecent(settings) {
    if (!settings) return
    NT.setState({ settings, recent: settings.recentFiles || [] })
  }

  async function refreshRecent() {
    try {
      const settings = await NT.api.call('settings:get')
      rememberRecent(settings)
      if (NT.state.screen === 'home') NT.renderHome()
    } catch {
      /* ignore */
    }
  }

  function waitForFfmpeg(ms) {
    if (NT.state.ffmpeg && NT.state.ffmpeg.connected) return Promise.resolve(true)
    return new Promise((resolve) => {
      let done = false
      const unsub = NT.api.on('ffmpeg:status', (status) => {
        if (status && status.connected && !done) {
          done = true
          unsub()
          resolve(true)
        }
      })
      setTimeout(() => {
        if (done) return
        done = true
        unsub()
        resolve(Boolean(NT.state.ffmpeg && NT.state.ffmpeg.connected))
      }, ms === undefined ? 3500 : ms)
    })
  }

  async function openMedia(path, opts) {
    if (!path) return
    const options = opts || {}
    let pendingMode = options.mode || NT.state.pendingMode || 'trim'
    let pendingAudio = options.audioAction || NT.state.pendingAudioAction || null
    const ready = await waitForFfmpeg(3500)
    if (!ready) {
      toast('请先连接 FFmpeg', 'error')
      NT.openFfmpegSetup()
      return
    }
    if (NT.state.homeTool === 'mcsounds' && NT.MCSounds?.destroy) {
      NT.MCSounds.destroy()
    }
    NT.setState({ homeTool: 'video', pendingMode, pendingAudioAction: pendingAudio })
    NT.ui.busy(true, '正在读取媒体信息…')
    try {
      const res = await NT.api.call('media:open', path)
      if (!res.info.hasVideo && ['multi', 'crop', 'gif'].includes(pendingMode)) {
        toast('该工具需要视频文件，已切换到裁剪模式')
        pendingMode = 'trim'
        pendingAudio = null
      }
      const settings = await NT.api.call('settings:get')
      rememberRecent(settings)
      NT.resetForMedia(res.info, pendingMode, res.url)
      NT.setState({ screen: 'editor', pendingMode: null, pendingAudioAction: null })
      setLayoutMode('editor')
      renderTitlebar('editor')
      document.title = `${res.info.name} — NiceTools Neo`
      NT.Editor.mount()
      if (options.extraPaths && options.extraPaths.length) {
        await addClips(options.extraPaths.filter((p) => p !== path))
      }
      if (NT.state.mode === 'multi' && NT.state.multiClips.length === 0) {
        await addClips([path])
      }
    } catch (err) {
      toast(err.message || '无法打开文件', 'error')
    } finally {
      NT.ui.busy(false)
    }
  }

  function openConverterWithFile(filePath, options = {}) {
    if (!filePath) return
    NT.setState({ screen: 'home', homeTool: 'hub', hubTab: 'convert' })
    setLayoutMode('home')
    renderTitlebar('home')
    NT.renderHome()
    requestAnimationFrame(() => {
      if (NT.Convert && NT.Convert.openPath) {
        void NT.Convert.openPath(filePath, {
          preferredFormat: options.preferredFormat || 'm4a'
        })
      }
    })
  }

  async function openMediaDialog(mode, audioAction) {    if (!NT.state.ffmpeg || !NT.state.ffmpeg.connected) {
      if (NT.state.settings && NT.state.settings.firstRunDone) {
        toast('请先连接 FFmpeg', 'error')
      }
      NT.openFfmpegSetup()
      return
    }
    try {
      const paths = await NT.api.call('dialog:open-media')
      if (!paths || !paths.length) return
      if (paths.length > 1) {
        await openMedia(paths[0], { mode: 'multi', extraPaths: paths.slice(1) })
      } else {
        await openMedia(paths[0], { mode: mode || 'trim', audioAction })
      }
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  async function openImage(path) {
    if (!path) return
    if (!NT.Image) {
      toast('图像工具尚未加载', 'error')
      return
    }
    if (NT.state.homeTool === 'mcsounds' && NT.MCSounds?.destroy) {
      NT.MCSounds.destroy()
    }
    NT.setState({ homeTool: 'image' })
    NT.ui.busy(true, '正在读取图片…')
    try {
      const res = await NT.api.call('image:open', path)
      NT.setState({ screen: 'image', image: res })
      setLayoutMode('image')
      renderTitlebar('image')
      document.title = `${res.name} — NiceTools Neo`
      NT.Image.mount(res)
    } catch (err) {
      toast(err.message || '无法打开图片', 'error')
    } finally {
      NT.ui.busy(false)
    }
  }

  async function openImageDialog() {
    try {
      const paths = await NT.api.call('dialog:open-image')
      if (paths && paths.length) await openImage(paths[0])
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  async function addClips(paths) {
    if (!paths || !paths.length) return
    if (!NT.state.project) {
      await openMedia(paths[0], { mode: 'multi', extraPaths: paths.slice(1) })
      return
    }
    const existing = [...(NT.state.multiClips || [])]
    if (!existing.length && NT.state.project.info) {
      const info = NT.state.project.info
      existing.push({
        path: info.path,
        info,
        name: info.name,
        duration: info.duration,
        in: 0,
        out: info.duration,
        url: NT.state.project.url || ''
      })
    }
    const added = []
    for (const path of paths) {
      try {
        const info = await NT.api.call('media:probe', path)
        if (!info.hasVideo) {
          toast(`${fmt.basename(path)} 没有视频轨道，无法拼接`)
          continue
        }
        let url = ''
        try {
          url = await NT.api.call('media:url', path)
        } catch {
          /* ignore */
        }
        added.push({
          path,
          info,
          name: info.name,
          duration: info.duration,
          in: 0,
          out: info.duration,
          url
        })
      } catch (err) {
        toast(`${fmt.basename(path)}：${err.message}`, 'error')
      }
    }
    if (!added.length) return
    const clips = [...existing, ...added]
    const patch = {
      mode: 'multi',
      multiClips: clips,
      includeVideo: true,
      activeClip: Math.min(NT.state.activeClip || 0, clips.length - 1)
    }
    if (NT.state.format === 'gif' || NT.state.format === 'audio') {
      patch.format = (NT.state.settings && NT.state.settings.defaultFormat) || 'copy'
      patch.outputPath = null
    }
    NT.setState(patch)
    if (NT.Editor && NT.state.screen === 'editor') NT.Editor.refresh()
    toast(`已添加 ${added.length} 个片段`)
  }

  async function openMultiDialog() {
    try {
      const paths = await NT.api.call('dialog:open-media')
      if (!paths || !paths.length) return
      if (!NT.state.project) {
        await openMedia(paths[0], { mode: 'multi', extraPaths: paths.slice(1) })
      } else {
        await addClips(paths)
      }
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  function goHome() {
    if (NT.Editor) NT.Editor.destroy()
    if (NT.Image && NT.Image.destroy) NT.Image.destroy()
    if (NT.state.homeTool === 'mcsounds' && NT.MCSounds?.destroy) NT.MCSounds.destroy()
    NT.ui.closeAllModals()
    NT.setState({
      screen: 'home',
      project: null,
      image: null,
      pendingMode: null,
      pendingAudioAction: null,
      estimate: null
    })
    setLayoutMode('home')
    renderTitlebar('home')
    NT.renderHome()
    document.title = 'NiceTools'
    void refreshRecent()
  }

  function markFirstRunDone() {
    const settings = NT.state.settings
    if (settings && settings.firstRunDone) return
    NT.api
      .call('settings:update', { firstRunDone: true })
      .then((next) => NT.setState({ settings: next }))
      .catch(() => {})
  }

  function selectHomeTool(tool) {
    if (!['video', 'hub', 'settings', 'mcsounds'].includes(tool)) return
    if (NT.state.homeTool === 'mcsounds' && tool !== 'mcsounds' && NT.MCSounds?.destroy) {
      NT.MCSounds.destroy()
    }
    NT.setState({ homeTool: tool, screen: 'home' })
    setLayoutMode('home')
    renderTitlebar('home')
    NT.renderHome()
  }

  function handleTool(key) {
    if (key === 'trim' || key === 'multi' || key === 'split' || key === 'crop' || key === 'gif') {
      NT.setState({ pendingMode: key, pendingAudioAction: null })
      void openMediaDialog(key)
    } else if (key === 'audio-extract') {
      NT.setState({ pendingAudioAction: 'extract' })
      void openMediaDialog('audio', 'extract')
    } else if (key === 'audio-trim') {
      NT.setState({ pendingAudioAction: 'trim' })
      void openMediaDialog('audio', 'trim')
    } else if (key === 'mute') {
      NT.setState({ pendingAudioAction: 'remove' })
      void openMediaDialog('audio', 'remove')
    }
  }

  function bindEvents() {
    document.addEventListener('click', (e) => {
      const railBtn = e.target.closest('[data-rail]')
      if (railBtn) {
        selectHomeTool(railBtn.dataset.rail)
        return
      }
      const nav = e.target.closest('[data-nav]')
      if (nav) {
        if (nav.dataset.nav === 'back') goHome()
        return
      }
      const tool = e.target.closest('[data-tool]')
      if (tool && !tool.disabled) {
        handleTool(tool.dataset.tool)
        return
      }
      const removeRecent = e.target.closest('[data-remove-recent]')
      if (removeRecent) {
        e.stopPropagation()
        const path = removeRecent.dataset.removeRecent
        NT.api
          .call('recent:remove', path)
          .then((list) => {
            const settings = { ...(NT.state.settings || {}), recentFiles: list }
            NT.setState({ recent: list, settings })
            NT.renderHome()
          })
          .catch(() => {})
        return
      }
      const recent = e.target.closest('[data-recent]')
      if (recent) {
        void openMedia(recent.dataset.recent, { mode: 'trim' })
        return
      }
      const actionEl = e.target.closest('[data-action]')
      if (actionEl) {
        const action = actionEl.dataset.action
        if (actionEl.tagName === 'A') e.preventDefault()
        if (action === 'open-file') void openMediaDialog()
        else if (action === 'open-multi') void openMultiDialog()
        else if (action === 'open-image') void openImageDialog()
        else if (action === 'change-image') void openImageDialog()
        else if (action === 'open-export') {
          if (!NT.state.ffmpeg || !NT.state.ffmpeg.connected) NT.openFfmpegSetup()
          else if (NT.Editor && NT.Editor.openExportSettings) NT.Editor.openExportSettings()
        }
        else if (action === 'settings' || action === 'about') NT.openSettings()
        else if (action === 'memory') {
          if (NT.Memory) NT.Memory.open()
        }
        else if (action === 'ffmpeg') NT.openFfmpegSetup()
        else if (action === 'change-video')
          void openMediaDialog(
            NT.state.mode === 'multi' ? 'trim' : NT.state.mode,
            NT.state.mode === 'audio' ? NT.state.audioAction : undefined
          )
        else if (action === 'reload') location.reload()
        else if (NT.Convert && NT.Convert.action && action.indexOf('convert-') === 0) {
          NT.Convert.action(action, actionEl)
        }
        return
      }
    })

    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey) {
        const target = e.target && e.target.closest ? e.target : document.body
        const editing =
          target &&
          (target.closest('input, textarea, select, [contenteditable="true"]') ||
            target.isContentEditable)
        const modalOpen = Boolean(document.querySelector('.overlay'))
        if (
          !editing &&
          !modalOpen &&
          NT.state.screen === 'editor' &&
          NT.History
        ) {
          const key = String(e.key || '').toLowerCase()
          if (key === 'z') {
            e.preventDefault()
            if (e.shiftKey) NT.History.redo()
            else NT.History.undo()
            return
          }
          if (key === 'y') {
            e.preventDefault()
            NT.History.redo()
            return
          }
        }
        if (e.key.toLowerCase() === 'o') {
          e.preventDefault()
          if (NT.state.screen === 'image') void openImageDialog()
          else if (NT.state.screen === 'home' && NT.state.homeTool === 'image') void openImageDialog()
          else if (NT.state.screen === 'home' && NT.state.homeTool === 'convert' && NT.Convert) NT.Convert.pick()
          else void openMediaDialog()
        } else if (e.key === ',') {
          e.preventDefault()
          NT.openSettings()
        }
      }
    })

    // Drag and drop
    document.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return
      e.preventDefault()
      dragDepth += 1
      const overlay = document.getElementById('drop-overlay')
      if (overlay) overlay.hidden = false
    })
    document.addEventListener('dragover', (e) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    })
    document.addEventListener('dragleave', (e) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return
      dragDepth = Math.max(0, dragDepth - 1)
      if (dragDepth === 0) {
        const overlay = document.getElementById('drop-overlay')
        if (overlay) overlay.hidden = true
      }
    })
    document.addEventListener('drop', async (e) => {
      if (!e.dataTransfer) return
      e.preventDefault()
      dragDepth = 0
      const overlay = document.getElementById('drop-overlay')
      if (overlay) overlay.hidden = true
      const files = Array.from(e.dataTransfer.files || [])
      const allPaths = files.map((f) => NT.api.pathForFile(f)).filter(Boolean)
      const paths = allPaths.filter((p) => isMediaPath(p))

      if (!paths.length) {
        toast('请拖入视频文件', 'error')
        return
      }
      if (NT.state.screen === 'editor' && NT.state.project) {
        const current = NT.state.project.info.name
        const ok = await confirmDialog({
          title: '导入其他视频？',
          message: `当前正在编辑 <b>${fmt.escapeHtml(
            current
          )}</b>。<br>导入其他视频会关闭当前工作台，当前编辑内容不会保存记录。`,
          confirmText: '导入其他视频',
          cancelText: '继续编辑',
          icon: 'film'
        })
        if (!ok) return
      }
      if (
        NT.state.screen === 'home' &&
        NT.state.homeTool === 'hub' &&
        NT.state.hubTab === 'convert' &&
        NT.Convert
      ) {
        await NT.Convert.openPath(paths[0])
        return
      }
      if (NT.state.screen === 'home' && NT.state.homeTool === 'settings') {
        toast('设置页不接收文件')
        return
      }
      await openMedia(paths[0], { mode: 'trim' })
      if (paths.length > 1) toast('已打开第一个文件')
    })
  }

  function handleFfmpegStatus(status) {
    if (!status) return
    NT.setState({ ffmpeg: status })
    renderTitlebar(NT.state.screen)
    if (status.connected) {
      NT.api
        .call('engine:info')
        .then((engineInfo) => {
          NT.setState({ engineInfo })
        })
        .catch(() => {})
    }
    if (NT.state.screen === 'editor' && NT.Editor) NT.Editor.refreshExport()
    if (!status.connected && !status.downloading && NT.state.settings && NT.state.settings.firstRunDone && !ffmpegWarned) {
      ffmpegWarned = true
    }
  }

  async function boot() {
    appShell()
    renderTitlebar('home')
    NT.renderHome()
    bindEvents()

    NT.api.on('app:open-file', (path) => {
      if (!path) return
      if (booted) void openMedia(path, { mode: 'trim' })
      else pendingOpenPath = path
    })

    try {
      const [appInfo, settings, ffmpeg, engineInfo] = await Promise.all([
        NT.api.call('app:info'),
        NT.api.call('settings:get'),
        NT.api.call('ffmpeg:status'),
        NT.api.call('engine:info').catch(() => null)
      ])
      NT.setState({
        app: appInfo,
        settings,
        ffmpeg,
        engineInfo,
        recent: settings.recentFiles || [],
        screen: 'home'
      })
      setLayoutMode('home')
      renderTitlebar('home')
      NT.renderHome()

      NT.api.on('ffmpeg:status', handleFfmpegStatus)
      NT.api.on('ffmpeg:download-done', (status) => {
        handleFfmpegStatus(status)
        toast('FFmpeg 下载完成')
      })
      NT.api.on('ffmpeg:download-error', (message) => {
        toast(message || 'FFmpeg 下载失败', 'error')
      })
      booted = true
      const startPath = pendingOpenPath
      pendingOpenPath = null
      if (startPath) {
        setTimeout(() => {
          void openMedia(startPath, { mode: 'trim' })
        }, 20)
      }

      if (!settings.firstRunDone && !startPath) {
        setTimeout(() => {
          if (NT.state.screen === 'home') NT.openFfmpegSetup({ firstRun: true })
        }, 420)
      }

      NT.api
        .call('update:notice')
        .then((notice) => {
          if (notice && NT.showUpdateNotice) NT.showUpdateNotice(notice)
        })
        .catch(() => {})
    } catch (err) {
      const view = document.getElementById('view')
      if (view) {
        view.className = 'view home-view'
        view.innerHTML = `<div class="home"><div class="recent-list" style="margin-top:40px;padding:28px"><div style="padding:24px;text-align:center">
          <div class="modal-icon" style="margin:0 auto 14px">${icon('alert', 22)}</div>
          <h2 style="margin:0 0 8px">无法启动 NiceTools</h2>
          <p style="font-size:12px;color:var(--text-2)">${fmt.escapeHtml(err.message || '未知错误')}</p>
          <button class="btn btn-primary" data-action="reload" style="margin-top:14px">重新加载</button>
        </div></div></div>`
      }
    }
  }

  NT.openMedia = openMedia
  NT.openMediaDialog = openMediaDialog
  NT.openConverterWithFile = openConverterWithFile
  NT.openImage = openImage
  NT.openImageDialog = openImageDialog
  NT.openMultiDialog = openMultiDialog
  NT.addClips = addClips
  NT.selectHomeTool = selectHomeTool
  NT.setLayoutMode = setLayoutMode
  NT.goHome = goHome
  NT.refreshRecent = refreshRecent
  NT.markFirstRunDone = markFirstRunDone
  NT.renderTitlebar = renderTitlebar
  NT.handleTool = handleTool

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
