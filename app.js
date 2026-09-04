/* ==========================================================================
   Shift Deck
   Everything lives on this device. Nothing is sent anywhere.
   ========================================================================== */

/* ---------- storage ------------------------------------------------------ */
const DEFAULTS = {
  companies: [],
  // Places, with the spellings each one answers to (§8.1). A flat table
  // carrying its own `companyId` rather than a list inside each job, because
  // the common read is a shift resolving its `siteId` — one lookup, no job to
  // find first — and the by-job list is only ever wanted on the Setup screen.
  sites: [],
  // Job titles, with the spellings each one answers to and what an hour of it
  // pays (§27). Flat and carrying its own `companyId` for the same reason the
  // sites are: the common read is a shift resolving its `roleId`.
  roles: [],
  shifts: [],
  // Shifts that were deleted after a calendar had already been told about
  // them. Not history — a to-do list with one item on it: say the event is
  // off. Emptied the moment that has been said (§22).
  tombstones: [],
  // Which sections of the Setup screen are folded open (§28). Stored rather
  // than held in memory because the screen is rebuilt on almost every edit —
  // a fold that sprang back open each time he renamed a role would be worse
  // than no fold at all — and because collapsing a job he has finished setting
  // up is a decision that should still hold next week.
  settings: { leads: [12, 2], feedMode: 'subscribe', icsUrl: '', open: {} }
};
let S = structuredClone(DEFAULTS);

const idb = {
  db: null,
  async open(){
    if(this.db) return this.db;
    this.db = await new Promise((res, rej) => {
      const r = indexedDB.open('shiftdeck', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('doc');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return this.db;
  },
  async get(){
    const db = await this.open();
    return new Promise((res, rej) => {
      const r = db.transaction('doc').objectStore('doc').get('state');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async put(v){
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction('doc','readwrite');
      t.objectStore('doc').put(JSON.parse(JSON.stringify(v)), 'state');
      t.oncomplete = res;
      t.onerror = () => rej(t.error);
    });
  }
};

async function loadState(){
  try{
    const v = await idb.get();
    if(v) S = Object.assign(structuredClone(DEFAULTS), v);
  }catch(e){ /* first run, or storage blocked */ }
}
let saveTimer = null;
function save(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => idb.put(S).catch(()=>{}), 120);
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2,9));

/* ---------- date helpers -------------------------------------------------
   MONTHS, WEEKDAYS, iso() and asDate() live in parser.js, which loads first.
   ---------------------------------------------------------------------- */
const DAYNAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHNAMES = ['January','February','March','April','May','June','July',
                    'August','September','October','November','December'];

const todayISO = () => { const n = new Date(); return iso(n.getFullYear(), n.getMonth(), n.getDate()); };
function shiftDays(s, n){ const d = asDate(s); d.setDate(d.getDate()+n); return iso(d.getFullYear(), d.getMonth(), d.getDate()); }
function mins(t){ const [h,m] = t.split(':').map(Number); return h*60+m; }
// 24-hour throughout. am/pm is the single most dangerous character in this
// app -- 23:00 cannot be misread the way 11:00pm can, so the display never
// uses it. The parser still reads am/pm off screenshots; that is input.
function fmtTime(t){
  const [h,m] = t.split(':').map(Number);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}
function durMins(sh){
  let d = mins(sh.end) - mins(sh.start);
  if(d <= 0) d += 1440;                 // overnight
  return d;
}
function fmtDur(m){
  const h = Math.floor(m/60), r = m%60;
  return r ? `${h}h ${r}m` : `${h}h`;
}
// Start of the pay week containing `dateStr`, for a week beginning on `startDow`.
function weekStart(dateStr, startDow){
  const d = asDate(dateStr);
  const back = (d.getDay() - startDow + 7) % 7;
  return shiftDays(dateStr, -back);
}

/* A shift the app proposed from a declared rota (§8.3), which nothing has
   confirmed yet. Every screen that presents a shift as a fact has to ask this
   — the schedule, the pay tab, the horizon note and the calendar file — and
   §20 is the record of what each of them did before it could. */
const isProposed = s => !!s && s.source === 'pattern';

/* ---------- deleting a shift the calendar already has (§10.6, §22) --------
   Subscription mode is immune: the file is the whole calendar, so a shift
   removed from the store is removed from the next rebuild and the event goes
   with it. Manual import has no such moment — it only ever adds — so a shift
   deleted here keeps its event and its alarms on the phone forever, and the
   app had no idea it had done that.

   So every removal of a shift goes through here first. A shift that was never
   sent leaves nothing behind and is dropped silently; one that was sent leaves
   a record naming the event it left on the phone, which is the only thing a
   cancellation can be built from once the shift — and often the job — is gone.

   The sequence number goes up. RFC 5545 lets a calendar ignore a revision no
   newer than the one it holds, so a cancellation counting from the same number
   as the publication can legitimately be thrown away.
   ---------------------------------------------------------------------- */
function retire(list){
  if(!S.tombstones) S.tombstones = [];        // a backup restored from before §22
  (list || []).forEach(sh => {
    if(!sh || !sh.sent) return;                 // no event out there to cancel
    const co = coById(sh.companyId);
    // An overnight shift's event ends on the next day. Guarded, because this
    // runs on the way out and a delete that throws is a delete that does not
    // happen — a filed shift always has both times, but nothing here needs to
    // depend on that being true.
    const overnight = sh.start && sh.end && mins(sh.end) <= mins(sh.start);
    S.tombstones.push({
      uid: shiftUID(sh.id),
      seq: (sh.seq || 0) + 1,
      date: sh.date, start: sh.start, end: sh.end,
      endDate: overnight ? shiftDays(sh.date, 1) : sh.date,
      // Baked now rather than looked up later: by the time this is written to
      // a file the job may have been removed too, and an event the importer
      // shows as "cancelled: Shift" tells him nothing.
      title: eventTitle(co && co.name, sh, siteById(sh.siteId)),
      at: todayISO()
    });
  });
}

/* Removes shifts and records what the calendar still needs telling about.
   Every delete path in the app goes through this one, because a path that
   forgets is a shift that rings at five in the morning for a job he no longer
   has, and nothing on any screen would say why. */
function dropShifts(pred){
  const going = S.shifts.filter(pred);
  if(!going.length) return 0;
  retire(going);
  S.shifts = S.shifts.filter(x => !pred(x));
  return going.length;
}

/* Cancellations still owed to the calendar. Empty in subscription mode by
   construction — see doExport. */
const owedCancels = () => (S.tombstones || []);

/* Shifts whose event text has just changed underneath them — a site renamed,
   an address added, a merge moving them to a record with another name. §8.1
   warns that changing `SUMMARY` at all rewrites every event, and this is the
   half of that warning the app can actually act on: the calendar goes on
   showing the old name until it is told, and it may ignore a revision no newer
   than the one it holds (§22). So the number goes up and the shift goes back
   in the queue for the next export.

   Subscription mode does not need this — the file is rebuilt whole — but it
   costs nothing there, and manual-import mode is where an event silently
   keeping a name nobody uses any more would sit for months. */
function restamp(pred){
  let n = 0;
  S.shifts.filter(pred).forEach(sh => {
    if(!sh.sent) return;
    sh.seq = (sh.seq || 0) + 1;
    sh.sent = false;
    n++;
  });
  return n;
}

/* ---------- review flags -------------------------------------------------
   parser.js emits codes; the wording lives here so changing it never breaks
   a test fixture. FLAG_MOVED is raised by the importer, not the parser.
   ---------------------------------------------------------------------- */
const FLAG_MOVED = 'moved';
const FLAG_CHANGED = 'changed';
const FLAG_HOLIDAY = 'holiday';
const FLAG_SITE = 'site';
const FLAG_ROLE = 'role';
/* A value here may be a function of the row. Most of these sentences are the
   same every time they are said; the site one has to name two spellings, and
   naming them is the whole content of it. */
const FLAG_TEXT = {
  [FLAG.NODATE]:  'No date found \u2014 set it below.',
  [FLAG.AMPM]:    'No am/pm was printed \u2014 check the times.',
  [FLAG.SPLIT]:   'Times were read from two separate lines \u2014 check them.',
  [FLAG.WEEKDAY]: 'The weekday on screen does not match this date.',
  [FLAG.ONETIME]: 'Only one time could be read \u2014 set the missing one below.',
  [FLAG.FIXEDAP]: 'The am/pm was printed on its own line and has been applied \u2014 check it.',
  [PAT_FLAG.FLIPPED]: 'Twelve hours out from a shift declared for this job, and corrected \u2014 check it.',
  [PAT_FLAG.OFFPAT]:  'This is not a shift declared for this job \u2014 check the day and the times.',
  [PAT_FLAG.ODDLEN]:  'That is an unusual length for a shift \u2014 check the times.',
  [PAT_FLAG.CLASH]:   'This runs over a shift already on file.',
  [FLAG_MOVED]:   'A shift is already on file at this time in a different place \u2014 adding this will not replace it.',
  [FLAG_CHANGED]: 'The calendar has moved a shift already on file.',
  [FLAG_HOLIDAY]: 'A statutory holiday falls on this day \u2014 remove this row if he is not working it.',
  [FLAG_SITE]: p => `Read as \u201c${p.siteRaw}\u201d and taken as `
    + `${(siteById(p.siteId) || {}).name} \u2014 adding this row remembers that spelling.`,
  // The site's sentence, plus the money. A near match on a role decides what
  // an hour of it is worth, and §27 is emphatic that a figure checked against
  // a deposit weeks later must never rest on a guess nobody was shown.
  [FLAG_ROLE]: p => {
    const role = roleById(p.roleId) || {};
    const rate = rateFor(p, role, coById(p.companyId));
    return `Read as \u201c${p.roleRaw}\u201d and taken as ${role.name}`
      + (rate == null ? '' : `, paid $${rate.toFixed(2)} an hour`)
      + ' \u2014 adding this row remembers that spelling.';
  },
  [ICS_FLAG.NOEND]: 'The calendar gave no end time \u2014 set one below.',
  [ICS_FLAG.RECUR]: 'A repeating event \u2014 only the first was read.',
  [ICS_FLAG.ZONE]:  'The time zone was not recognised \u2014 times taken as written.',
  [ICS_FLAG.LONG]:  'This runs for more than a day, which no shift should.'
};

/* ---------- the site table (§8.1) ----------------------------------------
   `sites.js` owns the matching, the aliases and the merge. What lives here is
   the part that needs the store: which sites belong to which job, and how a
   row coming off a reader acquires a `siteId`.

   This replaces `snapSite()`, which matched a fresh read against the labels
   already sitting in `S.shifts` — the parser's own unvalidated output — so one
   bad read became a "known site" and everything after it snapped to the
   mistake. `sites.js` says why that had to go.
   -------------------------------------------------------------------- */
const siteById = id => (S.sites || []).find(s => s.id === id);
const sitesFor = companyId => (S.sites || []).filter(s => s.companyId === companyId);
const roleById = id => (S.roles || []).find(r => r.id === id);
const rolesFor = companyId => (S.roles || []).filter(r => r.companyId === companyId);

/* What this shift pays an hour, or null if nothing has said. */
const shiftRate = s => rateFor(s, roleById(s.roleId), coById(s.companyId));

/* What names this shift on screen, and the address the calendar should carry.
   Both go through the same two functions everywhere, so a shift with no site
   reads as its label in every single place rather than in most of them. */
const shiftWhere = s => whereText(s, siteById(s.siteId), ' \u00b7 ', roleById(s.roleId));
const shiftAddress = s => addressFor(s, siteById(s.siteId));

/* Splitting a label into the two things it might be naming.

   Two of them, because matching and suggesting want different answers to the
   same ambiguity. `labelCandidates` is for the menus: the whole string is
   offered to both lists, because a label with no separator in it could be
   naming either and a menu is a question, not an answer. `labelParts` has to
   choose one, so it asks the tables — `readLabel` in sites.js is the rule, and
   this is the half that knows which job's records to ask about. */
function labelCandidates(label){
  const { role, site } = splitLabel(label);
  return site ? { role: role.trim(), site: site.trim() }
              : { role: role.trim(), site: role.trim() };
}

const labelParts = (label, companyId) =>
  readLabel(label, sitesFor(companyId), rolesFor(companyId), splitLabel);

/* Resolve a review row against both tables. Runs before the row is compared
   with anything on file, because "same shift" is an identity question once the
   records exist and a spelling question only when they do not.

   `siteRaw` and `roleRaw` are kept on the row: they are what was actually
   read, and they are what get recorded as spellings if he confirms the match.

   The two halves are deliberately independent. A screenshot naming a place the
   app knows and a job title it does not must still resolve the half it can —
   the alternative is a row that files under nothing because one word of it was
   unfamiliar. */
function applyNames(p){
  const parts = labelParts(p.label, p.companyId);
  p.siteRaw = parts.siteRaw;
  p.roleRaw = parts.roleRaw;
  // `role` is the text that was read, kept for the same reason `label` is: it
  // is what the shift reads as when its role record is later deleted.
  p.role = parts.roleRaw;

  // A site and a role both belong to one job, so changing the job on a review
  // row unsets them and the row is matched again against the new job's tables.
  // Undated TrackTik screens make that a routine correction (§16.1).
  const heldSite = siteById(p.siteId);
  if(heldSite && heldSite.companyId !== p.companyId){ p.siteId = null; p.siteHow = ''; }
  const heldRole = roleById(p.roleId);
  if(heldRole && heldRole.companyId !== p.companyId){ p.roleId = null; p.roleHow = ''; }

  if(!p.siteId){
    const m = matchName(p.siteRaw, sitesFor(p.companyId));
    p.siteId = m.rec ? m.rec.id : null;
    p.siteHow = m.how;
  }else if(!p.siteHow){
    p.siteHow = 'kept';               // arrived resolved; nothing was read
  }
  if(!p.roleId){
    const m = matchName(p.roleRaw, rolesFor(p.companyId));
    p.roleId = m.rec ? m.rec.id : null;
    p.roleHow = m.how;
  }else if(!p.roleHow){
    p.roleHow = 'kept';
  }
  // A matched role names the shift better than the text that was read, and it
  // is the name every screen and every event title will use from here.
  const rec = roleById(p.roleId);
  if(rec) p.role = rec.name;
  nameFlags(p);
}

/* Amber only for the near miss, on either table. An exact hit says nothing
   worth reading, and a row that matched nothing is not an error — §8.1 chose a
   nullable `siteId` precisely so that a name nobody recognises still files,
   under the text that was read, and §27 chose a nullable `roleId` the same way
   so that an unknown job title falls back to the job's own rate rather than
   blocking the import. What has to be looked at is the case where the app has
   decided two different spellings are the same thing, because that is the one
   it can be wrong about, and the one that is about to be remembered. */
function nameFlags(p){
  p.flags = (p.flags || []).filter(f => f !== FLAG_SITE && f !== FLAG_ROLE);
  if(p.siteHow === 'near') p.flags = [...p.flags, FLAG_SITE];
  if(p.roleHow === 'near') p.flags = [...p.flags, FLAG_ROLE];
}

/* The site column of a review row. Archived sites are off the list unless the
   row is already pointing at one, and the last option is the one that gets
   used on day one, when the table is empty and every row matched nothing.

   The name is asked for rather than taken, prefilled with what was read: a
   record made straight out of OCR would put "De Ia Montagme" on the calendar
   for ever, and this is the one moment somebody is looking at both the text
   and the screen it came from. */
function siteOptions(p){
  const live = sitesFor(p.companyId).filter(s => !s.archived || s.id === p.siteId);
  const opts = [`<option value=""${p.siteId ? '' : ' selected'}>\u2014 no site \u2014</option>`];
  live.forEach(s => opts.push(
    `<option value="${esc(s.id)}"${s.id === p.siteId ? ' selected' : ''}>${esc(s.name)}</option>`));
  opts.push(`<option value="+">+ Add ${
    p.siteRaw ? `\u201c${esc(p.siteRaw)}\u201d` : 'a site'}\u2026</option>`);
  return opts.join('');
}

/* The same, for roles, with the rate on the option. It is there because this
   is the moment the choice is made and the rate is the entire reason the role
   table exists — picking between "Cook" and "Cook Plant ASO" with the money
   printed beside each is a different act from picking between two words. */
function roleOptions(p){
  const co = coById(p.companyId);
  const live = rolesFor(p.companyId).filter(r => !r.archived || r.id === p.roleId);
  const base = co && co.rate != null && co.rate !== '' ? +co.rate : null;
  const opts = [`<option value=""${p.roleId ? '' : ' selected'}>\u2014 no role${
    base == null ? '' : `, $${base.toFixed(2)}`} \u2014</option>`];
  live.forEach(r => opts.push(
    `<option value="${esc(r.id)}"${r.id === p.roleId ? ' selected' : ''}>${esc(r.name)}${
      r.rate == null ? '' : ` \u2014 $${(+r.rate).toFixed(2)}`}</option>`));
  opts.push(`<option value="+">+ Add ${
    p.roleRaw ? `\u201c${esc(p.roleRaw)}\u201d` : 'a role'}\u2026</option>`);
  return opts.join('');
}

function pickSite(p, v){
  if(v === '+'){
    const name = prompt('Name this site the way it should read everywhere', p.siteRaw || '');
    if(!name || !name.trim()) return;         // cancelled: the row is unchanged
    const site = newSite(uid(), p.companyId, name.trim(), '');
    S.sites.push(site);
    p.siteId = site.id;
    p.siteHow = 'set';
    save();
  }else{
    p.siteId = v || null;
    p.siteHow = v ? 'set' : 'none';
  }
  nameFlags(p);
}

/* Adding a role asks for the rate as well as the name, in the same breath. It
   could be left to the Setup screen, and then the first week of a new job
   title would quietly price itself at the job's default and look right. Asking
   here costs one more tap at the only moment somebody is thinking about this
   role at all. Empty is a real answer and means the job's own rate stands. */
function pickRole(p, v){
  if(v === '+'){
    const name = prompt('Name this role the way it should read everywhere', p.roleRaw || '');
    if(!name || !name.trim()) return;         // cancelled: the row is unchanged
    const co = coById(p.companyId);
    const ask = prompt(`What does an hour of ${name.trim()} pay?`
      + (co && co.rate ? ` Leave it empty to use ${co.name}\u2019s $${(+co.rate).toFixed(2)}.`
                       : ' Leave it empty if it is the same as the rest of the job.'), '');
    if(ask === null) return;                  // cancelled at the rate, not at the name
    const rate = ask.trim() === '' ? null : +ask.trim();
    const role = newRole(uid(), p.companyId, name.trim(),
                         Number.isFinite(rate) && rate >= 0 ? rate : null);
    S.roles.push(role);
    p.roleId = role.id;
    p.roleHow = 'set';
    p.role = role.name;
    save();
  }else{
    p.roleId = v || null;
    p.roleHow = v ? 'set' : 'none';
    const rec = roleById(p.roleId);
    p.role = rec ? rec.name : (p.roleRaw || '');
  }
  nameFlags(p);
}

/* The confirmation half of §8.1's "aliases are the real prize", now for both
   tables. A row reaching the commit path has been through the review screen
   with its matches named on it, so whichever records it is pointing at then
   are the ones he is confirming, and the spellings that were read become
   spellings those records answer to. Next month the same misreading is an
   exact hit and says nothing.

   Only the two cases where something was actually decided record anything:
   `near`, where the app guessed and he let it stand, and `set`, where he
   pointed the row at a record himself — which is the more valuable of the two,
   because it is the spelling the matcher could not get to on its own. An
   `exact` hit has nothing to teach, and a record carried in with a generated
   row was never read off anything.

   A spelling learned in error is removable on the record's card in Setup,
   which is what makes this an act of committing rather than one more tick-box
   on every amber row. */
function learnSpellings(p){
  const teach = (rec, how, raw) => {
    if(!rec || (how !== 'near' && how !== 'set')) return;
    addAlias(rec, raw);
  };
  teach(siteById(p.siteId), p.siteHow, p.siteRaw);
  teach(roleById(p.roleId), p.roleHow, p.roleRaw);
}

/* ---------- pay maths ---------------------------------------------------- */
/* The clock, less the job's unpaid break. `pay.js` owns the rule; what is here
   is the shift record it has to be read off. */
const shiftPaidMins = (sh, co) => paidMins({ mins: durMins(sh) }, co);
function weeksFor(co){
  const map = new Map();
  S.shifts.filter(s => s.companyId === co.id).forEach(s => {
    const ws = weekStart(s.date, co.weekStart ?? 0);
    if(!map.has(ws)) map.set(ws, []);
    map.get(ws).push(s);
  });
  return [...map.entries()].sort((a,b) => b[0].localeCompare(a[0]));
}
/* One week's figures. The arithmetic is `pay.js`, and deliberately so — §27
   put it in a file of its own the moment a week could hold two rates, because
   a mixed-rate gross is checked against a real deposit and is the last thing
   in the app that should live where nothing can test it.

   What is left here is the lookup: which role each shift is, and therefore
   what its hours cost. A shift with no role, or a role with no rate of its
   own, prices at the job's rate exactly as every shift did before §27. */
function weekTotals(shifts, co){
  return weekPay(shifts.map(s => {
    const role = roleById(s.roleId);
    return {
      mins: shiftPaidMins(s, co),
      rate: rateFor(s, role, co),
      key: role ? role.id : 'co',
      name: role ? role.name : (co.name || 'the job\u2019s rate')
    };
  }), co);
}

/* ---------- rendering ---------------------------------------------------- */
const $ = s => document.querySelector(s);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if(cls) n.className = cls;
  if(html !== undefined) n.innerHTML = html;
  return n;
};
const esc = s => String(s??'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const coById = id => S.companies.find(c => c.id === id);

/* -- folding sections away (§28) ------------------------------------------
   The Setup screen grew past five thousand pixels once every job carried a
   rota, a role table and a site table, and it is a screen used on a phone. So
   each job is a fold, and each section inside it is a fold.

   The rule the whole thing rests on: a collapsed fold has to say enough that
   opening it is a choice rather than a search. A summary that reads "Roles"
   and nothing else is not a fold, it is a thing hidden. So every one of them
   carries its own state — the rates, the counts, the names — and the screen
   stays readable folded shut.

   State lives in `S.settings.open`, keyed `<jobId>` for a job and
   `<jobId>/<section>` for a section inside it. Absent means shut: a job set up
   months ago is a job he is not editing. The one exception is a job just
   added, which `#addco` opens by hand, because a job with nothing in it is a
   form and not a record. */
const foldOpen = (key, fallback) => {
  const v = (S.settings.open || {})[key];
  return v === undefined ? !!fallback : !!v;
};

/* Returns the `<details>` and the empty body to fill. `head` is the fold's
   name and `note` is what it says while shut — both are HTML, and callers
   escape their own. */
function fold(key, head, note, open){
  const d = el('details', 'fold');
  d.open = foldOpen(key, open);
  d.appendChild(el('summary', null,
    `<span class="foldname">${head}</span><span class="foldnote">${note || ''}</span>`));
  const body = el('div', 'foldbody');
  d.appendChild(body);
  // Assigned after `open` is set, and still guarded: the toggle event is
  // queued rather than immediate, so a render can deliver one saying exactly
  // what was already stored, and writing that back would put the store on
  // every redraw for nothing.
  d.ontoggle = () => {
    S.settings.open = S.settings.open || {};
    if(S.settings.open[key] === d.open) return;
    S.settings.open[key] = d.open;
    save();
  };
  return { d, body };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;

/* What each fold says while it is shut. Kept together because they have to
   read as one voice down the card, and because the temptation in each of them
   separately is to say more than a shut fold can hold. */
const money = n => '$' + (+n).toFixed(2);

function payNote(co){
  const bits = [];
  bits.push(co.rate == null || co.rate === '' ? 'no rate set' : money(co.rate) + '/h');
  bits.push('week from ' + DAYNAMES[co.weekStart ?? 0]);
  if(co.otAfterHrs) bits.push(`OT after ${co.otAfterHrs} h`);
  if(co.breakMins && co.breakAfterHrs)
    bits.push(`${co.breakMins} min off shifts over ${co.breakAfterHrs} h`);
  return esc(bits.join(' \u00b7 '));
}

function appNote(co){
  const bits = [];
  if(co.pkg) bits.push(co.pkg);
  if(co.icsMatch) bits.push(`only \u201c${co.icsMatch}\u201d`);
  if(co.holidays){
    const h = holidayPlaces().find(x => x.id === co.holidays);
    if(h) bits.push(h.name);
  }
  return esc(bits.length ? bits.join(' \u00b7 ') : 'nothing set');
}

function rotaNote(co){
  const pats = validPatterns(co.patterns);
  if(!pats.length) return 'none declared';
  const fills = pats.filter(p => p.days).length;
  return esc(plural(pats.length, 'declared shift')
    + (fills ? `, ${fills} can fill a week` : ', none fills a week'));
}

/* The two tables name themselves. A count alone would not answer the question
   he opens this section to ask, which is nearly always "is the one I am
   thinking of in here". Archived records are counted apart rather than left
   out: they still match nothing and still hold shifts. */
function tableNote(list, none, extra){
  const live = list.filter(x => !x.archived), gone = list.length - live.length;
  if(!list.length) return esc(none);
  const names = live.map(x => x.name).join(', ');
  const tail = gone ? ` \u00b7 ${gone} archived` : '';
  return esc(names + (extra ? extra(live) : '') + tail);
}

/* The job's own line. The rate range is first because it is the thing two jobs
   differ by at a glance, and it spans the roles: a job whose roles pay $22 and
   $28 does not have one rate to print. */
function jobNote(co){
  const roles = rolesFor(co.id).filter(r => !r.archived);
  const rates = [...new Set(roles.map(r => r.rate).filter(r => r != null).map(Number)
    .concat(co.rate == null || co.rate === '' ? [] : [+co.rate]))].sort((a, b) => a - b);
  const bits = [rates.length === 0 ? 'no rate set'
    : rates.length === 1 ? money(rates[0]) + '/h'
    : `${money(rates[0])}\u2013${money(rates[rates.length - 1])}/h`];
  const pats = validPatterns(co.patterns).length;
  if(pats) bits.push(plural(pats, 'declared shift'));
  if(roles.length) bits.push(plural(roles.length, 'role'));
  const sites = sitesFor(co.id).filter(x => !x.archived).length;
  if(sites) bits.push(plural(sites, 'site'));
  return esc(bits.join(' \u00b7 '));
}

/* -- typing a time (§24) --------------------------------------------------
   fmtTime() above refuses to print am/pm anywhere, for the reason stated
   there. Every field that took a time contradicted it: `<input type="time">`
   is drawn by the phone in the phone's locale, and on his that is a 12-hour
   spinner with an AM/PM segment. The review screen exists to catch an am/pm
   misread (§6, §16.2) and it was handing him am/pm to correct it with.

   These two build a text box instead. parseClock() in parser.js decides what
   a typed time is; what the box does with the answer is decided here:

   - anything that parses is committed as it is typed, so the note lines under
     each row keep up with the keystrokes exactly as they did before;
   - the box is rewritten to HH:MM when he leaves it, which is where a "9pm"
     transcribed off the employer's screen visibly becomes 21:00;
   - anything that does not parse stays on screen, marked, and commits
     nothing. Half-typed times pass through this state constantly, so it is
     drawn quietly and the value on file is simply left alone.

   inputmode=numeric is deliberate: the phone offers a keypad, which is the
   fast way to enter 1500 and no way at all to enter "3 pm". A meridiem is
   tolerated, not invited. */
const CLOCK_ATTRS = 'type="text" class="clock" inputmode="numeric" ' +
  'autocomplete="off" spellcheck="false" placeholder="HH:MM"';
const clockInput = (value, extra = '') =>
  `<input ${CLOCK_ATTRS} ${extra} value="${esc(value || '')}">`;

/* `set` is called with 'HH:MM' — or '' when the box is emptied and the caller
   allows that — and never with anything else. The handle it returns reads the
   field for callers that only commit on a button (the edit dialog). */
function bindClock(inp, set, opts = {}){
  const read = () => inp.value.trim() === ''
    ? (opts.allowEmpty ? '' : null)
    : parseClock(inp.value);
  const mark = v => inp.setAttribute('aria-invalid', v === null ? 'true' : 'false');
  const live = () => { const v = read(); mark(v); if(v !== null && set) set(v); };
  inp.oninput = live;
  inp.onchange = live;                       // paste, autofill
  inp.onblur = () => { const v = read(); if(v) inp.value = v; mark(v); };
  return { read, settle: () => inp.onblur() };
}

/* -- next shift banner -- */
function nextShift(){
  const now = new Date();
  const cands = S.shifts
    .map(s => ({ s, at: new Date(`${s.date}T${s.start}:00`) }))
    .filter(x => x.at.getTime() + durMins(x.s)*60000 > now.getTime())
    .sort((a,b) => a.at - b.at);
  return cands[0] || null;
}
function renderNext(){
  const wrap = $('#nextwrap');
  wrap.innerHTML = '';
  const n = nextShift();
  if(!n){
    wrap.appendChild(el('div','card soft','<span class="tiny">No upcoming shifts on file.</span>'));
    return;
  }
  const co = coById(n.s.companyId);
  const d = asDate(n.s.date);
  const rel = Math.round((n.at - new Date())/60000);
  let cd;
  if(rel <= 0) cd = 'On shift now';
  else if(rel < 60) cd = `Starts in ${rel} min`;
  else if(rel < 1440) cd = `Starts in ${Math.floor(rel/60)}h ${rel%60}m`;
  else cd = `In ${Math.round(rel/1440)} days`;

  const box = el('div','next');
  box.innerHTML = `
    <div class="lbl">NEXT SHIFT</div>
    <div class="big">${DAYNAMES[d.getDay()]} ${d.getDate()} ${MONTHNAMES[d.getMonth()].slice(0,3)} &middot; ${esc(fmtTime(n.s.start))}</div>
    <div class="sub">${esc(co ? co.name : 'Unassigned')} &middot; ${esc(shiftWhere(n.s))} &middot; ${fmtDur(durMins(n.s))}</div>
    <div class="cd">${cd}</div>`;
  wrap.appendChild(box);
}

/* -- launcher buttons -- */
function renderLaunchers(){
  const box = $('#launchers');
  box.innerHTML = '';
  S.companies.filter(c => c.pkg).forEach(c => {
    const b = el('button','ghost', 'Open ' + esc(c.name));
    b.onclick = () => {
      const url = `intent://#Intent;package=${c.pkg};S.browser_fallback_url=${
        encodeURIComponent('https://play.google.com/store/apps/details?id=' + c.pkg)};end`;
      location.href = url;
    };
    box.appendChild(b);
  });
}

/* -- schedule list -- */
/* How close the last shift on file has to be before the schedule is treated as
   probably unimported rather than genuinely empty. */
const HORIZON_DAYS = 3;

/* "Nothing on file after Friday", per job.

   An empty calendar reads as a day off, which is the silent failure this whole
   app exists to prevent, and the only existing signal for it is a line of text
   in Setup that he has no reason to open. This one sits on Schedule, which is
   where he actually looks.

   It is per job because the two jobs fail differently. Trupoint's shifts arrive
   through Homebase's Calendar Sync, so a short horizon there is the sync's
   business, not his. DSI is screenshots and manual adds only — nothing is
   coming unless he brings it — so a short horizon there is a job to do, and
   that is the case this warning is really for. Same fact, two meanings, so
   they get two sentences.

   A feed-backed job is one with an icsMatch set, which is already how a
   calendar event finds its job. No new field, and nothing to migrate. */
function horizonNotes(){
  const today = todayISO();
  const soon = shiftDays(today, HORIZON_DAYS);
  const many = S.companies.length > 1;

  const out = [];
  S.companies.forEach(co => {
    const mine = S.shifts.filter(s => s.companyId === co.id && s.date >= today);
    // Confirmed only. A week filled from the rota would otherwise switch this
    // note off, which turns the one standing prompt to act into a reassurance
    // about four assumptions (§20.3).
    const ahead = mine.filter(s => !isProposed(s));
    const proposed = mine.filter(isProposed);
    const last = ahead.reduce((a, s) => s.date > a ? s.date : a, '');
    const lastAny = mine.reduce((a, s) => s.date > a ? s.date : a, '');
    const fed = !!String(co.icsMatch || '').trim();
    const rota = canGenerate(co.patterns);
    // With one job there is no name in front, so the sentence has to start itself.
    const head = t => many ? `${co.name} — ${t}` : t[0].toUpperCase() + t.slice(1);

    // A week filled from the rota is not nothing, and saying "nothing on file"
    // over four visible shifts reads as a bug rather than a distinction. It is
    // a quieter note than the one below because the state is better — there is
    // a schedule, it is just an assumed one — and it names the way out of it.
    if(proposed.length){
      const to = proposed.reduce((a, s) => s.date > a ? s.date : a, '');
      out.push({ text: head(`filled from the rota to ${fmtDay(to)} — ` +
        `${proposed.length} shift${proposed.length===1?'':'s'}, none confirmed yet. ` +
        'A screenshot of that week confirms them.'), fed: true });
    }

    // The alarm below is about running out of schedule altogether, so it is
    // measured against everything on file, assumed or not — but what it counts
    // as an answer is only what has been confirmed.
    if(!(lastAny && lastAny > soon)){
      // "Confirmed" only once there is something unconfirmed to distinguish it
      // from. On a job that has never generated a week, this is §17.3's
      // sentence unchanged.
      const kind = proposed.length ? 'confirmed' : 'on file';
      const when = last ? `nothing ${kind} after ${fmtDay(last)}` : `nothing ${kind} at all`;
      out.push({
        text: fed
          ? `${head(when)}. The calendar should be filling this — check Calendar Sync.`
          : rota
            ? `${head(when)}. Nothing is coming automatically for this job — fill a week from the rota in Add.`
            : `${head(when)}. Nothing is coming automatically for this job — add next week.`,
        fed
      });
    }

    // The pile-up warning §8.3 asked for, and §17.2 put here. It counts the
    // proposals whose date has *passed* unconfirmed, because that is the state
    // that means the screenshots stopped arriving and nobody noticed. Counting
    // the ones still ahead would fire on the ordinary case the day after he
    // fills a week, which is §19.1's mistake exactly.
    const stale = S.shifts.filter(s => s.companyId === co.id && isProposed(s) &&
                                       s.date < today && s.date >= shiftDays(today, -14));
    if(stale.length)
      out.push({ text: head(`${stale.length} shift${stale.length===1?'':'s'} in the last fortnight ` +
        `came from the rota and ${stale.length===1?'was':'were'} never confirmed against a screenshot. ` +
        'The hours and the pay for those are assumptions.'), fed: false });
  });
  return out;
}

/* A date as "Fri 11 Sep" — short enough to read inside a sentence. */
function fmtDay(d){
  const x = asDate(d);
  return `${DAYNAMES[x.getDay()].slice(0,3)} ${x.getDate()} ${MONTHNAMES[x.getMonth()].slice(0,3)}`;
}

/* The same date, said the way he would say it. "Fri 11 Sep" is right for a
   week away and wrong for tomorrow, and tomorrow is when it matters. */
function dayPhrase(d){
  const today = todayISO();
  if(d === today) return 'today';
  if(d === shiftDays(today, 1)) return 'tomorrow';
  return fmtDay(d);
}

/* ---------- the calendar is behind this screen (§10.5, §23) ---------------
   The other half of §10.5. The horizon note says the app is missing shifts;
   this says the *phone* is, which is worse: he looks at a calendar that is
   confidently wrong rather than visibly empty, and the alarms come from it.

   Until now the only signal was a line in Setup he has no reason to open.

   When it fires is the whole design, and §19.1 is why. A note that appears
   the moment anything is uncommitted would be on screen through the ordinary
   import-review-export minute, every time, and a permanently amber screen
   teaches him to stop reading the amber that means something. So the trigger
   is not "something is unexported" — it is "something unexported is close
   enough that the alarms are the next thing to happen". Outside that window
   there is time, and nothing is wrong yet.

   §10.5 asked for "last exported N days ago" as the headline. It is not the
   headline: a feed saved ten days ago with nothing changed since is not stale,
   it is correct. What is pending is the fact; how long it has been pending is
   colour, and it is said as colour.
   ---------------------------------------------------------------------- */

/* Inside this, the alarms for it are the next thing due and an export is late
   rather than pending. Outside the second, there is time and no warning. */
const EXPORT_LATE_DAYS = 2;
const EXPORT_SOON_DAYS = 7;

/* Joins clauses the way a person would: "a", "a and b", "a, b and c". */
function andList(parts){
  if(parts.length < 3) return parts.join(' and ');
  return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
}

/* "tomorrow", not "on tomorrow". */
function onDay(d){
  const p = dayPhrase(d);
  return (p === 'today' || p === 'tomorrow') ? p : `on ${p}`;
}

function staleNotes(){
  const today = todayISO();
  const sub = S.settings.feedMode !== 'import';
  const soon = shiftDays(today, EXPORT_SOON_DAYS);
  const late = shiftDays(today, EXPORT_LATE_DAYS);
  const out = [];

  // A shift in the past is not a calendar problem any more. Its alarms have
  // been and gone, and exporting now changes nothing that can still happen.
  const pend = S.shifts.filter(s => !s.sent && s.date >= today);
  // `seq` tells the two apart with no new field: it only rises when a shift
  // that had already been sent is changed (§22.3). So an unsent shift with a
  // sequence number is one the calendar holds an *older version* of, and one
  // without is a shift the calendar has never heard of. The distinction is
  // worth making because the failures differ — nothing at all, or an alarm at
  // the wrong time — even though the fix is the same export.
  const missing = pend.filter(s => !s.seq);
  const changed = pend.filter(s => s.seq);

  if(pend.length){
    const first = pend.reduce((a, s) => s.date < a ? s.date : a, '9999-99-99');
    if(first <= soon){
      // One shift names its own day; several need the day of the nearest, or
      // "the soonest" has nothing to be the soonest of.
      let lead;
      if(pend.length === 1){
        lead = missing.length
          ? `A shift ${onDay(first)} is not in the calendar.`
          : `A shift ${onDay(first)} has changed since it was sent — the calendar still has the old one.`;
      } else {
        const bits = [];
        if(missing.length) bits.push(missing.length === 1
          ? '1 shift is not in the calendar'
          : `${missing.length} shifts are not in the calendar`);
        if(changed.length) bits.push(missing.length
          ? (changed.length === 1 ? '1 has changed since it was sent'
                                  : `${changed.length} have changed since they were sent`)
          : `${changed.length} shifts have changed since they were sent`);
        lead = `${andList(bits)}. The soonest is ${dayPhrase(first)}.`;
      }

      let t = lead;
      // Only when it is late. Said always, this is the clause he stops seeing.
      if(first <= late)
        t += ' The alarms on the phone come from the last export, not from this screen.';
      t += ` Save ${sub ? 'the feed file' : 'new shifts'} in Setup.`;

      const days = daysSinceExport();
      if(days !== null && days >= 3) t += ` Last saved ${days} days ago.`;

      out.push({ text: t, late: first <= late });
    }
  }

  // The other direction, and manual import only: the calendar holding an event
  // for a shift that is not happening. A subscription drops it on the next
  // rebuild without being asked (§22).
  const owed = (sub ? [] : owedCancels()).filter(t => t.date >= today);
  if(owed.length){
    const first = owed.reduce((a, t) => t.date < a ? t.date : a, '9999-99-99');
    if(first <= soon){
      out.push({
        text: (owed.length === 1
          ? `A deleted shift is still in the calendar ${onDay(first)}, with its alarms.`
          : `${owed.length} deleted shifts are still in the calendar, the soonest ${onDay(first)}, with their alarms.`)
          + ' Save the cancellations in Setup.',
        late: first <= late
      });
    }
  }

  return out;
}

/* Whole days since the feed was last written, or null if it never has been.
   Only ever used to explain a backlog that has already earned a warning. */
function daysSinceExport(){
  const at = S.settings.lastExport;
  if(!at) return null;
  const then = new Date(at);
  if(isNaN(then)) return null;
  return Math.floor((Date.now() - then.getTime()) / 86400000);
}

/* The standing warning. The horizon notes say what is missing; this says what
   is wrong, and it is louder because it is worse.

   It has to be a banner rather than only a line beside the shift, because the
   way a clash arrives is unattended: Calendar Sync writes a Trupoint shift
   into Google, the .ics comes in, and it lands on top of a DSI shift already
   on file. Nobody is looking at that week when it happens. A warning he has to
   scroll to the right week to find is a warning about a shift he has already
   stopped thinking about.

   It never proposes a fix. Which of the two is wrong is not something this app
   can know — the feed may be right and the screenshot stale, or the reverse —
   so it names both and he decides. */
function clashNotes(){
  const today = todayISO();
  return clashPairs(S.shifts.filter(s => s.date >= shiftDays(today, -1)))
    .map(({ a, b, mins: m }) => {
      const side = sh => {
        const co = coById(sh.companyId);
        return `${co ? co.name : 'Unassigned'} ${fmtTime(sh.start)}\u2013${fmtTime(sh.end)}`;
      };
      return `${fmtDay(a.date)}: ${side(a)} runs over ${side(b)} by ${fmtDur(m)}. ` +
             'He cannot work both \u2014 one of them is wrong.';
    });
}

/* The rest note (§25). Quieter than the clash above it and louder than the
   horizon notes below, which is exactly what it costs: a clash is a shift he
   is going to miss and a short horizon is a job to do, while this is a night
   he is going to spend differently than he planned to.

   Near horizon only. The gap is a fact about next Thursday as much as about
   tonight, but it is only *actionable* on the day — what he does with the
   information is set an alarm before he lies down — and a standing note about
   a week away is the amber screen §23 refused to build. So it appears when the
   shift he is going back to is today, tomorrow, or the day after.

   It states the gap and stops. How he spends six hours is not this app's
   business, and §19.4's reason applies again in a different key: a warning
   that also gives advice is one he has to disagree with rather than read. */
const REST_SOON_DAYS = 2;

function restNotes(){
  const today = todayISO();
  const soon = shiftDays(today, REST_SOON_DAYS);
  return restGaps(S.shifts)
    .filter(g => isShortRest(g.mins) && g.b.date >= today && g.b.date <= soon)
    .map(({ a, b, mins: m }) => {
      const side = sh => {
        const co = coById(sh.companyId);
        return `${co ? co.name : 'Unassigned'} ${fmtTime(sh.start)}\u2013${fmtTime(sh.end)}`;
      };
      return `Heads up: only ${fmtDur(m)} off ${onDay(b.date)}, between ` +
             `${side(a)} and ${side(b)}.`;
    });
}

function renderHorizon(){
  const wrap = $('#horizon');
  if(!wrap) return;
  wrap.innerHTML = '';
  const notes = horizonNotes();
  const bad = clashNotes();
  const stale = staleNotes();
  const rest = restNotes();
  wrap.hidden = !(notes.length || bad.length || stale.length || rest.length);
  // Worst first, and the order is by what it costs. A double booking is a
  // shift he is going to miss. A stale calendar is a shift he has, whose alarm
  // will not fire or will fire at the wrong time. A short rest is a shift he
  // will work tired. A short horizon is only a job to do.
  bad.forEach(t => {
    const p = el('p','flag horizon clash');
    p.textContent = t;
    wrap.appendChild(p);
  });
  stale.forEach(n => {
    const p = el('p', 'flag horizon' + (n.late ? ' late' : ''));
    p.textContent = n.text;
    wrap.appendChild(p);
  });
  rest.forEach(t => {
    const p = el('p','flag horizon rest');
    p.textContent = t;
    wrap.appendChild(p);
  });
  notes.forEach(n => {
    const p = el('p', 'flag horizon' + (n.fed ? ' fed' : ''));
    p.textContent = n.text;
    wrap.appendChild(p);
  });
}

/* -- how far back each list opens (§29) -----------------------------------
   Both lists used to open on a fixed slice of the past — the schedule on the
   last seven days, the pay tab on eight weeks — and both were wrong in the
   same way. What he opens the schedule to see is this week; what a week's
   worth of scrolling before it costs is the first thing he wanted, above the
   fold, pushed below it.

   So the past is behind a button on both. Not thrown away: last Tuesday's
   shift is still on file, still exported, still counted. It is one tap down
   rather than in the way.

   These two flags are deliberately *not* in the store. `renderAll()` runs on
   every edit, so they have to survive a redraw — opening the past and then
   editing a shift in it must not fold it away again — but they should not
   survive the app being closed. Coming back to it tomorrow, the thing to see
   is this week again. */
let pastOpen = false;   // schedule: weeks before the current one
let payOpen = false;    // pay: weeks before the window §29 draws

function renderSchedule(){
  renderNext();
  renderHorizon();
  renderLaunchers();
  const box = $('#sched');
  box.innerHTML = '';

  // The current week's start, not "seven days ago": a fixed offset lands
  // mid-week and cuts the block he is looking at in half.
  const cutoff = weekStart(todayISO(), 0);
  const all = S.shifts.slice().sort((a,b) => (a.date+a.start).localeCompare(b.date+b.start));
  const list = pastOpen ? all : all.filter(s => s.date >= cutoff);
  const behind = all.filter(s => s.date < cutoff).length;
  if(!list.length && !behind){
    box.appendChild(el('p','empty','Nothing scheduled yet. Use the Add tab to bring shifts in.'));
    return;
  }
  // Above the list, because what it opens goes above the list. Drawn before
  // the weeks so the button does not move when it is pressed.
  if(behind){
    const b = el('button','more', pastOpen
      ? 'Hide earlier shifts'
      : `Show ${plural(behind, 'earlier shift')}`);
    b.onclick = () => { pastOpen = !pastOpen; renderSchedule(); };
    box.appendChild(b);
  }
  if(!list.length){
    box.appendChild(el('p','empty','Nothing scheduled from this week on. Use the Add tab to bring shifts in.'));
    return;
  }

  // Worked out over every shift on file, not week by week and not day by day:
  // a clash does not respect either boundary.
  // The rest note in the week list, on the shift he comes back to. Worked out
  // over every shift on file for the same reason the clashes are: the shift
  // before a Monday morning is a Sunday night, and the two are in different
  // week blocks.
  const rests = new Map();
  restGaps(S.shifts).filter(g => isShortRest(g.mins)).forEach(({ b, mins: m }) => {
    rests.set(b.id, m);
  });

  // One line between the two, not one under each (§30). Keyed on whichever of
  // the pair starts later, because the list is drawn in start order and that
  // is therefore the one the warning can be placed in front of — the same
  // trick the rest note uses, and it works across a day boundary for the same
  // reason. `clashPairs` hands back the pair in store order, which says
  // nothing about which came first, so the comparison is made here.
  //
  // A Map rather than a list: a shift can run over two others, and what he
  // needs told once is that this row is double-booked.
  const clashes = new Set();
  clashPairs(S.shifts).forEach(({ a, b }) => {
    clashes.add((a.date + a.start) <= (b.date + b.start) ? b.id : a.id);
  });

  const byWeek = new Map();
  list.forEach(s => {
    const ws = weekStart(s.date, 0);
    if(!byWeek.has(ws)) byWeek.set(ws, []);
    byWeek.get(ws).push(s);
  });

  for(const [ws, shifts] of byWeek){
    const wsD = asDate(ws), weD = asDate(shiftDays(ws,6));
    const total = shifts.reduce((a,s) => a + durMins(s), 0);
    const head = el('div','weekhead');
    head.innerHTML = `<h2>${MONTHNAMES[wsD.getMonth()].slice(0,3)} ${wsD.getDate()} – ${
      MONTHNAMES[weD.getMonth()].slice(0,3)} ${weD.getDate()}</h2>
      <span class="tiny soft mono">${fmtDur(total)}</span>`;
    box.appendChild(head);

    const byDay = new Map();
    shifts.forEach(s => { if(!byDay.has(s.date)) byDay.set(s.date, []); byDay.get(s.date).push(s); });

    for(const [date, ds] of byDay){
      const d = asDate(date);
      const row = el('div','day' + (date === todayISO() ? ' today' : ''));
      row.appendChild(el('div','daynum',
        `<b>${d.getDate()}</b><span>${DAYNAMES[d.getDay()].toUpperCase()}</span>`));
      const col = el('div');
      ds.forEach(s => {
        const co = coById(s.companyId);
        const item = el('div','shift');
        // §8.3's hollow tick, on the thing that is actually there: the colour
        // stripe goes outlined rather than filled for a shift nothing has
        // confirmed. Colour alone cannot carry that on a 3px rule, so the word
        // rides along on the line that already names the job and the site.
        const dot = isProposed(s)
          ? `background:transparent;box-shadow:inset 0 0 0 1px ${esc(co?.color || '#C6CAC1')}`
          : `background:${esc(co?.color || '#C6CAC1')}`;
        item.innerHTML = `
          <i class="tick" style="${dot}"></i>
          <div>
            <div class="when">${esc(fmtTime(s.start))} – ${esc(fmtTime(s.end))}</div>
            <div class="where">${esc(co ? co.name : 'Unassigned')} &middot; ${esc(shiftWhere(s))}${
              isProposed(s) ? ' &middot; <span class="rota">from the rota</span>' : ''}</div>
          </div>
          <div class="len">${fmtDur(durMins(s))}</div>`;
        item.onclick = () => editShift(s.id);

        // Both of these go *before* the shift rather than after the day (§29,
        // §30), because both are about the join between this shift and the one
        // before it, and that is where the reader is looking. It is also why
        // neither names the shifts any more: sitting between the two, the
        // sentence was saying what he could already see.
        //
        // The other side of the pair is often in the day row above — a
        // Trupoint night into a DSI afternoon is exactly the case — and there
        // this lands at the top of the day, still between the two.
        //
        // The overlap goes first where a shift somehow has both: it is the one
        // with no recovery.
        if(clashes.has(s.id)) col.appendChild(el('div','gapwarn',
          'Warning: overlap. Tap shift to adjust times or delete.'));
        const rst = rests.get(s.id);
        if(rst) col.appendChild(el('div','restline', `Only ${fmtDur(rst)} off`));

        col.appendChild(item);
      });
      row.appendChild(col);
      box.appendChild(row);
    }
  }
}

/* -- pay tab -- */
/* The window the tab opens on (§29). Five weeks: next week, this one, and the
   three before it.

   Three back is what a fortnightly deposit needs to be checked against with a
   week of slack; beyond that he is not checking a figure, he is looking one
   up, and that is what the button under the list is for.

   One week forward, and exactly one. A week's pay is worth knowing the week
   before it — that is when a thin week is still something he can do something
   about — and worth nothing before that, because what the tab would print for
   a fortnight out is the rota's opinion of a week rather than money, which is
   the forecast §20.4 refused to let stand.

   So the far side has no button. Weeks past next week are dropped rather than
   folded: a *Show later* was built and taken out again, because a fold implies
   there is a figure behind it worth opening, and there is not. Hours that far
   ahead are on the Schedule tab, where they are hours. */
const PAY_BACK_WEEKS = 3, PAY_FWD_WEEKS = 1;

/* Which side of the window a pay week falls on, worked out in days rather than
   by comparing week-start strings: two jobs can start their weeks on different
   days (§27's `co.weekStart`), and the combined table below holds keys from
   both. Days from the week's start to today, so a week ahead is negative — a
   week starting tomorrow is -1, and one starting a fortnight out is -14. */
function payWhen(ws){
  const days = Math.round((asDate(todayISO()) - asDate(ws)) / 86400000);
  if(days < -7 * PAY_FWD_WEEKS) return 'ahead';
  return days < 7 * (PAY_BACK_WEEKS + 1) ? 'now' : 'earlier';
}

/* One week's work, shown (§29).

   Offered on every week, not only a mixed-rate one. The rates used to print
   under the date and with three roles in a week that was four lines of small
   text beside three numbers that have to stay readable as numbers — the row
   stopped looking like a row. But the answer was not to show it only where it
   was crowded: what an hour is worth, and how much of the week is overtime,
   are the two things a gross gets checked against, and a single-rate week has
   both of them just as much as a mixed one does.

   Two tables rather than one, and the split is the point. The first prices the
   hours; the second pays the week. They are kept apart because once there is
   overtime in a week they foot to different figures — the hours are worth
   $810 and the week pays $855 — and a single column carrying both is a column
   that gets added up wrong. So the first table has no money in it at all.

   The second is the week the way a pay stub says it: regular hours at the
   regular rate, overtime hours at time and a half, and a gross underneath that
   the two of them actually add to. */
function payDetail(co, ws, shifts){
  const w = weekTotals(shifts, co);
  const d = asDate(ws);
  const mult = Number.isFinite(+co.otMult) && +co.otMult > 0 ? +co.otMult : OT_MULT;
  const hrs = n => n.toFixed(2);
  const assumed = weekTotals(shifts.filter(isProposed), co);

  /* -- what the hours were. No pay column, deliberately: see above. */
  const hourRows = w.byRate.map(r => `<tr>
      <td>${esc(r.name)}${r.rate == null
        ? '<span class="tiny soft"><br>no rate set</span>' : ''}</td>
      <td class="n">${hrs(r.hrs)}</td>
      <td class="n">${r.rate == null ? '–' : money(r.rate)}</td>
    </tr>`).join('');
  // The average only appears where it is doing work. On a week paid at one
  // rate it is that rate, said twice.
  const avgRow = w.mixed ? `<tr class="tot"><td>Average</td>
      <td class="n">${hrs(w.hrs)}</td><td class="n">${money(w.rate)}</td></tr>` : '';

  /* -- how the week pays out.

     Two shapes, and which one is right turns on whether every hour has a
     price. When it does, the stub's own split is exact: (H-ot) at the regular
     rate plus ot at the regular rate times the multiplier comes to the same
     figure `pay.js` computes as straight plus premium — §27 records that
     identity and the tests hold it.

     When some hours have no rate the split stops being available, because the
     regular rate is the average of the hours that *have* one and the overtime
     threshold counted the hours that do not. Pricing unrated hours at the
     average to make the rows line up would be inventing a rate, which is the
     one thing §27.10 says this never does. So that week is shown the way the
     arithmetic actually ran: the priced hours, the premium on top, and the
     unpriced hours named and left out of the money. */
  const straight = w.byRate.reduce((a, r) => a + r.pay, 0);
  let payRows;
  if(!w.rated){
    payRows = `<tr><td>No rate set anywhere</td><td class="n">${hrs(w.hrs)}</td>
      <td class="n">–</td><td class="n">–</td></tr>`;
  } else if(!w.unratedHrs){
    const base = w.hrs - w.ot;
    payRows = `<tr><td>Regular</td><td class="n">${hrs(base)}</td>
        <td class="n">${money(w.rate)}</td><td class="n">${money(base * w.rate)}</td></tr>`
      + (w.ot > 0.005 ? `<tr><td>Overtime</td><td class="n">${hrs(w.ot)}</td>
        <td class="n">${money(w.rate * mult)}</td>
        <td class="n">${money(w.ot * w.rate * mult)}</td></tr>` : '');
  } else {
    payRows = `<tr><td>Hours with a rate</td><td class="n">${hrs(w.hrs - w.unratedHrs)}</td>
        <td class="n">${money(w.rate)}</td><td class="n">${money(straight)}</td></tr>`
      + (w.ot > 0.005 ? `<tr><td>Overtime premium<span class="tiny soft"><br>on top of the hours above</span></td>
        <td class="n">${hrs(w.ot)}</td><td class="n">${money(w.rate * (mult - 1))}</td>
        <td class="n">${money(w.gross - straight)}</td></tr>` : '')
      + `<tr><td>Hours with no rate<span class="tiny soft"><br>not in the gross</span></td>
        <td class="n">${hrs(w.unratedHrs)}</td>
        <td class="n">–</td><td class="n">–</td></tr>`;
  }

  const notes = [];
  // A week with no overtime says so. Without it the pay table is the hours
  // table restated, and a missing row reads as a figure that failed to load
  // rather than as the answer to "how much of this was overtime".
  if(w.rated && w.ot <= 0.005)
    notes.push(+co.otAfterHrs > 0
      ? `No overtime — the week did not reach the ${+co.otAfterHrs} h this job counts from.`
      : 'No overtime, because this job has no threshold set. Setup takes one.');
  // Said on every mixed week, not only the ones with overtime in them. The
  // regular rate on the pay table is a weighted average carried at full
  // precision, so the row does not multiply out at the two decimals it is
  // printed to — 28.00 h at $14.14 reads as $395.92 and the pay says $396.00.
  // On a screen built for reconciling a figure against a deposit, eight cents
  // he cannot account for is worse than a sentence.
  if(w.mixed)
    notes.push(`The regular rate is the ${money(w.rate)} weighted average of the hours above, ` +
      'and the pay is worked out from the exact average — multiplying the rounded figure ' +
      'by the hours can land a cent or two out.' +
      (w.ot > 0.005
        ? ` Overtime is ${mult}× that average, not ${mult}× whichever rate the last shift ` +
          'of the week happened to be paid at. That is what an employer paying two rates in ' +
          'one week has to do, and it means the answer does not move when a shift moves.'
        : ''));
  if(assumed.hrs)
    notes.push(`${hrs(assumed.hrs)} h of this came from the rota and nothing has confirmed it. ` +
      'A screenshot of the week confirms it.');
  notes.push('Estimate, before deductions.');

  $('#dlgbody').innerHTML = `
    <h2><span class="dot" style="background:${esc(co.color)}"></span>Week of ${
      MONTHNAMES[d.getMonth()].slice(0,3)} ${d.getDate()}</h2>
    <p class="tiny soft" style="margin:.1rem 0 .2rem">${esc(co.name)}</p>

    <p class="subhead">The hours</p>
    <table>
      <tr><th>Worked as</th><th class="n">Hours</th><th class="n">An hour</th></tr>
      ${hourRows}${avgRow}
    </table>

    <p class="subhead">The pay</p>
    <table>
      <tr><th>Paid as</th><th class="n">Hours</th><th class="n">Rate</th><th class="n">Pay</th></tr>
      ${payRows}
      <tr class="tot"><td>Gross</td><td class="n">${hrs(w.hrs)}</td>
        <td class="n">–</td>
        <td class="n">${w.rated ? money(w.gross) : '–'}</td></tr>
    </table>

    <p class="tiny soft" style="margin-top:.7rem">${notes.join('<br><br>')}</p>
    <div class="rowbtns"><button class="ghost" id="pd-close">Close</button></div>`;
  const dlg = $('#dlg');
  dlg.showModal();
  $('#pd-close').onclick = () => dlg.close();
}

function renderPay(){
  const box = $('#payout');
  box.innerHTML = '';
  if(!S.companies.length){
    box.appendChild(el('p','empty','Add a job in Setup first.'));
    return;
  }

  const allWeeks = new Map();
  let behind = false;

  S.companies.forEach(co => {
    // Weeks still ahead are dropped rather than folded: see PAY_BACK_WEEKS.
    const weeks = weeksFor(co).filter(([ws]) => payWhen(ws) !== 'ahead');
    const older = weeks.filter(([ws]) => payWhen(ws) === 'earlier');
    if(older.length) behind = true;
    const shown = payOpen ? weeks : weeks.filter(([ws]) => payWhen(ws) === 'now');
    const card = el('div','card');
    card.appendChild(el('h2', null,
      `<span class="dot" style="background:${esc(co.color)}"></span>${esc(co.name)}`));
    if(!shown.length){
      card.appendChild(el('p','tiny soft',
        weeks.length ? 'Nothing in the last four weeks.' : 'No shifts yet.'));
      box.appendChild(card);
      return;
    }
    const t = el('table');
    t.innerHTML = `<tr><th>Week of</th><th class="n">Hours</th><th class="n">OT</th><th class="n">Gross</th></tr>`;
    shown.forEach(([ws, shifts]) => {
      const w = weekTotals(shifts, co);
      const d = asDate(ws);
      // A week holding shifts nothing has confirmed says so, with the assumed
      // hours named separately (§20.4). The figure is not suppressed — a
      // forecast is useful — but a gross to the cent, checked against a
      // deposit weeks later when the screenshot is long gone, must not quietly
      // rest on a rota.
      const assumed = weekTotals(shifts.filter(isProposed), co);
      // The two warnings stay in the column, because they are about whether
      // the figure beside them can be trusted and that has to be read without
      // opening anything. What moved out is the per-role arithmetic (§29).
      const notes = [];
      if(assumed.hrs) notes.push(`${assumed.hrs.toFixed(2)} h from the rota, unconfirmed`);
      if(w.unratedHrs)
        notes.push(`${w.unratedHrs.toFixed(2)} h at no rate set, and not in the gross`);
      const tr = el('tr', assumed.hrs ? 'assumed' : null);
      tr.innerHTML = `<td>${MONTHNAMES[d.getMonth()].slice(0,3)} ${d.getDate()}${
          notes.length ? `<span class="tiny soft"><br>${notes.join('<br>')}</span>` : ''}</td>
        <td class="n">${w.hrs.toFixed(2)}</td>
        <td class="n">${w.ot ? w.ot.toFixed(2) : '–'}</td>
        <td class="n">${w.rated ? '$' + w.gross.toFixed(2) : '–'}</td>`;
      // On every week. A single-rate week has an hourly and a straight/overtime
      // split exactly as a mixed one does, and those are the two figures a
      // gross is checked against — offering the breakdown only where the row
      // was crowded would have been fixing the crowding, not the question.
      const b = el('button','brk','Breakdown');
      b.onclick = () => payDetail(co, ws, shifts);
      const cell = tr.querySelector('td');
      cell.appendChild(document.createElement('br'));
      cell.appendChild(b);
      t.appendChild(tr);

      const cur = allWeeks.get(ws) || { hrs:0, gross:0 };
      cur.hrs += w.hrs; cur.gross += w.gross;
      allWeeks.set(ws, cur);
    });
    card.appendChild(t);
    box.appendChild(card);
  });

  if(S.companies.length > 1 && allWeeks.size){
    const card = el('div','card');
    card.appendChild(el('h2', null, 'Both jobs together'));
    const t = el('table');
    t.innerHTML = `<tr><th>Week of</th><th class="n">Hours</th><th class="n">Gross</th></tr>`;
    [...allWeeks.entries()].sort((a,b) => b[0].localeCompare(a[0])).forEach(([ws,v]) => {
      const d = asDate(ws);
      const tr = el('tr');
      tr.innerHTML = `<td>${MONTHNAMES[d.getMonth()].slice(0,3)} ${d.getDate()}</td>
        <td class="n">${v.hrs.toFixed(2)}</td>
        <td class="n">${v.gross ? '$' + v.gross.toFixed(2) : '–'}</td>`;
      t.appendChild(tr);
    });
    card.appendChild(t);
    box.appendChild(card);
  }

  // Under everything, because what it opens goes under everything.
  if(behind){
    const b = el('button','more', payOpen ? 'Hide earlier weeks' : 'Show earlier weeks');
    b.onclick = () => { payOpen = !payOpen; renderPay(); };
    box.appendChild(b);
  }
}

/* -- declared shifts, in the job card (§8.2) --
   Seven toggles and two clocks. The whole point of §8.2 is that the rota is
   something he states once rather than something the app infers from its own
   output, so stating it has to be quicker than the misreads it prevents.

   Ticking days is also the only switch between the two kinds of pattern: with
   days it describes when the job runs and can fill a week (§8.3); without, it
   is only ever compared against. */
function patternDays(p){
  return (p.days || []).slice().sort((a,b) => a-b).map(d => DAYNAMES[d]).join(' ');
}
function renderPatterns(co, host, sugHost){
  host.innerHTML = '';
  if(!co.patterns) co.patterns = [];
  if(!co.patterns.length)
    host.appendChild(el('p','tiny soft','None declared. Times are then only checked for a plausible length.'));

  co.patterns.forEach((pat, i) => {
    const row = el('div','pat');
    row.innerHTML = `
      <div class="days">${DAYNAMES.map((d, dow) =>
        `<button type="button" class="day-t" data-dow="${dow}" aria-label="${d}"
                 aria-pressed="${(pat.days||[]).includes(dow) ? 'true' : 'false'}">${d[0]}</button>`
      ).join('')}</div>
      <div class="patt">
        ${clockInput(pat.start, 'aria-label="Starts"')}
        <span class="soft mono">to</span>
        ${clockInput(pat.end, 'aria-label="Ends"')}
        <select class="patrole" aria-label="Role">${roleOptions(
          { companyId: co.id, roleId: pat.roleId || null })}</select>
        <select class="patsite" aria-label="Site">${siteOptions(
          { companyId: co.id, siteId: pat.siteId || null })}</select>
        <button class="kill" type="button" aria-label="Remove this shift">&times;</button>
      </div>
      <p class="patwhat"></p>`;

    const what = row.querySelector('.patwhat');
    const say = () => {
      // What the declared role and site are actually for: they are what a
      // generated week is filed under. Said here rather than left to be
      // discovered, because the field that silently prices a shift is exactly
      // the field that has to say it is doing that (§27).
      const role = roleById(pat.roleId), site = siteById(pat.siteId);
      const rate = rateFor({}, role, co);
      const named = [role && role.name, site && site.name].filter(Boolean).join(' \u00b7 ');
      const money = role && role.rate != null ? `, at $${(+role.rate).toFixed(2)} an hour`
                  : rate != null ? `, at the job\u2019s $${rate.toFixed(2)}` : '';
      what.textContent =
        (!pat.start || !pat.end) ? 'Set both times \u2014 an unfinished shift is ignored.'
        : (pat.days && pat.days.length)
          ? `Runs ${patternDays(pat)}, ${pat.start}\u2013${pat.end}`
            + (named ? ` as ${named}${money}` : '')
            + '. A week filled from this is filed under exactly that.'
          : `${pat.start}\u2013${pat.end}, any day. Checked against, never used to fill a week`
            + (named ? `, so ${named} is only a note here.` : '.');
    };
    say();

    row.querySelectorAll('.day-t').forEach(b => {
      b.onclick = () => {
        const dow = +b.dataset.dow, on = b.getAttribute('aria-pressed') === 'true';
        const days = new Set(pat.days || []);
        if(on) days.delete(dow); else days.add(dow);
        b.setAttribute('aria-pressed', String(!on));
        pat.days = [...days].sort((a,b) => a-b);
        if(!pat.days.length) delete pat.days;
        say(); save();
      };
    });
    const [st, en] = row.querySelectorAll('input');
    bindClock(st, v => { pat.start = v; say(); save(); }, { allowEmpty: true });
    bindClock(en, v => { pat.end = v; say(); save(); }, { allowEmpty: true });

    // The standard role and place for this declared shift (§27). Both are
    // optional and both go through the same pickers the review screen uses, so
    // "+ Add …" here creates a real record with a rate rather than a string
    // that looks like one. Adding one has to redraw the whole section: a role
    // made on one declared shift belongs to the job, and every other row's
    // list is now out of date.
    const rolesel = row.querySelector('.patrole');
    rolesel.onchange = () => {
      const hold = { companyId: co.id, roleId: pat.roleId || null, roleRaw: '' };
      pickRole(hold, rolesel.value);
      if(hold.roleId) pat.roleId = hold.roleId; else delete pat.roleId;
      // Redrawn whole rather than in place: cancelling the prompt has to put
      // the select back, and a role made here belongs to the job, so every
      // other declared shift's list is out of date the moment it exists.
      save(); renderPatterns(co, host, sugHost);
    };
    const sitesel = row.querySelector('.patsite');
    sitesel.onchange = () => {
      const hold = { companyId: co.id, siteId: pat.siteId || null, siteRaw: '' };
      pickSite(hold, sitesel.value);
      if(hold.siteId) pat.siteId = hold.siteId; else delete pat.siteId;
      save(); renderPatterns(co, host, sugHost);
    };
    row.querySelector('.kill').onclick = () => {
      co.patterns.splice(i, 1);
      save(); renderPatterns(co, host, sugHost);
    };
    host.appendChild(row);
  });

  const btns = el('div','rowbtns');
  const add = el('button','ghost','Add a shift');
  add.onclick = () => {
    // Deliberately blank. A made-up default left in by accident would flag
    // every real shift as off-pattern, and a pattern with no times is dropped
    // by validPatterns() rather than half-believed.
    co.patterns.push({ start:'', end:'' });
    save(); renderPatterns(co, host, sugHost);
  };
  const build = el('button','ghost','Build from what\u2019s on file');
  build.onclick = () => renderSuggestions(co, host, sugHost);
  btns.appendChild(add); btns.appendChild(build);
  host.appendChild(btns);
  sugHost.innerHTML = '';
}

/* §8.2's shortcut past the typing. This is not the rejected idea of learning
   normal times from history — nothing here is applied to anything. It is a
   list of candidates drawn from the reader's own unvalidated output, and the
   human picking from it is exactly what stops that output becoming authority. */
function renderSuggestions(co, patHost, host){
  host.innerHTML = '';
  const filed = S.shifts.filter(s => s.companyId === co.id);
  const already = (co.patterns || []);
  const sug = suggestPatterns(filed)
    .filter(x => !already.some(p => p.start === x.start && p.end === x.end));

  host.appendChild(el('p','tiny soft', !filed.length
    ? 'Nothing on file for this job yet.'
    : !sug.length
      ? 'Every start and end pair on file is already declared.'
      : 'Pairs already on file, most common first. These came off screenshots, ' +
        'so add only the ones you know are real \u2014 that check is the point of them.'));

  sug.forEach(x => {
    const r = el('div','sug');
    r.innerHTML = `<span class="mono">${esc(x.start)}\u2013${esc(x.end)}</span>
      <span class="tiny soft">${x.count} shift${x.count===1?'':'s'}${
        x.days.length ? ' &middot; ' + esc(x.days.map(d => DAYNAMES[d]).join(' ')) : ''}</span>`;
    const use = el('button','ghost','Add this');
    use.onclick = () => {
      // The days it was actually filed on are a starting tick, not a claim.
      // He unticks the ones that were one-offs.
      co.patterns.push({ days: x.days.slice(), start: x.start, end: x.end });
      save();
      // Re-render both: the list is a menu he may take more than one thing
      // from, and what he has just taken drops off it.
      renderPatterns(co, patHost, host);
      renderSuggestions(co, patHost, host);
    };
    r.appendChild(use);
    host.appendChild(r);
  });
}

/* -- the site table, in the job card (§8.1) --
   One card per place. The name is what the calendar and every screen say; the
   address is the `LOCATION:` line and the reason this section exists; the
   spellings are what stop the same misreading needing the same decision every
   month.

   Merge is here rather than anywhere cleverer because merging is permanent and
   routine, not a migration step — OCR keeps inventing spellings, and the
   answer to "these two are the same place" has to be one control he can find. */
function renderSites(co, host, sugHost){
  host.innerHTML = '';
  const mine = sitesFor(co.id);
  if(!mine.length)
    host.appendChild(el('p','tiny soft','None yet. Add one here, or pick “Add …” on a row in the review list when a screenshot names it.'));

  mine.forEach(site => {
    const used = S.shifts.filter(x => x.siteId === site.id).length;
    const card = el('div','rec' + (site.archived ? ' archived' : ''));
    card.innerHTML = `
      <div class="grid2">
        <label class="f"><span>Name</span><input data-s="name" type="text" value="${esc(site.name)}"></label>
        <label class="f"><span>Address</span><input data-s="address" type="text"
          placeholder="401 Main St, Hattiesburg MS" value="${esc(site.address || '')}"></label>
      </div>
      <div class="aliases"></div>
      <div class="rowbtns sitebtns"></div>
      <p class="tiny soft sitecount"></p>`;

    card.querySelectorAll('[data-s]').forEach(inp => {
      const was = inp.value;
      inp.oninput = () => {
        site[inp.dataset.s] = inp.value;
        save();
        // The name is on the schedule, the banner and every event title.
        if(inp.dataset.s === 'name'){ renderSchedule(); renderNext(); }
      };
      // On leaving the field, not on every keystroke: a revision number that
      // counted letters typed would be nonsense, and the question is only
      // whether the text ended up different from what the calendar was told.
      inp.onchange = () => {
        if(inp.value === was) return;
        restamp(x => x.siteId === site.id);
        save(); renderSetup();
      };
    });

    // The spellings, each removable. This is the release valve on learning an
    // alias by committing a row: a wrong one is one tap to undo, and until it
    // is undone it is at least visible.
    const al = card.querySelector('.aliases');
    const spell = site.aliases || [];
    al.appendChild(el('span','tiny soft', spell.length
      ? 'Also read as:&nbsp;' : 'No other spellings recorded yet.'));
    spell.forEach(a => {
      const chip = el('span','alias', esc(a) + ' ');
      const x = el('button','kill','&times;');
      x.type = 'button';
      x.setAttribute('aria-label', `Forget the spelling ${a}`);
      x.onclick = () => { dropAlias(site, a); save(); renderSites(co, host, sugHost); };
      chip.appendChild(x);
      al.appendChild(chip);
    });

    const btns = card.querySelector('.sitebtns');

    // Archiving, not deleting, is the ordinary end of a site: he stops being
    // sent there, the shifts that happened still name it, and a fresh read
    // that looks like it is more likely a new place than a return.
    const arch = el('button','ghost', site.archived ? 'Bring back' : 'Archive');
    arch.type = 'button';
    arch.onclick = () => { site.archived = !site.archived; save(); renderSites(co, host, sugHost); };
    btns.appendChild(arch);

    const others = mine.filter(x => x.id !== site.id);
    if(others.length){
      const sel = el('select','mergesel');
      sel.innerHTML = `<option value="">Merge into\u2026</option>` + others.map(x =>
        `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
      sel.onchange = () => {
        const into = siteById(sel.value);
        sel.value = '';
        if(!into) return;
        if(!confirm(`Merge ${site.name} into ${into.name}? `
          + `${used} shift${used === 1 ? '' : 's'} move across, and everything ${site.name} `
          + `is read as becomes a spelling of ${into.name}. This cannot be undone.`)) return;
        const res = mergeSites(S.sites, site.id, into.id);
        S.sites = res.sites;
        // Restamped before they are moved, so the predicate still names them.
        restamp(x => x.siteId === site.id);
        S.shifts.forEach(x => { if(x.siteId === site.id) x.siteId = into.id; });
        pending.forEach(x => { if(x.siteId === site.id) x.siteId = into.id; });
        save(); renderAll(); renderReview();
      };
      btns.appendChild(sel);
    }

    const kill = el('button','ghost danger','Remove');
    kill.type = 'button';
    kill.onclick = () => {
      if(!confirm(used
        ? `Remove ${site.name}? ${used} shift${used === 1 ? '' : 's'} fall back to the text `
          + 'that was read off the screen, and the address goes with it.'
        : `Remove ${site.name}?`)) return;
      S.sites = S.sites.filter(x => x.id !== site.id);
      restamp(x => x.siteId === site.id);
      S.shifts.forEach(x => { if(x.siteId === site.id) x.siteId = null; });
      pending.forEach(x => { if(x.siteId === site.id){ x.siteId = null; x.siteHow = 'none'; } });
      save(); renderAll(); renderReview();
    };
    btns.appendChild(kill);

    card.querySelector('.sitecount').textContent =
      (used ? `${used} shift${used === 1 ? '' : 's'} here.` : 'No shifts here yet.')
      + (site.archived ? ' Archived \u2014 new reads will not match it.' : '');
    host.appendChild(card);
  });

  const btns = el('div','rowbtns');
  const add = el('button','ghost','Add a site');
  add.onclick = () => {
    S.sites.push(newSite(uid(), co.id, 'New site', ''));
    save(); renderSites(co, host, sugHost);
  };
  const build = el('button','ghost','Build from what\u2019s on file');
  build.onclick = () => renderSiteSuggestions(co, host, sugHost);
  btns.appendChild(add); btns.appendChild(build);
  host.appendChild(btns);
  sugHost.innerHTML = '';
}

/* The same shortcut §8.2 gives the rota, for names instead of times, and the
   answer to "what about the labels already on file". It is deliberately not a
   migration: turning every string OCR has ever produced into a site record is
   exactly the move `snapSite()` made, one bad read becoming authority for
   every read after it. This is a menu, the counts say which ones are worth
   believing, and the human ticking a row is the whole control. */
function renderSiteSuggestions(co, siteHost, host){
  host.innerHTML = '';
  const filed = S.shifts.filter(s => s.companyId === co.id);
  const sug = suggestNames(filed, sitesFor(co.id),
                           x => labelCandidates(x.label).site, x => x.siteId);

  host.appendChild(el('p','tiny soft', !filed.length
    ? 'Nothing on file for this job yet.'
    : !sug.length
      ? 'Every label on file already matches a site.'
      : 'Labels already on file, most common first. These came off screenshots, '
        + 'so correct the spelling as you add one \u2014 the name here is what the '
        + 'calendar will say from now on.'));

  sug.forEach(x => {
    const r = el('div','sug');
    r.innerHTML = `<span class="tiny">${esc(x.name)}</span>
      <span class="tiny soft">${x.count} shift${x.count === 1 ? '' : 's'}</span>`;
    const use = el('button','ghost','Add this');
    use.onclick = () => {
      const name = prompt('Name this site the way it should read everywhere', x.name);
      if(!name || !name.trim()) return;
      const site = newSite(uid(), co.id, name.trim(), '');
      // The label it came from is a spelling it answers to, whether or not the
      // name was corrected — that is the point of adding it from this list.
      addAlias(site, x.name);
      S.sites.push(site);
      // Repoint what it was built from. Every shift whose label now matches
      // this site, not only the ones spelled exactly like the row: the near
      // misses are the ones that made a site table worth having.
      S.shifts.filter(s => s.companyId === co.id && !s.siteId).forEach(s => {
        const c = labelCandidates(s.label);
        if(matchName(c.site, [site]).rec) s.siteId = site.id;
      });
      save();
      // Not renderAll(): that rebuilds this card and leaves these two panes
      // detached, so the list he is working down would stop responding. The
      // schedule does have to catch up — those shifts read differently now.
      renderSchedule(); renderNext();
      renderSites(co, siteHost, host);
      renderSiteSuggestions(co, siteHost, host);
    };
    r.appendChild(use);
    host.appendChild(r);
  });
}

/* -- the role table, in the job card (§27) --
   One card per job title. The name is what the calendar and every screen say;
   the rate is why this section exists; the spellings are what stop the same
   misreading needing the same decision every month.

   Deliberately the same card as a site, down to the merge control, because it
   is the same problem — OCR inventing spellings of a name — and a second
   answer to it, worded differently, would be one more thing to learn. What is
   not the same is the consequence of getting it wrong: merging two sites
   misfiles a place, merging two roles changes what an hour is worth, so the
   confirmations here say the money out loud. */
function renderRoles(co, host, sugHost){
  host.innerHTML = '';
  const mine = rolesFor(co.id);
  if(!mine.length)
    host.appendChild(el('p','tiny soft','None yet. Every shift is paid the job\u2019s own rate. '
      + 'Add one here, or pick \u201cAdd \u2026\u201d on a row in the review list when a screenshot names it.'));

  mine.forEach(role => {
    const used = S.shifts.filter(x => x.roleId === role.id).length;
    const card = el('div','rec' + (role.archived ? ' archived' : ''));
    card.innerHTML = `
      <div class="grid2">
        <label class="f"><span>Name</span><input data-r="name" type="text" value="${esc(role.name)}"></label>
        <label class="f"><span>Hourly rate</span><input data-r="rate" type="number" step="0.01"
          placeholder="${co.rate ?? 'the job\u2019s rate'}" value="${role.rate ?? ''}"></label>
      </div>
      <div class="aliases"></div>
      <div class="rowbtns rolebtns"></div>
      <p class="tiny soft rolecount"></p>`;

    card.querySelectorAll('[data-r]').forEach(inp => {
      const was = inp.value;
      inp.oninput = () => {
        const k = inp.dataset.r;
        // Empty is a real answer and is not zero: it means nothing has been
        // said about this role and the job's own rate stands.
        role[k] = k === 'rate' ? (inp.value === '' ? null : +inp.value) : inp.value;
        save();
        // The name is on the schedule, the banner and every event title; the
        // rate is on the pay tab and nowhere else.
        if(k === 'name'){ renderSchedule(); renderNext(); }
        renderPay();
      };
      inp.onchange = () => {
        if(inp.value === was) return;
        // Only the name reaches the calendar. A rate change rewrites no event,
        // so restamping every shift over it would send a week of identical
        // events for nothing.
        if(inp.dataset.r === 'name'){ restamp(x => x.roleId === role.id); save(); }
        renderSetup();
      };
    });

    const al = card.querySelector('.aliases');
    const spell = role.aliases || [];
    al.appendChild(el('span','tiny soft', spell.length
      ? 'Also read as:&nbsp;' : 'No other spellings recorded yet.'));
    spell.forEach(a => {
      const chip = el('span','alias', esc(a) + ' ');
      const x = el('button','kill','&times;');
      x.type = 'button';
      x.setAttribute('aria-label', `Forget the spelling ${a}`);
      x.onclick = () => { dropAlias(role, a); save(); renderRoles(co, host, sugHost); };
      chip.appendChild(x);
      al.appendChild(chip);
    });

    const btns = card.querySelector('.rolebtns');
    const arch = el('button','ghost', role.archived ? 'Bring back' : 'Archive');
    arch.type = 'button';
    arch.onclick = () => { role.archived = !role.archived; save(); renderRoles(co, host, sugHost); };
    btns.appendChild(arch);

    const others = mine.filter(x => x.id !== role.id);
    if(others.length){
      const sel = el('select','mergesel');
      sel.innerHTML = `<option value="">Merge into\u2026</option>` + others.map(x =>
        `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
      sel.onchange = () => {
        const into = roleById(sel.value);
        sel.value = '';
        if(!into) return;
        // The rate is named in the question. Merging is permanent, and the one
        // thing he cannot see from the two names alone is that these shifts
        // are about to be paid at a different number.
        const rate = rateFor({}, into, co);
        if(!confirm(`Merge ${role.name} into ${into.name}? `
          + `${used} shift${used === 1 ? '' : 's'} move across and are paid `
          + `${rate == null ? 'at whatever ' + co.name + ' pays' : '$' + rate.toFixed(2) + ' an hour'} `
          + `from now on, and everything ${role.name} is read as becomes a spelling of `
          + `${into.name}. This cannot be undone.`)) return;
        const res = mergeRoles(S.roles, role.id, into.id);
        S.roles = res.roles;
        restamp(x => x.roleId === role.id);
        S.shifts.forEach(x => { if(x.roleId === role.id){ x.roleId = into.id; x.role = into.name; } });
        pending.forEach(x => { if(x.roleId === role.id){ x.roleId = into.id; x.role = into.name; } });
        (co.patterns || []).forEach(pt => { if(pt.roleId === role.id) pt.roleId = into.id; });
        save(); renderAll(); renderReview();
      };
      btns.appendChild(sel);
    }

    const kill = el('button','ghost danger','Remove');
    kill.type = 'button';
    kill.onclick = () => {
      if(!confirm(used
        ? `Remove ${role.name}? ${used} shift${used === 1 ? '' : 's'} keep the name as text `
          + `and go back to ${co.name}\u2019s own rate.`
        : `Remove ${role.name}?`)) return;
      S.roles = S.roles.filter(x => x.id !== role.id);
      restamp(x => x.roleId === role.id);
      // The name survives as text, which is the whole point of keeping `role`
      // beside `roleId` — a shift does not become nameless because the record
      // pricing it was deleted.
      S.shifts.forEach(x => { if(x.roleId === role.id){ x.roleId = null; x.role = x.role || role.name; } });
      pending.forEach(x => { if(x.roleId === role.id){ x.roleId = null; x.roleHow = 'none'; } });
      (co.patterns || []).forEach(pt => { if(pt.roleId === role.id) delete pt.roleId; });
      save(); renderAll(); renderReview();
    };
    btns.appendChild(kill);

    const rate = rateFor({}, role, co);
    card.querySelector('.rolecount').textContent =
      (used ? `${used} shift${used === 1 ? '' : 's'}` : 'No shifts yet')
      + (role.rate != null ? `, at $${(+role.rate).toFixed(2)} an hour.`
         : rate != null ? `, at ${co.name}\u2019s $${rate.toFixed(2)}.`
         : ', and no rate set anywhere.')
      + (role.archived ? ' Archived \u2014 new reads will not match it.' : '');
    host.appendChild(card);
  });

  const btns = el('div','rowbtns');
  const add = el('button','ghost','Add a role');
  add.onclick = () => {
    S.roles.push(newRole(uid(), co.id, 'New role', null));
    save(); renderRoles(co, host, sugHost);
  };
  const build = el('button','ghost','Build from what\u2019s on file');
  build.onclick = () => renderRoleSuggestions(co, host, sugHost);
  btns.appendChild(add); btns.appendChild(build);
  host.appendChild(btns);
  sugHost.innerHTML = '';
}

/* The same menu the sites get, drawn from the same labels. A label with the
   employer's separator in it offers its left half here and its right half
   there; one without offers the whole string to both, because "Cook" with no
   pipe could be either and the app has no way to know. He picks. */
function renderRoleSuggestions(co, roleHost, host){
  host.innerHTML = '';
  const filed = S.shifts.filter(s => s.companyId === co.id);
  const sug = suggestNames(filed, rolesFor(co.id),
                           x => labelCandidates(x.label).role, x => x.roleId);

  host.appendChild(el('p','tiny soft', !filed.length
    ? 'Nothing on file for this job yet.'
    : !sug.length
      ? 'Every label on file already matches a role.'
      : 'Labels already on file, most common first. These came off screenshots, '
        + 'so correct the spelling as you add one \u2014 and the rate you give it is '
        + 'what every shift that matches will be paid from now on.'));

  sug.forEach(x => {
    const r = el('div','sug');
    r.innerHTML = `<span class="tiny">${esc(x.name)}</span>
      <span class="tiny soft">${x.count} shift${x.count === 1 ? '' : 's'}</span>`;
    const use = el('button','ghost','Add this');
    use.onclick = () => {
      const name = prompt('Name this role the way it should read everywhere', x.name);
      if(!name || !name.trim()) return;
      const ask = prompt(`What does an hour of ${name.trim()} pay?`
        + (co.rate ? ` Leave it empty to use ${co.name}\u2019s $${(+co.rate).toFixed(2)}.`
                   : ' Leave it empty if it is the same as the rest of the job.'), '');
      if(ask === null) return;
      const rate = ask.trim() === '' ? null : +ask.trim();
      const role = newRole(uid(), co.id, name.trim(),
                           Number.isFinite(rate) && rate >= 0 ? rate : null);
      addAlias(role, x.name);
      S.roles.push(role);
      // Repoint what it was built from, near misses included — those are the
      // ones that made a table worth having. This one moves money, so it is
      // worth being plain about what it just did.
      let moved = 0;
      S.shifts.filter(s => s.companyId === co.id && !s.roleId).forEach(s => {
        if(matchName(labelCandidates(s.label).role, [role]).rec){
          s.roleId = role.id; s.role = role.name; moved++;
        }
      });
      save();
      renderSchedule(); renderNext(); renderPay();
      renderRoles(co, roleHost, host);
      renderRoleSuggestions(co, roleHost, host);
      if(moved) host.prepend(el('p','tiny soft',
        `${moved} shift${moved === 1 ? '' : 's'} now read as ${esc(role.name)}`
        + (role.rate == null ? '.' : ` and are paid $${(+role.rate).toFixed(2)} an hour.`)));
    };
    r.appendChild(use);
    host.appendChild(r);
  });
}

/* -- setup tab -- */
function renderSetup(){
  const box = $('#colist');
  box.innerHTML = '';
  if(!S.companies.length)
    box.appendChild(el('p','empty','No jobs yet. Add one to get started.'));

  S.companies.forEach(co => {
    const card = el('div','card');
    // The job is a fold, and everything in it but its name and colour is a
    // fold inside that (§28). Name and colour stay put: they are how he tells
    // one job from the other, and burying the field that says which job this
    // is inside a section called something else would be perverse.
    const job = fold(co.id,
      `<span class="dot" style="background:${esc(co.color)}"></span>${esc(co.name)}`,
      jobNote(co), false);
    job.d.classList.add('job');
    card.appendChild(job.d);
    const inner = job.body;

    const head = el('div', null, `
      <div class="grid2">
        <label class="f"><span>Name</span><input data-k="name" type="text" value="${esc(co.name)}"></label>
        <label class="f"><span>Colour</span><input data-k="color" type="color" value="${esc(co.color)}" style="height:2.4rem;padding:.15rem"></label>
      </div>`);
    inner.appendChild(head);

    const pay = fold(co.id + '/pay', 'Pay and hours', payNote(co), false);
    pay.body.innerHTML = `
      <div class="grid2">
        <label class="f"><span>Hourly rate</span><input data-k="rate" type="number" step="0.01" value="${co.rate ?? ''}"></label>
        <label class="f"><span>Pay week starts</span>
          <select data-k="weekStart">${DAYNAMES.map((d,i) =>
            `<option value="${i}"${(co.weekStart??0)===i?' selected':''}>${d}</option>`).join('')}</select></label>
      </div>
      <div class="grid2">
        <label class="f"><span>Overtime after (hrs/wk)</span><input data-k="otAfterHrs" type="number" step="0.5" value="${co.otAfterHrs ?? ''}"></label>
        <label class="f"><span>Unpaid break (mins)</span><input data-k="breakMins" type="number" value="${co.breakMins ?? ''}"></label>
      </div>
      <label class="f"><span>\u2026on shifts over (hrs)</span><input data-k="breakAfterHrs" type="number" step="0.5" value="${co.breakAfterHrs ?? ''}"></label>
      <p class="tiny soft" style="margin:-.35rem 0 0">A role can be paid its own rate,
        below. This one is what a shift is worth when nothing more specific says otherwise.</p>`;
    inner.appendChild(pay.d);

    const app = fold(co.id + '/app', 'App and calendar', appNote(co), false);
    app.body.innerHTML = `
      <label class="f"><span>Android app package, for the open button</span>
        <input data-k="pkg" type="text" placeholder="com.tracktik.shift" value="${esc(co.pkg||'')}"></label>
      <label class="f"><span>Calendar import: only events mentioning\u2026</span>
        <input data-k="icsMatch" type="text" placeholder="Station" value="${esc(co.icsMatch||'')}"></label>
      <p class="tiny soft" style="margin:-.35rem 0 0">An employer's calendar sync writes into a
        whole Google account, so his own appointments arrive with the shifts. A word that appears
        on every shift and nothing else \u2014 a site name, the role \u2014 keeps them out. Leave it
        empty to take everything.</p>

      <label class="f"><span>Statutory holidays</span>
        <select data-k="holidays">
          <option value=""${!co.holidays ? ' selected' : ''}>Don\u2019t check</option>
          ${holidayPlaces().map(h =>
            `<option value="${h.id}"${co.holidays===h.id?' selected':''}>${esc(h.name)}</option>`).join('')}
        </select></label>
      <p class="tiny soft" style="margin:-.35rem 0 0">Only used when a week is filled from
        the rota: a generated shift landing on a holiday is flagged so it can be removed
        before it is added. It never removes one by itself \u2014 the rota may well run that
        day, and a shift quietly dropped is a shift missed.</p>`;
    inner.appendChild(app.d);

    const rota = fold(co.id + '/rota', 'Shifts this job normally runs', rotaNote(co), false);
    rota.body.innerHTML = `
      <p class="tiny soft" style="margin:0 0 .4rem">Times read off a screenshot are checked
        against these. One exactly twelve hours out is an am/pm misread and is corrected;
        one a few minutes out is tidied up; one an hour or two out is left alone and
        flagged, because the employer may have moved it.</p>
      <div class="patbox"></div>
      <div class="sugbox"></div>`;
    inner.appendChild(rota.d);

    const roleFold = fold(co.id + '/roles', 'Roles',
      tableNote(rolesFor(co.id), 'none \u2014 every shift at the job\u2019s rate',
                live => { const paid = live.filter(r => r.rate != null);
                          return paid.length ? ' \u00b7 ' + paid.map(r => money(r.rate)).join(', ') : ''; }),
      false);
    roleFold.body.innerHTML = `
      <p class="tiny soft" style="margin:0 0 .4rem">The job titles this employer pays him
        under, the spellings each one answers to, and what an hour of each is worth. A role
        with no rate of its own is paid the job\u2019s rate above \u2014 declare one only where it
        differs, or where the name is worth curating.</p>
      <div class="rolebox"></div>
      <div class="rolesugbox"></div>`;
    inner.appendChild(roleFold.d);

    const siteFold = fold(co.id + '/sites', 'Sites',
      tableNote(sitesFor(co.id), 'none yet'), false);
    siteFold.body.innerHTML = `
      <p class="tiny soft" style="margin:0 0 .4rem">The places this job sends him, and
        the spellings each one answers to. A screenshot naming a site the app already
        knows is filed against it however badly it was read, and its address is what the
        calendar turns into a tappable line.</p>
      <div class="sitebox"></div>
      <div class="sitesugbox"></div>`;
    inner.appendChild(siteFold.d);

    card.querySelectorAll('[data-k]').forEach(inp => {
      inp.oninput = () => {
        const k = inp.dataset.k;
        let v = inp.value;
        if(['rate','otAfterHrs','breakMins','breakAfterHrs','weekStart'].includes(k))
          v = v === '' ? null : +v;
        co[k] = v;
        save();
        if(k === 'name' || k === 'color'){ renderLaunchers(); }
        // Every figure on the pay tab hangs off these, and a rate typed with
        // the tab already drawn used to sit there stale until something else
        // redrew it.
        if(['rate','otAfterHrs','breakMins','breakAfterHrs','weekStart'].includes(k)) renderPay();
        // The shut folds above this one describe the field being typed in, so
        // they are rewritten as it is typed rather than on the next full
        // redraw — a summary that lags the box under it is worse than none.
        job.d.querySelector('.foldnote').innerHTML = jobNote(co);
        job.d.querySelector('.foldname').innerHTML =
          `<span class="dot" style="background:${esc(co.color)}"></span>${esc(co.name)}`;
        pay.d.querySelector('.foldnote').innerHTML = payNote(co);
        app.d.querySelector('.foldnote').innerHTML = appNote(co);
      };
    });
    // Roles before sites, and patterns before both: the declared shifts are
    // where a role and a site get put to work, so the section that uses them
    // reads first and the tables it draws from follow.
    renderPatterns(co, card.querySelector('.patbox'), card.querySelector('.sugbox'));
    renderRoles(co, card.querySelector('.rolebox'), card.querySelector('.rolesugbox'));
    renderSites(co, card.querySelector('.sitebox'), card.querySelector('.sitesugbox'));

    const btns = el('div','rowbtns');
    const del = el('button','ghost danger','Remove this job');
    del.onclick = () => {
      const n = S.shifts.filter(s => s.companyId === co.id).length;
      if(!confirm(`Remove ${co.name}? ${n} shift${n===1?'':'s'} will be deleted too.`)) return;
      dropShifts(s => s.companyId === co.id);
      S.companies = S.companies.filter(c => c.id !== co.id);
      // The job's sites and roles go with it. They are its places and its job
      // titles, they can never be matched against again, and leaving them
      // would put another job's lists in front of him the next time he opened
      // this screen — and another job's rates in the pay tab.
      S.sites = (S.sites || []).filter(x => x.companyId !== co.id);
      S.roles = (S.roles || []).filter(x => x.companyId !== co.id);
      // And its folds. Nothing reads a stale key, but a store that only ever
      // grows is a store that eventually holds more dead jobs than live ones.
      const open = S.settings.open || {};
      Object.keys(open).forEach(k => { if(k === co.id || k.startsWith(co.id + '/')) delete open[k]; });
      save(); renderAll();
    };
    btns.appendChild(del);
    // Inside the job's fold, not under it: a row of buttons for a job that is
    // folded shut would be a delete control floating next to nothing.
    inner.appendChild(btns);
    box.appendChild(card);
  });

  $('#leads').value = (S.settings.leads || []).join(', ');
  const sub = S.settings.feedMode !== 'import';
  const modeSel = document.getElementById('feedmode');
  if(modeSel) modeSel.value = sub ? 'subscribe' : 'import';
  const btn = document.getElementById('exportics');
  if(btn) btn.textContent = sub ? 'Save the feed file' : 'Save new shifts';
  const all = document.getElementById('exportall');
  if(all) all.hidden = sub;
  const help = document.getElementById('feedhelp');
  if(help) help.textContent = sub
    ? 'Always save over the same shifts.ics that ICSx\u2075 points at. It holds every shift, so the calendar mirrors it exactly and never duplicates.'
    : 'Only shifts not sent before are included, so importing again will not duplicate anything.';
  const un = S.shifts.filter(s => !s.sent).length;
  const note = document.getElementById('unsent');
  if(note) note.textContent = sub
    ? `${S.shifts.length} shift${S.shifts.length===1?'':'s'} in the feed.`
    : (un ? `${un} shift${un===1?'':'s'} not yet in the calendar.` : 'The calendar is up to date.');

  // Deleted shifts the calendar has not been told about. Only in manual-import
  // mode: subscription rebuilds the whole file and the event goes with it.
  // Hidden when the count is zero rather than saying "0 cancellations", which
  // would be one more permanently amber thing to learn to ignore (§19.1).
  const owed = sub ? 0 : owedCancels().length;
  const cbtn = document.getElementById('cancelics');
  if(cbtn) cbtn.hidden = !owed;
  const cnote = document.getElementById('cancelnote');
  if(cnote){
    cnote.hidden = !owed;
    cnote.textContent = owed
      ? `${owed} deleted shift${owed===1?'':'s'} still in the calendar, with alarms. `
        + 'Save the cancellations and open that file the same way. '
        + 'If the event is still there afterwards, delete it in the calendar by hand — '
        + 'some importers ignore the file\u2019s identifiers.'
      : '';
  }
}

function renderAll(){
  renderSchedule(); renderPay(); renderSetup(); fillCompanyPicker();
}

/* ---------- shift editing dialog ---------------------------------------- */
function editShift(id){
  const s = S.shifts.find(x => x.id === id);
  if(!s) return;
  const dlg = $('#dlg');
  // What the label offers each picker. Read fresh each time because the label
  // box below is editable and the pickers are redrawn from it.
  const cand = () => labelCandidates($('#e-label') ? $('#e-label').value : s.label);
  $('#dlgbody').innerHTML = `
    <h2>Edit shift</h2>
    <label class="f"><span>Job</span><select id="e-co">${S.companies.map(c =>
      `<option value="${c.id}"${c.id===s.companyId?' selected':''}>${esc(c.name)}</option>`).join('')}</select></label>
    <label class="f"><span>Date</span><input id="e-date" type="date" value="${s.date}"></label>
    <div class="grid2">
      <label class="f"><span>Start</span>${clockInput(s.start, 'id="e-start"')}</label>
      <label class="f"><span>End</span>${clockInput(s.end, 'id="e-end"')}</label>
    </div>
    <p class="flag" id="e-bad" hidden></p>
    <div class="grid2">
      <label class="f"><span>Role</span><select id="e-role">${roleOptions(
        { companyId: s.companyId, roleId: s.roleId || null, roleRaw: cand().role })}</select></label>
      <label class="f"><span>Site</span><select id="e-site">${siteOptions(
        { companyId: s.companyId, siteId: s.siteId || null, siteRaw: cand().site })}</select></label>
    </div>
    <p class="tiny soft" id="e-rate" style="margin:-.35rem 0 .55rem"></p>
    <label class="f" id="e-labelwrap"${s.siteId ? ' hidden' : ''}><span>Site or role, as text</span>
      <input id="e-label" type="text" value="${esc(s.label)}"></label>
    <label class="f"><span>Address, for the calendar</span>
      <input id="e-place" type="text" placeholder="401 Main St, Hattiesburg MS" value="${esc(s.place||'')}"></label>
    <p class="tiny soft" id="e-addr" style="margin:-.35rem 0 .55rem"></p>
    <div class="rowbtns">
      <button class="act" id="e-save">Save</button>
      <button class="ghost" id="e-cancel">Cancel</button>
      <button class="ghost danger" id="e-del" style="margin-left:auto">Delete</button>
    </div>`;
  dlg.showModal();
  // Both times are 24-hour, whatever the phone's locale is (§24). Nothing is
  // saved until they both read as times: this dialog is where he corrects a
  // shift by hand, so a field it could not understand has to stop the save
  // rather than file a blank over a time that was right until he touched it.
  const hush = () => { $('#e-bad').hidden = true; };
  const start = bindClock($('#e-start'), hush), end = bindClock($('#e-end'), hush);

  // The two pickers, and the three things that hang off them: the text label is
  // only shown when neither names the shift, the address box is an override
  // rather than the address — left empty, the site's own is what reaches the
  // calendar — and the rate line says what this shift is about to be worth.
  let siteId = s.siteId || null, roleId = s.roleId || null;
  const sitesel = $('#e-site'), rolesel = $('#e-role');
  const coNow = () => $('#e-co').value;
  const say = () => {
    const site = siteById(siteId), role = roleById(roleId);
    $('#e-labelwrap').hidden = !!(site || role);
    $('#e-addr').textContent = !site
      ? 'No site set, so this shift carries its own address or none at all.'
      : site.address
        ? `Left empty, ${site.name} uses ${site.address}.`
        : `${site.name} has no address on file. Add one on its card in Setup and every shift there gets it.`;
    // Named out loud, because this dialog is the one place a shift's pay can be
    // changed by hand and the field that does it does not look like it does.
    const co = coById(coNow());
    const rate = rateFor(s, role, co);
    $('#e-rate').textContent = rate == null
      ? 'No rate set for this, so it counts as hours and not as money.'
      : role && role.rate != null
        ? `Paid $${rate.toFixed(2)} an hour, from ${role.name}.`
        : `Paid $${rate.toFixed(2)} an hour, from ${(co && co.name) || 'the job'}.`;
  };
  const redraw = () => {
    const c = cand();
    sitesel.innerHTML = siteOptions({ companyId: coNow(), siteId, siteRaw: c.site });
    rolesel.innerHTML = roleOptions({ companyId: coNow(), roleId, roleRaw: c.role });
    say();
  };
  sitesel.onchange = () => {
    const row = { companyId: coNow(), siteId, siteRaw: cand().site };
    pickSite(row, sitesel.value);
    siteId = row.siteId;
    redraw();
  };
  rolesel.onchange = () => {
    const row = { companyId: coNow(), roleId, roleRaw: cand().role };
    pickRole(row, rolesel.value);
    roleId = row.roleId;
    redraw();
  };
  // A site and a role both belong to one job. Moving the shift to another one
  // therefore drops them rather than carrying a pointer into a list it is not
  // in — the label is still there, which is what it is for.
  $('#e-co').onchange = () => {
    const site = siteById(siteId); if(site && site.companyId !== coNow()) siteId = null;
    const role = roleById(roleId); if(role && role.companyId !== coNow()) roleId = null;
    redraw();
  };
  say();

  $('#e-cancel').onclick = () => dlg.close();
  $('#e-save').onclick = () => {
    start.settle(); end.settle();
    const st = start.read(), en = end.read();
    if(st === null || en === null){
      const bad = $('#e-bad');
      bad.hidden = false;
      bad.textContent = 'Start and end have to be times, on the 24-hour clock \u2014 ' +
        '21:30 for half past nine at night. 2130 and 9:30pm are read too.';
      return;
    }
    s.companyId = $('#e-co').value;
    s.date = $('#e-date').value;
    s.start = st;
    s.end = en;
    s.label = $('#e-label').value.trim() || 'Shift';
    // Pointing a filed shift at a record by hand is the strongest confirmation
    // in the app — stronger than letting a fuzzy match stand in review — so
    // the spelling it was read under becomes one that record answers to, and
    // the next screenshot spelling it that way needs no decision (§8.1, §27).
    const c = labelCandidates(s.label);
    if(siteId && siteId !== s.siteId)
      learnSpellings({ siteId, siteHow: 'set', siteRaw: c.site });
    if(roleId && roleId !== s.roleId)
      learnSpellings({ roleId, roleHow: 'set', roleRaw: c.role });
    s.siteId = siteId;
    s.roleId = roleId;
    // The curated spelling when there is a record, and otherwise whatever the
    // label offers as a role — the same fallback the review path uses.
    s.role = roleId ? (roleById(roleId) || {}).name || '' : c.role;
    s.place = $('#e-place').value.trim();
    // He has just been through this shift by hand, which is the strongest
    // confirmation there is. Leaving it as a proposal would keep drawing his
    // own numbers as an assumption and keep counting them as unconfirmed
    // (§20.8).
    if(isProposed(s)) s.source = 'manual';
    // Changed, so send it to the calendar again — and as a *newer* revision of
    // the event it already has, or a calendar is within its rights to keep
    // showing the old time (§22).
    if(s.sent) s.seq = (s.seq || 0) + 1;
    s.sent = false;
    save(); dlg.close(); renderAll();
  };
  $('#e-del').onclick = () => {
    dropShifts(x => x.id === id);
    save(); dlg.close(); renderAll();
  };
}

/* ---------- import ------------------------------------------------------- */
let pending = [];

function fillCompanyPicker(){
  const sel = $('#impco');
  const prev = sel.value;
  sel.innerHTML = S.companies.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')
    || '<option value="">Add a job in Setup first</option>';
  if(prev) sel.value = prev;
}

function prep(img){
  const scale = Math.min(3, Math.max(1, 1800 / img.naturalWidth));
  const c = document.createElement('canvas');
  c.width  = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  const x = c.getContext('2d', {willReadFrequently:true});
  x.imageSmoothingQuality = 'high';
  x.drawImage(img, 0, 0, c.width, c.height);
  const d = x.getImageData(0,0,c.width,c.height), p = d.data;
  let sum = 0;
  for(let i = 0; i < p.length; i += 4){
    const g = (p[i]*0.299 + p[i+1]*0.587 + p[i+2]*0.114)|0;
    p[i] = p[i+1] = p[i+2] = g; sum += g;
  }
  const dark = (sum/(p.length/4)) < 118;
  for(let i = 0; i < p.length; i += 4){
    let g = dark ? 255 - p[i] : p[i];
    g = (g-128)*1.45 + 128;
    p[i] = p[i+1] = p[i+2] = g < 0 ? 0 : g > 255 ? 255 : g;
  }
  x.putImageData(d,0,0);
  return c;
}
/* The OCR engine is ~10MB and only the Add tab needs it, so it is fetched on
   first use rather than from <head>. A script tag in <head> is parser-blocking:
   with the CDN unreachable the whole app failed to open, which is the opposite
   of what an offline-first PWA should do. The service worker caches it after
   the first successful load, so this costs nothing on later imports. */
let readerPromise = null;
function loadReader(){
  if(typeof Tesseract !== 'undefined') return Promise.resolve();
  if(readerPromise) return readerPromise;
  readerPromise = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/tesseract.min.js';
    s.onload = () => res();
    s.onerror = () => { readerPromise = null; rej(new Error('reader unavailable')); };
    document.head.appendChild(s);
  });
  return readerPromise;
}

const loadImg = file => new Promise((res,rej) => {
  const i = new Image();
  i.onload = () => res(i);
  i.onerror = () => rej(new Error('bad image'));
  i.src = URL.createObjectURL(file);
});

/* One door for everything dropped, picked or pasted. Screenshots go to the
   OCR path, .ics files to the calendar reader; a phone often reports no MIME
   type at all for an .ics, so the extension is checked too. */
function handleFiles(files){
  const all = [...files];
  const cal = all.filter(f => /\.ics$/i.test(f.name || '') || f.type === 'text/calendar');
  const imgs = all.filter(f => f.type.startsWith('image/'));
  if(cal.length) readCalendarFiles(cal);
  if(imgs.length) readFiles(imgs);
}

async function readFiles(files){
  const imgs = [...files].filter(f => f.type.startsWith('image/'));
  if(!imgs.length) return;
  if(!S.companies.length){ alert('Add a job in Setup first, so the shifts have somewhere to go.'); return; }

  const batchCo = $('#impco').value;
  if(!batchCo){ alert('Pick which job these screenshots are from first.'); return; }

  const prog = $('#prog'), fill = $('#barfill'), txt = $('#progtext');
  prog.classList.add('on');
  fill.style.width = '2%';
  txt.textContent = 'Loading the reader';

  let worker;
  try{
    await loadReader();
    worker = await Tesseract.createWorker('eng', 1, {
      logger: m => { if(m.status === 'recognizing text') fill.style.width = (10 + m.progress*85) + '%'; }
    });
  }catch(e){
    txt.textContent = 'The reader could not load. Check the connection and try again.';
    return;
  }

  const chunks = [];
  for(let i = 0; i < imgs.length; i++){
    txt.textContent = `Reading image ${i+1} of ${imgs.length}`;
    try{
      const { data:{ text } } = await worker.recognize(prep(await loadImg(imgs[i])));
      chunks.push(`--- ${imgs[i].name} ---\n${text}`);
      // Stamp the job now, not at commit time — the picker may be changed
      // between batches, and each row belongs to the job it was read under.
      parse(text).forEach(p => pending.push({ ...p, rid: uid(), companyId: batchCo }));
    }catch(e){ chunks.push(`--- ${imgs[i].name} ---\n[unreadable]`); }
  }
  await worker.terminate();

  $('#raw').textContent = chunks.join('\n\n');
  fill.style.width = '100%';

  // Before the duplicate filter, not after: a row twelve hours out is a
  // duplicate of nothing until it has been put right, and a row whose site is
  // still three characters of OCR damage is a duplicate of nothing either.
  pending.forEach(applyPatterns);
  pending.forEach(applyNames);
  pending = pending.filter(bySlot);

  txt.textContent = pending.length
    ? `Found ${pending.length} shift${pending.length===1?'':'s'}. Check them, then add.`
    : 'Nothing new found. Open the raw text below to see what was read.';
  renderReview();
}

/* Drop only exact repeats — same job, same date, same times, same place. A row
   matching on time but not on place is a location change, not a duplicate, so
   it stays and gets flagged for review. This is all a screenshot row can be
   matched on; a calendar row has a UID and is matched on that first.

   The case that made §8.3 work is the middle one. A generated shift is exactly
   what a later screenshot matches, so under the old rule the confirming row
   was discarded as a duplicate, nothing was written, and the record stayed a
   proposal for ever — the hollow tick could never fill in, and the mitigation
   §8.3 rests on could never happen (§20.2). A match against a `source:'pattern'`
   record is therefore a confirmation rather than a repeat: it carries
   `replaceId`, and the commit path replaces in place keeping the record's id,
   so the calendar sees an update rather than a second event.

   The site is not compared in that case. The label on a generated row was
   never read off anything — §8.3 calls it a convenience default — so a
   screenshot disagreeing with it is not a location change, it is the first
   real information anyone has had about it. */
function bySlot(p){
  if(!p.date) return true;
  const sameSlot = S.shifts.filter(s =>
    s.companyId === p.companyId && s.date === p.date &&
    s.start === p.start && s.end === p.end);
  if(!sameSlot.length) return true;

  // A generated row into a slot already filled: the week is already covered,
  // whatever is standing there. Filling the same week twice adds nothing.
  if(isProposed(p)) return false;

  const proposal = sameSlot.find(isProposed);
  if(proposal){ p.replaceId = proposal.id; return true; }            // confirmation

  // Same place, on the identity the site table gives it (§8.1). Two rows that
  // resolved to the same site are the same place however they were spelled,
  // which is the difference between a duplicate the app can see and one it
  // used to wave through as a location change. A row that matched no site
  // falls back to comparing the text, exactly as this did before.
  const mine = whereKey(p);
  if(sameSlot.some(s => whereKey(s) === mine)) return false;         // exact repeat
  p.flags = [...p.flags, FLAG_MOVED];
  return true;
}

/* ---------- declared patterns (§8.2) --------------------------------------
   patterns.js does the deciding. This is where the app says which rows it is
   allowed to decide about, and turns what comes back into something the review
   screen already knows how to show.

   Screenshot rows only. A calendar row carries the employer's own numbers and
   a hand-entered row carries his, so correcting either against a declared rota
   would be overwriting fact with assumption — which is the same mistake as
   snapping a shift the employer really moved, pointed the other way.
   ---------------------------------------------------------------------- */
const PAT_FLAGS = [PAT_FLAG.FLIPPED, PAT_FLAG.OFFPAT, PAT_FLAG.ODDLEN];

function applyPatterns(p){
  if(p.removeId) return;
  if(p.source && p.source !== 'ocr') return;
  if(p.edited) return;                       // he has taken the times over

  // Judge what was read, never what a previous run of this left behind.
  // Otherwise the second run finds its own correction sitting there looking
  // exactly right, and drops the warning that came with it.
  if(!p.read) p.read = { start: p.start, end: p.end };

  const co = coById(p.companyId);
  const got = checkShift({ date: p.date, start: p.read.start, end: p.read.end },
                         co && co.patterns);
  p.start = got.start;
  p.end   = got.end;
  p.flags = [...p.flags.filter(f => !PAT_FLAGS.includes(f)), ...got.flags];
  // Only a flip gets a sentence. A snap of a few minutes is deliberately
  // silent, and a note on every one of those is how a review screen stops
  // being read at all.
  p.patNote = (got.read && got.flags.includes(PAT_FLAG.FLIPPED))
    ? `Read as ${fmtTime(got.read.start)}\u2013${fmtTime(got.read.end)}.`
    : '';
}

/* ---------- filling a week from the rota (§8.3) ----------------------------
   The fixed job has no feed and no email, so the sensible primary input is not
   a screenshot at all — it is the rota itself, proposed into the review screen,
   with screenshots demoted to catching the weeks that deviate (§17.2).

   Rows are emitted into `pending`, which is the whole trick: the review screen,
   its flags, the length and overlap checks, the site snapping and the commit
   path all already exist and all treat these like any other import. What is
   new here is only what a pattern cannot say — which dates, which site, and
   which of those dates is a holiday.
   ---------------------------------------------------------------------- */

/* The pay week, not the schedule's Sunday-to-Saturday one. It is the week
   boundary he chose a meaning for, and a generated week that cut across the
   week his hours are totalled in would be useless for the one thing generation
   is for (§20.8). */
function payWeekStart(co, dateStr){
  return weekStart(dateStr || todayISO(), co.weekStart ?? 0);
}

/* Where the shift is, which a pattern does not carry. The most recent filed
   shift at these times for this job is the best guess available, and a
   convenience default is fine for a label where it would not be for a time:
   a wrong label costs mild confusion, a wrong time costs a shift (§8.3).

   Since §8.1 that guess carries a `siteId` rather than a string, so a filled
   week inherits the site's address without inheriting a spelling — and the
   `LOCATION:` line on a generated shift is the curated one rather than
   whatever OCR made of the site name on the day the guess came from.

   §27 put a standard role and site on the declared shift itself, and that is
   now the first answer: a rota row that says what it is beats anything
   rummaged out of history, and it has to, because the role carries the rate
   and a guessed rate is a wrong figure nobody was asked about. This function
   is what happens when the rota says nothing, which is every pattern declared
   before §27 and every one he does not bother to fill in. */
function siteFor(co, start, end){
  // Confirmed records first, and only then the app's own earlier guesses. A
  // label copied from one generated week into the next would be an assumption
  // quietly acquiring a history, which is the shape §8.2 rejected outright when
  // it refused to learn times from the parser's own output.
  const rank = s => (isProposed(s) ? 1 : 0);
  const mine = S.shifts.filter(s => s.companyId === co.id)
    .sort((a, b) => rank(a) - rank(b) || (b.date + b.start).localeCompare(a.date + a.start));
  const same = mine.find(s => s.start === start && s.end === end) || mine[0];
  return { label: same ? same.label : 'Shift', role: (same && same.role) || '',
           roleId: (same && same.roleId) || null,
           siteId: (same && same.siteId) || null,
           place: same && same.place ? same.place : '' };
}

/* Marked, never skipped. A silent skip generalises from one observed Labour
   Day, and on the holiday he does work it produces a missing shift with
   nothing on screen to notice — the more expensive failure by §8.3's own
   ranking. Flagged, the question costs one tap, in review, before anything is
   filed and long before anything rings (§20.7).

   Re-run when the row's date or job changes, the same way the pattern check is
   (§18.5): a verdict about the 7th has nothing to say about the 8th, and a
   holiday flag left standing over a date it no longer describes is exactly the
   sort of stale amber that teaches him to ignore the amber that means it. */
function applyHoliday(p){
  if(!isProposed(p)) return;
  const co = coById(p.companyId);
  const hol = co && p.date ? holidayOn(p.date, co.holidays) : null;
  p.flags = p.flags.filter(f => f !== FLAG_HOLIDAY);
  p.note = '';
  if(hol){
    p.flags = [...p.flags, FLAG_HOLIDAY];
    p.note = `${hol}.`;
  }
}

/* One week of the rota, as review rows. Returns what it did rather than
   saying it, so the caller writes the sentence and the tests do not have to
   read the DOM to know what happened. */
function fillWeek(co, ws){
  const today = todayISO();
  // Never backwards. Past hours filled from a rota land in the pay tab as
  // earnings nobody verified, and in the feed as events whose alarms have
  // already gone off (§20.8).
  const dates = weekDates(ws, 7).filter(d => d >= today);
  const rows = generateWeek(co.patterns, dates);

  let filled = 0, covered = 0, holidays = 0;
  for(const r of rows){
    // What the rota declared, and only then what history suggests. `r` carries
    // the declared role and site straight out of generateWeek(); `siteFor` is
    // the older guess, kept for the pattern that declares neither.
    const guess = siteFor(co, r.start, r.end);
    const roleId = r.roleId || guess.roleId || null;
    const siteId = r.siteId || guess.siteId || null;
    const role = roleById(roleId);
    const row = { rid: uid(), companyId: co.id, date: r.date, start: r.start, end: r.end,
                  label: guess.label, role: role ? role.name : guess.role,
                  roleId, siteId, flags: [], source: 'pattern' };
    // The address rides with the site, so a declared site brings its own and a
    // place copied off an unrelated shift would be worse than none.
    if(!r.siteId && guess.place) row.place = guess.place;

    applyHoliday(row);
    // Carried over rather than matched: the role and site on this row were
    // declared on the rota or copied from a shift that already had them, so
    // there is no reading to confirm and nothing to learn. It only needs the
    // raws and the `how`s settled so the review row and the commit path can
    // read them like any other.
    applyNames(row);

    // Already on file, or already sitting in this batch: the slot is covered
    // and a second row for it would read as a second shift he is expected to
    // work. bySlot() drops a generated row into a filled slot whatever the
    // site standing there, because the site on this row was invented here.
    const inBatch = pending.some(x => !x.removeId && x.companyId === co.id &&
      x.date === row.date && x.start === row.start && x.end === row.end);
    if(inBatch || !bySlot(row)){ covered++; continue; }

    pending.push(row);
    filled++;
    if(row.flags.includes(FLAG_HOLIDAY)) holidays++;   // counted only if it is really there
  }
  return { filled, covered, holidays, dates: dates.length };
}

/* Overlap, at the point it can still be stopped (§8.2, §19).

   The schedule banner catches a clash that is already filed. This catches it
   one step earlier, in review, which is where it is cheapest to fix and where
   the calendar path most needs it — a feed import is the one route into this
   app that nobody is watching.

   A row is checked against what is on file and against the rest of the batch,
   because a screenshot and an .ics imported in the same sitting can just as
   easily collide with each other as with history. Rows this one is about to
   replace or remove are not counted: they are this same shift, not a second
   one, and counting them would flag every ordinary calendar update. */
function applyClashes(rows){
  const live = S.shifts.filter(s => !rows.some(r => r.removeId === s.id || r.replaceId === s.id));
  rows.forEach(p => {
    if(p.removeId) return;
    p.flags = p.flags.filter(f => f !== PAT_FLAG.CLASH);
    p.clashNote = '';
    const others = [...live, ...rows.filter(r => !r.removeId)];
    const hits = findClashes(p, others, o => o === p || (p.replaceId && o.id === p.replaceId));
    if(!hits.length) return;
    const o = hits[0].shift;
    const co = coById(o.companyId);
    p.flags = [...p.flags, PAT_FLAG.CLASH];
    p.clashNote = `${co ? co.name : 'A shift'} ${fmtTime(o.start)}\u2013${fmtTime(o.end)} ` +
                  `on ${fmtDay(o.date)}, by ${fmtDur(hits[0].mins)}.`;
  });
}

/* ---------- calendar import ----------------------------------------------
   Homebase's own Calendar Sync writes his shifts into a Google calendar. That
   is a better source than a screenshot in every way that matters — the times
   are the employer's numbers rather than characters read off a dark screen —
   but nothing in a browser can reach into the phone's calendar to get them.
   An .ics file is the bridge, whether saved from the feed, exported out of
   Google Calendar, or pasted in as text.

   What a calendar row has and a screenshot row does not is the event's UID.
   That is a stable identity, so importing the same feed twice updates the
   shift it made the first time instead of adding a second one, and a shift
   the employer has moved shows as a change rather than a duplicate.
   ------------------------------------------------------------------------ */

/* Kept in one place because the same window has to be honest in the report:
   a Google export holds years of history and none of it is news. */
const ICS_FROM = () => shiftDays(todayISO(), -7);

function icsSame(a, b){
  return a.date === b.date && a.start === b.start && a.end === b.end &&
         whereKey(a) === whereKey(b);
}

function calendarRows(text){
  const co = coById($('#impco').value);
  const { rows, report } = parseICS(text, {
    from: ICS_FROM(),
    match: co ? co.icsMatch : ''
  });
  if(report.notCalendar) return { report };

  let unchanged = 0;
  const fresh = [];
  for(const r of rows){
    const row = { ...r, rid: uid(), companyId: co.id, extUid: r.uid };
    applyNames(row);

    // Matched on UID: this is a shift the feed has already given us once.
    const onFile = r.uid && S.shifts.find(s => s.extUid === r.uid && s.companyId === co.id);
    if(onFile){
      if(icsSame(onFile, row)){ unchanged++; continue; }
      row.flags = [...row.flags, FLAG_CHANGED];
      row.note = `Was ${fmtTime(onFile.start)}\u2013${fmtTime(onFile.end)} ${shiftWhere(onFile)}.`;
      row.replaceId = onFile.id;          // commit replaces rather than adds
      fresh.push(row);
      continue;
    }
    if(bySlot(row)) fresh.push(row);
  }
  return { rows: fresh, report, unchanged, gone: cancellationRows(report) };
}

/* A cancelled event names a shift on file that is not happening. Nothing else
   in this app can tell him that — a screenshot of a schedule cannot show what
   is missing from it — and with the schedule flowing back out to a calendar of
   its own, removing it here is what takes it off the phone.

   It is still a proposal, never an action. §8.4's rule holds: a partial view
   of a schedule is indistinguishable from a week of cancellations, so removal
   is a row he ticks off, sitting in the same review list as everything else. */
function cancellationRows(report){
  const co = coById($('#impco').value);
  return (report.cancelledRows || []).map(c => {
    const s = S.shifts.find(x => x.extUid === c.uid && x.companyId === co.id);
    if(!s) return null;
    return {
      rid: uid(), companyId: s.companyId, removeId: s.id,
      date: s.date, start: s.start, end: s.end, label: s.label,
      siteId: s.siteId || null, roleId: s.roleId || null, role: s.role || '',
      flags: [], source: 'ics'
    };
  }).filter(Boolean);
}

function readCalendarText(text, sourceName){
  if(!S.companies.length){ alert('Add a job in Setup first, so the shifts have somewhere to go.'); return; }
  if(!$('#impco').value){ alert('Pick which job this calendar is for first.'); return; }

  const prog = $('#prog'), fill = $('#barfill'), txt = $('#progtext');
  prog.classList.add('on');
  fill.style.width = '100%';

  // The raw text is the artefact, same as with a screenshot — but a Google
  // export runs to megabytes, and the panel only has to show the shape.
  $('#raw').textContent = `--- ${sourceName} ---\n` +
    (text.length > 20000 ? text.slice(0, 20000) + '\n\n[…truncated]' : text);

  const got = calendarRows(text);
  if(got.report.notCalendar){
    txt.textContent = 'That is not a calendar file. A saved feed starts with BEGIN:VCALENDAR — ' +
                      'a link that needs signing in gives back a web page instead.';
    return;
  }
  const r = got.report;
  got.rows.forEach(row => pending.push(row));
  got.gone.forEach(row => pending.push(row));

  const skipped = [];
  if(got.unchanged) skipped.push(`${got.unchanged} already on file`);
  if(r.past)     skipped.push(`${r.past} before ${ICS_FROM()}`);
  if(r.filtered) skipped.push(`${r.filtered} not matching the job's filter`);
  if(r.allDay)   skipped.push(`${r.allDay} all-day`);
  if(r.cancelled)skipped.push(`${r.cancelled} cancelled`);
  if(r.unreadable) skipped.push(`${r.unreadable} unreadable`);

  txt.textContent =
    (got.rows.length
      ? `${got.rows.length} shift${got.rows.length===1?'':'s'} to check, from ${r.events} events`
      : `Nothing new in ${r.events} events`) +
    (skipped.length ? ` (skipped: ${skipped.join(', ')}).` : '.') +
    (got.gone.length
      ? ` ${got.gone.length} shift${got.gone.length===1?' has':'s have'} been cancelled — ` +
        `tick ${got.gone.length===1?'it':'them'} below to take ${got.gone.length===1?'it':'them'} off the calendar.`
      : '');
  renderReview();
}

async function readCalendarFiles(files){
  for(const f of files){
    try{ readCalendarText(await f.text(), f.name); }
    catch(e){ $('#progtext').textContent = `${f.name} could not be read.`; }
  }
}

/* Fetching the feed directly would remove the saving step altogether, and for
   a feed that allows it this is the whole win. Most do not: Google's iCal
   addresses send no CORS headers, so the browser refuses to hand this page the
   response. That failure is indistinguishable from being offline, so say what
   is actually likely rather than guessing at a cause. */
async function fetchCalendar(url){
  const clean = String(url).trim().replace(/^webcal:/i, 'https:');
  if(!/^https?:\/\//i.test(clean)){ alert('That does not look like a link.'); return; }
  const txt = $('#progtext');
  $('#prog').classList.add('on');
  txt.textContent = 'Fetching the calendar…';
  try{
    const res = await fetch(clean, { redirect: 'follow' });
    if(!res.ok) throw new Error(String(res.status));
    const body = await res.text();
    S.settings.icsUrl = clean; save();
    readCalendarText(body, clean);
  }catch(e){
    txt.textContent = 'That link could not be read from here. Most calendar feeds — ' +
      "Google's included — refuse to hand their contents to a web page. " +
      'Open the link in Chrome to save the .ics, then add the file above.';
  }
}

function flagText(p){
  const say = f => {
    const t = FLAG_TEXT[f];
    return typeof t === 'function' ? t(p) : (t || f);
  };
  return [...p.flags.map(say), p.patNote || '', p.clashNote || '', p.note || '']
    .filter(Boolean).join(' ');
}

function renderReview(){
  const box = $('#review');
  box.innerHTML = '';
  $('#revbtns').hidden = !pending.length;
  if(!pending.length) return;
  // Every render, because a clash is a property of the batch rather than of a
  // row: correcting one row's date can put it on top of another, and removing
  // a row can clear a warning still sitting on the one it collided with.
  applyClashes(pending);

  const manyJobs = S.companies.length > 1;
  // A clash belongs to the batch, not to a row, so changing one row can clear
  // or raise a warning on another. Every row hands back a way to refresh its
  // own note line, and they all get called together — re-rendering the list
  // instead would reorder rows and drop focus mid-edit.
  const touches = [];
  const refreshAll = () => { applyClashes(pending); touches.forEach(t => t()); };
  // A record made on one row answers for the whole batch. Rows that already
  // resolved are left alone: a match he has confirmed is not re-litigated
  // because a different row taught the table something.
  const rematch = () => pending.forEach(x => {
    if(!x.removeId && (!x.siteId || !x.roleId)) applyNames(x);
  });

  pending.forEach(p => {
    // A removal is not an edit. It gets no fields — there is nothing to
    // correct, only a decision — and it says what would go.
    if(p.removeId){
      const row = el('div','rev flagged gone');
      row.innerHTML = `
        <div class="revf">
          <label class="tick"><input type="checkbox" checked> Remove</label>
          <span class="mono tiny">${esc(p.date)} ${esc(fmtTime(p.start))}\u2013${esc(fmtTime(p.end))}</span>
          <span class="tiny">${esc(shiftWhere(p))}</span>
          <button class="kill" aria-label="Keep this shift">&times;</button>
        </div>
        <p class="flag">Cancelled in the calendar. Removing it takes it off the phone on the next export.</p>`;
      const box = row.querySelector('input[type=checkbox]');
      box.onchange = () => { p.keep = !box.checked; };
      row.querySelector('.kill').onclick = () => {
        pending = pending.filter(x => x.rid !== p.rid);
        renderReview();
      };
      $('#review').appendChild(row);
      return;
    }

    const row = el('div','rev' + ((!p.date || p.flags.length) ? ' flagged' : ''));
    row.innerHTML = `
      <div class="revf">
        <input type="date" value="${p.date}">
        ${clockInput(p.start, 'aria-label="Starts"')}
        <span class="soft mono">to</span>
        ${clockInput(p.end, 'aria-label="Ends"')}
        <span class="tiny soft read">${esc(p.label || '\u2014')}</span>
        <select class="rolesel" aria-label="Role">${roleOptions(p)}</select>
        <select class="sitesel" aria-label="Site">${siteOptions(p)}</select>
        ${manyJobs ? `<select class="cosel">${S.companies.map(c =>
          `<option value="${c.id}"${c.id===p.companyId?' selected':''}>${esc(c.name)}</option>`
        ).join('')}</select>` : ''}
        <button class="kill" aria-label="Remove">&times;</button>
      </div>
      <p class="flag"${p.flags.length ? '' : ' hidden'}>${esc(flagText(p))}</p>`;

    const [d,s,e] = row.querySelectorAll('input');
    const note = row.querySelector('.flag');
    // Refresh this row in place. Re-rendering the whole list on every
    // keystroke would reorder rows and drop focus mid-edit.
    const touch = () => {
      note.textContent = flagText(p);
      note.hidden = !(p.flags.length || p.patNote);
      row.classList.toggle('flagged', !p.date || p.flags.length > 0);
    };
    touches.push(touch);
    // The date and the job are what decide which declared shifts a row is
    // judged against, so changing either re-runs the check — and a TrackTik
    // screen where every row came back undated (§16.1) is exactly when it is
    // worth most. The times are not on that list: once he has typed one it is
    // his, and §8.2's rule that a real change must never be snapped away
    // applies most of all when the change came from him.
    const recheck = () => {
      applyHoliday(p);
      applyPatterns(p);
      if(!p.edited){ s.value = p.start; e.value = p.end; }
      refreshAll();
    };
    const byHand = () => {
      p.edited = true;
      // A verdict about what was read says nothing about what he has since
      // typed, so it goes rather than sitting there amber over a number that
      // is no longer on the row.
      p.flags = p.flags.filter(f => !PAT_FLAGS.includes(f));
      p.patNote = '';
    };
    d.oninput = () => {
      p.date = d.value;
      // Only the missing-date warning is answered by setting a date. The am/pm
      // and split-line warnings are about the times and must survive.
      if(p.date) p.flags = p.flags.filter(f => f !== FLAG.NODATE);
      recheck();
    };
    bindClock(s, v => { p.start = v; byHand(); refreshAll(); }, { allowEmpty: true });
    bindClock(e, v => {
      p.end = v;
      byHand();
      // Supplying the end answers the one-time warning and nothing else. The
      // am/pm warning is about a value that was read, not one that was absent,
      // so it survives being given the other half of the pair.
      if(p.end) p.flags = p.flags.filter(f => f !== FLAG.ONETIME);
      refreshAll();
    }, { allowEmpty: true });
    const sel = row.querySelector('.sitesel');
    sel.onchange = () => {
      pickSite(p, sel.value);
      // A site made here is a site every other unresolved row in the batch can
      // now match. One screenshot routinely carries the same place four times,
      // spelled four ways, and naming it once is meant to answer all four.
      rematch();
      renderReview();
    };
    const rsel = row.querySelector('.rolesel');
    rsel.onchange = () => {
      pickRole(p, rsel.value);
      rematch();
      renderReview();
    };
    const job = row.querySelector('.cosel');
    // The site list belongs to the job, so changing the job rebuilds the row
    // rather than refreshing its note line — the options on it are wrong the
    // moment the job is.
    if(job) job.onchange = () => { p.companyId = job.value; recheck(); applyNames(p); renderReview(); };
    row.querySelector('.kill').onclick = () => {
      pending = pending.filter(x => x.rid !== p.rid);
      renderReview();
    };
    box.appendChild(row);
  });
}

/* ---------- calendar file ------------------------------------------------
   `fold`, `icsEscape`, `icsStamp` and `shiftUID` come from ics.js, which is
   loaded first and now owns the file format in both directions. What is left
   here is the half that needs the store: which shifts, whose job, what title.
   ---------------------------------------------------------------------- */
function buildICS(only){
  const now = icsStamp();
  const leads = (S.settings.leads || []).filter(n => n > 0);
  // §25's alarm, and the one place in this file that has to look outside the
  // list it was handed. Rest is a property of a *pair*, and in manual-import
  // mode `only` is the shifts not sent before — so the shift on the other side
  // of the gap is routinely not in it. Worked out over the whole store.
  const rests = new Map();
  restGaps(S.shifts).filter(g => isShortRest(g.mins))
                    .forEach(g => rests.set(g.b.id, g.mins));
  const L = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Shift Deck//EN','CALSCALE:GREGORIAN',
             'METHOD:PUBLISH','X-WR-CALNAME:Work Schedule'];
  only.forEach(s => {
    const co = coById(s.companyId);
    const endDate = mins(s.end) <= mins(s.start) ? shiftDays(s.date,1) : s.date;
    // The hollow tick is in the app; the alarm is on the phone, and the phone
    // is where §8.3's stated risk actually lands. The title carries the mark,
    // and the alarm body reuses the title, so a 05:00 buzz for a shift nothing
    // has confirmed says which kind it is (§20.5).
    const title = eventTitle(co && co.name, s, siteById(s.siteId), roleById(s.roleId)) +
                  (isProposed(s) ? ' (from the rota)' : '');
    L.push('BEGIN:VEVENT',
      fold(`UID:${shiftUID(s.id)}`),
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
      fold('SUMMARY:' + icsEscape(title)),
      fold('DESCRIPTION:' + icsEscape(`${fmtDur(durMins(s))} scheduled`
        + (rests.has(s.id) ? `\nOnly ${fmtDur(rests.get(s.id))} off before this one.` : ''))));
    // An address here is a tappable link to a map. The two-hour alarm fires,
    // he taps the event, taps the address, and he is navigating.
    // §8.1's single best reason to have built any of this: the two-hour alarm
    // fires, he taps the event, taps the address, and he is navigating. The
    // shift's own address wins over the site's standing one — a feed row
    // carries what the employer published for that night.
    const where = shiftAddress(s);
    if(where) L.push(fold('LOCATION:' + icsEscape(where)));
    leads.forEach(h => {
      L.push('BEGIN:VALARM','ACTION:DISPLAY',
        fold('DESCRIPTION:' + icsEscape(title)),
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
        fold('DESCRIPTION:' + icsEscape(`Heads up: only ${fmtDur(rest)} off between shifts.`)),
        `TRIGGER:-PT${rh}H${rm ? rm + 'M' : ''}`, 'END:VALARM');
    }
    L.push('END:VEVENT');
  });
  L.push('END:VCALENDAR');
  return L.join('\r\n');
}
function download(name, text, type){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], {type}));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- wiring ------------------------------------------------------- */
document.querySelectorAll('nav button').forEach(b => {
  b.onclick = () => {
    document.querySelectorAll('nav button').forEach(x => x.setAttribute('aria-current', String(x === b)));
    ['schedule','import','pay','setup'].forEach(t =>
      document.getElementById('tab-' + t).hidden = (t !== b.dataset.tab));
    if(b.dataset.tab === 'pay') renderPay();
    if(b.dataset.tab === 'schedule') renderSchedule();
    scrollTo(0,0);
  };
});

$('#intake').onclick = () => $('#picker').click();
$('#intake').onkeydown = e => { if(e.key==='Enter'||e.key===' '){ e.preventDefault(); $('#picker').click(); } };
$('#picker').onchange = () => { handleFiles($('#picker').files); $('#picker').value = ''; };

$('#icsintake').onclick = () => $('#icspick').click();
$('#icsintake').onkeydown = e => { if(e.key==='Enter'||e.key===' '){ e.preventDefault(); $('#icspick').click(); } };
$('#icspick').onchange = () => { handleFiles($('#icspick').files); $('#icspick').value = ''; };
['dragenter','dragover'].forEach(ev => $('#icsintake').addEventListener(ev, e => {
  e.preventDefault(); $('#icsintake').classList.add('hot'); }));
['dragleave','drop'].forEach(ev => $('#icsintake').addEventListener(ev, e => {
  e.preventDefault(); $('#icsintake').classList.remove('hot'); }));
$('#icsintake').addEventListener('drop', e => handleFiles(e.dataTransfer.files));

$('#icslink').onclick = () => {
  const url = prompt('Link to the calendar feed', S.settings.icsUrl || '');
  if(url) fetchCalendar(url);
};
$('#icspaste').onclick = async () => {
  const text = prompt('Paste the calendar text, starting at BEGIN:VCALENDAR');
  if(text && text.trim()) readCalendarText(text, 'pasted text');
};
['dragenter','dragover'].forEach(ev => $('#intake').addEventListener(ev, e => {
  e.preventDefault(); $('#intake').classList.add('hot'); }));
['dragleave','drop'].forEach(ev => $('#intake').addEventListener(ev, e => {
  e.preventDefault(); $('#intake').classList.remove('hot'); }));
$('#intake').addEventListener('drop', e => handleFiles(e.dataTransfer.files));
document.addEventListener('paste', e => {
  const f = [...(e.clipboardData?.files||[])];
  if(f.length && !document.getElementById('tab-import').hidden) handleFiles(f);
});

$('#commit').onclick = () => {
  let added = 0, replaced = 0, removed = 0;

  pending.filter(p => p.removeId && !p.keep).forEach(p => {
    removed += dropShifts(x => x.id === p.removeId);
  });

  pending.filter(p => !p.removeId && p.date && p.start && p.end && p.companyId).forEach(p => {
    // The spellings that were read become ones these records answer to, before
    // the shift is built — so a row he pointed at a site or a role by hand
    // teaches the tables on the way past (§8.1, §27).
    learnSpellings(p);
    const rec = {
      id: uid(), companyId: p.companyId, date: p.date, start: p.start, end: p.end,
      // `label` is kept whatever happens. It is what a shift renders as when
      // its site is later deleted, and it is the only record of what the
      // screen actually said. `role` is the same bargain one level down: the
      // text stays so a shift still names its job title after the record
      // carrying its rate is gone.
      label: p.label, siteId: p.siteId || null,
      roleId: p.roleId || null, role: p.role || '',
      source: p.source || 'ocr'
    };
    // A calendar row carries the event's UID. Keeping it is what makes the
    // next import of the same feed an update rather than a second copy.
    if(p.extUid) rec.extUid = p.extUid;
    if(p.place) rec.place = p.place;
    if(p.replaceId){
      // The employer moved a shift already on file. Replace it in place and
      // keep its id, so a calendar built in manual-import mode rewrites the
      // event it already sent rather than leaving the old time sitting there.
      const i = S.shifts.findIndex(x => x.id === p.replaceId);
      if(i >= 0){
        const was = S.shifts[i];
        rec.id = was.id;
        // Same event, later revision. Without this the rewrite carries the
        // same SEQUENCE as the version the calendar already holds, which it
        // may ignore — the old time would sit there with its alarms (§22).
        rec.seq = was.sent ? (was.seq || 0) + 1 : (was.seq || 0);
        S.shifts[i] = rec;
        replaced++;
        return;
      }
    }
    S.shifts.push(rec);
    added++;
  });
  pending = [];
  save(); renderReview(); renderAll();
  $('#progtext').textContent =
    `Added ${added} shift${added===1?'':'s'}` +
    (replaced ? `, updated ${replaced}` : '') +
    (removed ? `, removed ${removed}` : '') + '.' +
    // In subscription mode the feed is rebuilt whole, so a removal reaches the
    // phone by itself. In manual-import mode nothing withdraws an event that
    // has already been sent, so say so rather than let it sit there ringing.
    (removed && S.settings.feedMode === 'import'
      ? ' The events already sent to the calendar stay there \u2014 delete them in the calendar app too.'
      : '');
};
$('#discard').onclick = () => { pending = []; renderReview(); $('#progtext').textContent = 'Discarded.'; };

/* "Fill week of ___" (§8.3). The week is asked for rather than assumed —
   next week is the ordinary case and is what the picker opens on, but the week
   after is what he wants the moment he is looking further ahead than that. */
$('#fillweek').onclick = () => {
  const co = coById($('#impco').value);
  if(!co){ alert('Add a job in Setup first.'); return; }
  if(!canGenerate(co.patterns)){
    alert(`${co.name} has no rota to fill from. In Setup, declare the shifts it normally ` +
          'runs and tick the days — a shift with no days ticked is only ever checked against.');
    return;
  }

  const dlg = $('#dlg');
  $('#dlgbody').innerHTML = `
    <h2>Fill a week from the rota</h2>
    <p class="tiny soft" style="margin:0 0 .6rem">${esc(co.name)}. The shifts land in the
      review list below like any import — nothing is filed until you add them, and they
      stay marked as coming from the rota until a screenshot confirms them.</p>
    <label class="f"><span>Week beginning</span><input id="f-week" type="date"></label>
    <p class="tiny" id="f-what"></p>
    <div class="rowbtns">
      <button class="act" id="f-go">Fill it</button>
      <button class="ghost" id="f-cancel">Cancel</button>
    </div>`;

  const wk = $('#f-week');
  // Next week, on this job's own pay week (§20.8), because the week in front of
  // him is the one already on the schedule.
  wk.value = shiftDays(payWeekStart(co, todayISO()), 7);
  const say = () => {
    const ws = payWeekStart(co, wk.value || todayISO());
    const today = todayISO();
    const dates = weekDates(ws, 7).filter(d => d >= today);
    const rows = generateWeek(co.patterns, dates);
    const what = $('#f-what');
    what.textContent = !dates.length
      ? `That week has been and gone — ${fmtDay(ws)} onwards is already in the past, and a rota is not evidence about a week that has already happened.`
      : rows.length
        ? `Week of ${fmtDay(ws)}: ${rows.length} shift${rows.length===1?'':'s'} — ` +
          rows.map(r => `${DAYNAMES[dowOf(r.date)]} ${fmtTime(r.start)}\u2013${fmtTime(r.end)}`).join(', ') + '.'
        : `Week of ${fmtDay(ws)}: the rota puts nothing in it.`;
    $('#f-go').disabled = !rows.length;
  };
  wk.oninput = say;
  say();

  dlg.showModal();
  $('#f-cancel').onclick = () => dlg.close();
  $('#f-go').onclick = () => {
    const ws = payWeekStart(co, wk.value || todayISO());
    const got = fillWeek(co, ws);
    dlg.close();
    $('#prog').classList.add('on');
    renderReview();
    $('#progtext').textContent = got.filled
      ? `${got.filled} shift${got.filled===1?'':'s'} from the rota, week of ${fmtDay(ws)}. ` +
        'Nothing has confirmed these — check them, then add.' +
        (got.holidays ? ` ${got.holidays} fall${got.holidays===1?'s':''} on a holiday and ${got.holidays===1?'is':'are'} flagged.` : '') +
        (got.covered ? ` ${got.covered} already covered.` : '')
      : got.covered
        ? `Nothing to add — that week is already covered.`
        : `The rota puts nothing in the week of ${fmtDay(ws)}.`;
  };
};

$('#manual').onclick = () => {
  const co = $('#impco').value;
  if(!co){ alert('Add a job in Setup first.'); return; }
  const row = { rid: uid(), companyId: co, date: todayISO(), start: '09:00',
                end: '17:00', label: 'Shift', flags: [], source: 'manual' };
  applyNames(row);
  pending.push(row);
  renderReview();
  $('#prog').classList.add('on');
};

$('#addco').onclick = () => {
  const palette = ['#2F4B7C','#B0631A','#2F6B4F','#7A3B69','#8A2E2E'];
  const co = {
    id: uid(), name: 'New job', color: palette[S.companies.length % palette.length],
    rate: null, weekStart: 0, otAfterHrs: null, breakMins: null, breakAfterHrs: null,
    pkg: '', icsMatch: '', patterns: []
  };
  S.companies.push(co);
  // Folded open, both levels (§28). Every other job defaults shut because a
  // job set up months ago is one he is not editing; this one is a form he
  // asked for a second ago, and handing him a shut fold called "New job"
  // would be handing him a puzzle.
  S.settings.open = S.settings.open || {};
  S.settings.open[co.id] = true;
  S.settings.open[co.id + '/pay'] = true;
  save(); renderAll();
};

$('#feedmode').onchange = e => { S.settings.feedMode = e.target.value; save(); renderSetup(); };
$('#leads').oninput = e => {
  S.settings.leads = e.target.value.split(',').map(x => parseFloat(x.trim()))
                      .filter(n => !isNaN(n) && n > 0);
  save();
};

function doExport(all){
  // Subscription mode: the file IS the calendar, so it must always hold
  // everything. ICSx5 replaces the calendar contents on each sync, which is
  // what makes duplicates impossible.
  if(S.settings.feedMode === 'subscribe'){
    if(!S.shifts.length){ alert('No shifts to export yet.'); return; }
    download('shifts.ics', buildICS(S.shifts), 'text/calendar;charset=utf-8');
    S.shifts.forEach(s => s.sent = true);
    S.settings.lastExport = new Date().toISOString();
    // The rebuild *is* the cancellation here: a deleted shift is simply not in
    // the file, so the subscription drops the event on the next sync. Nothing
    // is owed, and leaving the records to pile up would nag about work the
    // export just did (§22).
    S.tombstones = [];
    save(); renderAll();
    return;
  }
  const list = all ? S.shifts : S.shifts.filter(s => !s.sent);
  if(!list.length){
    alert(all ? 'No shifts to export yet.'
             : 'Every shift has already been sent to the calendar. Use the full export if you need to rebuild it.');
    return;
  }
  download(`shifts-${todayISO()}.ics`, buildICS(list), 'text/calendar;charset=utf-8');
  list.forEach(s => s.sent = true);
  S.settings.lastExport = new Date().toISOString();
  // renderAll rather than renderSetup: the warning this clears lives on
  // Schedule, and a warning that outlives the thing it warned about is the
  // stale amber §19.1 is the record of.
  save(); renderAll();
}
/* §10.6, built in §22. A separate file, and it has to be: METHOD is a property
   of the calendar, not the event, so cancellations cannot ride along inside a
   file that says PUBLISH. Two saves is the price of an unambiguous file, and
   it is only paid on the weeks something was actually deleted. */
function doCancelExport(){
  const dead = owedCancels();
  if(!dead.length){ alert('Nothing has been deleted since the last export.'); return; }
  download(`shifts-cancelled-${todayISO()}.ics`,
           buildCancelICS(dead), 'text/calendar;charset=utf-8');
  S.tombstones = [];
  save(); renderAll();
}

$('#exportics').onclick = () => doExport(false);
$('#cancelics').onclick = doCancelExport;
$('#exportall').onclick = () => {
  if(!confirm('Export every shift again? Only do this after clearing the shift calendar, or you will get duplicates.')) return;
  doExport(true);
};
$('#exportjson').onclick = () =>
  download(`shift-deck-${todayISO()}.json`, JSON.stringify(S, null, 2), 'application/json');
$('#importjson').onclick = () => $('#jsonpick').click();
$('#jsonpick').onchange = async () => {
  const f = $('#jsonpick').files[0];
  if(!f) return;
  try{
    const v = JSON.parse(await f.text());
    if(!v.companies || !v.shifts) throw new Error('not a backup');
    if(!confirm('Replace everything on this device with the backup?')) return;
    S = Object.assign(structuredClone(DEFAULTS), v);
    save(); renderAll();
  }catch(e){ alert('That file could not be read as a backup.'); }
  $('#jsonpick').value = '';
};
$('#wipeshifts').onclick = () => {
  if(!confirm('Delete every shift? Jobs and rates are kept.')) return;
  dropShifts(() => true); save(); renderAll();
};
$('#wipeall').onclick = async () => {
  if(!confirm('Delete jobs, shifts and settings? Everything on this device goes.')) return;
  if(!confirm('Last check — this cannot be undone. Save a backup first if you want one.')) return;
  pending = [];
  S = structuredClone(DEFAULTS);
  clearTimeout(saveTimer);
  try{ await idb.put(S); }catch(e){}
  renderAll(); renderReview();
  alert('Cleared. The app is back to a fresh install.');
};
$('#flushcache').onclick = async () => {
  try{
    if('caches' in window) await Promise.all((await caches.keys()).map(k => caches.delete(k)));
    const regs = await navigator.serviceWorker?.getRegistrations?.() || [];
    await Promise.all(regs.map(r => r.unregister()));
  }catch(e){}
  location.reload();
};

/* ---------- boot --------------------------------------------------------- */
(async function boot(){
  await loadState();
  renderAll();

  if(navigator.storage?.persist){
    const ok = await navigator.storage.persist().catch(()=>false);
    $('#storenote').textContent = ok
      ? 'Storage is marked as persistent on this device.'
      : 'Android may clear this app’s storage under pressure. Save a backup now and then.';
  }
  if('serviceWorker' in navigator)
    navigator.serviceWorker.register('sw.js').catch(()=>{});

  setInterval(renderNext, 60000);
  document.addEventListener('visibilitychange', () => { if(!document.hidden) renderNext(); });
})();
