// LeetVault service worker. vite.config.js fills in VERSION and PRECACHE at build time, so every deploy
// produces a different sw.js; the browser sees the change and the page switches over (see src/pwa.js).
// Only the app's own files are cached. Supabase and LeetCode requests always go to the network.
const VERSION = __VERSION__
const PRECACHE = __PRECACHE__
const CACHE = `leetvault-${VERSION}`

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key)
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin) return
  const cached = caches.open(CACHE).then((cache) => cache.match(req.mode === 'navigate' ? '/index.html' : req))
  event.respondWith(cached.then((hit) => hit || fetch(req)))
})
