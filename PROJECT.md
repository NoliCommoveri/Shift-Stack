# Shift Deck — project state

_Last updated 3 September 2026_

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

**Two layout profiles are handled**, both derived from real OCR output rather
than guessed:

_TrackTik_ — a bare month name as a section header, then the weekday and time
range on one line with the day number on the line below:

```
February
WED 9:00am - 11:00am
(03) Mobile Guard | De la Montagne
```

_Homebase_ — a full written date header, then start and end times on separate
lines with the role alongside:

```
Sunday, July 27, 2025
9:00 am
5:00 pm Cook
```

The parser tracks month and year as state, pairs times either as a range on one
line or across two consecutive lines, and pulls the day number from the
following line. Day numbers that drop sharply (30, 31, 01) advance the month.

**The weekday is used as a free integrity check.** Where OCR read a usable
weekday abbreviation, the parser compares it against the weekday of the date it
constructed. This is what confirmed the February screenshot was 2027 rather
than 2026 — Feb 3 2027 is a Wednesday, Feb 3 2026 was not.

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

**The Homebase parser is under-tested.** It was validated against text
reconstructed from a help-page screenshot, not a real screenshot of his own
schedule. Line ordering from a real capture may differ. One real screenshot
would settle it.

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
