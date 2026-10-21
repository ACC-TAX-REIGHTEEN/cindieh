// Unit tests for the year-wide batch sweep in scraper-actions.ts.
//
// The batch's claims are all structural -- ONE dedupe set across twelve
// periods, per-period row counts as the only completeness signal, and a captured
// request with no period filter failing loudly instead of re-scraping one month
// twelve times -- so each is pinned here against the real orchestration loop
// rather than against a helper that merely looks right.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../content/scraper-xhr", () => ({
  xhrRequest: vi.fn(),
  xhrRequestByInvoice: vi.fn(),
  xhrDownloadWithholdingPdf: vi.fn(),
  xhrDownloadEfakturPdf: vi.fn(),
}));

import { startScraping, scrapePaginated } from "../content/scraper-actions";
import type { OrchestrationContext } from "../content/scraper-context";
import { xhrRequest } from "../content/scraper-xhr";
import type { CapturedRequest, ScrapeComplete, ScrapeMessage } from "../content/scraper-types";
import type { GridPage } from "../content/scraper-xhr";
import { emptyPeriods, failedPeriods } from "../content/sweep";
import {
  capturedFilters,
  gridRequest,
  rawBodyWithFilters,
  rawBodyWithoutSweepFilter,
  rawBodyWithSweep,
} from "./__mocks__/grid-requests";

const mockedXhrRequest = vi.mocked(xhrRequest);

/**
 * The captured PPN Keluaran request, re-asked for one period of one year.
 *
 * Built from the fixture rather than written out here: the sweep is only ever
 * exercised against the body the portal actually sends, so a change in what the
 * portal sends changes what these tests prove instead of passing unnoticed.
 */
function capturedWithFilters(period: string, year = "2026"): CapturedRequest {
  const fixture = gridRequest("OUTPUT_TAX");
  return {
    url: fixture.url ?? "",
    headers: { "Content-Type": "application/json" },
    body: null,
    rawBody: rawBodyWithSweep("OUTPUT_TAX", { period, year }),
    response: null,
    initialData: [],
    initialFirst: 0,
    source: "OUTPUT_TAX",
  };
}

/**
 * The captured PPN Masukan request, as the portal sent it: the selected month
 * as a LIST of codes (ADR-0043).
 */
function capturedMasukan(): CapturedRequest {
  const fixture = gridRequest("INPUT_TAX");
  return {
    url: fixture.url ?? "",
    headers: { "Content-Type": "application/json" },
    body: null,
    rawBody: fixture.rawBody,
    response: null,
    initialData: [],
    initialFirst: 0,
    source: "INPUT_TAX",
  };
}

function makeCtx(overrides: Partial<OrchestrationContext> = {}): OrchestrationContext {
  return {
    isStopRequested: () => false,
    sendToContent: vi.fn(),
    emitPdfDownload: vi.fn(),
    getMasaPajakFromDOM: () => "",
    delay: vi.fn(() => Promise.resolve()),
    timeout: 30000,
    maxErrors: 3,
    ...overrides,
  };
}

function page(rows: Record<string, unknown>[], total: number | null = null): GridPage {
  return { rows, total };
}

function monthOf(period: unknown): number {
  return Number(String(period).slice(-2));
}

/** Every message the run sent, typed by discriminant. */
function sent(ctx: OrchestrationContext): ScrapeMessage[] {
  return vi.mocked(ctx.sendToContent).mock.calls.map(([msg]) => msg);
}

function completionOf(ctx: OrchestrationContext): ScrapeComplete {
  const found = sent(ctx).find((msg) => msg.type === "SCRAPE_COMPLETE");
  expect(found, "expected a SCRAPE_COMPLETE").toBeDefined();
  return found as unknown as ScrapeComplete;
}

/** The `Filters` array each request carried, read back off the real body. */
function filtersPerRequest(): { period: unknown; matchMode: unknown; status: unknown }[] {
  return mockedXhrRequest.mock.calls.map((call) => {
    const overrides = (call[5] ?? {}) as {
      Filters?: { PropertyName: string; Value: unknown; MatchMode?: string }[];
    };
    const pick = (name: string) => overrides.Filters?.find((f) => f.PropertyName === name);
    return {
      period: pick("TaxInvoicePeriod")?.Value,
      matchMode: pick("TaxInvoicePeriod")?.MatchMode,
      status: pick("TaxInvoiceStatus")?.Value,
    };
  });
}

describe("year-wide batch sweep", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("sweeps every month of the year in ONE run, in order, oldEST first", async () => {
    mockedXhrRequest.mockResolvedValue(page([{ RecordId: 1 }]));
    const ctx = makeCtx();
    await startScraping(async () => capturedWithFilters("TD.00708"), ctx, { batchMonths: 12 });

    const periods = filtersPerRequest().map((f) => f.period);
    expect(periods).toEqual([
      "TD.00701",
      "TD.00702",
      "TD.00703",
      "TD.00704",
      "TD.00705",
      "TD.00706",
      "TD.00707",
      "TD.00708",
      "TD.00709",
      "TD.00710",
      "TD.00711",
      "TD.00712",
    ]);
    // ONE completion, not twelve: a twelve-file export is not the feature.
    expect(sent(ctx).filter((m) => m.type === "SCRAPE_COMPLETE")).toHaveLength(1);
  });

  it("sweeps only the months asked for", async () => {
    mockedXhrRequest.mockResolvedValue(page([{ RecordId: 1 }]));
    const ctx = makeCtx();
    await startScraping(async () => capturedWithFilters("TD.00708"), ctx, { batchMonths: 3 });
    expect(filtersPerRequest().map((f) => f.period)).toEqual([
      "TD.00701",
      "TD.00702",
      "TD.00703",
    ]);
  });

  // ── Resuming a stopped sweep ────────────────────

  it("resumes over the masa still missing, in year order, and asks for nothing else", async () => {
    mockedXhrRequest.mockResolvedValue(page([{ RecordId: 1 }]));
    const ctx = makeCtx();

    await startScraping(async () => capturedWithFilters("TD.00708"), ctx, {
      sweepPeriods: ["TD.00711", "TD.00712"],
      sweepYear: "2026",
    });

    // Two requests, not twelve: the kept months are not fetched twice, and the
    // codes go out in the year's order however they arrived.
    expect(filtersPerRequest().map((f) => f.period)).toEqual(["TD.00711", "TD.00712"]);
  });

  it("narrows a resume against the portal's own year plan, never beyond it", async () => {
    mockedXhrRequest.mockResolvedValue(page([{ RecordId: 1 }]));
    const ctx = makeCtx();

    await startScraping(async () => capturedWithFilters("TD.00708"), ctx, {
      // A code from another prefix (a stale list, or another grid's plan) is
      // dropped rather than requested: a period value invented anywhere but the
      // portal's own request is one the portal has never heard of (ADR-0018).
      sweepPeriods: ["TD.00711", "ZZ.99911"],
      sweepYear: "2026",
    });

    expect(filtersPerRequest().map((f) => f.period)).toEqual(["TD.00711"]);
  });

  it("refuses a resume whose grid no longer filters to the kept year", async () => {
    mockedXhrRequest.mockResolvedValue(page([{ RecordId: 1 }]));
    const ctx = makeCtx();

    await startScraping(async () => capturedWithFilters("TD.00708", "2025"), ctx, {
      sweepPeriods: ["TD.00711"],
      sweepYear: "2026",
    });

    // Not one request: the period code carries no year of its own, so sweeping
    // it under a 2025 filter would put 2025's August in a 2026 file.
    expect(mockedXhrRequest).not.toHaveBeenCalled();
    const error = sent(ctx).find((m) => m.type === "SCRAPE_ERROR") as { message: string };
    expect(error.message).toMatch(/2025/);
    expect(error.message).toMatch(/2026/);
  });

  it("refuses a resume whose codes match nothing in this grid's year", async () => {
    mockedXhrRequest.mockResolvedValue(page([{ RecordId: 1 }]));
    const ctx = makeCtx();

    await startScraping(async () => capturedWithFilters("TD.00708"), ctx, {
      sweepPeriods: ["ZZ.99911"],
      sweepYear: "2026",
    });

    expect(mockedXhrRequest).not.toHaveBeenCalled();
    const error = sent(ctx).find((m) => m.type === "SCRAPE_ERROR") as { message: string };
    expect(error.message).toMatch(/tidak cocok/i);
  });

  it("reports the masa IT fetched, because the receiver unions them in", async () => {
    mockedXhrRequest.mockResolvedValue(page([{ RecordId: 1 }]));
    const ctx = makeCtx();

    await startScraping(async () => capturedWithFilters("TD.00708"), ctx, {
      sweepPeriods: ["TD.00711", "TD.00712"],
      sweepYear: "2026",
    });

    const periods = completionOf(ctx).periods;
    expect(periods?.counts.map((c) => c.period)).toEqual(["TD.00711", "TD.00712"]);
    // The sweep reports its OWN scope; the receiver merges these counts with the
    // kept ones, and THAT is where the year's 12 comes back (sweep.mergeSweeps).
    expect(periods?.plan.length).toBe(2);
  });

  it("carries every other filter through untouched -- only the period's Value changes", async () => {
    mockedXhrRequest.mockResolvedValue(page([{ RecordId: 1 }]));
    const ctx = makeCtx();
    await startScraping(async () => capturedWithFilters("TD.00708"), ctx, { batchMonths: 2 });

    const sentFilters = filtersPerRequest();
    // Dropping TaxInvoiceStatus or MatchMode would silently widen the sweep to
    // statuses the user never asked for, or turn equals into a prefix match.
    // Both expectations are read from the CAPTURE, so the claim is "identical to
    // what the portal sent" rather than "identical to this test's idea of it" —
    // which is how a hand-built body used to pass against a value no request had.
    const capture = capturedFilters("OUTPUT_TAX");
    const status = capture.find((filter) => filter.PropertyName === "TaxInvoiceStatus")?.Value;
    const periodMatchMode = capture.find(
      (filter) => filter.PropertyName === "TaxInvoicePeriod",
    )?.MatchMode;
    expect(status, "the capture must carry a status filter").toBeDefined();
    expect(sentFilters[0].status).toEqual(status);
    expect(sentFilters[1].status).toEqual(status);
    expect(sentFilters[0].matchMode).toBe(periodMatchMode);
    expect(sentFilters[1].matchMode).toBe(periodMatchMode);
    // The one thing that DOES change, per request: the period itself.
    expect(sentFilters[0].period).toBe("TD.00701");
    expect(sentFilters[1].period).toBe("TD.00702");
  });

  it("shares ONE dedupe set across periods, so an invoice in two months is collected once", async () => {
    // Every page returns the same rows: only a shared `seen` set turns that into
    // one row instead of one per period. A per-period set would report 12.
    mockedXhrRequest.mockResolvedValue(page([{ RecordId: 7, TaxInvoiceNumber: "INV-1" }]));
    const ctx = makeCtx();
    await startScraping(async () => capturedWithFilters("TD.00708"), ctx, { batchMonths: 12 });

    const complete = completionOf(ctx);
    expect(complete.total).toBe(1);
    expect(complete.data).toHaveLength(1);
  });

  it("keeps distinct invoices from distinct periods", async () => {
    // The other direction of the same guard: over-deduping would silently drop
    // a month's real rows, which is worse than a duplicate.
    let call = 0;
    mockedXhrRequest.mockImplementation(async () => {
      const id = ++call;
      return page([{ RecordId: id, TaxInvoiceNumber: `INV-${id}` }]);
    });
    const ctx = makeCtx();
    await startScraping(async () => capturedWithFilters("TD.00708"), ctx, { batchMonths: 4 });
    expect(completionOf(ctx).total).toBe(4);
  });

  it("reports each period's own row count, which is the only completeness signal there is", async () => {
    mockedXhrRequest.mockImplementation(async (_c, _f, _r, _t, _s, overrides) => {
      const filters = (overrides ?? {}) as {
        Filters?: { PropertyName: string; Value: unknown }[];
      };
      const period = filters.Filters?.find((f) => f.PropertyName === "TaxInvoicePeriod")?.Value;
      // Distinct ids per period: the shared dedupe set would otherwise drop
      // month three's row as a duplicate of month one's, and the test would
      // be measuring the dedupe rather than the per-period counts.
      const rows = period === "TD.00702" ? [] : [{ RecordId: monthOf(period) }];
      return page(rows);
    });
    const ctx = makeCtx();
    await startScraping(async () => capturedWithFilters("TD.00708"), ctx, { batchMonths: 3 });

    const periods = completionOf(ctx).periods;
    expect(periods?.counts.map((c) => [c.period, c.rows])).toEqual([
      ["TD.00701", 1],
      ["TD.00702", 0],
      ["TD.00703", 1],
    ]);
    // February between two populated months is a month that vanished, and the
    // server's count is useless here (it answers Rows + 1), so this flag is the
    // only way the user finds out.
    expect(emptyPeriods(periods!)).toEqual(["TD.00702"]);
    expect(failedPeriods(periods!)).toEqual([]);
    expect(periods?.totalRows).toBe(2);
  });

  it("does not call an all-empty sweep anomalous", async () => {
    mockedXhrRequest.mockResolvedValue(page([]));
    const ctx = makeCtx();
    await startScraping(async () => capturedWithFilters("TD.00708"), ctx, { batchMonths: 3 });
    // A taxpayer with no data at all is not a fault; flagging it would train
    // the user to ignore the flag that matters.
    expect(emptyPeriods(completionOf(ctx).periods!)).toEqual([]);
  });

  it("drops the server's per-period count rather than comparing it against the whole year", async () => {
    mockedXhrRequest.mockResolvedValue(page([{ RecordId: 1 }], 501));
    const ctx = makeCtx();
    await startScraping(async () => capturedWithFilters("TD.00708"), ctx, { batchMonths: 3 });
    const complete = completionOf(ctx);
    // 501 is one period's count; twelve of them is not the year, and reporting
    // it would put a false "may be incomplete" notice on every batch.
    expect(complete.expectedTotal).toBeUndefined();
  });

  it("names the file for the YEAR, not for the month the grid was filtered to", async () => {
    mockedXhrRequest.mockResolvedValue(page([{ RecordId: 1 }]));
    const ctx = makeCtx();
    await startScraping(async () => capturedWithFilters("TD.00708", "2026"), ctx, { batchMonths: 12 });
    // A file called for August that holds twelve months is a name nobody
    // checks a filing against.
    expect(completionOf(ctx).filenameHint).toBe("2026");
  });

  it("FAILS rather than re-scraping one period twelve times when the request has no period filter", async () => {
    mockedXhrRequest.mockResolvedValue(page([{ RecordId: 1 }]));
    const ctx = makeCtx();
    const noPeriod: CapturedRequest = {
      ...capturedWithFilters("TD.00708"),
      rawBody: rawBodyWithFilters("OUTPUT_TAX", []),
    };
    await startScraping(async () => noPeriod, ctx, { batchMonths: 12 });

    // The silent version of this bug reports a year's worth of one month's rows.
    expect(mockedXhrRequest).not.toHaveBeenCalled();
    expect(sent(ctx).find((m) => m.type === "SCRAPE_COMPLETE")).toBeUndefined();
    expect(sent(ctx).find((m) => m.type === "SCRAPE_ERROR")).toBeDefined();
  });

  it("FAILS rather than sweeping a month code across every year when the request has no year filter", async () => {
    mockedXhrRequest.mockResolvedValue(page([{ RecordId: 1 }]));
    const ctx = makeCtx();
    // The period code carries no year of its own: TaxInvoiceYear is a SEPARATE
    // filter. Without it the twelve requests read one month code across every
    // year the account has, and the file would be named for a year that was
    // never filtered to.
    const noYear: CapturedRequest = {
      ...capturedWithFilters("TD.00708"),
      rawBody: rawBodyWithoutSweepFilter("OUTPUT_TAX", "year"),
    };
    await startScraping(async () => noYear, ctx, { batchMonths: 12 });

    expect(mockedXhrRequest).not.toHaveBeenCalled();
    expect(sent(ctx).find((m) => m.type === "SCRAPE_COMPLETE")).toBeUndefined();
    const error = sent(ctx).find((m) => m.type === "SCRAPE_ERROR");
    expect((error as { message?: string } | undefined)?.message).toContain("TaxInvoiceYear");
  });

  it("refuses a grid whose sweep filters were never measured", async () => {
    // The request carries perfectly ordinary filters; what is missing is a
    // measured row for the GRID (ADR-0019). No name hint, value shape or
    // lookalike spelling buys a sweep on a grid nobody has read.
    mockedXhrRequest.mockResolvedValue(page([{ RecordId: 1 }]));
    const ctx = makeCtx();
    const request: CapturedRequest = {
      ...capturedWithFilters("TD.00708"),
      source: "SPT_A2",
    };
    await startScraping(async () => request, ctx, { batchMonths: 12 });

    expect(mockedXhrRequest).not.toHaveBeenCalled();
    expect(sent(ctx).find((m) => m.type === "SCRAPE_COMPLETE")).toBeUndefined();
    const error = sent(ctx).find((m) => m.type === "SCRAPE_ERROR");
    expect((error as { message?: string } | undefined)?.message).toMatch(/belum pernah diukur/);
  });

  it("sweeps PPN Masukan, whose period filter arrives as a LIST of codes", async () => {
    // The portal sends the selected months as a list (`["TD.00709"]`, MatchMode
    // "contains") and was measured honouring ONE code written back as a plain
    // string (ADR-0043). The sweep plans twelve months from that list and asks
    // for one code at a time.
    mockedXhrRequest.mockResolvedValue(page([{ RecordId: 1 }]));
    const ctx = makeCtx();
    await startScraping(async () => capturedMasukan(), ctx, { batchMonths: 12 });

    const requests = filtersPerRequest();
    expect(requests.map((f) => f.period)).toEqual([
      "TD.00701",
      "TD.00702",
      "TD.00703",
      "TD.00704",
      "TD.00705",
      "TD.00706",
      "TD.00707",
      "TD.00708",
      "TD.00709",
      "TD.00710",
      "TD.00711",
      "TD.00712",
    ]);
    // The list is what the portal SENDS and the string is what it READS — and
    // the filter's own MatchMode is kept, because the server filters on it.
    expect(requests.every((f) => f.matchMode === "contains")).toBe(true);
    expect(sent(ctx).find((m) => m.type === "SCRAPE_ERROR")).toBeUndefined();
    expect(completionOf(ctx).filenameHint).toBe("2026");
  });

  it("does not require a year filter for an ordinary single-period scrape", async () => {
    // The guard belongs to the sweep: one period is fetched with the filters the
    // grid itself sent, so an ordinary export still works on a request that
    // carries no year.
    mockedXhrRequest.mockResolvedValue(page([{ RecordId: 1 }]));
    const ctx = makeCtx();
    const noYear: CapturedRequest = {
      ...capturedWithFilters("TD.00708"),
      rawBody: rawBodyWithoutSweepFilter("OUTPUT_TAX", "year"),
    };
    await startScraping(async () => noYear, ctx);

    expect(mockedXhrRequest).toHaveBeenCalled();
    expect(completionOf(ctx).total).toBe(1);
  });

  it("paginates each period from the start", async () => {
    // First/Rows must come back to 0 for period two, or it would continue from
    // where period one stopped and collect nothing.
    mockedXhrRequest.mockResolvedValue(page([{ RecordId: 1 }]));
    const ctx = makeCtx();
    await startScraping(async () => capturedWithFilters("TD.00708"), ctx, { batchMonths: 2 });
    expect(mockedXhrRequest.mock.calls.map((call) => call[1])).toEqual([0, 0]);
  });

  it("reports the masa it finished when the run is cancelled", async () => {
    // The stop lands while the SECOND period is in flight: the first month is
    // fully collected, the second is cut short (its response is dropped with the
    // request, which is the stop's job), and eleven more were never asked for.
    let stop = false;
    let call = 0;
    mockedXhrRequest.mockImplementation(async () => {
      call += 1;
      if (call === 1) return page([{ RecordId: 1 }]);
      stop = true;
      return page([{ RecordId: 2 }]);
    });
    const ctx = makeCtx({ isStopRequested: () => stop });
    await startScraping(async () => capturedWithFilters("TD.00708"), ctx, { batchMonths: 12 });

    expect(mockedXhrRequest).toHaveBeenCalledTimes(2);
    const complete = completionOf(ctx);
    // The months that did finish are kept, and flagged as a STOP rather than as
    // a partial run: the receiver saves them for a deliberate export and runs
    // nothing automatically, and the file it can make says "sebagian" in its
    // name (run-lifecycle.salvage, exporter's marker).
    expect(complete.cancelled).toBe(true);
    expect(complete.partial).toBeUndefined();
    expect(complete.total).toBe(1);
    expect(complete.data).toEqual([{ RecordId: 1 }]);
    // The year, because that is what a sweep is named for — the marker is added
    // at export time, not baked into a hint other exports would inherit.
    expect(complete.filenameHint).toBe("2026");
    // How much of the year arrived: a row count cannot say that ten of twelve
    // months are there and two are missing.
    expect(complete.periods?.plan.length).toBe(12);
    // Only the month that FINISHED is counted. The interrupted one is not an
    // empty month, and reporting it as one would send the user to the portal to
    // look for data the sweep never finished asking for.
    expect(complete.periods?.counts.map((c) => c.period)).toEqual(["TD.00701"]);
    expect(emptyPeriods(complete.periods!)).toEqual([]);
  });

  it("keeps the pages of the period the stop interrupted", async () => {
    // The stop lands mid-period, so the abort makes that period fail. The rows
    // already fetched must not go with it, and the stop must not be reported as
    // a scrape error — it is not a transport failure.
    let stop = false;
    let call = 0;
    mockedXhrRequest.mockImplementation(async () => {
      call += 1;
      if (call === 1) return page([{ RecordId: 1 }]);
      stop = true;
      throw new Error("AbortError: run dibatalkan");
    });
    const ctx = makeCtx({ isStopRequested: () => stop });
    await startScraping(async () => capturedWithFilters("TD.00708"), ctx, { batchMonths: 12 });

    const complete = completionOf(ctx);
    expect(complete.cancelled).toBe(true);
    expect(complete.data).toEqual([{ RecordId: 1 }]);
    expect(sent(ctx).find((m) => m.type === "SCRAPE_ERROR")).toBeUndefined();
    // The interrupted period is not a "failed masa": it is the one the user
    // stopped, and it is simply not in the counts.
    expect(failedPeriods(complete.periods!)).toEqual([]);
    expect(complete.periods?.counts.map((c) => c.period)).toEqual(["TD.00701"]);
  });

  it("sends nothing when a stop arrives before any row did", async () => {
    let stop = false;
    mockedXhrRequest.mockImplementation(async () => {
      stop = true;
      return page([]);
    });
    const ctx = makeCtx({ isStopRequested: () => stop });
    await startScraping(async () => capturedWithFilters("TD.00708"), ctx, { batchMonths: 12 });

    // Nothing was collected, so there is nothing to keep and no file to name:
    // the panel's own cancellation line is the whole truth.
    expect(sent(ctx).find((m) => m.type === "SCRAPE_COMPLETE")).toBeUndefined();
  });

  it("retries a failed period ONCE, so one transient failure does not cost the rest of the year", async () => {
    // maxErrors 1 isolates THIS retry: with the default breaker, a page failure
    // is already retried inside scrapePaginated, and the test would be measuring
    // that loop instead.
    let call = 0;
    mockedXhrRequest.mockImplementation(async () => {
      call += 1;
      if (call === 1) throw new Error("504 Gateway Timeout");
      return page([{ RecordId: call }]);
    });
    const ctx = makeCtx({ maxErrors: 1 });
    await startScraping(async () => capturedWithFilters("TD.00708"), ctx, { batchMonths: 2 });

    // The retry asks for the SAME period again; asking for the next one would
    // skip a month and call it a success, and a third attempt would be a loop.
    expect(filtersPerRequest().map((f) => f.period)).toEqual([
      "TD.00701",
      "TD.00701",
      "TD.00702",
    ]);
    const periods = completionOf(ctx).periods;
    expect(periods?.counts.map((c) => [c.period, c.rows])).toEqual([
      ["TD.00701", 1],
      ["TD.00702", 1],
    ]);
    expect(failedPeriods(periods!)).toEqual([]);
    // The retry pauses first: a second try sent straight after the first is the
    // burst the pacing rules exist to prevent.
    expect(vi.mocked(ctx.delay).mock.calls.map(([ms]) => ms)).toEqual([2000, 100]);
  });

  it("reports a period as failed only after the retry failed too, and keeps sweeping", async () => {
    let call = 0;
    mockedXhrRequest.mockImplementation(async () => {
      call += 1;
      if (call <= 2) throw new Error("504 Gateway Timeout");
      return page([{ RecordId: 3 }]);
    });
    const ctx = makeCtx({ maxErrors: 1 });
    await startScraping(async () => capturedWithFilters("TD.00708"), ctx, { batchMonths: 2 });

    const complete = completionOf(ctx);
    // Exactly one retry -- not a retry loop -- and the OTHER period still ran.
    expect(mockedXhrRequest).toHaveBeenCalledTimes(3);
    expect(complete.periods?.counts.map((c) => [c.period, c.rows])).toEqual([
      ["TD.00701", 0],
      ["TD.00702", 1],
    ]);
    expect(failedPeriods(complete.periods!)).toEqual(["TD.00701"]);
    expect(complete.total).toBe(1);
  });

  it("does not retry a failed period once the run is stopped", async () => {
    // The stop lands during the pause before the retry -- the one moment where a
    // second attempt is decided but not yet sent.
    let stop = false;
    mockedXhrRequest.mockImplementation(async () => {
      throw new Error("504 Gateway Timeout");
    });
    const delay = vi.fn(() => {
      stop = true;
      return Promise.resolve();
    });
    const ctx = makeCtx({ maxErrors: 1, isStopRequested: () => stop, delay });
    await startScraping(async () => capturedWithFilters("TD.00708"), ctx, { batchMonths: 12 });

    expect(mockedXhrRequest).toHaveBeenCalledTimes(1);
    // One pause, the retry pause: no page delay (the breaker threw at once) and
    // no between-period pause (the sweep ended).
    expect(delay.mock.calls).toEqual([[2000]]);
    // And no completion: a stopped sweep must not produce a file that looks like
    // a year.
    expect(sent(ctx).find((m) => m.type === "SCRAPE_COMPLETE")).toBeUndefined();
  });

  it("paces the BETWEEN-period pause, never skipping it", async () => {
    mockedXhrRequest.mockResolvedValue(page([{ RecordId: 1 }]));
    const ctx = makeCtx();
    await startScraping(async () => capturedWithFilters("TD.00708"), ctx, { batchMonths: 3 });
    // Two gaps between three periods; the per-page delays are mocked away
    // because each period returned a single short page.
    expect(vi.mocked(ctx.delay).mock.calls.map(([ms]) => ms)).toEqual([100, 100]);
  });

  it("does not scrape at all for an ordinary single-period run", async () => {
    mockedXhrRequest.mockResolvedValue(page([{ RecordId: 1 }]));
    const ctx = makeCtx();
    await startScraping(async () => capturedWithFilters("TD.00708"), ctx);
    expect(filtersPerRequest()).toHaveLength(1);
    // Absent, not an empty summary: an ordinary export has no periods to report.
    expect(completionOf(ctx).periods).toBeUndefined();
  });
});

describe("scrapePaginated with a shared accumulator", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("collects into the caller's accumulator so several calls are one Run", async () => {
    // Distinct rows: a shared dedupe set is exactly what would collapse these,
    // so identical fixtures would measure the dedupe rather than the accumulator.
    let call = 0;
    mockedXhrRequest.mockImplementation(async () => page([{ RecordId: ++call }]));
    const ctx = makeCtx();
    const accumulator = { allData: [] as Record<string, unknown>[], seen: new Set<string>() };

    await scrapePaginated(capturedWithFilters("TD.00701"), 500, ctx, {}, accumulator);
    await scrapePaginated(capturedWithFilters("TD.00702"), 500, ctx, {}, accumulator);

    expect(accumulator.allData).toHaveLength(2);
    // The result each call returns IS the shared array, so a caller cannot read
    // a per-period count from it by accident.
    expect(accumulator.allData.map((r) => r.RecordId)).toEqual([1, 2]);
  });

  it("dedupes across calls sharing one accumulator", async () => {
    mockedXhrRequest.mockResolvedValue(page([{ RecordId: 9 }]));
    const ctx = makeCtx();
    const accumulator = { allData: [] as Record<string, unknown>[], seen: new Set<string>() };
    await scrapePaginated(capturedWithFilters("TD.00701"), 500, ctx, {}, accumulator);
    await scrapePaginated(capturedWithFilters("TD.00702"), 500, ctx, {}, accumulator);
    expect(accumulator.allData).toHaveLength(1);
  });

  it("keeps its own accumulator when given none", async () => {
    mockedXhrRequest.mockResolvedValue(page([{ RecordId: 1 }]));
    const first = await scrapePaginated(capturedWithFilters("TD.00701"), 500, makeCtx());
    const second = await scrapePaginated(capturedWithFilters("TD.00701"), 500, makeCtx());
    // Two independent single-period scrapes each keep their own row: the shared
    // set is opt-in, so no existing caller changed behaviour.
    expect(first.allData).toHaveLength(1);
    expect(second.allData).toHaveLength(1);
  });
});