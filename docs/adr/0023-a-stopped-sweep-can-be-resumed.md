# 23. A stopped sweep is resumable: only the masa that never finished are re-run, into the rows it kept

Date: 2026-10-15

## Status

Accepted

## Context

ADR-0020 stopped a year-wide sweep from throwing its work away: the masa that
finished are reported, kept, and exported as `…-sebagian`. That rescued the
**data**, but not the **work**. The only way to finish the year was to start the
whole sweep again, and the second pass re-fetched the months already held —
minutes of portal traffic for rows the user already had, on a portal the project
deliberately paces. A taxpayer with 60k rows was asked to pay for them twice.

The kept rows and their per-masa counts were already in one place
(`RunResult.sweep`, ADR-0020), and the counts already said which masa finished.
What was missing was the request side: a sweep could only be asked for "the next
N months from January", never for a named set of masa.

## Decision

**A sweep that was stopped can be resumed from the same menu entry, and only the
masa that never finished are fetched.**

- **What is missing is derived, never remembered.** `pendingPeriods(summary)`
  rebuilds the year's plan from the counts (`planPeriods` on the first count's
  code, `planned` months long — ADR-0020) and subtracts every period recorded
  **without an error**. Both states a stop leaves behind are therefore resumed:
  a period that FAILED (rows may exist, the month is incomplete) and a period the
  stop cut short (not recorded at all). Nothing is persisted between runs; the
  counts are the whole memory. The same arithmetic answers a second, older
  question for free: a sweep that FINISHED with a masa the portal failed to
  deliver also has pending masa, so the same entry retries that month instead of
  the user reading the failure notice and starting the year over.
- **The same entry, and it says what it is doing.** `startBatchExport` routes to
  the resume when the rows on hand are a sweep with pending masa — the kept half
  of a stopped one, or a sweep that finished with a failed month. The
  label stays "Ekspor 1 Tahun (12 Masa)" — it is the same sweep finishing the same
  year — but the confirmation changes, naming how many masa are kept and how many
  will be fetched now. A silent resume would look like a fresh sweep that
  finished suspiciously fast. The panel's stopped-sweep line names the same entry
  (ADR-0020's wording, extended).
- **The request names the masa and the year; MAIN narrows both.** The message
  carries `sweepPeriods` (the codes) and `sweepYear` (the year the kept rows came
  from). `resumePeriodCodes` is only a SHAPE check, the same guard
  `batchMonthCount` gets for the same reason: the value crossed a world boundary.
  The scope check is `scraper-actions`, which filters the codes against the plan
  the **portal's own** captured request yields — a code the portal did not offer
  is never requested (ADR-0018) — and refuses outright when what survives is
  empty rather than completing a sweep that made no request. A period code reads
  as whatever the grid's separate year filter says, so a filter that moved since
  the stop would put two years in one file: the resume compares `sweepYear` with
  the captured year and stops with a message instead of mixing them.
- **The union is the isolated world's job, because the kept rows live there.** The
  MAIN world has no access to them — they were settled by an earlier Run — so
  `main.ts` merges: `unionRows` (deduplicated by the portal's own row identity,
  ADR-0016, previous rows first so the export's order stays stable) and
  `mergePeriodSummaries` (incoming counts win for a period they cover again, so a
  retried failure replaces that failure with the retry's outcome; `planned` keeps
  the larger value, because a resume is asked for a subset of the year). The
  merged rows and counts are what settle, what the panel reports, what the
  notification describes and what the file holds — so a finished resume is a
  whole year-wide sweep again, and `partialSweep` (with its `-sebagian` filename)
  no longer applies.
- **The panel's row total is the file's, not the sum of the counts.** The two
  halves were counted by two independent accumulators, so a masa that failed
  AFTER collecting rows has those rows counted once by the kept half and fetched
  again by the retry, which the union then dedupes. The merged summary's
  `totalRows` is therefore set from the union's actual rows: the number the user
  reads is the number of rows in the file.
- **A resume can only ADD to what a stop salvaged.** `begin("sweep-resume")` sets
  a flag, and `stop()` checks it: a resume that ends badly (a stop, an error, a
  rejected result) keeps the union it was adding to instead of dropping it. A
  failed resume must never be worse than no resume at all. Every other start
  still drops its result when it ends badly.

## Consequences

- A stop costs a pause. Press the entry again to fetch the missing masa; the
  file that comes out of the resumed run is one whole year with no `-sebagian`,
  and no month is fetched twice.
- The menu entry needs no new control and no new label: `isBatchPage` gates where
  it is offered, exactly as before, and the resume is decided from the Run's own
  state at click time.
- Resuming is a deliberate click with its own confirmation, so ADR-0020's "a stop
  runs nothing automatically" is intact: the stop itself still fetches nothing.
- `RunResult.sweep` now has a second reason to exist beside the panel line and
  the notification: it is what makes the kept rows resumable. Anything that
  clears the rows (a full scrape's `begin("scrape")`, `reset()` on navigation or
  "Bersihkan cache") clears the ability to resume with them.
- **The counts travel with the rows they describe, so a completion that replaces
  the rows without carrying counts clears them.** A targeted No. Faktur lookup
  returns the filtered SUBSET and a bulk PDF run scrapes the grid for itself;
  neither is a year, and keeping the earlier sweep's counts across them would let
  the next year-export offer to resume a year whose masa the isolated world no
  longer holds — and the finished file would lose its `-sebagian` name while still
  missing those months. `state.sweep` is therefore whatever the settling
  completion carried, and nothing else.
- **Known limits, deliberately not paid for here:** a resume cannot survive a page
  reload or navigation — the kept rows are in memory, and persisting 150k rows to
  extension storage is a different decision. A stop during a resume keeps the
  union and reports the masa still missing, so a resumed sweep can be stopped and
  resumed again, each stop keeping everything that finished. And a resume whose
  year filter no longer matches fails loudly with instructions rather than
  quietly producing a mixed-year file.
- Manual portal check: start a year export, stop it after two or three masa, then
  click the same entry and confirm that the dialog names the kept and remaining
  masa, that only the missing months are requested, that the panel reports one
  whole year when it finishes, and that the exported name carries no `-sebagian`.
