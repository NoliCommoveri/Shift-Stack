/* Declared-pattern tests (PROJECT.md §8.2). Run with:  npm test
 *
 * No fixtures here. The parser and calendar tests are about reading text that
 * something else produced, so they need samples of it; this module reads
 * nothing. It takes two shift times and a list a human typed and decides what
 * to do, which is exactly the sort of thing that is worth stating as cases.
 *
 * The numbers throughout are the real ones from §16: DSI's rota is
 * { days:[1,2,3,5], start:'15:00', end:'23:00' } and the Homebase misreads are
 * the ones the first real OCR pass actually produced.
 */
const test = require('node:test');
const assert = require('node:assert');
const T = require('../patterns.js');

const DSI = [{ days:[1,2,3,5], start:'15:00', end:'23:00' }];   // §16.3
const WED = '2026-09-09';                                        // a rota day
const THU = '2026-09-10';                                        // not one

const flags = r => r.flags;
const times = r => `${r.start}-${r.end}`;

/* ---------- the pieces --------------------------------------------------- */

test('clockGap measures round the clock, not along a number line', () => {
  assert.equal(T.clockGap(0, 30), 30);
  assert.equal(T.clockGap(23*60, 1*60), 120);      // over midnight, not 22h
  assert.equal(T.clockGap(9*60, 21*60), 720);      // an am/pm flip, either way
  assert.equal(T.clockGap(21*60, 9*60), 720);
});

test('spanMins treats an end at or before the start as overnight', () => {
  assert.equal(T.spanMins('15:00','23:00'), 480);
  assert.equal(T.spanMins('19:15','07:15'), 720);
  assert.equal(T.spanMins('20:00','00:00'), 240);
  assert.equal(T.spanMins('09:00',''), null);
});

test('validPatterns keeps what can be reasoned about and drops the rest', () => {
  assert.deepEqual(T.validPatterns(DSI), [{ start:'15:00', end:'23:00', days:[1,2,3,5] }]);

  // An unreadable time is not a weaker pattern, it is not a pattern.
  assert.deepEqual(T.validPatterns([{ start:'25:00', end:'23:00' }]), []);
  assert.deepEqual(T.validPatterns([{ start:'15:00' }]), []);
  assert.deepEqual(T.validPatterns(null), []);

  // Days are deduplicated, sorted, and range-checked.
  assert.deepEqual(T.validPatterns([{ days:[5,1,1,9,-2], start:'15:00', end:'23:00' }]),
                   [{ start:'15:00', end:'23:00', days:[1,5] }]);

  // No days ticked means "checking only", so the field goes rather than
  // sitting there as an empty list meaning "runs on no days".
  assert.deepEqual(T.validPatterns([{ days:[], start:'09:00', end:'17:00' }]),
                   [{ start:'09:00', end:'17:00' }]);
});

test('a pattern without days is a candidate on every day', () => {
  const pats = T.validPatterns([{ days:[1], start:'15:00', end:'23:00' },
                                { start:'09:00', end:'17:00' }]);
  assert.equal(T.patternsFor(pats, 1).length, 2);
  assert.equal(T.patternsFor(pats, 4).length, 1);
  // No date on the row yet, so nothing is ruled out on the strength of a day.
  assert.equal(T.patternsFor(pats, null).length, 2);
});

/* ---------- §8.2's table ------------------------------------------------- */

test('exactly twelve hours out is corrected, and says so', () => {
  const r = T.checkShift({ date: WED, start:'03:00', end:'23:00' }, DSI);
  assert.equal(times(r), '15:00-23:00');
  assert.deepEqual(flags(r), [T.PAT_FLAG.FLIPPED]);
  assert.deepEqual(r.read, { start:'03:00', end:'23:00' });
});

test('both ends flipped are both corrected', () => {
  const r = T.checkShift({ date: WED, start:'03:00', end:'11:00' }, DSI);
  assert.equal(times(r), '15:00-23:00');
  assert.deepEqual(flags(r), [T.PAT_FLAG.FLIPPED]);
});

test('a few minutes out is snapped, and quietly', () => {
  const r = T.checkShift({ date: WED, start:'15:03', end:'22:58' }, DSI);
  assert.equal(times(r), '15:00-23:00');
  assert.deepEqual(flags(r), []);
  // Silence is the point, but the reading is still handed back so the caller
  // can show it if it ever wants to.
  assert.deepEqual(r.read, { start:'15:03', end:'22:58' });
});

test('an hour or two out is left alone and flagged', () => {
  const r = T.checkShift({ date: WED, start:'17:00', end:'23:00' }, DSI);
  assert.equal(times(r), '17:00-23:00');
  assert.deepEqual(flags(r), [T.PAT_FLAG.OFFPAT]);
  assert.equal(r.read, null);
});

test('an exact match is silent and unchanged', () => {
  const r = T.checkShift({ date: WED, start:'15:00', end:'23:00' }, DSI);
  assert.equal(times(r), '15:00-23:00');
  assert.deepEqual(flags(r), []);
  assert.deepEqual(r.pattern, { start:'15:00', end:'23:00', days:[1,2,3,5] });
});

test('a shift on a day the rota does not run is flagged, never moved', () => {
  // The rota says Monday, Tuesday, Wednesday, Friday. A Thursday shift is
  // either a real deviation or a misread date, and both want a human.
  const r = T.checkShift({ date: THU, start:'15:00', end:'23:00' }, DSI);
  assert.deepEqual(flags(r), [T.PAT_FLAG.OFFPAT]);
  assert.equal(times(r), '15:00-23:00');
});

test('a catch-all pattern stops the rota flagging the extra days', () => {
  const pats = [...DSI, { start:'15:00', end:'23:00' }];
  assert.deepEqual(flags(T.checkShift({ date: THU, start:'15:00', end:'23:00' }, pats)), []);
});

test('with no patterns declared, nothing is corrected and nothing is flagged', () => {
  const r = T.checkShift({ date: WED, start:'03:00', end:'11:00' }, []);
  assert.equal(times(r), '03:00-11:00');
  assert.deepEqual(flags(r), []);
});

/* ---------- the length check, which needs no patterns -------------------- */

test('an impossible length is flagged with or without patterns', () => {
  // §16.2 for real: "8:00 pm" lost its pm and parsed as 08:00, making a
  // sixteen-hour shift out of a four-hour one. The job it happened on has no
  // declared rota, which is exactly why this check earns its place.
  assert.deepEqual(flags(T.checkShift({ date: WED, start:'08:00', end:'00:00' }, [])),
                   [T.PAT_FLAG.ODDLEN]);
  assert.deepEqual(flags(T.checkShift({ date: WED, start:'15:00', end:'15:30' }, [])),
                   [T.PAT_FLAG.ODDLEN]);

  // The longest shift in the real data is twelve hours and must stay quiet.
  assert.deepEqual(flags(T.checkShift({ date: WED, start:'19:15', end:'07:15' }, [])), []);
});

test('a correction that fixes the length clears the length warning', () => {
  const pats = [{ start:'20:00', end:'00:00' }];
  const r = T.checkShift({ date: WED, start:'08:00', end:'00:00' }, pats);
  assert.equal(times(r), '20:00-00:00');
  assert.deepEqual(flags(r), [T.PAT_FLAG.FLIPPED]);   // not also ODDLEN
});

/* ---------- what it refuses to do ---------------------------------------- */

test('a half-read row is not completed from a pattern', () => {
  // §16.2a: a shift with one legible time emits with the end blank and an
  // onetime flag. Filling that end in from the rota would be inventing the
  // number, which is how the twelve hours got in to begin with.
  const r = T.checkShift({ date: WED, start:'15:00', end:'' }, DSI);
  assert.equal(r.end, '');
  assert.equal(r.pattern, null);
  assert.deepEqual(flags(r), []);
});

test('a row with no date is judged on its times alone', () => {
  // §16.1 put every row on a real TrackTik screen in this state. The times are
  // still checkable; the day is not, so nothing is concluded from it.
  const r = T.checkShift({ date: '', start:'03:00', end:'11:00' }, DSI);
  assert.equal(times(r), '15:00-23:00');
  assert.deepEqual(flags(r), [T.PAT_FLAG.FLIPPED]);
});

test('the closer pattern wins, and a fit without a flip beats a fit with one', () => {
  const pats = [{ start:'15:00', end:'23:00' }, { start:'03:00', end:'11:00' }];
  // 03:00-11:00 is exactly twelve hours from the first and exactly right for
  // the second. A job whose declared shifts sit half a day apart must not
  // become a machine for inventing misreads.
  const r = T.checkShift({ date: WED, start:'03:00', end:'11:00' }, pats);
  assert.equal(times(r), '03:00-11:00');
  assert.deepEqual(flags(r), []);
});

test('checking a corrected row again changes nothing', () => {
  // app.js re-runs this when the date or the job on a review row changes, so
  // running it over its own output has to be a no-op rather than a ratchet.
  const once = T.checkShift({ date: WED, start:'03:00', end:'23:00' }, DSI);
  const twice = T.checkShift({ date: WED, start: once.start, end: once.end }, DSI);
  assert.equal(times(twice), '15:00-23:00');
  assert.deepEqual(flags(twice), []);
});

test('the input is never mutated', () => {
  const row = { date: WED, start:'03:00', end:'23:00' };
  T.checkShift(row, DSI);
  assert.deepEqual(row, { date: WED, start:'03:00', end:'23:00' });
});

/* ---------- build from what's on file ------------------------------------ */

test('suggestPatterns offers distinct pairs with counts and the days they fell on', () => {
  // The fortnight of DSI in §16.3: four shifts, one pair, four weekdays.
  const filed = [
    { date:'2026-09-04', start:'15:00', end:'23:00' },   // Fri
    { date:'2026-09-08', start:'15:00', end:'23:00' },   // Tue
    { date:'2026-09-09', start:'15:00', end:'23:00' },   // Wed
    { date:'2026-09-14', start:'15:00', end:'23:00' },   // Mon
    { date:'2026-09-05', start:'19:15', end:'07:15' }
  ];
  assert.deepEqual(T.suggestPatterns(filed), [
    { start:'15:00', end:'23:00', count:4, days:[1,2,3,5] },
    { start:'19:15', end:'07:15', count:1, days:[6] }
  ]);
});

test('suggestPatterns ignores rows it cannot read a pair off', () => {
  assert.deepEqual(T.suggestPatterns([{ date:'2026-09-09', start:'15:00', end:'' }]), []);
  assert.deepEqual(T.suggestPatterns([]), []);
  assert.deepEqual(T.suggestPatterns(undefined), []);
});
