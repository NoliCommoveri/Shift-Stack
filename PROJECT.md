# Shift Deck — project state

_Last updated 5 September 2026_ — §45 builds the read-only second phone:
`/view`, two tabs, and a `VIEW_TOKEN` that opens exactly one route so that the
phone *cannot* write rather than merely declining to. It needed no new column
and no new field — the shifts and every pay rate were already in D1 — only a
read path, a second credential and a page. The stylesheet moved out of
index.html so both pages draw the same week from one file, and a browser test
puts one mixed-rate week through both and fails if the grosses disagree.
§44 puts a **Confirm all** button in the
banner that reports a week filled from the rota, because saying "yes, that is
what I worked" should not cost one dialog per shift.
§43 reorders the nav bar to Pay before Add and sets it a size up, and takes the
calendar-file box, **Fetch from a link** and **Paste calendar text** off the Add
screen — three doors onto a path the Worker's cron has walked on its own since
§14.
§42 turns the title round: job, site, role,
on the calendar and on every screen, because the place is the half worth
keeping when a line is cut short.
§39 puts each job's colour on its own events,
which is the second signal §25 said colour could be and never the only one: the
title still names the job. It is an experiment with a known worst case — a
client that does not read RFC 7986's `COLOR` skips the line and shows the
calendar he has now — and the one thing it is waiting on is his phone.
§34 answers a question about testing on a
second phone and finds a way to duplicate a calendar that nothing in the app or
the Worker could see or undo: the company id is minted per setup, so setting the
same job up twice files a whole second copy of the employer's calendar under the
new one, and §14.3's column ownership means neither side can then delete it. It
adds `GET /trace` — the shift table grouped by company id, which is the one
shape that shows an orphan — and `POST /reset`, plus an ordered teardown that
cancels, clears, verifies, and only then forgets the token. §31 is a bug and its post-mortem: the
calendar export wrote `[object Object]` in place of every title, address and
UID from §28 onwards, because two of the seven scripts sharing one global
scope both declared `fold`. Real screenshots of both apps landed (§3.1, §5),
Homebase's own Calendar Sync turned out to exist and is now an import path (§12),
and the app became the normalising step between two calendars rather than a
second source of the same events (§13). The Worker that closes the import gap
is specified in §14 and audited against Ray's three existing Cloudflare apps
in §15. Build order for the agreed-but-unbuilt work is in §11. The first real
OCR pass ran the same day (§16): TrackTik came through it, Homebase did not,
and the two jobs turned out to be the opposite way round from what §8 assumed —
DSI is the fixed one, Trupoint is PRN. §17 closes the TrackTik email as a dead
end and makes screenshots the plan, §18 builds the first thing that follows
from it — DSI's rota, declared, and the am/pm check that runs off it — and §19
replaces the turnaround warning with one that catches shifts booked over each
other, across midnight, at the point they arrive. §26 builds §8.1's site table,
which leaves §8.4 as the last of §8's four.

A record of what has been built, why the design went the way it did, and what
is still undecided.

---

## 1. The problem

Ray's husband works two jobs whose schedules live in two separate employer
apps. Neither talks to the other, and there is no single place to see the week.

Two names for each job, and they are not interchangeable. The app is the
scheduling software the employer happens to buy; the employer is what the job
is called, what goes in Setup, and what prefixes every exported event. Which
app a job uses decides how its shifts are *read*; which employer it is decides
what they are *labelled*.

- **TrackTik SHIFT** (`com.tracktik.shift`) — the scheduling app used by
  **DSI**, security guarding. Sites seen so far include De la Montagne. No
  calendar feed, so this job is screenshots only.
- **Homebase** (`com.joinhomebase.homebase`) — the scheduling app used by
  **Trupoint**. Described in the original brief as hospitality, role-based e.g.
  Cook; §3.1 corrects that against his actual screenshots. Homebase has a
  Calendar Sync, which is why this is the job §14 can automate.

Goals, as stated:

1. Hosted, not a local file — Android makes local HTML unreliable to open
2. One place holding both schedules
3. Manual add and edit for changes
4. Links to launch the source apps
5. Company and location tables to match against
6. Hours per week, per company and total
7. Gross pay estimator
8. Aggressive reminders — ideally something he cannot miss

---

## 2. Routes investigated and rejected

**Official calendar feeds.** Homebase does expose a per-employee calendar
feed. TrackTik SHIFT does not — it is a guard-duty app with a view-only
schedule and clock-in, no export of any kind. Whether the Homebase feed is
enabled on his account was never confirmed, so nothing was built against it.

_Superseded on 3 September 2026._ It is enabled, and it is better than a feed
URL: the Homebase app has a **Calendar Sync** screen of its own — Enable, a
location list, the Google account, an alert lead time and a Sync now button —
which writes his shifts straight into that Google calendar. §12 is what was
built on top of it.

**TrackTik schedule distribution email.** TrackTik's documentation states that
publishing a schedule sends it to affected employees by email. That would have
been an ideal parsing target: structured, recurring, no scraping, no stored
credentials. He is not receiving these emails — it is a per-company setting.

_Closed on 3 September 2026._ **It is a dead end.** The setting is not going to
be turned on, so there is no email to parse and no point asking again. DSI is
screenshots and manual entry, permanently, and every plan below should be read
with that as a fact rather than a pending question. This is the single biggest
input to the roadmap in §11: it removes step 0 entirely, and it promotes the
manual path from a stopgap to the design.

**Scraping the TrackTik web portal.** Rejected. Requires stored credentials,
breaks on any markup change, sits in awkward territory with employer terms,
and cannot be done from a static page anyway because of cross-origin rules.
A published Python tool that does exactly this exists (`homebase_calendar_sync`
on PyPI, for Homebase) and is a good illustration of the maintenance burden.

**Claude API vision extraction.** Rejected on cost — Ray does not want a paid
API in the loop.

**Native Android app.** Rejected on cost of a different kind: it is the only
way to get a true unlock-triggered popup or a custom home screen widget, but
it means Kotlin and a build step, which breaks the whole no-build-step
architecture for one feature.

---

## 3. What was built

Four files plus icons, deployable to GitHub Pages as-is.

```
index.html              markup and styles
app.js                  all logic
parser.js               screenshot text to shift rows      (added, §9)
ics.js                  calendar file to shift rows        (added, §12)
sw.js                   service worker, offline shell + OCR engine caching
manifest.webmanifest    PWA install metadata
icon-192.png
icon-512.png
README.md
```

No build step. No backend. No dependencies beyond Tesseract.js from a CDN.

### 3.1 Reading screenshots

OCR runs entirely in the browser via **Tesseract.js**, a WASM build of the
Tesseract engine. Free, no API key, and the images never leave the device.

**Preprocessing** matters more than anything else here. Phone screenshots are
small and often dark mode, both of which OCR handles badly. Each image is
upscaled to roughly 1800px wide, converted to greyscale, auto-inverted if the
mean luminance says it is a dark screenshot, then contrast-stretched. This is
the difference between clean text and garbage.

**Two layout profiles are handled.** Both were originally derived from
screenshots in the vendors' own user guides. Real captures of his schedule —
four screenshots, both apps, the week of 3 September 2026 — have since arrived
and confirmed the shape of both profiles. The guides got the structure right.
What they got wrong is everything around it.

_TrackTik_ — a bare month name as a section header, then the weekday and time
range on one line with the day number on the line below. Dark mode, as
expected:

```
September
FRI 3:00pm - 11:00pm
04 Cook Plant ASO | SOUTHERN HENS, I...
```

Days he is not working print `NO SHIFTS SCHEDULED` in place of the times, and
the site name is truncated with an ellipsis at the width of the screen. The
truncation is stable week to week, so it fuzzy matches against itself and does
not need solving.

_Homebase_ — a written date header, then start and end times on separate lines
with the role alongside. Light mode, purple:

```
Thursday, September 03 Today
12:15 am CC (You) Cerion C.
4:15 am Training
Headquarters
```

Three differences from the guide, all of which needed parser changes:

- **The header carries no year at all.** The guide's did.
- **His own name is on every row**, with the avatar initials beside it, above
  the role. It is identical on every shift and says nothing, so the parser
  drops any fragment marked `(You)` rather than letting it become the label.
- **The site is on a third line** below the role. The label wants both, so the
  parser now gathers the lines following a split pair and picks the useful ones
  out by content instead of by position — which grouping the OCR chooses for
  the rows is not something to depend on.

One thing to note from the captures, since it contradicts §1: the roles on the
_Homebase_ screen are Training, Security Agent and Security Officer, at
Headquarters and F.O.C. §1 has Homebase down as the hospitality job "role-based,
e.g. Cook". That description came from the role in Homebase's own user guide,
not from his account. The only Cook in his actual data is on the _TrackTik_
side — `Cook Plant ASO | SOUTHERN HENS, INC`, which reads as a guard post at a
plant rather than a kitchen shift. On the evidence of four screenshots both
jobs look like security work. Nothing in the code turns on this; §1 is left as
written, with this correction against it.

The parser tracks month and year as state, pairs times either as a range on one
line or across two consecutive lines, and pulls the day number from the
following line. Day numbers that drop sharply (30, 31, 01) advance the month.

**The weekday is used as a free integrity check.** Where OCR read a usable
weekday abbreviation, the parser compares it against the weekday of the date it
constructed. On the guide screenshot this resolved February to 2027 rather than
2026 — Feb 3 2027 is a Wednesday, Feb 3 2026 was not. That is a fact about a
vendor demo, not evidence about his data, but the check itself is sound and has
since caught a wrong weekday in a hand-written test fixture.

The real screenshots made this matter more than it did. Neither app prints a
year, so on both layouts the year is invented by `guessYear` and the weekday is
the only thing on screen that can contradict it. The check ran only on the
TrackTik line format; it now also reads the weekday off the Homebase date
header, which is where the year is least constrained.

**Flags raised for review**, shown as amber rows:

- no date could be worked out
- no am/pm was printed next to the times
- times had to be paired across two separate lines
- the weekday on screen disagrees with the computed date

**Site name matching.** OCR spells the same site differently week to week.
Incoming names are compared against ones already on file for that company using
edit distance, snapping to the existing spelling when close. This gets quieter
over time rather than nagging forever.

### 3.2 The rest of the app

- **Schedule** — grouped by week, colour-coded per job, weekly hour totals,
  today highlighted. Flags shifts that overlap each other, in a banner and
  beside both shifts. Tap any shift to edit or delete. (It used to flag tight
  turnarounds too; §19 removes that.)
- **Next shift banner** — countdown at the top, refreshed each minute and on
  tab focus.
- **Launch buttons** — Android intent URLs with a Play Store fallback. Opens
  the app's home screen; deep-linking to a specific view is not possible.
- **Pay** — per company and combined. Per-employer pay week start day, unpaid
  break rules (deduct N minutes on shifts over M hours), overtime threshold and
  multiplier.
- **Setup** — company records, alarm lead times, calendar export, JSON backup
  and restore.
- **Storage** — IndexedDB with `navigator.storage.persist()` requested, not
  localStorage, because months of shift history cannot be re-derived once the
  screenshots are gone.

### 3.3 Calendar output

The phone's own calendar is the notification and widget surface. He already has
a working home screen calendar widget, so that last mile is proven.

The export writes an .ics with `VALARM` entries at configurable lead times,
defaulting to 12 and 2 hours before. Event titles follow his existing
convention: `DSI- Cook Plant`.

Two modes:

- **Subscription** — the file contains every shift. ICSx⁵ watches it and
  mirrors it into a native Android calendar. Duplicates are structurally
  impossible because a subscription replaces rather than appends.
- **Manual import** — only shifts not previously sent are included, since
  Samsung's importer tends to ignore UIDs and would otherwise duplicate
  everything on each import.

Note for the record: the Google Calendar app on Android cannot import .ics
files at all. Samsung Calendar can, via My Files.

---

## 4. The open question: getting the feed to ICSx⁵

> Settled in §14, which specifies the Worker below and extends it to the import
> side as well. This section stands as the reasoning that chose it.

**This is the live blocker.** Subscription mode is the right design — it
removes the manual import step and makes duplicates impossible. But it depends
on ICSx⁵ being able to re-read an updated file, and **his phone confirmed it
saves repeat downloads as `shifts (1).ics` rather than overwriting**. ICSx⁵
would stay pointed at the stale original and the calendar would quietly stop
updating. Silent staleness is the exact failure this project exists to prevent.

So the feed has to live at a URL. Options as they stand:

### Cloudflare Worker — recommended

The app POSTs the .ics with a shared secret, the Worker stores it in KV and
serves it at an unguessable URL. ICSx⁵ subscribes to that.

- Ray already runs a Worker for star-homeschool, so the account and the habit
  exist
- No OAuth, no token expiry, roughly forty lines
- Keeps working untouched
- **Cost:** shift times and site names sit in Cloudflare KV rather than only on
  the phone. Security site names and a cafe schedule — a judgement call, not a
  technical one

### Google Drive

- Writing needs a registered OAuth client and the `drive.file` scope
- Browser OAuth flows yield an access token lasting about an hour with no
  refresh token, so re-authorisation every export
- Reading back out relies on the `uc?export=download` direct link, whose
  behaviour Google changes periodically and which sometimes returns an HTML
  interstitial instead of the file — which fails silently

### GitHub Pages

- The repo already exists; the app could commit `shifts.ics` via the API with a
  fine-grained token
- Zero new infrastructure
- **Pages is public.** His schedule would be world-readable at a guessable URL.
  Rejected on that basis

### Do nothing

Stay on manual import mode. It works today. The cost is a file-open step after
each export and occasional duplicate management.

---

## 5. Other things still open

**The TrackTik distribution email.** One message to his scheduler could enable
it. If it lands, email parsing beats screenshots on every axis. Worth doing
before investing further in OCR.

**Whether Homebase exposes its calendar feed on his account.** ~~Never
confirmed.~~ Confirmed on 3 September 2026, and better than expected: the app
has a Calendar Sync screen that pushes into a Google calendar. Homebase needs
no OCR now. See §12 for what that does and does not close.

What it leaves open is TrackTik, which has no export of any kind, so the OCR
work in §3.1 stays load-bearing for that half of the schedule.

**No parser output has been seen from a real OCR pass.** This was "neither
parser has seen a real screenshot"; that half is now closed. Real screenshots
of both apps arrived and both layout profiles survived them, with the label
handling described in §3.1 rewritten to suit. `NOISE` was rewritten too — the
guide chrome was not his chrome, which is `Day view`, `Week view`,
`NO SHIFTS SCHEDULED`, `7 new shifts` and a five-item bottom nav.

What remains open is the step in between. The fixtures taken from those
screenshots are marked TRANSCRIBED, not PROVISIONAL: the layout, dates, times,
roles and sites in them are real, but they were read off the images by eye
rather than run through Tesseract. So the parser is now known to understand the
layout and is still unproven against the mangling. The auto-invert branch in
`prep()` has still never executed against a real input, and the am/pm risk in
§6 lands squarely here — a real pass on the dark TrackTik screen is the next
thing to get.

The scroll boundary is now understood at least. A row cut off at the bottom
keeps its times and loses its date; it is flagged `nodate` and stopped at
review. A row cut off at the top keeps its site and loses its times; it is
dropped silently, which is right, because the shift is only recoverable from
the overlapping screenshot anyway. Overlap the captures by one row.

**The unlock popup.** Not achievable from the web — there is no unlock event
exposed to browsers, and PWA widgets on Android do not exist (the manifest
`widgets` member targets Windows). Reachable via Tasker, which has a
"Display Unlocked" event trigger and can pop a dialog on every unlock, reading
from a file the app writes. Pairs with KWGT for a custom widget. Costs a few
dollars and an evening. Deferred until the calendar nagging proves too polite.

**Pay estimator accuracy.** Gross only, before deductions. Overtime is
calculated per employer, which is correct, but stat holidays, shift premiums
and retro adjustments are not modelled. Its real value is spotting a paystub
missing a shift, not predicting the deposit. If it ever gets treated as the
expected amount it will cause an argument.

---

## 6. Known risks

**am/pm is one character.** A misread puts a shift twelve hours out and it
looks entirely plausible in the list. This is the failure most likely to
actually cost him a shift. The review step exists for this; it should not be
skipped in the first weeks.

**Android can clear web app storage** under pressure or via "clear browsing
data", despite the persistence request. The JSON backup in Setup is the
mitigation and should be used periodically.

**Employer apps change.** The OCR approach is immune to UI restyling in a way
scraping is not, but a genuine layout change — a redesigned schedule screen —
would need the parser adjusting. The raw-text panel is there to make that a
five-minute fix rather than a debugging session.

**Editing in subscription mode.** Edits flow through on the next feed save,
which is correct. In manual import mode an edited shift produces a second
calendar event rather than replacing the first, hence the rebuild option.

---

## 7. Working agreements

**No live data until development is done.** The app is not carrying anything
real yet, so there is nothing to preserve across a data-shape change. Schema
migrations and a `version` field are therefore *deliberately not built*. When a
stored shape changes, use **Setup → Danger zone → Delete everything and start
over** and rebuild.

This holds until the first live data point — the first time real shifts are
entered and relied on. At that moment, before anything else: add `S.version`,
write the migration path, and make both `loadState()` *and* the backup-restore
path run it. Restoring an old backup into a new schema is the case that will
otherwise bite quietly.

**The raw text is the artefact, not the parse.** When a screenshot is imported,
what is worth keeping is the contents of *Show the raw text that was read*. That
is what becomes a test fixture. The parsed rows are the thing under test.

---

## 8. Agreed design, not yet built

Four pieces, in the order they should be built. The ordering matters: each one
changes the shape the next is written against.

### 8.1 Site table, replacing the free-text label — **do first**

**Built on 4 September 2026 — §26**, which is the record of what it became.
Two things below were overtaken and are marked where they sit: the blocker at
the foot of this section was cleared by §17.4, and the title convention was
overtaken by the same section.

`shift.label` is one string doing two jobs. The edit dialog admits it: the field
is captioned "Site or role". TrackTik's line is `Mobile Guard | De la Montagne`
— a role *and* a place. Homebase's is `Cook` — a role, no place. Addresses only
attach to one of them.

```js
S.sites = [{ id, companyId, name, address, aliases:[], archived }]
shift = { …, siteId, role, label }   // label kept as fallback
```

- **`siteId` stays nullable and `label` stays.** If OCR produces something that
  matches nothing, the shift still imports and renders `site?.name || label`.
  Requiring a site would let a bad read block an import, which is worse than an
  unlabelled shift.
- **Aliases are the real prize.** `snapSite()` currently matches against labels
  scraped out of `S.shifts` — deriving authority from its own unvalidated
  output, so one bad read becomes a "known site". A site record instead keeps
  the spellings confirmed to mean it, and confirming a fuzzy match in review
  adds one. Matching goes exact-alias → edit distance → no match. It gets quiet
  within weeks instead of guessing forever.
- **Merging is permanent, not a migration step.** OCR keeps inventing spellings.
  Merging site B into A moves its aliases and repoints its shifts.
- **Addresses earn their keep in the `.ics`.** One added `LOCATION:` line and
  Android renders a tappable address: the two-hour alarm fires, he taps the
  event, taps the address, and he is navigating. This is the single best reason
  to do this work.
- Knock-ons: the title convention `DSI- Cook Plant` needs preserving as
  `${company}- ${role} ${site}`; changing `SUMMARY` at all rewrites every event,
  which is free in subscription mode and messy in manual-import mode.
  *(Overtaken, §26.7: §17.4 kept the employer's pipe between role and site on
  purpose, so a space join here would reverse it. The rewrite is handled rather
  than only noted — `restamp()` re-queues the affected events.)*
- ~~The gap warning gets better for free — back-to-back shifts at *different
  addresses* is a different warning from two at the same one.~~ **Withdrawn,
  §19.** There is no turnaround warning any more to improve: going straight
  from one job to the other is the ordinary case here, and a warning about it
  fired constantly on nothing. What survives is overlap, which addresses do not
  change — he cannot be in two places at once whether or not they are the same
  place.

~~**Blocked on a real TrackTik screenshot.** The site/role split assumes the real
line contains the `|` separator. If it does not, that split is fiction. Build
the table and the schema now; wire the parser-side split once the real format is
known.~~ **Cleared, §11.1 and §17.4.** The separator is real, it survives the
parser, and `splitLabel()` was written and tested against it before this section
was built. §26 read it and changed nothing in `parser.js`.

### 8.2 am/pm plausibility, from a declared schedule

The documented top risk is that am/pm rides on one character, and the current
mitigation is "a human glances at the list" — a control that decays exactly when
vigilance does.

The first design considered was learning normal start times from history. **That
was rejected**, and the reason generalises: the history *is* the parser's own
unvalidated output. One bad am/pm import that gets committed becomes evidence,
so a 5am start starts to look normal and the next 5am misread stops being
flagged. A check that gets quieter each time it fails is worse than no check.

Instead, declared shift patterns per job:

```js
co.patterns = [
  { days:[1,2,3,4,5], start:'07:00', end:'19:00' },  // fixed job: can generate
  { start:'09:00', end:'17:00' }                      // PRN: snapping only
]
```

One field (`days`) distinguishes the two jobs with no mode switch. A pattern
with `days` can generate a week; one without is only ever used for checking.

**Snapping must never be silent.** If the employer genuinely moves a shift and
OCR reads it correctly, snapping it back to the declared time makes him late,
and there is no screenshot discrepancy to notice. So, by distance:

| Distance from a declared shift | Behaviour |
|---|---|
| Exactly ±12h | An am/pm flip. Correct it, show the row amber: "read as 9pm, corrected to 9am" |
| Within a few minutes | Same shift, sloppy OCR. Snap quietly |
| An hour or two off | **Do not touch.** Flag "doesn't match a known shift for this job" |
| No patterns declared | Duration and overlap checks still apply — they need no config (both built: §18.3, §19) |

**History still helps, as a suggestion.** A "build from what's on file" button
lists distinct start/end pairs already in `S.shifts` with counts, and he ticks
the real ones. He skips the typing; the app gets a list a human filtered. The
human is what stops bad data becoming authority.

### 8.3 Generating the fixed job's weeks

One job is PRN and moves constantly. The other is fixed for days and times, with
only the location changing — so most weeks it needs no screenshot at all.

**Which job is which, corrected 3 September 2026.** This section and §8.2 and
§8.4 were written without naming them, and §8.4's line about the PRN job reads
as though the PRN one is the job on screenshots. It is the other way round.
**DSI on TrackTik is the fixed job**; **Trupoint on Homebase is the PRN one.**
§16 has the evidence and what the swap costs each of the three sections. The
short version is that it is good news: the fixed job is the one with no
calendar feed, so generation lands on exactly the input that is expensive.

"Fill week of ___" emits rows into the existing `pending` array, so it reuses the
whole review screen, its flags, the commit path, and the diff in §8.4. Location
defaults to the most recent site for that pattern — a convenience default is
fine for a *label* where it would not be for a *time*: a wrong label costs mild
confusion, a wrong time costs a shift.

**The risk to manage:** "pretty fixed" is not fixed. A generated shift that was
actually cancelled means the app confidently shows work that does not exist and
fires alarms for it. That is cheaper than missing a shift but it corrodes trust,
which is the whole asset.

Mitigation, using the `source` field that already exists on the shift record:
generated shifts get `source:'pattern'` and render differently — a hollow tick
rather than a solid one — so assumption is visually distinct from fact. A
screenshot import then promotes them to confirmed, or flags them via §8.4. If
unconfirmed shifts pile up past some horizon, the app should say so.

**Read against the code, 3 September 2026.** The three things this section needs
exist and are named in §18.8. Four things it assumed do not, and §20 has the
reading; what it settles belongs here, because this is the section that gets
built from:

- **A screenshot cannot promote anything today.** `bySlot()` drops a row that
  matches a filed shift exactly, which is precisely what a confirming screenshot
  is, so a generated shift would stay an assumption for ever and the hollow tick
  would never fill in. A match against a `source:'pattern'` record is a
  confirmation rather than a duplicate: it carries `replaceId`, and the commit
  path replaces in place and keeps the id, so the calendar sees an update. A
  site that disagrees is not a location change either — the label was invented
  here, and the screenshot is the first real information about it (§20.2).
- **A filled week must not silence the horizon note.** §17.3's "nothing on file
  after Friday" counts every shift regardless of source, so generation would
  switch off the one standing prompt to act. The note counts confirmed shifts,
  and a filled week gets a line of its own naming how many are unconfirmed. The
  pile-up warning asked for above fires on a generated shift whose date has
  passed unconfirmed — not on one merely still in the future, which is the
  ordinary case (§20.3).
- **Pay must not present an assumption as earnings.** The pay tab sums every
  shift and prints a gross figure with overtime. A week holding generated shifts
  says so and names the assumed hours separately (§20.4).
- **The calendar event carries the mark too.** The hollow tick is in the app;
  the 05:00 alarm is on the phone, and that is where this section's stated risk
  actually lands. A generated shift exports with "(from the rota)" in the title,
  which the alarm body reuses (§20.5).
- **Holidays are marked, never skipped.** A silent skip generalises from one
  observed Labour Day and produces a missing shift on the holiday he does work,
  which is the more expensive failure by this section's own ranking. The
  generated row arrives flagged and he removes it in one tap (§20.7).
- **Generation never fills backwards, and a hand edit confirms.** Past dates are
  never generated, and `editShift()` promotes what he has corrected himself
  (§20.8).

### 8.4 Change detection on import

Partly addressed today (see §9) but the full version is still to build. Match
candidates within (job, date), pair by nearest start time, then sort into three
buckets in the review screen:

- **New** — no counterpart on file
- **Changed** — `9:00–17:00 De la Montagne → 11:00–19:00 De la Montagne`, shown
  before → after, one tap to accept
- **On file but not in this screenshot** — probably cancelled

The third bucket is the most valuable for a PRN job and the one nobody builds.
It **must never auto-remove**: screenshots are of a scrolling list, so a partial
capture is indistinguishable from a week of cancellations. Only propose removal
for dates strictly inside the min–max range of what parsed, and always as a
tick-box.

---

## 9. Built on 3 September 2026

### Test harness

The parser is now a separate file, `parser.js`, holding pure functions only —
text in, rows out, no DOM, no storage, and the current date injected so tests can
pin it. It loads as a plain script before `app.js` in the browser and is
`require`d directly by the tests in node. Still no build step, still no runtime
dependencies; `package.json` exists only to carry the test command.

```
npm test           # run
npm run test:update # regenerate golden files
```

Two kinds of test: unit tests for the small helpers, which hold regardless of
what the real screenshots look like, and golden fixtures pairing raw OCR text
with expected output. `tests/fixtures/README.md` has the workflow and a list of
what is worth capturing.

Update mode records what the parser *currently does*, which is not the same as
what it should do. Generated goldens must be read before being committed. Doing
exactly that caught a hand-written fixture whose weekdays disagreed with its
dates — the weekday cross-check was right and the fixture was wrong.

**One real parser bug found immediately:** `27 July 2025` parsed as July **20**,
because the month-first branch of `fullDate()` matched `July 20` and swallowed
the first two digits of the year. Fixed with a `(?!\d)` guard.

### Bugs fixed

- **Correcting a date wiped every warning on the row.** `p.flags = []` cleared
  the am/pm and split-line warnings along with the missing-date one — so fixing
  the most common problem silently discarded the most dangerous one. Now only
  the date flag is cleared. Rows also update in place rather than re-rendering
  the whole list on every keystroke, which was reordering rows and dropping
  focus mid-edit.
- **Imported rows did not carry their job.** `pending` was never cleared between
  batches and commit read the job picker once, so importing job A, switching the
  picker, then importing job B filed everything under B. Each row is now stamped
  with the job it was read under, carries a stable `rid`, and shows a per-row job
  picker when more than one job exists.
- **The dedupe check ignored the label**, so a shift at the same time in a
  different place was silently dropped — exactly backwards for the job where
  location is the only thing that changes. Exact repeats are still dropped
  (including OCR variants that snap to a known site); a genuine location change
  is kept and flagged.

### The app could not open offline

Two `<head>` resources were blocking, in an app whose stated purpose includes
working offline:

- The **Tesseract CDN script** was parser-blocking, so an unreachable jsDelivr
  stopped the whole app from opening, not just OCR. It is now fetched on first
  use of the Add tab. The service worker still caches it afterwards, so later
  imports are unchanged.
- The **Google Fonts stylesheet** blocked script execution entirely — with
  fonts.googleapis.com unreachable, `document.readyState` never left `loading`
  and the app rendered a blank page. Now loaded non-blocking; every font stack
  already falls back to `system-ui`, so text shows immediately and swaps.

Both were confirmed by booting the app in headless Chromium with no network at
all, which now renders correctly.

### Danger zone

- **Delete everything and start over** — clears jobs, shifts and settings. This
  is the intended way to move to a new data shape while §7 holds.
- **Reload the app files** — drops the cached shell and service worker and
  reloads, so a new version is picked up immediately rather than on the next
  open. Data untouched. Development convenience.

---

## 10. Open questions

Carried forward, plus what today added.

1. ~~**Do the parsers work at all on his real screens?**~~ Answered, and
   differently for each: TrackTik parses a real OCR pass exactly once the month
   header tolerates its debris; Homebase reads the layout but mangles the times
   badly enough to be unusable. §16 has both, and the Homebase result opens a
   decision rather than a bug list, since that job has a feed.
2. ~~**The TrackTik distribution email.**~~ Closed, and closed as a dead end
   (§2). It is not being switched on. DSI stays on screenshots and manual
   entry, so the OCR path is load-bearing rather than provisional and §8.4 is
   needed in full.
3. ~~**Does Homebase expose its calendar feed on his account?**~~ Answered: it
   has an in-app Calendar Sync writing to Google, and §12 imports from it. Only
   TrackTik needs screenshots now. What remains is whether the review flow is
   too manual to keep up with — see §12's open ends.
4. **Getting the feed to ICSx⁵** (§4) — still the live blocker, still pointing
   at a Cloudflare Worker. The browser-native escape hatch does not exist:
   `showSaveFilePicker()` with a retained handle would solve the `shifts (1).ics`
   problem exactly, but Chrome on Android does not support it. One idea that may
   soften the privacy objection: the feed does not need site names. A
   **minimal-feed option** publishing `DSI shift` with times only, keeping site
   and role local to the phone, puts nothing meaningful in KV.
5. ~~**Staleness should be loud, and is not.**~~ Both halves built. Two cheap,
   transport-independent additions, worth doing whatever happens with (4):
   - ~~"Last exported N days ago, 4 shifts changed since" on the **Schedule**
     tab.~~ Built, §23 — and not with that headline, which §23.1 explains.
     If the `.ics` is stale the calendar is lying, and Schedule is where he looks.
   - **"Nothing on file after Friday."** If the last shift held is within ~3
     days, the schedule is probably unimported rather than empty — and an empty
     calendar reads as a day off, which is the exact silent failure this project
     exists to prevent. **Per job**, decided 3 September 2026 and now built: the
     two jobs fail differently, so one sentence cannot serve both. Trupoint
     arrives through Calendar Sync, so a short horizon there is the sync's
     business and reads as "the calendar should be filling this". DSI is
     screenshots and manual adds only — nothing arrives unless he brings it —
     so a short horizon there is a job to do, and that is the case the warning
     is really for. A job counts as feed-backed when its `icsMatch` is set,
     which is already how a calendar event finds its job, so this needed no new
     field and nothing to migrate.
6. ~~**Manual-import mode orphans deleted shifts.**~~ Built, §22. A deleted
   shift that had been sent now leaves a record, and Setup offers a
   `METHOD:CANCEL` file that withdraws the event. What the section could not
   close is whether the importer on the far end acts on it — §22.5 is the
   record of why that is not this app's to promise, and what it says instead.
7. **Smaller, unowned.** Shift rows are `div`s with `onclick`, so editing is
   touch-only and unavailable to a screen reader. `fold()` slices ICS lines by
   character where the spec is byte-based, so an accented site name can produce
   an invalid line — in scope for Montréal addresses. OCR accuracy might improve
   cheaply from a page-segmentation mode and a character whitelist, currently
   left at Tesseract's defaults.

---

## 11. Roadmap — the order to build §8 in, and where to stop

§8 already argues its own internal order and that argument holds: each of the
four pieces changes the shape the next is written against. What this section
adds is where the §10 loose ends slot in, what the code says about §8.1's
stated blocker, and where to cut the work into sessions.

### 11.1 Two findings from reading §8 against the code

**§8.1's blocker is cleared.** §8.1 says the site/role split is "blocked on a
real TrackTik screenshot" because the split assumes the line contains a `|`.
It does — `tests/fixtures/tracktik-2026-09-TRANSCRIBED.txt` reads
`Cook Plant ASO | SOUTHERN HENS, I...`. The separator is real and §8.1 can
start.

**But the separator is destroyed before anything could read it.**
`normalise()` (`parser.js:38`) rewrites `|` to ` - ` on every line, and the
Homebase branch (`parser.js:238`) joins its own gathered fragments with the
same ` - `. So at the point a role/site split would want to read the boundary,
a real separator and an arbitrary fragment join look identical. Either split on
the pipe inside the TrackTik branch before `normalise()` flattens it, or keep
the pipe and give the Homebase join a different marker. This is a small change
but it has to be made deliberately, not discovered halfway through §8.1.

Two things are also cheaper than §8 implies. `source` already exists on the
shift record (`app.js:713`, `app.js:727`), so §8.3's hollow-tick rendering has
its hook. And `pending` already carries `rid`, per-row job stamping and a
review screen with flags, which is the scaffolding both §8.3 and §8.4 plug
into.

### 11.2 What comes before §8.1

**Send the two emails first.** §10.2 and §10.3 are each one message and each
can delete a large amount of the work below. If the TrackTik distribution email
gets switched on, email parsing beats screenshots on every axis and most of
§8.4 stops being necessary. If Homebase turns out to expose its feed, that job
needs no OCR at all. Neither costs a line of code, and both are worth their
answer before more is invested in OCR.

**Then a real OCR pass.** §10.1 is still open: the fixtures are TRANSCRIBED,
read off the images by eye, so the parser is known to understand the layout and
is still unproven against the mangling. The auto-invert branch in `prep()` has
never executed against a real input. §8.2 is a control designed specifically
against am/pm misreads — designing it before seeing how am/pm actually fails on
the dark TrackTik screen is designing against a guess. Run the four screenshots
through Tesseract, commit the raw text as fixtures, fix what breaks. The
page-segmentation mode and character whitelist in §10.7 belong in the same
sitting, since that is the one time the OCR settings are being looked at
anyway.

**And pull §10.5 forward.** The two staleness warnings touch no schema, depend
on no transport, and defend the exact failure the project exists to prevent —
an empty calendar reading as a day off. There is no reason they should queue
behind three schema changes.

### 11.3 The order

| | Work | Why here |
|---|---|---|
| 0 | ~~The two emails (§10.2, §10.3)~~ | Both closed. §10.3 answered by Calendar Sync; §10.2 is a dead end (§2). Step 0 is gone |
| 1 | Real Tesseract pass, fixtures from it, OCR tuning (§10.1, §10.7) | Gates §8.2's design |
| 2 | Staleness warnings, `METHOD:CANCEL`, byte-based `fold()` (§10.5–§10.7) | No schema, ships value immediately |
| 3 | **§8.1 site table** — schema, aliases, merge, `LOCATION:`, title convention, the parser split from §11.1 | Everything after assumes `siteId` |
| 4 | **§8.2** patterns and am/pm plausibility | Needs step 1's evidence; independent of sites |
| 5 | **§8.3** week generation | Small once patterns exist |
| 6 | **§8.4** change detection | Needs stable site identity to tell "same shift, different place" |

Steps 3 and 6 are the heavy ones. Step 5 is an evening.

**What §12 and §13 did to this table, later the same day.** The roadmap above
was written before Homebase's Calendar Sync was found, and four rows moved:

- **Step 0 is done, and it deleted nothing.** §10.3 is answered — Homebase
  syncs to Google, and §12 imports from it. §10.2 is now closed too, as a dead
  end: the TrackTik email is not coming (§2). The hoped-for outcome was that it
  would delete much of §8.4; the actual outcome is the opposite, and §17 is
  what follows from that.
- **Step 1 got more important, not less.** With Homebase on a feed, the OCR
  path carries TrackTik alone — the dark screen, which is exactly where the
  am/pm risk in §6 lives. A real Tesseract pass is now the only unproven part
  of the input side rather than one of two.
- **Step 2's `fold()` is done**, forced by §13 emitting real addresses.
  §10.6's `METHOD:CANCEL` is done too (§22), and §10.5's staleness warnings
  with it (§17.3, §23) — **step 2 is finished**. §13 had sharpened them: if Calendar Sync publishes only two months
  and the exported calendar is the one he reads, the horizon is a silent gap
  in the only place he looks.
- **Steps 3 and 6 are partly delivered on the calendar side.** §8.1's
  `LOCATION:` and §8.4's "cancelled" bucket both exist now for shifts that
  arrive from a feed, because a feed gives an address and a stable identity
  that OCR cannot. Neither is finished: the site table, the aliases and the
  merge are untouched, and change detection for screenshot rows still has only
  the slot to match on. What this changes is the argument — the two hardest
  steps now have a worked example to copy rather than a design to invent.

None of this reorders the table. It removes work from steps 0 and 2, and gives
3 and 6 a precedent.

**§4 is a parallel track, not part of this.** Getting the feed to ICSx⁵ remains
the live blocker for the product, but none of §8 depends on it and it is
infrastructure rather than enhancement. Worth noting that the minimal-feed idea
in §10.4 gets easier *after* §8.1: once role and site are separate fields,
"which of these leaves the phone" is a real choice rather than a string split.

### 11.4 One decision before step 3

§7 defers schema migrations until the first live data point. Step 3 is a schema
change. So before it starts, confirm §7 still holds — that nothing real is
being relied on yet. If it no longer holds, `S.version` and the migration path
are prerequisites of step 3 rather than something deferred, and §7 says exactly
what that means: both `loadState()` and the backup-restore path have to run it.

§12 and §13 added two fields to the shift record — `extUid` and `place` — which
is the first test of that agreement since it was written. They pass it on a
technicality worth stating: both are optional and every read is guarded, so a
record saved before them behaves exactly as it did. Additive optional fields do
not need a migration. Step 3 is not like that: it moves a value out of `label`
into a `siteId`, and a record written before it means something different
afterwards. That is the case §7 is actually about, and the check above stands.

---

## 12. Calendar import, 3 September 2026

He went looking and found Homebase's own **Calendar Sync**: Settings → Calendar
Sync, with an Enable toggle, the seven stations to tick, the Google account
(`raycarson13@gmail.com`) and an alert lead time. Turned on, it writes two
months of shifts into that Google calendar and the phone syncs them down.

That answers §10.3 and closes the Homebase half of §1's problem far better than
OCR ever could. It also does not, on its own, put a single shift in this app —
so the work was in the gap.

### Why an .ics file and not something cleverer

- **The phone's calendar is unreadable from a browser.** There is no web
  calendar API on Android. This is the same wall the unlock popup hit in §5,
  and it does not move.
- **The feed URLs refuse to be read.** Google's *secret address in iCal format*
  and Homebase's own feed link both answer without CORS headers, so the browser
  will not hand this page the response. **Fetch from a link** is in the app
  anyway, because for a feed that does allow it that is the whole win, and its
  failure message says what is actually likely rather than "network error".
- **Google Calendar's API** would work and was rejected for the reason §4
  rejected Drive: a registered OAuth client, an hour-long token with no
  refresh, and re-authorising on every import.

So: save the `.ics`, or paste the text, and the file does the rest. It works
offline, needs no account, no key and no infrastructure, and it is the same
format the app already writes on the way out.

### What a calendar row has that a screenshot row does not

`ics.js` is a second reader beside `parser.js` — pure functions, no DOM, no
storage, no dependency on the other, sharing only the row shape so both land in
the same review screen with the same flags and the same commit path.

The difference that matters is the **UID**. A screenshot row has no identity;
all the importer can do is compare the slot it lands in, which is why §9's
dedupe had to guess about location changes. A calendar row carries the
employer's own event ID, so:

- **A shift already on file is recognised and skipped.** Re-importing the same
  feed is how it stays current, and it costs nothing.
- **A shift the employer moved shows as a change** — `was 20:00–06:00 Silver
  Creek Station` — and *replaces* the record rather than appearing beside it.
  The shift keeps its `id`, so the calendar this app writes rewrites the event
  it already sent instead of orphaning it. That is the first piece of §8.4
  built, on the one input where it can be done exactly rather than by guess.
- **A cancelled shift is named.** `STATUS:CANCELLED` on an event whose UID is
  on file is the "on file but not in the schedule" bucket §8.4 calls the most
  valuable and says nobody builds — and here it arrives as fact rather than
  inference. It is still not acted on automatically: the calendar he synced
  covers one job, and a silent removal is exactly the failure §8.4 warns about.
  It is said in the import message and the deletion stays his.

### Three deliberate refusals

- **All-day entries are dropped, not given a time.** A shift is its times.
  §8.3's rule — a convenience default is fine for a label and never for a time
  — settles this.
- **Nothing is removed by an import.** As above.
- **The window is last week forward.** A Google export carries years of
  history and none of it is news. The import says how many it skipped.

### The mixing problem, and the filter

Calendar Sync writes into a whole Google account, not a calendar of its own,
so his dentist appointment and his mother's birthday arrive alongside the
shifts. There is no reliable structural way to tell them apart — the events
carry no marker naming Homebase.

So each job gains `co.icsMatch`, a word that has to appear in the title,
location or description: a station name, the role. It is a blunt instrument
and it is honest about being one — the import reports how many rows it
excluded, and leaving it empty takes everything and leans on the review
screen. If Homebase can be pointed at a calendar of its own, the filter stops
mattering; that is worth one look at the sync screen.

### Time zones

A feed writes times three ways — UTC, a wall time in a named zone, and a
floating wall time with no zone at all — and all three have to come out as the
wall clock on his phone, because that is what a shift is. `ics.js` converts via
`Intl`, with a second pass over the offset so the hour either side of a
daylight-saving change is right, and a test pinning 1 November 2026 to prove
it. An unrecognised zone (Microsoft writes `Central Standard Time`, which is
not an IANA name) is taken at face value and flagged rather than guessed at.

The tests pin an output zone rather than reading the machine's, so they do not
pass in one place and fail in another.

Which zone that is, is the job's — `co.zone`, an IANA name, filled in from the
phone's own when a job is made and offered as a box on the **App and calendar**
fold. The page could have gone on inferring it and been right; the Worker
cannot, and the whole of §35 is what happened when it inferred anyway.

### Still open

1. **No real feed has been through it.** The fixture is synthetic — written to
   the shape Google's exporter produces, with a Homebase-style event in it, not
   captured from his account. It is marked SYNTHETIC for the same reason the
   parser fixtures are marked PROVISIONAL. The first real export should be
   saved as a fixture and read carefully; what the SUMMARY and LOCATION
   actually contain is the thing to check, since the label depends on it.
2. **Whether the two-month horizon is enough.** Calendar Sync says it syncs two
   months. If the schedule is published further out than that, screenshots
   still have a job on the Homebase side.
3. **The manual step is still there** — save the file, then add it. Once a real
   export is in hand it is worth timing: if it is a minute a week, it is done.
   If it is annoying enough to be skipped, that is a silent-staleness risk of
   the same family as §10.5, and the answer is the §4 Worker fetching the feed
   server-side rather than anything clever in the browser.
4. ~~**Cancellations are told, not shown.**~~ Built in §13: the review screen
   grew a second row type and a cancellation is now a tick-box. It had to be —
   once the app is what feeds the calendar he reads, a cancellation it does not
   act on is a shift that keeps ringing.

---

## 13. Two calendars, and the app between them

Naming Calendar Sync as an import path (§12) left an obvious problem sitting in
the open: Homebase writes its shifts into a Google calendar, this app writes
*its* shifts into a calendar too, and both land on the same phone. Every
Homebase shift would appear twice.

The answer settles what this app is for, so it is worth stating plainly.

```
Homebase  ──Calendar Sync──▶  "Homebase Raw"     staging. Hidden on the phone.
                                    │             Machine-readable, not for him.
                                    │  .ics
                                    ▼
TrackTik  ──screenshots────▶  S H I F T   D E C K
                              normalises, merges, holds the hours and the pay
                                    │
                                    │  export ──▶ ICSx⁵
                                    ▼
                              "Work Schedule"    the one he reads. The widget
                                                  and the alarms come off it.
```

**The app is the normalising step, not a second source.** The employer's own
sync writes `Security Officer` with nothing to say whose shift it is. Two jobs
on one calendar that way is unreadable, which is §1's complaint restated: the
problem was never that the shifts were unavailable, it was that nothing put
them in one place in one language. What goes out is `Trupoint- Security Officer
- Headquarters`, from the job name in Setup, whichever way the shift arrived.

The prefix is the *employer*, never the app. Homebase is Trupoint's scheduling
software, so a shift that arrives through Homebase's Calendar Sync goes out
labelled Trupoint. Getting that backwards would defeat the one thing this step
exists to do.

**The staging calendar is a data channel, not a view.** Hidden in the phone's
calendar app, so nothing renders it and there are no duplicates. This also
retires the import filter for the Homebase side: a calendar of its own has
nothing in it but shifts, so `co.icsMatch` becomes the fallback for when
Homebase will only write to an account's main calendar rather than a chosen
one. Which of those it does is worth one look at the Calendar field on the
sync screen — it decides whether the filter matters at all.

### What this made worth building

- **`LOCATION` on the way out.** §8.1 called an address in the `.ics` the
  single best reason to build the site table — the alarm fires, he taps the
  event, taps the address, and he is navigating. Homebase puts a real street
  address on its events, so on that half of the schedule it arrives free of
  the site table entirely. Shifts keep `place`, the export emits it, and the
  edit dialog has a field so TrackTik shifts can have one typed in. The site
  table in §8.1 is still the right destination; this is the part of its value
  that did not have to wait for it.

- **Folding by octets.** §10.7 had this down as small and unowned: `fold()`
  sliced by character where the spec counts bytes, so an accented site name
  could produce an invalid line. Emitting real addresses made it live —
  Montréal is in scope — so it now walks code points and counts their UTF-8
  length. A character is never split and no line exceeds 75 octets.

- **Cancellation as a tick-box**, per §12's fourth open end. The reasoning
  changed with the architecture: while the app was a private view, an
  unremoved cancellation was untidy. Now that its export *is* the calendar he
  reads, an unremoved cancellation is an alarm that goes off for a shift that
  does not exist. It still never removes anything unasked — §8.4's rule that a
  partial capture is indistinguishable from a week of cancellations holds, and
  a cancellation is a proposal with a tick in it, not an action.

  One asymmetry to know about: in subscription mode the feed is rebuilt whole,
  so a removal reaches the phone by itself. In manual-import mode nothing
  withdraws an event already sent — §10.6's missing `METHOD:CANCEL` — so the
  app says so at the moment it matters rather than leaving it in a document.

### What this does not fix

**It is still a manual save.** The `.ics` has to be downloaded and added. The
architecture above changes what the app *is*; it does not change how the bytes
get in. §12's routes out stand: try the link button once in case Homebase's own
feed allows a direct read, and otherwise the §4 Worker fetching server-side is
the one thing that closes it — the same Worker the export side already wants,
now with a reason on both ends.

**And the horizon question is sharper now.** If Calendar Sync only publishes
two months, and the Work Schedule calendar is the only one he looks at, then
anything past that horizon is missing from the only place he checks. §10.5's
"nothing on file after Friday" warning was already worth building; this makes
it the next thing.
---

## 14. The Worker, specified

> **Corrected against the three Cloudflare apps that already exist**
> (Star-homeschool, Heritage-Hooves, Scheduling_App). This section was first
> written from first principles, which was a mistake: it specified KV, a
> cross-origin `POST`, and a CLI setup, none of which any of those three uses.
> The shape survived the comparison; the platform underneath it did not. The
> text below is the corrected version and is what gets built. §15 is the audit
> that produced the corrections and the record of why each one was made.

§13 ended by naming the §4 Worker as the one thing that closes the import gap,
"now with a reason on both ends". This section is that Worker written down
before any of it is built. It settles §4 and it goes past it: §4 was only ever
about getting the feed *out* to ICSx⁵, and this does the way in as well.

The decision that makes it worth building: **calendar-sourced shifts apply
without review.** That reverses §8.4's rule for this one source, and the
argument is in §14.6. Everything else follows from it.

### 14.1 Why this is small, and why that was not obvious

The reason to build it now is a property of the code that already exists.
`ics.js` is pure — no DOM, no storage, no clock, not one browser global, and it
already exports through `module.exports` for the tests. Its entry point takes
its whole world as an argument:

```
parseICS(text, { zone, from, match })  →  { rows, report }
```

It is also, by its own header, deliberately standalone from `parser.js`. So the
reader runs unmodified inside a Worker, against the golden files it is already
tested with. The server-side importer is not a rewrite; it is the file already
in the repo, required from somewhere else.

The obstacle was never Google and never CORS. CORS is a rule browsers apply to
themselves. A Worker fetching the secret `.ics` address server-side is not
subject to it, which is why `fetchCalendar`'s failure at `app.js:738` is
permanent in the page and absent in the Worker.

What is *not* portable yet is the writer. `buildICS` reads `S` and `coById`
from module scope, so it cannot leave the page as it stands. That is the one
real refactor here, and §14.7 makes it a prerequisite rather than a detail: if
the phone and the Worker each keep their own writer, the two will drift, and
the failure mode is a calendar that is subtly wrong rather than obviously
broken.

### 14.2 The shape

```
Homebase ──Calendar Sync──▶ "Homebase Raw" (Google) ──secret .ics──┐
                                                                    │
                                          Worker, cron every 15 min │
                                          fetch → parseICS → merge  │
                                                                    │
TrackTik ──screenshots──▶ phone ──POST──▶  D1  ◀────────────────────┘
                                            │
                                     GET, feed rebuilt whole
                                            ▼
                                   ICSx⁵, every 15 min
                                            ▼
                                 device calendar store
                                            ▼
                              Google Calendar app + widget
```

Homebase shifts reach his phone with the app never opened. TrackTik shifts
still need screenshots, because there is no feed to poll — that remains §5's
distribution-email question, and no amount of Worker closes it.

### 14.3 Storage

**D1**, which is what Star-homeschool, Heritage-Hooves and Scheduling_App all
use. An earlier draft of this section specified KV and then spent its length
working around KV's lack of transactions — splitting the store by provenance so
that no key had more than one writer, and closing on the line "we are out of
writers". D1 has atomic `batch()`, so there is nothing to work around: two
writers to one table is the ordinary case.

| Table | Written by | Holds |
|---|---|---|
| `cfg` | phone | one row: companies, settings, alarm lead times, as JSON `TEXT` |
| `shifts` | phone (`source='manual'`), cron (`source='feed'`) | every shift, whatever its origin |
| `raw` | cron | one row per job: last known-good `.ics`, for diffing and for looking at when something is wrong |
| `polls` | cron | append-only, trimmed to the last 50 (§14.8) |

`shifts` carries `source` (`manual` or `feed`), `job_id`, and `ext_uid` — null
for a hand-entered or OCR'd shift, the calendar UID for a fed one, and unique
per job where it is not null. That constraint is what makes the cron's
diff-and-apply idempotent (§14.5) rather than merely usually-correct.

The two writers stay disciplined about *which rows* they touch — the phone
never writes `source='feed'`, the cron never writes anything else — but that is
now a rule in the code rather than a property of the storage, and one `WHERE`
clause enforces it. This is the same column-level ownership Scheduling_App
locked for its shared `assignments` table: one table, two writers, each owning
its own columns and rows, enforced in the Worker rather than by keeping them
apart.

`GET /feed` is a `SELECT`, not a merge of two stores.

`polls` is append-only with a trim, which is `tick_run` in Heritage-Hooves and
`reward_entries` in Scheduling_App — a pattern with two prior implementations
in the account to copy from.

What does not change from that earlier draft is the honest part: the phone
stops being the source of truth. It owns its half, the Worker owns the other,
and neither is complete alone. That is the real cost of automatic import, and
it is larger than §4's stated privacy cost — the shift data is not merely
*copied* to Cloudflare, part of it now *lives* there. Scheduling_App reached
the same place and locked it as "D1 holds the truth; the device is a
read-through cache plus a write outbox", which is also why §14.7's pass two is
not optional.

### 14.4 Endpoints

Three, all on one Worker.

**`POST /push`** — the phone sends `cfg` and its `source='manual'` shifts.
Bearer token in `Authorization`, compared against the `PUSH_TOKEN` secret.
Rejects anything that is not the expected shape rather than storing it, because
a half-written `cfg` breaks the cron on its next tick and the phone would not
hear about it.

**Same-origin, so no CORS.** The Worker serves the app as well, from its
`[assets]` binding, exactly as all three of the other apps do (§14.9 step 2).
An earlier draft kept the app on GitHub Pages and specified an `OPTIONS`
preflight and an exact-origin `Access-Control-Allow-Origin` to go with it.
Nothing needed that: the app is four files and icons with no build step, moving
it under the Worker costs nothing, and it removes the preflight handler, the
origin allowlist, a second URL to configure in Setup, and the push token
travelling cross-origin. Scheduling_App has this as a locked decision — "one
Worker serving both apps, same-origin, no CORS, one git connection" — with the
failure that produced it recorded in its `wrangler.toml`: a relative
`fetch("/api/…")` cannot resolve from a GitHub Pages origin.

Two rules on the token comparison, both taken from `Scheduling_App`'s Worker
rather than invented here:

- **Fail closed when the secret is unset.** `if (!env.PUSH_TOKEN) return false`
  — an unset secret opens nothing. This is not hypothetical: §14.9 records that
  a secret only takes effect on a deploy made *after* it was added, so an unset
  `PUSH_TOKEN` is a state this Worker will genuinely be in for one deploy.
- **Compare in constant time**, not with `===`.

Hashing at rest and revocation, which the other apps do, do not transfer:
`PUSH_TOKEN` and `FEED_TOKEN` are Worker secrets rather than stored
credentials, and there is no device table to revoke from.

**`GET /feed/<FEED_TOKEN>.ics`** — what ICSx⁵ subscribes to. Rebuilt whole on
every request from one `SELECT` over `shifts`, so a removal reaches the phone by
itself and duplicates stay structurally impossible. `text/calendar; charset=utf-8`.
ICSx⁵ is not a browser and sends no preflight, so this endpoint needs nothing
from the paragraph above.

A different token from `PUSH_TOKEN`, and it must be: the feed token travels in
a URL that sits in ICSx⁵'s settings and in request logs, while the push token
is what authorises writes. One leaking should not cost the other.

If ICSx⁵'s "requires authentication" option is real — I could not confirm it
from a primary source, and it is a ten-second look on the phone — the feed
should take Basic auth as well, and the unguessable path becomes the second
lock rather than the only one. Nothing else subscribes, so there is no Google
fetcher to keep unauthenticated for.

**`GET /status`** — the poll ring buffer and the current counts, for the app's
Setup screen. ~~Same token as the feed.~~ **The push token**, changed when the
Setup screen was built: the phone then holds exactly one secret. `FEED_TOKEN`
exists to sit in the URL ICSx⁵ subscribes to, nothing on the phone reads it,
and asking him to paste a second token into Setup would have been a second
thing to get wrong for no gain. `POST /migrate` takes the push token for the
same reason — it is a write, and it is how §14.9 step 4 applies the schema
without anyone opening the D1 console.

### 14.5 The cron

`*/15 * * * *`. For each job with an `icsUrl` configured:

1. fetch the secret `.ics` address
2. `parseICS(text, { from: today − 7d, match: co.icsMatch, zone })`
3. match each row against that job's `source='feed'` rows on `ext_uid`, exactly
   as `calendarRows` does today: same UID and same times means unchanged, same
   UID and different times means replace in place keeping the shift's `id`, no
   UID on file means add
4. `report.cancelledRows` name shifts to remove
5. run the guards in §14.6; if any refuses, write nothing and record why
6. apply the changes and update `raw`, in one `batch()`, and append a poll record

**The cron must be idempotent, because Cron Triggers do not retry.** An
invocation that throws or times out is skipped silently until the next fire —
Heritage-Hooves states this and derives its whole tick design from it. Step 3
is already close, since it diffs on `ext_uid` rather than incrementing
anything, and the unique constraint in §14.3 is what makes "already applied"
a fact the database knows rather than one the code hopes for. A double-fire
must be a no-op, and a missed fire must cost nothing but fifteen minutes.
§14.6's "six hours without a successful poll" alarm is what catches the case
where they stop firing altogether, and it is doing more work than it looks.

**Cron Triggers are UTC-only**, which is most of what §14.10 used to leave open
about `zone`. The handler is told the zone; it never infers one.

Free plan fits, with room: 3 cron triggers per Worker against the one needed,
and D1's 100,000 rows written a day against roughly 100 — 96 poll records plus
whatever actually changed. The earlier KV draft made this same claim against a
1,000-writes-a-day ceiling, where a poll record on every tick plus a `raw`
update plus a second configured job would have been real arithmetic rather than
a rounding error. The number to actually measure is CPU — 10 ms per invocation
on the free plan, and a few dozen events of regex line-parsing should sit well
inside it, but "should" is doing work in that sentence. Database waiting does
not count toward it, only our own logic, which is the one way D1 is cheaper here
than a KV blob read plus a JSON parse. If it does not fit, the paid plan is $5 a
month and the alternative is not building this.

### 14.6 The guards, which replace the tick-box

§8.4 says a partial view of a schedule is indistinguishable from a week of
cancellations, and that is why removal is a proposal. Applying automatically
means answering it in code instead of asking him.

The rule holds for screenshots and does not transfer to a feed. Its evidence is
OCR's: a row scrolled off the top, a screenshot not taken, a page half-read. A
feed does not fail that way. It fails by being unreachable, by returning
nothing, or by returning something that is not a calendar — and every one of
those is detectable, which a missing screenshot is not.

So, refuse to apply anything and keep serving the last good feed when:

- the fetch is not a 200, or throws, or times out
- the body does not parse as a calendar (`report.notCalendar`)
- the calendar holds zero events
- a single pass would remove more than `max(3, 25%)` of that job's shifts
- a single pass would remove *every* future shift

Each refusal writes a poll record with its reason. Two consecutive refusals, or
any six hours without a successful poll, and the app's Setup screen says so in
a way that is hard to miss — the failure this project exists to prevent is not
a wrong shift, it is a calendar that has quietly stopped changing.

A machine that checks the feed parsed, is non-empty, and is not proposing a
massacre is a better safeguard than a tired man tapping "yes" through a review
list at eleven at night. That is the trade, stated so that reversing it later is
a decision rather than a discovery.

**What stays reviewed:** everything from a screenshot. The review screen does
not go away, it stops being on the Homebase path.

### 14.7 What has to change in the app first

Three extractions, each following the `parser.js` / `ics.js` pattern already
established — pure functions, `module.exports` at the bottom, plain script tag
in the browser, required directly by tests:

**`feed.js`** — `buildICS(shifts, companies, settings)`, plus `icsEscape` and
`fold` moved intact. Currently `app.js:859` and reads module scope. Both the
page and the Worker call this one, or they drift.

**`merge.js`** — the UID matching now inside `calendarRows` and
`cancellationRows`, lifted to `mergeCalendar(existing, rows, report, jobId)`
returning `{ add, replace, remove, unchanged }`. The page turns that into
review rows; the Worker applies it. One implementation, so the two paths cannot
disagree about what "already on file" means.

**`app.js`** — `doExport` POSTs in subscription mode instead of downloading;
Setup grows the push token and the status panel from `/status`; the manual
`.ics` download stays as the fallback for when the Worker is unreachable.

Setup does **not** grow a Worker URL field. Once the app is served by the
Worker (§14.4, §14.9), every call is a relative path to its own origin, and a
configurable base URL would be a way to get it wrong rather than a feature.

Both new modules get tests before the Worker is written, because they are the
part where a bug is silent.

Pass two, and it is not really optional: the phone reading the `source='feed'`
shifts back down so its own hours and pay views count the Homebase shifts it no
longer holds. §14.3 makes the Worker the source of truth, and the second half of
that pattern is a read-through cache on the device — which is what
Scheduling_App locked, and what stops the pay screen being quietly short. Until
it lands the calendar is right and the pay screen is wrong, and the screen
should say so rather than letting the numbers just be wrong.

### 14.8 Measuring the part that cannot be promised

Four hops, and only two are ours: Homebase to Google, Google serving its own
`.ics`, the cron's 15 minutes, ICSx⁵'s 15 minutes. Google publishes neither of
its two numbers. They are not the 8–24 hour problem — that is Google *polling*
someone else's feed, and this is Google *serving* its own — but "faster than
that" is not a figure.

So measure rather than claim. Every poll record carries the fetch time, the
event count, what changed, and the age of the newest `DTSTAMP` in the feed.
After a week of that, the true end-to-end delay is a number on the Setup screen
instead of an assumption in this document. It also answers §13's horizon
question for free: the Worker knows the date of the last event Calendar Sync is
publishing, so "nothing on file after Friday" (§10.5) becomes something it can
say without being asked.

### 14.9 What he sets up before any of this deploys

All one-time, none of them in the code, **and none of them a terminal
command.** Scheduling_App's guardrails put this plainly — "never instruct Ray
to run a CLI command or paste SQL into the D1 console; if a task seems to
require it, that is a bug in the task" — and an earlier draft of this section
broke that rule twice, asking for a KV namespace and three `wrangler secret
put` invocations. Everything below is the Cloudflare dashboard, the Google
Calendar UI, or the phone.

**The app moves under the Worker.** An earlier draft kept it on GitHub Pages
and paid for that in CORS (§14.4). It is now served by the Worker itself, which
is what all three of the other apps do. Two consequences, both one-time:

- **The PWA reinstalls**, because the origin changes. Test the install and
  offline mode at step 3 below, before going further — Star-homeschool's own
  deployment notes flag this as the one step with a user-visible cost.
- **`.assetsignore` at the repo root becomes load-bearing.** With
  `directory = "./"` everything not excluded is publicly downloadable. The
  `.git/` line is not optional: wrangler's default ignore list does not skip it,
  and without it the whole commit history is served as static assets.

**In a browser, before deploying:**

1. **Google Calendar → create a calendar named `Homebase Raw`.** Staging, per
   §13 — machine-readable, never rendered.
2. **Homebase → Settings → Calendar Sync → point the Calendar field at the
   staging calendar.** ✅ **Done, and it takes a named calendar.** The field
   offers any named calendar from the synced phone calendar app, and Homebase
   is already scoped to a staging calendar created for it. The §13 split holds
   as designed, which settles the one open question that could have changed
   what gets built:

   - `co.icsMatch` stays **empty** for Trupoint. `parseICS` skips filtering
     entirely on an empty needle (`ics.js:313`), so this costs nothing and
     needs no special case. It remains in the schema as the fallback for a
     future job whose app will only write to a whole account.
   - The guards get *stricter*, not looser. A calendar written to by one app
     and nothing else contains shifts and only shifts, so a row that will not
     parse is no longer noise to be skipped quietly — it is a signal that
     Homebase has changed its format or that something else has started
     writing there. The cron records unreadable rows as a distinct condition
     and says so on the Setup screen, rather than folding them into
     `report.unreadable` and moving on.

   Worth confirming once: the exact calendar name, since §14.9's next step
   needs that specific calendar's address and Google will happily hand over a
   different one's.
3. **Cloudflare → Workers & Pages → Create → connect to Git**, pick
   `NoliCommoveri/Shift-Stack`, branch `main`. A git-connected repo always
   creates a Worker now; there is no separate Pages option, and there must not
   be — **Cron Triggers do not run on Pages**, which is Heritage-Hooves' finding
   and the reason this is a plain Worker (`main = "worker/index.js"`,
   `[triggers] crons`, `export default { fetch, scheduled }`) rather than
   Star-homeschool's Pages-Functions build. A git-connected Worker takes all of
   its configuration from the committed `wrangler.toml`, so there is nothing to
   set here.

   *Checkpoint:* the assigned `…workers.dev` URL loads the app, and the PWA
   installs and opens offline from it.
4. **Cloudflare → D1 → Create database**, named `shift-deck`, then apply the
   schema from the app's own Settings screen. Browser-applied migrations are
   how both other D1 apps do it — Heritage-Hooves at `/admin/migrations`,
   Scheduling_App at Settings → Database — and both bundle the `.sql` files
   into the Worker with the same three-line `[[rules]] type = "Text"` block.
5. **Google Calendar → `Homebase Raw` → Settings → Integrate calendar → Secret
   address in iCal format.** Copy it. That string is the whole import.
6. **Cloudflare → the Worker → Settings → Variables and secrets** → add
   `PUSH_TOKEN`, `FEED_TOKEN` and the secret iCal address, each with type
   **Secret**, not Text. Secrets genuinely do work from the dashboard, unlike
   bindings — they are stored separately from `wrangler.toml`, which is also
   why a secret value is never committed. The iCal address belongs here and not
   in the config: it grants read of the calendar to anyone holding it.

   **The gotcha:** bindings and secrets only take effect on a deploy made
   *after* they were added. Push a commit or hit Retry deployment, or `env.DB` and
   `env.PUSH_TOKEN` are still undefined. §14.4's fail-closed rule is what makes
   that state safe rather than open.

**On the phone, after deploying:**

0. **Untick the staging calendar in the Google Calendar app.** It syncs down
   like any other calendar, and if it draws, every Trupoint shift appears
   twice — once raw from Homebase and once from the Work Schedule feed. §13
   calls it a data channel, not a view, and this is the step that makes that
   true on the device.

7. **ICSx⁵ → subscribe to `https://<worker>/feed/<FEED_TOKEN>.ics`**, sync
   interval 15 minutes.
8. **Google Calendar app → tick the new calendar visible** in its calendar
   list. It does not appear on its own, and this is the most common "it isn't
   working" that is not a fault.
9. **Settings → Battery → Background usage limits → Never sleeping apps → add
   ICSx⁵**, and stay off Maximum power saving, which disables sync adapters and
   does not re-enable them on the way out. Without this the 15-minute interval
   quietly becomes "whenever he next opens ICSx⁵", which is precisely the
   silent staleness §4 refused to accept.

**Then, once:** open the app at its `workers.dev` address, paste the push token
into Setup — there is no URL to paste, the app is talking to its own origin —
export once to seed the feed, and confirm a shift appears in the Google Calendar
app within half an hour.

### 14.10 Still open

- ~~Whether Homebase will write to a named calendar~~ — settled, it does
  (§14.9). The staging split is on and the import filter is not needed.
- **ICSx⁵'s authentication support** is unconfirmed (§14.4). Ten seconds on the
  phone decides whether the feed gets a second lock.
- **Worker CPU on the free plan** against a real Google export (§14.5). The
  first poll answers it. Moving to D1 (§14.3) probably helps rather than hurts,
  since database waiting does not count against the 10 ms and a `SELECT` is
  less of our own logic than a blob parse — but "probably" is doing work in that
  sentence, and the first real poll is still what settles it.
- ~~Where `zone` comes from~~ — settled. Cron Triggers are UTC-only and the
  Worker has no locale, so it is told: a per-job IANA name in `cfg`, defaulting
  to `America/Toronto`, validated on the way in and never inferred from the
  runtime. Settled on paper and not in the app for a month: nothing ever wrote
  `co.zone`, so every feed was read on the fallback and every Homebase shift in
  Central arrived an hour late. §35 is the field, the migration and the line
  that says which zone was used. Star-homeschool's `normalizeTimezone()` is the validator to lift —
  it already rejects a bare offset like `UTC+5`, which is the failure worth
  catching, because an offset is wrong for half the year in any zone that
  observes DST.
- **The pay screen is wrong until pass two** (§14.7), and it should say so.
- **Nothing here helps TrackTik**, which stays on screenshots until §5's email
  gets sent.

---

## 15. §14 read against the three Cloudflare apps that already exist

> **Applied.** Every correction below is folded into §14, which is now the
> version to build from. This section stays as the record of what was changed
> and why — and, more usefully, as the list of things to check the *next* time
> a Cloudflare design gets written here from scratch.

§14 was written from first principles. It should not have been. Three of Ray's
repos already run on Cloudflare, two of them have a written record of *why*
they are shaped the way they are, and one of them solved — as a locked decision
with the reasoning attached — two of the four problems §14 spends its length
solving.

The repos, and what each is:

| Repo | Shape | Storage | Cron | App served from |
|---|---|---|---|---|
| `Star-homeschool` | git-connected Worker, Pages-Functions source built to `dist/worker` | D1 | none | the Worker, `[assets] directory = "./"` |
| `Heritage-Hooves` | git-connected Worker, `src/index.ts` | D1 | `*/15 * * * *` | the Worker, `[assets] directory = "public"` |
| `Scheduling_App` | git-connected Worker, `management-app/worker/index.js` | D1 + R2 | none | the Worker, `[assets] directory = "./"` |

(There is no `sched-manager` repo. The scheduling one is `NoliCommoveri/Scheduling_App`.)

**None of the three uses KV. None of the three sends a cross-origin request.
None of the three asks Ray to run a CLI command.** §14 does all three.

### 15.1 What §14 gets right

Worth saying first, because most of it holds.

- **The 15-minute cron** is exactly Heritage-Hooves' interval, and for the same
  reason: a fixed schedule that fires more often than the work needs, with the
  handler deciding whether there is anything to do.
- **Pure functions with the I/O outside them.** §14.7's `feed.js` / `merge.js`
  extraction is Heritage-Hooves' §5.1 ("pure engines, thin database layer") and
  Star-homeschool's `functions/api/_lib/` under different names. `ics.js` and
  `parser.js` were already built this way. This is the house style, not a new idea.
- **The 10 ms CPU ceiling, and the response to it.** §14.5 says measure, and
  move to the $5 tier rather than contort the design. Heritage-Hooves §3 says
  the same sentence about its world tick. Same conclusion, reached twice.
- **Free tier only**, and no dependency with a hosted component. Locked in
  Scheduling_App, assumed everywhere else.
- **Google Drive.** §4 rejected it on OAuth grounds. Scheduling_App's decision
  table records it as **ABANDONED**, "solved a problem that no longer exists."
  Two independent rejections is a settled question.
- **The phone stops being the source of truth** (§14.3) is presented as this
  project's uncomfortable new cost. It is Scheduling_App's §III.A, locked:
  "D1 holds the truth. IndexedDB on both devices is a read-through cache plus a
  write outbox." Which also means §14.7's "pass two, not required" — the phone
  reading feed shifts back down — is not an optional extra. It is the second
  half of the pattern he has already standardised on, and the pay screen being
  short is what a missing read-through cache looks like.

### 15.2 KV should be D1

This is the big one.

§14.3 is a careful piece of design work solving a problem that does not exist
on the storage every other app uses. Its own words: "KV has no transactions and
no compare-and-set. One key with two writers loses writes." Everything after
that — the split by provenance, the one-writer-per-key rule, the union computed
at read time, the closing line "we are out of writers" — is scaffolding erected
around a limitation of KV.

D1 has atomic `batch()`. Two writers to one table is the ordinary case, not a
hazard to be designed around. Under D1 the store is one `shifts` table with a
`source` column (`manual` | `feed`), the phone writes its rows, the cron writes
its own, and `GET /feed` is a `SELECT`. The `raw/<jobId>` blob is a column or a
small table; the `polls` ring buffer is an append-only table with a `DELETE` on
a row count — which is `tick_run` in Heritage-Hooves and `reward_entries` in
Scheduling_App, a pattern with two prior implementations to copy from.

The free-tier arithmetic also moves the right way, and §14.5's version of it is
tighter than it reads. KV free is **1,000 writes a day**. A poll record on every
tick is 96 of them before anything changes; add `raw/<jobId>` and a second
configured job and the margin is real but not comfortable. D1 free is **100,000
rows written a day**. The question stops being a question.

The one thing KV would genuinely be better at is serving a static blob from
edge cache. §14.4 gives that up in its own text — the feed is "rebuilt whole on
every request" — so the advantage was never being collected.

### 15.3 The app should move under the Worker, and CORS should disappear

§14.4 spends a paragraph on the `OPTIONS` preflight, an exact-origin
`Access-Control-Allow-Origin` (correctly refusing `*`), and
`Allow-Headers: Authorization, Content-Type`, and closes on the irony that the
same browser rule blocking the import is the one the export has to satisfy.

The irony is optional. All three repos serve the app and the API from one
Worker via the `[assets]` binding, and Scheduling_App carries it as a locked
decision — *"One Worker serving both apps — same-origin, no CORS, one git
connection"* — with the failure that produced it written into its
`wrangler.toml`: a relative `fetch("/api/pair")` cannot resolve from a GitHub
Pages origin, so the assets directory was widened to the repo root.

§14.4's argument for staying on Pages is that the app carries no data, so §4's
world-readable objection does not apply. That is an argument for Pages being
*acceptable*, not better. Moving costs nothing in code — Shift Deck is already
"four files plus icons" with no build step (§3) — and removes the preflight
handler, the origin allowlist, a second URL to configure in Setup, and the
`PUSH_TOKEN` travelling cross-origin. §14.9's "**Not on the list: moving the
app**" should flip to being on the list.

Two things come with it, both one-time and both already documented in his own
notes:

- **The PWA reinstalls.** The origin changes, so the installed app and its
  service-worker cache are a fresh install. Star-homeschool's spec calls this
  out at exactly the same step: *"Test the PWA install and offline mode here,
  before going further — this is the hosting move, and it is the one step with
  a user-visible cost."*
- **`.assetsignore` becomes load-bearing.** With `directory = "./"` everything
  not excluded is publicly downloadable. Both repos that do this say so in
  capitals, and Star-homeschool adds the specific trap: wrangler's default
  ignore list does not skip `.git`, so without that line the whole commit
  history is served as static assets.

### 15.4 It has to be a plain Worker, not Pages Functions

§14 never says which. It matters, and Heritage-Hooves already answers it in one
line: **"Not Pages. Cron Triggers don't work with Pages."** Shift Deck's import
is a cron. So the template to copy is Heritage-Hooves (`main = "src/index.ts"`,
`[triggers] crons`, `export default { fetch, scheduled }`), not
Star-homeschool's `wrangler pages functions build` hybrid, which has no cron and
would need one bolted on.

Two more facts from that same file that §14 does not record and should:

- **Cron Triggers do not retry.** An invocation that throws or times out is
  skipped silently until the next fire. §14.5's diff-and-apply is close to
  idempotent already — it matches on `extUid` and rewrites the job's rows — but
  that should be stated as a requirement rather than left as a property. §14.6's
  "six hours without a successful poll" alarm is what catches the rest, and it
  is doing more work than §14 credits it with.
- **Cron Triggers are UTC-only.** Which is most of §14.10's open question.

### 15.5 §14.9 step 4 asks for a CLI, and that is a locked "never"

§14.9 tells Ray to create a KV namespace and run `wrangler secret put` three
times. Scheduling_App's guardrails: **"No CLI, ever — LOCKED. Migrations and
all ops are browser-driven,"** and, plainly, *"Never instruct Ray to run a CLI
command or paste SQL into the D1 console. If a task seems to require it, that
is a bug in the task, not in Ray's setup."*

Secrets do not need one. Star-homeschool's Step 6 documents the dashboard path
and why it works where bindings do not: Worker → Settings → **Variables and
secrets** → add, type **Secret**. Secrets are stored separately from
`wrangler.toml`, which is also why they are correct not to be committed. What
§14.9 does need to add is the gotcha that file records immediately after, and
which is the most common "it isn't working" that is not a fault:

> **Bindings and secrets only take effect on a deploy made after they were
> added.** Push a commit or hit Retry deployment, or `env.PUSH_TOKEN` is
> `undefined`.

Under D1 (§15.2) the namespace-creation step becomes creating a database in the
dashboard and applying the schema, and Ray has two existing implementations of
browser-applied migrations to lift — Heritage-Hooves' `/admin/migrations` and
Scheduling_App's Settings → Database — both of which bundle the `.sql` files
into the Worker with the same three-line `[[rules]] type = "Text"` block.

Net effect: §14.9's "three need a computer" drops to a dashboard session and no
terminal at all.

### 15.6 Token handling is thinner than the other three

§14.4 compares a bearer token against a secret with `===`. Every other repo is
stricter, and two of the differences are worth taking:

- **Fail closed on an unset secret.** Scheduling_App does this explicitly, with
  the reason in the comment: `if (!env.SYNC_TOKEN) return false; // fail closed
  — an unset secret opens nothing`. Given §15.5's deploy-ordering gotcha, an
  unset secret is a state this Worker will genuinely be in.
- **Constant-time comparison.** `timingSafeEqual` in Scheduling_App, used even
  for the Worker-secret path.

What does *not* transfer is hashing at rest and revocation. Star-homeschool
hashes device tokens because it stores them; `PUSH_TOKEN` and `FEED_TOKEN` are
Worker secrets, not stored credentials, and there is no device table to revoke
from. §14.4's instinct to use **two** separate tokens is right and is the same
instinct as Scheduling_App's three credential classes — a token that travels in
ICSx⁵'s settings and in request logs should not also authorise writes.

### 15.7 What changed in §14

Nothing about the *shape*. The cron, the guards, the 15-minute interval, the
three endpoints, the two tokens, the `feed.js` / `merge.js` extraction and the
decision to apply calendar shifts without review all stood. What changed is the
platform underneath them, and every change is toward what the other three apps
already do:

| §14 said | §14 now says | Why |
|---|---|---|
| KV, split by writer (§14.3) | D1, one `shifts` table with a `source` column | All three repos use D1; the split existed only to work around KV |
| App on GitHub Pages, CORS on `/push` (§14.4) | App served by the Worker, no CORS | Locked decision in Scheduling_App; the failure it fixes is recorded there |
| unstated | Plain Worker, not Pages Functions (§14.9) | Heritage-Hooves: cron does not run on Pages |
| `wrangler secret put` (§14.9) | Dashboard → Variables and secrets, plus the deploy-ordering gotcha | "No CLI, ever" is locked; the dashboard path is already documented |
| `===` against the secret (§14.4) | Fail closed on unset, constant-time compare | Both already written in `Scheduling_App` |
| no mention of retry (§14.5) | Idempotence required, and why | Cron Triggers do not retry; Heritage-Hooves derives its whole tick from this |
| "where does `zone` come from" open (§14.10) | A validated IANA name in `cfg`, never an offset | Cron is UTC-only; `normalizeTimezone()` already exists and already rejects offsets |
| pass two "not required" (§14.7) | the read-through half of §14.3, and not optional | Scheduling_App locked exactly this pairing |

### 15.8 One open question this does not close

§14.10's list loses `zone` and gains nothing, but the CPU question changes
character rather than going away: a `SELECT` and a few `INSERT`s against D1 is
more I/O and less compute than a KV blob read plus a JSON parse, and DB waiting
does not count against the 10 ms ceiling — Heritage-Hooves §3 makes that point
explicitly. So the move to D1 probably helps. "Probably" is still doing work in
that sentence, and the first real poll is still what answers it.

---

## 16. The first real OCR pass, 3 September 2026

§10.1 asked whether the parsers work at all on his real screens, and §11.2 made
a real Tesseract pass the gate on §8.2's design. It has now run, on one
screenshot from each app, and the answer is different for each.

### 16.1 TrackTik survives it

One fault, and it was not in the layout. The month header came off the screen
as `September Vv os` — the collapse chevron and a stray icon read as short
letter tokens — and `monthHeader()` allowed only `[~v^⌄\-_]` after the month
name. So `month` stayed null, and since a TrackTik date is a bare day number
that needs a month to mean anything, **every row on the screen came back
`nodate`**. Three shifts, all correct times, all correct labels, no date on any
of them. One over-tight character class, the entire screen unusable.

Widened to tolerate punctuation runs and one- or two-letter tokens, with digits
still excluded so a day number can never be eaten as noise. The week now parses
exactly: 9, 11 and 14 September, all 15:00–23:00, weekday cross-check clean, no
flags. `tests/fixtures/tracktik-2026-09-week2.txt` is the first fixture in the
repo that is neither PROVISIONAL nor TRANSCRIBED — it is what Tesseract
actually produced.

Three things worth recording beyond the fix:

- **The dark-mode path works.** `prep()`'s auto-invert had never executed
  against a real input (§11.2). It has now, on the dark TrackTik screen, and
  the text came back clean enough that am/pm survived on every row — which is
  the failure §6 names as most likely to cost him a shift.
- **The line order is not what the transcription guessed.** The TRANSCRIBED
  fixture has the weekday-and-time line above the day-number-and-site line, and
  so does the real OCR — but the real capture opens mid-row, so the first line
  on screen is a site with its times above the fold. The parser already handles
  that; it is worth knowing the transcriptions guessed the shape right.
- **§11.1's pipe finding is confirmed on real data.** The label arrives as
  `Cook Plant ASO | SOUTHERN HENS, I...` and reaches the review screen as
  `Cook Plant ASO - SOUTHERN HENS, I`, the separator already flattened by
  `normalise()`. §8.1 needs that boundary and it is destroyed before anything
  can read it.

### 16.2 Homebase does not survive it

The layout was read correctly and the dates are right. The times are not.
Ground truth for these exact days was already in the repo as a TRANSCRIBED
fixture, so the comparison is direct:

| | transcribed truth | from the real OCR |
|---|---|---|
| Thu 3 | 00:15–04:15 Training — Headquarters | 19:15–04:15, "Headquarters" |
| Thu 3 | 20:00–00:00 Training — F.O.C | **08:00**–00:00, "cc Training i - F.O.C" |
| Fri 4 | 00:15–08:15 Security Agent — Headquarters | 19:15–08:15, "Headquarters" |
| Sat 5 | 19:15–07:15 Security Officer — F.O.C | **dropped entirely** |

Three of four start times wrong, one shift silently missing, and the roles gone
from two of the three that survived. `12:15 am` came through as `19:15`, which
no downstream check can undo — the information is not in the text. `8:00 pm`
lost its meridiem onto the following line as `00pm .` and parsed as 08:00,
twelve hours out, which is §6's documented top risk happening on real input.
The Saturday row had one legible time where the two-single-times rule needs
two, so it did not become a flagged row — it became no row.

The `ampm` and `split` flags did fire on all three, so the app is not lying
quietly; the review screen says "no am/pm was printed — check the times". But a
fallback that needs every row's start time corrected by hand, and that can drop
a shift without saying so, is not much of a fallback.

### 16.2a Decided: the OCR path stays, on both jobs

Retiring the Homebase reader was on the table — Calendar Sync already delivers
that job's exact times, so the screenshot path is redundant on a good day. Ray
decided against it, and the reasoning holds: a feed that can be switched off,
fall behind or lose a location is not a reason to have no second way in. So the
faults above are a work list rather than an argument, and three of the four
have been fixed.

**The meridiem is recovered when it is legible.** `8:00 pm` lost its `pm` onto
the next line as `00pm .`; a following line that carries an unmistakable
meridiem and no time of its own now supplies it, and the row is flagged
`fixedap` — "printed on its own line and has been applied, check it" — rather
than passing itself off as a clean read. The bar is deliberately high:
`00pm` gives up its `pm`, while `2adM` and `28M` give up nothing. Guessing from
wreckage would reintroduce the twelve-hour error under a different name. That
shift now parses **exactly right**: 20:00–00:00, Training — F.O.C.

**The role is no longer stepped over.** The gather jumped from the start-time
line to the end-time line, so anything between them was lost — which is
precisely where Homebase puts the role. Together with a token-level debris
filter (a token mixing digits with letters is a broken time, not a word; two
letters or fewer is avatar debris) all four labels now come out right:
`Training - Headquarters`, `Training - F.O.C`, `Security Agent - Headquarters`,
`Security Officer - F.O.C`.

**A half-read shift is flagged, not dropped.** The Saturday row had one legible
time where the pairing rule wanted two, so it silently became nothing. It now
emits with the end left empty and an `onetime` flag. Nothing had to be invented
to make that safe: the review screen already renders an empty `type="time"` as
a blank asking to be filled, and the commit path at `app.js:952` already
refuses to file a row without an end. A shift that is *visibly incomplete*
costs a correction; a shift that is *absent* reads as a day off, and that is
the failure this project exists to prevent.

**What is left is not fixable here.** `12:15 am` came through as `19:15`. The
information is gone from the text and no amount of parsing recovers it, so two
rows in the golden are knowingly wrong and carry the `ampm` flag, which is the
honest limit of what the parser can say. Two things reduce that exposure and
neither is parser work: §8.2's plausibility check, and the fact that for this
job the feed is the primary path and OCR the fallback.

The capture is a committed fixture now rather than parked evidence, because
what it protects is real: the recovery, the gather, and the no-drop rule all
have a regression test made of text a real phone actually produced.

### 16.3 What the jobs actually look like

The screenshots settle the correction in §8.3, and they settle it with data.

**DSI on TrackTik is fixed.** Every shift seen, across both captures, is
15:00–23:00 at one site. The days across 3–14 September:

| Sept | 3 Thu | 4 Fri | 5 Sat | 6 Sun | 7 Mon | 8 Tue | 9 Wed | 10 Thu | 11 Fri | 12 Sat | 13 Sun | 14 Mon |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| shift | — | ✓ | — | — | **hol.** | ✓ | ✓ | — | ✓ | — | — | ✓ |

Monday, Tuesday, Wednesday, Friday. Thursday and weekends off. The one Monday
without a shift is 7 September — Labour Day, the first Monday of the month —
which Ray confirmed is a holiday rather than a change of rota. So the pattern
is `{ days:[1,2,3,5], start:'15:00', end:'23:00' }`, exactly §8.2's shape,
including the `days` field that makes a pattern generative.

**Trupoint on Homebase is PRN.** Four shifts in three days: 00:15–04:15,
20:00–00:00, 00:15–08:15, 19:15–07:15. Three different roles — Training,
Security Agent, Security Officer — across two sites. Nothing here repeats.

### 16.4 What the correction costs each section

- **§8.2 gains.** The declared-pattern check is worth most on the job whose
  times are stable, and that is the job on OCR. DSI's pattern is one line and
  is already known. The am/pm control lands where am/pm is actually read.
- **§8.3 gains a great deal.** Generation applies to the job with no feed, so
  "most weeks it needs no screenshot at all" now means most weeks the *only*
  OCR path in the product goes unused. That is the largest single reduction in
  manual effort available anywhere in §8, and §11.3 rates it an evening's work.
- **§8.3 also gains a named risk.** Its warning that "pretty fixed is not
  fixed" has a concrete instance on the very first fortnight of real data:
  Labour Day. Statutory holidays are the predictable exception, and a generated
  week that emits a shift on one would fire alarms for work that does not
  exist. Generation should skip them or mark them for confirmation — and since
  they are known years ahead, this is a lookup, not a guess.
- **§8.4 loses its headline.** Its most-valuable third bucket, "on file but not
  in this screenshot", was justified for a PRN job. The PRN job is Homebase,
  which arrives by feed — where §12 and §13 already detect cancellations,
  because a feed has stable identity and OCR does not. What §8.4 is left with
  on the TrackTik side is narrower and easier: catching the week that deviates
  from a known rota.

### 16.5 What this does to the order in §11.3

Step 1 is done for TrackTik and has answered its question for Homebase. What
follows moves:

- **§8.2 and §8.3 are now cheap and high-value**, and both depend on a pattern
  that today's data hands over for free. Neither needs the site table first.
- **§8.4 shrinks**, and its hardest part is already built on the feed side.
- **The Homebase decision is taken** (§16.2a) and the work it implied is done.
  What survives it is a parser limit, not a task.
- **Step 1's remaining OCR tuning** — page-segmentation mode and a character
  whitelist (§10.7) — should be judged on TrackTik alone now. TrackTik came
  through clean, so the case for touching Tesseract's settings is weaker than
  §11.2 assumed.

---

## 17. Screenshots are the plan now, 3 September 2026

The TrackTik distribution email is closed as a dead end (§2). It had been
carried since the beginning as the one thing that could replace the OCR path
wholesale, and it is not coming. What follows is not a small change of plan:
every argument in §8 that read "worth doing unless the email lands" now reads
"worth doing".

### 17.1 What the closure costs, and what it settles

**§8.4 is needed in full.** Its own text says most of it "stops being
necessary" if email parsing arrives. It has not, so change detection on
screenshot rows — including the third bucket, on file but not in this
screenshot — is real work with no cheaper substitute.

**The OCR path is load-bearing, not provisional.** This is the second decision
in a day pointing the same way: §16.2a kept the reader on both jobs, and this
one makes it the only way DSI shifts ever enter the app. The month-header fix
in §16.1 was not a tidy-up; it was the difference between a working product and
a screen of undated rows.

**Nothing is coming automatically for DSI, ever.** That single fact is what
§17.3 is built on, and it is worth stating plainly because the app's two jobs
now sit on opposite sides of it.

### 17.2 The proposal: put the normal week through the manual flow

DSI is a fixed rota — Monday, Tuesday, Wednesday, Friday, 15:00–23:00 (§16.3).
With no email and no feed, the sensible primary input is not the screenshot at
all. It is **the rota itself, proposed into the manual flow**, with screenshots
demoted to what they are good at: catching the weeks that deviate.

§8.3 already describes the machinery — "Fill week of ___" emits rows into the
existing `pending` array, so it reuses the review screen, its flags, the commit
path and the diff in §8.4. What changes is its standing. It was written as a
convenience for a job that mostly needed no screenshot; it is now the intended
normal path for the only job that has no automatic one.

The shape that follows from that:

- **Generated rows are proposals, never facts.** They land in review like any
  import and he confirms them. `source:'pattern'` already distinguishes them,
  and §8.3's hollow tick keeps assumption visually separate from fact.
- **A screenshot corrects the proposal rather than creating it.** That is a
  better use of a reader that mangles one character in a time than asking it to
  originate the whole week.
- **Holidays are the known exception and must be handled.** Labour Day is
  already in the first fortnight of real data (§16.3): the rota says Monday,
  the screen says no shift. A generated week that emits a shift on a statutory
  holiday fires alarms for work that does not exist, which §8.3 names as the
  thing that corrodes trust. They are known years ahead, so this is a lookup
  and not a guess.
- **Unconfirmed proposals must not pile up silently.** §8.3 already asks for
  this; §17.4's warning is the place it belongs.

### 17.3 Built: "nothing on file after Friday", per job

§10.5's warning is in, on the Schedule tab where he actually looks, and it is
per job because the two jobs fail differently:

- **DSI** — "Nothing is coming automatically for this job — add next week."
  Actionable, because nothing arrives unless he brings it.
- **Trupoint** — "The calendar should be filling this — check Calendar Sync."
  Quieter, and styled to match: worth knowing, not a job to do.

A job counts as feed-backed when its `icsMatch` is set, which is already how a
calendar event finds its job — so no new field and nothing to migrate, which
keeps §7 intact.

Showing the feed-backed job a quieter note rather than nothing is deliberate.
Suppressing it entirely would make a broken Calendar Sync invisible, and an
empty calendar reading as a day off is the precise failure this warning exists
to prevent — it does not stop being that failure because the cause was a sync
rather than a forgotten screenshot.

### 17.4 Built: the employer's separator survives

§11.1's finding is fixed, deliberately and before §8.1 rather than halfway
through it. `normalise()` flattened TrackTik's `|` to `" - "`, which is exactly
what the Homebase label join produces, so a real boundary and an arbitrary glue
join were indistinguishable at the point §8.1 wants to read one.

The pipe is now kept, spacing canonicalised, and `tidy()` no longer strips it:

| in a label | means |
|---|---|
| `" \| "` | a boundary the employer printed — `splitLabel()` can trust it |
| `" - "` | fragments this parser glued together — says nothing about structure |

`splitLabel()` is exported and tested and nothing reads it yet. That is the
point: §8.1 starts from a boundary that is already correct.

One knock-on, taken now because it is free now. The label is what the `.ics`
`SUMMARY` is built from, so TrackTik events read `DSI- Cook Plant ASO |
SOUTHERN HENS` instead of `DSI- Cook Plant ASO - SOUTHERN HENS`. §8.1 warns
that changing `SUMMARY` rewrites every event and is messy in manual-import
mode. Under §7 there is no live data yet, so the rewrite costs nothing today
and would cost something later — which is an argument for having done it now.

### 17.5 Where this leaves the order

Step 0 is gone. Step 1 is done (§16). Step 2 is now partly done — the horizon
warning is in; `METHOD:CANCEL` (§10.6) is still open. The rest reorders around
one fact: **the fixed job's rota is the highest-value unbuilt thing in the
document**, because it is the only job with no automatic input and the one
whose input is a reader that mangles times.

| | Work | Why here |
|---|---|---|
| 1 | **§8.2 patterns** for DSI | One line of config, already known from §16.3. Prerequisite for the next row |
| 2 | **§8.3 generation**, with holidays | §17.2's proposal. An evening's work per §11.3, and it removes most weeks of OCR |
| 3 | `METHOD:CANCEL` (§10.6) | The remainder of step 2; no schema |
| 4 | **§8.1 site table** | Unblocked now (§17.4). Still the heaviest, and everything after assumes `siteId` |
| 5 | **§8.4 change detection** | Needed in full now the email is closed; wants stable site identity first |

**Step 1 is built** — see §18, which restates this table with it struck off.

§8.2 and §8.3 moving ahead of §8.1 is a change from §11.3, and it is worth
being explicit about why: they need no schema, they depend only on a pattern
today's data already hands over, and together they take the OCR path off the
critical route for most weeks. §8.1 remains the bigger prize for labels and for
the `LOCATION:` line that makes an address tappable, but it no longer has to go
first.

---

## 18. Built: declared patterns, 3 September 2026

§8.2 is in, which closes step 1 of §17.5 and puts §8.3 within reach. The
config for DSI is the one line §16.3 predicted, typed once in Setup:

```js
co.patterns = [{ days:[1,2,3,5], start:'15:00', end:'23:00' }]
```

### 18.1 Where it lives, and why that is a new file

`patterns.js`, a third pure module alongside `parser.js` and `ics.js` — no DOM,
no storage, required directly by `tests/patterns.test.js`. It is not part of
either reader because it is not about reading anything: both readers turn
somebody else's text into rows, and this takes a finished row and a list a
human typed and decides what to do about the gap between them. Putting it in
`parser.js` would also have tied it to the screenshot path, and the length
check below is worth having on rows the screenshots never touched.

The app-side wiring is one function, `applyPatterns()`, which is the only place
that knows which rows are eligible.

### 18.2 The distances, as §8.2 set them out

| Distance from a declared shift | Built as |
|---|---|
| Exactly ±12h | Corrected, row amber, "Read as 03:00–11:00." under the flag |
| Within 5 minutes | Snapped, silently |
| Anything between | Untouched, flagged "not a shift declared for this job" |
| Wrong day for a rota with `days` | Untouched, same flag |
| No patterns declared | Length check only |

Each end of the shift is judged separately, which the real data forced: §16.2's
worst row was `8:00 pm` read as 08:00 against a correct 00:00 end, so a rule
requiring both ends to be twelve hours out would have missed the one misread
that actually happened.

Where two declared shifts could both explain a row, the one needing no flip
wins before the closer one does. A job whose declared shifts sit twelve hours
apart — a day rota and a night rota on the same site — must not become a
machine for inventing misreads.

**Snapping stays narrow on purpose.** §8.2's warning is that snapping a shift
the employer genuinely moved makes him late with no screenshot discrepancy left
to notice, so the two tolerances are five minutes and exactly 720, and the
whole hour-or-two range between them is flagged rather than touched.

### 18.3 The length check, which needed no patterns at all

§8.2's table ends with "duration and overlap checks still apply — they need no
config". The duration half is below; the overlap half is §19. This row turned
out to be the one that lands on Trupoint. Its job
has no rota to declare, and §16.2's misread made a 16-hour shift out of a
4-hour one. Anything under an hour or over fourteen is now flagged on any
screenshot row, declared patterns or not. Fourteen is chosen against the data:
the longest real shift seen is the 12-hour Saturday night in §16.3.

A correction re-runs the check rather than leaving the old verdict standing —
a row that was impossible as read is usually sensible once put right, and an
amber warning about a number no longer on the row teaches him to ignore amber.

### 18.4 What it refuses to do

- **Calendar rows and hand-typed rows are never touched.** A feed carries the
  employer's own numbers and a typed row carries Ray's; correcting either
  against a declared rota is overwriting fact with assumption, which is §8.2's
  own objection pointed the other way.
- **A half-read row is not completed from a pattern.** §16.2a's Saturday shift
  emits with a blank end and an `onetime` flag. Filling that end in from the
  rota is inventing the number, and §16.2a already settled that guessing from
  wreckage reintroduces the twelve-hour error under another name.
- **Nothing is learned from history.** §8.2 rejected that and the rejection
  holds: the history is the parser's own unvalidated output, so a committed
  misread would become evidence and the check would get quieter each time it
  failed.

### 18.5 The review screen keeps up

Two things decide which declared shifts a row is judged against — its date and
its job — and both are editable in review, so both re-run the check. That
matters more than it sounds: §16.1's screen came back with **every row
undated**, and until a date is set no rota with `days` can be resolved. An
undated row is still judged on its times alone; setting the date then brings
the day into it.

Re-running had to be idempotent, so each row keeps what was read off the screen
and every run is judged against that rather than against the previous run's
output. Without it the second run finds its own correction sitting there
looking exactly right and drops the warning that came with it — a check that
erases its own evidence.

Once he types a time himself, the row is his: nothing is applied over it, and
the pattern verdict is cleared rather than left amber over a number that is no
longer there.

The corrections run **before** the duplicate filter, not after. A row twelve
hours out is a duplicate of nothing until it has been put right.

### 18.6 Declaring it, and the shortcut past the typing

Seven day toggles and two clocks per pattern, in the job's card in Setup. The
toggles are the only switch between the two kinds of pattern, as §8.2 asked:
ticked days mean the pattern describes when the job runs and can fill a week
(§8.3); no days ticked means it is only ever compared against. A pattern with
an unfinished time is dropped rather than half-believed, which is why "Add a
shift" starts blank — a made-up default left in by accident would flag every
real shift as off-pattern.

**"Build from what's on file"** is §8.2's suggestion list: the distinct
start/end pairs already filed for the job, most common first, with the days
each was actually filed on pre-ticked. Nothing is applied — he adds the ones he
recognises. That is the difference between this and the rejected
learn-from-history design, and it is the whole difference: a human filtering
the parser's output is what stops the parser's output becoming authority.

### 18.7 §7 is intact

`co.patterns` is an additive optional field on the company record and every
read of it is guarded, so a job saved before today behaves exactly as it did.
That is the same technicality `extUid` and `place` passed on in §11.4, and it
is still not the case §7 is about — no value moves and nothing saved earlier
means something different now. §11.4's check therefore still stands unspent for
§8.1, which is the step that will actually need it.

### 18.8 Where this leaves the order

| | Work | Why here |
|---|---|---|
| ~~1~~ | ~~**§8.2 patterns** for DSI~~ | Done — this section |
| ~~2~~ | ~~**§8.3 generation**, with holidays~~ | Done — §21, after the reading in §20 |
| 1 | `METHOD:CANCEL` (§10.6) | No schema |
| 2 | **§8.1 site table** | Still the heaviest; everything after assumes `siteId` |
| 3 | **§8.4 change detection** | Wants stable site identity first |

§8.3 needs three things from here and has all three: a pattern with `days`,
`source:'pattern'` to render a proposal differently from a fact, and the
`pending` array a generated week is emitted into. What it still has to bring
of its own is the statutory-holiday lookup (§16.4, §17.2) — Labour Day sits in
the very first fortnight of real data, and a generated week that fires alarms
for a shift that does not exist is the failure §8.3 names as trust-corroding.

---

## 19. Built: overlap, and the end of the turnaround warning

The other half of §8.2's no-config row. Ray raised it against §18 and settled
the shape of it in one sentence: two shifts on the same day are common — he
often goes straight from one job to the other — and **only real overlap of
hours is a concern, and it is a major one**.

### 19.1 The turnaround warning was the bug

`app.js` had flagged any two shifts on one day with under an hour between them:
"Only 45 min between these." For these two jobs that is the ordinary case, not
a fault. It fired constantly on nothing, and it was the *same line* that had to
carry the case that matters — so the one warning in the app about being booked
twice was the one he had already learned to scroll past.

Removed rather than tuned. There is no threshold that makes it right, because
the thing it was measuring is not a problem.

### 19.2 What replaces it, and why it needed a timeline

Overlap only, measured in minutes both shifts are scheduled for. Zero is a
handover, not a clash, so a shift ending at 15:00 and one starting at 15:00 say
nothing.

The check works on an **absolute timeline** — days since 1970, times as minutes
on it — rather than inside a date, and the real data forces that. Trupoint's
shifts are 19:15–07:15 and 00:15–08:15 (§16.3): overnight is that job's normal
shape, so the collision to catch is a night running into the next morning's
shift, and the two sit on different dates. The old check bucketed by day and
compared each shift only with the one before it in the same bucket, so that
collision — the likeliest real one — was structurally invisible to it.

Two more things the old one could not see, both now fixed:

- It dropped any overlap deeper than ten hours (`gap > -600`), so **the worst
  collisions were the quietest**. A shift wholly inside another said nothing at
  all.
- It only ever ran on the Schedule tab, after commit — by which point the shift
  is filed and, in subscription mode, going out on the next export.

### 19.3 Three places it now shows

- **In review, during the add.** A pending row is checked against what is on
  file *and* against the rest of the batch, since a screenshot and an `.ics`
  imported in one sitting can collide with each other as easily as with
  history. Rows the import is about to replace or remove are not counted —
  they are the same shift seen twice, and counting them would flag every
  ordinary calendar update as a clash with itself.
- **As a banner over the schedule**, red, above the §17.3 horizon notes.
  This is the one Ray asked for and the reason is the arrival path: Calendar
  Sync writes a Trupoint shift into Google, the `.ics` comes in, and it lands
  on top of a DSI shift already on file. **Nobody is looking at that week when
  it happens.** A warning he has to scroll to the right week to find is a
  warning about a shift he has already stopped thinking about.
- **Beside both shifts** in the week list, each naming what it runs over and by
  how much. Two lines where the old check printed one, which is the right trade
  for the only failure in this app with no recovery.

### 19.4 It never proposes a fix

Which of the two shifts is wrong is not something this app can know. The feed
may be right and the screenshot stale, or the screenshot right and the feed
carrying a shift the employer has not withdrawn. So every message names both
sides and stops: "Trupoint 19:15–07:15 runs over DSI 06:00–14:00 by 1h 15m. He
cannot work both — one of them is wrong."

That is also why nothing here blocks a commit. §8.4's rule holds — a partial
view of a schedule must never cause an automatic removal — and a clash is
exactly the case where the app knows least and he knows most.

### 19.5 Where it lives

`patterns.js`, beside the declared-pattern checks, because §8.2's table names
the two together and both take a finished row and decide what is wrong with it.
`clashMins()`, `findClashes()` and `clashPairs()` are pure and tested; the app
side is `applyClashes()` for review rows and `clashNotes()` for the banner.

One wiring note worth recording: a clash is a property of the batch, not of a
row, so correcting one review row can raise or clear a warning on a different
one. Every row hands back a way to refresh its own note line and they are all
called together, rather than re-rendering the list — which would reorder rows
and drop focus mid-edit, the same reason §9's review screen refreshes in place.

Nothing about the order in §18.8 changes. §8.3 generation is still next, and
now inherits an overlap check that a generated week will be run through like
any other import.

---

## 20. §8.3 read against the code, 3 September 2026

§18 and §19 left generation as the next thing to build, and §18.8 recorded that
it needs three things and has all three: a pattern with `days`, `source` on the
shift record, and the `pending` array to emit into. That much is true. Reading
§8.3 against the file it will be built in turns up four things it assumed which
are not there, and one risk it never mentions that is worse than the one it
does.

None of this changes the plan. It changes what "an evening's work" contains.

### 20.1 What §8.3 gets right

The load-bearing decisions survive the reading, and two of them are better than
they looked when they were written.

- **Emitting into `pending` is exactly right.** The review screen already runs
  the length check, the overlap check (§19.3), the per-row date and job editors,
  and the commit path that keeps `place`, snaps the site name and files the
  record. A generated week costs none of that twice.
- **`source:'pattern'` already flows through the commit path** unchanged —
  `source: p.source || 'ocr'` on `app.js:1310` — so nothing has to be added to
  store it.
- **`applyPatterns()` already refuses to touch a generated row.** It returns
  early for any row whose `source` is not `ocr` (`app.js:876`), written for
  calendar and hand-entered rows. That guard is what stops a generated row from
  being checked against the pattern it was generated from, which would always
  pass and would mean the app confirming its own assumption. It needs no change,
  and it is worth saying so before someone tidies it.
- **`days` naming the day the shift *starts*** (`patterns.js`) is the rule that
  makes an overnight rota generable at all. A Saturday 19:15–07:15 pattern fills
  Saturday and files under Saturday, which is where the record already goes and
  what `absSpan()` already expects.

### 20.2 The promotion §8.3 depends on cannot happen

This is the one that breaks the section's own mitigation.

§8.3 says a generated shift is an assumption until "a screenshot import then
promotes them to confirmed". Today it cannot. `bySlot()` (`app.js:850`) drops an
incoming row that matches a filed shift on job, date, start, end and site — and
a generated shift is precisely the thing a later screenshot matches exactly. The
confirming row is discarded as a duplicate, nothing is written, and the record
stays `source:'pattern'` for ever.

The hollow tick therefore never fills in. Every week he actually worked stays on
screen as an assumption, which is the fastest possible way to teach him that the
distinction means nothing — and the distinction is the whole mitigation.

Worse in the same function: when the times match but the site does not, the row
gets `FLAG_MOVED` — "a shift is already on file at this time in a different
place — adding this will not replace it". Against a generated row that is a
false statement dressed as a warning. The site on a generated row was never read
off anything; §8.3 itself calls it a convenience default. A screenshot
disagreeing with an invented label is not a location change, it is the first
real information anyone has had about that label.

**Settled:** `bySlot()` gains one case. When the matching filed record is
`source:'pattern'`, the incoming screenshot row is not a duplicate and not a
move — it is the confirmation. It keeps `p.replaceId = existing.id` and goes
through to review like any other row, and the commit path already does the rest:
`replaceId` replaces in place and **keeps the record’s id** (`app.js:1322`),
which keeps the calendar UID stable, so the phone sees an update rather than a
second event. The replacement is written with the incoming row's `source`, so
promotion is a consequence of the existing code rather than a new mechanism.

That also gives the screenshot its proper job on this route, the one §17.2
described: it corrects the proposal instead of originating the week.

### 20.3 A filled week silences the one prompt to act

`horizonNotes()` (`app.js:255`) finds the last date on file per job and says
"nothing on file after Fri 11 Sep — nothing is coming automatically for this
job, add next week". It counts every shift regardless of `source`.

So generating a week turns that warning off. The app then says nothing at all
about the week, and what it is silent about is four assumptions. §17.2 already
asked for the opposite — "unconfirmed proposals must not pile up silently" — and
named §17.3's note as the place it belongs. It has to actually go there, or
generation quietly converts the only standing prompt in the app into a
reassurance.

**Settled:** the horizon note is computed over confirmed shifts, and a filled
week gets a note of its own rather than no note:

> Next week is filled from the rota — 4 shifts, none confirmed against a
> screenshot.

And the pile-up rule §8.3 asked for, made concrete: a `source:'pattern'` shift
whose **date has passed** and which was never promoted is the signal worth
raising, because it means the screenshots stopped arriving and nobody noticed.
Counting unconfirmed shifts in the future would fire on the ordinary case the
day after he generates, which is §19.1's mistake exactly.

### 20.4 Pay counts an assumption as earnings

§8.3 does not mention the pay tab, and the pay tab is where a wrong assumption
costs the most.

`weeksFor()` and `weekTotals()` (`app.js:154`, `app.js:163`) sum every shift on
file for the week, work the overtime threshold across them and print a gross
figure. Nothing in that path reads `source`. A generated week therefore shows up
as money — with overtime, to the cent — before anyone has confirmed that any of
it happened.

This is a different failure from the one §8.3 names. An alarm for a cancelled
shift wastes a morning; a pay figure built on assumptions is checked against a
deposit weeks later, when the screenshot that would have settled it is gone.

**Settled:** a week containing unconfirmed shifts says so on the pay row, with
the assumed hours named separately — "32 h, of which 8 h is from the rota and
unconfirmed". The figure is not suppressed: a forecast is useful and this app's
whole posture is to show the number and say what it rests on.

### 20.5 The alarm carries no mark, and the alarm is where the risk lands

§8.3's stated risk is that the app "fires alarms for work that does not exist".
The mitigation it offers — a hollow tick — is in the app. The alarm is in his
calendar, which knows nothing.

`buildICS()` (`app.js:1214`) writes every shift with the same `SUMMARY` and the
same `VALARM` bodies, and generated shifts export like anything else: `sent` is
unset on a new record, so in subscription mode the next feed rebuild carries
them, unattended, exactly as §19.3 describes for clashes. At 05:00 on a Monday
the phone cannot tell an assumption from a fact, and that is the moment §8.3 is
actually about.

**Settled:** for `source:'pattern'`, the event title and the alarm body carry
the mark — `DSI- De la Montagne (from the rota)`. It costs one conditional in a
string that is already built per shift, it survives into the alarm because the
alarm reuses the title, and it turns a 05:00 alarm from a claim into a question.

### 20.6 "A hollow tick" — what that is on this screen

Worth pinning down before it is built, because the words do not match the
markup. The schedule row's `.tick` is a 3 px vertical colour stripe
(`index.html:104`), not a tick mark, and the class name is taken a second time
by the review screen's checkbox label (`index.html:139`).

**Settled:** the stripe stays the job's colour and goes hollow — outlined rather
than filled — for `source:'pattern'`, plus the word *rota* in the row's second
line beside the site. Colour alone is not enough on a 3 px rule, and the second
line already carries "job · site" so there is a place to put a word.

### 20.7 Holidays: mark them, never skip them

§16.4 left this as "skip them or mark them for confirmation". It should be
settled now, because the two behave very differently on the week he does work.

Skipping silently is wrong on the evidence available. There is exactly one
observation — DSI ran no shift on Labour Day (§16.3) — and a silent skip
generalises from it to every statutory holiday for ever. On the holiday he does
work, a skip produces a missing shift with nothing on screen to notice, which is
the one failure this app exists to prevent; §8.3's own ranking says a wrong
shift is cheaper than a missed one.

Marking has none of that asymmetry. A generated row is a proposal in a review
screen, so the holiday question gets asked where it costs one tap, before
anything is filed and long before anything rings:

> 7 Sep is Labour Day. The rota says Monday — remove this if he is not working
> it.

He removes it or he leaves it. The app never has to decide, which is the right
posture for a fact it cannot know and he can.

The lookup itself stays what §16.4 said it was — a table, not a guess, and for
this app a small static one. No runtime dependencies (§9) and no network, so it
is a list of dates per jurisdiction in a file, and the jurisdiction is a
per-company field because the two employers need not share one.

### 20.8 The smaller things generation still has to settle

| Question | Settled |
|---|---|
| Which week is "a week"? | The pay week, `co.weekStart ?? 0`. Note the app is already inconsistent: `renderSchedule()` hardcodes Sunday (`app.js:362`) while `weeksFor()` uses `co.weekStart`. Generation follows pay, which is the one with a meaning he chose |
| Can it fill backwards? | No. Dates before today are never generated — past hours land in the pay tab as earnings nobody verified, and in the feed as events whose alarms have already gone off |
| What is the site default? | Label **and `place`** from the most recent filed shift for that job matching the pattern's times. Carrying `place` is what keeps the alarm's address tappable (`app.js:1236`); label without it is a downgrade from every other route into the app |
| Filling the same week twice? | The generated rows go through `bySlot()` like any import, with §20.2's promotion case. An exact repeat drops; a day already holding a different shift generates and the §19 overlap check flags it, which is correct — the employer moving a shift is exactly what should be visible |
| Two patterns, same times, same day? | Deduplicate on (day, start, end) before emitting. `validPatterns()` does not deduplicate, and nothing stops the same rota being declared twice |
| A half-typed pattern? | Never generates. Generation goes through `validPatterns()`, which already drops a pattern with an unreadable time and drops empty `days` so "no days ticked" reads as checking-only everywhere |
| Editing a generated shift by hand? | Promotes it. `editShift()` (`app.js:685`) writes every field and leaves `source` alone, so a shift he corrected himself would stay drawn as an assumption and keep counting as unconfirmed. A hand edit is the strongest confirmation there is |
| Where does the code live? | The date arithmetic goes in `patterns.js` as a pure function beside the rest — dates and validated patterns in, rows out, no DOM and no storage — so it is tested like §18 and §19. `app.js` picks the week, resolves the label and `place`, and pushes into `pending` |

### 20.9 What changed in §8.3

Folded in above the fold, so the spec is what gets built:

- The promotion path is named rather than assumed (§20.2).
- The horizon note and the pay tab are named as places that must learn to read
  `source` (§20.3, §20.4).
- The mark follows the shift into the calendar (§20.5).
- Holidays are marked, never skipped (§20.7).
- Generation never fills backwards, and a hand edit confirms (§20.8).

Nothing in §8.3's shape changed. Its two load-bearing sentences — emit into
`pending`, and a convenience default is fine for a label where it would not be
for a time — are both still exactly right.

### 20.10 Where this leaves the order

Unchanged from §18.8. §8.3 is still next and still an evening, with the reading
above deciding what that evening contains: the generator itself is small, and
the four places that have to learn the difference between an assumption and a
fact — `bySlot()`, the horizon note, the pay tab and the `.ics` title — are the
work.

One thing the reading is worth on its own: three of those four are places where
a generated shift would have been silently indistinguishable from a confirmed
one. `source` has been on the record since the beginning and, until §8.3, only
ever gated one early return.

**Built the same day: §21.** Everything settled above went in as settled, and
the reading held — the four places were the work, and the generator itself came
to about forty lines.

---

## 21. Built: filling a week from the rota, 3 September 2026

§8.3, as corrected by the reading in §20. The fixed job has no feed and no
email, so its normal input is now the rota itself proposed into the review
screen, with screenshots demoted to catching the weeks that deviate — which is
what §17.2 asked for and the largest single reduction in manual effort
available anywhere in §8.

**Add → Fill a week from the rota**, per job, per week. The rows land in
`pending` and everything downstream was already built: the review screen, its
flags, the length check, §19's overlap check, the site snapping and the commit
path all treat them like any other import.

### 21.1 Where it lives

- **`patterns.js` gains the generator**, beside the checks, as §20.8 said it
  should: `weekDates()` hands back the dates of a week and `generateWeek()`
  turns validated patterns and a list of dates into rows. Pure, and tested the
  way §18 and §19 are — dates in, rows out, no DOM and no storage. Two small
  helpers came with it, `isoFromDayNum()` and `dowOf()`, which walk the
  calendar on the same integer number line the overlap check already uses
  rather than through a local-time `Date`.
- **`holidays.js` is new**, for the same reason `patterns.js` was in §18.1: it
  is a different kind of knowledge. It answers one question — what, if
  anything, falls on this date in this jurisdiction — and it answers it by rule
  rather than from a typed-out table, because a table of dates runs out in a
  few years and then goes quietly wrong, which is the exact failure the file
  exists to prevent. Québec and the US federal list, both checked against the
  calendar in `tests/holidays.test.js`, including the two dates hand-rolled
  date maths usually gets wrong: Easter, and the Monday preceding 25 May in a
  year when 25 May is itself a Monday.
- **`app.js` does what a pattern cannot say**: which dates, which site, which
  address, and whether the slot is already taken.

The first test written was the one from §16.3: DSI's `{ days:[1,2,3,5],
start:'15:00', end:'23:00' }` over the week of 7 September 2026 gives Monday,
Tuesday, Wednesday and Friday at 15:00–23:00. That is the fortnight of real
data, generated.

### 21.2 The four places that learned the difference

§20's finding was that generation is small and the four places that had to tell
an assumption from a fact are the work. That was right, and each is one small
change:

| Where | Before | Now |
|---|---|---|
| `bySlot()` | Dropped a screenshot row matching a filed shift exactly | A match against a `source:'pattern'` record carries `replaceId` and goes to review as a **confirmation**. The commit path replaces in place keeping the id, so the calendar sees an update, not a second event. The site is not compared: the label on a generated row was invented here, so the screenshot's is the first real information about it |
| Horizon note (§17.3) | Counted every shift, so a filled week switched the prompt off | Counts confirmed shifts, and a filled week gets a quieter note of its own naming how many are unconfirmed. A separate note fires on proposals whose **date has passed** unconfirmed — the state that means the screenshots stopped arriving |
| Pay tab | Summed everything and printed a gross to the cent | A week holding proposals says so: "8.00 h from the rota, unconfirmed". The figure is not suppressed — a forecast is useful — but it says what it rests on |
| `buildICS()` | Every event identical | `DSI- De la Montagne (from the rota)`, which the alarm body reuses. The hollow tick is in the app; the 05:00 alarm is where §8.3's stated risk actually lands |

Two smaller ones from §20.8. `editShift()` promotes a proposal to `manual` on
save, because going through the shift by hand is the strongest confirmation
there is. And §8.3's "hollow tick" turned out to be a 3px colour stripe, so it
goes outlined rather than filled, with the words *from the rota* on the line
that already names the job and the site — colour alone cannot carry a
distinction on a 3px rule.

### 21.3 Holidays, marked and never skipped

§20.7's decision, built as decided. A generated shift landing on a statutory
holiday arrives flagged — "A statutory holiday falls on this day — remove this
row if he is not working it. Labour Day." — and one tap removes it.

The flag is deliberately generous: a holiday falling on a weekend also marks
the weekday it is taken on. An extra flagged row costs a tap; a missed one
costs an alarm at five in the morning.

It is also re-run when a row's date or job changes, the same way the pattern
check is (§18.5). A verdict about the 7th has nothing to say about the 8th, and
a holiday flag left standing over a date it no longer describes is exactly the
stale amber that teaches him to ignore the amber that means something.

The jurisdiction is a per-company field and its default is **off**. The two
employers need not share one, and a wrong holiday list would flag ordinary
weeks — §19.1 is the record of what a warning that fires on the ordinary case
does to every warning beside it.

### 21.4 What it refuses to do

- **It never fills backwards.** Dates before today are dropped before anything
  is generated, and a week wholly in the past says so and disables the button:
  a rota is not evidence about a week that has already happened, and filling
  one would put unverified hours in the pay tab and events in the feed whose
  alarms have already gone off.
- **It never fills a slot twice.** Already on file, or already sitting in the
  same batch, and the row is dropped — whatever site is standing there, because
  the site on a generated row was invented by the app.
- **It never generates from a pattern with no `days`.** That has meant
  "checking only" since §18.2 and it still does. A half-typed rota is dropped
  by `validPatterns()` rather than half-believed, and the same rota declared
  twice fills the week once.
- **It never confirms itself.** `applyPatterns()` already refused to check a
  non-OCR row, which is what stops a generated row being checked against the
  pattern it came from — a test that would always pass, and the app agreeing
  with its own assumption. §20.1 flagged that guard as load-bearing before
  anyone could tidy it away.
- **It never removes a shift.** Not on a holiday, not on a clash. §8.4's rule
  holds and §19.4's does too: the app names what it cannot know and stops.

### 21.5 §7 is intact

`co.holidays` is an additive optional field on the company record and every
read of it is guarded, so a job saved before today behaves exactly as it did —
no jurisdiction, no holiday flags. `source:'pattern'` is a new value in a field
that has been on the shift record since the beginning, and every existing
record's `source` still means what it meant. §11.4's check therefore still
stands unspent for §8.1, which remains the step that will actually need it.

### 21.6 Where this leaves the order

`METHOD:CANCEL` (§10.6) is next by default, then §8.1's site table, then §8.4 —
unchanged from §18.8 except that generation is off it.

The thing worth watching is not on the list: **whether the promotion in §21.2
actually fires**. Everything about the proposal/fact distinction rests on a
screenshot arriving one week in three and quietly turning last week's
assumptions into facts. If that stops happening, the app says so — the
unconfirmed note in §21.2 exists for exactly that — but the sentence has never
been read in anger. The first month of real use is what tests it, not the test
suite.

---

## 22. Built: withdrawing a shift from the calendar, 3 September 2026

§10.6, and the last of §11.3's step 2 that needed code. In manual-import mode
the export only ever adds — that is the whole design, because Samsung's
importer appends rather than replaces — so a shift deleted in the app kept its
event and its alarms on the phone forever, and nothing anywhere said so. RFC
5545 has one way to take an event back, and this builds it.

### 22.1 Why it could not be one more line in the export

The obvious version is a `STATUS:CANCELLED` event added to the file the export
already writes. It cannot be: `METHOD` is a property of the *calendar*, not of
the event, so one iCalendar object carries one instruction. A file announcing
`METHOD:PUBLISH` while holding cancelled events is asking the importer to
guess, and the whole point of a withdrawal is that nothing is left to guess.

So it is a second file, `shifts-cancelled-<date>.ics`, behind its own button,
and the button only appears on the weeks something was actually deleted. Two
saves is the price of an unambiguous file.

### 22.2 What a deletion has to leave behind

A cancellation names an event that no longer has a shift record — and often no
longer has a *job* record either, since removing a job deletes its shifts. So
the deletion is what writes the note, not the export:

```js
S.tombstones = [{ uid, seq, date, start, end, endDate, title, at }]
```

Not history, and not a bin to restore from. A to-do list with one item on it:
say this event is off. It empties the moment that has been said.

Only a shift with `sent` set leaves one. A shift deleted before any export was
never on the phone, and a cancellation for it would be a file about nothing.

Every delete path in the app now goes through one function. That was the actual
work — there were four, and three of them are the ones easy to forget: removing
a job, accepting a cancellation from the feed in the review screen, and
**Delete every shift** in the danger zone. A path that forgets is an alarm at
five in the morning for a job he no longer has, with nothing on any screen to
explain it.

The one path deliberately left out is the danger zone's *other* button, which
resets the whole device state. Nothing survives it to act on — including the
list of what would need cancelling — and it already says so in as many words.
Clearing the events it leaves behind is a calendar job, not this app's.

### 22.3 `SEQUENCE`, which was missing from the publish side too

A calendar may ignore a revision no newer than the one it holds, and every
event this app has ever written carried no `SEQUENCE` at all — which is to say
`0`, forever. That made the cancellation impossible on its own terms, and it
turned out to be a live bug in something already built: §21.2's `replaceId`
path rewrites an event in place when the employer moves a shift, and in
manual-import mode that rewrite was going out as the same revision the calendar
already had. The old time could legitimately have stayed put, alarms and all.

So the shift record carries `seq`, it goes up whenever a sent shift is changed
— by hand in the edit dialog, or by a screenshot moving it — and the
cancellation counts from one above the publication. Additive and optional:
absent means `0`, which is exactly what every existing record meant.

### 22.4 The writer moved into `ics.js`

`ics.js` was the reader and `buildICS` lived in `app.js`, where no test could
reach it. Line folding, text escaping and UID identity are one body of
knowledge about one file format, and the half of it that mattered most was the
untested half. `fold`, `icsEscape`, `icsStamp`, `shiftUID` and the cancellation
builder are all in `ics.js` now; `app.js` keeps only what needs the store —
which shifts, whose job, what title.

`shiftUID()` exists because both sides call it. A cancellation whose UID does
not match the publication *to the character* cancels nothing and reports
nothing, and there is a test asserting the two agree — so if they ever drift,
the suite fails rather than the phone.

Ten tests, in the style of §18 and §19: records in, text out. The last one
reads the file back through the reader in the same repo and checks it lands as
`report.cancelled`, which is cheaper proof that the file is well formed than
any amount of matching on raw lines.

### 22.5 What it refuses to promise

**That the calendar will act on it.** §3.3 has said since it was written that
Samsung's importer "tends to ignore UIDs", and a withdrawal is nothing *but* a
UID and a sequence number. If that is true of cancellations as well as of
publications, this file imports cleanly and removes nothing.

That is not a reason to build nothing — the file is correct, and any importer
that follows the spec will honour it — but it is a reason not to let the app
claim the shift is gone. So the note in Setup says what was done and what to
check:

> 1 deleted shift still in the calendar, with alarms. Save the cancellations
> and open that file the same way. If the event is still there afterwards,
> delete it in the calendar by hand — some importers ignore the file's
> identifiers.

That is the honest sentence. The app knows a shift was deleted after being
sent; it does not know what the phone did about it; and the one thing it can
always do is make sure he knows too, which is more than the silence it
replaced. Confirming it either way costs one deletion and one look at the
calendar, and that is worth doing before this is trusted.

**And no VALARM goes in the cancellation.** The alarms are the thing being
taken away. An importer that half-reads the file must not be handed a fresh set.

### 22.6 §7 is intact

`S.tombstones` is a new top-level array and `seq` is a new optional field on the
shift record; both arrive through `Object.assign(structuredClone(DEFAULTS), v)`,
which is the one path both `loadState()` and the backup restore already share.
A state saved before today loads with an empty list and no sequence numbers,
and behaves exactly as it did. Additive optional, no migration — §11.4's check
still stands unspent for §8.1, which remains the step that will actually need it.

### 22.7 Where this leaves the order

§10.5's two staleness warnings are now the whole of §11.3's step 2, then §8.1's
site table, then §8.4. *(The second of those is built too — §23.)* The one thing worth doing before any of it is the
five-minute test in §22.5: delete a shift, save the cancellation, open it, and
see whether the event goes. If it does not, the note is doing the work and the
§14 Worker — where the feed is rebuilt whole and this problem does not exist —
gets a little more urgent.

---

## 23. Built: the calendar is behind this screen, 4 September 2026

The other half of §10.5, and with it §11.3's step 2 is finished. §17.3 built the
warning that says *the app* is missing shifts. This one says the **phone** is,
which is the worse of the two: an app with a gap in it looks empty, and a
calendar with a gap in it looks like a day off.

Until now the only signal was the `#unsent` line in Setup, on a screen he has no
reason to open. This sits on Schedule, beside the horizon note and the overlap
banner.

### 23.1 What §10.5 asked for, and what it actually needed

§10.5 wrote the headline as *"Last exported N days ago, 4 shifts changed since"*.
The days-since half is not the headline, and building it as one would have been
wrong: a feed saved ten days ago with nothing changed since is not stale, it is
**correct**. The calendar and the app agree; there is nothing to say.

What makes the calendar lie is a *difference* — something on file the phone has
not been told about. So the count is the fact and the elapsed time is colour,
said only once the difference has already earned a warning: "Last saved 9 days
ago", appended, explaining a backlog rather than announcing one.

### 23.2 When it fires, which is the whole design

§19.1 is the standing lesson here: a warning that fires on the ordinary case
destroys every warning beside it. "Something is unexported" is the ordinary
case — it is true for the whole import-review-export minute, every single time,
and a screen that is permanently amber teaches him to stop reading amber.

So the trigger is not that something is unexported. It is that **something
unexported is close enough that the alarms are the next thing to happen**:

| Soonest unexported thing | |
|---|---|
| More than 7 days away | Nothing. There is time, and nothing is wrong yet |
| Within 7 days | Amber, naming the day and the button |
| Within 2 days | Red, and it says the alarms come from the last export |
| Already past | Nothing. The alarms have been and gone; exporting changes nothing that can still happen |

Two days is where it turns red because the default alarm leads are 12 and 2
hours (§3.3): inside that, the export is not a chore any more, it is late.

### 23.3 Three differences, and `seq` told two of them apart for free

The calendar can disagree with the app in three ways, and they are not the same
failure:

- **A shift it has never heard of.** No event, so no alarm at all.
- **A shift it holds an older version of.** An event exists and rings — at the
  wrong time, which is worse than silence because it looks like it worked.
- **An event for a shift that was deleted.** §22's case: a ghost at 05:00.
  Manual-import only; a subscription drops it on the next rebuild.

The first two needed telling apart to be said honestly, and **§22 had already
built the discriminator without either section noticing**. `seq` rises only when
a shift that had already been sent is changed. So an unsent shift *with* a
sequence number is one the calendar holds an old version of, and one without is
a shift it has never seen. No new field, nothing to migrate — the distinction
came free from a change made for a different reason.

The third is read straight off `S.tombstones`, filtered to dates still ahead:
a ghost event whose date has passed has already rung, and there is nothing left
to prevent.

### 23.4 What it says

> A shift tomorrow is not in the calendar. The alarms on the phone come from the
> last export, not from this screen. Save new shifts in Setup.

> 2 shifts are not in the calendar and 1 has changed since it was sent. The
> soonest is Tue 8 Sep. Save new shifts in Setup. Last saved 9 days ago.

> A deleted shift is still in the calendar on Sun 6 Sep, with its alarms. Save
> the cancellations in Setup.

Every one of them names the button. A warning about a calendar being wrong is
worth nothing if the fix is two screens away and unnamed — that was the fault of
the `#unsent` line it replaces.

The cancellation gets its own note rather than a clause in the first, because
the fix is a different button.

### 23.5 One field, and a render that clears itself

`S.settings.lastExport`, an ISO timestamp, written by the publish export in both
modes. Additive optional, absent means "never exported", and both `loadState()`
and the backup restore already go through
`Object.assign(structuredClone(DEFAULTS), v)` — so §7 holds and §11.4's check is
still unspent for §8.1.

The exports now call `renderAll()` rather than `renderSetup()`. The warning they
clear lives on Schedule, and a warning still standing after the thing it warned
about was fixed is exactly the stale amber §19.1 is the record of.

### 23.6 It has no test, and that is a choice worth naming

`staleNotes()` sits in `app.js` beside `horizonNotes()` and `clashNotes()`,
which have no tests either, and for the same reason: they are policy about the
whole store rather than a function of their arguments, and there is no DOM
harness in this repo to drive them. It was written in a shape that could move —
dates in, sentences out, no rendering — but extracting it to earn a test would
have put app-state policy in a file about file formats or about rotas, and it
belongs with the other two.

What it got instead is fifteen states driven through the real page in a
headless browser: nothing pending, unexported but weeks away, inside the window,
inside two days, changed-not-resent, mixed counts, both plural forms, both feed
modes, a ghost event, a past ghost, a past unexported shift, never exported at
all, and the export clearing the note. That is not in `npm test` and it should
be honest about that. If a third warning ever wants to join these two, the
harness is the thing to build first.

### 23.7 Where this leaves the order

§11.3's step 2 is done — every §10.5–§10.7 item is now built or closed. What is
left is the two heavy ones, in the order they were always in:

| | Work | |
|---|---|---|
| 3 | **§8.1 site table** | Unblocked since §17.4. Everything after assumes `siteId`, and it is the one remaining schema change, so §11.4's check gets spent here |
| 6 | **§8.4 change detection** | Wants stable site identity first, and has a worked example on the feed side to copy (§13) |

Beside them, unchanged: **§4/§14's Worker** is still the live product blocker
and still entirely unbuilt. It is worth noting what the last two days did to the
argument for it — §22 and §23 are both, in the end, elaborate handling of a
problem the Worker deletes. In subscription mode fed from a URL there is no
export to forget, no cancellation file to open, and nothing for either warning
to fire about.

---

## 24. Built: the time fields are 24-hour too, 4 September 2026

`app.js` has said this since the beginning, above `fmtTime()`:

> 24-hour throughout. am/pm is the single most dangerous character in this app
> — 23:00 cannot be misread the way 11:00pm can, so the display never uses it.
> The parser still reads am/pm off screenshots; that is input.

That was true of everything the app *printed* and false of everything it
*asked for*. All three fields where a time is entered by hand were
`<input type="time">`, which is not drawn by the app at all — it is drawn by
the phone, in the phone's locale. On a US-locale Android that is a 12-hour
spinner with an AM/PM segment.

### 24.1 Where that lands

On the review screen, which exists for one reason: to catch the am/pm misread
that §6 names as the top risk and that §16.2 caught happening on real input,
where Homebase's "8:00 pm" came back as 08:00. §18 built the declared-pattern
check on top of that, which corrects an exact twelve-hour flip and shows the
row amber.

So the sequence was: the parser reads 08:00, patterns.js says that is twelve
hours off DSI's rota and corrects it to 20:00, the row explains itself in
24-hour — and the box he then taps to check it offers him am and pm. The one
control in the product for fixing an am/pm mistake was the only place in the
product that spoke am/pm.

The Setup rota fields had the same shape, and they are worse in one respect:
they are typed once and then everything else is measured against them. A rota
entered as 3:00 AM instead of 3:00 PM does not produce a wrong shift, it
produces a wrong *check*, silently, on every import afterwards.

### 24.2 What replaced it

A plain text box. `parseClock()` in `parser.js` decides what a typed time is;
`bindClock()` in `app.js` decides what the box does with the answer.

`parseClock()` lives in `parser.js` and not next to the field because the am/pm
rule has to exist exactly once, in `to24()`. Two copies of that rule drift, and
an am/pm rule that drifts is §6's risk arriving by another door.

Bare digits are read as 24-hour, with no guess about which half of the day was
meant — that guess is the thing being removed:

```
9  09  9:00  09:00  900  0900   ->  09:00      (nine in the morning)
21  21:30  2130  21.30          ->  21:30      (nine at night)
2400  24:00                     ->  00:00
```

A meridiem is still **accepted**, because the employer's screen prints one and
he transcribes from it — but only ever accepted, never shown back. `9pm`
becomes `21:00` in the box the moment he leaves it, which turns the conversion
into something he can see and check rather than something done behind the
value. This is the same line §6 already drew: am/pm is input, never display.

`inputmode="numeric"` is deliberate. The phone offers a keypad, which is the
fast way to type `1500` and no way at all to type "3 pm". The meridiem is
tolerated, not invited.

### 24.3 What it refuses to do

It never rounds to the nearest thing the text might have been. `2:5` is not
02:05, `9:60` is not 10:00, `1500pm` is not anything. All of them come back
null, the box is marked, and **the value on file is left exactly as it was**.

That matters more than it looks, because half-typed times pass through the
invalid state on every keystroke. The rule that makes this safe is: only a
value that parses is ever committed, so the note lines under each row keep up
with the typing exactly as they did before, and a field the app could not
understand changes nothing.

The edit dialog goes one step further and refuses to save at all while either
time is unreadable. It is the screen where he corrects a shift by hand, so
filing a blank over a time that was right until he touched it is the one
outcome it must not have.

### 24.4 What it does not do

It does not touch what the parser reads off a screenshot. §16.2's failure was
OCR losing a meridiem, and nothing here helps with that — §18's declared
patterns are still the only control on it. This closes the hole on the other
side: the correction.

It also leaves the date fields as `<input type="date">`. A date picker in the
phone's locale can be read the wrong way round — 09/04 — but unlike a time it
commits an unambiguous ISO value, and unlike am/pm a wrong date shows up as
the wrong day of the week on a row that already prints the weekday.

### 24.5 §7 is intact

Nothing about the stored shape changed. `start` and `end` were `'HH:MM'`
strings before this and are `'HH:MM'` strings after it; what changed is only
which control produces them. A job saved yesterday reads back identically.

### 24.6 Where this leaves the order

Unchanged from §23.7 — §8.1's site table, then §8.4, with §4/§14's Worker
still the live product blocker beside them.

This was not on the list and should not have been on one: it is a
contradiction between a stated principle and the code, found by reading the
two against each other, and the fix is smaller than the section describing it.
Worth noting where it was found, though — not in the app, but in the comment
above `fmtTime()` claiming something the fields underneath it did not do. The
comments in this codebase are load-bearing enough to be worth auditing that
way again.

---

## 25. Built: how long he is off between shifts, 4 September 2026

Ray raised it from a real week. Four shifts, in order:

| | shift | rest before it | |
|---|---|---|---|
| 1 | 15:00–23:00 | — | |
| 2 | 00:15–04:15 next day | 1h 15m | silent |
| 3 | 20:00–08:00 | 15h 45m | silent |
| 4 | 15:00–23:00 | **7h** | **says so** |

His three numbers, in his words: under two hours he is not even coming home;
over eight he has time to sleep at least six and a half; in between he needs to
know to plan a four-hour nap rather than a full night.

### 25.1 §19 has to be answered first

§19.1 deleted a turnaround warning and gave a reason that reads like a
prohibition on this one: *"There is no threshold that makes it right, because
the thing it was measuring is not a problem."*

It is not the same warning, and the difference is which case is silent. The old
one fired on any two shifts under an hour apart — which for these two jobs is
the ordinary week, since going straight from one to the other is normal — so it
fired constantly on nothing and taught him to scroll past the line that also
had to carry the double booking. **That case is silent here by construction.**
Under two hours is the bottom of the band, not the top of it.

The table above is the check on that claim, and it is worth keeping: one
warning out of three gaps, on the week the feature was asked for.

The residual risk is real and named rather than solved. A 7h gap is not rare in
his pattern, so this could still become wallpaper. Two things hold it back — the
banner appears only when the shift he is going back to is within two days
(§25.3), and the week-list line is not red (§25.5) — and if it does go quiet on
him anyway, §19.1's remedy applies: delete it rather than tune it.

### 25.2 The message states the gap and stops

Ray settled the wording, and the first draft was wrong in an instructive way.
It computed a sleep figure — gap minus commute, minus eating, minus winding
down — and told him to set a four-hour alarm.

That draft did not survive its own arithmetic. "8h means at least 6.5h asleep"
implies an hour and a half of overhead; "7h means a 4h nap" implies three. Both
are his numbers and they cannot both be one constant, because they are not
measurements — they are two reasonable feelings about two different evenings.

So the app does not have the number and stops pretending to:

```
Heads up: only 6h off between shifts.
```

He knows what six hours means for him on a given night; what he does not know,
until this tells him, is that it is six. §19.4 said the clash warning names both
sides and proposes no fix because the app cannot know which shift is wrong. The
same shape for a different reason: here the app knows the fact perfectly well
and has no business with the decision that follows it.

### 25.3 Three surfaces, one of which is the point

**The alarm, in the exported calendar.** This is the one that matters, because
it is the only one that reaches him with the app closed. `VALARM` on the shift
he is coming back to, `TRIGGER` at the *start* of the gap rather than on the
morning of the shift — `-PT7H` on a 15:00 start fires at 08:00, as the night
shift ends.

That anchor is the whole design of it. The gap is routinely 08:00 to 15:00, and
a notice arriving at 09:00 reaches him driving home off twelve hours with the
decision already made. At the clock-out he is awake and can still choose what
to do with the afternoon.

**The banner**, over the schedule, ranked below the clash and the stale
calendar and above the horizon notes. The order is by cost, as §19.3's is: a
clash is a shift he will miss, a stale calendar is an alarm that will not fire,
this is a shift he will work tired, and a short horizon is only a job to do.

Near horizon only — it appears when the shift he is going back to is today,
tomorrow, or the day after. The gap is a fact about next Thursday too, but it
is only *actionable* on the day, and a standing note about a week away is the
permanently amber screen §23 refused to build.

**A line in the week list**, on the shift he comes back to.

### 25.4 Two things the sweep has to get right

`restGaps()` in `patterns.js`, on §19.2's absolute timeline for §19.2's reason:
Trupoint runs 19:15–07:15 and 00:15–08:15, so the rest that matters is nearly
always measured across midnight and a per-day check could not see it.

Neither of these is a sort and a subtraction:

- **The previous shift is not the one before it in the list.** A shift wholly
  inside another — which happens, and which §19 flags separately — would end
  the pair early and report hours he is still at work as time off. A 20:00–08:00
  night with a 22:00–23:00 inside it would measure the next day's rest from
  23:00 and call 16 hours what is really 7. The sweep carries the furthest end
  reached, not the end of the last shift started.
- **A shift nobody can read breaks the chain.** A row with a date and no usable
  times has no place on the timeline. Stepping over it joins the shifts either
  side and measures a gap with a shift sitting in it — wrong number, wrong two
  shifts named, and possibly a "7h off" over a night he is working. So no gap
  is reported across a day holding one. That is a silence about something real,
  and it is the right way round: the row is already flagged and asking to be
  completed, which is the same answer §19 gives an unreadable row.

Zero is a handover and negative is a clash. Neither is rest, and the clash has
its own warning this one must not muddy.

### 25.5 Small things that are decisions

**The band is closed at the bottom and open at the top.** Exactly two hours is
worth saying; exactly eight is a night's sleep. One predicate, `isShortRest()`,
so the three surfaces cannot drift apart on the boundary.

**The week-list line is not red.** The clash gets `--bad` because it is a fault
in the schedule. This is a fact about the night, and colouring a fact like a
fault is how the line that means something gets scrolled past.

**`buildICS` looks outside the list it was handed.** Rest is a property of a
*pair*, and in manual-import mode `only` is the shifts not sent before — so the
shift on the other side of the gap is routinely not in it. The alarm is worked
out over the whole store and the export is filtered afterwards. Tested with a
one-event file whose partner shift is absent, because getting this wrong would
have produced a file that is correct in subscription mode and silently missing
alarms in the other.

### 25.6 What manual-import mode still cannot do

The alarm is a property of a pair, so adding a shift changes the alarm on a
shift the calendar may already hold. Subscription mode is immune — the feed is
rebuilt whole on every save, which is the same immunity §22 records for
deletions. Manual import only ever appends, so an alarm written before the
other half of the pair existed goes stale and nothing says so.

Not fixed, and the option is recorded rather than taken: `seq` could be bumped
on a shift whose rest changed, making it a revision like a retime (§22). That
is the correct fix and it is more moving parts than this feature is worth
today. Until then the banner is the backstop in manual mode, and subscription
is the recommended mode for reasons that now include this one.

### 25.7 Where this leaves the order

Unchanged: §8.1's site table, then §8.4, with §4/§14's Worker still the live
product blocker. *(The first of those is built — §26.)*

But this feature has a second half that only the Worker can build, and it is
worth writing down now while the reasoning is fresh. A `VALARM` is a good
notification and not the one Ray asked for — it depends on an export having
happened and on ICSx⁵ having synced since. Once §14's Worker exists, D1 holds
every shift and the `*/15` cron is already running, so a Web Push on the same
tick costs no new infrastructure and stays inside the free plan: 3 cron
triggers against the 1 §14.5 uses, and one JWT signature against the 10ms CPU
ceiling that section already flags as the number to watch.

The cheap shape, worked out and not yet built: **payload-less push, and the
service worker fetches the line.** RFC 8291 payload encryption is real work;
having the worker read the shifts out of IndexedDB instead would work — storage
is IndexedDB already, which a service worker can open, where `localStorage`
would have ruled it out — but only after §14.7's pass two lands, since until
the phone reads `source='feed'` shifts back down its own store does not hold the
Trupoint side of the pair, and the gap that started this is cross-job. A
same-origin `fetch` back to the Worker needs neither. That leaves VAPID's JWT as
the only crypto, which is one ECDSA P-256 signature that WebCrypto emits in the
raw `r||s` form JWS wants.

One rule for when that lands: **the `VALARM` comes out.** Two buzzes for the
same seven hours is precisely how a warning gets muted, and §19 is the record of
that happening in this app once already.

---

## 26. Built: the site table, 4 September 2026

§8.1, the heaviest of the four and the one everything after it was written
against. `shift.label` was one string doing two jobs — the edit dialog admitted
it by captioning the field "Site or role" — and every consequence of that ran
downstream: no address on a screenshot shift, no `LOCATION:` line, no stable
answer to "is this the same place", and a matcher deriving its idea of a known
site from its own unvalidated output.

```js
S.sites = [{ id, companyId, name, address, aliases:[], archived }]
shift   = { …, siteId, role, label }
```

### 26.1 Where it lives

- **`sites.js` is new**, a fifth pure module beside `parser.js`, `ics.js`,
  `patterns.js` and `holidays.js`, and new for the same reason §18.1 gave: it
  is a different kind of knowledge. It answers one question — are these two
  spellings the same place — and it answers it against records a human made,
  not against text anything read. Matching, the aliases, the merge, the title
  convention and the address precedence are all here; there is no DOM and no
  storage, and `tests/sites.test.js` requires it directly.
- **`app.js` does what the table cannot say**: which sites belong to which job,
  how a review row acquires a `siteId`, and what happens on the four screens.
  The wiring is three functions — `applySite()`, which resolves a row;
  `siteFlag()`, which decides whether it is worth looking at; and
  `learnSpelling()`, which is the commit-time half of the aliases.
- **`parser.js` is untouched.** That is §17.4 paying off exactly as intended:
  the separator was already correct, `splitLabel()` was already exported and
  tested, and this section is the one that finally reads it.

### 26.2 `snapSite()` was the bug, not the starting point

§8.1 called aliases "the real prize" and it understated it. The function being
replaced matched a fresh read against `[...new Set(S.shifts.map(s => s.label))]`
— the labels already filed, which are the parser's own output. One bad read
committed once became a "known site", and every later read of that site snapped
to the mistake. It is the same failure §8.2 refused outright for times, sitting
unremarked in the name path, and it had the same shape: a check that gets more
confident the more often it has been wrong.

Nothing now derives a spelling from anything but a site record, and a site
record only ever exists because somebody made one. Three routes make one, and
all three put a human between the OCR and the record:

| Route | When |
|---|---|
| `+ Add "…"` on a review row | Day one, and every new site after. The name is asked for, prefilled with what was read |
| **Build from what's on file** in Setup | Labels already filed, with counts, corrected as they are added |
| **Add a site** in Setup | Typed from scratch, for a place he knows is coming |

The middle one is deliberately not a migration. Turning every string OCR has
ever produced into a site record would be `snapSite()` again, in one pass
instead of gradually.

### 26.3 Matching, and the one place §8.1's rule needed tightening

Exact spelling → edit distance → no match, as specified, with the thresholds
lifted unchanged from the function being replaced (three characters, or 18% of
the longer spelling). Two rules were added because a wrong `siteId` costs more
than a wrong string did:

- **An exact hit anywhere beats a near hit anywhere.** Both passes run over the
  whole list rather than site by site, so a record that answers to the exact
  text cannot lose to one that is two characters away.
- **A spelling under five characters has to match exactly.** "Cook" and "Cort"
  are two apart, which is most of the word. The real names — De la Montagne,
  SOUTHERN HENS — are long, and it is on long names that a distance of three
  means what it is supposed to mean.

Archived sites are not matched against. Archiving says he has stopped being
sent there, so a fresh read that looks like it is more likely a new place with
a similar name; the record stays, and the shifts already naming it still read
correctly.

### 26.4 The confirmation, and what it costs

§8.1: "confirming a fuzzy match in review adds one". The confirming act is
**adding the row**. The review screen is already the mandatory checkpoint, the
row is already amber and already names both spellings — *Read as "De Ia
Montagme" and taken as De la Montagne* — so pressing Add is a decision he has
been shown. A row he redirected by hand teaches the table too, and that is the
more valuable of the two: it is the spelling the matcher could not reach on its
own.

**This is a trade and it is worth naming.** A separate tick-box per amber row
would make the confirmation explicit; it would also put a second control on
every fuzzy row, on a phone, in the screen whose whole job is to be quick
enough to actually get used. The cost of the choice made is that ignoring an
amber row teaches the table the spelling it was warning about. The release
valve is that every spelling is listed on the site's card in Setup with an ×
beside it — visible, and one tap to undo — which a tick-box in a review list
that has since been committed would not be.

Nothing is learned from an exact match, and nothing from a site carried in with
a generated week: neither was read off anything.

### 26.5 The four screens

- **The review row loses its free-text label and gains a site column.** What
  was read is shown, then a select naming what it was taken as. Typing a
  corrected spelling into a box was never the fix — the next screenshot spells
  it wrong again — and naming the site is. A site made on one row is matched
  against every other unresolved row in the same batch, because one screenshot
  routinely carries the same place four times, spelled four ways.
- **The edit dialog splits into Role and Site**, with the text label appearing
  only when there is no site — which is the fallback made visible. Pointing a
  filed shift at a site here teaches the spelling too.
- **The schedule and the banner read `role · site`**, or the label unchanged
  when there is no site.
- **Setup grows a Sites list per job**: name, address, the spellings with an ×
  each, archive, merge, remove.

### 26.6 `LOCATION:`, which is why any of this was worth doing

One line in the `.ics`, and Android renders a tappable address: the two-hour
alarm fires, he taps the event, taps the address, and he is navigating. §8.1
called it the single best reason and it was right.

The shift's own `place` wins over the site's address. A calendar row carries
what the employer published for that night, which is a fact about that night;
the site's is a standing default. The edit dialog says so rather than leaving
it to be discovered — *"Left empty, De la Montagne uses 401 Main St"*.

### 26.7 The title, and where §8.1 was overtaken

§8.1 specifies `${company}- ${role} ${site}`. Written literally that produces
`DSI- Cook Plant ASO SOUTHERN HENS`, and it should not be built that way: §17.4
landed eleven sections later, kept the employer's pipe deliberately, and
changed the exported `SUMMARY` to carry it. A space join now would reverse a
change made on purpose and turn two fields back into one run-on string.

So the separator stays: `DSI- Cook Plant ASO | De la Montagne`. What improves
is which side of it is trustworthy — the site half is now the curated spelling
rather than whatever the reader made of it that day. A shift matching no site
produces the byte-identical title it produced yesterday.

*(Overtaken in one respect, §42: the two halves changed places, so the same
title now reads `DSI- De la Montagne | Cook Plant ASO`. The separator, the
curated spelling and the no-site fallback are all as written here.)*

**And the knock-on §8.1 warned about is now handled rather than noted.**
Renaming a site, adding an address to one, merging or removing one all change
the text of events a calendar may already hold. `restamp()` bumps `SEQUENCE`
and clears `sent` for the affected shifts, so the next export rewrites them as
a newer revision — which is what §22 established a calendar needs before it
will believe an update. It fires on leaving the field rather than on each
keystroke: a revision number counting letters typed would be nonsense.

### 26.8 Identity, which is what fixes the duplicate check

`bySlot()` compared `key(label)` against `key(snapSite(label))`. It now compares
`whereKey()`, which is the `siteId` when there is one and the text only when
there is not. Two rows that resolved to the same site are the same place
however they were spelled — the case that used to file a second shift over a
real one — and two that resolved to *different* sites are still flagged as a
location change rather than swallowed. `icsSame()` uses the same predicate, so
a feed re-import compares places the same way.

### 26.9 §7 is intact, and §11.4's check is spent without being needed

§11.4 reserved a decision for this step: it is the one schema change that
"moves a value out of `label` into a `siteId`, and a record written before it
means something different afterwards". Built as §8.1 actually specifies, it is
not that change. `siteId` is nullable, `label` is kept and still written on
every commit, and every read goes through `whereText()`, which falls back to
the label. A record saved yesterday has no `siteId`, renders as its label, and
means exactly what it always meant — the same additive-optional test `extUid`
and `place` passed in §11.4's own words.

So no `S.version`, no migration path, and **Delete everything and start over**
remains the documented answer to a shape change. §7 holds because the design
chose the fallback, not because nothing changed.

The one thing that would have needed a migration is the thing that was
deliberately not built: auto-creating a site for every label on file. That is
in Setup as a list to pick from instead, which is §8.2's shortcut applied to
names, for §8.2's reason.

### 26.10 What it refuses to do

- **Never blocks an import.** A name matching nothing files as read. §8.1 chose
  a nullable `siteId` precisely so one bad read cannot stop a shift arriving,
  and an unmatched row is not even amber — there is nothing wrong with it.
- **Never invents a site.** Not from a label, not from a feed, not on commit.
- **Never merges on its own.** Merging is permanent and moves shifts; it is a
  confirm dialog naming the count, and there is no undo.
- **Never renames a site from a screenshot.** A read that matches becomes an
  alias, never the name. The name is what the calendar says, and it changes
  only when he changes it.
- **Never carries a site across jobs.** Changing the job on a row or in the
  edit dialog drops the `siteId` and matches again against the new job's list.

### 26.11 Where this leaves the order

§8.4 change detection is now the only one of §8's four left, and it is the one
that was waiting for this: "needs stable site identity to tell same shift,
different place". It has it — `whereKey()` is that identity, and §26.8 is
already the first half of the answer.

The site table was also the last of the three §11.3 called schema changes, so
§4/§14's Worker is now the only thing on the list that is not an enhancement,
and it remains the live product blocker.


## 27. Built: roles, and a second rate at the same job, 4 September 2026

The question that started this was narrow: *should role be a table too, like
site?* It arrived with the reason attached — there was no way to pay two rates
at one employer, and `co.rate` was a single number multiplied by a week's
hours. Cook and Dishwasher at Homebase do not pay the same, and neither do
Mobile Guard and Site Supervisor at DSI.

The answer is yes, and the interesting part is that the table was the cheap
half. The expensive half was the arithmetic sitting behind it.

### 27.1 Why the table cost almost nothing

`sites.js` had been generic since §8.1 without anyone saying so. Everything in
it from `key()` to `suggestNames()` reads `{ name, aliases, archived }` and
nothing else — it never knew what a site was. The only site-specific things in
the file were the four naming functions at the bottom and one line of
`mergeSites` about the address.

So the role table is the same machinery pointed at a second list:

```
S.roles = [{ id, companyId, name, rate, aliases:[], archived }]
shift   = { …, siteId, roleId, role, label }
```

What changed in `sites.js` was renaming rather than writing: `matchSite` →
`matchName`, `suggestSites` → `suggestNames`, and `mergeSites` split into a
generic `mergeRecords` plus two four-line wrappers that differ only in what
they absorb — an address for a site, a rate for a role. A role gets the exact
alias matching, the edit-distance matching, the amber-on-near-miss, the learn-
on-commit, the merge, the archive and the build-from-what's-on-file, and none
of it had to be designed twice.

That is worth stating plainly because the instinct before starting was that a
role needs *less* than a site and should therefore get something smaller and
ad-hoc. It needs less — no address, no `LOCATION:` line — but the part it does
need was already built, and a second smaller mechanism would have been more
code, not less, plus a second thing to learn.

### 27.2 The rate hangs off the record, never off the string

`rateFor(shift, role, co)` is the whole of it: the role's rate when it has one,
the job's when it does not. Both stages are nullable, and null is not zero —
null means nothing has been said, zero means this pays nothing.

The consequence is that a job with one rate needs no roles at all and behaves
exactly as it did before this section. A role with no rate of its own is a
spelling table and a curated name, which is a perfectly good reason to declare
one.

Why the record and not the string: §8.2 refused to learn normal times from the
parser's own output, because a check that gets quieter each time it fails is
worse than no check. The same argument, one step further along. A gross to the
cent is checked against a real deposit weeks after the screenshot is gone, so
it must rest on something a human confirmed. A rate keyed on whatever OCR
produced would be a figure derived from unvalidated text, and wrong silently.

### 27.3 The overtime question, which is the actual work

Two rates in one week and this stops having an obvious answer:

```js
gross = base*rate + ot*rate*otMult
```

Which hours were the overtime hours? Chronologically the last ones — but then
a week's gross depends on the order the shifts happened to fall in, and moving
one shift from Tuesday to Saturday changes what he is owed for hours already
worked. That is not how anybody is paid, and it is a number that cannot be
checked against a stub.

What is done instead is the **weighted-average regular rate**: every hour is
paid at its own rate, and the overtime *premium* is charged on the average of
them. It is what the FLSA requires of an employer paying two rates in one
week, and it does not care what order the shifts fell in.

The property that made it safe to swap in is that it reduces to the old
formula exactly when every hour pays the same:

```
H*r + ot*r*(mult-1)  ==  (H-ot)*r + ot*r*mult
```

So not one figure the app had already shown him changed meaning. That identity
is a test, not a claim.

Hours with no rate anywhere are counted in the total and left out of the
money, and left out of the average as well — averaging over unpriced hours
would drag the regular rate down and under-pay the premium on the hours that
*are* priced, which is a wrong number in the direction that matters.

### 27.4 `pay.js`, and why the maths moved out of `app.js`

The arithmetic is now a file of its own with sixteen tests. The reason is the
one above: this is the only calculation in the app that gets checked against a
bank deposit, and it was the last thing living where nothing could test it. It
takes hours with a price on them and returns money; it does not know what a
role is.

`weekTotals()` in `app.js` is what is left — the lookup that turns each shift
into a priced row, which is genuinely store-shaped and belongs there.

### 27.5 The rota declares a standard role and site

Asked for during the build, and it turned a guess into a fact. A declared
shift now carries an optional `roleId` and `siteId`:

```js
co.patterns = [{ days:[1,2,3,5], start:'15:00', end:'23:00', roleId:'r1', siteId:'s1' }]
```

`generateWeek()` carries them onto every row it makes; `patterns.js` never
reads them, it just has to not lose them.

What this replaces is `siteFor()`, which filled a generated week by rummaging
through the most recent shift on file with the same times. That was already a
guess, and §20 was careful about ranking confirmed shifts above the app's own
earlier proposals so it did not compound. The moment a role carries a rate it
stops being an acceptable guess at all — it is a guess about money. Declared
on the rota it is a fact he typed once, and `siteFor()` survives only as the
fallback for a pattern that declares nothing, which is every pattern written
before this section.

The de-dupe in `generateWeek()` is still keyed on the slot alone and not on
what he is doing in it. Two declared shifts at the same hours on the same day
are one shift declared twice, and generating both would put him on the
calendar in two places at once.

`checkShift()` returns the matched pattern with its `roleId` on it, and
nothing applies it. Inferring a role — and therefore a rate — from the fact
that a read landed on a declared time would be exactly the guess §8.2 refused
to make about the time itself.

### 27.6 Which table a label is talking to

The one genuinely new decision. With the employer's separator (§17.4) there is
nothing to decide: left of the pipe is a role, right is a place. Without one
there is nothing printed to go on — Homebase prints `Cook`, a role with no
place in it, and a TrackTik line whose pipe was lost to OCR could be either.

Before this section that case was resolved by assumption: the whole label was
a site candidate, which is why `Cook` was being offered as a place to file
shifts under. `readLabel()` now asks both tables and lets the better hit win.
Exact beats near either way round; at equal confidence the site wins.

That tie-break is not arbitrary. An empty role table can only ever answer
'none', so a job with no roles declared sends every label to the site side —
which is precisely what the app did when the site table was the only one there
was. The ambiguity §8.1 resolved by assumption is now resolved by evidence,
and where there is no evidence the old behaviour stands.

The menus work differently on purpose. `labelCandidates()` offers a
separator-less label to *both* build-from-file lists, because the app
genuinely cannot tell and a menu is a question, not an answer.

### 27.7 What the screens say

- **Review** grows a role picker beside the site picker, and a near match gets
  its own amber line naming both spellings **and the rate it is about to
  apply**. The site's sentence says what will be remembered; the role's has to
  say what will be paid, because that is the part he cannot see.
- **Setup** grows a Roles section above Sites, deliberately the same card down
  to the merge control. The merge confirmation names the surviving rate, since
  the one thing two names cannot tell him is that these shifts are about to be
  paid a different number.
- **The rota row** grows two selects and says in its caption what a generated
  week will be filed under, and at what rate. A field that silently prices a
  shift has to say that it does.
- **The pay tab** shows its work. A week paid at more than one rate lists the
  hours per role under the date, in the same place §20.4's rota note goes — a
  single gross with two rates hidden inside it is exactly the figure that
  cannot be checked against a stub. Hours with no rate are named and excluded.
- **The edit dialog** swaps its free-text Role box for the same picker and
  prints the rate the shift will be paid. It is the one place a shift's pay
  can be changed by hand, and the field that does it did not look like it did.

### 27.8 Identity, and the change §26.8 could not see

`whereKey()` now includes the role. A feed that moves him from Cook to
Dishwasher at the same site and the same hour has changed what the night is
worth, and a comparison that ignored the role would call that unchanged and
leave the old rate standing against it. §26.8 built the identity; this widens
it to the field that carries the money.

### 27.9 §7 holds again, and nothing migrated

Same argument as §26.9, one table along. `roleId` is nullable and `role` stays
as text, so a shift written before today has no `roleId`, prices at the job's
rate, and reads exactly as it always did. A backup restored from before this
section picks up `roles: []` from `DEFAULTS`, which is what `loadState()` and
the restore path already do for every key. Verified in the browser: an old
backup produces a byte-identical event title and the same gross.

Deleting a role is the same bargain as deleting a site. The shift keeps its
name as text and falls back to the job's rate — a shift does not become
nameless, or unpriced, because the record pricing it was removed.

### 27.10 What it refuses to do

- **Never invents a rate.** No role, or a role with no rate, means the job's
  rate. No rate anywhere means hours and not money, said out loud on the pay
  tab rather than shown as a confident `$0.00`.
- **Never prices from a guess.** Not from a matched pattern, not from a
  neighbouring shift, not from the parser. The rota's declared role is a fact
  he typed; everything else that could have supplied one is refused.
- **Never blocks an import.** An unknown job title files as read and is not
  even amber, exactly as an unknown site does.
- **Never renames a role from a screenshot.** A read that matches becomes an
  alias. The name is what the calendar says.
- **Never changes a rate on a merge.** A rate already on the surviving record
  is the one he typed and it stands; the absorbed one is taken only into an
  empty field.
- **Never carries a role across jobs.** Changing the job drops the `roleId`,
  the same as the `siteId`.

### 27.11 Where this leaves the order

§8.4 change detection is still the only one of §8's four outstanding, and it
is better placed than it was: `whereKey()` now distinguishes same-slot shifts
that differ by role, which is one more kind of "same shift, changed" it can
tell apart.

§4/§14's Worker remains the only thing on the list that is not an enhancement,
and the live product blocker.

One thing this deliberately did **not** build, and it is worth recording
because it was considered and put to him directly: rates that vary by *site*
rather than by role. Guard work is often paid per post, and if Mobile Guard at
De la Montagne and Mobile Guard at Headquarters ever pay differently, the rate
does not belong on the role record — it belongs on a small ordered override
list keyed on role and/or site, falling back to `co.rate`. That is a different
schema and a bigger one. He was asked, and the answer was per role only, so
per role only is what exists.

## 28. Built: folding the Setup screen away, 4 September 2026

§27 left the Setup screen 5,295 pixels tall with two jobs on it. Each job now
carries a rota, a role table and a site table, and it is a screen used on a
phone. So each job is a fold, and each section inside it is a fold.

Native `<details>`/`<summary>`: it folds, it takes a keyboard, and it needs no
script to do either — which matters in a repo with no build step and no
runtime dependencies.

**The rule the whole thing rests on.** A collapsed fold has to say enough that
opening it is a choice rather than a search. A summary reading "Roles" and
nothing else is not a fold, it is a thing hidden. So every one carries its own
state on the right: `$15.00/h · week from Sun · OT after 40 h` for pay,
`4 declared shifts, 2 can fill a week` for the rota, the record names for the
two tables, and for the job itself a rate *range* — a job whose roles pay $22
and $28 does not have one rate to print.

**State is stored, not held in memory.** `S.settings.open`, keyed `<jobId>`
and `<jobId>/<section>`. `renderSetup()` runs on almost every edit — renaming
a role calls it — and a fold that sprang back open each time would be worse
than no fold. Storing it also means collapsing a job he has finished setting
up is a decision that still holds next week.

**Absent means shut.** A job set up months ago is a job he is not editing. The
one exception is a job just added, which `#addco` opens by hand along with its
Pay and hours section: a job with nothing in it is a form, not a record, and a
shut fold labelled "New job" would be a puzzle.

Name and colour stay outside the folds, at the top of the open job. They are
how he tells one job from the other, and burying the field that says which job
this is inside a section called something else would be perverse. The summary
lines for the job, the pay fold and the app fold are rewritten on every
keystroke rather than on the next full redraw — a summary that lags the box
under it is worse than none.

Removing a job prunes its keys. Nothing reads a stale one, but a store that
only ever grows eventually holds more dead jobs than live ones.

## 29. Built: what each list opens on, 4 September 2026

Four findings from watching the app used on a phone, all of them about the
same thing: a screen that opens showing something other than what it was
opened for.

### 29.1 The schedule opened on last week

`renderSchedule()` cut the list at `today - 7`. A fixed seven-day offset lands
mid-week, so the top of the screen was the tail of a week already worked,
sliced in half, and this week began somewhere below the fold. Every open of
the tab started with a scroll.

The cut is now `weekStart(today)` and the past is behind a button: *Show 8
earlier shifts*, drawn above the list because what it opens goes above the
list — the button does not move when it is pressed. Nothing is dropped. Last
Tuesday is still on file, still in the export, still in the pay figures.

### 29.2 The rest note was at the end of the day

§25 put the short-rest note on the shift he comes back to. It was appended
after that shift's row, which on the day that actually triggers it — a
Trupoint night at 00:15–08:15 and a DSI afternoon at 15:00–23:00 — put it
underneath *both*, at the bottom of the day. So it had to name the shift it
followed, in a sentence longer than the gap it was describing:

> Only 6h 45m off after Tru-Point 00:15–08:15.

It is now drawn *before* the shift it belongs to, which is to say in the gap
it is about:

> **Heads up — short turnaround (6 hours and 45 minutes off)**

The naming was only ever there to disambiguate a note that had floated away
from its subject; placed between the two, the sentence was telling him what he
could see. The gap is spelled out rather than given as `6h 45m`, which is right
in a column of figures beside the shift lengths it gets compared against and
wrong inside a sentence, where it reads as a code rather than as an amount of
sleep.

It is also filled now — the signal colour, white letters, a darker border —
rather than the grey line §25 gave it. §25's reasoning was that a gap is a
fact about the night and not a fault in the schedule, so it must not be given
the red the clash gets. That still holds: it is not red. But grey text at
0.8rem in the middle of a week list is not read at all, and a warning nobody
reads is worse than one pitched slightly loud. The red still has one job.

The shift he is coming back from is often in the day row above. There this
lands at the top of a day rather than between two rows, which is still between
the two shifts, and still reads correctly.

### 29.3 The pay tab showed eight weeks and counting

`slice(0, 8)` per job, plus eight in the combined table. What the tab is
actually for is checking a deposit against what he thinks he worked, and that
question is asked about the last few weeks — the rest is a lookup.

It now opens on **next week, this week and the three before it** — five weeks,
with everything older behind *Show earlier weeks* at the bottom. Three back is
a fortnightly deposit plus a week of slack.

The window is worked out in days from the week's start rather than by
comparing week-start strings, because two jobs can begin their weeks on
different days (`co.weekStart`, §27) and the combined table holds keys from
both.

**One week forward, and exactly one.** A week's pay is worth knowing the week
before it, which is while a thin week is still something he can do something
about. A fortnight out it is worth nothing, because what the tab would print
is the rota's opinion of a week rather than money — the forecast §20.4 refused
to let stand.

So there is no button on the far side. Weeks past next week are dropped, not
folded: a *Show later* was built, and taken out on his reading, because a fold
implies a figure behind it worth opening and there is not one. This took two
passes to land — it was first built with no forward weeks at all, on a reading
of "pay doesn't need display until week prior" that turned out to mean the
opposite of what it was taken for. Hours that far ahead are on the Schedule
tab, where they are hours and not dollars.

### 29.4 The mixed-rate week could not be read as a row

§27 put the per-role hours under the date, and the reasoning was right — a
gross with two rates hidden inside it cannot be checked against a paystub. The
execution was wrong. Three roles in a week is four lines of small text in the
first column beside three numbers that have to stay readable as numbers, and
the row stopped looking like a row:

> Sep 3
> 12.00 h Security Officer at $17.00
> 8.00 h Security Agent at $12.00
> 8.00 h Training at $12.00      28.00   2.50   $413.68

The rates now live behind a **Breakdown** button on the row, in a modal.

**On every week, not only a mixed one.** The button was first put only on weeks
that needed the room, which was fixing the crowding rather than the question:
what an hour is worth, and how much of the week was overtime, are the two
figures a gross gets checked against, and a single-rate week has both of them
just as much as a mixed one.

**Two tables, and the split is the point.** *The hours* prices what was worked
— role, hours, an hour — and carries no money column at all. *The pay* is the
week the way a stub says it: regular hours at the regular rate, overtime at
time and a half, gross underneath. They are kept apart because once there is
overtime they foot to different figures — 42 h of $18.00 work is $756 of hours
and $774 of pay — and one column carrying both is a column that gets added up
wrong.

    The hours
    Cook Plant ASO    42.00   $18.00

    The pay
    Regular           40.00   $18.00   $720.00
    Overtime           2.00   $27.00    $54.00
    Gross             42.00        –   $774.00

This is the second half of what moving it out bought. The inline per-role
lines never added up to the gross once a week had overtime in it: the premium
is charged on the weighted average of the rates (§27) and it appeared nowhere
on screen, so the numbers he could see did not reconcile with the one he was
checking. Now they do, in both shapes.

**Which shape depends on whether every hour has a price.** §27's identity —
`H·r + ot·r·(m-1) == (H-ot)·r + ot·r·m` — is what lets the stub's own split be
printed from figures `pay.js` computed the other way, and the tests hold it.
It only holds while every hour is rated. When some are not, the regular rate is
the average of the ones that *are* and the overtime threshold counted the ones
that are not, so pricing the unrated hours at the average to make the rows line
up would be inventing a rate — the one thing §27.10 says this never does. That
week is shown the way the arithmetic actually ran instead: priced hours, the
premium on top, and the unpriced hours named and left out of the money.

A week with no overtime says so rather than dropping the row, because a
missing row reads as a figure that failed to load rather than as the answer to
"how much of this was overtime".

The averaging is explained only on weeks that have overtime in them. On a
mixed week the regular rate is a weighted average carried at full precision,
so the row does not multiply out at the two decimals it is printed to —
28.00 h at $14.14 reads as $395.92 against a stated $396.00 — and on a screen
built for reconciling against a deposit, eight cents he cannot account for is
worse than a sentence. That sentence was first printed on every mixed week,
and on one with no overtime it was a paragraph about a row that is not on the
screen: it opens on "the regular rate", which is a term that exists to work
out overtime, under a table that says there was none.

So the cents are answered where they occur, by one word in the cell —
`$14.14 avg` — and the paragraph is kept for the week that has an overtime
line to justify it, where it explains that line as well as the rounding.

Two things stayed in the column, because they are not arithmetic: the
unconfirmed-hours note (§20.4) and the hours-at-no-rate note. Both are about
whether the figure beside them can be trusted at all, and that has to be
readable without opening anything.

### 29.5 Where the two flags live

`pastOpen` and `payOpen` are module-level variables, deliberately not in the
store. `renderAll()` runs on every edit, so they have to survive a redraw —
opening the past and then editing a shift in it must not fold it away again —
but they should not survive the app being closed. Opening it tomorrow, the
thing to see is this week again. This is the opposite call to §28's folds, and
for the opposite reason: a fold in Setup records a decision about a job that
still holds next week, while these record where he happens to be looking now.

### 29.6 The nav bar was not floating

Reported off the screenshots above: the tab bar appeared halfway down the
Schedule tab, over the short-rest banner, instead of pinned to the bottom.

It is not a bug in the app, and it is worth recording because the report was
entirely reasonable — it is exactly what the picture showed. Playwright's
`fullPage: true` stitches a tall image out of a scrolling capture, and a
`position: fixed` element is painted once, at wherever it sat in the viewport,
and then stranded mid-image. Measured in a real viewport at the top, the
middle and the bottom of the scroll, `nav.getBoundingClientRect().bottom`
comes back at 915 of a 915px viewport every time.

The lesson is about the screenshots rather than the CSS: a page with a fixed
bar cannot be shown with a full-page capture. Everything above was re-shot at
viewport size and scrolled, which is also what he is actually looking at.

## 30. Built: one overlap warning, between the two, 4 September 2026

§19 put the overlap warning beside *both* shifts, and said why: a double
booking is the failure with no recovery, so two lines where the old check
printed one "is the right trade".

On the screen it was not a trade, it was the same sentence twice:

> 15:00 – 01:00  DSI · Cook Plant ASO
>   *Overlaps Tru-Point 19:15–07:15 on Sat 5 Sep by 5h 45m. He cannot work both.*
> 19:15 – 07:15  Tru-Point · Security Officer
>   *Overlaps DSI 15:00–01:00 on Sat 5 Sep by 5h 45m. He cannot work both.*

Four lines of red for one problem, each naming the shift printed directly
above or below it. §29.2 had just made the same argument about the rest note
and the fix is the same: put it between the two, and the placement says which
two it means.

So it is one banner, in the gap:

> **Warning — shifts overlap. Verify schedule in employer apps and adjust.**

**It names neither side and states no duration.** Both were there to
disambiguate a line that had floated away from its subject; sitting between
them, they were describing what he could see. What replaces them is the thing
neither said — what to do about it. The rest note has nothing to offer there
and stops at the fact (§25), but an overlap has a next step.

**And the next step is not in this app.** An earlier draft read *"Tap shift to
adjust times or delete"*, which points at the shift editor — and editing the
shift here fixes the screen while leaving him rostered for both. Whichever of
the two is wrong is wrong in Homebase or in DSI's app, which is where he is
actually double-booked and the only place it can be settled. So the banner
sends him there.

**Still not a proposal.** It does not say which of the two to change, because
§19.4's rule holds: the feed may be right and the screenshot stale, or the
reverse, and a warning that also gives advice is one he has to disagree with
rather than read. It says go and look.

**It is keyed on whichever of the pair starts later**, because the list is
drawn in start order and that is the one it can be placed in front of — the
same trick §29.2 uses, and it works across a day boundary for the same reason.
A Trupoint night at 22:00–06:00 running into a DSI morning at 03:00 puts the
banner at the top of Monday, which is still between the two. `clashPairs()`
returns the pair in store order, which says nothing about which came first, so
the comparison is made at the call site. A `Set` rather than a `Map`: a shift
can run over two others, and what has to be said once is that this row is
double-booked.

**And it is filled now.** §25 gave the rest note grey specifically so it could
not be mistaken for this red. §29.2 then filled the rest note — and a red
*line* under a filled amber block is the worse warning drawn quieter, which is
the inversion that rule existed to prevent. Both are filled, same shape, two
colours, and the red still has only ever had this one job.

The banner above the week list is untouched. It names both sides and the size
of the overlap because up there nothing is next to anything, and because it
exists for the case where nobody is looking at that week at all (§19).

---

## 31. Fixed: the export wrote no titles at all, 4 September 2026

Ray imported a file and Samsung Calendar offered him eight rows of **My
event**. The times were right. Everything else was gone.

"My event" is what an Android calendar shows for an event with no `SUMMARY`,
and the file had none — nor a `LOCATION`, nor a `UID`. What it had, where each
of those should have been, was the line `[object Object]`.

### What happened

The app has no build step and no modules. `index.html` loads seven plain
scripts, and every top-level `function` and `const` in them lands in **one**
global scope, where the last file loaded wins:

    parser.js  ics.js  patterns.js  holidays.js  sites.js  pay.js  app.js

ics.js has owned RFC 5545 line folding since §22 — `fold(l)`, which breaks a
long property across 75-octet lines. §28 then gave app.js a `fold(key, head,
note, open)` of its own, the Setup screen's `<details>` helper. Same name,
different job, and app.js is loaded last.

So from §28 onwards, every call in `buildICS` that reached for the folder got
the fold *widget*, and pushed the `<details>` element it returns into an array
that is later `join`ed into text:

    SUMMARY:[object Object]      -> no title, so "My event"
    LOCATION:[object Object]     -> no address, so nothing to tap (§26)
    UID:[object Object]          -> no identity at all
    DESCRIPTION:[object Object]  -> both alarms fire with no text (§25)

`buildCancelICS` in ics.js was hit the same way — in the browser it resolves
`fold` through the same global scope, so the §22 cancellation was writing
`UID:[object Object]` too, and cancelling nothing. Exactly the silent failure
§22 wrote three paragraphs about: the file imports cleanly, and the alarm
still rings at five.

**The UID loss is the worst of it**, and it is worse than a missing title.
`shiftUID` is what makes a re-import an update rather than a second copy, and
what a cancellation names. Every event in a broken file carried the same
literal string as its identity, which is not a name, it is a collision.

### Why nothing caught it

The tests `require` each file into a scope of its own, so ics.js's `fold` is
the only `fold` any of them has ever seen. `tests/ics.test.js` exercises the
folder directly and passes; it always did. The collision exists only in the
browser, where the scripts share a scope — and nothing was testing the scope.

The rename is the fix — the folder is `icsFold` now, alongside `icsEscape`,
`icsStamp` and `icsLocal`, which is the prefix the rest of that file already
carries — but the rename is not the lesson. Any of the seven files could do
this again tomorrow.

So `tests/globals.test.js` reads the `<script src>` list out of index.html and
fails if two of those files declare the same top-level name. It reads the list
rather than holding one, because a file added to the page and not to the test
is exactly the file the test exists for.

### What it means for a calendar that already has the bad events

Nothing in the app can clean them up. A cancellation names an event by UID
(§22), and the UID those events were saved under is not the one the store
holds — so `shifts-cancelled.ics` will not touch them. They have to be deleted
on the phone, by hand, once.

After that: **Export everything**, not the incremental export. The incremental
one sends only shifts with `sent` false, and the whole broken batch was marked
`sent` on the way out. In subscription mode this is already true — the file is
the calendar and every rebuild holds everything (§13).

## 32. Built: the app shows both jobs, 4 September 2026

Two things were missing between §14's Worker and a phone that could be trusted
to be looked at. They are unrelated in the code and the same bug in use: the
app was not showing him his schedule.

### 32.1 The cron had no job to poll

`feedJob` in `worker/guards.js` picks the job whose calendar the Worker
fetches:

```js
return cos.find(c => c.icsFeed) || (cos.length === 1 ? cos[0] : null);
```

Nothing ever set `icsFeed`. The two mentions in the repo were that line and its
own unit test. Setup writes `icsMatch` — the word an event has to contain to be
taken seriously — and `icsMatch` is a filter, not a choice of job; §11.1 even
says "a feed-backed job is one with an `icsMatch` set", which is true of the
import screen and was never true of the cron.

The whole premise of this app is two jobs. With two jobs `find` returns
undefined, `cos.length === 1` is false, `feedJob` returns null, and every tick
records `ok: 0, "no job is configured for the feed"` and fetches nothing. Six
hours of that and §14.6's alarm fires — correctly, and about the symptom. The
cause was on the Setup screen the whole time, two sections above the alarm.

So Setup grows the tick, on each job's **App and calendar** fold, and it is
exclusive: ticking one unticks the other. `feedJob` takes the first it finds,
so two ticked would have made the choice by store order and said nothing about
having made it. The decision is now visible and is made where he can see it.

`renderServer` says so too, before anything the server reported and whether or
not the server was asked: with a push token set and no job ticked, the Server
section says which tick is missing. The Worker's own alarm arrives six hours
later and names the symptom; this arrives immediately and names the cause.

### 32.2 The phone could not see what the cron fetched

This is §14.7's "pass two", which that section already called not really
optional. `GET /shifts` on the Worker, behind the same push token `/status` is
behind, returning the `source='feed'` rows; `pullFromServer` in the page
replacing its own copy of that half.

Until it landed the split was invisible and wrong in the worst available way.
The calendar was complete — the Worker builds it from D1, where both halves
live — and the app was not. So the Schedule showed one employer, the Pay screen
was short by the other's hours, and every overlap and short-rest warning was
worked out over half the picture. The calendar was right, and the calendar is
the backup. The app is what he opens.

**The local half can be replaced whole**, because `source` says who wrote what.
The phone never files a `feed` shift — a calendar imported by hand here is
`ics`, and the Worker rejects a pushed row claiming otherwise — so the column
is an unambiguous mark for "the cron wrote this". Replacing it mirrors the
`DELETE FROM shifts WHERE source != 'feed'` the push already does at the other
end. Each side replaces the column it owns in one statement. Neither can
half-apply, and neither has to know what the other did. §14.3's column
ownership, read in the second direction.

**Names are resolved again on arrival.** The Worker matched them against the
cfg it was last pushed, and a site added on the phone this morning is not in
it. Every row goes past `applyNames` before it is filed, so a shift cannot land
as bare text beside one the app already files properly.

**An unmigrated server deletes nothing.** `/shifts` answers `needsSetup` before
the schema is applied, the same way `/status` does, and the pull treats that as
"nothing to say" rather than "no shifts". Wiping a schedule to match a server
that has never held one is not a state there is a way back from.

**When it runs**: on boot after the first paint, on `visibilitychange`, on the
Setup screen's Check button, and after a push — which makes that one button a
whole sync rather than half of one. The floor is five minutes, and failure is
silent on every path except the button. Being offline is ordinary here; the
shifts are already on screen out of IndexedDB, which is what keeping them there
was for. The Setup screen is where the server is reported on properly.

### 32.3 A fetched shift is read only

It belongs to the employer's calendar and the cron replaces it from there every
fifteen minutes. An edit saved on the phone would be gone by the next poll with
nothing on any screen to say why — §4's silent staleness, arriving by a new
route.

So a feed shift is marked on the Schedule — "from the calendar", the same
italic the rota mark uses, because both say "this row is not one he typed" —
and opening one gives a panel rather than the edit dialog: job, date, times,
where, and the address, which is still one tap from navigation and is the whole
reason §8.1 exists. No Save, no Delete, and a line saying to move the shift in
the employer's app, where the change will actually hold.

### 32.4 What the tests hold

Both halves are page-only. `icsFeed` is written by a checkbox and read by a
Worker; `pullFromServer` merges two lists using `applyNames`, `S` and
`renderAll`. No unit test can reach either, and the gap between them was a
Worker refusing every fifteen minutes while 243 tests passed — which is the
same shape as §31, and the reason `browser.test.js` exists.

Two new browser tests, driving the real handlers: the tick is exclusive and
survives the redraw it triggers; the pull replaces the feed half, leaves the
typed shifts alone, resolves names against this phone's tables, refuses to
delete anything on a `needsSetup` answer, and opens a fetched shift with no way
to change it.

And one in `config.test.js`: every route in `worker/index.js` checks the push
token, at the route or in the handler it dispatches to. It reads the file as
text, because `worker/index.js` imports `schema.sql` and cannot be required
outside wrangler's bundle. That is weaker than calling it and still worth
having — a route added without its guard is the whole schedule readable by
anyone who knows the hostname, and nothing else in the suite would notice.

### 32.5 Found on the way: the app was dead offline

`sw.js` lists the shell files it caches on install. `feed.js` and `merge.js`
were never added to that list — they have been missing since §14.7 extracted
them — while `index.html` has loaded all nine scripts the whole time.

The shell handler is cache-first with a network refresh behind it, so a miss is
not slow offline, it is nothing: the fallback is a `fetch` that cannot succeed,
and it resolves to `undefined`. The page then loaded eight of its nine scripts.
`feed.js` throws on a missing collaborator by design — §31 bought that check —
so what he got was a blank app, with no signal, in the one condition an
installed PWA exists to survive. Which is also the condition this section's
whole argument rests on: the app is what he looks at, and half the car parks he
works in have no signal.

Both files added, and `SHELL` bumped to v10 — `install` only re-runs `addAll`
under a cache name it has not seen, so without the bump the fix ships and no
phone fetches it.

`config.test.js` now reads the `<script src>` list out of index.html and the
`FILES` list out of sw.js and fails if they disagree, the same way
`globals.test.js` reads that list rather than holding one: a file added to the
page and not to the shell is exactly the file the test exists for.

## 33. Built: shifts send themselves, 4 September 2026

The button was the whole mechanism for getting the phone's half to the server,
and it was the wrong shape for what it does.

A shift is added at the end of a shift, on a phone, by somebody who has just
finished twelve hours. The step between "it is in the app" and "it is in the
calendar" is a step that gets missed, and missing it is silent in the way this
project exists to refuse: the shift is on the Schedule, the app looks right, and
the alarm at five the next morning does not fire. §4 designed that failure out
of every other path in the app and left it standing at the one place a human had
to remember something.

### 33.1 Hung on `save`, not on a list of triggers

Every mutation in the app already calls `save()`. So `save()` schedules the
push, and the coverage is complete rather than nearly complete — a list of
trigger points written by hand would have been missing the one that mattered,
and there would have been no way to know which.

Debounced four seconds: a rate typed into Setup is eight keystrokes and one
change. Flushed immediately when the app is backgrounded, because Android can
stop the page at any point after that and a pending timer stops with it.

### 33.2 What makes that affordable: comparing the payload

`save()` runs on every keystroke and every fold opened. Almost none of those
change what the server holds.

So `pushBody()` builds the request as the string it will be sent as, and
`autoPush` compares it with the last string the server accepted. That test is
exact in both directions: it cannot push for a change that does not reach the
server, and it cannot miss one that does. A dirty flag would have been the
first; a hash would have risked the second.

`sent` is stripped from what goes up. It records what *this phone* has put into
a calendar, which is not the server's business — the same argument the pull
already makes in the other direction — and it also has to go, or the flag set on
a successful push would change the payload and ask for another push to say so,
for ever.

### 33.3 Failure is quiet, and is not lost

Being offline is the ordinary case here, not an error to report: half the car
parks he works in have no signal.

So a failed push says nothing and throws nothing. `sentBody` is only advanced on
success, so the next save, the next resume, the next minute tick, or the next
launch tries again with whatever is current by then. Four chances, and the last
one covers a phone that was closed with a push still owed.

The important half is that the shifts stay **unmarked**. `sent` is set only on a
confirmed write, so §23's warning — "2 shifts are not in the calendar, the
soonest tomorrow" — stays on the Schedule for exactly as long as it is true, and
goes when the push lands. The existing machinery is the failure report; nothing
new had to be built to say it, and nothing nags about a button.

What did change is what that warning tells him to do. It used to end "Save the
feed file in Setup", which with a server is telling him to press a button that
is not what is holding this up. With a token set it now says they send
themselves, and to check the server if the warning stays.

### 33.4 The button is still there, and now means "now"

Renamed to **Send now**, unconditional where the automatic path is not: he
pressed it, and a button that decides for itself that the server already has
this would look broken on the one occasion he is pressing it because he doubts
that. It still does the full round trip — push, then read the cron's half back.

Without a token none of this exists and the `.ics` download is unchanged. The
token is the consent, and §4's rule is untouched: nothing leaves the device
without one, automatic or not.

### 33.5 Found by it: rendering was writing to the store

`renderPatterns` filled in a missing `patterns` array on the way past. Harmless
for as long as nothing compared the store with itself — and the moment something
did, a job saved before §18 sent itself once more on the first render after
every launch, for ever, over a difference nobody asked for.

Fixed where it was: the render reads, and the array is created by the button
that adds the first pattern. The browser test asserts the general rule rather
than that one line — draw the whole app twice, and the payload must not move.
Any render that writes to the store fails it.

---

## 34. Built: testing on another phone, and undoing it, 4 September 2026

Ray asked whether testing the app on his own phone could leave his husband with
duplicate calendar events. The answer turned out to be yes, by a route nothing
in the app or the Worker could see, let alone clean up — and the reason is
§14.3, the rule that makes the ordinary sync safe.

### 34.1 How a test duplicates a calendar

The company id is the hinge. It is `uid()`, minted when the job is created in
Setup, and nothing else in the system ever derives one: the cron stamps its rows
with `feedJob(store.companies).id`, and `feedJob` refuses rather than guesses
when the config names no job. So a server with no config writes nothing at all —
the poll records `no job is configured for the feed` and stops. That part is
sound.

What is not sound is what happens when the same job is set up a **second** time.
It gets a new random id, the push replaces the `cfg` row whole, and on the next
tick:

```js
const mine = store.shifts.filter(s => s.companyId === job.id && s.source === 'feed');
```

matches nothing. Every event in the employer's calendar comes back as an `add`.
`guard` waves it through, correctly by its own lights — `if(!held.length) return
null` is there so the very first poll is not refused as a massacre — and the
unique index is on `(company_id, ext_uid)`, so a new company id collides with
nothing. The database now holds two copies of the whole calendar, and
`feed()` builds the file from `SELECT json FROM shifts` with no WHERE at all,
so ICSx⁵ mirrors both.

The second setup does not have to be on a second phone. **Delete everything and
start over**, then recreate the job, does it on the only phone there is.

### 34.2 Why nothing could clean it up

Both halves of §14.3's bargain fail closed here, in the same direction:

- The phone cannot delete the rows. The push's clause is `DELETE FROM shifts
  WHERE source != 'feed'`, so "Delete all shifts" clears the typed half and
  leaves the duplicated half untouched.
- The cron cannot delete them either. Its `remove` list comes from
  `report.cancelledRows` matched against `byUid`, and `byUid` is built from
  `mine` — which is filtered by the *current* job id. Rows under the dead id are
  outside its view permanently.
- "Delete everything and start over" does not even try. It writes `DEFAULTS`
  straight to IndexedDB, deliberately bypassing `save()` — the only thing that
  schedules a push — and throws away the token on the way, so `autoPush` stops
  at its first line. Nothing leaves the phone, and the device has just destroyed
  the credential it would need to say otherwise.
- Re-running the migration does nothing: `schema.sql` is `CREATE TABLE IF NOT
  EXISTS` throughout, by design (§14.9).

And every screen reads the state as something other than what it is. The
Schedule draws the orphans as "Unassigned". The Pay tab walks `S.companies` and
so never counts them. The clash banner fires on all of them and blames the shift
they collide with rather than the copy they are.

### 34.3 `GET /trace` — the question `/status` does not ask

`/status` answers "is the cron still running": counts by source, the poll ring
buffer, §14.6's two alarms. That is a question about *time*, and it is the right
one for the failure §14.6 was built around — a calendar that has quietly stopped
changing.

`/trace` answers a question about *rows*, because both failures this project has
actually shipped were invisible to the first one. A feed full of `[object
Object]` polled perfectly (§31). A duplicated calendar polls perfectly too.

It returns the config's jobs with their ids, the shift table grouped **by
company id as well as by source** — the shape `/status` cannot have, since two
copies of one calendar are both `feed` and the count merely doubles — the
orphans named by `orphanGroups`, and the event count of the feed *as actually
rendered*, not as counted from the table. Rendering it is the only way to be
sure the thing ICSx⁵ fetches is the thing the rows say it is.

Behind the push token, like everything else that describes his schedule.

### 34.4 `POST /reset` — the one thing allowed across §14.3's line

Deliberately blunt: every row, every table, no filtering by source or by
company. Anything narrower would have to know which rows the test wrote, and the
whole reason this exists is that by then nobody does.

Counted before it clears, and the counts come back — "cleared" with no number is
indistinguishable from "there was nothing there", and being told what the test
left behind is the point of pressing it.

`drop` is offered and is not the default. Dropping the tables is tidier and
stops the cron writing so much as a refusal, but the next phone must press "Set
up the database" before its first push will land — a real trap on the morning
somebody is being handed a working app. So it is asked for explicitly.

### 34.5 The order, which is the whole design

The teardown is a sequence, and everything of value in it is in the ordering:

1. **Cancellations first**, while the shifts that name them are still on the
   device. It goes through `retire`, the same path every ordinary delete takes,
   so it covers both jobs — the cron's rows are events in the calendar exactly
   like the typed ones — skips anything never sent, and counts the sequence
   number up, since a calendar may ignore a revision no newer than the one it
   holds (§22).
2. **Clear the server.** In subscription mode this *is* the deletion: the feed
   empties, and ICSx⁵ mirrors rather than appends. In manual-import mode there
   is no such moment, which is why step 1 is not optional there.
3. **Verify.** A 200 says the statements ran. `/trace` says the feed ICSx⁵
   fetches is actually empty, which is what was being claimed.
4. **Forget the token**, on its own and written immediately. That alone makes
   the device inert — both `autoPush` and `syncDown` stop at their first line
   without one — so if anything below fails the phone is still safe.
5. **Wipe the device.**

If step 3 finds rows still there it stops without touching anything local, and
says so. A phone that still holds the token is a phone that can try again; one
that does not is a dead end, and that asymmetry is worth more than tidiness.

`teardown.running` guards the gap between 2 and 5. Without it the sixty-second
timer, a tab switch, or the `visibilitychange` on the way to the file picker
would each push the whole schedule straight back into the database that was just
emptied — and it would look exactly like the teardown had not worked. It is
never unset once the server has been cleared.

What the app cannot do is reach into the calendar app, so the last line of the
log is an instruction: sync ICSx⁵ once and look at the calendar before handing
the phone over. Nor can it revoke the shared secret — only forget it. Rotating
`PUSH_TOKEN` in the Cloudflare dashboard is the real revocation, and the note
says so.

### 34.6 What is tested where

The split follows the one this codebase already uses. `resetPlan` and
`orphanGroups` are pure and live in `worker/guards.js` with unit tests —
including that `shifts` is cleared before `cfg`, so a batch that somehow half-
applied cannot leave the feed being built from rows whose companies have gone,
which is the orphan case again.

The sequence itself is a browser test, and has to be. A unit test can assert
that `resetPlan` names four tables. Only a loaded page can assert that the token
is still there when the server is called and gone by the time it finishes, and
that `autoPush` and `syncDown`, fired deliberately mid-flight, put nothing back.

---

## 35. Fixed: the Homebase shifts were an hour late, 4 September 2026

Every shift the cron filed was on the calendar an hour out. Not the typed
ones and not the rota's — the Homebase ones, the half of the schedule
nobody types, which is the half the phone cannot check against anything.

The employer's calendar publishes UTC. `ics.js` turns that into a wall time,
and it needs to be told which wall: `parseICS` takes a `zone`, and with none
it reads into the machine's own clock. In the page that is free and always
right — the machine is his phone and the phone is where he works. In the
Worker it is not available at all. Cron Triggers are UTC-only and a Worker has
no locale, so `normalizeTimezone` in `worker/guards.js` falls back to a
hard-coded `America/Toronto` when the job does not say.

§14.10 settled this a month ago: **a per-job IANA name in `cfg`**. What it did
not do was build the input. `co.zone` was read by the Worker on every poll and
written by nothing, ever, so the fallback was not a fallback — it was the
answer, for every job, on every tick. An hour west of Toronto that is a 17:00
start filed as 18:00.

### Why nothing caught it

Because everything agreed. The Schedule drew 18:00, the pay figures counted
the hours from 18:00, the feed published `DTSTART` at 18:00, and the alarms
counted back from 18:00. There is no screen in this app that compares a shift
against anything but another shift, and all of them were reading the same
wrong number. `/status` said the poll was healthy, because it was: the fetch
worked, the parse worked, the diff applied. Nothing in it named the clock.

That is the same shape as §31 — a file that imports perfectly and is wrong —
and it wants the same answer: not more care, but a number on a screen that a
person can disagree with.

### What changed

- **The field exists.** `co.zone` on the **App and calendar** fold, a text box
  with a datalist of the usual names. Free text and not a menu: a menu that
  forgot a city would be a phone with no way to say where it is.
- **It starts as the phone's.** A new job takes `Intl.DateTimeFormat()
  .resolvedOptions().timeZone`, and `fillZones` on load backfills every job
  written before the field existed. He is asked nothing, and the job that is
  wrong is the only one he has to open. Filling it in triggers a save, so it
  reaches the server on the next push rather than at the next edit.
- **An offset is refused in words.** `zoneOK` in `app.js` is the same shape
  test `normalizeTimezone` applies on the other side, so a zone this screen
  accepts is one the Worker will honour. `UTC-6` is not stored quietly to be
  thrown away six hours later; the sentence under the box says why.
- **Both readers are told.** The page's own import passes `jobZone(co)` to
  `parseICS` rather than leaning on the machine. Two readers of one calendar
  that disagree about the hour do not just show different times — they match
  nothing on `icsSame`, and every poll rewrites the whole schedule.
- **The zone is reported.** `zoneFor(job)` in `worker/guards.js` returns the
  zone *and* whether it had to fall back to get it, `GET /status` carries both,
  and the Setup screen prints `Feed times are read in America/Chicago`. When
  the server's answer and the phone's disagree the line goes red and names both
  — which is the line that would have made this a five-minute bug.

### The repair

Nothing has to be re-imported. The shifts on file differ from the shifts the
feed now parses to, so `mergeCalendar` puts them in `replace`, the poll rewrites
them in place, and `SEQUENCE` goes up — which is what makes a calendar accept a
revision it already holds (§22). §14.6's guards do not stand in the way: they
cap removals, and a retimed shift is not one. One tick, and the schedule and
the calendar are both on the right clock.

### What is tested

`zoneFor` is pure and sits with the other guards: a job with a zone, a job
without one, a job that asked for `UTC-6` and did not get it — all three come
back saying which they were. `ics.js` gets the symptom stated as arithmetic:
one UTC start, read on Chicago and on Toronto, an hour apart.

The rest is a browser test, and has to be. Only a loaded page can assert that a
job made in a Playwright context pinned to `America/Chicago` is born in Central,
that `fillZones` repairs a store written before the field, that typing an offset
gets a sentence instead of silence, and that a `/status` reply naming Toronto
turns the line red while one naming Chicago leaves it grey.

---

## 36. Fixed: the role was in the calendar and not in the app, 4 September 2026

The event Homebase publishes and the event this app publishes, side by side:

    Homebase Raw            Shift: F.O.C.
                            Sat 5 Sep 19:15 → Sun 6 Sep 07:15
                            3492 Hwy 42, Hattiesburg, MS 39402
                            Security Officer

    Work Schedule           Tru-Point- F.O.C. - 3492 Hwy 42
                            Sat 5 Sep 20:15 → Sun 6 Sep 08:15
                            3492 Hwy 42 Hattiesburg, MS 39402

§35 is the hour. This is the title: the street number went into it, the role
did not, and the address ended up said twice.

### The three fields, and which is which

Homebase's own sync writes a shift as three properties, and none of them is
where the fixture said it would be:

    SUMMARY:      Shift: F.O.C.        the station, behind a badge
    LOCATION:     3492 Hwy 42\n…       the street address
    DESCRIPTION:  Security Officer     the role

`labelFor` read the first two and ignored the third. It took the first segment
of LOCATION as the name of a place — right for `Headquarters, 401 Main St`,
wrong for `3492 Hwy 42` — and glued it to the summary with " - ".

That dash is the second half of the fault, and the worse half. §17.4 keeps two
separators apart on purpose: `" | "` is a boundary the employer printed and
`splitLabel` can trust it; `" - "` is glue this app invented and means nothing
about structure. So the label went to the site and role tables as one
unsplittable string, matched neither, and every downstream question — what is
this shift called, what does it pay (§27), is it the same shift as the one on
file (`whereKey`) — was answered off raw text.

### What changed

- **The role comes out of DESCRIPTION**, when it is plainly a role: first line,
  four words at most, every word capitalised, no digits. The fixture's own
  "Shift published by Homebase.", Google's HTML and our own "12h scheduled" are
  all refused, and a refused description leaves the row reading exactly as it
  did before. A wrong role is filed against a rate; a missing one is a row he
  names himself.
- **A street line is an address, not a place.** `placeName` drops a first
  segment that starts with a digit. It is already on the event as LOCATION,
  tappable, which is §8.1's best argument for the site table in the first
  place — printing it in the title as well cost the room the role needed.
- **The halves are joined with the pipe**, because the reader knows the
  boundary is real: the two halves came out of two different properties. The
  label Homebase's feed now produces is `Security Officer | F.O.C.`, which is
  the same shape TrackTik prints and the tables already read.
- **One resolver, two callers.** `resolveNames` in sites.js does the whole of
  it — split the label, ask each table about its own half, take the curated
  spelling — and `applyNames` in the page and the cron's `resolver` both call
  it. The cron had its own version that matched the whole label against the
  sites and a `role` field a feed row does not carry against the roles, so a
  shift the server filed resolved to neither table while the same shift
  imported by hand resolved to both.

The event now published is `Tru-Point- Security Officer | F.O.C.`, at 19:15,
with the address still on it. The order is §8.1's `${company}- ${role} |
${site}`, the same as every other screen and the TrackTik rows; the calendar is
not the place to invent a second one.

*(§42 reverses the order to `${company}- ${site} | ${role}` — the event reads
`Tru-Point- F.O.C. | Security Officer`. The sentence above is why that had to
be one change in one function and not a calendar-only tweak.)*

### What is tested

`placeName` and `roleFrom` are unit tests naming the real strings — the street
line, the description that is a sentence, our own feed's. `labelFor` gets
Homebase's three fields as one case and Google's two as another. The synthetic
fixture gains an event in the shape Ray's calendar actually holds, so the whole
path is a golden test rather than three functions agreeing in isolation.
`resolveNames` is four cases in sites.test.js, the one the cron was getting
wrong first among them.

---

## 37. Fixed: §35 shipped and the times did not move, 5 September 2026

The deploy went out and the Schedule came back with the new titles on it —
"Tru-Point · Training · Headquarters" where the address used to be — and every
one of them still an hour late. The summary is §36's work and it landed. The
hour is §35's and it did not.

Which is the useful part of the report, because the two travel together. A
title only changes when the cron rewrites the row, and the cron writes the
label and the times in the same rewrite. So the rewrite happened, with the new
reader, and still produced Eastern wall times: the Worker was running the fixed
code and had never been told the zone.

### Two routes, and §35 only built one

`co.zone` reaches the Worker in the config the phone pushes. That is the right
place for it — the phone is the only thing that knows where he is standing —
but it made the push a precondition for the fix, and two things sit in front of
a push:

- **The shell cache.** `sw.js` serves the app cache-first with a network
  refresh behind it, so the load after a deploy runs the *previous* `app.js`
  and the new one only appears on the load after that. `SHELL` was left at
  `v10`, so the service worker never reinstalled and never re-fetched anything.
  The phone was running the code that has no zone field and no `fillZones`,
  which cannot push what it does not have.
- **The first tick.** Even on a phone with the new code, the cron may fire
  before the push lands. A server with no answer needs one that is right
  anyway.

And the answer it fell back to was `America/Toronto`, lifted from
Star-homeschool along with `normalizeTimezone` — an Eastern default in an app
whose every shift, fixture and test is in Hattiesburg.

### What changed

- **`ZONE` in `wrangler.toml`.** A plain var, deployed with the Worker, read by
  `zoneFor` when the job in `cfg` has not said. It is right on the first tick,
  before any phone has spoken, and it steps aside the moment a job carries its
  own zone. `keep_vars = true` protects the secrets in the dashboard; a var in
  the file is not one of them.
- **The last resort is Central.** `DEFAULT_ZONE` is `America/Chicago`. A
  default nobody notices should be the answer for the place the app is used.
- **`zoneFor` says where its answer came from** — `job`, `env` or `fallback` —
  and `/status` carries it, so the Setup line reads "the zone set on the
  Worker, because the job's own has not reached it" rather than leaving him to
  work out which of the three he is looking at.
- **`SHELL` is bumped to `v11`**, which is what makes the browser reinstall the
  service worker, re-fetch every file in `FILES`, and claim the open page. A
  release that only reaches the phone on the load after next is a release that
  looks like it did not work — which is exactly how this one looked.

### What is tested

`zoneFor` gets the env case in guards.test.js: told a zone with no job answer
it uses it and says `env`; told one alongside a job answer the job still wins;
an offset in the deploy config is refused exactly as one in a job is. A config
test reads `wrangler.toml` and fails if `ZONE` is missing, is filed under the
wrong table, or is an offset rather than an IANA name — the same three ways the
`keep_vars` line was wrong before §14.9 found it. The browser test now drives
all three sources through the Setup line.

---

## 38. Built: the cron's decision, where a test can reach it, 5 September 2026

Three faults reached the phone in two days — §35's hour, §36's missing role,
§37's zone that only travelled by push — and the suite was green through all of
them. They have one thing in common: every one lived inside `poll()`.

`worker/index.js` cannot be required by a Node test. It is ESM, it imports
`schema.sql` as text, and every path through it wants a D1 binding. So the
cron's judgement — which zone, what the feed says, what would change, whether
§14.6 will allow it — was the one part of this app with no test at all, while
`parseICS`, `mergeCalendar` and `guard` each had a thorough one. Each module
answered its own question correctly and nothing checked the sentence they made
together.

### `worker/poll.js`

The same extraction guards.js, merge.js and feed.js each came out of.
`planPoll({ text, store, env, at })` is a pure function: feed text in, and out
comes the zone it used, where that answer came from, what the reader made of
the text, what would change and the guard's refusal. `index.js` keeps the two
halves that need the outside world — the fetch and the batch — and asks this
what to do in between.

`resolver` moved with it, which is where §36's fault was. `feedRow` moved too,
and that one is not tidiness: the idempotence test has to build its rows the
way the Worker builds them, and a test that built them differently would be
testing its own arithmetic.

`at` is passed in. A test whose seven-day window is counted from the real clock
starts failing in a week for a reason that has nothing to do with the code.

### What it caught, stated as tests

The eleven cases in `tests/poll.test.js` are the September faults, written down
so they cannot come back quietly:

- **The hour.** The fixture's 00:15Z event lands at 19:15 the evening before,
  which is what the raw Homebase entry says. The same feed read on
  `America/Toronto` lands at 20:15 — the shipped bug, pinned rather than
  described.
- **The names.** A cron-filed row resolves to `roleId` and `siteId` and carries
  the address in `place`, not in the label. A row neither table has heard of
  still files under the text that was read.
- **The repair.** Two polls with the zone corrected between them: no additions,
  no removals, every shift replaced in place, ids kept, `seq` up by one. That
  is the tick that fixes Ray's calendar, asserted rather than hoped about.
- **The no-op.** Two polls of an unchanged feed: nothing added, nothing
  replaced, everything unchanged. Cron Triggers do not retry and may
  double-fire (§14.5).
- **The refusals.** An empty calendar, a sign-in page, and two jobs with
  neither ticked each come back as the reason they came back, with the last
  good feed still standing.

And one assertion in `config.test.js` keeps it honest: `poll()` must call
`planPoll`, and must not contain a parse, a diff or a guard of its own. The
decision moving back into a file no test can reach is exactly how this went
untested for as long as it did.

---

## 39. Built: a colour per job on the calendar, 5 September 2026

The app has known which job a shift belongs to since §32, and it says so in
three places: the dot beside the job in Setup, the 3px tick down the side of
every row in the Schedule, and the job's name at the front of every title. The
calendar had the third of those and neither of the first two. One subscription,
one colour, both employers — which is the state §32 fixed everywhere except
the screen he actually looks at in the morning.

### What is possible, and what is not

Three routes, and only one of them survives contact with the chain this app
publishes through.

- **Google's own per-event colours** are `colorId` on the Calendar API and
  nothing else. §4 rejected that API for reasons that have not changed, and a
  published `.ics` cannot reach it.
- **`CATEGORIES`** is accepted by everything and displayed by nothing in this
  chain. Writing it would be writing a line for no reader.
- **`COLOR`, RFC 7986**, per event. ICSx⁵ maps it onto the Android calendar
  provider's per-event colour, and the Google Calendar app and its widget draw
  what the provider holds. Everything else in the chain skips the property.

The third is what is built. The reason it was worth building rather than
debating is the shape of its failure: a client that does not understand `COLOR`
ignores the line, so the calendar in that case is the calendar he has today.
There is no version of this that makes anything worse, which is a rare enough
property in this project to spend an afternoon on.

The alternative that would have been certain — **a feed per job**, subscribed
twice, coloured in ICSx⁵ — was not built. It works everywhere and it costs two
subscriptions on the phone, two URLs to keep secret, and a second thing to
notice when one of them stops. §4 spent a week getting one feed onto that
phone. If the colours do not appear, this is where to go next.

### The value is a name, not a hex

RFC 7986 takes a CSS3 colour *keyword*. Setup's picker is an `<input
type="color">` and gives hex. So something has to turn `#2F4B7C` into a word,
and it is `icsColor` in `ics.js`, next to the folder and the escaper, because
which values the format accepts is a fact about the format.

138 names against sixteen million hexes means the match is the nearest one, and
**nearest has to be measured in CIELAB**. That is not fastidiousness. The first
draft measured it with "redmean", a cheap RGB approximation that weights green
four times, and against the five colours a new job is actually born with it
answered `darkslateblue` for both the navy and the plum. Two jobs, one colour,
and the whole feature silently does nothing — the exact failure it exists to
prevent. In Lab the same five come out `steelblue`, `peru`, `seagreen`,
`darkslateblue` and `brown`.

A colour that is not a colour — an empty field, a name, a malformed hex —
returns the empty string and the writer leaves the property out. `COLOR:` with
nothing after it is a malformed line for every client, including the ones that
were going to ignore the value anyway.

### What is tested

- The palette test is the one that matters: five jobs, five different names. It
  is the assertion redmean failed.
- Every one of the 138 entries is checked against an independently written list
  of CSS3 keywords and asked to answer to its own hex, because ICSx⁵ drops a
  name it cannot find and a typo in the table would be invisible.
- The writer puts two jobs' colours on one calendar, and writes no `COLOR` line
  at all for a job that has none — which is every store in every test written
  before today, and every calendar this app published before today.
- The browser test asserts the line in a real Chromium. `ics.js` and `feed.js`
  are separate `<script>` tags sharing one global scope, and §31 is what
  happens when a name is resolved by `require` in the tests and by something
  else on the page.

### The shell version, because §37 was written the same day

`SHELL` in `sw.js` goes to `v12`. The colour is in `ics.js` and `feed.js`, both
of them in that file's `FILES`, and the calendar the *page* saves is written by
whichever copies the shell is holding. §37 is what leaving it alone looks like:
the fix deploys, the phone keeps serving the previous scripts out of cache, and
the thing that was fixed goes on not working with nothing to say why. The
subscription is not affected either way — the Worker renders that feed itself —
but the export path is, and the export path is the one he can check today.

### What is not settled

**Whether his phone does anything with it.** ICSx⁵ reads `COLOR` and the
provider stores a per-event colour; whether that is on by default, behind a
setting, or overridden by the subscription's own colour is not something the
tests here can answer. The next step is one look at the calendar after a sync.
If the events are all still one colour, the feed-per-job route above is the
fallback and nothing has to be undone to take it.

---

## 40. Built: the third line between two shifts, 5 September 2026

Ray, from the week on his home screen: he wants a line for **back to back** —
where one shift ends and the next starts an hour or less later — and the
short-turnaround band moved down to match, from two-to-eight hours to
one-to-eight.

So the join between two shifts now has three sentences instead of two, and
which one is drawn is decided by one number:

| gap | line | where |
|---|---|---|
| overlapping | `Warning — shifts overlap.` | list, banner |
| 0 to 60 minutes | `Back to back — 45 minutes between shifts` | **list only** |
| 61 to 479 minutes | `Heads up — short turnaround (7 hours off)` | list, banner, alarm |
| 480 minutes and up | *nothing* | — |

### 40.1 §19 has to be answered again, and the answer is different this time

§19.1 deleted a turnaround warning that fired on any two shifts under an hour
apart, because that is his ordinary week and a warning that fires on the
ordinary week teaches him to scroll past the line beside it that means
something. §25 answered that by keeping the sub-two-hour case silent. This
feature puts a line back into exactly the band §19 cleared.

The difference is that it is not a warning, and that is a claim with three
things behind it rather than a preference about wording:

- **It is in the week list and nowhere else.** No banner over the schedule, no
  `VALARM` in the calendar. §19's warning was loud in a place he could not
  dismiss; this one is only ever found by a reader already looking at that week.
- **It is not filled.** The overlap is white on red and the turnaround is white
  on amber, because both are things to act on. This is grey on paper with a
  hairline, which is what the app already uses for the words beside a fact.
- **It states the join and stops**, like the other two. There is no "consider",
  no "make sure", nothing to disagree with.

What it buys is real, and it is a property of how the list is drawn rather than
of the shifts: a Trupoint night ending 07:15 and a DSI afternoon starting 08:00
are two rows, in two different day blocks, under two different dates, with
different job names — and nothing on the screen says they are one stretch of
being awake until this does. He knows his own week; what he cannot see at
scrolling speed is which of two adjacent rows in different blocks are joined.

If it does become wallpaper, §19.1's remedy still applies and applies to this
first: delete it rather than tune it.

### 40.2 The floor moved because the hour under it was the worst case

§25 set the bottom of the turnaround band at two hours on Ray's own reasoning —
under two he is not coming home. That was a reason to expect silence to be
harmless, and it was wrong in the one place it mattered: at 90 minutes he is
neither coming home nor going straight on. He is sitting in a car park with an
hour and a half, which is exactly the gap worth knowing about in advance and
was the only band the app said nothing about at all.

So the floor is an hour now, and nothing is silent under it any more — what was
silence is the back-to-back line. The check on that claim is §25's own table,
which changes by one row:

| | shift | rest before it | §25 | now |
|---|---|---|---|---|
| 1 | 15:00–23:00 | — | | |
| 2 | 00:15–04:15 next day | 1h 15m | silent | **short turnaround** |
| 3 | 20:00–08:00 | 15h 45m | silent | silent |
| 4 | 15:00–23:00 | 7h | says so | says so |

One extra alarm on the week the feature was raised about, and it is on the gap
that had the least to say for itself.

### 40.3 One sweep, two predicates, one boundary

`restGaps()` is unchanged except in what it refuses to report. It used to drop a
zero-minute gap along with the negative ones — "zero is a handover and negative
is a clash, neither is time off" — and zero is the truest back to back there
is, so it is in now. Negative stays out: that is not a gap, it is two shifts on
top of each other, and it has its own warning.

The bands are `isBackToBack()` and `isShortRest()`, and they share the constant
`BACK_TO_BACK_MINS` — the top of the first is the floor of the second. That is
the whole reason the number is written once: two predicates with their own
copies of 60 is how a gap of exactly an hour ends up with two lines or none,
and `patterns.test.js` now walks every minute from 0 to 600 asserting that
exactly one of them is true below eight hours and neither above it.

The schedule builds both maps from a single `restGaps` pass, split by band, for
the same reason: asking twice is two chances to disagree about one number.

### 40.4 What did not change

**The calendar.** No new `VALARM`, no new `DESCRIPTION` line. A buzz as he
clocks out of one job to walk into the next is §19's warning wearing a
different hat, and a second alarm for the ordinary week is precisely how the
one that matters gets muted. The feed did widen by one hour at the bottom,
because that is the turnaround band moving and the turnaround band has always
had an alarm: a 90-minute gap now writes `TRIGGER:-PT1H30M`.

**The banner.** Same reason. §25.3 put the rest note on the banner because it
is actionable on the day; there is nothing to do about a 45-minute gap except
know it is coming, and the list is where he finds that out.

**The order between the lines.** The overlap still goes first where a shift
somehow has both. The other two cannot both appear on one shift — the bands
share a boundary — so the order between them is only the order they are
written in.

### 40.5 Tested where it can actually be wrong

`patterns.test.js` covers the bands and the sweep. But which sentence lands in
front of which shift is a rendering decision that exists only in a loaded page,
and `renderSchedule` reads `S` and builds DOM and is reachable from nowhere
else — so `browser.test.js` now builds a four-shift week with one join of each
kind and asserts the three lines come out in the right order with the right
text, including that a zero gap says "no gap between shifts" rather than
"0 minutes".

---

## 41. Fixed: the app would not open from the home screen, 5 September 2026

Ray installed the PWA for the first time and the icon opened Chrome's error
page: *"This site can't be reached — https://shift-deck.star-hs.workers.dev/index.html
might be temporarily down… ERR_FAILED."* The same URL in a browser tab was
fine, the Worker was up, and the app it was serving was the app.

### 41.1 The chain

Three ordinary decisions, none of them wrong on its own:

1. **`manifest.webmanifest` started the app at `./index.html`.** A home screen
   icon launches by *navigating* to the start URL.
2. **Cloudflare's asset handler redirects `/index.html` to `/`.** That is
   `html_handling`'s default, `auto-trailing-slash`, and it exists so a page
   has one canonical URL. Nothing in the repo asked for it and nothing in the
   repo could see it.
3. **`sw.js` cached the shell with `cache.addAll(FILES)`,** and `FILES` held
   `./index.html`. `fetch` follows the redirect and returns a perfectly good
   200 — with its `redirected` flag set. The Cache API preserves that flag.

And then the rule that turns three fine decisions into a dead app: **a
navigation request has redirect mode "manual", and a service worker that
answers one with a redirected response produces a network error.** By
specification. Chrome renders it as ERR_FAILED with nothing on the page and
nothing the phone can show him.

So the app worked in a tab, because a tab that is already at `/` is not making
that navigation, and it failed on every launch from the icon, because that is
the only thing a launch does.

### 41.2 The second way to make the same blank page

Found while fixing the first. The old fetch handler ended:

```js
const net = fetch(e.request).then(...).catch(() => hit);
return hit || net;
```

On a cache miss with no network, `net` falls back to `hit`, which is
`undefined` — and `respondWith(undefined)` is a network error too. Same blank
page, different cause, and it would have been the failure mode of a mistyped
`FILES` entry offline: the exact condition an installed PWA exists to survive.

### 41.3 The fix

- **Start at `./`.** The canonical URL, the one the host does not redirect.
- **`"id": "/index.html"` in the manifest**, which is the identity Chrome
  derived when he installed it. Changing `start_url` without saying so would
  make this a different app to the browser, and the installed one would go on
  pointing at the old URL for ever. Ugly, load-bearing, and permanent.
- **Nothing is cached as fetched.** `install` fetches each file and rebuilds
  the response before putting it, which drops the redirect flag and keeps the
  bytes and headers. `addAll` is what stored the poisoned copy and is gone.
- **Nothing redirected ever answers a navigation**, including a response
  coming straight off the network on a cache miss.
- **The handler cannot resolve to `undefined`.** Offline and uncached falls
  back to the cached shell for a navigation, and to a 503 that says so in
  words for anything else.
- **`SHELL` goes to `v13`,** because a phone holding v12 is holding the
  poisoned copy and only a new cache name re-fetches it (§37's lesson, third
  time).

### 41.4 The test that would have caught it

Nothing in the suite had ever run a service worker: every browser test loads
the app over `file://`, where a worker will not register at all. So this one
starts a local HTTP server that does the two things the host does — serve the
app at `/`, redirect `/index.html` to `/` — installs the worker, and then
navigates to the start URL the way a launch does.

Against the previous `sw.js` it fails with `net::ERR_FAILED at /index.html`,
which is Ray's screenshot reproduced in CI. That is the point of writing it
rather than trusting the text checks in `config.test.js`, which can only assert
that the strings that caused this are absent.

### 41.5 What to do on the phone

The fixed worker has to reach the device before it can help, and the broken
launch is the one thing that cannot fetch it. So: open the site in Chrome
(not the icon), let it load, and the new worker installs and claims the page.
The home screen icon works from then on. If it does not, **Setup → Flush cache
and reload** does the same thing harder, and reinstalling the icon picks up the
new `start_url` as well.

---

## 42. Changed: the place leads the title, 5 September 2026

Ray asked for job, site, role — on the calendar and on the dashboard both. It
was job, role, site.

    before   DSI- Cook Plant ASO | SOUTHERN HENS      Unassigned · Cook Plant ASO · SOUTHERN HENS
    after    DSI- SOUTHERN HENS | Cook Plant ASO      DSI · SOUTHERN HENS · Cook Plant ASO

### 42.1 Why this way round is the better one anyway

Every place the string is read, it is read left to right and cut off on the
right. A 05:00 alarm body on a lock screen, the `.sub` line under a schedule
row, the Where line in the shift dialog, a phone's own calendar list — all of
them run out of room, and none of them run out of it on the left.

So the question is which half survives a truncation, and the two halves are not
equal. The site is what he drives to; it is what the address hangs off, what
`whereKey` files the shift under, and the thing that tells one twelve-hour
night from another. The role is what he does once he is there, and on a job
with one role it says nothing at all — Homebase prints `Cook` for every shift
it publishes. Reading `SOUTHERN HENS · Cook Pl…` he knows where he is going.
Reading `Cook Plant ASO · SOUTHE…` he knows what he already knew.

It also puts the title in narrowing order after the job name — employer, place,
task — which is the order the rest of the app already asks for names in.

### 42.2 One function, because §26 made it one function

`whereText()` in sites.js is the only place the two halves are joined. The
calendar goes through it (`eventTitle` → `feed.js`), and so does every screen
(`shiftWhere` in app.js), which is exactly what §36 insisted on — *the calendar
is not the place to invent a second order*. So the swap is one expression, and
the two ends cannot disagree about it.

The one string that was built by hand rather than through `whereText` was the
rota editor's *"Runs Mon–Fri, 19:00–07:00 as Cook Plant ASO · SOUTHERN HENS"*,
which joined the pattern's declared role and site itself. It is flipped to
match. A generated week is filed under exactly those two records, so the
sentence describing it has to read the way the rows it produces will.

### 42.3 The input side is untouched, and that is the whole subtlety

The employer prints `role | place` — TrackTik on screen, and Homebase's three
properties assembled into the same shape by `labelFor` (§36). `splitLabel` in
parser.js and `readLabel` in sites.js both read that order, and §17.4 is the
section that made the pipe trustworthy enough to read it by.

None of that moved. This is the output side only: what the app *writes* for a
person to read, not what it *reads* from an employer. A shift's `label` still
holds the employer's order, unchanged, and still resolves to the same site and
the same role as it did yesterday. The test added to sites.test.js pins the two
orders against each other in one case, so a later reader that flattens them
back together fails rather than silently swapping a role for a place.

The fallbacks are unchanged for the same reason they exist: a shift with no
site reads as its raw label, a matched role with no site speaks alone, and a
site with no role is just the site. There is no order to reverse in any of
those, and a shift that matched neither table produces the byte-identical
title it produced before either table existed.

### 42.4 What this does to events already on the phone

§8.1's warning, restated by §26.7: changing `SUMMARY` at all rewrites every
event.

- **Subscription mode (§14) handles itself.** The Worker rebuilds the whole
  feed on each poll from `feedICS`, so the next fetch carries the new titles
  and nothing has to be tracked.
- **Manual-import mode does not.** A shift already marked `sent` has an event
  on the phone with the old title and no reason to be sent again. `restamp()`
  is the mechanism — bump `SEQUENCE`, clear `sent` — but it fires on renaming
  a site or a role, not on a change to the code that formats them, and there
  is no `S.version` to hang a one-time migration off (§7, §26.9 chose that
  deliberately). So those events keep the old title until the shift is edited.

The answer there is the control that already exists: **Rebuild the whole
calendar** in Setup, which exports every shift again rather than the unsent
ones. It re-exports at the same `SEQUENCE`, which is why its own dialog says to
clear the shift calendar first — so the honest instruction for this change is
clear the calendar, then rebuild. Not automated here: a title reading the old
way round until the next rebuild is a cosmetic lag, and a migration that
restamped every shift on load would be a schema-shaped answer to a formatting
change (§7).

### 42.5 What is tested

The two title assertions in sites.test.js swap sides, and a new case states the
rule outright: the label goes in as `role | place` and the title comes out as
`place | role`, with the single-half cases asserted alongside so the fallbacks
cannot drift with it. `feed.js` and `ics.js` needed no changes — the writer
takes the title from `eventTitle` and the reader never sees one.

---

## 43. Changed: the nav bar, and three doors that led nowhere, 5 September 2026

Two small things Ray asked for in one breath, both about the Add screen and the
bar under it.

### 43.1 Pay before Add

The bar is `Schedule · Pay · Add · Setup` where it was `Schedule · Add · Pay ·
Setup`. It is a `repeat(4,1fr)` grid, so the order is the order the buttons are
written in and nothing else moved; `b.dataset.tab` is what the click handler
reads, so no wiring knows or cares which slot a button sits in.

The order it should have been in from the start. Adding shifts is the thing he
does once a fortnight when a rota lands; checking what a week paid is the thing
he does on the way home. The two tabs he opens most are now the two ends of the
bar, which are also the two easiest to hit with a thumb.

### 43.2 A size up

`nav button` goes from `.85rem` to `.95rem`, padding `.85rem` to `.95rem` with
it. `.85rem` was the body's own small-text size, which is why it read as a
caption rather than as a control — the only four controls on screen at all
times were set in the type reserved for asides.

The padding moves with the size deliberately: it is what puts each button over
the ~44px both platforms ask of a touch target, on a phone held one-handed in a
car park at 05:00. Nothing else in the bar changed, and it is the only rule in
the file that had to.

### 43.3 The calendar-file pathways are gone

Off the Add screen: the *"Add a calendar file"* drop box, the `#icspick` input
behind it, **Fetch from a link**, **Paste calendar text**, and the `<details>`
explaining how to get an .ics out of Homebase and Google Calendar. `fetchCalendar`
went with the button that was its only caller.

Three doors onto one path, and the path is one Ray has never walked. **Fetch
from a link** could not work and was documented as not working in its own help
text: Google's iCal addresses send no CORS headers, the browser refuses to hand
the page the response, and the function spent its whole life printing an
apology for a failure it could not distinguish from being offline. §14 is what
replaced it — the Worker fetches `env.ICS_URL` server-side on a cron, where
CORS is not a rule that applies, and nothing has to be tapped at all.

What is left on the screen is what he actually does: screenshots, the rota, one
by hand.

### 43.4 What was kept, and why it is not on the screen

`handleFiles` still splits its input by extension and sends an `.ics` to
`readCalendarText`, so a calendar file dropped on the **screenshot** box is
still read exactly as it was. `readCalendarFiles`, `readCalendarText` and
`ics.js` are all untouched — the Worker's importer is the same reader, and the
golden fixtures still test it.

That is the right shape for a path nobody uses: a fallback with no promise on
the screen. It costs nothing to keep, it is the only way back in if the Worker
is down, and it does not spend a line of the Add screen advertising itself.

`S.settings.icsUrl` was written only by `fetchCalendar` and is now written
nowhere. It stays in `SETTINGS_PRIVATE` regardless: a store restored
from an older backup can still be carrying one, and a secret calendar address
is not a thing to start writing into an export file on the technicality that
nothing sets it any more.

---

## 44. Built: a week from the rota, confirmed from its banner, 5 September 2026

> *filled from the rota to Fri 12 Sep — 5 shifts, none confirmed yet.
> A screenshot of that week confirms them.* **[ Confirm all 5 ]**

Ray: *"opening each to save is silly."* It was.

### 44.1 The friction, and what it cost

`isProposed(s)` is `s.source === 'pattern'`, and the only thing that had ever
cleared it was line 2603 — `if(isProposed(s)) s.source = 'manual'` — on the way
*out of the edit dialog*. So a rota that filled a week wrote five proposals and
confirming them meant opening five dialogs and pressing Save five times, to
answer one question the banner above had already asked him.

That is not merely tedious, it is self-defeating: the app has a *second* banner
whose whole job is to complain that shifts in the last fortnight came from the
rota and were never confirmed. The friction in the first banner is what
produces the state the second one exists to report. A week goes unconfirmed
because saying so cost five dialogs, and then the app tells him off for it.

### 44.2 `confirmProposals`, and the two lines that are not obvious

```js
going.forEach(s => { s.source = 'manual'; });
restamp(s => ids.has(s.id));
```

The first line is the whole feature. The second is the part inherited from the
edit dialog's own reasoning, and it is easy to leave out:

`feedICS` marks a proposal's event *"(from the rota)"*. Confirming therefore
changes the `SUMMARY` of an event a phone may already be holding, and §22 is
blunt about what happens to a rewrite at an equal `SEQUENCE` — a calendar is
free to ignore it. `restamp()` bumps the sequence and clears `sent`, which is
what makes it a *newer* revision rather than a suggestion (§26.7). A shift that
was never sent has nothing to revise and `restamp` leaves it alone.

Times, records and pay are untouched. Confirming says the assumption was
right; it does not claim to know anything the rota did not.

### 44.3 The predicate, not the company

The button carries a `pred` built from the exact ids the sentence counted:

```js
const ids = new Set(proposed.map(s => s.id));
act: { label: `Confirm all ${proposed.length}`, pred: s => ids.has(s.id) }
```

Not "every proposal for this job". The two banners on one job select different
shifts — one looks ahead, one looks back fourteen days — and a button that
confirmed by company would have the forward banner silently confirming last
fortnight's as well. Confirming the set the sentence just described is the
only behaviour a person reading it can predict.

### 44.4 The second banner asks first

The past-fortnight note gets the same button and a `confirm()` in front of it.
The difference is not squeamishness about a click: the forward banner is about
a week still ahead, which the next screenshot corrects for free. The backward
one is about nights that have already been worked or not, where confirming is
a statement about money that has been earned — the hours stop being counted as
assumptions in `weekTotals`, and the pay screen stops hedging them.

### 44.5 Inline, and only where there is something to press

`.horizon .doit` is a bordered button in `currentColor` at `.78rem`, appended
after the sentence rather than given its own row. It inherits the banner's
colour, so it is quiet in the fed banner and carries the warning colour in the
other, with no rule of its own for either.

A full-width button under a note set this quietly would outweigh the note. And
a note with no `act` gets no button — most of them describe a state there is
nothing to press about, and the ones that do are the point of §44.

### 44.6 What is tested

In `browser.test.js`, because the button does not exist outside a loaded page —
`renderHorizon` builds it out of `S`, and a unit test could reach
`confirmProposals` and prove none of what matters. The bugs worth catching are
a banner that says four and confirms three, and one that confirms them and goes
on saying four.

So the test seeds two proposals and one already-manual shift, asserts the label
reads `Confirm all 2`, clicks it, and then asserts all three ways it could be
wrong: every source is `manual`, only the proposal that had been `sent` went up
a `SEQUENCE`, and the banner redrew without the button — which is the assertion
that the state the sentence described is actually gone.

### 44.7 The shell, for all three of these

`SHELL` goes to `v14` (§37's lesson, fourth time). §42, §43 and §44 are four
things Ray asked for and will go looking for on the phone, and a release
someone is waiting to see is the definition of one that has to arrive on the
next load rather than the one after. `RUNTIME` is untouched, as always — it
carries the OCR engine and the fonts, and bumping it costs a 10MB re-download
to deliver a reordered nav bar.

The one thing still owed is from §42 and is on the phone rather than in the
repo: shifts already marked `sent` keep the old role-first title until the
calendar is cleared and **Rebuild the whole calendar** is run from Setup
(§42.4). Nothing in §43 or §44 needs anything done to it by hand.
## 45. Built: a read-only second phone, 5 September 2026

Ray asked whether there could be a read-only version on a second phone, with
just the shifts and pay tabs and no add or settings, so that he can see his
husband's schedule too.

Yes, and the whole of it was already in the database. The question that
followed — whether it meant sending anything to D1 that was not already going
there — has a clean answer: nothing. The `shifts` table holds all three
sources; the cron writes `source='feed'` and `/push` writes the phone's
`manual` and `pattern` rows. Every figure the pay tab needs is on the company
object — the rate, `otMult`, `otAfterHrs`, the break rule, `weekStart` — and
`cfg.companies` has gone up with every push since §14.3. `renderPay` reads
nothing from `S.settings` at all. So this section adds no write, no column and
no field. What it adds is a read path, a second credential and a second page.

### 45.1 Why a page and not a flag

The obvious build is a query parameter: `?view=1`, hide the Add and Setup tabs,
done in an afternoon. It is worth naming why that is the wrong answer, because
it looks like the cheaper one.

A phone holding the push token and a `curl` are the same thing to a Worker.
A viewer built as a flag on `app.js` is a phone that holds `PUSH_TOKEN` — the
credential that can rewrite the whole store and, through `/reset`, delete it —
and that is stopped from using it by a CSS rule. The tabs are hidden; the code
that pushes is still loaded, still bound to `save`, and still one bug or one
long-press away from running. What is being asked for is not a screen with
fewer buttons, it is a phone that *cannot* change his schedule, and that is a
property of the server or it is not a property at all.

So: `VIEW_TOKEN`, a second dashboard secret, which opens exactly one route.

    GET /read      →  viewOK   →  the cfg row and every shift
    POST /push     →  PUSH_TOKEN only
    POST /reset    →  PUSH_TOKEN only
    POST /migrate  →  PUSH_TOKEN only
    GET /status    →  PUSH_TOKEN only
    GET /trace     →  PUSH_TOKEN only

`viewOK` accepts the push token as well, because it is strictly the more
privileged of the two and there is no reason this route should keep the app's
own phone out. An unset `VIEW_TOKEN` opens nothing: `tokenOK` refuses an empty
expected secret, so the deploy between adding the secret and it taking effect
(§14.9) fails closed, which is the failure that is safe.

It lives in `guards.js`, next to `tokenOK`, for that file's stated reason — a
rule about who gets in should be callable by a test that has no database and no
network. It was written in `index.js` first and moved, which was the right
second thought: `index.js` cannot be required by a test at all, because it
imports `schema.sql`, and a guard that can only be asserted by reading its own
source as text is a guard nothing has ever run. `guards.test.js` now runs it —
the near misses, the trailing space, the wrong case, and every shape of unset.

`config.test.js` asserts the wiring, which is the half a unit test cannot see:
that exactly one route accepts the view token, that it is a GET, that `/push`,
`/reset` and `/migrate` do not mention `viewOK` at all, and that `/read` reads
neither `raw` nor `polls` — the employer's calendar text and the cron's log are
not his week and have no business on a second phone.

### 45.2 Why `/read` rather than `/shifts`

`/shifts` exists and answers with `WHERE source = 'feed'`. That filter is
right for the app: the phone asking already holds the manual and pattern rows,
because it wrote them, and handing them back would be handing it its own
homework. A second phone holds nothing, so the whole table is the answer here.

`cfg` comes back in the same response rather than behind a second call, because
the two halves are one answer. A shift's colour, its site, its role and what
its hours are worth all live in `cfg`; a viewer with the shifts and not the
companies would draw an unnamed grey week and a pay tab of dashes. It is
already the narrowed row `safeSettings` wrote in §14.3 — the push token and the
employer's secret calendar address were never in it — so there was nothing
further to strip.

### 45.3 The stylesheet moved out

`index.html` carried its styles inline. Two pages drawing the same week from
one stylesheet is correct; two pages drawing the same week from two copies of
one stylesheet is a schedule that looks slightly different on the two phones
within a month, and on a schedule a difference in how something is drawn reads
as a difference in the shifts.

So the whole `<style>` block became `app.css`, unchanged, and both pages link
it. `SHELL` goes to `v15`: a phone holding an older shell has an `index.html`
that still carries its styles inline and a file list that has never heard of
`app.css`. It would work — it is the old page, whole — and it would go on
working for as long as the cache stood, which is §41's lesson for the fourth
time.

`v15` rather than a second `v14`, and that distinction is the merge with
§42–§44 rather than a detail. This branch and that one both bumped to `v14`
independently; had both shipped under the one name, a phone that took §43's
`v14` would already hold a shell it considered current, would never re-fetch,
and would never learn that `app.css` exists — the deploy would reach every
phone except the one that had been keeping up. A cache name is a claim that
what is behind it is what is being served, and two different sets of files
cannot both make it.

### 45.4 Two service workers on one origin

The viewer needs its own offline shell, and that is the fiddly part.

A worker may only claim a scope at or below its own directory. The page is
served at `/view` — Cloudflare's `html_handling` drops the extension, and
`/view.html` redirects there, so `/view` is the URL that does not redirect and
therefore the only sound `start_url` (§41). But `/view` is not below `/view/`,
so a worker at `/view/sw.js` could not control the page it exists for. It goes
at the root instead, as `/view-sw.js`, and registers with `scope: '/view'`:
from the root it may claim any scope, and the more specific registration wins
for these pages. The app keeps `/`, the viewer takes `/view*`, and both can be
installed on one phone without either quietly answering the other's fetches.

Cache names are the second half of that. `activate` deletes every cache it does
not recognise, so two workers sharing a naming scheme would each delete the
other's shell on every activation — two apps that refetch themselves from the
network on every launch, which is the opposite of the point. The viewer's shell
is `shiftdeck-view-shell-v1` and its `activate` only ever considers keys
starting `shiftdeck-view-`.

`fromShell` looks in its own cache rather than calling `caches.match`, which
searches every cache on the origin: the shared modules are the same files
today, they are one deploy away from not being, and a viewer running `app.css`
out of a shell the app cached last month is a bug with no symptom anyone could
report.

`/read` is never cached. `view.js` keeps the last answer in IndexedDB and draws
from it, which is a cache that knows how old it is and says so on the screen; a
second copy in the Cache API would be an older answer with nothing to say it
was one, handed back to a `fetch` that believes it reached the server.

### 45.5 Its own IndexedDB, and what that is worth later

`shiftdeck-view`, not `shiftdeck`. The viewer is served from the app's origin,
so a shared database name would be two writers over one `'state'` key — the
app's whole store overwritten by a cache of the server's answer. That is only
possible on one device, and it is the device this was tested on.

Ray asked whether the viewer would create an IndexedDB that web push could use
later. It does, and it is the right substrate for it — a service worker cannot
read `localStorage` but can read IndexedDB, so a `push` handler could open this
store and build the notification body out of the shifts it already holds. Worth
being exact about what that would still need, because the database is not the
missing piece: `view-sw.js` has `install`, `activate` and `fetch` and no `push`
listener, there are no VAPID keys, nothing calls `pushManager.subscribe`, and
each device's subscription endpoint would have to be stored server-side for the
Worker to send to it. That last one is a new D1 table, which makes push the
first thing in this project that genuinely does add data the database is not
already carrying. Per-device endpoints are an upside rather than a cost: two
phones would be separately addressable, so a shift change could go to both and
a "you are on in two hours" to only one.

### 45.6 The as-of line

The one thing this screen has that the app does not need, and the reason it
needs it is the reason the whole project exists.

On the app, an empty week is a week he has not imported, and three separate
things say so — the horizon note, the stale-export warning, the poll log in
Setup. None of those belong here: every one of them is a job to do, and there
is nothing to do from this phone. What is left is the single failure a
read-only screen can have. It shows a week; Saturday is empty; and the reason
is not that he is off, it is that this phone last reached the Worker on
Tuesday. Nothing else on the page can tell those apart.

So there is one line under each heading — *As of four minutes ago* — and it
changes colour rather than wording, because it has to work without being read.
An hour is amber and twelve hours is red, and at twelve hours it stops being a
timestamp and says what it means: *this may not be his week any more*. The
thresholds come off the cron, which polls every fifteen minutes, and off
`autoPush`, which sends within seconds of an edit; an hour behind is already
unusual.

It refreshes on launch, on `visibilitychange`, and on a button. No timer: a
phone in a pocket polling a Worker every minute is a battery cost for an answer
nobody is reading.

### 45.7 What is shared, and the test that keeps it shared

`view.html` loads the same eight scripts `index.html` does, minus `app.js`.
Every one of them is pure — dates, ICS, the site and role tables, the pay
arithmetic — and loading them rather than reimplementing them is what makes a
week here foot to the week there. What is not shared is `app.js` itself, which
is five thousand lines of editing, importing and exporting on a page with
nothing to edit.

The pay tab is `renderPay` and `payDetail` with `S` changed to `V`. That is a
copy, and a copy of an arithmetic is exactly what §27 moved into `pay.js` to
prevent — so the test that matters puts one mixed-rate week with overtime in it
through *both pages* in a real browser and compares the hours, the overtime,
the average rate and the gross. A figure on Ray's phone that disagreed with the
figure on his by a cent would be worse than no pay tab at all, because the
disagreement is the half that would get believed.

The other browser test is §31's, on the new page: seven scripts share one
global scope here too, `view.js` adds about forty names to it, and the last
time two files declared the same identifier every title in the exported
calendar came out `[object Object]` for four sections. It asserts the page
loads with no uncaught errors, that `weekPay`, `whereText`, `durMins`,
`clashPairs` and `restGaps` all resolved, that `S` is *not* defined, that the
nav has exactly two buttons, and that neither tab contains a single `<input>`.

### 45.8 Handing the token over

The token is minted in the Cloudflare dashboard and has to reach a phone that
is not the one it was minted on. So it travels as a link: `/view#t=THETOKEN`,
which the page reads once and takes straight back out of the address bar. An
installed PWA launches at `start_url` and drops the hash anyway, which is why
it is written to IndexedDB the moment it is read. There is a paste field too,
for a token sent as text.

`app.js` was left alone. A helper on the Setup screen that built the link would
be a convenience, and it would put the view token on the husband's phone, which
has no use for it. Four secrets already live in one dashboard panel; this is
the fourth.

### 45.9 What was left out

- **The launcher buttons.** They open TrackTik and Homebase by Android package
  name. Those apps are not on the second phone, and would not be his account
  if they were.
- **The horizon and stale-calendar notes.** Jobs to do, on a phone with nothing
  to do.
- **Editing anything at all.** A shift opens the read-only panel `showFeedShift`
  gives a feed row on the app — there, because a feed row is the employer's;
  here, because every row is somebody else's.

## 46. Built: a third phone, for the kids, 5 September 2026

Ray asked for the viewer again, for the children this time, with two things
taken out and one thing put in. They must not see what any of it pays, they
must not see the whole schedule — a rolling seven days from today is enough —
and the top of the screen should not be a schedule at all. It should be one
sentence: *Daddy leaves for work in 6 hours*, or *Daddy home from work in 4
hours*, worked out from the shift's own times with a fixed padding at each end.

He asked whether that was a whole other view. It is, and it is a whole other
credential and a whole other route, which is the more important half of the
answer and the reason this is a section rather than a commit.

### 46.1 Why not the viewer with the Pay tab deleted

That build takes an hour: copy `view.html`, drop the Pay tab and the nav, slice
the week list to seven days, add the banner. It would be wrong in exactly the
way §45.1 was about to be wrong before it was written down, and the argument
has not changed since — only what it is protecting.

`VIEW_TOKEN` opens `/read`. `/read` answers with every shift on file and with
`cfg.companies`, and a company object carries `rate`, `otMult`, `otAfterHrs`,
the break rule and `weekStart`. So a kids' page built on the view token is a
phone that has been *sent* his pay and every shift he has ever worked, and is
declining to draw them. The children will not go looking. A child's phone
spends afternoons in other people's houses, and what is one line in an address
bar away from anyone holding it is not "a screen without a Pay tab", it is what
he earns.

So the narrowing is on the server, as it was in §45, and it goes one step
further down:

    GET /read      →  viewOK   →  the cfg row and every shift
    GET /soon      →  kidsOK   →  seven days of times, four fields a shift
    POST /push     →  PUSH_TOKEN only
    …

`kidsOK` accepts `VIEW_TOKEN` and `PUSH_TOKEN` as well, by §45's own argument
about `viewOK`: both already read everything `/soon` returns and a great deal
more, and refusing them a slice of what they can have whole would be a rule
with nothing behind it. `KIDS_TOKEN` on its own opens `/soon` and nothing else
— not `/read`, which is asserted in `config.test.js` by name rather than by
count.

What `/soon` sends is built field by field in `soonOnly`, in `guards.js`, next
to the other rules a test can run without a database:

    { date, start, end, job, color }

A whitelist by construction, for `safeSettings`' reason one table over: a field
added to a shift later — a note, a pay code, a rate cached onto the row — is
withheld by default rather than leaked by default. There is no `rate` on the
kids' phone to hide, and `pay.js` is not loaded on it at all. That is the
difference between a page that does not show something and a page that does not
have it.

### 46.2 The page is about a door, not about a shift

The employer's times are when he clocks on and off. They are not the times the
question is about. "When is Daddy home" is a question about the front door, and
between the two there is a drive at each end — so the page adds them, and says
the padded times everywhere rather than the shift's own:

    LEAVE_PAD = 45   // minutes before the shift starts, he is out of the door
    HOME_PAD  = 30   // minutes after it ends, he is back through it

Hard-coded, as asked, and named once each at the top of `kids.js` rather than
spelled into the sentences, so that changing them is one edit. Anything
cleverer — a per-job commute, a field on the site table — is another thing to
get wrong on a screen whose entire value is being right to within a few
minutes.

That framing is also why the banner has the states it has. It never says "his
shift starts in ten minutes", because from this side of the front door the
shift is not an event. There are two events, and they are the door opening
outward and the door opening inward:

- he is here, and the countdown runs to him leaving;
- he has gone — which begins forty-five minutes *before* the shift does — and
  the countdown runs to him coming back;
- there is nothing in the week, and it says so.

The middle state is the one a page counting to the employer's times would get
wrong, and it would get it wrong for three quarters of an hour, twice a day,
while a child watched a countdown to a shift that had already started tell them
their father was still in the house.

Two smaller cases, both in the browser test because neither can be reached from
node — `kids.js` is a page script in a page with no modules:

- **Overnight.** 19:00 to 07:00 is home at 07:30 the *following* morning.
  Adding thirty minutes to 07:00 on the shift's own date says he is home
  twelve hours before he is. The week list labels that row *next morning*.
- **A double.** Two shifts in one day file as two rows, and the gap between
  them can be shorter than the two paddings put together — in which case he
  never came home, and the banner must not say he did. So "is he out" is asked
  of every shift in the week rather than of the next one.

### 46.3 How long it says

Precise under three hours, rounded above it. "In 2 hours 15 min" is the range
where the difference between that and two and a half hours is the difference
between going out to play and not; "in about nine hours" is the true answer to
a question asked at bedtime, and "in 8 hours and 47 minutes" is a false
precision about a man who still has to drive home.

### 46.4 Whose today the week starts on

The window is `[today, today + 6]` and it is closed twice: once in SQL, so the
rest of the schedule is never read out of D1 at all — `date` is a column and
§14.3 put an index on it — and once in `soonOnly`, which is the half a test
without a database can run. Neither is redundant. The SQL is what keeps the
rest of his year out of the Worker's memory; the pure function is what anything
can check.

`today` is his, not the Worker's. A Worker runs on UTC, and a child opening
this after seven in the evening in Chicago is already inside the Worker's
tomorrow: a window computed on UTC would drop this evening's shift off the
front of the list and show a day at the far end that has not arrived. So it
goes through `zoneFor` and `todayIn`, exactly as the cron's own window does
(§35, §37) — the job's zone if it has one, the deploy-time `ZONE` if not.

### 46.5 What it does not load

`kids.html` loads `app.css` and `kids.js`, and that is the whole list. Not
`app.js`, not `view.js`, and not `parser.js`, `ics.js`, `patterns.js`,
`holidays.js`, `sites.js`, `merge.js`, `feed.js` or — the one that matters —
`pay.js`.

That is a departure from §45, which shares everything precisely so that a week
drawn on the viewer is the week drawn on the app. The reason it does not apply
here is that this page draws none of the same things. There is no week list, no
pay table, no warning band, no dialog; there is a sentence and seven rows. The
four lines of date arithmetic it needs are four lines. Importing a hundred
kilobytes of OCR and calendar-writing to get them, onto a phone that shows a
countdown, would be paying the sharing cost with none of the sharing benefit.

The palette is still shared, for §45.3's reason: three pages drawing from three
copies of one stylesheet is three schedules that look slightly different inside
a month.

### 46.6 A third worker, a third scope

`sw.js` holds `/`, `view-sw.js` holds `/view`, `kids-sw.js` holds `/kids`. Each
sits at the root because a script may only claim a scope at or below its own
directory, each deletes only caches whose names begin with its own prefix, and
each has its own IndexedDB — `shiftdeck`, `shiftdeck-view`, `shiftdeck-kids`.
`config.test.js` asserts all three names are distinct in one place, because the
failure is silent: two workers sharing a cache prefix delete each other's
shells on every activation, and the symptom is two apps that reinstall
themselves from the network on every launch.

`/soon` is never cached by the worker, for §45's reason one page along:
`kids.js` keeps the last answer in IndexedDB, which is a cache that knows how
old it is and has a line on the screen for saying so. A second copy in the
Cache API would be handed back to a `fetch` that believes it reached the
server, and being confidently out of date is the only failure this page can
have.

### 46.7 The quiet line

§45's as-of line, with the middle state dropped. The viewer distinguishes fresh
from stale from cold because the person holding it can go and do something
about stale. A child cannot, so there are two states: nothing, and — past
twelve hours, off the same cron — *this has not heard from the schedule in a
while, so it may be wrong. Ask a grown-up.*

It is there for the same reason it is on the viewer. With no way to add a
shift, an empty week and a fetch that failed on Tuesday look identical on the
screen, and the second one is the failure this project exists to prevent.

### 46.8 Handing the code over

`/kids#t=THECODE`, read once and taken straight back out of the address bar,
which is §45.8 unchanged. It matters slightly more here: this is the phone that
gets handed around a back seat, and the hash is the half of a link that
survives being screenshotted. There is a paste field behind it for a code sent
as text, labelled "Code" rather than "View token", because of who is reading it.

`KIDS_TOKEN` is the fifth secret in the one dashboard panel. `app.js` was left
alone again — a helper that built the link would put the kids' code on the
phone with the fewest uses for it.

### 46.9 Its own icon

The app and the viewer share `icon-192.png`. On a phone holding both, the only
thing telling them apart is the word under an identical picture, which is not
how a home screen is read — and a third identical square would have made that
worse rather than left it alone.

So `/kids` has its own drawing: a calendar with work days and home days on it,
a clock and a briefcase. Ray supplied it. It ships as three files rather than
two, which is a correction to what the other two manifests do:

    kids-192.png            any        the artwork, full bleed
    kids-512.png            any        the same, larger
    kids-maskable-512.png   maskable   the artwork inset into the middle 80%

`purpose: "any maskable"` on one file — which is what `manifest.webmanifest`
and `view.webmanifest` both say — is a claim that one picture is correct under
two different treatments, and it is not. Android crops a maskable icon to the
circle inscribed in its square, so a full-bleed drawing loses its corners and,
here, the clock's rays; a pre-inset drawing used as `any` sits in a box of
margin next to icons that do not. Two files, one for each, and neither is
guessed at.

The artwork arrived as an opaque RGB square with a black stroke and black
corners outside its own rounded frame — no alpha to hide them. Both come off in
the resize, which is in `scratchpad/icons.js` rather than in the repo: there is
no build step here and there is not going to be one for three PNGs. Chromium
did the resampling, because this machine has no ImageMagick and no PIL and does
have a browser.

`config.test.js` asserts the icons are not the app's, that every file named in
the manifest exists, and that no entry claims both purposes at once. The first
of those is the one that matters: pointing this back at `icon-192.png` would
look like a tidy-up.

### 46.10 What was left out

- **The pay tab.** The ask, and the reason for `/soon`.
- **Everything before today, and everything after next Saturday.** Also the
  ask. A child looking at a month of a parent's shifts is a different thing
  from a child looking at the week, and only one of them was wanted.
- **The site, the address, the role, and which of the two apps a shift came
  from.** None of it answers the question the page is for, and all of it would
  have had to be sent to be hidden.
- **A tap target of any kind.** There is no shift panel here. A row is not a
  door to anything; it is the answer.

## 47. Changed: an icon each, 5 September 2026

Ray drew three: a calendar with a badge for the app, a calendar with a wallet
for the viewer, and a calendar with a briefcase for the kids' phone (§46.9).
They replace `icon-192.png` and `icon-512.png`, which the app and the viewer
had been sharing since the viewer was built.

Sharing them was not a decision, it was §45 not making one — the viewer was
copied from the app and the icon line came with it. What it cost is small and
constant: on a phone holding both, the only thing distinguishing two identical
squares is the word underneath, and a home screen is scanned by picture. §46
would have made it three.

### 47.1 Two files a purpose, not one file claiming both

All three manifests said `purpose: "any maskable"` on both icons. That is a
claim that one picture is correct under two different treatments, and it is
not one:

- **`maskable`** is cropped by the platform to the circle inscribed in its
  square. A full-bleed drawing loses its corners — on the kids' one, the
  clock's rays; on the app's, the top of the calendar's rings.
- **`any`** is drawn as given. A picture pre-inset for the mask sits in a box
  of margin beside icons that are not.

So each app ships three files: the artwork full bleed at 192 and 512 as `any`,
and the artwork inset into the middle 80% on the app's paper as `maskable`.
Whichever half is wrong under one file is wrong silently, which is why
`config.test.js` now asserts it: every file a manifest names exists, no file is
named by two manifests, no `purpose` has a space in it, both purposes are
present, and each page's `apple-touch-icon` — which is what iOS reads instead
of the manifest — names one of them.

### 47.2 What the artwork needed doing to it

All three arrived as opaque RGB: no alpha, a dark stroke around a rounded
frame, and the four corners outside that frame filled solid. Left alone that is
four dark triangles on a home screen. The resize scales each image a little
past its box and clips the box with a 15% radius, so the outermost few per cent
— which is all stroke — falls outside it and the corners go with it.

Chromium did the resampling. This machine has no ImageMagick and no PIL and
does have a browser, and a browser is a perfectly good resampler. The script is
in the scratchpad rather than the repo: nine PNGs do not earn a build step in a
project whose whole shape is that what is in the root is what gets served.

### 47.3 Getting it onto a phone that is already installed

The manifests are in both shell caches, and a phone holding an old shell keeps
the old manifest and the old icon with it. So `SHELL` goes to `v16` in `sw.js`
and `v2` in `view-sw.js` — §41's rule, which is that `install` only re-runs
under a cache name it has not seen, and a fix that ships without a bump is a
fix nothing fetches.

That gets the *file* to the phone. Whether Android redraws the launcher icon
for an already-installed PWA is the platform's business and not this repo's; if
it does not, removing it from the home screen and adding it again is the
answer. Both are cosmetic, and neither touches the schedule.
