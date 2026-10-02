import NoSleep from 'nosleep.js'
import { connect } from './net.js'
import { loadManifest, loadBitmap, frameRect, FPS } from './library.js'
import { homeUrl } from './rooms.js'

const HOLD_MS = 5000 // corner buttons must be held this long
const SEND_MS = 33 // cursor updates to the screen, at most ~30/s
const DRAW_DELAY_MS = 90 // grace period for a second finger before one-finger drawing starts
const GAIN = 1.1 // a slow swipe across the whole phone moves ~1.1 board widths
const ACCEL = 0.9 // extra gain per px/ms of finger speed, like a laptop trackpad
const MAX_ACCEL = 3
const TRAIL = 256 // recent points shown on the phone's minimap

const $ = (id) => document.getElementById(id)
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const store = {
  get: (k) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v)
    } catch {}
  },
}

export async function startPaint(code) {
  $('paint').hidden = false
  document.title = `gifshooter · ${code}`
  store.set('gifshooter:last', code)

  const manifest = await loadManifest()
  const sprites = manifest.sprites
  let spriteId = store.get('gifshooter:sprite')
  if (!manifest.byId.has(spriteId)) spriteId = sprites[Math.floor(Math.random() * sprites.length)].id

  // ---- network -------------------------------------------------------------
  const { room, hello, cursor } = connect(code)
  const screens = new Set()
  let aspect = 16 / 9 // of the presenting screen; updated from its hello

  const status = $('paint-status')
  const updateStatus = () => {
    status.textContent = screens.size
      ? `${code} · 1 finger draws · 2 fingers move`
      : `${code} · looking for the screen…`
  }
  updateStatus()

  hello.onMessage = (data, { peerId }) => {
    if (data?.role !== 'screen') return
    screens.add(peerId)
    if (Number.isFinite(data.aspect) && data.aspect > 0.2 && data.aspect < 5) aspect = data.aspect
    updateStatus()
    dirty = true
  }
  room.onPeerLeave = (peerId) => {
    if (screens.delete(peerId)) updateStatus()
  }

  // ---- cursor state ----------------------------------------------------------
  const pos = { x: 0.5, y: 0.5 }
  let drawing = false
  let dirty = true // something to send / redraw
  let forceSend = false
  let lastSend = 0
  const trail = new Float32Array(TRAIL * 3) // x, y, drawing
  let trailHead = 0

  function setDrawing(on) {
    if (drawing === on) return
    drawing = on
    dirty = true
    forceSend = true
  }

  function moveBy(dxPx, dyPx, dtMs) {
    const w = pad.clientWidth || 1
    const speed = Math.hypot(dxPx, dyPx) / Math.max(dtMs, 1)
    const gain = GAIN * Math.min(MAX_ACCEL, 1 + ACCEL * speed)
    pos.x = clamp01(pos.x + (dxPx / w) * gain)
    pos.y = clamp01(pos.y + (dyPx / w) * gain * aspect)
    trail[trailHead * 3] = pos.x
    trail[trailHead * 3 + 1] = pos.y
    trail[trailHead * 3 + 2] = drawing ? 1 : 0
    trailHead = (trailHead + 1) % TRAIL
    dirty = true
  }

  function send(now) {
    lastSend = now
    forceSend = false
    if (!screens.size) return
    const msg = { x: Math.round(pos.x * 1e4) / 1e4, y: Math.round(pos.y * 1e4) / 1e4, d: drawing, s: spriteId }
    cursor.send(msg, { target: [...screens] }).catch(() => {})
  }

  // ---- trackpad ----------------------------------------------------------------
  // One finger: move + draw. Two fingers: move only. Once a gesture has used two fingers
  // it stays move-only until every finger is lifted, so lifting fingers one at a time
  // never leaves a stray stroke.
  const pad = $('pad')
  const touches = new Map()
  let mode = 'idle' // idle | pending | draw | move
  let pendingSince = 0
  let last = null
  let lastMoveAt = 0
  let hoverLast = null

  const centroid = () => {
    let x = 0
    let y = 0
    for (const t of touches.values()) {
      x += t.x
      y += t.y
    }
    return { x: x / touches.size, y: y / touches.size }
  }

  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    wakeUp()
    pad.setPointerCapture?.(e.pointerId)
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (touches.size === 1 && mode === 'idle') {
      mode = 'pending'
      pendingSince = performance.now()
    } else if (touches.size >= 2) {
      mode = 'move'
      setDrawing(false)
    }
    last = centroid()
    lastMoveAt = performance.now()
  })

  pad.addEventListener('pointermove', (e) => {
    const now = performance.now()
    const t = touches.get(e.pointerId)
    if (!t) {
      // Desktop testing: a hovering mouse moves the cursor without drawing.
      if (e.pointerType === 'mouse') {
        if (hoverLast) moveBy(e.clientX - hoverLast.x, e.clientY - hoverLast.y, now - lastMoveAt)
        hoverLast = { x: e.clientX, y: e.clientY }
        lastMoveAt = now
      }
      return
    }
    t.x = e.clientX
    t.y = e.clientY
    const c = centroid()
    if (mode === 'pending' && now - pendingSince >= DRAW_DELAY_MS) {
      mode = 'draw'
      setDrawing(true)
    }
    moveBy(c.x - last.x, c.y - last.y, now - lastMoveAt)
    last = c
    lastMoveAt = now
    hoverLast = { x: e.clientX, y: e.clientY }
  })

  const release = (e) => {
    if (!touches.delete(e.pointerId)) return
    if (touches.size === 0) {
      mode = 'idle'
      setDrawing(false)
      last = null
    } else {
      last = centroid() // re-anchor so the cursor doesn't jump
    }
  }
  pad.addEventListener('pointerup', release)
  pad.addEventListener('pointercancel', release)
  pad.addEventListener('lostpointercapture', release)
  pad.addEventListener('contextmenu', (e) => e.preventDefault())

  // ---- staying awake & fullscreen -----------------------------------------------
  const noSleep = new NoSleep()
  let wakeLock = null
  let awake = false
  function wakeUp() {
    const el = document.documentElement
    if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {})
    if (awake) return
    awake = true
    if ('wakeLock' in navigator) requestWakeLock()
    else noSleep.enable() // must run inside the user gesture
  }
  function requestWakeLock() {
    navigator.wakeLock.request('screen').then(
      (lock) => (wakeLock = lock),
      () => noSleep.enable(),
    )
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && awake && wakeLock?.released) requestWakeLock()
    if (document.visibilityState === 'hidden') {
      touches.clear()
      mode = 'idle'
      setDrawing(false)
    }
  })

  // ---- hold-to-activate corner buttons ------------------------------------------
  holdButton($('hold-exit'), () => {
    room.leave()
    location.assign(homeUrl())
  })
  holdButton($('hold-gif'), () => openPicker())

  // ---- gif preview (current gif, animated in the corner button) -----------------
  const preview = $('gif-preview')
  const pctx = preview.getContext('2d')
  let previewBitmap = null
  let previewFor = null
  let previewFrame = -1

  async function loadPreview(id) {
    previewFor = id
    previewFrame = -1
    const sprite = manifest.byId.get(id)
    const bitmap = await loadBitmap(sprite.file).catch(() => null)
    if (previewFor !== id) {
      bitmap?.close()
      return
    }
    previewBitmap?.close() // only one full spritesheet in memory on the phone
    previewBitmap = bitmap
  }
  loadPreview(spriteId)

  function drawPreview(now) {
    const sprite = manifest.byId.get(spriteId)
    if (!previewBitmap || !sprite || previewFor !== spriteId) return
    const f = Math.floor((now / 1000) * FPS) % sprite.frames
    if (f === previewFrame) return
    previewFrame = f
    const size = preview.width
    const scale = size / Math.max(sprite.w, sprite.h)
    const w = sprite.w * scale
    const h = sprite.h * scale
    pctx.clearRect(0, 0, size, size)
    pctx.drawImage(previewBitmap, ...frameRect(sprite, f), (size - w) / 2, (size - h) / 2, w, h)
  }

  // ---- gif picker -----------------------------------------------------------------
  const picker = $('picker')
  const grid = $('picker-grid')
  const thumbsUrl = new URL(`./sprites/${manifest.thumbs.file}`, location.href).href
  const thumbCols = manifest.thumbs.cols
  const thumbRows = Math.ceil(sprites.length / thumbCols)
  const cells = sprites.map((sprite, i) => {
    const cell = document.createElement('button')
    cell.className = 'thumb'
    cell.setAttribute('aria-label', `gif ${i + 1}`)
    const col = i % thumbCols
    const row = Math.floor(i / thumbCols)
    cell.style.backgroundImage = `url("${thumbsUrl}")`
    cell.style.backgroundSize = `${thumbCols * 100}% ${thumbRows * 100}%`
    cell.style.backgroundPosition = `${thumbCols > 1 ? (col / (thumbCols - 1)) * 100 : 0}% ${thumbRows > 1 ? (row / (thumbRows - 1)) * 100 : 0}%`
    cell.onclick = () => {
      if (justOpened()) return
      selectSprite(sprite.id)
      closePicker()
    }
    grid.append(cell)
    return cell
  })

  function selectSprite(id) {
    spriteId = id
    store.set('gifshooter:sprite', id)
    loadPreview(id)
    dirty = true
    forceSend = true
  }
  // The finger that held the button lifts while the picker is already open; ignore the
  // click that release would otherwise land on whatever is now under it.
  let pickerOpenedAt = 0
  const justOpened = () => performance.now() - pickerOpenedAt < 600
  function openPicker() {
    pickerOpenedAt = performance.now()
    touches.clear()
    mode = 'idle'
    setDrawing(false)
    cells.forEach((c, i) => c.classList.toggle('selected', sprites[i].id === spriteId))
    picker.hidden = false
    cells[sprites.findIndex((s) => s.id === spriteId)]?.scrollIntoView({ block: 'center' })
  }
  function closePicker() {
    picker.hidden = true
  }
  $('picker-close').onclick = () => justOpened() || closePicker()

  // ---- minimap on the phone ----------------------------------------------------------
  const ctx = pad.getContext('2d')
  function resizePad() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    pad.width = Math.round(pad.clientWidth * dpr)
    pad.height = Math.round(pad.clientHeight * dpr)
    dirty = true
  }
  window.addEventListener('resize', resizePad)
  resizePad()

  function drawPad() {
    const W = pad.width
    const H = pad.height
    ctx.clearRect(0, 0, W, H)
    const margin = Math.min(W, H) * 0.12
    let bw = W - margin * 2
    let bh = bw / aspect
    if (bh > H - margin * 4) {
      bh = H - margin * 4
      bw = bh * aspect
    }
    const bx = (W - bw) / 2
    const by = (H - bh) / 2
    ctx.strokeStyle = 'rgba(127,255,212,0.25)'
    ctx.lineWidth = 2
    ctx.strokeRect(bx, by, bw, bh)

    for (let i = 0; i < TRAIL; i++) {
      const j = ((trailHead + i) % TRAIL) * 3
      if (!trail[j + 2]) continue
      ctx.fillStyle = `rgba(127,255,212,${(0.08 + (0.4 * i) / TRAIL).toFixed(3)})`
      ctx.fillRect(bx + trail[j] * bw - 2, by + trail[j + 1] * bh - 2, 4, 4)
    }

    const cx = bx + pos.x * bw
    const cy = by + pos.y * bh
    const r = Math.max(6, Math.min(W, H) * 0.02)
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.lineWidth = 3
    ctx.strokeStyle = 'aquamarine'
    ctx.stroke()
    if (drawing) {
      ctx.fillStyle = 'aquamarine'
      ctx.fill()
    }
  }

  // ---- main loop ---------------------------------------------------------------------
  function loop(now) {
    requestAnimationFrame(loop)
    if (mode === 'pending' && touches.size === 1 && now - pendingSince >= DRAW_DELAY_MS) {
      mode = 'draw'
      setDrawing(true)
    }
    if ((dirty && now - lastSend >= SEND_MS) || forceSend) {
      send(now)
      drawPad()
      dirty = false
    }
    drawPreview(now)
  }
  requestAnimationFrame(loop)

  window.addEventListener('pagehide', () => {
    room.leave()
    previewBitmap?.close()
    wakeLock?.release().catch(() => {})
    noSleep.disable()
  })
}

// A button that only fires after being held for HOLD_MS, with a progress ring,
// so a palm or stray finger while drawing hands-free can't trigger it.
function holdButton(el, onFire) {
  let start = 0
  let raf = 0
  let pointer = null

  const reset = () => {
    cancelAnimationFrame(raf)
    pointer = null
    el.classList.remove('holding')
    el.style.setProperty('--p', 0)
  }
  const tick = (now) => {
    const p = (now - start) / HOLD_MS
    el.style.setProperty('--p', Math.min(1, p).toFixed(3))
    if (p >= 1) {
      reset()
      navigator.vibrate?.(60)
      onFire()
    } else {
      raf = requestAnimationFrame(tick)
    }
  }
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (pointer !== null) return
    pointer = e.pointerId
    el.setPointerCapture?.(e.pointerId)
    el.classList.add('holding')
    start = performance.now()
    navigator.vibrate?.(15)
    raf = requestAnimationFrame(tick)
  })
  const end = (e) => {
    if (e.pointerId === pointer) reset()
  }
  el.addEventListener('pointerup', end)
  el.addEventListener('pointercancel', end)
  el.addEventListener('lostpointercapture', end)
  el.addEventListener('contextmenu', (e) => e.preventDefault())
  el.addEventListener('click', (e) => e.preventDefault())
}
