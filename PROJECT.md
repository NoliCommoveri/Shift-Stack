# Shift Deck — project state

_Last updated 3 September 2026_ — real screenshots of both apps landed (§3.1, §5),
Homebase's own Calendar Sync turned out to exist and is now an import path (§12),
and the app became the normalising step between two calendars rather than a
second source of the same events (§13). Build order for the agreed-but-unbuilt
work is in §11.

A record of what has been built, why the design went the way it did, and what
is still undecided.

---

## 1. The problem

Ray's husband works two jobs whose schedules live in two separate employer
apps. Neither talks to the other, and there is no single place to see the week.

- **TrackTik SHIFT** (`com.tracktik.shift`) — security guard scheduling.
  Sites seen so far include De la Montagne. Referred to on the home screen
  calendar as DSI.
- **Homebase** (`com.joinhomebase.homebase`) — hospitality scheduling.
  Role-based, e.g. Cook. Referred to as Trupoint.

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
**Still worth one ask to his scheduler**, since it would unlock a far better
pipeline than screenshots.

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
  today highlighted. Flags tight turnarounds and overlaps between the two jobs
  on the same day. Tap any shift to edit or delete.
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
- The gap warning gets better for free — back-to-back shifts at *different
  addresses* is a different warning from two at the same one.

**Blocked on a real TrackTik screenshot.** The site/role split assumes the real
line contains the `|` separator. If it does not, that split is fiction. Build
the table and the schema now; wire the parser-side split once the real format is
known.

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
| No patterns declared | Duration and overlap checks still apply — they need no config |

**History still helps, as a suggestion.** A "build from what's on file" button
lists distinct start/end pairs already in `S.shifts` with counts, and he ticks
the real ones. He skips the typing; the app gets a list a human filtered. The
human is what stops bad data becoming authority.

### 8.3 Generating the fixed job's weeks

One job is PRN and moves constantly. The other is fixed for days and times, with
only the location changing — so most weeks it needs no screenshot at all.

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

1. **Do the parsers work at all on his real screens?** Everything in §8 assumes
   usable rows come out. Screenshots are being collected; the capture list is in
   `tests/fixtures/README.md`. This gates §8.1's site/role split.
2. **The TrackTik distribution email.** Still one message to his scheduler. If
   it lands, email parsing beats screenshots on every axis and much of §8.4
   becomes unnecessary. Worth asking before investing further in OCR.
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
5. **Staleness should be loud, and is not.** The only signal is `#unsent`
   buried in Setup. Two cheap, transport-independent additions, worth doing
   whatever happens with (4):
   - "Last exported N days ago, 4 shifts changed since" on the **Schedule** tab.
     If the `.ics` is stale the calendar is lying, and Schedule is where he looks.
   - **"Nothing on file after Friday."** If the last shift held is within ~3
     days, the schedule is probably unimported rather than empty — and an empty
     calendar reads as a day off, which is the exact silent failure this project
     exists to prevent.
6. **Manual-import mode orphans deleted shifts.** No `METHOD:CANCEL` is emitted,
   so a deleted shift keeps its calendar event and its alarms forever.
   Subscription mode is immune.
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
| 0 | The two emails (§10.2, §10.3) | No code; may delete work below |
| 1 | Real Tesseract pass, fixtures from it, OCR tuning (§10.1, §10.7) | Gates §8.2's design |
| 2 | Staleness warnings, `METHOD:CANCEL`, byte-based `fold()` (§10.5–§10.7) | No schema, ships value immediately |
| 3 | **§8.1 site table** — schema, aliases, merge, `LOCATION:`, title convention, the parser split from §11.1 | Everything after assumes `siteId` |
| 4 | **§8.2** patterns and am/pm plausibility | Needs step 1's evidence; independent of sites |
| 5 | **§8.3** week generation | Small once patterns exist |
| 6 | **§8.4** change detection | Needs stable site identity to tell "same shift, different place" |

Steps 3 and 6 are the heavy ones. Step 5 is an evening.

**What §12 and §13 did to this table, later the same day.** The roadmap above
was written before Homebase's Calendar Sync was found, and four rows moved:

- **Step 0 is half done.** §10.3 is answered — Homebase syncs to Google, and
  §12 imports from it. The TrackTik email in §10.2 is still one message worth
  sending, and it is now the whole of step 0.
- **Step 1 got more important, not less.** With Homebase on a feed, the OCR
  path carries TrackTik alone — the dark screen, which is exactly where the
  am/pm risk in §6 lives. A real Tesseract pass is now the only unproven part
  of the input side rather than one of two.
- **Step 2's `fold()` is done**, forced by §13 emitting real addresses. The
  §10.5 staleness warnings and §10.6's `METHOD:CANCEL` are still open, and
  §13 sharpened the first of them: if Calendar Sync publishes only two months
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
them in one place in one language. What goes out is `DSI- Security Officer -
Headquarters`, from the job name in Setup, whichever way the shift arrived.

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
TrackTik ──screenshots──▶ phone ──POST──▶  KV  ◀────────────────────┘
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

### 14.3 Storage, and the reason it is split

KV has no transactions and no compare-and-set. One key with two writers loses
writes, and here there genuinely are two: the phone pushing TrackTik shifts and
the cron applying Homebase's. So the store is split by provenance, and **no key
has more than one writer**:

| Key | Written by | Holds |
|---|---|---|
| `cfg` | phone | companies, settings, alarm lead times |
| `shifts/manual` | phone | every OCR and hand-entered shift |
| `shifts/feed/<jobId>` | cron | that job's calendar-sourced shifts |
| `raw/<jobId>` | cron | last known-good `.ics`, for diffing and for looking at when something is wrong |
| `polls` | cron | ring buffer, last 50 poll records (§14.8) |

The feed served to ICSx⁵ is built at read time from the union. Nothing merges
the two stores into a third, because a third would need a writer and we are out
of writers.

This also answers a question §4 never had to: the phone stops being the source
of truth. It owns its half, the Worker owns the other, and neither is complete
alone. That is the real cost of automatic import, and it is larger than §4's
stated privacy cost — the shift data is not merely *copied* to Cloudflare, part
of it now *lives* there.

### 14.4 Endpoints

Three, all on one Worker.

**`POST /push`** — the phone sends `cfg` and `shifts/manual`. Bearer token in
`Authorization`, compared against the `PUSH_TOKEN` secret. Rejects anything
that is not the expected shape rather than storing it, because a half-written
`cfg` breaks the cron on its next tick and the phone would not hear about it.

This one is cross-origin and the Worker has to say so. The app is served from
`nolicommoveri.github.io` and there is no reason to move it — §4 rejected Pages
for hosting the *feed*, where a world-readable schedule was the objection, and
the app itself carries no data at all. So the page lives on Pages, the Worker
lives on Cloudflare, and every request between them is cross-origin. The Worker
answers the `OPTIONS` preflight and returns `Access-Control-Allow-Origin` for
the Pages origin exactly — not `*`, which would let any page that learned the
push token write to the store — along with `Allow-Headers: Authorization,
Content-Type`. `GET /feed` needs none of this: ICSx⁵ is not a browser and does
not ask.

The irony is worth recording. The same rule that makes the import impossible
from the page is the one the export has to satisfy to leave it, and both are
the browser's, not Google's.

**`GET /feed/<FEED_TOKEN>.ics`** — what ICSx⁵ subscribes to. Rebuilt whole on
every request from the union of the stores, so a removal reaches the phone by
itself and duplicates stay structurally impossible. `text/calendar; charset=utf-8`.

A different token from `PUSH_TOKEN`, and it must be: the feed token travels in
a URL that sits in ICSx⁵'s settings and in request logs, while the push token
is what authorises writes. One leaking should not cost the other.

If ICSx⁵'s "requires authentication" option is real — I could not confirm it
from a primary source, and it is a ten-second look on the phone — the feed
should take Basic auth as well, and the unguessable path becomes the second
lock rather than the only one. Nothing else subscribes, so there is no Google
fetcher to keep unauthenticated for.

**`GET /status`** — the poll ring buffer and the current counts, for the app's
Setup screen. Same token as the feed.

### 14.5 The cron

`*/15 * * * *`. For each job with an `icsUrl` configured:

1. fetch the secret `.ics` address
2. `parseICS(text, { from: today − 7d, match: co.icsMatch, zone })`
3. match each row against `shifts/feed/<jobId>` on `extUid`, exactly as
   `calendarRows` does today: same UID and same times means unchanged, same UID
   and different times means replace in place keeping the shift's `id`, no UID
   on file means add
4. `report.cancelledRows` name shifts to remove
5. run the guards in §14.6; if any refuses, write nothing and record why
6. write `shifts/feed/<jobId>` and `raw/<jobId>`, append a poll record

Free plan fits: 3 cron triggers per Worker against the one needed, 96 polls a
day against 1,000 KV writes, and writes only happen when something changed. The
number to actually measure is CPU — 10 ms per invocation on the free plan, and
a few dozen events of regex line-parsing should sit well inside it, but "should"
is doing work in that sentence. If it does not fit, the paid plan is $5 a month
and the alternative is not building this.

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
Setup grows the Worker URL, the tokens, and the status panel from `/status`;
the manual `.ics` download stays as the fallback for when the Worker is
unreachable.

Both new modules get tests before the Worker is written, because they are the
part where a bug is silent.

Pass two, not required for the calendar to work: the phone reading
`shifts/feed/*` back down so its own hours and pay views count the Homebase
shifts it no longer holds. Until that lands the calendar is right and the pay
screen is short — worth saying out loud on the screen rather than letting the
numbers just be wrong.

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

Six of these are one-time and none of them are in the code. Three need a
computer; the rest are on the phone.

**Not on the list: moving the app.** It stays on GitHub Pages where it already
runs. Only the Worker is new, and it is the only thing that needs a Cloudflare
account.

**On a computer, before deploying:**

1. **Google Calendar → create a calendar named `Homebase Raw`.** Staging, per
   §13 — machine-readable, never rendered.
2. **Homebase → Settings → Calendar Sync → point the Calendar field at
   `Homebase Raw`**, not at the account's main calendar. **Look at what that
   field offers.** If it will only take an account and not a named calendar,
   the staging split is off the table and `co.icsMatch` becomes load-bearing —
   a word on every shift and nothing else, set per job in Setup. This is the
   one setup step that changes what gets built, so it wants checking before the
   Worker is written, not after.
3. **Google Calendar → `Homebase Raw` → Settings → Integrate calendar → Secret
   address in iCal format.** Copy it. That string is the whole import.
4. **Cloudflare** — a KV namespace, and `wrangler secret put` for `PUSH_TOKEN`,
   `FEED_TOKEN` and the secret iCal address. The address is a credential: it
   grants read of the calendar to anyone holding it, so it belongs in a secret
   and not in `wrangler.toml`.

**On the phone, after deploying:**

5. **ICSx⁵ → subscribe to `https://<worker>/feed/<FEED_TOKEN>.ics`**, sync
   interval 15 minutes.
6. **Google Calendar app → tick the new calendar visible** in its calendar
   list. It does not appear on its own, and this is the most common "it isn't
   working" that is not a fault.
7. **Settings → Battery → Background usage limits → Never sleeping apps → add
   ICSx⁵**, and stay off Maximum power saving, which disables sync adapters and
   does not re-enable them on the way out. Without this the 15-minute interval
   quietly becomes "whenever he next opens ICSx⁵", which is precisely the
   silent staleness §4 refused to accept.

**Then, once:** open the app, paste the Worker URL and the push token into
Setup, export once to seed the feed, and confirm a shift appears in the Google
Calendar app within half an hour.

### 14.10 Still open

- **ICSx⁵'s authentication support** is unconfirmed (§14.4). Ten seconds on the
  phone decides whether the feed gets a second lock.
- **Worker CPU on the free plan** against a real Google export (§14.5). The
  first poll answers it.
- **Where `zone` comes from.** `parseICS` takes one and the tests pin it; the
  Worker has no locale and must be told. Simplest is a per-job setting
  defaulting to `America/Toronto`, but it should be explicit, not inferred from
  a runtime that has no business having an opinion.
- **The pay screen is short until pass two** (§14.7), and it should say so.
- **Nothing here helps TrackTik**, which stays on screenshots until §5's email
  gets sent.
