;(function () {
  const NT = (window.NT = window.NT || {})
  const { icon } = NT

  function render(view) {
    const target = view || document.getElementById('view')
    if (!target) return
    target.className = 'view hub-view'
    target.innerHTML = `<div class="hub-page">
      <header class="hub-head">
        <div>
          <span class="hub-kicker">TOOLBOX · 02</span>
          <h1>解析转换</h1>
          <p>把视频和音频转成常用的容器与编码，全部在本机完成。</p>
        </div>
        <span class="hub-local">${icon('shield', 12)} 本地处理优先</span>
      </header>
      <div class="hub-body" id="hub-body">
        <div id="hub-convert"></div>
      </div>
    </div>`

    if (NT.Convert) {
      NT.Convert.renderInto(document.getElementById('hub-convert'))
    }
  }

  NT.Hub = { render }
})()
