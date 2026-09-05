/* The two countdowns. Run with:  npm test
 *
 * §49 took this arithmetic out of app.js and view.js because both banners and
 * the card on opening ask the same question of the same shift, and three
 * copies is three chances to answer it differently. That only pays if the one
 * copy is right, and the cases that break it are the ones nobody types by
 * hand: a shift that crosses midnight, a shift already running, the minute
 * before he has to be out of the door.
 *
 * The clock is passed in everywhere. A countdown test that reads Date.now() is
 * a test that passes at 3pm and fails on a night shift.
 */
const test = require('node:test');
const assert = require('node:assert');
const W = require('../when.js');

/* Wall time, local, the way the phone reads `${date}T${start}` — so the fixture
   clock has to be built the same way or every figure here is out by the zone
   the test machine happens to be in. */
const at = s => new Date(s);

const shift = (over = {}) => ({
  id: 'sh1', companyId: 'c1', date: '2026-09-05',
  start: '19:15', end: '07:15', ...over
});

/* ---------- which shift ------------------------------------------------- */

test('the next shift is the one running, not the one after it', () => {
  const shifts = [shift(), shift({ id: 'sh2', date: '2026-09-06', start: '19:15' })];
  const n = W.whenNext(shifts, at('2026-09-05T23:00:00'));
  assert.equal(n.s.id, 'sh1');
  assert.equal(n.on, true);
});

test('a shift is finished only once its end has passed, midnight or not', () => {
  const shifts = [shift()];                       // 19:15 → 07:15 the next day
  assert.ok(W.whenNext(shifts, at('2026-09-06T07:14:00')), 'still on it at 07:14');
  assert.equal(W.whenNext(shifts, at('2026-09-06T07:16:00')), null);
});

test('no shifts, and nothing on file, both come back as nothing to say', () => {
  assert.equal(W.whenNext([], at('2026-09-05T01:22:00')), null);
  assert.equal(W.whenNext(undefined, at('2026-09-05T01:22:00')), null);
});

/* ---------- the line the banner already had ----------------------------- */

test('the countdown says what it said before it moved', () => {
  const s = [shift()];
  const cd = t => W.whenCountdown(W.whenNext(s, at(t)));
  assert.equal(cd('2026-09-05T01:22:00'), 'Starts in 17h 53m');
  assert.equal(cd('2026-09-05T18:40:00'), 'Starts in 35 min');
  assert.equal(cd('2026-09-05T19:15:00'), 'On shift now');
  assert.equal(cd('2026-09-05T23:00:00'), 'On shift now');
  assert.equal(W.whenCountdown(W.whenNext([shift({ date: '2026-09-08' })],
    at('2026-09-05T19:15:00'))), 'In 3 days');
});

/* ---------- the line under it ------------------------------------------- */

test('off shift, the second line counts to the door and not to the start', () => {
  const s = [shift()];
  const lead = t => W.whenLead(W.whenNext(s, at(t)));
  // 19:15 less the forty-five minutes §46 already spends on the door.
  assert.equal(lead('2026-09-05T01:22:00'), 'Leave in 17h 8m');
  assert.equal(lead('2026-09-05T18:00:00'), 'Leave in 30 min');
});

test('inside the last forty-five minutes it stops counting and says so', () => {
  const s = [shift()];
  // A countdown that runs to zero and then counts up is a countdown that has
  // to be read to be understood, at the one moment there is no time to.
  assert.equal(W.whenLead(W.whenNext(s, at('2026-09-05T18:30:00'))), 'Leave now');
  assert.equal(W.whenLead(W.whenNext(s, at('2026-09-05T19:00:00'))), 'Leave now');
});

test('on shift, the second line is the end of it', () => {
  const s = [shift()];
  assert.equal(W.whenLead(W.whenNext(s, at('2026-09-05T21:00:00'))), 'Off in 10h 15m');
  assert.equal(W.whenLead(W.whenNext(s, at('2026-09-06T06:45:00'))), 'Off in 30 min');
});

test('more than a day out there is no door to leave by yet', () => {
  // "Leave in 2 days" under "In 3 days" is one wait rounded twice, and the two
  // roundings disagree.
  assert.equal(W.whenLead(W.whenNext([shift({ date: '2026-09-08' })],
    at('2026-09-05T19:15:00'))), '');
});

/* ---------- the card on opening ----------------------------------------- */

test('the card says work when he is off and off when he is on', () => {
  const s = [shift()];
  assert.equal(W.whenLine(W.whenNext(s, at('2026-09-05T01:22:00'))),
    'Work in 17 hours and 53 minutes');
  assert.equal(W.whenLine(W.whenNext(s, at('2026-09-05T21:00:00'))),
    'Off in 10 hours and 15 minutes');
});

test('a wait longer than a day is said in days, without false minutes', () => {
  assert.equal(W.whenWordy(3 * 1440 + 125), '3 days and 2 hours');
  assert.equal(W.whenWordy(1440), '1 day');
  assert.equal(W.whenWordy(90), '1 hour and 30 minutes');
  assert.equal(W.whenWordy(60), '1 hour');
  assert.equal(W.whenWordy(1), '1 minute');
  assert.equal(W.whenWordy(0), '0 minutes');
});

test('the third line is the clock time it lands on, 24-hour', () => {
  const s = [shift()];
  // Off shift that is the start; on shift it is the end, which is the next
  // morning and still reads as a time rather than a date.
  assert.equal(W.whenAt(W.whenNext(s, at('2026-09-05T01:22:00')).at), '19:15');
  assert.equal(W.whenAt(W.whenNext(s, at('2026-09-05T21:00:00')).end), '07:15');
});

test('nothing counts backwards, whichever line asks', () => {
  // Every one of these can be handed a negative by a clock that ticks between
  // the read and the draw, and a "-3 min" on the banner reads as a bug.
  assert.equal(W.whenClock(-5), '0 min');
  assert.equal(W.whenWordy(-5), '0 minutes');
});
