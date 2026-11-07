;(function () {
  const NT = (window.NT = window.NT || {})
  const { icon } = NT
  const { fmt } = NT
  const { openModal, toast } = NT.ui

  let modalRef = null
  let info = null
  let busy = false

  function memoryHtml() {
    const system = (info && info.system) || { total: 0, free: 0 }
    const appInfo = (info && info.app) || { workingSet: 0, privateBytes: 0, processes: 0 }
    const used = Math.max(0, system.total - system.free)
    const pct = system.total ? Math.min(100, Math.round((used / system.total) * 100)) : 0
    return `<button class="modal-close" data-modal-close type="button">${icon('x', 15)}</button>
      <span class="memory-kicker">MEMORY / LOCAL ONLY</span>
      <h2>内存优化</h2>
      <p class="lead">只整理 NiceTools 自身占用的内存，不需要管理员权限，不会关闭当前项目。</p>

      <div class="memory-meter">
        <div class="memory-meter-head"><span>系统内存</span><b>${pct}%</b></div>
        <div class="memory-meter-track"><span style="width:${pct}%"></span></div>
        <div class="memory-meter-foot">
          <span>已用 ${fmt.formatBytes(used)}</span>
          <span>可用 ${fmt.formatBytes(system.free)}</span>
          <span>总计 ${fmt.formatBytes(system.total)}</span>
        </div>
      </div>

      <div class="memory-cards">
        <div><span>NiceTools 工作集</span><b>${fmt.formatBytes(appInfo.workingSet || 0)}</b></div>
        <div><span>NiceTools 进程</span><b>${appInfo.processes || 0}</b></div>
        <div><span>安全模式</span><b>无管理员</b></div>
      </div>

      <p class="memory-note">会释放视频预览缓存、Chromium 可回收缓存，并整理 NiceTools 各进程的工作集。系统备用内存不会强制清空，清理后可用内存不一定明显增加，这是正常现象。</p>

      <div class="modal-actions memory-actions">
        <button class="btn btn-ghost" data-modal-close type="button">关闭</button>
        <button class="btn btn-primary" data-memory-optimize type="button" ${busy ? 'disabled' : ''}>
          ${icon('zap', 14)} ${busy ? '正在优化…' : '优化内存'}
        </button>
      </div>`
  }

  function render() {
    if (!modalRef) return
    modalRef.modal.innerHTML = memoryHtml()
    const close = modalRef.modal.querySelector('[data-modal-close]')
    if (close) close.addEventListener('click', () => modalRef.close())
    const button = modalRef.modal.querySelector('[data-memory-optimize]')
    if (button) button.addEventListener('click', () => void optimize())
  }

  async function refresh() {
    try {
      info = await NT.api.call('memory:info')
    } catch {
      info = null
    }
    render()
  }

  async function optimize() {
    if (busy) return
    busy = true
    render()
    try {
      if (typeof window.gc === 'function') {
        try {
          window.gc()
        } catch {
          /* ignore */
        }
      }
      const result = await NT.api.call('memory:optimize')
      const before = result && result.before && result.before.app ? result.before.app.workingSet : 0
      const after = result && result.after && result.after.app ? result.after.app.workingSet : 0
      const delta = Math.max(0, before - after)
      info = result && result.after ? result.after : null
      if (delta > 128 * 1024) {
        toast(`已整理 NiceTools 内存，工作集减少 ${fmt.formatBytes(delta)}`)
      } else {
        toast('内存已整理；系统缓存会在需要时自动回收')
      }
    } catch (err) {
      toast(err.message || '内存整理失败', 'error')
    } finally {
      busy = false
      await refresh()
    }
  }

  function open() {
    if (modalRef) {
      refresh()
      return
    }
    modalRef = openModal(memoryHtml(), {
      className: 'memory-modal',
      closable: true,
      onClose: () => {
        modalRef = null
      }
    })
    const close = modalRef.modal.querySelector('[data-modal-close]')
    if (close) close.addEventListener('click', () => modalRef.close())
    const button = modalRef.modal.querySelector('[data-memory-optimize]')
    if (button) button.addEventListener('click', () => void optimize())
    void refresh()
  }

  NT.Memory = { open }
})()
