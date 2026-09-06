/* What the cron would do, end to end. Run with:  npm test
 *
 * PROJECT.md §38. Every other test in this suite asks one module one question.
 * This one runs the whole of the Worker's decision — which zone, what the feed
 * says, what would change, and whether §14.6 will allow it — against the
 * golden fixture, because the three faults that reached Ray's phone in
 * September were all invisible to the unit tests and all obvious here:
 *
 *   §35  the zone was never asked for, so every shift was filed an hour out
 *   §36  the resolver matched the whole label against the site table, so a
 *        cron-filed shift resolved to no site and no role
 *   §37  the zone had one route to the Worker and it ran through a phone
 *        serving the previous app.js out of its shell cache
 *
 * The clock is passed in rather than read, so these do not start failing in a
 * week when the fixture's dates fall out of the seven-day window.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { planPoll, feedRow } = require('../worker/poll.js');
const { guard } = require('../worker/guards.js');

const ROOT = path.join(__dirname, '..');
const FEED = fs.readFileSync(
  path.join(ROOT, 'tests', 'fixtures', 'calendar', 'homebase-google-sync-SYNTHETIC.ics'), 'utf8');

/* Friday 4 September 2026, mid-morning UTC — the week the fixture is written
   around, and late enough in the day that the zone cannot move the date. */
const AT = new Date('2026-09-04T15:00:00Z');

/* Ray's store, as the Worker reads it out of `cfg` and `shifts`: one job that
   the server polls, the site the fixture's events name, and the two roles they
   are worked under. `zone` is left off on purpose — the state every store was
   in before §35, and the one §37's `ZONE` var exists to cover. */
const store = (extra = {}) => ({
  companies: [{ id: 'tp', name: 'Tru-Point', icsFeed: true, ...(extra.company || {}) }],
  sites: [{ id: 'hq', companyId: 'tp', name: 'Headquarters',
            address: '401 Main St, Hattiesburg MS', aliases: [], archived: false },
          { id: 'foc', companyId: 'tp', name: 'F.O.C.', address: '', aliases: [], archived: false }],
  roles: [{ id: 'so', companyId: 'tp', name: 'Security Officer', rate: 22.5,
            aliases: [], archived: false },
          { id: 'tr', companyId: 'tp', name: 'Training', rate: 15, aliases: [], archived: false }],
  shifts: extra.shifts || [],
  settings: { leads: [12, 2] }
});

const CENTRAL = { ZONE: 'America/Chicago' };
const run = (opts = {}) =>
  planPoll({ text: opts.text || FEED, store: opts.store || store(),
             env: 'env' in opts ? opts.env : CENTRAL, at: AT });

/* Apply a plan the way index.js applies it, so a second poll can be run
   against the result. `feedRow` is the Worker's own, for the same reason. */
function apply(mine, plan){
  const gone = new Set(plan.remove.concat(plan.stale || []).map(s => s.id));
  const kept = mine.filter(s => !gone.has(s.id));
  const replaced = new Map(plan.replace.map(r => [r.id, r]));
  let n = 0;
  return [
    ...kept.map(s => replaced.has(s.id)
      ? feedRow(replaced.get(s.id).row, s.id, (s.seq || 0) + 1)
      : s),
    ...plan.add.map(row => feedRow(row, `f${++n}`))
  ];
}

/* ---------- the zone ------------------------------------------------------ */

test('a feed of UTC times is filed on the clock he actually works to', () => {
  const { zone, zoneSource, plan } = run();
  assert.equal(zone, 'America/Chicago');
  assert.equal(zoneSource, 'env', 'no job has pushed a zone yet; the Worker was told one');

  // The event in the shape Ray's own calendar holds: 00:15Z is 19:15 the
  // evening before in Central, which is what the raw Homebase entry says.
  const foc = plan.add.find(r => r.extUid.includes('4471909'));
  assert.equal(foc.date, '2026-09-05');
  assert.equal(foc.start, '19:15');
  assert.equal(foc.end, '07:15');
  assert.equal(foc.endDate, '2026-09-06');
});

test('the same feed on Eastern is the hour that §35 was', () => {
  // Not a hypothetical: this is what the cron filed for a month, and what the
  // calendar showed after §36 corrected the titles and nothing else moved.
  const east = run({ store: store({ company: { zone: 'America/Toronto' } }) });
  assert.equal(east.zoneSource, 'job');
  const foc = east.plan.add.find(r => r.extUid.includes('4471909'));
  assert.equal(foc.start, '20:15', 'an hour late, exactly as it shipped');
  assert.equal(foc.end, '08:15');
});

test('the job’s own zone wins, and a Worker told nothing still lands Central', () => {
  assert.equal(run({ store: store({ company: { zone: 'America/Denver' } }) }).zone, 'America/Denver');
  // No `ZONE` var and no job zone: the last resort, which is where the
  // stations are rather than where another project's stations were.
  const bare = run({ env: {} });
  assert.equal(bare.zone, 'America/Chicago');
  assert.equal(bare.zoneSource, 'fallback');
});

/* ---------- the names ----------------------------------------------------- */

test('a cron-filed shift resolves to a site and a role, like a hand-imported one', () => {
  // §36: the resolver used to match the whole label against the site table and
  // a `role` field a feed row does not carry against the roles, so every row
  // came out with neither — paid at the job's rate instead of the role's, and
  // compared on text where an identity was available.
  const foc = run().plan.add.find(r => r.extUid.includes('4471909'));
  assert.equal(foc.roleId, 'so');
  assert.equal(foc.siteId, 'foc');
  assert.equal(foc.role, 'Security Officer');
  // The street address is on the row for the calendar to make tappable, and
  // nowhere near the label.
  assert.match(foc.place, /3492 Hwy 42/);
  assert.equal(foc.label, 'Security Officer | F.O.C.');
});

test('a row the tables have never heard of still files, under what was read', () => {
  const { plan } = run({ store: store({ company: { icsFeed: true } }) });
  const purvis = plan.add.find(r => r.extUid.includes('4471904'));
  assert.equal(purvis.siteId, null, 'Purvis Gen Station is not in the site table');
  assert.equal(purvis.roleId, null, 'nor is Security Agent in the roles');
  assert.equal(purvis.label, 'Security Agent | Purvis Gen Station');
});

/* ---------- the diff ------------------------------------------------------ */

test('a second poll of an unchanged feed changes nothing', () => {
  // Cron Triggers do not retry and may double-fire, so a repeat has to be a
  // no-op (§14.5). Anything else and the calendar gains a duplicate every
  // fifteen minutes, or every event's revision climbs for no reason.
  const first = run();
  const held = apply([], first.plan);
  assert.equal(held.length, first.plan.add.length);

  const second = run({ store: store({ shifts: held }) });
  assert.deepEqual(
    { add: second.plan.add.length, replace: second.plan.replace.length,
      remove: second.plan.remove.length, unchanged: second.plan.unchanged },
    { add: 0, replace: 0, remove: 0, unchanged: held.length });
  assert.equal(second.refuse, null);
});

test('a zone corrected between two polls rewrites the shifts it already filed', () => {
  // The repair path, asserted rather than hoped about: this is what has to
  // happen on Ray's next tick once the Worker knows it is in Central.
  const east = run({ store: store({ company: { zone: 'America/Toronto' } }) });
  const held = apply([], east.plan);

  const fixed = run({ store: store({ company: { zone: 'America/Chicago' }, shifts: held }) });
  assert.equal(fixed.plan.add.length, 0, 'the same shifts, not a second copy of them');
  assert.equal(fixed.plan.remove.length, 0);
  assert.equal(fixed.plan.replace.length, held.length, 'every one of them retimed');
  assert.equal(fixed.refuse, null, '§14.6 caps removals, and a retimed shift is not one');

  // And each rewrite counts the revision up, which is what makes a calendar
  // accept an event it already holds (§22). Without it the phone keeps the
  // wrong hour and nothing says why.
  const after = apply(held, fixed.plan);
  const foc = after.find(s => s.extUid.includes('4471909'));
  assert.equal(foc.start, '19:15');
  assert.equal(foc.seq, 1);
  assert.deepEqual(after.map(s => s.id).sort(), held.map(s => s.id).sort(),
                   'in place, keeping every shift’s id');
});

/* ---------- a rota republished under new ids (§51) ------------------------ */

/* The employer's calendar has one copy of the day; the app had two. Every
   Homebase UID carries the shift's own id — `homebase-4471903-20260903` — so a
   rota rebuilt and republished is the same evening under a name the app has
   never seen, and matching on UID alone files it a second time while the first
   sits there with nothing to remove it. This is that feed, twice. */
const REBUILT = FEED.replace(/homebase-44719(\d\d)-/g, (m, n) => `homebase-44729${n}-`);

test('a rota republished under new ids does not file a second copy of the week', () => {
  const held = apply([], run().plan);
  const { plan } = run({ text: REBUILT, store: store({ shifts: held }) });

  assert.equal(plan.add.length, 0, 'not one of them is a shift he has been given twice');
  assert.equal(plan.replace.length, 6, 'the six Homebase events, revised in place');
  assert.equal(plan.unchanged, 1, 'and the one event whose id did not change');

  const after = apply(held, plan);
  assert.equal(after.length, held.length);
  assert.deepEqual(after.map(s => s.id).sort(), held.map(s => s.id).sort(),
                   'every shift kept its id, so the calendar sees revisions (§22)');
  const uids = after.map(s => s.extUid).filter(u => u.includes('homebase'));
  assert.ok(uids.every(u => u.includes('44729')), 'and every one now answers to its new id');
});

test('a schedule that is already doubled is collapsed by the next poll', () => {
  // The state §51 was reported in: the cron had been down, the rota was
  // rebuilt while it was, and the poll that came back filed the whole week
  // beside itself. Nothing on the phone can clear a source='feed' row (§14.3),
  // so the cron has to be the thing that heals it.
  const doubled = [...apply([], run().plan),
                   ...apply([], run({ text: REBUILT }).plan)]
                  .map((s, i) => ({ ...s, id: `d${i}` }));
  assert.equal(doubled.length, 14);

  const { plan, refuse } = run({ text: REBUILT, store: store({ shifts: doubled }) });
  assert.equal(refuse, null, '§14.6 must not read a collapse as a massacre');
  assert.equal(plan.stale.length, 7);
  assert.equal(plan.remove.length, 0);
  assert.deepEqual([plan.add.length, plan.replace.length], [0, 0]);

  const after = apply(doubled, plan);
  assert.equal(after.length, 7);
  const slots = after.map(s => `${s.date} ${s.start} ${s.end}`);
  assert.equal(new Set(slots).size, slots.length, 'one row a slot');
});

test('the same collapse offered as cancellations would have been refused', () => {
  // Why `stale` is handed back separately rather than dropped into `remove`:
  // seven of fourteen is over §14.6's ceiling, so a doubled schedule would
  // refuse every poll from here on and never come back to one row a slot.
  const doubled = [...apply([], run().plan),
                   ...apply([], run({ text: REBUILT }).plan)]
                  .map((s, i) => ({ ...s, id: `d${i}` }));
  const { plan, refuse } = run({ text: REBUILT, store: store({ shifts: doubled }) });
  assert.equal(refuse, null);
  assert.match(guard({ report: { events: 7 }, mine: doubled, today: '2026-09-04',
                       plan: { ...plan, remove: plan.stale, stale: [] } }),
               /would remove 7 of 14 shifts/);
});

/* ---------- the guards ----------------------------------------------------- */

test('a feed that would empty the schedule is refused, and the old one stands', () => {
  const held = apply([], run().plan);
  const empty = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR';
  const { refuse } = run({ text: empty, store: store({ shifts: held }) });
  assert.match(refuse, /held no events/);
});

test('a sign-in page where a calendar should be is refused as one', () => {
  const { refuse } = run({ text: '<html><body>Sign in to continue</body></html>' });
  assert.match(refuse, /did not parse as a calendar/);
});

test('no job ticked is the refusal that says so, not a crash', () => {
  const none = planPoll({ text: FEED, at: AT, env: CENTRAL,
                          store: { companies: [{ id: 'a' }, { id: 'b' }] } });
  assert.equal(none.job, null);
  assert.match(none.refuse, /no job is configured/);
});

/* ---------- the window ----------------------------------------------------- */

test('the seven-day window is counted where the shifts are', () => {
  const { today, from, report } = run();
  assert.equal(today, '2026-09-04');
  assert.equal(from, '2026-08-28');
  assert.equal(report.past, 1, 'last month’s shift is not news');
  assert.equal(report.allDay, 1, 'and a birthday is not a shift');
});
