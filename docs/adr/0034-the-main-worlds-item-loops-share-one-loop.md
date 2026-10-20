# The MAIN world's item loops share one loop

Four flows in the MAIN world walk a list of things one at a time:

| Flow | The items | Where it lived |
|---|---|---|
| The paginated grid | one page of rows at a time | `scrapePaginated()` in `scraper-actions.ts` |
| The withholding slips | one Bukti Potong PDF at a time | `downloadBulkWithholdingPdf()` |
| The e-Faktur rows | one invoice PDF at a time | `startPdfDownload()` |
| The targeted lookup | one invoice number at a time | `scrapeByInvoices()` |

Each of them hand-rolled the same five rules:

```ts
if (ctx.isStopRequested()) break;          // when to stop
ctx.sendToContent({ type: "SCRAPE_PROGRESS" }); // what the panel is told
if (consecutiveFailuresExhausted(ctx, n)) { /* give up */ } // when to give up
failedItems.push(name);                     // what a failure is called
await ctx.delay(ms);                       // how long to wait
```

Four copies of the stop check, four copies of the breaker, four copies of the wait, and — the
clearest sign that the copies had already drifted — the sentence
`"N kegagalan unduh PDF berturut-turut. Periksa sesi Coretax dan coba lagi."` written out twice,
verbatim, in two files' worth of the same function. Nothing said they had to stay the same, and a
rule change was four edits.

The drift had already cost something. The paginated grid RETRIES a failed page: it asks for the
same offset again, until the breaker trips. The two PDF loops and the targeted lookup do not —
they record the failure and move to the next item. Both behaviours are right for their flow, and
the shared code could not tell them apart, because the retry was written into the loop body rather
than declared.

`src/content/per-item.ts` is the loop, and the four flows are its adapters. A flow says what one
item MEANS:

```ts
export interface ItemFlow<TItem, TResult> {
  next(): ItemStep<TItem> | null;                       // the next unit of work
  status(step, attempt, result): string;                // the line the panel shows
  readonly reportWhen: "before" | "after";              // WHEN that line goes out
  attempt(step, attempt): Promise<TResult>;             // the work; a throw is a failure
  accept(result, step): boolean;                        // take the result; false ends the run
  recordFailure(step, error): void;                     // name a failed item
  exhausted(failures, error): void;                     // what giving up looks like
  readonly delayMs: number;                             // the wait after a success
  readonly failureDelayMs?: number;                     // the wait after a failure
  readonly retry?: ItemRetry;                           // how one item is retried
}
```

and the loop owns the rules around it: the stop check, the progress line, the breaker, the retry
and the wait.

Rationale:

1. **A STOP is not a FAILURE, and the module says so.** A stop ends the run at once and records
   nothing: the rows already collected are the run's, and a request the user cancelled is not a
   request that failed. A failure is named, counted and weighed against the breaker. The two were
   interleaved in the old bodies, one `if` apart, and a stop that fell through the failure path
   would have named a row the user never lost.
2. **A result that arrives after a stop is DROPPED, not taken.** The loop checks the stop between
   the work and the merge, so a page that lands after the user pressed stop does not add rows to a
   run that is already over. Every one of the four bodies had that check, in its own place, in
   its own words.
3. **The retry is DECLARED, not written into the body.** The targeted lookup declares two extra
   attempts and a linear backoff; the paginated grid declares none and instead hands the SAME page
   over again — which is the grid's own retry, and the reason its page counter counts attempts.
   The loop cannot confuse the two, because one is a declaration and the other is a decision the
   flow makes in `next()`.
4. **The breaker is measured once.** `breakerTripped(failures, limit)` is the only arithmetic, and
   the limit stays the run's own: the world answers "has the breaker tripped?" rather than the
   loop carrying a number of its own.
5. **How a run gives up stays with the flow.** The paginated grid THROWS (its orchestrator turns
   the throw into SCRAPE_ERROR) while the two PDF loops and the targeted lookup ANNOUNCE the end
   and return. Those are genuinely different: the first is a step inside a bigger run, the others
   are runs the user started on their own. The module measures the trip; the flow says what the
   trip means.
6. **The shared wording is written once.** The PDF failure sentence is one function
   (`pdfDownloadFailures()`) used by both PDF flows, so the two copies cannot drift again.

Consequences: `scraper-actions.ts` loses four hand-written loop bodies and gains four adapters;
`consecutiveFailuresExhausted()` stays, now as the binding of the shared arithmetic to a run's
own budget, so the existing breaker tests still describe the same thing. The module is pure — no
browser API, no DOM, no portal — so `per-item.unit.test.ts` drives it with a scripted flow: the
stop check before and after the work, the line before and after the item, the breaker, the
retry's growing backoff, the two delays, and the rule that a failed item is named once however
many attempts it took.

The behaviour is unchanged. Every existing case in `scraper-actions.unit.test.ts` — the short page
that ends the grid, the full page that adds nothing new, the truncation flag, the 2000 ms recovery
delay, the 800 ms PDF pacing, the escalating backoff, the isolated PDF failure that is partial but
completes, the cancellation that must not publish a completion — passes against the adapters
without being edited.

Status: accepted.
