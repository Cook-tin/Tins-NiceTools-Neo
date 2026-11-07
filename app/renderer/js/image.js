;(function () {
  const NT = (window.NT = window.NT || {})
  const { icon } = NT
  const { fmt } = NT

  const image = {
    ro: null,
    mounted: false
  }

  function mount(data) {
    const view = document.getElementById('view')
    if (!view || !data) return
    destroy()
    image.mounted = true
    view.className = 'view image-view'
    const ext = (data.name.split('.').pop() || '').toUpperCase()
    view.innerHTML = `<div class="image-page">
      <section class="image-stage">
        <img id="image-preview" src="${data.url}" alt="${fmt.escapeHtml(data.name)}" />
      </section>
      <aside class="image-panel">
        <div class="image-panel-head">
          <span class="image-kicker">IMAGE CROP</span>
          <h2>图像裁剪</h2>
          <p>大图预览 · 本地打开</p>
        </div>
        <div class="image-meta">
          <div class="image-meta-row"><span>尺寸</span><b id="image-dim">${
            data.width && data.height ? `${data.width} × ${data.height}` : '读取中'
          }</b></div>
          <div class="image-meta-row"><span>大小</span><b>${fmt.formatBytes(data.size)}</b></div>
          <div class="image-meta-row"><span>格式</span><b>${fmt.escapeHtml(ext || '—')}</b></div>
        </div>
        <div class="image-coming">
          <span class="image-coming-icon">${icon('imageCrop', 20)}</span>
          <h3>裁剪与导出正在路上</h3>
          <p>v1.1 先把图片工作页和大图预览做好；裁剪框、比例和导出会在下个版本加入。</p>
        </div>
        <div class="image-panel-actions">
          <button class="btn btn-secondary" data-action="change-image" type="button">${icon(
            'imageCrop',
            14
          )} 换一张</button>
          <button class="btn btn-ghost" data-nav="back" type="button">${icon(
            'chevronLeft',
            14
          )} 返回工具页</button>
        </div>
      </aside>
    </div>`

    const img = document.getElementById('image-preview')
    if (img) {
      img.addEventListener('load', () => {
        const dim = document.getElementById('image-dim')
        if (dim && img.naturalWidth && img.naturalHeight) {
          dim.textContent = `${img.naturalWidth} × ${img.naturalHeight}`
        }
      })
      img.addEventListener('error', () => {
        img.classList.add('failed')
      })
    }
  }

  function destroy() {
    image.mounted = false
  }

  NT.Image = { mount, destroy, get mounted() { return image.mounted } }
})()
