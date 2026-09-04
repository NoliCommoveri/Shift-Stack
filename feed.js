/* ==========================================================================
   The calendar file the app publishes. PROJECT.md §14.7.

   This was `buildICS` inside app.js, reading `S` and `coById` from module
   scope, which is exactly why it had to come out: §14 puts a Worker on the
   other end of the same feed, and a writer that can only run in the page
   means the phone and the Worker each keep their own. Two writers to one
   calendar drift, and the failure mode is a calendar that is subtly wrong
   rather than obviously broken — a shift an hour out, an alarm that never
   fires — which is the kind this project exists to prevent.

   So it takes its whole world as an argument, the way `parseICS` already
   does. The page hands it `S`; the Worker builds the same shape out of D1
   and the `cfg` row. One implementation, and the two paths cannot disagree.

   The reader half of the file format stays in ics.js, which owns it in both
   directions. What is here is the half that needs the store: which shifts,
   whose job, what title.
   ========================================================================== */

/* Node gets the collaborators by require; the browser already has them as
   globals, since this file loads after ics.js, patterns.js and sites.js.

   Every one is aliased to a local name rather than used bare. That is not
   style: `fold` was a global in ics.js and a *different* global of the same
   name in app.js, the later script won, and every UID, SUMMARY, DESCRIPTION
   and LOCATION line this function wrote came out as "[object Object]". The
   file still opened, still had the right number of events, and every one of
   them was unreadable. Aliasing means this file cannot be broken from the
   outside by a name it does not control. */
const _dep = _need(
  ['fold', 'icsEscape', 'icsStamp', 'shiftUID', 'restGaps', 'isShortRest', 'eventTitle', 'addressFor'],
  () => Object.assign({}, require('./ics.js'), require('./patterns.js'), require('./sites.js')));

/* Three environments load this file and each hands over its collaborators a
   different way: Node's test runner by `require`, the browser by globals set
   from the earlier <script> tags, and the Worker by esbuild, which rewrites
   the `require` calls below into direct references while bundling.

   The `try` is what makes the browser work — `require` is not defined there,
   so the call throws and the globals are used instead. The check afterwards
   is the part that matters: whatever route a name arrived by, it has to be a
   function before this file will run. Getting that wrong once already cost a
   calendar full of "[object Object]", and it cost it silently, so a missing
   collaborator now fails loudly at load rather than quietly at write. */
function _need(names, load){
  let mod = null;
  try { mod = load(); } catch (e) { mod = null; }
  const out = {};
  for(const n of names){
    const g = (typeof globalThis !== 'undefined') ? globalThis[n] : undefined;
    out[n] = (mod && typeof mod[n] === 'function') ? mod[n] : g;
    if(typeof out[n] !== 'function')
      throw new Error(`feed.js needs ${n}, and neither require nor the page provided it`);
  }
  return out;
}

const icsFold   = _dep.fold;
const icsEsc    = _dep.icsEscape;
const icsNow    = _dep.icsStamp;
const uidFor    = _dep.shiftUID;
const gapsIn    = _dep.restGaps;
const tooShort  = _dep.isShortRest;
const titleFor  = _dep.eventTitle;
const placeFor  = _dep.addressFor;

/* Kept here rather than in app.js because the calendar file is now a second
   consumer of both, and a duplicate would be one more thing to drift. app.js
   uses these same two off the global. */
function durMins(sh){
  let d = toMins(sh.end) - toMins(sh.start);
  if(d <= 0) d += 1440;                 // overnight
  return d;
}
function fmtDur(m){
  const h = Math.floor(m/60), r = m%60;
  return r ? `${h}h ${r}m` : `${h}h`;
}
function toMins(t){ const [h,m] = String(t).split(':').map(Number); return h*60+m; }

/* The day after `date`, in ISO. Done on a UTC day number so that it cannot
   pick up the runtime's zone — the Worker's is UTC and the phone's is not,
   and a shift ending at 07:00 must roll to the same date on both. */
function nextDay(date){
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  if(!m) return date;
  const d = new Date(Date.UTC(+m[1], +m[2]-1, +m[3]) + 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${
          String(d.getUTCDate()).padStart(2,'0')}`;
}

const feedById = (list, id) => (list || []).find(x => x.id === id) || null;

/* `only` is the shifts to write. `store` is the shape `S` has in the page —
   { shifts, companies, sites, roles, settings } — and `store.shifts` is the
   *whole* store rather than `only`, deliberately: the short-rest alarm is a
   property of a pair, and in manual-import mode `only` is the shifts not sent
   before, so the shift on the other side of the gap is routinely not in it.

   `opts.now` exists so a test can pin DTSTAMP. Nothing else passes it.

   Named `feedICS` and not `buildICS` on purpose: app.js keeps a `buildICS`
   of its own that supplies the store, both are plain globals in the browser,
   and one name for two functions is the exact bug this extraction was
   cleaning up. */
function feedICS(only, store, opts){
  store = store || {};
  const settings = store.settings || {};
  const now = icsNow((opts && opts.now) || new Date());
  const leads = (settings.leads || []).filter(n => n > 0);

  const rests = new Map();
  gapsIn(store.shifts || []).filter(g => tooShort(g.mins))
                            .forEach(g => rests.set(g.b.id, g.mins));

  const L = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Shift Deck//EN','CALSCALE:GREGORIAN',
             'METHOD:PUBLISH','X-WR-CALNAME:Work Schedule'];
  (only || []).forEach(s => {
    const co = feedById(store.companies, s.companyId);
    const endDate = toMins(s.end) <= toMins(s.start) ? nextDay(s.date) : s.date;
    // The hollow tick is in the app; the alarm is on the phone, and the phone
    // is where §8.3's stated risk actually lands. The title carries the mark,
    // and the alarm body reuses the title, so a 05:00 buzz for a shift nothing
    // has confirmed says which kind it is (§20.5).
    const title = titleFor(co && co.name, s, feedById(store.sites, s.siteId), feedById(store.roles, s.roleId)) +
                  (s.source === 'pattern' ? ' (from the rota)' : '');
    L.push('BEGIN:VEVENT',
      icsFold(`UID:${uidFor(s.id)}`),
      `DTSTAMP:${now}`,
      // A calendar may ignore a revision no newer than the one it holds, so a
      // shift that has been moved or retimed since it was sent has to say so.
      // The cancellation in ics.js counts from the same number (§22).
      `SEQUENCE:${s.seq || 0}`,
      `DTSTART:${s.date.replace(/-/g,'')}T${s.start.replace(':','')}00`,
      `DTEND:${endDate.replace(/-/g,'')}T${s.end.replace(':','')}00`,
      // Every event says which job it is. That is the whole point of the
      // normalising step: an employer's own sync writes "Security Officer"
      // with nothing to say whose shift it is, and two jobs' worth of those
      // on one calendar is unreadable.
      icsFold('SUMMARY:' + icsEsc(title)),
      icsFold('DESCRIPTION:' + icsEsc(`${fmtDur(durMins(s))} scheduled`
        + (rests.has(s.id) ? `\nOnly ${fmtDur(rests.get(s.id))} off before this one.` : ''))));
    // §8.1's single best reason to have built any of this: the two-hour alarm
    // fires, he taps the event, taps the address, and he is navigating. The
    // shift's own address wins over the site's standing one — a feed row
    // carries what the employer published for that night.
    const where = placeFor(s, feedById(store.sites, s.siteId));
    if(where) L.push(icsFold('LOCATION:' + icsEsc(where)));
    leads.forEach(h => {
      L.push('BEGIN:VALARM','ACTION:DISPLAY',
        icsFold('DESCRIPTION:' + icsEsc(title)),
        `TRIGGER:-PT${h}H`, 'END:VALARM');
    });
    // It fires as the shift before it ends, not on the morning of this one.
    // The gap here is 08:00 to 15:00 as often as not, and a notice that
    // arrives at 09:00 reaches him driving home off a twelve-hour night with
    // the decision already made. At the clock-out he is awake and can still
    // choose what to do with the afternoon.
    const rest = rests.get(s.id);
    if(rest){
      const rh = Math.floor(rest / 60), rm = rest % 60;
      L.push('BEGIN:VALARM','ACTION:DISPLAY',
        icsFold('DESCRIPTION:' + icsEsc(`Heads up: only ${fmtDur(rest)} off between shifts.`)),
        `TRIGGER:-PT${rh}H${rm ? rm + 'M' : ''}`, 'END:VALARM');
    }
    L.push('END:VEVENT');
  });
  L.push('END:VCALENDAR');
  return L.join('\r\n');
}

/* Node picks these up for the tests; the browser just gets the globals. */
if(typeof module !== 'undefined' && module.exports){
  module.exports = { feedICS, durMins, fmtDur, nextDay };
}
