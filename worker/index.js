/* ==========================================================================
   Shift Deck, server side. PROJECT.md §14.

   Three endpoints and a cron, all on one Worker, which also serves the app
   itself. The app being same-origin is what removes CORS from this file
   entirely (§14.4) — there is no preflight handler and no origin allowlist
   because there is no cross-origin request to make.

   The import half is the reason this exists. Fetching an employer's feed from
   the page failed permanently on Google's iCal addresses because they send no
   CORS headers; CORS is a rule browsers apply to themselves, and nothing here
   is a browser. §43 removed the page's attempt at it altogether, so this is
   now the only way in for a calendar feed. The reader that runs against the
   fetch is ics.js unmodified, the same file the golden fixtures already test.
   ========================================================================== */

import feedMod from '../feed.js';
// The cron's decision — which zone, what the feed says, what would change, and
// whether §14.6 will allow it — lives in poll.js so it can be tested without a
// database or a network (§38). What is left here is the two halves that need
// the outside world: the fetch, and the writes.
import pollMod from './poll.js';
import guardsMod from './guards.js';
import schemaSQL from './schema.sql';

const { feedICS } = feedMod;
const { planPoll, feedRow } = pollMod;
const { alarmFor, feedJob, zoneFor, newestStamp, tokenOK, splitSQL,
        safeSettings, resetPlan, orphanGroups, countEvents, viewOK,
        kidsOK, soonOnly, KIDS_DAYS, todayIn, shiftISO } = guardsMod;

const JSON_HEAD = { 'content-type': 'application/json; charset=utf-8' };
const nowISO = () => new Date().toISOString();

/* How long the employer's calendar gets to answer before the poll gives up and
   says so (§50.1). Generous — this is a static file over HTTPS and a slow one
   still lands inside a second — because the number is not tuning, it is the
   difference between a fault that is recorded and a fault that is invisible.
   Anything short enough to trip on an ordinary slow morning would turn a
   working feed into a log full of refusals. */
const FEED_TIMEOUT_MS = 30000;

/* A timeout reads as an ordinary abort, and "The operation was aborted" is not
   a sentence that tells Ray what to do. Named for what happened instead, on
   the screen where he is already asking why nothing has changed. */
function feedError(e){
  const name = e && e.name;
  if(name === 'TimeoutError' || name === 'AbortError')
    return `the feed did not answer within ${Math.round(FEED_TIMEOUT_MS / 1000)} seconds`;
  return `the feed could not be reached: ${(e && e.message) || e}`;
}


const bearer = req => {
  const h = req.headers.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1] : '';
};


/* The token rules, the guards, the zone validator and the date arithmetic all
   live in guards.js so they can be tested without a database (§14.6). */

/* ---------- the store ----------------------------------------------------- */

async function readCfg(env){
  const r = await env.DB.prepare('SELECT json FROM cfg WHERE id = 1').first();
  if(!r) return null;
  try { return JSON.parse(r.json); } catch { return null; }
}

async function readShifts(env, where = '', binds = []){
  const { results } = await env.DB.prepare(
    `SELECT json FROM shifts ${where}`).bind(...binds).all();
  return (results || []).map(r => { try { return JSON.parse(r.json); } catch { return null; } })
                        .filter(Boolean);
}

/* The `cfg` row holds companies, sites, roles and settings; `shifts` holds the
   shifts. Together they are the shape the page calls `S`, which is what
   feed.js was extracted to take (§14.7). */
async function readStore(env){
  const cfg = await readCfg(env) || {};
  return {
    companies: cfg.companies || [],
    sites: cfg.sites || [],
    roles: cfg.roles || [],
    settings: cfg.settings || {},
    shifts: await readShifts(env)
  };
}

/* ---------- the cron ------------------------------------------------------
   Idempotent, because Cron Triggers do not retry: an invocation that throws
   or times out is skipped silently until the next fire. A double-fire must be
   a no-op and a missed fire must cost nothing but the interval. The
   `shifts_ext_uid` index is what makes the first of those a fact rather than
   a hope.
   ---------------------------------------------------------------------- */
async function poll(env){
  const store = await readStore(env);
  const job = feedJob(store.companies);
  if(!job) return record(env, 'unknown', { ok: 0, reason: 'no job is configured for the feed' });
  if(!env.ICS_URL) return record(env, job.id, { ok: 0, reason: 'the calendar address is not set' });

  let text = '', ms = 0;
  const t0 = Date.now();
  try {
    // One deadline over the whole read, headers and body alike (§50.1). A feed
    // that *refuses* has always been caught here and recorded; a feed that
    // *hangs* was the one failure this cron could not report on itself, because
    // the invocation is terminated rather than rejected — `ctx.waitUntil` dies
    // with it, the catch below never runs, and the poll leaves no row at all.
    // A gap in a log that writes on every branch is the hardest kind of fault
    // to read, and this app exists to refuse silent staleness.
    //
    // Aborting the signal errors the body stream too, so `res.text()` is
    // covered by the same deadline as the request — a feed that opens and then
    // stops sending is the same hang wearing a different hat.
    const res = await fetch(env.ICS_URL, {
      headers: { 'user-agent': 'shift-deck/1' },
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS)
    });
    ms = Date.now() - t0;
    if(!res.ok) return record(env, job.id, { ok: 0, reason: `the feed answered ${res.status}`, ms });
    text = await res.text();
  } catch (e) {
    return record(env, job.id, { ok: 0, reason: feedError(e), ms: Date.now() - t0 });
  }

  // Everything between the text and the writes, and the only part of the cron
  // worth arguing with. `unreadable` is a distinct condition rather than noise
  // to be skipped quietly: a calendar written to by one app and nothing else
  // contains shifts and only shifts, so a row that will not parse says
  // Homebase has changed its format (§14.9).
  const { report, plan, refuse, unreadable } = planPoll({ text, store, env });
  if(refuse) return record(env, job.id, { ok: 0, reason: refuse, events: report.events, unreadable, ms });

  const stamp = nowISO();
  const writes = [];
  // The deletes go first, and the order is not cosmetic. `shifts_ext_uid` is
  // unique per (company, ext_uid) and a batch is checked statement by
  // statement, so a shift taking over the UID of a row that is on its way out
  // in the same pass would fail the whole batch if the two were the other way
  // round. Nothing in the plan writes a row it then deletes — a shift claimed
  // by the feed is never stale — so there is nothing to lose by clearing the
  // way first.
  //
  // The cancellations and the superseded copies leave by the same statement:
  // both are rows this feed says are no longer a shift he works. They are two
  // groups rather than one only because §14.6's ceiling counts one of them
  // (guards.js) — a feed that has come back truncated must not be allowed to
  // empty a week, and collapsing a duplicate empties nothing (§51).
  for(const s of plan.remove.concat(plan.stale))
    writes.push(env.DB.prepare(`DELETE FROM shifts WHERE id = ? AND source = 'feed'`).bind(s.id));
  for(const row of plan.add)
    writes.push(insert(env, feedRow(row, newId()), stamp));
  for(const rep of plan.replace)
    // In place, keeping the shift's id, and SEQUENCE goes up so a calendar
    // that already holds the old revision does not ignore the new one (§22).
    writes.push(insert(env, feedRow(rep.row, rep.id, (rep.was.seq || 0) + 1), stamp));

  writes.push(env.DB.prepare(
    `INSERT INTO raw (job_id, ics, fetched_at) VALUES (?, ?, ?)
     ON CONFLICT(job_id) DO UPDATE SET ics = excluded.ics, fetched_at = excluded.fetched_at`
  ).bind(job.id, text, stamp));

  // One batch, so a poll either lands whole or not at all. Half an applied
  // diff is the state there is no way to recover from without knowing which
  // half.
  if(writes.length) await env.DB.batch(writes);

  return record(env, job.id, {
    ok: 1, events: report.events, unreadable, ms,
    added: plan.add.length, replaced: plan.replace.length,
    // Both kinds of delete, because `removed` is what the poll log counts and
    // a row that left the table left the table. `stale` rides along beside it
    // for the answer "Poll now" hands straight back to the Setup screen: it is
    // not a column in `polls`, and the one-off collapse of a doubled schedule
    // is worth being able to read as what it was.
    removed: plan.remove.length + plan.stale.length, stale: plan.stale.length,
    unchanged: plan.unchanged,
    newest: newestStamp(text)
  });
}

/* The cron never writes anything but source='feed', which is the phone's half
   of §14.3's bargain kept from this side. */
function insert(env, shift, stamp){
  return env.DB.prepare(
    `INSERT INTO shifts (id, company_id, source, ext_uid, date, json, updated_at)
     VALUES (?, ?, 'feed', ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       ext_uid = excluded.ext_uid, date = excluded.date,
       json = excluded.json, updated_at = excluded.updated_at
     WHERE shifts.source = 'feed'`
  ).bind(shift.id, shift.companyId, shift.extUid || null, shift.date,
         JSON.stringify(shift), stamp);
}

async function record(env, jobId, p){
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO polls (job_id, at, ok, reason, events, added, replaced, removed,
                          unchanged, unreadable, ms, newest)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(jobId, nowISO(), p.ok ? 1 : 0, p.reason || null, p.events || 0,
           p.added || 0, p.replaced || 0, p.removed || 0, p.unchanged || 0,
           p.unreadable || 0, p.ms || null, p.newest || null),
    // Trimmed to the last 50 (§14.8) — the same append-and-trim that
    // Heritage-Hooves' tick_run and Scheduling_App's reward_entries use.
    env.DB.prepare(
      `DELETE FROM polls WHERE id NOT IN (SELECT id FROM polls ORDER BY id DESC LIMIT 50)`)
  ]);
  return p;
}

const newId = () => 'f' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);

/* ---------- endpoints ----------------------------------------------------- */

/* The phone sends `cfg` and its own shifts. Anything that is not the expected
   shape is rejected rather than stored: a half-written cfg breaks the cron on
   its next tick, and the phone would never hear about it. */
async function push(req, env){
  if(!tokenOK(env.PUSH_TOKEN, bearer(req)))
    return new Response('no', { status: 401 });

  let body;
  try { body = await req.json(); } catch { return bad('that was not JSON'); }
  if(!body || typeof body !== 'object') return bad('expected an object');
  const { cfg, shifts } = body;
  if(!cfg || typeof cfg !== 'object' || !Array.isArray(cfg.companies))
    return bad('cfg must carry a companies array');
  if(!Array.isArray(shifts)) return bad('shifts must be an array');
  for(const s of shifts){
    if(!s || !s.id || !s.companyId || !/^\d{4}-\d{2}-\d{2}$/.test(s.date || ''))
      return bad('every shift needs an id, a companyId and an ISO date');
    if(s.source === 'feed')
      return bad("the phone does not write source='feed' shifts");
  }

  // The settings are narrowed to what this side actually reads before anything
  // is written. The phone narrows them too, but a phone that installed the app
  // before that change keeps sending the old shape — sw.js holds app.js in the
  // shell cache — so this is the half that makes it true. Storing `pushToken`
  // and `icsUrl` put two credentials in a row that never had a use for either.
  const kept = { ...cfg, settings: safeSettings(cfg.settings) };

  const stamp = nowISO();
  const writes = [
    env.DB.prepare(
      `INSERT INTO cfg (id, json, updated_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`
    ).bind(JSON.stringify(kept), stamp),
    // The phone owns its half whole: what it did not send, it deleted. The
    // WHERE clause is §14.3's column ownership — the cron's rows are not the
    // phone's to clear.
    env.DB.prepare(`DELETE FROM shifts WHERE source != 'feed'`)
  ];
  for(const s of shifts)
    writes.push(env.DB.prepare(
      `INSERT INTO shifts (id, company_id, source, ext_uid, date, json, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?)`
    ).bind(s.id, s.companyId, s.source === 'pattern' ? 'pattern' : 'manual',
           s.date, JSON.stringify(s), stamp));

  await env.DB.batch(writes);
  return json({ ok: true, shifts: shifts.length, at: stamp });
}

/* What ICSx⁵ subscribes to. Rebuilt whole on every request from one SELECT,
   so a removal reaches the phone by itself and duplicates stay structurally
   impossible. ICSx⁵ is not a browser and sends no preflight. */
async function feed(env, token){
  if(!tokenOK(env.FEED_TOKEN, token))
    return new Response('no', { status: 404 });    // 404, not 401: nothing here says a feed exists

  const store = await readStore(env);
  const body = feedICS(store.shifts, store);
  return new Response(body, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'cache-control': 'no-store',
      'content-disposition': 'inline; filename="work-schedule.ics"'
    }
  });
}

/* Pass two of §14.7, and the half that makes the app the thing he looks at.

   The cron's shifts exist only here. Until the phone can read them back its
   Schedule shows one job out of two and its Pay screen is short by a whole
   employer's hours — confidently wrong rather than visibly empty, which is the
   failure §23 is the record of. The calendar was right the whole time, and the
   calendar is the backup; the app is what he opens.

   Only `source='feed'` rows go down. Everything else on this server arrived
   from the phone in the first place, and handing it back would invite the two
   copies to disagree about which is newer. §14.3 gives each side a column it
   owns, and this is that same line read in the other direction: the push
   replaces everything that is not `feed`, this replaces everything that is.
   Neither can half-apply, and neither needs to know what the other did. */
async function feedShifts(env){
  // Same answer as /status gives before the schema is applied: an ordinary
  // state, not a 500. The phone must be able to tell "no tables yet" from "no
  // shifts", because one of those is a reason to wipe its local copy and the
  // other is very much not.
  if(!(await tablesExist(env)))
    return json({ needsSetup: true, shifts: [], at: nowISO() });
  return json({ shifts: await readShifts(env, `WHERE source = 'feed'`), at: nowISO() });
}

/* Everything a screen needs to draw his week, and nothing that could change it
   (§45).

   Deliberately not `/shifts`, which answers with the cron's half alone. That
   filter exists because the phone asking already holds the manual and pattern
   rows it wrote; a second phone holds nothing, so the whole `shifts` table is
   the answer here — all three sources, the same set `feedICS` builds the
   calendar from.

   `cfg` comes back with it rather than behind a second call, because the two
   are one answer: a shift's colour, its site, its role and what its hours pay
   all live in `cfg`, and a viewer that had the shifts but not the companies
   would draw an unnamed grey week and a pay tab of dashes. It is already the
   narrowed row `safeSettings` wrote — the push token and the employer's
   calendar address were never in it — so there is nothing further to strip.

   One timestamp, `at`, and the viewer shows it. A read-only screen has no way
   to tell a schedule that has not changed from a server it has stopped
   reaching, and on a phone that is the whole failure: an empty Saturday that
   is really a fetch that failed four days ago. */
async function readAll(env){
  if(!(await tablesExist(env)))
    return json({ needsSetup: true, cfg: null, shifts: [], at: nowISO() });
  const cfg = await readCfg(env) || {};
  return json({
    cfg: {
      companies: cfg.companies || [],
      sites: cfg.sites || [],
      roles: cfg.roles || [],
      settings: cfg.settings || {}
    },
    shifts: await readShifts(env),
    at: nowISO()
  });
}

/* What the kids' phone gets. PROJECT.md §46.

   `readAll` above hands back the store: every shift on file and the companies
   with their rates on them. This hands back a week of times and four fields a
   shift, and it is a separate function rather than a filter applied to that
   one because the difference between the two is the entire safety property of
   §46. A `/read` with a parameter would be one forgotten branch away from
   answering a child's phone with his gross.

   The window is closed twice. Once in SQL, so the rows outside it are never
   read out of D1 at all — `date` is a column, and `shifts_by_date` is the
   index §14.3 put on it. Once again in `soonOnly`, which is the half a test
   without a database can run. Neither is redundant: the SQL is what keeps the
   rest of the schedule out of the Worker's memory, and the pure function is
   what anything can check.

   `today` is his day, not the Worker's. A Worker runs on UTC, and a child
   opening this at seven in the evening in Chicago is five hours into the
   Worker's tomorrow — a window computed on UTC would drop today's evening
   shift off the front and show a day at the far end that has not arrived. So
   it goes through `zoneFor`/`todayIn`, exactly as the cron's own window does
   (§35, §37): the job's zone if it has one, the deploy-time `ZONE` if not. */
async function readSoon(env){
  if(!(await tablesExist(env)))
    return json({ needsSetup: true, today: null, days: KIDS_DAYS, shifts: [], at: nowISO() });

  const cfg = await readCfg(env) || {};
  const { zone } = zoneFor(feedJob(cfg.companies || []), env);
  const today = todayIn(zone);
  const last = shiftISO(today, KIDS_DAYS - 1);

  const rows = await readShifts(env, 'WHERE date >= ? AND date <= ?', [today, last]);
  return json({
    today,
    days: KIDS_DAYS,
    shifts: soonOnly(rows, cfg.companies || [], today),
    at: nowISO()
  });
}

/* The poll ring buffer and the current counts, for the app's Setup screen.
   §14.6's two alarms are computed here rather than in the page, so that the
   rule about what counts as "quietly stopped changing" has one home. */
async function status(env){
  // Being asked for status before the schema is applied is an ordinary state
  // — it is the state every new deploy starts in — so it answers rather than
  // throwing a 500 nobody can read.
  if(!(await tablesExist(env)))
    return json({ needsSetup: true, alarm: null, shifts: {}, polls: [],
                  message: 'The database has no tables yet. Press "Set up the database".' });

  // Which clock the next poll will read the feed on (§14.10). Reported rather
  // than assumed: the zone is a per-job field the app fills in, and the one
  // failure it has actually produced was the field being empty and this side
  // quietly falling back to Eastern — a whole schedule an hour out, with every
  // screen agreeing because every screen read the same number.
  const cfg = await readCfg(env) || {};
  const { zone, defaulted, source } = zoneFor(feedJob(cfg.companies || []), env);

  const { results: polls } = await env.DB.prepare(
    `SELECT * FROM polls ORDER BY id DESC LIMIT 50`).all();
  const rows = polls || [];
  const good = rows.find(p => p.ok);

  const counts = await env.DB.prepare(
    `SELECT source, COUNT(*) AS n FROM shifts GROUP BY source`).all();

  return json({
    shifts: Object.fromEntries((counts.results || []).map(r => [r.source, r.n])),
    lastGood: good ? good.at : null,
    zone, zoneDefaulted: defaulted, zoneSource: source,
    // §14.6's two alarms, computed in guards.js so that "quietly stopped
    // changing" means one thing here and on the Setup screen. The failure this
    // project exists to catch is not a wrong shift, it is a calendar that has
    // stopped changing without saying so.
    alarm: alarmFor(rows),
    polls: rows
  });
}

/* ---------- the trace (§34) -----------------------------------------------
   Everything the phone needs to see the whole path in one answer, so that
   testing against the real Worker is something that can be checked rather
   than hoped about.

   `/status` was already here and is not this. It answers "is the cron still
   running", which is a question about time; this answers "what is actually in
   the database and what would the calendar get", which is a question about
   rows. The two failures this project has actually produced — a feed of
   "[object Object]" and a second copy of an employer's calendar under a dead
   company id — were both invisible to the first question and obvious to the
   second.

   The feed is rendered rather than counted from the table, because rendering
   it is the only way to be sure the thing ICSx⁵ fetches is the thing the rows
   say it should be. It costs one build of a file that is at most a few
   hundred events.
   ---------------------------------------------------------------------- */
async function trace(env){
  if(!(await tablesExist(env)))
    return json({ needsSetup: true, companies: [], groups: [], orphans: [],
                  feed: { events: 0, bytes: 0 }, at: nowISO() });

  const cfg = await readCfg(env) || {};
  const companies = (cfg.companies || []).map(c => ({
    id: c && c.id, name: c && c.name, feed: !!(c && c.icsFeed) }));
  const job = feedJob(cfg.companies || []);

  // By company as well as by source. `/status` groups by source alone, which
  // is precisely the shape that cannot show an orphan: two copies of the same
  // employer's calendar are both `feed`, and the count simply doubles with
  // nothing to say why.
  const { results } = await env.DB.prepare(
    `SELECT company_id, source, COUNT(*) AS n, MIN(date) AS first, MAX(date) AS last
       FROM shifts GROUP BY company_id, source ORDER BY company_id, source`).all();
  const groups = results || [];

  const store = await readStore(env);
  const body = feedICS(store.shifts, store);

  const last = await env.DB.prepare(
    `SELECT at, ok, reason, events, added, replaced, removed FROM polls ORDER BY id DESC LIMIT 1`
  ).first();

  return json({
    companies,
    jobId: job ? job.id : null,
    groups,
    orphans: orphanGroups(groups, cfg.companies || []),
    feed: { events: countEvents(body), bytes: body.length },
    lastPoll: last || null,
    at: nowISO()
  });
}

/* ---------- the teardown (§34) --------------------------------------------
   One button's worth of server, and the only thing in this file that crosses
   §14.3's line between the phone's rows and the cron's. It is allowed to
   because it is not a sync: it is the end of a test, and what it is undoing
   is precisely the state neither side can see well enough to undo on its own.

   Counted before it is cleared, and the counts come back. "Cleared" with no
   number is indistinguishable from "there was nothing there", and the whole
   point of pressing this is to be told what the test left behind.

   `drop` is the harder option and is not the default. Clearing the rows
   leaves the schema standing, so the next phone to hold the token can push
   the moment it is set up; dropping the tables puts the database back to the
   state a fresh deploy is in, which is tidier and means the cron writes
   literally nothing — `record` throws into the handler's own catch — but the
   next phone must press "Set up the database" before its first push will
   land. That is a real trap on the morning somebody is being handed a
   working app, so it is asked for explicitly or not done.
   ---------------------------------------------------------------------- */
async function reset(req, env){
  let body = null;
  try { body = await req.json(); } catch { body = null; }
  const drop = !!(body && body.drop);

  const exists = await tablesExist(env);
  if(!exists && !drop)
    return json({ ok: true, already: true, dropped: false, before: {}, at: nowISO() });

  const before = exists ? await tableCounts(env) : {};
  const plan = resetPlan({ drop });
  await env.DB.batch(plan.map(sql => env.DB.prepare(sql)));

  return json({ ok: true, dropped: drop, statements: plan.length, before, at: nowISO() });
}

/* One row of four counts, so the teardown can say what it removed. Separate
   statements would be four round trips to say one sentence. */
async function tableCounts(env){
  const r = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM shifts) AS shifts,
            (SELECT COUNT(*) FROM cfg)    AS cfg,
            (SELECT COUNT(*) FROM raw)    AS raw,
            (SELECT COUNT(*) FROM polls)  AS polls`).first();
  return r || {};
}

/* Applied from the app's Settings screen. Nobody is asked to paste SQL into
   the D1 console (§14.9), and running it twice is harmless by construction. */
async function migrate(env){
  const stmts = splitSQL(schemaSQL);
  // A schema that parsed to nothing is a bug in the splitter, not an empty
  // database. Saying so beats reporting "0 statements applied" as a success.
  if(stmts.length < 4) throw new Error(`the schema parsed to ${stmts.length} statements, which cannot be right`);
  // One at a time rather than in a batch, so a failure names the statement
  // that caused it instead of the whole file. Every one is IF NOT EXISTS, so
  // a run that stops halfway can simply be run again.
  for(const sql of stmts){
    try { await env.DB.prepare(sql).run(); }
    catch (e) { throw new Error(`${e.message} — while running: ${sql.split('\n')[0].slice(0, 80)}`); }
  }
  return json({ ok: true, statements: stmts.length });
}

/* ---------- the poll, by hand (§50.2) -------------------------------------
   The same `poll()` the cron runs, awaited rather than handed to `waitUntil`,
   so that its outcome comes back in the response instead of only into a table.

   It exists because of the evening this section is named for. The cron stopped
   and there was no way to ask it anything: the Setup screen could show that no
   poll had been recorded for seven hours, and nothing anywhere could say
   whether the schedule was firing and dying or not firing at all. Those have
   opposite fixes and the log looked identical either way — a gap.

   Pressing this collapses that. If it answers, the code, the secrets, the feed
   and D1 writes are all fine and the fault is the schedule. If it answers with
   a reason, the reason is the fault and it is now written down. If it hangs for
   thirty seconds and comes back saying the feed did not answer, that was the
   fault all along, and the cron had been dying of it silently every tick.

   Not a new code path, deliberately. A "test the feed" button that fetched and
   parsed without writing would prove something adjacent and not the thing —
   this runs the poll, guards and batch and all, and its record lands in the
   same ring buffer as the cron's. What the button does is remove the wait. */
async function pollNow(env){
  if(!(await tablesExist(env)))
    return json({ ok: false, error: 'The database has no tables yet. Press "Set up the database".' }, 409);
  try {
    // `poll` returns the record it wrote, which is exactly what /status would
    // show fifteen minutes -- or two hours -- later.
    return json({ ok: true, poll: await poll(env), at: nowISO() });
  } catch (e) {
    // The same fallback `scheduled` uses, for the same reason: a throw here is
    // still a fact about the poll and belongs in the log with the rest.
    const reason = `the poll threw: ${e.message}`;
    try { await record(env, 'unknown', { ok: 0, reason }); } catch { /* the database is what failed */ }
    return json({ ok: false, error: reason }, 500);
  }
}

/* Has the schema been applied? Asked of sqlite_master rather than by catching
   a failure, so that a real database error is not read as "not set up yet". */
async function tablesExist(env){
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('cfg','shifts','raw','polls')`
  ).first();
  return !!r && r.n === 4;
}

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: JSON_HEAD });
const bad = msg => json({ ok: false, error: msg }, 400);

export default {
  async fetch(req, env){
    try { return await route(req, env); }
    catch (e) {
      // Without this a thrown error is a bare 500 with no body, which is what
      // the Setup screen showed while the migration was silently applying two
      // statements out of seven. The message is ours and names no secret.
      return json({ ok: false, error: e.message || String(e) }, 500);
    }
  },

  async scheduled(event, env, ctx){
    ctx.waitUntil(poll(env).catch(async e => {
      // A throw here is a skipped tick, not a retry, so it has to leave a
      // trace of itself somewhere the Setup screen can find it.
      try { await record(env, 'unknown', { ok: 0, reason: `the poll threw: ${e.message}` }); }
      catch { /* the database is what failed; there is nowhere left to write */ }
    }));
  }
};

async function route(req, env){
  const url = new URL(req.url);
  const path = url.pathname;

  if(path === '/push' && req.method === 'POST') return push(req, env);

  const f = /^\/feed\/(.+)\.ics$/.exec(path);
  if(f && req.method === 'GET') return feed(env, decodeURIComponent(f[1]));

  // The push token, not the feed token. The phone holds exactly one secret;
  // FEED_TOKEN exists only to sit in the URL ICSx⁵ subscribes to, and
  // giving the app a second token to paste would be a second thing to get
  // wrong for no gain.
  if(path === '/status' && req.method === 'GET'){
    if(!tokenOK(env.PUSH_TOKEN, bearer(req))) return new Response('no', { status: 401 });
    return status(env);
  }

  // The phone reading the cron's half back down (§14.7 pass two). Behind the
  // push token like /status is, and for the same reason: it is his schedule,
  // and a schedule is exactly as private as the calendar the feed token
  // protects.
  if(path === '/shifts' && req.method === 'GET'){
    if(!tokenOK(env.PUSH_TOKEN, bearer(req))) return new Response('no', { status: 401 });
    return feedShifts(env);
  }

  // The read-only viewer's one route (§45). The only place `viewOK` is used,
  // and the only route a `VIEW_TOKEN` opens: everything above and below this
  // either writes or describes the machinery, and the second phone gets
  // neither. GET, so there is not even a verb here that could change anything.
  if(path === '/read' && req.method === 'GET'){
    if(!viewOK(env, bearer(req))) return new Response('no', { status: 401 });
    return readAll(env);
  }

  // The kids' one route (§46). A rolling week of start and end times with no
  // money anywhere in the answer, and the only route a `KIDS_TOKEN` opens —
  // `/read`, one route above, is not it. What makes the pay tab absent from
  // that phone is that the figures are not in what it is sent, not that its
  // page declines to draw them.
  if(path === '/soon' && req.method === 'GET'){
    if(!kidsOK(env, bearer(req))) return new Response('no', { status: 401 });
    return readSoon(env);
  }

  // Read-only, and behind the push token like everything else that describes
  // his schedule. This is the screen §34 gives him for checking a test against
  // the real server before it matters.
  if(path === '/trace' && req.method === 'GET'){
    if(!tokenOK(env.PUSH_TOKEN, bearer(req))) return new Response('no', { status: 401 });
    return trace(env);
  }

  // The teardown (§34). POST, and behind the same token: it is the most
  // destructive thing this Worker can be asked to do, and the app asks twice
  // before it gets here.
  if(path === '/reset' && req.method === 'POST'){
    if(!tokenOK(env.PUSH_TOKEN, bearer(req))) return new Response('no', { status: 401 });
    return reset(req, env);
  }

  // Running the cron's own poll on demand (§50.2). POST, because it writes
  // exactly what the cron writes, and behind the push token like the rest of
  // the machinery. The one thing on this Worker that can tell a schedule that
  // is not firing from a poll that is failing.
  if(path === '/poll' && req.method === 'POST'){
    if(!tokenOK(env.PUSH_TOKEN, bearer(req))) return new Response('no', { status: 401 });
    return pollNow(env);
  }

  if(path === '/migrate' && req.method === 'POST'){
    if(!tokenOK(env.PUSH_TOKEN, bearer(req))) return new Response('no', { status: 401 });
    return migrate(env);
  }

  // Everything else is the app, served from the same origin it calls.
  return env.ASSETS.fetch(req);
}
