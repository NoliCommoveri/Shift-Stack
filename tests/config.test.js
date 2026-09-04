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
  for(const served of ['index.html', 'app.js', 'feed.js', 'merge.js', 'sw.js'])
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
  const at = worker.search(new RegExp(`(async\\s+)?function\\s+${name}\\s*\\(`));
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
    // Dispatched instead: follow it and look in the handler.
    const call = /return\s+([A-Za-z_$][\w$]*)\s*\(/.exec(r.body);
    return !!call && /tokenOK\(env\.PUSH_TOKEN, bearer\(req\)\)/.test(bodyOf(call[1]));
  };

  assert.ok(routes.length >= 4, `expected the four endpoints, found ${routes.length}`);
  for(const r of routes)
    assert.ok(guarded(r), `${r.path} must check the push token, at the route or in its handler`);

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
