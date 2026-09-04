/* ==========================================================================
   What a calendar feed changes about what is already on file. PROJECT.md §14.7.

   The UID matching that used to sit inside `calendarRows` and
   `cancellationRows` in app.js, lifted out whole. It is the same question on
   both ends of §14 — the page turns the answer into review rows for a human
   to tick, the Worker's cron applies it without asking (§14.6) — and if the
   two had their own copies they would eventually disagree about what
   "already on file" means. That disagreement is invisible: both sides would
   look right on their own, and the calendar would gain a duplicate or lose a
   shift with nothing to say which side did it.

   This decides nothing about *whether* to apply. It reports the difference,
   and the caller decides: the page by showing it, the Worker by running
   §14.6's guards over it first.
   ========================================================================== */

/* Same three-environment resolution as feed.js, and for the same reason: a
   `whereKey` that silently arrived as undefined would make every feed row
   look changed, and the cron would rewrite the whole schedule every fifteen
   minutes without anything reporting a fault. */
const keyOf = (() => {
  let mod = null;
  try { mod = require('./sites.js'); } catch (e) { mod = null; }
  // Bare, not `globalThis.whereKey`: `whereKey` is a top-level `const` in
  // sites.js, so it lives in the global lexical environment and is not a
  // property of the global object. Reading it off `globalThis` returned
  // undefined in the browser and threw this very error on every page load,
  // while every unit test passed — they go through `require`.
  if(!mod){ try { mod = { whereKey }; } catch (e) { mod = null; } }
  const fn = mod && mod.whereKey;
  if(typeof fn !== 'function')
    throw new Error('merge.js needs whereKey, and neither require nor the page provided it');
  return fn;
})();


/* Same shift, unchanged. The place is compared on the identity the site table
   gives it, not on the spelling: two rows that resolved to the same site are
   the same place however the employer wrote it that week. The role counts too
   — the same hours in a different role are worth a different amount (§27), so
   a comparison that ignored it would file the old rate against the new work. */
function icsSame(a, b){
  return a.date === b.date && a.start === b.start && a.end === b.end &&
         keyOf(a) === keyOf(b);
}

/* `existing` is the shifts already on file for this job that came from this
   feed — `source='feed'` rows in the Worker, `extUid`-carrying rows in the
   page. `rows` and `report` are `parseICS`'s two outputs. `jobId` is the
   company the feed belongs to.

   Returns four groups and never mutates its arguments:

     add        rows the feed has that nothing on file matches
     replace    { id, was, row } — same UID, different shift
     remove     shifts on file the feed says are cancelled
     unchanged  a count, because nothing needs doing with them

   Matching is on `ext_uid` and nothing else. That is what makes applying this
   idempotent (§14.5) rather than merely usually-correct: running the same
   feed twice puts every row in `unchanged` the second time, which matters
   because Cron Triggers do not retry and a double-fire has to be a no-op.

   `opts.resolve` is how a row gets its site and role before it is compared,
   and it is not optional in practice. A shift on file holds `siteId`; a row
   off the feed holds only the text the employer wrote. `whereKey` answers
   those two differently by design, so without a resolver every row would
   come back as `replace` and the cron would rewrite the whole schedule every
   fifteen minutes. The page passes `applyNames`, which reads the store; the
   Worker passes its own against the `cfg` row. Neither belongs in here. */
function mergeCalendar(existing, rows, report, jobId, opts){
  const resolve = (opts && opts.resolve) || (r => r);
  const onFile = (existing || []).filter(s => s.companyId === jobId && s.extUid);
  const byUid = new Map();
  onFile.forEach(s => { if(!byUid.has(s.extUid)) byUid.set(s.extUid, s); });

  const add = [], replace = [];
  let unchanged = 0;

  for(const r of (rows || [])){
    const row = resolve({ ...r, companyId: jobId, extUid: r.uid || null });
    const held = r.uid ? byUid.get(r.uid) : null;
    if(!held){ add.push(row); continue; }
    if(icsSame(held, row)){ unchanged++; continue; }
    replace.push({ id: held.id, was: held, row });
  }

  // A cancelled event names a shift on file that is not happening. Nothing
  // else in this app can tell him that — a screenshot of a schedule cannot
  // show what is missing from it — and with the schedule flowing back out to
  // a calendar of its own, removing it here is what takes it off the phone.
  const remove = [];
  const seen = new Set();
  for(const c of (report && report.cancelledRows) || []){
    const s = c && c.uid ? byUid.get(c.uid) : null;
    if(!s || seen.has(s.id)) continue;
    seen.add(s.id);
    remove.push(s);
  }

  return { add, replace, remove, unchanged };
}

/* Node picks these up for the tests; the browser just gets the globals. */
if(typeof module !== 'undefined' && module.exports){
  module.exports = { mergeCalendar, icsSame };
}
