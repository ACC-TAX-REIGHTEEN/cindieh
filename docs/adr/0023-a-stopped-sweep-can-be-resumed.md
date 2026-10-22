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
  stop cut short (not recorded at all). Nothing else is persisted between runs;
  the counts are the whole memory (the kept half itself was later made to
  survive a reload — see the amendment below). The same arithmetic answers a second, older
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

## Amendment 2026-10-17: the kept half survives a reload

**What changed.** The rows a stop salvaged and their per-masa counts are now
written to extension storage, and a reloaded tab reads them back and offers the
same resume. Only the half itself is stored: no pending request travels with it,
because a stop retired those (ADR-0022, ADR-0027), so a refresh cannot revive a
comparison or an export the user never re-asked for.

- **The Run announces, `main.ts` persists.** Every mutator of the life-cycle
  (`begin`, `stop`, `reset`, `complete`) ends by announcing what a resume would
  start from (`onResumable`), so a path that drops the rows clears the snapshot
  and a path that keeps them writes it, without either being remembered
  separately. `restore()` is the other end, and it adopts the stored rows as a
  RESULT rather than starting a Run: nothing is in flight and nothing is owed.
- **Only a stopped sweep qualified at the time.** `partialSweep` and the counts
  were both required, which is why the flag is stored instead of inferred: a whole
  sweep carries counts too. A stopped sweep with no rows, or one whose grid is
  unknown, is not stored at all — a snapshot that cannot be matched to a grid
  could only be offered to the wrong one. (Widened by the 2026-10-19 amendment
  below: what qualifies is any sweep with a masa still pending, stopped or not.)
- **The page decides, by SOURCE.** `snapshotAppliesTo` compares the stored
  source with `getPageExportSource()`: a Keluaran half-year is not offered on
  Masukan even though both sweep. A tab that loaded on another workbook page
  keeps the snapshot and offers it once the user navigates to the right grid.
- **A stored snapshot is guarded on the way in, never trusted.** Version, shape
  and a 24-hour window are checked before its rows may become a Run's, and a blob
  that fails any of them is DROPPED rather than repaired. The window exists
  because a resume is a pause, not an archive: a masa fetched last week can have
  gained an invoice since, and nothing in the merge could see that.
- **Too large to store is not stored short.** Above about 4 MB of serialized
  sweep the write is skipped and the reload simply has no resume — the behaviour
  before this existed — because a truncated snapshot would make the resumed file
  short in exactly the way its own counts deny.
- **A stop still writes no FILE, and starts nothing.** What it writes is the
  snapshot a later click reads, which leaves ADR-0020's "nothing runs
  automatically" intact: `restore()` adopts rows and begins no Run.
- **Navigation still forgets.** `reset()` is the isolated world's one path that
  forgets everything, and the snapshot goes with it, so a tab that moves to
  another page cannot come back to rows from the one before.

## Amendment 2026-10-19: a sweep that finished with a failed masa survives too

**What changed.** The snapshot is no longer restricted to a STOP `partialSweep`.
A sweep that ran to its plan while the portal failed to deliver a masa is stored
as well, and a reloaded tab offers the same one-month retry it could already make
in the tab that ran it. Nothing else about the entry moves: same menu item, same
confirmation, same union merge, same `pendingPeriods` arithmetic.

- **The test is `pendingPeriods`, not the flag.** What makes rows resumable is
  masa still missing, and both states have some: a stop has the masa it never
  reached, a finished sweep has the ones the portal failed on. `sweepContentOf`,
  `readSnapshot` and `restore()` all ask that one question, so the second state
  is not a special case anywhere — it is the same year one step later.
- **The flag is still carried, because it is about the FILE, not about the
  offer.** A restored stop is still exported as `-sebagian`; a finished sweep was
  never stopped and keeps its plain year name even though a month is missing. The
  stored `partialSweep` is therefore a boolean fact about the rows rather than a
  qualification, and `restore()` re-installs it as it was instead of asserting it.
- **A whole year is still not stored.** With nothing pending there is nothing to
  resume, so the same announcement that writes a short year CLEARS the snapshot
  once the last missing masa arrives — including the completion of a successful
  retry, which is what makes the stored half go away by itself.
- **The panel says which of the two it restored.** `restoredSweepMessage` takes
  the flag, and a finished sweep is offered a RETRY of the masa the portal failed
  on rather than a continuation of a stop; the `-sebagian` sentence is said only
  where it is true.
- **Version stays 1.** The shape only loosened (`partialSweep: true` → any
  boolean), so a snapshot written before this amendment still reads back — and one
  that has since had its last masa filled in is dropped by the pending-masa guard
  instead of being offered as a resume that would fetch nothing.

## Amendment 2026-10-20: the sweep carries its plan

**What changed.** ADR-0040 gave the sweep a PLAN — the period codes it covers — beside
its counts, and moved the resume's arithmetic into `sweep.ts`. The decisions above are
unchanged: what is still missing is still derived rather than remembered, the union is
still the isolated world's job, and a stop still keeps the rows. Only the arithmetic
moved, and with it the two names this ADR used:

| Was | Is now |
|---|---|
| `pendingPeriods(summary)` | `sweep.missingPeriods(sweep)` |
| `mergePeriodSummaries(previous, incoming)` | `sweep.mergeSweeps(previous, incoming, totalRows)` |
| `summary.planned` (a number) | `sweep.plan.length` (the plan's own length) |
| the snapshot's version 1 | version 2 — a version 1 blob has counts but no plan |

**Why it was worth reopening.** "What is missing is derived, never remembered" was true
only of the DERIVATION: the plan itself was remembered as a number and rebuilt from the
first count, which assumes that count is month 01. A resumed sweep's own half starts
wherever the resume began, so the rebuild would have asked for January to March again and
never for October to December. The union merge hid it — the union's first count is month
01 again — but only because a merge two modules away, in the other world, happened to run
first. The plan now travels with the counts, so the derivation is the plan minus the
periods that finished, and nothing is rebuilt.

The stored snapshot's version moves to 2 for the same reason: a version 1 blob carries
only the counts, and reading it as a sweep with no plan would be reading a year as if it
had no missing masa at all.

## Consequences

- A stop costs a pause. Press the entry again to fetch the missing masa; the
  file that comes out of the resumed run is one whole year with no `-sebagian`,
  and no month is fetched twice.
- The menu entry needs no new control and no new label: `isEfakturPage` gates
  where it is offered, exactly as before (`isBatchPage` was a second name for the
  same answer and was removed by ADR-0035), and the resume is decided from the
  Run's own state at click time.
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
- **Known limits:** a reload is covered (see the amendment), navigation is not —
  `reset()` forgets the kept half, deliberately, so a tab that has moved on does
  not offer rows from the page it left. A sweep too large for extension storage
  is not persisted, and a stored one expires after a day. A stop during a resume
  keeps the union and reports the masa still missing, so a resumed sweep can be
  stopped and resumed again, each stop keeping everything that finished. And a
  resume whose year filter no longer matches fails loudly with instructions
  rather than quietly producing a mixed-year file.
- Manual portal check (failed masa): let a year export finish with one masa the
  portal refused (throttle the connection through that month), reload the tab, and
  confirm the panel says the rows were restored and offers to RETRY that one masa,
  that the entry asks for exactly it, and that the file the retry writes carries no
  `-sebagian`.
- Manual portal check: start a year export, stop it after two or three masa, then
  click the same entry and confirm that the dialog names the kept and remaining
  masa, that only the missing months are requested, that the panel reports one
  whole year when it finishes, and that the exported name carries no `-sebagian`.
  Reload the tab first and confirm the panel says the half-year was restored and
  that the same entry still offers the remaining masa — then reload on another
  e-Faktur grid and confirm it is NOT offered there.
