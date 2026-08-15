// Unit tests for scraper-actions.ts orchestration.
// The XHR functions are module-level imports, so we mock scraper-xhr and
// drive the loops through a stub ScraperContext with an injectable delay.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../content/scraper-xhr", () => ({
  xhrRequest: vi.fn(),
  xhrRequestByInvoice: vi.fn(),
  xhrDownloadWithholdingPdf: vi.fn(),
  xhrDownloadEfakturPdf: vi.fn(),
}));

import {
  scrapePaginated,
  getPaginateConfig,
  scrapeByInvoices,
} from "../content/scraper-actions";
import type { ScraperContext } from "../content/scraper-actions";
import { xhrRequest, xhrRequestByInvoice } from "../content/scraper-xhr";
import type { CapturedRequest } from "../content/scraper-types";

const mockedXhrRequest = vi.mocked(xhrRequest);
const mockedXhrRequestByInvoice = vi.mocked(xhrRequestByInvoice);

function makeCaptured(source: CapturedRequest["source"] = "OUTPUT_TAX"): CapturedRequest {
  return {
    url: "https://coretaxdjp.pajak.go.id/einvoiceportal/api/outputinvoice/list",
    headers: { "Content-Type": "application/json" },
    body: null,
    rawBody: "{}",
    response: null,
    initialData: [],
    initialFirst: 0,
    source,
  };
}

function makeCtx(overrides: Partial<ScraperContext> = {}): ScraperContext {
  return {
    // ── Orchestration ──────────────────────────────────
    isStopRequested: () => false,
    sendToContent: vi.fn(),
    emitPdfDownload: vi.fn(),
    getMasaPajakFromDOM: () => "",
    delay: vi.fn(() => Promise.resolve()),
    timeout: 30000,
    maxErrors: 3,

    // ── Request capture (stubs — not exercised by action tests) ──
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

// ── getPaginateConfig ─────────────────────────────────────────────────────────

describe("getPaginateConfig", () => {
  it("uses 500 rows/request for e-invoice sources", () => {
    expect(getPaginateConfig("OUTPUT_TAX").step).toBe(500);
    expect(getPaginateConfig("INPUT_TAX").step).toBe(500);
    expect(getPaginateConfig("OUTPUT_RETURN").step).toBe(500);
    expect(getPaginateConfig("INPUT_RETURN").step).toBe(500);
  });

  it("uses 1000 rows/request for SPT and PPh 21 sources", () => {
    expect(getPaginateConfig("SPT_A2").step).toBe(1000);
    expect(getPaginateConfig("SPT_B2").step).toBe(1000);
    expect(getPaginateConfig("PPH_21_L1A").step).toBe(1000);
  });

  it("paces SPT requests slower than e-invoice", () => {
    expect(getPaginateConfig("SPT_A2").delayMs).toBe(150);
    expect(getPaginateConfig("PPH_21_L2").delayMs).toBe(150);
    expect(getPaginateConfig("OUTPUT_TAX").delayMs).toBe(100);
  });
});

// ── scrapePaginated ───────────────────────────────────────────────────────────

describe("scrapePaginated", () => {
  beforeEach(() => {
    mockedXhrRequest.mockReset();
  });

  it("collects rows across pages until a short page", async () => {
    mockedXhrRequest
      .mockResolvedValueOnce([{ Reference: "R1" }, { Reference: "R2" }])
      .mockResolvedValueOnce([{ Reference: "R3" }])
      .mockResolvedValueOnce([{ Reference: "R4" }]);
    const ctx = makeCtx();

    const { allData, page } = await scrapePaginated(makeCaptured(), 2, ctx);

    expect(page).toBe(2);
    expect(allData).toEqual([{ Reference: "R1" }, { Reference: "R2" }, { Reference: "R3" }]);
    expect(mockedXhrRequest).toHaveBeenCalledTimes(2);
  });

  it("paces between full pages via ctx.delay(delayMs)", async () => {
    mockedXhrRequest
      .mockResolvedValueOnce([{ Reference: "R1" }])
      .mockResolvedValueOnce([{ Reference: "R2" }])
      .mockResolvedValueOnce([]); // short page stops the loop
    const ctx = makeCtx();
    const delaySpy = ctx.delay as ReturnType<typeof vi.fn>;

    await scrapePaginated(makeCaptured(), 1, ctx);

    // Two full pages → two pacing delays at the source's configured delayMs.
    expect(delaySpy).toHaveBeenCalledTimes(2);
    expect(delaySpy).toHaveBeenCalledWith(100); // OUTPUT_TAX → 100ms
  });

  it("paces SPT at the slower delay", async () => {
    mockedXhrRequest
      .mockResolvedValueOnce([{ Reference: "R1" }])
      .mockResolvedValueOnce([{ Reference: "R2" }])
      .mockResolvedValueOnce([]);
    const ctx = makeCtx();
    const delaySpy = ctx.delay as ReturnType<typeof vi.fn>;

    await scrapePaginated(makeCaptured("SPT_A2"), 1, ctx);

    expect(delaySpy).toHaveBeenCalledWith(150);
  });

  it("backs off 2000ms between consecutive errors before aborting at maxErrors", async () => {
    mockedXhrRequest
      .mockRejectedValueOnce(new Error("boom 1"))
      .mockRejectedValueOnce(new Error("boom 2"))
      .mockRejectedValueOnce(new Error("boom 3"));
    const ctx = makeCtx({ maxErrors: 3 });
    const delaySpy = ctx.delay as ReturnType<typeof vi.fn>;
    const sendSpy = ctx.sendToContent as ReturnType<typeof vi.fn>;

    const { allData, page } = await scrapePaginated(makeCaptured(), 10, ctx);

    expect(allData).toEqual([]);
    expect(page).toBe(3);
    // First two errors back off; the third aborts.
    expect(delaySpy).toHaveBeenCalledWith(2000);
    expect(delaySpy).toHaveBeenCalledTimes(2);
    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SCRAPE_ERROR", message: expect.stringContaining("3 error berturut-turut") }),
    );
  });

  it("stops early when ctx.isStopRequested returns true", async () => {
    mockedXhrRequest.mockResolvedValue([{ Reference: "R1" }]);
    const ctx = makeCtx({ isStopRequested: () => true });

    const { allData, page } = await scrapePaginated(makeCaptured(), 1, ctx);

    expect(page).toBe(0);
    expect(allData).toEqual([]);
    expect(mockedXhrRequest).not.toHaveBeenCalled();
  });

  it("passes First/Rows and timeout through to the XHR call", async () => {
    mockedXhrRequest.mockResolvedValue([{ Reference: "R1" }]);
    const ctx = makeCtx({ timeout: 12345 });

    await scrapePaginated(makeCaptured(), 50, ctx);

    expect(mockedXhrRequest).toHaveBeenCalledWith(
      expect.objectContaining({ source: "OUTPUT_TAX" }),
      0,
      50,
      12345,
    );
  });
});

// ── scrapeByInvoices ──────────────────────────────────────────────────────────

describe("scrapeByInvoices", () => {
  beforeEach(() => {
    mockedXhrRequestByInvoice.mockReset();
  });

  it("searches each invoice and paces 50ms between successful lookups", async () => {
    mockedXhrRequestByInvoice
      .mockResolvedValueOnce([{ Reference: "R1" }])
      .mockResolvedValueOnce([{ Reference: "R2" }]);
    const ctx = makeCtx();
    const delaySpy = ctx.delay as ReturnType<typeof vi.fn>;

    await scrapeByInvoices(["A", "B"], makeCaptured(), ctx);

    expect(mockedXhrRequestByInvoice).toHaveBeenCalledTimes(2);
    expect(delaySpy).toHaveBeenCalledWith(50);
    expect(ctx.sendToContent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SCRAPE_COMPLETE", data: [{ Reference: "R1" }, { Reference: "R2" }] }),
    );
  });

  it("retries failed lookups with exponential backoff then moves on", async () => {
    mockedXhrRequestByInvoice
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce([{ Reference: "R1" }]);
    const ctx = makeCtx();
    const delaySpy = ctx.delay as ReturnType<typeof vi.fn>;

    await scrapeByInvoices(["A"], makeCaptured(), ctx);

    expect(delaySpy).toHaveBeenCalledWith(1000); // BACKOFF_BASE_MS * attempt 1
    expect(mockedXhrRequestByInvoice).toHaveBeenCalledTimes(2);
    expect(ctx.sendToContent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SCRAPE_COMPLETE" }),
    );
  });

  it("aborts when consecutive failures reach maxErrors", async () => {
    mockedXhrRequestByInvoice.mockRejectedValue(new Error("always fails"));
    const ctx = makeCtx({ maxErrors: 2 });

    await scrapeByInvoices(["A", "B", "C"], makeCaptured(), ctx);

    expect(ctx.sendToContent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "SCRAPE_ERROR",
        message: expect.stringContaining("kegagalan berturut-turut"),
      }),
    );
  });

  it("returns early on abort — never sends SCRAPE_COMPLETE after SCRAPE_ERROR", async () => {
    mockedXhrRequestByInvoice.mockRejectedValue(new Error("always fails"));
    const ctx = makeCtx({ maxErrors: 1 });

    await scrapeByInvoices(["A", "B"], makeCaptured(), ctx);

    const messages = (ctx.sendToContent as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0],
    );
    expect(messages.some((m) => m.type === "SCRAPE_ERROR")).toBe(true);
    expect(messages.some((m) => m.type === "SCRAPE_COMPLETE")).toBe(false);
    // Aborted after the first invoice — the second invoice is never queried.
    expect(mockedXhrRequestByInvoice).toHaveBeenCalledTimes(3); // attempts 0..MAX_INVOICE_RETRIES for "A" only
  });

  it("tries each invoice MAX_INVOICE_RETRIES + 1 times with escalating backoff", async () => {
    mockedXhrRequestByInvoice.mockRejectedValue(new Error("always fails"));
    const ctx = makeCtx({ maxErrors: 99 }); // never aborts
    const delaySpy = ctx.delay as ReturnType<typeof vi.fn>;

    await scrapeByInvoices(["A"], makeCaptured(), ctx);

    expect(mockedXhrRequestByInvoice).toHaveBeenCalledTimes(3);
    expect(delaySpy).toHaveBeenCalledWith(1000); // BACKOFF_BASE_MS * attempt 1
    expect(delaySpy).toHaveBeenCalledWith(2000); // BACKOFF_BASE_MS * attempt 2
  });

  it("resets the consecutive-failure counter after a success", async () => {
    mockedXhrRequestByInvoice
      .mockRejectedValueOnce(new Error("fail A"))
      .mockRejectedValueOnce(new Error("fail A"))
      .mockRejectedValueOnce(new Error("fail A"))
      .mockResolvedValueOnce([{ Reference: "B1" }]) // success resets the counter
      .mockRejectedValueOnce(new Error("fail C"))
      .mockRejectedValueOnce(new Error("fail C"))
      .mockRejectedValueOnce(new Error("fail C"));
    const ctx = makeCtx({ maxErrors: 2 });

    await scrapeByInvoices(["A", "B", "C"], makeCaptured(), ctx);

    // A fails (1 consecutive), B succeeds (resets to 0), C fails (1) — the
    // counter never reaches maxErrors, so the run completes instead of aborting.
    expect(ctx.sendToContent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SCRAPE_COMPLETE", data: [{ Reference: "B1" }] }),
    );
    const messages = (ctx.sendToContent as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0],
    );
    expect(messages.some((m) => m.type === "SCRAPE_ERROR")).toBe(false);
  });

  it("stops mid-way when stop is requested and completes with partial data", async () => {
    let stop = false;
    mockedXhrRequestByInvoice.mockImplementationOnce(async () => {
      stop = true; // noticed at the next iteration's stop check
      return [{ Reference: "R1" }];
    });
    const ctx = makeCtx({ isStopRequested: () => stop });

    await scrapeByInvoices(["A", "B"], makeCaptured(), ctx);

    expect(mockedXhrRequestByInvoice).toHaveBeenCalledTimes(1);
    expect(ctx.sendToContent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SCRAPE_COMPLETE", data: [{ Reference: "R1" }] }),
    );
  });
});
