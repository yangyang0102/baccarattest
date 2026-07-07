const CACHE_NAME = "monster-baccarat-v1.47";
const ASSETS = [
  "./",
  "./index.html",
  "./app.js?ver=1.47",
  "./favicon.ico",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async ()=>{
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async ()=>{
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k===CACHE_NAME)? null : caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  event.respondWith((async ()=>{
    const req = event.request;

    // Network-first for HTML navigations to avoid stale UI (v1.45)
    const accept = req.headers.get("accept") || "";
    if (req.mode === "navigate" || accept.includes("text/html")){
      try{
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone());
        return fresh;
      }catch{
        const cached = await caches.match(req);
        return cached || caches.match("./index.html");
      }
    }

    // Default: cache-first for static assets
    const cached = await caches.match(req);
    if (cached) return cached;
    try{
      const res = await fetch(req);
      return res;
    }catch{
      return caches.match("./index.html");
    }
  })());
});
