// Unit tests for scraper-intercept.ts
// Tests interceptRequest, isCacheValid, and triggerXhrCapture
// without any browser environment.
import { describe, it, expect, vi } from "vitest";
import {
  interceptRequest,
  isCacheValid,
  triggerXhrCapture,
} from "../content/scraper-intercept";
import type { ScraperContext } from "../content/scraper-actions";
import type { CapturedRequest } from "../content/scraper-types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeCapture(source = "OUTPUT_TAX"): CapturedRequest {
  return {
    url: "https://example.com/api/list",
    headers: {},
    body: null,
    rawBody: "{}",
    response: null,
    initialData: [],
    initialFirst: 0,
    source: source as CapturedRequest["source"],
  };
}

type TimerFn = (fn: () => void, ms: number) => unknown;
type ClearTimerFn = (h: unknown) => void;

/**
 * Build a fake ScraperContext with controllable state.
 * Only the request-capture members are wired for behaviour;
 * the orchestration members are no-op stubs (never called by
 * intercept-focused tests).
 * setTimeout/clearTimeout are vitest spies that record calls
 * but do NOT auto-fire — tests control timer execution manually.
 */
function makeCtx(opts: {
  signal?: AbortSignal;
  lastCaptured?: CapturedRequest | null;
  lastCapturedTime?: number;
  visibleGridSource?: CapturedRequest["source"] | null;
  currentPageSource?: CapturedRequest["source"] | null;
  isWithholdingPage?: boolean;
  queryElementResult?: Element | null;
  buttons?: Array<{ id?: string; textContent?: string; querySelector?: (sel: string) => Element | null }>;
}): ScraperContext & {
  _subscribers: Array<(req: CapturedRequest) => void>;
  _unsubscribeCalls: number;
  _timeouts: Array<{ fn: () => void; ms: number }>;
  _clearTimeoutHandles: unknown[];
  _clickedElements: Element[];
} {
  const subscribers: Array<(req: CapturedRequest) => void> = [];
  let unsubscribeCalls = 0;
  const timeouts: Array<{ fn: () => void; ms: number }> = [];
  const clearTimeoutHandles: unknown[] = [];
  const clickedElements: Element[] = [];

  return {
    signal: opts.signal,
    // ── Orchestration stubs (not exercised by intercept tests) ────
    isStopRequested: vi.fn(() => false),
    sendToContent: vi.fn(),
    emitPdfDownload: vi.fn(),
    getMasaPajakFromDOM: vi.fn(() => ""),
    delay: vi.fn(() => Promise.resolve()),
    timeout: 30000,
    maxErrors: 3,

    // ── Request capture (fully wired for these tests) ────
    getLastCaptured: () => opts.lastCaptured ?? null,
    getLastCapturedTime: () => opts.lastCapturedTime ?? 0,
    getVisibleGridSource: () => opts.visibleGridSource ?? null,
    getCurrentPageSource: () => opts.currentPageSource ?? null,
    isWithholdingPage: () => opts.isWithholdingPage ?? false,
    subscribeCapture: vi.fn((fn) => {
      subscribers.push(fn);
      return () => {
        const idx = subscribers.indexOf(fn);
        if (idx > -1) subscribers.splice(idx, 1);
        unsubscribeCalls++;
      };
    }),
    queryElement: vi.fn(() => opts.queryElementResult ?? null),
    queryAllButtons: vi.fn(() => (opts.buttons ?? []) as HTMLButtonElement[]),
    clickElement: vi.fn((el) => { clickedElements.push(el); }),
    setTimeout: vi.fn((fn, ms) => {
      const handle = timeouts.length;
      timeouts.push({ fn, ms });
      return handle;
    }) as TimerFn,
    clearTimeout: vi.fn((h) => { clearTimeoutHandles.push(h); }) as ClearTimerFn,
    _subscribers: subscribers,
    get _unsubscribeCalls() { return unsubscribeCalls; },
    _timeouts: timeouts,
    _clearTimeoutHandles: clearTimeoutHandles,
    _clickedElements: clickedElements,
  };
}

// ── isCacheValid ─────────────────────────────────────────────────────────────

describe("isCacheValid", () => {
  it("returns false when no request has been captured", () => {
    const ctx = makeCtx({ lastCaptured: null });
    expect(isCacheValid(ctx)).toBe(false);
  });

  it("returns false when cache is older than 5 minutes", () => {
    const oldTime = Date.now() - 301_000; // 5m 1s ago
    const ctx = makeCtx({
      lastCaptured: makeCapture("OUTPUT_TAX"),
      lastCapturedTime: oldTime,
      currentPageSource: "OUTPUT_TAX",
    });
    expect(isCacheValid(ctx)).toBe(false);
  });

  it("returns true when cache is fresh and visible grid source matches", () => {
    const ctx = makeCtx({
      lastCaptured: makeCapture("SPT_A2"),
      lastCapturedTime: Date.now() - 1000,
      visibleGridSource: "SPT_A2",
    });
    expect(isCacheValid(ctx)).toBe(true);
  });

  it("returns true when cache is fresh and page source matches", () => {
    const ctx = makeCtx({
      lastCaptured: makeCapture("OUTPUT_TAX"),
      lastCapturedTime: Date.now() - 1000,
      currentPageSource: "OUTPUT_TAX",
    });
    expect(isCacheValid(ctx)).toBe(true);
  });

  it("returns true when cache is fresh and isWithholdingPage is true for WITHHOLDING_SLIPS", () => {
    const ctx = makeCtx({
      lastCaptured: makeCapture("WITHHOLDING_SLIPS"),
      lastCapturedTime: Date.now() - 1000,
      isWithholdingPage: true,
    });
    expect(isCacheValid(ctx)).toBe(true);
  });

  it("returns false when source does not match any of the three conditions", () => {
    const ctx = makeCtx({
      lastCaptured: makeCapture("OUTPUT_TAX"),
      lastCapturedTime: Date.now() - 1000,
      visibleGridSource: "SPT_A2",  // different source
      currentPageSource: "INPUT_TAX",  // different source
      isWithholdingPage: false,
    });
    expect(isCacheValid(ctx)).toBe(false);
  });

  it("accepts a cache that is well inside the TTL boundary (e.g. 4m50s ago)", () => {
    const wellInsideTTL = Date.now() - 290_000; // 4m50s — comfortably inside the 5m TTL
    const ctx = makeCtx({
      lastCaptured: makeCapture("OUTPUT_TAX"),
      lastCapturedTime: wellInsideTTL,
      currentPageSource: "OUTPUT_TAX",
    });
    expect(isCacheValid(ctx)).toBe(true);
  });
});

// ── triggerXhrCapture ─────────────────────────────────────────────────────────

describe("triggerXhrCapture", () => {
  it("clicks the next-page button when it exists", () => {
    const nextBtn = { id: "next", textContent: "" } as unknown as Element;
    const ctx = makeCtx({ queryElementResult: nextBtn });
    triggerXhrCapture(ctx);
    expect(ctx._clickedElements).toContain(nextBtn);
  });

  it("does NOT query buttons when next-page button exists", () => {
    const nextBtn = {} as unknown as Element;
    const ctx = makeCtx({ queryElementResult: nextBtn });
    triggerXhrCapture(ctx);
    expect(ctx.queryAllButtons).not.toHaveBeenCalled();
  });

  it("falls back to search button when next-page button is absent", () => {
    const searchBtn = { id: "btn-cari", textContent: "Cari Data", querySelector: () => null };
    const ctx = makeCtx({
      queryElementResult: null,
      buttons: [searchBtn],
    });
    triggerXhrCapture(ctx);
    expect(ctx._clickedElements.length).toBe(1);
  });

  it("falls back to refresh button by text", () => {
    const refreshBtn = { id: "btn-refresh", textContent: "Refresh", querySelector: () => null };
    const ctx = makeCtx({
      queryElementResult: null,
      buttons: [refreshBtn],
    });
    triggerXhrCapture(ctx);
    expect(ctx._clickedElements.length).toBe(1);
  });

  it("skips buttons whose id starts with ch-", () => {
    const ownBtn = { id: "ch-export-btn", textContent: "Cari", querySelector: () => null };
    const ctx = makeCtx({
      queryElementResult: null,
      buttons: [ownBtn],
    });
    triggerXhrCapture(ctx);
    expect(ctx._clickedElements.length).toBe(0);
  });

  it("falls back to button with .pi-search icon", () => {
    const iconBtn = {
      id: "icon-btn",
      textContent: "",
      querySelector: (sel: string) => sel === ".pi-search" ? {} as Element : null,
    };
    const ctx = makeCtx({
      queryElementResult: null,
      buttons: [iconBtn],
    });
    triggerXhrCapture(ctx);
    expect(ctx._clickedElements.length).toBe(1);
  });

  it("does nothing when no buttons match", () => {
    const ctx = makeCtx({
      queryElementResult: null,
      buttons: [],
    });
    triggerXhrCapture(ctx);
    expect(ctx._clickedElements.length).toBe(0);
  });
});

// ── interceptRequest ──────────────────────────────────────────────────────────

describe("interceptRequest", () => {
  it.each([false, true])("rejects pre-aborted signals without capture or clicks (cache=%s)", async (cached) => {
    const controller = new AbortController();
    controller.abort();
    const ctx = makeCtx({
      signal: controller.signal,
      lastCaptured: cached ? makeCapture() : null,
      lastCapturedTime: Date.now(),
      currentPageSource: "OUTPUT_TAX",
    });
    await expect(interceptRequest(ctx)).rejects.toMatchObject({ name: "AbortError" });
    expect(ctx.subscribeCapture).not.toHaveBeenCalled();
    expect(ctx._timeouts).toHaveLength(0);
    expect(ctx._clickedElements).toHaveLength(0);
  });

  it("cancels both timers and the subscription without clicking or accepting stale capture", async () => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const ctx = makeCtx({ signal: controller.signal, queryElementResult: {} as Element });
    const promise = interceptRequest(ctx);
    const staleCapture = ctx._subscribers[0];
    controller.abort();
    for (const timer of ctx._timeouts) timer.fn();
    staleCapture(makeCapture());
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(ctx._clearTimeoutHandles).toEqual([0, 1]);
    expect(ctx._unsubscribeCalls).toBe(1);
    expect(ctx._subscribers).toHaveLength(0);
    expect(ctx._clickedElements).toHaveLength(0);
    expect(remove).toHaveBeenCalledExactlyOnceWith("abort", add.mock.calls[0][1]);
  });

  it.each(["capture", "timeout"] as const)("cleans up on %s and ignores subsequent abort", async (event) => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const ctx = makeCtx({ signal: controller.signal });
    const promise = interceptRequest(ctx);
    if (event === "capture") {
      ctx._subscribers[0](makeCapture());
      await expect(promise).resolves.toBeDefined();
    } else {
      ctx._timeouts[1].fn();
      await expect(promise).rejects.toThrow("Timeout");
    }
    controller.abort();
    ctx._timeouts[0].fn();
    expect(ctx._clearTimeoutHandles).toEqual([0, 1]);
    expect(ctx._unsubscribeCalls).toBe(1);
    expect(remove).toHaveBeenCalledOnce();
    expect(ctx.queryElement).not.toHaveBeenCalled();
  });

  it("cleans up a synchronous capture without scheduling timers", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const ctx = makeCtx({ signal: controller.signal });
    const unsubscribe = vi.fn();
    const captured = makeCapture();
    ctx.subscribeCapture = (fn) => {
      fn(captured);
      return unsubscribe;
    };
    await expect(interceptRequest(ctx)).resolves.toBe(captured);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(ctx._timeouts).toHaveLength(0);
  });
  it("resolves immediately with cached request when cache is valid", async () => {
    const captured = makeCapture("OUTPUT_TAX");
    const ctx = makeCtx({
      lastCaptured: captured,
      lastCapturedTime: Date.now() - 1000,
      currentPageSource: "OUTPUT_TAX",
    });

    const result = await interceptRequest(ctx);
    expect(result).toBe(captured);
    // No timers should be scheduled for the fast path
    expect(ctx._timeouts.length).toBe(0);
  });

  it("registers a capture subscriber when cache is invalid", () => {
    const ctx = makeCtx({ lastCaptured: null });
    interceptRequest(ctx); // don't await — runs async
    expect(ctx.subscribeCapture).toHaveBeenCalledOnce();
  });

  it("schedules two timers (trigger + timeout) when cache is invalid", () => {
    const ctx = makeCtx({ lastCaptured: null });
    interceptRequest(ctx);
    expect(ctx._timeouts.length).toBe(2);
  });

  it("schedules trigger timer with 500ms delay", () => {
    const ctx = makeCtx({ lastCaptured: null });
    interceptRequest(ctx);
    const triggerTimer = ctx._timeouts.find((t) => t.ms === 500);
    expect(triggerTimer).toBeDefined();
  });

  it("schedules timeout rejection timer with 15000ms delay", () => {
    const ctx = makeCtx({ lastCaptured: null });
    interceptRequest(ctx);
    const timeoutTimer = ctx._timeouts.find((t) => t.ms === 15000);
    expect(timeoutTimer).toBeDefined();
  });

  it("resolves when a capture subscriber is called", async () => {
    const ctx = makeCtx({ lastCaptured: null });
    const promise = interceptRequest(ctx);

    // Simulate an XHR being captured
    const captured = makeCapture("OUTPUT_TAX");
    ctx._subscribers[0](captured);

    const result = await promise;
    expect(result).toBe(captured);
  });

  it("clears the timeout handle when resolved via subscriber", async () => {
    const ctx = makeCtx({ lastCaptured: null });
    const promise = interceptRequest(ctx);

    ctx._subscribers[0](makeCapture());

    await promise;
    expect(ctx._clearTimeoutHandles).toEqual([0, 1]);
    expect(ctx._unsubscribeCalls).toBe(1);
    expect(ctx._subscribers).toHaveLength(0);
    ctx._timeouts[0].fn();
    expect(ctx.queryElement).not.toHaveBeenCalled();
  });

  it("rejects with a descriptive error message on timeout", async () => {
    const ctx = makeCtx({ lastCaptured: null });
    const promise = interceptRequest(ctx);

    // Fire the timeout timer manually
    const timeoutTimer = ctx._timeouts.find((t) => t.ms === 15000)!;
    timeoutTimer.fn();

    await expect(promise).rejects.toThrow("Tidak ada request tertangkap (Timeout)");
  });

  it("removes the subscriber from the list when the timeout fires", async () => {
    const ctx = makeCtx({ lastCaptured: null });
    const promise = interceptRequest(ctx);

    expect(ctx._subscribers.length).toBe(1);
    const timeoutTimer = ctx._timeouts.find((t) => t.ms === 15000)!;
    timeoutTimer.fn();

    try { await promise; } catch { /* expected */ }
    expect(ctx._subscribers.length).toBe(0);
  });

  it("does not reject again if subscriber fires after timeout", async () => {
    const ctx = makeCtx({ lastCaptured: null });
    const promise = interceptRequest(ctx);

    // Timeout fires first
    const timeoutTimer = ctx._timeouts.find((t) => t.ms === 15000)!;
    timeoutTimer.fn();

    // Then a stale subscriber fires — should be a no-op
    if (ctx._subscribers.length > 0) {
      ctx._subscribers[0](makeCapture());
    }

    // Promise should still reject (not resolve)
    await expect(promise).rejects.toThrow();
  });
});
