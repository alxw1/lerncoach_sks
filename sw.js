// Offline-Unterstützung: erst Netz, bei Funkloch aus dem Cache.
// Netzabrufe umgehen den Browser-Cache (GitHub Pages cacht sonst bis zu 10 Minuten),
// damit eine neue Version sofort ankommt.
const CACHE = 'sks-lerncoach-v5';
const SHELL = ['./', 'index.html', 'styles.css', 'manifest.webmanifest', 'icons/icon.svg',
  'src/app.js', 'src/leitner.js', 'src/grader.js', 'src/hints.js', 'src/speech.js', 'src/elwis-parser.js', 'data/fragen.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => Promise.allSettled(SHELL.map((u) => fetch(u, { cache: 'no-cache' }).then((res) => res.ok && c.put(u, res)))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    // Eigene Anfrage per URL: eine Navigations-Anfrage lässt sich nicht mit anderem Cache-Modus kopieren
    fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' })
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
