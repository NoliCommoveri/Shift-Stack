/* ==========================================================================
   Shift Deck, read only. PROJECT.md §45.

   A second phone that shows his week and what it pays, and can do nothing
   else. Two tabs — Schedule and Pay — and no Add, no Setup, no export, no
   teardown.

   What makes it read only is the Worker, not this file. `/read` is the only
   route a `VIEW_TOKEN` opens; `/push`, `/reset` and `/migrate` all refuse it.
   That distinction is the whole point of building this as a separate page
   rather than as a flag on `app.js`: a flag hides buttons, and a phone with a
   hidden button and a working push token is one `curl` away from writing to
   his schedule. Here there is no code that writes and no credential that
   could. If this file were replaced wholesale by something malicious, the
   worst it could do is read.

   It shares everything else. parser.js, ics.js, patterns.js, holidays.js,
   sites.js, pay.js and feed.js are the same files `app.js` loads, and the
   stylesheet is the same stylesheet — so a week drawn here is the week drawn
   there, and a gross here foots to the gross there because it is the same
   `weekPay`. What is not shared is `app.js` itself, which is 5,000 lines of
   editing, importing and exporting that this page has no use for.

   Naming: every identifier below is either unique to this file or one
   `app.js` also declares — never one of the modules'. Seven scripts share one
   global scope on this page, and §31 is the record of what a collision costs
   (two files declared `fold`, and every title in the exported calendar came
   out `[object Object]` for four sections).
   ========================================================================== */

/* ---------- the store ----------------------------------------------------
   `shiftdeck-view`, not `shiftdeck`. The viewer is served from the same origin
   as the app, so on a phone that has opened both they share an IndexedDB
   namespace, and a shared database name would have been two writers fighting
   over one `'state'` key — the app's whole store, overwritten by a cache of
   the server's answer, on the one device where that is unrecoverable.

   That case is not hypothetical the way it sounds: the phone it happens on is
   the one being used to test this. */
const VIEW_DB = 'shiftdeck-view';

const V = {
  companies: [], sites: [], roles: [], settings: {},
  shifts: [],
  at: null,          // the server's own timestamp on the answer we hold
  got: null,         // when this phone last succeeded, its own clock
  token: ''
};

const vIdb = {
  db: null,
  async open(){
    if(this.db) return this.db;
    this.db = await new Promise((res, rej) => {
      const r = indexedDB.open(VIEW_DB, 1);
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
      const t = db.transaction('doc', 'readwrite');
      t.objectStore('doc').put(JSON.parse(JSON.stringify(v)), 'state');
      t.oncomplete = res;
      t.onerror = () => rej(t.error);
    });
  }
};

/* The cache is what makes this usable rather than a website. An installed PWA
   is opened in a car park with one bar, and the answer to "when is he on
   tomorrow" has to be on screen before the network is asked anything. So the
   last good answer is drawn first and the fetch happens behind it. */
const vSave = () => vIdb.put({
  companies: V.companies, sites: V.sites, roles: V.roles, settings: V.settings,
  shifts: V.shifts, at: V.at, got: V.got, token: V.token
}).catch(() => {});

/* ---------- the token ----------------------------------------------------
   Three ways in, in order of how it actually gets onto a second phone.

   The hash is the one that gets used: the token is minted in the Cloudflare
   dashboard and has to travel from there to a phone that is not the one it
   was minted on, so it travels as a link. It is taken out of the address bar
   the moment it is read — an installed PWA launches at `start_url` and drops
   the hash anyway, so leaving it there would only mean a token sitting in the
   browser's history for the life of the phone.

   The field is the fallback for a token pasted rather than followed. */
function vTokenFromHash(){
  const m = /[#&]t=([^&]+)/.exec(location.hash || '');
  if(!m) return '';
  const t = decodeURIComponent(m[1]).trim();
  history.replaceState(null, '', location.pathname + location.search);
  return t;
}

/* ---------- talking to the Worker ----------------------------------------
   One route, one verb. There is no `post` in this file and nothing to add
   one for. */
async function vRead(){
  const r = await fetch('/read', {
    headers: { authorization: 'Bearer ' + V.token },
    cache: 'no-store'
  });
  if(r.status === 401) throw Object.assign(new Error('That token was refused.'), { auth: true });
  if(!r.ok) throw new Error(`The server answered ${r.status}.`);
  return r.json();
}

/* Fold an answer into the store. `needsSetup` is the state a Worker is in
   before its schema has been applied, and it is not an empty schedule: wiping
   the cached week because the database has not been set up yet would replace a
   correct answer with a blank one. */
function vTake(a){
  if(a.needsSetup) return false;
  if(a.cfg){
    V.companies = a.cfg.companies || [];
    V.sites     = a.cfg.sites || [];
    V.roles     = a.cfg.roles || [];
    V.settings  = a.cfg.settings || {};
  }
  V.shifts = a.shifts || [];
  V.at  = a.at || null;
  V.got = Date.now();
  return true;
}

let vPulling = false;
async function vPull(quiet){
  if(vPulling || !V.token) return;
  vPulling = true;
  if(!quiet) vAsOf('checking');
  try {
    const a = await vRead();
    vTake(a);
    await vSave();
    vShowApp();
    vDrawAll();
  } catch(e){
    if(e.auth){
      // The token stopped working — rotated, or mistyped in the first place.
      // The cached week stays on the phone: it was true when it arrived, and
      // throwing it away would turn a wrong password into a lost schedule.
      V.token = '';
      await vSave();
      vGate(e.message);
    } else {
      // Offline, or the Worker is down. Neither is a reason to change what is
      // on screen; the as-of line is the thing that has to notice.
      vDrawAsOf();
    }
  } finally {
    vPulling = false;
  }
}

/* ---------- helpers app.js also has --------------------------------------
   Declared here rather than shared because they live in `app.js`, which this
   page deliberately does not load. Each one is the app's, unchanged. */
const $ = s => document.querySelector(s);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if(cls) n.className = cls;
  if(html !== undefined) n.innerHTML = html;
  return n;
};
const esc = s => String(s ?? '').replace(/[&<>"]/g,
  c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));

const DAYNAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHNAMES = ['January','February','March','April','May','June','July',
                    'August','September','October','November','December'];

const todayISO = () => { const n = new Date(); return iso(n.getFullYear(), n.getMonth(), n.getDate()); };
const shiftDays = (s, n) => { const d = asDate(s); d.setDate(d.getDate() + n); return iso(d.getFullYear(), d.getMonth(), d.getDate()); };
const money = n => '$' + (+n).toFixed(2);
const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;

// 24-hour, for the reason app.js is: am/pm is the one character in this app
// that can be misread into a missed shift.
function fmtTime(t){
  const [h, m] = String(t).split(':').map(Number);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}
// `fmtDurWords` is when.js's (§49), because the app says the same sentence and
// the card on opening says it a third time.
function fmtDay(d){
  const x = asDate(d);
  return `${DAYNAMES[x.getDay()].slice(0,3)} ${x.getDate()} ${MONTHNAMES[x.getMonth()].slice(0,3)}`;
}
function weekStart(dateStr, startDow){
  const d = asDate(dateStr);
  const back = (d.getDay() - startDow + 7) % 7;
  return shiftDays(dateStr, -back);
}

const coById = id => V.companies.find(c => c.id === id);
const siteById = id => (V.sites || []).find(s => s.id === id);
const roleById = id => (V.roles || []).find(r => r.id === id);
const isProposed = s => !!s && s.source === 'pattern';
const isFromFeed = s => !!s && s.source === 'feed';
const shiftWhere = s => whereText(s, siteById(s.siteId), ' · ', roleById(s.roleId));
const shiftAddress = s => addressFor(s, siteById(s.siteId));

/* Paid minutes, then the week. Both are the app's line for line, and both go
   through `pay.js` — §27 put the arithmetic in a testable file precisely so
   that a second screen showing a gross could not quietly invent its own. */
const shiftPaidMins = (sh, co) => paidMins({ mins: durMins(sh) }, co);
function weeksFor(co){
  const map = new Map();
  V.shifts.filter(s => s.companyId === co.id).forEach(s => {
    const ws = weekStart(s.date, co.weekStart ?? 0);
    if(!map.has(ws)) map.set(ws, []);
    map.get(ws).push(s);
  });
  return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}
function weekTotals(shifts, co){
  return weekPay(shifts.map(s => {
    const role = roleById(s.roleId);
    return {
      mins: shiftPaidMins(s, co),
      rate: rateFor(s, role, co),
      key: role ? role.id : 'co',
      name: role ? role.name : (co.name || 'the job’s rate')
    };
  }), co);
}

/* ---------- the as-of line (§45) -----------------------------------------
   The one thing this screen has that the app does not need.

   On the app, a week with nothing in it is a week he has not imported, and
   every screen that could be wrong about that says so — the horizon note, the
   stale-export note, the Setup screen's poll log. None of those exist here,
   and none of them should: this phone is not the one that fixes anything.

   What is left is the single failure a read-only screen can have. It shows a
   week; the week is empty on Saturday; and the reason is not that he is off,
   it is that this phone last reached the Worker on Tuesday. Nothing else on
   the page can tell those apart, so this line has to, and it has to do it
   without being read — which means it changes colour rather than wording.

   The thresholds come off the cron. It polls every fifteen minutes, and the
   app pushes within seconds of an edit, so an hour behind is already unusual
   and half a day behind means something is broken rather than quiet. */
const STALE_MINS = 60, COLD_MINS = 12 * 60;

function vAgeMins(){
  if(!V.got) return null;
  return Math.max(0, Math.round((Date.now() - V.got) / 60000));
}
function vAgeWords(m){
  if(m < 1) return 'just now';
  if(m < 60) return `${plural(m, 'minute')} ago`;
  const h = Math.round(m / 60);
  if(h < 24) return `${plural(h, 'hour')} ago`;
  return `${plural(Math.round(h / 24), 'day')} ago`;
}

/* `state` is only ever 'checking' — the transient the refresh button shows.
   Every other state is a fact about `V.got` and is worked out here. */
function vAsOf(state){
  const age = vAgeMins();
  const boxes = [$('#asof'), $('#asofpay')].filter(Boolean);
  boxes.forEach(box => {
    box.className = 'asof';
    box.innerHTML = '';
    let text;
    if(state === 'checking') text = 'Checking…';
    else if(age === null) text = 'Not read from the server yet.';
    else {
      text = `As of ${vAgeWords(age)}.`;
      if(age >= COLD_MINS){
        box.classList.add('cold');
        // Said outright, because at this range the empty days on the screen
        // are more likely to be this than to be days off.
        text = `Last read ${vAgeWords(age)} — this may not be his week any more.`;
      } else if(age >= STALE_MINS){
        box.classList.add('stale');
      }
    }
    box.appendChild(el('span', null, esc(text)));
    const b = el('button', null, 'Refresh');
    b.onclick = () => vPull(false);
    box.appendChild(b);
  });
}
const vDrawAsOf = () => vAsOf();

/* ---------- the schedule -------------------------------------------------
   `renderNext` and `renderSchedule` from app.js, with the editing taken out:
   the launcher buttons go (they open the employer's apps, which are not on
   this phone and would not be his account if they were), the horizon notes go
   (they are jobs to do, and there is nothing to do here), and a shift opens a
   panel rather than an editor.

   What stays is every line that is about the shifts themselves — the overlap
   warning, the short turnaround, the back-to-back note — because those are
   facts about his week and the reason for looking at it on this phone at all.
   §29, §30 and §40 decided how they are drawn; nothing here re-decides it. */
function vDrawNext(){
  const wrap = $('#nextwrap');
  wrap.innerHTML = '';
  // Which shift, and both countdowns, are when.js's (§49). This screen and the
  // app's draw one banner and must not arrive at it separately.
  const n = whenNext(V.shifts);
  if(!n){
    wrap.appendChild(el('div', 'card soft',
      '<span class="tiny">No upcoming shifts on file.</span>'));
    return;
  }
  const co = coById(n.s.companyId);
  const d = asDate(n.s.date);
  // The door, at §46's forty-five minutes before the start — or, once he is in
  // the shift, when it lets him go. Empty more than a day out.
  const lead = whenLead(n);

  const box = el('div', 'next');
  box.innerHTML = `
    <div class="lbl">NEXT SHIFT</div>
    <div class="big">${DAYNAMES[d.getDay()]} ${d.getDate()} ${
      MONTHNAMES[d.getMonth()].slice(0,3)} &middot; ${esc(fmtTime(n.s.start))}</div>
    <div class="sub">${esc(co ? co.name : 'Unassigned')} &middot; ${
      esc(shiftWhere(n.s))} &middot; ${fmtDur(durMins(n.s))}</div>
    <div class="cd">${esc(whenCountdown(n))}</div>
    ${lead ? `<div class="cd lead">${esc(lead)}</div>` : ''}`;
  wrap.appendChild(box);
}

let vPastOpen = false;

function vDrawSchedule(){
  vDrawNext();
  vAsOf();
  const box = $('#sched');
  box.innerHTML = '';

  const cutoff = weekStart(todayISO(), 0);
  const all = V.shifts.slice().sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const list = vPastOpen ? all : all.filter(s => s.date >= cutoff);
  const behind = all.filter(s => s.date < cutoff).length;

  if(!list.length && !behind){
    // Not "use the Add tab": there is no Add tab, and the thing to do about an
    // empty schedule is on the other phone.
    box.appendChild(el('p', 'empty', 'Nothing on file yet.'));
    return;
  }
  if(behind){
    const b = el('button', 'more', vPastOpen
      ? 'Hide earlier shifts'
      : `Show ${plural(behind, 'earlier shift')}`);
    b.onclick = () => { vPastOpen = !vPastOpen; vDrawSchedule(); };
    box.appendChild(b);
  }
  if(!list.length){
    box.appendChild(el('p', 'empty', 'Nothing from this week on.'));
    return;
  }

  // One sweep over every shift on file, split by band — the app's §40 line for
  // line, and for its reason: both notes are the same fact about the same
  // join, so asking twice would be two chances to disagree about one number.
  const rests = new Map(), straight = new Map();
  restGaps(V.shifts).forEach(({ b, mins: m }) => {
    if(isShortRest(m)) rests.set(b.id, m);
    else if(isBackToBack(m)) straight.set(b.id, m);
  });
  const clashes = new Set();
  clashPairs(V.shifts).forEach(({ a, b }) => {
    clashes.add((a.date + a.start) <= (b.date + b.start) ? b.id : a.id);
  });

  const byWeek = new Map();
  list.forEach(s => {
    const ws = weekStart(s.date, 0);
    if(!byWeek.has(ws)) byWeek.set(ws, []);
    byWeek.get(ws).push(s);
  });

  for(const [ws, shifts] of byWeek){
    const wsD = asDate(ws), weD = asDate(shiftDays(ws, 6));
    const total = shifts.reduce((a, s) => a + durMins(s), 0);
    const head = el('div', 'weekhead');
    head.innerHTML = `<h2>${MONTHNAMES[wsD.getMonth()].slice(0,3)} ${wsD.getDate()} – ${
      MONTHNAMES[weD.getMonth()].slice(0,3)} ${weD.getDate()}</h2>
      <span class="tiny soft mono">${fmtDur(total)}</span>`;
    box.appendChild(head);

    const byDay = new Map();
    shifts.forEach(s => { if(!byDay.has(s.date)) byDay.set(s.date, []); byDay.get(s.date).push(s); });

    for(const [date, ds] of byDay){
      const d = asDate(date);
      const row = el('div', 'day' + (date === todayISO() ? ' today' : ''));
      row.appendChild(el('div', 'daynum',
        `<b>${d.getDate()}</b><span>${DAYNAMES[d.getDay()].toUpperCase()}</span>`));
      const col = el('div');
      ds.forEach(s => {
        const co = coById(s.companyId);
        const item = el('div', 'shift');
        const dot = isProposed(s)
          ? `background:transparent;box-shadow:inset 0 0 0 1px ${esc(co?.color || '#C6CAC1')}`
          : `background:${esc(co?.color || '#C6CAC1')}`;
        item.innerHTML = `
          <i class="tick" style="${dot}"></i>
          <div>
            <div class="when">${esc(fmtTime(s.start))} – ${esc(fmtTime(s.end))}</div>
            <div class="where">${esc(co ? co.name : 'Unassigned')} &middot; ${esc(shiftWhere(s))}${
              isProposed(s) ? ' &middot; <span class="rota">from the rota</span>' : ''}${
              isFromFeed(s) ? ' &middot; <span class="fromfeed">from the calendar</span>' : ''}</div>
          </div>
          <div class="len">${fmtDur(durMins(s))}</div>`;
        item.onclick = () => vShowShift(s);

        if(clashes.has(s.id)) col.appendChild(el('div', 'gapwarn',
          'Warning — shifts overlap. Verify schedule in employer apps and adjust.'));
        const rst = rests.get(s.id);
        if(rst) col.appendChild(el('div', 'restline',
          `Heads up — short turnaround (${fmtDurWords(rst)} off)`));
        const b2b = straight.get(s.id);
        if(b2b !== undefined) col.appendChild(el('div', 'b2bline',
          `Back to back — ${b2b ? `${fmtDurWords(b2b)} between shifts` : 'no gap between shifts'}`));

        col.appendChild(item);
      });
      row.appendChild(col);
      box.appendChild(row);
    }
  }
}

/* The shift panel. `showFeedShift` in app.js, generalised: there it is what a
   feed row gets instead of the editor, and here every row gets it, because
   here every row is somebody else's. */
function vShowShift(s){
  const co = coById(s.companyId), where = shiftAddress(s);
  const dlg = $('#dlg');
  const from = isFromFeed(s) ? 'From this job’s own calendar, fetched every fifteen minutes.'
    : isProposed(s) ? 'From the rota. Nothing has confirmed this one yet.'
    : 'Entered on his phone.';
  $('#dlgbody').innerHTML = `
    <h2><span class="dot" style="background:${esc(co?.color || '#C6CAC1')}"></span>${
      esc(co ? co.name : 'Unassigned')}</h2>
    <p class="tiny soft" style="margin:-.5rem 0 .7rem">${esc(from)}</p>
    <div class="facts">
      <div><span>Date</span><b>${esc(fmtDay(s.date))}</b></div>
      <div><span>Time</span><b class="mono">${esc(fmtTime(s.start))}–${esc(fmtTime(s.end))}
        · ${esc(fmtDur(durMins(s)))}</b></div>
      <div><span>Where</span><b>${esc(shiftWhere(s))}</b></div>
      ${where ? `<div><span>Address</span><b>${esc(where)}</b></div>` : ''}
    </div>
    <div class="rowbtns"><button class="act" id="v-close">Close</button></div>`;
  dlg.showModal();
  $('#v-close').onclick = () => dlg.close();
}

/* ---------- pay ----------------------------------------------------------
   `renderPay` and `payDetail` from app.js, unchanged apart from reading `V`.
   The figures are not recomputed differently here and must not be: a gross on
   this phone that disagreed with the gross on his by a cent would be worse
   than no pay tab, because the disagreement is what would get believed. */
const PAY_BACK_WEEKS = 3, PAY_FWD_WEEKS = 1;

function payWhen(ws){
  const days = Math.round((asDate(todayISO()) - asDate(ws)) / 86400000);
  if(days < -7 * PAY_FWD_WEEKS) return 'ahead';
  return days < 7 * (PAY_BACK_WEEKS + 1) ? 'now' : 'earlier';
}

let vPayOpen = false;

function vPayDetail(co, ws, shifts){
  const w = weekTotals(shifts, co);
  const d = asDate(ws);
  const mult = Number.isFinite(+co.otMult) && +co.otMult > 0 ? +co.otMult : OT_MULT;
  const hrs = n => n.toFixed(2);
  const assumed = weekTotals(shifts.filter(isProposed), co);

  const hourRows = w.byRate.map(r => `<tr>
      <td>${esc(r.name)}${r.rate == null
        ? '<span class="tiny soft"><br>no rate set</span>' : ''}</td>
      <td class="n">${hrs(r.hrs)}</td>
      <td class="n">${r.rate == null ? '–' : money(r.rate)}</td>
    </tr>`).join('');
  const avgRow = w.mixed ? `<tr class="tot"><td>Average</td>
      <td class="n">${hrs(w.hrs)}</td><td class="n">${money(w.rate)}</td></tr>` : '';

  const straight = w.byRate.reduce((a, r) => a + r.pay, 0);
  let payRows;
  if(!w.rated){
    payRows = `<tr><td>No rate set anywhere</td><td class="n">${hrs(w.hrs)}</td>
      <td class="n">–</td><td class="n">–</td></tr>`;
  } else if(!w.unratedHrs){
    const avg = w.mixed ? '<span class="tiny soft"> avg</span>' : '';
    const base = w.hrs - w.ot;
    payRows = `<tr><td>Regular</td><td class="n">${hrs(base)}</td>
        <td class="n">${money(w.rate)}${avg}</td><td class="n">${money(base * w.rate)}</td></tr>`
      + (w.ot > 0.005 ? `<tr><td>Overtime</td><td class="n">${hrs(w.ot)}</td>
        <td class="n">${money(w.rate * mult)}${avg}</td>
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
  if(w.rated && w.ot <= 0.005)
    notes.push(+co.otAfterHrs > 0
      ? `No overtime — the week did not reach the ${+co.otAfterHrs} h this job counts from.`
      : 'No overtime, because this job has no threshold set.');
  if(w.mixed && w.ot > 0.005)
    notes.push(`Overtime is ${mult}× the ${money(w.rate)} weighted average of the hours above, ` +
      `not ${mult}× whichever rate the last shift of the week happened to be paid at. That is ` +
      'what an employer paying two rates in one week has to do, and it means the answer does ' +
      'not move when a shift moves. The average is carried at full precision, so multiplying ' +
      'the rounded figure by the hours can land a cent or two out.');
  if(assumed.hrs)
    notes.push(`${hrs(assumed.hrs)} h of this came from the rota and nothing has confirmed it.`);
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
    <div class="rowbtns"><button class="ghost" id="v-pdclose">Close</button></div>`;
  const dlg = $('#dlg');
  dlg.showModal();
  $('#v-pdclose').onclick = () => dlg.close();
}

function vDrawPay(){
  vAsOf();
  const box = $('#payout');
  box.innerHTML = '';
  if(!V.companies.length){
    box.appendChild(el('p', 'empty', 'No jobs on file.'));
    return;
  }

  const allWeeks = new Map();
  let behind = false;

  V.companies.forEach(co => {
    const weeks = weeksFor(co).filter(([ws]) => payWhen(ws) !== 'ahead');
    if(weeks.some(([ws]) => payWhen(ws) === 'earlier')) behind = true;
    const shown = vPayOpen ? weeks : weeks.filter(([ws]) => payWhen(ws) === 'now');
    const card = el('div', 'card');
    card.appendChild(el('h2', null,
      `<span class="dot" style="background:${esc(co.color)}"></span>${esc(co.name)}`));
    if(!shown.length){
      card.appendChild(el('p', 'tiny soft',
        weeks.length ? 'Nothing in the last four weeks.' : 'No shifts yet.'));
      box.appendChild(card);
      return;
    }
    const t = el('table');
    t.innerHTML = `<tr><th>Week of</th><th class="n">Hours</th><th class="n">OT</th><th class="n">Gross</th></tr>`;
    shown.forEach(([ws, shifts]) => {
      const w = weekTotals(shifts, co);
      const d = asDate(ws);
      const assumed = weekTotals(shifts.filter(isProposed), co);
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
      const b = el('button', 'brk', 'Breakdown');
      b.onclick = () => vPayDetail(co, ws, shifts);
      const cell = tr.querySelector('td');
      cell.appendChild(document.createElement('br'));
      cell.appendChild(b);
      t.appendChild(tr);

      const cur = allWeeks.get(ws) || { hrs: 0, gross: 0 };
      cur.hrs += w.hrs; cur.gross += w.gross;
      allWeeks.set(ws, cur);
    });
    card.appendChild(t);
    box.appendChild(card);
  });

  if(V.companies.length > 1 && allWeeks.size){
    const card = el('div', 'card');
    card.appendChild(el('h2', null, 'Both jobs together'));
    const t = el('table');
    t.innerHTML = `<tr><th>Week of</th><th class="n">Hours</th><th class="n">Gross</th></tr>`;
    [...allWeeks.entries()].sort((a, b) => b[0].localeCompare(a[0])).forEach(([ws, v]) => {
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

  if(behind){
    const b = el('button', 'more', vPayOpen ? 'Hide earlier weeks' : 'Show earlier weeks');
    b.onclick = () => { vPayOpen = !vPayOpen; vDrawPay(); };
    box.appendChild(b);
  }
}

const vDrawAll = () => { vDrawSchedule(); vDrawPay(); };

/* ---------- the two screens ---------------------------------------------- */
function vGate(err){
  $('#tab-gate').hidden = false;
  $('#tab-schedule').hidden = true;
  $('#tab-pay').hidden = true;
  $('#nav').hidden = true;
  const e = $('#gateerr');
  e.hidden = !err;
  e.textContent = err || '';
}
function vShowApp(){
  $('#tab-gate').hidden = true;
  $('#nav').hidden = false;
  vTab(vCurrent);
}

let vCurrent = 'schedule';
function vTab(name){
  vCurrent = name;
  $('#tab-schedule').hidden = name !== 'schedule';
  $('#tab-pay').hidden = name !== 'pay';
  document.querySelectorAll('#nav button').forEach(b =>
    b.setAttribute('aria-current', String(b.dataset.tab === name)));
}
document.querySelectorAll('#nav button').forEach(b => {
  b.onclick = () => vTab(b.dataset.tab);
});

$('#unlock').onclick = async () => {
  const t = $('#tok').value.trim();
  if(!t){ vGate('Paste the token first.'); return; }
  V.token = t;
  $('#tok').value = '';
  $('#gateerr').hidden = true;
  await vPull(false);
};
$('#tok').onkeydown = e => { if(e.key === 'Enter') $('#unlock').click(); };

/* ---------- boot ---------------------------------------------------------
   Cache first, network behind it, which is the same shape the service worker
   serves the shell with and for the same reason: the answer to "when is he on
   tomorrow" has to be on screen before anything is asked of the network. */
(async function boot(){
  let saved = null;
  try { saved = await vIdb.get(); } catch(e){ /* first run, or storage blocked */ }
  if(saved){
    V.companies = saved.companies || [];
    V.sites = saved.sites || [];
    V.roles = saved.roles || [];
    V.settings = saved.settings || {};
    V.shifts = saved.shifts || [];
    V.at = saved.at || null;
    V.got = saved.got || null;
    V.token = saved.token || '';
  }

  const fromLink = vTokenFromHash();
  if(fromLink){ V.token = fromLink; await vSave(); }

  if(!V.token){ vGate(); }
  else { vShowApp(); vDrawAll(); }

  if(V.token) vPull(true);

  // Coming back to the app is the moment the week is being looked at, so it is
  // the moment worth spending a request on. There is no timer: a phone in a
  // pocket polling a Worker every minute is a battery cost for an answer
  // nobody is reading.
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'visible' && V.token) vPull(true);
  });

  /* The card on opening (§49). An installed PWA switched away from is not
     closed — the page stays loaded and coming back fires no `load` — so
     `whenWake` binds the two events that do fire, and returns the same call
     for this opening. Nothing is shown behind the door: a phone with no token
     yet has no shifts to count down to, and `whenNext` would say so anyway.
     The ten-minute floor lives in `whenPrompt`, keyed per page. */
  const vOpenCard = whenWake(() => (V.token ? V.shifts : []), {
    key: 'view',
    describe: s => {
      const co = coById(s.companyId);
      return `${co ? co.name : 'Unassigned'} \u00b7 ${shiftWhere(s)} \u00b7 ${fmtDur(durMins(s))}`;
    }
  });
  vOpenCard();

  // A shift that starts while the app is open must not leave the banner saying
  // "Leave in 3 min" for an hour. The app has had this minute timer since it
  // was built; the viewer had no reason for one until there was a countdown on
  // the screen that changes what he does.
  setInterval(vDrawNext, 60000);

  /* The viewer's own service worker, at its own scope (§45). `/view-sw.js`
     sits at the root — a script can only claim a scope at or below its own
     directory, and `/view` is not below `/view/` — and is registered for
     `/view` alone. The app's worker keeps `/`, this one takes `/view*`, the
     more specific registration wins for these pages, and both PWAs can be
     installed on one phone without either quietly taking the other's fetches.
     That matters on exactly one device: the one this was tested on. */
  if('serviceWorker' in navigator)
    navigator.serviceWorker.register('/view-sw.js', { scope: '/view' }).catch(() => {});
})();
