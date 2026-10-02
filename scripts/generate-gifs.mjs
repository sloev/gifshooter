// Renders the procedural gif library (scripts/procedural/gifs.mjs) into frame strips
// at assets-src/generated/<name>.<frames>.png, in parallel worker threads.
// Then run `npm run build:sprites` to pack them with the rest of the library.
//
//   node scripts/generate-gifs.mjs [name-filter]
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { availableParallelism } from 'node:os'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { GIFS } from './procedural/gifs.mjs'
import { Raster, renderPixels } from './procedural/lib.mjs'

const SIZE = 160
const SS = 2
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const OUT = path.join(ROOT, 'assets-src/generated')

async function render(gif) {
  const strip = Buffer.alloc(SIZE * SIZE * 4 * gif.frames)
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
    // place frame f in a horizontal strip
    for (let y = 0; y < SIZE; y++) frame.copy(strip, (y * SIZE * gif.frames + f * SIZE) * 4, y * SIZE * 4, (y + 1) * SIZE * 4)
  }
  await sharp(strip, { raw: { width: SIZE * gif.frames, height: SIZE, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT, `${gif.name}.${gif.frames}.png`))
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
