import { describe, expect, it, vi } from "vitest";
import type { ScraperContext } from "../content/scraper-actions";
import {
  PERIOD_ATTEMPTS,
  PERIOD_RETRY_DELAY_MS,
  runPeriodSweep,
  type PeriodSweepInput,
} from "../content/period-sweep";
import type { CapturedRequest, ScrapeComplete, ScrapeMessage } from "../content/scraper-types";
import { gridRequest, rawBodyWithSweep } from "./__mocks__/grid-requests";

// The sweep's rules are the ones a reader has to know before trusting a year of
// rows: each period is tried twice at most, a failed period is recorded and the
// sweep continues, a period the stop cut short is not counted, and a stop
// reports what finished. Each is asserted here against the LOOP itself, with a
// scripted fetcher, so the rules are no longer only visible through a real
// portal request.

const PERIODS = ["TD.00701", "TD.00702"];

function captured(): CapturedRequest {
  const fixture = gridRequest("OUTPUT_TAX");
  return {
    url: fixture.url ?? "",
    headers: { "Content-Type": "application/json" },
    body: null,
    rawBody: rawBodyWithSweep("OUTPUT_TAX", { period: "TD.00708", year: "2026" }),
    response: null,
    initialData: [],
    initialFirst: 0,
    source: "OUTPUT_TAX",
  };
}

function makeCtx(overrides: Partial<ScraperContext> = {}): ScraperContext {
  return {
    isStopRequested: () => false,
    sendToContent: vi.fn(),
    emitPdfDownload: vi.fn(),
    getMasaPajakFromDOM: () => "",
    delay: vi.fn(() => Promise.resolve()),
    timeout: 30000,
    maxErrors: 3,
    getLastCaptured: () => null,
    getLastCapturedTime: () => 0,
    getVisibleGridSource: () => null,
    getCurrentPageSource: () => null,
    isWithholdingPage: () => false,
    subscribeCapture: vi.fn(() => () => {}),
    queryElement: vi.fn(() => null),
    queryAllButtons: vi.fn(() => []),
    clickElement: vi.fn(),
    setTimeout: vi.fn(() => 0),
    clearTimeout: vi.fn(),
    ...overrides,
  };
}

function sent(ctx: ScraperContext): ScrapeMessage[] {
  return vi.mocked(ctx.sendToContent).mock.calls.map(([message]) => message);
}

function completionOf(ctx: ScraperContext): ScrapeComplete | undefined {
  return sent(ctx).find((message) => message.type === "SCRAPE_COMPLETE") as
    | ScrapeComplete
    | undefined;
}

/**
 * Run the real loop over one captured request.
 *
 * `rows` is the same object the fetcher writes into, because that is how the
 * production adapter works: `scrapePaginated` merges into the Run's one
 * accumulator, and the sweep counts around the call.
 */
function sweep(
  fetchPeriod: PeriodSweepInput["fetchPeriod"],
  ctx: ScraperContext = makeCtx(),
  periods: string[] = PERIODS,
) {
  const rows = { allData: [] as Record<string, unknown>[] };
  return {
    rows,
    ctx,
    run: () =>
      runPeriodSweep({
        captured: captured(),
        periods,
        ctx,
        rows,
        startedAt: Date.now(),
        fetchPeriod,
      }),
  };
}

describe("runPeriodSweep — the loop", () => {
  it("fetches every period in order, into ONE accumulator, counting each one", async () => {
    const { run, rows, ctx } = sweep(async (period) => {
      rows.allData.push({ RecordId: rows.allData.length, period });
      return { page: 2, truncated: false };
    });

    const result = await run();

    expect(result.stopped).toBe(false);
    expect(result.summary.counts).toEqual([
      { period: "TD.00701", rows: 1 },
      { period: "TD.00702", rows: 1 },
    ]);
    // `planned` is the year it was ASKED for, which a stopped sweep needs to say
    // "10 dari 12" later.
    expect(result.summary.planned).toBe(2);
    expect(result.pages).toBe(4);
    expect(result.summary.failedPeriods).toEqual([]);
    expect(result.summary.emptyPeriods).toEqual([]);
    // Nothing to report: an accepted sweep is completed by its caller.
    expect(completionOf(ctx)).toBeUndefined();
  });

  it("counts the rows each period ADDED, not the accumulator's running total", async () => {
    const { run, rows } = sweep(async (period) => {
      rows.allData.push({ RecordId: 1, period }, { RecordId: 2, period });
      return { page: 1, truncated: false };
    });

    const result = await run();

    expect(result.summary.counts.map((count) => count.rows)).toEqual([2, 2]);
    expect(result.summary.totalRows).toBe(4);
  });

  it("reports progress after each FINISHED period, and paces the pause between them", async () => {
    const { run, rows, ctx } = sweep(async (period) => {
      rows.allData.push({ RecordId: rows.allData.length, period });
      return { page: 1, truncated: false };
    });

    await run();

    const progress = sent(ctx).filter((message) => message.type === "SCRAPE_PROGRESS");
    expect(progress.map((message) => (message as { status: string }).status)).toEqual([
      "Masa 1/2 (TD.00701) — 1 baris",
      "Masa 2/2 (TD.00702) — 2 baris",
    ]);
    // One gap between two periods, and no pause after the last one.
    expect(vi.mocked(ctx.delay).mock.calls.map(([ms]) => ms)).toEqual([100]);
  });

  it("keeps a period's truncation finding for the run", async () => {
    const { run, rows } = sweep(async (period) => {
      rows.allData.push({ RecordId: 1, period });
      return { page: 1, truncated: true };
    });

    expect((await run()).truncated).toBe(true);
  });

  it("finds a masa that came back empty between non-empty neighbours", async () => {
    // The empty month is the middle one; the loop records it as empty rather
    // than leaving it out of the counts.
    const { run, rows } = sweep(
      async (period) => {
        if (period !== "TD.00702") rows.allData.push({ RecordId: 1, period });
        return { page: 1, truncated: false };
      },
      makeCtx(),
      ["TD.00701", "TD.00702", "TD.00703"],
    );

    expect((await run()).summary.emptyPeriods).toEqual(["TD.00702"]);
  });
});

describe("runPeriodSweep — one retry", () => {
  it(`tries a period at most ${PERIOD_ATTEMPTS} times, on the SAME period, and pauses first`, async () => {
    const calls: string[] = [];
    const { run, rows, ctx } = sweep(async (period) => {
      calls.push(period);
      if (calls.length === 1) throw new Error("504 Gateway Timeout");
      rows.allData.push({ RecordId: calls.length, period });
      return { page: 1, truncated: false };
    });

    const result = await run();

    // Asking for the NEXT period after a failure would skip a month and call it
    // a success; a third attempt would be a retry loop.
    expect(calls).toEqual(["TD.00701", "TD.00701", "TD.00702"]);
    expect(result.summary.counts.map((count) => [count.period, count.rows])).toEqual([
      ["TD.00701", 1],
      ["TD.00702", 1],
    ]);
    expect(result.summary.failedPeriods).toEqual([]);
    // The retry pause is paced like every other delay: 2000 at the default preset.
    expect(vi.mocked(ctx.delay).mock.calls.map(([ms]) => ms)).toEqual([PERIOD_RETRY_DELAY_MS, 100]);
  });

  it("records a period as failed only after the retry failed too, and keeps sweeping", async () => {
    const calls: string[] = [];
    const { run, rows } = sweep(async (period) => {
      calls.push(period);
      if (calls.length <= 2) throw new Error("504 Gateway Timeout");
      rows.allData.push({ RecordId: 3, period });
      return { page: 1, truncated: false };
    });

    const result = await run();

    expect(calls).toEqual(["TD.00701", "TD.00701", "TD.00702"]);
    expect(result.summary.counts).toEqual([
      { period: "TD.00701", rows: 0, error: "504 Gateway Timeout" },
      { period: "TD.00702", rows: 1 },
    ]);
    expect(result.summary.failedPeriods).toEqual(["TD.00701"]);
    expect(result.stopped).toBe(false);
  });

  it("does not start the retry once the run is stopped during the retry pause", async () => {
    let stop = false;
    const fetchPeriod = vi.fn(async () => {
      throw new Error("504 Gateway Timeout");
    });
    const delay = vi.fn(() => {
      stop = true;
      return Promise.resolve();
    });
    const { run } = sweep(fetchPeriod, makeCtx({ isStopRequested: () => stop, delay }));

    const result = await run();

    expect(fetchPeriod).toHaveBeenCalledTimes(1);
    expect(delay.mock.calls).toEqual([[PERIOD_RETRY_DELAY_MS]]);
    expect(result.stopped).toBe(true);
  });
});

describe("runPeriodSweep — a stop", () => {
  it("reports the masa that finished, and nothing about the one the stop cut short", async () => {
    // The stop lands in the pause between periods, so period one is whole and
    // period two was never asked for.
    let stop = false;
    const delay = vi.fn(() => {
      stop = true;
      return Promise.resolve();
    });
    const ctx = makeCtx({ isStopRequested: () => stop, delay });
    const { run, rows } = sweep(async (period) => {
      rows.allData.push({ RecordId: rows.allData.length, period });
      return { page: 2, truncated: period === "TD.00701" };
    }, ctx);

    const result = await run();

    expect(result.stopped).toBe(true);
    expect(result.summary.counts.map((count) => count.period)).toEqual(["TD.00701"]);
    const complete = completionOf(ctx);
    expect(complete).toBeDefined();
    expect(complete?.cancelled).toBe(true);
    // Not a rejected partial run: the rows are real, only the request is open.
    expect(complete?.partial).toBeUndefined();
    expect(complete?.data).toEqual([{ RecordId: 0, period: "TD.00701" }]);
    expect(complete?.total).toBe(1);
    expect(complete?.pages).toBe(2);
    // A sweep is named for the YEAR, and the receiver adds the partial marker at
    // export time.
    expect(complete?.filenameHint).toBe("2026");
    expect(complete?.periods?.planned).toBe(2);
    expect(complete?.periods?.counts.map((count) => count.period)).toEqual(["TD.00701"]);
    // A finished period's truncation finding survives into the stop report.
    expect(complete?.truncated).toBe(true);
    // A stop is not a scrape error: it is not a transport failure.
    expect(sent(ctx).find((message) => message.type === "SCRAPE_ERROR")).toBeUndefined();
  });

  it("keeps the rows a stopped period had already added, without counting it", async () => {
    // The stop lands mid-period, so the page loop drops the response it was
    // waiting for. Rows already in the accumulator are the run's and stay there;
    // the interrupted period is neither a month with rows nor an empty one.
    let stop = false;
    const { run, rows, ctx } = sweep(async (period) => {
      rows.allData.push({ RecordId: rows.allData.length + 1, period });
      if (rows.allData.length === 2) stop = true;
      return { page: 1, truncated: false };
    }, makeCtx({ isStopRequested: () => stop }));

    const result = await run();

    expect(result.summary.counts.map((count) => count.period)).toEqual(["TD.00701"]);
    expect(completionOf(ctx)?.data).toHaveLength(2);
    expect(completionOf(ctx)?.total).toBe(2);
    expect(completionOf(ctx)?.periods?.counts).toHaveLength(1);
  });

  it("sends nothing when a stop arrives before any row did", async () => {
    let stop = false;
    const ctx = makeCtx({ isStopRequested: () => stop });
    const { run } = sweep(async () => {
      stop = true;
      return { page: 1, truncated: false };
    }, ctx);

    await run();

    // Nothing was collected, so there is nothing to keep and no file to name:
    // the panel's own cancellation line is the whole truth.
    expect(sent(ctx).find((message) => message.type === "SCRAPE_COMPLETE")).toBeUndefined();
  });

  it("does not fetch anything when the run is already stopped", async () => {
    const fetchPeriod = vi.fn(async () => ({ page: 1, truncated: false }));
    const { run } = sweep(fetchPeriod, makeCtx({ isStopRequested: () => true }));

    const result = await run();

    expect(fetchPeriod).not.toHaveBeenCalled();
    expect(result.stopped).toBe(true);
  });
});
