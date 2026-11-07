;(function () {
  const NT = (window.NT = window.NT || {})

  function pad(n, w) {
    return String(Math.floor(n)).padStart(w || 2, '0')
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n))
  }

  function formatClock(seconds, decimals) {
    const d = decimals === undefined ? 3 : decimals
    const s = Math.max(0, Number(seconds) || 0)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    const secText = sec.toFixed(d).padStart(d > 0 ? d + 3 : 2, '0')
    if (h > 0) return `${h}:${pad(m)}:${secText}`
    return `${pad(m)}:${secText}`
  }

  function formatTime(seconds) {
    return formatClock(seconds, 0)
  }

  function formatShort(seconds) {
    const s = Math.max(0, Number(seconds) || 0)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = Math.floor(s % 60)
    if (h > 0) return `${h}:${pad(m)}:${pad(sec)}`
    return `${m}:${pad(sec)}`
  }

  function formatBytes(bytes, digits) {
    const b = Math.max(0, Number(bytes) || 0)
    if (b < 1024) return `${Math.round(b)} B`
    const kb = b / 1024
    if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`
    const mb = kb / 1024
    if (mb < 1024) return `${mb.toFixed(digits === undefined ? 1 : digits)} MB`
    const gb = mb / 1024
    return `${gb.toFixed(2)} GB`
  }

  function splitBytes(bytes) {
    const b = Math.max(0, Number(bytes) || 0)
    const mb = b / 1024 / 1024
    if (mb < 1024) return { value: mb.toFixed(1), unit: 'MB' }
    return { value: (mb / 1024).toFixed(2), unit: 'GB' }
  }

  function parseTime(input) {
    if (typeof input === 'number') return input
    if (!input) return null
    const text = String(input).trim().replace(',', '.')
    if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(text)) return null
    const parts = text.split(':').map(Number)
    if (parts.some((p) => !Number.isFinite(p))) return null
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
    if (parts.length === 2) return parts[0] * 60 + parts[1]
    return parts[0]
  }

  function formatEta(seconds) {
    const s = Math.max(0, Math.round(Number(seconds) || 0))
    if (s < 1) return '< 1 秒'
    if (s < 60) return `${s} 秒`
    const m = Math.floor(s / 60)
    const r = s % 60
    if (m < 60) return r ? `${m} 分 ${r} 秒` : `${m} 分钟`
    const h = Math.floor(m / 60)
    return `${h} 小时 ${m % 60} 分`
  }

  function formatSpeed(speed) {
    const s = Number(speed) || 0
    if (!s) return '—'
    return `${s.toFixed(s >= 10 ? 0 : 1)}×`
  }

  function basename(p) {
    const s = String(p || '').replace(/[\\/]+$/, '')
    const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
    return i >= 0 ? s.slice(i + 1) : s
  }

  function dirname(p) {
    const s = String(p || '')
    const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
    return i > 0 ? s.slice(0, i) : ''
  }

  function extname(p) {
    const base = basename(p)
    const i = base.lastIndexOf('.')
    return i > 0 ? base.slice(i + 1).toLowerCase() : ''
  }

  function stripExt(p) {
    const base = basename(p)
    const i = base.lastIndexOf('.')
    return i > 0 ? base.slice(0, i) : base
  }

  function even(n) {
    const v = Math.max(2, Math.round(Number(n) || 0))
    return v % 2 === 0 ? v : v - 1
  }

  function escapeHtml(str) {
    return String(str === undefined || str === null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function formatDate(ts) {
    if (!ts) return ''
    const d = new Date(ts)
    const now = new Date()
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
    if (sameDay) return `今天 ${time}`
    return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${time}`
  }

  function resolutionLabel(w, h) {
    if (!w || !h) return ''
    const known = { 3840: '4K', 2560: '2K', 1920: '1080p', 1280: '720p', 854: '480p', 640: '360p' }
    const key = Math.min(w, h) === w ? w : h
    return known[key] ? `${known[key]} · ${w}×${h}` : `${w}×${h}`
  }

  function debounce(fn, delay) {
    let timer = null
    return function (...args) {
      clearTimeout(timer)
      timer = setTimeout(() => fn.apply(this, args), delay)
    }
  }

  function throttle(fn, delay) {
    let last = 0
    let timer = null
    return function (...args) {
      const now = Date.now()
      const wait = delay - (now - last)
      if (wait <= 0) {
        clearTimeout(timer)
        last = now
        fn.apply(this, args)
      } else if (!timer) {
        timer = setTimeout(() => {
          timer = null
          last = Date.now()
          fn.apply(this, args)
        }, wait)
      }
    }
  }

  function uid(prefix) {
    return `${prefix || 'id'}_${Math.random().toString(36).slice(2, 10)}`
  }

  NT.fmt = {
    pad,
    clamp,
    formatClock,
    formatTime,
    formatShort,
    formatBytes,
    splitBytes,
    parseTime,
    formatEta,
    formatSpeed,
    basename,
    dirname,
    extname,
    stripExt,
    even,
    escapeHtml,
    formatDate,
    resolutionLabel,
    debounce,
    throttle,
    uid
  }
})()
