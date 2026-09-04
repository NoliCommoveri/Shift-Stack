/* ==========================================================================
   Shift Deck, server side. PROJECT.md §14.

   Three endpoints and a cron, all on one Worker, which also serves the app
   itself. The app being same-origin is what removes CORS from this file
   entirely (§14.4) — there is no preflight handler and no origin allowlist
   because there is no cross-origin request to make.

   The import half is the reason this exists. `fetchCalendar` in the page
   fails permanently on Google's iCal addresses because they send no CORS
   headers; CORS is a rule browsers apply to themselves, and nothing here is
   a browser. The reader that runs against that fetch is ics.js unmodified,
   the same file the golden fixtures already test.
   ========================================================================== */

import icsMod from '../ics.js';
import feedMod from '../feed.js';
import mergeMod from '../merge.js';
import sitesMod from '../sites.js';
import guardsMod from './guards.js';
import schemaSQL from './schema.sql';

const { parseICS } = icsMod;
const { feedICS } = feedMod;
const { mergeCalendar } = mergeMod;
const { matchName } = sitesMod;
const { guard, alarmFor, feedJob, normalizeTimezone, todayIn, shiftISO,
        newestStamp, tokenOK, splitSQL } = guardsMod;

const JSON_HEAD = { 'content-type': 'application/json; charset=utf-8' };
const nowISO = () => new Date().toISOString();


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
   a no-op and a missed fire must cost nothing but fifteen minutes. The
   `shifts_ext_uid` index is what makes the first of those a fact rather than
   a hope.
   ---------------------------------------------------------------------- */
async function poll(env){
  const store = await readStore(env);
  const job = feedJob(store.companies);
  if(!job) return record(env, 'unknown', { ok: 0, reason: 'no job is configured for the feed' });
  if(!env.ICS_URL) return record(env, job.id, { ok: 0, reason: 'the calendar address is not set' });

  const zone = normalizeTimezone(job.zone);
  const today = todayIn(zone);
  const from = shiftISO(today, -7);

  let text = '', ms = 0;
  const t0 = Date.now();
  try {
    const res = await fetch(env.ICS_URL, { headers: { 'user-agent': 'shift-deck/1' } });
    ms = Date.now() - t0;
    if(!res.ok) return record(env, job.id, { ok: 0, reason: `the feed answered ${res.status}`, ms });
    text = await res.text();
  } catch (e) {
    return record(env, job.id, { ok: 0, reason: `the feed could not be reached: ${e.message}`, ms: Date.now() - t0 });
  }

  const { rows, report } = parseICS(text, { zone, from, match: job.icsMatch || '' });

  // A calendar written to by one app and nothing else contains shifts and only
  // shifts, so a row that will not parse is not noise to be skipped quietly —
  // it is a signal that Homebase has changed its format, or that something
  // else has started writing there (§14.9). Recorded as its own condition.
  const unreadable = report.unreadable || 0;

  const mine = store.shifts.filter(s => s.companyId === job.id && s.source === 'feed');
  const plan = mergeCalendar(mine, rows, report, job.id, { resolve: resolver(store, job.id) });

  const refuse = guard({ report, plan, mine, today });
  if(refuse) return record(env, job.id, { ok: 0, reason: refuse, events: report.events, unreadable, ms });

  const stamp = nowISO();
  const writes = [];
  for(const row of plan.add)
    writes.push(insert(env, { ...row, id: newId(), source: 'feed', seq: 0 }, stamp));
  for(const rep of plan.replace)
    // In place, keeping the shift's id, and SEQUENCE goes up so a calendar
    // that already holds the old revision does not ignore the new one (§22).
    writes.push(insert(env, { ...rep.row, id: rep.id, source: 'feed', seq: (rep.was.seq || 0) + 1 }, stamp));
  for(const s of plan.remove)
    writes.push(env.DB.prepare(`DELETE FROM shifts WHERE id = ? AND source = 'feed'`).bind(s.id));

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
    removed: plan.remove.length, unchanged: plan.unchanged,
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

/* Standing in for the page's applyNames: a feed row arrives with the text the
   employer wrote and no ids, and merge.js compares places on the identity the
   site table gives them. Without this every row would come back changed and
   the cron would rewrite the whole schedule every fifteen minutes (§14.7). */
function resolver(store, jobId){
  const sites = (store.sites || []).filter(s => s.companyId === jobId);
  const roles = (store.roles || []).filter(r => r.companyId === jobId);
  return row => {
    const m = matchName(row.siteRaw || row.label || '', sites);
    const r = matchName(row.roleRaw || row.role || '', roles);
    return { ...row, siteId: m.rec ? m.rec.id : null, roleId: r.rec ? r.rec.id : null };
  };
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

  const stamp = nowISO();
  const writes = [
    env.DB.prepare(
      `INSERT INTO cfg (id, json, updated_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`
    ).bind(JSON.stringify(cfg), stamp),
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

  const { results: polls } = await env.DB.prepare(
    `SELECT * FROM polls ORDER BY id DESC LIMIT 50`).all();
  const rows = polls || [];
  const good = rows.find(p => p.ok);

  const counts = await env.DB.prepare(
    `SELECT source, COUNT(*) AS n FROM shifts GROUP BY source`).all();

  return json({
    shifts: Object.fromEntries((counts.results || []).map(r => [r.source, r.n])),
    lastGood: good ? good.at : null,
    // §14.6's two alarms, computed in guards.js so that "quietly stopped
    // changing" means one thing here and on the Setup screen. The failure this
    // project exists to catch is not a wrong shift, it is a calendar that has
    // stopped changing without saying so.
    alarm: alarmFor(rows),
    polls: rows
  });
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

  if(path === '/migrate' && req.method === 'POST'){
    if(!tokenOK(env.PUSH_TOKEN, bearer(req))) return new Response('no', { status: 401 });
    return migrate(env);
  }

  // Everything else is the app, served from the same origin it calls.
  return env.ASSETS.fetch(req);
}
