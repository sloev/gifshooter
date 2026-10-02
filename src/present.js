import QRCode from 'qrcode'
import { connect } from './net.js'
import { loadManifest, loadBitmap, frameRect, FPS, MAX_RING_FRAMES } from './library.js'
import { painterUrl } from './rooms.js'

const TICK_MS = 1000 / FPS
const MARKER_MS = 10_000 // painter cursors fade out over this long
const STAMP_SIZE = 0.16 // stamp size, as a share of the board's shorter side
const STAMP_SPACING = 0.1 // distance between stamps along a stroke, as a share of stamp size
const MAX_STAMPS_PER_MOVE = 48 // interpolation cap for one cursor update
const MAX_ACTIVE_STAMPS = 4000 // hard cap on stamps still being written into the ring
const MAX_WAITING_STAMPS = 400 // stamps parked while their spritesheet downloads
const BLACK_TARGET = 0.2 // stop fading once this share of the board is black
const BLACK_LEVEL = 28 // a pixel counts as black when its brightest channel is below this
const FADE_HALF_LIFE_IDLE = 120 // seconds, when nobody is drawing
const FADE_HALF_LIFE_BUSY = 8 // seconds, at BUSY_RATE stamps/s or more
const BUSY_RATE = 25
const SAMPLE_W = 96
const SAMPLE_H = 54

const $ = (id) => document.getElementById(id)
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

function makeSurface(width, height) {
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height })
  const ctx = canvas.getContext('2d', { alpha: false })
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
  const params = new URLSearchParams(location.search)
  const lowMem = navigator.deviceMemory && navigator.deviceMemory <= 4
  const budgetMB = Number(params.get('budget')) || (lowMem ? 128 : 256)
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
  $('present-url').textContent = url.replace(/^https?:\/\//, '')
  QRCode.toCanvas($('qr'), url, { margin: 1, width: 168, color: { dark: '#000', light: '#fff' } }).catch(console.error)

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

  // ---- spritesheets (loaded on first use, then kept) -----------------------
  const atlases = new Map()
  function atlas(id) {
    let a = atlases.get(id)
    if (!a) {
      const sprite = manifest.byId.get(id)
      if (!sprite) return null
      a = { sprite, bitmap: null }
      atlases.set(id, a)
      loadBitmap(sprite.file)
        .then((bitmap) => {
          a.bitmap = bitmap
          flushWaiting()
        })
        .catch((err) => {
          console.error(err)
          atlases.delete(id)
        })
    }
    return a
  }
  let thumbs = null
  loadBitmap(manifest.thumbs.file).then((b) => (thumbs = b), console.error)

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
    drawStamp(ring.slot(tick).ctx, s, tick, STAMP_SIZE * Math.min(ring.width, ring.height))
    stampsThisWindow++
    if (stamps.length - head > MAX_ACTIVE_STAMPS) head = stamps.length - MAX_ACTIVE_STAMPS
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
    while (head < stamps.length && stamps[head].t0 <= t - ringLength) head++
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
      p = { hue: hueOf(peerId), stroke: false, n: 0, carry: 0, mx: x, my: y, px: x, py: y }
      painters.set(peerId, p)
    }
    p.x = x
    p.y = y
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

  function drawMarkers(now) {
    const sx = board.width
    const sy = board.height
    const r = Math.max(10, Math.min(sx, sy) * 0.018)
    for (const [id, p] of painters) {
      const age = now - p.at
      if (age > MARKER_MS) {
        painters.delete(id)
        continue
      }
      const alpha = 1 - age / MARKER_MS
      const x = p.x * sx
      const y = p.y * sy
      bctx.globalAlpha = alpha
      bctx.lineWidth = r * 0.28
      bctx.strokeStyle = '#000'
      bctx.beginPath()
      bctx.arc(x, y, r, 0, Math.PI * 2)
      bctx.stroke()
      bctx.lineWidth = r * 0.16
      bctx.strokeStyle = `hsl(${p.hue} 95% 62%)`
      bctx.stroke()
      if (p.d && age < 500) {
        bctx.fillStyle = `hsl(${p.hue} 95% 62%)`
        bctx.beginPath()
        bctx.arc(x, y, r * 0.35, 0, Math.PI * 2)
        bctx.fill()
      }
      if (thumbs && p.a) {
        const t = manifest.thumbs
        const i = p.a.sprite.index
        const ts = r * 2.2
        bctx.drawImage(thumbs, (i % t.cols) * t.size, Math.floor(i / t.cols) * t.size, t.size, t.size, x + r * 0.9, y + r * 0.9, ts, ts)
      }
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
        `ring ${ringLength}×${ring.width}×${ring.height} · stamps ${stamps.length - head} (+${waiting.length} waiting)` +
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
  const updatePeers = () => {
    const n = peers.size - screens.size
    $('present-peers').textContent = `${n} painter${n === 1 ? '' : 's'}`
  }

  room.onPeerJoin = (peerId) => {
    peers.add(peerId)
    hello.send(info(), { target: peerId }).catch(() => {})
    updatePeers()
  }
  room.onPeerLeave = (peerId) => {
    peers.delete(peerId)
    screens.delete(peerId)
    const p = painters.get(peerId)
    if (p) p.stroke = false
    updatePeers()
  }
  hello.onMessage = (data, { peerId }) => {
    if (data?.role === 'screen') screens.add(peerId)
    updatePeers()
  }
  cursor.onMessage = (data, { peerId }) => onCursor(data, peerId)

  let resizeTimer = 0
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      layout()
      hello.send(info()).catch(() => {})
    }, 250)
  })

  window.addEventListener('pagehide', () => {
    cancelAnimationFrame(raf)
    clearInterval(fadeTimer)
    room.leave()
    ring.dispose()
    for (const a of atlases.values()) a.bitmap?.close()
    thumbs?.close()
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
