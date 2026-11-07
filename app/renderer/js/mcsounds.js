/* NT-Addon-Search — NiceTools 本地 MC 音效搜索器
 * 正式内置页面：由 home.js 路由到 NT.MCSounds.render(view)。
 * 主进程能力统一走单通道 mcsounds，由 lib/mcsounds/index.js 处理。
 */
;(function () {
  'use strict'

  const ADDON_ID = 'mcsounds'
  const LS_ROOT = 'nt.addon.mcsounds.root'
  const LS_TAGS = 'nt.addon.mcsounds.tags'
  const LS_PENDING = 'nt.addon.mcsounds.pending'
  const LS_DLDIR = 'nt.addon.mcsounds.dldir'
  const LS_WAV = 'nt.addon.mcsounds.wavmode'
  const ROW_H = 64
  const OVERSCAN = 6

  const S = {
    root: '',
    pending: '',
    items: [],
    filtered: [],
    query: '',
    tags: {},
    playing: '',
    paused: false,
    loading: false,
    error: '',
    ready: false,
    note: '',
    scrollTop: 0,
    raf: 0,
    tick: 0,
    audio: null,
    pop: null,
    dlg: null,
    selected: new Set(),
    anchor: -1,
    wavMode: true,
    warmTimer: 0
  }

  const ICON = {
    wave:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 11v2M21 12h0"/></svg>',
    play:
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.52.85l10-6.5a1 1 0 0 0 0-1.7l-10-6.5A1 1 0 0 0 8 5.5z"/></svg>',
    pause:
      '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1.4"/><rect x="14" y="5" width="4" height="14" rx="1.4"/></svg>',
    folder:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2h7A1.5 1.5 0 0 1 19 9.5v7A1.5 1.5 0 0 1 17.5 18h-13A1.5 1.5 0 0 1 3 16.5z"/></svg>',
    tag:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M4 12.5V5.5A1.5 1.5 0 0 1 5.5 4h7L20 11.5a1.5 1.5 0 0 1 0 2.1l-6.4 6.4a1.5 1.5 0 0 1-2.1 0z"/><circle cx="8.5" cy="8.5" r="1.4"/></svg>',
    search:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>',
    download:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v10"/><path d="m8 10.5 4 4 4-4"/><path d="M4.5 18.5h15"/></svg>',
    check:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    close:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>'
  }

  // ---------- 工具 ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]))
  }

  function fmtDur(sec) {
    if (!sec || sec < 0) return '—'
    if (sec < 10) return sec.toFixed(1) + 's'
    if (sec < 60) return Math.round(sec) + 's'
    const m = Math.floor(sec / 60)
    const s = Math.round(sec % 60)
    return m + ':' + String(s).padStart(2, '0')
  }

  function fmtSize(n) {
    if (!n) return ''
    if (n < 1024) return n + ' B'
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB'
    return (n / 1048576).toFixed(1) + ' MB'
  }

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key)
      return raw ? JSON.parse(raw) : fallback
    } catch {
      return fallback
    }
  }

  function saveJSON(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val))
    } catch {
      /* 忽略配额错误 */
    }
  }

  // ---------- 初始化 ----------
  let mountedView = null
  let keyboardHandler = null
  let initialized = false

  function init() {
    if (initialized) return
    initialized = true
    S.tags = loadJSON(LS_TAGS, {}) || {}
    S.root = localStorage.getItem(LS_ROOT) || ''
    S.pending = localStorage.getItem(LS_PENDING) || ''
    S.wavMode = localStorage.getItem(LS_WAV) !== '0'
    S.audio = new Audio()
    S.audio.preload = 'none'
    S.audio.addEventListener('ended', onAudioEnded)
    S.audio.addEventListener('pause', () => {
      if (S.audio && !S.audio.ended && S.playing) {
        S.paused = true
        paintRows()
      }
    })
    S.audio.addEventListener('play', () => {
      if (!S.playing) return
      S.paused = false
      paintRows()
      startProgress()
    })
  }

  function installKeyboard() {
    if (keyboardHandler) return
    keyboardHandler = (e) => {
      if (!S.ready) return
      const NT = window.NT
      if (!NT || !NT.state || NT.state.homeTool !== ADDON_ID) return
      const tag = ((e.target && e.target.tagName) || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea') return

      if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'a') {
        e.preventDefault()
        selectAll()
        return
      }
      if (e.key === 'Escape' && S.selected.size) {
        S.selected.clear()
        paintRows()
      }
    }
    document.addEventListener('keydown', keyboardHandler)
  }

  function removeKeyboard() {
    if (!keyboardHandler) return
    document.removeEventListener('keydown', keyboardHandler)
    keyboardHandler = null
  }

  function selectAll() {
    if (!S.filtered.length) return
    S.selected = new Set(S.filtered.map((x) => x.rel))
    paintRows()
    toast('已选中 ' + S.selected.size + ' 个音效，拖动任意一个即可整批拖出')
  }

  function render(view) {
    if (!view) return
    init()
    mountedView = view
    installKeyboard()
    if (S.root && !S.ready && !S.loading) {
      loadRoot(S.root).catch(() => {})
    }
    renderPage(view)
  }

  function destroy() {
    clearTimeout(S.warmTimer)
    S.warmTimer = 0
    stopProgress()
    stopAudio()
    closePop()
    closeDialog()
    const dialog = document.getElementById('mcs-dlg')
    if (dialog) dialog.style.display = 'none'
    if (mountedView) {
      mountedView.style.padding = ''
      mountedView.className = 'view'
    }
    removeKeyboard()
    mountedView = null
  }

  // ---------- 数据 ----------
  async function linkFolder() {
    const NT = window.NT
    if (!NT || !NT.api) return
    let picked = ''
    try {
      picked = await NT.api.call('dialog:choose-folder')
    } catch (e) {
      toast('选择文件夹失败：' + e.message)
      return
    }
    if (!picked) return
    await loadRoot(picked)
  }

  async function loadRoot(root) {
    const NT = window.NT
    if (!NT || !NT.api) return
    S.loading = true
    S.error = ''
    S.note = ''
    S.root = root
    renderPage()
    try {
      const data = await NT.api.call('mcsounds', { fn: 'scan', root: root })
      buildItems(data)
      S.ready = true
      S.error = ''
      S.pending = data.base || root
      localStorage.setItem(LS_ROOT, S.pending)
      localStorage.setItem(LS_PENDING, S.pending)
    } catch (e) {
      S.ready = false
      S.items = []
      S.filtered = []
      S.error = e.message || '读取失败'
    } finally {
      S.loading = false
      applyFilter()
      renderPage()
    }
  }

  function unlinkFolder() {
    stopAudio()
    S.root = ''
    S.ready = false
    S.items = []
    S.filtered = []
    S.query = ''
    S.error = ''
    S.note = ''
    localStorage.removeItem(LS_ROOT)
    renderPage()
    toast('已取消链接')
  }

  function buildItems(data) {
    const base = String(data.base || S.root || '').replace(/[\\/]+$/, '')
    const evByPath = {}
    const durByPath = {}
    if (data.manifest && Array.isArray(data.manifest.files)) {
      for (const f of data.manifest.files) {
        if (!f || !f.path) continue
        evByPath[f.path] = f.events || []
        durByPath[f.path] = f.duration || 0
      }
    }
    const zh = (data.zh && data.zh.items) || {}

    // 一个文件可能被多个事件引用，选与路径语义最匹配的作为主事件
    function pickEvent(events, rel) {
      if (!events || !events.length) return ''
      const flat = rel.toLowerCase().replace(/[/_.]/g, '.')
      let best = events[0]
      let bestScore = -1
      for (const ev of events) {
        const parts = ev.split('.')
        let score = 0
        for (const p of parts) {
          if (p.length > 2 && flat.includes(p)) score += 3
        }
        if (flat.startsWith(parts[0])) score += 1
        if (score > bestScore) {
          bestScore = score
          best = ev
        }
      }
      return best
    }

    S.items = (data.files || []).map((f) => {
      const rel = f.rel
      const events = evByPath[rel] || []
      const ev = pickEvent(events, rel)
      const z = zh[ev] || null
      const baseName = rel.split('/').pop().replace(/\.ogg$/i, '')
      const abs = f.abs || base + '\\sounds\\' + rel.replace(/\//g, '\\')
      // 所有关联事件的中文名都进入关键词，保证换个事件名也能搜到
      let extraKw = ''
      if (events.length > 1) {
        const names = []
        for (const e2 of events) {
          const z2 = zh[e2]
          if (z2 && z2.n) names.push(z2.n)
        }
        extraKw = names.join(' ')
      }
      return {
        rel,
        abs,
        size: f.size || 0,
        dur: durByPath[rel] || 0,
        event: ev,
        events,
        extra: events.length > 1 ? events.length : 0,
        name: z ? z.n : baseName,
        desc: z ? z.d : '',
        py: z ? z.p || '' : '',
        init: z ? z.i || '' : '',
        kw: (z ? z.k || '' : '') + (extraKw ? ' ' + extraKw : ''),
        cat: z ? z.c || '' : ''
      }
    })
    // 名称索引，避免每次搜索重新拼接。
    // 拼音字段可能是空格分隔的多个候选（多音字），所以存成数组。
    const splitPy = (v) =>
      String(v || '')
        .toLowerCase()
        .split(/\s+/)
        .map((s) => s.replace(/[^a-z]/g, ''))
        .filter(Boolean)
    for (const it of S.items) {
      it._name = it.name.toLowerCase()
      it._ev = it.event.toLowerCase()
      it._kw = it.kw.toLowerCase()
      it._py = splitPy(it.py)
      it._init = splitPy(it.init)
    }

    // 同一事件有多个音频文件时补变体序号，避免同名分不清
    const groups = new Map()
    for (const it of S.items) {
      if (!it.event) continue
      if (!groups.has(it.event)) groups.set(it.event, [])
      groups.get(it.event).push(it)
    }
    for (const list of groups.values()) {
      if (list.length < 2) continue
      list.sort((a, b) => a.rel.localeCompare(b.rel, 'en', { numeric: true }))
      list.forEach((it, i) => {
        it.name = it.name + ' ' + (i + 1)
        it._name = it.name.toLowerCase()
      })
    }

    // 默认列表按事件分组 + 文件名自然排序，避免 1,10,11,2 这种字典序
    S.items.sort((a, b) => {
      const ea = a.event || '\uffff'
      const eb = b.event || '\uffff'
      if (ea !== eb) return ea < eb ? -1 : 1
      return a.rel.localeCompare(b.rel, 'en', { numeric: true })
    })
  }

  // ---------- 搜索 ----------
  function applyFilter() {
    const q = S.query.trim().toLowerCase()
    if (!q) {
      S.filtered = S.items
      return
    }
    const qp = q.replace(/[^a-z0-9]/g, '')
    const hits = []
    for (const it of S.items) {
      let score = 0
      if (it._name === q) score = 130
      else if (it._name.startsWith(q)) score = 110
      else if (it._name.includes(q)) score = 90

      if (!score && qp) {
        if (it._py.includes(qp)) score = 100
        else if (it._py.some((x) => x.startsWith(qp))) score = 85
        else if (it._init.some((x) => x.startsWith(qp))) score = 70
        else if (it._py.some((x) => x.includes(qp))) score = 50
      }
      if (!score && it._ev.includes(q)) score = 60
      if (!score && it._kw.includes(q)) score = 40

      if (!score) {
        const tags = S.tags[it.rel]
        if (tags && tags.some((t) => String(t).toLowerCase().includes(q))) score = 55
      }
      if (score) hits.push({ it, score })
    }
    hits.sort((a, b) => b.score - a.score || a.it.rel.localeCompare(b.it.rel, 'en', { numeric: true }))
    S.filtered = hits.map((h) => h.it)
  }

  // ---------- 页面 ----------
  function renderPage(target) {
    const NT = window.NT
    const view = target || mountedView
    if (!view || !NT) return
    if (NT.setLayoutMode) NT.setLayoutMode('home')
    view.className = 'view'
    view.style.padding = '0'

    // 从别的页面切回来时，把之前藏起来的下载弹窗恢复
    const dlgEl = document.getElementById('mcs-dlg')
    if (dlgEl && DL.open) dlgEl.style.display = ''

    if (S.loading) {
      view.innerHTML =
        '<div class="mcs-page"><div class="mcs-empty"><div class="mcs-empty-icon">' +
        ICON.search +
        '</div><b>正在读取音效库…</b><span>扫描 sounds 目录并加载索引</span></div></div>'
      return
    }

    if (!S.ready) {
      const pendingBar = S.pending
        ? '<span class="mcs-root" title="' + esc(S.pending) + '">' + esc(S.pending) + '</span>' +
          '<button class="mcs-btn is-primary" data-act="relink" type="button">' + ICON.folder + ' 链接目录</button>'
        : ''
      view.innerHTML =
        '<div class="mcs-page">' +
        '<header class="mcs-head"><div><span class="mcs-kicker">TOOLBOX · MC SOUND</span>' +
        '<h1 class="mcs-title">本地MC音效搜索器</h1>' +
        '<p class="mcs-desc">链接本地 MCSounds 文件夹后，可搜索中文名、英文名、拼音和自定义标签，点卡片即可试听。</p></div>' +
        '<div style="display:flex;align-items:center;gap:10px">' + pendingBar + '</div></header>' +
        (S.note ? '<div class="mcs-note">' + esc(S.note) + '</div>' : '') +
        '<div class="mcs-empty"><div class="mcs-empty-icon">' + ICON.wave + '</div>' +
        '<b>' + (S.error ? '读取失败' : '还没有链接音效库') + '</b>' +
        '<span>' +
        (S.error
          ? esc(S.error) + '<br>请确认选择的是 MCSounds 根目录（里面应有 sounds 文件夹）'
          : '还没有音效的话，可以从官方资源索引下载一份：<br>只下载 sounds 目录下的音效，直连 Mojang 官方 CDN，不经过任何第三方站点。') +
        '</span>' +
        '<div class="mcs-empty-actions">' +
        '<button class="mcs-btn is-primary" data-act="link" type="button">' + ICON.folder + ' 链接 MCSounds 文件夹</button>' +
        '<button class="mcs-btn" data-act="download" type="button">' + ICON.download + ' 从官方资源索引下载</button>' +
        '</div>' +
        '</div></div>'
      bindPage(view)
      return
    }

    view.innerHTML =
      '<div class="mcs-page">' +
      '<header class="mcs-head"><div><span class="mcs-kicker">TOOLBOX · MC SOUND</span>' +
      '<h1 class="mcs-title">本地MC音效搜索器</h1>' +
      '<p class="mcs-desc">点卡片试听，Ctrl / Shift 多选后可拖进剪辑软件；支持中文名、英文名、拼音搜索。</p></div>' +
      '<div style="display:flex;align-items:center;gap:10px">' +
      '<span class="mcs-root" title="' + esc(S.root) + '">' + esc(S.root) + '</span>' +
      '<button class="mcs-icon-btn mcs-head-icon" data-act="download" type="button" title="从官方资源索引下载 / 更新音效" aria-label="从官方资源索引下载">' + ICON.download + '</button>' +
      '<button class="mcs-btn" data-act="link" type="button">' + ICON.folder + ' 更换目录</button>' +
      '<button class="mcs-btn" data-act="unlink" type="button" title="断开与当前目录的链接">取消链接此目录</button>' +
      '</div></header>' +
      '<div class="mcs-bar">' +
      '<input class="mcs-search" id="mcs-q" type="search" spellcheck="false" placeholder="搜索：石头 / stone / shitou / st / 方块" value="' +
      esc(S.query) + '">' +
      '<button class="mcs-toggle' + (S.wavMode ? ' is-on' : '') + '" data-act="wavmode" type="button" title="' +
      (S.wavMode
        ? '拖动时自动转成 WAV，存放在 ' + esc(S.root) + '\\_drag_wav\\；点击改为拖出原始 OGG'
        : '当前拖出原始 OGG；点击改为自动转成 WAV') +
      '"><span class="mcs-toggle-dot"></span>拖出为 WAV</button>' +
      '<span class="mcs-meta" id="mcs-count"></span>' +
      '</div>' +
      '<div class="mcs-list" id="mcs-list"><div class="mcs-inner" id="mcs-inner"></div></div>' +
      '</div>'

    bindPage(view)
    updateCount()
    paint()
  }

  function bindPage(view) {
    const link = view.querySelector('[data-act="link"]')
    if (link) link.addEventListener('click', () => void linkFolder())

    const relink = view.querySelector('[data-act="relink"]')
    if (relink) relink.addEventListener('click', () => void loadRoot(S.pending))

    const download = view.querySelector('[data-act="download"]')
    if (download) download.addEventListener('click', () => openDownloadDialog())

    const unlink = view.querySelector('[data-act="unlink"]')
    if (unlink) unlink.addEventListener('click', () => unlinkFolder())

    const wavBtn = view.querySelector('[data-act="wavmode"]')
    if (wavBtn)
      wavBtn.addEventListener('click', () => {
        S.wavMode = !S.wavMode
        localStorage.setItem(LS_WAV, S.wavMode ? '1' : '0')
        wavBtn.classList.toggle('is-on', S.wavMode)
        wavBtn.title = S.wavMode
          ? '拖动时自动转成 WAV，存放在 ' + S.root + '\\_drag_wav\\；点击改为拖出原始 OGG'
          : '当前拖出原始 OGG；点击改为自动转成 WAV'
        toast(
          S.wavMode
            ? '拖出的文件会转成 WAV，存在音效库的 _drag_wav 文件夹'
            : '拖出的文件保持原始 OGG'
        )
      })

    const q = view.querySelector('#mcs-q')
    if (q) {
      let timer = 0
      q.addEventListener('input', () => {
        clearTimeout(timer)
        timer = setTimeout(() => {
          S.query = q.value
          applyFilter()
          updateCount()
          const list = document.getElementById('mcs-list')
          if (list) list.scrollTop = 0
          S.scrollTop = 0
          paint()
        }, 120)
      })
      q.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          q.value = ''
          S.query = ''
          applyFilter()
          updateCount()
          paint()
        }
      })
      setTimeout(() => q.focus(), 30)
    }

    const list = view.querySelector('#mcs-list')
    if (list) {
      list.addEventListener('scroll', () => {
        S.scrollTop = list.scrollTop
        if (S.raf) return
        S.raf = requestAnimationFrame(() => {
          S.raf = 0
          paintRows()
        })
      })
    }
  }

  function updateCount() {
    const el = document.getElementById('mcs-count')
    if (!el) return
    const total = S.items.length
    const n = S.filtered.length
    el.textContent = S.query.trim() ? n + ' / ' + total + ' 个音效' : total + ' 个音效'
  }

  // ---------- 虚拟列表 ----------
  function paint() {
    const inner = document.getElementById('mcs-inner')
    if (!inner) return
    inner.style.height = S.filtered.length * ROW_H + 'px'
    paintRows()
  }

  function paintRows() {
    const list = document.getElementById('mcs-list')
    const inner = document.getElementById('mcs-inner')
    if (!list || !inner) return

    if (!S.filtered.length) {
      inner.style.height = '0px'
      inner.innerHTML = ''
      let empty = document.getElementById('mcs-noresult')
      if (!empty) {
        empty = document.createElement('div')
        empty.id = 'mcs-noresult'
        empty.className = 'mcs-empty'
        empty.innerHTML =
          '<div class="mcs-empty-icon">' + ICON.search + '</div><b>没有匹配的音效</b><span>换个关键词试试，支持中文、英文、拼音首字母</span>'
        list.parentNode.insertBefore(empty, list.nextSibling)
      }
      return
    }
    const old = document.getElementById('mcs-noresult')
    if (old) old.remove()

    const viewH = list.clientHeight || 600
    const start = Math.max(0, Math.floor(list.scrollTop / ROW_H) - OVERSCAN)
    const end = Math.min(S.filtered.length, Math.ceil((list.scrollTop + viewH) / ROW_H) + OVERSCAN)

    const html = []
    for (let i = start; i < end; i++) {
      const it = S.filtered[i]
      const on = S.playing === it.rel
      const active = on && !S.paused
      const tags = S.tags[it.rel] || []
      const p = on ? currentProgress() : 0
      const sel = S.selected.has(it.rel)
      html.push(
        '<div class="mcs-row' + (on ? ' is-playing' : '') + (sel ? ' is-sel' : '') +
          '" style="top:' + i * ROW_H + 'px" data-i="' + i + '" draggable="true">' +
          '<div class="mcs-fill" style="transform:scaleX(' + p + ')"></div>' +
          '<button class="mcs-play' + (on ? ' is-on' : '') + '" data-act="play" data-i="' + i + '" type="button" aria-label="' + (active ? '暂停' : '播放') + '">' +
          (active ? ICON.pause : ICON.play) +
          '</button>' +
          '<div class="mcs-main">' +
          '<div class="mcs-name"><span class="mcs-name-text">' + esc(it.name) + '</span>' +
          (it.cat ? '<span class="mcs-badge">' + esc(catZh(it.cat)) + '</span>' : '') +
          (it.extra ? '<span class="mcs-badge">+' + (it.extra - 1) + '</span>' : '') +
          (tags.length ? '<span class="mcs-tagchip">' + esc(tags[0]) + (tags.length > 1 ? ' +' + (tags.length - 1) : '') + '</span>' : '') +
          '</div>' +
          '<div class="mcs-sub">' + esc(it.event || it.rel) + ' · ' + esc(it.rel) + '</div>' +
          '</div>' +
          '<span class="mcs-dur">' + fmtDur(it.dur) + '</span>' +
          '<button class="mcs-icon-btn" data-act="tag" data-i="' + i + '" type="button" aria-label="标签" title="自定义标签">' + ICON.tag + '</button>' +
          '<button class="mcs-icon-btn" data-act="open" data-i="' + i + '" type="button" aria-label="打开目录" title="在资源管理器中显示">' + ICON.folder + '</button>' +
          '</div>'
      )
    }
    inner.innerHTML = html.join('')

    inner.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const it = S.filtered[Number(btn.dataset.i)]
        if (!it) return
        const act = btn.dataset.act
        if (act === 'play') void togglePause(it)
        else if (act === 'tag') openTagPop(btn, it)
        else if (act === 'open') void openFolder(it)
      })
    })

    // 卡片交互：普通点击播放，Ctrl/Shift 多选，拖拽拖出到外部软件
    inner.querySelectorAll('.mcs-row').forEach((row) => {
      const idx = Number(row.dataset.i)

      row.addEventListener('click', (e) => {
        const it = S.filtered[idx]
        if (!it) return

        // Shift：从锚点到当前的范围选中
        if (e.shiftKey && S.anchor >= 0) {
          e.preventDefault()
          const a = Math.min(S.anchor, idx)
          const b = Math.max(S.anchor, idx)
          S.selected.clear()
          for (let k = a; k <= b; k++) if (S.filtered[k]) S.selected.add(S.filtered[k].rel)
          paintRows()
          return
        }
        // Ctrl / Cmd：加选、去选，不播放
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault()
          if (S.selected.has(it.rel)) S.selected.delete(it.rel)
          else S.selected.add(it.rel)
          S.anchor = idx
          paintRows()
          return
        }
        // 普通点击：清空选择并播放
        S.anchor = idx
        if (S.selected.size) {
          S.selected.clear()
          paintRows()
        }
        void startPlay(it)
      })

      // 按下就开始预热转码，等真正拖起来时缓存通常已经好了
      row.addEventListener('mousedown', () => {
        if (!S.wavMode) return
        const it = S.filtered[idx]
        if (it) warmDrag(pickDragItems(it))
      })

      row.addEventListener('dragstart', (e) => {
        const it = S.filtered[idx]
        if (!it) return
        // 必须阻止默认拖拽，改由主进程 startDrag 发起，才能把文件交给外部软件
        e.preventDefault()
        doDrag(pickDragItems(it))
      })
    })
  }

  /** 拖的是已选中的卡片就拖整批，否则只拖这一张并清空选择 */
  function pickDragItems(it) {
    if (S.selected.size && S.selected.has(it.rel)) {
      return S.filtered.filter((x) => S.selected.has(x.rel))
    }
    if (S.selected.size) {
      S.selected.clear()
      paintRows()
    }
    return [it]
  }

  /** 后台预热：把 wav 缓存先准备好，拖拽时就能命中 */
  function warmDrag(picks) {
    const NT = window.NT
    if (!NT || !NT.api) return
    // 选中数量太多时不预热：转不完还白占 CPU
    if (!picks.length || picks.length > 40) return
    clearTimeout(S.warmTimer)
    S.warmTimer = setTimeout(() => {
      const items = picks.slice(0, 40).map((x) => ({ abs: x.abs, size: x.size, name: x.name }))
      NT.api.call('mcsounds', { fn: 'warm', items, dst: S.root }).catch(() => {})
    }, 60)
  }

  /** 真正发起拖拽（同步调用，主进程会阻塞到拖放结束） */
  function doDrag(picks) {
    const nice = window.nice
    if (!nice || typeof nice.dragSync !== 'function') {
      toast('拖拽通道未就绪，请先运行一次 apply.cmd 安装脚本')
      return
    }
    // 一次拖太多，剪辑软件那边也会卡死
    if (picks.length > 200) {
      toast('一次最多拖出 200 个，当前选中 ' + picks.length + ' 个，请先缩小范围')
      return
    }
    const items = picks.map((x) => ({ abs: x.abs, size: x.size, name: x.name }))
    let res = null
    try {
      res = nice.dragSync('mcsounds:drag', {
        mode: S.wavMode ? 'wav' : 'raw',
        dst: S.root,
        items
      })
    } catch (err) {
      toast('拖出失败：' + (err && err.message ? err.message : err))
      return
    }
    if (!res) return
    if (!res.ok) {
      if (res.error) toast(res.error)
      return
    }
    if (res.raw > 0 && res.wav > 0) {
      toast(res.wav + ' 个已转为 WAV，' + res.raw + ' 个未来得及转换，按原文件拖出')
    }
  }

  const CAT_ZH = {
    block: '方块', entity: '生物', item: '物品', ui: '界面', music: '音乐',
    ambient: '环境', music_disc: '唱片', weather: '天气', event: '事件',
    particle: '粒子', enchant: '附魔'
  }
  function catZh(c) {
    return CAT_ZH[c] || c
  }

  // ---------- 播放 ----------
  function currentProgress() {
    const a = S.audio
    if (!a) return 0
    const d = a.duration
    if (!isFinite(d) || d <= 0) return 0
    return Math.max(0, Math.min(1, a.currentTime / d))
  }

  function startProgress() {
    if (S.tick) return
    const step = () => {
      S.tick = 0
      if (!S.playing) return
      const fill = document.querySelector('.mcs-row.is-playing .mcs-fill')
      if (fill) fill.style.transform = 'scaleX(' + currentProgress() + ')'
      if (!S.audio.paused && !S.audio.ended) S.tick = requestAnimationFrame(step)
    }
    S.tick = requestAnimationFrame(step)
  }

  function stopProgress() {
    if (S.tick) {
      cancelAnimationFrame(S.tick)
      S.tick = 0
    }
  }

  function stopAudio() {
    if (!S.audio) return
    S.playing = ''
    S.paused = false
    stopProgress()
    try {
      S.audio.pause()
      S.audio.removeAttribute('src')
      S.audio.load()
    } catch {}
  }

  /** 播放结束：遮罩淡出，卡片恢复白底原样 */
  function onAudioEnded() {
    const fill = document.querySelector('.mcs-row.is-playing .mcs-fill')
    if (fill) {
      fill.style.transform = 'scaleX(1)'
      fill.style.transition = 'opacity .22s ease'
      fill.style.opacity = '0'
    }
    stopProgress()
    setTimeout(() => {
      S.playing = ''
      S.paused = false
      paintRows()
    }, 230)
  }

  /** 换一首：先停掉旧的，再播新的 */
  async function switchTo(it) {
    const NT = window.NT
    if (!NT || !NT.api) return
    try {
      const url = await NT.api.call('media:url', it.abs)
      S.playing = ''
      S.paused = false
      stopProgress()
      S.audio.pause()
      S.audio.src = url
      S.playing = it.rel
      paintRows()
      await S.audio.play()
      startProgress()
    } catch (e) {
      S.playing = ''
      S.paused = false
      stopProgress()
      paintRows()
      toast('播放失败：' + e.message)
    }
  }

  /** 点卡片：从头播放；同一张再点 = 归零重播 */
  async function startPlay(it) {
    if (S.playing !== it.rel) return switchTo(it)
    try {
      S.audio.currentTime = 0
      S.paused = false
      await S.audio.play()
      paintRows()
      startProgress()
    } catch (e) {
      toast('播放失败：' + e.message)
    }
  }

  /** 圆按钮：暂停 / 继续；不是当前曲目则直接播 */
  async function togglePause(it) {
    if (S.playing !== it.rel) return switchTo(it)
    try {
      if (S.audio.paused) {
        S.paused = false
        await S.audio.play()
        startProgress()
      } else {
        S.audio.pause()
        S.paused = true
        stopProgress()
      }
      paintRows()
    } catch (e) {
      toast('播放失败：' + e.message)
    }
  }

  async function openFolder(it) {
    const NT = window.NT
    if (!NT || !NT.api) return
    try {
      await NT.api.call('shell:show', it.abs)
    } catch (e) {
      toast('打开失败：' + e.message)
    }
  }

  let toastTimer = 0
  function toast(msg) {
    let el = document.getElementById('mcs-toast')
    if (!el) {
      el = document.createElement('div')
      el.id = 'mcs-toast'
      el.style.cssText =
        'position:fixed;left:50%;bottom:34px;transform:translateX(-50%);background:#000;color:#fff;' +
        'font-size:12px;padding:9px 16px;border-radius:999px;z-index:80;pointer-events:none;opacity:0;transition:opacity .18s'
      document.body.appendChild(el)
    }
    el.textContent = msg
    el.style.opacity = '1'
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => {
      el.style.opacity = '0'
    }, 2200)
  }

  // ---------- 从官方资源索引下载 ----------
  const DL = {
    open: false,
    phase: 'idle', // loading | ready | running | done | error
    info: null,
    dir: '',
    status: null,
    error: '',
    timer: 0
  }

  function openDownloadDialog() {
    if (DL.open) return
    DL.open = true
    DL.phase = 'loading'
    DL.info = null
    DL.status = null
    DL.error = ''
    DL.dir = localStorage.getItem(LS_DLDIR) || ''
    renderDialog()
    void loadOfficial()
  }

  async function loadOfficial() {
    const NT = window.NT
    try {
      DL.info = await NT.api.call('mcsounds', { fn: 'official' })
      if (!DL.dir) DL.dir = DL.info.defaultDir || ''
      DL.phase = 'ready'
    } catch (e) {
      DL.error = e.message || '读取官方索引失败'
      DL.phase = 'error'
    }
    renderDialog()
  }

  function closeDialog() {
    if (DL.phase === 'running') return
    DL.open = false
    if (DL.timer) {
      clearInterval(DL.timer)
      DL.timer = 0
    }
    const el = document.getElementById('mcs-dlg')
    if (el) el.remove()
  }

  async function pickDownloadDir() {
    const NT = window.NT
    try {
      const picked = await NT.api.call('dialog:choose-folder')
      if (!picked) return
      DL.dir = picked
      renderDialog()
    } catch (e) {
      toast('选择文件夹失败：' + e.message)
    }
  }

  async function startDownload() {
    const NT = window.NT
    if (!DL.dir) {
      toast('请先选择安装目录')
      return
    }
    DL.phase = 'running'
    DL.status = { done: 0, total: DL.info ? DL.info.count : 0, bytes: 0, totalBytes: DL.info ? DL.info.bytes : 0 }
    localStorage.setItem(LS_DLDIR, DL.dir)
    renderDialog()
    try {
      await NT.api.call('mcsounds', { fn: 'download', dir: DL.dir })
    } catch (e) {
      DL.error = e.message || '启动下载失败'
      DL.phase = 'error'
      renderDialog()
      return
    }
    if (DL.timer) clearInterval(DL.timer)
    DL.timer = setInterval(pollDownload, 320)
    void pollDownload()
  }

  async function pollDownload() {
    const NT = window.NT
    let st
    try {
      st = await NT.api.call('mcsounds', { fn: 'status' })
    } catch {
      return
    }
    DL.status = st
    if (st.phase === 'done') {
      if (DL.timer) {
        clearInterval(DL.timer)
        DL.timer = 0
      }
      DL.phase = 'done'
      S.pending = st.dir || DL.dir
      S.note = '音效已下载到 ' + S.pending + '，点击右上角「链接目录」即可开始使用。'
      localStorage.setItem(LS_PENDING, S.pending)
      renderDialog()
      if (!S.ready) renderPage()
      return
    }
    if (st.phase === 'error' || st.phase === 'cancelled') {
      if (DL.timer) {
        clearInterval(DL.timer)
        DL.timer = 0
      }
      DL.phase = st.phase === 'cancelled' ? 'ready' : 'error'
      DL.error = st.phase === 'cancelled' ? '' : st.error || '下载失败'
      renderDialog()
      return
    }
    paintDialogProgress()
  }

  async function cancelDownload() {
    const NT = window.NT
    try {
      await NT.api.call('mcsounds', { fn: 'cancel' })
    } catch {}
  }

  function paintDialogProgress() {
    const box = document.getElementById('mcs-dlg')
    if (!box || DL.phase !== 'running') return
    const st = DL.status || {}
    const total = st.total || 0
    const done = st.done || 0
    const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0
    const bar = box.querySelector('.mcs-dl-bar > i')
    if (bar) bar.style.width = pct + '%'
    const num = box.querySelector('[data-dl="num"]')
    if (num) num.textContent = done + ' / ' + total
    const pctEl = box.querySelector('[data-dl="pct"]')
    if (pctEl) pctEl.textContent = pct + '%'
    const spd = box.querySelector('[data-dl="speed"]')
    if (spd) spd.textContent = (fmtSize(st.bytes) || '0 B') + ' / ' + (fmtSize(st.totalBytes) || '—') + '　' + (fmtSize(st.speed) ? fmtSize(st.speed) + '/s' : '')
    const cur = box.querySelector('[data-dl="current"]')
    if (cur) cur.textContent = st.current || ''
  }

  function renderDialog() {
    let box = document.getElementById('mcs-dlg')
    if (!box) {
      box = document.createElement('div')
      box.id = 'mcs-dlg'
      box.className = 'mcs-mask'
      document.body.appendChild(box)
    }

    const info = DL.info
    let body = ''
    let foot = ''

    if (DL.phase === 'loading') {
      body = '<div class="mcs-dl-loading"><span class="mcs-spin"></span>正在读取官方资源索引…</div>'
      foot = '<button class="mcs-btn" data-dl="close" type="button">取消</button>'
    } else if (DL.phase === 'error') {
      body =
        '<div class="mcs-dl-err">' + esc(DL.error) + '</div>' +
        '<div class="mcs-dl-hint">请检查网络连接后重试。下载只访问 Mojang 官方地址，不需要任何账号。</div>'
      foot =
        '<button class="mcs-btn" data-dl="close" type="button">关闭</button>' +
        '<button class="mcs-btn is-primary" data-dl="retry" type="button">重试</button>'
    } else if (DL.phase === 'running') {
      const st = DL.status || {}
      const total = st.total || (info ? info.count : 0)
      const pct = total ? Math.min(100, Math.round(((st.done || 0) / total) * 100)) : 0
      body =
        '<div class="mcs-dl-rows">' +
        '<div class="mcs-dl-row"><span>版本</span><b>' + esc(String(st.version || (info ? info.version : ''))) + '</b></div>' +
        '<div class="mcs-dl-row"><span>安装目录</span><b class="mcs-mono">' + esc(st.dir || DL.dir) + '</b></div>' +
        '</div>' +
        '<div class="mcs-dl-progress">' +
        '<div class="mcs-dl-bar"><i style="width:' + pct + '%"></i></div>' +
        '<div class="mcs-dl-line"><span data-dl="pct">' + pct + '%</span>' +
        '<span data-dl="num">' + (st.done || 0) + ' / ' + total + '</span>' +
        '<span data-dl="speed">' + (fmtSize(st.bytes) || '0 B') + ' / ' + (fmtSize(st.totalBytes) || '—') + '</span></div>' +
        '<div class="mcs-dl-cur" data-dl="current">' + esc(st.current || '') + '</div>' +
        '</div>' +
        '<div class="mcs-dl-hint">已存在的文件会自动跳过，中断后再次下载可以续传。</div>'
      foot = '<button class="mcs-btn" data-dl="cancel" type="button">停止下载</button>'
    } else if (DL.phase === 'done') {
      const st = DL.status || {}
      body =
        '<div class="mcs-dl-ok">' + ICON.check + '下载完成</div>' +
        '<div class="mcs-dl-rows">' +
        '<div class="mcs-dl-row"><span>版本</span><b>' + esc(String(st.version || '')) + '</b></div>' +
        '<div class="mcs-dl-row"><span>安装目录</span><b class="mcs-mono">' + esc(st.dir || DL.dir) + '</b></div>' +
        '<div class="mcs-dl-row"><span>文件数量</span><b>' + (st.total || 0) + ' 个 .ogg</b></div>' +
        '<div class="mcs-dl-row"><span>占用大小</span><b>' + (fmtSize(st.bytes) || '—') + '</b></div>' +
        (st.failed ? '<div class="mcs-dl-row"><span>失败</span><b class="mcs-warn">' + st.failed + ' 个（再次下载可补齐）</b></div>' : '') +
        '</div>' +
        '<div class="mcs-dl-hint">现在关闭这个窗口，点击页面右上角「链接目录」即可开始使用。</div>'
      foot =
        '<button class="mcs-btn" data-dl="open" type="button">打开目录</button>' +
        '<button class="mcs-btn is-primary" data-dl="close" type="button">好的</button>'
    } else {
      body =
        '<div class="mcs-dl-rows">' +
        '<div class="mcs-dl-row"><span>版本</span><b>' + esc(info ? info.version : '—') + '（最新正式版）</b></div>' +
        '<div class="mcs-dl-row"><span>文件数量</span><b>' + (info ? info.count.toLocaleString() : '—') + ' 个 .ogg</b></div>' +
        '<div class="mcs-dl-row"><span>预计大小</span><b>' + (info ? fmtSize(info.bytes) : '—') + '</b></div>' +
        '</div>' +
        '<div class="mcs-dl-dir">' +
        '<div class="mcs-dl-row"><span>安装目录</span></div>' +
        '<div class="mcs-dl-dirbox">' +
        '<span class="mcs-mono" title="' + esc(DL.dir) + '">' + esc(DL.dir || '（尚未选择）') + '</span>' +
        '<button class="mcs-btn" data-dl="pick" type="button">更改</button>' +
        '</div>' +
        '</div>' +
        '<div class="mcs-dl-hint">只下载 sounds 目录下的音效，直连 Mojang 官方 CDN（resources.download.minecraft.net），<br>不经过任何第三方站点。已存在的文件会自动跳过。</div>'
      foot =
        '<button class="mcs-btn" data-dl="close" type="button">取消</button>' +
        '<button class="mcs-btn is-primary" data-dl="start" type="button">' + ICON.download + ' 开始下载</button>'
    }

    box.innerHTML =
      '<div class="mcs-dialog">' +
      '<div class="mcs-dialog-head"><b>从官方资源索引下载</b>' +
      '<button class="mcs-icon-btn" data-dl="close" type="button" aria-label="关闭">' + ICON.close + '</button></div>' +
      '<div class="mcs-dialog-body">' + body + '</div>' +
      '<div class="mcs-dialog-foot">' + foot + '</div>' +
      '</div>'

    box.querySelectorAll('[data-dl]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const act = btn.dataset.dl
        if (act === 'close') closeDialog()
        else if (act === 'retry') {
          DL.phase = 'loading'
          DL.error = ''
          renderDialog()
          void loadOfficial()
        } else if (act === 'pick') void pickDownloadDir()
        else if (act === 'start') void startDownload()
        else if (act === 'cancel') void cancelDownload()
        else if (act === 'open') {
          const NT = window.NT
          if (NT && DL.dir) NT.api.call('shell:open', DL.dir).catch(() => {})
        }
      })
    })
  }

  // ---------- 自定义标签 ----------
  function closePop() {
    if (S.pop) {
      S.pop.remove()
      S.pop = null
    }
  }

  function openTagPop(anchor, it) {
    closePop()
    const rect = anchor.getBoundingClientRect()
    const pop = document.createElement('div')
    pop.className = 'mcs-pop'
    pop.innerHTML =
      '<div class="mcs-pop-title">' + esc(it.name) + '</div>' +
      '<div class="mcs-pop-tags" data-role="list"></div>' +
      '<input type="text" maxlength="24" placeholder="输入标签后回车，如：剪辑常用" data-role="input">' +
      '<div class="mcs-pop-hint">标签只存在本机，会参与搜索。点击 × 可删除。</div>'
    document.body.appendChild(pop)
    const w = 300
    let left = rect.right - w
    if (left < 12) left = 12
    let top = rect.bottom + 8
    if (top + 200 > window.innerHeight) top = Math.max(12, rect.top - 208)
    pop.style.left = left + 'px'
    pop.style.top = top + 'px'
    S.pop = pop

    const listEl = pop.querySelector('[data-role="list"]')
    const input = pop.querySelector('[data-role="input"]')

    function draw() {
      const tags = S.tags[it.rel] || []
      listEl.innerHTML = tags.length
        ? tags
            .map(
              (t, i) =>
                '<span class="mcs-pop-tag">' + esc(t) + '<button type="button" data-del="' + i + '">×</button></span>'
            )
            .join('')
        : '<span class="mcs-pop-hint">还没有标签</span>'
      listEl.querySelectorAll('[data-del]').forEach((b) => {
        b.addEventListener('click', () => {
          const i = Number(b.dataset.del)
          const arr = (S.tags[it.rel] || []).slice()
          arr.splice(i, 1)
          if (arr.length) S.tags[it.rel] = arr
          else delete S.tags[it.rel]
          saveJSON(LS_TAGS, S.tags)
          draw()
          if (S.query.trim()) applyFilter()
          updateCount()
          paint()
        })
      })
    }

    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return
      const v = input.value.trim()
      if (!v) return
      const arr = (S.tags[it.rel] || []).slice()
      if (!arr.includes(v)) arr.push(v)
      S.tags[it.rel] = arr
      saveJSON(LS_TAGS, S.tags)
      input.value = ''
      draw()
      if (S.query.trim()) applyFilter()
      updateCount()
      paint()
    })

    draw()
    setTimeout(() => input.focus(), 30)

    setTimeout(() => {
      const off = (e) => {
        if (pop.contains(e.target)) return
        closePop()
        document.removeEventListener('mousedown', off, true)
      }
      document.addEventListener('mousedown', off, true)
    }, 0)
  }

  // ---------- 启动 ----------
  init()
  NT.MCSounds = { render, destroy }
})()
