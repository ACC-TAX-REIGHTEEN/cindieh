// ============================================================
// INJECTION-READINESS.TS — the wait for the portal's own DOM
// ============================================================
// Coretax is an Angular SPA that re-renders constantly, so an injected
// control often runs BEFORE the node it hangs off exists. That wait is one
// policy — a retry budget, an inter-attempt delay, the pending timers and
// their cancellation on navigation — and it used to be copied into every
// injector (ui.ts redeclared the budget to dodge a circular import, and the
// timer registry lived in ui-filters even though ui.ts's toolbar was its
// heaviest user).
//
// Now one module owns it. An injector wraps its attempt once and exposes the
// returned `run` under its own name; nothing else in the codebase sees a
// countdown, a delay or a timer handle.
//
// Stateful module, per the project's convention: `createInjectionLoop` is the
// factory (one loop per injector, so two injectors waiting at once never spend
// each other's budget), and the pending timers are module state behind
// `cancelInjectionLoops()` — the one call navigation and teardown make.
// ============================================================

/**
 * How many times a loop re-runs its attempt after the portal answered "not
 * ready yet". Fixed by how long Angular realistically takes to render a
 * toolbar; not a tuning knob any caller should reach for.
 */
export const INJECTION_MAX_RETRIES = 8;

/** Distance between two attempts of the same loop. */
export const INJECTION_RETRY_DELAY_MS = 1000;

/** Every timer a loop has outstanding, so one call can cancel all of them. */
const pendingTimers = new Set<ReturnType<typeof setTimeout>>();

/**
 * One injector's readiness loop.
 *
 * `attempt` does the whole job of one round — its own guards, its own lookup,
 * its own paint — and answers the only question this module asks: "was I able
 * to finish?" A `true` ends the round (built, already built, or nothing to
 * build here); a `false` means the portal has not rendered the node yet, and
 * the loop runs the same attempt again after the delay, at most
 * INJECTION_MAX_RETRIES times.
 *
 * The returned `run` is what callers invoke: a navigation tick or a
 * MutationObserver debounce. Every `run` starts a FRESH round — it supersedes
 * this loop's own pending attempt and restores the budget — which is what
 * makes repeated injections of a page that never becomes ready stoppable
 * rather than a poll that never ends.
 */
export function createInjectionLoop(attempt: () => boolean): () => void {
  let retriesLeft = INJECTION_MAX_RETRIES;
  let ownTimer: ReturnType<typeof setTimeout> | null = null;

  function forgetOwnTimer(): void {
    if (ownTimer === null) return;
    clearTimeout(ownTimer);
    pendingTimers.delete(ownTimer);
    ownTimer = null;
  }

  function step(): void {
    if (attempt()) {
      // Finished. Nothing is pending, and the next run() restores the budget.
      return;
    }
    if (retriesLeft <= 0) return;
    retriesLeft -= 1;

    const timer = setTimeout(() => {
      pendingTimers.delete(timer);
      if (ownTimer === timer) ownTimer = null;
      step();
    }, INJECTION_RETRY_DELAY_MS);
    pendingTimers.add(timer);
    ownTimer = timer;
  }

  return function run(): void {
    // One pending attempt per loop: a fresh run replaces this loop's own
    // instead of stacking a second chain beside it.
    forgetOwnTimer();
    retriesLeft = INJECTION_MAX_RETRIES;
    step();
  };
}

/**
 * Cancel every pending attempt, in every loop (call on navigation and on
 * teardown). Deliberately not per-loop: the caller that cancels is the one
 * leaving the page, and it must not have to know which injectors were waiting.
 */
export function cancelInjectionLoops(): void {
  for (const timer of pendingTimers) clearTimeout(timer);
  pendingTimers.clear();
}
