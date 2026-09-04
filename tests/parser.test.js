/* Parser tests. Run with:  npm test
 *
 * Two kinds of test here:
 *
 *   1. Unit tests for the small helpers. These are about calendar arithmetic
 *      and text shape, so they hold regardless of what the real screenshots
 *      turn out to look like.
 *
 *   2. Golden fixtures. Each tests/fixtures/NAME.txt is raw text as the OCR
 *      produced it; NAME.expected.json is what the parser should make of it.
 *      To add one: drop the raw text in, run
 *
 *          npm run test:update
 *
 *      then READ the generated .json before committing it. The update mode
 *      records what the parser currently does, which is not the same as what
 *      it should do — it is a typing shortcut, not a source of truth.
 *
 * Fixture dates are resolved against a pinned NOW so a fixture without an
 * explicit year does not start failing next January.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../parser.js');

const NOW = new Date('2026-09-03T12:00:00');
const FIX = path.join(__dirname, 'fixtures');
const UPDATE = process.env.UPDATE === '1';

/* ---------- helpers ------------------------------------------------------ */

test('to24 converts 12-hour times', () => {
  assert.equal(P.to24('9', '00', 'am'), '09:00');
  assert.equal(P.to24('9', '00', 'pm'), '21:00');
  assert.equal(P.to24('12', '00', 'am'), '00:00');   // midnight, not noon
  assert.equal(P.to24('12', '30', 'pm'), '12:30');   // noon stays noon
  assert.equal(P.to24('7', '45', null), '07:45');    // no marker: taken as read
  assert.equal(P.to24('25', '00', null), null);      // out of range
});

/* The three fields where a time is typed rather than read (§24). These are
   about what a person means by what he typed, so they are worth stating as
   cases in a way the browser's own time control never let us. */
test('parseClock reads a typed time as 24-hour', () => {
  assert.equal(P.parseClock('9'), '09:00');       // nine in the morning
  assert.equal(P.parseClock('21'), '21:00');      // nine at night
  assert.equal(P.parseClock('900'), '09:00');
  assert.equal(P.parseClock('0900'), '09:00');
  assert.equal(P.parseClock('1530'), '15:30');
  assert.equal(P.parseClock('15:30'), '15:30');
  assert.equal(P.parseClock('15.30'), '15:30');   // the other separator on a keypad
  assert.equal(P.parseClock(' 23:00 '), '23:00');
  assert.equal(P.parseClock('115'), '01:15');     // three digits: one for the hour
});

test('parseClock takes the meridiem off the employer\'s screen', () => {
  assert.equal(P.parseClock('9pm'), '21:00');
  assert.equal(P.parseClock('9:00 PM'), '21:00');
  assert.equal(P.parseClock('8:00 p.m.'), '20:00');
  assert.equal(P.parseClock('12am'), '00:00');    // midnight, not noon
  assert.equal(P.parseClock('12pm'), '12:00');
  assert.equal(P.parseClock('1500pm'), null);     // not a time anybody means
  assert.equal(P.parseClock('0pm'), null);
});

test('parseClock normalises the long way of writing midnight', () => {
  assert.equal(P.parseClock('2400'), '00:00');
  assert.equal(P.parseClock('24:00'), '00:00');
  assert.equal(P.parseClock('24:30'), null);      // there is no such minute
});

test('parseClock refuses rather than rounds', () => {
  // Half-typed times pass through here on every keystroke. Each one has to
  // come back null so the value on file is left alone, not overwritten with
  // the nearest thing the text might have been.
  assert.equal(P.parseClock('2:5'), null);
  assert.equal(P.parseClock('9:60'), null);
  assert.equal(P.parseClock('99:00'), null);
  assert.equal(P.parseClock('25'), null);
  assert.equal(P.parseClock('12345'), null);
  assert.equal(P.parseClock('half three'), null);
  assert.equal(P.parseClock(''), null);
  assert.equal(P.parseClock(null), null);
});

test('findRange reads a time range and notices a missing am/pm', () => {
  assert.deepEqual(
    { ...P.findRange('WED 9:00am - 11:00am'), text: undefined },
    { start: '09:00', end: '11:00', ambiguous: false, text: undefined });

  // One marker covers both ends.
  const carried = P.findRange('9:00 - 5:00pm');
  assert.equal(carried.start, '21:00');
  assert.equal(carried.end, '17:00');
  assert.equal(carried.ambiguous, false);

  // Neither end marked — this is the dangerous case and must be flagged.
  assert.equal(P.findRange('9:00 - 5:00').ambiguous, true);
});

test('monthHeader matches a bare month and ignores anything else', () => {
  assert.deepEqual(P.monthHeader('February'), { month: 1, year: null });
  assert.deepEqual(P.monthHeader('Feb 2027'), { month: 1, year: 2027 });
  assert.equal(P.monthHeader('February 3 shift'), null);
  assert.equal(P.monthHeader('Fabruary'), null);
});

test('fullDate reads the written and numeric forms', () => {
  assert.equal(P.fullDate('Sunday, July 27, 2025', NOW), '2025-07-27');
  assert.equal(P.fullDate('27 July 2025', NOW), '2025-07-27');
  assert.equal(P.fullDate('2025-07-27', NOW), '2025-07-27');
  assert.equal(P.fullDate('7/27/2025', NOW), '2025-07-27');
  assert.equal(P.fullDate('no date at all', NOW), null);
});

test('guessYear puts a bare month and day near now', () => {
  assert.equal(P.guessYear(8, 10, NOW), 2026);        // Sep 10, a week out
  assert.equal(P.guessYear(0, 15, NOW), 2027);        // Jan 15 means next year
  assert.equal(P.guessYear(7, 1, NOW), 2026);         // Aug 1, just behind us
});

test('tidy strips OCR debris without eating real site names', () => {
  // The pipe is kept deliberately: it is TrackTik's own mark for where the
  // role ends and the site begins, and §8.1 needs to read it. Brackets and
  // the rest of the debris still go.
  assert.equal(P.tidy('  (03) Mobile Guard | De la Montagne  '), '03 Mobile Guard | De la Montagne');
  assert.equal(P.tidy('Café Rue-St'), 'Café Rue-St');
  assert.equal(P.tidy(''), '');
});

test('the employee\'s own name is kept out of the label', () => {
  // Homebase prints "(You) Cerion C." above the role on every row of his own
  // schedule, with the avatar initials beside it. Neither says anything.
  assert.equal(P.usefulPart('CC (You) Cerion C.'), false);
  assert.equal(P.usefulPart('(You) Cerion C.'), false);
  assert.equal(P.usefulPart('CC'), false);          // avatar initials alone
  assert.equal(P.usefulPart('Training'), true);
  assert.equal(P.usefulPart('Cook Plant ASO'), true);
  assert.equal(P.usefulPart('Security Officer'), true);
});

test('a split shift keeps both the role and the site', () => {
  const got = P.parse(
    'Thursday, September 03 Today\n' +
    '12:15 am CC (You) Cerion C.\n' +
    '4:15 am @ Training\n' +
    'Headquarters', { now: NOW });
  assert.equal(got.length, 1);
  assert.equal(got[0].label, 'Training - Headquarters');
});

test('the weekday on a written date header is checked too', () => {
  // Homebase prints no year, so guessYear has to invent one and the weekday
  // beside the date is the only thing that can contradict it.
  const ok = P.parse('Friday, September 04\n9:00 am\n5:00 pm Security Agent', { now: NOW });
  assert.deepEqual(ok[0].flags, [P.FLAG.SPLIT]);

  const bad = P.parse('Monday, September 04\n9:00 am\n5:00 pm Security Agent', { now: NOW });
  assert.ok(bad[0].flags.includes(P.FLAG.WEEKDAY));
});

test('rows scrolled off the top or bottom do not invent a date', () => {
  // A time with no day number under it is a row cut off by the screen edge.
  const got = P.parse('September\nWED 3:00pm - 11:00pm', { now: NOW });
  assert.equal(got.length, 1);
  assert.equal(got[0].date, '');
  assert.ok(got[0].flags.includes(P.FLAG.NODATE));
});

/* ---------- what the first real OCR pass broke ---------------------------- */

test('a month header survives OCR debris beside it', () => {
  // The real September capture read the header as "September Vv os" — the
  // collapse chevron and a stray icon. The month never got set, and since a
  // TrackTik date is a bare day number, every row on the screen came back
  // nodate: three correct shifts with no date on any of them.
  assert.deepEqual(P.monthHeader('September Vv os'), { month: 8, year: null });
  assert.deepEqual(P.monthHeader('September'),       { month: 8, year: null });
  assert.deepEqual(P.monthHeader('September 2026'),  { month: 8, year: 2026 });

  // Digits are still not debris — a day number must never be eaten as noise,
  // and a written date header must not be mistaken for a month header.
  assert.equal(P.monthHeader('September 02'), null);
  assert.equal(P.monthHeader('Thursday, September 03'), null);
  assert.equal(P.monthHeader('Schedule'), null);
});

test('a meridiem stranded on its own line is recovered', () => {
  // "8:00 pm" lost its pm onto the following line as "00pm .", so it parsed
  // as 08:00 — twelve hours out, the documented top risk on real input.
  assert.equal(P.looseMeridiem('00pm .'), 'PM');
  assert.equal(P.looseMeridiem('am'), 'AM');

  // And is not guessed from wreckage that merely contains an m.
  assert.equal(P.looseMeridiem('\u20142adM cc @ Training'), null);
  assert.equal(P.looseMeridiem('28M cc @ @ Security Agent :'), null);
  assert.equal(P.looseMeridiem('Headquarters'), null);
  assert.equal(P.looseMeridiem('4:15am'), null);   // attached to a time already

  const got = P.parse(
    'Thursday, September 03\n8:00 (You) Cerion C.\n00pm .\n12:00am @ Training\nF.O.C.',
    { now: NOW });
  assert.equal(got.length, 1);
  assert.equal(got[0].start, '20:00');
  assert.ok(got[0].flags.includes(P.FLAG.FIXEDAP));
  assert.ok(!got[0].flags.includes(P.FLAG.AMPM), 'a recovered meridiem is no longer missing');
});

test('label debris is dropped without taking the role with it', () => {
  assert.equal(P.stripDebris('\u20142adM cc @ Training'), 'Training');
  assert.equal(P.stripDebris('28M cc @ @ Security Agent :'), 'Security Agent');
  assert.equal(P.stripDebris('00pm .'), '');
  assert.equal(P.stripDebris('F.O.C.'), 'F.O.C.');        // three letters, kept
  assert.equal(P.stripDebris('Headquarters'), 'Headquarters');
});

test('the role between the two time lines is not stepped over', () => {
  // The gather used to jump from the start-time line to the end-time line,
  // so a role sitting between them was lost on every Homebase import.
  const got = P.parse(
    'Friday, September 04\n' +
    '19:15 (You) Cerion C.\n' +
    '28M cc @ @ Security Agent :\n' +
    '8:15am\n' +
    'Headquarters', { now: NOW });
  assert.equal(got.length, 1);
  assert.equal(got[0].label, 'Security Agent - Headquarters');
});

test('a shift with only one legible time is flagged, never dropped', () => {
  // A silently absent shift reads as a day off, which is the failure this
  // whole project exists to prevent. The end is left empty instead — the
  // review screen asks for it and the commit path refuses to file without it.
  const got = P.parse(
    'Saturday, September 05\n' +
    '7.15 (You) Cerion C.\n' +
    'dell cC @ Security Officer :\n' +
    'F.O.C.', { now: NOW });
  assert.equal(got.length, 1);
  assert.equal(got[0].date, '2026-09-05');
  assert.equal(got[0].start, '07:15');
  assert.equal(got[0].end, '');
  assert.ok(got[0].flags.includes(P.FLAG.ONETIME));
});

test('a stray time with nothing naming a shift is still ignored', () => {
  // The guard on the rule above: without it, any clock-like text on the
  // screen would become a row.
  assert.deepEqual(P.parse('Saturday, September 05\n7:15', { now: NOW }), []);
});

test('the employer separator survives, and a join is not mistaken for one', () => {
  // TrackTik prints a real boundary inside one field. normalise() used to
  // flatten it to " - ", which is what the Homebase join produces, so §8.1
  // could not tell a separator from glue. The pipe now survives both
  // normalise() and tidy().
  const tt = P.parse('September\nWED 3:00pm - 11:00pm\n09 Cook Plant ASO | SOUTHERN HENS, I...',
                     { now: NOW });
  assert.equal(tt[0].label, 'Cook Plant ASO | SOUTHERN HENS, I');
  assert.deepEqual(P.splitLabel(tt[0].label),
                   { role: 'Cook Plant ASO', site: 'SOUTHERN HENS, I' });

  // Homebase's role and site arrive on separate lines; gluing them back
  // together is this parser's doing and claims nothing about structure.
  const hb = P.parse('Thursday, September 03\n12:15 am (You) Cerion C.\n4:15 am @ Training\nHeadquarters',
                     { now: NOW });
  assert.equal(hb[0].label, 'Training - Headquarters');
  assert.deepEqual(P.splitLabel(hb[0].label),
                   { role: 'Training - Headquarters', site: '' });
});

/* ---------- golden fixtures ---------------------------------------------- */

const raws = fs.existsSync(FIX)
  ? fs.readdirSync(FIX).filter(f => f.endsWith('.txt')).sort()
  : [];

if(!raws.length){
  test('fixtures directory has raw text to parse', { skip: 'no .txt fixtures yet' }, () => {});
}

for(const raw of raws){
  test(`fixture: ${raw}`, () => {
    const text = fs.readFileSync(path.join(FIX, raw), 'utf8');
    const got = P.parse(text, { now: NOW });
    const goldPath = path.join(FIX, raw.replace(/\.txt$/, '.expected.json'));

    if(UPDATE || !fs.existsSync(goldPath)){
      fs.writeFileSync(goldPath, JSON.stringify(got, null, 2) + '\n');
      if(!UPDATE) assert.fail(
        `No golden file for ${raw}. One has been written to ${path.basename(goldPath)} — ` +
        `read it, correct anything wrong, and commit it.`);
      return;
    }
    assert.deepStrictEqual(got, JSON.parse(fs.readFileSync(goldPath, 'utf8')));
  });
}
