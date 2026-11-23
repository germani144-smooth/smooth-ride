// Smooth Ride service worker. Cache-first, own scope and own caches only.
// VERSION must match js/version.js and package.json (checked by unit tests).
const VERSION = "0.3.0";
const PREFIX = "smooth-ride-";
const CACHE = PREFIX + VERSION;

// Every file the app needs offline. A unit test checks each exists and that every app
// file in the repo is listed here.
const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/app.css",
  "./js/app.js",
  "./js/version.js",
  "./js/core/escape.js",
  "./js/core/storage.js",
  "./js/core/backup.js",
  "./js/core/update.js",
  "./js/core/geo.js",
  "./js/core/gpx.js",
  "./js/core/analysis.js",
  "./js/core/drives.js",
  "./js/core/format.js",
  "./js/db.js",
  "./js/live.js",
  "./js/drives.js",
  "./js/core/swipe.js",
  "./js/swipe.js",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  // Fetch every file fresh (bypass HTTP cache and CDN with ?v= and cache:'reload').
  // If any file fails, the whole install fails and the old version stays in charge.
  event.waitUntil(
    (async () => {
      const responses = await Promise.all(
        PRECACHE.map(async (path) => {
          const url = new URL(path, self.registration.scope);
          const busted = new URL(url);
          busted.searchParams.set("v", VERSION);
          const res = await fetch(new Request(busted, { cache: "reload" }));
          if (!res.ok) throw new Error(`Precache failed: ${path} (${res.status})`);
          return [url.href, res];
        }),
      );
      const cache = await caches.open(CACHE);
      await Promise.all(responses.map(([href, res]) => cache.put(href, res)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      // Only ever delete our own old caches.
      await Promise.all(
        keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Leave other origins (map tiles) and anything outside our scope to the network.
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const clean = new URL(url);
      clean.search = "";
      const hit = await cache.match(clean.href);
      if (hit) return hit;
      if (req.mode === "navigate") {
        const shell = await cache.match(new URL("./index.html", self.registration.scope).href);
        if (shell) return shell;
      }
      return fetch(req);
    })(),
  );
});
