/* No two scripts may claim the same global. Run with:  npm test
 *
 * The app has no build step and no modules: every file in index.html is a
 * classic script, so every top-level `function f` and `const f` is a property
 * of one shared global object, and the last script to declare a name wins
 * silently.
 *
 * That is not theoretical. `fold` was line-folding in ics.js and a `<details>`
 * builder in app.js; app.js loads last, so the calendar writer called the
 * wrong one and wrote "[object Object]" into every UID, SUMMARY, DESCRIPTION
 * and LOCATION line it produced. The file still opened. It had the right
 * number of events. Every one of them was unreadable, and it shipped, because
 * nothing in the repo was in a position to notice.
 *
 * Extracting feed.js came within one rename of doing it twice more — `hhmm`
 * is a formatter in ics.js and was a parser in feed.js, which would have
 * broken calendar import outright. So the rule gets a test rather than a
 * comment: one name, one owner, across every script the page loads.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/* The load order the browser actually uses, read from index.html rather than
   listed here — a file added to the page and not to this list would be
   exactly the gap this test exists to close. */
const scripts = [...fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .matchAll(/<script src="([^"]+\.js)"><\/script>/g)].map(m => m[1]);

/* Top level means column zero in these files: everything nested is indented,
   and nothing here is minified. Good enough to catch a real collision, and it
   does not need to be a parser to do it. */
const DECL = /^(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)/;

function globalsOf(file){
  const out = new Set();
  for(const line of fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n')){
    const m = DECL.exec(line);
    if(m) out.add(m[1]);
  }
  return out;
}

test('index.html loads every script the app needs', () => {
  assert.ok(scripts.length >= 8, `only found ${scripts.length} scripts`);
  assert.equal(scripts[scripts.length - 1], 'app.js', 'app.js loads last');
  for(const f of scripts) assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} is missing`);
});

test('no global is declared by two scripts', () => {
  const owner = new Map();
  const clashes = [];
  for(const file of scripts){
    for(const name of globalsOf(file)){
      if(owner.has(name)) clashes.push(`${name}: ${owner.get(name)} and ${file}`);
      else owner.set(name, file);
    }
  }
  assert.deepEqual(clashes, [], 'two scripts declare the same top-level name; the later one silently wins');
});
