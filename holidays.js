/* ==========================================================================
   Statutory holidays, for the week generator.
   PROJECT.md §8.3, settled in §20.7.

   §16.3's first fortnight of real data contains the case this exists for: the
   DSI rota says Monday, and 7 September 2026 had no shift, because it is
   Labour Day. A generated week that emits a shift there would fire a 05:00
   alarm for work that does not exist, which §8.3 names as the thing that
   corrodes trust.

   **The row is marked, never skipped** (§20.7). A silent skip generalises from
   one observed holiday to every holiday for ever, and on the holiday he does
   work it produces a missing shift with nothing on screen to notice — the one
   failure this app exists to prevent, and by §8.3's own ranking the more
   expensive of the two. A flagged row in the review screen costs one tap
   either way, and the app never has to decide something it cannot know.

   These are rules rather than a typed-out table of dates because the rules do
   not expire: a table would run out in a few years and go quietly wrong at the
   end, and "quietly wrong later" is the failure mode this whole file exists to
   prevent. Everything here is arithmetic on a calendar — no network, no
   dependencies, nothing to keep up to date (§9).

   Which list applies is a per-company field: the two employers need not share
   a jurisdiction, and a job with none set gets no holiday flags at all.
   ========================================================================== */

/* Weekend-adjacent dates are marked too. A holiday falling on a Saturday or a
   Sunday is generally taken on the neighbouring weekday — Québec's own rule
   for Canada Day on a Sunday says exactly that — and this net is deliberately
   the generous one: an extra flagged row costs a tap, a missed one costs an
   alarm at five in the morning. */
const HOL_OBSERVED = true;

const HOLIDAYS = {
  QC: {
    name: 'Québec',
    rules: [
      { kind:'fixed', month:1,  day:1,  name:'New Year’s Day', observed: HOL_OBSERVED },
      { kind:'easter', offset:-2, name:'Good Friday' },
      { kind:'easter', offset: 1, name:'Easter Monday' },
      // The Monday strictly before 25 May: Journée nationale des patriotes.
      { kind:'monBefore', month:5, day:25, name:'National Patriots’ Day' },
      { kind:'fixed', month:6,  day:24, name:'Fête nationale', observed: HOL_OBSERVED },
      { kind:'fixed', month:7,  day:1,  name:'Canada Day', observed: HOL_OBSERVED },
      { kind:'nth',   month:9,  dow:1, nth: 1, name:'Labour Day' },
      { kind:'nth',   month:10, dow:1, nth: 2, name:'Thanksgiving' },
      { kind:'fixed', month:12, day:25, name:'Christmas Day', observed: HOL_OBSERVED }
    ]
  },
  US: {
    name: 'United States',
    rules: [
      { kind:'fixed', month:1,  day:1,  name:'New Year’s Day', observed: HOL_OBSERVED },
      { kind:'nth',   month:1,  dow:1, nth: 3, name:'Martin Luther King Jr. Day' },
      { kind:'nth',   month:2,  dow:1, nth: 3, name:'Washington’s Birthday' },
      { kind:'nth',   month:5,  dow:1, nth:-1, name:'Memorial Day' },
      { kind:'fixed', month:6,  day:19, name:'Juneteenth', observed: HOL_OBSERVED },
      { kind:'fixed', month:7,  day:4,  name:'Independence Day', observed: HOL_OBSERVED },
      { kind:'nth',   month:9,  dow:1, nth: 1, name:'Labor Day' },
      { kind:'nth',   month:10, dow:1, nth: 2, name:'Columbus Day' },
      { kind:'fixed', month:11, day:11, name:'Veterans Day', observed: HOL_OBSERVED },
      { kind:'nth',   month:11, dow:4, nth: 4, name:'Thanksgiving' },
      { kind:'fixed', month:12, day:25, name:'Christmas Day', observed: HOL_OBSERVED }
    ]
  }
};

/* UTC throughout, for the same reason the overlap check is (§19.2): this is
   arithmetic on a calendar date, not a moment in time. */
const holISO = (y, m, d) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth()+1).padStart(2,'0')}-${
    String(t.getUTCDate()).padStart(2,'0')}`;
};
const holDow = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();

/* The nth given weekday of a month; nth of -1 means the last one. */
function nthWeekday(y, month, dow, nth){
  if(nth < 0){
    const last = new Date(Date.UTC(y, month, 0)).getUTCDate();
    return last - ((holDow(y, month, last) - dow + 7) % 7);
  }
  const first = holDow(y, month, 1);
  return 1 + ((dow - first + 7) % 7) + (nth - 1) * 7;
}

/* Easter Sunday, by the anonymous Gregorian algorithm. Good Friday and Easter
   Monday are the two Québec lets an employer choose between, so both are
   marked — this asks a question rather than answering one. */
function easterSunday(y){
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/* Every holiday in one year for one place, as { 'YYYY-MM-DD': name }. */
function holidaysIn(year, place){
  const set = HOLIDAYS[place];
  const out = {};
  if(!set || !Number.isInteger(year)) return out;

  const put = (iso, name) => { if(!out[iso]) out[iso] = name; };

  for(const r of set.rules){
    if(r.kind === 'fixed'){
      put(holISO(year, r.month, r.day), r.name);
      if(r.observed){
        const dow = holDow(year, r.month, r.day);
        // Saturday is taken on the Friday before, Sunday on the Monday after.
        if(dow === 6) put(holISO(year, r.month, r.day - 1), `${r.name} (observed)`);
        if(dow === 0) put(holISO(year, r.month, r.day + 1), `${r.name} (observed)`);
      }
    }else if(r.kind === 'nth'){
      put(holISO(year, r.month, nthWeekday(year, r.month, r.dow, r.nth)), r.name);
    }else if(r.kind === 'monBefore'){
      // Strictly preceding: when 25 May is itself a Monday the day is the 18th,
      // which is what Québec did in 2020 and the one year the naive modulo
      // would get wrong.
      const dow = holDow(year, r.month, r.day);
      put(holISO(year, r.month, r.day - (((dow - 1 + 7) % 7) || 7)), r.name);
    }else if(r.kind === 'easter'){
      const e = easterSunday(year);
      put(holISO(year, e.month, e.day + r.offset), r.name);
    }
  }
  return out;
}

/* What, if anything, falls on this date. Null for a job with no jurisdiction
   set, which is the default and stays the default: a wrong holiday list would
   flag the ordinary week, and §19.1 is the record of what a warning that fires
   on the ordinary case does to every other warning beside it. */
function holidayOn(isoDate, place){
  const m = /^(\d{4})-\d{2}-\d{2}$/.exec(String(isoDate || ''));
  if(!m || !HOLIDAYS[place]) return null;
  return holidaysIn(+m[1], place)[isoDate] || null;
}

/* For the setup screen's picker. */
function holidayPlaces(){
  return Object.keys(HOLIDAYS).map(k => ({ id: k, name: HOLIDAYS[k].name }));
}

if(typeof module !== 'undefined' && module.exports){
  module.exports = { HOLIDAYS, holidaysIn, holidayOn, holidayPlaces,
                     nthWeekday, easterSunday };
}
