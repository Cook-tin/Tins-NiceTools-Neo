/**
 * Minimal asar packer (no dependencies). Used to test the DeepSeek Electron
 * runtime and to produce an optional asar distribution.
 *
 * Usage: node scripts/pack-asar.mjs <source-dir> <output.asar>
 */
import fs from 'node:fs'
import path from 'node:path'

const [srcArg, outArg] = process.argv.slice(2)
if (!srcArg || !outArg) {
  console.error('usage: node scripts/pack-asar.mjs <source-dir> <output.asar>')
  process.exit(1)
}
const src = path.resolve(srcArg)
const out = path.resolve(outArg)

const chunks = []
let offset = 0

function walk(dir) {
  const files = {}
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files[entry.name] = { files: walk(full) }
    } else if (entry.isFile()) {
      const data = fs.readFileSync(full)
      files[entry.name] = { size: data.length, offset: String(offset) }
      chunks.push(data)
      offset += data.length
    }
  }
  return files
}

const tree = walk(src)
const json = Buffer.from(JSON.stringify({ files: tree }), 'utf8')
const alignedLen = json.length + ((4 - (json.length % 4)) % 4)

// asar header is two nested Chromium Pickle objects:
//   [uint32=4][uint32=headerBuf.length]                          (size pickle)
//   [uint32=4+alignedLen][uint32=json.length][json][padding]     (header pickle)
// Data offsets are relative to the start of the concatenated file data,
// which begins at 8 + headerBuf.length.
const headerBuf = Buffer.alloc(8 + alignedLen)
headerBuf.writeUInt32LE(4 + alignedLen, 0)
headerBuf.writeUInt32LE(json.length, 4)
json.copy(headerBuf, 8)

const sizeBuf = Buffer.alloc(8)
sizeBuf.writeUInt32LE(4, 0)
sizeBuf.writeUInt32LE(headerBuf.length, 4)

fs.mkdirSync(path.dirname(out), { recursive: true })
const fd = fs.openSync(out, 'w')
fs.writeSync(fd, sizeBuf)
fs.writeSync(fd, headerBuf)
for (const chunk of chunks) fs.writeSync(fd, chunk)
fs.closeSync(fd)
console.log(
  `[asar] ${out} (${(fs.statSync(out).size / 1024 / 1024).toFixed(1)} MB, ${chunks.length} files, header ${headerBuf.length} bytes)`
)
