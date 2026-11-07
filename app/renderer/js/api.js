;(function () {
  const NT = (window.NT = window.NT || {})

  async function call(channel, ...args) {
    if (!window.nice || typeof window.nice.invoke !== 'function') {
      throw new Error('NiceTools 桌面环境未就绪')
    }
    const res = await window.nice.invoke(channel, ...args)
    if (!res || res.ok !== true) {
      throw new Error((res && res.error) || '操作失败')
    }
    return res.data
  }

  function on(channel, callback) {
    if (!window.nice || typeof window.nice.on !== 'function') return () => {}
    return window.nice.on(channel, callback)
  }

  function pathForFile(file) {
    if (!window.nice || typeof window.nice.getPathForFile !== 'function') return ''
    return window.nice.getPathForFile(file)
  }

  NT.api = { call, on, pathForFile }
})()
