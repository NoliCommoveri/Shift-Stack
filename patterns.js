/* ==========================================================================
   Declared shift patterns, and the plausibility check built on them.
   PROJECT.md §8.2.

   The documented top risk is that am/pm rides on one character (§6), and §16.2
   showed it happening on real input: "8:00 pm" came back as 08:00, twelve
   hours out and perfectly plausible on its face. The mitigation up to now was
   "a human glances at the list", which is a control that decays exactly when
   vigilance does.

   Learning normal start times from history was considered and rejected: the
   history is the parser's own unvalidated output, so one bad am/pm import that
   gets committed becomes evidence, and a check that gets quieter each time it
   fails is worse than no check. What this module compares against instead is a
   list the human declared — a rota he knows, typed once.

       co.patterns = [
         { days:[1,2,3,5], start:'15:00', end:'23:00' },  // DSI: can generate
         { start:'09:00', end:'17:00' }                   // PRN: checking only
       ]

   One field distinguishes the two jobs with no mode switch. A pattern with
   `days` describes which days the job runs and can therefore generate a week
   (§8.3); one without is only ever used for checking.

   `days` are getDay() numbers, 0 = Sunday, and they name the day the shift
   *starts* — a 19:15-07:15 Saturday night is Saturday, the same day the shift
   record is filed under.

   Nothing here touches the DOM or storage. app.js decides which rows to run it
   over and turns the codes below into sentences.
   ========================================================================== */

/* Flag codes, same contract as parser.js: codes here, wording in app.js. */
const PAT_FLAG = {
  FLIPPED: 'flipped',  // exactly 12h from a declared shift, and corrected
  OFFPAT:  'offpat',   // patterns are declared for this job and none matched
  ODDLEN:  'oddlen'    // no pattern needed: this is not the length of a shift
};

/* Snapping must never be silent (§8.2). If the employer genuinely moves a
   shift and OCR reads it correctly, snapping it back to the declared time
   makes him late, and there is no screenshot discrepancy left to notice. So
   the two tolerances below are deliberately narrow and everything between them
   is left alone and flagged instead.

   SNAP_MINS  a few minutes out is the same shift read sloppily
   FLIP_MINS  exactly twelve hours is not a coincidence, it is a meridiem  */
const SNAP_MINS = 5;
const FLIP_MINS = 720;

/* A shift shorter than this or longer than it is worth a second look whatever
   the job. The longest real shift in the data is 12h (§16.3); §16.2's misread
   produced a 16h one. These need no configuration, which is why they still
   apply to a job with no patterns declared at all. */
const MIN_SHIFT_MINS = 60;
const MAX_SHIFT_MINS = 14 * 60;

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const patMins = t => { const m = HHMM.exec(String(t||'')); return m ? +m[1]*60 + +m[2] : null; };

/* Minutes between two times of day, ignoring which came first: 0 to 720. */
function clockGap(a, b){
  const d = Math.abs(a - b) % 1440;
  return Math.min(d, 1440 - d);
}

/* How long a shift runs, in minutes, taking end <= start as overnight. This
   duplicates durMins() in app.js rather than importing it, because that one
   takes a shift record and this file deliberately knows nothing about them. */
function spanMins(start, end){
  const a = patMins(start), b = patMins(end);
  if(a === null || b === null) return null;
  const d = b - a;
  return d > 0 ? d : d + 1440;
}

/* Take whatever is on the company record and return only what can be reasoned
   about. A pattern with an unreadable time is not a weaker pattern, it is not
   a pattern — silently dropping it is right, because the alternative is a
   check that quietly compares against nonsense. An empty `days` is dropped
   rather than kept as [], so "no days ticked" reads as "checking only"
   everywhere downstream instead of "runs on no days". */
function validPatterns(list){
  return (Array.isArray(list) ? list : []).map(p => {
    if(!p || patMins(p.start) === null || patMins(p.end) === null) return null;
    const days = [...new Set((Array.isArray(p.days) ? p.days : [])
      .map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
    const out = { start: p.start, end: p.end };
    if(days.length) out.days = days;
    return out;
  }).filter(Boolean);
}

/* Which patterns could describe a shift starting on this weekday. A pattern
   with no `days` describes any day. A null weekday means the row has no date
   yet — §16.1 put every row on a real screen in exactly that state — so every
   pattern stays a candidate and only the times get judged.

   This is also how the two kinds compose on one job: declare a rota with days
   and a catch-all without, and the catch-all keeps the rota's days from
   flagging the extra shifts. */
function patternsFor(patterns, dow){
  return patterns.filter(p => !p.days || dow === null || dow === undefined || p.days.includes(dow));
}

/* One end of a shift against one end of a pattern. */
function endFit(read, want){
  const a = patMins(read), b = patMins(want);
  if(a === null || b === null) return null;
  if(a === b) return { kind: 'exact', gap: 0 };
  const gap = clockGap(a, b);
  if(gap <= SNAP_MINS) return { kind: 'snap', gap };
  if(gap === FLIP_MINS) return { kind: 'flip', gap };
  return null;                       // an hour or two off: a different shift
}

/* The check. `row` is { date, start, end } and `patterns` is the job's
   declared list, already validated. Returns what the times should be, the
   codes that go on the row, and the original reading so the caller can say
   what it changed. It never decides anything from `row`'s own history, and it
   never mutates its argument.

   Distance decides the behaviour, exactly as §8.2's table sets it out:

     exactly +/-12h   an am/pm flip. Corrected, and flagged so the correction
                      is visible rather than silent
     a few minutes    the same shift read sloppily. Snapped, no flag
     an hour or two   not this shift. Left alone and flagged
     no patterns      only the length check below, which needs no config
*/
function checkShift(row, patterns){
  const pats = validPatterns(patterns);
  const out = { start: row.start, end: row.end, flags: [], read: null, pattern: null };

  const long = spanMins(row.start, row.end);
  if(long !== null && (long < MIN_SHIFT_MINS || long > MAX_SHIFT_MINS))
    out.flags.push(PAT_FLAG.ODDLEN);

  // A half-read row is already flagged and already asking to be filled in
  // (§16.2a). Matching it on the one time it has would mean inventing the
  // other from a pattern, and guessing from wreckage is what put the twelve
  // hours in in the first place.
  if(patMins(row.start) === null || patMins(row.end) === null || !pats.length) return out;

  const dow = row.date ? new Date(row.date + 'T12:00:00').getDay() : null;
  const cands = patternsFor(pats, dow);

  let best = null;
  for(const p of cands){
    const s = endFit(row.start, p.start), e = endFit(row.end, p.end);
    if(!s || !e) continue;
    const flips = (s.kind === 'flip' ? 1 : 0) + (e.kind === 'flip' ? 1 : 0);
    const gap = s.gap + e.gap;
    // Fewest flips first, then closest. A pattern that fits without claiming a
    // misread always wins over one that has to claim a misread to fit, so a
    // job whose declared shifts are twelve hours apart is not turned into a
    // machine for inventing flips.
    if(!best || flips < best.flips || (flips === best.flips && gap < best.gap))
      best = { p, flips, gap, s, e };
  }

  if(!best){
    out.flags.push(PAT_FLAG.OFFPAT);
    return out;
  }

  out.pattern = best.p;
  if(best.gap === 0) return out;                       // already exactly right

  out.read = { start: row.start, end: row.end };
  out.start = best.p.start;
  out.end = best.p.end;
  if(best.flips) out.flags.push(PAT_FLAG.FLIPPED);
  // A snap with no flip is deliberately silent: minutes are the reader being
  // untidy, and a warning on every one of those is how a review screen stops
  // being read at all.

  // The correction can turn an impossible length into a sensible one, and an
  // ODDLEN raised against what was read has nothing to say about what was
  // filed. Recompute rather than leave the stale one standing.
  const fixed = spanMins(out.start, out.end);
  out.flags = out.flags.filter(f => f !== PAT_FLAG.ODDLEN);
  if(fixed !== null && (fixed < MIN_SHIFT_MINS || fixed > MAX_SHIFT_MINS))
    out.flags.push(PAT_FLAG.ODDLEN);

  return out;
}

/* §8.2's "build from what's on file". Typing a rota out is the sort of chore
   that gets skipped, so offer the distinct start/end pairs already filed for
   this job with a count against each, and let him tick the real ones.

   This looks like the learning-from-history idea that was rejected above, and
   the difference is the whole point: nothing here is applied to anything. It
   is a list of candidates a human then filters, and the filtering is what
   stops the parser's own output becoming authority.

   `days` come back as the days that pair was actually filed on, which is a
   sensible starting tick rather than a claim — a fortnight of DSI gives back
   [1,2,3,5] (§16.3) and he confirms it. */
function suggestPatterns(shifts){
  const seen = new Map();
  for(const s of (shifts || [])){
    if(patMins(s.start) === null || patMins(s.end) === null) continue;
    const k = s.start + '-' + s.end;
    if(!seen.has(k)) seen.set(k, { start: s.start, end: s.end, count: 0, days: new Set() });
    const e = seen.get(k);
    e.count++;
    if(s.date) e.days.add(new Date(s.date + 'T12:00:00').getDay());
  }
  return [...seen.values()]
    .map(e => ({ start: e.start, end: e.end, count: e.count, days: [...e.days].sort() }))
    .sort((a, b) => b.count - a.count || a.start.localeCompare(b.start));
}

/* Node picks these up for the tests; the browser just gets the globals. */
if(typeof module !== 'undefined' && module.exports){
  module.exports = { PAT_FLAG, SNAP_MINS, FLIP_MINS, MIN_SHIFT_MINS, MAX_SHIFT_MINS,
                     clockGap, spanMins, validPatterns, patternsFor, endFit,
                     checkShift, suggestPatterns };
}
