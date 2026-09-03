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

/* ---------- review flags -------------------------------------------------
   parser.js emits codes; the wording lives here so changing it never breaks
   a test fixture. FLAG_MOVED is raised by the importer, not the parser.
   ---------------------------------------------------------------------- */
const FLAG_MOVED = 'moved';
const FLAG_CHANGED = 'changed';
const FLAG_TEXT = {
  [FLAG.NODATE]:  'No date found \u2014 set it below.',
  [FLAG.AMPM]:    'No am/pm was printed \u2014 check the times.',
  [FLAG.SPLIT]:   'Times were read from two separate lines \u2014 check them.',
  [FLAG.WEEKDAY]: 'The weekday on screen does not match this date.',
  [FLAG.ONETIME]: 'Only one time could be read \u2014 set the missing one below.',
  [FLAG.FIXEDAP]: 'The am/pm was printed on its own line and has been applied \u2014 check it.',
  [FLAG_MOVED]:   'A shift is already on file at this time in a different place \u2014 adding this will not replace it.',
  [FLAG_CHANGED]: 'The calendar has moved a shift already on file.',
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
function renderSchedule(){
  renderNext();
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
        item.innerHTML = `
          <i class="tick" style="background:${esc(co?.color || '#C6CAC1')}"></i>
          <div>
            <div class="when">${esc(fmtTime(s.start))} – ${esc(fmtTime(s.end))}</div>
            <div class="where">${esc(co ? co.name : 'Unassigned')} &middot; ${esc(s.label)}</div>
          </div>
          <div class="len">${fmtDur(durMins(s))}</div>`;
        item.onclick = () => editShift(s.id);
        col.appendChild(item);

        // Flag a tight turnaround between two jobs on the same day.
        const prev = ds[idx-1];
        if(prev){
          const gap = mins(s.start) - (mins(prev.start) + durMins(prev));
          if(gap < 60 && gap > -600)
            col.appendChild(el('div','gapwarn',
              gap < 0 ? 'These two overlap.' : `Only ${gap} min between these.`));
        }
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
      const tr = el('tr');
      tr.innerHTML = `<td>${MONTHNAMES[d.getMonth()].slice(0,3)} ${d.getDate()}</td>
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
        empty to take everything.</p>`;
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

  pending = pending.filter(bySlot);

  txt.textContent = pending.length
    ? `Found ${pending.length} shift${pending.length===1?'':'s'}. Check them, then add.`
    : 'Nothing new found. Open the raw text below to see what was read.';
  renderReview();
}

/* Drop only exact repeats — same job, same date, same times, same place. A row
   matching on time but not on place is a location change, not a duplicate, so
   it stays and gets flagged for review. This is all a screenshot row can be
   matched on; a calendar row has a UID and is matched on that first. */
function bySlot(p){
  if(!p.date) return true;
  const sameSlot = S.shifts.filter(s =>
    s.companyId === p.companyId && s.date === p.date &&
    s.start === p.start && s.end === p.end);
  if(!sameSlot.length) return true;
  const snapped = key(snapSite(p.label, p.companyId));
  if(sameSlot.some(s => key(s.label) === snapped)) return false;     // exact repeat
  p.flags = [...p.flags, FLAG_MOVED];
  return true;
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
  return [...p.flags.map(f => FLAG_TEXT[f] || f), p.note || ''].filter(Boolean).join(' ');
}

function renderReview(){
  const box = $('#review');
  box.innerHTML = '';
  $('#revbtns').hidden = !pending.length;
  if(!pending.length) return;

  const manyJobs = S.companies.length > 1;

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
      note.hidden = !p.flags.length;
      row.classList.toggle('flagged', !p.date || p.flags.length > 0);
    };
    d.oninput = () => {
      p.date = d.value;
      // Only the missing-date warning is answered by setting a date. The am/pm
      // and split-line warnings are about the times and must survive.
      if(p.date) p.flags = p.flags.filter(f => f !== FLAG.NODATE);
      touch();
    };
    s.oninput = () => { p.start = s.value; };
    e.oninput = () => {
      p.end = e.value;
      // Supplying the end answers the one-time warning and nothing else. The
      // am/pm warning is about a value that was read, not one that was absent,
      // so it survives being given the other half of the pair.
      if(p.end) p.flags = p.flags.filter(f => f !== FLAG.ONETIME);
      touch();
    };
    l.oninput = () => { p.label = l.value; };
    const job = row.querySelector('select');
    if(job) job.onchange = () => { p.companyId = job.value; };
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
    const title = `${co ? co.name : 'Shift'}- ${s.label}`;
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
    pkg: '', icsMatch: ''
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
