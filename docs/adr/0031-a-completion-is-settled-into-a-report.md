# A completion is settled into a report before anything is painted

`main.ts`'s `SCRAPE_COMPLETE` handler was ~140 lines: it resolved the chunk transfer, reset it,
merged a resumed sweep's halves, called `runLifecycle.complete`, branched on the outcome, wrote
the badge six times in a fixed order, composed the notification counts and ran whatever the Run
still owed. Every rule in it was real — the transfer is single-use (ADR-0017), the union is what
settles (ADR-0023), a stop is not a completion (ADR-0020) — and every one of them was observable
only by booting the content script and driving messages through it. The ordering was a comment,
not a value.

`src/content/completion-intake.ts` is that handler as one module. A completion goes in; a
`RunReport` comes out:

```ts
type SurfaceUpdate =
  | { kind: "complete"; total; pages; elapsed; runKind?; failedItems? }
  | { kind: "status"; topic: "stopped-sweep" | "shortfall" | "batch" | "truncated" | "failed-items"; text }
  | { kind: "error"; text };

interface RunReport {
  ending: "accepted" | "salvaged" | "rejected" | "incomplete" | "failed";
  completion: ScrapeComplete | null;      // the union merged in, for the endings with rows
  updates: SurfaceUpdate[];               // in the order the panel shows them
  notification: { kind; detail } | null;  // null where a toast must stay silent
  followUp: FollowUp[];
}

settleCompletion({ completion, transfer, run }): RunReport
failedRun({ message, run }): RunReport
```

Rationale:

1. **The report names outcomes, not DOM calls.** `complete`, a `status` topic and `error` are what
   the panel can be told; which badge function paints them, and with which argument, stays in
   `main.ts`'s `applyReport`. The ordering rule therefore survives without a document, and the
   surface is still the only thing that needs one.
2. **The transfer's single use is the module's rule.** `settleCompletion` empties the buffer on
   every path out, including the rejected and salvaged ones, so "one transfer at a time" stopped
   being a call `main.ts` had to remember after two of its four branches.
3. **The resume merge cannot be separated from the settle.** The union, the merged per-masa counts
   and the re-derived `totalRows` exist to feed `runLifecycle.complete`; passing a settled outcome
   in would have split ADR-0023's rule across a caller and a module. The life-cycle arrives as a
   parameter, so a test builds a real one.
4. **Every ending is the same question.** `failedRun` returns the same shape, from the same
   wording module (`scrape-result.ts`, now including `incompleteTransferMessage`), so a failure
   cannot be announced one way in the panel and another in the toast. The `publishIncomplete`
   helper that existed only to notify runs that did not finish is gone.
5. **A salvage stays silent.** The report returns `notification: null` for a stopped sweep: the
   panel says how much of the year survived, and a toast claiming the run finished is exactly what
   ADR-0020 forbids.

Consequences: `main.ts` keeps the message wiring, `SCRAPE_PROGRESS`, `INJECTED_READY`, the
retirement listener and `applyReport`; the completion handler is one call. `run-lifecycle.ts`,
`result-chunks.ts` and `scrape-result.ts` are unchanged in their own rules. The module reads no DOM and calls no
browser API, and it unit-tests directly in
`src/tests/completion-intake.unit.test.ts`: the panel order, a lapsed transfer, the union of a
resumed sweep, a resume stopped twice, a refused result, the follow-up order, and both wordings
of a failed run. The boot harness still drives the messages end to end, which is now wiring
coverage rather than the only coverage.

Status: accepted.
