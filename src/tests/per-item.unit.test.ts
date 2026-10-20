// Unit tests for per-item.ts — the MAIN world's per-item loop.
//
// The module is pure, so the suite drives it with a scripted flow and a
// stub world: no portal, no DOM, no browser API.
import { describe, it, expect, vi } from "vitest";

import {
  runItems,
  breakerTripped,
  type ItemFlow,
  type ItemLoopDeps,
  type ItemProgress,
  type ItemStep,
} from "../content/per-item";

/** What the scripted flow did, for the suite to read. */
interface Scripted<TItem, TResult> {
  flow: ItemFlow<TItem, TResult>;
  /** The items the flow handed over, in order. */
  handed: TItem[];
  /** The items the flow recorded as failed, in order. */
  failed: TItem[];
  /** How many results the flow accepted. */
  accepted: number;
  /** The attempts each item took, in order. */
  attempts: number[];
}

/**
 * A flow over a fixed list.
 *
 * `work` answers what one attempt of one item does: return a result, or
 * throw to fail the attempt.
 */
function scripted<TItem, TResult>(
  items: TItem[],
  work: (item: TItem, attempt: number) => TResult | Promise<TResult>,
  options: {
    reportWhen?: "before" | "after";
    status?: (step: ItemStep<TItem>, attempt: number) => string;
    delayMs?: number;
    failureDelayMs?: number;
    retry?: { extraAttempts: number; backoffMs: number };
    accept?: (result: TResult, step: ItemStep<TItem>) => boolean;
  } = {},
): Scripted<TItem, TResult> {
  const handed: TItem[] = [];
  const failed: TItem[] = [];
  const attempts: number[] = [];
  let index = 0;
  let accepted = 0;

  const flow: ItemFlow<TItem, TResult> = {
    next: () => {
      if (index >= items.length) return null;
      const item = items[index];
      index++;
      handed.push(item);
      return { value: item, index, total: items.length };
    },
    reportWhen: options.reportWhen ?? "before",
    status:
      options.status ??
      ((step, attempt) => `item ${step.index}/${step.total} attempt ${attempt}`),
    attempt: async (step, attempt) => {
      attempts.push(attempt);
      return work(step.value, attempt);
    },
    accept: (result, step) => {
      accepted++;
      return options.accept ? options.accept(result, step) : true;
    },
    recordFailure: (step) => {
      failed.push(step.value);
    },
    exhausted: () => {},
    delayMs: options.delayMs ?? 100,
    failureDelayMs: options.failureDelayMs,
    retry: options.retry,
  };

  return {
    flow,
    handed,
    failed,
    attempts,
    get accepted() {
      return accepted;
    },
  };
}

/** A stub world: a stop flag, a progress log, a delay log and a breaker. */
function makeDeps(overrides: Partial<ItemLoopDeps> = {}): ItemLoopDeps {
  return {
    isStopped: () => false,
    progress: vi.fn(),
    breakerTripped: (failures) => breakerTripped(failures, 3),
    delay: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

/** The lines the world was told to show. */
function linesOf(deps: ItemLoopDeps): string[] {
  return vi.mocked(deps.progress).mock.calls.map(([state]) => state.status);
}

/** The states the world was told about. */
function statesOf(deps: ItemLoopDeps): ItemProgress[] {
  return vi.mocked(deps.progress).mock.calls.map(([state]) => state);
}

// ── breakerTripped ────────────────────────────────────────────────────────────

describe("breakerTripped", () => {
  it("trips once the failures in a row reach the limit", () => {
    expect(breakerTripped(0, 3)).toBe(false);
    expect(breakerTripped(2, 3)).toBe(false);
    expect(breakerTripped(3, 3)).toBe(true);
    expect(breakerTripped(4, 3)).toBe(true);
  });
});

// ── runItems ─────────────────────────────────────────────────────────────────

describe("runItems", () => {
  it("walks every item and accepts every result", async () => {
    const script = scripted(["a", "b", "c"], (item) => item.toUpperCase());
    const deps = makeDeps();

    const result = await runItems(script.flow, deps);

    expect(script.handed).toEqual(["a", "b", "c"]);
    expect(script.accepted).toBe(3);
    expect(result).toEqual({ failures: 0, stopped: false, exhausted: false });
  });

  it("reports the line before the item is worked on", async () => {
    const { flow } = scripted(["a", "b"], () => "ok", { reportWhen: "before" });
    const deps = makeDeps();

    await runItems(flow, deps);

    expect(linesOf(deps)).toEqual([
      "item 1/2 attempt 1",
      "item 2/2 attempt 1",
    ]);
  });

  it("reports the line only after the item succeeded", async () => {
    const { flow } = scripted(["a"], () => "ok", { reportWhen: "after" });
    const deps = makeDeps();

    await runItems(flow, deps);

    expect(linesOf(deps)).toEqual(["item 1/1 attempt 1"]);
  });

  it("does not report a failed item", async () => {
    const { flow } = scripted(["a"], () => {
      throw new Error("boom");
    }, { reportWhen: "before" });
    const deps = makeDeps();

    await runItems(flow, deps);

    // The line for the attempt went out before the work; there is no second
    // line for the failure — a failed item is named in the failure report.
    expect(linesOf(deps)).toEqual(["item 1/1 attempt 1"]);
  });

  it("carries the item's position and the failure count into the progress", async () => {
    const { flow } = scripted(["a", "b"], (item) => {
      if (item === "a") throw new Error("boom");
      return "ok";
    });
    const deps = makeDeps();

    await runItems(flow, deps);

    const states = statesOf(deps);
    expect(states[0]).toMatchObject({ index: 1, total: 2, attempt: 1, failureCount: 0 });
    expect(states[1]).toMatchObject({ index: 2, total: 2, attempt: 1, failureCount: 1 });
  });

  it("names a failed item, counts it, and carries on with the next", async () => {
    const { flow, failed, handed } = scripted(["a", "b"], (item) => {
      if (item === "a") throw new Error("boom");
      return "ok";
    });
    const deps = makeDeps();

    const result = await runItems(flow, deps);

    expect(failed).toEqual(["a"]);
    expect(handed).toEqual(["a", "b"]);
    expect(result.failures).toBe(1);
  });

  it("gives the run up when the failures in a row reach the limit", async () => {
    const { flow, failed, handed } = scripted(["a", "b", "c"], () => {
      throw new Error("boom");
    });
    const deps = makeDeps();
    const exhausted = vi.fn();
    flow.exhausted = exhausted;

    const result = await runItems(flow, deps);

    expect(exhausted).toHaveBeenCalledTimes(1);
    expect(exhausted.mock.calls[0][0]).toBe(3);
    expect(failed).toEqual(["a", "b", "c"]);
    // The run ended at the third failure: the fourth item is never handed over.
    expect(handed).toEqual(["a", "b", "c"]);
    expect(result.exhausted).toBe(true);
  });

  it("lets the flow's own give-up throw, and the throw travels out", async () => {
    const { flow } = scripted(["a"], () => {
      throw new Error("boom");
    });
    const deps = makeDeps({ breakerTripped: () => true });
    flow.exhausted = () => {
      throw new Error("3 failures in a row");
    };

    await expect(runItems(flow, deps)).rejects.toThrow("3 failures in a row");
  });

  it("counts the failures in a row, not the failures in the run", async () => {
    // A success between two failures resets the counter, so the run never
    // reaches the limit.
    const { flow } = scripted(["a", "b", "c"], (item) => {
      if (item === "b") return "ok";
      throw new Error("boom");
    });
    const deps = makeDeps();

    const result = await runItems(flow, deps);

    expect(result.failures).toBe(2);
    expect(result.exhausted).toBe(false);
  });

  it("stops before the first item when a stop was requested", async () => {
    const { flow, handed } = scripted(["a"], () => "ok");
    const deps = makeDeps({ isStopped: () => true });

    const result = await runItems(flow, deps);

    expect(handed).toEqual([]);
    expect(result).toEqual({ failures: 0, stopped: true, exhausted: false });
  });

  it("drops a result that arrives after a stop instead of taking it", async () => {
    let stopped = false;
    const { flow, accepted } = scripted(["a"], () => {
      stopped = true;
      return "ok";
    });
    const deps = makeDeps({ isStopped: () => stopped });

    const result = await runItems(flow, deps);

    expect(accepted).toBe(0);
    expect(result.stopped).toBe(true);
  });

  it("does not work on an item the stop caught while it was handed over", async () => {
    let stopped = false;
    const { flow, handed } = scripted(["a"], () => "ok");
    // The flow's own hand-over is where the stop arrives.
    const original = flow.next.bind(flow);
    flow.next = () => {
      const step = original();
      stopped = true;
      return step;
    };
    const deps = makeDeps({ isStopped: () => stopped });

    const result = await runItems(flow, deps);

    expect(handed).toEqual(["a"]);
    expect(result.stopped).toBe(true);
  });

  it("ends the run when the flow says there is no next item", async () => {
    const { flow, handed } = scripted(["a", "b"], () => "ok", {
      accept: (_result, step) => step.index < 2,
    });
    const deps = makeDeps();

    await runItems(flow, deps);

    // The second item was worked on, and the flow said the run was over, so
    // the third was never asked for.
    expect(handed).toEqual(["a", "b"]);
  });

  it("waits the flow's delay after a successful item", async () => {
    const { flow } = scripted(["a", "b"], () => "ok", { delayMs: 250 });
    const deps = makeDeps();

    await runItems(flow, deps);

    expect(vi.mocked(deps.delay)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(deps.delay)).toHaveBeenCalledWith(250);
  });

  it("waits the failure delay after a failed item, and the flow's own after a success", async () => {
    const { flow } = scripted(["a", "b"], (item) => {
      if (item === "a") throw new Error("boom");
      return "ok";
    }, { delayMs: 100, failureDelayMs: 2000 });
    const deps = makeDeps();

    await runItems(flow, deps);

    expect(vi.mocked(deps.delay)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(deps.delay)).toHaveBeenNthCalledWith(1, 2000);
    expect(vi.mocked(deps.delay)).toHaveBeenNthCalledWith(2, 100);
  });

  it("falls back to the flow's delay when no failure delay is declared", async () => {
    const { flow } = scripted(["a"], () => {
      throw new Error("boom");
    }, { delayMs: 75 });
    const deps = makeDeps();

    await runItems(flow, deps);

    expect(vi.mocked(deps.delay)).toHaveBeenCalledWith(75);
  });

  it("retries a failed item, waiting a growing backoff between the attempts", async () => {
    const { flow, failed, attempts } = scripted(["a"], (item, attempt) => {
      if (attempt < 3) throw new Error("boom");
      return "ok";
    }, { retry: { extraAttempts: 2, backoffMs: 1000 } });
    const deps = makeDeps();

    const result = await runItems(flow, deps);

    expect(attempts).toEqual([1, 2, 3]);
    // One base before the second attempt, two before the third.
    expect(vi.mocked(deps.delay)).toHaveBeenNthCalledWith(1, 1000);
    expect(vi.mocked(deps.delay)).toHaveBeenNthCalledWith(2, 2000);
    // The item succeeded, so it was never recorded as a failure.
    expect(failed).toEqual([]);
    expect(result.failures).toBe(0);
  });

  it("reports the attempt number while it retries", async () => {
    const { flow } = scripted(["a"], (item, attempt) => {
      if (attempt < 2) throw new Error("boom");
      return "ok";
    }, { retry: { extraAttempts: 1, backoffMs: 10 } });
    const deps = makeDeps();

    await runItems(flow, deps);

    expect(linesOf(deps)).toEqual(["item 1/1 attempt 1", "item 1/1 attempt 2"]);
  });

  it("records a failed item once, however many attempts it took", async () => {
    const { flow, failed, attempts } = scripted(["a"], () => {
      throw new Error("boom");
    }, { retry: { extraAttempts: 2, backoffMs: 10 } });
    const deps = makeDeps();

    const result = await runItems(flow, deps);

    expect(attempts).toEqual([1, 2, 3]);
    expect(failed).toEqual(["a"]);
    expect(result.failures).toBe(1);
  });

  it("stops retrying when a stop arrives during the backoff", async () => {
    let stopped = false;
    const { flow, attempts } = scripted(["a"], () => {
      throw new Error("boom");
    }, { retry: { extraAttempts: 2, backoffMs: 10 } });
    const deps = makeDeps({
      isStopped: () => stopped,
      delay: vi.fn(async () => {
        stopped = true;
      }),
    });

    const result = await runItems(flow, deps);

    expect(attempts).toEqual([1]);
    expect(result.stopped).toBe(true);
    expect(result.failures).toBe(0);
  });

  it("does not wait for an item the flow will never hand over", async () => {
    const { flow } = scripted(["a"], () => "ok", {
      accept: () => false,
      delayMs: 100,
    });
    const deps = makeDeps();

    await runItems(flow, deps);

    // The run ended with the item, so no wait was paid for a next one.
    expect(vi.mocked(deps.delay)).not.toHaveBeenCalled();
  });
});
