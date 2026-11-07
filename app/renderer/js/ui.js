;(function () {
  const NT = (window.NT = window.NT || {})
  const { icon } = NT

  function toast(message, type, duration) {
    const root = document.getElementById('toast-root')
    if (!root) return
    const el = document.createElement('div')
    el.className = 'toast' + (type === 'error' ? ' error' : '')
    el.innerHTML = `${icon(type === 'error' ? 'alert' : 'check', 14)}<span>${NT.fmt.escapeHtml(
      message
    )}</span>`
    root.appendChild(el)
    const ms = duration === undefined ? (type === 'error' ? 4200 : 2600) : duration
    setTimeout(() => {
      el.classList.add('out')
      setTimeout(() => el.remove(), 220)
    }, ms)
  }

  let modalStack = []

  function openModal(html, opts) {
    const options = opts || {}
    const root = document.getElementById('overlay-root')
    const overlay = document.createElement('div')
    overlay.className = 'overlay'
    overlay.innerHTML = `<div class="modal ${options.className || ''}" role="dialog" aria-modal="true">${html}</div>`
    root.appendChild(overlay)
    const modal = overlay.firstElementChild

    const entry = {
      overlay,
      modal,
      closed: false,
      closable: options.closable !== false,
      close(silent) {
        if (entry.closed) return
        entry.closed = true
        overlay.remove()
        modalStack = modalStack.filter((m) => m !== entry)
        if (!silent && typeof options.onClose === 'function') options.onClose()
      }
    }
    modalStack.push(entry)

    if (options.closable !== false) {
      overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay) entry.close()
      })
      const closeBtn = modal.querySelector('[data-modal-close]')
      if (closeBtn) closeBtn.addEventListener('click', () => entry.close())
    }

    return entry
  }

  function closeTopModal() {
    const top = modalStack[modalStack.length - 1]
    if (top && !top.closed && top.closable) {
      top.close()
      return true
    }
    return false
  }

  function confirmDialog(opts) {
    const options = opts || {}
    return new Promise((resolve) => {
      let settled = false
      const modal = openModal(
        `<div class="modal-icon">${icon(options.icon || 'alert', 24)}</div>
         <h2>${NT.fmt.escapeHtml(options.title || '确认操作')}</h2>
         <p class="confirm-copy">${options.message || ''}</p>
         <div class="modal-actions">
           <button class="btn btn-ghost" data-cancel>取消</button>
           <button class="btn btn-primary" data-confirm>${NT.fmt.escapeHtml(
             options.confirmText || '确认'
           )}</button>
         </div>`,
        {
          className: 'narrow',
          onClose: () => {
            if (!settled) {
              settled = true
              resolve(false)
            }
          }
        }
      )
      modal.modal.querySelector('[data-cancel]').addEventListener('click', () => modal.close())
      modal.modal.querySelector('[data-confirm]').addEventListener('click', () => {
        settled = true
        resolve(true)
        modal.close(true)
      })
    })
  }

  function busy(show, text) {
    let el = document.getElementById('busy-overlay')
    if (!show) {
      if (el) el.remove()
      return
    }
    if (!el) {
      el = document.createElement('div')
      el.id = 'busy-overlay'
      el.className = 'busy-overlay'
      el.innerHTML = `<div class="spinner"></div><div id="busy-text"></div>`
      document.body.appendChild(el)
    }
    const label = document.getElementById('busy-text')
    if (label) label.textContent = text || '处理中…'
  }

  function closeAllModals() {
    for (const entry of [...modalStack].reverse()) entry.close(true)
    modalStack = []
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (closeTopModal()) e.preventDefault()
    }
  })

  NT.ui = { toast, openModal, confirmDialog, busy, closeTopModal, closeAllModals }
  NT.toast = toast
})()
