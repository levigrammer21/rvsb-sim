// Service Worker - v3 (network-first for app shell)
// This version is designed to STOP the "stuck on old JS" problem.

const VERSION = "v3";                 // <--- bump this any time you want to force refresh
const CACHE_NAME = `rvsb-cache-${VERSION}`;

const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.webmanifest"
];

// Install: cache basic shell, activate immediately
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
});

// Activate: delete old caches, take control immediately
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k.startsWith("rvsb-cache-") && k !== CACHE_NAME) ? caches.delete(k) : Promise.resolve()));
    await self.clients.claim();
  })());
});

// Fetch strategy:
// - Network-first for HTML + app.js (so updates show up immediately)
// - Cache-first for other static files
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin requests
  if (url.origin !== location.origin) return;

  const isHTML = req.mode === "navigate" || url.pathname.endsWith(".html") || url.pathname === "/" || url.pathname.endsWith("/rvsb-sim/");
  const isAppJS = url.pathname.endsWith("/app.js");

  if (isHTML || isAppJS) {
    // Network first
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: "no-store" });
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        const cached = await caches.match(req);
        return cached || new Response("Offline and no cache available.", { status: 503 });
      }
    })());
    return;
  }

  // Everything else: cache-first
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const fresh = await fetch(req);
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, fresh.clone());
      return fresh;
    } catch {
      return new Response("Offline.", { status: 503 });
    }
  })());
});

  // Runtime: PokéAPI GET requests – stale-while-revalidate
  if (url.origin.includes("pokeapi.co") && req.method === "GET") {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(req);
      const fetchPromise = fetch(req).then((res) => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => cached);
      return cached || fetchPromise;
    })());
  }
});
