/* Calendar writer tests. Run with:  npm test
 *
 * §14.7 asks for these before the Worker is written, "because they are the
 * part where a bug is silent", and the extraction proved the point on its way
 * out: `buildICS` had been writing "[object Object]" into every UID, SUMMARY,
 * DESCRIPTION and LOCATION line since the Setup screen grew its own global
 * called `fold`. The file still parsed, still held the right number of events,
 * and every one of them was unreadable. Nothing caught it, because nothing was
 * looking. The first test below is the one that would have.
 *
 * DTSTAMP is pinned everywhere. Without it these compare against the clock.
 */
const test = require('node:test');
const assert = require('node:assert');
const F = require('../feed.js');
const I = require('../ics.js');

const NOW = { now: new Date('2026-09-03T12:00:00Z') };

const store = (over = {}) => ({
  companies: [{ id: 'c1', name: 'Trupoint' }],
  sites: [{ id: 's1', name: 'Rosemont Station', address: '9501 W Devon Ave' }],
  roles: [{ id: 'r1', name: 'Security Officer' }],
  settings: { leads: [] },
  shifts: [],
  ...over
});

const shift = (over = {}) => ({
  id: 'sh1', companyId: 'c1', date: '2026-09-04',
  start: '19:00', end: '07:00', siteId: 's1', roleId: 'r1', ...over
});

const lines = t => t.split('\r\n');
const lineStarting = (t, k) => lines(t).find(l => l.startsWith(k));

/* ---------- the bug that started this ------------------------------------ */

test('no property line is written as a stringified object', () => {
  const s = store({ sites: [{ id: 's1', name: 'A very long site name that will certainly need folding across lines', address: '9501 West Devon Avenue, Rosemont, Illinois' }] });
  const out = F.feedICS([shift()], s, NOW);
  assert.ok(!/\[object /.test(out), 'a collaborator resolved to the wrong global');
  assert.match(lineStarting(out, 'UID:'), /^UID:sh1@shiftdeck$/);
  assert.ok(lineStarting(out, 'SUMMARY:'), 'SUMMARY is present');
  assert.ok(lineStarting(out, 'LOCATION:'), 'LOCATION is present');
});

test('long lines are folded at 75 octets, not left whole', () => {
  const s = store({ sites: [{ id: 's1', name: 'Gare Centrale — Montréal, quai des arrivées côté est', address: 'Rue de la Gauchetière Ouest' }] });
  const out = F.feedICS([shift()], s, NOW);
  for(const l of lines(out)){
    assert.ok(Buffer.byteLength(l, 'utf8') <= 75, `line over 75 octets: ${l}`);
  }
  // And it still reads back as one value.
  assert.match(I.unfold(out), /SUMMARY:[^\r\n]*Montréal/);
});

/* ---------- the file itself ---------------------------------------------- */

test('an empty list is still a valid, empty calendar', () => {
  const out = F.feedICS([], store(), NOW);
  assert.match(out, /^BEGIN:VCALENDAR\r\n/);
  assert.match(out, /\r\nEND:VCALENDAR$/);
  assert.equal((out.match(/BEGIN:VEVENT/g) || []).length, 0);
});

test('an overnight shift ends on the next day', () => {
  const out = F.feedICS([shift({ date: '2026-09-04', start: '19:00', end: '07:00' })], store(), NOW);
  assert.equal(lineStarting(out, 'DTSTART:'), 'DTSTART:20260904T190000');
  assert.equal(lineStarting(out, 'DTEND:'),   'DTEND:20260905T070000');
});

test('a shift that ends the same day does not roll over', () => {
  const out = F.feedICS([shift({ start: '07:00', end: '19:00' })], store(), NOW);
  assert.equal(lineStarting(out, 'DTEND:'), 'DTEND:20260904T190000');
});

test('a month boundary rolls the date, not just the day number', () => {
  const out = F.feedICS([shift({ date: '2026-09-30', start: '19:00', end: '07:00' })], store(), NOW);
  assert.equal(lineStarting(out, 'DTEND:'), 'DTEND:20261001T070000');
});

test('the day rolls the same way whatever the runtime zone is', () => {
  // The Worker runs in UTC and the phone does not. A DTEND that moved with
  // the machine would be an hour and a date out for half the year.
  const before = process.env.TZ;
  const run = tz => { process.env.TZ = tz; return F.nextDay('2026-09-30'); };
  try {
    assert.equal(run('UTC'), '2026-10-01');
    assert.equal(run('Pacific/Kiritimati'), '2026-10-01');
    assert.equal(run('Pacific/Midway'), '2026-10-01');
  } finally { process.env.TZ = before; }
});

test('SEQUENCE carries the shift revision so a move is not ignored', () => {
  const out = F.feedICS([shift({ seq: 3 })], store(), NOW);
  assert.equal(lineStarting(out, 'SEQUENCE:'), 'SEQUENCE:3');
  assert.equal(lineStarting(F.feedICS([shift()], store(), NOW), 'SEQUENCE:'), 'SEQUENCE:0');
});

test('DTSTAMP is the stamp it was handed', () => {
  assert.equal(lineStarting(F.feedICS([shift()], store(), NOW), 'DTSTAMP:'), 'DTSTAMP:20260903T120000Z');
});

/* ---------- what the event says ------------------------------------------ */

test('a rota proposal says so in its title', () => {
  const out = F.feedICS([shift({ source: 'pattern' })], store(), NOW);
  assert.match(I.unfold(out), /SUMMARY:[^\r\n]*\(from the rota\)/);
  const firm = F.feedICS([shift()], store(), NOW);
  assert.ok(!/from the rota/.test(I.unfold(firm)));
});

test('the description gives the length of the shift', () => {
  const out = I.unfold(F.feedICS([shift({ start: '19:00', end: '07:30' })], store(), NOW));
  assert.match(out, /DESCRIPTION:12h 30m scheduled/);
});

test('commas and semicolons in a name are escaped, not left to split the line', () => {
  const s = store({ sites: [{ id: 's1', name: 'Rosemont, Gate 3; north', address: '' }] });
  const out = I.unfold(F.feedICS([shift()], s, NOW));
  const summary = out.split('\n').find(l => l.startsWith('SUMMARY:'));
  assert.ok(summary.includes('\\,'), 'comma escaped');
  assert.ok(summary.includes('\;'), 'semicolon escaped');
});

/* ---------- alarms -------------------------------------------------------- */

test('each lead time gets its own alarm, and zero gets none', () => {
  const out = F.feedICS([shift()], store({ settings: { leads: [2, 12] } }), NOW);
  assert.deepEqual(lines(out).filter(l => l.startsWith('TRIGGER:')), ['TRIGGER:-PT2H', 'TRIGGER:-PT12H']);
  const none = F.feedICS([shift()], store({ settings: { leads: [0] } }), NOW);
  assert.equal((none.match(/BEGIN:VALARM/g) || []).length, 0);
});

test('a short rest warns against the whole store, not just the shifts being sent', () => {
  // §14.7's reason for taking the whole store: in manual-import mode the
  // shift on the other side of the gap is routinely not in `only`.
  const a = shift({ id: 'a', date: '2026-09-04', start: '19:00', end: '07:00' });
  const b = shift({ id: 'b', date: '2026-09-05', start: '14:00', end: '23:00' });
  const out = I.unfold(F.feedICS([b], store({ shifts: [a, b] }), NOW));
  assert.match(out, /Only 7h off before this one/);
  assert.match(out, /Heads up: only 7h off between shifts/);

  // Handed only `b` as the store, there is no pair and so no warning.
  const alone = I.unfold(F.feedICS([b], store({ shifts: [b] }), NOW));
  assert.ok(!/Heads up/.test(alone));
});

/* ---------- colour -------------------------------------------------------- */

test("each event carries its job's colour as a CSS3 name", () => {
  const s = store({ companies: [{ id: 'c1', name: 'Trupoint', color: '#2F4B7C' }] });
  assert.equal(lineStarting(F.feedICS([shift()], s, NOW), 'COLOR:'), 'COLOR:steelblue');
});

test('two jobs on the one calendar get their own two colours', () => {
  // The whole reason for the property. One feed, one subscription, and until
  // now one colour for both employers.
  const s = store({
    companies: [{ id: 'c1', name: 'Trupoint', color: '#2F4B7C' },
                { id: 'c2', name: 'DSI', color: '#B0631A' }],
    shifts: []
  });
  const rows = [shift(), shift({ id: 'sh2', companyId: 'c2', date: '2026-09-05' })];
  const got = lines(F.feedICS(rows, s, NOW)).filter(l => l.startsWith('COLOR:'));
  assert.deepEqual(got, ['COLOR:steelblue', 'COLOR:peru']);
});

test('a job with no colour gets no COLOR line at all', () => {
  // Every store in the tests above is this case, and every calendar written
  // before §39 was too. An empty COLOR: would be a malformed line in all of
  // them, which is a worse calendar than the one with no colours in it.
  const out = F.feedICS([shift()], store(), NOW);
  assert.ok(!/COLOR/.test(out), 'no colour to give, so nothing written');
  const junk = store({ companies: [{ id: 'c1', name: 'Trupoint', color: 'not a colour' }] });
  assert.ok(!/COLOR/.test(F.feedICS([shift()], junk, NOW)));
});

test('the colour does not replace the job name in the title', () => {
  // §25: colour alone cannot carry a distinction, and a client that ignores
  // COLOR — which is most of them — has to lose nothing by it.
  const s = store({ companies: [{ id: 'c1', name: 'Trupoint', color: '#2F4B7C' }] });
  assert.match(I.unfold(F.feedICS([shift()], s, NOW)), /SUMMARY:[^\r\n]*Trupoint/);
});

/* ---------- the helpers it owns ------------------------------------------ */

test('durMins treats end <= start as overnight', () => {
  assert.equal(F.durMins({ start: '19:00', end: '07:00' }), 720);
  assert.equal(F.durMins({ start: '07:00', end: '19:00' }), 720);
  assert.equal(F.durMins({ start: '19:00', end: '19:00' }), 1440);
});

test('fmtDur drops a zero minutes part', () => {
  assert.equal(F.fmtDur(720), '12h');
  assert.equal(F.fmtDur(750), '12h 30m');
  assert.equal(F.fmtDur(45), '0h 45m');
});
