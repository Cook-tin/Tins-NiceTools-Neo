;(function () {
  const NT = (window.NT = window.NT || {})
  const MAX_HISTORY = 80

  const FIELDS = [
    'mode',
    'inPoint',
    'outPoint',
    'crop',
    'cropAspect',
    'splitPoints',
    'multiClips',
    'activeClip',
    'format',
    'quality',
    'includeVideo',
    'includeAudio',
    'audioAction',
    'audioFormat',
    'gif'
  ]

  // Fields that create a new history entry. Selecting a clip / moving the
  // playhead must not create noise in the stack.
  const TRIGGER_FIELDS = [
    'inPoint',
    'outPoint',
    'crop',
    'cropAspect',
    'splitPoints',
    'multiClips',
    'format',
    'quality',
    'includeVideo',
    'includeAudio',
    'audioAction',
    'audioFormat',
    'gif'
  ]

  const originalSetState = NT.setState

  let undoStack = []
  let redoStack = []
  let suspended = 0
  let pending = null
  let applying = false

  function clone(value) {
    if (value === undefined) return undefined
    if (typeof structuredClone === 'function') {
      try {
        return structuredClone(value)
      } catch {
        /* fall through */
      }
    }
    return JSON.parse(JSON.stringify(value))
  }

  function snapshot() {
    const source = NT.state || {}
    const result = {}
    for (const key of FIELDS) result[key] = clone(source[key])
    result.playhead = Number(source.playhead) || 0
    return result
  }

  function applySnapshot(snap) {
    const patch = {}
    for (const key of FIELDS) {
      if (snap[key] !== undefined) patch[key] = clone(snap[key])
    }
    patch.playhead = snap.playhead
    patch.estimate = null
    patch.estimating = false
    applying = true
    try {
      originalSetState(patch)
    } finally {
      applying = false
    }
    if (NT.Editor && NT.Editor.refresh) NT.Editor.refresh()
    if (NT.Editor && NT.Editor.seek) {
      try {
        NT.Editor.seek(snap.playhead, { snap: false })
      } catch {
        /* ignore */
      }
    }
  }

  function same(a, b) {
    return JSON.stringify(a) === JSON.stringify(b)
  }

  function changedTrigger(before, after) {
    for (const key of TRIGGER_FIELDS) {
      if (!same(before[key], after[key])) return true
    }
    return false
  }

  function labelFor(before, after) {
    if (!same(before.crop, after.crop) || !same(before.cropAspect, after.cropAspect)) {
      return '调整画面'
    }
    if (!same(before.inPoint, after.inPoint) || !same(before.outPoint, after.outPoint)) {
      return '调整选区'
    }
    if (!same(before.splitPoints, after.splitPoints)) return '分割'
    if (!same(before.multiClips, after.multiClips)) return '调整片段'
    if (!same(before.format, after.format)) return '导出格式'
    if (!same(before.quality, after.quality)) return '画质'
    if (!same(before.gif, after.gif)) return 'GIF 参数'
    if (
      !same(before.audioAction, after.audioAction) ||
      !same(before.audioFormat, after.audioFormat)
    ) {
      return '音频设置'
    }
    if (
      !same(before.includeVideo, after.includeVideo) ||
      !same(before.includeAudio, after.includeAudio)
    ) {
      return '保留轨道'
    }
    return '编辑'
  }

  function push(before, label) {
    const after = snapshot()
    if (!changedTrigger(before, after)) return false
    undoStack.push({ state: before, label: label || labelFor(before, after) })
    if (undoStack.length > MAX_HISTORY) undoStack.shift()
    redoStack = []
    notify()
    return true
  }

  function notify() {
    if (NT.Editor && NT.Editor.refreshHistoryButtons) NT.Editor.refreshHistoryButtons()
  }

  function begin(label) {
    if (suspended === 0) {
      pending = { before: snapshot(), label: label || '' }
    }
    suspended += 1
  }

  function end(commit) {
    if (suspended <= 0) return
    suspended -= 1
    if (suspended !== 0) return
    const item = pending
    pending = null
    if (commit !== false && item) push(item.before, item.label)
  }

  function record(label, fn) {
    begin(label)
    try {
      return fn()
    } finally {
      end(true)
    }
  }

  function undo() {
    if (!undoStack.length || applying) return false
    const entry = undoStack.pop()
    const current = snapshot()
    redoStack.push({ state: current, label: entry.label })
    applySnapshot(entry.state)
    if (NT.toast) NT.toast(`已撤销：${entry.label}`)
    notify()
    return true
  }

  function redo() {
    if (!redoStack.length || applying) return false
    const entry = redoStack.pop()
    const current = snapshot()
    undoStack.push({ state: current, label: entry.label })
    applySnapshot(entry.state)
    if (NT.toast) NT.toast(`已重做：${entry.label}`)
    notify()
    return true
  }

  function reset() {
    undoStack = []
    redoStack = []
    suspended = 0
    pending = null
    notify()
  }

  function ignoreNext() {
    begin('ignore')
    end(false)
  }

  const wrappedSetState = function (patch, opts) {
    if (applying || suspended > 0) {
      return originalSetState(patch, opts)
    }
    const before = snapshot()
    const result = originalSetState(patch, opts)
    const after = snapshot()
    if (changedTrigger(before, after)) push(before, labelFor(before, after))
    return result
  }
  NT.setState = wrappedSetState

  NT.History = {
    begin,
    end,
    record,
    undo,
    redo,
    reset,
    ignoreNext,
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    snapshot
  }
})()
