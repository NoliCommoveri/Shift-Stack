/* ==========================================================================
   Shift Deck
   Everything lives on this device. Nothing is sent anywhere.
   ========================================================================== */

/* ---------- storage ------------------------------------------------------ */
const DEFAULTS = {
  companies: [],
  shifts: [],
  settings: { leads: [12, 2], feedMode: 'subscribe', icsUrl: '' }
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

/* ---------- review flags -------------------------------------------------
   parser.js emits codes; the wording lives here so changing it never breaks
   a test fixture. FLAG_MOVED is raised by the importer, not the parser.
   ---------------------------------------------------------------------- */
const FLAG_MOVED = 'moved';
const FLAG_CHANGED = 'changed';
const FLAG_HOLIDAY = 'holiday';
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
  [ICS_FLAG.NOEND]: 'The calendar gave no end time \u2014 set one below.',
  [ICS_FLAG.RECUR]: 'A repeating event \u2014 only the first was read.',
  [ICS_FLAG.ZONE]:  'The time zone was not recognised \u2014 times taken as written.',
  [ICS_FLAG.LONG]:  'This runs for more than a day, which no shift should.'
};

/* ---------- site name matching ------------------------------------------
   OCR spells the same site three different ways. Snap to one we already know.
   -------------------------------------------------------------------- */
const key = s => String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
function editDistance(a, b){
  if(Math.abs(a.length - b.length) > 4) return 99;
  const dp = Array.from({length:a.length+1}, (_,i) => [i, ...Array(b.length).fill(0)]);
  for(let j = 0; j <= b.length; j++) dp[0][j] = j;
  for(let i = 1; i <= a.length; i++)
    for(let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1] + (a[i-1]===b[j-1]?0:1));
  return dp[a.length][b.length];
}
function knownSites(companyId){
  return [...new Set(S.shifts.filter(s => s.companyId === companyId).map(s => s.label))];
}
function snapSite(raw, companyId){
  const k = key(raw);
  if(!k) return raw;
  let best = null, bestD = 99;
  for(const known of knownSites(companyId)){
    const kk = key(known);
    if(kk === k) return known;
    const d = editDistance(k, kk);
    const rel = d / Math.max(k.length, kk.length, 1);
    if(d < bestD && (d <= 3 || rel <= 0.18)){ bestD = d; best = known; }
  }
  return best || raw;
}

/* ---------- pay maths ---------------------------------------------------- */
function paidMins(sh, co){
  let m = durMins(sh);
  if(co && co.breakMins && co.breakAfterHrs && m >= co.breakAfterHrs*60) m -= co.breakMins;
  return Math.max(0, m);
}
function weeksFor(co){
  const map = new Map();
  S.shifts.filter(s => s.companyId === co.id).forEach(s => {
    const ws = weekStart(s.date, co.weekStart ?? 0);
    if(!map.has(ws)) map.set(ws, []);
    map.get(ws).push(s);
  });
  return [...map.entries()].sort((a,b) => b[0].localeCompare(a[0]));
}
function weekTotals(shifts, co){
  const m = shifts.reduce((a,s) => a + paidMins(s, co), 0);
  const hrs = m/60;
  const rate = +co.rate || 0;
  let base = hrs, ot = 0;
  if(co.otAfterHrs && hrs > co.otAfterHrs){ base = co.otAfterHrs; ot = hrs - co.otAfterHrs; }
  const gross = base*rate + ot*rate*(+co.otMult || 1.5);
  return { mins: m, hrs, base, ot, gross };
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
    <div class="sub">${esc(co ? co.name : 'Unassigned')} &middot; ${esc(n.s.label)} &middot; ${fmtDur(durMins(n.s))}</div>
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

function renderHorizon(){
  const wrap = $('#horizon');
  if(!wrap) return;
  wrap.innerHTML = '';
  const notes = horizonNotes();
  const bad = clashNotes();
  wrap.hidden = !(notes.length || bad.length);
  // Clashes first. A missing week is a job to do; a double booking is a shift
  // he is going to miss.
  bad.forEach(t => {
    const p = el('p','flag horizon clash');
    p.textContent = t;
    wrap.appendChild(p);
  });
  notes.forEach(n => {
    const p = el('p', 'flag horizon' + (n.fed ? ' fed' : ''));
    p.textContent = n.text;
    wrap.appendChild(p);
  });
}

function renderSchedule(){
  renderNext();
  renderHorizon();
  renderLaunchers();
  const box = $('#sched');
  box.innerHTML = '';

  const cutoff = shiftDays(todayISO(), -7);
  const list = S.shifts.filter(s => s.date >= cutoff)
                       .sort((a,b) => (a.date+a.start).localeCompare(b.date+b.start));
  if(!list.length){
    box.appendChild(el('p','empty','Nothing scheduled yet. Use the Add tab to bring shifts in.'));
    return;
  }

  // Worked out over every shift on file, not week by week and not day by day:
  // a clash does not respect either boundary.
  const clashes = new Map();
  clashPairs(S.shifts).forEach(({ a, b, mins: m }) => {
    const name = sh => {
      const co = coById(sh.companyId);
      return `${co ? co.name : 'a shift'} ${fmtTime(sh.start)}\u2013${fmtTime(sh.end)} on ${fmtDay(sh.date)}`;
    };
    // Both sides say what they run over. Two lines where the old check printed
    // one, and that is the right trade for the failure with no recovery.
    if(!clashes.has(a.id)) clashes.set(a.id, { other: name(b), mins: m });
    if(!clashes.has(b.id)) clashes.set(b.id, { other: name(a), mins: m });
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
      ds.forEach((s, idx) => {
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
            <div class="where">${esc(co ? co.name : 'Unassigned')} &middot; ${esc(s.label)}${
              isProposed(s) ? ' &middot; <span class="rota">from the rota</span>' : ''}</div>
          </div>
          <div class="len">${fmtDur(durMins(s))}</div>`;
        item.onclick = () => editShift(s.id);
        col.appendChild(item);

        // Only real overlap. A tight turnaround used to be flagged here too
        // and it was wrong for these two jobs — going straight from one to the
        // other is normal, so it fired constantly on nothing and taught him to
        // scroll past the line that also has to carry the case that matters.
        //
        // Not `ds[idx-1]` either: the collision worth catching is a Trupoint
        // night running into the next morning, and those two sit in different
        // day rows. `clashes` is worked out across the whole list.
        const hit = clashes.get(s.id);
        if(hit) col.appendChild(el('div','gapwarn',
          `Overlaps ${hit.other} by ${fmtDur(hit.mins)}. He cannot work both.`));
      });
      row.appendChild(col);
      box.appendChild(row);
    }
  }
}

/* -- pay tab -- */
function renderPay(){
  const box = $('#payout');
  box.innerHTML = '';
  if(!S.companies.length){
    box.appendChild(el('p','empty','Add a job in Setup first.'));
    return;
  }

  const allWeeks = new Map();

  S.companies.forEach(co => {
    const weeks = weeksFor(co).slice(0, 8);
    const card = el('div','card');
    card.appendChild(el('h2', null,
      `<span class="dot" style="background:${esc(co.color)}"></span>${esc(co.name)}`));
    if(!weeks.length){
      card.appendChild(el('p','tiny soft','No shifts yet.'));
      box.appendChild(card);
      return;
    }
    const t = el('table');
    t.innerHTML = `<tr><th>Week of</th><th class="n">Hours</th><th class="n">OT</th><th class="n">Gross</th></tr>`;
    weeks.forEach(([ws, shifts]) => {
      const w = weekTotals(shifts, co);
      const d = asDate(ws);
      // A week holding shifts nothing has confirmed says so, with the assumed
      // hours named separately (§20.4). The figure is not suppressed — a
      // forecast is useful — but a gross to the cent, checked against a
      // deposit weeks later when the screenshot is long gone, must not quietly
      // rest on a rota.
      const assumed = weekTotals(shifts.filter(isProposed), co);
      const tr = el('tr', assumed.hrs ? 'assumed' : null);
      tr.innerHTML = `<td>${MONTHNAMES[d.getMonth()].slice(0,3)} ${d.getDate()}${
          assumed.hrs ? `<span class="tiny soft"><br>${assumed.hrs.toFixed(2)} h from the rota, unconfirmed</span>` : ''}</td>
        <td class="n">${w.hrs.toFixed(2)}</td>
        <td class="n">${w.ot ? w.ot.toFixed(2) : '–'}</td>
        <td class="n">${co.rate ? '$' + w.gross.toFixed(2) : '–'}</td>`;
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
    [...allWeeks.entries()].sort((a,b) => b[0].localeCompare(a[0])).slice(0,8).forEach(([ws,v]) => {
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
        <input type="time" aria-label="Starts" value="${esc(pat.start||'')}">
        <span class="soft mono">to</span>
        <input type="time" aria-label="Ends" value="${esc(pat.end||'')}">
        <button class="kill" type="button" aria-label="Remove this shift">&times;</button>
      </div>
      <p class="patwhat"></p>`;

    const what = row.querySelector('.patwhat');
    const say = () => {
      what.textContent =
        (!pat.start || !pat.end) ? 'Set both times \u2014 an unfinished shift is ignored.'
        : (pat.days && pat.days.length)
          ? `Runs ${patternDays(pat)}, ${pat.start}\u2013${pat.end}. A week can be filled from this.`
          : `${pat.start}\u2013${pat.end}, any day. Checked against, never used to fill a week.`;
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
    st.oninput = () => { pat.start = st.value; say(); save(); };
    en.oninput = () => { pat.end = en.value; say(); save(); };
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

/* -- setup tab -- */
function renderSetup(){
  const box = $('#colist');
  box.innerHTML = '';
  if(!S.companies.length)
    box.appendChild(el('p','empty','No jobs yet. Add one to get started.'));

  S.companies.forEach(co => {
    const card = el('div','card');
    card.innerHTML = `
      <label class="f"><span>Name</span><input data-k="name" type="text" value="${esc(co.name)}"></label>
      <div class="grid2">
        <label class="f"><span>Colour</span><input data-k="color" type="color" value="${esc(co.color)}" style="height:2.4rem;padding:.15rem"></label>
        <label class="f"><span>Hourly rate</span><input data-k="rate" type="number" step="0.01" value="${co.rate ?? ''}"></label>
      </div>
      <div class="grid2">
        <label class="f"><span>Pay week starts</span>
          <select data-k="weekStart">${DAYNAMES.map((d,i) =>
            `<option value="${i}"${(co.weekStart??0)===i?' selected':''}>${d}</option>`).join('')}</select></label>
        <label class="f"><span>Overtime after (hrs/wk)</span><input data-k="otAfterHrs" type="number" step="0.5" value="${co.otAfterHrs ?? ''}"></label>
      </div>
      <div class="grid2">
        <label class="f"><span>Unpaid break (mins)</span><input data-k="breakMins" type="number" value="${co.breakMins ?? ''}"></label>
        <label class="f"><span>…on shifts over (hrs)</span><input data-k="breakAfterHrs" type="number" step="0.5" value="${co.breakAfterHrs ?? ''}"></label>
      </div>
      <label class="f"><span>Android app package, for the open button</span>
        <input data-k="pkg" type="text" placeholder="com.tracktik.shift" value="${esc(co.pkg||'')}"></label>
      <label class="f"><span>Calendar import: only events mentioning…</span>
        <input data-k="icsMatch" type="text" placeholder="Station" value="${esc(co.icsMatch||'')}"></label>
      <p class="tiny soft" style="margin:-.35rem 0 0">An employer's calendar sync writes into a
        whole Google account, so his own appointments arrive with the shifts. A word that appears
        on every shift and nothing else — a site name, the role — keeps them out. Leave it
        empty to take everything.</p>

      <label class="f"><span>Statutory holidays</span>
        <select data-k="holidays">
          <option value=""${!co.holidays ? ' selected' : ''}>Don’t check</option>
          ${holidayPlaces().map(h =>
            `<option value="${h.id}"${co.holidays===h.id?' selected':''}>${esc(h.name)}</option>`).join('')}
        </select></label>
      <p class="tiny soft" style="margin:-.35rem 0 0">Only used when a week is filled from
        the rota: a generated shift landing on a holiday is flagged so it can be removed
        before it is added. It never removes one by itself — the rota may well run that
        day, and a shift quietly dropped is a shift missed.</p>

      <h3 class="subhead">Shifts this job normally runs</h3>
      <p class="tiny soft" style="margin:0 0 .4rem">Times read off a screenshot are checked
        against these. One exactly twelve hours out is an am/pm misread and is corrected;
        one a few minutes out is tidied up; one an hour or two out is left alone and
        flagged, because the employer may have moved it.</p>
      <div class="patbox"></div>
      <div class="sugbox"></div>`;
    card.querySelectorAll('[data-k]').forEach(inp => {
      inp.oninput = () => {
        const k = inp.dataset.k;
        let v = inp.value;
        if(['rate','otAfterHrs','breakMins','breakAfterHrs','weekStart'].includes(k))
          v = v === '' ? null : +v;
        co[k] = v;
        save();
        if(k === 'name' || k === 'color'){ renderLaunchers(); }
      };
    });
    renderPatterns(co, card.querySelector('.patbox'), card.querySelector('.sugbox'));

    const btns = el('div','rowbtns');
    const del = el('button','ghost danger','Remove this job');
    del.onclick = () => {
      const n = S.shifts.filter(s => s.companyId === co.id).length;
      if(!confirm(`Remove ${co.name}? ${n} shift${n===1?'':'s'} will be deleted too.`)) return;
      S.shifts = S.shifts.filter(s => s.companyId !== co.id);
      S.companies = S.companies.filter(c => c.id !== co.id);
      save(); renderAll();
    };
    btns.appendChild(del);
    card.appendChild(btns);
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
}

function renderAll(){
  renderSchedule(); renderPay(); renderSetup(); fillCompanyPicker();
}

/* ---------- shift editing dialog ---------------------------------------- */
function editShift(id){
  const s = S.shifts.find(x => x.id === id);
  if(!s) return;
  const dlg = $('#dlg');
  $('#dlgbody').innerHTML = `
    <h2>Edit shift</h2>
    <label class="f"><span>Job</span><select id="e-co">${S.companies.map(c =>
      `<option value="${c.id}"${c.id===s.companyId?' selected':''}>${esc(c.name)}</option>`).join('')}</select></label>
    <label class="f"><span>Date</span><input id="e-date" type="date" value="${s.date}"></label>
    <div class="grid2">
      <label class="f"><span>Start</span><input id="e-start" type="time" value="${s.start}"></label>
      <label class="f"><span>End</span><input id="e-end" type="time" value="${s.end}"></label>
    </div>
    <label class="f"><span>Site or role</span><input id="e-label" type="text" value="${esc(s.label)}"></label>
    <label class="f"><span>Address, for the calendar</span>
      <input id="e-place" type="text" placeholder="401 Main St, Hattiesburg MS" value="${esc(s.place||'')}"></label>
    <div class="rowbtns">
      <button class="act" id="e-save">Save</button>
      <button class="ghost" id="e-cancel">Cancel</button>
      <button class="ghost danger" id="e-del" style="margin-left:auto">Delete</button>
    </div>`;
  dlg.showModal();
  $('#e-cancel').onclick = () => dlg.close();
  $('#e-save').onclick = () => {
    s.companyId = $('#e-co').value;
    s.date = $('#e-date').value;
    s.start = $('#e-start').value;
    s.end = $('#e-end').value;
    s.label = $('#e-label').value.trim() || 'Shift';
    s.place = $('#e-place').value.trim();
    // He has just been through this shift by hand, which is the strongest
    // confirmation there is. Leaving it as a proposal would keep drawing his
    // own numbers as an assumption and keep counting them as unconfirmed
    // (§20.8).
    if(isProposed(s)) s.source = 'manual';
    s.sent = false;              // changed, so send it to the calendar again
    save(); dlg.close(); renderAll();
  };
  $('#e-del').onclick = () => {
    S.shifts = S.shifts.filter(x => x.id !== id);
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
  // duplicate of nothing until it has been put right.
  pending.forEach(applyPatterns);
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

  const snapped = key(snapSite(p.label, p.companyId));
  if(sameSlot.some(s => key(s.label) === snapped)) return false;     // exact repeat
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

   `place` comes with it. It is what makes the two-hour alarm a tappable
   address (§14, §20.8) — a label without it is a downgrade from every other
   route into this app. */
function siteFor(co, start, end){
  // Confirmed records first, and only then the app's own earlier guesses. A
  // label copied from one generated week into the next would be an assumption
  // quietly acquiring a history, which is the shape §8.2 rejected outright when
  // it refused to learn times from the parser's own output.
  const rank = s => (isProposed(s) ? 1 : 0);
  const mine = S.shifts.filter(s => s.companyId === co.id)
    .sort((a, b) => rank(a) - rank(b) || (b.date + b.start).localeCompare(a.date + a.start));
  const same = mine.find(s => s.start === start && s.end === end) || mine[0];
  return { label: same ? same.label : 'Shift', place: same && same.place ? same.place : '' };
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
    const site = siteFor(co, r.start, r.end);
    const row = { rid: uid(), companyId: co.id, date: r.date, start: r.start, end: r.end,
                  label: site.label, flags: [], source: 'pattern' };
    if(site.place) row.place = site.place;

    applyHoliday(row);

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
         key(a.label) === key(b.label);
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

    // Matched on UID: this is a shift the feed has already given us once.
    const onFile = r.uid && S.shifts.find(s => s.extUid === r.uid && s.companyId === co.id);
    if(onFile){
      if(icsSame(onFile, row)){ unchanged++; continue; }
      row.flags = [...row.flags, FLAG_CHANGED];
      row.note = `Was ${fmtTime(onFile.start)}\u2013${fmtTime(onFile.end)} ${onFile.label}.`;
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
  return [...p.flags.map(f => FLAG_TEXT[f] || f), p.patNote || '', p.clashNote || '', p.note || '']
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

  pending.forEach(p => {
    // A removal is not an edit. It gets no fields — there is nothing to
    // correct, only a decision — and it says what would go.
    if(p.removeId){
      const row = el('div','rev flagged gone');
      row.innerHTML = `
        <div class="revf">
          <label class="tick"><input type="checkbox" checked> Remove</label>
          <span class="mono tiny">${esc(p.date)} ${esc(fmtTime(p.start))}\u2013${esc(fmtTime(p.end))}</span>
          <span class="tiny">${esc(p.label)}</span>
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
        <input type="time" value="${p.start}">
        <span class="soft mono">to</span>
        <input type="time" value="${p.end}">
        <input type="text" value="${esc(p.label)}">
        ${manyJobs ? `<select>${S.companies.map(c =>
          `<option value="${c.id}"${c.id===p.companyId?' selected':''}>${esc(c.name)}</option>`
        ).join('')}</select>` : ''}
        <button class="kill" aria-label="Remove">&times;</button>
      </div>
      <p class="flag"${p.flags.length ? '' : ' hidden'}>${esc(flagText(p))}</p>`;

    const [d,s,e,l] = row.querySelectorAll('input');
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
    s.oninput = () => { p.start = s.value; byHand(); refreshAll(); };
    e.oninput = () => {
      p.end = e.value;
      byHand();
      // Supplying the end answers the one-time warning and nothing else. The
      // am/pm warning is about a value that was read, not one that was absent,
      // so it survives being given the other half of the pair.
      if(p.end) p.flags = p.flags.filter(f => f !== FLAG.ONETIME);
      refreshAll();
    };
    l.oninput = () => { p.label = l.value; };
    const job = row.querySelector('select');
    if(job) job.onchange = () => { p.companyId = job.value; recheck(); };
    row.querySelector('.kill').onclick = () => {
      pending = pending.filter(x => x.rid !== p.rid);
      renderReview();
    };
    box.appendChild(row);
  });
}

/* ---------- calendar file ------------------------------------------------ */
function icsEscape(s){ return String(s).replace(/([,;\\])/g,'\\$1').replace(/\n/g,'\\n'); }
/* The spec folds at 75 octets, not 75 characters. Slicing by character wrote
   over-long lines for anything non-ASCII, which some calendar apps reject
   outright — live now that real addresses go in the file, since a Montréal
   site name is two bytes a letter in the accents. Splitting on code points
   keeps a character whole; counting their UTF-8 length keeps the line legal. */
function fold(l){
  const enc = new TextEncoder();
  if(enc.encode(l).length <= 74) return l;
  const out = [];
  let line = '', limit = 74;               // continuation lines carry a space
  for(const ch of l){
    const n = enc.encode(ch).length;
    if(enc.encode(line).length + n > limit){
      out.push(line);
      line = ' ' + ch;
      limit = 74;
    } else line += ch;
  }
  if(line) out.push(line);
  return out.join('\r\n');
}
function buildICS(only){
  const now = new Date().toISOString().replace(/[-:]/g,'').split('.')[0] + 'Z';
  const leads = (S.settings.leads || []).filter(n => n > 0);
  const L = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Shift Deck//EN','CALSCALE:GREGORIAN',
             'METHOD:PUBLISH','X-WR-CALNAME:Work Schedule'];
  only.forEach(s => {
    const co = coById(s.companyId);
    const endDate = mins(s.end) <= mins(s.start) ? shiftDays(s.date,1) : s.date;
    // The hollow tick is in the app; the alarm is on the phone, and the phone
    // is where §8.3's stated risk actually lands. The title carries the mark,
    // and the alarm body reuses the title, so a 05:00 buzz for a shift nothing
    // has confirmed says which kind it is (§20.5).
    const title = `${co ? co.name : 'Shift'}- ${s.label}` +
                  (isProposed(s) ? ' (from the rota)' : '');
    L.push('BEGIN:VEVENT',
      fold(`UID:${s.id}@shiftdeck`),
      `DTSTAMP:${now}`,
      `DTSTART:${s.date.replace(/-/g,'')}T${s.start.replace(':','')}00`,
      `DTEND:${endDate.replace(/-/g,'')}T${s.end.replace(':','')}00`,
      // Every event says which job it is. That is the whole point of the
      // normalising step: an employer's own sync writes "Security Officer"
      // with nothing to say whose shift it is, and two jobs' worth of those
      // on one calendar is unreadable.
      fold('SUMMARY:' + icsEscape(title)),
      fold('DESCRIPTION:' + icsEscape(`${fmtDur(durMins(s))} scheduled`)));
    // An address here is a tappable link to a map. The two-hour alarm fires,
    // he taps the event, taps the address, and he is navigating.
    if(s.place) L.push(fold('LOCATION:' + icsEscape(s.place)));
    leads.forEach(h => {
      L.push('BEGIN:VALARM','ACTION:DISPLAY',
        fold('DESCRIPTION:' + icsEscape(title)),
        `TRIGGER:-PT${h}H`, 'END:VALARM');
    });
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
    const before = S.shifts.length;
    S.shifts = S.shifts.filter(x => x.id !== p.removeId);
    if(S.shifts.length < before) removed++;
  });

  pending.filter(p => !p.removeId && p.date && p.start && p.end && p.companyId).forEach(p => {
    const rec = {
      id: uid(), companyId: p.companyId, date: p.date, start: p.start, end: p.end,
      label: snapSite(p.label, p.companyId), source: p.source || 'ocr'
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
        rec.id = S.shifts[i].id;
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
  pending.push({ rid: uid(), companyId: co, date: todayISO(), start: '09:00',
                 end: '17:00', label: 'Shift', flags: [], source: 'manual' });
  renderReview();
  $('#prog').classList.add('on');
};

$('#addco').onclick = () => {
  const palette = ['#2F4B7C','#B0631A','#2F6B4F','#7A3B69','#8A2E2E'];
  S.companies.push({
    id: uid(), name: 'New job', color: palette[S.companies.length % palette.length],
    rate: null, weekStart: 0, otAfterHrs: null, breakMins: null, breakAfterHrs: null,
    pkg: '', icsMatch: '', patterns: []
  });
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
    save(); renderSetup();
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
  save(); renderSetup();
}
$('#exportics').onclick = () => doExport(false);
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
  S.shifts = []; save(); renderAll();
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
