/* ==========================================================================
   What a week is worth. PROJECT.md §27.

   This used to be four lines inside app.js, and it could be, because one job
   had one rate:

       gross = base*rate + ot*rate*otMult

   §27 asked for a second rate at the same job — Cook and Dishwasher at
   Homebase, Mobile Guard and Site Supervisor at DSI — and the moment two rates
   land in one week that formula stops having an obvious answer. Which hours
   were the overtime hours? Chronologically the last ones, so a week's gross
   would depend on the order the shifts happened to fall in, and moving one
   shift from Tuesday to Saturday would change what he is owed for hours he
   already worked. That is not how anybody is paid.

   What is done here instead is the weighted-average regular rate: every hour
   is paid at its own rate, and the overtime *premium* is charged on the
   average of them. It is what the FLSA requires of an employer paying two
   rates in one week, it does not care what order the shifts fell in, and it
   reduces exactly to the old formula when every hour pays the same:

       H*r + ot*r*(mult-1)  ==  (H-ot)*r + ot*r*mult

   That identity is the reason this could be swapped in without recomputing a
   single figure the app had already shown. It is checked in the tests.

   The other half of §27's argument is that this file exists at all. A gross to
   the cent is checked against a deposit weeks later, when the screenshots are
   long gone, so the arithmetic behind it is the last thing in the app that
   should live where nothing can test it.

   Nothing here touches the DOM or storage, and nothing here knows what a role
   is. It takes hours with a price on them.
   ========================================================================== */

/* The default multiplier, unchanged from where it was inlined in app.js. */
const OT_MULT = 1.5;

/* Paid minutes: the clock, less an unpaid break the job takes off shifts over
   a certain length. Lifted from app.js unchanged so the one place that decides
   what an hour is stays next to the place that prices it. */
function paidMins(sh, co){
  const a = sh && sh.mins;
  let m = Number.isFinite(a) ? a : 0;
  if(co && co.breakMins && co.breakAfterHrs && m >= co.breakAfterHrs * 60) m -= co.breakMins;
  return Math.max(0, m);
}

/* One week.

   `rows` are `{ mins, rate, key, name }` — minutes already paid-adjusted, the
   rate that applies to them, and how to label them in a breakdown. A null rate
   is not zero: it means nothing has been said about what this hour is worth,
   and those hours are counted in the total and left out of the money, because
   inventing a rate is how a forecast becomes a wrong number he trusts.

   Returns the figures the pay tab shows, plus `byRate` — what actually got
   paid at what — because §27's rule is that a mixed-rate gross has to be able
   to show its work. A week where one rate did all of it hands back one row and
   the tab says nothing extra. */
function weekPay(rows, co){
  const list = (rows || []).filter(r => r && Number.isFinite(r.mins) && r.mins > 0);
  const opts = co || {};

  let hrs = 0, unratedHrs = 0, straight = 0;
  const bag = new Map();
  for(const r of list){
    const h = r.mins / 60;
    hrs += h;
    const rate = r.rate == null || r.rate === '' || Number.isNaN(+r.rate) ? null : +r.rate;
    if(rate == null) unratedHrs += h; else straight += h * rate;

    const k = r.key != null ? String(r.key) : (rate == null ? 'none' : 'rate:' + rate);
    if(!bag.has(k)) bag.set(k, { key: k, name: r.name || '', rate, hrs: 0, pay: 0 });
    const e = bag.get(k);
    e.hrs += h;
    if(rate != null) e.pay += h * rate;
  }

  // The regular rate is the average of the hours that have one. Averaging over
  // hours nothing prices would drag it towards zero and quietly under-pay the
  // overtime premium on the hours that are priced.
  const ratedHrs = hrs - unratedHrs;
  const regular = ratedHrs > 0 ? straight / ratedHrs : 0;

  const after = +opts.otAfterHrs;
  let base = hrs, ot = 0;
  if(Number.isFinite(after) && after > 0 && hrs > after){ base = after; ot = hrs - after; }

  const mult = Number.isFinite(+opts.otMult) && +opts.otMult > 0 ? +opts.otMult : OT_MULT;
  // Every hour at its own rate, then the premium on the hours past the
  // threshold. Splitting it this way is what makes the answer independent of
  // which shifts happened to fall last in the week.
  const gross = straight + ot * regular * (mult - 1);

  return {
    mins: list.reduce((a, r) => a + r.mins, 0),
    hrs, base, ot, gross,
    rate: regular,
    unratedHrs,
    // A rate was known for at least some of it, so a figure is worth printing.
    rated: ratedHrs > 0,
    // Whether the week needs to show its work: more than one price was paid.
    mixed: new Set(list.filter(r => r.rate != null).map(r => +r.rate)).size > 1,
    byRate: [...bag.values()].sort((a, b) => b.hrs - a.hrs || a.name.localeCompare(b.name))
  };
}

/* Node picks these up for the tests; the browser just gets the globals. */
if(typeof module !== 'undefined' && module.exports){
  module.exports = { OT_MULT, paidMins, weekPay };
}
