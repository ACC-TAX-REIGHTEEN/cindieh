// Unit tests for injection-readiness.ts — the one module that owns the wait
// for Angular to render the node an injector hangs off: the retry budget, the
// delay, the pending timers and their cancellation on navigation.
//
// These cases pin the POLICY. Whether a given injector asks the right
// readiness question is each injector's own suite (ui-filters.unit.test.ts,
// ui-export-dropdown.unit.test.ts).
import { describe, it, expect, vi, afterEach } from "vitest";

import {
  INJECTION_MAX_RETRIES,
  INJECTION_RETRY_DELAY_MS,
  cancelInjectionLoops,
  createInjectionLoop,
} from "../content/injection-readiness";

afterEach(() => {
  cancelInjectionLoops();
  vi.useRealTimers();
});

/** An attempt that stays "not ready" until `failures` runs have happened. */
function notReadyUntil(failures: number): { attempt: () => boolean; runs: () => number } {
  let runs = 0;
  return {
    attempt: () => (runs += 1) > failures,
    runs: () => runs,
  };
}

describe("createInjectionLoop", () => {
  it("paints on the first attempt when the portal's node is already there", () => {
    vi.useFakeTimers();
    const attempt = vi.fn(() => true);

    createInjectionLoop(attempt)();

    expect(attempt).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("comes back for the node on every delay until it renders", () => {
    vi.useFakeTimers();
    const { attempt, runs } = notReadyUntil(3);
    const run = createInjectionLoop(attempt);

    run();
    expect(runs()).toBe(1);
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(INJECTION_RETRY_DELAY_MS);
    vi.advanceTimersByTime(INJECTION_RETRY_DELAY_MS);
    expect(runs()).toBe(3);
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(INJECTION_RETRY_DELAY_MS);
    expect(runs()).toBe(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("gives up after INJECTION_MAX_RETRIES instead of polling forever", () => {
    vi.useFakeTimers();
    const attempt = vi.fn(() => false);
    const run = createInjectionLoop(attempt);

    run();
    vi.advanceTimersByTime(INJECTION_RETRY_DELAY_MS * (INJECTION_MAX_RETRIES + 10));

    // The first attempt plus its retries — then silence, no timer left running.
    expect(attempt).toHaveBeenCalledTimes(INJECTION_MAX_RETRIES + 1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("restores the budget on the next run, so a later paint still retries", () => {
    vi.useFakeTimers();
    const attempt = vi.fn(() => false);
    const run = createInjectionLoop(attempt);

    run();
    vi.advanceTimersByTime(INJECTION_RETRY_DELAY_MS * (INJECTION_MAX_RETRIES + 10));
    expect(attempt).toHaveBeenCalledTimes(INJECTION_MAX_RETRIES + 1);

    run();
    vi.advanceTimersByTime(INJECTION_RETRY_DELAY_MS * (INJECTION_MAX_RETRIES + 10));
    expect(attempt).toHaveBeenCalledTimes((INJECTION_MAX_RETRIES + 1) * 2);
  });

  it("keeps one pending attempt per run — a fresh run supersedes its own", () => {
    vi.useFakeTimers();
    const attempt = vi.fn(() => false);
    const run = createInjectionLoop(attempt);

    run();
    run();
    run();
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(INJECTION_RETRY_DELAY_MS);
    expect(attempt).toHaveBeenCalledTimes(4);
  });

  it("gives each loop its own budget, so one stalled injector cannot starve another", () => {
    vi.useFakeTimers();
    const stalled = vi.fn(() => false);
    const landing = notReadyUntil(1);

    createInjectionLoop(stalled)();
    // Spend the stalled loop's budget, then the second loop's own round:
    vi.advanceTimersByTime(INJECTION_RETRY_DELAY_MS * (INJECTION_MAX_RETRIES + 10));
    expect(stalled).toHaveBeenCalledTimes(INJECTION_MAX_RETRIES + 1);

    createInjectionLoop(landing.attempt)();
    vi.advanceTimersByTime(INJECTION_RETRY_DELAY_MS);

    expect(landing.runs()).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("cancelInjectionLoops", () => {
  it("cancels every loop's pending attempt (navigation teardown)", () => {
    vi.useFakeTimers();
    const first = vi.fn(() => false);
    const second = vi.fn(() => false);
    createInjectionLoop(first)();
    createInjectionLoop(second)();
    expect(vi.getTimerCount()).toBe(2);

    cancelInjectionLoops();
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(INJECTION_RETRY_DELAY_MS * (INJECTION_MAX_RETRIES + 10));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("is safe to call when nothing is pending", () => {
    expect(() => cancelInjectionLoops()).not.toThrow();
    expect(() => cancelInjectionLoops()).not.toThrow();
  });
});
