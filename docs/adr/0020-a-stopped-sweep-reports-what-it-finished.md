# 20. A stopped year-wide sweep reports what it finished, and keeps the rows

Date: 2026-10-15

## Status

Accepted

## Context

ADR-0018 made the year-wide export ONE Run and decided, on purpose, that a
cancelled run emits **no completion**. Two reasons stood behind that: a file must
never be written that looks like a year when it is not one, and the isolated
world settles its own Run the moment the user stops (ADR-0014), so a completion
arriving afterwards had nowhere to land. `ScrapeComplete.cancelled` was declared
"reserved for explicitly reported cancellation" and left without a producer.

The cost of that rule is the largest single loss in the app. A sweep is minutes
of portal traffic, and a stop at masa 11 threw away ten months of rows that were
already fetched and already deduped — the user had paid for them. The panel said
"Proses dihentikan" and the data was gone.

## Decision

A sweep that is stopped **with rows collected** reports them.

- **What is kept.** The rows already merged into the shared accumulator, plus the
  fields, the source and the year filename hint. The report travels as the
  ordinary `SCRAPE_COMPLETE`, flagged `cancelled: true`, so chunking (ADR-0017)
  and the incomplete-transfer check apply to it unchanged: a 150k-row salvage is
  split across `SCRAPE_DATA_CHUNK` messages, and a lost chunk is still reported
  rather than settled.
- **What is not.** A period the stop cut short is not recorded at all — not with
  rows, not empty, not failed. Only masa that FINISHED are counted, because
  "masa tanpa baris" is a finding about the taxpayer's data and a stopped span is
  not one. The last page of an interrupted request is dropped with the request,
  which is the stop's job; `planned` (the period count asked for) travels with
  the counts so the panel can say "10 dari 12" rather than leaving the gap to be
  inferred from a row count.
- **How it lands.** A stop retires the run id (`bridge.postToScraper`), so the
  report necessarily arrives under a retired id. `bridge.isStoppedRunMessage`
  remembers the id the last STOP_SCRAPE retired, and `main.ts` admits exactly one
  REPORT through that window: the chunk stream a large result travels in
  (ADR-0017) plus the `SCRAPE_COMPLETE` with `cancelled` that names how many
  chunks must arrive. That width is not generosity — a big taxpayer's salvage is
  tens of thousands of rows and therefore chunked, so admitting only the
  completion would leave the assembly empty and report the kept sweep as an
  incomplete transfer. A teardown (`RESET_SCRAPER`) deliberately does not open
  the window: its whole job is to leave nothing behind.
- **What it means.** `run-lifecycle.complete` gains a third outcome beside
  accepted and rejected: `salvaged`. The rows are kept and marked
  `partialSweep`; everything the Run still owed is dropped, so nothing runs
  automatically — a pending comparison spent against eleven of twelve months
  would produce a result that looks complete, which is the one thing a partial
  year must never do. A cancelled completion carrying NO rows keeps the older
  meaning and is still rejected, with the wording that already existed.
- **What the file is called.** `generateDynamicFilename` appends `-sebagian`
  when the export data carries `partialSweep` — one place, so every export path
  of every source inherits it. The rows stay exportable on purpose; the name is
  what stops a ten-month file from passing as a whole year.
- **What is announced.** Nothing. The panel line changes to say how much
  survived; no desktop notification is raised for a salvage, because the user
  pressed stop and is watching.

The batch only. A stopped ordinary scrape still emits nothing: its rows are a
partial page set of one month, and its filename already says which month.

## Consequences

- A stop is no longer a total loss. The panel reports the months that finished
  and the rows kept, and an export from there is visibly partial.
- The exception to the run-id rule is one id wide and one report wide (its
  chunks plus its completion), so a stale completion from any earlier run still
  cannot pose as the current one, and the manager of that window is the module
  that owns run ids.
- The panel's own cancellation message is no longer the last word on a stopped
  sweep; it is replaced by the salvage line, which the isolated world can only
  print once the report arrives. A stop with nothing collected keeps the original
  behaviour end to end.
- The manual portal loop should now include a stopped sweep: begin a year export,
  stop it after two or three masa, and confirm the panel names the months that
  finished and that the exported file carries `-sebagian`.
