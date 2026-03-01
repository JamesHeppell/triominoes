// ── Triominoes service worker ────────────────────────────────────────────────
// Bump CACHE_VERSION after each new deployment to force clients to re-fetch.
const CACHE_VERSION = 'v4';
const CACHE_NAME    = `triominoes-${CACHE_VERSION}`;

const PRECACHE = [
  './index.html',
  './puzzle.html',
  './rules.html',
  './style.css',
  './main.js',
  './puzzle.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

// Pre-cache all assets so the game works offline after the first visit.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

// Delete stale caches from previous versions.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Cache-first: serve from cache when available, fetch and cache otherwise.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ??
        fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
          }
          return response;
        })
    )
  );
});
