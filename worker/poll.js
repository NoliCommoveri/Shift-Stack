/* ==========================================================================
   What the cron decides, without the database or the network. PROJECT.md §38.

   The same extraction guards.js, merge.js and feed.js each came out of, and
   for the same reason: `poll()` in index.js was a fetch, a decision and a
   batch of D1 writes in one function, and only the middle one is interesting.
   Nothing could reach it. `worker/index.js` cannot be required by a Node test
   — it is ESM, it imports schema.sql as text, and every path through it wants
   a D1 binding — so the whole of the cron's judgement was the one part of this
   app with no test at all. Three faults shipped through it in two days:

     §35  the zone was never asked for, so every shift was filed an hour out
     §36  the row resolver matched the whole label against the site table,
          so a cron-filed shift resolved to no site and no role
     §37  the zone had one route to the Worker and it went through a phone
          that was still serving the previous app.js out of its cache

   Every one of them is a pure function of (feed text, store, env), which is
   exactly the signature below. index.js keeps the two halves that need the
   outside world — fetching the calendar and writing the plan — and this file
   answers the question they are wrapped around.
   ========================================================================== */

const { parseICS } = require('../ics.js');
const { resolveNames } = require('../sites.js');
const { splitLabel } = require('../parser.js');
const { mergeCalendar } = require('../merge.js');
const { guard, feedJob, zoneFor, todayIn, shiftISO } = require('./guards.js');

/* How a feed row gets its site and role before it is compared with anything on
   file. A shift on file holds `siteId`; a row off the feed holds only the text
   the employer wrote, and `whereKey` answers those two differently by design —
   so without this every row comes back as `replace` and the cron rewrites the
   whole schedule every fifteen minutes.

   `resolveNames` is sites.js's and the page's `applyNames` calls the same one.
   This used to be a pair of `matchName` calls of its own, against the whole
   label and against a `role` field a feed row does not carry, so a shift the
   server filed resolved to neither table while the same shift imported by hand
   resolved to both (§36). */
function resolver(store, jobId){
  const sites = (store.sites || []).filter(s => s.companyId === jobId);
  const roles = (store.roles || []).filter(r => r.companyId === jobId);
  return row => ({ ...row, ...resolveNames(row, sites, roles, splitLabel) });
}

/* The row the database gets, from the row the reader made. Here rather than
   inline in index.js's two write loops so that a test can apply a plan the way
   the Worker applies it — an idempotence test that built its rows differently
   would be testing its own arithmetic. `seq` is what makes a calendar accept a
   revision of an event it already holds (§22). */
function feedRow(row, id, seq){
  return { ...row, id, source: 'feed', seq: seq || 0 };
}

/* Feed text in, a plan out.

   `at` is the clock, passed in so a test does not depend on the day it runs —
   the seven-day window is counted from today *where the shifts are*, which is
   the zone this function has just worked out.

   Returns everything index.js needs to record the poll, and everything a test
   needs to check it: which zone was used and where that answer came from, what
   the reader made of the text, what would change, and the guard's refusal if
   §14.6 says none of it should be applied. */
function planPoll({ text, store, env, at }){
  const s = store || {};
  const job = feedJob(s.companies || []);
  if(!job) return { job: null, refuse: 'no job is configured for the feed' };

  const { zone, source, defaulted } = zoneFor(job, env);
  const today = todayIn(zone, at || new Date());
  const from = shiftISO(today, -7);

  const { rows, report } = parseICS(text, { zone, from, match: job.icsMatch || '' });

  const mine = (s.shifts || []).filter(x => x.companyId === job.id && x.source === 'feed');
  const plan = mergeCalendar(mine, rows, report, job.id, { resolve: resolver(s, job.id) });

  return { job, zone, zoneSource: source, zoneDefaulted: defaulted, today, from,
           rows, report, plan, mine,
           // A calendar written to by one app and nothing else contains shifts
           // and only shifts, so a row that will not parse is not noise to be
           // skipped quietly — it says Homebase has changed its format, or
           // that something else has started writing there (§14.9).
           unreadable: report.unreadable || 0,
           refuse: guard({ report, plan, mine, today }) };
}

module.exports = { planPoll, resolver, feedRow };
