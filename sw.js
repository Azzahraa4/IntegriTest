const CACHE = "df-phone-v2";
const SHELL = ["./", "index.html", "student.html", "supervisor.html", "css/style.css", "css/ai.css", "manifest.webmanifest", "icon.svg",
  "js/config.js", "js/pwa.js", "js/landing.js", "js/sensor.js", "js/student.js", "js/supervisor.js", "js/storage.js", "js/firebase-client.js",
  "js/ai-risk.js", "js/ai-report.js", "js/ai-dashboard.js"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== CACHE).map((x) => caches.delete(x))))));
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;        // Firebase tidak di-cache
  e.respondWith(fetch(e.request).then((r) => { caches.open(CACHE).then((c) => c.put(e.request, r.clone())); return r; }).catch(() => caches.match(e.request)));
});
self.addEventListener("notificationclick", (e) => { e.notification.close(); e.waitUntil(clients.matchAll({ type: "window" }).then((l) => l[0]?.focus())); });
