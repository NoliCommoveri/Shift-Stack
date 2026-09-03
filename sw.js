/* Shift Deck service worker.
   App shell is cached so it opens offline. The OCR engine is cached on first
   use, which is why the second import is much faster than the first. */
const SHELL = 'shiftdeck-shell-v4';
const RUNTIME = 'shiftdeck-runtime-v1';  // engine + fonts: never bump, it costs a 10MB re-download
const FILES = ['./', './index.html', './parser.js', './ics.js', './patterns.js', './app.js', './manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== SHELL && k !== RUNTIME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if(e.request.method !== 'GET') return;

  // Tesseract's engine, language data and the fonts: cache once, reuse forever.
  if(/cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com|tessdata/.test(url.href)){
    e.respondWith(
      caches.open(RUNTIME).then(async cache => {
        const hit = await cache.match(e.request);
        if(hit) return hit;
        const res = await fetch(e.request);
        if(res.ok || res.type === 'opaque') cache.put(e.request, res.clone());
        return res;
      }).catch(() => fetch(e.request))
    );
    return;
  }

  // App shell: serve from cache, refresh in the background.
  e.respondWith(
    caches.match(e.request).then(hit => {
      const net = fetch(e.request).then(res => {
        if(res.ok) caches.open(SHELL).then(c => c.put(e.request, res.clone()));
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
