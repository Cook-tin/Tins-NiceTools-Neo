;(function () {
  const P = {
    play: '<path d="M8 5.4v13.2L19 12 8 5.4z" fill="currentColor" stroke="none"/>',
    pause:
      '<rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/>',
    skipBack: '<path d="M19 5v14L8 12l11-7z"/><path d="M5 5v14"/>',
    skipForward: '<path d="M5 5v14l11-7L5 5z"/><path d="M19 5v14"/>',
    volume:
      '<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>',
    volumeX:
      '<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M16 9l5 6M21 9l-5 6"/>',
    scissors:
      '<circle cx="6" cy="6" r="2.6"/><circle cx="6" cy="18" r="2.6"/><path d="M20 4L8.12 15.88"/><path d="M14.47 14.48L20 20"/><path d="M8.12 8.12L12 12"/>',
    crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
    layers:
      '<path d="M12 2l9 5-9 5-9-5 9-5z"/><path d="M3 12l9 5 9-5"/><path d="M3 17l9 5 9-5"/>',
    split:
      '<path d="M12 2v20" stroke-dasharray="2.5 2.5"/><rect x="4" y="6" width="5" height="12" rx="1"/><rect x="15" y="6" width="5" height="12" rx="1"/>',
    music:
      '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    mute: '<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M22 9l-6 6M16 9l6 6"/>',
    film:
      '<rect x="2.5" y="3" width="19" height="18" rx="2"/><path d="M7.5 3v18M16.5 3v18M2.5 9h5M2.5 15h5M16.5 9h5M16.5 15h5"/>',
    image:
      '<rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="8.6" cy="8.6" r="1.4"/><path d="M21 15.5l-5-5L5.5 21"/>',
    audioLines: '<path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>',
    folder:
      '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>',
    download: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 21h16"/>',
    check: '<path d="M4.5 12.5l5 5L20 7"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    chevronLeft: '<path d="M15 5l-7 7 7 7"/>',
    chevronRight: '<path d="M9 5l7 7-7 7"/>',
    chevronDown: '<path d="M6 9l6 6 6-6"/>',
    settings:
      '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6h.09A1.7 1.7 0 0 0 10 3.05V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.09a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    trash:
      '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>',
    arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    arrowDown: '<path d="M12 5v14M5 12l7 7 7-7"/>',
    zap: '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>',
    memory:
      '<rect x="5" y="7" width="14" height="10" rx="1"/><path d="M8 7V4M12 7V4M16 7V4M8 20v-3M12 20v-3M16 20v-3"/><path d="M9 11v2M12 11v2M15 11v2"/>',
    wave: '<path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 11v2M21 12h0"/>',
    link:
      '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    file:
      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/><path d="M14 2v6h6"/>',
    alert:
      '<path d="M12 3l10 18H2L12 3z"/><path d="M12 9v5"/><path d="M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
    external:
      '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/>',
    rotate:
      '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
    maximize:
      '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/>',
    minimize:
      '<path d="M8 3v5H3"/><path d="M16 3v5h5"/><path d="M8 21v-5H3"/><path d="M16 21v-5h5"/>',
    eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff:
      '<path d="M3 3l18 18"/><path d="M10.6 6.2A10 10 0 0 1 12 6c6.5 0 10 6 10 6a16 16 0 0 1-3.1 3.7"/><path d="M6.2 6.6C3.5 8.5 2 12 2 12s3.5 6 10 6c1.7 0 3.2-.4 4.5-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/>',
    sparkles:
      '<path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3z"/><path d="M19 14.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    arrowRight: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
    more: '<circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/>',
    aspect:
      '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 9h8v6H8z" stroke-dasharray="2 2"/>',
    loop:
      '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
    playCircle: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l6-3.5-6-3.5z" fill="currentColor" stroke="none"/>',
    wave: '<path d="M3 12h2l2-5 3 10 3-14 3 18 2-9h3"/>',
    imageCrop:
      '<path d="M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3"/><rect x="7" y="7" width="10" height="10" rx="1.5"/>'
  }

  function icon(name, size, cls) {
    const s = size || 18
    const body = P[name] || P.info
    return `<svg class="ic ${cls || ''}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
  }

  function brandMark(size) {
    const s = size || 28
    return `<span class="brand-mark" style="width:${s}px;height:${s}px;border-radius:${Math.round(
      s * 0.32
    )}px">${icon('scissors', Math.round(s * 0.56))}</span>`
  }

  window.NT = window.NT || {}
  window.NT.icon = icon
  window.NT.brandMark = brandMark
})()
