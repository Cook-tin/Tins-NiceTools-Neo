'use strict'

/**
 * NT-addon-Search — 主进程模块
 *
 * 由 lib/ipc.js 里一行 handler 引入：
 *   handler('addon:mcsounds', (_e, req) => require('../../../../NT-addon-Search/main.js').handle(req))
 *
 * 对外只暴露 handle(req)，req.fn 取：
 *   scan      扫描本地音效库（读 sounds/ + manifest.json + zh-index.json）
 *   official  读取官方资源索引，返回版本号 / 文件数 / 总大小
 *   download  按官方资源索引下载音效，下载完成后生成 manifest.json 与 zh-index.json
 *   status    轮询下载进度
 *   cancel    取消下载
 *
 * 不修改 NiceTools 的任何既有逻辑，也不依赖它的私有 API。
 */

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { execFileSync, execFile } = require('node:child_process')

const ADDON_DIR = __dirname
const DATA_DIR = __dirname

const VERSION_MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
const RESOURCE_BASE = 'https://resources.download.minecraft.net'
const SOUNDS_PREFIX = 'minecraft/sounds/'
const SOUNDS_JSON_KEY = 'minecraft/sounds.json'
const LANG_ZH_KEY = 'minecraft/lang/zh_cn.json'
const CONCURRENCY = 8
const MAX_DEPTH = 8

const job = {
  running: false,
  phase: 'idle',
  version: '',
  dir: '',
  total: 0,
  done: 0,
  skipped: 0,
  failed: 0,
  bytes: 0,
  totalBytes: 0,
  current: '',
  error: '',
  cancelled: false,
  zhCount: 0,
  zhSource: '',
  startedAt: 0,
  finishedAt: 0
}

let officialCache = null
let cancelFlag = false

// ---------------------------------------------------------------- 基础工具

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

async function fetchJson(url, timeoutMs = 30000) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'NiceTools-MCSounds/1.0' }
    })
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

async function fetchBuffer(url, timeoutMs = 60000) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'NiceTools-MCSounds/1.0' }
    })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    return Buffer.from(await res.arrayBuffer())
  } finally {
    clearTimeout(timer)
  }
}

function resourceUrl(hash) {
  return RESOURCE_BASE + '/' + hash.slice(0, 2) + '/' + hash
}

// ---------------------------------------------------------------- Ogg 时长

/**
 * 从 Ogg Vorbis 里读时长：识别头拿采样率，最后一个合法 page 的 granule 位置除以采样率。
 * 只读文件首 4KB 与尾 16KB，4961 个文件也很快。
 */
function oggDuration(abs) {
  let fd
  try {
    fd = fs.openSync(abs, 'r')
    const size = fs.fstatSync(fd).size
    if (size < 128) return 0

    const headLen = Math.min(4096, size)
    const head = Buffer.alloc(headLen)
    fs.readSync(fd, head, 0, headLen, 0)
    const idx = head.indexOf('vorbis')
    if (idx < 0 || idx + 15 > headLen) return 0
    const sampleRate = head.readUInt32LE(idx + 11)
    if (sampleRate < 1000 || sampleRate > 400000) return 0

    const tailLen = Math.min(16384, size)
    const tail = Buffer.alloc(tailLen)
    fs.readSync(fd, tail, 0, tailLen, size - tailLen)

    let best = 0
    for (let p = tail.indexOf('OggS'); p >= 0; p = tail.indexOf('OggS', p + 4)) {
      if (p + 27 > tailLen) continue
      if (tail[p + 4] !== 0) continue
      const seg = tail[p + 26]
      if (p + 27 + seg > tailLen) continue
      let bodyLen = 0
      for (let i = 0; i < seg; i++) bodyLen += tail[p + 27 + i]
      const pageLen = 27 + seg + bodyLen
      if (p + pageLen > tailLen + 1) continue
      const granule = Number(tail.readBigInt64LE(p + 6))
      if (granule >= 0 && granule < 1e9) best = granule
    }
    return best ? best / sampleRate : 0
  } catch {
    return 0
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd)
      } catch {}
    }
  }
}

// ---------------------------------------------------------------- 扫描本地库

function walkSounds(soundsDir) {
  const files = []
  const walk = (dir, rel, depth) => {
    if (depth > MAX_DEPTH) return
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue
      const full = path.join(dir, ent.name)
      const nextRel = rel ? rel + '/' + ent.name : ent.name
      if (ent.isDirectory()) {
        walk(full, nextRel, depth + 1)
      } else if (ent.name.toLowerCase().endsWith('.ogg')) {
        try {
          const s = fs.statSync(full)
          files.push({ rel: nextRel, abs: full, size: s.size, mtime: s.mtimeMs })
        } catch {}
      }
    }
  }
  walk(soundsDir, '', 0)
  return files
}

function scan(root) {
  if (typeof root !== 'string' || !root.trim()) throw new Error('尚未选择目录')
  const base = path.resolve(root)
  const soundsDir = path.join(base, 'sounds')
  let stat
  try {
    stat = fs.statSync(soundsDir)
  } catch {
    throw new Error('所选目录里没有 sounds 文件夹')
  }
  if (!stat.isDirectory()) throw new Error('sounds 不是一个文件夹')

  return {
    base,
    files: walkSounds(soundsDir),
    manifest: readJson(path.join(base, 'manifest.json')),
    zh: readJson(path.join(base, 'zh-index.json'))
  }
}

// ---------------------------------------------------------------- 官方索引

async function officialPlan() {
  if (officialCache) return officialCache

  const manifest = await fetchJson(VERSION_MANIFEST_URL)
  const releaseId = manifest && manifest.latest && manifest.latest.release
  if (!releaseId) throw new Error('无法读取官方版本列表')
  const entry = (manifest.versions || []).find((v) => v.id === releaseId)
  if (!entry) throw new Error('版本列表里找不到 ' + releaseId)

  const detail = await fetchJson(entry.url)
  if (!detail.assetIndex || !detail.assetIndex.url) throw new Error('该版本没有资源索引')

  const index = await fetchJson(detail.assetIndex.url, 60000)
  const objects = index.objects || {}

  const sounds = []
  let bytes = 0
  for (const key of Object.keys(objects)) {
    if (!key.startsWith(SOUNDS_PREFIX)) continue
    if (!key.toLowerCase().endsWith('.ogg')) continue
    const obj = objects[key]
    sounds.push({
      rel: key.slice(SOUNDS_PREFIX.length),
      hash: obj.hash,
      size: obj.size
    })
    bytes += obj.size
  }
  sounds.sort((a, b) => a.rel.localeCompare(b.rel, 'en', { numeric: true }))
  if (!sounds.length) throw new Error('资源索引里没有音效文件')

  officialCache = {
    version: releaseId,
    assetIndexId: detail.assetIndex.id || '',
    count: sounds.length,
    bytes,
    sounds,
    objects,
    soundsJsonHash: (objects[SOUNDS_JSON_KEY] || {}).hash || '',
    langHash: (objects[LANG_ZH_KEY] || {}).hash || ''
  }
  return officialCache
}

// ---------------------------------------------------------------- 下载引擎

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true })
}

async function downloadOne(item, soundsDir) {
  const base = path.resolve(soundsDir)
  const dest = path.resolve(base, item.rel.split('/').join(path.sep))
  if (dest !== base && !dest.startsWith(base + path.sep)) {
    throw new Error('非法资源路径 ' + item.rel)
  }
  try {
    const st = await fsp.stat(dest)
    if (st.size === item.size) {
      job.skipped++
      job.done++
      job.bytes += item.size
      return
    }
  } catch {}
  await ensureDir(path.dirname(dest))
  const buf = await fetchBuffer(resourceUrl(item.hash))
  if (buf.length !== item.size) {
    throw new Error('大小不符 ' + item.rel)
  }
  const digest = crypto.createHash('sha1').update(buf).digest('hex')
  if (String(item.hash).toLowerCase() !== digest.toLowerCase()) {
    throw new Error('SHA1 校验失败 ' + item.rel)
  }
  const tmp = dest + '.part'
  await fsp.writeFile(tmp, buf)
  await fsp.rename(tmp, dest)
  job.done++
  job.bytes += buf.length
}

async function runPool(items, limit, worker) {
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!cancelFlag) {
      const i = next++
      if (i >= items.length) return
      try {
        await worker(items[i], i)
      } catch (err) {
        job.failed++
        job.done++
        if (!job.error) job.error = items[i].rel + '：' + err.message
      }
    }
  })
  await Promise.all(runners)
}

// ---------------------------------------------------------------- 生成 manifest

function buildEventMap(soundsJson) {
  const events = {}
  const fileMap = {}

  const resolve = (name, depth, seen) => {
    if (depth > 6 || seen.has(name)) return []
    const def = soundsJson[name]
    if (!def) return []
    const list = []
    for (const s of def.sounds || []) {
      const soundName = typeof s === 'string' ? s : s.name
      if (!soundName) continue
      const isEvent = typeof s === 'object' && s.type === 'event'
      if (isEvent) {
        seen.add(name)
        list.push(...resolve(soundName, depth + 1, seen))
        seen.delete(name)
      } else {
        list.push({
          rel: soundName.replace(/\\/g, '/').replace(/\.ogg$/i, '') + '.ogg',
          volume: typeof s === 'object' && s.volume != null ? Number(s.volume) : 1,
          pitch: typeof s === 'object' && s.pitch != null ? Number(s.pitch) : 1
        })
      }
    }
    return list
  }

  for (const name of Object.keys(soundsJson)) {
    const def = soundsJson[name] || {}
    const refs = resolve(name, 0, new Set())
    events[name] = {
      category: def.category || '',
      subtitle: def.subtitle || '',
      files: []
    }
    for (const r of refs) {
      if (!events[name].files.includes(r.rel)) events[name].files.push(r.rel)
      if (!fileMap[r.rel]) fileMap[r.rel] = { events: [], volume: r.volume, pitch: r.pitch }
      if (!fileMap[r.rel].events.includes(name)) fileMap[r.rel].events.push(name)
    }
  }
  return { events, fileMap }
}

async function writeManifest(base, plan, soundsJson) {
  const soundsDir = path.join(base, 'sounds')
  const { events, fileMap } = buildEventMap(soundsJson)
  const files = []

  for (const s of plan.sounds) {
    const abs = path.join(soundsDir, s.rel.split('/').join(path.sep))
    const info = fileMap[s.rel] || null
    files.push({
      path: s.rel,
      rel: s.rel,
      abs,
      hash: s.hash,
      size: s.size,
      duration: oggDuration(abs),
      events: info ? info.events : [],
      volume: info ? info.volume : 1,
      pitch: info ? info.pitch : 1
    })
  }

  const totalBytes = files.reduce((n, f) => n + f.size, 0)
  const manifest = {
    meta: {
      source: 'Minecraft Java Edition ' + plan.version + ' 官方资源索引（piston-meta / resources.download.minecraft.net）',
      minecraft_version: plan.version,
      asset_index: plan.assetIndexId,
      generated_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
      base_dir: 'sounds/',
      file_count: files.length,
      event_count: Object.keys(events).length,
      total_bytes: totalBytes,
      format: 'ogg (Vorbis)'
    },
    events,
    files
  }
  await fsp.writeFile(path.join(base, 'manifest.json'), JSON.stringify(manifest), 'utf8')
  return manifest.meta
}

// ---------------------------------------------------------------- 中文索引
//
// 完全依据官方 lang/zh_cn.json + sounds.json 现场生成。
// 官方发新版本 -> 用户点一次下载 -> 中文名自动跟上，无需重新发布插件。
//
// 名词：官方 zh_cn.json 里的 block/item/entity/biome/enchantment/effect 条目
// 动作：内置词表（不随版本变），词表没有的再从 subtitle 冒号后取
// 拼音：data/pinyin.json（6763 汉字，含多音字），生成的字段是空格分隔的多个候选

const PINYIN = readJson(path.join(DATA_DIR, 'pinyin.json')) || {}

const CATEGORY = {
  block: '方块', entity: '实体', item: '物品', ui: '界面',
  music: '音乐', music_disc: '唱片', ambient: '环境', weather: '天气',
  event: '事件', particle: '粒子', enchant: '附魔', mob: '生物',
  random: '随机', dig: '挖掘', step: '脚步', tile: '方块',
  note: '音符', records: '唱片', liquid: '液体', portal: '传送门',
  fire: '火焰', damage: '受伤', minecart: '矿车', fireworks: '烟花'
}

const ACTION = {
  step: '脚步声', break: '破坏', hit: '击打', place: '放置',
  fall: '落下', death: '死亡', hurt: '受伤', ambient: '环境音',
  eat: '进食', close: '关闭', open: '打开', use: '使用',
  attack: '攻击', click_on: '开启', click_off: '关闭',
  shoot: '射击', swim: '游泳', angry: '愤怒', push: '推动',
  jump: '跳跃', throw: '投掷', growl: '低吼', loop: '循环音',
  pant: '喘息', whine: '呜咽', land: '落地', idle: '待机',
  spawn: '生成', flop: '拍打', celebrate: '庆祝',
  additions: '附加音', shear: '剪毛', splash: '溅水', mood: '氛围',
  activate: '激活', deactivate: '停用', fill: '装填', charge: '蓄力',
  dash: '冲刺', dash_ready: '冲刺就绪', milk: '挤奶',
  unequip: '卸下', squish: '挤压', extinguish: '熄灭',
  insert: '插入', pickup: '拾取', click: '点击', empty: '倒空',
  launch: '发射', bounce: '弹跳', beg_for_food: '讨食', hiss: '嘶嘶声',
  purr: '呼噜声', purreow: '喵呜', explode: '爆炸', prime: '引燃',
  fuse: '引信', burn: '燃烧', ignite: '点燃', teleport: '传送',
  drink: '饮用', equip: '装备', levelup: '升级', toggle: '切换',
  saddle: '上鞍', unsaddle: '卸鞍', ride: '骑乘', lay: '下蛋',
  roll: '滚动', slide: '滑行', scrape: '刮擦', wax: '打蜡',
  oxidize: '氧化', brush: '刷拭', dig: '挖掘', grow: '生长',
  sip: '啜饮', burst: '爆裂', ring: '钟声', resonate: '共鸣',
  shimmer: '微光', crack: '龟裂', hatch: '孵化', retrieve: '收回',
  impact: '撞击', haggle: '议价', advertise: '叫卖',
  ambient_land: '环境落地', death_land: '死亡落地', hurt_land: '受伤落地',
  ambient_water: '水中环境', swim_idle: '水中待机', jump_water: '入水',
  attack_strong: '重击', attack_weak: '轻击', deflect: '格挡',
  parry: '招架', wind_burst: '风爆', shoot_multi: '多重射击'
}

const PREFIX = {
  baby_: '幼年', waxed_: '打蜡', exposed_: '斑驳', weathered_: '风化',
  oxidized_: '氧化', stripped_: '去皮', cracked_: '裂纹', chiseled_: '雕纹',
  polished_: '磨制', smooth_: '平滑', deepslate_: '深板岩', zombie_: '僵尸'
}

const NOUN_PREFIXES = [
  'block.minecraft.',
  'item.minecraft.',
  'entity.minecraft.',
  'biome.minecraft.',
  'enchantment.minecraft.',
  'effect.minecraft.'
]

const MUSIC_SCENE = {
  game: '主世界', creative: '创造模式', menu: '主菜单', end: '末地',
  dragon: '末影龙', credits: '制作名单', under_water: '水下', water: '水下'
}
const MUSIC_DIM = { overworld: '主世界', nether: '下界', end: '末地' }

// 多音字组合上限：一个中文名里多音字通常 0~2 个，8 个候选足够
const PY_LIMIT = 8

// 只有这些字才启用「副音」参与候选。
// pypinyin 的 heteronym 很激进（"坏"会给出 huai/pi/pei），全量启用会让索引里
// 塞满无意义的候选。这里手工挑出 MC 语料里真正需要多音的字。
const POLYPHONE = new Set([
  '乐', '重', '弹', '落', '血', '着', '行', '藏', '和', '长',
  '差', '觉', '角', '降', '恶', '传', '背', '薄', '曲', '蒙',
  '石', '地', '得', '大', '发', '处', '系', '应', '露', '种',
  '分', '数', '少', '好', '间', '空', '干', '漂', '佛', '阿'
])

function readingsOf(ch) {
  const v = PINYIN[ch]
  if (!v) return null
  if (typeof v === 'string') return [v]
  return POLYPHONE.has(ch) ? v.slice(0, 2) : [v[0]]
}

/** 笛卡尔积，最多 cap 个；第一个组合始终是主音 */
function combos(groups, cap) {
  let out = ['']
  for (const g of groups) {
    const next = []
    for (const prefix of out) {
      for (const r of g) {
        next.push(prefix + r)
        if (next.length >= cap) break
      }
      if (next.length >= cap) break
    }
    out = next
  }
  return out.length ? out : ['']
}

/** 中文 -> { p: '全拼候选', i: '首字母候选' } */
function pinyinFields(text) {
  const full = []
  const first = []
  for (const ch of String(text || '')) {
    if (ch >= '\u4e00' && ch <= '\u9fff') {
      const rs = readingsOf(ch)
      if (!rs) continue
      full.push(rs)
      first.push(rs.map((r) => r[0]))
    } else {
      const m = ch.toLowerCase().match(/[a-z0-9]/)
      if (m) {
        full.push([m[0]])
        first.push([m[0]])
      }
    }
  }
  return {
    p: combos(full, PY_LIMIT).join(' '),
    i: combos(first, PY_LIMIT).join(' ')
  }
}

/** token -> 中文名词，查不到返回空串 */
function nounLookup(token, lang) {
  if (!token) return ''
  for (const p of NOUN_PREFIXES) {
    const v = lang[p + token]
    if (v) return v
  }
  for (const pre of Object.keys(PREFIX)) {
    if (token.startsWith(pre) && token.length > pre.length) {
      const base = nounLookup(token.slice(pre.length), lang)
      if (base) return PREFIX[pre] + base
    }
  }
  if (token.includes('_')) {
    const outs = []
    for (const part of token.split('_')) {
      const v = nounLookup(part, lang)
      if (v) outs.push(v)
    }
    if (outs.length) return outs.join('')
  }
  return ''
}

/** 一个事件名 -> 中文条目 */
function zhEntryFor(ev, def, lang) {
  const parts = ev.split('.')
  const cat = parts[0]
  const action = parts.length > 1 ? parts[parts.length - 1] : ''
  const mids = parts.length > 2 ? parts.slice(1, -1) : []
  const sub = lang[def.subtitle || ''] || ''

  // —— 特殊族：音乐 / 唱片 / 水下环境 / 界面提示 ——
  let special = ''
  if (cat === 'music') {
    if (mids.length && MUSIC_DIM[mids[0]]) {
      const dim = MUSIC_DIM[mids[0]]
      const tail = mids.slice(1).join('_')
      const scene = nounLookup(tail, lang) || tail
      special = dim + '·' + scene + '·音乐'
    } else {
      const key = mids.join('_') || action
      special = (MUSIC_SCENE[key] || '游戏') + '·背景音乐'
    }
  } else if (cat === 'music_disc') {
    const track = mids.length ? mids[0] : action
    const desc = lang['item.minecraft.music_disc_' + track + '.desc'] || ''
    special = '唱片·' + (desc || track)
  } else if (ev.startsWith('ambient.underwater')) {
    const tail = parts.slice(2).join('.') || 'loop'
    const uw = { enter: '进入', exit: '离开', loop: '循环音', 'loop.additions': '附加音' }
    const last = tail.split('.').pop()
    special = '水下·' + (uw[tail] || ACTION[last] || tail)
  } else if (ev.startsWith('ui.toast.')) {
    const toast = { challenge_complete: '挑战完成提示音', in: '提示弹出', out: '提示收起' }
    special = '界面·' + (toast[action] || action)
  }

  // —— 名词：优先靠后的中段，再试整段 ——
  let noun = ''
  for (let i = mids.length - 1; i >= 0; i--) {
    noun = nounLookup(mids[i], lang)
    if (noun) break
  }
  if (!noun && mids.length) noun = nounLookup(mids.join('_'), lang)

  // —— 动作：词表，其次 subtitle 冒号后 ——
  let act = ACTION[action] || ''
  if (!act && sub) {
    if (sub.includes('：')) act = sub.split('：')[1]
    else if (sub.includes(':')) act = sub.split(':')[1]
  }

  const catZh = CATEGORY[cat] || cat
  let name
  if (special) name = special
  else if (noun && act) name = noun + '·' + act
  else if (sub) name = sub
  else if (noun) name = noun
  else if (act) name = catZh + '·' + act
  else name = ev

  // —— 关键词：类别 + 事件名 + 名词 + 动作 + 字幕 + 各中段译名 ——
  const kws = [catZh, ev]
  if (noun) kws.push(noun)
  if (act) kws.push(act)
  if (sub) kws.push(sub)
  for (const t of mids) {
    const v = nounLookup(t, lang)
    kws.push(v || t.replace(/_/g, ' '))
  }
  if (action) kws.push(action.replace(/_/g, ' '))

  const py = pinyinFields(name)
  const kw = Array.from(new Set(kws.filter(Boolean))).join(' ')

  return {
    sub: !!sub,
    noun: !!noun,
    act: !!act,
    entry: { n: name, d: sub || name, c: cat, a: action, p: py.p, i: py.i, k: kw }
  }
}

function buildZhIndex(lang, soundsJson) {
  const items = {}
  const stat = { sub: 0, noun: 0, act: 0, fallback: 0 }
  for (const ev of Object.keys(soundsJson).sort()) {
    const r = zhEntryFor(ev, soundsJson[ev] || {}, lang)
    items[ev] = r.entry
    if (r.sub) stat.sub++
    if (r.noun) stat.noun++
    if (r.act) stat.act++
    if (!r.sub && !r.noun && !r.act) stat.fallback++
  }
  return { items, stat }
}

/**
 * 写 zh-index.json
 * 只用官方 lang/zh_cn.json 现场生成（仓库不内置任何 Minecraft 译名数据）。
 * 拿不到语言文件时返回 source: 'none'，搜索退化为英文事件名匹配。
 */
async function writeZhIndex(base, plan, soundsJson) {
  const dst = path.join(base, 'zh-index.json')

  let lang = null
  if (plan && plan.langHash) {
    try {
      const buf = await fetchBuffer(resourceUrl(plan.langHash), 90000)
      lang = JSON.parse(buf.toString('utf8'))
    } catch {
      lang = null
    }
  }

  if (!lang || !Object.keys(lang).length) {
    return { count: 0, source: 'none' }
  }

  const { items, stat } = buildZhIndex(lang, soundsJson || {})
  const out = {
    meta: {
      version: (plan && plan.version) || '',
      lang: 'zh_cn',
      generated_from: 'official',
      generated_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
      count: Object.keys(items).length,
      note: 'n=中文名 d=中文描述 c=类别 a=动作 p=全拼(空格分隔多候选) i=首字母 k=关键词'
    },
    items
  }
  await fsp.writeFile(dst, JSON.stringify(out), 'utf8')
  return { count: Object.keys(items).length, source: 'generated', stat }
}

async function writeReadme(base, meta, zh) {
  const zhCount = (zh && zh.count) || 0
  const zhHow =
    zh && zh.source === 'generated'
      ? '官方 lang/zh_cn.json 现场生成（' + zhCount + ' 条事件）'
      : '未生成（本次未能读取官方 lang/zh_cn.json，搜索仅支持英文事件名；联网后重新下载即可生成）'
  const lines = [
    'MCSounds 本地音效库',
    '===================',
    '',
    '来源：Minecraft Java Edition ' + meta.minecraft_version + ' 官方资源索引',
    '      https://piston-meta.mojang.com  →  https://resources.download.minecraft.net',
    '      文件内容与官方一致（按 SHA1 校验），不经过任何第三方站点。',
    '',
    '结构：',
    '  sounds/            ' + meta.file_count + ' 个 .ogg，路径沿用官方资源结构，请勿改名',
    '  manifest.json      文件→事件映射、时长、音量与音高',
    '  zh-index.json      事件→中文名 / 描述 / 分类 / 拼音',
    '',
    '中文名来源：' + zhHow,
    '            官方发新版本后，在搜索器里再点一次「从官方资源索引下载」即可刷新中文名。',
    '',
    '使用：在 NiceTools 的「本地MC音效搜索器」里点击「链接目录」，选中本文件夹即可。',
    '',
    '更新音效：',
    '  方式一（推荐）：在搜索器里点「从官方资源索引下载」，选同一个目录，',
    '                  已存在的文件会自动跳过，只补新增部分。',
    '  方式二：手动把新的 .ogg 放进 sounds/ 任意子目录，重启 NiceTools 即可搜到。',
    '',
    '注意：音效版权归 Mojang / Microsoft 所有，仅供个人学习与创作使用。'
  ]
  await fsp.writeFile(path.join(base, 'README.txt'), lines.join('\r\n'), 'utf8')
}

// ---------------------------------------------------------------- 拖拽导出
//
// 把选中的音效拖进外部剪辑软件：
//   mode = 'raw'  直接拖原 .ogg（零延迟，但 PR / AE / 达芬奇不认 Ogg Vorbis）
//   mode = 'wav'  用 NiceTools 自带的 ffmpeg 转成 wav 再拖（通用格式，实测 70ms/个）
//
// 走 ipcRenderer.sendSync —— startDrag 必须在 dragstart 事件里同步发起，
// 异步 send 会让拖拽循环错过时机。sendSync 会阻塞到拖放结束，这正是我们要的。

const DRAG_CHANNEL = 'mcsounds:drag'
// 转好的 wav 落在音效库根目录下的 _drag_wav\，跟着素材一起管理，不占 C 盘。
// 与 sounds\ 平级，扫描只从 sounds\ 开始，不会把 wav 当成音效收进来。
const DRAG_SUBDIR = '_drag_wav'
const LEGACY_DRAG_DIR = path.join(os.tmpdir(), 'mcsounds-drag')   // 旧版缓存位置，启动时清理
const DRAG_BUDGET_MS = 800
const DRAG_ICON = path.join(ADDON_DIR, 'drag.png')

let ffmpegCache = ''

function findFfmpeg() {
  if (ffmpegCache !== '') return ffmpegCache
  const candidates = []
  try {
    const appPath = require('electron').app.getAppPath()
    candidates.push(path.resolve(appPath, '../../ffmpeg/bin/ffmpeg.exe'))
    candidates.push(path.resolve(appPath, '../../ffmpeg/bin/ffmpeg'))
  } catch {}
  candidates.push(path.resolve(ADDON_DIR, '../NiceTools/ffmpeg/bin/ffmpeg.exe'))
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) {
        ffmpegCache = c
        return c
      }
    } catch {}
  }
  ffmpegCache = ''   // 交给 PATH 里的 ffmpeg；没有就只能拖原文件
  return ''
}

function safeFileName(name, fallback) {
  const out = String(name || '')
    .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
    .replace(/^[.\s]+/, '')
    .trim()
    .slice(0, 80)
  return out || fallback || 'sound'
}

function dragKey(item) {
  return crypto
    .createHash('sha1')
    .update(String(item.abs) + '|' + String(item.size || 0))
    .digest('hex')
    .slice(0, 16)
}

/**
 * 拖拽用的 wav 目录：默认是 <音效库根目录>\_drag_wav
 * 目录不存在 / 不可写时回退到系统临时目录（此时不保证持久化）
 */
function dragDirFor(base) {
  const b = String(base || '').trim()
  if (b && path.isAbsolute(b)) {
    const dir = path.join(b, DRAG_SUBDIR)
    try {
      if (!fs.statSync(dir).isDirectory()) throw new Error('not dir')
    } catch {
      try {
        fs.mkdirSync(dir, { recursive: true })
      } catch {
        return { dir: fallbackDragDir(), persistent: false }
      }
    }
    try {
      if (!fs.statSync(dir).isDirectory()) throw new Error('not dir')
      const probe = path.join(dir, '.w')
      fs.writeFileSync(probe, '1')
      fs.rmSync(probe, { force: true })
      return { dir, persistent: true }
    } catch {
      return { dir: fallbackDragDir(), persistent: false }
    }
  }
  return { dir: fallbackDragDir(), persistent: false }
}

function fallbackDragDir() {
  try {
    fs.mkdirSync(LEGACY_DRAG_DIR, { recursive: true })
  } catch {}
  return LEGACY_DRAG_DIR
}

/** 清掉旧版本留在 C 盘临时目录里的 wav（升级后一次性释放） */
function cleanLegacyDragCache() {
  try {
    fs.rmSync(LEGACY_DRAG_DIR, { recursive: true, force: true })
  } catch {}
}

// ---- 文件名分配 ----
// 目录里放一份 .cache.json 记录「文件名 → 源文件指纹」，
// 这样同名不同源也不会互相覆盖，而正常情况文件名仍然是干净的中文名。
const dragMaps = new Map()   // dir -> { baseName: key }

function dragMapOf(dir) {
  if (dragMaps.has(dir)) return dragMaps.get(dir)
  let map = {}
  try {
    const o = JSON.parse(fs.readFileSync(path.join(dir, '.cache.json'), 'utf8'))
    if (o && typeof o === 'object' && !Array.isArray(o)) map = o
  } catch {}
  dragMaps.set(dir, map)
  return map
}

function saveDragMap(dir) {
  try {
    fs.writeFileSync(path.join(dir, '.cache.json'), JSON.stringify(dragMapOf(dir)))
  } catch {}
}

/** 为某个音效在 dir 里定位（或分配）一个 wav 路径 */
function wavPathFor(item, dir) {
  const map = dragMapOf(dir)
  const key = dragKey(item)
  const base = safeFileName(item.name, path.basename(item.abs).replace(/\.ogg$/i, ''))

  // 同一个源文件之前分配过名字：沿用同一个路径（文件缺失/残缺就重写它）
  for (const [name, k] of Object.entries(map)) {
    if (k === key && name.startsWith(base)) return path.join(dir, name + '.wav')
  }

  const taken = (name) => {
    if (map[name] !== undefined) return true
    try {
      return fs.statSync(path.join(dir, name + '.wav')).isFile()
    } catch {
      return false
    }
  }

  let name = base
  if (taken(name)) name = base + '~' + key.slice(0, 6)
  let n = 2
  while (taken(name)) name = base + '~' + key.slice(0, 6) + '-' + n++

  map[name] = key
  saveDragMap(dir)
  return path.join(dir, name + '.wav')
}

/** 转成 wav 放到指定目录，返回 wav 绝对路径 */
function ensureWav(item, ffmpeg, dir) {
  const out = wavPathFor(item, dir)
  try {
    if (fs.statSync(out).size > 44) return out
  } catch {}

  const tmp = out.replace(/\.wav$/i, '.__tmp' + process.pid + '_' + Date.now() + '.wav')
  execFileSync(
    ffmpeg,
    ['-v', 'error', '-y', '-i', item.abs, '-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le', tmp],
    { timeout: 8000, windowsHide: true, stdio: 'ignore' }
  )
  fs.renameSync(tmp, out)
  return out
}

function onDragSync(event, payload) {
  const p = payload || {}
  const items = Array.isArray(p.items) ? p.items : []
  const mode = p.mode === 'wav' ? 'wav' : 'raw'
  let result = { ok: false, count: 0, wav: 0, raw: 0, dir: '', error: '' }

  try {
    const outs = []
    const done = new Set()
    if (mode === 'wav') {
      const ffmpeg = findFfmpeg()
      if (!ffmpeg) {
        result.error = '没有找到 ffmpeg，已改为拖出原始 ogg'
      } else {
        const { dir, persistent } = dragDirFor(p.dst)
        result.dir = persistent ? dir : ''
        const started = Date.now()
        for (const it of items) {
          if (!it || !it.abs) continue
          try {
            if (fs.statSync(it.abs).isFile()) {
              outs.push(ensureWav(it, ffmpeg, dir))
              done.add(it.abs)
              result.wav++
            }
          } catch {
            /* 单个失败不影响其他，下面统一补原文件 */
          }
          // 预算用尽就停手，剩下的按原文件拖，避免用户在拖动时卡太久
          if (Date.now() - started > DRAG_BUDGET_MS) break
        }
      }
    }

    // 未转码 / 转码失败 / 已超预算的部分，一律回退到原 ogg
    for (const it of items) {
      if (!it || !it.abs || done.has(it.abs)) continue
      try {
        if (fs.statSync(it.abs).isFile()) {
          outs.push(it.abs)
          done.add(it.abs)
          result.raw++
        }
      } catch {}
    }

    if (!outs.length) {
      result.error = result.error || '没有可拖出的文件'
    } else {
      const opts = { files: outs }
      try {
        if (fs.statSync(DRAG_ICON).isFile()) opts.icon = DRAG_ICON
      } catch {}
      event.sender.startDrag(opts)
      result.ok = true
      result.count = outs.length
    }
  } catch (err) {
    result.ok = false
    result.error = (err && err.message) || String(err)
  }

  // 必须先给 returnValue，否则渲染进程会一直阻塞
  event.returnValue = {
    ok: result.ok,
    count: result.count,
    wav: result.wav,
    raw: result.raw,
    dir: result.dir,
    error: result.error
  }
}

let dragRegistered = false

function registerDragChannel() {
  if (dragRegistered) return
  let ipcMain = null
  try {
    ipcMain = require('electron').ipcMain
  } catch {
    return
  }
  if (!ipcMain || typeof ipcMain.on !== 'function') return
  dragRegistered = true
  ipcMain.on(DRAG_CHANNEL, onDragSync)
  setTimeout(cleanLegacyDragCache, 3000)
}

// ---------------------------------------------------------------- 拖拽预热
//
// 鼠标按下时就把 wav 转好放进缓存，真正 dragstart 时直接命中，
// 避免用户在拖动那一刻等转码。

async function ensureWavAsync(item, ffmpeg, dir) {
  const out = wavPathFor(item, dir)
  try {
    if (fs.statSync(out).size > 44) return out
  } catch {}

  const tmp = out.replace(/\.wav$/i, '.__tmp' + process.pid + '_' + Date.now() + '.wav')
  await new Promise((resolve, reject) => {
    execFile(
      ffmpeg,
      ['-v', 'error', '-y', '-i', item.abs, '-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le', tmp],
      { timeout: 8000, windowsHide: true },
      (err) => (err ? reject(err) : resolve())
    )
  })
  await fsp.rename(tmp, out)
  return out
}

let warmRunning = false

async function warm(items, dst) {
  if (warmRunning) return { ok: 0, busy: true }
  const ffmpeg = findFfmpeg()
  if (!ffmpeg) return { ok: 0, error: 'no ffmpeg' }

  const list = (items || []).filter((x) => x && x.abs).slice(0, 40)
  if (!list.length) return { ok: 0 }

  const { dir, persistent } = dragDirFor(dst)
  warmRunning = true
  let ok = 0
  let i = 0
  const worker = async () => {
    while (i < list.length) {
      const it = list[i++]
      try {
        await ensureWavAsync(it, ffmpeg, dir)
        ok++
      } catch {
        /* 单个失败不影响其他 */
      }
    }
  }
  try {
    await Promise.all([worker(), worker(), worker(), worker()])
  } finally {
    warmRunning = false
  }
  return { ok, total: list.length, dir, persistent }
}

// ---------------------------------------------------------------- 下载主流程

async function runDownload(dir, base) {
  Object.assign(job, {
    running: true,
    phase: 'preparing',
    version: base.version,
    dir: dir,
    total: base.count,
    done: 0,
    skipped: 0,
    failed: 0,
    bytes: 0,
    totalBytes: base.bytes,
    current: '',
    error: '',
    cancelled: false,
    zhCount: 0,
    zhSource: '',
    startedAt: Date.now(),
    finishedAt: 0
  })
  cancelFlag = false

  const soundsDir = path.join(dir, 'sounds')
  await ensureDir(soundsDir)

  job.phase = 'downloading'
  await runPool(base.sounds, CONCURRENCY, async (item) => {
    job.current = item.rel
    await downloadOne(item, soundsDir)
  })

  if (cancelFlag) {
    job.phase = 'cancelled'
    job.running = false
    job.finishedAt = Date.now()
    return
  }

  job.phase = 'indexing'
  job.current = 'sounds.json'
  let soundsJson = {}
  try {
    if (base.soundsJsonHash) {
      const buf = await fetchBuffer(resourceUrl(base.soundsJsonHash))
      soundsJson = JSON.parse(buf.toString('utf8'))
    }
  } catch {
    soundsJson = {}
  }

  job.current = 'manifest.json'
  const meta = await writeManifest(dir, base, soundsJson)

  // 中文索引：拉官方 lang/zh_cn.json 现场生成，版本更新自动跟上
  job.current = 'zh_cn.json'
  let zh = { count: 0, source: 'none' }
  try {
    zh = await writeZhIndex(dir, base, soundsJson)
  } catch (err) {
    job.error = '中文索引生成失败：' + (err && err.message ? err.message : String(err))
  }
  job.zhCount = zh.count
  job.zhSource = zh.source

  job.current = 'README.txt'
  await writeReadme(dir, meta, zh)

  job.phase = 'done'
  job.running = false
  job.current = ''
  job.finishedAt = Date.now()
}

// ---------------------------------------------------------------- 对外入口

function snapshot() {
  const now = job.running ? Date.now() : job.finishedAt || Date.now()
  const elapsed = job.startedAt ? Math.max(0.001, (now - job.startedAt) / 1000) : 0
  return {
    running: job.running,
    phase: job.phase,
    version: job.version,
    dir: job.dir,
    total: job.total,
    done: job.done,
    skipped: job.skipped,
    failed: job.failed,
    bytes: job.bytes,
    totalBytes: job.totalBytes,
    current: job.current,
    error: job.error,
    cancelled: job.cancelled,
    zhCount: job.zhCount,
    zhSource: job.zhSource,
    elapsed: Math.round(elapsed),
    speed: elapsed > 0 ? Math.round(job.bytes / elapsed) : 0
  }
}

async function handle(req) {
  const r = req || {}
  const fn = r.fn

  if (fn === 'scan') {
    return scan(r.root)
  }

  if (fn === 'official') {
    const plan = await officialPlan()
    let defaultDir = ''
    try {
      defaultDir = path.join(require('electron').app.getPath('documents'), 'MCSounds')
    } catch {
      defaultDir = path.join(path.parse(ADDON_DIR).root, 'MCSounds')
    }
    return {
      version: plan.version,
      count: plan.count,
      bytes: plan.bytes,
      assetIndexId: plan.assetIndexId,
      defaultDir
    }
  }

  if (fn === 'download') {
    if (job.running) throw new Error('已有下载任务在进行中')
    const plan = await officialPlan()
    const dir = String(r.dir || '').trim()
    if (!dir) throw new Error('尚未选择安装目录')
    runDownload(path.resolve(dir), plan).catch((err) => {
      job.phase = 'error'
      job.running = false
      job.error = err && err.message ? err.message : String(err)
      job.finishedAt = Date.now()
    })
    return { started: true, dir: path.resolve(dir) }
  }

  if (fn === 'warm') {
    return warm(r.items, r.dst)
  }

  if (fn === 'status') {
    return snapshot()
  }

  if (fn === 'cancel') {
    if (!job.running) return { cancelled: false }
    cancelFlag = true
    job.cancelled = true
    return { cancelled: true }
  }

  throw new Error('未知操作：' + String(fn))
}

module.exports = { handle, registerDrag: registerDragChannel }
// 供离线比对脚本使用（不影响运行时）
module.exports.__test = { buildZhIndex, zhEntryFor, pinyinFields, nounLookup, findFfmpeg }
