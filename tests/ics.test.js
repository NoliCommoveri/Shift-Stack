/* Calendar reader tests. Run with:  npm test
 *
 * Same two kinds as the parser tests:
 *
 *   1. Unit tests for the pieces — line unfolding, parameters, time zones,
 *      durations, labels. These are about the file format and calendar
 *      arithmetic, so they hold whatever any employer's feed turns out to
 *      look like.
 *
 *   2. Golden fixtures. Each tests/fixtures/calendar/NAME.ics is calendar text
 *      as a real feed produced it; NAME.expected.json is what the reader
 *      should make of it. UPDATE=1 regenerates them, and — as with the parser
 *      fixtures — what it records is what the reader currently does, not what
 *      it ought to do. Read the JSON before committing it.
 *
 * Every test pins an output zone. Without one the answers would depend on the
 * TZ of whatever machine ran them, which is the sort of test that passes for
 * a year and then fails on someone else's laptop.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const I = require('../ics.js');

const ZONE = 'America/Chicago';          // where the stations are
const FIX = path.join(__dirname, 'fixtures', 'calendar');
const UPDATE = process.env.UPDATE === '1';

/* ---------- the file format ---------------------------------------------- */

test('folded lines are joined back together', () => {
  assert.equal(I.unfold('SUMMARY:Secur\r\n ity Officer'), 'SUMMARY:Security Officer');
  assert.equal(I.unfold('SUMMARY:Secur\n\tity Officer'), 'SUMMARY:Security Officer');
  // A blank line is not a fold and must not swallow the next line.
  assert.equal(I.unfold('A:1\r\nB:2'), 'A:1\nB:2');
});

test('a property splits into name, parameters and value', () => {
  const cl = I.contentLine('DTSTART;TZID=America/Chicago;VALUE=DATE-TIME:20260903T061500');
  assert.equal(cl.name, 'DTSTART');
  assert.equal(cl.params.TZID, 'America/Chicago');
  assert.equal(cl.value, '20260903T061500');

  // A colon inside a quoted parameter is not the value separator.
  const q = I.contentLine('ATTENDEE;CN="Carson, C:harles":mailto:c@example.com');
  assert.equal(q.params.CN, 'Carson, C:harles');
  assert.equal(q.value, 'mailto:c@example.com');

  assert.equal(I.contentLine('no colon here'), null);
});

test('escaped text comes back as it was written', () => {
  assert.equal(I.unescapeText('Headquarters\\, 401 Main St'), 'Headquarters, 401 Main St');
  assert.equal(I.unescapeText('one\\ntwo'), 'one\ntwo');
  assert.equal(I.unescapeText('a\;b\\\\c'), 'a;b\\c');
});

test('durations convert to minutes', () => {
  assert.equal(I.parseDuration('PT8H'), 480);
  assert.equal(I.parseDuration('PT4H30M'), 270);
  assert.equal(I.parseDuration('P1DT2H'), 1560);
  assert.equal(I.parseDuration('PT45S'), 1);      // rounded, not dropped
  assert.equal(I.parseDuration('nonsense'), null);
});

/* ---------- time --------------------------------------------------------- */

test('a UTC time lands on the right wall clock', () => {
  // 00:15Z on 5 September is 19:15 on the 4th in Chicago, on daylight time.
  const r = I.resolve(I.parseDT('20260905T001500Z', {}), ZONE);
  assert.deepEqual(r.parts, { y: 2026, mo: 8, d: 4, h: 19, mi: 15 });
});

test('a zoned wall time is not shifted when the zones agree', () => {
  const t = I.parseDT('20260903T061500', { TZID: ZONE });
  const r = I.resolve(t, ZONE);
  assert.deepEqual(r.parts, { y: 2026, mo: 8, d: 3, h: 6, mi: 15 });
  assert.ok(!r.floating);
});

test('a zoned wall time crosses into another zone correctly', () => {
  const t = I.parseDT('20260903T061500', { TZID: 'America/New_York' });
  assert.deepEqual(I.resolve(t, ZONE).parts, { y: 2026, mo: 8, d: 3, h: 5, mi: 15 });
});

test('the hour either side of a daylight-saving change is right', () => {
  // US daylight time ended 1 November 2026 at 02:00 local.
  const before = I.wallToUTC({ y: 2026, mo: 10, d: 1, h: 1, mi: 30, s: 0 }, ZONE);
  const after  = I.wallToUTC({ y: 2026, mo: 10, d: 1, h: 3, mi: 30, s: 0 }, ZONE);
  assert.equal(new Date(before).toISOString(), '2026-11-01T06:30:00.000Z');  // CDT, -5
  assert.equal(new Date(after).toISOString(),  '2026-11-01T09:30:00.000Z');  // CST, -6
});

test('the same feed read on the wrong zone is a shift an hour out', () => {
  // §14.10, stated as the symptom rather than as the arithmetic. Homebase
  // publishes UTC; the Worker fell back to America/Toronto for any job that
  // had not been told its zone, and nothing in the app had ever set one. A
  // 17:00 start in Hattiesburg came out of the cron as 18:00 and every screen
  // agreed with it.
  const t = I.parseDT('20260904T220000Z', {});
  assert.equal(I.resolve(t, 'America/Chicago').parts.h, 17);
  assert.equal(I.resolve(t, 'America/Toronto').parts.h, 18);
});

test('an unrecognised zone is taken at face value and says so', () => {
  const t = I.parseDT('20260903T061500', { TZID: 'Central Standard Time' });
  const r = I.resolve(t, ZONE);
  assert.deepEqual(r.parts, { y: 2026, mo: 8, d: 3, h: 6, mi: 15 });
  assert.ok(r.unknownZone);
});

/* ---------- labels ------------------------------------------------------- */

test('the role and the station both survive into the label', () => {
  assert.equal(I.labelFor('Security Officer', 'Headquarters, 401 Main St, Hattiesburg MS'),
               'Security Officer - Headquarters');
  // The employer's badge on the front says nothing the job picker has not.
  assert.equal(I.labelFor('Homebase: Cook', 'F.O.C.'), 'Cook - F.O.C.');
  // No repeating the place when the title already carries it.
  assert.equal(I.labelFor('Moselle Station', 'Moselle Station'), 'Moselle Station');
  assert.equal(I.labelFor('', 'Benndale Station'), 'Benndale Station');
});

test('a repeating occurrence keeps an identity of its own', () => {
  // Every occurrence of a repeat shares the event's UID. Without the
  // recurrence marker they would all collapse onto one shift.
  assert.equal(I.eventUID({ UID: 'abc@homebase.io' }), 'abc@homebase.io');
  assert.equal(I.eventUID({ UID: 'abc@homebase.io', 'RECURRENCE-ID': '20260910T060000Z' }),
               'abc@homebase.io#20260910T060000Z');
});

/* ---------- whole files -------------------------------------------------- */

const read = f => fs.readFileSync(path.join(FIX, f), 'utf8');
const FEED = 'homebase-google-sync-SYNTHETIC.ics';

test('something that is not a calendar is refused, not half read', () => {
  const { rows, report } = I.parseICS('<html><body>Sign in to continue</body></html>');
  assert.equal(rows.length, 0);
  assert.ok(report.notCalendar);
});

test('an alarm inside an event does not become the event', () => {
  // VALARM has its own DESCRIPTION and TRIGGER. Reading them as the event's
  // would put "Reminder" on the shift row.
  const { rows } = I.parseICS(read(FEED), { zone: ZONE, from: '2026-09-01' });
  assert.ok(rows.every(r => !/Reminder/.test(r.label)));
});

test('an overnight shift keeps both its times and one date', () => {
  const { rows } = I.parseICS(read(FEED), { zone: ZONE, from: '2026-09-01' });
  const night = rows.find(r => r.uid.includes('4471905'));
  assert.equal(night.date, '2026-09-06');
  assert.equal(night.start, '20:00');
  assert.equal(night.end, '06:00');
  assert.equal(night.endDate, '2026-09-07');
  assert.deepEqual(night.flags, []);     // an overnight shift is not a problem
});

test('a cancelled shift is reported rather than imported', () => {
  const { rows, report } = I.parseICS(read(FEED), { zone: ZONE, from: '2026-09-01' });
  assert.ok(rows.every(r => !r.uid.includes('4471907')));
  assert.equal(report.cancelled, 1);
  assert.equal(report.cancelledRows[0].date, '2026-09-09');
  assert.match(report.cancelledRows[0].label, /Bay Springs/);
});

test('all-day entries are dropped instead of being given invented times', () => {
  const { rows, report } = I.parseICS(read(FEED), { zone: ZONE, from: '2026-09-01' });
  assert.ok(rows.every(r => !/birthday/i.test(r.label)));
  assert.equal(report.allDay, 1);
});

test('the window keeps last month out of the review screen', () => {
  const { rows, report } = I.parseICS(read(FEED), { zone: ZONE, from: '2026-09-01' });
  assert.ok(rows.every(r => r.date >= '2026-09-01'));
  assert.equal(report.past, 1);          // the August shift at Moselle

  const all = I.parseICS(read(FEED), { zone: ZONE });
  assert.ok(all.rows.some(r => r.date === '2026-08-12'));
});

test('the filter separates the shifts from the rest of his calendar', () => {
  // Homebase syncs into his personal Google calendar, so the dentist and the
  // birthdays arrive alongside the shifts.
  const { rows, report } = I.parseICS(read(FEED),
    { zone: ZONE, from: '2026-09-01', match: 'station' });
  assert.ok(rows.every(r => /Station/.test(r.label)));
  assert.ok(report.filtered > 0);
});

/* ---------- writing: the cancellation (§10.6, §22) -----------------------
   The failure this guards against is silent by nature. A cancellation with a
   UID that does not match the publication to the character, or a sequence
   number no higher than the one the calendar holds, imports without complaint
   and cancels nothing — and the alarm still goes off at five in the morning.
   Nothing on any screen would say so, which is why it is worth a test rather
   than a look.
   ---------------------------------------------------------------------- */

const DEAD = {
  uid: I.shiftUID('abc-123'), seq: 1,
  date: '2026-09-07', start: '15:00', end: '23:00', endDate: '2026-09-07',
  title: 'DSI- De la Montagne'
};
const cancel = (rows, o = {}) =>
  I.buildCancelICS(rows, Object.assign({ now: '20260903T120000Z' }, o));
const lines = t => t.split('\r\n');

test('the UID is built the one way, so a cancel names what was published', () => {
  // The publish side calls the same function. If it ever stops, this is the
  // test that fails rather than the phone.
  assert.equal(I.shiftUID('abc-123'), 'abc-123@shiftdeck');
  assert.ok(lines(cancel([DEAD])).includes(`UID:${I.shiftUID('abc-123')}`));
});

test('the method is on the calendar and the status is on the event', () => {
  const L = lines(cancel([DEAD]));
  assert.ok(L.includes('METHOD:CANCEL'));
  assert.ok(L.includes('STATUS:CANCELLED'));
  assert.ok(!L.includes('METHOD:PUBLISH'));
});

test('the sequence is carried through, so the revision is newer', () => {
  assert.ok(lines(cancel([DEAD])).includes('SEQUENCE:1'));
  assert.ok(lines(cancel([Object.assign({}, DEAD, { seq: 4 })])).includes('SEQUENCE:4'));
  // Missing or nonsense, and it still has to be a legal integer.
  assert.ok(lines(cancel([Object.assign({}, DEAD, { seq: undefined })])).includes('SEQUENCE:0'));
});

test('no alarms ride along in a cancellation', () => {
  // The alarms are the thing being taken away. An importer that half-reads the
  // file must not be handed a fresh set of them.
  assert.ok(!/VALARM/.test(cancel([DEAD])));
});

test('the times match the floating local form the publish side writes', () => {
  const L = lines(cancel([DEAD]));
  assert.ok(L.includes('DTSTART:20260907T150000'));
  assert.ok(L.includes('DTEND:20260907T230000'));
});

test('an overnight shift ends on the day the record says it does', () => {
  const night = Object.assign({}, DEAD,
    { start: '20:00', end: '04:00', endDate: '2026-09-08' });
  assert.ok(lines(cancel([night])).includes('DTEND:20260908T040000'));
});

test('an entry with no UID is dropped, not guessed at', () => {
  // Without one there is no event to name, and an importer would be free to
  // apply it to whatever it liked.
  const out = cancel([Object.assign({}, DEAD, { uid: '' }), DEAD]);
  assert.equal(out.match(/BEGIN:VEVENT/g).length, 1);
});

test('an empty list still produces a valid, empty calendar', () => {
  const out = cancel([]);
  assert.ok(out.startsWith('BEGIN:VCALENDAR'));
  assert.ok(out.endsWith('END:VCALENDAR'));
  assert.ok(!/BEGIN:VEVENT/.test(out));
});

test('the summary is escaped and folded like any other text line', () => {
  const long = Object.assign({}, DEAD,
    { title: 'DSI- Poste de garde, Montréal; ' + 'x'.repeat(70) });
  const out = cancel([long]);
  // Read it back through the unfolder rather than matching the raw text: the
  // point is that the value survives, not which column it broke at.
  const summary = I.unfold(out).split('\n').find(l => l.startsWith('SUMMARY:'));
  assert.equal(I.unescapeText(summary.slice('SUMMARY:'.length)), long.title);
  // Folded at 75 octets, not characters: the accent is two bytes.
  const enc = new TextEncoder();
  for(const l of lines(out)) assert.ok(enc.encode(l).length <= 75, `over-long: ${l}`);
});

test('what it writes reads back as a cancellation', () => {
  // The reader already knows what a cancelled event is (§13). Round-tripping
  // is the cheapest proof the file is well formed rather than merely the
  // shape this test expected.
  const { rows, report } = I.parseICS(cancel([DEAD]), { zone: ZONE });
  assert.equal(rows.length, 0);
  assert.equal(report.cancelled, 1);
  assert.equal(report.cancelledRows[0].uid, I.shiftUID('abc-123'));
  assert.equal(report.cancelledRows[0].date, '2026-09-07');
});

/* ---------- golden fixtures ---------------------------------------------- */

const feeds = fs.existsSync(FIX)
  ? fs.readdirSync(FIX).filter(f => f.endsWith('.ics')).sort()
  : [];

if(!feeds.length){
  test('calendar fixtures directory has feeds to read', { skip: 'no .ics fixtures yet' }, () => {});
}

for(const feed of feeds){
  test(`fixture: ${feed}`, () => {
    const got = I.parseICS(read(feed), { zone: ZONE, from: '2026-09-01' });
    const goldPath = path.join(FIX, feed.replace(/\.ics$/, '.expected.json'));

    if(UPDATE || !fs.existsSync(goldPath)){
      fs.writeFileSync(goldPath, JSON.stringify(got, null, 2) + '\n');
      if(!UPDATE) assert.fail(
        `No golden file for ${feed}. One has been written to ${path.basename(goldPath)} — ` +
        `read it, correct anything wrong, and commit it.`);
      return;
    }
    assert.deepStrictEqual(got, JSON.parse(fs.readFileSync(goldPath, 'utf8')));
  });
}
