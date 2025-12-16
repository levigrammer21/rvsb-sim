// Simple Service Worker (offline-friendly app shell + runtime cache for PokéAPI)
const APP_CACHE = "rvsb-app-v1";
const RUNTIME_CACHE = "rvsb-runtime-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) => cache.addAll([
      "./",
      "./index.html",
      "./app.js",
      "./manifest.webmanifest",
      "./icons/icon-192.png",
      "./icons/icon-512.png"
    ]))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => (k !== APP_CACHE && k !== RUNTIME_CACHE) ? caches.delete(k) : null))
    )
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // App shell: cache-first
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req))
    );
    return;
  }

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
