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

## Development

Two readers, both pure functions — no DOM, no storage. `parser.js` turns OCR
text into shift rows; `ics.js` does the same for a calendar file. They share
nothing but the row shape, so both land in the same review screen with the
same flags and the same commit path. Each loads as a plain script in the
browser and is required directly by the tests. There is still no build step
and the app has no runtime dependencies.

```
npm test              # run both readers' tests
npm run test:update   # regenerate golden files, then read them before committing
```

`tests/fixtures/README.md` explains how to turn a screenshot into a test case.
Calendar feeds go in `tests/fixtures/calendar/` as `.ics` alongside their
expected JSON, and every calendar test pins an output time zone so the answers
do not depend on where the tests are run.
Fixtures marked PROVISIONAL are typed from the vendors' user guides; ones
marked TRANSCRIBED are real schedules read off screenshots by eye rather than
by OCR. Neither kind proves the reading of the text, only the understanding of
the layout. An unmarked fixture is pasted OCR output; there are none yet.

The app is not carrying live data yet, so there are no schema migrations. When
the stored shape changes, use **Setup → Danger zone → Delete everything and
start over**. See PROJECT.md §7.

## Known limits

- am/pm rides on a single character. A misread puts a shift twelve hours out
  and it will look plausible. Glance at the times before exporting. This is a
  screenshot problem only — a calendar import cannot get a time wrong this way.
- A calendar import never removes anything on its own. Cancellations are
  proposed with a tick-box and wait for you.
- In manual-import mode, removing a shift here does not withdraw an event
  already sent to the phone's calendar — delete it there too. Subscription
  mode has no such problem: the feed is rebuilt whole every time.
- Pay figures are gross estimates for spotting a missing shift on a paystub,
  not a prediction of the deposit. Overtime is counted separately per employer,
  and premiums, stat holidays and retro pay are not modelled.
- Android can clear the storage of a web app under pressure. Save a backup
  from Setup now and then.
- Both layouts have been checked against real screenshots, but not yet against
  real OCR output — the test fixtures were transcribed by eye. The reading of
  the text is the part still unproven. Check the first few imports closely.
