/* The Worker's decisions. Run with:  npm test
 *
 * §14.6 takes the review tick-box off the Homebase path and puts these in its
 * place, so these are the tests standing where a human used to. The trade it
 * makes — a machine that checks the feed parsed, is non-empty and is not
 * proposing a massacre, against a tired man tapping yes at eleven at night —
 * is only the better one if the machine is right, and nothing downstream will
 * notice if it is not.
 */
const test = require('node:test');
const assert = require('node:assert');
const G = require('../worker/guards.js');

const held = n => Array.from({ length: n }, (_, i) => ({ id: 's' + i, date: '2026-09-10' }));
const plan = remove => ({ add: [], replace: [], remove, unchanged: 0 });
const ok = { events: 12, notCalendar: false };
const TODAY = '2026-09-04';

const check = (report, removes, mine) =>
  G.guard({ report, plan: plan(removes), mine, today: TODAY });

/* ---------- §14.6's five refusals ---------------------------------------- */

test('a body that is not a calendar is refused', () => {
  assert.match(G.guard({ report: { notCalendar: true }, plan: plan([]), mine: held(10), today: TODAY }),
               /did not parse as a calendar/);
  // A fetch that failed hands no report at all, and that is a refusal too.
  assert.match(G.guard({ report: null, plan: plan([]), mine: held(10), today: TODAY }),
               /did not parse as a calendar/);
});

test('a calendar with no events is refused', () => {
  assert.match(check({ events: 0 }, [], held(10)), /held no events/);
});

test('removing more than a quarter of a job\'s shifts is refused', () => {
  const mine = held(20);                    // ceiling is max(3, 5) = 5
  assert.equal(check(ok, mine.slice(0, 5), mine), null);
  assert.match(check(ok, mine.slice(0, 6), mine), /remove 6 of 20 shifts/);
});

test('the floor of three lets a small schedule lose a few', () => {
  // max(3, 25%) — with four shifts on file, 25% is one, and the floor is what
  // stops a fortnight's worth of ordinary churn tripping the guard.
  const mine = held(4);
  assert.equal(check(ok, mine.slice(0, 3), mine), null);
  assert.match(check(ok, mine.slice(0, 4), mine), /remove 4 of 4/);
});

test('removing every future shift is refused even when the count is small', () => {
  // Two future shifts on file and both proposed for removal: under the 25%
  // ceiling by count, and exactly the week-of-cancellations shape §8.4 warns
  // about. The past is not counted, because the past does not get cancelled.
  const mine = [{ id: 'a', date: '2026-08-01' }, { id: 'b', date: '2026-08-02' },
                { id: 'c', date: '2026-09-10' }, { id: 'd', date: '2026-09-11' }];
  assert.match(G.guard({ report: ok, plan: plan([mine[2], mine[3]]), mine, today: TODAY }),
               /every future shift/);
});

test('a normal poll applies', () => {
  const mine = held(20);
  assert.equal(check(ok, [], mine), null);
  assert.equal(check(ok, mine.slice(0, 2), mine), null);
});

test('the very first poll is not refused for having nothing to compare against', () => {
  // A ceiling computed from an empty store would be zero and would refuse the
  // one poll that matters most.
  assert.equal(check(ok, [], []), null);
});

/* ---------- the alarms ---------------------------------------------------- */

const at = h => new Date(Date.parse('2026-09-04T12:00:00Z') - h * 3600000).toISOString();
const NOW = Date.parse('2026-09-04T12:00:00Z');

test('two refusals in a row raise the alarm', () => {
  const polls = [{ ok: 0, reason: 'the feed answered 500', at: at(0) },
                 { ok: 0, reason: 'the feed answered 500', at: at(0.25) },
                 { ok: 1, at: at(0.5) }];
  assert.match(G.alarmFor(polls, NOW), /2 polls in a row have refused: the feed answered 500/);
});

test('one refusal does not, on its own', () => {
  assert.equal(G.alarmFor([{ ok: 0, reason: 'x', at: at(0) }, { ok: 1, at: at(0.25) }], NOW), null);
});

test('six hours without a good poll raises the alarm', () => {
  assert.equal(G.alarmFor([{ ok: 1, at: at(5) }], NOW), null);
  assert.match(G.alarmFor([{ ok: 1, at: at(7) }], NOW), /7 hours since the last good poll/);
});

test('a feed that has never worked says so rather than staying quiet', () => {
  assert.match(G.alarmFor([], NOW), /no poll has ever run/);
  assert.match(G.alarmFor([{ ok: 0, reason: 'x', at: at(1) }], NOW), /has ever succeeded/);
});

/* ---------- which job, which zone ---------------------------------------- */

test('one job needs no marking; two without one is refused', () => {
  assert.equal(G.feedJob([{ id: 'c1' }]).id, 'c1');
  assert.equal(G.feedJob([{ id: 'c1' }, { id: 'c2' }]), null);
  assert.equal(G.feedJob([{ id: 'c1' }, { id: 'c2', icsFeed: true }]).id, 'c2');
  assert.equal(G.feedJob([]), null);
});

test('a bare offset is not a time zone', () => {
  // An offset is wrong for half the year in any zone that observes DST, which
  // is exactly the failure worth catching.
  assert.equal(G.normalizeTimezone('UTC+5'), G.DEFAULT_ZONE);
  assert.equal(G.normalizeTimezone('-05:00'), G.DEFAULT_ZONE);
  assert.equal(G.normalizeTimezone(''), G.DEFAULT_ZONE);
  assert.equal(G.normalizeTimezone('Nowhere/Nothing'), G.DEFAULT_ZONE);
  assert.equal(G.normalizeTimezone('America/Toronto'), 'America/Toronto');
  assert.equal(G.normalizeTimezone('America/Chicago'), 'America/Chicago');
  // UTC is a real zone, and the one the Worker itself runs in. Testing for a
  // '/' to spot an offset threw it out, which is why the offset is now
  // rejected by shape instead.
  assert.equal(G.normalizeTimezone('UTC'), 'UTC');
});

test('today is where the shifts are, not where the Worker is', () => {
  // 01:30 UTC on the 5th is still the 4th in Toronto, and the seven-day
  // import window is counted from it.
  const at0130 = new Date('2026-09-05T01:30:00Z');
  assert.equal(G.todayIn('America/Toronto', at0130), '2026-09-04');
  assert.equal(G.todayIn('UTC', at0130), '2026-09-05');
});

test('day arithmetic does not move with the runtime zone', () => {
  const before = process.env.TZ;
  try {
    for(const tz of ['UTC', 'Pacific/Kiritimati', 'Pacific/Midway']){
      process.env.TZ = tz;
      assert.equal(G.shiftISO('2026-09-04', -7), '2026-08-28');
      assert.equal(G.shiftISO('2026-01-01', -1), '2025-12-31');
    }
  } finally { process.env.TZ = before; }
});

/* ---------- staleness and tokens ----------------------------------------- */

test('the newest DTSTAMP is what §14.8 measures', () => {
  const ics = 'BEGIN:VEVENT\r\nDTSTAMP:20260901T120000Z\r\nEND:VEVENT\r\n' +
              'BEGIN:VEVENT\r\nDTSTAMP:20260903T090000Z\r\nEND:VEVENT\r\n';
  assert.equal(G.newestStamp(ics), '20260903T090000Z');
  assert.equal(G.newestStamp(''), null);
  assert.equal(G.newestStamp(null), null);
});

test('an unset secret opens nothing', () => {
  // A Worker genuinely runs in this state for one deploy, because a secret
  // only takes effect on a deploy made after it was added (§14.9).
  assert.equal(G.tokenOK(undefined, 'anything'), false);
  assert.equal(G.tokenOK('', 'anything'), false);
  assert.equal(G.tokenOK(undefined, undefined), false);
  assert.equal(G.tokenOK('secret', ''), false);
});

test('a token matches only itself', () => {
  assert.equal(G.tokenOK('s3cret', 's3cret'), true);
  assert.equal(G.tokenOK('s3cret', 's3crev'), false);
  assert.equal(G.tokenOK('s3cret', 's3cret '), false);
  assert.equal(G.tokenOK('s3cret', 's3cretXXXX'), false);
  assert.equal(G.tokenOK('s3cret', 's3c'), false);
});

test('comparison does not stop at the first wrong byte', () => {
  // Not a timing measurement — those are too noisy to assert on. This checks
  // the property that makes constant time possible: a wrong first byte and a
  // wrong last byte both walk the whole string.
  assert.equal(G.timingSafeEqual('abcdef', 'zbcdef'), false);
  assert.equal(G.timingSafeEqual('abcdef', 'abcdez'), false);
  assert.equal(G.timingSafeEqual('abcdef', 'abcdef'), true);
  // Multi-byte characters are compared as bytes, not code points.
  assert.equal(G.timingSafeEqual('café', 'café'), true);
  assert.equal(G.timingSafeEqual('café', 'cafe'), false);
});
