// Converts the source gif library into compact grid spritesheets (WebP with alpha)
// plus a manifest the app loads at runtime.
//
//   assets-src/sprites/<name>.<frames>.png  horizontal frame strips
//   assets-src/gifs/<name>.gif              animated gifs
//
// Output: public/sprites/<id>.webp + public/sprites/manifest.json
//
// Every gif is capped at MAX_FRAMES (evenly subsampled) and MAX_SIDE px per frame,
// and frames are packed into a roughly square grid so the atlas stays well below
// browser/GPU texture limits (the old 1-row strips were up to 70k px wide).
import sharp from 'sharp'
import { readdir, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const MAX_FRAMES = 120
const MAX_SIDE = 192
const THUMB = 72
const THUMB_FRAMES = 12
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const OUT = path.join(ROOT, 'public/sprites')

sharp.cache(false)

const pickFrames = (count) => {
  const n = Math.min(count, MAX_FRAMES)
  return Array.from({ length: n }, (_, i) => Math.floor((i * count) / n))
}

async function framesFromStrip(file, count) {
  const img = sharp(file, { limitInputPixels: false })
  const { width, height } = await img.metadata()
  const fw = Math.floor(width / count)
  const raw = await img.ensureAlpha().raw().toBuffer()
  return { fw, fh: height, count, raw, stride: width }
}

async function framesFromGif(file) {
  const meta = await sharp(file, { animated: true }).metadata()
  const count = meta.pages || 1
  const fh = meta.pageHeight || meta.height
  const fw = meta.width
  // Animated gifs decode as a vertical strip of pages.
  const raw = await sharp(file, { animated: true }).ensureAlpha().raw().toBuffer()
  return { fw, fh, count, raw, stride: fw, vertical: true }
}

function extractFrame(src, index) {
  const { fw, fh, raw, stride, vertical } = src
  const out = Buffer.alloc(fw * fh * 4)
  const x0 = vertical ? 0 : index * fw
  const y0 = vertical ? index * fh : 0
  for (let y = 0; y < fh; y++) {
    const from = ((y0 + y) * stride + x0) * 4
    raw.copy(out, y * fw * 4, from, from + fw * 4)
  }
  return out
}

// Union bounding box of visible pixels over the given frames, so padding is trimmed
// consistently and the animation doesn't jitter.
function visibleBox(frames, fw, fh) {
  let x0 = fw, y0 = fh, x1 = -1, y1 = -1
  for (const f of frames) {
    for (let y = 0; y < fh; y++) {
      for (let x = 0; x < fw; x++) {
        if (f[(y * fw + x) * 4 + 3] > 8) {
          if (x < x0) x0 = x
          if (x > x1) x1 = x
          if (y < y0) y0 = y
          if (y > y1) y1 = y
        }
      }
    }
  }
  if (x1 < 0) return { left: 0, top: 0, width: fw, height: fh }
  return { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }
}

async function buildAtlas(id, src) {
  const indices = pickFrames(src.count)
  const frames = indices.map((i) => extractFrame(src, i))
  const box = visibleBox(frames, src.fw, src.fh)
  const scale = Math.min(1, MAX_SIDE / Math.max(box.width, box.height))
  const w = Math.max(1, Math.round(box.width * scale))
  const h = Math.max(1, Math.round(box.height * scale))
  const n = indices.length
  const cols = Math.max(1, Math.min(n, Math.round(Math.sqrt((n * h) / w))))
  const rows = Math.ceil(n / cols)

  const tiles = await Promise.all(
    frames.map(async (frame, i) => ({
      input: await sharp(frame, { raw: { width: src.fw, height: src.fh, channels: 4 } })
        .extract(box)
        .resize(w, h, { kernel: 'lanczos3' })
        .png()
        .toBuffer(),
      left: (i % cols) * w,
      top: Math.floor(i / cols) * h,
    })),
  )

  const file = `${id}.webp`
  await sharp({ create: { width: cols * w, height: rows * h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(tiles)
    .webp({ quality: 82, alphaQuality: 90, effort: 6, smartSubsample: true })
    .toFile(path.join(OUT, file))

  // A short, evenly subsampled loop for the animated picker thumbnails.
  const thumb = await Promise.all(
    Array.from({ length: THUMB_FRAMES }, (_, i) =>
      sharp(frames[Math.floor((i * n) / THUMB_FRAMES)], { raw: { width: src.fw, height: src.fh, channels: 4 } })
        .extract(box)
        .resize(THUMB, THUMB, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer(),
    ),
  )

  return { sprite: { id, file, frames: n, w, h, cols }, thumb }
}

// One row per sprite, one column per thumbnail frame.
async function buildThumbs(thumbs) {
  await sharp({
    create: { width: THUMB_FRAMES * THUMB, height: thumbs.length * THUMB, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    limitInputPixels: false,
  })
    .composite(thumbs.flatMap((row, r) => row.map((input, c) => ({ input, left: c * THUMB, top: r * THUMB }))))
    .webp({ quality: 78, alphaQuality: 85, effort: 6 })
    .toFile(path.join(OUT, 'thumbs.webp'))
  return { file: 'thumbs.webp', size: THUMB, frames: THUMB_FRAMES }
}

async function main() {
  await rm(OUT, { recursive: true, force: true })
  await mkdir(OUT, { recursive: true })
  const built = []

  // Frame strips: the original library plus the procedural ones (scripts/generate-gifs.mjs).
  for (const [dir, prefix] of [['assets-src/sprites', 's'], ['assets-src/generated', 'p-']]) {
    const stripDir = path.join(ROOT, dir)
    for (const name of (await readdir(stripDir)).sort()) {
      const m = name.match(/^(.+)\.(\d+)\.png$/)
      if (!m) continue
      const id = prefix === 's' ? `s${m[1]}-${m[2]}` : `${prefix}${m[1]}`
      built.push(await buildAtlas(id, await framesFromStrip(path.join(stripDir, name), Number(m[2]))))
      console.log('strip', name)
    }
  }

  const gifDir = path.join(ROOT, 'assets-src/gifs')
  for (const name of (await readdir(gifDir)).sort()) {
    if (!name.endsWith('.gif')) continue
    const src = await framesFromGif(path.join(gifDir, name))
    if (src.count < 2) continue
    const id = `g${path.basename(name, '.gif').replace(/[^a-z0-9]+/gi, '-')}`
    built.push(await buildAtlas(id, src))
    console.log('gif  ', name)
  }

  const sprites = built.map((b) => b.sprite)
  const thumbs = await buildThumbs(built.map((b) => b.thumb))
  await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify({ thumbs, sprites }))
  console.log(`${sprites.length} sprites, max frames ${Math.max(...sprites.map((s) => s.frames))}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
