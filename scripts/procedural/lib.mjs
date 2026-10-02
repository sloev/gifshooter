// Tiny software renderer for procedural looping gifs: per-pixel "shaders", an SDF
// raymarcher, analytic spheres, and a line/triangle rasterizer. Everything works on
// plain numbers (no vector objects) so the hot loops stay allocation-free.

export const TAU = Math.PI * 2
export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v)
export const mix = (a, b, t) => a + (b - a) * t
export const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}
export const fract = (v) => v - Math.floor(v)

// Inigo Quilez cosine palette, writes rgb into out[0..2].
export function palette(t, out, a = [0.5, 0.5, 0.5], b = [0.5, 0.5, 0.5], c = [1, 1, 1], d = [0, 0.33, 0.67]) {
  out[0] = a[0] + b[0] * Math.cos(TAU * (c[0] * t + d[0]))
  out[1] = a[1] + b[1] * Math.cos(TAU * (c[1] * t + d[1]))
  out[2] = a[2] + b[2] * Math.cos(TAU * (c[2] * t + d[2]))
  return out
}

export function hsv(h, s, v, out) {
  h = fract(h) * 6
  for (let i = 0; i < 3; i++) {
    const k = (h + [0, 4, 2][i]) % 6
    out[i] = v * mix(1, clamp(Math.abs(k - 3) - 1), s)
  }
  return out
}

// ---- 3D value noise (seamless when sampled on a rotating sphere) ------------
const PERM = new Uint8Array(512)
{
  let s = 1337
  const p = Array.from({ length: 256 }, (_, i) => i)
  for (let i = 255; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const j = s % (i + 1)
    ;[p[i], p[j]] = [p[j], p[i]]
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255]
}
const h3 = (x, y, z) => PERM[PERM[PERM[x & 255] + (y & 255)] + (z & 255)] / 255
export function noise3(x, y, z) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const zi = Math.floor(z)
  let xf = x - xi
  let yf = y - yi
  let zf = z - zi
  xf = xf * xf * (3 - 2 * xf)
  yf = yf * yf * (3 - 2 * yf)
  zf = zf * zf * (3 - 2 * zf)
  const a = mix(h3(xi, yi, zi), h3(xi + 1, yi, zi), xf)
  const b = mix(h3(xi, yi + 1, zi), h3(xi + 1, yi + 1, zi), xf)
  const c = mix(h3(xi, yi, zi + 1), h3(xi + 1, yi, zi + 1), xf)
  const d = mix(h3(xi, yi + 1, zi + 1), h3(xi + 1, yi + 1, zi + 1), xf)
  return mix(mix(a, b, yf), mix(c, d, yf), zf)
}
export function fbm(x, y, z, oct = 5) {
  let v = 0
  let amp = 0.5
  for (let i = 0; i < oct; i++) {
    v += amp * noise3(x, y, z)
    x *= 2.03
    y *= 2.01
    z *= 1.97
    amp *= 0.5
  }
  return v / (1 - Math.pow(0.5, oct))
}

// ---- SDF primitives ------------------------------------------------------
export const sdSphere = (x, y, z, r) => Math.hypot(x, y, z) - r
export const sdTorus = (x, y, z, R, r) => Math.hypot(Math.hypot(x, z) - R, y) - r
export function sdRoundBox(x, y, z, b, r) {
  const qx = Math.abs(x) - b + r
  const qy = Math.abs(y) - b + r
  const qz = Math.abs(z) - b + r
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r
}
export function smin(a, b, k) {
  const h = clamp(0.5 + (0.5 * (b - a)) / k)
  return mix(b, a, h) - k * h * (1 - h)
}
// IQ 2D heart, roughly spanning x in [-0.6,0.6], y in [-0.6,0.5] after centering.
export function sdHeart2(x, y) {
  y += 0.55
  x = Math.abs(x)
  if (y + x > 1) return Math.hypot(x - 0.25, y - 0.75) - Math.SQRT2 / 4
  const m = 0.5 * Math.max(x + y, 0)
  return Math.sqrt(Math.min(x * x + (y - 1) * (y - 1), (x - m) * (x - m) + (y - m) * (y - m))) * Math.sign(x - y)
}
// Puffy 3D heart: rounded extrusion of the 2D heart.
export function sdHeart3(x, y, z, thick = 0.12, round = 0.18) {
  const dx = sdHeart2(x, y) + round
  const dz = Math.abs(z) - thick
  return Math.min(Math.max(dx, dz), 0) + Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) - round
}

// ---- raymarcher ------------------------------------------------------------
// Camera on -z looking at the origin. `sdf(x,y,z)` -> distance, `shade(hit, out)`
// gets position, normal and view dir and writes rgb into out.
const hit = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, dx: 0, dy: 0, dz: 0 }
export function raymarch(sdf, px, py, out, shade, { dist = 3.4, fov = 0.42, bound = 1.5, steps = 110 } = {}) {
  let dx = px * fov
  let dy = py * fov
  let dz = 1
  const l = Math.hypot(dx, dy, dz)
  dx /= l
  dy /= l
  dz /= l
  const oz = -dist
  // bounding sphere
  const b = oz * dz
  const c = oz * oz - bound * bound
  const disc = b * b - c
  if (disc < 0) return (out[3] = 0)
  let t = Math.max(0, -b - Math.sqrt(disc))
  const tFar = -b + Math.sqrt(disc)
  for (let i = 0; i < steps && t < tFar; i++) {
    const x = dx * t
    const y = dy * t
    const z = oz + dz * t
    const d = sdf(x, y, z)
    if (d < 0.0008) {
      const e = 0.0015
      const a = sdf(x + e, y - e, z - e)
      const bb = sdf(x - e, y - e, z + e)
      const cc = sdf(x - e, y + e, z - e)
      const dd = sdf(x + e, y + e, z + e)
      let nx = a - bb - cc + dd
      let ny = -a - bb + cc + dd
      let nz = -a + bb - cc + dd
      const nl = Math.hypot(nx, ny, nz) || 1
      hit.x = x
      hit.y = y
      hit.z = z
      hit.nx = nx / nl
      hit.ny = ny / nl
      hit.nz = nz / nl
      hit.dx = dx
      hit.dy = dy
      hit.dz = dz
      shade(hit, out)
      out[3] = 1
      return 1
    }
    t += d * 0.8
  }
  return (out[3] = 0)
}

// Studio-ish lighting: key + fill + specular + fresnel rim. Mutates out (base rgb in).
export function light(h, out, { spec = 0.6, shine = 40, rim = 0.35, amb = 0.28, metal = 0 } = {}) {
  const Lx = -0.48
  const Ly = 0.7
  const Lz = -0.53
  const diff = Math.max(0, h.nx * Lx + h.ny * Ly + h.nz * Lz)
  const fill = Math.max(0, -h.nx * 0.6 - h.ny * 0.2 - h.nz * 0.3) * 0.25
  let hx = Lx - h.dx
  let hy = Ly - h.dy
  let hz = Lz - h.dz
  const hl = Math.hypot(hx, hy, hz)
  const sp = Math.pow(Math.max(0, (h.nx * hx + h.ny * hy + h.nz * hz) / hl), shine) * spec
  const fr = Math.pow(clamp(1 + h.nx * h.dx + h.ny * h.dy + h.nz * h.dz), 3) * rim
  const k = amb + 0.85 * diff + fill
  for (let i = 0; i < 3; i++) {
    const base = out[i]
    out[i] = base * k * (1 - metal) + sp * mix(1, base, metal) + fr * mix(0.9, base, 0.5)
  }
  return out
}

// ---- frame rendering ---------------------------------------------------------
// `shader(x, y, out)` with x,y in [-1,1] (y up) writes straight rgba.
// Supersampled SS×SS, averaged with premultiplied alpha. Returns RGBA8 buffer.
export function renderPixels(size, ss, shader) {
  const outBuf = Buffer.alloc(size * size * 4)
  const px = [0, 0, 0, 0, 0, 0, 0, 0] // rgba + optional emissive (strength, rgb)
  const n = ss * ss
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = ((x + (sx + 0.5) / ss) / size) * 2 - 1
          const v = 1 - ((y + (sy + 0.5) / ss) / size) * 2
          px[0] = px[1] = px[2] = 0
          px[3] = 1
          shader(u, v, px)
          const al = clamp(px[3])
          r += clamp(px[0]) * al
          g += clamp(px[1]) * al
          b += clamp(px[2]) * al
          a += al
        }
      }
      const i = (y * size + x) * 4
      if (a > 0) {
        outBuf[i] = Math.round((r / a) * 255)
        outBuf[i + 1] = Math.round((g / a) * 255)
        outBuf[i + 2] = Math.round((b / a) * 255)
      }
      outBuf[i + 3] = Math.round((a / n) * 255)
    }
  }
  return outBuf
}

// Vector canvas for line/triangle art, rendered at size*ss then box-downsampled.
export class Raster {
  constructor(size, ss) {
    this.size = size
    this.ss = ss
    this.W = size * ss
    this.rgba = new Float32Array(this.W * this.W * 4) // premultiplied
    this.depth = new Float32Array(this.W * this.W).fill(Infinity)
  }
  // normalized [-1,1] (y up) -> raster px
  X(x) {
    return (x * 0.5 + 0.5) * this.W
  }
  Y(y) {
    return (0.5 - y * 0.5) * this.W
  }
  // Additive glowing line with soft falloff.
  line(x0, y0, x1, y1, width, r, g, b, glow = 2.5) {
    const W = this.W
    const ax = this.X(x0)
    const ay = this.Y(y0)
    const bx = this.X(x1)
    const by = this.Y(y1)
    const w = width * W * 0.5
    const reach = w * glow
    const minX = Math.max(0, Math.floor(Math.min(ax, bx) - reach))
    const maxX = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + reach))
    const minY = Math.max(0, Math.floor(Math.min(ay, by) - reach))
    const maxY = Math.min(W - 1, Math.ceil(Math.max(ay, by) + reach))
    const vx = bx - ax
    const vy = by - ay
    const vv = vx * vx + vy * vy || 1
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5 - ax
        const py = y + 0.5 - ay
        const h = clamp((px * vx + py * vy) / vv)
        const d = Math.hypot(px - vx * h, py - vy * h)
        if (d > reach) continue
        const core = d < w ? 1 : 0
        const halo = Math.pow(1 - d / reach, 2) * 0.45
        const a = Math.max(core, halo)
        const i = (y * W + x) * 4
        this.rgba[i] = Math.max(this.rgba[i], r * a)
        this.rgba[i + 1] = Math.max(this.rgba[i + 1], g * a)
        this.rgba[i + 2] = Math.max(this.rgba[i + 2], b * a)
        this.rgba[i + 3] = Math.max(this.rgba[i + 3], a)
      }
    }
  }
  // Opaque flat triangle with z-buffer (z: smaller = closer).
  tri(p0, p1, p2, r, g, b) {
    const W = this.W
    const x0 = this.X(p0[0]), y0 = this.Y(p0[1])
    const x1 = this.X(p1[0]), y1 = this.Y(p1[1])
    const x2 = this.X(p2[0]), y2 = this.Y(p2[1])
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
    if (Math.abs(area) < 1e-9) return
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)))
    const maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)))
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)))
    const maxY = Math.min(W - 1, Math.ceil(Math.max(y0, y1, y2)))
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5
        const py = y + 0.5
        const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / area
        const w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / area
        const w2 = 1 - w0 - w1
        if (w0 < 0 || w1 < 0 || w2 < 0) continue
        const z = w0 * p0[2] + w1 * p1[2] + w2 * p2[2]
        const j = y * W + x
        if (z >= this.depth[j]) continue
        this.depth[j] = z
        const i = j * 4
        this.rgba[i] = r
        this.rgba[i + 1] = g
        this.rgba[i + 2] = b
        this.rgba[i + 3] = 1
      }
    }
  }
  toBuffer() {
    const { size, ss, W } = this
    const out = Buffer.alloc(size * size * 4)
    const n = ss * ss
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let r = 0, g = 0, b = 0, a = 0
        for (let sy = 0; sy < ss; sy++) {
          for (let sx = 0; sx < ss; sx++) {
            const i = ((y * ss + sy) * W + x * ss + sx) * 4
            r += this.rgba[i]
            g += this.rgba[i + 1]
            b += this.rgba[i + 2]
            a += this.rgba[i + 3]
          }
        }
        const o = (y * size + x) * 4
        if (a > 0) {
          out[o] = Math.round(clamp(r / a) * 255)
          out[o + 1] = Math.round(clamp(g / a) * 255)
          out[o + 2] = Math.round(clamp(b / a) * 255)
        }
        out[o + 3] = Math.round(clamp(a / n) * 255)
      }
    }
    return out
  }
}

// Rotate a point [x,y,z] by yaw (around y) then pitch (around x).
export function rot(p, yaw, pitch) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw)
  const cx = Math.cos(pitch), sx = Math.sin(pitch)
  const x = p[0] * cy + p[2] * sy
  const z = -p[0] * sy + p[2] * cy
  const y = p[1] * cx - z * sx
  return [x, y, p[1] * sx + z * cx]
}
// Simple perspective projection -> [x, y, depth]
export const project = (p, dist = 3.2, scale = 1.9) => {
  const k = scale / (dist + p[2])
  return [p[0] * k, p[1] * k, p[2]]
}
