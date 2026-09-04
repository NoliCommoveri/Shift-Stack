/* What a week is worth, with more than one rate in it (PROJECT.md §27).
 * Run with:  npm test
 *
 * No fixtures. This module takes hours with a price on them and returns money,
 * which is exactly the sort of thing worth stating as cases — and it is the
 * only arithmetic in the app that gets checked against a real bank deposit
 * weeks after the screenshot it came from is gone.
 *
 * The rates throughout are the two-job shape from §1: one employer paying a
 * guard rate and a supervisor rate in the same week.
 */
const test = require('node:test');
const assert = require('node:assert');
const T = require('../pay.js');

const H = (hours, rate, name) => ({ mins: hours * 60, rate, name, key: name || String(rate) });
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg || ''} ${a} !== ${b}`);

/* ---------- the break ---------------------------------------------------- */

test('an unpaid break comes off a shift long enough to earn one', () => {
  const co = { breakMins: 30, breakAfterHrs: 6 };
  assert.equal(T.paidMins({ mins: 480 }, co), 450);
  // Exactly on the threshold counts: "over six hours" is the employer's rule
  // and six hours is where it starts.
  assert.equal(T.paidMins({ mins: 360 }, co), 330);
  assert.equal(T.paidMins({ mins: 300 }, co), 300);
});

test('no break configured takes nothing off, and nothing goes negative', () => {
  assert.equal(T.paidMins({ mins: 480 }, {}), 480);
  assert.equal(T.paidMins({ mins: 10 }, { breakMins: 30, breakAfterHrs: 0.1 }), 0);
});

/* ---------- one rate, which must not have changed ------------------------
   The whole case for swapping the old four-line formula out is that it is a
   special case of this one. If these drift apart, every figure the app has
   ever shown him changed meaning. */

test('a single-rate week is the old formula, to the cent', () => {
  const co = { otAfterHrs: 40, otMult: 1.5 };
  const rows = [H(30, 20), H(18, 20)];                       // 48 h at $20
  const w = T.weekPay(rows, co);

  const rate = 20, hrs = 48, ot = 8, base = 40;
  near(w.gross, base * rate + ot * rate * 1.5, 'old formula');
  near(w.gross, 40 * 20 + 8 * 30);
  assert.equal(w.hrs, hrs);
  assert.equal(w.ot, ot);
  assert.equal(w.mixed, false);
});

test('under the overtime threshold there is no premium', () => {
  const w = T.weekPay([H(35, 20)], { otAfterHrs: 40 });
  near(w.gross, 700);
  assert.equal(w.ot, 0);
  assert.equal(w.base, 35);
});

test('no threshold declared means no overtime at all', () => {
  const w = T.weekPay([H(60, 20)], {});
  near(w.gross, 1200);
  assert.equal(w.ot, 0);
});

test('the multiplier is the job’s when it has one', () => {
  const w = T.weekPay([H(48, 20)], { otAfterHrs: 40, otMult: 2 });
  near(w.gross, 40 * 20 + 8 * 40);
});

/* ---------- two rates ---------------------------------------------------- */

test('every hour is paid at its own rate', () => {
  const w = T.weekPay([H(20, 20, 'Guard'), H(10, 30, 'Supervisor')], {});
  near(w.gross, 20 * 20 + 10 * 30);
  assert.equal(w.hrs, 30);
  assert.equal(w.mixed, true);
});

test('the overtime premium is charged on the weighted average, not on either rate', () => {
  // 30 h at $20 and 18 h at $30 — 48 h, so 8 h of overtime.
  const w = T.weekPay([H(30, 20, 'Guard'), H(18, 30, 'Supervisor')], { otAfterHrs: 40 });
  const straight = 30 * 20 + 18 * 30;                        // 1140
  const regular = straight / 48;                             // 23.75
  near(w.rate, regular);
  near(w.gross, straight + 8 * regular * 0.5);

  // Not the low rate, and not the high one. Those are the two wrong answers
  // this formulation exists to avoid.
  assert.ok(Math.abs(w.gross - (straight + 8 * 20 * 0.5)) > 1);
  assert.ok(Math.abs(w.gross - (straight + 8 * 30 * 0.5)) > 1);
});

test('the answer does not depend on which shifts fell last in the week', () => {
  // The point of the weighted average. Paid chronologically, moving the
  // supervisor shift to the end of the week would change what he is owed for
  // hours he had already worked.
  const co = { otAfterHrs: 40 };
  const a = T.weekPay([H(30, 20), H(18, 30)], co);
  const b = T.weekPay([H(18, 30), H(30, 20)], co);
  near(a.gross, b.gross);

  // And splitting one shift into two of the same rate changes nothing either.
  const c = T.weekPay([H(15, 20), H(15, 20), H(18, 30)], co);
  near(a.gross, c.gross);
});

/* ---------- hours nobody has priced -------------------------------------- */

test('an hour with no rate is counted and not paid', () => {
  const w = T.weekPay([H(10, 20, 'Guard'), H(5, null, 'Unknown')], {});
  assert.equal(w.hrs, 15);
  assert.equal(w.unratedHrs, 5);
  near(w.gross, 200);
  assert.equal(w.rated, true);
});

test('unpriced hours do not drag the regular rate down', () => {
  // Averaging over hours nothing prices would under-pay the premium on the
  // hours that are priced, which is a wrong number in the direction that
  // matters — it would look like less than he is owed.
  const w = T.weekPay([H(40, 20), H(8, null)], { otAfterHrs: 40 });
  near(w.rate, 20);
  near(w.gross, 40 * 20 + 8 * 20 * 0.5);
});

test('a week with no rate anywhere prints no figure', () => {
  const w = T.weekPay([H(20, null)], { otAfterHrs: 40 });
  assert.equal(w.rated, false);
  assert.equal(w.gross, 0);
  assert.equal(w.hrs, 20);
});

test('a rate of zero is a rate, and is not "nothing said"', () => {
  const w = T.weekPay([H(10, 0)], {});
  assert.equal(w.rated, true);
  assert.equal(w.unratedHrs, 0);
});

/* ---------- showing the work --------------------------------------------- */

test('the breakdown says what was paid at what, biggest first', () => {
  const w = T.weekPay([H(10, 30, 'Supervisor'), H(30, 20, 'Guard')], {});
  assert.deepEqual(w.byRate.map(r => [r.name, r.hrs, r.rate]),
                   [['Guard', 30, 20], ['Supervisor', 10, 30]]);
  near(w.byRate[0].pay, 600);
});

test('two roles paid the same are not a mixed week', () => {
  // `mixed` is what decides whether the pay tab shows its work, and two names
  // for one rate is a single figure he can check without a breakdown.
  const w = T.weekPay([H(10, 20, 'Guard'), H(10, 20, 'Relief')], {});
  assert.equal(w.mixed, false);
  assert.equal(w.byRate.length, 2);
});

test('empty and junk rows come back as an empty week rather than NaN', () => {
  for(const rows of [[], null, [null], [{ mins: 0, rate: 20 }], [{ rate: 20 }]]){
    const w = T.weekPay(rows, { otAfterHrs: 40 });
    assert.equal(w.hrs, 0);
    assert.equal(w.gross, 0);
    assert.equal(w.rated, false);
  }
});
