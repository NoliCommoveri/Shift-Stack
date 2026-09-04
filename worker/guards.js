/* ==========================================================================
   The parts of the Worker that decide things. PROJECT.md §14.6.

   Separate from index.js so they can be tested, and they have to be: §14.6
   takes the review tick-box away from the Homebase path and puts these in its
   place. "A machine that checks the feed parsed, is non-empty, and is not
   proposing a massacre is a better safeguard than a tired man tapping yes
   through a review list at eleven at night" — that trade is only true if the
   machine is right, and nothing else in the system will notice if it is not.

   Everything here is pure. No D1, no fetch, no clock except where one is
   handed in.
   ========================================================================== */

/* Refuse to apply anything, and keep serving the last good feed, when any of
   §14.6's five conditions holds. Returns the reason to record, or null to go
   ahead. Each one is a way a *feed* fails — unreachable, empty, not a
   calendar, or proposing an implausible removal — as against the way a
   screenshot fails, which is by being partial and undetectable (§8.4). */
function guard({ report, plan, mine, today }){
  if(!report || report.notCalendar) return 'the feed did not parse as a calendar';
  if(!report.events) return 'the feed held no events';

  const held = mine || [];
  const gone = (plan && plan.remove) || [];

  // Nothing on file yet: the first poll is all additions, and a ceiling
  // computed from zero would refuse it.
  if(!held.length) return null;

  const ceiling = Math.max(3, Math.floor(held.length * 0.25));
  if(gone.length > ceiling)
    return `it would remove ${gone.length} of ${held.length} shifts in one pass`;

  const futureHeld = held.filter(s => s.date >= today);
  const futureGone = gone.filter(s => s.date >= today);
  if(futureHeld.length && futureGone.length >= futureHeld.length)
    return 'it would remove every future shift';

  return null;
}

/* §14.6's two alarms, computed in one place so that "quietly stopped
   changing" means the same thing to the Setup screen as it does here.
   `polls` is newest first. */
function alarmFor(polls, now = Date.now()){
  const rows = polls || [];
  if(!rows.length) return 'no poll has ever run';
  const good = rows.find(p => p.ok);
  if(!good) return 'no poll has ever succeeded';

  const leading = [];
  for(const p of rows){ if(p.ok) break; leading.push(p); }
  if(leading.length >= 2)
    return `${leading.length} polls in a row have refused: ${leading[0].reason}`;

  const hours = (now - Date.parse(good.at)) / 3600000;
  if(hours >= 6) return `${Math.floor(hours)} hours since the last good poll`;
  return null;
}

/* Which job the one secret calendar address belongs to: the job that says it
   is the feed's, or the only job there is. Anything else is ambiguous and
   refused rather than guessed at — filing a night's work against the wrong
   employer's rate is worse than not filing it. */
function feedJob(companies){
  const cos = companies || [];
  if(!cos.length) return null;
  return cos.find(c => c.icsFeed) || (cos.length === 1 ? cos[0] : null);
}

/* Cron Triggers are UTC-only and this Worker has no locale, so the zone is
   told to it and never inferred. A bare offset like `UTC+5` or `-05:00` is
   rejected, because an offset is wrong for half the year in any zone that
   observes DST — which is the whole failure worth catching.

   Rejecting it has to be explicit rather than left to `Intl`, which is the
   trap here: modern runtimes *accept* offset time zones, so `Intl` alone
   would take `-05:00` and be wrong every summer. Testing for a `/` instead
   was the other way to get this wrong, and it threw out `UTC`, which is a
   real zone and the one the Worker itself runs in. */
const DEFAULT_ZONE = 'America/Toronto';
function normalizeTimezone(z){
  const s = String(z || '').trim();
  if(!s) return DEFAULT_ZONE;
  if(/[+-]\d/.test(s)) return DEFAULT_ZONE;            // UTC+5, GMT-3, -05:00
  try { new Intl.DateTimeFormat('en-US', { timeZone: s }); return s; }
  catch { return DEFAULT_ZONE; }
}

/* Today where the shifts are, not where the Worker is. en-CA formats as
   YYYY-MM-DD, which is the one thing it is useful for. */
function todayIn(zone, at = new Date()){
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: normalizeTimezone(zone), year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(at);
}

/* Day arithmetic on a UTC day number, so it cannot pick up the runtime's
   zone. The Worker's is UTC and the phone's is not. */
function shiftISO(date, n){
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  if(!m) return date;
  return new Date(Date.UTC(+m[1], +m[2]-1, +m[3]) + n * 86400000).toISOString().slice(0, 10);
}

/* The newest DTSTAMP in the feed, which is how §14.8 turns "how stale is
   this" from an assumption in the design document into a number on a screen. */
function newestStamp(text){
  const all = [...String(text || '').matchAll(/^DTSTAMP:(\d{8}T\d{6}Z)/gm)].map(m => m[1]).sort();
  return all.length ? all[all.length - 1] : null;
}

/* Not `===`. A comparison that returns on the first wrong byte leaks the
   token a byte at a time to anyone willing to measure. The lengths are folded
   into the same accumulator so that a wrong length is not a faster no. */
function timingSafeEqual(a, b){
  const enc = new TextEncoder();
  const x = enc.encode(String(a)), y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for(let i = 0; i < n; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

/* An unset secret opens nothing. Not hypothetical: a secret only takes effect
   on a deploy made *after* it was added (§14.9), so this Worker genuinely
   runs with the token undefined for one deploy, and the choice is between
   failing closed and being open to the world for the length of it. */
function tokenOK(secret, given){
  if(!secret || !given) return false;
  return timingSafeEqual(secret, given);
}


/* The schema file, split into statements the database can be handed one at a
   time. Comments are stripped rather than used to decide what to keep: the
   first version filtered out any chunk that *began* with `--`, and every
   CREATE TABLE in schema.sql has an explanatory block above it, so seven
   statements became two — both of them CREATE INDEX, on tables that had just
   been dropped from the list. The migration failed with "no such table" and
   the app showed a bare 500.

   No string literal in schema.sql contains `--`, which is what makes stripping
   them this bluntly safe. If one ever does, this needs a real tokenizer. */
function splitSQL(sql){
  return String(sql || '')
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map(s => s.trim())
    .filter(Boolean);
}

/* What of `settings` the server is allowed to hold. PROJECT.md §14.3.

   The phone used to send `S.settings` whole, which meant `pushToken` — the
   secret that authorises writes to this Worker — was stored in the `cfg` row
   as cleartext, alongside `icsUrl`, the employer's secret calendar address.
   Neither was ever read back: the Worker validates against `env.PUSH_TOKEN`
   and polls `env.ICS_URL`, both of which are dashboard secrets. So the row
   held two credentials it had no use for, in a place with a much wider
   readership than a binding — the D1 console, any dump, every backup — and a
   rotated token went on living there as a stale copy.

   A whitelist rather than a blacklist, so that a setting added to the page
   later is withheld by default instead of leaking by default. The list is
   short because it is derived rather than chosen: it is exactly what
   `feedICS` reads off the store (`settings.leads`, feed.js:121), which is the
   only thing on this side that touches settings at all. It grows when the
   Worker starts reading something, and not before.

   The page whitelists too, so the secret never travels. This is the half that
   matters, because sw.js caches app.js in the shell: a phone that installed
   the app before the fix keeps running the old push for as long as its cache
   stands, and only the server can refuse what it sends. */
const SETTINGS_KEPT = ['leads'];

function safeSettings(settings){
  const from = (settings && typeof settings === 'object') ? settings : {};
  const out = {};
  for(const k of SETTINGS_KEPT) if(k in from) out[k] = from[k];
  return out;
}

module.exports = { guard, splitSQL, alarmFor, feedJob, normalizeTimezone, DEFAULT_ZONE,
                   todayIn, shiftISO, newestStamp, timingSafeEqual, tokenOK,
                   safeSettings, SETTINGS_KEPT };
