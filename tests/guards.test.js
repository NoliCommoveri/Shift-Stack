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

/* ---------- the schema splitter ------------------------------------------ */

test('every statement in schema.sql survives the split', () => {
  // The first version filtered out any chunk beginning with `--`, and every
  // CREATE TABLE in the file has a comment block above it. Seven statements
  // became two — both CREATE INDEX, on tables no longer being created — and
  // the migration failed with "no such table" behind a bare 500.
  const sql = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'worker', 'schema.sql'), 'utf8');
  const stmts = G.splitSQL(sql);

  assert.equal(stmts.length, 7);
  for(const t of ['cfg', 'shifts', 'raw', 'polls'])
    assert.ok(stmts.some(s => new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\b`).test(s)),
              `${t} is created`);
  assert.ok(stmts.every(s => !s.includes('--')), 'comments are stripped, not carried through');

  // A table must be created before anything indexes it.
  const at = re => stmts.findIndex(s => re.test(s));
  assert.ok(at(/CREATE TABLE IF NOT EXISTS shifts/) < at(/shifts_ext_uid/));
  assert.ok(at(/CREATE TABLE IF NOT EXISTS shifts/) < at(/shifts_by_date/));
  assert.ok(at(/CREATE TABLE IF NOT EXISTS polls/) < at(/polls_at/));
});

test('the splitter keeps nothing empty and survives an empty file', () => {
  assert.deepEqual(G.splitSQL('-- only a comment\n\n'), []);
  assert.deepEqual(G.splitSQL(''), []);
  assert.deepEqual(G.splitSQL(null), []);
  assert.deepEqual(G.splitSQL('SELECT 1;;;  ;\n-- x\nSELECT 2'), ['SELECT 1', 'SELECT 2']);
});


/* ---------- what the server is allowed to hold ---------------------------
 * The phone used to send `S.settings` whole, so `pushToken` — the secret that
 * authorises the very request carrying it — was stored in the `cfg` row as
 * cleartext, next to the employer's secret calendar address. Neither was ever
 * read: the Worker authenticates against `env.PUSH_TOKEN` and polls
 * `env.ICS_URL`. The row simply held two credentials, in a place with a far
 * wider readership than a secret binding.
 *
 * These are the tests standing where nothing stood, and the whitelist is the
 * point: a setting added to the page next year must be withheld by default.
 */
const SENSITIVE = ['pushToken', 'icsUrl'];

const fullSettings = {
  leads: [12, 2],
  feedMode: 'subscribe',
  icsUrl: 'https://calendar.google.com/calendar/ical/abc123secret/basic.ics',
  pushToken: 'a-real-token-nobody-should-store',
  lastExport: '2026-09-04T11:00:00.000Z',
  open: { server: true }
};

test('the push token never reaches the stored config', () => {
  const kept = G.safeSettings(fullSettings);
  for(const k of SENSITIVE)
    assert.ok(!(k in kept), `${k} must not survive into the cfg row`);
  // Not merely absent under its own name — absent from the row entirely, which
  // is what a grep of a D1 dump would actually be looking for.
  assert.ok(!JSON.stringify(kept).includes(fullSettings.pushToken));
  assert.ok(!JSON.stringify(kept).includes('abc123secret'));
});

test('what the feed builder reads still gets through', () => {
  // feed.js:121 reads settings.leads and nothing else, so this is the whole
  // reason the server holds any settings at all. Withholding it would move the
  // leak's cost onto the alarms in the calendar.
  assert.deepEqual(G.safeSettings(fullSettings).leads, [12, 2]);
});

test('it is a whitelist, so a setting added later is withheld by default', () => {
  const kept = G.safeSettings({ ...fullSettings, apiKeyForSomethingNew: 'sk-live-oops' });
  assert.deepEqual(Object.keys(kept).sort(), G.SETTINGS_KEPT.slice().sort()
                     .filter(k => k in fullSettings));
  assert.ok(!JSON.stringify(kept).includes('sk-live-oops'));
});

test('a missing or malformed settings object is an empty one, not a throw', () => {
  // The Worker validates cfg.companies and nothing deeper, so `settings` can
  // arrive as undefined, null or a string from any client that gets it wrong.
  for(const bad of [undefined, null, 'nope', 42, []])
    assert.deepEqual(G.safeSettings(bad), {});
});

test('it copies rather than aliases, so the caller cannot be edited through it', () => {
  const src = { leads: [12, 2], pushToken: 't' };
  const kept = G.safeSettings(src);
  assert.notEqual(kept, src);
  assert.ok('pushToken' in src, 'safeSettings must not strip its argument in place');
});


/* ---------- and why there is no job --------------------------------------
 * The two states that reach here are different problems with different next
 * actions, and they used to print one sentence between them. Setup shows this
 * line verbatim every fifteen minutes, so it is the whole diagnosis.
 */
test('an empty config says nothing has been pushed, not that a job is missing', () => {
  const why = G.whyNoFeedJob([]);
  assert.match(why, /nothing has been sent from the phone/);
  assert.match(why, /export once/);
});

test('two jobs and no tick says which screen to go to', () => {
  const why = G.whyNoFeedJob([{ id: 'c1' }, { id: 'c2' }]);
  assert.match(why, /2 jobs are set up/);
  assert.match(why, /App and calendar/);
  // And it must not tell him to push, which he has already done.
  assert.ok(!/export once/.test(why));
});

test('the two reasons are not the same sentence', () => {
  assert.notEqual(G.whyNoFeedJob([]), G.whyNoFeedJob([{ id: 'c1' }, { id: 'c2' }]));
});
