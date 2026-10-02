import QRCode from 'qrcode'
import { connect } from './net.js'
import { loadManifest, loadBitmap, frameRect, FPS, MAX_RING_FRAMES } from './library.js'
import { painterUrl, homeUrl } from './rooms.js'

const TICK_MS = 1000 / FPS
const MARKER_MS = 10_000 // painter cursors fade out over this long
const STAMP_SIZE = 0.16 // stamp size, as a share of the board's shorter side
const STAMP_SPACING = 0.1 // distance between stamps along a stroke, as a share of stamp size
const MAX_STAMPS_PER_MOVE = 48 // interpolation cap for one cursor update
const MAX_ACTIVE_STAMPS = 4000 // hard cap on stamps still being written into the ring
const MAX_WAITING_STAMPS = 400 // stamps parked while their spritesheet downloads
const ATLAS_BUDGET = 160 * 1024 * 1024 // decoded spritesheets kept around (LRU beyond this)
const BLACK_TARGET = 0.2 // stop fading once this share of the board is black
const BLACK_LEVEL = 28 // a pixel counts as black when its brightest channel is below this
const FADE_HALF_LIFE_IDLE = 120 // seconds, when nobody is drawing
const FADE_HALF_LIFE_BUSY = 8 // seconds, at BUSY_RATE stamps/s or more
const BUSY_RATE = 25
const SAMPLE_W = 96
const SAMPLE_H = 54

const $ = (id) => document.getElementById(id)
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

// Phones and tablets have little GPU memory: Android Chrome silently evicts the contents
// of GPU-backed canvases under pressure, and with ~120 of them the loop flickers as it
// passes frames that were dropped. There the ring uses CPU-backed canvases and a
// smaller budget. Override with &soft=1 / &soft=0 and &budget=<MB>.
const params = new URLSearchParams(location.search)
const MOBILE = matchMedia('(pointer: coarse)').matches || navigator.userAgentData?.mobile === true
const SOFTWARE = params.has('soft') ? params.get('soft') !== '0' : MOBILE

function makeSurface(width, height) {
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height })
  // willReadFrequently asks the browser for a CPU-backed canvas, which can't be evicted
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: SOFTWARE })
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, width, height)
  ctx.imageSmoothingQuality = 'medium'
  return { canvas, ctx }
}

// The board is a loop of `length` frames. Every stamp is written once into each slot
// (frame k of its gif into the k-th slot after it landed), so the whole board animates.
// Slots are allocated once and reused; resolution is chosen to fit a memory budget.
class FrameRing {
  constructor(length, width, height) {
    this.length = length
    this.width = width
    this.height = height
    this.slots = Array.from({ length }, () => makeSurface(width, height))
    // Safety net: if the browser still drops a frame's contents, refill it from the
    // previous frame instead of leaving a black flash in the loop.
    this.slots.forEach(({ canvas, ctx }, i) => {
      canvas.addEventListener?.('contextrestored', () => {
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, this.width, this.height)
        const prev = this.slots[(i + length - 1) % length]
        if (prev) ctx.drawImage(prev.canvas, 0, 0)
      })
    })
  }

  slot(t) {
    return this.slots[((t % this.length) + this.length) % this.length]
  }

  copyFrom(other) {
    for (let i = 0; i < this.length; i++) {
      this.slots[i].ctx.drawImage(other.slots[i % other.length].canvas, 0, 0, this.width, this.height)
    }
  }

  dispose() {
    // Zero-size the backing stores so browsers (Safari especially) release them right away.
    for (const { canvas } of this.slots) canvas.width = canvas.height = 0
    this.slots.length = 0
  }
}

function ringResolution(frames, cssW, cssH) {
  const lowMem = navigator.deviceMemory && navigator.deviceMemory <= 4
  const budgetMB = Number(params.get('budget')) || (MOBILE ? 48 : lowMem ? 128 : 256)
  const scale = Math.min(1, Math.sqrt((budgetMB * 1024 * 1024) / (frames * 4 * cssW * cssH)))
  return [Math.max(64, Math.round(cssW * scale)), Math.max(36, Math.round(cssH * scale))]
}

const hueOf = (id) => {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return ((h % 360) + 360) % 360
}

export async function startPresent(code) {
  $('present').hidden = false
  document.title = `gifshooter · ${code}`

  const url = painterUrl(code)
  $('present-code').textContent = code
  // The bar shows the plain site address next to the code; the QR goes straight in.
  $('present-url').textContent = homeUrl().replace(/^https?:\/\//, '').replace(/\/$/, '')
  QRCode.toCanvas($('qr'), url, { margin: 2, width: 240, color: { dark: '#000', light: '#fff' } }).catch(console.error)

  const manifest = await loadManifest()
  const ringLength = Math.min(MAX_RING_FRAMES, Math.max(...manifest.sprites.map((s) => s.frames)))

  // ---- board + ring ----------------------------------------------------------
  const board = $('board')
  const bctx = board.getContext('2d', { alpha: false })
  let ring = null

  function layout() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    board.width = Math.round(board.clientWidth * dpr)
    board.height = Math.round(board.clientHeight * dpr)
    const [w, h] = ringResolution(ringLength, board.clientWidth, board.clientHeight)
    if (ring && ring.width === w && ring.height === h) return
    const next = new FrameRing(ringLength, w, h)
    if (ring) {
      next.copyFrom(ring)
      ring.dispose()
    }
    ring = next
  }
  layout()

  // ---- spritesheets (loaded on first use, least recently used evicted) -----
  // `refs` counts live stamps still being written into the ring; those sheets stay.
  const atlases = new Map()
  let atlasBytes = 0
  function atlas(id) {
    let a = atlases.get(id)
    if (!a) {
      const sprite = manifest.byId.get(id)
      if (!sprite) return null
      a = { sprite, bitmap: null, refs: 0, used: 0, bytes: 0 }
      atlases.set(id, a)
      loadBitmap(sprite.file)
        .then((bitmap) => {
          if (atlases.get(id) !== a) return bitmap.close()
          a.bitmap = bitmap
          a.bytes = bitmap.width * bitmap.height * 4
          atlasBytes += a.bytes
          flushWaiting()
          evictAtlases()
        })
        .catch((err) => {
          console.error(err)
          atlases.delete(id)
        })
    }
    a.used = performance.now()
    return a
  }
  function evictAtlases() {
    while (atlasBytes > ATLAS_BUDGET) {
      let victim = null
      for (const a of atlases.values()) {
        if (!a.bitmap || a.refs > 0) continue
        let held = false
        for (const p of painters.values()) if (p.a === a) held = true
        if (!held && (!victim || a.used < victim.used)) victim = a
      }
      if (!victim) return
      victim.bitmap.close()
      atlasBytes -= victim.bytes
      atlases.delete(victim.sprite.id)
    }
  }

  // ---- stamps: FIFO ordered by start tick ----------------------------------
  const startTime = performance.now()
  const clockTick = () => Math.floor((performance.now() - startTime) / TICK_MS)
  let tick = clockTick() - 1
  const stamps = []
  let head = 0
  let waiting = []
  let stampsThisWindow = 0

  // `ph` is the stamp's index within its stroke. Each stamp runs one gif frame behind
  // the one before it, so the animation ripples along the stroke from tail to head.
  function addStamp(a, x, y, ph) {
    if (!a.bitmap) {
      if (waiting.length < MAX_WAITING_STAMPS) waiting.push({ a, x, y, ph })
      return
    }
    // Land in the slot on screen right now and draw it immediately, so strokes grow at
    // display rate instead of in 15 fps steps. The remaining slots follow in prepareSlot.
    const s = { t0: tick, a, x, y, ph }
    stamps.push(s)
    a.refs++
    drawStamp(ring.slot(tick).ctx, s, tick, STAMP_SIZE * Math.min(ring.width, ring.height))
    stampsThisWindow++
    while (stamps.length - head > MAX_ACTIVE_STAMPS) stamps[head++].a.refs--
  }

  function flushWaiting() {
    const pending = waiting
    waiting = []
    for (const s of pending) addStamp(s.a, s.x, s.y, s.ph)
  }

  function drawStamp(ctx, s, t, size) {
    const sp = s.a.sprite
    const scale = size / Math.max(sp.w, sp.h)
    const w = sp.w * scale
    const h = sp.h * scale
    const f = (((t - s.t0 - s.ph) % sp.frames) + sp.frames) % sp.frames
    const [sx, sy, sw, sh] = frameRect(sp, f)
    ctx.drawImage(s.a.bitmap, sx, sy, sw, sh, s.x * ring.width - w / 2, s.y * ring.height - h / 2, w, h)
  }

  // ---- fade control --------------------------------------------------------
  // Fade is tracked as an accumulated budget (in e-folds). Each slot pays off what it
  // owes when the loop reaches it, so all slots end up equally faded even while the
  // rate changes or fading switches off; otherwise the loop would visibly pulse.
  let activity = 0 // stamps per second, smoothed
  let blackShare = 1 // smoothed share of black pixels on the board
  let halfLife = 0 // current fade half-life in seconds, 0 = not fading
  let fadeTotal = 0
  const slotFade = new Float64Array(ringLength)
  const sampler = makeSampler()

  function updateFade() {
    activity = activity * 0.7 + (stampsThisWindow / 0.5) * 0.3
    stampsThisWindow = 0
    blackShare = blackShare * 0.75 + sampler(ring.slot(tick).canvas) * 0.25
    if (blackShare >= BLACK_TARGET) {
      halfLife = 0
      return
    }
    // Busier board -> shorter half-life, interpolated on a log scale.
    const busy = clamp01(activity / BUSY_RATE)
    halfLife = FADE_HALF_LIFE_IDLE * Math.pow(FADE_HALF_LIFE_BUSY / FADE_HALF_LIFE_IDLE, busy)
    fadeTotal += (0.5 * Math.LN2) / halfLife
  }
  const fadeTimer = setInterval(updateFade, 500)

  // ---- writing a slot ------------------------------------------------------
  function prepareSlot(t) {
    const { ctx } = ring.slot(t)
    const i = ((t % ringLength) + ringLength) % ringLength
    const owed = fadeTotal - slotFade[i]
    // Tiny alphas get lost in 8-bit rounding, so let small amounts accumulate first.
    if (owed > 0.02) {
      ctx.fillStyle = `rgba(0,0,0,${(1 - Math.exp(-owed)).toFixed(4)})`
      ctx.fillRect(0, 0, ring.width, ring.height)
      slotFade[i] = fadeTotal
    }
    while (head < stamps.length && stamps[head].t0 <= t - ringLength) stamps[head++].a.refs--
    if (head > 1024 && head * 2 > stamps.length) {
      stamps.splice(0, head)
      head = 0
    }
    const size = STAMP_SIZE * Math.min(ring.width, ring.height)
    for (let i = head; i < stamps.length; i++) {
      const s = stamps[i]
      if (s.t0 > t) break
      drawStamp(ctx, s, t, size)
    }
  }

  // ---- painters ------------------------------------------------------------
  const painters = new Map() // peerId -> { x, y, d, at, hue, a, stroke, n, carry, mx, my, px, py }

  function onCursor(data, peerId) {
    if (!data || typeof data !== 'object') return
    const x = clamp01(Number(data.x))
    const y = clamp01(Number(data.y))
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    let p = painters.get(peerId)
    if (!p) {
      p = { hue: hues.get(peerId) ?? hueOf(peerId), stroke: false, n: 0, carry: 0, mx: x, my: y, px: x, py: y }
      painters.set(peerId, p)
    }
    p.x = x
    p.y = y
    if (Number.isFinite(data.h)) p.hue = ((Math.round(data.h) % 360) + 360) % 360 // the painter's own colour
    p.d = !!data.d
    p.at = performance.now()
    p.a = (typeof data.s === 'string' && atlas(data.s)) || p.a

    if (!p.d || !p.a) {
      if (p.stroke && p.a) strokeTo(p, p.px, p.py, p.px, p.py) // finish the tail
      p.stroke = false
      return
    }
    if (!p.stroke) {
      p.stroke = true
      p.n = 0
      p.carry = 0
      p.mx = p.px = x
      p.my = p.py = y
      addStamp(p.a, x, y, p.n++)
      return
    }
    // Smooth the stroke: quadratic curve from the last midpoint, through the previous
    // cursor point, to the new midpoint.
    strokeTo(p, p.px, p.py, (p.px + x) / 2, (p.py + y) / 2)
    p.px = x
    p.py = y
  }

  // Walk the curve (mx,my) -> control (cx,cy) -> (ex,ey) in board pixels and drop a
  // stamp every `spacing` pixels, carrying leftover distance into the next segment.
  function strokeTo(p, cx, cy, ex, ey) {
    const W = ring.width
    const H = ring.height
    const spacing = STAMP_SPACING * STAMP_SIZE * Math.min(W, H)
    const x0 = p.mx * W, y0 = p.my * H, x1 = cx * W, y1 = cy * H, x2 = ex * W, y2 = ey * H
    const approx = Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1)
    const n = Math.max(1, Math.ceil(approx / (spacing / 3)))
    let lx = x0
    let ly = y0
    let budget = MAX_STAMPS_PER_MOVE
    for (let i = 1; i <= n && budget > 0; i++) {
      const t = i / n
      const u = 1 - t
      const qx = u * u * x0 + 2 * u * t * x1 + t * t * x2
      const qy = u * u * y0 + 2 * u * t * y1 + t * t * y2
      p.carry += Math.hypot(qx - lx, qy - ly)
      lx = qx
      ly = qy
      if (p.carry >= spacing) {
        p.carry = 0
        addStamp(p.a, qx / W, qy / H, p.n++)
        budget--
      }
    }
    p.mx = ex
    p.my = ey
  }

  // Each painter's cursor: a dot in their colour, fading out over MARKER_MS.
  function drawMarkers(now) {
    const sx = board.width
    const sy = board.height
    const r = Math.max(9, Math.min(sx, sy) * 0.016)
    for (const [id, p] of painters) {
      const age = now - p.at
      if (age > MARKER_MS) {
        painters.delete(id)
        continue
      }
      const x = p.x * sx
      const y = p.y * sy
      const fill = `hsl(${p.hue} 95% 60%)`
      bctx.globalAlpha = 1 - age / MARKER_MS
      if (p.d && age < 500) {
        bctx.beginPath()
        bctx.arc(x, y, r * 1.9, 0, Math.PI * 2)
        bctx.lineWidth = r * 0.35
        bctx.strokeStyle = fill
        bctx.stroke()
      }
      bctx.beginPath()
      bctx.arc(x, y, r, 0, Math.PI * 2)
      bctx.fillStyle = fill
      bctx.fill()
      bctx.lineWidth = r * 0.3
      bctx.strokeStyle = 'rgba(0,0,0,0.8)'
      bctx.stroke()
      bctx.beginPath()
      bctx.arc(x, y, r * 1.15, 0, Math.PI * 2)
      bctx.lineWidth = r * 0.12
      bctx.strokeStyle = 'rgba(255,255,255,0.9)'
      bctx.stroke()
    }
    bctx.globalAlpha = 1
  }

  // ---- render loop ---------------------------------------------------------
  let raf = 0
  function frame(now) {
    raf = requestAnimationFrame(frame)
    const target = clockTick()
    if (target - tick > ringLength) tick = target - ringLength // tab was hidden: skip ahead
    while (tick < target) prepareSlot(++tick)
    bctx.imageSmoothingEnabled = true
    bctx.drawImage(ring.slot(tick).canvas, 0, 0, board.width, board.height)
    drawMarkers(now)
    if (debug) {
      debug.textContent =
        `ring ${ringLength}×${ring.width}×${ring.height} ${SOFTWARE ? "cpu" : "gpu"} · stamps ${stamps.length - head} (+${waiting.length} waiting) · sheets ${(atlasBytes / 1048576).toFixed(0)}MB` +
        ` · ${activity.toFixed(1)}/s · black ${(blackShare * 100).toFixed(0)}% · fade ${halfLife ? `half-life ${halfLife.toFixed(0)}s` : 'off'}`
    }
  }
  const debug = new URLSearchParams(location.search).has('debug') ? document.createElement('div') : null
  if (debug) {
    window.__gifshooter = { ring: () => ring, sampler }
    debug.className = 'debug'
    $('present').append(debug)
  }
  raf = requestAnimationFrame(frame)

  // ---- network -------------------------------------------------------------
  const { room, hello, cursor } = connect(code)
  const peers = new Set()
  const screens = new Set()
  const info = () => ({ role: 'screen', aspect: board.clientWidth / board.clientHeight, frames: ringLength })
  const hues = new Map() // peerId -> colour this screen handed out
  // Pick the hue furthest from every colour already in use, so painters stay distinct.
  function pickHue() {
    const used = [...hues.values()]
    for (const p of painters.values()) used.push(p.hue)
    if (!used.length) return Math.floor(Math.random() * 360)
    let best = 0
    let bestGap = -1
    for (let h = 0; h < 360; h += 5) {
      let gap = 180
      for (const u of used) gap = Math.min(gap, Math.abs(((h - u + 540) % 360) - 180))
      if (gap > bestGap) {
        bestGap = gap
        best = h
      }
    }
    return best
  }
  const sendInfo = (peerId) => hello.send({ ...info(), hue: hues.get(peerId) }, { target: peerId }).catch(() => {})
  const updatePeers = () => {
    const n = peers.size - screens.size
    $('present-peers').textContent = `${n} painter${n === 1 ? '' : 's'}`
  }

  room.onPeerJoin = (peerId) => {
    peers.add(peerId)
    hues.set(peerId, pickHue())
    sendInfo(peerId)
    updatePeers()
  }
  room.onPeerLeave = (peerId) => {
    peers.delete(peerId)
    screens.delete(peerId)
    hues.delete(peerId)
    const p = painters.get(peerId)
    if (p) p.stroke = false
    updatePeers()
  }
  hello.onMessage = (data, { peerId }) => {
    if (data?.role === 'screen') {
      screens.add(peerId)
      hues.delete(peerId)
    }
    updatePeers()
  }
  cursor.onMessage = (data, { peerId }) => onCursor(data, peerId)

  let resizeTimer = 0
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      layout()
      for (const peerId of peers) sendInfo(peerId)
    }, 250)
  })

  window.addEventListener('pagehide', () => {
    cancelAnimationFrame(raf)
    clearInterval(fadeTimer)
    room.leave()
    ring.dispose()
    for (const a of atlases.values()) a.bitmap?.close()
  })
}

// Share of (near-)black pixels in a small downscaled copy of the board.
function makeSampler() {
  const c = document.createElement('canvas')
  c.width = SAMPLE_W
  c.height = SAMPLE_H
  const ctx = c.getContext('2d', { willReadFrequently: true, alpha: false })
  return (source) => {
    ctx.drawImage(source, 0, 0, SAMPLE_W, SAMPLE_H)
    const px = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data
    let black = 0
    for (let i = 0; i < px.length; i += 4) {
      if (px[i] < BLACK_LEVEL && px[i + 1] < BLACK_LEVEL && px[i + 2] < BLACK_LEVEL) black++
    }
    return black / (SAMPLE_W * SAMPLE_H)
  }
}
