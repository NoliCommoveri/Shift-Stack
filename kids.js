/* ==========================================================================
   Shift Deck, for the kids. PROJECT.md §46.

   A third phone, and a third of a page. It answers one question — when does
   Daddy leave, and when is he home — over a rolling seven days that start
   today, and it can answer nothing else, because nothing else is sent to it.

   What makes that true is `/soon` and `KIDS_TOKEN`, not this file. §45 built
   the read-only viewer and said it out loud: a phone holding a token and a
   `curl` are the same thing to a Worker, so a restriction that lives in a
   page is not a restriction. The viewer holds `VIEW_TOKEN`, and `VIEW_TOKEN`
   opens `/read`, which answers with every shift on file and every company
   with its rate, its overtime multiplier and its threshold on it. A kids'
   build of the viewer with the Pay tab deleted would still be one phone and
   one address bar away from all of it.

   So this page holds `KIDS_TOKEN`, which opens `/soon` and nothing else, and
   `/soon` answers with four fields a shift — the day, the two times, the
   job's name and its colour — inside one week. There is no rate on this phone
   to hide. `pay.js` is not even loaded.

   It shares the palette with the app and the viewer and shares nothing else,
   deliberately: this is a different screen, not a narrower one. The app draws
   a schedule for the man working it; this draws a doorway for the people
   waiting on the other side of it.
   ========================================================================== */

/* ---------- the two paddings (§46.2) -------------------------------------
   The employer's times are when he clocks on and off. The times a child is
   asking about are when the front door opens, and they are not the same
   number: there is a drive at each end.

   Hard-coded, as asked, and named here rather than spelled into the sentences
   below so that changing them is one edit in one place. `45` is the drive out
   plus getting in and parked; `30` is the drive home. Anything cleverer — a
   per-job commute, a field on the site table — is a thing to get wrong for a
   page whose whole value is that it is never wrong by more than a few
   minutes. */
const LEAVE_PAD = 45;   // minutes before a shift starts, he is out of the door
const HOME_PAD  = 30;   // minutes after it ends, he is back through it

/* Who the sentences are about. One word, in one place, for the same reason. */
const WHO = 'Daddy';

/* ---------- the store ----------------------------------------------------
   `shiftdeck-kids`, its own. Three pages on one origin now, and the app's
   store and the viewer's are both a single 'state' key in a database named
   after themselves — a shared name is two writers over one key, which is a
   whole schedule overwritten by a cache of a week of times. */
const KIDS_DB = 'shiftdeck-kids';

const K = {
  shifts: [],        // the week, exactly as `/soon` sent it
  today: null,       // his today, worked out on his zone by the Worker
  got: null,         // when this phone last succeeded, its own clock
  token: ''
};

const kIdb = {
  db: null,
  async open(){
    if(this.db) return this.db;
    this.db = await new Promise((res, rej) => {
      const r = indexedDB.open(KIDS_DB, 1);
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

const kSave = () => kIdb.put({
  shifts: K.shifts, today: K.today, got: K.got, token: K.token
}).catch(() => {});

/* ---------- the token ----------------------------------------------------
   The viewer's, unchanged (§45.8): it arrives as `/kids#t=THETOKEN`, is read
   once, and is taken straight back out of the address bar. On this phone that
   matters slightly more than on the last one — it is a phone that gets handed
   around a back seat — and the hash is the half of the link that survives
   being screenshotted. */
function kTokenFromHash(){
  const m = /[#&]t=([^&]+)/.exec(location.hash || '');
  if(!m) return '';
  const t = decodeURIComponent(m[1]).trim();
  history.replaceState(null, '', location.pathname + location.search);
  return t;
}

/* ---------- talking to the Worker ----------------------------------------
   One route, one verb, and it is not the viewer's route. There is no `/read`
   in this file and no `POST` anywhere in it. */
async function kSoon(){
  const r = await fetch('/soon', {
    headers: { authorization: 'Bearer ' + K.token },
    cache: 'no-store'
  });
  if(r.status === 401) throw Object.assign(new Error('That code did not work.'), { auth: true });
  if(!r.ok) throw new Error(`The server answered ${r.status}.`);
  return r.json();
}

let kPulling = false;
async function kPull(quiet){
  if(kPulling || !K.token) return;
  kPulling = true;
  try {
    const a = await kSoon();
    // `needsSetup` is a database with no tables yet, which is not an empty
    // week: replacing a correct week with a blank one because the schema has
    // not been applied would be the page lying rather than failing.
    if(!a.needsSetup){
      K.shifts = a.shifts || [];
      K.today = a.today || null;
      K.got = Date.now();
      await kSave();
    }
    kShowWeek();
    kDraw();
  } catch(e){
    if(e.auth){
      // The code stopped working. The week stays on the phone — it was true
      // when it arrived, and a wrong password should not also be a lost
      // answer — but there is nothing to do here except ask for a new one.
      K.token = '';
      await kSave();
      kGate(e.message);
    } else {
      kDrawAsOf();     // offline, or the Worker is down; the line notices
    }
  } finally {
    kPulling = false;
  }
}

/* ---------- small helpers ------------------------------------------------
   This page loads none of the shared modules, so the four lines of date
   arithmetic it needs are here. They are four lines; importing `parser.js`
   and `feed.js` to get them would put a hundred kilobytes of OCR and calendar
   writing on a phone that shows a countdown. */
const $ = s => document.querySelector(s);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if(cls) n.className = cls;
  if(html !== undefined) n.innerHTML = html;
  return n;
};
const esc = s => String(s ?? '').replace(/[&<>"]/g,
  c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));

const DAYNAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTHNAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/* Midday, so that a date read back as a Date cannot cross a day boundary on a
   daylight-saving Sunday. The app does the same, for the same reason. */
const asDay = s => new Date(s + 'T12:00:00');
const isoOf = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${
                     String(d.getDate()).padStart(2,'0')}`;
const addDays = (s, n) => { const d = asDay(s); d.setDate(d.getDate() + n); return isoOf(d); };
const hhmm = d => `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;

/* The two moments this page is about, as real times on this phone's clock.

   `end` before `start` is an overnight shift — the app's own rule, and the
   one place this file has to know it: a shift that ends at 07:00 having
   started at 19:00 gets home the following morning, and a page that added
   thirty minutes to 07:00 on the wrong day would tell a child their father
   was home twelve hours before he was. */
function doorTimes(s){
  const start = new Date(`${s.date}T${s.start}:00`);
  const end = new Date(`${s.date}T${s.end}:00`);
  if(end <= start) end.setDate(end.getDate() + 1);
  return {
    leave: new Date(start.getTime() - LEAVE_PAD * 60000),
    home:  new Date(end.getTime() + HOME_PAD * 60000)
  };
}

/* How long, said the way it gets said out loud. Precise under three hours,
   because that is the range in which the difference between "two hours" and
   "two and a half" is the difference between going out to play and not; and
   rounded above it, because "in about nine hours" is the true answer to a
   question asked at bedtime and "in 8 hours and 47 minutes" is a false
   precision about a man who has to drive home. */
function kHowLong(mins){
  if(mins <= 0) return 'any minute now';
  if(mins < 60) return `in ${mins} minute${mins === 1 ? '' : 's'}`;
  if(mins < 180){
    const h = Math.floor(mins / 60), m = mins % 60;
    const hs = `${h} hour${h === 1 ? '' : 's'}`;
    return m ? `in ${hs} ${m} min` : `in ${hs}`;
  }
  if(mins < 1440) return `in about ${Math.round(mins / 60)} hours`;
  const d = Math.round(mins / 1440);
  return `in ${d} day${d === 1 ? '' : 's'}`;
}

/* "at 05:15", "at 05:15 tomorrow", "at 05:15 on Thursday". The clock time is
   the part that gets remembered, so it leads. */
function kAtWhen(when){
  const today = K.today || isoOf(new Date());
  const day = isoOf(when);
  let tail = '';
  if(day === addDays(today, 1)) tail = ' tomorrow';
  else if(day !== today) tail = ` on ${DAYNAMES[when.getDay()]}`;
  return `at ${hhmm(when)}${tail}`;
}

/* ---------- the banner ---------------------------------------------------
   The sentence. Four states, in the order the day runs through them:

     he is here, and the next going-out is a countdown to it
     he has left, or is about to, and the countdown is now to coming back
     he is at work, which is the same countdown
     there is nothing in the week at all

   Note what is not a state: "his shift starts in ten minutes". The shift is
   the employer's fact. From this side of the front door the only two events
   are the door opening outward and the door opening inward, and the whole
   page is built on that being the honest framing rather than a simplified
   one. */
function kBannerState(now = new Date()){
  const withTimes = K.shifts.map(s => ({ s, ...doorTimes(s) }))
                            .sort((a, b) => a.leave - b.leave);

  // Out of the house: between leaving and getting back, for any shift. Not
  // "the next one" — a double shift files as two rows and the gap between
  // them can be shorter than the two paddings, in which case he never came
  // home and the page must not say he did.
  const out = withTimes.find(x => now >= x.leave && now < x.home);
  if(out) return { out: true, when: out.home, shift: out.s };

  const next = withTimes.find(x => x.leave > now);
  if(next) return { out: false, when: next.leave, shift: next.s };

  return { out: false, when: null, shift: null };
}

function kDrawBanner(){
  const box = $('#banner');
  const st = kBannerState();
  box.className = 'banner' + (st.out ? ' out' : ' home');

  if(!st.when){
    box.innerHTML = `
      <div class="lbl">${esc(WHO)} is home</div>
      <div class="big">No work this week</div>
      <div class="sub">Nothing on the calendar for the next seven days.</div>`;
    return;
  }

  const mins = Math.round((st.when - new Date()) / 60000);
  box.innerHTML = `
    <div class="lbl">${esc(WHO)} ${st.out ? 'home from work' : 'leaves for work'}</div>
    <div class="big">${esc(kHowLong(mins))}</div>
    <div class="sub">${esc(kAtWhen(st.when))}</div>`;
}

/* ---------- the week -----------------------------------------------------
   Seven rows, always, including the empty ones. A list of only the working
   days would be shorter and would answer the wrong question: "is he home on
   Saturday" is answered by a row that says Saturday and says he is, not by
   the absence of one. */
function kDrawWeek(){
  const box = $('#week');
  box.innerHTML = '';
  const today = K.today || isoOf(new Date());

  const byDay = new Map();
  K.shifts.forEach(s => {
    if(!byDay.has(s.date)) byDay.set(s.date, []);
    byDay.get(s.date).push(s);
  });

  for(let i = 0; i < 7; i++){
    const date = addDays(today, i);
    const d = asDay(date);
    const row = el('div', 'day' + (i === 0 ? ' today' : ''));
    row.appendChild(el('div', 'dn',
      `<b>${i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : DAYNAMES[d.getDay()]}</b>
       <span>${MONTHNAMES[d.getMonth()]} ${d.getDate()}</span>`));

    const what = el('div', 'what');
    const shifts = (byDay.get(date) || []).slice()
      .sort((a, b) => a.start.localeCompare(b.start));

    if(!shifts.length){
      what.appendChild(el('div', 'off', `${WHO} is home all day`));
    } else {
      shifts.forEach(s => {
        const { leave, home } = doorTimes(s);
        // The home time can land on the next morning, and on a row headed
        // with today's date that would read as this morning. Said, when it is.
        const over = isoOf(home) !== date ? ' <span class="tag">next morning</span>' : '';
        // Grouped, because a day with two shifts on it is two departures and
        // two arrivals, and four times in a flat list is a puzzle rather than
        // an answer.
        const trip = el('div', 'trip');
        trip.appendChild(el('div', 'go',
          `<span class="tag">Leaves</span> <b>${esc(hhmm(leave))}</b>`));
        trip.appendChild(el('div', 'go',
          `<span class="tag">Home</span> <b>${esc(hhmm(home))}</b>${over}`));
        if(s.job) trip.appendChild(el('div', 'job',
          `<i style="background:${esc(s.color || '#C6CAC1')}"></i>${esc(s.job)}`));
        what.appendChild(trip);
      });
    }
    row.appendChild(what);
    box.appendChild(row);
  }
}

/* ---------- the quiet line -----------------------------------------------
   §45's as-of line, with the wording changed for who is reading it and the
   middle state dropped. The viewer distinguishes fresh from stale from cold
   because the person holding it can go and do something about stale. A child
   cannot, so there are two states here: fine, and old enough that the empty
   days on the screen are more likely to be this than to be days off.

   The threshold is the viewer's twelve hours, off the same cron. */
const KIDS_COLD_MINS = 12 * 60;

function kDrawAsOf(){
  const box = $('#asof');
  box.className = 'asof';
  box.innerHTML = '';
  if(K.got === null){
    box.appendChild(el('span', null, 'Waiting to hear from the schedule&hellip;'));
  } else {
    const age = Math.max(0, Math.round((Date.now() - K.got) / 60000));
    if(age >= KIDS_COLD_MINS){
      box.classList.add('cold');
      box.appendChild(el('span', null,
        'This has not heard from the schedule in a while, so it may be wrong. ' +
        'Ask a grown-up.'));
    }
  }
  const b = el('button', null, 'Check again');
  b.onclick = () => kPull(false);
  box.appendChild(b);
}

const kDraw = () => { kDrawBanner(); kDrawWeek(); kDrawAsOf(); };

/* ---------- the two screens ---------------------------------------------- */
function kGate(err){
  $('#tab-gate').hidden = false;
  $('#tab-week').hidden = true;
  const e = $('#gateerr');
  e.hidden = !err;
  e.textContent = err || '';
}
function kShowWeek(){
  $('#tab-gate').hidden = true;
  $('#tab-week').hidden = false;
}

$('#unlock').onclick = async () => {
  const t = $('#tok').value.trim();
  if(!t){ kGate('Paste the code first.'); return; }
  K.token = t;
  $('#tok').value = '';
  $('#gateerr').hidden = true;
  await kPull(false);
};
$('#tok').onkeydown = e => { if(e.key === 'Enter') $('#unlock').click(); };

/* ---------- boot ---------------------------------------------------------
   Cache first, network behind it. The answer to "how long until Daddy is
   home" has to be on the screen before anything is asked of the network, and
   it can be: the times do not change while the countdown runs, only the
   distance to them does, and that is this phone's own clock. */
(async function boot(){
  let saved = null;
  try { saved = await kIdb.get(); } catch(e){ /* first run, or storage blocked */ }
  if(saved){
    K.shifts = saved.shifts || [];
    K.today = saved.today || null;
    K.got = saved.got || null;
    K.token = saved.token || '';
  }

  const fromLink = kTokenFromHash();
  if(fromLink){ K.token = fromLink; await kSave(); }

  if(!K.token){ kGate(); }
  else { kShowWeek(); kDraw(); }

  if(K.token) kPull(true);

  /* The countdown has to move. Every thirty seconds, from the times already
     in hand — no request, no server, nothing that fails when the car park has
     one bar. A minute would be enough for the number and not for "any minute
     now", which is the one this page is read for. */
  setInterval(() => { if(K.token && !$('#tab-week').hidden) kDrawBanner(); }, 30000);

  /* Midnight, and the day the week starts on. `today` came from the Worker on
     his zone, so it is only ever refreshed by asking again — which is what
     coming back to the app does. */
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'visible' && K.token){ kDrawBanner(); kPull(true); }
  });

  if('serviceWorker' in navigator)
    navigator.serviceWorker.register('/kids-sw.js', { scope: '/kids' }).catch(() => {});
})();
