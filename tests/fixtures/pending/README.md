# Pending fixtures

Raw OCR text that is real evidence but has **no golden file yet**, because the
parser's current output for it is known to be wrong. The test harness does not
glob this directory, so nothing in here asserts anything.

Committing a golden generated from text the parser mishandles would enshrine
the bug as the expected result — the rule in `../README.md` step 4. Parking the
text here keeps the evidence without making that claim.

## homebase-2026-09-week1.txt

A real OCR pass over the Homebase schedule for 3–5 September 2026. The same
days, transcribed by eye, are in `../homebase-2026-09-week1-TRANSCRIBED.txt`,
so ground truth for this capture is already in the repo. Current parser output
against the real text:

| | transcribed truth | from the real OCR |
|---|---|---|
| Thu 3 | 00:15–04:15 Training — Headquarters | 19:15–04:15, "Headquarters" |
| Thu 3 | 20:00–00:00 Training — F.O.C | **08:00**–00:00, "cc Training i - F.O.C" |
| Fri 4 | 00:15–08:15 Security Agent — Headquarters | 19:15–08:15, "Headquarters" |
| Sat 5 | 19:15–07:15 Security Officer — F.O.C | **dropped entirely** |

Three faults, all on the reading rather than the layout:

1. **`12:15 am` came through as `19:15`.** Unrecoverable from the text alone —
   nothing downstream can know the 9 was a 2 and the "am" was eaten.
2. **`8:00 pm` lost its meridiem to the next line** (`00pm .`), so it parsed as
   08:00 — twelve hours out, the §6 top risk on real data.
3. **The Saturday shift has only one legible time**, and the two-single-times
   rule needs a pair, so the row is silently absent rather than flagged.

Also visible but separate: lines *between* the start-time line and the
end-time line are never gathered into the label, which is why "Training" and
"Security Agent" are missing. That one is a plain bug with an obvious correct
behaviour, unlike the three above.

Whether any of this gets fixed is a live question, not an oversight: Homebase
is the job with Calendar Sync (§12), so this OCR path is a fallback for a job
that already has a feed carrying exact times.
