/* Shift Deck service worker.
   App shell is cached so it opens offline. The OCR engine is cached on first
   use, which is why the second import is much faster than the first. */
/* Bumped with every release that has to reach the phone promptly. The fetch
   handler below is cache-first with a network refresh behind it, so an
   unchanged service worker serves the *old* app.js on the load after a deploy
   and the new one only on the load after that. §35 shipped that way and looked
   like it had not worked: the cron had the fix, the phone was still running
   the code that never sends a time zone. Changing this string is what makes
   the browser reinstall the worker, re-fetch every file in FILES from the
   network, and claim the open page.

   v12 is §39: the colour lives in `ics.js` and `feed.js`, both of them in
   FILES below, and the file the *page* saves is written by the copies the
   shell is holding. Left at v11 the exported calendar would come out with no
   COLOR line on a phone that already has the app — which is §37's failure
   exactly, and the one this string exists to prevent. */
const SHELL = 'shiftdeck-shell-v12';
const RUNTIME = 'shiftdeck-runtime-v1';  // engine + fonts: never bump, it costs a 10MB re-download
/* Every script index.html loads, and nothing it does not. feed.js and merge.js
   were missing from this list from the day §14.7 extracted them: the shell
   fetch below is cache-first with a network refresh behind it, so a miss
   offline falls through to a fetch that cannot succeed and returns nothing.
   The page then loaded eight of its nine scripts, and feed.js throws on a
   missing collaborator by design — so the app was dead offline, which is the
   one condition it exists to survive. `tests/config.test.js` now reads both
   lists and fails if they disagree. */
const FILES = ['./', './index.html', './parser.js', './ics.js', './patterns.js', './holidays.js', './sites.js', './pay.js', './feed.js', './merge.js', './app.js', './manifest.webmanifest'];

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
