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
   look changed, and the cron would rewrite the whole schedule on every
   poll without anything reporting a fault. */
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


/* The slot a shift stands in: a day, two times and the place, on the identity
   the site table gives it rather than on the spelling. Two rows that resolved
   to the same site are the same place however the employer wrote it that week.
   The role counts too — the same hours in a different role are worth a
   different amount (§27), so a key that ignored it would file the old rate
   against the new work.

   One person cannot work two shifts at one company, on one day, between the
   same two clock times, in the same role at the same place. So this is not
   merely a comparison, it is an identity: `app.js`'s `bySlot` has always
   treated a second row with this key as a repeat to drop rather than a shift
   to file, and §51 is what it cost for the cron not to. */
function slotKey(x){
  return `${x.date}|${x.start}|${x.end}|${keyOf(x)}`;
}

/* Same shift, unchanged. */
function icsSame(a, b){
  return slotKey(a) === slotKey(b);
}

/* `existing` is the shifts already on file for this job that came from this
   feed — `source='feed'` rows in the Worker, `extUid`-carrying rows in the
   page. `rows` and `report` are `parseICS`'s two outputs. `jobId` is the
   company the feed belongs to.

   Returns five groups and never mutates its arguments:

     add        rows the feed has that nothing on file matches
     replace    { id, was, row } — a shift on file, revised
     remove     shifts on file the feed says are cancelled
     stale      shifts on file the feed has replaced under a new UID
     unchanged  a count, because nothing needs doing with them

   Matching is on `ext_uid` first, and that is what makes applying this
   idempotent (§14.5) rather than merely usually-correct: running the same
   feed twice puts every row in `unchanged` the second time, which matters
   because Cron Triggers do not retry and a double-fire has to be a no-op.

   Matching is on the *slot* second, and that is §51. A UID is stable only for
   as long as the employer's calendar chooses to reuse it, and Homebase does
   not: a rota rebuilt and republished arrives as the same shifts under fresh
   event ids. On UID alone every one of them is a row nothing on file matches
   — an `add` — while the row it supersedes sits there untouched, because
   nothing removes a shift that has merely stopped being mentioned. The
   employer's calendar has one copy of the day and the app has two, which is
   §51's report exactly. So a row that matched no UID is offered the slot it
   stands in, and takes over the shift already there: same id, same outgoing
   event, one row.

   `stale` is the other half of the same fault, and what heals a schedule that
   already has two of everything. A shift on file that no row of this feed
   claims, standing in a slot that a row of this feed *does* claim, is the
   superseded copy: the feed has just confirmed that slot, and confirmed it as
   one shift. It is handed back separately from `remove` because §14.6's
   ceiling is a rule about cancellations — about a truncated feed proposing to
   empty a week — and collapsing two rows into one empties nothing.

   `opts.resolve` is how a row gets its site and role before it is compared,
   and it is not optional in practice. A shift on file holds `siteId`; a row
   off the feed holds only the text the employer wrote. `whereKey` answers
   those two differently by design, so without a resolver every row would
   come back as `replace` and the cron would rewrite the whole schedule on
   every poll. The page passes `applyNames`, which reads the store; the
   Worker passes its own against the `cfg` row. Neither belongs in here. */
function mergeCalendar(existing, rows, report, jobId, opts){
  const resolve = (opts && opts.resolve) || (r => r);
  const onFile = (existing || []).filter(s => s.companyId === jobId && s.extUid);
  const byUid = new Map();
  const bySlot = new Map();
  onFile.forEach(s => {
    if(!byUid.has(s.extUid)) byUid.set(s.extUid, s);
    const k = slotKey(s);
    if(!bySlot.has(k)) bySlot.set(k, []);
    bySlot.get(k).push(s);
  });

  // Which shifts on file this feed has spoken for. A row on file is claimed at
  // most once, and by at most one feed row: without that, one calendar event
  // moved onto a day that already held two would replace them both.
  const claimed = new Set();
  // The subset of those claimed in pass two, under a UID the feed had not used
  // for them before. Only these are protected from a cancellation below: a
  // feed that both cancels a UID and carries it live is answering its own
  // question and has always been read as the cancellation, but a feed that
  // cancels one id and republishes the same hours under another is saying the
  // shift is on.
  const reclaimed = new Set();
  const add = [], replace = [];
  let unchanged = 0;

  // Pass one, on the UID, and it runs to the end before pass two begins. The
  // order is the whole of the safety: a UID that matches is the employer
  // naming a specific shift, and it must have first refusal on the row it
  // names, or a second event standing in the same slot could take it first
  // and leave the named one to be filed all over again.
  const unmatched = [];
  for(const r of (rows || [])){
    const row = resolve({ ...r, companyId: jobId, extUid: r.uid || null });
    const held = r.uid ? byUid.get(r.uid) : null;
    if(!held || claimed.has(held.id)){ unmatched.push(row); continue; }
    claimed.add(held.id);
    if(icsSame(held, row)){ unchanged++; continue; }
    replace.push({ id: held.id, was: held, row });
  }

  // Pass two, on the slot. A republished rota arrives here entire.
  const filled = new Set();
  for(const row of unmatched){
    const k = slotKey(row);
    const held = (bySlot.get(k) || []).find(s => !claimed.has(s.id));
    if(held){
      // The same shift under a new name. Replaced rather than added, so it
      // keeps its id — and with it the event `feedICS` writes out, which is
      // named after that id (§22). An add would take the shift off the phone's
      // calendar and put an identical one back beside it.
      claimed.add(held.id);
      reclaimed.add(held.id);
      replace.push({ id: held.id, was: held, row });
      continue;
    }
    // Two events in one feed standing in one slot are one shift written twice,
    // and the second is dropped rather than filed. `bySlot` in app.js has
    // always answered a hand-imported calendar this way; answering it
    // differently here is the disagreement this file exists to prevent.
    if(filled.has(k)) continue;
    filled.add(k);
    add.push(row);
  }

  // A cancelled event names a shift on file that is not happening. Nothing
  // else in this app can tell him that — a screenshot of a schedule cannot
  // show what is missing from it — and with the schedule flowing back out to
  // a calendar of its own, removing it here is what takes it off the phone.
  //
  // Not a shift some live row of this feed has just claimed: a rota that
  // cancels an event and republishes the same hours under a new id says the
  // shift is on, and the cancellation is about the old name for it.
  const remove = [];
  const seen = new Set();
  for(const c of (report && report.cancelledRows) || []){
    const s = c && c.uid ? byUid.get(c.uid) : null;
    if(!s || seen.has(s.id) || reclaimed.has(s.id)) continue;
    seen.add(s.id);
    remove.push(s);
  }

  // What is left over in a slot this feed has confirmed: the superseded copy.
  // Bounded by construction — a row only goes here while another row survives
  // in its place — so this can never empty a day, whatever the feed does.
  const stale = [];
  for(const pool of bySlot.values()){
    if(pool.length < 2) continue;
    if(!pool.some(s => claimed.has(s.id) && !seen.has(s.id))) continue;
    for(const s of pool) if(!claimed.has(s.id) && !seen.has(s.id)) stale.push(s);
  }

  return { add, replace, remove, stale, unchanged };
}

/* Node picks these up for the tests; the browser just gets the globals. */
if(typeof module !== 'undefined' && module.exports){
  module.exports = { mergeCalendar, icsSame };
}
