/**
 * Captures a PNG from the running NiceTools renderer via the Chrome DevTools
 * Protocol. Usage: node scripts/cdp-shot.mjs <out.png> [expression]
 */
import fs from 'node:fs'
import path from 'node:path'

const port = process.env.CDP_PORT || '9223'
const out = path.resolve(process.argv[2] || 'screenshot.png')
const expression = process.env.CDP_EXPR || process.argv[3]

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = list.find((t) => t.type === 'page' && t.url.includes('renderer/index.html')) || list[0]
if (!page) throw new Error('no page target')

const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) reject(new Error(JSON.stringify(msg.error)))
    else resolve(msg.result)
  }
})

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const mid = ++id
    pending.set(mid, { resolve, reject })
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
}

await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', reject, { once: true })
})

await send('Page.enable')
await send('Runtime.enable')

if (expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  })
  console.log('eval:', JSON.stringify(result.result?.value ?? result.result?.description))
  await new Promise((r) => setTimeout(r, 900))
}

const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, Buffer.from(shot.data, 'base64'))
console.log('screenshot:', out, fs.statSync(out).size, 'bytes')
ws.close()
process.exit(0)
