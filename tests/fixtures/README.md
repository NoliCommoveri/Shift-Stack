# Parser fixtures

Each `NAME.txt` is raw text exactly as the OCR produced it. Each
`NAME.expected.json` is what the parser should make of that text.

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

**Neither** — plain OCR output pasted from the app, which is the real thing.
There are none yet. Replace the TRANSCRIBED files with these when the first
import runs.

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

- ~~Dark mode~~ — the TrackTik app is dark. The invert path in `prep()` still
  has never run against a real screenshot, since these were transcribed rather
  than read.
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
