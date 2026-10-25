"use strict";
/*
 * Findaro service worker — Phase 3 PWA support.
 *
 * Caching rules (deliberately conservative):
 *  - App shell and static assets: cache-first, filled from the network on
 *    first visit, so the site and every client-side tool work offline
 *    after that first visit.
 *  - Wikipedia API calls (search + suggestions): NETWORK ONLY. They are
 *    never read from or written to any cache, so no query or result is
 *    ever stored by this worker. When the network is unreachable the
 *    fetch simply fails and the page shows its offline message.
 *  - Non-GET requests: never intercepted.
 *  - Nothing user-entered is cached: the only requests cached are GETs
 *    for the app's own files and its font/CDN assets.
 *
 * The cache name is versioned; old versions are deleted on activate.
 */
var CACHE_NAME = "findaro-shell-v1";
var SCOPE = self.registration.scope;
var INDEX_URL = new URL("../index.html", SCOPE).href;
var ROOT_URL = new URL("../", SCOPE).href;

/* Precache targets, resolved against this worker's location (assets/),
 * so the page, manifest and icons are covered wherever the site is hosted. */
var CORE_ASSETS = [
  ROOT_URL,
  INDEX_URL,
  new URL("manifest.webmanifest", SCOPE).href,
  new URL("icon-192.png", SCOPE).href,
  new URL("icon-512.png", SCOPE).href,
  new URL("icon-maskable-512.png", SCOPE).href,
  new URL("apple-touch-icon.png", SCOPE).href
];

/* Self-contained offline fallback, shown for navigation requests when
 * neither the network nor a cached copy of the page is available. */
var OFFLINE_HTML =
  "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\" />" +
  "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />" +
  "<meta name=\"color-scheme\" content=\"light dark\" /><title>You're offline — Findaro</title>" +
  "<style>body{margin:0;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#FBF7F1;color:#251334;" +
  "display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}" +
  "@media (prefers-color-scheme: dark){body{background:#150A24;color:#F5EEFC}}" +
  ".card{max-width:420px;text-align:center}h1{font-size:26px;margin:14px 0 8px}p{margin:0 0 18px;line-height:1.55;opacity:.85}" +
  "a{display:inline-block;background:#5B21B6;color:#fff;text-decoration:none;font-weight:600;padding:11px 22px;border-radius:9px}" +
  "</style></head><body><div class=\"card\">" +
  "<svg width=\"64\" height=\"64\" viewBox=\"0 0 48 48\" fill=\"none\" aria-hidden=\"true\">" +
  "<circle cx=\"21\" cy=\"21\" r=\"13.5\" stroke=\"#5B21B6\" stroke-width=\"5.5\"/>" +
  "<line x1=\"31.5\" y1=\"31.5\" x2=\"43\" y2=\"43\" stroke=\"#E8482F\" stroke-width=\"6\" stroke-linecap=\"round\"/>" +
  "<circle cx=\"21\" cy=\"21\" r=\"4\" fill=\"#E8482F\"/></svg>" +
  "<h1>You're offline</h1>" +
  "<p>Findaro can't load this page without a connection. Once the site has loaded at least once, " +
  "all 16 tools work fully offline — reconnect and try again to pick up where you left off.</p>" +
  "<a href=\"" + ROOT_URL + "\">Try again</a>" +
  "</div></body></html>";

function offlineResponse() {
  return new Response(OFFLINE_HTML, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      /* Cache each asset independently: one missing file must not
       * prevent the rest of the shell from being stored. */
      return Promise.all(CORE_ASSETS.map(function (url) {
        return cache.add(url).catch(function () { /* asset unavailable — skip it */ });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (name) {
        if (name !== CACHE_NAME) return caches.delete(name);
        return undefined;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return;

  var url;
  try { url = new URL(request.url); } catch (e) { return; }

  /* Wikipedia API: network only, never cached. Failures propagate to the
   * page, which shows its friendly offline message for search. */
  if (url.hostname === "wikipedia.org" || url.hostname.endsWith(".wikipedia.org")) return;

  /* Page navigations: network first so the freshest page wins; fall back
   * to the cached page offline, then to the offline view. */
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).then(function (response) {
        if (response && response.ok) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(INDEX_URL, copy);
          });
        }
        return response;
      }).catch(function () {
        return caches.match(request).then(function (hit) {
          if (hit) return hit;
          return caches.match(INDEX_URL).then(function (index) {
            return index || offlineResponse();
          });
        });
      })
    );
    return;
  }

  /* Everything else (app files, fonts, the QR library): cache-first,
   * filled from the network on first fetch. */
  event.respondWith(
    caches.match(request).then(function (hit) {
      if (hit) return hit;
      return fetch(request).then(function (response) {
        if (response && (response.status === 200 || response.type === "opaque")) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(request, copy);
          });
        }
        return response;
      });
    })
  );
});
