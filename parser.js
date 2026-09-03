/* ==========================================================================
   Shift Deck — screenshot text parser

   Pure functions only: text in, shift rows out. No DOM, no storage, no clock
   of its own — the current date is injected so tests can pin it.

   Loaded as a plain script before app.js in the browser, and required
   directly by tests/parser.test.js in node. No build step either way.

   STATUS: both layout profiles were originally derived from screenshots in
   the vendors' user guides. Real captures of September 2026 have since landed
   and confirmed the shape of both — a month header with the day number in a
   left column for TrackTik, a written date header with the times on separate
   lines for Homebase. What they changed is the debris around the times: see
   PERSON below. Fixtures marked PROVISIONAL are still guide-derived; those
   marked TRANSCRIBED were read off real screenshots by eye rather than by OCR.
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
const NOISE = /^(schedule|my shifts|open shifts|all shifts|day view|week view|today|no shifts scheduled|\d+\s+new shifts?|table of contents|browsing|your hours|scheduled|actual|home|money|messages|my profile|profile|more|clock)/i;

/* The row naming the employee whose schedule this is. Homebase prints it
   above the role on every single shift — "CC (You) Cerion C." — so it carries
   nothing a label should keep, and the avatar initials share the row with it.
   Matched loosely because "(You)" is four characters of OCR risk. */
const PERSON = /^[^A-Za-z0-9]*(?:[A-Za-z]{1,3}\b[^A-Za-z0-9]*)?[\(\[\{]?\s*y[o0]u\s*[\)\]\}]?\b/i;

/* Label fragments worth keeping in a label. Two characters or fewer is avatar
   debris, not a role. */
const usefulPart = s => s.length > 2 && !NOISE.test(s) && !PERSON.test(s);

/* ---------- the parser --------------------------------------------------
   Handles both layouts, as captured in September 2026:
     TrackTik  month header, then the weekday and the time range on one line
               with the day number and the site on the next:
                 September
                 FRI 3:00pm - 11:00pm
                 04 Cook Plant ASO | SOUTHERN HENS, I...
     Homebase  a written date header with no year, then the start and end
               times on separate lines, with the employee's own name, the role
               and the site spread over the three lines beside them:
                 Thursday, September 03 Today
                 12:15 am CC (You) Cerion C.
                 4:15 am Training
                 Headquarters

   opts.now  Date treated as "today" when guessing a missing year.
   -------------------------------------------------------------------- */
function parse(text, opts = {}){
  const now = opts.now || new Date();
  const lines = normalise(text).split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const out = [];
  let month = null, year = null, lastDay = null, dateNow = null, dateNowWd;

  for(let i = 0; i < lines.length; i++){
    const line = lines[i];

    const mh = monthHeader(line);
    if(mh){ month = mh.month; if(mh.year) year = mh.year; lastDay = null; continue; }

    // A header line carrying a full date resets the current day. Homebase
    // writes the weekday first and no year at all, so keep the weekday: it is
    // the only check there is on the year guessYear had to invent.
    if(!findSingle(line)){
      const fd = fullDate(line, now);
      if(fd){
        dateNow = fd;
        const w = line.match(/^\s*[\(\[]?\s*([A-Za-z]{3,9})\b/);
        dateNowWd = w ? WEEKDAYS[w[1].slice(0,3).toLowerCase()] : undefined;
        continue;
      }
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
      // The role sits beside one of the times and the site on its own line
      // under them, with the employee's own name on a third. Which of those
      // shares a line with a time depends on how the OCR grouped the rows, so
      // gather them all and sort them out by content rather than by position.
      const parts = [line.replace(a.text,''), lines[j].replace(b.text,'')];
      for(let k = j + 1; k < lines.length && k <= j + 2; k++){
        const nx = lines[k];
        if(findSingle(nx) || findRange(nx) || monthHeader(nx) || NOISE.test(nx)) break;
        if(fullDate(nx, now)) break;
        parts.push(nx);
        consumed = k - i;
      }
      label = parts.map(x => x.trim()).filter(usefulPart).join(' - ');
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
    const want = wdTok ? WEEKDAYS[wdTok[1].toLowerCase()]
               : (date && date === dateNow) ? dateNowWd : undefined;
    if(date && want !== undefined && asDate(date).getDay() !== want)
      flags.push(FLAG.WEEKDAY);

    out.push({ date, start, end, label: tidy(label) || 'Shift', flags });
    i += consumed;
  }
  return out;
}

/* Node picks these up for the tests; the browser just gets the globals. */
if(typeof module !== 'undefined' && module.exports){
  module.exports = { MONTHS, WEEKDAYS, FLAG, iso, asDate, normalise, guessYear,
                     monthHeader, fullDate, leadingDay, to24, findRange,
                     findSingle, tidy, NOISE, PERSON, usefulPart, parse };
}
