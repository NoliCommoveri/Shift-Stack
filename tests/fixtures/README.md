# Parser fixtures

Each `NAME.txt` is raw text exactly as the OCR produced it. Each
`NAME.expected.json` is what the parser should make of that text.

**Everything marked PROVISIONAL is not real data.** Those three files were
typed from the layout examples in the vendors' own user guides, which is all
the project has had to work from so far. They are here to hold the harness
upright and to catch accidental regressions — they are not evidence that the
parser reads either employer's real screens correctly.

## Adding a real fixture

1. Import the screenshot in the app, open **Show the raw text that was read**,
   and copy the whole panel.
2. Save it here as something descriptive — `tracktik-2026-09-week1.txt`.
3. `UPDATE=1 node --test tests/`
4. **Open the generated `.expected.json` and read it.** Update mode records
   what the parser currently does, not what it ought to do. Anything wrong in
   there is a bug to fix, not a result to commit.
5. Once the JSON says what the screenshot actually showed, commit both files.

Delete the PROVISIONAL fixtures once real ones cover the same ground.

## Worth capturing

- Dark mode, if that is what the phone is set to — the invert path in `prep()`
  has never run against a real screenshot.
- Uncropped and unedited.
- A scroll boundary, with rows cut off at the top and bottom.
- A month rollover, for the day-number-drops-so-advance-the-month logic.
- An overnight shift, if he works them.
- The same week captured twice, which is the input the change detection will
  eventually have to handle.
