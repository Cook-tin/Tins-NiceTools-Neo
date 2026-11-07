;(function () {
  const NT = (window.NT = window.NT || {})
  const { icon } = NT
  const { fmt } = NT
  const { openModal, toast } = NT.ui

  function setText(id, text) {
    const el = document.getElementById(id)
    if (el) el.textContent = text
  }

  function setHtml(id, html) {
    const el = document.getElementById(id)
    if (el) el.innerHTML = html
  }

  function ringOffset(progress) {
    const circumference = 2 * Math.PI * 33
    return String(circumference * (1 - Math.max(0, Math.min(1, progress))))
  }

  function setRing(progress) {
    const fg = document.querySelector('#export-ring .ring-fg')
    if (fg) fg.style.strokeDashoffset = ringOffset(progress)
  }

  function openExportModal(jobId, spec, opts) {
    const options = opts || {}
    const isConvert = Boolean(spec && spec.kind === 'transcode')
    let settled = false
    let currentPhase = 'preparing'

    const modal = openModal(
      `<div class="export-ring" id="export-ring">
        <svg viewBox="0 0 74 74">
          <circle class="ring-bg" cx="37" cy="37" r="33"></circle>
          <circle class="ring-fg" cx="37" cy="37" r="33" stroke-dasharray="207.345" stroke-dashoffset="207.345"></circle>
        </svg>
        <div class="ring-icon" id="export-ring-icon">${icon('download', 22)}</div>
      </div>
      <h2 class="export-title" id="export-title">正在导出</h2>
      <p class="export-sub" id="export-sub">准备中…</p>
      <div class="export-stats" id="export-stats">
        <div class="export-stat"><b id="export-speed">—</b><span>速度</span></div>
        <div class="export-stat"><b id="export-eta">—</b><span>剩余</span></div>
        <div class="export-stat"><b id="export-size">—</b><span>时长</span></div>
      </div>
      <div class="export-bar"><span id="export-bar-fill"></span></div>
      <div class="export-pct" id="export-pct">0%</div>
      <div id="export-result"></div>
      <div class="modal-actions" id="export-actions">
        <button class="btn btn-ghost" data-cancel type="button">取消</button>
      </div>`,
      { className: 'narrow export-modal', closable: false }
    )

    let cleaned = false
    let finished = false
    let unsubscribe = () => {}

    function handleProgress(p) {
      if (!p || p.jobId !== jobId || finished) return
      if (p.phase === 'done') {
        finished = true
        settled = true
        showSuccess(p)
        return
      }
      if (p.phase === 'error') {
        finished = true
        settled = true
        showError(p)
        return
      }
      if (p.phase === 'cancelled') {
        finished = true
        cleaned = true
        unsubscribe()
        modal.close(true)
        toast('已取消导出')
        return
      }
      currentPhase = p.phase
      const progress = Math.max(0, Math.min(1, Number(p.progress) || 0))
      setRing(progress)
      const pct = Math.round(progress * 100)
      setText('export-pct', `${pct}%`)
      const fill = document.getElementById('export-bar-fill')
      if (fill) fill.style.width = `${progress * 100}%`
      const titles = {
        preparing: isConvert ? '正在准备转换' : '正在准备',
        extracting: '正在提取片段',
        encoding: isConvert ? '正在转换' : '正在导出',
        concat: '正在拼接',
        finalizing: '正在完成'
      }
      setText('export-title', titles[p.phase] || (isConvert ? '正在转换' : '正在导出'))
      setText('export-sub', p.message || '正在处理…')
      setText('export-speed', p.speed ? fmt.formatSpeed(p.speed) : '—')
      setText('export-eta', p.eta !== undefined ? fmt.formatEta(p.eta) : '—')
      if (spec && spec.sources && spec.sources.length) {
        const dur = spec.sources.reduce((sum, s) => sum + Math.max(0, s.out - s.in), 0)
        setText('export-size', dur ? fmt.formatShort(dur) : '—')
      }
    }

    unsubscribe = NT.api.on('export:progress', handleProgress)
    NT.api
      .call('export:status', jobId)
      .then((last) => {
        if (last) handleProgress(last)
      })
      .catch(() => {})

    function cleanup() {
      if (cleaned) return
      cleaned = true
      unsubscribe()
    }

    function showSuccess(p) {
      setRing(1)
      setText('export-pct', '100%')
      const fill = document.getElementById('export-bar-fill')
      if (fill) fill.style.width = '100%'
      setText('export-title', isConvert ? '转换完成' : '导出完成')
      setText(
        'export-sub',
        p.message && p.message !== '导出完成' ? p.message : '文件已保存'
      )
      setHtml('export-ring-icon', icon('check', 24))
      document.getElementById('export-ring').classList.add('done')
      const outputs = p.outputs || []
      const count = outputs.length
      const firstName = outputs[0] ? outputs[0].split(/[\\/]/).pop() : '输出文件'
      const folder = outputs[0] ? outputs[0].replace(/[\\/][^\\/]+$/, '') : ''
      const resultHtml = `<div class="export-result">
        <span class="file-icon">${icon(
          count > 1 ? 'layers' : isConvert && spec && spec.container === 'mp3' ? 'music' : 'film',
          17
        )}</span>
        <span class="file-main">
          <span class="file-name">${fmt.escapeHtml(
            count > 1 ? `${count} 个文件` : firstName
          )}</span>
          <span class="file-meta">${p.outputBytes ? fmt.formatBytes(p.outputBytes) : ''}${
            count === 1 ? ` · ${fmt.escapeHtml(folder)}` : ''
          }</span>
        </span>
      </div>`
      setHtml('export-result', resultHtml)
      setHtml(
        'export-actions',
        `${count === 1 ? `<button class="btn btn-secondary" data-open-file type="button">${icon('external', 14)} 打开文件</button>` : ''}
         <button class="btn btn-secondary" data-show-folder type="button">${icon('folder', 14)} 打开文件夹</button>
         <button class="btn btn-primary" data-finish type="button">完成</button>`
      )
      const actions = document.getElementById('export-actions')
      actions.querySelector('[data-show-folder]').addEventListener('click', () => {
        if (outputs[0]) NT.api.call('shell:show', outputs[0]).catch(() => {})
      })
      const openBtn = actions.querySelector('[data-open-file]')
      if (openBtn) {
        openBtn.addEventListener('click', () => {
          if (outputs[0]) NT.api.call('shell:open', outputs[0]).catch((err) => toast(err.message, 'error'))
        })
      }
      actions.querySelector('[data-finish]').addEventListener('click', () => {
        cleanup()
        modal.close(true)
      })
      document.getElementById('export-stats').style.display = 'none'
      if (
        NT.state.settings &&
        NT.state.settings.openFolderAfterExport &&
        outputs[0]
      ) {
        setTimeout(() => {
          NT.api.call('shell:show', outputs[0]).catch(() => {})
        }, 350)
      }
      if (typeof options.onDone === 'function') {
        try {
          options.onDone({ outputs, bytes: p.outputBytes, message: p.message })
        } catch {
          /* ignore */
        }
      }
    }

    function showError(p) {
      setRing(0)
      setText('export-title', isConvert ? '转换失败' : '导出失败')
      setText('export-sub', p.message || '处理过程中出现错误')
      setHtml('export-ring-icon', icon('alert', 24))
      document.getElementById('export-ring').classList.add('error')
      setHtml(
        'export-result',
        `<div class="export-result"><span class="file-icon">${icon('alert', 16)}</span><span class="file-main"><span class="file-name">没有生成文件</span><span class="file-meta">可以查看日志了解技术细节</span></span></div>`
      )
      setHtml(
        'export-actions',
        `<button class="btn btn-secondary" data-log type="button">${icon('file', 14)} 查看日志</button>
         <button class="btn btn-primary" data-finish type="button">关闭</button>`
      )
      const actions = document.getElementById('export-actions')
      actions.querySelector('[data-log]').addEventListener('click', () => {
        NT.api.call('app:open-log').catch(() => {})
      })
      actions.querySelector('[data-finish]').addEventListener('click', () => {
        cleanup()
        modal.close(true)
      })
      document.getElementById('export-stats').style.display = 'none'
      document.getElementById('export-pct').style.display = 'none'
    }

    modal.modal.querySelector('[data-cancel]').addEventListener('click', () => {
      if (settled) return
      const btn = modal.modal.querySelector('[data-cancel]')
      if (btn) {
        btn.disabled = true
        btn.textContent = '正在取消…'
      }
      NT.api.call('export:cancel', jobId).catch(() => {})
    })

    // If the job completed before the modal was ready, ask the main process for
    // its last state by waiting for the next event. The progress events are
    // sent immediately after start, so in practice this listener is attached
    // before FFmpeg produces its first update.

    return modal
  }

  function ffmpegCardHtml(status) {
    if (!status || !status.connected) {
      return `<div class="ffmpeg-card">
        <span class="fc-icon">${icon('link', 17)}</span>
        <span class="fc-main">
          <span class="fc-title"><span class="badge-off"></span> 未连接</span>
          <span class="fc-path">需要 FFmpeg 才能读取和导出视频</span>
        </span>
      </div>`
    }
    return `<div class="ffmpeg-card">
      <span class="fc-icon">${icon('check', 16)}</span>
      <span class="fc-main">
        <span class="fc-title"><span class="badge-ok">${icon('check', 8)}</span> 已连接 FFmpeg</span>
        <span class="fc-path" title="${fmt.escapeHtml(status.ffmpegPath || '')}">${fmt.escapeHtml(
          status.version || ''
        )}</span>
      </span>
    </div>`
  }

  function openFfmpegSetup(opts) {
    const options = opts || {}
    const firstRun = Boolean(options.firstRun)
    let modalRef = null
    let unsubscribe = null
    let downloading = false

    const renderBody = () => {
      const status = NT.state.ffmpeg || {}
      if (status.connected) {
        return `<div class="modal-icon">${icon('check', 24)}</div>
          <h2>${firstRun ? '欢迎使用 NiceTools' : 'FFmpeg 已就绪'}</h2>
          <p class="lead">NiceTools 使用本地 FFmpeg 处理视频。所有文件都留在你的电脑上，不会被上传。</p>
          ${ffmpegCardHtml(status)}
          <div class="onboard-steps">
            <div class="onboard-step"><span class="onboard-num">1</span><span>拖入视频，设置入点和出点。</span></div>
            <div class="onboard-step"><span class="onboard-num">2</span><span>选择「原编码」即可无损秒出，或改用 H.264 精确导出。</span></div>
            <div class="onboard-step"><span class="onboard-num">3</span><span>导出完成后，可选择替换原视频（原文件移入回收站）。</span></div>
          </div>
          <div class="modal-actions">
            <button class="btn btn-ghost" data-close type="button">稍后</button>
            <button class="btn btn-primary" data-start type="button">开始剪辑</button>
          </div>`
      }
      return `<div class="modal-icon">${icon('download', 24)}</div>
        <h2>连接 FFmpeg</h2>
        <p class="lead">第一次使用需要连接 FFmpeg。你可以让 NiceTools 自动下载一份，或选择电脑上已有的 ffmpeg.exe。</p>
        ${ffmpegCardHtml(status)}
        <div class="onboard-steps">
          <div class="onboard-step"><span class="onboard-num">1</span><span>NiceTools 会下载官方 GPL 构建的 FFmpeg（约 200 MB）。</span></div>
          <div class="onboard-step"><span class="onboard-num">2</span><span>下载完成后自动解压、验证并连接。</span></div>
          <div class="onboard-step"><span class="onboard-num">3</span><span>之后完全离线可用。也可以随时在设置中更换版本。</span></div>
        </div>
        <div class="download-box" id="download-box" ${downloading ? '' : 'hidden'}>
          <div class="download-top"><span id="download-msg">正在连接…</span><span id="download-pct">0%</span></div>
          <div class="progress-track"><div class="progress-fill" id="download-fill"></div></div>
          <div class="download-meta"><span id="download-bytes">0 MB</span><button class="chip-btn" data-cancel-download type="button" style="height:20px">取消</button></div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-close type="button">稍后</button>
          <button class="btn btn-secondary" data-choose type="button">选择本地文件</button>
          <button class="btn btn-primary" data-download type="button">${icon('download', 14)} 自动下载</button>
        </div>
        <p class="field-help">下载源：GitHub / gyan.dev。FFmpeg 为 GPL 开源软件，NiceTools 仅在本机调用它。</p>`
    }

    const wire = () => {
      const m = modalRef.modal
      const start = m.querySelector('[data-start]')
      if (start) start.addEventListener('click', () => modalRef.close())
      m.querySelectorAll('[data-close]').forEach((btn) =>
        btn.addEventListener('click', () => modalRef.close())
      )
      const dl = m.querySelector('[data-download]')
      if (dl) {
        dl.addEventListener('click', async () => {
          downloading = true
          dl.disabled = true
          const box = document.getElementById('download-box')
          if (box) box.hidden = false
          try {
            await NT.api.call('ffmpeg:download')
          } catch (err) {
            downloading = false
            if (dl) dl.disabled = false
            toast(err.message, 'error')
          }
        })
      }
      const choose = m.querySelector('[data-choose]')
      if (choose) {
        choose.addEventListener('click', async () => {
          try {
            const status = await NT.api.call('ffmpeg:choose')
            NT.setState({ ffmpeg: status })
            if (status.connected) {
              toast('FFmpeg 已连接')
              rerender()
            }
          } catch (err) {
            toast(err.message, 'error')
          }
        })
      }
      const cancel = m.querySelector('[data-cancel-download]')
      if (cancel) {
        cancel.addEventListener('click', () => {
          NT.api.call('ffmpeg:cancel-download').catch(() => {})
        })
      }
    }

    const updateDownload = (status) => {
      if (!status) return
      const box = document.getElementById('download-box')
      if (box && status.downloading) box.hidden = false
      if (status.downloading) {
        downloading = true
        const pct = Math.max(0, Math.min(100, status.downloadPercent || 0))
        setText('download-msg', status.downloadMessage || '正在下载…')
        setText('download-pct', `${Math.round(pct)}%`)
        const fill = document.getElementById('download-fill')
        if (fill) fill.style.width = `${pct}%`
        setText(
          'download-bytes',
          `${fmt.formatBytes(status.downloadReceived || 0)} / ${fmt.formatBytes(status.downloadTotal || 0)}`
        )
      }
    }

    const rerender = () => {
      if (!modalRef) return
      modalRef.modal.innerHTML = `${renderBody()}`
      wire()
      updateDownload(NT.state.ffmpeg)
    }

    modalRef = openModal(renderBody(), {
      className: 'wide',
      closable: true,
      onClose: () => {
        if (unsubscribe) unsubscribe()
        if (firstRun && NT.markFirstRunDone) NT.markFirstRunDone()
      }
    })
    wire()

    unsubscribe = NT.api.on('ffmpeg:status', (status) => {
      NT.setState({ ffmpeg: status })
      updateDownload(status)
      if (!status.downloading && status.connected) {
        downloading = false
        rerender()
        toast('FFmpeg 已连接')
      }
    })
    NT.api.on('ffmpeg:download-error', (message) => {
      downloading = false
      const box = document.getElementById('download-box')
      if (box) {
        const msg = document.getElementById('download-msg')
        if (msg) msg.textContent = message || '下载失败'
      }
      const dl = document.querySelector('[data-download]')
      if (dl) dl.disabled = false
      toast(message || '下载失败', 'error')
    })
    return modalRef
  }

  function openSettings() {
    const s = NT.state.settings || {}
    const status = NT.state.ffmpeg || {}
    let modalRef = null
    const render = () => {
      const st = NT.state.settings || s
      const ff = NT.state.ffmpeg || status
      return `<button class="modal-close" data-modal-close type="button">${icon('x', 15)}</button>
        <h2>设置</h2>
        <p class="lead">NiceTools 的偏好设置保存在本机。</p>
        <div class="settings-block" style="border-top:0;padding-top:0;margin-top:0">
          <h3>FFmpeg</h3>
          ${ffmpegCardHtml(ff)}
          <div class="modal-actions" style="margin-top:8px">
            <button class="btn btn-secondary btn-sm" data-ff-choose type="button">更换 FFmpeg</button>
            <button class="btn btn-ghost btn-sm" data-ff-folder type="button">打开所在文件夹</button>
          </div>
        </div>
        <div class="settings-block">
          <h3>导出</h3>
          <div class="settings-row">
            <span class="sr-copy"><strong>默认格式</strong><span>新建任务时默认使用的导出方式</span></span>
            <select class="select" data-setting="defaultFormat">
              <option value="copy" ${st.defaultFormat === 'copy' ? 'selected' : ''}>原编码 · 极速</option>
              <option value="h264" ${st.defaultFormat === 'h264' ? 'selected' : ''}>MP4 · H.264</option>
            </select>
          </div>
          <div class="settings-row">
            <span class="sr-copy"><strong>默认画质</strong><span>H.264 精确导出的质量</span></span>
            <select class="select" data-setting="defaultQuality">
              <option value="high" ${st.defaultQuality === 'high' ? 'selected' : ''}>高质量</option>
              <option value="balanced" ${st.defaultQuality === 'balanced' ? 'selected' : ''}>平衡</option>
              <option value="small" ${st.defaultQuality === 'small' ? 'selected' : ''}>小体积</option>
            </select>
          </div>
          <div class="settings-row">
            <span class="sr-copy"><strong>编码器</strong><span>${
              ff.nvencAvailable ? '检测到 NVIDIA NVENC，可硬件加速' : '未检测到 NVENC，将使用 x264'
            }</span></span>
            <select class="select" data-setting="encoder">
              <option value="auto" ${st.encoder === 'auto' ? 'selected' : ''}>自动</option>
              <option value="nvenc" ${st.encoder === 'nvenc' ? 'selected' : ''}>硬件 NVENC</option>
              <option value="x264" ${st.encoder === 'x264' ? 'selected' : ''}>软件 x264</option>
            </select>
          </div>
          <div class="settings-row">
            <span class="sr-copy"><strong>网络优化</strong><span>MP4 写入 faststart，便于网页播放</span></span>
            <button class="switch${st.faststart !== false ? ' on' : ''}" data-toggle-setting="faststart" type="button"></button>
          </div>
          <div class="settings-row">
            <span class="sr-copy"><strong>默认替换原视频</strong><span>每次导出仍会再次确认</span></span>
            <button class="switch${st.replaceOriginal ? ' on' : ''}" data-toggle-setting="replaceOriginal" type="button"></button>
          </div>
          <div class="settings-row">
            <span class="sr-copy"><strong>导出后打开文件夹</strong><span>完成后自动在资源管理器中显示</span></span>
            <button class="switch${st.openFolderAfterExport ? ' on' : ''}" data-toggle-setting="openFolderAfterExport" type="button"></button>
          </div>
          <div class="settings-row">
            <span class="sr-copy"><strong>使用默认导出位置</strong><span>关闭时导出到当前视频所在文件夹</span></span>
            <button class="switch${st.useDefaultExportPath ? ' on' : ''}" data-toggle-setting="useDefaultExportPath" type="button"></button>
          </div>
          <div class="settings-row">
            <span class="sr-copy"><strong>默认导出位置</strong><span class="settings-path-modal" title="${fmt.escapeHtml(
              st.defaultExportPath || ''
            )}">${fmt.escapeHtml(st.defaultExportPath || '尚未选择文件夹')}</span></span>
            <button class="btn btn-ghost btn-sm" data-pick-default-dir type="button">${
              st.defaultExportPath ? '更改' : '选择'
            }</button>
          </div>
        </div>
        <div class="settings-block">
          <h3>关于</h3>
          <div class="settings-row">
            <span class="sr-copy"><strong>NiceTools Neo ${fmt.escapeHtml(
              (NT.state.app && NT.state.app.version) || '1.5.3'
            )}</strong><span>轻量视频工具容器 · MIT</span></span>
            <button class="btn btn-ghost btn-sm" data-about-log type="button">查看日志</button>
          </div>
          <div class="settings-row">
            <span class="sr-copy"><strong>FFmpeg</strong><span>${fmt.escapeHtml(
              ff.version || '未连接'
            )}</span></span>
            <button class="btn btn-ghost btn-sm" data-about-ff type="button">ffmpeg.org</button>
          </div>
          <div class="settings-row">
            <span class="sr-copy"><strong>本地处理</strong><span>视频不会离开这台电脑</span></span>
            <span class="badge-ok">${icon('check', 8)}</span>
          </div>
        </div>`
    }
    const wire = () => {
      const m = modalRef.modal
      m.querySelectorAll('[data-setting]').forEach((sel) => {
        sel.addEventListener('change', async () => {
          const key = sel.dataset.setting
          const value = sel.value
          const settings = await NT.api.call('settings:update', { [key]: value })
          NT.setState({ settings })
        })
      })
      m.querySelectorAll('[data-toggle-setting]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const key = btn.dataset.toggleSetting
          const current = NT.state.settings || {}
          if (
            key === 'useDefaultExportPath' &&
            !current[key] &&
            !current.defaultExportPath
          ) {
            try {
              const dir = await NT.api.call('dialog:choose-folder')
              if (!dir) return
              const settings = await NT.api.call('settings:update', {
                defaultExportPath: dir,
                useDefaultExportPath: true
              })
              NT.setState({ settings })
              if (NT.Editor && NT.Editor.refreshExport) NT.Editor.refreshExport()
              modalRef.close(true)
              openSettings()
            } catch (err) {
              toast(err.message, 'error')
            }
            return
          }
          const next = { ...current, [key]: !current[key] }
          const settings = await NT.api.call('settings:update', { [key]: next[key] })
          NT.setState({ settings })
          if (NT.Editor && NT.Editor.refreshExport) NT.Editor.refreshExport()
          btn.classList.toggle('on', Boolean(next[key]))
        })
      })
      const pickDefaultDir = m.querySelector('[data-pick-default-dir]')
      if (pickDefaultDir) {
        pickDefaultDir.addEventListener('click', async () => {
          try {
            const dir = await NT.api.call('dialog:choose-folder')
            if (!dir) return
            const settings = await NT.api.call('settings:update', {
              defaultExportPath: dir
            })
            NT.setState({ settings })
            if (NT.Editor && NT.Editor.refreshExport) NT.Editor.refreshExport()
            modalRef.close(true)
            openSettings()
          } catch (err) {
            toast(err.message, 'error')
          }
        })
      }
      const choose = m.querySelector('[data-ff-choose]')
      if (choose) {
        choose.addEventListener('click', async () => {
          try {
            const status = await NT.api.call('ffmpeg:choose')
            NT.setState({ ffmpeg: status })
            modalRef.close(true)
            openSettings()
          } catch (err) {
            toast(err.message, 'error')
          }
        })
      }
      const folder = m.querySelector('[data-ff-folder]')
      if (folder) {
        folder.addEventListener('click', () => {
          NT.api.call('ffmpeg:open-folder').catch(() => {})
        })
      }
      const log = m.querySelector('[data-about-log]')
      if (log) log.addEventListener('click', () => NT.api.call('app:open-log').catch(() => {}))
      const ff = m.querySelector('[data-about-ff]')
      if (ff) ff.addEventListener('click', () => NT.api.call('app:open-external', 'https://ffmpeg.org').catch(() => {}))
    }
    modalRef = openModal(render(), { className: 'wide', closable: true })
    wire()
    return modalRef
  }

  function showUpdateNotice(info) {
    const version = (info && info.version) || (NT.state.app && NT.state.app.version) || ''
    const zipPath = (info && info.zipPath) || ''
    const exists = Boolean(info && info.zipExists)
    const note = '更新包不会自动删除，需要删除的记得顺手删了哦'
    const missingNote = exists
      ? ''
      : '<p class="update-notice-note">本次更新包已被 1.5.1 更新器删除；从 1.5.2 起不会自动删除。</p>'
    const modalRef = openModal(
      `<button class="modal-close" data-modal-close type="button">${icon('x', 15)}</button>
        <div class="update-notice-mark">${icon('check', 20)}</div>
        <span class="update-notice-kicker">UPDATE COMPLETE</span>
        <h2>版本已升级至 v${fmt.escapeHtml(version)}</h2>
        <p class="lead">欢迎使用 NiceTools</p>
        <p class="update-notice-note">${fmt.escapeHtml(note)}</p>
        ${missingNote}
        <div class="modal-actions">
          <button class="btn btn-ghost" data-modal-close type="button">关闭</button>
          <button class="btn btn-secondary" data-open-update-package type="button" ${
            exists ? '' : 'disabled'
          }>打开更新包位置</button>
        </div>`,
      { className: 'narrow update-notice-modal', closable: true }
    )
    modalRef.modal.querySelectorAll('[data-modal-close]').forEach((button) => {
      button.addEventListener('click', () => modalRef.close())
    })
    const openPackage = modalRef.modal.querySelector('[data-open-update-package]')
    if (openPackage) {
      openPackage.addEventListener('click', async () => {
        if (!exists) return
        const ok = await NT.api.call('update:show-package', zipPath).catch(() => false)
        if (!ok) toast('更新包路径不存在，可能已经被移动或删除', 'error')
      })
    }
    return modalRef
  }

  NT.openExportModal = openExportModal
  NT.openFfmpegSetup = openFfmpegSetup
  NT.openSettings = openSettings
  NT.openAbout = openSettings
  NT.showUpdateNotice = showUpdateNotice
})()
