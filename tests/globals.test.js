/* The shared global scope. Run with:  npm test
 *
 * The app has no build step and no modules: index.html loads seven plain
 * scripts, and every top-level `function` and `const` in them lands in one
 * global scope, where the last file loaded wins. Nothing warns about it —
 * not the browser, not the other tests, which `require` each file into a
 * scope of its own and so never see the collision at all.
 *
 * §31 is what that costs. app.js grew a `fold` for the Setup screen's
 * `<details>` while ics.js already had a `fold` for RFC 5545 line folding.
 * app.js loads last, so every line the exporter folded came out as the
 * string "[object Object]": no SUMMARY, so the phone showed every shift as
 * "My event"; no LOCATION, so no address to tap; no UID, so no event could
 * be updated or cancelled. The file imported cleanly and the tests stayed
 * green for three commits.
 *
 * So the scope is a thing to test. The list of scripts is read out of
 * index.html rather than written here, because a file added to the page and
 * not to this test is exactly the file this test exists for.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/* The scripts index.html loads, in the order it loads them. */
function pageScripts(){
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  return [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(m => m[1]);
}

/* Top-level declarations, which is what this codebase puts in the global
   scope. Column zero is the test: every file here indents anything nested,
   so a declaration starting a line is a global and one that does not, is not.
   A blunt rule, deliberately — it needs no parser and it cannot be quietly
   defeated by adding a file. */
function globalsIn(src){
  const found = new Set();
  const re = /^(?:function\s*\*?\s*([A-Za-z_$][\w$]*)|(?:const|let|var|class)\s+([A-Za-z_$][\w$]*))/gm;
  for(const m of src.matchAll(re)) found.add(m[1] || m[2]);
  return found;
}

test('index.html loads the scripts the app is made of', () => {
  const files = pageScripts();
  assert.ok(files.length >= 2, 'no <script src> found in index.html');
  files.forEach(f => assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} is on the page but not in the repo`));
});

test('no two scripts declare the same global', () => {
  const owner = new Map();
  const clashes = [];
  pageScripts().forEach(f => {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    globalsIn(src).forEach(name => {
      if(owner.has(name)) clashes.push(`${name}: ${owner.get(name)} then ${f}`);
      else owner.set(name, f);
    });
  });
  assert.deepEqual(clashes, [],
    'a name declared twice means the later script silently replaces the earlier one:\n  '
    + clashes.join('\n  '));
});
