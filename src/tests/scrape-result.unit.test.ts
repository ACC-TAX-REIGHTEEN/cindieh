import { describe, expect, it, vi } from "vitest";
import type { ContentState } from "../content/main-actions";
import type { ScrapeComplete } from "../content/scraper-types";
import { createMessageDispatcher } from "../content/postmessage-guard";
import {
  acceptScrapeResult,
  consumeMissingInvoices,
  currentRunHandlers,
  findMissingInvoices,
  incompleteResultMessage,
  invalidateScrapeResult,
  missingInvoicesMessage,
  scrapeErrorMessage,
  skippedInvoicesMessage,
} from "../content/scrape-result";

function makeState(): ContentState {
  return {
    isRunning: true,
    scrapedData: [{ old: true }],
    scrapedFields: ["old"],
    lastExportMeta: { filenameHint: "old", source: "OUTPUT_TAX" },
    pendingExportFormat: "xlsx",
    pendingCompare: true,
    pendingCheck: true,
    requestedInvoices: ["001", "002"],
    lastState: null,
    exportMode: "raw",
  };
}

function complete(overrides: Partial<ScrapeComplete> = {}): ScrapeComplete {
  return {
    type: "SCRAPE_COMPLETE",
    data: [{ TaxInvoiceNumber: "001" }],
    fields: ["TaxInvoiceNumber"],
    total: 1,
    pages: 1,
    elapsed: "1s",
    source: "OUTPUT_TAX",
    ...overrides,
  };
}

function expectInvalidated(state: ContentState): void {
  expect(state).toMatchObject({
    isRunning: false,
    scrapedData: null,
    scrapedFields: null,
    lastExportMeta: null,
    pendingExportFormat: null,
    pendingCompare: false,
    pendingCheck: false,
    requestedInvoices: [],
    lastState: { type: "SCRAPE_ERROR" },
    exportMode: "raw",
  });
}

describe("acceptScrapeResult", () => {
  it("caches a complete result and leaves pending actions for main to consume", () => {
    const state = makeState();
    const result = complete({ filenameHint: "2026", partial: false, cancelled: false, failureCount: 0, failedInvoices: [] });
    expect(acceptScrapeResult(state, result)).toBe(true);
    expect(state).toMatchObject({
      isRunning: false,
      scrapedData: result.data,
      scrapedFields: result.fields,
      lastExportMeta: { filenameHint: "2026", source: "OUTPUT_TAX" },
      lastState: result,
      pendingExportFormat: "xlsx",
      pendingCompare: true,
      pendingCheck: true,
    });
  });

  it("accepts empty successful results", () => {
    const state = makeState();
    expect(acceptScrapeResult(state, complete({ data: [], fields: ["TaxInvoiceNumber"], total: 0 }))).toBe(true);
    expect(state.scrapedData).toEqual([]);
  });

  it("retains the grid schema on successful PDF completion", () => {
    const state = makeState();
    expect(acceptScrapeResult(state, complete({ fields: [] }))).toBe(true);
    expect(state.scrapedFields).toEqual(["old"]);
  });

  it.each([
    { partial: true },
    { cancelled: true },
    { failedInvoices: ["002", "003"] },
    { failureCount: 2 },
    { partial: false, failureCount: 1 },
    { partial: true, fields: [], source: "WITHHOLDING_SLIPS" as const },
  ])("invalidates incomplete results and prevents automatic work: %j", (flags) => {
    const state = makeState();
    const automaticWork = vi.fn();
    if (acceptScrapeResult(state, complete(flags))) automaticWork();
    expect(automaticWork).not.toHaveBeenCalled();
    expectInvalidated(state);
  });

  it("does not revive pending actions when a subsequent complete result arrives", () => {
    const state = makeState();
    acceptScrapeResult(state, complete({ partial: true }));
    acceptScrapeResult(state, complete());
    expect(state.pendingExportFormat).toBeNull();
    expect(state.pendingCompare).toBe(false);
    expect(state.pendingCheck).toBe(false);
  });
});

describe("result warnings and errors", () => {
  it("includes every failed invoice and actionable Indonesian instructions", () => {
    const message = incompleteResultMessage({ failedInvoices: ["001", "002"], failureCount: 2 });
    expect(message).toContain("Faktur gagal: 001, 002.");
    expect(message).toContain("2 proses gagal");
    expect(message).toContain("Periksa sesi Coretax dan filter, lalu jalankan ulang");
    expect(message).not.toContain("PDF sudah tidak tersedia");
  });

  it("distinguishes cancellation and warns that prior PDF downloads remain", () => {
    expect(incompleteResultMessage({ cancelled: true })).toContain("Proses dibatalkan.");
    expect(incompleteResultMessage({ partial: true })).toContain("PDF yang sudah diunduh tetap tersimpan.");
  });

  it("invalidates errors while preserving the original reason and export preference", () => {
    const state = makeState();
    const message = scrapeErrorMessage("Sesi berakhir.");
    invalidateScrapeResult(state, message);
    expectInvalidated(state);
    expect(state.lastState).toEqual({ type: "SCRAPE_ERROR", message });
    expect(message).toContain("Sesi berakhir.");
    expect(message).toContain("jalankan ulang");
    expect(scrapeErrorMessage()).toContain("Proses gagal.");
  });
});

// ── Missing-invoice reporting ────────────────────────────────────────────────
// A No. Faktur number Coretax has no row for is NOT a lookup failure: the request
// succeeds with an empty payload, so the scrape looks complete and the export
// comes back short. These cases pin the diff that makes the gap visible.

describe("missing-invoice reporting", () => {
  it("reports requested numbers no row carries, once each", () => {
    const rows = [{ TaxInvoiceNumber: "001" }, { TaxInvoiceNumber: "002" }];
    expect(findMissingInvoices(["001", "002", "003", "003"], rows)).toEqual(["003"]);
  });

  it("matches LetterNumber as a fallback and ignores case", () => {
    const letter = [{ LetterNumber: "040-001" }];
    expect(findMissingInvoices(["040-001"], letter)).toEqual([]);
    expect(findMissingInvoices(["040-002"], letter)).toEqual(["040-002"]);
    expect(findMissingInvoices(["abc"], [{ TaxInvoiceNumber: "ABC" }])).toEqual([]);
  });

  it("reports nothing when the request is empty or fully matched", () => {
    expect(findMissingInvoices([], [])).toEqual([]);
    expect(findMissingInvoices([], [{ TaxInvoiceNumber: "001" }])).toEqual([]);
    expect(findMissingInvoices(["001"], [{ TaxInvoiceNumber: "001" }])).toEqual([]);
    expect(missingInvoicesMessage(3, [])).toBeNull();
  });

  it("lists a sample and summarizes the remainder", () => {
    const missing = ["A", "B", "C", "D", "E", "F", "G"];
    expect(missingInvoicesMessage(20, missing)).toBe(
      "7 dari 20 nomor faktur tidak ditemukan di Coretax: A, B, C, D, E (+2 nomor lain).",
    );
  });

  it("phrases the bulk-PDF variant around the data already captured", () => {
    // Same list, different reason: these numbers are absent from the rows on hand,
    // so those files will not be downloaded at all.
    expect(skippedInvoicesMessage(20, ["040-002"])).toBe(
      "1 dari 20 nomor faktur tidak ada di data yang sudah diambil dan akan dilewati: 040-002.",
    );
    expect(skippedInvoicesMessage(20, ["A", "B", "C", "D", "E", "F"])).toContain("(+1 nomor lain)");
    expect(skippedInvoicesMessage(3, [])).toBeNull();
  });

  it("consumes the request, so a later scrape cannot be diffed against it", () => {
    const state = makeState();
    const notice = consumeMissingInvoices(state, [{ TaxInvoiceNumber: "001" }]);
    expect(notice).toBe("1 dari 2 nomor faktur tidak ditemukan di Coretax: 002.");
    expect(state.requestedInvoices).toEqual([]);

    // Same state, second completion: nothing left to report.
    expect(consumeMissingInvoices(state, [])).toBeNull();
  });

  it("says nothing for a full scrape, which requested no numbers", () => {
    const state = makeState();
    state.requestedInvoices = [];
    expect(consumeMissingInvoices(state, [{ TaxInvoiceNumber: "001" }])).toBeNull();
  });
});

describe("currentRunHandlers", () => {
  const types = ["SCRAPE_PROGRESS", "SCRAPE_COMPLETE", "SCRAPE_ERROR", "DOWNLOAD_PDF_ITEM", "INJECTED_READY"];

  it.each(types)("checks run freshness for %s inside the token-guarded dispatcher", (type) => {
    const handler = vi.fn();
    const isCurrent = vi.fn((msg: Record<string, unknown>) => msg.runId === 2);
    const selfWindow = { location: { origin: "https://example.test" } };
    const dispatcher = createMessageDispatcher({
      direction: "FROM_PAGE",
      token: "test-token",
      selfWindow,
      handlers: currentRunHandlers({ [type]: handler }, isCurrent),
    });
    const send = (runId: number, token = "test-token") => dispatcher.handle({
      source: selfWindow,
      origin: selfWindow.location.origin,
      data: { direction: "FROM_PAGE", type, token, runId },
    });
    send(2, "wrong-token");
    expect(isCurrent).not.toHaveBeenCalled();
    send(1);
    expect(handler).not.toHaveBeenCalled();
    send(2);
    expect(handler).toHaveBeenCalledExactlyOnceWith({ type, runId: 2 });
  });

  it.each(["DOWNLOAD_PDF_ITEM", "INJECTED_READY"])("delegates the unscoped %s exception to the bridge", (type) => {
    const handler = vi.fn();
    const isCurrent = vi.fn(() => true);
    currentRunHandlers({ [type]: handler }, isCurrent)[type]({ type });
    expect(isCurrent).toHaveBeenCalledWith({ type });
    expect(handler).toHaveBeenCalledWith({ type });
  });
});
