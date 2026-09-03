/* ==========================================================================
   Shift Deck — screenshot text parser

   Pure functions only: text in, shift rows out. No DOM, no storage, no clock
   of its own — the current date is injected so tests can pin it.

   Loaded as a plain script before app.js in the browser, and required
   directly by tests/parser.test.js in node. No build step either way.

   STATUS: both layout profiles below were derived from screenshots in the
   vendors' own user guides, NOT from real captures of the schedules this app
   is for. Treat every fixture as provisional until real screenshots land.
   ========================================================================== */

const MONTHS = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
const WEEKDAYS = {sun:0,mon:1,tue:2,wed:3,thu:4,fri:5,sat:6};

const iso = (y,m,d) => `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
const asDate = s => new Date(s + 'T12:00:00');

/* Flag codes. The parser emits codes; app.js turns them into sentences.
   Codes keep the test fixtures stable when the wording changes. */
const FLAG = {
  NODATE:  'nodate',   // no date could be worked out
  AMPM:    'ampm',     // no am/pm was printed next to the times
  SPLIT:   'split',    // times had to be paired across two lines
  WEEKDAY: 'weekday'   // weekday on screen disagrees with the computed date
};

/* ---------- OCR text normalising ---------------------------------------- */
function normalise(t){
  return t
    .replace(/[‐-―−]/g, '-')
    .replace(/\s*\|\s*/g, ' - ')
    .replace(/(\d)\s*[.;](\d{2})/g, '$1:$2')
    .replace(/(\d)\s*:\s*(\d{2})/g, '$1:$2')
    .replace(/[ \t]{2,}/g, ' ');
}

/* Screenshots carry a month and day but rarely a year. Pick the year that
   puts the date nearest to now, preferring one not far in the past. */
function guessYear(month, day, now = new Date()){
  const floor = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 45);
  const years = [now.getFullYear()-1, now.getFullYear(), now.getFullYear()+1];
  for(const y of years) if(new Date(y, month, day) >= floor) return y;
  let best = null, gap = Infinity;
  for(const y of years){
    const g = Math.abs(new Date(y, month, day) - now);
    if(g < gap){ gap = g; best = y; }
  }
  return best;
}

/* A line that is only a month name — TrackTik's section header. */
function monthHeader(line){
  const m = line.match(/^([A-Za-z]{3,9})\.?\s*(\d{4})?\s*[~v^⌄\-_]*$/);
  if(!m) return null;
  const mo = MONTHS[m[1].slice(0,3).toLowerCase()];
  if(mo === undefined) return null;
  return { month: mo, year: m[2] ? +m[2] : null };
}

/* A full written date — Homebase's day header, e.g. "Sunday, July 27, 2025". */
function fullDate(line, now = new Date()){
  // (?!\d) stops "27 July 2025" being read as July 20 by the month-first
  // branch swallowing the first two digits of the year.
  let m = line.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?!\d)(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/);
  if(m && MONTHS[m[1].slice(0,3).toLowerCase()] !== undefined){
    const mo = MONTHS[m[1].slice(0,3).toLowerCase()], d = +m[2];
    if(d >= 1 && d <= 31) return iso(m[3] ? +m[3] : guessYear(mo,d,now), mo, d);
  }
  m = line.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\.?(?:,?\s*(\d{4}))?/);
  if(m && MONTHS[m[2].slice(0,3).toLowerCase()] !== undefined){
    const mo = MONTHS[m[2].slice(0,3).toLowerCase()], d = +m[1];
    if(d >= 1 && d <= 31) return iso(m[3] ? +m[3] : guessYear(mo,d,now), mo, d);
  }
  m = line.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if(m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = line.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if(m){
    const mo = +m[1]-1, d = +m[2];
    if(mo >= 0 && mo <= 11 && d >= 1 && d <= 31){
      let y = m[3] ? +m[3] : guessYear(mo,d,now);
      if(y < 100) y += 2000;
      return iso(y, mo, d);
    }
  }
  return null;
}

function leadingDay(line){
  const m = line.match(/^[\(\[\{]?\s*(\d{1,2})\s*[\)\]\}]?[\s.:-]+(.*)$/);
  if(!m) return null;
  const d = +m[1];
  if(d < 1 || d > 31) return null;
  return { day: d, rest: m[2].trim() };
}

function to24(h, m, ap){
  h = +h;
  if(ap){
    ap = ap.toUpperCase();
    if(ap === 'PM' && h !== 12) h += 12;
    if(ap === 'AM' && h === 12) h = 0;
  }
  if(h > 23) return null;
  return `${String(h).padStart(2,'0')}:${m}`;
}

const RANGE  = /(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?\s*(?:-|to|until|–)\s*(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?/;
const SINGLE = /(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?/;

function findRange(line){
  const m = line.match(RANGE);
  if(!m) return null;
  const a = m[3] || m[6], b = m[6] || m[3];
  const start = to24(m[1], m[2], a), end = to24(m[4], m[5], b);
  if(!start || !end) return null;
  return { start, end, ambiguous: !m[3] && !m[6], text: m[0] };
}
function findSingle(line){
  const m = line.match(SINGLE);
  if(!m) return null;
  const t = to24(m[1], m[2], m[3]);
  if(!t) return null;
  return { time: t, ambiguous: !m[3], text: m[0] };
}

function tidy(s){
  return String(s||'')
    .replace(/[^A-Za-z0-9À-ſ &'/.,-]/g,' ')
    .replace(/\s{2,}/g,' ')
    .replace(/^[\s,.\-]+|[\s,.\-]+$/g,'')
    .slice(0,60);
}

// Lines that are chrome, not data.
const NOISE = /^(schedule|my shifts|open shifts|all shifts|today|table of contents|browsing|your hours|scheduled|actual|home|money|messages|more|clock)/i;

/* ---------- the parser --------------------------------------------------
   Handles both layouts seen so far:
     TrackTik  month header, then "WED 9:00am - 11:00am" / "(03) Site"
     Homebase  "Sunday, July 27, 2025", then a start time and an end time
               on separate lines with the role beside them

   opts.now  Date treated as "today" when guessing a missing year.
   -------------------------------------------------------------------- */
function parse(text, opts = {}){
  const now = opts.now || new Date();
  const lines = normalise(text).split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const out = [];
  let month = null, year = null, lastDay = null, dateNow = null;

  for(let i = 0; i < lines.length; i++){
    const line = lines[i];

    const mh = monthHeader(line);
    if(mh){ month = mh.month; if(mh.year) year = mh.year; lastDay = null; continue; }

    // A header line carrying a full date resets the current day.
    if(!findSingle(line)){
      const fd = fullDate(line, now);
      if(fd){ dateNow = fd; continue; }
    }

    if(NOISE.test(line)) continue;

    const r = findRange(line);
    let start, end, ambiguous, consumed = 0, label = '';
    let dayFromBefore = null, wdTok = null;

    if(r){
      start = r.start; end = r.end; ambiguous = r.ambiguous;
      const cut = line.indexOf(r.text);
      const before = line.slice(0, cut).trim();
      const after  = line.slice(cut + r.text.length).trim();
      if(after.length > 2) label = after;

      dayFromBefore = /^[\(\[]?\s*\d{1,2}\s*[\)\]]?$/.test(before)
        ? +before.replace(/\D/g,'') : null;
      wdTok = before.match(/^([A-Za-z]{3})\b/);
    } else {
      // Two single times on consecutive lines = one shift (Homebase).
      const a = findSingle(line);
      if(!a) continue;
      let j = i + 1, b = null;
      while(j < lines.length && j <= i + 2){
        if(findRange(lines[j])) break;
        const cand = findSingle(lines[j]);
        if(cand){ b = cand; break; }
        j++;
      }
      if(!b) continue;
      start = a.time; end = b.time; ambiguous = a.ambiguous || b.ambiguous;
      consumed = j - i;
      const restA = line.replace(a.text,'').trim();
      const restB = lines[j].replace(b.text,'').trim();
      label = [restA, restB].filter(x => x.length > 2 && !NOISE.test(x)).join(' ');
      if(lines[j+1] && !findSingle(lines[j+1]) && !NOISE.test(lines[j+1]) && !fullDate(lines[j+1], now)){
        if(label.length < 3) label = lines[j+1];
        consumed = j + 1 - i;
      }
    }

    // Work out the date.
    let day = (typeof dayFromBefore === 'number') ? dayFromBefore : null;
    if(r){
      const nxt = lines[i+1];
      if(nxt && !findRange(nxt) && !findSingle(nxt)){
        const nd = leadingDay(nxt);
        if(nd){
          if(day === null) day = nd.day;
          if(!label) label = nd.rest;
        } else if(!label && !NOISE.test(nxt)) label = nxt;
      }
    }

    let date = '';
    if(day !== null && month !== null){
      if(lastDay !== null && day < lastDay - 10){
        month++; if(month > 11){ month = 0; if(year) year++; }
      }
      lastDay = day;
      date = iso(year || guessYear(month, day, now), month, day);
    } else if(dateNow){
      date = dateNow;
    }

    const flags = [];
    if(!date)     flags.push(FLAG.NODATE);
    if(ambiguous) flags.push(FLAG.AMPM);
    if(!r)        flags.push(FLAG.SPLIT);
    if(date && wdTok){
      const want = WEEKDAYS[wdTok[1].toLowerCase()];
      if(want !== undefined && asDate(date).getDay() !== want)
        flags.push(FLAG.WEEKDAY);
    }

    out.push({ date, start, end, label: tidy(label) || 'Shift', flags });
    i += consumed;
  }
  return out;
}

/* Node picks these up for the tests; the browser just gets the globals. */
if(typeof module !== 'undefined' && module.exports){
  module.exports = { MONTHS, WEEKDAYS, FLAG, iso, asDate, normalise, guessYear,
                     monthHeader, fullDate, leadingDay, to24, findRange,
                     findSingle, tidy, NOISE, parse };
}
