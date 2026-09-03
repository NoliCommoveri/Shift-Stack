/* ==========================================================================
   Shift Deck — calendar (.ics) reader

   Pure functions only: iCalendar text in, shift rows out. No DOM, no storage,
   no clock of its own. Loaded as a plain script after parser.js in the
   browser, and required directly by tests/ics.test.js in node.

   WHY THIS EXISTS

   Homebase has a Calendar Sync of its own — Settings, a location picker, a
   Google account and an alert lead time. Turned on, it writes his shifts into
   that Google calendar, and the phone syncs them down. That is a far better
   source than a screenshot: the times are the employer's own numbers rather
   than something read off a dark screen one character at a time, so no am/pm
   can be misread and no row can be lost to a scroll boundary.

   What it does not do is put those shifts in this app, and no browser can go
   and get them: there is no web API for the phone's calendar on Android, and
   the Google feed URLs do not send CORS headers, so a fetch from a static page
   is usually refused. The .ics file is the bridge that always works — saved
   from the feed, exported out of Google Calendar, or pasted in as text.

   Rows come out in the same shape parser.js produces, so they land in the same
   review screen, with the same flags and the same commit path. The one thing
   they carry that OCR rows cannot is the event's UID, which is a stable
   identity: re-importing the same calendar updates the shift it already made
   instead of adding a second one.
   ========================================================================== */

/* Deliberately standalone — no dependency on parser.js, in either direction.
   The two readers share nothing but the row shape they produce, and a feed
   needs none of the OCR repair work parser.js does. In particular it must not
   run text through parser.js's `tidy`: that strips the debris a camera leaves
   behind, and here there is none. A feed's text is the employer's own, exact
   to the character, and "F.O.C." should stay "F.O.C." */
const icsISO = (y, m, d) =>
  `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/* All a feed's text needs: no line breaks, no runs of spaces, a sane length. */
function clean(s){
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

/* Flag codes, same contract as parser.js: codes here, sentences in app.js. */
const ICS_FLAG = {
  NOEND: 'noend',   // no end time was given — the start was used for both
  RECUR: 'recur',   // a repeating event; only the first occurrence was read
  ZONE:  'zone',    // the event's time zone was not recognised
  LONG:  'long'     // runs for more than a day, which no shift should
};

/* ---------- reading the file format --------------------------------------
   RFC 5545 in the small: lines are folded at 75 octets and continued with a
   leading space or tab, properties carry parameters before the colon, and
   text values escape commas, semicolons and newlines.
   ---------------------------------------------------------------------- */

function unfold(text){
  return String(text || '')
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    .replace(/\n[ \t]/g, '');
}

/* Split on a delimiter, ignoring any inside a quoted parameter value. */
function splitOutsideQuotes(s, delim){
  const out = [];
  let cur = '', q = false;
  for(const c of s){
    if(c === '"'){ q = !q; cur += c; }
    else if(c === delim && !q){ out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function contentLine(line){
  let i = 0, q = false;
  for(; i < line.length; i++){
    const c = line[i];
    if(c === '"') q = !q;
    else if(c === ':' && !q) break;
  }
  if(i >= line.length) return null;                 // no value: not a property
  const bits = splitOutsideQuotes(line.slice(0, i), ';');
  const params = {};
  for(const b of bits.slice(1)){
    const eq = b.indexOf('=');
    if(eq < 0) continue;
    params[b.slice(0, eq).toUpperCase()] = b.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: bits[0].toUpperCase().trim(), params, value: line.slice(i + 1) };
}

function unescapeText(v){
  return String(v || '').replace(/\\([nN,;\\])/g, (_, c) =>
    (c === 'n' || c === 'N') ? '\n' : c);
}

/* ---------- time ---------------------------------------------------------
   Three forms turn up in a real feed and each needs different handling:

     20260903T121500Z            an instant in UTC
     TZID=America/Chicago:...    a wall time in a named zone
     20260903T071500             a floating wall time, no zone at all

   All three have to come out as the wall time on *his* phone, because that is
   what a shift is. Google writes the first two; the third is taken as read.
   ---------------------------------------------------------------------- */

const DTPAT = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/;

function parseDT(value, params = {}){
  const m = String(value || '').trim().match(DTPAT);
  if(!m) return null;
  const dateOnly = params.VALUE === 'DATE' || !m[4];
  return {
    y: +m[1], mo: +m[2] - 1, d: +m[3],
    h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0),
    utc: m[7] === 'Z',
    dateOnly,
    tzid: params.TZID || null
  };
}

/* Minutes to add to UTC to get the wall clock in `zone` at that instant. */
function zoneOffset(zone, ms){
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date(ms)).reduce((a, x) => (a[x.type] = x.value, a), {});
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return (asUTC - ms) / 60000;
}

/* A wall time in a named zone, as a UTC instant. Two passes, because the
   offset depends on the instant and the instant depends on the offset —
   the second pass is what gets the hour either side of a DST change right. */
function wallToUTC(t, zone){
  const naive = Date.UTC(t.y, t.mo, t.d, t.h, t.mi, t.s);
  let ms = naive - zoneOffset(zone, naive) * 60000;
  ms = naive - zoneOffset(zone, ms) * 60000;
  return ms;
}

/* Wall clock parts of an instant, in `zone` or in the machine's own zone. */
function partsIn(ms, zone){
  if(!zone){
    const d = new Date(ms);
    return { y: d.getFullYear(), mo: d.getMonth(), d: d.getDate(),
             h: d.getHours(), mi: d.getMinutes() };
  }
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  }).formatToParts(new Date(ms)).reduce((a, x) => (a[x.type] = x.value, a), {});
  return { y: +p.year, mo: +p.month - 1, d: +p.day, h: +p.hour, mi: +p.minute };
}

function knownZone(zone){
  if(!zone) return false;
  try{ new Intl.DateTimeFormat('en-US', { timeZone: zone }); return true; }
  catch(e){ return false; }
}

/* One date-time resolved to wall-clock parts in the output zone.
   `floating` says the value carried no zone and was taken at face value. */
function resolve(t, outZone){
  if(t.dateOnly) return { parts: { y: t.y, mo: t.mo, d: t.d, h: 0, mi: 0 }, floating: true };
  if(t.utc) return { parts: partsIn(Date.UTC(t.y, t.mo, t.d, t.h, t.mi, t.s), outZone) };
  if(t.tzid && knownZone(t.tzid))
    return { parts: partsIn(wallToUTC(t, t.tzid), outZone) };
  return {
    parts: { y: t.y, mo: t.mo, d: t.d, h: t.h, mi: t.mi },
    floating: true,
    unknownZone: !!t.tzid
  };
}

const DURPAT = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;
function parseDuration(v){
  const m = String(v || '').trim().toUpperCase().match(DURPAT);
  if(!m) return null;
  const mins = (+(m[2] || 0)) * 10080 + (+(m[3] || 0)) * 1440
             + (+(m[4] || 0)) * 60 + (+(m[5] || 0)) + Math.round((+(m[6] || 0)) / 60);
  return m[1] === '-' ? -mins : mins;
}

const hhmm = p => `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`;
const dayISO = p => icsISO(p.y, p.mo, p.d);

/* ---------- the label ----------------------------------------------------
   Homebase writes the role into SUMMARY and the station into LOCATION, which
   is exactly the role-and-place split §8.1 wants and OCR cannot reliably give.
   Both are kept, unless the summary already says the place.
   ---------------------------------------------------------------------- */

/* Google prefixes a synced calendar's own name onto nothing, but employer
   feeds do like a badge on the front — "Homebase: Cook". It says nothing the
   job picker has not already said, so it comes off. */
const TITLE_BADGE = /^\s*(?:homebase|tracktik|shift|work|schedule)\s*[:\-–]\s*/i;

function labelFor(summary, location){
  const title = clean(String(summary || '').replace(TITLE_BADGE, ''));
  // An address is a street line and a town and a postcode; only the first
  // piece of it names the place, and that is what belongs on a shift row.
  const place = clean(String(location || '').split(/[\n,]/)[0]);
  const flat = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  if(!place) return title;
  if(!title) return place;
  if(flat(title).includes(flat(place)) || flat(place).includes(flat(title))) return title;
  // Both, but the place is the half worth keeping: it is what he navigates to
  // and what the site table matches on, so a long title gives way to it
  // rather than pushing it off the end.
  const room = 60 - place.length - 3;
  return `${room < title.length ? title.slice(0, Math.max(0, room)).trim() : title} - ${place}`;
}

/* ---------- the reader ---------------------------------------------------
   opts.zone   IANA zone the times should come out in. Omitted means the
               machine's own, which on his phone is the right answer; the
               tests pin it so they do not depend on where they run.
   opts.from   ISO date. Events before it are dropped — a Google export holds
               years of history and none of it is a shift he has to be told
               about. Omitted means keep everything.
   opts.match  Only keep events whose title or place contains this. A synced
               calendar is usually his personal one with the shifts mixed into
               it, so without this the review screen fills with birthdays.
   -------------------------------------------------------------------- */
function parseICS(text, opts = {}){
  const zone = opts.zone || null;
  const from = opts.from || null;
  const needle = String(opts.match || '').trim().toLowerCase();

  const report = { calName: '', events: 0, kept: 0, allDay: 0, cancelled: 0,
                   past: 0, filtered: 0, unreadable: 0, cancelledRows: [] };

  const body = unfold(text);
  if(!/^BEGIN:VCALENDAR/im.test(body)){
    report.notCalendar = true;
    return { rows: [], report };
  }

  const rows = [];
  let ev = null;      // the VEVENT being read
  let inside = null;  // a component nested in it (VALARM), whose properties
                      // must not be mistaken for the event's own

  for(const line of body.split('\n')){
    const cl = contentLine(line.trim());
    if(!cl) continue;
    const { name, params, value } = cl;

    if(name === 'BEGIN'){
      const comp = value.toUpperCase().trim();
      if(comp === 'VEVENT'){ ev = { props: {}, params: {} }; inside = null; }
      else if(ev) inside = comp;
      continue;
    }
    if(name === 'END'){
      const comp = value.toUpperCase().trim();
      if(comp === 'VEVENT' && ev){
        report.events++;
        const made = buildRow(ev, { zone, from, needle, report });
        if(made) rows.push(made);
        ev = null;
      } else if(ev && inside === comp) inside = null;
      continue;
    }

    if(!ev){
      if(name === 'X-WR-CALNAME') report.calName = clean(unescapeText(value));
      continue;
    }
    if(inside) continue;                  // VALARM's own DESCRIPTION, not ours
    ev.props[name] = value;
    ev.params[name] = params;
  }

  report.kept = rows.length;
  return { rows, report };
}

function buildRow(ev, ctx){
  const { zone, from, needle, report } = ctx;
  const p = ev.props;

  const dtstart = parseDT(p.DTSTART, ev.params.DTSTART || {});
  if(!dtstart){ report.unreadable++; return null; }

  // An all-day entry carries no times, and a shift is its times. Inventing
  // one would be the exact mistake this app exists to avoid, so it is dropped
  // and counted rather than guessed at.
  if(dtstart.dateOnly){ report.allDay++; return null; }

  const label = labelFor(unescapeText(p.SUMMARY), unescapeText(p.LOCATION));

  const a = resolve(dtstart, zone);
  const date = dayISO(a.parts);

  if(from && date < from){ report.past++; return null; }

  if(needle){
    const hay = `${p.SUMMARY || ''} ${p.LOCATION || ''} ${p.DESCRIPTION || ''}`.toLowerCase();
    if(!hay.includes(needle)){ report.filtered++; return null; }
  }

  // A cancelled event is not a row. It is worth more than that: its UID names
  // a shift already on file that is not happening, which is the one thing a
  // screenshot can never tell you. app.js matches these against the store.
  if(String(p.STATUS || '').toUpperCase().trim() === 'CANCELLED'){
    report.cancelled++;
    report.cancelledRows.push({ uid: eventUID(p), date, label });
    return null;
  }

  const flags = [];
  if(a.floating && a.unknownZone) flags.push(ICS_FLAG.ZONE);

  let endParts = null;
  const dtend = p.DTEND ? parseDT(p.DTEND, ev.params.DTEND || {}) : null;
  if(dtend){
    const b = resolve(dtend, zone);
    endParts = b.parts;
  } else if(p.DURATION){
    const mins = parseDuration(p.DURATION);
    if(mins !== null && mins > 0){
      const base = new Date(a.parts.y, a.parts.mo, a.parts.d, a.parts.h, a.parts.mi);
      base.setMinutes(base.getMinutes() + mins);
      endParts = { y: base.getFullYear(), mo: base.getMonth(), d: base.getDate(),
                   h: base.getHours(), mi: base.getMinutes() };
    }
  }
  if(!endParts){
    endParts = a.parts;
    flags.push(ICS_FLAG.NOEND);
  }

  const endDate = dayISO(endParts);
  const spanDays = Math.round((Date.UTC(endParts.y, endParts.mo, endParts.d)
                             - Date.UTC(a.parts.y, a.parts.mo, a.parts.d)) / 86400000);
  // A shift record holds one date and two times; an end at or before the start
  // is read as the next morning, which covers every overnight shift he works.
  // Anything longer than that is not a shift and should be looked at.
  if(spanDays > 1 || spanDays < 0) flags.push(ICS_FLAG.LONG);

  if(p.RRULE || p.RDATE) flags.push(ICS_FLAG.RECUR);

  return {
    date, start: hhmm(a.parts), end: hhmm(endParts),
    label: label || 'Shift',
    flags,
    uid: eventUID(p),
    endDate,
    source: 'ics'
  };
}

/* One occurrence of a repeating event shares its UID with every other, so the
   recurrence marker has to be part of the identity or they collapse into one. */
function eventUID(p){
  const base = String(p.UID || '').trim();
  if(!base) return '';
  const rid = String(p['RECURRENCE-ID'] || '').trim();
  return rid ? `${base}#${rid}` : base;
}

/* Node picks these up for the tests; the browser just gets the globals. */
if(typeof module !== 'undefined' && module.exports){
  module.exports = { ICS_FLAG, clean, unfold, splitOutsideQuotes, contentLine, unescapeText,
                     parseDT, zoneOffset, wallToUTC, partsIn, knownZone, resolve,
                     parseDuration, labelFor, eventUID, parseICS };
}
