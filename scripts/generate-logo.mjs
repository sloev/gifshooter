// Renders the animated "GIFSHOOTER" logo as public/logo.webp: chunky extruded
// WordArt-style letters with a rainbow face, dark candy sides and chrome highlights,
// swinging and waving in a seamless loop.
//
//   node scripts/generate-logo.mjs
import path from 'node:path'
import sharp from 'sharp'
import { TAU, clamp, mix, hsv } from './procedural/lib.mjs'

const W = 800
const H = 176
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
const TEXT = 'GIFSHOOTER'
const GAP = 0.36

// Lay out segments, centred on the origin.
const segs = []
let pen = 0
for (const ch of TEXT) {
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

// ---- precomputed 2D distance field (bilinear lookup keeps raymarching cheap) ---
const VIEW_W = textW + 1.9 // world units across the image
const VIEW_H = (VIEW_W * H) / W
const GX = 1400
const GY = Math.round((GX * VIEW_H) / VIEW_W) + 1
const grid = new Float32Array(GX * GY)
for (let j = 0; j < GY; j++) {
  for (let i = 0; i < GX; i++) {
    const x = (i / (GX - 1) - 0.5) * VIEW_W
    const y = (j / (GY - 1) - 0.5) * VIEW_H
    let d = Infinity
    for (const [ax, ay, bx, by] of segs) {
      const vx = bx - ax, vy = by - ay
      const h = clamp(((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1))
      d = Math.min(d, Math.hypot(x - ax - vx * h, y - ay - vy * h))
    }
    grid[j * GX + i] = d - R
  }
}
function sd2(x, y) {
  const fx = (x / VIEW_W + 0.5) * (GX - 1)
  const fy = (y / VIEW_H + 0.5) * (GY - 1)
  if (fx < 0 || fy < 0 || fx >= GX - 1 || fy >= GY - 1) return 1
  const i = Math.floor(fx), j = Math.floor(fy)
  const u = fx - i, v = fy - j
  const k = j * GX + i
  return mix(mix(grid[k], grid[k + 1], u), mix(grid[k + GX], grid[k + GX + 1], u), v)
}

// ---- 3D: rounded extrusion, deformed by a travelling wave and a gentle swing ----
const DEPTH = 0.22
const BEVEL = 0.07
function makeScene(t) {
  const yaw = 0.28 * Math.sin(TAU * t)
  const pitch = 0.12 * Math.sin(TAU * t + 1.3)
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch)
  const local = (x0, y0, z0, o) => {
    // swing (rotate the object), then wave the letters up and down
    let x = x0 * cy + z0 * sy
    let z = -x0 * sy + z0 * cy
    let y = y0 * cp - z * sp
    z = y0 * sp + z * cp
    y -= 0.16 * Math.sin(TAU * t - x * 0.75)
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
  return { sdf, local, faceZ }
}

const out = [0, 0, 0, 0]
const q = [0, 0, 0]
function shadePixel(scene, t, X, Y) {
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
      const hue = q[0] * 0.045 - t
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

const frames = []
for (let f = 0; f < FRAMES; f++) {
  const t = f / FRAMES
  const scene = makeScene(t)
  const buf = Buffer.alloc(W * H * 4)
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const X = ((px + (sx + 0.5) / SS) / W - 0.5) * VIEW_W
          const Y = (0.5 - (py + (sy + 0.5) / SS) / H) * VIEW_H
          const c = shadePixel(scene, t, X, Y)
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
  frames.push(buf)
  process.stdout.write(`\rframe ${f + 1}/${FRAMES}`)
}

await sharp(Buffer.concat(frames), { raw: { width: W, height: H * FRAMES, channels: 4, pageHeight: H } })
  .webp({ loop: 0, delay: Array(FRAMES).fill(Math.round(1000 / 15)), quality: 85, alphaQuality: 90, effort: 6 })
  .toFile(path.join(ROOT, 'public/logo.webp'))
console.log('\nwrote public/logo.webp')
