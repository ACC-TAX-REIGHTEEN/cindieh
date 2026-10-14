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

import { startScraping, scrapePaginated, type ScraperContext } from "../content/scraper-actions";
import { xhrRequest } from "../content/scraper-xhr";
import type { CapturedRequest, ScrapeComplete, ScrapeMessage } from "../content/scraper-types";
import type { GridPage } from "../content/scraper-xhr";

const mockedXhrRequest = vi.mocked(xhrRequest);

/**
 * A captured request shaped like the one the portal actually makes: the period
 * and year arrive as body filters, not as query parameters. Synthesising the
 * codes locally would produce twelve period values the portal has never heard of.
 */
function capturedWithFilters(period: string, year = "2026"): CapturedRequest {
  return {
    url: "https://coretaxdjp.pajak.go.id/einvoiceportal/api/outputinvoice/list",
    headers: { "Content-Type": "application/json" },
    body: null,
    rawBody: JSON.stringify({
      TaxpayerAggregateIdentifier: " taxpayer-id ",
      SellerTaxpayerAggregateIdentifier: "",
      First: 0,
      Rows: 50,
      SortField: "",
      SortOrder: "",
      LanguageId: "id",
      Filters: [
        { PropertyName: "TaxInvoicePeriod", Value: period, MatchMode: "equals", CaseSensitive: true },
        { PropertyName: "TaxInvoiceYear", Value: year, MatchMode: "equals", CaseSensitive: true },
        { PropertyName: "TaxInvoiceStatus", Value: ["CREATED"], MatchMode: "contains", CaseSensitive: true },
      ],
    }),
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

function page(rows: Record<string, unknown>[], total: number | null = null): GridPage {
  return { rows, total };
}

function monthOf(period: unknown): number {
  return Number(String(period).slice(-2));
}

/** Every message the run sent, typed by discriminant. */
function sent(ctx: ScraperContext): ScrapeMessage[] {
  return vi.mocked(ctx.sendToContent).mock.calls.map(([msg]) => msg);
}

function completionOf(ctx: ScraperContext): ScrapeComplete {
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

  it("carries every other filter through untouched -- only the period's Value changes", async () => {
    mockedXhrRequest.mockResolvedValue(page([{ RecordId: 1 }]));
    const ctx = makeCtx();
    await startScraping(async () => capturedWithFilters("TD.00708"), ctx, { batchMonths: 2 });

    const sentFilters = filtersPerRequest();
    // Dropping TaxInvoiceStatus or MatchMode would silently widen the sweep to
    // statuses the user never asked for, or turn equals into a prefix match.
    expect(sentFilters[0].status).toEqual(["CREATED"]);
    expect(sentFilters[1].status).toEqual(["CREATED"]);
    expect(sentFilters[0].matchMode).toBe("equals");
    expect(sentFilters[1].matchMode).toBe("equals");
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
    expect(periods?.emptyPeriods).toEqual(["TD.00702"]);
    expect(periods?.failedPeriods).toEqual([]);
    expect(periods?.totalRows).toBe(2);
  });

  it("does not call an all-empty sweep anomalous", async () => {
    mockedXhrRequest.mockResolvedValue(page([]));
    const ctx = makeCtx();
    await startScraping(async () => capturedWithFilters("TD.00708"), ctx, { batchMonths: 3 });
    // A taxpayer with no data at all is not a fault; flagging it would train
    // the user to ignore the flag that matters.
    expect(completionOf(ctx).periods?.emptyPeriods).toEqual([]);
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
      rawBody: JSON.stringify({ First: 0, Rows: 50, Filters: [] }),
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
      rawBody: JSON.stringify({
        First: 0,
        Rows: 50,
        Filters: [
          { PropertyName: "TaxInvoicePeriod", Value: "TD.00708", MatchMode: "equals" },
        ],
      }),
    };
    await startScraping(async () => noYear, ctx, { batchMonths: 12 });

    expect(mockedXhrRequest).not.toHaveBeenCalled();
    expect(sent(ctx).find((m) => m.type === "SCRAPE_COMPLETE")).toBeUndefined();
    const error = sent(ctx).find((m) => m.type === "SCRAPE_ERROR");
    expect((error as { message?: string } | undefined)?.message).toContain("tahun pajak");
  });

  it("does not require a year filter for an ordinary single-period scrape", async () => {
    // The guard belongs to the sweep: one period is fetched with the filters the
    // grid itself sent, so an ordinary export still works on a request that
    // carries no year.
    mockedXhrRequest.mockResolvedValue(page([{ RecordId: 1 }]));
    const ctx = makeCtx();
    const noYear: CapturedRequest = {
      ...capturedWithFilters("TD.00708"),
      rawBody: JSON.stringify({
        First: 0,
        Rows: 50,
        Filters: [{ PropertyName: "TaxInvoicePeriod", Value: "TD.00708" }],
      }),
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

  it("stops between periods when the run is cancelled", async () => {
    let stop = false;
    mockedXhrRequest.mockImplementation(async () => {
      stop = true;
      return page([{ RecordId: 1 }]);
    });
    const ctx = makeCtx({ isStopRequested: () => stop });
    await startScraping(async () => capturedWithFilters("TD.00708"), ctx, { batchMonths: 12 });
    // A cancelled run emits no completion: nothing was swept, so a file must not
    // be written that looks like a year.
    expect(mockedXhrRequest).toHaveBeenCalledTimes(1);
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