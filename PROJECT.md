# Shift Deck — project state

_Last updated 3 September 2026_ — real screenshots of both apps landed; see §3.1 and §5.
Build order for the agreed-but-unbuilt work is in §11.

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

**Whether Homebase exposes its calendar feed on his account.** If it does,
Homebase needs no OCR at all — subscribe to it directly and only TrackTik needs
screenshots. Never confirmed.

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
3. **Does Homebase expose its calendar feed on his account?** If so, Homebase
   needs no OCR at all and only TrackTik needs screenshots. Never confirmed.
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
