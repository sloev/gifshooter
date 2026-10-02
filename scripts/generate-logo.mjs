// Renders the animated "GIFSHOOTER" logo as public/logo.webp: chunky extruded
// WordArt-style letters with a rainbow face, dark candy sides and chrome highlights,
// swinging and waving in a seamless loop. Also renders the app icons (a 3D "G")
// into public/icons/ and the favicon.
//
//   node scripts/generate-logo.mjs          logo + icons
//   node scripts/generate-logo.mjs icons    icons only
//   node scripts/generate-logo.mjs logo     logo only
import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import sharp from 'sharp'
import { TAU, clamp, mix, hsv, fract, palette } from './procedural/lib.mjs'

const FRAMES = 45 // 3 s at 15 fps
const SS = 2
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')

// ---- letters as rounded strokes ---------------------------------------------
// Glyph space: y up, baseline 0, cap height 1.4. Each glyph is a list of polylines.
const R = 0.2 // stroke radius
const arc = (cx, cy, rx, ry, a0, a1, n = 14) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)]
  })
const glyphs = {
  G: { w: 1, lines: [[...arc(0.5, 0.7, 0.42, 0.62, 40, 330), [0.9, 0.66], [0.56, 0.66]]] },
  I: { w: 0.4, lines: [[[0.2, 0.08], [0.2, 1.32]]] },
  F: { w: 0.85, lines: [[[0.12, 0.08], [0.12, 1.32], [0.82, 1.32]], [[0.12, 0.74], [0.66, 0.74]]] },
  S: { w: 0.95, lines: [[...arc(0.48, 1.0, 0.36, 0.32, 15, 270), ...arc(0.48, 0.37, 0.38, 0.31, 90, -165)]] },
  H: { w: 1, lines: [[[0.12, 0.08], [0.12, 1.32]], [[0.88, 0.08], [0.88, 1.32]], [[0.12, 0.72], [0.88, 0.72]]] },
  O: { w: 1.02, lines: [arc(0.51, 0.7, 0.4, 0.62, 0, 360, 28)] },
  T: { w: 0.95, lines: [[[0.06, 1.32], [0.89, 1.32]], [[0.475, 1.32], [0.475, 0.08]]] },
  E: { w: 0.85, lines: [[[0.82, 1.32], [0.12, 1.32], [0.12, 0.08], [0.82, 0.08]], [[0.12, 0.72], [0.66, 0.72]]] },
  R: { w: 0.95, lines: [[[0.12, 0.08], [0.12, 1.32], [0.5, 1.32], ...arc(0.5, 1.02, 0.34, 0.3, 90, -90, 10), [0.12, 0.72]], [[0.46, 0.72], [0.86, 0.08]]] },
}
const GAP = 0.36

// Lay out a word as stroke segments centred on the origin and precompute its 2D
// distance field over a view of viewW world units (bilinear lookup keeps raymarching
// cheap). Returns { sd2, viewW, viewH }.
function layoutText(text, pad, aspect, gridX = 1400) {
  const segs = []
  let pen = 0
  for (const ch of text) {
    const g = glyphs[ch]
    for (const line of g.lines) for (let i = 0; i < line.length - 1; i++) segs.push([line[i][0] + pen, line[i][1], line[i + 1][0] + pen, line[i + 1][1]])
    pen += g.w + GAP
  }
  const textW = pen - GAP
  for (const s of segs) {
    s[0] -= textW / 2
    s[2] -= textW / 2
    s[1] -= 0.7
    s[3] -= 0.7
  }
  const viewW = Math.max(textW + pad, (1.4 + pad) * aspect)
  const viewH = viewW / aspect
  const GX = gridX
  const GY = Math.round((GX * viewH) / viewW) + 1
  const grid = new Float32Array(GX * GY)
  for (let j = 0; j < GY; j++) {
    for (let i = 0; i < GX; i++) {
      const x = (i / (GX - 1) - 0.5) * viewW
      const y = (j / (GY - 1) - 0.5) * viewH
      let d = Infinity
      for (const [ax, ay, bx, by] of segs) {
        const vx = bx - ax, vy = by - ay
        const h = clamp(((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1))
        d = Math.min(d, Math.hypot(x - ax - vx * h, y - ay - vy * h))
      }
      grid[j * GX + i] = d - R
    }
  }
  const sd2 = (x, y) => {
    const fx = (x / viewW + 0.5) * (GX - 1)
    const fy = (y / viewH + 0.5) * (GY - 1)
    if (fx < 0 || fy < 0 || fx >= GX - 1 || fy >= GY - 1) return 1
    const i = Math.floor(fx), j = Math.floor(fy)
    const u = fx - i, v = fy - j
    const k = j * GX + i
    return mix(mix(grid[k], grid[k + 1], u), mix(grid[k + GX], grid[k + GX + 1], u), v)
  }
  return { sd2, viewW, viewH }
}

// ---- 3D: rounded extrusion, deformed by a travelling wave and a gentle swing ----
const DEPTH = 0.22
const BEVEL = 0.07
function makeScene(sd2, t, { swing = 1, wave = 0.16, hueX = 0.045, hueY = 0 } = {}) {
  const yaw = 0.28 * Math.sin(TAU * t) * swing + (swing ? 0 : 0.32)
  const pitch = 0.12 * Math.sin(TAU * t + 1.3) * swing + (swing ? 0 : -0.12)
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch)
  const local = (x0, y0, z0, o) => {
    // swing (rotate the object), then wave the letters up and down
    let x = x0 * cy + z0 * sy
    let z = -x0 * sy + z0 * cy
    let y = y0 * cp - z * sp
    z = y0 * sp + z * cp
    y -= wave * Math.sin(TAU * t - x * 0.75)
    o[0] = x
    o[1] = y
    o[2] = z
  }
  const q = [0, 0, 0]
  const sdf = (x, y, z) => {
    local(x, y, z, q)
    const dx = sd2(q[0], q[1]) + BEVEL
    const dz = Math.abs(q[2]) - DEPTH
    return Math.min(Math.max(dx, dz), 0) + Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) - BEVEL
  }
  // normal rotated into the letters' own space (ignoring the small wave tilt)
  const faceZ = (nx, ny, nz) => ny * sp + (-nx * sy + nz * cy) * cp
  const hue = (x, y) => x * hueX + y * hueY - t
  return { sdf, local, faceZ, hue }
}

const out = [0, 0, 0, 0]
const q = [0, 0, 0]
function shadePixel(scene, X, Y) {
  // orthographic camera looking down +z
  const { sdf, local, faceZ } = scene
  let z = -1.4
  for (let i = 0; i < 90 && z < 1.4; i++) {
    const d = sdf(X, Y, z)
    if (d < 0.001) {
      const e = 0.002
      let nx = sdf(X + e, Y, z) - sdf(X - e, Y, z)
      let ny = sdf(X, Y + e, z) - sdf(X, Y - e, z)
      let nz = sdf(X, Y, z + e) - sdf(X, Y, z - e)
      const l = Math.hypot(nx, ny, nz) || 1
      nx /= l
      ny /= l
      nz /= l
      local(X, Y, z, q)
      const hue = scene.hue(q[0], q[1])
      // front/back face vs extruded side, judged in the letters' own frame
      if (Math.abs(faceZ(nx, ny, nz)) > 0.78) {
        // rainbow face, brighter at the top like old chrome WordArt
        hsv(hue, 0.85, 1, out)
        const v = 0.7 + 0.3 * clamp(q[1] / 0.7 + 0.5)
        for (let k = 0; k < 3; k++) out[k] *= v
      } else {
        // candy-dark extruded sides with stripes
        hsv(hue + 0.5, 0.9, 0.55, out)
        const stripe = 0.75 + 0.25 * Math.sin(q[2] * 40)
        for (let k = 0; k < 3; k++) out[k] *= stripe
      }
      const Lx = -0.4, Ly = 0.65, Lz = -0.65
      const diff = clamp(nx * Lx + ny * Ly + nz * Lz)
      // Blinn-Phong with the view along +z
      const hx = Lx, hy = Ly, hz = Lz - 1
      const hl = Math.hypot(hx, hy, hz)
      const spec = Math.pow(clamp((nx * hx + ny * hy + nz * hz) / hl), 30)
      for (let k = 0; k < 3; k++) out[k] = clamp(out[k] * (0.45 + 0.7 * diff) + spec * 0.9)
      out[3] = 1
      return out
    }
    z += d * 0.75
  }
  out[3] = 0
  return out
}

// Render one frame as RGBA8 over [viewW x viewH] world units.
function renderFrame(scene, W, H, viewW, viewH) {
  const buf = Buffer.alloc(W * H * 4)
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const X = ((px + (sx + 0.5) / SS) / W - 0.5) * viewW
          const Y = (0.5 - (py + (sy + 0.5) / SS) / H) * viewH
          const c = shadePixel(scene, X, Y)
          r += c[0] * c[3]
          g += c[1] * c[3]
          b += c[2] * c[3]
          a += c[3]
        }
      }
      const i = (py * W + px) * 4
      if (a > 0) {
        buf[i] = Math.round((r / a) * 255)
        buf[i + 1] = Math.round((g / a) * 255)
        buf[i + 2] = Math.round((b / a) * 255)
      }
      buf[i + 3] = Math.round((a / (SS * SS)) * 255)
    }
  }
  return buf
}

// ---- icons: a static 3D "G" ------------------------------------------------------
// `pad` is extra world units around the letter: more padding = smaller glyph
// (maskable icons need it inside the central safe circle).
async function icon(file, size, pad, background) {
  const { sd2, viewW, viewH } = layoutText('G', pad, 1, 900)
  const scene = makeScene(sd2, 0.62, { swing: 0, wave: 0, hueX: 0.22, hueY: 0.16 })
  let img = sharp(renderFrame(scene, size, size, viewW, viewH), { raw: { width: size, height: size, channels: 4 } })
  if (background) img = img.flatten({ background })
  await img.png({ compressionLevel: 9 }).toFile(path.join(ROOT, file))
  console.log('wrote', file)
}

if (process.argv[2] !== 'logo') {
  await mkdir(path.join(ROOT, 'public/icons'), { recursive: true })
  await icon('public/icons/icon-512.png', 512, 0.55, '#000000')
  await icon('public/icons/icon-192.png', 192, 0.55, '#000000')
  await icon('public/icons/maskable-512.png', 512, 1.5, '#000000')
  await icon('public/icons/apple-touch-icon.png', 180, 0.7, '#000000')
  await icon('public/favicon.png', 64, 0.4)
}
if (process.argv[2] === 'icons') process.exit(0)

// ---- animated logo: early-MTV / 90s demoscene ------------------------------------------
// Every letter is its own extruded object: a domino wave of full 3D flips, bouncing on
// the beat, acid plasma faces with a chrome sheen, black-and-white checkered sides, a
// fat black outline and a hard drop shadow in cycling hot colours. Behind it: copper
// bars, a streaking starfield and MTV zigzags; a few frames glitch with RGB tears.
const W = 800
const H = 220
const LOGO = 'GIFSHOOTER'
const L_DEPTH = 0.2
const L_BEVEL = 0.06
const OUTLINE = 0.09
const SHADOW = [0.2, -0.17] // hard drop shadow offset (world units)

// per-letter distance grids in glyph-local coords centred on the glyph
function letterField(ch, res = 150) {
  const g = glyphs[ch]
  const pad = 0.55
  const x0 = -g.w / 2 - pad, x1 = g.w / 2 + pad, y0 = -0.7 - pad, y1 = 0.7 + pad
  const segs = []
  for (const line of g.lines) for (let i = 0; i < line.length - 1; i++) segs.push([line[i][0] - g.w / 2, line[i][1] - 0.7, line[i + 1][0] - g.w / 2, line[i + 1][1] - 0.7])
  const GX = Math.round((x1 - x0) * res), GY = Math.round((y1 - y0) * res)
  const grid = new Float32Array(GX * GY)
  for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++) {
    const x = x0 + ((x1 - x0) * i) / (GX - 1), y = y0 + ((y1 - y0) * j) / (GY - 1)
    let d = Infinity
    for (const [ax, ay, bx, by] of segs) {
      const vx = bx - ax, vy = by - ay
      const h = clamp(((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1))
      d = Math.min(d, Math.hypot(x - ax - vx * h, y - ay - vy * h))
    }
    grid[j * GX + i] = d - R
  }
  return (x, y) => {
    const fx = ((x - x0) / (x1 - x0)) * (GX - 1), fy = ((y - y0) / (y1 - y0)) * (GY - 1)
    if (fx < 0 || fy < 0 || fx >= GX - 1 || fy >= GY - 1) return 0.5
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, k = j * GX + i
    return mix(mix(grid[k], grid[k + 1], u), mix(grid[k + GX], grid[k + GX + 1], u), v)
  }
}

const letters = []
{
  let pen = 0
  for (const ch of LOGO) {
    letters.push({ ch, cx: pen + glyphs[ch].w / 2, sd: letterField(ch) })
    pen += glyphs[ch].w + GAP
  }
  for (const l of letters) l.cx -= (pen - GAP) / 2
}
const VW = (letters.at(-1).cx - letters[0].cx) + 2.6
const VH = (VW * H) / W

const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u))
function wildPose(t) {
  const beat = Math.exp(-Math.pow((fract(t * 4) - 0.02) / 0.08, 2)) // 4 beats per loop
  return letters.map((l, j) => {
    // domino wave: each letter does one full flip per loop, staggered
    const flip = ease((fract(t - j * 0.045) - 0.05) / 0.3)
    const a = TAU * flip
    const bounce = 0.28 * Math.abs(Math.sin(TAU * t * 2 - j * 0.55)) - 0.12
    const tilt = 0.18 * Math.sin(TAU * t + j * 0.9)
    const s = 1 + 0.1 * beat + 0.04 * Math.sin(TAU * t * 2 + j)
    return { ...l, ca: Math.cos(a), sa: Math.sin(a), ct: Math.cos(tilt), st: Math.sin(tilt), by: bounce, s }
  })
}

// letter-local point for world point (x,y,z); writes q[0..2]
function toLocal(L, x, y, z, q) {
  const px = (x - L.cx) / L.s, py = (y - L.by) / L.s, pz = z / L.s
  const rx = px * L.ca + pz * L.sa
  const rz = -px * L.sa + pz * L.ca
  q[0] = rx * L.ct + py * L.st
  q[1] = -rx * L.st + py * L.ct
  q[2] = rz
}
const extrude = (d2, z, depth, bevel) => {
  const dx = d2 + bevel, dz = Math.abs(z) - depth
  return Math.min(Math.max(dx, dz), 0) + Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) - bevel
}

const hitInfo = { mat: 0, j: 0 } // mat: 1 letter, 2 outline, 3 shadow
const lq = [0, 0, 0]
function wildSdf(pose, x, y, z) {
  let best = Infinity
  // only letters near this x can be hit (they never move far from their slot)
  for (let j = 0; j < pose.length; j++) {
    const L = pose[j]
    if (Math.abs(x - L.cx) > 1.2 && Math.abs(x - SHADOW[0] - L.cx) > 1.2) continue
    toLocal(L, x, y, z, lq)
    const d2 = L.sd(lq[0], lq[1])
    const dl = extrude(d2, lq[2], L_DEPTH, L_BEVEL) * L.s
    if (dl < best) { best = dl; hitInfo.mat = 1; hitInfo.j = j }
    // outline: a thin flange through the middle of the letter, so it frames the face
    // from the front and the back and stays out of the way edge-on during flips
    const dout = extrude(d2 - OUTLINE, lq[2], 0.03, 0.02) * L.s
    if (dout < best) { best = dout; hitInfo.mat = 2; hitInfo.j = j }
    toLocal(L, x - SHADOW[0], y - SHADOW[1], z - 0.7, lq)
    const ds = extrude(L.sd(lq[0], lq[1]) - OUTLINE, lq[2], 0.03, 0.02) * L.s
    if (ds < best) { best = ds; hitInfo.mat = 3; hitInfo.j = j }
  }
  return best
}

const col = [0, 0, 0, 0]
const tmpc = [0, 0, 0]
function wildBackground(t, X, Y, o) {
  o[0] = o[1] = o[2] = 0
  o[3] = 0
  const over = (r, g, b, a) => {
    o[0] = mix(o[0], r, a); o[1] = mix(o[1], g, a); o[2] = mix(o[2], b, a); o[3] = a + o[3] * (1 - a)
  }
  // streaking starfield (integer speeds keep the loop seamless)
  for (let i = 0; i < 36; i++) {
    const ys = (fract(Math.sin(i * 12.9898) * 43758.5) - 0.5) * VH * 0.95
    if (Math.abs(Y - ys) > 0.025) continue
    const k = 1 + (i % 3)
    const xs = (fract(fract(Math.sin(i * 78.233) * 12345.6) - k * t) - 0.5) * (VW + 2)
    const tail = 0.25 * k
    if (X < xs && X > xs - tail) over(1, 1, 1, ((X - xs + tail) / tail) * 0.8)
  }
  // copper bars
  for (let i = 0; i < 3; i++) {
    const yb = Math.sin(TAU * (t + i / 3)) * VH * 0.32
    const d = Math.abs(Y - yb) / 0.17
    if (d < 1) {
      const v = 1 - d
      palette(i / 3 + v * 0.25 + t, tmpc, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [1, 1, 1], [0, 0.33, 0.67])
      over(tmpc[0] * (0.4 + v), tmpc[1] * (0.4 + v), tmpc[2] * (0.4 + v), Math.pow(v, 0.5) * 0.85)
    }
  }
  // MTV zigzags
  for (let i = 0; i < 2; i++) {
    const tri = (u) => Math.abs(fract(u) - 0.5) * 4 - 1
    const yz = (i ? -1 : 1) * VH * 0.36 + 0.12 * tri(X * 0.9 + (i ? -1 : 1) * t * 2)
    if (Math.abs(Y - yz) < 0.045) over(i ? 0.1 : 1, i ? 0.95 : 0.9, i ? 1 : 0.1, 1)
  }
}

function wildPixel(pose, t, X, Y) {
  let z = -2.2
  for (let i = 0; i < 120 && z < 2.2; i++) {
    const d = wildSdf(pose, X, Y, z)
    if (d < 0.0012) {
      const { mat, j } = hitInfo
      const L = pose[j]
      if (mat === 2) return (col[0] = col[1] = col[2] = 0.02, (col[3] = 1), col)
      if (mat === 3) {
        hsv(t * 2 + j * 0.13, 1, 1, col)
        col[3] = 1
        return col
      }
      const e = 0.002
      let nx = wildSdf(pose, X + e, Y, z) - wildSdf(pose, X - e, Y, z)
      let ny = wildSdf(pose, X, Y + e, z) - wildSdf(pose, X, Y - e, z)
      let nz = wildSdf(pose, X, Y, z + e) - wildSdf(pose, X, Y, z - e)
      const nl = Math.hypot(nx, ny, nz) || 1
      nx /= nl; ny /= nl; nz /= nl
      toLocal(L, X, Y, z, lq)
      const faceZ = -nx * L.sa + nz * L.ca // normal in the letter's own frame (z part)
      if (Math.abs(faceZ) > 0.75) {
        // acid plasma face with a chrome horizon sheen
        const v = Math.sin(lq[0] * 4 + TAU * t) + Math.sin(lq[1] * 5 - TAU * t * 2) + Math.sin((lq[0] + lq[1]) * 3 + TAU * t + j)
        palette(v * 0.18 + t + j * 0.08, col, [0.6, 0.5, 0.5], [0.5, 0.5, 0.5], [1, 1, 1], [0.0, 0.25, 0.6])
        const chrome = lq[1] > 0.05 ? 0.25 : 0
        for (let k = 0; k < 3; k++) col[k] = mix(col[k], 1, chrome * (0.5 + 0.5 * Math.sin(lq[1] * 30)))
      } else {
        // black & white checkered extrusion
        const c = (Math.floor(lq[2] * 12 + 10) + Math.floor((lq[0] + lq[1]) * 8 + 10)) & 1
        col[0] = col[1] = col[2] = c ? 0.95 : 0.06
      }
      const Lx = -0.45, Ly = 0.6, Lz = -0.66
      const diff = clamp(nx * Lx + ny * Ly + nz * Lz)
      const hx = Lx, hy = Ly, hz = Lz - 1, hl = Math.hypot(hx, hy, hz)
      const spec = Math.pow(clamp((nx * hx + ny * hy + nz * hz) / hl), 24)
      for (let k = 0; k < 3; k++) col[k] = clamp(col[k] * (0.55 + 0.6 * diff) + spec)
      col[3] = 1
      return col
    }
    z += Math.max(d * 0.7, 0.002)
  }
  wildBackground(t, X, Y, col)
  return col
}

function renderWild(t) {
  const pose = wildPose(t)
  const buf = Buffer.alloc(W * H * 4)
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    let r = 0, g = 0, b = 0, a = 0
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const X = ((px + (sx + 0.5) / SS) / W - 0.5) * VW
      const Y = (0.5 - (py + (sy + 0.5) / SS) / H) * VH
      const c = wildPixel(pose, t, X, Y)
      r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3]
    }
    const i = (py * W + px) * 4
    if (a > 0) {
      buf[i] = Math.round((r / a) * 255)
      buf[i + 1] = Math.round((g / a) * 255)
      buf[i + 2] = Math.round((b / a) * 255)
    }
    buf[i + 3] = Math.round((a / (SS * SS)) * 255)
  }
  return buf
}

// VHS-style glitch: RGB split plus a few torn rows
function glitch(buf, amount, seed) {
  const src = Buffer.from(buf)
  const tear = (y) => {
    const band = Math.floor(y / 14)
    return fract(Math.sin((band + seed) * 91.7) * 4371.3) > 0.7 ? Math.round((fract(Math.sin(band * 13.1 + seed) * 999) - 0.5) * 60) : 0
  }
  for (let y = 0; y < H; y++) {
    const off = tear(y)
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4
      const at = (dx) => (y * W + Math.min(W - 1, Math.max(0, x + off + dx))) * 4
      buf[o] = src[at(amount)]
      buf[o + 1] = src[at(0) + 1]
      buf[o + 2] = src[at(-amount) + 2]
      buf[o + 3] = Math.max(src[at(amount) + 3], src[at(0) + 3], src[at(-amount) + 3])
    }
  }
}

const GLITCH = new Map([[11, 7], [12, 12], [29, 9], [41, 6]]) // frame -> RGB split px
const frames = []
for (let f = 0; f < FRAMES; f++) {
  const buf = renderWild(f / FRAMES)
  if (GLITCH.has(f)) glitch(buf, GLITCH.get(f), f)
  frames.push(buf)
  process.stdout.write(`\rframe ${f + 1}/${FRAMES}`)
}

await sharp(Buffer.concat(frames), { raw: { width: W, height: H * FRAMES, channels: 4, pageHeight: H } })
  .webp({ loop: 0, delay: Array(FRAMES).fill(Math.round(1000 / 15)), quality: 60, alphaQuality: 80, effort: 6 })
  .toFile(path.join(ROOT, 'public/logo.webp'))
console.log('\nwrote public/logo.webp')
