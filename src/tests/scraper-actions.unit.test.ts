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
  startScraping,
  startPdfDownload,
  consecutiveFailuresExhausted,
} from "../content/scraper-actions";
import type { ScraperContext } from "../content/scraper-actions";
import { createScrapeRuns } from "../content/scraper-run";
import { xhrRequest, xhrRequestByInvoice, xhrDownloadEfakturPdf, xhrDownloadWithholdingPdf } from "../content/scraper-xhr";
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

  it("defaults to the normal preset when no pacing is given", () => {
    expect(getPaginateConfig("OUTPUT_TAX").delayMs).toBe(getPaginateConfig("OUTPUT_TAX", "normal").delayMs);
  });

  it("scales only the delay, never the page size", () => {
    // The step is capped by the portal's own UI limits; a slower preset must
    // not quietly change how many rows are requested at once.
    for (const preset of ["normal", "hati-hati", "sabar"] as const) {
      expect(getPaginateConfig("OUTPUT_TAX", preset).step).toBe(500);
      expect(getPaginateConfig("SPT_A2", preset).step).toBe(1000);
    }
    expect(getPaginateConfig("OUTPUT_TAX", "hati-hati").delayMs).toBe(200);
    expect(getPaginateConfig("SPT_A2", "sabar").delayMs).toBe(600);
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

    await expect(scrapePaginated(makeCaptured(), 10, ctx)).rejects.toThrow("3 error berturut-turut");

    // First two errors back off; the third aborts.
    expect(delaySpy).toHaveBeenCalledWith(2000);
    expect(delaySpy).toHaveBeenCalledTimes(2);
    // Only the orchestrator emits the terminal error.
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("breaks the loop once consecutive failures reach maxErrors", () => {
    const ctx = makeCtx({ maxErrors: 3 });
    expect(consecutiveFailuresExhausted(ctx, ctx.maxErrors - 1)).toBe(false);
    expect(consecutiveFailuresExhausted(ctx, ctx.maxErrors)).toBe(true);
  });

  it("keeps loop-local counters in sync with the shared breaker", () => {
    const ctx = makeCtx({ maxErrors: 3 });
    let consecutiveFailures = 0;
    for (let i = 0; i < ctx.maxErrors + 1; i++) {
      consecutiveFailures++;
      if (consecutiveFailuresExhausted(ctx, consecutiveFailures)) break;
    }
    expect(consecutiveFailures).toBe(ctx.maxErrors);
  });

  it("stops early when ctx.isStopRequested returns true", async () => {
    mockedXhrRequest.mockResolvedValue([{ Reference: "R1" }]);
    const ctx = makeCtx({ isStopRequested: () => true });

    const { allData, page } = await scrapePaginated(makeCaptured(), 1, ctx);

    expect(page).toBe(0);
    expect(allData).toEqual([]);
    expect(mockedXhrRequest).not.toHaveBeenCalled();
  });

  it("waits the scaled inter-page delay for the active pacing preset", async () => {
    // A full first page is what makes the loop pace, so the step has to match
    // the row count; the short second page then ends the run.
    mockedXhrRequest
      .mockResolvedValueOnce([{ Reference: "R1" }, { Reference: "R2" }])
      .mockResolvedValueOnce([{ Reference: "R3" }]);
    const ctx = makeCtx({ getPacing: () => "sabar" });

    await scrapePaginated(makeCaptured(), 2, ctx);

    // OUTPUT_TAX is 100 ms at normal pacing; "sabar" is 4x.
    expect(ctx.delay).toHaveBeenCalledWith(400);
  });

  it("keeps the code's own floor when nothing sets a pacing", async () => {
    mockedXhrRequest
      .mockResolvedValueOnce([{ Reference: "R1" }, { Reference: "R2" }])
      .mockResolvedValueOnce([{ Reference: "R3" }]);
    const ctx = makeCtx();

    await scrapePaginated(makeCaptured(), 2, ctx);

    expect(ctx.delay).toHaveBeenCalledWith(100);
  });

  it("cancels an in-flight scrape without publishing an error or corrupting its replacement", async () => {
    const runs = createScrapeRuns();
    const old = runs.start(1)!;
    let requestSignal: AbortSignal | undefined;
    let began!: () => void;
    const requestStarted = new Promise<void>((resolve) => { began = resolve; });
    mockedXhrRequest.mockImplementationOnce((_captured, _first, _rows, _timeout, signal) => {
      requestSignal = signal;
      began();
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("Dibatalkan", "AbortError")), { once: true });
      });
    });
    const oldCtx = makeCtx({ signal: old.signal, isStopRequested: () => !old.isCurrent() });
    const oldWork = startScraping(async () => makeCaptured(), oldCtx).finally(() => old.finish());
    await requestStarted;
    expect(requestSignal).toBe(old.signal);

    runs.cancel();
    const replacement = runs.start(3)!;
    mockedXhrRequest.mockResolvedValueOnce([{ Reference: "NEW" }]);
    const newCtx = makeCtx({ signal: replacement.signal, isStopRequested: () => !replacement.isCurrent() });
    await oldWork;
    expect(requestSignal?.aborted).toBe(true);
    expect(replacement.isCurrent()).toBe(true);
    expect(oldCtx.sendToContent).not.toHaveBeenCalledWith(expect.objectContaining({ type: "SCRAPE_ERROR" }));
    expect(oldCtx.sendToContent).not.toHaveBeenCalledWith(expect.objectContaining({ type: "SCRAPE_COMPLETE" }));

    await startScraping(async () => makeCaptured(), newCtx);
    expect(newCtx.sendToContent).toHaveBeenCalledWith(expect.objectContaining({
      type: "SCRAPE_COMPLETE", data: [{ Reference: "NEW" }], partial: false,
    }));
    replacement.finish();
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
      expect.objectContaining({ type: "SCRAPE_COMPLETE", data: [{ Reference: "R1" }, { Reference: "R2" }], partial: false, failedInvoices: [], failureCount: 0 }),
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
      expect.objectContaining({ type: "SCRAPE_COMPLETE", data: [{ Reference: "B1" }], partial: true, failedInvoices: ["A", "C"], failureCount: 2 }),
    );
    const messages = (ctx.sendToContent as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0],
    );
    expect(messages.some((m) => m.type === "SCRAPE_ERROR")).toBe(false);
  });

  it("does not emit completion or accept an invoice response after cancellation", async () => {
    let stop = false;
    mockedXhrRequestByInvoice.mockImplementationOnce(async () => {
      stop = true;
      return [{ Reference: "R1" }];
    });
    const ctx = makeCtx({ isStopRequested: () => stop });

    await scrapeByInvoices(["A", "B"], makeCaptured(), ctx);

    expect(mockedXhrRequestByInvoice).toHaveBeenCalledTimes(1);
    expect(ctx.sendToContent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "SCRAPE_COMPLETE" }),
    );
  });

  it("does not retry when cancelled during backoff", async () => {
    let stop = false;
    mockedXhrRequestByInvoice.mockRejectedValue(new Error("failure"));
    const ctx = makeCtx({
      isStopRequested: () => stop,
      delay: vi.fn(async () => { stop = true; }),
    });
    await scrapeByInvoices(["A", "B"], makeCaptured(), ctx);
    expect(mockedXhrRequestByInvoice).toHaveBeenCalledTimes(1);
    expect(ctx.sendToContent).not.toHaveBeenCalledWith(expect.objectContaining({ type: "SCRAPE_COMPLETE" }));
    expect(ctx.sendToContent).not.toHaveBeenCalledWith(expect.objectContaining({ type: "SCRAPE_ERROR" }));
  });

  it("marks exhausted lookups partial even when no rows were recovered", async () => {
    mockedXhrRequestByInvoice.mockRejectedValue(new Error("failure"));
    const ctx = makeCtx();
    await scrapeByInvoices(["A"], makeCaptured(), ctx);
    expect(ctx.sendToContent).toHaveBeenCalledWith(expect.objectContaining({
      type: "SCRAPE_COMPLETE", data: [], partial: true, failedInvoices: ["A"], failureCount: 1,
    }));
  });

  it("treats a successful empty lookup as success, not a failed invoice", async () => {
    mockedXhrRequestByInvoice.mockResolvedValue([]);
    const ctx = makeCtx();
    await scrapeByInvoices(["A"], makeCaptured(), ctx);
    expect(ctx.sendToContent).toHaveBeenCalledWith(expect.objectContaining({
      type: "SCRAPE_COMPLETE", data: [], partial: false, failedInvoices: [], failureCount: 0,
    }));
  });
});

 describe("startScraping", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it("emits one error and no completion when pagination fails after collecting data", async () => {
    mockedXhrRequest.mockResolvedValueOnce(Array.from({ length: 500 }, (_, i) => ({ Id: i })))
      .mockRejectedValue(new Error("failure"));
    const ctx = makeCtx();
    await startScraping(async () => makeCaptured(), ctx);
    const messages = vi.mocked(ctx.sendToContent).mock.calls.map(([msg]) => msg);
    expect(messages.filter(msg => msg.type === "SCRAPE_ERROR")).toHaveLength(1);
    expect(messages.some(msg => msg.type === "SCRAPE_COMPLETE")).toBe(false);
    expect(mockedXhrRequest).toHaveBeenCalledTimes(4);
    expect(ctx.emitPdfDownload).not.toHaveBeenCalled();
  });

  it("does not request pages if cancelled during capture", async () => {
    let stop = false;
    const ctx = makeCtx({ isStopRequested: () => stop });
    await startScraping(async () => { stop = true; return makeCaptured(); }, ctx);
    expect(mockedXhrRequest).not.toHaveBeenCalled();
    expect(ctx.sendToContent).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("suppresses late pagination results/errors after cancellation (reject: %s)", async (reject) => {
    let stop = false;
    mockedXhrRequest.mockImplementation(async () => {
      stop = true;
      if (reject) throw new Error("late failure");
      return [{ Id: 1 }];
    });
    const ctx = makeCtx({ isStopRequested: () => stop });
    await startScraping(async () => makeCaptured(), ctx);
    expect(mockedXhrRequest).toHaveBeenCalledTimes(1);
    expect(ctx.sendToContent).toHaveBeenCalledTimes(1);
  });
});

 describe("bulk PDF actions", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it.each(["OUTPUT_TAX", "WITHHOLDING_SLIPS"] as const)("paces failures and stops at the consecutive failure limit for %s", async (source) => {
    const rows = [{ Id: 1 }, { Id: 2 }, { Id: 3 }];
    const ctx = makeCtx({ maxErrors: 2 });
    const download = vi.mocked(source === "OUTPUT_TAX" ? xhrDownloadEfakturPdf : xhrDownloadWithholdingPdf);
    download.mockRejectedValue(new Error("HTTP 401 saat download PDF"));
    if (source === "OUTPUT_TAX") {
      await startPdfDownload(rows, makeCaptured(source), ctx);
    } else {
      mockedXhrRequest.mockResolvedValue(rows);
      await startScraping(async () => makeCaptured(source), ctx);
    }
    expect(download).toHaveBeenCalledTimes(2);
    expect(ctx.delay).toHaveBeenCalledWith(800);
    expect(ctx.emitPdfDownload).not.toHaveBeenCalled();
    expect(ctx.sendToContent).toHaveBeenCalledWith(expect.objectContaining({ type: "SCRAPE_ERROR" }));
    expect(ctx.sendToContent).not.toHaveBeenCalledWith(expect.objectContaining({ type: "SCRAPE_COMPLETE" }));
  });

  it.each(["OUTPUT_TAX", "WITHHOLDING_SLIPS"] as const)("does not emit a late PDF or completion after cancellation for %s", async (source) => {
    let stop = false;
    const rows = [{ Id: 1 }, { Id: 2 }];
    const ctx = makeCtx({ isStopRequested: () => stop });
    const download = vi.mocked(source === "OUTPUT_TAX" ? xhrDownloadEfakturPdf : xhrDownloadWithholdingPdf);
    download.mockImplementation(async () => { stop = true; return "pdf"; });
    if (source === "OUTPUT_TAX") {
      await startPdfDownload(rows, makeCaptured(source), ctx);
    } else {
      mockedXhrRequest.mockResolvedValue(rows);
      await startScraping(async () => makeCaptured(source), ctx);
    }
    expect(download).toHaveBeenCalledTimes(1);
    expect(ctx.emitPdfDownload).not.toHaveBeenCalled();
    expect(ctx.sendToContent).not.toHaveBeenCalledWith(expect.objectContaining({ type: "SCRAPE_COMPLETE" }));
  });

  it("reports isolated PDF failures as partial and resets the consecutive counter", async () => {
    vi.mocked(xhrDownloadEfakturPdf).mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce("pdf").mockRejectedValueOnce(new Error("fail"));
    const ctx = makeCtx({ maxErrors: 2 });
    await startPdfDownload([{ Id: 1 }, { Id: 2 }, { Id: 3 }], makeCaptured(), ctx);
    expect(ctx.emitPdfDownload).toHaveBeenCalledTimes(1);
    expect(ctx.delay).toHaveBeenCalledTimes(3);
    expect(ctx.sendToContent).toHaveBeenCalledWith(expect.objectContaining({
      type: "SCRAPE_COMPLETE", partial: true, failureCount: 2,
    }));
  });
});

// ── Data-only withholding scrape (skipPdf) ───────────────────────────────────
// A withholding scrape normally ends by downloading every slip's PDF. The
// XLSX/CSV export path asks the same scrape for rows only, so the flag has to
// suppress the download and still report a complete (data) result.

describe("data-only withholding scrape", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedXhrRequest.mockReset();
  });

  it("collects the rows without downloading a single PDF", async () => {
    mockedXhrRequest.mockResolvedValue([{ Id: 1 }, { Id: 2 }]);
    const ctx = makeCtx();

    await startScraping(async () => makeCaptured("WITHHOLDING_SLIPS"), ctx, { skipPdf: true });

    expect(xhrDownloadWithholdingPdf).not.toHaveBeenCalled();
    expect(ctx.emitPdfDownload).not.toHaveBeenCalled();
    expect(ctx.sendToContent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SCRAPE_COMPLETE", kind: "scrape", total: 2 }),
    );
  });

  it("still bulk-downloads when the flag is absent", async () => {
    mockedXhrRequest.mockResolvedValue([{ Id: 1 }]);
    vi.mocked(xhrDownloadWithholdingPdf).mockResolvedValue("pdf");
    const ctx = makeCtx();

    await startScraping(async () => makeCaptured("WITHHOLDING_SLIPS"), ctx);

    expect(xhrDownloadWithholdingPdf).toHaveBeenCalledTimes(1);
    expect(ctx.sendToContent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SCRAPE_COMPLETE", kind: "pdf" }),
    );
  });
});

// ── Pacing preset reaches every delay ────────────────────────────────────────
// The preset lives in the popup and is applied inside the MAIN world, so each
// delay site has to read it: a preset that only slowed the paginated loop would
// leave the two heaviest paths (bulk PDF, per-invoice lookup) untouched.

describe("pacing preset", () => {
  beforeEach(() => {
    mockedXhrRequest.mockReset();
    mockedXhrRequestByInvoice.mockReset();
  });

  it("scales the bulk e-faktur PDF delay", async () => {
    vi.mocked(xhrDownloadEfakturPdf).mockResolvedValue("pdf");
    const ctx = makeCtx({ getPacing: () => "sabar" });

    await startPdfDownload([{ Id: 1 }, { Id: 2 }], makeCaptured(), ctx);

    expect(ctx.delay).toHaveBeenCalledWith(3200); // 800 ms x 4
  });

  it("scales the bulk withholding PDF delay", async () => {
    vi.mocked(xhrDownloadWithholdingPdf).mockResolvedValue("pdf");
    // The withholding flow scrapes first (one short page) and then downloads.
    mockedXhrRequest.mockResolvedValue([{ Id: 1 }]);
    const ctx = makeCtx({ getPacing: () => "hati-hati" });

    await startScraping(async () => makeCaptured("WITHHOLDING_SLIPS"), ctx);

    expect(ctx.delay).toHaveBeenCalledWith(1600); // 800 ms x 2
  });

  it("scales the per-invoice lookup delay", async () => {
    mockedXhrRequestByInvoice.mockResolvedValue([{ Reference: "R1" }, { Reference: "R2" }]);
    const ctx = makeCtx({ getPacing: () => "sabar" });

    await scrapeByInvoices(["INV-1"], makeCaptured(), ctx);

    expect(ctx.delay).toHaveBeenCalledWith(200); // 50 ms x 4
  });

  it("leaves the documented delays alone at the normal preset", async () => {
    vi.mocked(xhrDownloadEfakturPdf).mockResolvedValue("pdf");
    const ctx = makeCtx({ getPacing: () => "normal" });

    await startPdfDownload([{ Id: 1 }], makeCaptured(), ctx);

    expect(ctx.delay).toHaveBeenCalledWith(800);
  });
});
