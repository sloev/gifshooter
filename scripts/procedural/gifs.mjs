// Procedural looping gifs. Each entry renders frame t in [0,1) and must loop seamlessly
// (everything time-dependent is periodic in t).
//
//   { name, frames, setup(t) -> shader(x, y, out) }   per-pixel, x,y in [-1,1], y up
//   { name, frames, raster(R, t) }                    line / triangle art on a Raster
import {
  TAU, clamp, mix, smoothstep, fract, palette, hsv, fbm, noise3,
  sdSphere, sdTorus, sdRoundBox, smin, sdHeart2, sdHeart3, raymarch, light, rot, project,
} from './lib.mjs'

const tmp = [0, 0, 0]
const gauss = (t, c, w) => {
  // periodic distance so the pulse loops
  let d = Math.abs(t - c)
  d = Math.min(d, 1 - d)
  return Math.exp(-(d / w) * (d / w))
}
const set = (out, r, g, b, a = 1) => {
  out[0] = r
  out[1] = g
  out[2] = b
  out[3] = a
}

// ---- analytic spheres (planets) ----------------------------------------------
// Calls surf(qx,qy,qz, out) with the rotated surface point; lights it unless the
// surface writes emissive in out[4].
const LX = -0.55, LY = 0.45, LZ = -0.7
function planet(x, y, R, spin, tilt, surf, out, { atmo = null, atmoWidth = 0.1, night = 0.04 } = {}) {
  const r2 = x * x + y * y
  if (r2 > R * R) {
    if (!atmo) return (out[3] = 0)
    const d = (Math.sqrt(r2) - R) / (R * atmoWidth)
    if (d > 1) return (out[3] = 0)
    const lit = clamp(0.3 + ((x * LX + y * LY) / Math.sqrt(r2)) * 0.9)
    set(out, atmo[0], atmo[1], atmo[2], Math.pow(1 - d, 2) * 0.8 * lit)
    return
  }
  const z = -Math.sqrt(R * R - r2)
  const nx = x / R, ny = y / R, nz = z / R
  // tilt around z, then spin around y
  const ct = Math.cos(tilt), st = Math.sin(tilt)
  const tx = nx * ct + ny * st
  const ty = -nx * st + ny * ct
  const cs = Math.cos(spin), ss = Math.sin(spin)
  const qx = tx * cs + nz * ss
  const qz = -tx * ss + nz * cs
  out[4] = 0
  surf(qx, ty, qz, out)
  const diff = clamp(nx * LX + ny * LY + nz * LZ)
  const k = night + (1 - night) * diff
  const e = out[4] || 0
  for (let i = 0; i < 3; i++) out[i] = out[i] * k + (e ? e * out[5 + i] : 0)
  if (atmo) {
    const rim = Math.pow(1 + nz, 3) * clamp(diff + 0.3)
    for (let i = 0; i < 3; i++) out[i] = mix(out[i], atmo[i], rim * 0.7)
  }
  out[3] = 1
}

// ---- hearts / love -------------------------------------------------------------
const hearts = [
  {
    name: 'heart-beat',
    frames: 30,
    setup(t) {
      const s = 1.45 * (1 + 0.12 * gauss(t, 0.1, 0.06) + 0.07 * gauss(t, 0.32, 0.06))
      const yaw = 0.35 * Math.sin(TAU * t)
      const c = Math.cos(yaw), sn = Math.sin(yaw)
      const sdf = (x, y, z) => sdHeart3((x * c + z * sn) / s, y / s, (-x * sn + z * c) / s, 0.1, 0.2) * s
      const shade = (h, o) => {
        set(o, 0.92, 0.05, 0.16)
        light(h, o, { spec: 1, shine: 70, rim: 0.45 })
      }
      return (x, y, out) => raymarch(sdf, x, y, out, shade)
    },
  },
  {
    name: 'heart-spin-holo',
    frames: 60,
    setup(t) {
      const yaw = TAU * t
      const c = Math.cos(yaw), sn = Math.sin(yaw)
      const s = 1.4
      const sdf = (x, y, z) => sdHeart3((x * c + z * sn) / s, y / s, (-x * sn + z * c) / s, 0.16, 0.2) * s
      const shade = (h, o) => {
        const f = 1 + h.nx * h.dx + h.ny * h.dy + h.nz * h.dz
        palette(f * 1.3 + h.y * 0.4 + t, o, [0.6, 0.5, 0.6], [0.4, 0.4, 0.4], [1, 1, 1], [0.0, 0.2, 0.45])
        light(h, o, { spec: 1.2, shine: 50, rim: 0.3, metal: 0.25 })
      }
      return (x, y, out) => raymarch(sdf, x, y, out, shade)
    },
  },
  {
    name: 'heart-neon',
    frames: 45,
    setup(t) {
      const pulse = 0.75 + 0.25 * Math.sin(TAU * t * 3)
      return (x, y, out) => {
        const d = Math.abs(sdHeart2(x * 1.35, y * 1.35 + 0.05) / 1.35)
        const core = smoothstep(0.035, 0.018, d)
        const halo = Math.exp(-d * 12) * 0.85 * pulse
        hsv(t + x * 0.15 - y * 0.15 + 0.9, 0.85, 1, out)
        for (let i = 0; i < 3; i++) out[i] = mix(out[i], 1, core * 0.7)
        out[3] = Math.max(core, halo)
      }
    },
  },
  {
    name: 'hearts-rising',
    frames: 60,
    setup(t) {
      const items = Array.from({ length: 9 }, (_, i) => {
        const ph = fract(t + i / 9)
        return {
          x: 0.55 * Math.sin(TAU * (t + i * 0.37)) * (0.4 + 0.6 * ((i * 7) % 5) / 4) + ((i % 3) - 1) * 0.3,
          y: -1.3 + 2.6 * ph,
          s: 0.22 + 0.12 * ((i * 5) % 3),
          a: Math.min(1, ph * 6, (1 - ph) * 6),
          hue: 0.92 + 0.08 * ((i * 3) % 4) / 3,
        }
      })
      return (x, y, out) => {
        out[3] = 0
        for (const h of items) {
          const d = sdHeart2((x - h.x) / h.s, (y - h.y) / h.s)
          if (d < 0.02) {
            const gx = (x - h.x) / h.s + 0.25
            const gy = (y - h.y) / h.s - 0.15
            const hl = Math.exp(-(gx * gx + gy * gy) * 18)
            hsv(h.hue, 0.75 - hl * 0.6, 0.95, out)
            out[3] = h.a * smoothstep(0.02, -0.02, d)
          }
        }
      }
    },
  },
  {
    name: 'heart-pixel',
    frames: 30,
    setup(t) {
      const s = 1.25 * (1 + 0.14 * gauss(t, 0.15, 0.08) + 0.08 * gauss(t, 0.4, 0.08))
      const N = 8
      return (x, y, out) => {
        const qx = (Math.floor(x * N) + 0.5) / N
        const qy = (Math.floor(y * N) + 0.5) / N
        const d = sdHeart2(qx / s, qy / s)
        if (d > 0) return (out[3] = 0)
        if (d > -0.09) return set(out, 0.35, 0.02, 0.1)
        const hx = qx / s + 0.28, hy = qy / s - 0.18
        if (hx * hx + hy * hy < 0.012) return set(out, 1, 0.85, 0.9)
        set(out, qy > 0.1 * s ? 1 : 0.85, 0.12, 0.3)
      }
    },
  },
  {
    name: 'heart-orbit',
    frames: 60,
    setup(t) {
      const small = Array.from({ length: 6 }, (_, k) => {
        const a = TAU * (t / 6 + k / 6)
        return [Math.cos(a) * 1.05, Math.sin(a) * 0.32, Math.sin(a) * 1.05]
      })
      const big = (x, y, z) => sdHeart3(x / 1.05, y / 1.05, z / 1.05, 0.12, 0.2) * 1.05
      const sm = (x, y, z, c) => sdHeart3((x - c[0]) / 0.3, (y - c[1]) / 0.3, (z - c[2]) / 0.3, 0.12, 0.2) * 0.3
      const sdf = (x, y, z) => {
        let d = big(x, y, z)
        for (const c of small) d = Math.min(d, sm(x, y, z, c))
        return d
      }
      const shade = (h, o) => {
        const isBig = big(h.x, h.y, h.z) < 0.01
        if (isBig) set(o, 0.85, 0.05, 0.25)
        else set(o, 1, 0.55, 0.75)
        light(h, o, { spec: 0.9, shine: 60 })
      }
      return (x, y, out) => raymarch(sdf, x, y, out, shade, { bound: 1.6 })
    },
  },
]

// ---- planets -----------------------------------------------------------------------
const planets = [
  {
    name: 'planet-earth',
    frames: 90,
    setup(t) {
      const spin = TAU * t
      const surf = (x, y, z, o) => {
        const h = fbm(x * 2.2 + 5, y * 2.2, z * 2.2, 5)
        if (Math.abs(y) > 0.86 + (h - 0.5) * 0.2) set(o, 0.95, 0.97, 1)
        else if (h < 0.52) set(o, 0.04, 0.16 + h * 0.3, 0.45 + h * 0.4)
        else if (h < 0.6) set(o, 0.2, 0.5, 0.15)
        else set(o, 0.45, 0.38, 0.2)
        // clouds drift one extra turn per loop
        const ca = TAU * t
        const cx = x * Math.cos(ca) + z * Math.sin(ca)
        const cz = -x * Math.sin(ca) + z * Math.cos(ca)
        const c = smoothstep(0.55, 0.75, fbm(cx * 3 + 11, y * 5, cz * 3, 4))
        for (let i = 0; i < 3; i++) o[i] = mix(o[i], 1, c * 0.85)
      }
      return (x, y, out) => planet(x, y, 0.8, spin, 0.4, surf, out, { atmo: [0.35, 0.6, 1] })
    },
  },
  {
    name: 'planet-ringed',
    frames: 60,
    setup(t) {
      const spin = TAU * t
      const R = 0.5
      // ring plane normal, tilted towards the camera
      const tilt = 0.42
      const nx = Math.sin(-0.35) * Math.cos(tilt), ny = Math.cos(tilt), nz = Math.sin(tilt)
      const surf = (x, y, z, o) => {
        const b = Math.sin(y * 22 + fbm(x * 3, y * 3, z * 3, 3) * 3)
        set(o, 0.85 + b * 0.08, 0.7 + b * 0.1, 0.45 + b * 0.08)
      }
      return (x, y, out) => {
        planet(x, y, R, spin, -0.35, surf, out)
        const zr = -(nx * x + ny * y) / nz
        const rr = Math.hypot(x, y, zr)
        if (rr < 0.68 || rr > 1.05) return
        const zp = x * x + y * y < R * R ? -Math.sqrt(R * R - x * x - y * y) : Infinity
        if (out[3] > 0 && zr > zp) return // ring behind planet
        const band = 0.5 + 0.5 * Math.sin(rr * 60) * Math.sin(rr * 23)
        const gap = rr > 0.86 && rr < 0.89 ? 0.1 : 1
        const a = (0.55 + 0.45 * band) * gap * smoothstep(0.68, 0.72, rr) * smoothstep(1.05, 1.0, rr)
        // shadow of planet on far ring
        const shade = zr > 0 && x * x + y * y < R * R ? 0.35 : 1
        const r = 0.9 * shade, g = 0.8 * shade, b = 0.6 * shade
        if (out[3] > 0) {
          for (let i = 0; i < 3; i++) out[i] = mix(out[i], [r, g, b][i], a)
        } else set(out, r, g, b, a)
      }
    },
  },
  {
    name: 'planet-gas-giant',
    frames: 90,
    setup(t) {
      const spin = TAU * t
      const sx = 0.75, sy = -0.25, sz = -0.6 // storm direction on the surface
      const surf = (x, y, z, o) => {
        const v = y * 7 + 1.4 * fbm(x * 2.5, y * 6, z * 2.5, 4)
        palette(v * 0.18, o, [0.75, 0.55, 0.4], [0.2, 0.18, 0.15], [1, 1, 1], [0, 0.1, 0.2])
        const ds = Math.hypot((x - sx) * 0.8, (y - sy) * 1.8, z - sz)
        const spot = smoothstep(0.22, 0.12, ds)
        o[0] = mix(o[0], 0.75, spot)
        o[1] = mix(o[1], 0.25, spot)
        o[2] = mix(o[2], 0.15, spot)
      }
      return (x, y, out) => planet(x, y, 0.82, spin, 0.1, surf, out, { atmo: [1, 0.85, 0.6], atmoWidth: 0.06 })
    },
  },
  {
    name: 'planet-lava',
    frames: 60,
    setup(t) {
      const spin = TAU * t
      const surf = (x, y, z, o) => {
        const n = fbm(x * 2.6 + 3, y * 2.6, z * 2.6, 5)
        const crack = 1 - smoothstep(0.0, 0.035, Math.abs(n - 0.5))
        set(o, 0.18 + n * 0.1, 0.1, 0.08)
        o[4] = crack * 1.4
        o[5] = 1
        o[6] = 0.45 + crack * 0.3
        o[7] = 0.05
      }
      return (x, y, out) => planet(x, y, 0.8, spin, 0.25, surf, out, { atmo: [1, 0.35, 0.05], atmoWidth: 0.08, night: 0.1 })
    },
  },
  {
    name: 'planet-moon',
    frames: 60,
    setup(t) {
      const spin = TAU * t
      const craters = Array.from({ length: 16 }, (_, i) => {
        const a = i * 2.39996
        const y = 1 - (2 * (i + 0.5)) / 16
        const r = Math.sqrt(1 - y * y)
        return [Math.cos(a) * r, y, Math.sin(a) * r, 0.12 + ((i * 7) % 5) * 0.04]
      })
      const surf = (x, y, z, o) => {
        let v = 0.55 + (fbm(x * 4, y * 4, z * 4, 4) - 0.5) * 0.5
        for (const c of craters) {
          const d = Math.acos(clamp(x * c[0] + y * c[1] + z * c[2], -1, 1)) / c[3]
          if (d < 1.25) v *= d < 1 ? 0.75 + 0.15 * d * d : 1.15
        }
        set(o, v, v, v * 1.02)
      }
      return (x, y, out) => planet(x, y, 0.78, spin, 0.2, surf, out, { night: 0.02 })
    },
  },
  {
    name: 'planet-ice',
    frames: 60,
    setup(t) {
      const spin = TAU * t
      const surf = (x, y, z, o) => {
        const w = fbm(x * 2 + fbm(x * 3, y * 3, z * 3, 3), y * 4, z * 2, 4)
        palette(w * 0.8 + y * 0.2, o, [0.45, 0.6, 0.75], [0.25, 0.25, 0.25], [1, 1, 1], [0.6, 0.7, 0.8])
      }
      return (x, y, out) => planet(x, y, 0.8, spin, -0.3, surf, out, { atmo: [0.6, 0.85, 1], atmoWidth: 0.12 })
    },
  },
  {
    name: 'planet-and-moon',
    frames: 60,
    setup(t) {
      const a = TAU * t
      const mx = Math.cos(a) * 0.82, my = Math.sin(a) * 0.2, mz = Math.sin(a)
      const ms = 1 + mz * 0.25 // a little perspective
      const surfP = (x, y, z, o) => {
        const h = fbm(x * 2.4, y * 2.4, z * 2.4, 4)
        if (h < 0.5) set(o, 0.1, 0.35, 0.7)
        else set(o, 0.25 + h * 0.3, 0.55, 0.3)
      }
      const surfM = (x, y, z, o) => {
        const v = 0.55 + (fbm(x * 5, y * 5, z * 5, 3) - 0.5) * 0.6
        set(o, v, v * 0.97, v * 0.93)
      }
      const m = [0, 0, 0, 0, 0, 0, 0, 0]
      return (x, y, out) => {
        planet(x, y, 0.55, a * 0.5, 0.3, surfP, out, { atmo: [0.4, 0.7, 1], atmoWidth: 0.12 })
        planet((x - mx) / ms, (y - my) / ms, 0.13, a, 0, surfM, m)
        if (m[3] > 0) {
          const behind = mz > 0 && out[3] > 0.99 && x * x + y * y < 0.55 * 0.55
          if (!behind) for (let i = 0; i < 4; i++) out[i] = i < 3 ? mix(out[i], m[i], m[3]) : Math.max(out[3], m[3])
        }
      }
    },
  },
  {
    name: 'planet-sun',
    frames: 45,
    setup(t) {
      const ca = Math.cos(TAU * t), sa = Math.sin(TAU * t)
      return (x, y, out) => {
        const r = Math.hypot(x, y)
        const R = 0.62
        if (r < R) {
          const z = Math.sqrt(R * R - r * r)
          const g = fbm(x * 9 + ca, y * 9 + sa, z * 9, 4)
          const limb = 0.6 + 0.4 * (z / R)
          set(out, 1 * limb, (0.55 + g * 0.4) * limb, (0.1 + g * 0.2) * limb)
          return
        }
        const ang = Math.atan2(y, x)
        const flick = fbm(Math.cos(ang) * 2 + ca * 0.8, Math.sin(ang) * 2 + sa * 0.8, r * 3, 3)
        const glow = Math.pow(clamp(1 - (r - R) / (0.38 * (0.6 + flick))), 2)
        set(out, 1, 0.5 + glow * 0.3, 0.1, glow)
      }
    },
  },
]

// ---- abstract shapes ------------------------------------------------------------------
const shapes = [
  {
    name: 'shape-metaballs',
    frames: 60,
    setup(t) {
      const balls = Array.from({ length: 5 }, (_, i) => [
        0.45 * Math.sin(TAU * (t + i * 0.21) * (i % 2 ? 1 : 2)),
        0.45 * Math.cos(TAU * (t * (1 + (i % 3)) + i * 0.33)),
        0.18 + 0.05 * (i % 3),
      ])
      return (x, y, out) => {
        let f = 0
        for (const b of balls) f += (b[2] * b[2]) / ((x - b[0]) ** 2 + (y - b[1]) ** 2 + 1e-4)
        if (f < 0.8) return (out[3] = 0)
        palette(0.15 * f + 0.3 * y + t, out, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [1, 1, 0.5], [0.8, 0.9, 0.3])
        const edge = smoothstep(0.8, 1.0, f)
        const hl = smoothstep(2.5, 8, f) * 0.35
        for (let i = 0; i < 3; i++) out[i] = mix(out[i], 1, hl)
        out[3] = edge
      }
    },
  },
  {
    name: 'shape-op-rings',
    frames: 40,
    setup(t) {
      return (x, y, out) => {
        const r = Math.hypot(x, y)
        if (r > 0.95) return (out[3] = 0)
        const wob = 0.08 * Math.sin(Math.atan2(y, x) * 3 + TAU * t)
        const v = Math.sin((r + wob) * 42 - TAU * t * 2)
        const k = smoothstep(-0.15, 0.15, v)
        set(out, mix(1, 0.1, k), mix(0.15, 0.95, k), mix(0.7, 0.95, k), smoothstep(0.95, 0.93, r))
      }
    },
  },
  {
    name: 'shape-star',
    frames: 45,
    setup(t) {
      const rotA = (TAU * t) / 5
      return (x, y, out) => {
        const a = Math.atan2(y, x) + rotA
        const r = Math.hypot(x, y)
        // 5-point star radius as a function of angle
        const k = Math.abs(fract((a / TAU) * 5 + 0.25) - 0.5) * 2
        const edge = mix(0.42, 0.95, Math.pow(k, 1.6))
        if (r > edge) return (out[3] = 0)
        hsv(r * 1.2 - t + 0.1, 0.8, 1, out)
        const rings = 0.5 + 0.5 * Math.sin(r * 30 - TAU * t * 3)
        for (let i = 0; i < 3; i++) out[i] *= 0.65 + 0.35 * rings
        out[3] = smoothstep(edge, edge - 0.02, r)
      }
    },
  },
  {
    name: 'shape-spiral',
    frames: 45,
    setup(t) {
      return (x, y, out) => {
        const r = Math.hypot(x, y)
        if (r > 0.96) return (out[3] = 0)
        const a = Math.atan2(y, x)
        const v = fract(((a / TAU) * 3 + Math.log(r + 1e-3) * 1.6 - t * 3))
        hsv(v * 0.3 + 0.75, 0.9, v < 0.5 ? 1 : 0.15, out)
        out[3] = smoothstep(0.96, 0.93, r)
      }
    },
  },
  {
    name: 'shape-squares',
    frames: 60,
    setup(t) {
      return (x, y, out) => {
        out[3] = 0
        for (let i = 0; i < 8; i++) {
          const s = 0.95 - i * 0.11
          const a = TAU * t * (i % 2 ? 0.25 : -0.25) + i * 0.2
          const c = Math.cos(a), sn = Math.sin(a)
          const u = Math.abs(x * c - y * sn), v = Math.abs(x * sn + y * c)
          if (Math.max(u, v) < s) {
            hsv(i * 0.09 + t, 0.75, 1 - i * 0.05, out)
            out[3] = 1
          }
        }
      }
    },
  },
]

// ---- early 3D ------------------------------------------------------------------------
const cubeV = [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => [x, y, z])))
const cubeE = []
for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
  const d = cubeV[i].reduce((n, v, k) => n + (v !== cubeV[j][k] ? 1 : 0), 0)
  if (d === 1) cubeE.push([i, j])
}
const PHI = (1 + Math.sqrt(5)) / 2
const icoV = [
  [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
  [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
  [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
].map((v) => v.map((c) => c / Math.hypot(...v)))
const icoF = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
]
function torusMesh(R, r, nu, nv) {
  const v = []
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const u = (TAU * i) / nu, w = (TAU * j) / nv
    v.push([(R + r * Math.cos(w)) * Math.cos(u), r * Math.sin(w), (R + r * Math.cos(w)) * Math.sin(u)])
  }
  const id = (i, j) => (i % nu) * nv + (j % nv)
  return { v, id }
}

const early = [
  {
    name: 'retro-wire-cube',
    frames: 60,
    raster(R, t) {
      const yaw = TAU * t, pitch = 0.45 + 0.2 * Math.sin(TAU * t)
      const P = cubeV.map((p) => project(rot(p.map((c) => c * 0.62), yaw, pitch), 3.2, 2.2))
      for (const [a, b] of cubeE) R.line(P[a][0], P[a][1], P[b][0], P[b][1], 0.022, 0.3, 1, 0.4)
      for (const p of P) R.line(p[0], p[1], p[0], p[1], 0.05, 0.8, 1, 0.8, 1.5)
    },
  },
  {
    name: 'retro-ico-flat',
    frames: 60,
    raster(R, t) {
      const yaw = TAU * t, pitch = 0.5 * Math.sin(TAU * t)
      const V = icoV.map((p) => rot(p.map((c) => c * 0.82), yaw, pitch))
      const pal = [[0.1, 0.05, 0.3], [0.35, 0.1, 0.6], [0.8, 0.2, 0.7], [1, 0.55, 0.8], [1, 0.95, 0.85]]
      for (const f of icoF) {
        const [a, b, c] = f.map((i) => V[i])
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
        const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
        const l = Math.hypot(nx, ny, nz)
        nx /= l; ny /= l; nz /= l
        const k = clamp(0.15 + 0.85 * Math.max(0, -0.5 * nx + 0.6 * ny - 0.62 * nz))
        const col = pal[Math.min(4, Math.floor(k * 5))]
        R.tri(...[a, b, c].map((p) => project(p, 3.2, 2.2)), ...col)
      }
    },
  },
  {
    name: 'retro-boing-ball',
    frames: 40,
    setup(t) {
      const by = -0.5 + 0.95 * Math.abs(Math.sin(Math.PI * t))
      const spin = (TAU * t) / 4
      const Rb = 0.42
      return (x, y, out) => {
        // shadow
        const sx = (x - 0.12) / 0.5, sy = (y + 0.9) / 0.1
        const sh = sx * sx + sy * sy < 1 ? 0.35 * (0.6 + 0.4 * (1 - Math.abs(Math.sin(Math.PI * t)))) : 0
        const dx = x, dy = y - by
        const r2 = dx * dx + dy * dy
        if (r2 > Rb * Rb) return set(out, 0, 0, 0, sh)
        const z = -Math.sqrt(Rb * Rb - r2)
        let nx = dx / Rb, ny = dy / Rb, nz = z / Rb
        const tl = 0.35
        const tx = nx * Math.cos(tl) + ny * Math.sin(tl)
        const ty = -nx * Math.sin(tl) + ny * Math.cos(tl)
        const lon = Math.atan2(nz, tx) + spin
        const lat = Math.asin(clamp(ty, -1, 1))
        const c = (Math.floor((lon / TAU) * 16) + Math.floor((lat / Math.PI) * 8)) & 1
        const diff = 0.35 + 0.65 * clamp(-0.5 * nx + 0.6 * ny - 0.6 * nz)
        set(out, diff, c ? 0.05 * diff : diff, c ? 0.05 * diff : diff)
      }
    },
  },
  {
    name: 'retro-wire-torus',
    frames: 60,
    raster(R, t) {
      const nu = 18, nv = 9
      const { v, id } = torusMesh(0.62, 0.26, nu, nv)
      const yaw = (TAU * t) / nu * 2, pitch = 1.0
      const P = v.map((p) => project(rot(p, yaw + TAU * t * 0, pitch + 0.25 * Math.sin(TAU * t)), 3.2, 2.2))
      for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
        const a = P[id(i, j)], b = P[id(i + 1, j)], c = P[id(i, j + 1)]
        const depth = clamp(0.5 - a[2])
        R.line(a[0], a[1], b[0], b[1], 0.012, 0.2 + depth * 0.6, 0.9, 1, 2)
        R.line(a[0], a[1], c[0], c[1], 0.012, 0.9, 0.3 + depth * 0.4, 1, 2)
      }
    },
  },
  {
    name: 'retro-chrome-ball',
    frames: 45,
    setup(t) {
      const off = 2 * t
      const R = 0.8
      return (x, y, out) => {
        const r2 = x * x + y * y
        if (r2 > R * R) return (out[3] = 0)
        const nz = -Math.sqrt(R * R - r2) / R
        const nx = x / R, ny = y / R
        // reflect view (0,0,1) about n
        const d = 2 * nz
        const rx = -d * nx, ry = -d * ny, rz = 1 - d * nz
        if (ry < -0.05) {
          const k = -1.2 / ry
          const u = rx * k + off, w = rz * k
          const c = (Math.floor(u) + Math.floor(w)) & 1
          const fog = clamp(1 / (k * 0.25))
          set(out, mix(0.5, c ? 1 : 0.1, fog), mix(0.4, c ? 0.2 : 0.1, fog), mix(0.6, c ? 0.8 : 0.3, fog))
        } else {
          const h = clamp(ry)
          set(out, mix(1, 0.2, h), mix(0.6, 0.3, h), mix(0.4, 0.9, h))
          if (ry < 0.05) set(out, 1, 0.95, 0.8)
        }
        const sp = Math.pow(clamp(-0.4 * nx + 0.6 * ny - 0.7 * nz), 60)
        for (let i = 0; i < 3; i++) out[i] = mix(out[i] * 0.9, 1, sp)
      }
    },
  },
  {
    name: 'retro-lowpoly-donut',
    frames: 60,
    raster(R, t) {
      const nu = 14, nv = 7
      const { v, id } = torusMesh(0.6, 0.28, nu, nv)
      const V = v.map((p) => rot(p, TAU * t, 0.9 + 0.3 * Math.sin(TAU * t)))
      const pal = [[0.05, 0.2, 0.3], [0.0, 0.45, 0.55], [0.1, 0.75, 0.7], [0.6, 0.95, 0.75], [1, 1, 0.8]]
      for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
        const q = [V[id(i, j)], V[id(i + 1, j)], V[id(i + 1, j + 1)], V[id(i, j + 1)]]
        for (const [a, b, c] of [[q[0], q[1], q[2]], [q[0], q[2], q[3]]]) {
          const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
          const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
          let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
          const l = Math.hypot(nx, ny, nz) || 1
          const k = Math.abs(-0.5 * nx + 0.6 * ny - 0.62 * nz) / l
          R.tri(project(a, 3.2, 2.3), project(b, 3.2, 2.3), project(c, 3.2, 2.3), ...pal[Math.min(4, Math.floor(k * 5))])
        }
      }
    },
  },
]

// ---- blender-ish abstract color ------------------------------------------------------------
const blender = [
  {
    name: 'blend-iridescent-blob',
    frames: 60,
    setup(t) {
      const a = TAU * t
      const sdf = (x, y, z) =>
        sdSphere(x, y, z, 0.95) +
        0.11 * Math.sin(3.1 * x + a) * Math.sin(2.7 * y + a * 2) * Math.sin(3.3 * z - a) +
        0.05 * Math.sin(7 * y - a * 3)
      const shade = (h, o) => {
        const f = 1 + h.nx * h.dx + h.ny * h.dy + h.nz * h.dz
        palette(f * 1.6 + h.ny * 0.3 + t, o, [0.55, 0.5, 0.6], [0.45, 0.45, 0.4], [1, 1, 1], [0.0, 0.33, 0.67])
        light(h, o, { spec: 1.1, shine: 45, rim: 0.2, metal: 0.2 })
      }
      return (x, y, out) => raymarch((x2, y2, z2) => sdf(x2, y2, z2) * 0.7, x, y, out, shade, { bound: 1.25, steps: 140 })
    },
  },
  {
    name: 'blend-twisted-ring',
    frames: 60,
    setup(t) {
      const a = TAU * t
      const tilt = 1.0
      const ct = Math.cos(tilt), st = Math.sin(tilt)
      const sdf = (x, y0, z0) => {
        const y = y0 * ct - z0 * st
        const z = y0 * st + z0 * ct
        const ang = Math.atan2(z, x)
        const q = Math.hypot(x, z) - 0.72
        const tw = ang * 1.5 + a / 2 // square section: quarter-symmetric, loops after a/2*... -> 2 per loop
        const c = Math.cos(tw), s = Math.sin(tw)
        const u = q * c - y * s, v = q * s + y * c
        const du = Math.abs(u) - 0.17, dv = Math.abs(v) - 0.17
        return (Math.hypot(Math.max(du, 0), Math.max(dv, 0)) + Math.min(Math.max(du, dv), 0) - 0.05) * 0.7
      }
      const shade = (h, o) => {
        set(o, 0.5 + 0.5 * h.nx, 0.5 + 0.5 * h.ny, 0.5 - 0.5 * h.nz)
        light(h, o, { spec: 0.8, shine: 40, amb: 0.45 })
      }
      return (x, y, out) => raymarch(sdf, x, y, out, shade, { bound: 1.2, steps: 140 })
    },
  },
  {
    name: 'blend-candy-donut',
    frames: 60,
    setup(t) {
      // Tilted towards the camera with a gentle wobble; the colours flow around the ring.
      const tilt = 1.05 + 0.15 * Math.sin(TAU * t)
      const yaw = 0.35 * Math.sin(TAU * t)
      const ct = Math.cos(tilt), st = Math.sin(tilt), cy = Math.cos(yaw), sy = Math.sin(yaw)
      const local = (x0, y0, z0, o) => {
        const x = x0 * cy + z0 * sy
        const z = -x0 * sy + z0 * cy
        o[0] = x
        o[1] = y0 * ct - z * st
        o[2] = y0 * st + z * ct
      }
      const q = [0, 0, 0]
      const sdf = (x0, y0, z0) => {
        local(x0, y0, z0, q)
        return sdTorus(q[0], q[1], q[2], 0.6, 0.3) + 0.015 * Math.sin(Math.atan2(q[2], q[0]) * 12)
      }
      const shade = (h, o) => {
        local(h.x, h.y, h.z, q)
        const ang = Math.atan2(q[2], q[0])
        palette(ang / TAU + t + 0.2 * q[1], o, [0.85, 0.65, 0.75], [0.15, 0.3, 0.2], [1, 1, 1], [0, 0.15, 0.4])
        light(h, o, { spec: 0.9, shine: 30, rim: 0.3, amb: 0.4 })
      }
      return (x, y, out) => raymarch(sdf, x, y, out, shade, { bound: 1.0 })
    },
  },
  {
    name: 'blend-orbit-metaballs',
    frames: 60,
    setup(t) {
      const cs = [
        [1, 0.3, 0.6],
        [0.2, 0.85, 1],
        [1, 0.85, 0.2],
      ]
      const P = cs.map((_, i) => {
        const a = TAU * (t + i / 3)
        return [Math.cos(a) * 0.55, Math.sin(a * 2) * 0.25, Math.sin(a) * 0.55]
      })
      const ds = (x, y, z, i) => sdSphere(x - P[i][0], y - P[i][1], z - P[i][2], 0.42)
      const sdf = (x, y, z) => smin(smin(ds(x, y, z, 0), ds(x, y, z, 1), 0.35), ds(x, y, z, 2), 0.35)
      const shade = (h, o) => {
        let wsum = 0
        o[0] = o[1] = o[2] = 0
        for (let i = 0; i < 3; i++) {
          const w = Math.exp(-ds(h.x, h.y, h.z, i) * 12)
          wsum += w
          for (let k = 0; k < 3; k++) o[k] += cs[i][k] * w
        }
        for (let k = 0; k < 3; k++) o[k] /= wsum
        light(h, o, { spec: 1, shine: 60, rim: 0.3 })
      }
      return (x, y, out) => raymarch(sdf, x, y, out, shade, { bound: 1.3 })
    },
  },
  {
    name: 'blend-morph-cube',
    frames: 60,
    setup(t) {
      const m = 0.5 - 0.5 * Math.cos(TAU * t)
      const yaw = (TAU * t) / 4, pitch = 0.6
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch)
      const sdf = (x0, y0, z0) => {
        const x = x0 * cy + z0 * sy
        const z1 = -x0 * sy + z0 * cy
        const y = y0 * cp - z1 * sp
        const z = y0 * sp + z1 * cp
        return mix(sdRoundBox(x, y, z, 0.62, 0.08), sdSphere(x, y, z, 0.8), m)
      }
      const shade = (h, o) => {
        palette(h.y * 0.6 + t + h.nx * 0.2, o, [0.5, 0.5, 0.6], [0.5, 0.4, 0.4], [1, 1, 1], [0.7, 0.4, 0.1])
        light(h, o, { spec: 1.1, shine: 55, rim: 0.4, metal: 0.3 })
      }
      return (x, y, out) => raymarch(sdf, x, y, out, shade, { bound: 1.25 })
    },
  },
  {
    name: 'blend-gyroid-ball',
    frames: 60,
    setup(t) {
      const yaw = TAU * t
      const c = Math.cos(yaw), s = Math.sin(yaw)
      const sdf = (x0, y, z0) => {
        const x = x0 * c + z0 * s
        const z = -x0 * s + z0 * c
        const k = 5
        const g = Math.sin(x * k) * Math.cos(y * k) + Math.sin(y * k) * Math.cos(z * k) + Math.sin(z * k) * Math.cos(x * k)
        return Math.max(sdSphere(x, y, z, 0.92), Math.abs(g) / (k * 1.7) - 0.035)
      }
      const shade = (h, o) => {
        const r = Math.hypot(h.x, h.y, h.z)
        palette(r * 1.1 + t, o, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [1, 0.8, 0.6], [0.2, 0.5, 0.8])
        light(h, o, { spec: 0.7, shine: 30, amb: 0.35 })
      }
      return (x, y, out) => raymarch((a, b, d) => sdf(a, b, d) * 0.8, x, y, out, shade, { bound: 1.0, steps: 160 })
    },
  },
]

export const GIFS = [...hearts, ...planets, ...shapes, ...early, ...blender]
