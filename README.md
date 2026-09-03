# Shift Deck

Aggregates shift schedules from two employer apps into one view, with hours
and gross pay estimates, and feeds the phone's calendar so the home screen
widget and alarms do the reminding.

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
2. **Add** → pick the job, drop in screenshots, check the rows, add them.
3. **Setup** → Save new shifts → open the file on the phone → import into the
   shift calendar.

The first import downloads the OCR engine, about 10 MB. After that it is cached
and works offline.

## The calendar

Two modes, set in Setup.

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

## Reading screenshots

Two layouts are handled:

- **TrackTik** — a month header, then a weekday and time range on one line with
  the day number on the line below.
- **Homebase** — a full written date header, then start and end times on
  separate lines.

Rows the reader is unsure about are highlighted. It flags a missing date, times
with no am/pm printed, times that had to be paired across two lines, and any
case where the weekday on screen disagrees with the date it worked out.

Site names are fuzzy matched against ones already on file, so the same site
spelled three different ways by OCR collapses to one.

## Development

The parser is `parser.js` — pure functions, no DOM, no storage. It loads as a
plain script in the browser and is required directly by the tests. There is
still no build step and the app has no runtime dependencies.

```
npm test              # run the parser tests
npm run test:update   # regenerate golden files, then read them before committing
```

`tests/fixtures/README.md` explains how to turn a screenshot into a test case.
Fixtures marked PROVISIONAL are typed from the vendors' user guides, not from
real schedules — they catch regressions, they do not prove correctness.

The app is not carrying live data yet, so there are no schema migrations. When
the stored shape changes, use **Setup → Danger zone → Delete everything and
start over**. See PROJECT.md §7.

## Known limits

- am/pm rides on a single character. A misread puts a shift twelve hours out
  and it will look plausible. Glance at the times before exporting.
- Pay figures are gross estimates for spotting a missing shift on a paystub,
  not a prediction of the deposit. Overtime is counted separately per employer,
  and premiums, stat holidays and retro pay are not modelled.
- Android can clear the storage of a web app under pressure. Save a backup
  from Setup now and then.
- Neither screenshot layout has been tested against a real capture yet. Both
  profiles come from the employers' user guides. Check the first few imports
  closely.
