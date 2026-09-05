/* ==========================================================================
   Shift Deck — the calendar (.ics) file, both directions

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

   WHY THE WRITER IS HERE TOO

   It was not, and that was the reason §10.6 sat open as long as it did. Line
   folding, text escaping and UID identity are one body of knowledge about one
   file format, and half of it lived in app.js where nothing could test it. A
   cancellation is the case where getting that wrong is silent: the file looks
   right, the calendar ignores it, and the alarm still rings. So the format
   knowledge is all in this file now — `icsFold`, `icsEscape`, `shiftUID` and
   the cancellation builder — and app.js keeps only the part that needs the
   store: which shifts, whose job, what title.
   ========================================================================== */

/* Deliberately standalone — no dependency on parser.js, in either direction.
   The two readers share nothing but the row shape they produce, and a feed
   needs none of the OCR repair work parser.js does. In particular it must not
   run text through parser.js's `tidy`: that strips the debris a camera leaves
   behind, and here there is none. A feed's text is the employer's own, exact
   to the character, and "F.O.C." should stay "F.O.C." */
const icsISO = (y, m, d) =>
  `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/* All a feed's text needs: no line breaks, no runs of spaces, a sane length.
   A label has to fit a phone-width row; an address has to stay navigable, so
   it gets far more room. */
function clean(s, max = 60){
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
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

/* An address is a street line and a town and a postcode; only the first piece
   of it can name a place, and it only names one when it is a name. Homebase
   writes a street line — "3492 Hwy 42" — and a street number on the front of a
   shift title says nothing the tappable LOCATION on the event does not already
   say, while pushing the thing that does name the shift off the end. A leading
   digit is the whole test: "Headquarters, 401 Main St" starts with the place
   and "3492 Hwy 42, Hattiesburg" starts with the street. */
function placeName(location){
  const first = clean(String(location || '').split(/[\n,]/)[0]);
  return /^\d/.test(first) ? '' : first;
}

/* The role, out of DESCRIPTION. Homebase's own sync writes the station into
   SUMMARY and the job title down here, which is the other half of the
   role-and-place split §8.1 wants and the half this reader used to throw away:
   "Security Officer" sat in the description while the street number went into
   the title.

   A description is free text, though, and most feeds put a sentence in it —
   the fixture's own "Shift published by Homebase.", Google's HTML, our own
   "12h scheduled". So this accepts a job title and nothing else: the first
   line, four words at most, every word starting with a capital, no digits and
   no sentence punctuation. Anything less certain is dropped and the row reads
   exactly as it did before this function existed, which is the right way round
   — a wrong role is filed against a rate (§27), and a missing one is a row he
   labels himself. */
function roleFrom(description){
  const first = String(description || '').split('\n').map(x => x.trim()).filter(Boolean)[0];
  const s = clean(first, 40);
  if(!s || s.length > 40) return '';
  const words = s.split(' ');
  if(words.length > 4) return '';
  if(!words.every(w => /^[A-Z][A-Za-z.'\/&-]*$/.test(w))) return '';
  return s;
}

/* The two halves of a label, in the order §17.4 fixed and with the separator
   it fixed: role, pipe, place. The pipe is not decoration — `splitLabel` in
   parser.js trusts it and `readLabel` in sites.js splits on it, so a label
   joined with anything else arrives at the site and role tables as one string
   and matches neither. This reader knows the boundary is real, because the two
   halves came out of two different properties of the event, so it says so.

   Which property is which is the part that varies. Homebase writes the station
   into SUMMARY, the address into LOCATION and the role into DESCRIPTION;
   Google's own export and TrackTik write the role into SUMMARY and the place
   into LOCATION. So the place is taken from LOCATION when it is a name, the
   role from DESCRIPTION when it is plainly one, and the title fills whichever
   half is still empty. */
function labelFor(summary, location, description){
  const title = clean(String(summary || '').replace(TITLE_BADGE, ''));
  const place = placeName(location);
  const role  = roleFrom(description);
  const flat = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const same = (a, b) => !!a && !!b && (flat(a).includes(flat(b)) || flat(b).includes(flat(a)));

  let left = role;                    // what he is doing
  let right = place;                  // where he is doing it
  // The title is whichever half nothing else filled. Never both, and never a
  // repeat of the half it already agrees with — "Moselle Station" beside
  // "Moselle Station" is one place, not a role at one.
  if(!right && !same(title, left)) right = title;
  else if(!left && !same(title, right)) left = title;

  if(!left) return right || '';
  if(!right || same(left, right)) return left;
  // The place is the half worth keeping whole: it is what he navigates to and
  // what the site table matches on, so a long role gives way to it rather than
  // pushing it off the end.
  const room = 60 - right.length - 3;
  return `${room < left.length ? left.slice(0, Math.max(0, room)).trim() : left} | ${right}`;
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

  const location = unescapeText(p.LOCATION);
  const label = labelFor(unescapeText(p.SUMMARY), location, unescapeText(p.DESCRIPTION));
  // The whole address is kept beside the shortened label. Homebase writes a
  // real street address here, and an address on a calendar event is a tappable
  // link to a map on the phone — which is §8.1's best argument for the site
  // table, arriving for free on this half of the schedule.
  const place = clean(location, 200);

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
    report.cancelledRows.push({ uid: eventUID(p), date, label, place });
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
    place,
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

/* ==========================================================================
   WRITING

   The reader above is about someone else's file. What follows is about ours:
   the identity we put on an event, and the one message that takes an event
   back off the phone.
   ========================================================================== */

/* Every event this app writes is named after the shift record that made it,
   and nothing else. That is the whole of the identity scheme, and it lives in
   one function on purpose: a cancellation whose UID does not match the
   publication to the character cancels nothing, and the failure is silent —
   the file imports cleanly and the alarm still rings at five. Both callers
   go through here so the two can never drift apart. */
function shiftUID(id){ return `${id}@shiftdeck`; }

function icsEscape(s){
  return String(s).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
}

/* The spec folds at 75 octets, not 75 characters. Slicing by character wrote
   over-long lines for anything non-ASCII, which some calendar apps reject
   outright — live now that real addresses go in the file, since a Montreal
   site name is two bytes a letter in the accents. Splitting on code points
   keeps a character whole; counting their UTF-8 length keeps the line legal.

   Named `icsFold` rather than `fold` because every file here is a plain
   script sharing one global scope, and app.js — loaded last — has a `fold`
   of its own for the Setup screen's `<details>`. The bare name let that one
   win, so every line this one was meant to write came out as the string
   "[object Object]": no SUMMARY, so the phone showed each shift as "My
   event"; no LOCATION, so no address to tap; and no UID, so nothing could be
   updated or cancelled. The `ics` prefix its neighbours already carry is what
   keeps the two apart. */
function icsFold(l){
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

/* ---------- colour --------------------------------------------------------
   RFC 7986 lets an event carry a COLOR, and the value is not free text: it is
   a CSS3 colour *name*. The job colours in Setup come out of an `<input
   type="color">` and are hex. Something has to reconcile the two, and it is
   here for the same reason folding and escaping are — which values the file
   format will accept is a fact about the format, not about the store.

   What reads it is ICSx⁵, which maps the name onto the Android calendar
   provider's per-event colour; the Google Calendar app and its widget then
   draw the event in it. Nothing else in the chain looks at COLOR at all, and
   that is what makes this safe to send: a client that does not understand the
   property skips it, so the worst case is the calendar he already has. It is
   also why the colour is never the only signal — §25's argument stands, the
   job name is still in the SUMMARY, and this is the second thing that says
   which job it is rather than the first.

   The match is nearest-by-eye, not exact: 138 names cannot cover a picker
   with sixteen million, so `#2F4B7C` — no CSS3 colour at all — comes out as
   the one that looks most like it, `steelblue`.

   Which is why the distance is measured in CIELAB and not in RGB. Nearest in
   RGB is not nearest to the eye, and the cheap approximations are worse than
   they look: the first draft of this used "redmean", which weights green four
   times, and it answered `darkslateblue` for both the navy and the plum in
   the Setup palette — two jobs, one colour, and the feature quietly does
   nothing. Lab is the space distance was defined for. It costs a cube root
   per channel, on two colours, a hundred and thirty-eight times, once per job
   per feed.
   ---------------------------------------------------------------------- */

/* The CSS3 extended colour keywords, which is exactly the set RFC 7986 draws
   on. The grey/gray, cyan/aqua and magenta/fuchsia spellings name the same
   colours, so only one of each pair is here — a nearest match has no reason
   to prefer one spelling, and the one kept is the one every client has known
   since HTML 4. */
const CSS3_NAMES = {
  aliceblue:0xf0f8ff, antiquewhite:0xfaebd7, aqua:0x00ffff, aquamarine:0x7fffd4,
  azure:0xf0ffff, beige:0xf5f5dc, bisque:0xffe4c4, black:0x000000,
  blanchedalmond:0xffebcd, blue:0x0000ff, blueviolet:0x8a2be2, brown:0xa52a2a,
  burlywood:0xdeb887, cadetblue:0x5f9ea0, chartreuse:0x7fff00, chocolate:0xd2691e,
  coral:0xff7f50, cornflowerblue:0x6495ed, cornsilk:0xfff8dc, crimson:0xdc143c,
  darkblue:0x00008b, darkcyan:0x008b8b, darkgoldenrod:0xb8860b, darkgray:0xa9a9a9,
  darkgreen:0x006400, darkkhaki:0xbdb76b, darkmagenta:0x8b008b, darkolivegreen:0x556b2f,
  darkorange:0xff8c00, darkorchid:0x9932cc, darkred:0x8b0000, darksalmon:0xe9967a,
  darkseagreen:0x8fbc8f, darkslateblue:0x483d8b, darkslategray:0x2f4f4f,
  darkturquoise:0x00ced1, darkviolet:0x9400d3, deeppink:0xff1493, deepskyblue:0x00bfff,
  dimgray:0x696969, dodgerblue:0x1e90ff, firebrick:0xb22222, floralwhite:0xfffaf0,
  forestgreen:0x228b22, fuchsia:0xff00ff, gainsboro:0xdcdcdc, ghostwhite:0xf8f8ff,
  gold:0xffd700, goldenrod:0xdaa520, gray:0x808080, green:0x008000,
  greenyellow:0xadff2f, honeydew:0xf0fff0, hotpink:0xff69b4, indianred:0xcd5c5c,
  indigo:0x4b0082, ivory:0xfffff0, khaki:0xf0e68c, lavender:0xe6e6fa,
  lavenderblush:0xfff0f5, lawngreen:0x7cfc00, lemonchiffon:0xfffacd, lightblue:0xadd8e6,
  lightcoral:0xf08080, lightcyan:0xe0ffff, lightgoldenrodyellow:0xfafad2,
  lightgray:0xd3d3d3, lightgreen:0x90ee90, lightpink:0xffb6c1, lightsalmon:0xffa07a,
  lightseagreen:0x20b2aa, lightskyblue:0x87cefa, lightslategray:0x778899,
  lightsteelblue:0xb0c4de, lightyellow:0xffffe0, lime:0x00ff00, limegreen:0x32cd32,
  linen:0xfaf0e6, maroon:0x800000, mediumaquamarine:0x66cdaa, mediumblue:0x0000cd,
  mediumorchid:0xba55d3, mediumpurple:0x9370db, mediumseagreen:0x3cb371,
  mediumslateblue:0x7b68ee, mediumspringgreen:0x00fa9a, mediumturquoise:0x48d1cc,
  mediumvioletred:0xc71585, midnightblue:0x191970, mintcream:0xf5fffa,
  mistyrose:0xffe4e1, moccasin:0xffe4b5, navajowhite:0xffdead, navy:0x000080,
  oldlace:0xfdf5e6, olive:0x808000, olivedrab:0x6b8e23, orange:0xffa500,
  orangered:0xff4500, orchid:0xda70d6, palegoldenrod:0xeee8aa, palegreen:0x98fb98,
  paleturquoise:0xafeeee, palevioletred:0xdb7093, papayawhip:0xffefd5,
  peachpuff:0xffdab9, peru:0xcd853f, pink:0xffc0cb, plum:0xdda0dd,
  powderblue:0xb0e0e6, purple:0x800080, red:0xff0000, rosybrown:0xbc8f8f,
  royalblue:0x4169e1, saddlebrown:0x8b4513, salmon:0xfa8072, sandybrown:0xf4a460,
  seagreen:0x2e8b57, seashell:0xfff5ee, sienna:0xa0522d, silver:0xc0c0c0,
  skyblue:0x87ceeb, slateblue:0x6a5acd, slategray:0x708090, snow:0xfffafa,
  springgreen:0x00ff7f, steelblue:0x4682b4, tan:0xd2b48c, teal:0x008080,
  thistle:0xd8bfd8, tomato:0xff6347, turquoise:0x40e0d0, violet:0xee82ee,
  wheat:0xf5deb3, white:0xffffff, whitesmoke:0xf5f5f5, yellow:0xffff00,
  yellowgreen:0x9acd32
};

/* A feed is one colour per job and dozens of events, so the answer is worth
   keeping. Two jobs means this map never holds more than two entries. */
const CSS3_NEAREST = new Map();

/* Hex in, CSS3 name out — and the empty string for anything that is not a
   colour, which is the caller's signal to leave the property out entirely.
   Writing `COLOR:` with nothing after it, or with a hex a client cannot read,
   is worse than not writing it: one is a malformed line and the other is a
   value the spec does not allow. */
function icsColor(hex){
  const raw = String(hex || '').trim().replace(/^#/, '').toLowerCase();
  const key = /^[0-9a-f]{3}$/.test(raw) ? raw.replace(/(.)/g, '$1$1')
            : /^[0-9a-f]{6}$/.test(raw) ? raw
            : '';
  if(!key) return '';
  if(CSS3_NEAREST.has(key)) return CSS3_NEAREST.get(key);

  const want = cielab(parseInt(key, 16));
  let best = '', min = Infinity;
  for(const name in CSS3_NAMES){
    const has = cielab(CSS3_NAMES[name]);
    const d = (want[0] - has[0]) ** 2 + (want[1] - has[1]) ** 2 + (want[2] - has[2]) ** 2;
    if(d < min){ min = d; best = name; }
  }
  CSS3_NEAREST.set(key, best);
  return best;
}

/* 0xRRGGBB to CIELAB, by the standard route: undo sRGB's gamma, into XYZ
   under the D65 white point every sRGB colour is defined against, then into
   Lab. The constants are the ones in the sRGB and CIE definitions and are not
   tuning — nothing here is worth adjusting by taste. */
function cielab(v){
  const lin = c => (c /= 255) <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const r = lin((v >> 16) & 255), g = lin((v >> 8) & 255), b = lin(v & 255);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047,
        y = (0.2126 * r + 0.7152 * g + 0.0722 * b),
        z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/* UTC stamp, the only form DTSTAMP is allowed to take. */
function icsStamp(d = new Date()){
  return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

/* A local wall time as the file writes it: floating, no zone, because that is
   what every event this app publishes uses and a cancellation has to look
   like the thing it cancels. */
function icsLocal(date, time){
  return `${String(date).replace(/-/g, '')}T${String(time).replace(':', '')}00`;
}

/* ---------- the cancellation ---------------------------------------------
   §10.6: in manual-import mode a deleted shift keeps its calendar event and
   its alarms forever. Subscription mode is immune, because there the file is
   the whole calendar and a rebuild simply does not contain the shift any more.
   Manual import has no such moment — it only ever adds — so the removal has to
   be said out loud, and RFC 5545 has exactly one way to say it.

   Three things make it a cancellation rather than a wish:

   - `METHOD:CANCEL` on the calendar. It is a calendar-level property, which is
     why this cannot be appended to the publish file: one iCalendar object
     carries one method, and a file claiming PUBLISH while holding cancelled
     events is asking the importer to guess.
   - `STATUS:CANCELLED` on each event. Belt and braces, deliberately: the
     method is the instruction, the status is the same instruction written on
     the event itself, and importers vary in which one they read.
   - `SEQUENCE` above the one that published it. A calendar is entitled to
     ignore a revision that is not newer than what it holds, and an event this
     app published carries `SEQUENCE:0` unless it has been edited since.

   No VALARM goes in. The alarms are the thing being taken away, and an
   importer that half-understands the file should not be handed a fresh set.

   Records in, text out, and the caller keeps the store: each entry is
   { uid, seq, date, start, end, endDate, title } as app.js recorded it at the
   moment of deletion. It is recorded rather than looked up because by the time
   this runs the shift is gone, and so, often, is the job it belonged to.
   -------------------------------------------------------------------- */
function buildCancelICS(dead, opts = {}){
  const now = opts.now || icsStamp();
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Shift Deck//EN',
             'CALSCALE:GREGORIAN', 'METHOD:CANCEL', 'X-WR-CALNAME:Work Schedule'];
  (dead || []).forEach(t => {
    // Without a UID there is no event to name and the entry would cancel
    // whatever the importer felt like. Dropped, not guessed at.
    if(!t || !t.uid || !t.date || !t.start) return;
    L.push('BEGIN:VEVENT',
      icsFold(`UID:${t.uid}`),
      `DTSTAMP:${now}`,
      `SEQUENCE:${Number(t.seq) || 0}`,
      'STATUS:CANCELLED',
      `DTSTART:${icsLocal(t.date, t.start)}`);
    if(t.end) L.push(`DTEND:${icsLocal(t.endDate || t.date, t.end)}`);
    // The summary is not what identifies the event — the UID is — but an
    // importer that shows the user a confirmation shows this, and "cancelled:
    // what?" is a bad thing to be asked at a glance.
    L.push(icsFold('SUMMARY:' + icsEscape(t.title || 'Shift')));
    L.push('END:VEVENT');
  });
  L.push('END:VCALENDAR');
  return L.join('\r\n');
}

/* Node picks these up for the tests; the browser just gets the globals. */
if(typeof module !== 'undefined' && module.exports){
  module.exports = { ICS_FLAG, clean, unfold, splitOutsideQuotes, contentLine, unescapeText,
                     parseDT, zoneOffset, wallToUTC, partsIn, knownZone, resolve,
                     parseDuration, labelFor, placeName, roleFrom, eventUID, parseICS,
                     shiftUID, icsEscape, icsFold, icsColor, icsStamp, icsLocal, buildCancelICS };
}
