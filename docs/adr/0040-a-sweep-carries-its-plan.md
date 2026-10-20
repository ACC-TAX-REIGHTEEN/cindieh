# A sweep carries its plan

A year-wide export was described by two numbers and a list of counts: `PeriodSummary` held
`counts`, `totalRows`, `planned`, `emptyPeriods` and `failedPeriods`. The `planned` number was how
many periods the sweep was ASKED for, and the plan itself — the actual period codes — was thrown
away at the world boundary and reconstructed by the reader:

```ts
export function pendingPeriods(summary: PeriodSummary): string[] {
  const seed = summary.counts[0]?.period;      // the FIRST count, as a seed
  if (!seed) return [];
  const plan = planPeriods(seed, summary.planned);  // the year, rebuilt from it
  const finished = new Set(summary.counts.filter((c) => !c.error).map((c) => c.period));
  return plan.filter((code) => !finished.has(code));
}
```

That reconstruction is only right when the first count is month 01. Nothing stated the assumption,
nothing asserted it, and the resumed half of a sweep cannot hold it: a resume covers a SUFFIX of the
year, so its own summary starts at, say, `TD.00704` with `planned = 9` — and rebuilt from that seed
it would ask for January to March again and never ask for October to December.

What saved it was a merge in the other world: `completion-intake.ts` folded the resumed half into
the kept half before anything read either, and the union's first count was month 01 again. The
correctness of the MAIN world's own summary therefore depended on a merge living two modules away,
in the other world, on a different instance of the same value — and no test pinned the pairing.

The question the reconstruction served was asked in four places, with four different guard sets:

| Caller | Question | Guards beyond it |
|---|---|---|
| `run-lifecycle.ts` `restore()` | may these rows be adopted? | `data` and `fields` non-empty |
| `sweep-snapshot.ts` `sweepContentOf()` | may these rows be stored? | `data`, `fields`, `source` |
| `sweep-snapshot.ts` `readSnapshot()` | may this blob be offered? | the stored shape |
| `main-actions.ts` `startBatchExport()` | is this a resume or a fresh year? | `data` non-empty |

and the "a masa finished" predicate behind it was written out by hand five more times
(`scrape-batch.ts`, `scrape-result.ts` twice, `main-actions.ts`).

Decision:

1. **The plan travels with the counts.** `sweep.ts` owns the concept: a `Sweep` is a `plan` (the
   period codes it covers), the `counts` (what each contributed) and `totalRows` (the rows it holds).
   The MAIN world reports the codes it was asked for; the isolated world unions the halves' plans.
   Nothing is reconstructed from a seed any more.
2. **The plan replaces the `planned` NUMBER.** `planned` was the plan's length wearing a number's
   clothes; `sweep.plan.length` is that length, and there is no second place it can disagree with.
3. **The empty and failed lists are derived, not carried.** `emptyPeriods` and `failedPeriods` were
   fields on the summary and on the wire and in storage, each able to disagree with the counts it
   claimed to describe. They are now functions of the counts.
4. **The module answers the two questions, once.** `missingPeriods(sweep)` is "which masa are still
   missing" and `isResumable(sweep)` is "is there anything left to resume". The four callers ask
   the module; the four guard sets that are genuinely different questions (may these ROWS be stored,
   may this BLOB be offered) stay where they are.
5. **The union is the merge.** `mergeSweeps(previous, incoming, totalRows)` folds the incoming
   counts in, lets them win for a period they cover again, and takes the union of the two plans. The
   row count is the caller's to say, because the two halves were counted by two accumulators and the
   panel names the deduplicated union (ADR-0016).

`scrape-batch.ts` keeps the REQUEST half — the measured filters, the period codes derived from the
portal's own request, the body rewritten for one masa at a time — and `sweep.ts` owns what a sweep
IS. The two do not import each other.

Consequences:

- The resumed half describes itself: its plan is the suffix it swept, and the union's plan is the
  whole year. A sweep with a plan and no counts at all — a stop that caught the first period, which
  is never recorded (ADR-0020) — now says all twelve are missing. Before, the reconstruction found
  no seed, reported nothing missing, and the batch entry started a FRESH year that DROPPED the kept
  rows; now the resume asks for the whole year and keeps what was collected.
- The stored snapshot carries the plan too, so its version moves to 2: a version 1 blob has only the
  counts and is dropped rather than read as a sweep with no plan and nothing to resume.
- The wire shape shrinks from five fields to three, and the panel's "10 dari 12 masa" reads the
  plan's own length.
- `sweep.ts` is 100% covered on its own terms, and the arithmetic that was spread over three modules
  and four guard sets is now one module with one question.

Status: accepted.
