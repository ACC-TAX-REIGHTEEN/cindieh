// Unit tests for main-actions.ts
// Tests createContentState, handleExportAction, startScrape, and applyMultiInvoiceFilter
// using injected deps — no DOM, no module singleton.
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
import {
  createContentState,
  resetContentState,
  handleExportAction,
  startPdfDownload,
  startScrape,
  applyMultiInvoiceFilter,
  triggerSearch,
  scrapeIntentForFormat,
  SCRAPE_CANCELLED_MESSAGE,
  type ContentState,
  type ActionDeps,
} from "../content/main-actions";
import type { ExportData } from "../content/exporter";
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
    // The real predicate over the documented default threshold, so the cases
    // below exercise the shipped decision instead of a stub that always says yes.
    shouldConfirmBulkDownload: vi.fn((count: number) =>
      shouldConfirmBulkDownload(count, DEFAULT_BULK_CONFIRM_THRESHOLD),
    ),
    exportXLSX: vi.fn(),
    exportCSV: vi.fn(),
    triggerSearch: vi.fn(),
    ...overrides,
  };
}

// ── createContentState ────────────────────────────────────────────────────────

describe("createContentState", () => {
  it("creates a fresh state with all fields at their zero values", () => {
    const state = createContentState();
    expect(state.isRunning).toBe(false);
    expect(state.scrapedData).toBeNull();
    expect(state.scrapedFields).toBeNull();
    expect(state.lastExportMeta).toBeNull();
    expect(state.pendingExportFormat).toBeNull();
    expect(state.pendingCompare).toBe(false);
    expect(state.requestedInvoices).toEqual([]);
    expect(state.lastState).toBeNull();
    expect(state.exportMode).toBe("cleaned");
  });

  it("each call returns an independent object (no shared reference)", () => {
    const a = createContentState();
    const b = createContentState();
    a.isRunning = true;
    expect(b.isRunning).toBe(false);
  });
});

describe("resetContentState", () => {
  it("resets a ContentState object in place and preserves exportMode only when requested", () => {
    const state = createContentState();
    state.isRunning = true;
    state.scrapedData = [{ id: 1 }];
    state.pendingExportFormat = "pdf";
    state.exportMode = "raw";
    const sameState = state;

    resetContentState(state);

    expect(state).toBe(sameState);
    expect(state.isRunning).toBe(false);
    expect(state.scrapedData).toBeNull();
    expect(state.pendingExportFormat).toBeNull();
    expect(state.exportMode).toBe("cleaned");

    state.exportMode = "raw";
    state.isRunning = true;
    resetContentState(state, { preserveExportMode: true });

    expect(state).toBe(sameState);
    expect(state.isRunning).toBe(false);
    expect(state.exportMode).toBe("raw");
  });
});

// ── startScrape ───────────────────────────────────────────────────────────────

describe("startScrape", () => {
  it("sets isRunning to true", () => {
    const state = createContentState();
    startScrape(state, makeDeps());
    expect(state.isRunning).toBe(true);
  });

  it("clears scrapedData, scrapedFields, and lastExportMeta", () => {
    const state = createContentState();
    state.scrapedData = [{ id: 1 }];
    state.scrapedFields = ["id"];
    state.lastExportMeta = { filenameHint: "hint" };

    startScrape(state, makeDeps());

    expect(state.scrapedData).toBeNull();
    expect(state.scrapedFields).toBeNull();
    expect(state.lastExportMeta).toBeNull();
  });

  it("sets lastState to a progress placeholder", () => {
    const state = createContentState();
    startScrape(state, makeDeps());
    expect(state.lastState).toMatchObject({ type: "SCRAPE_PROGRESS", elapsed: "0s" });
  });

  it("calls showPanel", () => {
    const deps = makeDeps();
    startScrape(createContentState(), deps);
    expect(deps.showPanel).toHaveBeenCalledOnce();
  });

  it("calls updatePanelProgress with initial zeroes", () => {
    const deps = makeDeps();
    startScrape(createContentState(), deps);
    expect(deps.updatePanelProgress).toHaveBeenCalledWith(0, 0, "0s", expect.any(String));
  });

  it("posts START_SCRAPE to the scraper", () => {
    const deps = makeDeps();
    startScrape(createContentState(), deps);
    expect(deps.postToScraper).toHaveBeenCalledWith({ type: "START_SCRAPE" });
  });

  it("does not mutate a second independent state", () => {
    const stateA = createContentState();
    const stateB = createContentState();
    startScrape(stateA, makeDeps());
    expect(stateB.isRunning).toBe(false);
  });
});

// ── handleExportAction — already running ──────────────────────────────────────

describe("handleExportAction — already running", () => {
  let state: ContentState;
  let deps: ActionDeps;

  beforeEach(() => {
    state = createContentState();
    state.isRunning = true;
    state.pendingExportFormat = "xlsx";
    deps = makeDeps();
  });

  it("posts STOP_SCRAPE", () => {
    handleExportAction("xlsx", state, deps);
    expect(deps.postToScraper).toHaveBeenCalledWith({ type: "STOP_SCRAPE" });
  });

  it("renders the cancellation message on the panel", () => {
    handleExportAction("xlsx", state, deps);
    expect(deps.updatePanelError).toHaveBeenCalledWith(SCRAPE_CANCELLED_MESSAGE);
  });

  it("sets isRunning to false", () => {
    handleExportAction("xlsx", state, deps);
    expect(state.isRunning).toBe(false);
  });

  it("clears pendingExportFormat", () => {
    handleExportAction("xlsx", state, deps);
    expect(state.pendingExportFormat).toBeNull();
  });

  it("reports the cancellation instead of rendering an idle panel", () => {
    handleExportAction("xlsx", state, deps);
    expect(deps.updatePanelError).toHaveBeenCalledWith(SCRAPE_CANCELLED_MESSAGE);
    expect(deps.updatePanelIdle).not.toHaveBeenCalled();
  });

  it("returns true for all formats when running", () => {
    for (const fmt of ["xlsx", "csv", "pdf"] as const) {
      const s = createContentState();
      s.isRunning = true;
      expect(handleExportAction(fmt, s, makeDeps())).toBe(true);
    }
  });
});

// ── handleExportAction — data already scraped ────────────────────────────────

describe("handleExportAction — data already scraped", () => {
  const scrapedData = [{ Reference: "REF-001", SellingPrice: 100, VAT: 11 }];
  const scrapedFields = ["Reference", "SellingPrice", "VAT"];

  function makeStateWithData(): ContentState {
    const state = createContentState();
    state.scrapedData = scrapedData;
    state.scrapedFields = scrapedFields;
    state.lastExportMeta = { filenameHint: "hint", source: "OUTPUT_TAX" };
    return state;
  }

  it("calls exportXLSX with the correct ExportData for xlsx format", () => {
    const deps = makeDeps();
    handleExportAction("xlsx", makeStateWithData(), deps);
    expect(deps.exportXLSX).toHaveBeenCalledOnce();
    const arg = (deps.exportXLSX as ReturnType<typeof vi.fn>).mock.calls[0][0] as ExportData;
    expect(arg.data).toBe(scrapedData);
    expect(arg.fields).toBe(scrapedFields);
    expect(arg.filenameHint).toBe("hint");
    expect(arg.source).toBe("OUTPUT_TAX");
  });

  it("passes the selected export mode to xlsx exports", () => {
    const deps = makeDeps();
    const state = makeStateWithData();
    state.exportMode = "raw";
    handleExportAction("xlsx", state, deps);
    const arg = (deps.exportXLSX as ReturnType<typeof vi.fn>).mock.calls[0][0] as ExportData;
    expect(arg.mode).toBe("raw");
  });

  it("calls exportCSV with the correct ExportData for csv format", () => {
    const deps = makeDeps();
    handleExportAction("csv", makeStateWithData(), deps);
    expect(deps.exportCSV).toHaveBeenCalledOnce();
    const arg = (deps.exportCSV as ReturnType<typeof vi.fn>).mock.calls[0][0] as ExportData;
    expect(arg.data).toBe(scrapedData);
  });

  it("returns true for pdf format when data exists (handled internally)", () => {
    const deps = makeDeps();
    const result = handleExportAction("pdf", makeStateWithData(), deps);
    expect(result).toBe(true);
  });

  it("reports the pdf flow's decline instead of always claiming success", () => {
    // The boolean used to be constant `true`, which made it useless; the
    // confirmation flow's decline is now propagated.
    vi.stubGlobal("confirm", vi.fn(() => false));
    vi.stubGlobal("alert", vi.fn());
    try {
      const state = createContentState();
      state.scrapedData = Array.from({ length: 11 }, (_, i) => ({ TaxInvoiceNumber: `INV-${i}` }));
      state.scrapedFields = ["TaxInvoiceNumber"];
      const deps = makeDeps();

      const declined = handleExportAction("pdf", state, deps);

      expect(declined).toBe(false);
      expect(state.isRunning).toBe(false);
      expect(deps.postToScraper).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "START_PDF_DOWNLOAD" }),
      );

      // Same rows, confirmation accepted: it starts and reports so.
      vi.stubGlobal("confirm", vi.fn(() => true));
      const acceptedState = createContentState();
      acceptedState.scrapedData = state.scrapedData;
      acceptedState.scrapedFields = state.scrapedFields;
      const accepted = handleExportAction("pdf", acceptedState, makeDeps());
      expect(accepted).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("posts START_PDF_DOWNLOAD for pdf format when data exists", () => {
    const deps = makeDeps();
    handleExportAction("pdf", makeStateWithData(), deps);
    expect(deps.postToScraper).toHaveBeenCalledWith(
      expect.objectContaining({ type: "START_PDF_DOWNLOAD" }),
    );
  });

  it("does NOT call exportXLSX/exportCSV for pdf format", () => {
    const deps = makeDeps();
    handleExportAction("pdf", makeStateWithData(), deps);
    expect(deps.exportXLSX).not.toHaveBeenCalled();
    expect(deps.exportCSV).not.toHaveBeenCalled();
  });

  it("returns true for xlsx and csv when data exists", () => {
    expect(handleExportAction("xlsx", makeStateWithData(), makeDeps())).toBe(true);
    expect(handleExportAction("csv", makeStateWithData(), makeDeps())).toBe(true);
  });

  it("does not start a new scrape when data is already present", () => {
    const deps = makeDeps();
    handleExportAction("xlsx", makeStateWithData(), deps);
    expect(deps.postToScraper).not.toHaveBeenCalledWith(expect.objectContaining({ type: "START_SCRAPE" }));
  });
});

// ── handleExportAction — multi-invoice filter (no data yet) ──────────────────

describe("handleExportAction — multi-invoice filter", () => {
  it("sends SCRAPE_BY_INVOICES when invoice numbers are present and format is xlsx", () => {
    const state = createContentState();
    const deps = makeDeps({
      getMultiInvoiceNumbers: vi.fn(() => ["INV-001", "INV-002"]),
    });

    handleExportAction("xlsx", state, deps);

    expect(deps.postToScraper).toHaveBeenCalledWith({
      type: "SCRAPE_BY_INVOICES",
      invoiceNumbers: ["INV-001", "INV-002"],
    });
  });

  it("remembers the requested numbers so the result can be diffed against them", () => {
    const state = createContentState();
    const deps = makeDeps({
      getMultiInvoiceNumbers: vi.fn(() => ["INV-001", "INV-002"]),
    });

    handleExportAction("xlsx", state, deps);

    expect(state.requestedInvoices).toEqual(["INV-001", "INV-002"]);
  });

  it("leaves no request behind when the user aborts the targeted scrape", () => {
    const state = createContentState();
    state.isRunning = true;
    state.requestedInvoices = ["INV-001"];

    handleExportAction("xlsx", state, makeDeps());

    // The aborted run emits no completion, so nothing would ever consume it.
    expect(state.requestedInvoices).toEqual([]);
  });

  it("sets isRunning to true and pendingExportFormat to the requested format", () => {
    const state = createContentState();
    const deps = makeDeps({
      getMultiInvoiceNumbers: vi.fn(() => ["INV-001"]),
    });

    handleExportAction("csv", state, deps);

    expect(state.isRunning).toBe(true);
    expect(state.pendingExportFormat).toBe("csv");
  });

  it("calls showPanel when starting a multi-invoice scrape", () => {
    const state = createContentState();
    const deps = makeDeps({
      getMultiInvoiceNumbers: vi.fn(() => ["INV-001"]),
    });

    handleExportAction("xlsx", state, deps);

    expect(deps.showPanel).toHaveBeenCalledOnce();
  });

  it("does NOT use SCRAPE_BY_INVOICES for pdf format (skips filter)", () => {
    const state = createContentState();
    const deps = makeDeps({
      getMultiInvoiceNumbers: vi.fn(() => ["INV-001"]),
    });

    handleExportAction("pdf", state, deps);

    // pdf bypasses the multi-invoice check; should fall through to startScrape
    expect(deps.postToScraper).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "SCRAPE_BY_INVOICES" }),
    );
    expect(deps.postToScraper).toHaveBeenCalledWith({ type: "START_SCRAPE" });
  });

  it("does NOT use SCRAPE_BY_INVOICES on non-efaktur pages (e.g. withholding slips)", () => {
    const state = createContentState();
    const deps = makeDeps({
      getMultiInvoiceNumbers: vi.fn(() => ["INV-001"]),
      isEfakturPage: vi.fn(() => false),
    });

    handleExportAction("xlsx", state, deps);

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
  it("sets pendingExportFormat before starting scrape", () => {
    const state = createContentState();
    handleExportAction("xlsx", state, makeDeps());
    expect(state.pendingExportFormat).toBe("xlsx");
  });

  it("posts START_SCRAPE as a data-only request for a sheet format", () => {
    const deps = makeDeps();
    handleExportAction("xlsx", createContentState(), deps);
    expect(deps.postToScraper).toHaveBeenCalledWith({ type: "START_SCRAPE", skipPdf: true });
  });

  it("keeps the plain START_SCRAPE for a PDF request", () => {
    const deps = makeDeps();
    handleExportAction("pdf", createContentState(), deps);
    expect(deps.postToScraper).toHaveBeenCalledWith({ type: "START_SCRAPE" });
  });

  it("returns true for all formats in this path", () => {
    for (const fmt of ["xlsx", "csv", "pdf"] as const) {
      expect(handleExportAction(fmt, createContentState(), makeDeps())).toBe(true);
    }
  });

  it("does not call exportXLSX or exportCSV", () => {
    const deps = makeDeps();
    handleExportAction("xlsx", createContentState(), deps);
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
    const result = applyMultiInvoiceFilter(rows, makeDeps());
    expect(result).toHaveLength(rows.length);
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
    const result = applyMultiInvoiceFilter(rows, deps);
    expect(result).toEqual([{ TaxInvoiceNumber: "INV-001", SellingPrice: 100 }]);
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
    const state = createContentState();

    const result = startPdfDownload(rows, state, deps);

    expect(result).toBe(true);
    expect(state.isRunning).toBe(true);
    expect(deps.showPanel).toHaveBeenCalledOnce();
    expect(deps.postToScraper).toHaveBeenCalledWith({
      type: "START_PDF_DOWNLOAD",
      data: rows,
    });
  });

  it("asks for confirmation when more than 10 files would be downloaded", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ TaxInvoiceNumber: `INV-${i}` }));
    const deps = makeDeps();

    startPdfDownload(many, createContentState(), deps);

    expect(globalThis.confirm).toHaveBeenCalledOnce();
  });

  it("does not ask at exactly the threshold — only ABOVE it counts", () => {
    const exactly = Array.from({ length: 10 }, (_, i) => ({ TaxInvoiceNumber: `INV-${i}` }));

    startPdfDownload(exactly, createContentState(), makeDeps());

    expect(globalThis.confirm).not.toHaveBeenCalled();
  });

  it("stays silent when the preference turns confirmation off (threshold 0)", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ TaxInvoiceNumber: `INV-${i}` }));
    const deps = makeDeps({ shouldConfirmBulkDownload: vi.fn(() => false) });

    const started = startPdfDownload(many, createContentState(), deps);

    expect(globalThis.confirm).not.toHaveBeenCalled();
    expect(started).toBe(true);
    expect(deps.postToScraper).toHaveBeenCalledOnce();
  });

  it("asks once the count passes a lowered threshold", () => {
    const few = Array.from({ length: 3 }, (_, i) => ({ TaxInvoiceNumber: `INV-${i}` }));
    const deps = makeDeps({
      shouldConfirmBulkDownload: vi.fn((count: number) => shouldConfirmBulkDownload(count, 2)),
    });

    startPdfDownload(few, createContentState(), deps);

    expect(globalThis.confirm).toHaveBeenCalledOnce();
  });

  it("does not post when the user cancels the confirmation", () => {
    vi.mocked(globalThis.confirm).mockReturnValue(false);
    const many = Array.from({ length: 15 }, (_, i) => ({ TaxInvoiceNumber: `INV-${i}` }));
    const deps = makeDeps();
    const state = createContentState();

    const result = startPdfDownload(many, state, deps);

    expect(result).toBe(false);
    expect(state.isRunning).toBe(false);
    expect(deps.postToScraper).not.toHaveBeenCalled();
  });

  it("names the filtered numbers the captured data has no row for, before starting", () => {
    // Too few files to trigger the confirmation, so this is the only moment the
    // user can still be told which requests the run will leave out.
    const deps = makeDeps({ getMultiInvoiceNumbers: vi.fn(() => ["INV-001", "INV-404"]) });

    const started = startPdfDownload(rows, createContentState(), deps);

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

    startPdfDownload(many, createContentState(), deps);

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

  it("says nothing when every filtered number has a row", () => {
    const deps = makeDeps({ getMultiInvoiceNumbers: vi.fn(() => ["INV-001"]) });

    startPdfDownload(rows, createContentState(), deps);

    expect(globalThis.alert).not.toHaveBeenCalled();
  });

  it("does not report skipped numbers when the No. Faktur filter is empty", () => {
    const started = startPdfDownload(rows, createContentState(), makeDeps());

    expect(started).toBe(true);
    expect(globalThis.alert).not.toHaveBeenCalled();
  });

  it("returns false and alerts when the multi-invoice filter matches nothing", () => {
    const deps = makeDeps({
      getMultiInvoiceNumbers: vi.fn(() => ["NOPE"]),
    });
    const result = startPdfDownload(rows, createContentState(), deps);

    expect(result).toBe(false);
    expect(globalThis.alert).toHaveBeenCalled();
    expect(deps.postToScraper).not.toHaveBeenCalled();
  });
});

// ── State isolation between test cases ───────────────────────────────────────

describe("state isolation", () => {
  it("mutations to one ContentState do not affect another", () => {
    const stateA = createContentState();
    const stateB = createContentState();

    stateA.isRunning = true;
    stateA.scrapedData = [{ id: 1 }];
    stateA.pendingExportFormat = "pdf";

    expect(stateB.isRunning).toBe(false);
    expect(stateB.scrapedData).toBeNull();
    expect(stateB.pendingExportFormat).toBeNull();
  });

  it("two sequential startScrape calls on separate states do not interfere", () => {
    const stateA = createContentState();
    const stateB = createContentState();
    const depsA = makeDeps();
    const depsB = makeDeps();

    startScrape(stateA, depsA);
    startScrape(stateB, depsB);

    expect(depsA.postToScraper).toHaveBeenCalledOnce();
    expect(depsB.postToScraper).toHaveBeenCalledOnce();
  });
});

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
