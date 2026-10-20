// ============================================================
// PER-ITEM.TS — the MAIN world's per-item loop
// ============================================================
//
// Four flows in the MAIN world walk a list of things one at a time: the
// paginated grid, the withholding slips, the e-Faktur rows and the invoice
// numbers of a targeted lookup. Each of them used to hand-roll the same five
// rules — when to stop, what the panel is told, when to give up, what a
// failure is called, and how long to wait — so a rule change was four edits,
// and the "N kegagalan unduh PDF berturut-turut" sentence was written twice,
// verbatim.
//
// This module is those rules, once. A flow supplies an `ItemFlow` — what one
// item MEANS — and the loop does the rest:
//
//   for each item:
//     stop?            -> the run ends
//     report           -> what the panel is told
//     attempt          -> the item's own work; a throw is a failure
//     stop?            -> the run ends
//     take the result  -> the flow says whether there is a next item
//     wait
//
// What stays in the flow is what is genuinely that flow's: what an item is
// called, what its work is, what its result does, and what its failure is
// called. What moves here is what the four flows SHARED, which is the point.
//
// Three things are worth naming, because they are easy to confuse:
//
//   - A STOP is not a failure. A stop ends the run at once and records
//     nothing: the rows already collected are the run's, and a request the
//     user cancelled is not a request that failed.
//   - A FAILURE is not a stop. It is named, counted, and weighed against the
//     breaker; the run gives up when too many arrive in a row.
//   - The BREAKER is measured once, here. How a run gives up — throwing, or
//     announcing the end itself — stays with the flow, because the two are
//     not the same thing: the paginated scrape throws (its orchestrator turns
//     the throw into SCRAPE_ERROR) while the two PDF loops and the targeted
//     lookup announce the failure and end quietly.
//
// Pure: no browser API, no DOM, no portal. The four adapters in
// scraper-actions.ts supply the world.
// ============================================================

/**
 * One unit of work, with the position the run reports it at.
 *
 * `index` is 1-based: it is the page number for the paginated grid and the
 * item's place in the list for the three PDF/lookup flows. `total` is 0 when
 * the flow has no count to offer — the paginated grid's item count is a
 * number of ROWS, which the flow reports itself.
 */
export interface ItemStep<TItem> {
  /** What the item is. */
  readonly value: TItem;
  /** Where the item sits, counting from 1. */
  readonly index: number;
  /** How many items there are, or 0 when the flow has no count. */
  readonly total: number;
}

/** What the panel is told while the loop works. */
export interface ItemProgress {
  /** The line the panel shows. */
  readonly status: string;
  /** Where the item sits, counting from 1. */
  readonly index: number;
  /** How many items there are, or 0 when the flow has no count. */
  readonly total: number;
  /** Which attempt this is, counting from 1. */
  readonly attempt: number;
  /** How many items have failed so far. */
  readonly failureCount: number;
}

/**
 * How one item is retried.
 *
 * `extraAttempts` is how many attempts BEYOND the first one the item gets.
 * `backoffMs` is the base of a linear backoff: attempt n waits
 * `backoffMs * (n - 1)`, so the second attempt waits one base and the third
 * waits two.
 */
export interface ItemRetry {
  /** How many attempts beyond the first one the item gets. */
  readonly extraAttempts: number;
  /** The base of the linear backoff between attempts. */
  readonly backoffMs: number;
}

/**
 * What one flow's items MEAN.
 *
 * The flow owns the item — what it is, what it is called, what its work is
 * and what its result does. The loop owns the rules around it.
 */
export interface ItemFlow<TItem, TResult> {
  /**
   * The next unit of work, or null when the run is over.
   *
   * Called once per item, before the item is worked on. A flow that asks for
   * a FAILED item again (the paginated grid re-requests the page that failed)
   * simply hands the same item over with a new index.
   */
  next(): ItemStep<TItem> | null;
  /**
   * The line the panel shows for this item.
   *
   * `result` is undefined for a "before" report and the item's result for an
   * "after" one, so a flow that reports after the work can say what the work
   * brought.
   */
  status(step: ItemStep<TItem>, attempt: number, result: TResult | undefined): string;
  /**
   * WHEN the line goes out: before the item is worked on, or after it
   * succeeded.
   *
   * A failure is never reported this way — a failed item is named in the
   * run's own failure report instead, which is what a user can act on.
   */
  readonly reportWhen: "before" | "after";
  /** The item's work. Throwing is what makes the item a failure. */
  attempt(step: ItemStep<TItem>, attempt: number): Promise<TResult>;
  /**
   * Take a successful result. Return false to end the run.
   *
   * The result is taken only after the stop check, so a result that arrives
   * after the user pressed stop is dropped rather than merged.
   */
  accept(result: TResult, step: ItemStep<TItem>): boolean;
  /** Name a failed item — the run's own failure report. */
  recordFailure(step: ItemStep<TItem>, error: unknown): void;
  /**
   * What the run does when the breaker trips.
   *
   * THROW to abort the whole run (the orchestrator turns the throw into
   * SCRAPE_ERROR); RETURN to end the run after saying why.
   */
  exhausted(failures: number, error: unknown): void;
  /** The wait after a successful item, in ms. */
  readonly delayMs: number;
  /** The wait after a FAILED item, in ms. Defaults to `delayMs`. */
  readonly failureDelayMs?: number;
  /** How one item is retried. Omitted means one attempt and no more. */
  readonly retry?: ItemRetry;
}

/** What the loop needs of the world it runs in. */
export interface ItemLoopDeps {
  /** Returns true when a stop has been requested. */
  isStopped(): boolean;
  /** Report the line the panel shows. */
  progress(state: ItemProgress): void;
  /**
   * True once the failures in a row have reached the limit.
   *
   * The world owns the limit (it is the run's own budget), so the loop asks
   * the world rather than carrying a number of its own.
   */
  breakerTripped(failures: number): boolean;
  /** Wait. */
  delay(ms: number): Promise<void>;
}

/** What the loop leaves behind. */
export interface ItemLoopResult {
  /** How many items failed. */
  readonly failures: number;
  /** Whether a stop ended the run. */
  readonly stopped: boolean;
  /** Whether the breaker gave the run up. */
  readonly exhausted: boolean;
}

/**
 * True once `failures` failures in a row reach the limit.
 *
 * The breaker's arithmetic lives here so the limit is measured in one place.
 */
export function breakerTripped(failures: number, limit: number): boolean {
  return failures >= limit;
}

/**
 * Walk a flow's items under the rules every one of them shared.
 *
 * The loop owns the stop check, the progress line, the breaker, the retry and
 * the wait. The flow owns the item.
 */
export async function runItems<TItem, TResult>(
  flow: ItemFlow<TItem, TResult>,
  deps: ItemLoopDeps,
): Promise<ItemLoopResult> {
  let failures = 0;
  let consecutiveFailures = 0;

  for (;;) {
    if (deps.isStopped()) return { failures, stopped: true, exhausted: false };

    const step = flow.next();
    if (step === null) return { failures, stopped: false, exhausted: false };

    const maxAttempts = (flow.retry?.extraAttempts ?? 0) + 1;
    // The wait between attempts grows linearly: the second attempt waits one
    // base, the third two. A flow with no retry never reaches it.
    const backoffMs = flow.retry?.backoffMs ?? 0;
    let succeeded = false;
    let keepGoing = true;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (deps.isStopped()) return { failures, stopped: true, exhausted: false };

      if (flow.reportWhen === "before") {
        deps.progress(progressState(flow, step, attempt, failures, undefined));
      }
      if (attempt > 1) {
        await deps.delay(backoffMs * (attempt - 1));
        if (deps.isStopped()) return { failures, stopped: true, exhausted: false };
      }

      try {
        const result = await flow.attempt(step, attempt);
        if (deps.isStopped()) return { failures, stopped: true, exhausted: false };
        keepGoing = flow.accept(result, step);
        consecutiveFailures = 0;
        succeeded = true;
        if (flow.reportWhen === "after") {
          deps.progress(progressState(flow, step, attempt, failures, result));
        }
        break;
      } catch (error) {
        if (deps.isStopped()) return { failures, stopped: true, exhausted: false };
        lastError = error;
        if (attempt < maxAttempts) continue;
        break;
      }
    }

    if (succeeded) {
      // The flow said there is no next item: the run is over, and it does not
      // wait for an item that will never come.
      if (!keepGoing) return { failures, stopped: false, exhausted: false };
      await deps.delay(flow.delayMs);
      continue;
    }

    // The item failed for good. It is named, counted, and weighed against the
    // breaker.
    failures++;
    consecutiveFailures++;
    flow.recordFailure(step, lastError);
    if (deps.breakerTripped(consecutiveFailures)) {
      flow.exhausted(consecutiveFailures, lastError);
      return { failures, stopped: false, exhausted: true };
    }
    await deps.delay(flow.failureDelayMs ?? flow.delayMs);
  }
}

/** The panel's line, and the numbers that go with it. */
function progressState<TItem, TResult>(
  flow: ItemFlow<TItem, TResult>,
  step: ItemStep<TItem>,
  attempt: number,
  failureCount: number,
  result: TResult | undefined,
): ItemProgress {
  return {
    status: flow.status(step, attempt, result),
    index: step.index,
    total: step.total,
    attempt,
    failureCount,
  };
}
