import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

// Emits sw.js with the build's app-shell files precached. Spritesheets are left out
// (they're cached on first use) except the manifest and the picker thumbnails.
function serviceWorker() {
  const publicFiles = (dir, base = '') =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name)
      const rel = base ? `${base}/${name}` : name
      return statSync(full).isDirectory() ? publicFiles(full, rel) : [rel]
    })
  return {
    name: 'gifshooter-sw',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = [
        './',
        ...Object.keys(bundle),
        ...publicFiles('public').filter((f) => !f.startsWith('sprites/') || /manifest\.json$|thumbs\.webp$/.test(f)),
      ]
      const hash = createHash('sha256')
      for (const [name, chunk] of Object.entries(bundle)) hash.update(name).update(chunk.code ?? chunk.source ?? '')
      hash.update(readFileSync('public/sprites/manifest.json'))
      const version = hash.digest('hex').slice(0, 12)
      const source = readFileSync('src/sw-template.js', 'utf8')
        .replace('__VERSION__', version)
        .replace('__PRECACHE__', JSON.stringify(files, null, 2))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

// Relative base so the build works from any GitHub Pages path; output to docs/ for Pages.
export default {
  base: './',
  plugins: [serviceWorker()],
  build: {
    outDir: 'docs',
    emptyOutDir: true,
  },
}
