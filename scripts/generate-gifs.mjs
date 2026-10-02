// Renders the procedural gif library (scripts/procedural/gifs.mjs) into lossless frame
// grids at assets-src/generated/<name>.<frames>.<cols>.webp, in parallel worker threads.
// Then run `npm run build:sprites` to pack them with the rest of the library.
//
//   node scripts/generate-gifs.mjs [name-filter]
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { availableParallelism } from 'node:os'
import { mkdir, readdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { GIFS } from './procedural/gifs.mjs'
import { Raster, renderPixels } from './procedural/lib.mjs'

const SIZE = 160
const SS = 2
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const OUT = path.join(ROOT, 'assets-src/generated')

async function render(gif) {
  // Trimmed later by build-sprites; here just a near-square grid of SIZE×SIZE frames.
  const cols = Math.ceil(Math.sqrt(gif.frames))
  const rows = Math.ceil(gif.frames / cols)
  const W = cols * SIZE
  const grid = Buffer.alloc(W * rows * SIZE * 4)
  for (let f = 0; f < gif.frames; f++) {
    const t = f / gif.frames
    let frame
    if (gif.raster) {
      const R = new Raster(SIZE, SS + 1)
      gif.raster(R, t)
      frame = R.toBuffer()
    } else {
      frame = renderPixels(SIZE, SS, gif.setup(t))
    }
    const gx = (f % cols) * SIZE
    const gy = Math.floor(f / cols) * SIZE
    for (let y = 0; y < SIZE; y++) frame.copy(grid, ((gy + y) * W + gx) * 4, y * SIZE * 4, (y + 1) * SIZE * 4)
  }
  // replace any earlier render of this gif (frame count / grid may have changed)
  for (const old of await readdir(OUT)) if (old.startsWith(`${gif.name}.`)) await unlink(path.join(OUT, old))
  await sharp(grid, { raw: { width: W, height: rows * SIZE, channels: 4 } })
    .webp({ lossless: true, effort: 6, exact: true })
    .toFile(path.join(OUT, `${gif.name}.${gif.frames}.${cols}.webp`))
}

if (isMainThread) {
  const filter = process.argv[2]
  const todo = GIFS.map((g, i) => [g, i]).filter(([g]) => !filter || g.name.includes(filter))
  await mkdir(OUT, { recursive: true })
  const queue = todo.map(([, i]) => i)
  const workers = Math.min(availableParallelism(), queue.length)
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (queue.length) {
        const index = queue.shift()
        const started = Date.now()
        await new Promise((resolve, reject) => {
          const w = new Worker(new URL(import.meta.url), { workerData: index })
          w.once('message', resolve)
          w.once('error', reject)
        })
        console.log(`${GIFS[index].name} ${((Date.now() - started) / 1000).toFixed(1)}s`)
      }
    }),
  )
} else {
  await render(GIFS[workerData])
  parentPort.postMessage('done')
}
