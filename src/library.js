// The gif library: grid spritesheets (WebP with alpha) produced by scripts/build-sprites.mjs.
const base = './sprites/'
let manifestPromise

export function loadManifest() {
  manifestPromise ??= fetch(`${base}manifest.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`manifest ${r.status}`)
      return r.json()
    })
    .then((m) => ({ ...m, byId: new Map(m.sprites.map((s, i) => [s.id, { ...s, index: i }])) }))
  return manifestPromise
}

export async function loadBitmap(file) {
  const res = await fetch(base + file)
  if (!res.ok) throw new Error(`${file} ${res.status}`)
  return createImageBitmap(await res.blob())
}

// Source rect of frame i inside a sprite's atlas.
export function frameRect(sprite, i) {
  const f = i % sprite.frames
  return [(f % sprite.cols) * sprite.w, Math.floor(f / sprite.cols) * sprite.h, sprite.w, sprite.h]
}

// Animation speed for every gif, and the length of the presenter's frame ring.
export const FPS = 15
export const MAX_RING_FRAMES = 120
