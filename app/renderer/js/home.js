;(function () {
  const NT = (window.NT = window.NT || {})
  const { icon } = NT
  const { fmt } = NT

  const VIDEO_FORMATS = ['MP4', 'MOV', 'MKV', 'WEBM', 'AVI', 'M4V', 'FLV', 'TS']
  const TOOLS = [
    { key: 'video', label: '视频裁剪', icon: 'film' },
    { key: 'hub', label: '解析转换', icon: 'refresh' },
    { key: 'mcsounds', label: 'MC音效', icon: 'wave' }
  ]

  function renderRail() {
    const rail = document.getElementById('rail')
    if (!rail) return
    const active = NT.state.homeTool || 'video'
    const app = NT.state.app || {}
    const version = `${app.version || '1.5.3'}${app.edition ? ' ' + app.edition : ''}`
    rail.innerHTML = `<nav class="rail-nav">
        ${TOOLS.map(
          (tool, index) => `<button class="rail-item${active === tool.key ? ' active' : ''}" data-rail="${
            tool.key
          }" style="--i:${index}" type="button">
            <span class="rail-icon">${icon(tool.icon, 18)}</span>
            <span class="rail-label">${tool.label}</span>
          </button>`
        ).join('')}
      </nav>
      <div class="rail-bottom">
        <button class="rail-item" data-action="memory" type="button">
          <span class="rail-icon">${icon('memory', 18)}</span>
          <span class="rail-label">内存</span>
        </button>
        <button class="rail-item${active === 'settings' ? ' active' : ''}" data-rail="settings" type="button">
          <span class="rail-icon">${icon('settings', 18)}</span>
          <span class="rail-label">设置</span>
        </button>
        <div class="rail-foot">v${fmt.escapeHtml(version)}</div>
      </div>`
  }

  function recentPanelRow(file, index) {
    const meta = [
      file.duration ? fmt.formatShort(file.duration) : '',
      file.width && file.height ? fmt.resolutionLabel(file.width, file.height) : ''
    ]
      .filter(Boolean)
      .join(' · ')
    return `<button class="picker-recent-item" data-recent="${fmt.escapeHtml(
      file.path
    )}" style="--i:${index}" type="button">
      <span class="picker-recent-icon">${icon('film', 13)}</span>
      <span class="picker-recent-main">
        <span class="picker-recent-name">${fmt.escapeHtml(file.name)}</span>
        <span class="picker-recent-meta">${fmt.escapeHtml(meta)}</span>
      </span>
      <span class="picker-recent-arrow">${icon('arrowRight', 12)}</span>
    </button>`
  }

  function wireFolder(folder, recentCount) {
    if (!folder) return
    const panel = folder.querySelector('.picker-recent-panel')
    if (!panel) return
    let open = false
    const setOpen = (next) => {
      if (open === next) return
      open = next
      folder.classList.toggle('revealed', next)
      folder.setAttribute('aria-expanded', next ? 'true' : 'false')
      panel.inert = !next
    }
    folder.addEventListener('pointerenter', () => setOpen(true))
    folder.addEventListener('pointerleave', () => setOpen(false))
    folder.addEventListener('focusin', () => setOpen(true))
    folder.addEventListener('focusout', (e) => {
      if (!folder.contains(e.relatedTarget)) setOpen(false)
    })
    folder.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target === folder) {
        e.preventDefault()
        folder.click()
      }
    })
  }

  function renderPicker(view) {
    const seen = new Set()
    const recent = (NT.state.recent || [])
      .filter((file) => {
        if (!file || !file.path) return false
        const key = String(file.path).replace(/\//g, '\\').toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, 4)
    const panel = `<div class="picker-recent-panel" inert>
      <div class="picker-recent-head"><span>最近打开</span><span>${recent.length}</span></div>
      ${
        recent.length
          ? `<div class="picker-recent-list">${recent.map(recentPanelRow).join('')}</div>`
          : `<div class="picker-recent-empty">
              <span class="picker-recent-empty-icon">${icon('film', 20)}</span>
              <b>还没有最近打开的视频</b>
              <span>打开一个视频后会出现在这里</span>
            </div>`
      }
    </div>`

    view.className = 'view picker-view'
    view.innerHTML = `<div class="picker-page">
      <div class="picker-stage">
        <div class="picker-folder has-recent${recent.length ? '' : ' is-empty'}" data-action="open-file" role="button" tabindex="0" aria-label="选择视频" aria-expanded="false">
          <span class="picker-sheet one"></span>
          <span class="picker-sheet two"></span>
          <span class="picker-folder-body">
            <span class="folder-glyph">${icon('folder', 58)}</span>
            ${panel}
          </span>
        </div>
      </div>
      <div class="picker-formats">
        ${VIDEO_FORMATS.map((f, i) => `<span style="--i:${i}">${f}</span>`).join('')}
      </div>
    </div>`

    const folder = view.querySelector('.picker-folder')
    if (folder) wireFolder(folder, recent.length)
  }

  function renderHome() {
    const view = document.getElementById('view')
    if (!view) return
    if (NT.setLayoutMode) NT.setLayoutMode('home')
    renderRail()
    if (NT.state.homeTool === 'hub' && NT.Hub) {
      NT.Hub.render(view)
      return
    }
    if (NT.state.homeTool === 'settings' && NT.SettingsPage) {
      NT.SettingsPage.render(view)
      return
    }
    if (NT.state.homeTool === 'mcsounds' && NT.MCSounds) {
      NT.MCSounds.render(view)
      return
    }
    renderPicker(view)
  }

  NT.renderHome = renderHome
})()
