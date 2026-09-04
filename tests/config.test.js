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
