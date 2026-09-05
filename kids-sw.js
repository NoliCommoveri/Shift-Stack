/* Shift Deck, for the kids — their service worker. PROJECT.md §46.

   The third worker on this origin, and the third scope. `sw.js` holds `/`,
   `view-sw.js` holds `/view`, and this holds `/kids`; the more specific
   registration wins for each page, so three PWAs can sit on one phone — or,
   as they actually will, one each on three phones — without any of them
   answering another's fetches out of its own shell.

   It sits at the root because a script may only claim a scope at or below its
   own directory, and the page is served at `/kids`, which is not below
   `/kids/`. Its cache name is its own for the reason §45 gives: `activate`
   deletes every cache it does not recognise, and two workers sharing a naming
   scheme would each delete the other's shell on every activation.

   The rest is `view-sw.js`, including §41's two rules — no redirected response
   is ever stored or served, and the handler never resolves to `undefined`. */
const SHELL = 'shiftdeck-kids-shell-v1';

/* Everything kids.html loads, which is a short list on purpose. The page draws
   its own week and its own countdown, so it needs the palette and one script;
   `pay.js` is not on it, and neither is the parser, the ICS reader or the
   merge. A file missing from this list is not slow offline, it is absent —
   `tests/config.test.js` reads the list against the page and fails if they
   disagree. */
const FILES = ['/kids', '/app.css', '/kids.js', '/kids.webmanifest'];

const START = new URL('/kids', self.location.href).href;

/* A response with nothing left of how it was fetched (§41). `/kids.html`
   redirects to `/kids`, `fetch` follows it and sets a flag the Cache API
   keeps, and a worker answering a navigation with a redirected response is a
   network error by specification. */
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

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(
        ks.filter(k => k.startsWith('shiftdeck-kids-') && k !== SHELL)
          .map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if(e.request.method !== 'GET') return;

  /* The week itself is never cached here, for §45's reason one page along:
     `kids.js` keeps the last answer in IndexedDB, which is a cache that knows
     how old it is and has a line on the screen for saying so. A second, older
     copy in the Cache API would be handed to a `fetch` that believes it
     reached the server, and the one failure this page can have is being
     confidently out of date. */
  if(url.origin === self.location.origin && url.pathname === '/soon') return;

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

/* This worker's own cache rather than `caches.match`, which searches every
   cache on the origin — and there are now three of them holding a file called
   `/app.css`. */
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
    return new Response('This is offline and the page is not in its cache.',
      { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
}
