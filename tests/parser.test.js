/* Parser tests. Run with:  node --test tests/
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
 *          UPDATE=1 node --test tests/
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
  assert.equal(P.tidy('  (03) Mobile Guard | De la Montagne  '), '03 Mobile Guard De la Montagne');
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
