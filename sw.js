const CACHE_NAME = "hydration-compliance-shell-v2";
const ASSETS = [
  "./",
  "./index.html",
  "./fabric-runtime.js",
  "./tide-worker.js",
  "./verify.html",
  "./attestation-verify.js",
  "./chain-config.js",
  "./chain-anchor.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
      await self.clients.claim();
      const clients = await self.clients.matchAll({ type: "window" });
      clients.forEach((client) => {
        client.postMessage({
          type: "service-worker.ready",
          cache: CACHE_NAME,
        });
      });
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request, { ignoreSearch: true });

      try {
        const response = await fetch(request);
        if (response && response.ok) {
          cache.put(request, response.clone());
        }
        return response;
      } catch (error) {
        if (cached) return cached;
        throw error;
      }
    })()
  );
});

self.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "cache-status") return;
  event.source.postMessage({
    type: "service-worker.status",
    assetCount: ASSETS.length,
  });
});
