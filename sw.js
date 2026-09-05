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

   v13 is §41: the shell is stored stripped of the redirect flag, and a phone
   holding v12 is holding the poisoned copy of `/index.html` that broke the
   installed app. Nothing but a new cache name re-fetches it.

   v14 is §42–§44, which are all things Ray asked for and will go looking for:
   the title reads job, site, role; the nav bar is reordered and bigger; the
   calendar-file pathways are off the Add screen; and a week filled from the
   rota can be confirmed from its own banner. A release he is waiting to see is
   the definition of one that has to reach the phone promptly.

   v15 is §45: the stylesheet moved out of index.html into app.css so the
   read-only viewer could link the same one. A new name rather than a second
   v14, and that is the whole point of the bump — a phone that already took
   v14 holds a shell whose index.html still carries its styles inline and whose
   file list has never heard of app.css. It would work, being the old page
   whole, and it would go on working for as long as the cache stood: a deploy
   that ships nothing, to the one phone that already trusted this worker. */
const SHELL = 'shiftdeck-shell-v16';
const RUNTIME = 'shiftdeck-runtime-v1';  // engine + fonts: never bump, it costs a 10MB re-download
/* Every script index.html loads, and nothing it does not. feed.js and merge.js
   were missing from this list from the day §14.7 extracted them: the shell
   fetch below is cache-first with a network refresh behind it, so a miss
   offline falls through to a fetch that cannot succeed and returns nothing.
   The page then loaded eight of its nine scripts, and feed.js throws on a
   missing collaborator by design — so the app was dead offline, which is the
   one condition it exists to survive. `tests/config.test.js` now reads both
   lists and fails if they disagree. */
const FILES = ['./', './index.html', './app.css', './parser.js', './ics.js', './patterns.js', './holidays.js', './sites.js', './pay.js', './feed.js', './merge.js', './app.js', './manifest.webmanifest'];

/* The start URL, absolute, and the only thing a navigation that misses the
   cache can fall back to. `./` against sw.js's own location is the origin
   root, which is what the Worker's asset handler serves the app from. */
const START = new URL('./', self.location.href).href;

/* A response with nothing left of how it was fetched (§41).

   Cloudflare's asset handler redirects `/index.html` to `/`. `fetch` follows
   that and hands back a perfectly good 200 — with its `redirected` flag set,
   which the Cache API preserves and which makes the response *illegal* to
   answer a navigation with: a navigation request has redirect mode "manual",
   and a service worker answering one with a redirected response produces a
   network error. Chrome shows it as ERR_FAILED with no explanation on the
   page and nothing in the log the phone can see.

   That is exactly what an installed PWA does on every launch — it navigates
   to the start URL — so this was the app opening in the browser and refusing
   to open from the home screen. Rebuilding the response drops the flag and
   keeps the bytes and the headers. */
async function plain(res){
  return new Response(await res.blob(),
    { status: 200, statusText: 'OK', headers: res.headers });
}

/* `addAll` would be shorter and it is what stored the poisoned copy: it caches
   what `fetch` returns, flag and all. So every file is fetched and rebuilt
   before it is put. `cache: 'reload'` keeps the browser's own HTTP cache from
   handing back the previous deploy's file, which is the other way a bumped
   SHELL ships nothing. */
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await Promise.all(FILES.map(async f => {
      const url = new URL(f, self.location.href).href;
      const res = await fetch(url, { cache: 'reload' });
      if(!res.ok) throw new Error(`${f} answered ${res.status}`);
      await cache.put(url, await plain(res));
    }));
    await self.skipWaiting();
  })());
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
  e.respondWith(fromShell(e.request));
});

/* Cache first, network behind it, and two rules that were not here before
   (§41).

   **Nothing redirected ever answers a navigation.** Stored copies are already
   stripped by `plain`; a response coming straight off the network on a cache
   miss is stripped here, because `/index.html` redirects to `/` on this host
   and a navigation is the one request that cannot be answered with the result.

   **This never resolves to `undefined`.** The old handler returned `hit ||
   net`, and `net` fell back to `hit` when the fetch failed — so a miss with no
   network resolved to nothing, and `respondWith(undefined)` is a network
   error, which is the same blank ERR_FAILED page by a second route. Offline
   and uncached now falls back to the app shell for a navigation and says so in
   words for anything else. */
async function fromShell(request){
  const cached = await caches.match(request);
  const network = fetch(request).then(async res => {
    if(res.ok){
      const copy = await plain(res.clone());
      const cache = await caches.open(SHELL);
      await cache.put(request, copy);
    }
    return res;
  });

  if(cached){ network.catch(() => {}); return cached; }

  try {
    const res = await network;
    return (request.mode === 'navigate' && res.redirected) ? plain(res) : res;
  } catch (err) {
    if(request.mode === 'navigate'){
      const shell = await caches.match(START);
      if(shell) return shell;
    }
    return new Response('Shift Deck is offline and this file is not in its cache.',
      { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
}
