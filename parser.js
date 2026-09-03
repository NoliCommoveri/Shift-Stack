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

   A real OCR pass finally ran on 3 September 2026, and the two layouts came
   out of it very differently. TrackTik survives it: the only fault was the
   month header arriving as "September Vv os", and with that tolerated the week
   parses exactly, weekday cross-check included. Homebase does not, and the
   damage is to the times rather than the layout — see
   tests/fixtures/pending/README.md. TrackTik is the job that has no calendar
   feed, so it is the one this parser actually has to carry.
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
  WEEKDAY: 'weekday',  // weekday on screen disagrees with the computed date
  ONETIME: 'onetime',  // only one of the two times could be read
  FIXEDAP: 'fixedap'   // an am/pm was recovered from a neighbouring line
};

/* ---------- OCR text normalising ---------------------------------------- */
function normalise(t){
  return t
    .replace(/[‐-―−]/g, '-')
    .replace(/\s*\|\s*/g, ' | ')
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

/* A line that is only a month name — TrackTik's section header.

   The real September capture read it as "September Vv os": the collapse
   chevron and a stray icon came through as short letter tokens, which the
   original trailing class did not allow, so the month never got set and every
   row on the screen came back nodate. Debris is tolerated as punctuation runs
   and tokens of one or two letters — long enough for a chevron, too short to
   swallow "Thursday, September 03", and digits stay excluded so a day number
   can never be mistaken for noise. */
function monthHeader(line){
  const m = line.match(/^([A-Za-z]{3,9})\.?\s*(\d{4})?(?:\s*(?:[~v^⌄\-_.,:;]+|[A-Za-z]{1,2}\b))*\s*$/);
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
  // hh and mm are kept so a meridiem found later, on another line, can be
  // applied without parsing the text a second time.
  return { time: t, ambiguous: !m[3], text: m[0], hh: m[1], mm: m[2] };
}

/* ---------- the two separators, which are not the same thing --------------

   TrackTik prints a real boundary inside one field: "Cook Plant ASO | SOUTHERN
   HENS, I..." is a role and a place, and the pipe is the employer's own mark
   for where one ends and the other begins. Homebase prints no such thing — its
   role and its site arrive on separate lines and are joined back together
   here, and that join is this parser's invention.

   normalise() used to flatten the pipe to " - ", which is exactly what the
   Homebase join produces, so at the point §8.1 wants to read the boundary a
   real separator and an arbitrary join looked identical. The pipe is now kept
   (spacing canonicalised to " | ") and tidy() no longer strips it, so the
   distinction survives all the way to the label:

     " | "  a separator the employer printed    → splitLabel() can trust it
     " - "  fragments this parser glued         → means nothing about structure

   Nothing downstream reads splitLabel() yet. It exists so §8.1's site table
   starts from a boundary that is already correct rather than discovering
   halfway through that it was destroyed three functions earlier. */
function splitLabel(label){
  const s = String(label||'');
  const i = s.indexOf('|');
  if(i < 0) return { role: s.trim(), site: '' };
  return { role: s.slice(0, i).trim(), site: s.slice(i + 1).trim() };
}

function tidy(s){
  return String(s||'')
    .replace(/[^A-Za-z0-9À-ſ &'/.,|-]/g,' ')
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

/* Token-level debris in a Homebase label row. The real OCR pass put the
   avatar initials, the row's icons and the wreckage of a mangled time on the
   same lines as the role — "—2adM cc @ Training", "28M cc @ @ Security Agent
   :". Two kinds of token are never part of a role or a site name: one that
   mixes digits with letters, which is a broken time rather than a word, and
   one carrying two letters or fewer, which is avatar debris or punctuation.
   Everything else is left alone, so "F.O.C." survives on its three letters.

   TrackTik labels do not come through here — they arrive whole from the line
   beside the day number — so this only ever sees the layout it was written
   for. */
function stripDebris(s){
  return String(s||'')
    .split(/\s+/)
    .filter(tok => {
      const letters = tok.replace(/[^A-Za-z]/g,'');
      if(letters.length <= 2) return false;
      if(/\d/.test(tok) && /[A-Za-z]/.test(tok)) return false;
      return true;
    })
    .join(' ');
}

/* A meridiem stranded on its own line. Homebase prints it beside the time; the
   OCR pass tore it off onto the next line as "00pm .", so the 8:00 pm start
   parsed as 08:00 — twelve hours out, and the exact failure the review step
   exists to catch. Recovered only from a token that is unmistakably a meridiem
   and not part of a time: "00pm" gives up its pm, while "2adM" and "28M" give
   up nothing, which is the right answer for both. */
function looseMeridiem(line){
  if(findSingle(line)) return null;
  const m = String(line||'').match(/(?:^|[^A-Za-z])([AaPp])\.?[Mm](?![A-Za-z])/);
  return m ? m[1].toUpperCase() + 'M' : null;
}

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
    let dayFromBefore = null, wdTok = null, oneTime = false, apFixed = false;

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
      // Whatever sits between this line and the end time belongs to this row.
      // It used to be stepped over, which is the whole reason the role went
      // missing from every Homebase import: "Training" and "Security Agent"
      // are on exactly that line.
      const mid = [];
      const lastMid = b ? j - 1 : Math.min(i + 2, lines.length - 1);
      for(let k = i + 1; k <= lastMid; k++){
        const nx = lines[k];
        if(monthHeader(nx) || fullDate(nx, now) || NOISE.test(nx)) break;
        mid.push(nx);
      }

      // A meridiem torn off its time and stranded on one of those lines.
      let ap = null;
      for(const nx of mid){ ap = looseMeridiem(nx); if(ap) break; }

      start = a.time;
      if(ap && a.ambiguous){
        const t = to24(a.hh, a.mm, ap);
        if(t){ start = t; apFixed = true; }
      }

      // One legible time is still a shift. Dropping the row outright is the
      // silent failure this whole project exists to prevent — an absent shift
      // reads as a day off. The end is left empty instead, which the review
      // screen already knows how to demand, and the commit path already
      // refuses to file without.
      oneTime = !b;
      end = b ? b.time : '';
      ambiguous = (a.ambiguous && !apFixed) || (b ? b.ambiguous : false);
      consumed = b ? j - i : mid.length;

      // The role sits beside one of the times and the site on its own line
      // under them, with the employee's own name on a third. Which of those
      // shares a line with a time depends on how the OCR grouped the rows, so
      // gather them all and sort them out by content rather than by position.
      const parts = [line.replace(a.text,''), ...mid];
      if(b) parts.push(lines[j].replace(b.text,''));
      const tail = i + consumed;
      for(let k = tail + 1; k < lines.length && k <= tail + 2; k++){
        const nx = lines[k];
        if(findSingle(nx) || findRange(nx) || monthHeader(nx) || NOISE.test(nx)) break;
        if(fullDate(nx, now)) break;
        parts.push(nx);
        consumed = k - i;
      }
      // Joined with a dash, never a pipe: see the separator note above tidy().
      label = parts.map(x => stripDebris(x.trim())).filter(usefulPart).join(' - ');

      // A lone time only counts as a shift if something around it names one.
      // Without that guard any stray clock-like text becomes a row.
      if(oneTime && !label) continue;
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
    if(!r && !oneTime) flags.push(FLAG.SPLIT);
    if(oneTime)   flags.push(FLAG.ONETIME);
    if(apFixed)   flags.push(FLAG.FIXEDAP);
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
                     findSingle, tidy, splitLabel, NOISE, PERSON, usefulPart,
                     stripDebris, looseMeridiem, parse };
}
