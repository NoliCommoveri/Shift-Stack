/* The deploy configuration. Run with:  npm test
 *
 * These assert things wrangler will otherwise tell you about in a warning in
 * the middle of a build log, which is not a place anyone reads. `keep_vars`
 * was set to stop every build deleting PUSH_TOKEN, FEED_TOKEN and ICS_URL
 * from the dashboard — and was written one line too low, so TOML filed it
 * under [assets], wrangler said "Unexpected fields found in assets field" and
 * carried on, and the secrets went on being deleted by a fix that looked
 * applied. The build succeeded every time.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const toml = fs.readFileSync(path.join(ROOT, 'wrangler.toml'), 'utf8').split('\n');

/* Which [table] a bare key belongs to: whichever header precedes it. */
function tableOf(key){
  let table = null;
  for(const line of toml){
    const h = /^\s*(\[\[?[^\]]+\]\]?)/.exec(line);
    if(h){ table = h[1]; continue; }
    if(new RegExp(`^\\s*${key}\\s*=`).test(line)) return table;
  }
  return undefined;                                   // not present at all
}

test('keep_vars is set, and set at the top level where wrangler reads it', () => {
  // Top-level-only field. Under any table header it is silently ignored, and
  // the symptom is three secrets vanishing on every deploy.
  assert.equal(tableOf('keep_vars'), null,
    'keep_vars must appear before the first [table] header');
  assert.match(toml.join('\n'), /^keep_vars\s*=\s*true\s*$/m);
});

test('the Worker is a Worker, with the cron that is the point of it', () => {
  // Cron Triggers do not run on Pages (§14.9), so `main` and `[triggers]`
  // are what keep this from quietly becoming a static site.
  assert.equal(tableOf('main'), null);
  assert.match(toml.join('\n'), /^main\s*=\s*"worker\/index\.js"\s*$/m);
  assert.equal(tableOf('crons'), '[triggers]');
  assert.match(toml.join('\n'), /crons\s*=\s*\["\*\/15 \* \* \* \*"\]/);
});

test('the database is bound by id, not just by name', () => {
  assert.equal(tableOf('database_id'), '[[d1_databases]]');
  assert.equal(tableOf('binding'), '[assets]');       // the first `binding` key
  assert.match(toml.join('\n'), /database_id\s*=\s*"[0-9a-f-]{36}"/);
});

test('the schema ships as text so the Settings screen can apply it', () => {
  // §14.9: nobody is asked to paste SQL into the D1 console.
  assert.match(toml.join('\n'), /globs\s*=\s*\["worker\/\*\.sql"\]/);
  assert.ok(fs.existsSync(path.join(ROOT, 'worker', 'schema.sql')));
});

test('.assetsignore keeps the repo off the public site', () => {
  // `directory = "./"` serves everything not excluded. The .git line is the
  // one that matters: wrangler's default ignore list does not skip it, and
  // without it the whole commit history is downloadable.
  const ignore = fs.readFileSync(path.join(ROOT, '.assetsignore'), 'utf8').split('\n')
                   .map(l => l.trim()).filter(Boolean);
  for(const must of ['.git', 'node_modules', 'worker', 'tests', 'wrangler.toml', 'PROJECT.md'])
    assert.ok(ignore.includes(must), `.assetsignore must exclude ${must}`);
  // And the app itself must still be served.
  // The viewer's four files and the stylesheet both pages link (§45). A page
  // excluded here is a 404 on the second phone with nothing to say why.
  for(const served of ['index.html', 'app.js', 'app.css', 'feed.js', 'merge.js', 'sw.js',
                       'view.html', 'view.js', 'view-sw.js', 'view.webmanifest',
                       'kids.html', 'kids.js', 'kids-sw.js', 'kids.webmanifest'])
    assert.ok(!ignore.includes(served), `${served} must not be excluded`);
});

/* Every route that answers with his data checks a token first.
 *
 * worker/index.js cannot be required here — it imports schema.sql, which only
 * exists as a module inside wrangler's bundle — so this reads it as text. That
 * is weaker than calling it, and still worth having: the failure it guards
 * against is a route added without its guard, which is a whole schedule
 * readable by anyone who knows the hostname, and nothing else in the suite
 * would notice.
 */
const worker = fs.readFileSync(path.join(ROOT, 'worker', 'index.js'), 'utf8');

/* A named function's body, brace-counted from its opening `{`. Needed because
 * the guard is not always at the route: `/push` and `/feed` dispatch to a
 * handler and check the token inside it, which is just as good and would look
 * unguarded to anything that only read the route line. */
function bodyOf(name){
  // A declaration or a block-bodied arrow assigned to a const: `viewOK` is the
  // second shape, and the first version of this only knew the first, so the
  // guard it was asked about read as absent rather than as unguarded.
  const at = worker.search(new RegExp(
    `(async\\s+)?function\\s+${name}\\s*\\(|const\\s+${name}\\s*=\\s*(async\\s*)?\\(`));
  if(at < 0) return '';
  let i = worker.indexOf('{', at), depth = 0;
  for(let j = i; j < worker.length; j++){
    if(worker[j] === '{') depth++;
    else if(worker[j] === '}' && --depth === 0) return worker.slice(i, j + 1);
  }
  return '';
}

test('no endpoint answers with the schedule before checking a token', () => {
  // Each route from its `path === '/x'` to the next one, or to the assets
  // fallthrough — the one route meant to be open, because what it serves is
  // the app itself.
  const starts = [...worker.matchAll(/path === '(\/[a-z]+)'/g)];
  const end = worker.indexOf('return env.ASSETS.fetch(req)');
  assert.ok(end > 0, 'the assets fallthrough is still the last route');

  const routes = starts.map((m, i) => ({
    path: m[1],
    body: worker.slice(m.index, i + 1 < starts.length ? starts[i + 1].index : end)
  }));

  const guarded = r => {
    if(/tokenOK\(env\.PUSH_TOKEN, bearer\(req\)\)/.test(r.body)) return true;
    // The read-only viewer's route (§45). A different secret, and a narrower
    // one: `viewOK` is asserted below to open nothing that writes.
    if(/viewOK\(env, bearer\(req\)\)/.test(r.body)) return true;
    // The kids' route (§46). Narrower again, and asserted below to answer with
    // a week of times and nothing that could be read as money.
    if(/kidsOK\(env, bearer\(req\)\)/.test(r.body)) return true;
    // Dispatched instead: follow it and look in the handler.
    const call = /return\s+([A-Za-z_$][\w$]*)\s*\(/.exec(r.body);
    return !!call && /tokenOK\(env\.PUSH_TOKEN, bearer\(req\)\)/.test(bodyOf(call[1]));
  };

  assert.ok(routes.length >= 5, `expected every endpoint, found ${routes.length}`);
  for(const r of routes)
    assert.ok(guarded(r), `${r.path} must check a token, at the route or in its handler`);

  // /shifts is what §14.7's pass two added, and it hands back every shift the
  // cron holds. Named rather than merely counted, so deleting it fails here
  // instead of leaving the app quietly showing one job out of two again.
  assert.ok(routes.some(r => r.path === '/shifts'), 'the app can read the feed shifts back');

  // The subscription feed is the exception and a different secret: it sits in
  // a URL ICSx⁵ holds, and it answers 404 rather than 401 so that nothing
  // there says a feed exists at all.
  assert.match(bodyOf('feed'), /tokenOK\(env\.FEED_TOKEN, token\)/);
  assert.match(bodyOf('feed'), /status: 404/);
});

/* The read-only half is read-only on the server (§45).
 *
 * The viewer hides its Add and Setup tabs by not having them, which is worth
 * nothing on its own: a phone holding a token and a `curl` are the same thing
 * to a Worker. What makes the second phone unable to touch his schedule is
 * that `VIEW_TOKEN` opens one route and that route only reads. So that is what
 * is asserted here, rather than anything about the page.
 */
test('the view token opens exactly one route, and that route only reads', () => {
  // The rule itself is in guards.js and has its own unit tests; what is
  // checked here is where it is wired in.
  assert.ok(require('../worker/guards.js').viewOK, 'viewOK is a guard, not a route detail');

  // Every route that accepts it. One, and it is a GET.
  const uses = [...worker.matchAll(/path === '(\/[a-z]+)' && req\.method === '([A-Z]+)'\)\{\s*\n\s*if\(!viewOK/g)];
  assert.equal(uses.length, 1, 'exactly one route accepts the view token');
  assert.deepEqual([uses[0][1], uses[0][2]], ['/read', 'GET']);

  // And the routes that write are not among them. Named individually rather
  // than counted: the failure this guards against is a route gaining a second,
  // looser guard later, and a count would not notice.
  for(const path of ['/push', '/reset', '/migrate']){
    const at = worker.indexOf(`path === '${path}'`);
    assert.ok(at > 0, `${path} is still a route`);
    const body = worker.slice(at, at + 400);
    assert.ok(!/viewOK/.test(body), `${path} must not accept the view token`);
  }

  // What /read hands back is the store, not the machinery. `raw` holds the
  // employer's calendar text verbatim and `polls` is the cron's log; neither
  // is his week, and neither belongs on a second phone.
  const read = bodyOf('readAll');
  assert.ok(read, 'readAll exists');
  assert.ok(!/FROM raw|FROM polls/.test(read), '/read answers with the store, not the log');
});

/* The kids' half sees a week and no money (§46).
 *
 * §45's test above is the model and the reason: hiding a tab is worth nothing,
 * because a phone holding a token and a `curl` are the same thing to a Worker.
 * A kids' page built on `VIEW_TOKEN` would be one address bar away from
 * `/read`, which answers with every shift on file and every company with its
 * rate, its multiplier and its threshold sitting on it. So what is asserted
 * here is the wiring: which route the kids' token opens, that it is the only
 * one, and that the route hands back `soonOnly` rather than the store.
 */
test('the kids’ token opens exactly one route, and that route sends no money', () => {
  assert.ok(require('../worker/guards.js').kidsOK, 'kidsOK is a guard, not a route detail');

  const uses = [...worker.matchAll(/path === '(\/[a-z]+)' && req\.method === '([A-Z]+)'\)\{\s*\n\s*if\(!kidsOK/g)];
  assert.equal(uses.length, 1, 'exactly one route accepts the kids’ token');
  assert.deepEqual([uses[0][1], uses[0][2]], ['/soon', 'GET']);

  // And it is not `/read`. That is the whole of §46: the two tokens open two
  // different answers, rather than one answer drawn two ways.
  for(const path of ['/push', '/reset', '/migrate', '/read', '/status', '/trace', '/shifts']){
    const at = worker.indexOf(`path === '${path}'`);
    assert.ok(at > 0, `${path} is still a route`);
    assert.ok(!/kidsOK/.test(worker.slice(at, at + 400)),
      `${path} must not accept the kids’ token`);
  }

  // What `/soon` answers with. Every shift it sends goes through `soonOnly`,
  // which builds its output field by field and has its own unit test; the
  // handler must not be assembling a second, looser shape beside it.
  const soon = bodyOf('readSoon');
  assert.ok(soon, 'readSoon exists');
  assert.match(soon, /soonOnly\(/, '/soon shapes its answer with soonOnly');
  // Named, rather than pattern-matched at the return: the failure to catch is
  // a handler that grew a second field, and every one of these is a field it
  // could plausibly grow. `cfg` is read here — the job names and colours come
  // off it — and must go no further than `soonOnly`'s second argument.
  for(const gone of ['readStore', 'sites', 'roles', 'settings', 'rate', 'raw', 'polls'])
    assert.ok(!new RegExp(`\\b${gone}\\b`).test(soon),
      `/soon must not so much as mention ${gone}`);
  // The window is closed in SQL as well, so the rest of the schedule is never
  // read out of D1 at all.
  assert.match(soon, /readShifts\(env, 'WHERE date >= \? AND date <= \?'/);
  // And the day it is closed around is his, not the Worker's: a Worker runs on
  // UTC and a child opening this in the evening in Chicago is already inside
  // the Worker's tomorrow (§35, §37).
  assert.match(soon, /zoneFor\(/);
  assert.match(soon, /todayIn\(zone\)/);
});

/* The kids' page holds no arithmetic that could price an hour (§46.1).
 *
 * The server half is above. This is the page half, and it is not decoration:
 * `pay.js` not being loaded is what makes "there is no pay on this phone" a
 * fact about the bytes rather than a promise about the markup.
 */
test('the kids’ page cannot price anything, and cannot write', () => {
  const html = fs.readFileSync(path.join(ROOT, 'kids.html'), 'utf8');
  const js = fs.readFileSync(path.join(ROOT, 'kids.js'), 'utf8');

  const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(scripts, ['kids.js'],
    'the kids’ page loads its own script and nothing else');
  for(const gone of ['pay.js', 'app.js', 'view.js', 'ics.js', 'parser.js'])
    assert.ok(!scripts.includes(gone), `the kids’ page must not load ${gone}`);

  assert.ok(!/method:\s*'POST'/i.test(js), 'the kids’ page makes no POST');
  for(const route of ['/push', '/reset', '/migrate', '/status', '/trace', '/read'])
    assert.ok(!js.includes(`'${route}'`), `the kids’ page must not call ${route}`);
  assert.ok(js.includes("fetch('/soon'"), 'the kids’ page reads /soon');

  // Its own database, for §45's reason one page along: three stores on one
  // origin, and a shared name is two writers over one 'state' key.
  assert.match(js, /const KIDS_DB = 'shiftdeck-kids'/);

  // The two paddings, named once each and not spelled into the sentences.
  assert.match(js, /const LEAVE_PAD = 45;/);
  assert.match(js, /const HOME_PAD  = 30;/);
});

/* The kids' shell, and its scope (§41, §45, §46). */
test('the kids’ worker caches its page and claims only its own scope', () => {
  const html = fs.readFileSync(path.join(ROOT, 'kids.html'), 'utf8');
  const sw = fs.readFileSync(path.join(ROOT, 'kids-sw.js'), 'utf8');
  const shell = (/const FILES = \[([^\]]+)\]/.exec(sw) || [, ''])[1]
    .split(',').map(x => x.trim().replace(/^'|'$/g, ''));
  const cached = f => shell.includes(f) || shell.includes('/' + f) || shell.includes('./' + f);

  for(const f of [...[...html.matchAll(/<script\s+src="([^"]+)"/g)].map(m => m[1]),
                  '/kids', 'app.css', 'kids.webmanifest'])
    assert.ok(cached(f), `kids-sw.js must cache ${f}, or the page is dead offline`);

  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'kids.webmanifest'), 'utf8'));
  assert.ok(!/\.html$/.test(m.start_url), `start_url must not redirect: ${m.start_url}`);
  assert.equal(m.start_url, '/kids');
  assert.equal(m.scope, '/kids');
  assert.ok(shell.includes(m.start_url), 'the start URL must be in the shell cache');

  // Three workers on one origin now. Each deletes only its own caches, and
  // each claims only its own scope, or two of the three reinstall themselves
  // from the network on every launch.
  const nameOf = t => (/const SHELL = '([^']+)'/.exec(t) || [, ''])[1];
  const names = ['sw.js', 'view-sw.js', 'kids-sw.js']
    .map(f => nameOf(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  assert.equal(new Set(names).size, 3, 'three workers, three cache names');
  assert.ok(nameOf(sw).startsWith('shiftdeck-kids-'));
  assert.match(sw, /k\.startsWith\('shiftdeck-kids-'\)/,
    'the kids’ worker must only ever delete its own caches');
  assert.match(fs.readFileSync(path.join(ROOT, 'kids.js'), 'utf8'),
    /register\('\/kids-sw\.js', \{ scope: '\/kids' \}\)/);

  // Its own identity, or installing it would replace one of the other two on a
  // phone that has them.
  const ids = ['manifest.webmanifest', 'view.webmanifest', 'kids.webmanifest']
    .map(f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')).id);
  assert.equal(new Set(ids).size, 3, 'three apps, three identities');

});

/* Three apps, three drawings, and two files each (§47).
 *
 * The app and the viewer shared `icon-192.png` until §47, so on a phone
 * holding both the only thing telling them apart was the word under an
 * identical picture — which is not how a home screen is read. Each now has its
 * own artwork, and each declares two purposes across two files rather than one
 * file claiming both.
 *
 * `purpose: "any maskable"` on a single file is a claim that one picture is
 * correct under two treatments, and it is not: Android crops a maskable icon
 * to the circle inscribed in its square, so a full-bleed drawing loses its
 * corners, and a pre-inset drawing used as `any` sits in a box of margin next
 * to icons that do not. Whichever of the two is wrong is wrong silently, which
 * is why it is asserted here rather than looked at.
 */
test('each of the three apps has its own icon, at both purposes', () => {
  const apps = [['manifest.webmanifest', 'index.html', 'app'],
                ['view.webmanifest', 'view.html', 'view'],
                ['kids.webmanifest', 'kids.html', 'kids']];

  const seen = new Map();
  for(const [manifest, page, who] of apps){
    const m = JSON.parse(fs.readFileSync(path.join(ROOT, manifest), 'utf8'));
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');

    for(const i of m.icons){
      assert.ok(fs.existsSync(path.join(ROOT, i.src)),
        `${manifest} names ${i.src}, which is not in the repo`);
      assert.ok(!/\s/.test(i.purpose),
        `${i.src} claims "${i.purpose}"; one file cannot be correct for both`);
      // Shared with another app is the failure this test exists for.
      assert.ok(!seen.has(i.src),
        `${i.src} is ${who}'s and ${seen.get(i.src)}'s; they need telling apart`);
      seen.set(i.src, who);
    }

    const purposes = m.icons.map(i => i.purpose);
    assert.ok(purposes.includes('any'), `${manifest} needs an uncropped icon`);
    assert.ok(purposes.includes('maskable'), `${manifest} needs one for Android's mask`);

    // iOS reads the tag and not the manifest, so the two have to agree.
    const tag = /<link rel="apple-touch-icon" href="([^"]+)">/.exec(html);
    assert.ok(tag, `${page} has no apple-touch-icon`);
    assert.ok(m.icons.some(i => i.src === tag[1]),
      `${page} points iOS at ${tag[1]}, which ${manifest} does not name`);
  }

  // And the pair that used to be shared is gone rather than left lying around
  // for something to point back at.
  for(const old of ['icon-192.png', 'icon-512.png'])
    assert.ok(!fs.existsSync(path.join(ROOT, old)), `${old} is nobody's now`);
});

/* One stylesheet, two pages (§45).
 *
 * The viewer draws the same weeks and the same pay tables as the app, so it
 * links the same CSS. A copy would have been two schedules that looked
 * slightly different inside a month, and on a schedule a difference in how
 * something is drawn reads as a difference in the shifts.
 */
test('both pages link the one stylesheet, and both workers cache it', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'app.css')), 'app.css exists');
  for(const page of ['index.html', 'view.html']){
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    assert.match(html, /<link rel="stylesheet" href="app\.css">/,
      `${page} must link app.css`);
    // And must not have kept a copy of what moved out of it.
    assert.ok(!/--paper:#EDEEE9/.test(html.replace(/<link[^>]*>/g, '')),
      `${page} must not carry its own copy of the palette`);
  }
  for(const worker of ['sw.js', 'view-sw.js']){
    const sw = fs.readFileSync(path.join(ROOT, worker), 'utf8');
    assert.match(sw, /['"][.\/]*\/?app\.css['"]/, `${worker} must cache app.css`);
  }
});

/* The viewer's own shell (§45).
 *
 * The same assertion the app gets, for the same reason: a file missing from
 * the list is not slow offline, it is absent, and `feed.js` throws on a
 * missing collaborator by design.
 */
test('the viewer\u2019s service worker caches every script its page loads', () => {
  const html = fs.readFileSync(path.join(ROOT, 'view.html'), 'utf8');
  const sw = fs.readFileSync(path.join(ROOT, 'view-sw.js'), 'utf8');

  const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(m => m[1]);
  const shell = (/const FILES = \[([^\]]+)\]/.exec(sw) || [, ''])[1]
    .split(',').map(x => x.trim().replace(/^'|'$/g, ''));
  const cached = f => shell.includes(f) || shell.includes('/' + f) || shell.includes('./' + f);

  assert.ok(scripts.length >= 8, `expected the viewer\u2019s scripts, found ${scripts.length}`);
  for(const f of scripts)
    assert.ok(cached(f), `view-sw.js must cache ${f}, or the viewer is dead offline`);
  for(const f of ['/view', 'view.webmanifest'])
    assert.ok(cached(f), `view-sw.js must cache ${f}`);

  // app.js is the half the viewer deliberately does not load: five thousand
  // lines of editing, importing and exporting, on a page with nothing to edit.
  assert.ok(!scripts.includes('app.js'), 'the viewer does not load app.js');
});

/* The viewer opens from the home screen, and does not take the app's scope
 * with it (§41, §45).
 */
test('the viewer starts at a URL the host does not redirect, in its own scope', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'view.webmanifest'), 'utf8'));
  // Same trap as §41: `html_handling` defaults to auto-trailing-slash, so
  // /view.html redirects to /view and a start URL that redirects is a launch
  // that has to survive the redirect on the one request that cannot.
  assert.ok(!/\.html$/.test(m.start_url), `start_url must not redirect: ${m.start_url}`);
  assert.equal(m.start_url, '/view');
  assert.equal(m.scope, '/view');
  // Its own identity, or installing it would replace the app on a phone that
  // has both.
  assert.notEqual(m.id, JSON.parse(
    fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8')).id);

  const sw = fs.readFileSync(path.join(ROOT, 'view-sw.js'), 'utf8');
  const shell = (/const FILES = \[([^\]]+)\]/.exec(sw) || [, ''])[1]
    .split(',').map(x => x.trim().replace(/^'|'$/g, ''));
  assert.ok(shell.includes(m.start_url), 'the start URL must be in the shell cache');

  // Two workers on one origin. Distinct cache names, or each `activate` would
  // delete the other's shell and both apps would refetch themselves on every
  // launch; and a registration scoped to /view, or the viewer would claim the
  // whole origin and start answering the app's fetches from its own shell.
  const app = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const nameOf = t => (/const SHELL = '([^']+)'/.exec(t) || [, ''])[1];
  assert.notEqual(nameOf(sw), nameOf(app));
  assert.ok(nameOf(sw).startsWith('shiftdeck-view-'));
  assert.match(sw, /k\.startsWith\('shiftdeck-view-'\)/,
    'the viewer must only ever delete its own caches');
  const js = fs.readFileSync(path.join(ROOT, 'view.js'), 'utf8');
  assert.match(js, /register\('\/view-sw\.js', \{ scope: '\/view' \}\)/);
});

/* The viewer holds no credential that can write, and asks for nothing that
 * could (§45). The page half of the rule the Worker enforces above.
 */
test('the viewer cannot write, and never sees the push token', () => {
  const js = fs.readFileSync(path.join(ROOT, 'view.js'), 'utf8');
  assert.ok(!/method:\s*'POST'/i.test(js), 'the viewer makes no POST');
  for(const route of ['/push', '/reset', '/migrate', '/status', '/trace'])
    assert.ok(!js.includes(`'${route}'`), `the viewer must not call ${route}`);
  assert.ok(js.includes("fetch('/read'"), 'the viewer reads /read');
  // Its own database. The app's is `shiftdeck`, on the same origin, and a
  // shared name would be two writers over one 'state' key -- the app's whole
  // store overwritten by a cache of the server's answer.
  assert.match(js, /const VIEW_DB = 'shiftdeck-view'/);
});

/* The offline shell holds every script the page loads.
 *
 * sw.js serves the shell cache-first with a network refresh behind it, so a
 * file missing from its list is not slow offline — it is absent, because the
 * fallback is a fetch that cannot succeed. feed.js and merge.js were missing
 * from the day §14.7 extracted them, and feed.js throws on a missing
 * collaborator by design, so the app was dead with no signal: the one
 * condition an installed PWA exists to survive.
 */
test('the service worker caches every script the page loads', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

  const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(m => m[1]);
  const shell = (/const FILES = \[([^\]]+)\]/.exec(sw) || [, ''])[1]
    .split(',').map(x => x.trim().replace(/^'|'$/g, ''));
  // The list is written './x' and the page asks for 'x'; both name one file.
  const cached = f => shell.includes(f) || shell.includes('./' + f);

  assert.ok(scripts.length >= 9, `expected the page's scripts, found ${scripts.length}`);
  for(const f of scripts)
    assert.ok(cached(f), `sw.js must cache ${f}, or the app is dead offline`);

  // The page itself and its manifest, which are not <script> tags.
  for(const f of ['./', 'index.html', 'manifest.webmanifest'])
    assert.ok(cached(f), `sw.js must cache ${f}`);

  // Bumping SHELL is what makes a fixed list reach a phone that already holds
  // the old one: `install` only re-runs `addAll` under a cache name it has not
  // seen. Left alone, the fix ships and nothing fetches it.
  assert.match(sw, /const SHELL = 'shiftdeck-shell-v(\d+)'/);
});

/* The app opens from the home screen (§41).
 *
 * The installed PWA navigated to `./index.html` on every launch. Cloudflare's
 * asset handler redirects that to `/`, `fetch` follows the redirect and keeps
 * a flag saying so, the Cache API stores the flag, and a service worker
 * answering a *navigation* with a redirected response is a network error by
 * specification. So the shell cached the app and the home screen icon opened
 * ERR_FAILED, while the same URL in a browser tab was fine.
 *
 * Two independent things had to be true for that, so both are asserted here.
 */
test('the app starts at a URL the host does not redirect', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
  // `html_handling` defaults to auto-trailing-slash, which redirects
  // /index.html to /. A start URL that redirects is a launch that has to
  // survive the redirect, every time, on the one request that cannot.
  assert.ok(!/\.html$/.test(m.start_url), `start_url must not redirect: ${m.start_url}`);
  assert.equal(m.scope, './');

  // The identity Chrome gave the app when it was installed, said out loud so
  // that moving start_url does not make this a different app and leave the
  // installed one pointing at the old URL for ever.
  assert.equal(m.id, '/index.html');

  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const shell = (/const FILES = \[([^\]]+)\]/.exec(sw) || [, ''])[1]
    .split(',').map(x => x.trim().replace(/^'|'$/g, ''));
  assert.ok(shell.includes(m.start_url), 'the start URL must be in the shell cache');
});

test('the service worker never stores or serves a redirected response', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  // `addAll` caches exactly what `fetch` returned, redirect flag included,
  // which is what poisoned the shell. Every put goes through `plain` instead.
  assert.ok(!/\.addAll\(/.test(sw), 'cache.addAll stores the redirect flag; rebuild the response');
  assert.match(sw, /async function plain\(res\)/);
  assert.match(sw, /new Response\(await res\.blob\(\)/);
  // And a navigation served straight off the network is stripped too.
  assert.match(sw, /request\.mode === 'navigate' && res\.redirected/);
  // The other way to produce the same blank page: respondWith(undefined).
  assert.ok(!/return hit \|\| net/.test(sw), 'a miss with no network must not resolve to undefined');
});

/* The zone the cron reads the feed on, when no phone has pushed one (§37).
 *
 * `zoneFor` prefers the job's own answer and falls back to this, so the
 * failure it prevents is the one §35 shipped with: a Worker whose only route
 * to a time zone was a push from a phone that was still serving the previous
 * app.js out of its shell cache, filing every shift an hour out in the
 * meantime with a healthy poll record either side of it.
 */
test('the Worker is told a time zone at deploy time, as an IANA name', () => {
  const line = /^ZONE\s*=\s*"([^"]+)"\s*$/m.exec(toml.join('\n'));
  assert.ok(line, 'wrangler.toml must set ZONE');
  assert.equal(tableOf('ZONE'), '[vars]', 'ZONE is a var, not a secret and not an asset setting');
  // The same shape test `normalizeTimezone` applies. An offset is wrong for
  // half the year in any zone that keeps daylight saving, and a deploy config
  // that sets one is a whole schedule an hour out every summer.
  const zone = line[1];
  assert.ok(!/[+-]\d/.test(zone), `ZONE must be an IANA name, not the offset ${zone}`);
  assert.doesNotThrow(() => new Intl.DateTimeFormat('en-US', { timeZone: zone }));
});

/* The cron actually goes through the tested path (§38).
 *
 * `poll.test.js` runs the whole decision — zone, read, diff, guard — but it
 * runs `planPoll`, and index.js is free to stop calling it. That is not a
 * theoretical worry: the decision lived inline in `poll()` until §38, where
 * nothing could reach it, and three faults shipped through it in two days.
 * Re-inlining any of it would leave a green suite and an untested cron.
 */
test('the cron asks poll.js what to do rather than working it out again', () => {
  const body = bodyOf('poll');
  assert.ok(body, 'the cron handler is still called poll');
  assert.match(body, /planPoll\(\{ text, store, env \}\)/,
    'poll() must hand the feed text, the store and env to planPoll');
  // The two halves that need the outside world are the only ones left here.
  assert.match(body, /fetch\(env\.ICS_URL/);
  assert.match(body, /env\.DB\.batch\(writes\)/);
  // And nothing that decides: a parse, a diff or a guard back in this file is
  // a decision no test can see.
  for(const gone of ['parseICS(', 'mergeCalendar(', 'guard({'])
    assert.ok(!body.includes(gone), `${gone} belongs in poll.js, where it is tested`);
});
