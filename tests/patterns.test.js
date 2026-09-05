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

/* ---------- overlap ------------------------------------------------------
 * The one failure with no recovery: two shifts booked over each other means
 * he is contracted to be in two places at once. Every case below is built out
 * of the real shapes in §16.3 — DSI 15:00-23:00, Trupoint overnight.
 */

test('a handover is not a clash, however tight', () => {
  // This is the case that matters most, because it is the common one. He
  // often goes straight from one job to the other, and a check that fires on
  // that is a check he learns to scroll past.
  const a = { date:'2026-09-09', start:'07:00', end:'15:00' };
  const b = { date:'2026-09-09', start:'15:00', end:'23:00' };
  assert.equal(T.clashMins(a, b), 0);

  // Two shifts on one day with hours between them are not a clash either.
  assert.equal(T.clashMins({ date:'2026-09-09', start:'06:00', end:'10:00' },
                           { date:'2026-09-09', start:'15:00', end:'23:00' }), 0);
});

test('a real overlap is measured, whichever way round it is given', () => {
  const a = { date:'2026-09-09', start:'13:00', end:'21:00' };
  const b = { date:'2026-09-09', start:'15:00', end:'23:00' };
  assert.equal(T.clashMins(a, b), 360);
  assert.equal(T.clashMins(b, a), 360);
});

test('an overnight shift is compared with the next morning, not just its own day', () => {
  // Trupoint's Saturday night runs to 07:15 on the Sunday. A Sunday shift
  // starting at 06:00 collides with it by 75 minutes, and the two sit on
  // different dates — which is why none of this is done inside a date.
  const night = { date:'2026-09-05', start:'19:15', end:'07:15' };
  const morning = { date:'2026-09-06', start:'06:00', end:'14:00' };
  assert.equal(T.clashMins(night, morning), 75);

  // The same night shift against the previous evening's DSI shift.
  assert.equal(T.clashMins(night, { date:'2026-09-05', start:'15:00', end:'23:00' }), 225);
});

test('a shift wholly inside another is a clash, not something to wave through', () => {
  // The old day-bucket check dropped anything overlapping by more than ten
  // hours, so the worst collisions were the invisible ones.
  const long = { date:'2026-09-09', start:'08:00', end:'20:00' };
  const inner = { date:'2026-09-09', start:'10:00', end:'12:00' };
  assert.equal(T.clashMins(long, inner), 120);

  // Two identical shifts overlap completely.
  assert.equal(T.clashMins(long, { ...long }), 720);
});

test('shifts days apart never clash', () => {
  assert.equal(T.clashMins({ date:'2026-09-09', start:'15:00', end:'23:00' },
                           { date:'2026-09-11', start:'15:00', end:'23:00' }), 0);
  // Including across a month end, which is arithmetic the day number has to
  // get right rather than string comparison.
  assert.equal(T.clashMins({ date:'2026-09-30', start:'19:15', end:'07:15' },
                           { date:'2026-10-01', start:'06:00', end:'14:00' }), 75);
});

test('an incomplete row clashes with nothing', () => {
  const half = { date:'2026-09-09', start:'15:00', end:'' };
  assert.equal(T.clashMins(half, { date:'2026-09-09', start:'15:00', end:'23:00' }), 0);
  assert.deepEqual(T.findClashes(half, [{ date:'2026-09-09', start:'15:00', end:'23:00' }]), []);
  // Undated too: it is already flagged and asking to be completed, and
  // inventing the missing half to test it against would be inventing the answer.
  assert.deepEqual(T.findClashes({ date:'', start:'15:00', end:'23:00' },
                                 [{ date:'2026-09-09', start:'15:00', end:'23:00' }]), []);
});

test('findClashes reports the worst first and never counts the row itself', () => {
  const row = { id:'new', date:'2026-09-09', start:'12:00', end:'20:00' };
  const filed = [
    { id:'a', date:'2026-09-09', start:'15:00', end:'23:00' },   // 5h
    { id:'b', date:'2026-09-09', start:'19:00', end:'23:00' },   // 1h
    { id:'c', date:'2026-09-09', start:'20:00', end:'23:00' },   // handover
    { id:'new', date:'2026-09-09', start:'12:00', end:'20:00' }  // itself
  ];
  const got = T.findClashes(row, filed, o => o.id === 'new');
  assert.deepEqual(got.map(c => [c.shift.id, c.mins]), [['a',300], ['b',60]]);
});

test('clashPairs reports each colliding pair once', () => {
  const filed = [
    { id:'a', date:'2026-09-05', start:'19:15', end:'07:15' },
    { id:'b', date:'2026-09-06', start:'06:00', end:'14:00' },
    { id:'c', date:'2026-09-09', start:'15:00', end:'23:00' }   // clashes with nothing
  ];
  const pairs = T.clashPairs(filed);
  assert.equal(pairs.length, 1);
  assert.deepEqual([pairs[0].a.id, pairs[0].b.id, pairs[0].mins], ['a','b',75]);
  assert.deepEqual(T.clashPairs([]), []);
});

/* ---------- generating a week (§8.3) ------------------------------------- */

test('dowOf and weekDates walk the calendar without a local Date', () => {
  assert.equal(T.dowOf('2026-09-07'), 1);            // Labour Day, a Monday
  assert.equal(T.dowOf('2026-09-13'), 0);            // Sunday
  assert.equal(T.dowOf('nonsense'), null);
  assert.equal(T.isoFromDayNum(T.dayNum('2026-09-07')), '2026-09-07');
  assert.deepEqual(T.weekDates('2026-09-07'), [
    '2026-09-07','2026-09-08','2026-09-09','2026-09-10',
    '2026-09-11','2026-09-12','2026-09-13'
  ]);
  assert.deepEqual(T.weekDates('2026-09-07', 2), ['2026-09-07','2026-09-08']);
  // A month boundary is where hand-rolled date maths usually breaks.
  assert.deepEqual(T.weekDates('2026-09-28', 4), ['2026-09-28','2026-09-29','2026-09-30','2026-10-01']);
  assert.deepEqual(T.weekDates('', 7), []);
  assert.deepEqual(T.weekDates('2026-09-07', 0), []);
});

test('DSI’s rota fills its own week, and only its own days', () => {
  const got = T.generateWeek(DSI, T.weekDates('2026-09-07'));
  assert.deepEqual(got.map(r => r.date),
    ['2026-09-07','2026-09-08','2026-09-09','2026-09-11']);   // Mon Tue Wed Fri
  assert.ok(got.every(r => r.start === '15:00' && r.end === '23:00'));
});

test('a pattern with no days never generates, however it is mixed in', () => {
  const checkOnly = [{ start:'09:00', end:'17:00' }];
  assert.deepEqual(T.generateWeek(checkOnly, T.weekDates('2026-09-07')), []);
  assert.equal(T.canGenerate(checkOnly), false);
  assert.equal(T.canGenerate(DSI), true);
  assert.equal(T.canGenerate([]), false);
  // Beside a rota, the catch-all still contributes nothing to the week.
  const mixed = T.generateWeek([...DSI, ...checkOnly], T.weekDates('2026-09-07'));
  assert.equal(mixed.length, 4);
  assert.ok(mixed.every(r => r.start === '15:00'));
});

test('a half-typed rota is dropped rather than half-believed', () => {
  // The state the setup screen is in between adding a shift and typing it.
  assert.deepEqual(T.generateWeek([{ days:[1,2,3,5], start:'', end:'' }],
                                  T.weekDates('2026-09-07')), []);
  assert.deepEqual(T.generateWeek([{ days:[1], start:'15:00' }], T.weekDates('2026-09-07')), []);
  assert.deepEqual(T.generateWeek(null, T.weekDates('2026-09-07')), []);
  assert.deepEqual(T.generateWeek(DSI, null), []);
});

test('the same rota declared twice fills the week once', () => {
  const got = T.generateWeek([...DSI, ...DSI], T.weekDates('2026-09-07'));
  assert.equal(got.length, 4);
  // A second shift at different times on a rota day is a second shift, not a
  // duplicate, and both are emitted.
  const two = T.generateWeek([...DSI, { days:[1], start:'06:00', end:'14:00' }],
                             T.weekDates('2026-09-07'));
  assert.equal(two.length, 5);
  assert.deepEqual(two.slice(0, 2).map(r => r.start), ['06:00', '15:00']);  // in order
});

test('an overnight rota fills the day the shift starts on', () => {
  // Saturday nights, the shape §16.3 records for the other job.
  const nights = [{ days:[6], start:'19:15', end:'07:15' }];
  const got = T.generateWeek(nights, T.weekDates('2026-09-07'));
  assert.deepEqual(got, [{ date:'2026-09-12', start:'19:15', end:'07:15' }]);
  // And the overlap check sees it running into the Sunday, exactly as it would
  // for a shift read off a screenshot.
  assert.equal(T.clashMins(got[0], { date:'2026-09-13', start:'06:00', end:'14:00' }), 75);
});

test('generation fills only the dates it is given', () => {
  // app.js drops the dates already past before calling, which is how §20.8's
  // "never backwards" is enforced; the function itself just does as it is told.
  const rest = T.weekDates('2026-09-07').filter(d => d >= '2026-09-09');
  assert.deepEqual(T.generateWeek(DSI, rest).map(r => r.date),
    ['2026-09-09','2026-09-11']);
});

/* ---------- rest between shifts (§25) ----------------------------------- */

/* The four shifts §25 was raised about, as one chain. Three gaps, and §40
   moved which of them speak: the 1h 15m after the 00:15 was silent when the
   band started at two hours and is a short turnaround now, he sleeps properly
   before the night, and then has an afternoon of it. */
const CHAIN = [
  { id:'a', date:'2026-09-01', start:'15:00', end:'23:00' },
  { id:'b', date:'2026-09-02', start:'00:15', end:'04:15' },
  { id:'c', date:'2026-09-02', start:'20:00', end:'08:00' },
  { id:'d', date:'2026-09-03', start:'15:00', end:'23:00' }
];

test('the real week is measured, and each gap lands in its own band', () => {
  const got = T.restGaps(CHAIN);
  assert.deepEqual(got.map(g => [g.a.id, g.b.id, g.mins]),
    [['a','b',75], ['b','c',945], ['c','d',420]]);
  // §40 moved the floor to an hour, so the 1h 15m is a turnaround now.
  assert.deepEqual(got.filter(g => T.isShortRest(g.mins)).map(g => g.mins), [75, 420]);
  // And nothing in this week is back to back: the shortest join is over an
  // hour, and the other two are a night and an afternoon.
  assert.deepEqual(got.filter(g => T.isBackToBack(g.mins)).map(g => g.mins), []);
});

test('the two bands meet at an hour and neither overlaps the other', () => {
  // Back to back is closed at both ends: no gap at all is the truest case of
  // it, and exactly an hour is Ray's number.
  assert.equal(T.isBackToBack(0), true);
  assert.equal(T.isBackToBack(60), true);
  assert.equal(T.isBackToBack(61), false);
  assert.equal(T.isBackToBack(-1), false);
  assert.equal(T.isBackToBack(null), false);
  // The turnaround band starts where that one stops and ends where a night's
  // sleep starts: exactly an hour is back to back, exactly eight is silence.
  assert.equal(T.isShortRest(60), false);
  assert.equal(T.isShortRest(61), true);
  assert.equal(T.isShortRest(479), true);
  assert.equal(T.isShortRest(480), false);
  assert.equal(T.isShortRest(null), false);
  // No number is in both, and no number between them is in neither.
  for(let m = 0; m <= 600; m++)
    assert.equal(T.isBackToBack(m) !== T.isShortRest(m), m < 480, `at ${m} minutes`);
});

test('going straight from one job to the other is back to back, not a turnaround', () => {
  // §19.1's case, and the whole reason that warning was deleted. It is still
  // not a warning — §40 gives it a line that states the join and stops.
  const tight = [{ date:'2026-09-01', start:'07:00', end:'15:00' },
                 { date:'2026-09-01', start:'15:45', end:'23:00' }];
  const [g] = T.restGaps(tight);
  assert.equal(g.mins, 45);
  assert.equal(T.isShortRest(g.mins), false);
  assert.equal(T.isBackToBack(g.mins), true);
});

test('a handover is reported as no gap, and an overlap is not reported at all', () => {
  // Zero is the shift ending as the next starts, which is the truest back to
  // back there is, so §40 needs it out of the sweep. Negative is §19's clash,
  // which has its own warning and must not also produce a gap note.
  const [g] = T.restGaps([{ date:'2026-09-01', start:'07:00', end:'15:00' },
                          { date:'2026-09-01', start:'15:00', end:'23:00' }]);
  assert.equal(g.mins, 0);
  assert.equal(T.isBackToBack(g.mins), true);
  assert.equal(T.isShortRest(g.mins), false);
  assert.deepEqual(T.restGaps([{ date:'2026-09-01', start:'19:15', end:'07:15' },
                               { date:'2026-09-02', start:'06:00', end:'14:00' }]), []);
});

test('back to back is measured across midnight too', () => {
  // The join this was asked about: a Trupoint night off at 07:15 and a DSI
  // afternoon on at 08:00, on two different dates.
  const [g] = T.restGaps([{ id:'night', date:'2026-09-05', start:'19:15', end:'07:15' },
                          { id:'day',   date:'2026-09-06', start:'08:00', end:'16:00' }]);
  assert.equal(g.mins, 45);
  assert.equal(T.isBackToBack(g.mins), true);
});

test('rest is measured across midnight, not inside a date', () => {
  // §19.2's reason, on the other check: the night ends on a different date
  // from the one it started, and a per-day reading would compare the wrong
  // pair or none at all.
  const [g] = T.restGaps([{ date:'2026-09-05', start:'19:15', end:'07:15' },
                          { date:'2026-09-06', start:'13:15', end:'21:15' }]);
  assert.equal(g.mins, 360);
  assert.equal(T.isShortRest(g.mins), true);
});

test('a shift wholly inside another does not shorten the rest after it', () => {
  // Sorting by start would pair the short shift with what follows and report
  // the hours he is still on the night shift as time off. The sweep carries
  // the furthest end reached, so the rest is measured from 08:00.
  const got = T.restGaps([{ id:'night', date:'2026-09-05', start:'20:00', end:'08:00' },
                          { id:'in',    date:'2026-09-05', start:'22:00', end:'23:00' },
                          { id:'back',  date:'2026-09-06', start:'15:00', end:'23:00' }]);
  assert.deepEqual(got.map(g => [g.a.id, g.b.id, g.mins]), [['night','back',420]]);
});

test('a shift nobody can read breaks the chain rather than being stepped over', () => {
  // With the half-read row skipped, 08:00 to 15:00 looks like seven hours off
  // and is not — there is a shift in the middle of it. Saying nothing is the
  // right silence: that row is already flagged and asking to be completed.
  const murky = [{ id:'night', date:'2026-09-05', start:'20:00', end:'08:00' },
                 { id:'half',  date:'2026-09-06', start:'', end:'' },
                 { id:'back',  date:'2026-09-06', start:'15:00', end:'23:00' }];
  assert.deepEqual(T.restGaps(murky), []);
  // Every gap touching that day goes quiet, including the evening one — an
  // unreadable row on the 6th could just as well be at 23:30 as at noon.
  const evening = T.restGaps([...murky, { id:'next', date:'2026-09-07', start:'06:00', end:'14:00' }]);
  assert.deepEqual(evening, []);
  // Days it does not sit on are unaffected.
  const clear = T.restGaps([...murky,
    { id:'next', date:'2026-09-07', start:'06:00', end:'14:00' },
    { id:'after', date:'2026-09-07', start:'19:00', end:'23:00' }]);
  assert.deepEqual(clear.map(g => [g.a.id, g.b.id, g.mins]), [['next','after',300]]);
});

test('a row with no date at all silences nothing', () => {
  // It has no place on the timeline and no day to block, so it is simply not
  // there — the same answer clashMins gives it.
  const got = T.restGaps([{ id:'x', date:'2026-09-05', start:'20:00', end:'08:00' },
                          { id:'nowhere', date:'', start:'09:00', end:'17:00' },
                          { id:'y', date:'2026-09-06', start:'15:00', end:'23:00' }]);
  assert.deepEqual(got.map(g => [g.a.id, g.b.id, g.mins]), [['x','y',420]]);
});

test('one shift, or none, has no rest to report', () => {
  assert.deepEqual(T.restGaps([]), []);
  assert.deepEqual(T.restGaps(null), []);
  assert.deepEqual(T.restGaps([CHAIN[0]]), []);
});

test('restGaps never mutates what it is given', () => {
  const before = JSON.stringify(CHAIN);
  T.restGaps(CHAIN);
  assert.equal(JSON.stringify(CHAIN), before);
});

/* ---------- the declared role and site (§27) -----------------------------
   A rota row now says what he normally does and where, so a generated week
   can be filed under a fact he typed rather than a guess rummaged out of the
   most recent shift with the same times. Nothing in this file reads them; all
   it has to do is not lose them. */

test('a declared role and site survive validation', () => {
  const [p] = T.validPatterns([{ days: [1], start: '15:00', end: '23:00',
                                 roleId: 'r1', siteId: 's1' }]);
  assert.equal(p.roleId, 'r1');
  assert.equal(p.siteId, 's1');
});

test('a pattern that declares neither gains neither', () => {
  const [p] = T.validPatterns([{ days: [1], start: '15:00', end: '23:00' }]);
  assert.ok(!('roleId' in p));
  assert.ok(!('siteId' in p));
});

test('an unreadable pattern is still dropped, role or no role', () => {
  assert.deepEqual(T.validPatterns([{ start: 'half four', end: '23:00', roleId: 'r1' }]), []);
});

test('a generated week carries what the rota declared', () => {
  const rows = T.generateWeek(
    [{ days: [1, 2], start: '15:00', end: '23:00', roleId: 'r1', siteId: 's1' }],
    ['2026-09-07', '2026-09-08']);
  assert.equal(rows.length, 2);
  rows.forEach(r => { assert.equal(r.roleId, 'r1'); assert.equal(r.siteId, 's1'); });
});

test('two roles at the same hours on one day still generate one shift', () => {
  // The de-dupe is keyed on the slot and not on what he is doing in it. Two
  // declared shifts at the same times on the same day are one shift declared
  // twice, and generating both would put him in two places at once.
  const rows = T.generateWeek([
    { days: [1], start: '15:00', end: '23:00', roleId: 'r1' },
    { days: [1], start: '15:00', end: '23:00', roleId: 'r2' }
  ], ['2026-09-07']);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].roleId, 'r1');       // the first declared wins
});

test('the checking half is unmoved by a declared role', () => {
  const out = T.checkShift({ date: '2026-09-07', start: '03:00', end: '11:00' },
                           [{ days: [1], start: '15:00', end: '23:00', roleId: 'r1' }]);
  assert.equal(out.start, '15:00');
  assert.ok(out.flags.includes(T.PAT_FLAG.FLIPPED));
  // Carried out on the matched pattern, so a caller that wants it has it —
  // but nothing here applies it to the row. Inferring a rate from a time is
  // exactly the kind of guess §8.2 refused to make about the time itself.
  assert.equal(out.pattern.roleId, 'r1');
});
