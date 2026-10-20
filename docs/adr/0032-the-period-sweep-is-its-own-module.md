# The year-wide sweep is one module, and its page loop is a seam

`startScraping` was ~285 lines serving four Run shapes at once: an ordinary scrape, a withholding
bulk PDF run, a year-wide sweep, and a resume. The sweep's rules sat in the middle of it, between
the request guard, the filename rules and the completion build:

- a period gets one retry, on the SAME period code, after a paced pause;
- the retry is abandoned the moment the run is stopped;
- a period that fails both attempts is recorded with its error and the sweep continues;
- a period the stop cut short is not recorded at all (ADR-0020);
- a stop emits one `cancelled` completion built from the masa that finished, and nothing at all
  when no row arrived.

Each rule was real and each was observable only by running a whole scrape against a mocked XHR,
because the loop carried the accumulator, the counts, the stop report and the completion build in
one function body.

`src/content/period-sweep.ts` is that loop as one module:

```ts
runPeriodSweep({
  captured,          // for the filename hint and the source
  periods,           // the codes to fetch, in order
  rows,              // the Run's ONE accumulator
  ctx,               // stop check, progress channel, delay, pacing
  startedAt,         // elapsed in the progress line and the stop report
  fetchPeriod,       // one whole period, into `rows`
}): Promise<{ summary: Sweep; pages: number; truncated: boolean; stopped: boolean }>
```

(`summary` is a `Sweep` — the plan beside the counts, ADR-0040.)

Rationale:

1. **The rules are now the module's interface.** Retry-once, failed-period-recorded, cut-short-
   period-uncounted and stop-reports-what-finished are the facts a reader needs before trusting a
   sweep's counts, so they live where the loop is, not as comments between unrelated concerns.
2. **The stop report cannot disagree with the counts.** It is built from the same `counts` the
   result returns, inside the module, so "what it finished" and "what it says it finished" are one
   value rather than two accumulators maintained in parallel.
3. **`fetchPeriod` is the seam, and it has two adapters.** Production binds it to
   `scrapePaginated` with the period's request overrides; the tests supply a scripted fetcher. That
   is what makes the retry and stop rules measurable without a portal request, and it keeps XHR out
   of a module that is otherwise pure orchestration.
4. **A stopped sweep is not a completion.** The module returns `stopped: true` only after it has
   sent the `cancelled` completion it owes, so the caller's branch is a return, not a second
   decision about whether to report (ADR-0020).

Consequences: `startScraping` keeps the intent resolution, the measured-filter guard, the resume
year check, the filename rules and the final completion, and calls one function for the sweep.
`scraper-actions.ts` no longer exports the retry constants or the stopped-sweep emitter. The
existing end-to-end suite (`scraper-batch-run.unit.test.ts`) is unchanged and still drives every
one of these rules through the real message path; `period-sweep.unit.test.ts` adds the direct
coverage, including stop timings that are awkward to stage through XHR: a stop in the retry pause,
a stop between periods, and a stop that lands before any row did.

Status: accepted.
