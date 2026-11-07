'use strict'

/**
 * Lightweight renderer smoke test without a browser: loads the classic
 * renderer scripts into a VM context with a minimal DOM stub and renders the
 * home screen and every inspector panel. This catches template errors and
 * missing references that syntax checking cannot.
 */
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert')

const ROOT = path.resolve(__dirname, '..', 'app', 'renderer')
const view = { className: '', innerHTML: '', querySelector() { return null } }
const railView = { innerHTML: '' }
const fakeDocument = {
  getElementById(id) {
    if (id === 'view') return view
    if (id === 'rail') return railView
    return null
  },
  querySelector() {
    return null
  },
  querySelectorAll() {
    return []
  },
  addEventListener() {},
  createElement() {
    return { style: {}, classList: { add() {}, remove() {} }, appendChild() {}, addEventListener() {} }
  },
  body: { appendChild() {} }
}
const fakeWindow = { NT: {} }
const context = vm.createContext({
  window: fakeWindow,
  document: fakeDocument,
  console,
  setTimeout,
  clearTimeout,
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  cancelAnimationFrame: clearTimeout,
  ResizeObserver: class {
    observe() {}
    disconnect() {}
  }
})
fakeWindow.document = fakeDocument

for (const file of ['js/icons.js', 'js/format.js', 'js/state.js', 'js/ui.js', 'js/home.js', 'js/panels.js']) {
  const code = fs.readFileSync(path.join(ROOT, file), 'utf8')
  vm.runInContext(code, context, { filename: file })
}

const NT = fakeWindow.NT

function checkHtml(label, html) {
  assert.ok(html && html.length > 40, `${label}: empty html`)
  assert.ok(!/undefined/.test(html), `${label}: contains "undefined"`)
  assert.ok(!/NaN/.test(html), `${label}: contains "NaN"`)
  const open = (html.match(/<div/g) || []).length
  const close = (html.match(/<\/div>/g) || []).length
  assert.strictEqual(open, close, `${label}: unbalanced div (${open}/${close})`)
  console.log(`  ok  ${label} (${html.length} chars)`)
}

NT.state.settings = { defaultFormat: 'copy', defaultQuality: 'balanced', faststart: true }
NT.state.app = { version: '0.1.0' }
NT.state.recent = [
  {
    path: 'D:\\v\\a.mp4',
    name: 'a.mp4',
    duration: 30,
    width: 1920,
    height: 1080,
    size: 1000000,
    openedAt: Date.now()
  }
]
NT.state.ffmpeg = { connected: true, version: '7.1' }
NT.renderHome()
checkHtml('home', view.innerHTML)
assert.ok(view.innerHTML.includes('picker-folder'))
assert.ok(view.innerHTML.includes('MP4'))
assert.ok(view.innerHTML.includes('最近打开'))

const info = {
  name: '测试.mp4',
  path: 'D:\\v\\测试.mp4',
  duration: 30,
  size: 123456789,
  hasVideo: true,
  hasAudio: true,
  video: {
    codec: 'h264',
    width: 1920,
    height: 1080,
    displayWidth: 1920,
    displayHeight: 1080,
    fps: 30,
    pixFmt: 'yuv420p'
  },
  audio: { codec: 'aac', sampleRate: 48000, channels: 2 }
}
NT.state.project = {
  info,
  keyframes: [0, 2, 4, 6, 8, 10, 12],
  thumbs: [],
  waveform: null
}
NT.state.crop = { x: 0, y: 0, width: 1920, height: 1080 }
NT.state.inPoint = 2
NT.state.outPoint = 12
NT.state.splitPoints = [5, 10]
NT.state.multiClips = [
  { path: info.path, info, name: info.name, duration: info.duration },
  { path: 'D:\\v\\b.mp4', info, name: 'b.mp4', duration: info.duration }
]
NT.state.audioAction = 'extract'
NT.state.audioFormat = 'm4a'
NT.state.gif = { fps: 15, width: 480, loop: true, colors: 128 }

for (const mode of ['trim', 'multi', 'split', 'crop', 'audio', 'gif']) {
  NT.state.mode = mode
  const container = { innerHTML: '' }
  NT.renderModePanel(container)
  checkHtml(`panel:${mode}`, container.innerHTML)
}

NT.state.mode = 'audio'
for (const action of ['extract', 'trim', 'remove']) {
  NT.state.audioAction = action
  const container = { innerHTML: '' }
  NT.renderModePanel(container)
  checkHtml(`panel:audio:${action}`, container.innerHTML)
}

console.log('\nrenderer smoke passed')
