/* Site table tests (PROJECT.md §8.1). Run with:  npm test
 *
 * No fixtures, for the same reason patterns.js has none: this module reads
 * nothing. It takes a spelling and a list of records somebody made and decides
 * whether they are the same place, which is exactly the sort of thing worth
 * stating as cases.
 *
 * The names throughout are the real ones from §16.3 — DSI's De la Montagne and
 * the "Cook Plant ASO | SOUTHERN HENS" line that gave §17.4 its separator —
 * and the misspellings are the ones OCR actually makes on that dark screen:
 * l/I, n/m, o/0.
 */
const test = require('node:test');
const assert = require('node:assert');
const T = require('../sites.js');
const P = require('../parser.js');

const site = (id, name, aliases = [], extra = {}) =>
  Object.assign({ id, companyId: 'dsi', name, address: '', aliases, archived: false }, extra);

const MONT = () => site('s1', 'De la Montagne');
const HENS = () => site('s2', 'SOUTHERN HENS');

/* ---------- the key ------------------------------------------------------ */

test('the key ignores everything OCR gets wrong that is not a letter', () => {
  assert.equal(T.key('De la Montagne'), T.key('DE LA MONTAGNE'));
  assert.equal(T.key('SOUTHERN HENS, I...'), T.key('southern hens i'));
  assert.equal(T.key('  '), '');
  assert.equal(T.key(null), '');
});

/* ---------- matching ----------------------------------------------------- */

test('an exact name matches, and says so', () => {
  const m = T.matchSite('De la Montagne', [MONT()]);
  assert.equal(m.site.id, 's1');
  assert.equal(m.how, 'exact');
});

test('a recorded spelling matches exactly, not nearly', () => {
  const m = T.matchSite('De Ia Montagme', [MONT(), site('s3', 'Elsewhere', ['De Ia Montagme'])]);
  assert.equal(m.site.id, 's3');
  assert.equal(m.how, 'exact');
});

test('an exact hit on one site beats a near hit on another', () => {
  // Order matters here: the near match is the first record in the list, so a
  // matcher that took the first plausible answer would get this wrong.
  const m = T.matchSite('Southern Hen', [site('s4', 'Southern Hens'), site('s5', 'X', ['Southern Hen'])]);
  assert.equal(m.site.id, 's5');
  assert.equal(m.how, 'exact');
});

test('OCR damage inside a long name still lands on the site', () => {
  const m = T.matchSite('De Ia Montagme', [MONT()]);
  assert.equal(m.site.id, 's1');
  assert.equal(m.how, 'near');
  assert.equal(m.dist, 2);
});

test('a short spelling has to be exact', () => {
  // "Cook" and "Cort" are two apart, which is most of the word. §8.2's
  // argument applied to names: a check that is confidently wrong is worse than
  // one that says nothing.
  assert.equal(T.matchSite('Cort', [site('s6', 'Cook')]).site, null);
  assert.equal(T.matchSite('Cook', [site('s6', 'Cook')]).how, 'exact');
});

test('a different place is not a misreading of this one', () => {
  assert.equal(T.matchSite('SOUTHERN HENS', [MONT()]).site, null);
  assert.equal(T.matchSite('SOUTHERN HENS', [MONT()]).how, 'none');
});

test('nothing readable matches nothing', () => {
  assert.equal(T.matchSite('', [MONT()]).site, null);
  assert.equal(T.matchSite('  ...  ', [MONT()]).site, null);
  assert.equal(T.matchSite('De la Montagne', []).site, null);
});

test('an archived site is not matched against, and does not block the read', () => {
  const gone = site('s7', 'De la Montagne', [], { archived: true });
  assert.equal(T.matchSite('De la Montagne', [gone]).site, null);
  // …but a live site of a similar name still wins, rather than being shadowed.
  assert.equal(T.matchSite('De la Montagne', [gone, MONT()]).site.id, 's1');
});

/* ---------- spellings ---------------------------------------------------- */

test('a spelling is recorded once, and never one the site already had', () => {
  const s = MONT();
  assert.equal(T.addAlias(s, 'De Ia Montagme'), true);
  assert.equal(T.addAlias(s, 'de ia montagme'), false);      // same key
  assert.equal(T.addAlias(s, 'De la Montagne'), false);      // the name itself
  assert.equal(T.addAlias(s, '   '), false);
  assert.deepEqual(s.aliases, ['De Ia Montagme']);
});

test('a spelling learned in error can be forgotten', () => {
  const s = MONT();
  T.addAlias(s, 'De Ia Montagme');
  assert.equal(T.dropAlias(s, 'DE IA MONTAGME'), true);
  assert.deepEqual(s.aliases, []);
  assert.equal(T.dropAlias(s, 'never recorded'), false);
});

test('a learned spelling is what makes the next read exact', () => {
  const s = MONT();
  assert.equal(T.matchSite('De Ia Montagme', [s]).how, 'near');
  T.addAlias(s, 'De Ia Montagme');
  assert.equal(T.matchSite('De Ia Montagme', [s]).how, 'exact');
});

/* ---------- merging ------------------------------------------------------ */

test('merging moves every spelling and leaves one record', () => {
  const a = site('s1', 'De la Montagne', ['Montagne']);
  const b = site('s2', 'De Ia Montagme', ['De la Montaqne']);
  const { sites, moved } = T.mergeSites([a, b], 's2', 's1');
  assert.deepEqual(sites.map(x => x.id), ['s1']);
  assert.equal(moved, 2);                                     // its name and its alias
  assert.deepEqual(a.aliases, ['Montagne', 'De Ia Montagme', 'De la Montaqne']);
});

test('merging takes an address only when there is none already', () => {
  const a = site('s1', 'A', [], { address: '1 Main St' });
  const b = site('s2', 'B', [], { address: '2 Other Rd' });
  T.mergeSites([a, b], 's2', 's1');
  assert.equal(a.address, '1 Main St');

  const c = site('s3', 'C');
  const d = site('s4', 'D', [], { address: '2 Other Rd' });
  T.mergeSites([c, d], 's4', 's3');
  assert.equal(c.address, '2 Other Rd');
});

test('merging a site into itself, or into one that is not there, does nothing', () => {
  const a = MONT(), b = HENS();
  assert.equal(T.mergeSites([a, b], 's1', 's1').sites.length, 2);
  assert.equal(T.mergeSites([a, b], 's1', 'nope').sites.length, 2);
});

/* ---------- what a shift reads as ---------------------------------------- */

test('with no site, a shift reads as the label, unchanged', () => {
  const sh = { label: 'Cook Plant ASO | SOUTHERN HENS' };
  assert.equal(T.whereText(sh, null), 'Cook Plant ASO | SOUTHERN HENS');
  assert.equal(T.eventTitle('DSI', sh, null), 'DSI- Cook Plant ASO | SOUTHERN HENS');
});

test('with a site, the curated spelling replaces the read one', () => {
  // The label still holds the OCR damage; nothing on screen does.
  const sh = { label: 'Cook Plant ASO | S0UTHERN HEN5', role: 'Cook Plant ASO' };
  assert.equal(T.eventTitle('DSI', sh, HENS()), 'DSI- Cook Plant ASO | SOUTHERN HENS');
  assert.equal(T.whereText(sh, HENS(), ' · '), 'Cook Plant ASO · SOUTHERN HENS');
});

test('a role with no place named beside it leaves the site to speak alone', () => {
  assert.equal(T.eventTitle('Trupoint', { label: 'Cook', role: '' }, HENS()), 'Trupoint- SOUTHERN HENS');
});

test('a shift with nothing at all still gets a title', () => {
  assert.equal(T.eventTitle('', { label: '' }, null), 'Shift- Shift');
});

/* ---------- the address the calendar gets -------------------------------- */

test('the shift wins over the site, and the site over nothing', () => {
  const s = site('s1', 'A', [], { address: '1 Main St' });
  assert.equal(T.addressFor({ place: '2 Other Rd' }, s), '2 Other Rd');
  assert.equal(T.addressFor({}, s), '1 Main St');
  assert.equal(T.addressFor({}, null), '');
  assert.equal(T.addressFor({ place: '' }, null), '');
});

/* ---------- same place, for the duplicate check -------------------------- */

test('two rows on the same site are the same place, however they were read', () => {
  const a = { siteId: 's1', label: 'De Ia Montagme' };
  const b = { siteId: 's1', label: 'De la Montagne' };
  assert.equal(T.whereKey(a), T.whereKey(b));
});

test('with no site it falls back to the text, exactly as it used to', () => {
  assert.equal(T.whereKey({ label: 'De la Montagne' }), T.whereKey({ label: 'DE LA MONTAGNE' }));
  assert.notEqual(T.whereKey({ label: 'De la Montagne' }), T.whereKey({ label: 'SOUTHERN HENS' }));
});

test('a resolved row and an unresolved one are not the same place', () => {
  // They may well be, but nothing has said so, and the wrong answer here files
  // a second shift over the top of a real one.
  assert.notEqual(T.whereKey({ siteId: 's1', label: 'X' }), T.whereKey({ label: 'X' }));
});

/* ---------- building from what is on file -------------------------------- */

test('labels on file come back most-used first, and only the unmatched ones', () => {
  const shifts = [
    { companyId: 'dsi', label: 'SOUTHERN HENS' },
    { companyId: 'dsi', label: 'southern hens' },
    { companyId: 'dsi', label: 'De la Montagne' },
    { companyId: 'dsi', label: 'Already', siteId: 's9' },   // resolved: nothing to ask
    { companyId: 'dsi', label: '   ' }
  ];
  const sug = T.suggestSites(shifts, []);
  assert.deepEqual(sug.map(x => x.name), ['SOUTHERN HENS', 'De la Montagne']);
  assert.equal(sug[0].count, 2);
});

test('the label is read for the place in it, not offered whole', () => {
  // Offering "Cook Plant ASO | SOUTHERN HENS" would file a site under a name
  // with a role stuck to the front, which then matches nothing the next time
  // the same screen is read.
  const shifts = [{ companyId: 'dsi', label: 'Cook Plant ASO | SOUTHERN HENS' },
                  { companyId: 'dsi', label: 'Mobile Guard | SOUTHERN HENS' }];
  const read = l => P.splitLabel(l).site || P.splitLabel(l).role;
  const sug = T.suggestSites(shifts, [], read);
  assert.deepEqual(sug, [{ name: 'SOUTHERN HENS', count: 2 }]);
});

test('a label the table already answers to is not offered again', () => {
  const shifts = [{ companyId: 'dsi', label: 'De Ia Montagme' }];
  assert.deepEqual(T.suggestSites(shifts, [MONT()]), []);      // a near match counts
});

/* ---------- the separator §17.4 preserved, read as §8.1 wants it ---------- */

test('the employer’s pipe is what tells a role from a place', () => {
  // This is the join between the two modules: parser.js keeps the separator,
  // and everything above only ever sees the right-hand side of it.
  const { role, site: place } = P.splitLabel('Cook Plant ASO | SOUTHERN HENS');
  assert.equal(role, 'Cook Plant ASO');
  assert.equal(T.matchSite(place, [HENS()]).how, 'exact');

  // No pipe: no printed boundary, so the whole label is the only candidate.
  const homebase = P.splitLabel('Cook');
  assert.equal(homebase.site, '');
  assert.equal(T.matchSite(homebase.site || homebase.role, [HENS()]).site, null);
});
