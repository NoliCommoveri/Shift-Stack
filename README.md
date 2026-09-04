# Shift Deck

Aggregates shift schedules from two employer apps into one view, with hours
and gross pay estimates, and feeds the phone's calendar so the home screen
widget and alarms do the reminding. Shifts come in from screenshots, or from
an employer's own calendar sync where it has one.

Everything stays on the device. Nothing is uploaded anywhere.

## Deploying

1. Create a repo and drop these files in the root.
2. Settings → Pages → Source: `main`, folder `/ (root)`.
3. Open the published URL on the phone in Chrome.
4. Menu → **Add to Home screen**. Install it properly rather than bookmarking —
   that is what lets it work offline and keeps its storage.

Pay rates and site names are entered in the app, not stored in the repo.

## First run

1. **Setup** → add both jobs. Set the colour, hourly rate, and which day the
   pay week starts. The Android package names for the launch buttons are
   `com.tracktik.shift` and `com.joinhomebase.homebase`.
2. **Add** → pick the job, then either drop in screenshots or add a calendar
   file. Check the rows, add them.
3. **Setup** → Save new shifts → open the file on the phone → import into the
   shift calendar.

The first import downloads the OCR engine, about 10 MB. After that it is cached
and works offline.

## Feeding the phone's calendar

This is the way out, not the way in. Two modes, set in Setup.

**Subscription (recommended).** Install ICSx⁵ from the Play Store or F-Droid.
Save the feed file, then in ICSx⁵ add a subscription pointing at that local
shifts.ics. It syncs on a schedule into a native Android calendar that any
calendar app or widget can read.

The feed always contains every shift, and ICSx⁵ mirrors it rather than
appending, so duplicates are impossible and there is no manual import step
after the first setup. Save over the same file each time.

One thing to watch: Chrome on Android may save a second download as
`shifts (1).ics` instead of overwriting, which would leave ICSx⁵ pointing at
the stale file. Delete the old one first, or check the filename after saving.
If that proves annoying, host the feed at a URL and point ICSx⁵ there instead.

**Manual import.** For opening the file directly in a calendar app. Note that
the Google Calendar app on Android cannot import files at all — Samsung
Calendar can, via My Files. In this mode the export only includes shifts not
sent before, since importing appends rather than replaces.

Because it only ever adds, deleting a shift has to be said out loud. When a
shift that has already been sent is deleted, Setup shows how many events the
calendar has not been told about and offers **Save the cancellations** — a
second file that names those events and withdraws them. Open it the same way as
any other export. It is a separate file on purpose: a calendar file carries one
instruction, and one claiming to publish while holding cancelled events is
asking the importer to guess.

Whether it takes is the importer's decision, not this app's. Samsung's is known
to be loose about the identifiers a withdrawal depends on, so check the event
afterwards; if it is still there, delete it in the calendar by hand. This is
the mode's known cost, and the reason subscription is the recommended one —
there the feed is rebuilt whole and a deleted shift simply is not in it.

Alarm lead times are set in Setup, in hours before each shift.

## How the two calendars fit together

The shape that makes this work, and the one to set up:

```
Homebase  ──Calendar Sync──▶  "Homebase Raw"      a staging calendar,
                              (Google)             hidden on the phone

                                    │  save the .ics, add it
                                    ▼
TrackTik  ──screenshots────▶  S H I F T   D E C K   one job named on every
                              normalises, merges     shift, hours, pay
                                    │
                                    │  export ──▶ ICSx⁵
                                    ▼
                              "Work Schedule"      the calendar he actually
                              (native Android)      looks at, and the widget
```

Two things follow from it.

**Every event says which job it is.** Homebase writes `Security Officer` and
nothing else — put two employers' shifts on one calendar that way and it is
unreadable. What Shift Deck exports is `Trupoint- Security Officer - Headquarters`,
using the job name from Setup, for both jobs and whichever way the shift came
in. That normalising step is the reason to route through here at all.

**No duplicates.** The staging calendar is the raw feed and is switched off in
the phone's calendar app; the Work Schedule calendar is the only one showing.
Without the split, every Homebase shift appears twice — once from Homebase's
own sync and once from the export.

Setting it up:

1. In Google Calendar, create a calendar called **Homebase Raw**.
2. In Homebase → Settings → Calendar Sync, point the **Calendar** field at it
   rather than at the account's main calendar. If the field only offers
   accounts and not individual calendars, leave it and use the job's import
   filter instead — see below.
3. On the phone, untick **Homebase Raw** so it does not draw.
4. Point ICSx⁵ at the exported `shifts.ics` as the **Work Schedule** calendar,
   and leave that one showing. The widget reads it.

Addresses ride along. Homebase puts a real street address on its events, and
Shift Deck now passes it through to the export, so the two-hour alarm fires, he
taps the event, taps the address, and he is navigating. For TrackTik shifts
there is a field for it on the edit dialog.

## Bringing in an employer's calendar sync

Homebase has a Calendar Sync of its own — Settings → Calendar Sync, then
Enable, the locations, a Google account and an alert lead time. Turned on, it
writes his shifts into that Google calendar and the phone syncs them down.

That is a better source than a screenshot in every way that matters: the times
are the employer's own numbers rather than characters read off a dark screen,
so no am/pm can be misread, no row can be lost to a scroll boundary, and each
event carries an ID that stays the same when the shift moves.

What it cannot do is put those shifts in here. There is no web API for the
phone's calendar on Android, so a page like this one cannot go and read it.
The `.ics` file is the bridge:

1. In Google Calendar in a browser → Settings → the calendar Homebase writes
   to → **Secret address in iCal format**.
2. Open that link in Chrome. It saves an `.ics`.
3. **Add** → pick the job → **Add a calendar file** → choose it.

**Fetch from a link** takes that address directly and skips the saving, but
Google does not let a web page read its calendar addresses, so expect it to
fail and fall back to the file. It is there for feeds that do allow it.

Importing the same calendar again is safe and is how it stays current. Events
are matched on their ID, so a shift already on file is left alone, and one the
employer has **moved** is shown as a change — `was 20:00–06:00` — and replaces
the old one rather than appearing twice. A **cancelled** shift arrives as a
row in the review list with a tick already in it: leave it ticked and the shift
goes, and the next export takes it off the Work Schedule calendar too. It is
never removed without being shown, because a partial view of a schedule looks
exactly like a week of cancellations.

Three things are skipped, and the import says how many of each: anything
before last week, all-day entries — a shift is its times, and inventing one
would be the exact mistake this app exists to avoid — and anything that does
not match the job's filter.

That filter is the fallback for when Homebase cannot be pointed at a calendar
of its own. Syncing into a whole Google account brings the dentist and the
birthdays along with the shifts, and **Setup → the job → Calendar import: only
events mentioning…** takes a word that appears on every shift and nothing else
— a site name, the role. With a staging calendar there is nothing to filter and
it can stay empty.

## Reading screenshots

Two layouts are handled, both confirmed against real screenshots of his
schedule from September 2026:

- **TrackTik** — a month header, then a weekday and time range on one line with
  the day number and the site on the line below.
- **Homebase** — a written date header carrying no year, then start and end
  times on separate lines, with his own name, the role and the site alongside.
  The name is the same on every row, so it is dropped and the label keeps the
  role and the site.

Rows the reader is unsure about are highlighted. It flags a missing date, times
with no am/pm printed, times that had to be paired across two lines, and any
case where the weekday on screen disagrees with the date it worked out.

Neither app prints a year, so the year is inferred. The weekday printed beside
the date is the only thing that can contradict that guess, and it is checked on
both layouts.

A row cut off by the top or bottom of the screen loses either its times or its
date. Times without a date are flagged for review rather than guessed at; a
site line whose times scrolled away is dropped. Overlap the screenshots by a
row and nothing is lost.

Site names are fuzzy matched against ones already on file, so the same site
spelled three different ways by OCR collapses to one.

## Typing a time

Every time in the app is 24-hour, entered and displayed. `23:00` cannot be
misread the way `11:00pm` can, and the fields follow the display rather than
the phone's locale — a US-locale phone draws `<input type="time">` as a
12-hour spinner with an AM/PM segment, which put am/pm on the one screen that
exists to catch an am/pm misread.

The boxes take what you would actually type:

| Typed | Filed |
| --- | --- |
| `9` `09` `900` `0900` `9:00` | `09:00` |
| `21` `2130` `21:30` `21.30` | `21:30` |
| `2400` | `00:00` |
| `9pm` `9:00 PM` `12am` | `21:00` `21:00` `00:00` |

A bare `9` is nine in the morning; nine at night is `21`. A meridiem is
accepted, because the employer's screen prints one and you may be copying from
it — but the box rewrites it as `21:00` as soon as you leave the field, so you
can see what it made of it.

Anything it cannot read goes red and changes nothing. It never rounds to the
nearest time you might have meant: `2:5` is not `02:05`. The edit dialog will
not save while either time is unreadable.

## Declared shifts

am/pm rides on a single character, and a misread puts a shift twelve hours out
looking perfectly plausible. Under each job in **Setup** you can declare the
shifts it normally runs — tick the days, set the two times. Screenshot rows are
then checked against them:

- **Exactly twelve hours out** is an am/pm misread. It is corrected, and the
  row goes amber saying what was read, because a silent correction is no better
  than a silent error.
- **A few minutes out** is the reader being untidy. Snapped, quietly.
- **An hour or two out** is left alone and flagged. The employer may genuinely
  have moved the shift, and snapping that back would make him late with nothing
  left to notice.
- **A day the job does not run** is flagged the same way, never moved.

Nothing is inferred from shifts already on file — that history is the reader's
own output, so one bad import would become evidence and the check would get
quieter every time it failed. **Build from what's on file** offers the pairs
already filed as a list to pick from; you choosing them is the point.

Ticking days also says the pattern can fill a week; leave every day unticked
and it is only ever used for checking. Whether or not any are declared, a shift
under an hour or over fourteen is flagged as an unlikely length.

Calendar rows and shifts typed by hand are never corrected this way. Those
times are the employer's own numbers, or yours.

## Filling a week from the rota

A job that runs the same days every week does not need a screenshot most weeks.
**Add → Fill a week from the rota** puts the declared rota into a week and
drops the shifts into the review list, where they behave like any other import:
same flags, same overlap check, same commit. Nothing is filed until you add
them.

They stay marked afterwards. A shift that came from the rota rather than from a
screenshot shows a **hollow stripe** and the words *from the rota* in the week
list, is named separately in the pay tab — "8.00 h from the rota, unconfirmed" —
and goes into the calendar as *DSI- De la Montagne (from the rota)*, so the
05:00 alarm says which kind of shift it is. A screenshot covering that week
**promotes** them: the matching shift becomes confirmed in place, keeping its
calendar event, and a site read off the screen replaces the one the app
guessed. Editing a shift by hand confirms it too.

If a week filled this way is never confirmed, the schedule says so rather than
letting it pass as fact: *"3 shifts in the last fortnight came from the rota and
were never confirmed against a screenshot."*

Set **Statutory holidays** on the job and a generated shift landing on one is
flagged — *"A statutory holiday falls on this day."* It is never dropped for
you: the rota may well run that day, and a shift quietly skipped is a shift
missed. Past weeks are never filled, and a week already covered is left alone.

## What the Schedule tab warns about

Three kinds of warning sit above the week list, ordered by what they cost.

**Red — a shift that is going to go wrong on the phone.** Two shifts scheduled
over each other, covered below. And a calendar that has fallen behind this
screen for something happening within two days: the alarms come from the last
export, so a shift the calendar has never seen has no alarm, and one whose time
changed still rings at the old one.

**Amber — the same thing, with time to fix it.** *"2 shifts are not in the
calendar and 1 has changed since it was sent. The soonest is Tue 8 Sep. Save
new shifts in Setup."* In manual-import mode a deleted shift that is still in
the calendar gets its own line, since the fix is the other button.

This one is deliberately quiet outside a week. A shift added three weeks ahead
and not yet exported is not a problem — there is time — and a warning that sat
there amber for three weeks would teach you to stop reading the amber that
means something. It appears when the soonest unexported thing comes within
seven days, and turns red at two.

**Amber — nothing on file after Friday.** The schedule is running out. Per job,
because the two fail differently: a job on a calendar sync should be filling
itself, and a job on screenshots will not fill itself at all.

## Overlapping shifts

Two shifts scheduled over each other is the one failure with no recovery, so it
is flagged in three places: on the row as you add it, in a red banner over the
schedule, and beside both shifts in the week list. Each message names both
sides and how long they overlap by, and stops there — which of the two is wrong
is not something the app can know.

Overlap is measured across midnight, not within a day: an overnight shift
running into the next morning's is the likeliest real collision, and it is the
one a day-by-day check would never see. Nothing is blocked and nothing is
removed automatically.

**Two shifts on the same day are not a warning.** Going straight from one job
to the other is ordinary. Only hours actually scheduled twice count, so a shift
ending at 15:00 and one starting at 15:00 say nothing.

## Development

Four modules, all pure functions — no DOM, no storage. `parser.js` turns OCR
text into shift rows and `ics.js` does the same for a calendar file; they share
nothing but the row shape, so both land in the same review screen with the same
flags and the same commit path. `patterns.js` reads nothing at all — it takes a
finished row and the shifts declared for its job and decides what to do about
the difference, and it also turns a declared rota into a week of rows.
`holidays.js` is a calendar: which dates are statutory holidays, worked out by
rule so nothing expires. Each loads as a plain script in the browser and is
required directly by the tests. There is still no build step and the app has no
runtime dependencies.

```
npm test              # run every module's tests
npm run test:update   # regenerate golden files, then read them before committing
```

`tests/fixtures/README.md` explains how to turn a screenshot into a test case.
Calendar feeds go in `tests/fixtures/calendar/` as `.ics` alongside their
expected JSON, and every calendar test pins an output time zone so the answers
do not depend on where the tests are run.
Fixtures marked PROVISIONAL are typed from the vendors' user guides; ones
marked TRANSCRIBED are real schedules read off screenshots by eye rather than
by OCR. Neither kind proves the reading of the text, only the understanding of
the layout. An unmarked fixture is pasted OCR output. `patterns.js` and `holidays.js` have no
fixtures — they read nothing, so their tests are stated cases and dates checked
against a calendar rather than samples.

The app is not carrying live data yet, so there are no schema migrations. When
the stored shape changes, use **Setup → Danger zone → Delete everything and
start over**. See PROJECT.md §7.

## Known limits

- am/pm rides on a single character. A misread puts a shift twelve hours out
  and it will look plausible. Declaring the job's shifts (above) catches the
  ones that land on a job with a fixed rota, and an unlikely length catches
  some of the rest, but neither is complete — glance at the times before
  exporting. This is a screenshot problem only: a calendar import cannot get a
  time wrong this way.
- A calendar import never removes anything on its own. Cancellations are
  proposed with a tick-box and wait for you. An import that overlaps a shift
  already on file is flagged, not blocked.
- In manual-import mode, removing a shift here does not withdraw the event by
  itself: Setup offers a cancellation file, and whether the calendar app acts
  on it is out of this app's hands. Check the event afterwards and delete it
  there if it survived. Subscription mode has no such problem — the feed is
  rebuilt whole every time.
- Pay figures are gross estimates for spotting a missing shift on a paystub,
  not a prediction of the deposit. Overtime is counted separately per employer,
  and premiums, stat holidays and retro pay are not modelled. A week holding
  shifts filled from the rota says how many of its hours are assumed.
- The holiday lists are Québec's and the US federal one, and they say when a
  holiday falls, not whether your employer observes it or whether you are
  working it. That is why a holiday only ever flags a generated shift and never
  removes one.
- Android can clear the storage of a web app under pressure. Save a backup
  from Setup now and then.
- Both layouts have been checked against real screenshots, but not yet against
  real OCR output — the test fixtures were transcribed by eye. The reading of
  the text is the part still unproven. Check the first few imports closely.
