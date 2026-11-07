;(function () {
  const NT = (window.NT = window.NT || {})
  const { icon } = NT
  const { fmt } = NT

  function project() {
    return NT.state.project
  }

  function codecLabel(info) {
    if (!info || !info.video) return '—'
    const map = { h264: 'H.264', hevc: 'HEVC', av1: 'AV1', vp9: 'VP9', prores: 'ProRes' }
    return map[info.video.codec] || info.video.codec.toUpperCase()
  }

  function keyframeNotice() {
    const s = NT.state
    const project = NT.state.project
    if (!project || !project.keyframes.length) {
      return '<b>无损导出</b>会尽量贴近关键帧，导出前将自动对齐。'
    }
    const keys = project.keyframes
    let prev = 0
    for (const k of keys) if (k <= s.inPoint + 0.0005) prev = k
    const diff = s.inPoint - prev
    if (diff > 0.02) {
      return `起点不是关键帧，<b>无损导出</b>会从 ${fmt.formatClock(prev, 2)} 开始（提前 ${diff.toFixed(
        2
      )}s）。需要精确起点请改用 H.264 精确导出。`
    }
    return `起点已落在关键帧 <b>${fmt.formatClock(s.inPoint, 2)}</b>，可无损秒出。`
  }

  function renderTrim(container) {
    const s = NT.state
    const info = project().info
    const sel = Math.max(0, s.outPoint - s.inPoint)
    container.innerHTML = `<div class="panel">
      <div class="selection-summary">
        <div>
          <div class="big">${fmt.formatClock(sel, 2)}</div>
          <div class="small">选区时长</div>
        </div>
        <div style="text-align:right">
          <div class="small">起点 → 终点</div>
          <div class="mono" style="font-size:10.5px;margin-top:2px">${fmt.formatClock(
            s.inPoint,
            2
          )} → ${fmt.formatClock(s.outPoint, 2)}</div>
        </div>
      </div>
      <div class="time-pair">
        <div class="time-box">
          <label>入点</label>
          <input id="trim-in" value="${fmt.formatClock(s.inPoint, 3)}" spellcheck="false" />
        </div>
        <div class="time-box">
          <label>出点</label>
          <input id="trim-out" value="${fmt.formatClock(s.outPoint, 3)}" spellcheck="false" />
        </div>
      </div>
      <div class="mini-actions" style="margin-top:8px">
        <button class="chip-btn" data-act="set-in" type="button">${icon('chevronLeft', 11)} 播放头设入点</button>
        <button class="chip-btn" data-act="set-out" type="button">播放头设出点 ${icon('chevronRight', 11)}</button>
      </div>
      <div class="row" style="margin-top:6px">
        <span class="row-label">自动吸附</span>
        <button class="switch${s.autoSnap ? ' on' : ''}" data-act="toggle-snap" aria-label="自动吸附"></button>
      </div>
      <p class="panel-note">拖动时间轴两侧手柄或播放头时，自动吸附到视频边界、另一侧手柄和播放头。</p>
      <div class="row">
        <span class="row-label">原始编码</span>
        <span class="row-value">${codecLabel(info)} · ${info.video ? `${info.video.displayWidth}×${info.video.displayHeight}` : ''}</span>
      </div>
      <div class="row">
        <span class="row-label">文件大小</span>
        <span class="row-value">${fmt.formatBytes(info.size)}</span>
      </div>
    </div>`
  }

  function renderMulti(container) {
    const s = NT.state
    const clips = s.multiClips || []
    const total = clips.reduce((sum, c) => sum + (c.info.duration || 0), 0)
    const compatible =
      clips.length > 1 &&
      clips.every((c) => {
        const a = clips[0].info
        const b = c.info
        return (
          a.video &&
          b.video &&
          a.video.codec === b.video.codec &&
          a.video.width === b.video.width &&
          a.video.height === b.video.height &&
          a.video.pixFmt === b.video.pixFmt &&
          Math.abs(a.video.fps - b.video.fps) < 0.02 &&
          Boolean(a.audio) === Boolean(b.audio)
        )
      })

    const rows = clips
      .map(
        (clip, i) => `<div class="clip-item${s.activeClip === i ? ' active' : ''}" data-act="select-clip" data-index="${i}" role="button" tabindex="0">
        <span class="clip-index">${i + 1}</span>
        <span class="clip-main">
          <span class="clip-name">${fmt.escapeHtml(clip.name)}</span>
          <span class="clip-meta">${fmt.formatShort(clip.duration)} · ${
            clip.info.video ? `${clip.info.video.displayWidth}×${clip.info.video.displayHeight}` : clip.info.audio ? '音频' : ''
          }</span>
        </span>
        <span class="clip-actions">
          <button class="clip-btn" data-act="remove-clip" data-index="${i}" title="移除">${icon('x', 12)}</button>
        </span>
      </div>`
      )
      .join('')

    container.innerHTML = `<div class="panel">
      <div class="panel-title">
        <h3>片段序列</h3>
        <span>${clips.length} 段 · ${fmt.formatShort(total)}</span>
      </div>
      ${clips.length ? `<div class="clip-list">${rows}</div>` : `<p class="panel-note">还没有片段。添加视频后会按顺序拼接。</p>`}
      <button class="add-clip" data-act="add-clips" type="button">${icon('plus', 13)} 添加视频</button>
      ${
        clips.length > 1
          ? `<div class="compat-chip">${icon(compatible ? 'check' : 'refresh', 10)} ${
              compatible ? '参数一致，可无损拼接' : '参数不一致，将自动重新编码'
            }</div>`
          : ''
      }
      <p class="panel-note">拼接会按列表顺序进行。编码、分辨率、帧率一致时可无损秒拼；否则将统一为最高分辨率重新编码。</p>
    </div>`
  }

  function renderSplit(container) {
    const s = NT.state
    const points = s.splitPoints || []
    const rows = points
      .map(
        (t, i) => `<div class="split-item">
        <span class="time">${fmt.formatClock(t, 2)}</span>
        <span class="spacer"></span>
        <button class="clip-btn" data-act="remove-split" data-index="${i}" title="移除">${icon('x', 11)}</button>
      </div>`
      )
      .join('')
    container.innerHTML = `<div class="panel">
      <div class="panel-title"><h3>分割点</h3><span>${points.length} 个</span></div>
      ${points.length ? `<div class="split-list">${rows}</div>` : `<p class="panel-note">还没有分割点。把播放头移到需要切开的位置，然后添加。</p>`}
      <button class="add-clip" data-act="add-split" type="button">${icon('plus', 13)} 在播放头添加分割点</button>
      ${points.length ? `<button class="chip-btn" data-act="clear-splits" style="margin-top:8px" type="button">清空分割点</button>` : ''}
      <div class="row" style="margin-top:8px"><span class="row-label">输出段数</span><span class="row-value">${points.length + 1} 段</span></div>
      <p class="panel-note">无损分割会对齐到关键帧，导出为 ${points.length + 1} 个独立文件。</p>
    </div>`
  }

  function renderCrop(container) {
    const s = NT.state
    const crop = s.crop || { width: 0, height: 0 }
    const aspects = [
      { k: 'free', label: '自由' },
      { k: '1:1', label: '1:1' },
      { k: '16:9', label: '16:9' },
      { k: '9:16', label: '9:16' },
      { k: '4:3', label: '4:3' },
      { k: '3:4', label: '3:4' }
    ]
    container.innerHTML = `<div class="panel">
      <div class="row-stack">
        <div class="row-stack-head"><span>裁剪比例</span><span id="crop-size-label">${Math.round(
          crop.width
        )} × ${Math.round(crop.height)}</span></div>
        <div class="pill-row">
          ${aspects
            .map(
              (a) =>
                `<button class="pill${
                  (s.cropAspect || 'free') === a.k ? ' active' : ''
                }" data-act="crop-aspect" data-value="${a.k}" type="button">${a.label}</button>`
            )
            .join('')}
        </div>
      </div>
      <div class="row">
        <span class="row-label">裁剪尺寸</span>
        <div class="crop-dims">
          <input class="crop-input" id="crop-w" value="${Math.round(crop.width)}" readonly />
          <span class="dim">×</span>
          <input class="crop-input" id="crop-h" value="${Math.round(crop.height)}" readonly />
        </div>
      </div>
      <div class="row">
        <span class="row-label">原画面</span>
        <span class="row-value">${project().info.video ? `${project().info.video.displayWidth} × ${project().info.video.displayHeight}` : '—'}</span>
      </div>
      <button class="btn btn-secondary btn-sm" data-act="crop-reset" style="width:100%;margin-top:8px" type="button">
        ${icon('rotate', 13)} 重置为完整画面
      </button>
      <p class="panel-note warn">画面修改后，视频会自动使用 H.264 重编码；时间轴上的裁剪区间会同时生效。GIF 导出同样会应用画面裁剪。</p>
    </div>`
  }

  function renderAudio(container) {
    const s = NT.state
    const info = project().info
    const audio = info.audio
    if (!audio) {
      container.innerHTML = `<div class="panel">
        <div class="panel-title"><h3>音频</h3><span>无音轨</span></div>
        <p class="panel-note warn">这个文件没有音频轨道，无法提取或裁剪音频。你仍然可以在裁剪模式里直接剪视频。</p>
      </div>`
      return
    }
    const actions = [
      { key: 'extract', title: '提取完整音频', desc: '导出整段音轨，不改变时长' },
      { key: 'trim', title: '裁剪音频', desc: '只保留时间轴选中的片段' },
      { key: 'remove', title: '移除音频', desc: '导出不带声音的视频' }
    ]
    container.innerHTML = `<div class="panel">
      <div class="panel-title"><h3>音频操作</h3><span>${audio.codec.toUpperCase()}</span></div>
      ${actions
        .map(
          (a) => `<button class="option-card${
            s.audioAction === a.key ? ' active' : ''
          }" data-act="audio-action" data-value="${a.key}" type="button">
          <span class="option-radio"></span>
          <span class="option-copy"><h4>${a.title}</h4><p>${a.desc}</p></span>
        </button>`
        )
        .join('')}
      <div class="row">
        <span class="row-label">音频轨道</span>
        <span class="row-value">${audio.channels} 声道 · ${(audio.sampleRate / 1000).toFixed(1)} kHz</span>
      </div>
      ${
        s.audioAction !== 'remove'
          ? `<div class="row">
              <span class="row-label">输出格式</span>
              <div class="seg" style="width:120px">
                <button class="${s.audioFormat === 'm4a' ? 'active' : ''}" data-act="audio-format" data-value="m4a" type="button">M4A</button>
                <button class="${s.audioFormat === 'mp3' ? 'active' : ''}" data-act="audio-format" data-value="mp3" type="button">MP3</button>
              </div>
            </div>`
          : ''
      }
      <p class="panel-note">${
        s.audioAction === 'remove'
          ? '视频画面保持不变，导出时移除声音轨道。'
          : s.audioAction === 'trim'
            ? '使用时间轴上的选区裁剪音频，起点受关键帧吸附影响。'
            : '提取完整音轨；AAC 音轨可直接复制，无需重新编码。'
      }</p>
    </div>`
  }

  function renderGif(container) {
    const s = NT.state
    const g = s.gif
    container.innerHTML = `<div class="panel">
      <div class="row-stack">
        <div class="row-stack-head"><span>帧率</span><span>${g.fps} fps</span></div>
        <div class="seg">
          ${[10, 15, 20, 24]
            .map(
              (v) =>
                `<button class="${g.fps === v ? 'active' : ''}" data-act="gif-fps" data-value="${v}" type="button">${v}</button>`
            )
            .join('')}
        </div>
      </div>
      <div class="row-stack">
        <div class="row-stack-head"><span>宽度</span><span>${g.width}px</span></div>
        <div class="seg">
          ${[320, 480, 640]
            .map(
              (v) =>
                `<button class="${g.width === v ? 'active' : ''}" data-act="gif-width" data-value="${v}" type="button">${v}</button>`
            )
            .join('')}
        </div>
      </div>
      <div class="row">
        <span class="row-label">颜色质量</span>
        <div class="seg" style="width:140px">
          ${[64, 128, 256]
            .map(
              (v) =>
                `<button class="${g.colors === v ? 'active' : ''}" data-act="gif-colors" data-value="${v}" type="button">${v}</button>`
            )
            .join('')}
        </div>
      </div>
      <div class="row">
        <span class="row-label">循环播放</span>
        <button class="switch${g.loop ? ' on' : ''}" data-act="gif-loop" aria-label="循环播放"></button>
      </div>
      <p class="panel-note">GIF 使用调色板量化，文件通常比视频大。建议宽度 480px、15fps，并缩短选区。</p>
    </div>`
  }

  function renderModePanel(container) {
    if (!container) return
    const mode = NT.state.mode
    if (mode === 'trim') renderTrim(container)
    else if (mode === 'multi') renderMulti(container)
    else if (mode === 'split') renderSplit(container)
    else if (mode === 'crop') renderCrop(container)
    else if (mode === 'audio') renderAudio(container)
    else if (mode === 'gif') renderGif(container)
  }

  NT.renderModePanel = renderModePanel
  NT.codecLabel = codecLabel
})()
