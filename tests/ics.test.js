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
