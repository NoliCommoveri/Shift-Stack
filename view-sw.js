/* Shift Deck, read only — the viewer's service worker. PROJECT.md §42.

   A second worker on one origin, and the scope is the whole reason it is a
   separate file rather than a branch inside sw.js.

   A script may only claim a scope at or below its own directory, so this sits
   at the root: `/view/sw.js` could claim `/view/` and the page is served at
   `/view`, which is not below it. From the root it can claim `/view`, and
   `view.js` registers it with exactly that. The app's worker keeps `/`, this
   one takes `/view*`, and the more specific registration wins for these pages
   — so both apps can be installed on one phone without either silently taking
   over the other's fetches. That case is not theoretical: it is the phone this
   was built and tested on.

   Cache names are this worker's own for the same reason. `activate` below
   deletes every cache it does not recognise, and two workers sharing an origin
   with one naming scheme would each delete the other's shell on every
   activation — an app that reinstalls itself from the network every launch,
   which is the opposite of the point.

   Everything else here is sw.js, including the two rules §41 paid for: no
   redirected response is ever stored or served, and the handler never resolves
   to `undefined`. */
const SHELL = 'shiftdeck-view-shell-v1';

/* Every file view.html loads. The shared modules are the app's own, by the
   same absolute paths the page asks for — one copy on the origin, cached
   twice, which is a few kilobytes against the certainty that the viewer is
   running the same `weekPay` as the app.

   A file missing from this list is not slow offline, it is absent: the fetch
   behind the cache cannot succeed, and `feed.js` throws on a missing
   collaborator by design. §14.7 shipped that way in the app for four sections
   and the symptom was a dead page with nothing in any log the phone can see.
   `tests/config.test.js` reads this list against view.html and fails if they
   disagree. */
const FILES = ['/view', '/app.css', '/parser.js', '/ics.js', '/patterns.js',
               '/holidays.js', '/sites.js', '/pay.js', '/feed.js', '/merge.js',
               '/view.js', '/view.webmanifest'];

/* The start URL, and the only thing a navigation that misses the cache can
   fall back to. */
const START = new URL('/view', self.location.href).href;

/* A response with nothing left of how it was fetched (§41). Cloudflare's asset
   handler redirects `/view.html` to `/view`; `fetch` follows it and sets a flag
   the Cache API preserves, and a service worker answering a *navigation* with
   a redirected response is a network error by specification — ERR_FAILED, with
   nothing on the page and nothing in a log. Rebuilding drops the flag and
   keeps the bytes. */
async function plain(res){
  return new Response(await res.blob(),
    { status: 200, statusText: 'OK', headers: res.headers });
}

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

/* Only this worker's own caches are considered. The app's are not ours to
   delete, and deleting them is what a copied `activate` would do. */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(
        ks.filter(k => k.startsWith('shiftdeck-view-') && k !== SHELL)
          .map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if(e.request.method !== 'GET') return;

  /* The schedule itself is never cached here. `view.js` keeps the last answer
     in IndexedDB and draws from it, which is a cache that knows how old it is
     and says so on the screen; a copy in the Cache API as well would be a
     second, older answer with nothing to say it was one, handed back to a
     `fetch` that believes it reached the server. The as-of line would then be
     confidently wrong, which is the one failure this page has. */
  if(url.origin === self.location.origin && url.pathname === '/read') return;

  // Fonts, cached once. No Tesseract here: the viewer imports nothing.
  if(/fonts\.(googleapis|gstatic)\.com/.test(url.href)){
    e.respondWith(
      caches.open(SHELL).then(async cache => {
        const hit = await cache.match(e.request);
        if(hit) return hit;
        const res = await fetch(e.request);
        if(res.ok || res.type === 'opaque') cache.put(e.request, res.clone());
        return res;
      }).catch(() => fetch(e.request))
    );
    return;
  }

  e.respondWith(fromShell(e.request));
});

/* Scoped to this worker's own cache rather than `caches.match`, which searches
   every cache on the origin and would let the app's shell answer the viewer's
   requests for the shared scripts. They are the same files today; they are one
   deploy away from not being, and a viewer running app.css from a shell the
   app cached last month is a bug with no symptom anyone could report. */
async function fromShell(request){
  const shelf = await caches.open(SHELL);
  const cached = await shelf.match(request);
  const network = fetch(request).then(async res => {
    if(res.ok){
      await shelf.put(request, await plain(res.clone()));
    }
    return res;
  });

  if(cached){ network.catch(() => {}); return cached; }

  try {
    const res = await network;
    return (request.mode === 'navigate' && res.redirected) ? plain(res) : res;
  } catch (err) {
    if(request.mode === 'navigate'){
      const shell = await shelf.match(START);
      if(shell) return shell;
    }
    return new Response('The viewer is offline and this file is not in its cache.',
      { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
}
