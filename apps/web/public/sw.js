// LiveCoco offline service worker: network first, falling back to the cache for public content only.
// Signed-in pages are never cached, so personal data does not outlive the session on a shared phone.
const CACHE = "lc-v4";
const SHELL = ["/", "/icon.svg", "/manifest.webmanifest"];
const PUBLIC_PAGES = new Set(["/", "/ta", "/en", "/market"]);

const cacheable = (req, url) => {
  if (req.method !== "GET" || url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith("/_next/static/") || url.pathname === "/icon.svg" || url.pathname === "/manifest.webmanifest") return true;
  if (url.pathname.startsWith("/v1/prices/") || url.pathname === "/v1/sell-lots") return true;
  // Public HTML pages only; React Server Component requests carry an `RSC` header and are left alone.
  return req.mode === "navigate" && !req.headers.has("rsc") && PUBLIC_PAGES.has(url.pathname);
};

self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (!cacheable(e.request, url)) {
    // Offline navigation to a page we do not keep: show the cached price board instead of the browser error.
    if (e.request.mode === "navigate") e.respondWith(fetch(e.request).catch(() => caches.match("/").then((r) => r || Response.error())));
    return;
  }
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && !res.redirected) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || Response.error())),
  );
});
