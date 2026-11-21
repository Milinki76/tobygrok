/* Grok Bot service worker: caches the app shell only.
   Desk data (state/chart/activity/coin JSON) is never cached: it is
   cross-origin and always fetched with ?t=<epoch> and cache: no-store. */
const SHELL = "gb-shell-v3";
const FILES = ["./", "index.html", "app.css", "app.js", "chart.js", "manifest.json",
  "apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return; // data: network only
  // Network first so a new deploy shows at once; shell from cache when offline.
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(SHELL).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match("index.html")))
  );
});

/* Plan A only (plan B has no push endpoint: Telegram only). The payload
   url is the exact links.coin_url string the server put in the push. */
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Grok Bot · now", {
    body: d.body || "", icon: d.icon || "icons/icon-192.png", data: { url: d.url || null },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const u = e.notification.data && e.notification.data.url;
  if (u && u.indexOf("https://fomo.family/") === 0) e.waitUntil(self.clients.openWindow(u));
});
