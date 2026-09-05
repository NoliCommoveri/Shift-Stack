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
  // The pipe and not a dash: §17.4's separator is what `splitLabel` trusts and
  // what the site and role tables split on. Joined with anything else the whole
  // label arrives at both tables as one string and matches neither.
  assert.equal(I.labelFor('Security Officer', 'Headquarters, 401 Main St, Hattiesburg MS'),
               'Security Officer | Headquarters');
  // The employer's badge on the front says nothing the job picker has not.
  assert.equal(I.labelFor('Homebase: Cook', 'F.O.C.'), 'Cook | F.O.C.');
  // No repeating the place when the title already carries it.
  assert.equal(I.labelFor('Moselle Station', 'Moselle Station'), 'Moselle Station');
  assert.equal(I.labelFor('', 'Benndale Station'), 'Benndale Station');
});

test('a street line is an address, not the name of a place', () => {
  // What Ray's calendar actually holds: Homebase puts the station in SUMMARY
  // and the street in LOCATION, and the reader was putting the street in the
  // title — "Tru-Point- F.O.C. - 3492 Hwy 42", with the address said twice and
  // the role not said at all. The address is already on the event, tappable.
  assert.equal(I.placeName('3492 Hwy 42\nHattiesburg, MS 39402'), '');
  assert.equal(I.placeName('Headquarters, 401 Main St, Hattiesburg MS'), 'Headquarters');
  assert.equal(I.placeName('Purvis Gen Station'), 'Purvis Gen Station');
});

test('the role comes out of the description, and only when it is one', () => {
  // Homebase's own sync writes the job title here and nothing else.
  assert.equal(I.roleFrom('Security Officer'), 'Security Officer');
  assert.equal(I.roleFrom('Site Supervisor\nsome other line'), 'Site Supervisor');
  // Everything else a feed puts in a description is not a role. Refusing them
  // leaves the row exactly as it read before, which is the safe direction: a
  // wrong role is filed against a rate (§27), a missing one is a row he names.
  assert.equal(I.roleFrom('Shift published by Homebase.'), '');
  assert.equal(I.roleFrom('12h scheduled'), '');
  assert.equal(I.roleFrom('Only 6h 45m off before this one.'), '');
  assert.equal(I.roleFrom('<b>Details</b>'), '');
  assert.equal(I.roleFrom(''), '');
});

test('Homebase\u2019s three fields come out as role, place and address', () => {
  // The whole of the second half of §36, in one event: the station in SUMMARY
  // behind a badge, the street in LOCATION, the role in DESCRIPTION.
  assert.equal(I.labelFor('Shift: F.O.C.', '3492 Hwy 42\nHattiesburg, MS 39402',
                          'Security Officer'),
               'Security Officer | F.O.C.');
  // A description that is a role and a location that is a place: the title is
  // then the same role twice, and is dropped rather than repeated.
  assert.equal(I.labelFor('Homebase: Security Officer', 'Purvis Gen Station',
                          'Security Officer'),
               'Security Officer | Purvis Gen Station');
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

/* ---------- colour ------------------------------------------------------- */

test('a hex the CSS3 list actually has comes back by name', () => {
  assert.equal(I.icsColor('#ff0000'), 'red');
  assert.equal(I.icsColor('#000080'), 'navy');
  assert.equal(I.icsColor('4682B4'), 'steelblue');     // no leading #
  assert.equal(I.icsColor('#0F0'), 'lime');            // three digits
});

test('anything that is not a colour gets no name, so no property is written', () => {
  // The caller writes the line only if this returns something. A COLOR with a
  // hex in it, or with nothing in it, is a value RFC 7986 does not allow.
  for(const junk of ['', null, undefined, 'rebeccapurple', '#12345', 'steelblue', '#nothex'])
    assert.equal(I.icsColor(junk), '', `${JSON.stringify(junk)} should name no colour`);
});

test('the Setup palette gives five jobs five different colours', () => {
  // The point of the whole property. Two jobs that come out the same name are
  // two jobs the calendar cannot tell apart, which is the state before this
  // existed — and it is what nearest-in-RGB actually did to this palette: the
  // navy and the plum both answered darkslateblue.
  const palette = ['#2F4B7C', '#B0631A', '#2F6B4F', '#7A3B69', '#8A2E2E'];
  const names = palette.map(I.icsColor);
  assert.ok(names.every(Boolean), 'every palette entry names a colour');
  assert.equal(new Set(names).size, palette.length, `collided: ${names.join(', ')}`);
});

test('the name is one a client can look up, not one this file invented', () => {
  // ICSx\u2075 matches the value against its own CSS3 table and drops what it
  // cannot find, silently. A typo in the table here would be invisible.
  const css3 = new Set(['aliceblue','antiquewhite','aqua','aquamarine','azure','beige','bisque',
    'black','blanchedalmond','blue','blueviolet','brown','burlywood','cadetblue','chartreuse',
    'chocolate','coral','cornflowerblue','cornsilk','crimson','darkblue','darkcyan','darkgoldenrod',
    'darkgray','darkgreen','darkkhaki','darkmagenta','darkolivegreen','darkorange','darkorchid',
    'darkred','darksalmon','darkseagreen','darkslateblue','darkslategray','darkturquoise',
    'darkviolet','deeppink','deepskyblue','dimgray','dodgerblue','firebrick','floralwhite',
    'forestgreen','fuchsia','gainsboro','ghostwhite','gold','goldenrod','gray','green',
    'greenyellow','honeydew','hotpink','indianred','indigo','ivory','khaki','lavender',
    'lavenderblush','lawngreen','lemonchiffon','lightblue','lightcoral','lightcyan',
    'lightgoldenrodyellow','lightgray','lightgreen','lightpink','lightsalmon','lightseagreen',
    'lightskyblue','lightslategray','lightsteelblue','lightyellow','lime','limegreen','linen',
    'maroon','mediumaquamarine','mediumblue','mediumorchid','mediumpurple','mediumseagreen',
    'mediumslateblue','mediumspringgreen','mediumturquoise','mediumvioletred','midnightblue',
    'mintcream','mistyrose','moccasin','navajowhite','navy','oldlace','olive','olivedrab',
    'orange','orangered','orchid','palegoldenrod','palegreen','paleturquoise','palevioletred',
    'papayawhip','peachpuff','peru','pink','plum','powderblue','purple','red','rosybrown',
    'royalblue','saddlebrown','salmon','sandybrown','seagreen','seashell','sienna','silver',
    'skyblue','slateblue','slategray','snow','springgreen','steelblue','tan','teal','thistle',
    'tomato','turquoise','violet','wheat','white','whitesmoke','yellow','yellowgreen']);
  // Every entry in the table has to be in that set, and the way to reach them
  // all is to ask for each one exactly.
  const src = fs.readFileSync(path.join(__dirname, '..', 'ics.js'), 'utf8');
  const table = /const CSS3_NAMES = \{([\s\S]*?)\n\};/.exec(src);
  assert.ok(table, 'the colour table is still where this test looks for it');
  const entries = [...table[1].matchAll(/([a-z]+):0x([0-9a-f]{6})/g)];
  assert.equal(entries.length, 138, 'the CSS3 list, minus the duplicate spellings');
  for(const [, name, hex] of entries){
    assert.ok(css3.has(name), `${name} is not a CSS3 colour keyword`);
    assert.equal(I.icsColor('#' + hex), name, `${name} does not answer to its own hex`);
  }
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
