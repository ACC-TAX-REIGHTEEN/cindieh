// Unit tests for main-actions.ts
// Tests handleExportAction, startScrape, startPdfDownload and
// applyMultiInvoiceFilter using injected deps — no DOM.
//
// These handlers no longer carry their own state: they drive a Run through
// run-lifecycle's interface (ADR-0014). The module is replaced here with one
// instance that `beforeEach` resets, which is the same isolation the old
// per-test `createContentState()` gave. Assertions are therefore written
// against the interface — "a declined confirmation left nothing a later
// completion could report" — rather than against fields.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockInvoiceNumbers: string[] = [];
vi.mock("../content/ui-badge", () => ({
  showPanel: vi.fn(),
  updatePanelProgress: vi.fn(),
  updatePanelIdle: vi.fn(),
  updatePanelError: vi.fn(),
}));
vi.mock("../content/ui-filters", () => ({
  getMultiInvoiceNumbers: () => mockInvoiceNumbers,
}));
vi.mock("../content/run-lifecycle", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../content/run-lifecycle")>();
  return { ...actual, runLifecycle: actual.createRunLifecycle() };
});

import {
  handleExportAction,
  startPdfDownload,
  startScrape,
  stopRun,
  applyMultiInvoiceFilter,
  triggerSearch,
  scrapeIntentForFormat,
  SCRAPE_CANCELLED_MESSAGE,
  EXPORT_XLSX_FAILED_MESSAGE,
  type ActionDeps,
} from "../content/main-actions";
import { runLifecycle, type RunOutcome } from "../content/run-lifecycle";
import type { ExportData, ExportMode } from "../content/exporter";
import type { ScrapeComplete } from "../content/scraper-types";
import {
  DEFAULT_BULK_CONFIRM_THRESHOLD,
  shouldConfirmBulkDownload,
} from "../shared/extension-preferences";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDeps(overrides: Partial<ActionDeps> = {}): ActionDeps {
  return {
    postToScraper: vi.fn(),
    showPanel: vi.fn(),
    updatePanelProgress: vi.fn(),
    updatePanelIdle: vi.fn(),
    updatePanelError: vi.fn(),
    getMultiInvoiceNumbers: vi.fn(() => []),
    isEfakturPage: vi.fn(() => true),
    isBatchPage: vi.fn(() => true),
    // The real predicate over the documented default threshold, so the cases
    // below exercise the shipped decision instead of a stub that always says yes.
    shouldConfirmBulkDownload: vi.fn((count: number) =>
      shouldConfirmBulkDownload(count, DEFAULT_BULK_CONFIRM_THRESHOLD),
    ),
    getExportMode: vi.fn<() => ExportMode>(() => "cleaned"),
    exportXLSX: vi.fn(),
    exportCSV: vi.fn(),
    triggerSearch: vi.fn(),
    ...overrides,
  };
}

function complete(overrides: Partial<ScrapeComplete> = {}): ScrapeComplete {
  return {
    type: "SCRAPE_COMPLETE",
    data: [],
    fields: ["Reference"],
    total: 0,
    pages: 1,
    elapsed: "1s",
    source: "OUTPUT_TAX",
    ...overrides,
  };
}

/** Put reusable rows in the Run, the way a finished scrape would. */
function seedResult(
  rows: Record<string, unknown>[],
  fields: string[],
  meta: { filenameHint?: string; source?: ScrapeComplete["source"] } = {},
): void {
  runLifecycle.begin("scrape");
  runLifecycle.complete(complete({ data: rows, fields, ...meta }));
}

/** What a later completion would report about numbers nothing asked for. */
function shortfallOf(outcome: RunOutcome): unknown {
  return outcome.kind === "accepted" ? outcome.shortfall : null;
}

beforeEach(() => {
  runLifecycle.reset();
});

// ── startScrape ───────────────────────────────────────────────────────────────

describe("startScrape", () => {
  it("marks a run in flight", () => {
    startScrape(makeDeps());
    expect(runLifecycle.isRunning()).toBe(true);
  });

  it("retires the rows a previous scrape left behind", () => {
    seedResult([{ id: 1 }], ["id"], { filenameHint: "hint" });
    expect(runLifecycle.result()).not.toBeNull();

    startScrape(makeDeps());

    expect(runLifecycle.result()).toBeNull();
  });

  it("calls showPanel", () => {
    const deps = makeDeps();
    startScrape(deps);
    expect(deps.showPanel).toHaveBeenCalledOnce();
  });

  it("calls updatePanelProgress with initial zeroes", () => {
    const deps = makeDeps();
    startScrape(deps);
    expect(deps.updatePanelProgress).toHaveBeenCalledWith(0, 0, "0s", expect.any(String));
  });

  it("posts START_SCRAPE to the scraper", () => {
    const deps = makeDeps();
    startScrape(deps);
    expect(deps.postToScraper).toHaveBeenCalledWith({ type: "START_SCRAPE" });
  });
});

// ── handleExportAction — already running ──────────────────────────────────────

describe("handleExportAction — already running", () => {
  let deps: ActionDeps;

  beforeEach(() => {
    runLifecycle.begin("scrape");
    runLifecycle.request({ kind: "export", format: "xlsx" });
    deps = makeDeps();
  });

  it("posts STOP_SCRAPE", () => {
    handleExportAction("xlsx", deps);
    expect(deps.postToScraper).toHaveBeenCalledWith({ type: "STOP_SCRAPE" });
  });

  it("renders the cancellation message on the panel", () => {
    handleExportAction("xlsx", deps);
    expect(deps.updatePanelError).toHaveBeenCalledWith(SCRAPE_CANCELLED_MESSAGE);
  });

  it("ends the run and drops the export request it owed", () => {
    handleExportAction("xlsx", deps);
    expect(runLifecycle.isRunning()).toBe(false);
    expect(runLifecycle.pendingExport()).toBeNull();
  });

  it("leaves the last good rows usable by a following export", () => {
    // The export click doubles as a stop, but the rows it just downloaded are
    // still the newest ones on hand — dropping them would be a regression.
    seedResult([{ Reference: "REF-1" }], ["Reference"]);
    runLifecycle.begin("bulk-pdf");

    handleExportAction("xlsx", makeDeps());

    expect(runLifecycle.result()?.data).toEqual([{ Reference: "REF-1" }]);
  });

  it("reports the cancellation instead of rendering an idle panel", () => {
    handleExportAction("xlsx", deps);
    expect(deps.updatePanelError).toHaveBeenCalledWith(SCRAPE_CANCELLED_MESSAGE);
    expect(deps.updatePanelIdle).not.toHaveBeenCalled();
  });

  it("takes a queued comparison down with the run, which no later completion revives", () => {
    // The same stop the toolbar and the stop key run: a request dies with the
    // Run that recorded it (ADR-0022). The next completion is a No. Faktur
    // lookup whose rows are the filtered subset, so spending the queued
    // comparison on it would answer "Tidak ditemukan" for every pasted row the
    // filter left out.
    runLifecycle.request({ kind: "compare" });
    runLifecycle.request({ kind: "check" });

    handleExportAction("xlsx", deps);

    runLifecycle.begin("targeted");
    const outcome = runLifecycle.complete(complete({ data: [{ Reference: "REF-1" }] }));
    expect(outcome.kind === "accepted" && outcome.followUp).toEqual([]);
  });

  it("returns true for all formats when running", () => {
    for (const fmt of ["xlsx", "csv", "pdf"] as const) {
      runLifecycle.begin("scrape");
      expect(handleExportAction(fmt, makeDeps())).toBe(true);
    }
  });
});

// ── stopRun — the one sequence every stop control runs ────────────────────────

// The three steps are one call so a fourth stop control cannot get them in a
// different order or skip one (ADR-0027), and `keepRows` is required so it has
// to state the only thing the controls disagree about. The toolbar button and
// the stop key pass false from main.ts; the export click passes true below.

describe("stopRun", () => {
  it("posts STOP_SCRAPE, settles the Run and reports the cancellation", () => {
    const deps = makeDeps();
    runLifecycle.begin("scrape");

    stopRun(deps, { keepRows: false });

    expect(deps.postToScraper).toHaveBeenCalledWith({ type: "STOP_SCRAPE" });
    expect(deps.updatePanelError).toHaveBeenCalledWith(SCRAPE_CANCELLED_MESSAGE);
    expect(runLifecycle.isRunning()).toBe(false);
  });

  it.each([true, false])(
    "decides the rows by the flag and nothing else (keepRows: %s)",
    (keepRows) => {
      seedResult([{ Reference: "REF-1" }], ["Reference"]);
      runLifecycle.begin("bulk-pdf");

      stopRun(makeDeps(), { keepRows });

      expect(runLifecycle.result()?.data).toEqual(
        keepRows ? [{ Reference: "REF-1" }] : undefined,
      );
    },
  );

  it("retires the requests the Run carried either way, so a later lookup inherits none", () => {
    for (const keepRows of [true, false]) {
      runLifecycle.reset();
      runLifecycle.begin("scrape");
      runLifecycle.request({ kind: "compare" });
      runLifecycle.request({ kind: "check" });

      stopRun(makeDeps(), { keepRows });

      runLifecycle.begin("targeted");
      const outcome = runLifecycle.complete(complete({ data: [{ Reference: "REF-1" }] }));
      expect(outcome.kind === "accepted" && outcome.followUp).toEqual([]);
    }
  });
});

// ── handleExportAction — data already scraped ────────────────────────────────

describe("handleExportAction — data already scraped", () => {
  const scrapedData = [{ Reference: "REF-001", SellingPrice: 100, VAT: 11 }];
  const scrapedFields = ["Reference", "SellingPrice", "VAT"];

  function seed(): void {
    seedResult(scrapedData, scrapedFields, { filenameHint: "hint", source: "OUTPUT_TAX" });
  }

  it("calls exportXLSX with the correct ExportData for xlsx format", () => {
    const deps = makeDeps();
    seed();
    handleExportAction("xlsx", deps);
    expect(deps.exportXLSX).toHaveBeenCalledOnce();
    const arg = (deps.exportXLSX as ReturnType<typeof vi.fn>).mock.calls[0][0] as ExportData;
    expect(arg.data).toBe(scrapedData);
    expect(arg.fields).toBe(scrapedFields);
    expect(arg.filenameHint).toBe("hint");
    expect(arg.source).toBe("OUTPUT_TAX");
  });

  it("passes the selected export mode to xlsx exports", () => {
    const deps = makeDeps({ getExportMode: () => "raw" });
    seed();
    handleExportAction("xlsx", deps);
    const arg = (deps.exportXLSX as ReturnType<typeof vi.fn>).mock.calls[0][0] as ExportData;
    expect(arg.mode).toBe("raw");
  });

  it("surfaces a failed xlsx export in the panel instead of swallowing it", async () => {
    // The writer is now async (it loads the SheetJS chunk first), and the click
    // that triggers it cannot await — so a rejected load must reach the user.
    const deps = makeDeps({
      exportXLSX: vi.fn(() => Promise.reject(new Error("chunk unreachable"))),
    });
    seed();
    handleExportAction("xlsx", deps);
    await Promise.resolve();
    await Promise.resolve();
    expect(deps.showPanel).toHaveBeenCalled();
    expect(deps.updatePanelError).toHaveBeenCalledWith(EXPORT_XLSX_FAILED_MESSAGE);
  });

  it("tolerates a synchronous xlsx dep returning nothing", () => {
    // The existing suite's default double returns undefined; Promise.resolve
    // wrapping keeps that supported instead of demanding a real Promise.
    const deps = makeDeps({ exportXLSX: vi.fn(() => undefined) });
    seed();
    expect(() => handleExportAction("xlsx", deps)).not.toThrow();
    expect(deps.updatePanelError).not.toHaveBeenCalled();
  });

  it("calls exportCSV with the correct ExportData for csv format", () => {
    const deps = makeDeps();
    seed();
    handleExportAction("csv", deps);
    expect(deps.exportCSV).toHaveBeenCalledOnce();
    const arg = (deps.exportCSV as ReturnType<typeof vi.fn>).mock.calls[0][0] as ExportData;
    expect(arg.data).toBe(scrapedData);
  });

  it("returns true for pdf format when data exists (handled internally)", () => {
    seed();
    expect(handleExportAction("pdf", makeDeps())).toBe(true);
  });

  it("reports the pdf flow's decline instead of always claiming success", () => {
    // The boolean used to be constant `true`, which made it useless; the
    // confirmation flow's decline is now propagated.
    vi.stubGlobal("confirm", vi.fn(() => false));
    vi.stubGlobal("alert", vi.fn());
    try {
      const many = Array.from({ length: 11 }, (_, i) => ({ TaxInvoiceNumber: `INV-${i}` }));
      seedResult(many, ["TaxInvoiceNumber"]);
      const deps = makeDeps();

      expect(handleExportAction("pdf", deps)).toBe(false);
      expect(runLifecycle.isRunning()).toBe(false);
      expect(deps.postToScraper).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "START_PDF_DOWNLOAD" }),
      );

      // Same rows, confirmation accepted: it starts and reports so.
      vi.stubGlobal("confirm", vi.fn(() => true));
      expect(handleExportAction("pdf", makeDeps())).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("posts START_PDF_DOWNLOAD for pdf format when data exists", () => {
    const deps = makeDeps();
    seed();
    handleExportAction("pdf", deps);
    expect(deps.postToScraper).toHaveBeenCalledWith(
      expect.objectContaining({ type: "START_PDF_DOWNLOAD" }),
    );
  });

  it("does NOT call exportXLSX/exportCSV for pdf format", () => {
    const deps = makeDeps();
    seed();
    handleExportAction("pdf", deps);
    expect(deps.exportXLSX).not.toHaveBeenCalled();
    expect(deps.exportCSV).not.toHaveBeenCalled();
  });

  it("returns true for xlsx and csv when data exists", () => {
    seed();
    expect(handleExportAction("xlsx", makeDeps())).toBe(true);
    expect(handleExportAction("csv", makeDeps())).toBe(true);
  });

  it("does not start a new scrape when data is already present", () => {
    const deps = makeDeps();
    seed();
    handleExportAction("xlsx", deps);
    expect(deps.postToScraper).not.toHaveBeenCalledWith(expect.objectContaining({ type: "START_SCRAPE" }));
  });
});

// ── handleExportAction — multi-invoice filter (no data yet) ──────────────────

describe("handleExportAction — multi-invoice filter", () => {
  it("sends SCRAPE_BY_INVOICES when invoice numbers are present and format is xlsx", () => {
    const deps = makeDeps({ getMultiInvoiceNumbers: vi.fn(() => ["INV-001", "INV-002"]) });

    handleExportAction("xlsx", deps);

    expect(deps.postToScraper).toHaveBeenCalledWith({
      type: "SCRAPE_BY_INVOICES",
      invoiceNumbers: ["INV-001", "INV-002"],
    });
  });

  it("remembers the requested numbers so the result can be diffed against them", () => {
    const deps = makeDeps({ getMultiInvoiceNumbers: vi.fn(() => ["INV-001", "INV-404"]) });

    handleExportAction("xlsx", deps);

    const outcome = runLifecycle.complete(complete({ data: [{ TaxInvoiceNumber: "INV-001" }] }));
    expect(shortfallOf(outcome)).toEqual({
      count: 1,
      notice: "1 dari 2 nomor faktur tidak ditemukan di Coretax: INV-404.",
    });
  });

  it("leaves no request behind when the user aborts the targeted scrape", () => {
    runLifecycle.begin("scrape");
    runLifecycle.request({ kind: "export", format: "xlsx" });
    runLifecycle.noteRequestedInvoices(["INV-404"]);

    handleExportAction("xlsx", makeDeps());

    // The aborted run emits no completion, so nothing would ever consume it.
    expect(shortfallOf(runLifecycle.complete(complete()))).toBeNull();
  });

  it("starts a run in flight and remembers the requested format", () => {
    const deps = makeDeps({ getMultiInvoiceNumbers: vi.fn(() => ["INV-001"]) });

    handleExportAction("csv", deps);

    expect(runLifecycle.isRunning()).toBe(true);
    expect(runLifecycle.pendingExport()).toBe("csv");
  });

  it("calls showPanel when starting a multi-invoice scrape", () => {
    const deps = makeDeps({ getMultiInvoiceNumbers: vi.fn(() => ["INV-001"]) });

    handleExportAction("xlsx", deps);

    expect(deps.showPanel).toHaveBeenCalledOnce();
  });

  it("does NOT use SCRAPE_BY_INVOICES for pdf format (skips filter)", () => {
    const deps = makeDeps({ getMultiInvoiceNumbers: vi.fn(() => ["INV-001"]) });

    handleExportAction("pdf", deps);

    // pdf bypasses the multi-invoice check; should fall through to startScrape
    expect(deps.postToScraper).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "SCRAPE_BY_INVOICES" }),
    );
    expect(deps.postToScraper).toHaveBeenCalledWith({ type: "START_SCRAPE" });
  });

  it("does NOT use SCRAPE_BY_INVOICES on non-efaktur pages (e.g. withholding slips)", () => {
    const deps = makeDeps({
      getMultiInvoiceNumbers: vi.fn(() => ["INV-001"]),
      isEfakturPage: vi.fn(() => false),
    });

    handleExportAction("xlsx", deps);

    // The No. Faktur filter only exists on efaktur pages; elsewhere the
    // multi-invoice scrape must not run even if numbers were somehow present.
    expect(deps.postToScraper).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "SCRAPE_BY_INVOICES" }),
    );
    // A data export asks for rows only — on this page that is what keeps the
    // withholding scrape from firing one PDF request per slip.
    expect(deps.postToScraper).toHaveBeenCalledWith({ type: "START_SCRAPE", skipPdf: true });
  });
});

// ── scrapeIntentForFormat ────────────────────────────────────────────────────
// The START_SCRAPE fields a requested format implies. main.ts repeats this
// intent when it resends a request the scraper missed, so the mapping itself is
// pinned here rather than only through the messages it produces.

describe("scrapeIntentForFormat", () => {
  it("asks for rows only for the sheet formats", () => {
    expect(scrapeIntentForFormat("xlsx")).toEqual({ skipPdf: true });
    expect(scrapeIntentForFormat("csv")).toEqual({ skipPdf: true });
  });

  it("leaves the bulk PDF step in place for a PDF request and for no request", () => {
    expect(scrapeIntentForFormat("pdf")).toEqual({});
    expect(scrapeIntentForFormat(null)).toEqual({});
  });
});

// ── handleExportAction — no data, no multi-invoice filter ────────────────────

describe("handleExportAction — no data, no filter → startScrape", () => {
  it("remembers the pending format before starting the scrape", () => {
    handleExportAction("xlsx", makeDeps());
    expect(runLifecycle.pendingExport()).toBe("xlsx");
  });

  it("posts START_SCRAPE as a data-only request for a sheet format", () => {
    const deps = makeDeps();
    handleExportAction("xlsx", deps);
    expect(deps.postToScraper).toHaveBeenCalledWith({ type: "START_SCRAPE", skipPdf: true });
  });

  it("keeps the plain START_SCRAPE for a PDF request", () => {
    const deps = makeDeps();
    handleExportAction("pdf", deps);
    expect(deps.postToScraper).toHaveBeenCalledWith({ type: "START_SCRAPE" });
  });

  it("returns true for all formats in this path", () => {
    for (const fmt of ["xlsx", "csv", "pdf"] as const) {
      expect(handleExportAction(fmt, makeDeps())).toBe(true);
    }
  });

  it("does not call exportXLSX or exportCSV", () => {
    const deps = makeDeps();
    handleExportAction("xlsx", deps);
    expect(deps.exportXLSX).not.toHaveBeenCalled();
    expect(deps.exportCSV).not.toHaveBeenCalled();
  });
});

// ── applyMultiInvoiceFilter ───────────────────────────────────────────────────

describe("applyMultiInvoiceFilter", () => {
  const rows = [
    { TaxInvoiceNumber: "INV-001", SellingPrice: 100 },
    { TaxInvoiceNumber: "INV-002", SellingPrice: 200 },
    { TaxInvoiceNumber: "INV-003", SellingPrice: 300 },
    { LetterNumber: "LET-001", SellingPrice: 400 },
  ];

  it("returns all rows when no invoice numbers are present", () => {
    expect(applyMultiInvoiceFilter(rows, makeDeps())).toHaveLength(rows.length);
  });

  it("passes every row through untouched on non-efaktur pages", () => {
    const deps = makeDeps({
      getMultiInvoiceNumbers: vi.fn(() => ["INV-001"]),
      isEfakturPage: vi.fn(() => false),
    });
    const result = applyMultiInvoiceFilter(rows, deps);
    expect(result).toBe(rows); // identity: same reference when filter not applicable
    expect(deps.getMultiInvoiceNumbers).not.toHaveBeenCalled();
  });

  it("filters rows by TaxInvoiceNumber (case-insensitive) on efaktur pages", () => {
    const deps = makeDeps({
      getMultiInvoiceNumbers: vi.fn(() => ["INV-001"]),
      isEfakturPage: vi.fn(() => true),
    });
    expect(applyMultiInvoiceFilter(rows, deps)).toEqual([
      { TaxInvoiceNumber: "INV-001", SellingPrice: 100 },
    ]);
  });
});

// ── startPdfDownload ──────────────────────────────────────────────────────────

describe("startPdfDownload", () => {
  const rows = [
    { TaxInvoiceNumber: "INV-001" },
    { TaxInvoiceNumber: "INV-002" },
  ];

  beforeEach(() => {
    mockInvoiceNumbers.length = 0;
    vi.stubGlobal("confirm", vi.fn(() => true));
    vi.stubGlobal("alert", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts START_PDF_DOWNLOAD with the rows and shows the panel", () => {
    const deps = makeDeps();

    const result = startPdfDownload(rows, deps);

    expect(result).toBe(true);
    expect(runLifecycle.isRunning()).toBe(true);
    expect(deps.showPanel).toHaveBeenCalledOnce();
    expect(deps.postToScraper).toHaveBeenCalledWith({
      type: "START_PDF_DOWNLOAD",
      data: rows,
    });
  });

  it("asks for confirmation when more than 10 files would be downloaded", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ TaxInvoiceNumber: `INV-${i}` }));

    startPdfDownload(many, makeDeps());

    expect(globalThis.confirm).toHaveBeenCalledOnce();
  });

  it("does not ask at exactly the threshold — only ABOVE it counts", () => {
    const exactly = Array.from({ length: 10 }, (_, i) => ({ TaxInvoiceNumber: `INV-${i}` }));

    startPdfDownload(exactly, makeDeps());

    expect(globalThis.confirm).not.toHaveBeenCalled();
  });

  it("stays silent when the preference turns confirmation off (threshold 0)", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ TaxInvoiceNumber: `INV-${i}` }));
    const deps = makeDeps({ shouldConfirmBulkDownload: vi.fn(() => false) });

    const started = startPdfDownload(many, deps);

    expect(globalThis.confirm).not.toHaveBeenCalled();
    expect(started).toBe(true);
    expect(deps.postToScraper).toHaveBeenCalledOnce();
  });

  it("asks once the count passes a lowered threshold", () => {
    const few = Array.from({ length: 3 }, (_, i) => ({ TaxInvoiceNumber: `INV-${i}` }));
    const deps = makeDeps({
      shouldConfirmBulkDownload: vi.fn((count: number) => shouldConfirmBulkDownload(count, 2)),
    });

    startPdfDownload(few, deps);

    expect(globalThis.confirm).toHaveBeenCalledOnce();
  });

  it("does not post when the user cancels the confirmation", () => {
    vi.mocked(globalThis.confirm).mockReturnValue(false);
    const many = Array.from({ length: 15 }, (_, i) => ({ TaxInvoiceNumber: `INV-${i}` }));
    const deps = makeDeps();

    const result = startPdfDownload(many, deps);

    expect(result).toBe(false);
    expect(runLifecycle.isRunning()).toBe(false);
    expect(deps.postToScraper).not.toHaveBeenCalled();
  });

  it("names the filtered numbers the captured data has no row for, before starting", () => {
    // Too few files to trigger the confirmation, so this is the only moment the
    // user can still be told which requests the run will leave out.
    const deps = makeDeps({ getMultiInvoiceNumbers: vi.fn(() => ["INV-001", "INV-404"]) });

    const started = startPdfDownload(rows, deps);

    expect(started).toBe(true);
    expect(globalThis.alert).toHaveBeenCalledWith(
      "1 dari 2 nomor faktur tidak ada di data yang sudah diambil dan akan dilewati: INV-404.",
    );
  });

  it("folds the skipped numbers into the confirmation body when one is shown", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ TaxInvoiceNumber: `INV-${i}` }));
    // 12 matches clear the 10-file threshold, so the dialog appears at all; the
    // filter can never match more rows than it names, which is why a broad
    // request is what reaches this path.
    const requested = [...Array.from({ length: 12 }, (_, i) => `INV-${i}`), "INV-404"];
    const deps = makeDeps({ getMultiInvoiceNumbers: vi.fn(() => requested) });

    startPdfDownload(many, deps);

    expect(globalThis.confirm).toHaveBeenCalledOnce();
    const body = vi.mocked(globalThis.confirm).mock.calls[0][0] as unknown as string;
    expect(body).toContain(
      "1 dari 13 nomor faktur tidak ada di data yang sudah diambil dan akan dilewati: INV-404.",
    );
    // The standing age warning is kept: "not in the captured rows" and "too old
    // for Coretax to serve" are two different reasons a requested file is absent.
    expect(body).toContain("Faktur yang sudah lama mungkin tidak bisa diunduh");
    expect(globalThis.alert).not.toHaveBeenCalled();
  });

  it("hands the requested numbers to the completion report", () => {
    const deps = makeDeps({ getMultiInvoiceNumbers: vi.fn(() => ["INV-001", "INV-404"]) });

    startPdfDownload(rows, deps);

    // The completion diffs these against the rows that arrive, so the toast can
    // report how many requested invoices the run left out. A PDF run withholds
    // the panel notice but still carries the count.
    const outcome = runLifecycle.complete(complete({ data: rows, kind: "pdf" }));
    expect(shortfallOf(outcome)).toEqual({ count: 1, notice: null });
  });

  it("records nothing when the confirmation is declined", () => {
    vi.mocked(globalThis.confirm).mockReturnValue(false);
    const many = Array.from({ length: 15 }, (_, i) => ({ TaxInvoiceNumber: `INV-${i}` }));
    const deps = makeDeps({
      getMultiInvoiceNumbers: vi.fn(() => many.map((row) => row.TaxInvoiceNumber)),
    });

    startPdfDownload(many, deps);

    // No run started, so no completion will consume it — a stale list would make
    // a later completion report invoices it never asked about.
    expect(shortfallOf(runLifecycle.complete(complete({ kind: "pdf" })))).toBeNull();
  });

  it("says nothing when every filtered number has a row", () => {
    const deps = makeDeps({ getMultiInvoiceNumbers: vi.fn(() => ["INV-001"]) });

    startPdfDownload(rows, deps);

    expect(globalThis.alert).not.toHaveBeenCalled();
  });

  it("does not report skipped numbers when the No. Faktur filter is empty", () => {
    expect(startPdfDownload(rows, makeDeps())).toBe(true);
    expect(globalThis.alert).not.toHaveBeenCalled();
  });

  it("returns false and alerts when the multi-invoice filter matches nothing", () => {
    const deps = makeDeps({ getMultiInvoiceNumbers: vi.fn(() => ["NOPE"]) });

    const result = startPdfDownload(rows, deps);

    expect(result).toBe(false);
    expect(globalThis.alert).toHaveBeenCalled();
    expect(deps.postToScraper).not.toHaveBeenCalled();
  });
});

// ── Run isolation ────────────────────────────────────────────────────────────
// Per-instance isolation and reset() are covered in run-lifecycle.unit.test.ts.
// What matters here is that these tests do not leak into each other through the
// shared Run, which `beforeEach(reset)` guarantees.

// ── triggerSearch ─────────────────────────────────────────────────────────────
// The delayed click is driven through the injected scheduleDelay so no real
// DOM timer or fake timers are needed.

describe("triggerSearch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeButton(overrides: Partial<HTMLButtonElement> = {}): HTMLButtonElement {
    return {
      id: "",
      textContent: "",
      querySelector: () => null,
      click: vi.fn(),
      ...overrides,
    } as unknown as HTMLButtonElement;
  }

  function captureSchedule() {
    const scheduled: Array<() => void> = [];
    const schedule = (fn: () => void) => {
      scheduled.push(fn);
      return 1;
    };
    return { scheduled, schedule };
  }

  it("schedules a delayed click on the matching search button", () => {
    const click = vi.fn();
    vi.stubGlobal("document", {
      querySelectorAll: () => [makeButton({ textContent: "Cari", click })],
    });
    const { scheduled, schedule } = captureSchedule();

    triggerSearch(schedule);

    expect(scheduled).toHaveLength(1);
    scheduled[0]();
    expect(click).toHaveBeenCalledOnce();
  });

  it("matches buttons by refresh text", () => {
    const click = vi.fn();
    vi.stubGlobal("document", {
      querySelectorAll: () => [makeButton({ textContent: "Refresh Data", click })],
    });
    const { scheduled, schedule } = captureSchedule();

    triggerSearch(schedule);

    expect(scheduled).toHaveLength(1);
  });

  it("matches buttons carrying a pi-search icon even without matching text", () => {
    const click = vi.fn();
    vi.stubGlobal("document", {
      querySelectorAll: () => [
        makeButton({ textContent: "Export", querySelector: () => ({}) as Element, click }),
      ],
    });
    const { scheduled, schedule } = captureSchedule();

    triggerSearch(schedule);

    expect(scheduled).toHaveLength(1);
  });

  it("ignores Cindieh's own ch-* buttons and clicks the real search button", () => {
    const chClick = vi.fn();
    const cariClick = vi.fn();
    vi.stubGlobal("document", {
      querySelectorAll: () => [
        makeButton({ id: "ch-export", textContent: "Export", click: chClick }),
        makeButton({ textContent: "Cari", click: cariClick }),
      ],
    });
    const { scheduled, schedule } = captureSchedule();

    triggerSearch(schedule);

    expect(scheduled).toHaveLength(1);
    scheduled[0]();
    expect(chClick).not.toHaveBeenCalled();
    expect(cariClick).toHaveBeenCalledOnce();
  });

  it("schedules nothing when no search button exists", () => {
    vi.stubGlobal("document", { querySelectorAll: () => [] });
    const { scheduled, schedule } = captureSchedule();

    triggerSearch(schedule);

    expect(scheduled).toHaveLength(0);
  });
});