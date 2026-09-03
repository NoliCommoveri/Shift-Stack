/* ==========================================================================
   Shift Deck
   Everything lives on this device. Nothing is sent anywhere.
   ========================================================================== */

/* ---------- storage ------------------------------------------------------ */
const DEFAULTS = {
  companies: [],
  shifts: [],
  settings: { leads: [12, 2], feedMode: 'subscribe' }
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
const FLAG_TEXT = {
  [FLAG.NODATE]:  'No date found \u2014 set it below.',
  [FLAG.AMPM]:    'No am/pm was printed \u2014 check the times.',
  [FLAG.SPLIT]:   'Times were read from two separate lines \u2014 check them.',
  [FLAG.WEEKDAY]: 'The weekday on screen does not match this date.',
  [FLAG_MOVED]:   'A shift is already on file at this time in a different place \u2014 adding this will not replace it.'
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
        <input data-k="pkg" type="text" placeholder="com.tracktik.shift" value="${esc(co.pkg||'')}"></label>`;
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

  // Drop only exact repeats — same job, same date, same times, same place.
  // A row matching on time but not on place is a location change, not a
  // duplicate, so it stays and gets flagged for review.
  pending = pending.filter(p => {
    if(!p.date) return true;
    const sameSlot = S.shifts.filter(s =>
      s.companyId === p.companyId && s.date === p.date &&
      s.start === p.start && s.end === p.end);
    if(!sameSlot.length) return true;
    const snapped = key(snapSite(p.label, p.companyId));
    if(sameSlot.some(s => key(s.label) === snapped)) return false;   // exact repeat
    p.flags = [...p.flags, FLAG_MOVED];
    return true;
  });

  txt.textContent = pending.length
    ? `Found ${pending.length} shift${pending.length===1?'':'s'}. Check them, then add.`
    : 'Nothing new found. Open the raw text below to see what was read.';
  renderReview();
}

function flagText(p){
  return p.flags.map(f => FLAG_TEXT[f] || f).join(' ');
}

function renderReview(){
  const box = $('#review');
  box.innerHTML = '';
  $('#revbtns').hidden = !pending.length;
  if(!pending.length) return;

  const manyJobs = S.companies.length > 1;

  pending.forEach(p => {
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
    e.oninput = () => { p.end = e.value; };
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
function fold(l){
  if(l.length <= 74) return l;
  const out = [l.slice(0,74)];
  let rest = l.slice(74);
  while(rest.length > 73){ out.push(' ' + rest.slice(0,73)); rest = rest.slice(73); }
  if(rest) out.push(' ' + rest);
  return out.join('\r\n');
}
function buildICS(only){
  const now = new Date().toISOString().replace(/[-:]/g,'').split('.')[0] + 'Z';
  const leads = (S.settings.leads || []).filter(n => n > 0);
  const L = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Shift Deck//EN','CALSCALE:GREGORIAN',
             'METHOD:PUBLISH','X-WR-CALNAME:Work shifts'];
  only.forEach(s => {
    const co = coById(s.companyId);
    const endDate = mins(s.end) <= mins(s.start) ? shiftDays(s.date,1) : s.date;
    const title = `${co ? co.name : 'Shift'}- ${s.label}`;
    L.push('BEGIN:VEVENT',
      fold(`UID:${s.id}@shiftdeck`),
      `DTSTAMP:${now}`,
      `DTSTART:${s.date.replace(/-/g,'')}T${s.start.replace(':','')}00`,
      `DTEND:${endDate.replace(/-/g,'')}T${s.end.replace(':','')}00`,
      fold('SUMMARY:' + icsEscape(title)),
      fold('DESCRIPTION:' + icsEscape(`${fmtDur(durMins(s))} scheduled`)));
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
$('#picker').onchange = () => { readFiles($('#picker').files); $('#picker').value = ''; };
['dragenter','dragover'].forEach(ev => $('#intake').addEventListener(ev, e => {
  e.preventDefault(); $('#intake').classList.add('hot'); }));
['dragleave','drop'].forEach(ev => $('#intake').addEventListener(ev, e => {
  e.preventDefault(); $('#intake').classList.remove('hot'); }));
$('#intake').addEventListener('drop', e => readFiles(e.dataTransfer.files));
document.addEventListener('paste', e => {
  const f = [...(e.clipboardData?.files||[])];
  if(f.length && !document.getElementById('tab-import').hidden) readFiles(f);
});

$('#commit').onclick = () => {
  let n = 0;
  pending.filter(p => p.date && p.start && p.end && p.companyId).forEach(p => {
    S.shifts.push({
      id: uid(), companyId: p.companyId, date: p.date, start: p.start, end: p.end,
      label: snapSite(p.label, p.companyId), source: p.source || 'ocr'
    });
    n++;
  });
  pending = [];
  save(); renderReview(); renderAll();
  $('#progtext').textContent = `Added ${n} shift${n===1?'':'s'}.`;
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
    rate: null, weekStart: 0, otAfterHrs: null, breakMins: null, breakAfterHrs: null, pkg: ''
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
