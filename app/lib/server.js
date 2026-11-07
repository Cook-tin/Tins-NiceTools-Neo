'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const logger = require('./logger')

const MIME = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.ts': 'video/mp2t',
  '.mts': 'video/mp2t',
  '.m2ts': 'video/mp2t',
  '.flv': 'video/x-flv',
  '.wmv': 'video/x-ms-wmv',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.3gp': 'video/3gpp',
  '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.avif': 'image/avif'
}

class MediaServer {
  constructor() {
    this.server = null
    this.port = 0
    this.token = crypto.randomBytes(12).toString('hex')
    this.files = new Map()
    this.ids = new Map()
  }

  async start() {
    if (this.server) return
    this.server = http.createServer((req, res) => this.handle(req, res))
    this.server.on('error', (err) => logger.error('media server error', err))
    await new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(0, '127.0.0.1', () => {
        this.port = this.server.address().port
        logger.info('media server listening', this.port)
        resolve()
      })
    })
  }

  urlFor(filePath, opts = {}) {
    const normalized = path.resolve(filePath)
    let id = this.ids.get(normalized)
    if (!id) {
      id = crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 16)
      this.ids.set(normalized, id)
      this.files.set(id, { path: normalized, cache: Boolean(opts.cache) })
    } else if (opts.cache) {
      const entry = this.files.get(id)
      if (entry) entry.cache = true
    }
    return `http://127.0.0.1:${this.port}/m/${this.token}/${id}`
  }

  handle(req, res) {
    try {
      const url = new URL(req.url, 'http://127.0.0.1')
      const prefix = `/m/${this.token}/`
      if (!url.pathname.startsWith(prefix)) {
        res.writeHead(404).end('Not found')
        return
      }
      const id = url.pathname.slice(prefix.length).split('/')[0]
      const entry = this.files.get(id)
      if (!entry) {
        res.writeHead(404).end('Not found')
        return
      }
      let stat
      try {
        stat = fs.statSync(entry.path)
      } catch {
        res.writeHead(404).end('Not found')
        return
      }
      if (!stat.isFile()) {
        res.writeHead(404).end('Not found')
        return
      }

      const ext = path.extname(entry.path).toLowerCase()
      const type = MIME[ext] || 'application/octet-stream'
      const headers = {
        'Content-Type': type,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Range',
        'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
        'Cache-Control': entry.cache ? 'public, max-age=31536000, immutable' : 'no-cache',
        'Content-Disposition': 'inline'
      }

      const range = req.headers.range
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/i.exec(String(range).trim())
        if (!match) {
          res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end()
          return
        }
        let start = match[1] === '' ? null : Number(match[1])
        let end = match[2] === '' ? null : Number(match[2])
        if (start === null && end === null) {
          res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end()
          return
        }
        if (start === null) {
          start = Math.max(0, stat.size - end)
          end = stat.size - 1
        } else {
          if (end === null || end >= stat.size) end = stat.size - 1
        }
        if (start >= stat.size || start > end) {
          res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end()
          return
        }
        headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`
        headers['Content-Length'] = String(end - start + 1)
        res.writeHead(206, headers)
        if (req.method === 'HEAD') {
          res.end()
          return
        }
        const stream = fs.createReadStream(entry.path, { start, end })
        stream.on('error', () => {
          try {
            res.destroy()
          } catch {
            /* ignore */
          }
        })
        stream.pipe(res)
        return
      }

      headers['Content-Length'] = String(stat.size)
      res.writeHead(200, headers)
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      const stream = fs.createReadStream(entry.path)
      stream.on('error', () => {
        try {
          res.destroy()
        } catch {
          /* ignore */
        }
      })
      stream.pipe(res)
    } catch (err) {
      logger.error('media server request failed', err)
      try {
        res.writeHead(500).end()
      } catch {
        /* ignore */
      }
    }
  }

  close() {
    if (this.server) {
      try {
        this.server.close()
      } catch {
        /* ignore */
      }
      this.server = null
    }
  }
}

module.exports = { MediaServer }
