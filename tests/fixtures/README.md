# Fixtures

Each `NAME.txt` here is raw text exactly as the OCR produced it. Each
`NAME.expected.json` is what the parser should make of that text.

`calendar/` holds the same arrangement for `ics.js`: a `NAME.ics` as a real
feed wrote it, beside the `NAME.expected.json` the reader should produce from
it. Those are read with the output time zone pinned to `America/Chicago` and
the window pinned to 1 September 2026, so a fixture's answers do not depend on
where or when the tests run.

Fixtures carry their epistemic status in the filename.

**PROVISIONAL** — typed from the layout examples in the vendors' own user
guides. Not real data. They hold the harness upright and catch accidental
regressions; they are not evidence about either employer's real screens.

**TRANSCRIBED** — read off real screenshots of his actual schedule by eye, not
run through OCR. The layout, dates, times, roles and sites in these are real
and are what the parser has to get right. What is *not* real is the character
noise: a genuine OCR pass would mangle spellings, split or merge lines
differently, and drop the odd character. So these prove the parser understands
the layout; they do not prove it survives the reading of it.

**SYNTHETIC** — for calendar feeds: written by hand to the shape a real
exporter produces, not captured from an account. Same standing as PROVISIONAL.
It proves the reader understands the format; it does not prove that Homebase's
events say what the fixture assumes they say.

**Neither** — plain OCR output pasted from the app, or an untouched `.ics`
saved from the real feed. That is the real thing. Two of these arrived on
3 September 2026: `tracktik-2026-09-week2.txt` and `homebase-2026-09-week1.txt`.
Replace the TRANSCRIBED and SYNTHETIC files with these as they arrive.

### `homebase-2026-09-week1.txt` holds two rows that are knowingly wrong

Read its golden with that in mind. The Thursday and Friday shifts record a
19:15 start where the screen said 12:15 am, because the OCR pass read `12:15
am` as `19:15` and that information is not in the text for anything to
recover. Both rows carry the `ampm` flag, which is the whole of what the parser
can honestly do about it.

That is not a bug waiting to be fixed, and the golden is not endorsing 19:15 as
correct. What the file exists to protect is everything around it: the meridiem
recovered from a stranded `00pm` line, the role gathered from between the two
time lines, and the Saturday shift emitting a flagged row with an empty end
rather than vanishing. The same days transcribed by eye are in
`homebase-2026-09-week1-TRANSCRIBED.txt`, which is where ground truth lives.

## Adding a real fixture

1. Import the screenshot in the app, open **Show the raw text that was read**,
   and copy the whole panel.
2. Save it here as something descriptive — `tracktik-2026-09-week1.txt`.
3. `npm run test:update`
4. **Open the generated `.expected.json` and read it.** Update mode records
   what the parser currently does, not what it ought to do. Anything wrong in
   there is a bug to fix, not a result to commit.
5. Once the JSON says what the screenshot actually showed, commit both files.

Delete the PROVISIONAL fixtures once real ones cover the same ground.

## Worth capturing

Struck through where the TRANSCRIBED fixtures now cover it by layout, though
none of it is covered by a real OCR pass yet.

- ~~Dark mode~~ — the TrackTik app is dark, and the invert path in `prep()`
  has now run against a real screenshot of it. The text came back clean enough
  that am/pm survived on every row, which is the read that matters most.
- Uncropped and unedited.
- ~~A scroll boundary~~ — `tracktik-2026-09-scrolled` opens on a site line
  whose times are above the fold, and `tracktik-2026-09` ends on a time whose
  day number is below it. The first is dropped, the second flagged `nodate`.
- A month rollover, for the day-number-drops-so-advance-the-month logic. Still
  only covered provisionally.
- ~~An overnight shift~~ — he works them on both jobs. Homebase 8:00pm-12:00am
  and 7:15pm-7:15am are in the transcribed fixture.
- The same week captured twice, which is the input the change detection will
  eventually have to handle.

## Adding a real calendar fixture

1. Save the `.ics` from the feed — Google Calendar → Settings → the calendar
   Homebase writes to → secret address in iCal format, opened in a browser.
2. **Read it before committing it.** It is his real schedule, and it may carry
   personal events from the same account. Cut anything that is not a shift, and
   change the site names if they should not be in the repo.
3. Save it in `calendar/`, run `npm run test:update`, and read the generated
   JSON as above.

Worth capturing: what Homebase actually puts in `SUMMARY` and `LOCATION` — the
label depends entirely on it — and whether the events carry anything naming
Homebase that the job filter could match on instead of a site name.
