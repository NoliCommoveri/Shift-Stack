/* Statutory holiday tests (PROJECT.md §8.3, §20.7). Run with:  npm test
 *
 * The dates below are checked against the calendar, not against the code, and
 * the one that matters most is the first: 7 September 2026 is Labour Day, and
 * §16.3's real fortnight shows DSI's Monday rota with no shift on it. That is
 * the case the whole file exists for.
 */
const test = require('node:test');
const assert = require('node:assert');
const H = require('../holidays.js');

test('Labour Day 2026 is the Monday §16.3 shows no shift on', () => {
  assert.equal(H.holidayOn('2026-09-07', 'QC'), 'Labour Day');
  assert.equal(H.holidayOn('2026-09-07', 'US'), 'Labor Day');
  // The rota's other Mondays are ordinary days and must stay silent.
  assert.equal(H.holidayOn('2026-09-14', 'QC'), null);
  assert.equal(H.holidayOn('2026-09-08', 'QC'), null);
});

test('a job with no jurisdiction set is never flagged', () => {
  assert.equal(H.holidayOn('2026-09-07', ''), null);
  assert.equal(H.holidayOn('2026-09-07', undefined), null);
  assert.equal(H.holidayOn('2026-09-07', 'ZZ'), null);
  assert.deepEqual(H.holidaysIn(2026, ''), {});
});

test('rubbish in, nothing out', () => {
  assert.equal(H.holidayOn('7 September 2026', 'QC'), null);
  assert.equal(H.holidayOn('', 'QC'), null);
  assert.equal(H.holidayOn(null, 'QC'), null);
  assert.deepEqual(H.holidaysIn('2026', 'QC'), {});
});

test('nth weekday, counted forwards and backwards', () => {
  // September 2026 starts on a Tuesday, so the first Monday is the 7th.
  assert.equal(H.nthWeekday(2026, 9, 1, 1), 7);
  assert.equal(H.nthWeekday(2026, 9, 1, 2), 14);
  assert.equal(H.nthWeekday(2026, 11, 4, 4), 26);   // fourth Thursday
  assert.equal(H.nthWeekday(2026, 5, 1, -1), 25);   // last Monday
  assert.equal(H.nthWeekday(2027, 5, 1, -1), 31);   // a month ending on one
});

test('Easter moves, and both days Québec offers are marked', () => {
  assert.deepEqual(H.easterSunday(2026), { month: 4, day: 5 });
  assert.deepEqual(H.easterSunday(2027), { month: 3, day: 28 });
  assert.equal(H.holidayOn('2026-04-03', 'QC'), 'Good Friday');
  assert.equal(H.holidayOn('2026-04-06', 'QC'), 'Easter Monday');
  assert.equal(H.holidayOn('2026-04-05', 'QC'), null);   // the Sunday itself is not one
});

test('the Monday preceding 25 May is strictly before it', () => {
  // 2020 is the check: 25 May was itself a Monday and the day was the 18th.
  assert.equal(H.holidayOn('2020-05-18', 'QC'), 'National Patriots’ Day');
  assert.equal(H.holidayOn('2020-05-25', 'QC'), null);
  assert.equal(H.holidayOn('2026-05-18', 'QC'), 'National Patriots’ Day');
  assert.equal(H.holidayOn('2027-05-24', 'QC'), 'National Patriots’ Day');
});

test('a holiday on a weekend marks the day it is taken as well', () => {
  // 4 July 2027 is a Sunday, taken on the Monday.
  assert.equal(H.holidayOn('2027-07-04', 'US'), 'Independence Day');
  assert.equal(H.holidayOn('2027-07-05', 'US'), 'Independence Day (observed)');
  // 1 July 2028 is a Saturday, taken on the Friday — Québec's own rule for it.
  assert.equal(H.holidayOn('2028-06-30', 'QC'), 'Canada Day (observed)');
  // A holiday already on a weekday adds nothing beside itself.
  assert.equal(H.holidayOn('2026-07-02', 'QC'), null);
  assert.equal(H.holidayOn('2026-06-30', 'QC'), null);
});

test('the two jurisdictions are genuinely different lists', () => {
  assert.equal(H.holidayOn('2026-06-24', 'QC'), 'Fête nationale');
  assert.equal(H.holidayOn('2026-06-24', 'US'), null);
  assert.equal(H.holidayOn('2026-07-04', 'US'), 'Independence Day');
  assert.equal(H.holidayOn('2026-07-04', 'QC'), null);
  assert.equal(H.holidayOn('2026-11-26', 'US'), 'Thanksgiving');   // fourth Thursday
  assert.equal(H.holidayOn('2026-10-12', 'QC'), 'Thanksgiving');   // second Monday
});

test('the picker gets a name for each list', () => {
  const places = H.holidayPlaces();
  assert.deepEqual(places.map(p => p.id), ['QC', 'US']);
  assert.ok(places.every(p => p.name));
});
