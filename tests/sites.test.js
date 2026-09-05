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
  const m = T.matchName('De la Montagne', [MONT()]);
  assert.equal(m.rec.id, 's1');
  assert.equal(m.how, 'exact');
});

test('a recorded spelling matches exactly, not nearly', () => {
  const m = T.matchName('De Ia Montagme', [MONT(), site('s3', 'Elsewhere', ['De Ia Montagme'])]);
  assert.equal(m.rec.id, 's3');
  assert.equal(m.how, 'exact');
});

test('an exact hit on one site beats a near hit on another', () => {
  // Order matters here: the near match is the first record in the list, so a
  // matcher that took the first plausible answer would get this wrong.
  const m = T.matchName('Southern Hen', [site('s4', 'Southern Hens'), site('s5', 'X', ['Southern Hen'])]);
  assert.equal(m.rec.id, 's5');
  assert.equal(m.how, 'exact');
});

test('OCR damage inside a long name still lands on the site', () => {
  const m = T.matchName('De Ia Montagme', [MONT()]);
  assert.equal(m.rec.id, 's1');
  assert.equal(m.how, 'near');
  assert.equal(m.dist, 2);
});

test('a short spelling has to be exact', () => {
  // "Cook" and "Cort" are two apart, which is most of the word. §8.2's
  // argument applied to names: a check that is confidently wrong is worse than
  // one that says nothing.
  assert.equal(T.matchName('Cort', [site('s6', 'Cook')]).rec, null);
  assert.equal(T.matchName('Cook', [site('s6', 'Cook')]).how, 'exact');
});

test('a different place is not a misreading of this one', () => {
  assert.equal(T.matchName('SOUTHERN HENS', [MONT()]).rec, null);
  assert.equal(T.matchName('SOUTHERN HENS', [MONT()]).how, 'none');
});

test('nothing readable matches nothing', () => {
  assert.equal(T.matchName('', [MONT()]).rec, null);
  assert.equal(T.matchName('  ...  ', [MONT()]).rec, null);
  assert.equal(T.matchName('De la Montagne', []).rec, null);
});

test('an archived site is not matched against, and does not block the read', () => {
  const gone = site('s7', 'De la Montagne', [], { archived: true });
  assert.equal(T.matchName('De la Montagne', [gone]).rec, null);
  // …but a live site of a similar name still wins, rather than being shadowed.
  assert.equal(T.matchName('De la Montagne', [gone, MONT()]).rec.id, 's1');
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
  assert.equal(T.matchName('De Ia Montagme', [s]).how, 'near');
  T.addAlias(s, 'De Ia Montagme');
  assert.equal(T.matchName('De Ia Montagme', [s]).how, 'exact');
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
  // The label still holds the OCR damage; nothing on screen does. The label
  // also still reads role-first, because that is the order the employer
  // printed it in — what comes out reads place-first, which is the point.
  const sh = { label: 'Cook Plant ASO | S0UTHERN HEN5', role: 'Cook Plant ASO' };
  assert.equal(T.eventTitle('DSI', sh, HENS()), 'DSI- SOUTHERN HENS | Cook Plant ASO');
  assert.equal(T.whereText(sh, HENS(), ' · '), 'SOUTHERN HENS · Cook Plant ASO');
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
  const sug = T.suggestNames(shifts, []);
  assert.deepEqual(sug.map(x => x.name), ['SOUTHERN HENS', 'De la Montagne']);
  assert.equal(sug[0].count, 2);
});

test('the label is read for the place in it, not offered whole', () => {
  // Offering "Cook Plant ASO | SOUTHERN HENS" would file a site under a name
  // with a role stuck to the front, which then matches nothing the next time
  // the same screen is read.
  const shifts = [{ companyId: 'dsi', label: 'Cook Plant ASO | SOUTHERN HENS' },
                  { companyId: 'dsi', label: 'Mobile Guard | SOUTHERN HENS' }];
  const read = s => P.splitLabel(s.label).site || P.splitLabel(s.label).role;
  const sug = T.suggestNames(shifts, [], read);
  assert.deepEqual(sug, [{ name: 'SOUTHERN HENS', count: 2 }]);
});

test('a label the table already answers to is not offered again', () => {
  const shifts = [{ companyId: 'dsi', label: 'De Ia Montagme' }];
  assert.deepEqual(T.suggestNames(shifts, [MONT()]), []);      // a near match counts
});

/* ---------- the separator §17.4 preserved, read as §8.1 wants it ---------- */

test('the employer’s pipe is what tells a role from a place', () => {
  // This is the join between the two modules: parser.js keeps the separator,
  // and everything above only ever sees the right-hand side of it.
  const { role, site: place } = P.splitLabel('Cook Plant ASO | SOUTHERN HENS');
  assert.equal(role, 'Cook Plant ASO');
  assert.equal(T.matchName(place, [HENS()]).how, 'exact');

  // No pipe: no printed boundary, so the whole label is the only candidate.
  const homebase = P.splitLabel('Cook');
  assert.equal(homebase.site, '');
  assert.equal(T.matchName(homebase.site || homebase.role, [HENS()]).rec, null);
});

/* ---------- the role table (§27) -----------------------------------------
   The same machinery pointed at a second list, so what is worth stating here
   is not that matching works — the cases above already say that — but the
   things a role does that a site does not: it carries a rate, that rate
   survives a merge in the right direction, and a matched role can name a
   shift with no place beside it at all. */

const role = (id, name, rate = null, aliases = [], extra = {}) =>
  Object.assign({ id, companyId: 'hb', name, rate, aliases, archived: false }, extra);

test('a new role holds the rate it was given, and empty is not zero', () => {
  assert.equal(T.newRole('r1', 'hb', 'Cook', 18.5).rate, 18.5);
  assert.equal(T.newRole('r2', 'hb', 'Cook', '').rate, null);
  assert.equal(T.newRole('r3', 'hb', 'Cook').rate, null);
  // Zero is a real answer and has to survive being one.
  assert.equal(T.newRole('r4', 'hb', 'Volunteer', 0).rate, 0);
});

test('the role’s rate wins, the job’s stands in, and null means neither', () => {
  const co = { rate: 15 };
  assert.equal(T.rateFor({}, role('r1', 'Cook', 18.5), co), 18.5);
  assert.equal(T.rateFor({}, role('r1', 'Dishwasher', null), co), 15);
  assert.equal(T.rateFor({}, null, co), 15);
  assert.equal(T.rateFor({}, null, {}), null);
  assert.equal(T.rateFor({}, role('r1', 'Cook', 0), co), 0);   // not the job's 15
});

test('the same misreadings that find a site find a role', () => {
  const m = T.matchName('Mobiie Guard', [role('r1', 'Mobile Guard', 22)]);
  assert.equal(m.rec.id, 'r1');
  assert.equal(m.how, 'near');
});

test('merging roles takes a rate only when there is none already', () => {
  // The dangerous direction. Merging two spellings of one job title must never
  // quietly change what an hour of the surviving one is worth.
  const keep = role('r1', 'Cook', 18.5), gone = role('r2', 'C00k', 9);
  const r = T.mergeRoles([keep, gone], 'r2', 'r1');
  assert.equal(r.roles.length, 1);
  assert.equal(keep.rate, 18.5);
  assert.ok(T.spellings(keep).includes('C00k'));

  const blank = role('r3', 'Prep', null), paid = role('r4', 'Prep Cook', 16);
  T.mergeRoles([blank, paid], 'r4', 'r3');
  assert.equal(blank.rate, 16);
});

test('a matched role names a shift that has no place beside it', () => {
  // Homebase prints "Cook" and no site at all. Before there was a role table
  // there was nothing to curate and the label was all there was.
  const sh = { label: 'C00k', role: 'C00k' };
  assert.equal(T.whereText(sh, null, ' · '), 'C00k');                       // as it was
  assert.equal(T.whereText(sh, null, ' · ', role('r1', 'Cook')), 'Cook');   // curated
});

test('with a site and a role, the curated spelling of each is what reads', () => {
  const sh = { label: 'Cook Plant ASO | SOUTHERN HENS', role: 'Cook Plant AS0' };
  const out = T.whereText(sh, HENS(), ' · ', role('r1', 'Cook Plant ASO'));
  assert.equal(out, 'SOUTHERN HENS · Cook Plant ASO');
  assert.equal(T.eventTitle('DSI', sh, HENS(), role('r1', 'Cook Plant ASO')),
               'DSI- SOUTHERN HENS | Cook Plant ASO');
});

test('the place leads and the role follows, whatever order the label came in', () => {
  // The employer prints "role | place" and parser.js still reads it that way;
  // this is the other end, where the string is scanned rather than parsed. A
  // schedule row and a phone alert both cut off at the right, so the half that
  // says which site he is driving to goes first (app.js shiftWhere, feed.js).
  const sh = { label: 'Cook Plant ASO | SOUTHERN HENS', role: 'Cook Plant ASO' };
  assert.equal(T.whereText(sh, HENS(), ' · '), 'SOUTHERN HENS · Cook Plant ASO');
  assert.equal(T.eventTitle('DSI', sh, HENS()), 'DSI- SOUTHERN HENS | Cook Plant ASO');
  // Either half alone is unchanged: there is no order to swap.
  assert.equal(T.whereText({ label: 'x', role: '' }, HENS(), ' · '), 'SOUTHERN HENS');
  assert.equal(T.whereText({ label: 'C00k', role: 'C00k' }, null, ' · ',
                           role('r1', 'Cook')), 'Cook');
});

test('a title with no records at all is byte-identical to before either table', () => {
  const sh = { label: 'Cook Plant ASO | SOUTHERN HENS' };
  assert.equal(T.eventTitle('DSI', sh, null), 'DSI- Cook Plant ASO | SOUTHERN HENS');
  assert.equal(T.eventTitle('DSI', sh, null, null), 'DSI- Cook Plant ASO | SOUTHERN HENS');
});

test('the role is part of what makes two rows the same shift', () => {
  // A feed that moves him from Cook to Dishwasher at the same site and hour
  // has changed what the night is worth, and a comparison that ignored it
  // would call that unchanged and leave the old rate against it.
  const a = { siteId: 's1', roleId: 'r1' }, b = { siteId: 's1', roleId: 'r2' };
  assert.notEqual(T.whereKey(a), T.whereKey(b));
  assert.equal(T.whereKey(a), T.whereKey({ siteId: 's1', roleId: 'r1' }));
  // A site with no role is unchanged from §8.1's behaviour.
  assert.equal(T.whereKey({ siteId: 's1' }), T.whereKey({ siteId: 's1', roleId: null }));
  assert.notEqual(T.whereKey({ siteId: 's1' }), T.whereKey({ label: 'x' }));
});

test('roles build from the labels on file, held apart from the sites', () => {
  const shifts = [
    { companyId: 'dsi', label: 'Cook Plant ASO | SOUTHERN HENS' },
    { companyId: 'dsi', label: 'Cook Plant ASO | SOUTHERN HENS' },
    { companyId: 'dsi', label: 'Mobile Guard | SOUTHERN HENS', roleId: 'r9' }
  ];
  const readRole = s => P.splitLabel(s.label).role;
  const sug = T.suggestNames(shifts, [], readRole, s => s.roleId);
  assert.deepEqual(sug, [{ name: 'Cook Plant ASO', count: 2 }]);
});

/* ---------- which table a label is talking to (§27) -----------------------
   The one genuinely new decision the role table forced. With the employer's
   pipe there is nothing to decide; without it, "Cook" could be a job title or
   a place, and something has to choose. These are the six cases, driven
   through the real app in a browser before they were written down here. */

const HB_ROLES = () => [role('r1', 'Cook', 18), role('r2', 'Dishwasher', null)];
const HB_SITES = () => [site('st1', 'Headquarters')];
const read = label => T.readLabel(label, HB_SITES(), HB_ROLES(), P.splitLabel);

test('the pipe settles it, and nothing is asked of the tables', () => {
  assert.deepEqual(read('Cook | Headquarters'), { roleRaw: 'Cook', siteRaw: 'Headquarters' });
  // Even when neither side is a record either table has heard of.
  assert.deepEqual(read('Prep | Elsewhere'), { roleRaw: 'Prep', siteRaw: 'Elsewhere' });
});

test('with no pipe, an exact hit decides which table it was', () => {
  assert.deepEqual(read('Cook'), { roleRaw: 'Cook', siteRaw: '' });
  assert.deepEqual(read('Headquarters'), { roleRaw: '', siteRaw: 'Headquarters' });
});

test('with no pipe, a near hit decides it too', () => {
  assert.deepEqual(read('Dishwaher'), { roleRaw: 'Dishwaher', siteRaw: '' });
  assert.deepEqual(read('Headquartars'), { roleRaw: '', siteRaw: 'Headquartars' });
});

test('an exact hit on one table beats a near hit on the other', () => {
  // The ordering that matters: a role spelled exactly must not lose to a site
  // that is three characters of OCR damage away from the same string.
  const sites = [site('st2', 'Cooke Street')], roles = [role('r1', 'Cook', 18)];
  assert.deepEqual(T.readLabel('Cook', sites, roles, P.splitLabel),
                   { roleRaw: 'Cook', siteRaw: '' });
});

test('matching neither leaves it where §8.1 left it, as a site candidate', () => {
  // Unchanged behaviour, and deliberately: the label still files as the text
  // that was read, and the site suggestion list is still where it turns up.
  assert.deepEqual(read('Something Else'), { roleRaw: '', siteRaw: 'Something Else' });
  assert.deepEqual(read('   '), { roleRaw: '', siteRaw: '' });
});

test('a job with no roles declared behaves exactly as it did before §27', () => {
  // The tie-break earns its keep here. An empty role table can only ever
  // return 'none', so every label goes to the site side, which is what the
  // app did when the site table was the only one there was.
  for(const label of ['Cook', 'Headquarters', 'Headquartars', 'Anything At All'])
    assert.equal(T.readLabel(label, HB_SITES(), [], P.splitLabel).roleRaw, '');
});

/* ---------- resolving a whole row (§36) ----------------------------------
   One function, two callers: the page's `applyNames` and the Worker's cron.
   The cron used to do its own thing — the whole label against the site table,
   and a `role` field a feed row does not carry against the roles — so a shift
   the server filed resolved to neither table while the same shift imported by
   hand resolved to both. It showed up as a night paid at the job's rate
   instead of the role's (§27) and a title made of raw text.
   ------------------------------------------------------------------------ */

const TP_SITES = () => [site('st9', 'F.O.C.')];
const TP_ROLES = () => [role('r9', 'Security Officer', 22.5)];
const resolve = label =>
  T.resolveNames({ label }, TP_SITES(), TP_ROLES(), P.splitLabel);

test('a feed label resolves both halves against both tables', () => {
  // What Homebase's own calendar now reads as: the role out of the event's
  // description, the station out of its summary, and the street address left
  // where it belongs, on the event.
  const r = resolve('Security Officer | F.O.C.');
  assert.equal(r.roleId, 'r9');
  assert.equal(r.siteId, 'st9');
  assert.equal(r.role, 'Security Officer');
  assert.equal(r.roleHow, 'exact');
  assert.equal(r.siteHow, 'exact');
});

test('the curated spelling wins over the one the feed wrote', () => {
  const roles = [role('r9', 'Security Officer', 22.5)];
  roles[0].aliases = ['Security Agent'];
  const r = T.resolveNames({ label: 'Security Agent | F.O.C.' }, TP_SITES(), roles, P.splitLabel);
  assert.equal(r.roleId, 'r9');
  assert.equal(r.role, 'Security Officer', 'the table says what the role is called');
  assert.equal(r.roleRaw, 'Security Agent', 'and what was read is kept, for the alias');
});

test('a half that matches nothing files as the text that was read', () => {
  // §8.1's rule, unchanged: a row nobody has a record for still files.
  const r = resolve('Prep Cook | Somewhere New');
  assert.equal(r.roleId, null);
  assert.equal(r.siteId, null);
  assert.equal(r.role, 'Prep Cook');
  assert.equal(r.siteRaw, 'Somewhere New');
});

test('a label with no separator still goes to whichever table knows it', () => {
  assert.equal(resolve('F.O.C.').siteId, 'st9');
  assert.equal(resolve('F.O.C.').roleId, null);
  assert.equal(resolve('Security Officer').roleId, 'r9');
  assert.equal(resolve('Security Officer').siteId, null);
});
