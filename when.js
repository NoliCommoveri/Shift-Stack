/* ==========================================================================
   What the clock says about the shift he is in, or the one coming. §49.

   Two screens ask the same question — the banner at the top of Schedule, and
   the card that comes up when the app is opened — and both ask it of both
   phones. Written twice that would be four copies of one arithmetic, and the
   way that fails is not a crash: it is a banner saying one thing and a card
   saying another about the same shift, on the same screen, an hour apart.

   So the arithmetic is here, once, and it is pure. Nothing in this file reads
   `S` or `V` or a global store: it takes the shifts and the clock as
   arguments, and the two pages hand it their own. `whenPrompt` is the one
   exception — it draws — and all it draws is three lines of that arithmetic.
   ========================================================================== */

/* Forty-five minutes before the start, he is out of the door. That is the same
   number kids.js calls LEAVE_PAD (§46), and it is the same fact: what the door
   costs before a shift. A second name because both files can end up loaded on
   one page one day and two `const`s of one name is a page that does not run
   at all; `tests/config.test.js` asserts the numbers agree, which is the half
   that matters. */
const LEAVE_LEAD = 45;

/* Ten minutes. Switching out to check a message and coming back is not an
   opening, and a card that greets every one of those is a card he learns to
   dismiss without reading — which is the same as not having it, except worse,
   because it is also in the way. */
const WHEN_QUIET = 600;

/* durMins is feed.js's — it is what the calendar file measures a shift with,
   and a second copy here is how a shift ends at two different times. Node gets
   it by require, the browser by the <script> tag loaded before this one. */
const _whenDur = (() => {
  try { return require('./feed.js').durMins; } catch(e){ /* not Node */ }
  try { return durMins; } catch(e){ /* not the page either */ }
  return null;
})();
if(typeof _whenDur !== 'function')
  throw new Error('when.js needs durMins, and neither require nor the page provided it');

/* The next shift that has not finished — the one in progress if there is one,
   because a shift he is standing in is the next thing the clock has to say
   something about. Wall time, read on the phone's own zone, which is what
   `${date}T${start}` means to a browser and is the whole reason §14.10 keeps
   the zone out of the stored strings.

   Everything the two callers need comes back on the one object, so that no
   caller has to redo the subtraction and get a different answer:
     at    when it starts        end   when it ends
     to    minutes until it starts (negative once it has)
     left  minutes until it ends
     lead  minutes until he has to leave
     on    true while he is in it                                          */
function whenNext(shifts, now){
  const t = (now || new Date()).getTime();
  const cands = (shifts || [])
    .map(s => ({ s, at: new Date(`${s.date}T${s.start}:00`) }))
    .filter(x => !isNaN(x.at.getTime()) && x.at.getTime() + _whenDur(x.s) * 60000 > t)
    .sort((a, b) => a.at - b.at);
  const n = cands[0];
  if(!n) return null;
  n.end  = new Date(n.at.getTime() + _whenDur(n.s) * 60000);
  n.on   = n.at.getTime() <= t;
  n.to   = Math.round((n.at.getTime() - t) / 60000);
  n.left = Math.round((n.end.getTime() - t) / 60000);
  n.lead = Math.round((n.at.getTime() - LEAVE_LEAD * 60000 - t) / 60000);
  return n;
}

/* "2h 05m" is a code. "45 min" and "2h 5m" are the two shapes the banner has
   always used and they are kept, because the countdown line above this one is
   the thing being read against. */
function whenClock(m){
  if(m < 0) m = 0;
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

/* The line the banner already had, moved here so that the line under it
   cannot come to a different view of the same minute. */
function whenCountdown(n){
  if(!n) return '';
  if(n.on) return 'On shift now';
  if(n.to < 60) return `Starts in ${n.to} min`;
  if(n.to < 1440) return `Starts in ${Math.floor(n.to / 60)}h ${n.to % 60}m`;
  return `In ${Math.round(n.to / 1440)} days`;
}

/* The second line: not when the shift is, which the line above says, but what
   he has to do about it and when.

   On shift, that is when it lets him go. Off it, that is when he has to be out
   of the door, which is the start less §46's forty-five minutes and is the
   number he actually sets an alarm by. Past that and there is no countdown
   left to give — it says so rather than counting up.

   Empty beyond a day out: "Leave in 2 days" under "In 3 days" is two roundings
   of one wait, disagreeing, and neither is a thing to do today. */
function whenLead(n){
  if(!n) return '';
  if(n.on) return `Off in ${whenClock(n.left)}`;
  if(n.to >= 1440) return '';
  return n.lead <= 0 ? 'Leave now' : `Leave in ${whenClock(n.lead)}`;
}

/* 24-hour, for app.js's reason: am/pm is the one character in this app that
   can be misread into a missed shift. */
function whenAt(d){
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

/* The same gap in words, for a sentence rather than a column. "6h 45m" is
   right beside the shift lengths it is compared against and wrong in the
   middle of a line of prose, where it reads as a code.

   Past a day the minutes go: "2 days and 3 hours" is what a wait that long is
   known to, and "2 days and 3 hours and 12 minutes" is a false precision about
   a shift that has not been confirmed yet. */
function fmtDurWords(m){
  const h = Math.floor(m / 60), r = m % 60;
  const bits = [];
  if(h) bits.push(`${h} hour${h === 1 ? '' : 's'}`);
  if(r) bits.push(`${r} minute${r === 1 ? '' : 's'}`);
  return bits.join(' and ') || '0 minutes';
}
function whenWordy(m){
  if(m < 0) m = 0;
  if(m < 1440) return fmtDurWords(m);
  const d = Math.floor(m / 1440), h = Math.round((m % 1440) / 60);
  return `${d} day${d === 1 ? '' : 's'}` + (h ? ` and ${h} hour${h === 1 ? '' : 's'}` : '');
}

/* The one sentence the card exists to say. Off shift it is the next start; on
   shift it is the end of the one he is in, because "work in 9 hours" said to a
   man three hours into a twelve is the wrong question answered. */
function whenLine(n){
  if(!n) return '';
  return n.on ? `Off in ${whenWordy(n.left)}` : `Work in ${whenWordy(n.to)}`;
}

/* ---------- the card on opening -----------------------------------------
   An installed PWA that is switched away from is not closed: the page stays
   loaded, and coming back fires no `load`. What it does fire is
   `visibilitychange`, and — if the page was frozen or killed and restored —
   `pageshow`. `whenWake` binds both and lets `whenPrompt`'s own floor sort out
   the double, which is simpler than deciding which of the two counts as the
   opening.

   The floor is kept in localStorage rather than in a variable, because the
   case it is for is the one where there is no variable left: Android stopping
   the app in the background and rebuilding it on the next tap looks, to this
   file, exactly like a first run.

   Both pages are on one origin and so share one localStorage, hence the key
   per page. Two apps writing one "last shown" would each suppress the other's
   card, which is the sort of bug that gets called "it only shows sometimes".  */
function whenPrompt(shifts, opts){
  const o = opts || {};
  const dlg = document.getElementById('dlg');
  const body = document.getElementById('dlgbody');
  if(!dlg || !body || dlg.open) return false;

  const now = o.now || new Date();
  const n = whenNext(shifts, now);
  if(!n) return false;                        // nothing on file, nothing to say

  const key = 'when-prompt-' + (o.key || 'app');
  const t = now.getTime();
  let last = 0;
  try { last = Number(localStorage.getItem(key)) || 0; } catch(e){ /* blocked */ }
  if(t - last < WHEN_QUIET * 1000 && !o.force) return false;
  try { localStorage.setItem(key, String(t)); } catch(e){ /* blocked */ }

  /* Three lines and nothing else. This is a flag, not a briefing: the shift,
     the job, the site and the length are all on the screen behind it, and a
     card that repeats them is a card to be read rather than glanced at. What
     it is for is the one number, so the one number is what is big.

     textContent throughout, so this file needs neither page's `esc`. */
  const mk = (into, tag, cls, text) => {
    const e = document.createElement(tag);
    if(cls) e.className = cls;
    if(text != null) e.textContent = text;
    into.appendChild(e);
    return e;
  };
  body.innerHTML = '';
  const flag = mk(body, 'div', 'whenflag');
  mk(flag, 'div', 'what', n.on ? 'Off in' : 'Work in');
  mk(flag, 'div', 'count', whenWordy(n.on ? n.left : n.to));
  // The clock time it lands on, because a countdown answers "how long" and the
  // next thing asked is always "so what time is that".
  mk(flag, 'div', 'at', 'at ' + whenAt(n.on ? n.end : n.at));

  mk(mk(body, 'div', 'rowbtns whenclose'), 'button', 'act', 'Close')
    .onclick = () => dlg.close();
  dlg.showModal();
  return true;
}

/* Bind the openings. `get` is called at the moment of the opening rather than
   now, because the shifts it should read are the ones on file then. */
function whenWake(get, opts){
  const fire = () => { try { whenPrompt(get(), opts); } catch(e){ /* never in the way */ } };
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'visible') fire();
  });
  // Restored from the back/forward cache: no reload, and on some Androids no
  // visibilitychange either.
  window.addEventListener('pageshow', e => { if(e.persisted) fire(); });
  return fire;
}

/* Node picks these up for the tests; the browser just gets the globals. */
if(typeof module !== 'undefined' && module.exports){
  module.exports = { LEAVE_LEAD, WHEN_QUIET, whenNext, whenClock, whenCountdown,
                     whenLead, whenWordy, whenLine, whenAt, fmtDurWords };
}
