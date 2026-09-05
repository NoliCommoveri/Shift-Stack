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
         { days:[1,2,3,5], start:'15:00', end:'23:00',    // DSI: can generate
           roleId:'r1', siteId:'s1' },
         { start:'09:00', end:'17:00' }                   // PRN: checking only
       ]

   One field distinguishes the two jobs with no mode switch. A pattern with
   `days` describes which days the job runs and can therefore generate a week
   (§8.3); one without is only ever used for checking.

   `roleId` and `siteId` are §27's, and both are optional. A declared shift is
   the one place in the app that knows what he normally does and where — the
   generator used to guess both by rummaging through the most recent shift on
   file with the same times, which was a guess about money as soon as the role
   carried a rate. Declared, it is a fact he typed. Nothing here reads them:
   they are carried through validation and out of the generator untouched,
   because what a role means is app.js's business and this file only has to not
   lose them.

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
  ODDLEN:  'oddlen',   // no pattern needed: this is not the length of a shift
  CLASH:   'clash'     // he cannot work this, he is already somewhere else
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
    // Carried, never judged. An id pointing at a record that has since been
    // deleted is the caller's problem to notice, and it resolves to nothing
    // rather than to something wrong.
    if(p.roleId) out.roleId = p.roleId;
    if(p.siteId) out.siteId = p.siteId;
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

/* ==========================================================================
   Generating a week from a declared rota.
   PROJECT.md §8.3, with the corrections in §20.

   `days` is what makes a pattern generative, and it has meant that since §18.2
   — a pattern with days describes which days the job runs and can therefore
   fill a week; one without is only ever compared against. So this is the whole
   of the generator: the days he ticked, over the dates he asked for.

   Everything a generated row still needs — the site label, the address, the
   holiday flag, whether the slot is already filled — is the app's, because
   every one of those is a lookup into stored shifts or a company field. What
   is here takes patterns and dates and nothing else, which is what makes it
   testable the way §18 and §19 are.
   ========================================================================== */

/* An ISO date back from a day number. `dayNum` above is the other direction,
   and both are UTC for the reason given there. */
function isoFromDayNum(n){
  if(!Number.isFinite(n)) return null;
  const d = new Date(n * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${
    String(d.getUTCDate()).padStart(2,'0')}`;
}

/* getDay() numbers, 0 = Sunday, straight off the number line rather than out
   of a local-time Date: 1 January 1970 was a Thursday, which is the 4. */
function dowOf(isoDate){
  const n = dayNum(isoDate);
  return n === null ? null : ((n + 4) % 7 + 7) % 7;
}

/* `len` dates from `startISO`. A week by default, and the caller decides which
   day a week starts on — this file has no opinion and app.js takes the pay
   week, which is the one he chose a meaning for (§20.8). */
function weekDates(startISO, len = 7){
  const n = dayNum(startISO);
  if(n === null || !(len > 0)) return [];
  return Array.from({ length: Math.floor(len) }, (_, i) => isoFromDayNum(n + i));
}

/* The rows a rota puts on those dates: { date, start, end }, in order.

   Only patterns with `days` generate. A half-typed one is dropped first by
   validPatterns(), so a rota being entered while a week is filled cannot emit
   a shift with no times in it, and the same pattern declared twice emits one
   row rather than two — nothing stops him adding it twice, and two identical
   rows in review would look like two shifts he is expected to work.

   `days` name the day the shift *starts*, so a Saturday 19:15-07:15 pattern
   fills Saturday and is filed under Saturday. That is where the record goes
   and what absSpan() below already expects, so the overlap check sees a
   generated night running into the next morning exactly as it sees a real one. */
function generateWeek(patterns, dates){
  const pats = validPatterns(patterns).filter(p => p.days);
  const seen = new Set();
  const out = [];
  for(const date of (dates || [])){
    const dow = dowOf(date);
    if(dow === null) continue;
    for(const p of pats){
      if(!p.days.includes(dow)) continue;
      // Deliberately keyed on the slot alone, not on what the pattern says he
      // is doing in it. Two declared shifts at the same hours on the same day
      // are one shift declared twice, and generating both would put him on the
      // calendar in two places at once.
      const k = `${date} ${p.start} ${p.end}`;
      if(seen.has(k)) continue;
      seen.add(k);
      const row = { date, start: p.start, end: p.end };
      if(p.roleId) row.roleId = p.roleId;
      if(p.siteId) row.siteId = p.siteId;
      out.push(row);
    }
  }
  return out.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}

/* Whether a job can fill a week at all. The button says so before it is
   pressed rather than filling nothing and leaving him wondering. */
function canGenerate(patterns){
  return validPatterns(patterns).some(p => p.days);
}

/* ==========================================================================
   Overlap, the other half of §8.2's no-config row.

   This is the one failure in the app with no recovery. A misread time is
   embarrassing; two shifts booked over each other means he is contracted to be
   in two places at once and finds out on the day.

   **Only real overlap counts.** An earlier version of this warned about tight
   turnarounds too — under an hour between two shifts — and that is wrong for
   these two jobs: going straight from one to the other is normal and common,
   so the warning fired constantly on nothing and taught him to scroll past it.
   A warning that cries wolf on the ordinary case is worse than no warning,
   because it is the same warning that has to carry the case that matters.

   Everything below works on an absolute timeline rather than within a day,
   which the real data forces: Trupoint's shifts are 19:15-07:15 and
   00:15-08:15 (§16.3), so overnight is that job's normal shape and the
   collision to catch is a night shift running into the next morning's. A check
   that compared shifts inside a single date could never see it.
   ========================================================================== */

/* Days since 1970 for an ISO date, so two shifts on different dates can be put
   on one number line. Deliberately UTC: this is arithmetic on a calendar date,
   not a moment in time, and a local-time reading of it would shift by a day
   somewhere in the world. */
function dayNum(isoDate){
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ''));
  return m ? Math.round(Date.UTC(+m[1], +m[2]-1, +m[3]) / 86400000) : null;
}

/* A shift as [from, to) in minutes on that line. An end at or before the start
   is overnight and runs past the end of its own day, which is the whole reason
   this is not done inside a date. */
function absSpan(sh){
  if(!sh) return null;
  const d = dayNum(sh.date), a = patMins(sh.start), b = patMins(sh.end);
  if(d === null || a === null || b === null) return null;
  const from = d * 1440 + a;
  return { from, to: from + (b > a ? b - a : b - a + 1440) };
}

/* Minutes two shifts are both scheduled for. Zero when one ends exactly as the
   other starts — that is a handover, not a clash, and it is the ordinary case
   this must stay quiet about. */
function clashMins(a, b){
  const x = absSpan(a), y = absSpan(b);
  if(!x || !y) return 0;
  return Math.max(0, Math.min(x.to, y.to) - Math.max(x.from, y.from));
}

/* Everything in `others` that `row` cannot be worked alongside, worst first.
   A row is never compared with itself: `sameAs` says which of the others is
   this same shift seen from somewhere else — the record a review row is about
   to replace, or the row's own entry in a list it is part of.

   A row missing a date or a time simply has no span, so it clashes with
   nothing. That is right rather than lenient: it is already flagged and asking
   to be completed, and inventing the missing half to test it against would be
   inventing the answer. */
function findClashes(row, others, sameAs){
  if(!absSpan(row)) return [];
  return (others || [])
    .filter(o => o && !(sameAs && sameAs(o)))
    .map(o => ({ shift: o, mins: clashMins(row, o) }))
    .filter(c => c.mins > 0)
    .sort((a, b) => b.mins - a.mins);
}

/* Every colliding pair in one list, each reported once. Used for the standing
   warning over the schedule, where the question is not "is this new row safe"
   but "is anything on file already wrong". */
function clashPairs(shifts){
  const list = (shifts || []).filter(s => absSpan(s));
  const out = [];
  for(let i = 0; i < list.length; i++)
    for(let j = i + 1; j < list.length; j++){
      const m = clashMins(list[i], list[j]);
      if(m > 0) out.push({ a: list[i], b: list[j], mins: m });
    }
  return out.sort((x, y) => y.mins - x.mins);
}

/* ---------- rest between shifts (§25) ------------------------------------
   How long he is off between one shift and the next, and whether that is a
   length worth saying out loud.

   §19 deleted a turnaround warning and the reason it did has to be answered
   before anything here is allowed to exist. That one fired on any two shifts
   under an hour apart, which for these two jobs is the ordinary week — he goes
   straight from one to the other — so it fired constantly on nothing and
   taught him to scroll past the line that also carries the double-booking.

   This is not that warning re-tuned, and the difference is which case is
   silent — or rather, which case is a warning. Over eight hours there is a
   night's sleep in it and nothing to say at all. Under an hour he is going
   straight from one job to the other, which is his ordinary week: §40 prints
   that in the week list as a plain statement of the join and never as a
   warning, never on the banner, and never as an alarm, because the moment it
   is any of those three it is §19's warning again. The band in between is the
   one worth a heads up, and whether he knows about it before he gets home
   decides whether he sleeps four hours on purpose or wakes up with ninety
   minutes left.

   Every one of them states the gap and stops. They propose nothing — how he
   spends six hours is not this app's business, and a warning that gives advice
   is one he has to disagree with rather than read.

   Absolute timeline again, for §19.2's reason: Trupoint runs 19:15-07:15 and
   00:15-08:15, so the rest that matters is nearly always measured across
   midnight and a check that worked inside a date could not see it.
   -------------------------------------------------------------------- */

/* The two numbers that cut the timeline into three bands. Both are the
   human's rather than derived ones, which is why they are stated here and not
   computed from a sleep figure somewhere else.

   At or under BACK_TO_BACK he is going straight on — one ends, the other
   starts, and an hour is as much of a break as that leaves room for. Over
   REST_MAX there is a night in it. In between he is home without a night in
   it, which is the band §25 was built for.

   §25 put the floor of that middle band at two hours, on the grounds that
   under two he is not coming home at all. That is still true and §40 says it
   is no longer a reason for silence: the hour between one and two is the case
   where he is neither home nor going straight on, and being told "1 hour and
   45 minutes off" is exactly what that hour is for. So the floor moved down to
   an hour, and what is under it is not silence any more — it is the other
   message. */
const BACK_TO_BACK_MINS = 60;
const REST_MAX_MINS = 480;

/* The bands, as predicates, so the surfaces that ask cannot drift apart on the
   boundaries — and so the two cannot overlap or leave a gap between them,
   since one constant is the top of the first and the floor of the second.

   Back to back is closed at both ends. No gap at all is the truest case of it
   and has to be in, and an hour is the number Ray gave. The turnaround band is
   therefore open at the bottom, and open at the top as it always was: exactly
   an hour is back to back, exactly eight is a night's sleep. */
function isBackToBack(mins){
  return Number.isFinite(mins) && mins >= 0 && mins <= BACK_TO_BACK_MINS;
}
function isShortRest(mins){
  return Number.isFinite(mins) && mins > BACK_TO_BACK_MINS && mins < REST_MAX_MINS;
}

/* Every join between consecutive shifts, in order, with the time off across
   it. Zero is in — that is the shift that starts as the last one ends, and
   §40's back-to-back line is about exactly that. It is not rest, and nothing
   here calls it rest: the predicates above say which band a number is in, and
   `isShortRest` has never been true of zero and still is not.

   Two things stop this being a sort and a subtraction.

   **The previous shift is not the one before it in the list.** A shift wholly
   inside another — which happens, and is separately flagged as a clash — would
   otherwise end the pair early and report a rest that includes hours he is
   still at work. So the sweep carries the furthest end reached so far, not the
   end of the last shift started.

   **A shift nobody can read breaks the chain.** A row with a date and no
   usable times has no place on the timeline, and skipping over it would join
   the shifts either side and measure a gap with a shift sitting in it. The
   number would be wrong and it would name the wrong two shifts, so no gap is
   reported across a day holding one. That is a silence about something real,
   which is the right way round: the row is already flagged and asking to be
   completed. */
function restGaps(shifts){
  const spans = [], murky = new Set();
  (shifts || []).forEach(s => {
    const sp = absSpan(s);
    if(sp) spans.push({ shift: s, from: sp.from, to: sp.to });
    else { const d = dayNum(s && s.date); if(d !== null) murky.add(d); }
  });
  spans.sort((a, b) => a.from - b.from || a.to - b.to);

  // A gap is unreadable if any day holding an unplaceable shift touches it.
  const readable = (from, to) => ![...murky].some(d => d * 1440 < to && (d + 1) * 1440 > from);

  const out = [];
  let prev = spans[0];
  for(let i = 1; i < spans.length; i++){
    const next = spans[i];
    const mins = next.from - prev.to;
    // Negative is a clash, and it stays out: it is not a gap at all, it is two
    // shifts on top of each other, and it has its own warning that says
    // something this one must not muddy.
    if(mins >= 0 && readable(prev.to, next.from))
      out.push({ a: prev.shift, b: next.shift, mins });
    if(next.to > prev.to) prev = next;
  }
  return out;
}

/* Node picks these up for the tests; the browser just gets the globals. */
if(typeof module !== 'undefined' && module.exports){
  module.exports = { PAT_FLAG, SNAP_MINS, FLIP_MINS, MIN_SHIFT_MINS, MAX_SHIFT_MINS,
                     clockGap, spanMins, validPatterns, patternsFor, endFit,
                     checkShift, suggestPatterns,
                     isoFromDayNum, dowOf, weekDates, generateWeek, canGenerate,
                     dayNum, absSpan, clashMins, findClashes, clashPairs,
                     BACK_TO_BACK_MINS, REST_MAX_MINS,
                     isBackToBack, isShortRest, restGaps };
}
