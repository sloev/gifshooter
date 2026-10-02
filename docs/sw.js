// Service worker template. vite.config.js fills in the build hash and the list of
// app-shell files to precache, and emits the result as sw.js.
const VERSION = 'ef54a5bbf690'
const PRECACHE = [
  "./",
  "assets/index-ckM_wHhX.js",
  "assets/net-AyOqgJti.js",
  "assets/paint-DfxlpMZz.js",
  "assets/present-BRP9Muws.js",
  "assets/index-Dp4r-10f.css",
  "favicon.png",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
  "logo.webp",
  "manifest.webmanifest",
  "sprites/manifest.json",
  "sprites/thumbs.webp"
]
const SHELL = `gifshooter-shell-${VERSION}`
const SPRITES = `gifshooter-sprites-${VERSION}`

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== SPRITES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

const fromCacheOrNetwork = async (request, cacheName) => {
  const cached = await caches.match(request, { ignoreSearch: true })
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) {
    const cache = await caches.open(cacheName)
    cache.put(request, response.clone())
  }
  return response
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== location.origin) return

  // Pages: network first so a new deploy shows up, the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(new URL('./', location.href).href).then((r) => r || caches.match('index.html'))),
    )
    return
  }
  // Spritesheets are big, so they're cached the first time they're used.
  if (url.pathname.includes('/sprites/')) {
    event.respondWith(fromCacheOrNetwork(request, SPRITES))
    return
  }
  event.respondWith(fromCacheOrNetwork(request, SHELL))
})
