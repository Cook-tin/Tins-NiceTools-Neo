;(function () {
  const NT = (window.NT = window.NT || {})
  const { icon } = NT
  const { fmt } = NT
  const { toast, confirmDialog } = NT.ui

  let updateState = { status: '', busy: false, result: null }
  let updateProgressBound = false

  function settings() {
    return NT.state.settings || {}
  }

  async function update(patch) {
    try {
      const next = await NT.api.call('settings:update', patch)
      NT.setState({ settings: next })
      if (NT.Editor && NT.Editor.refreshExport) NT.Editor.refreshExport()
      if (NT.renderTitlebar) NT.renderTitlebar(NT.state.screen)
      render()
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  async function clearRecent() {
    try {
      const list = await NT.api.call('recent:clear')
      const next = { ...(NT.state.settings || {}), recentFiles: list }
      NT.setState({ settings: next, recent: list })
      toast('最近打开已清除')
      render()
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  async function chooseFfmpeg() {
    try {
      const status = await NT.api.call('ffmpeg:choose')
      if (status) NT.setState({ ffmpeg: status })
      render()
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  async function chooseDefaultDir() {
    try {
      const dir = await NT.api.call('dialog:choose-folder')
      if (!dir) return
      await update({ defaultExportPath: dir, useDefaultExportPath: true })
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  function selectRow(label, hint, key, options) {
    const value = settings()[key]
    return `<label class="settings-row">
      <span class="settings-copy"><b>${label}</b><small>${hint}</small></span>
      <select class="settings-select" data-setting="${key}">
        ${options
          .map(
            ([v, text]) =>
              `<option value="${v}" ${value === v ? 'selected' : ''}>${text}</option>`
          )
          .join('')}
      </select>
    </label>`
  }

  function switchRow(label, hint, key) {
    const on = Boolean(settings()[key])
    return `<div class="settings-row">
      <span class="settings-copy"><b>${label}</b><small>${hint}</small></span>
      <button class="switch${on ? ' on' : ''}" data-toggle="${key}" aria-label="${label}" type="button"></button>
    </div>`
  }

  async function checkUpdate() {
    updateState = { status: '正在检查更新…', busy: true, result: null }
    render()
    try {
      const result = await NT.api.call('update:check')
      if (!result.configured) {
        updateState = {
          status: '尚未配置更新源，可以手动选择官方更新包。',
          busy: false,
          result
        }
      } else if (result.error) {
        updateState = { status: `检查失败：${result.error}`, busy: false, result }
      } else if (result.available) {
        updateState = {
          status: `发现新版本 ${result.latest}`,
          busy: false,
          result
        }
      } else {
        updateState = {
          status: `已是最新版本 ${result.current}`,
          busy: false,
          result
        }
      }
    } catch (err) {
      updateState = { status: err.message || '检查更新失败', busy: false, result: null }
    }
    render()
  }

  async function installUpdate() {
    const result = updateState.result
    if (!result || !result.available || !result.url) {
      toast('没有可用的更新地址')
      return
    }
    updateState = { ...updateState, busy: true, status: '正在下载更新包…' }
    render()
    try {
      const downloaded = await NT.api.call('update:download', {
        url: result.url,
        sha256: result.sha256
      })
      updateState = { ...updateState, status: '正在启动更新程序…' }
      render()
      await NT.api.call('update:install', downloaded.path)
    } catch (err) {
      updateState = { ...updateState, busy: false, status: `更新失败：${err.message}` }
      render()
    }
  }

  async function chooseUpdatePackage() {
    try {
      const zipPath = await NT.api.call('update:pick-package')
      if (!zipPath) return
      const ok = await confirmDialog({
        title: '安装更新包？',
        message: `将从<br><b>${fmt.escapeHtml(
          fmt.basename(zipPath)
        )}</b><br>更新当前 NiceTools。更新程序会关闭软件、替换文件并重新启动。`,
        confirmText: '安装更新',
        cancelText: '取消',
        icon: 'refresh'
      })
      if (!ok) return
      await NT.api.call('update:install', zipPath)
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  function bindUpdateProgress() {
    if (updateProgressBound) return
    updateProgressBound = true
    NT.api.on('update:progress', (p) => {
      if (!p) return
      const pct = Math.round((p.progress || 0) * 100)
      updateState = { ...updateState, status: `正在下载更新包… ${pct}%` }
      const el = document.querySelector('.update-status')
      if (el) el.textContent = updateState.status
    })
  }

  function render() {
    const target = document.getElementById('view')
    if (!target) return
    const ff = NT.state.ffmpeg || {}
    const app = NT.state.app || {}
    const versionLabel = `${app.version || '1.5.3'}${app.edition ? ' ' + app.edition : ''}`
    const engineKey = settings().engine === 'ffmpeg' ? 'ffmpeg' : 'litenx'
    const engineInfo = NT.state.engineInfo
    const recent = NT.state.recent || settings().recentFiles || []
    const caps = engineInfo
      ? [...(engineInfo.decode || []), ...(engineInfo.encode || [])].slice(0, 6)
      : []
    target.className = 'view settings-page-view'
    target.innerHTML = `<div class="settings-page">
      <header class="settings-head">
        <span class="settings-kicker">PREFERENCES</span>
        <h1>设置</h1>
        <p>所有设置保存在本机，不上传。</p>
      </header>

      <section class="settings-section">
        <div class="settings-section-head"><h2>处理引擎</h2><span>LiteNX / FFmpeg</span></div>
        <div class="engine-grid">
          <button class="engine-card${engineKey === 'litenx' ? ' active' : ''}" data-engine="litenx" type="button">
            <span class="engine-card-name">LiteNX${icon('zap', 13)}</span>
            <span class="engine-card-desc">FFmpeg + 硬件加速处理</span>
            <span class="engine-card-meta">${caps.length ? caps.join(' · ') : '正在检测 GPU 能力…'}</span>
          </button>
          <button class="engine-card${engineKey === 'ffmpeg' ? ' active' : ''}" data-engine="ffmpeg" type="button">
            <span class="engine-card-name">FFmpeg</span>
            <span class="engine-card-desc">标准兼容模式，CPU 处理优先</span>
            <span class="engine-card-meta">稳定 · 通用 · 兼容所有机器</span>
          </button>
        </div>
        <div class="engine-detail">
          <div class="engine-detail-row"><span>当前引擎</span><b>${engineKey === 'litenx' ? 'LiteNX' : 'FFmpeg'}</b></div>
          <div class="engine-detail-row"><span>底层</span><b>${fmt.escapeHtml(
            engineInfo && engineInfo.backend ? engineInfo.backend : ff.connected ? 'FFmpeg 已连接' : 'FFmpeg 未连接'
          )}</b></div>
          <div class="engine-detail-row"><span>预览</span><b>${fmt.escapeHtml(
            engineInfo && engineInfo.preview ? engineInfo.preview : 'Chromium GPU'
          )}</b></div>
          <div class="engine-detail-row"><span>硬件解码</span><b>${fmt.escapeHtml(
            engineInfo && engineInfo.decode && engineInfo.decode.length
              ? engineInfo.decode.join(' / ')
              : '自动 / 软件回退'
          )}</b></div>
          <div class="engine-detail-row"><span>硬件编码</span><b>${fmt.escapeHtml(
            engineInfo && engineInfo.encode && engineInfo.encode.length
              ? engineInfo.encode.join(' / ')
              : '自动 / 软件回退'
          )}</b></div>
        </div>
        <p class="engine-note">${fmt.escapeHtml(
          engineInfo && engineInfo.note
            ? engineInfo.note
            : 'LiteNX 会优先使用 GPU 解码与硬件编码；失败时自动回退到软件处理。'
        )}</p>
      </section>

      <section class="settings-section">
        <div class="settings-section-head"><h2>FFmpeg 运行时</h2><span>已随 LiteNX 内置</span></div>
        <div class="settings-ffmpeg">
          <span class="settings-ffmpeg-icon">${icon(ff.connected ? 'check' : 'alert', 18)}</span>
          <span class="settings-ffmpeg-main">
            <b>${ff.connected ? 'FFmpeg 已就绪' : 'FFmpeg 尚未就绪'}</b>
            <small>${ff.connected ? fmt.escapeHtml(ff.version || '') : '请检查软件目录中的 FFmpeg'}</small>
          </span>
          <button class="btn btn-secondary btn-sm" data-settings-action="choose-ffmpeg" type="button">更换</button>
          <button class="btn btn-ghost btn-sm" data-settings-action="open-ffmpeg" type="button">打开所在文件夹</button>
        </div>
      </section>

      <section class="settings-section">
        <div class="settings-section-head"><h2>导出</h2><span>新视频的默认值</span></div>
        ${selectRow('默认格式', '新建任务默认使用的导出方式', 'defaultFormat', [
          ['copy', '原编码 · 极速'],
          ['h264', 'H.264 · 精确']
        ])}
        ${selectRow('默认画质', 'H.264 精确导出的质量', 'defaultQuality', [
          ['high', '高质量'],
          ['balanced', '平衡'],
          ['small', '小体积']
        ])}
        ${selectRow('编码器', '优先使用硬件或软件编码', 'encoder', [
          ['auto', '自动'],
          ['nvenc', 'NVIDIA NVENC'],
          ['qsv', 'Intel QSV'],
          ['software', '软件 x264']
        ])}
        ${switchRow('网络优化', 'MP4 写入 faststart，便于网页播放', 'faststart')}
        ${switchRow('默认替换原视频', '每次导出仍会再次确认', 'replaceOriginal')}
        ${switchRow('导出后打开文件夹', '完成后自动在资源管理器中显示', 'openFolderAfterExport')}
        ${switchRow('使用默认导出位置', '关闭时导出到当前视频所在文件夹', 'useDefaultExportPath')}
        <div class="settings-row settings-path-row">
          <span class="settings-copy">
            <b>默认导出位置</b>
            <small class="settings-path-value" title="${fmt.escapeHtml(settings().defaultExportPath || '')}">${fmt.escapeHtml(
              settings().defaultExportPath || '尚未选择文件夹'
            )}</small>
          </span>
          <button class="btn btn-secondary btn-sm" data-settings-action="pick-default-dir" type="button">${
            settings().defaultExportPath ? '更改' : '选择文件夹'
          }</button>
        </div>
      </section>

      <section class="settings-section">
        <div class="settings-section-head"><h2>最近打开</h2><span>最多保留 4 项</span></div>
        <div class="settings-recent-head">
          <span>${recent.length ? `当前 ${recent.length} 项` : '还没有最近打开'}</span>
          <button class="btn btn-secondary btn-sm" data-settings-action="clear-recent" type="button" ${
            recent.length ? '' : 'disabled'
          }>清除最近打开</button>
        </div>
        ${
          recent.length
            ? `<div class="settings-recent-list">${recent
                .map(
                  (file) =>
                    `<div class="settings-recent-item"><span>${fmt.escapeHtml(
                      file.name || fmt.basename(file.path)
                    )}</span><small>${fmt.escapeHtml(fmt.dirname(file.path))}</small></div>`
                )
                .join('')}</div>`
            : ''
        }
      </section>

      <section class="settings-section">
        <div class="settings-section-head"><h2>更新</h2><span>当前 v${fmt.escapeHtml(
          versionLabel
        )}</span></div>
        <div class="settings-recent-head">
          <span>使用 NiceTools Neo 更新包</span>
          <button class="btn btn-secondary btn-sm" data-settings-action="choose-update" type="button">选择更新包</button>
        </div>
        <p class="engine-note">选择 ZIP 更新包后，更新程序会关闭软件、替换文件并重新启动。开源版更新包请从本项目的 GitHub Releases 获取，不要混用其他版本（含音频解析的自用版）的更新包。</p>
      </section>

      <section class="settings-section">
        <div class="settings-section-head"><h2>关于</h2><span>NiceTools Neo ${fmt.escapeHtml(versionLabel)}</span></div>
        <div class="settings-about">
          <div><span>版本</span><b>${fmt.escapeHtml(versionLabel)}</b></div>
          <div><span>许可</span><b>MIT</b></div>
          <div><span>处理方式</span><b>${engineKey === 'litenx' ? 'LiteNX 本地引擎' : 'FFmpeg 兼容模式'}</b></div>
        </div>
        <div class="settings-about-actions">
          <button class="btn btn-secondary btn-sm" data-settings-action="open-log" type="button">${icon(
            'file',
            13
          )} 查看日志</button>
          <button class="btn btn-ghost btn-sm" data-settings-action="open-ffmpeg-site" type="button">${icon(
            'external',
            13
          )} FFmpeg 官网</button>
        </div>
      </section>
    </div>`

    target.querySelectorAll('[data-engine]').forEach((el) => {
      el.addEventListener('click', () => {
        const engine = el.dataset.engine === 'ffmpeg' ? 'ffmpeg' : 'litenx'
        if (engine === engineKey) return
        void update({ engine })
      })
    })
    target.querySelectorAll('[data-setting]').forEach((el) => {
      el.addEventListener('change', () => {
        const key = el.dataset.setting
        const value = el.value
        void update({ [key]: value })
      })
    })
    target.querySelectorAll('[data-toggle]').forEach((el) => {
      el.addEventListener('click', () => {
        const key = el.dataset.toggle
        if (
          key === 'useDefaultExportPath' &&
          !settings()[key] &&
          !settings().defaultExportPath
        ) {
          void chooseDefaultDir()
          return
        }
        void update({ [key]: !settings()[key] })
      })
    })
    target.querySelectorAll('[data-settings-action]').forEach((el) => {
      el.addEventListener('click', () => {
        const action = el.dataset.settingsAction
        if (action === 'choose-ffmpeg') void chooseFfmpeg()
        else if (action === 'open-ffmpeg') NT.api.call('ffmpeg:open-folder').catch(() => {})
        else if (action === 'open-log') NT.api.call('app:open-log').catch(() => {})
        else if (action === 'open-ffmpeg-site')
          NT.api.call('app:open-external', 'https://ffmpeg.org').catch(() => {})
        else if (action === 'clear-recent') void clearRecent()
        else if (action === 'choose-update') void chooseUpdatePackage()
        else if (action === 'pick-default-dir') void chooseDefaultDir()
      })
    })
    if (!NT.state.engineInfo && !window.__engineInfoLoading) {
      window.__engineInfoLoading = true
      NT.api
        .call('engine:info')
        .then((info) => {
          NT.setState({ engineInfo: info })
        })
        .catch(() => {})
        .finally(() => {
          window.__engineInfoLoading = false
        })
    }
  }

  NT.SettingsPage = { render }
})()
