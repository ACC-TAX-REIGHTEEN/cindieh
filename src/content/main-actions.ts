// ============================================================
// MAIN-ACTIONS.TS — Export action handlers (extracted from main.ts)
// ============================================================
// Contains export-related action handlers and shared state
// accessed by both main.ts (message relay) and the export UI events.
//
// State is now managed via ContentState objects created by
// createContentState(). The module also exports a default singleton
// instance (used by main.ts and ui-comparer.ts) alongside the
// factory so tests can create independent, isolated instances.
// ============================================================

import { type ExportData, type ExportMode, exportXLSX, exportCSV } from "./exporter";
import type { ExportSource } from "./page-context";
import type { ScrapeProgress, ScrapeComplete, ScrapeError } from "./scraper-types";
import { showPanel, updatePanelProgress, updatePanelIdle } from "./ui-badge";
import { getMultiInvoiceNumbers } from "./ui-filters";
import { postToScraper } from "./bridge";
import { debugLog, debugWarn } from "./debug";

// ── Types ────────────────────────────────────────────

/** The last scrape message, persisted for reconnection. */
export type ScrapeState = ScrapeProgress | ScrapeComplete | ScrapeError;

export interface LastExportMeta {
  filenameHint?: string;
  source?: ExportSource;
}

// ── State object ─────────────────────────────────────
// Encapsulates all mutable state that was previously stored as
// bare module-level `let` variables. Tests create a fresh instance
// per test case — no shared singleton reset ceremony.

export interface ContentState {
  isRunning: boolean;
  scrapedData: Record<string, unknown>[] | null;
  scrapedFields: string[] | null;
  lastExportMeta: LastExportMeta | null;
  pendingExportFormat: "xlsx" | "csv" | "pdf" | null;
  pendingCompare: boolean;
  lastState: ScrapeState | null;
  exportMode: ExportMode;
}

export function createContentState(): ContentState {
  return {
    isRunning: false,
    scrapedData: null,
    scrapedFields: null,
    lastExportMeta: null,
    pendingExportFormat: null,
    pendingCompare: false,
    lastState: null,
    exportMode: "cleaned",
  };
}

// ── Module singleton ──────────────────────────────────
// main.ts and ui-comparer.ts import this object directly.
// Tests should call createContentState() and use the action
// functions directly instead of depending on this singleton.

export const contentState: ContentState = createContentState();

export function resetContentState(
  state: ContentState,
  options: { preserveExportMode?: boolean } = {},
): void {
  const exportMode = state.exportMode;
  Object.assign(state, createContentState());
  if (options.preserveExportMode) {
    state.exportMode = exportMode;
  }
}

// ── Constants ────────────────────────────────────────

const SEARCH_CLICK_DELAY_MS = 100;

// ── Dependencies interface ────────────────────────────
// All browser/DOM dependencies needed by the action functions.
// Injected so tests can stub them without touching the DOM.

export interface ActionDeps {
  postToScraper: (msg: Record<string, unknown>) => void;
  showPanel: () => void;
  updatePanelProgress: (total: number, page: number, elapsed: string, status: string) => void;
  updatePanelIdle: () => void;
  getMultiInvoiceNumbers: () => string[];
  exportXLSX: (data: ExportData) => void;
  exportCSV: (data: ExportData) => void;
  /** Find and click the Coretax search/refresh button. */
  triggerSearch: () => void;
}

/** Build a production ActionDeps that calls the real browser globals. */
export function createActionDeps(): ActionDeps {
  return {
    postToScraper,
    showPanel,
    updatePanelProgress,
    updatePanelIdle,
    getMultiInvoiceNumbers,
    exportXLSX,
    exportCSV,
    triggerSearch: () => triggerSearch(),
  };
}

// ── Functions ────────────────────────────────────────

/**
 * Helper: find and click the search/refresh button.
 *
 * `scheduleDelay` defaults to the global setTimeout in production; tests pass
 * a stub to capture the click without touching the DOM timer.
 */
export function triggerSearch(
  scheduleDelay: (fn: () => void, ms: number) => unknown = setTimeout,
): void {
  const searchBtn = Array.from(document.querySelectorAll("button")).find((btn) => {
    // Ignore Cindieh's own injected buttons (they use pi-search/pi-refresh icons)
    if (btn.id?.startsWith("ch-")) return false;
    const text = btn.textContent?.toLowerCase() || "";
    const hasIcon = !!btn.querySelector(".pi-search, .pi-refresh, .pi-filter");
    return text.includes("cari") || text.includes("refresh") || hasIcon;
  }) as HTMLButtonElement;

  if (searchBtn) {
    debugLog("Triggering search via button:", searchBtn.textContent?.trim());
    scheduleDelay(() => searchBtn.click(), SEARCH_CLICK_DELAY_MS);
  } else {
    debugWarn("Could not find search/refresh button");
  }
}

export function applyMultiInvoiceFilter(d: Record<string, unknown>[]): Record<string, unknown>[] {
  const nums = getMultiInvoiceNumbers();
  if (nums.length === 0) return d;
  const set = new Set(nums.map((n) => n.toLowerCase()));
  return d.filter((r) => set.has(String(r.TaxInvoiceNumber || r.LetterNumber || "").toLowerCase()));
}

/**
 * Start a full scrape: show the panel, reset scraped data, and post
 * START_SCRAPE to the page world.
 *
 * Accepts an optional ContentState + ActionDeps for testability.
 * When omitted, uses the module singleton and production deps.
 */
export function startScrape(
  state: ContentState = contentState,
  deps: ActionDeps = createActionDeps(),
): void {
  deps.showPanel();
  state.isRunning = true;
  state.scrapedData = null;
  state.scrapedFields = null;
  state.lastExportMeta = null;
  state.lastState = {
    type: "SCRAPE_PROGRESS",
    total: 0,
    page: 0,
    elapsed: "0s",
    status: "Menunggu...",
  };
  deps.updatePanelProgress(0, 0, "0s", "Menangkap request dari Angular...");
  deps.postToScraper({ type: "START_SCRAPE" });
}

/**
 * Start a bulk PDF download for the given rows: apply the multi-invoice
 * filter, confirm when the count is large, show the panel, and post
 * START_PDF_DOWNLOAD to the scraper.
 *
 * Accepts an optional ContentState + ActionDeps for testability.
 */
export function startPdfDownload(
  data: Record<string, unknown>[],
  state: ContentState = contentState,
  deps: ActionDeps = createActionDeps(),
): boolean {
  const filtered = applyMultiInvoiceFilter(data);
  if (filtered.length === 0) {
    globalThis.alert?.("Tidak ada faktur yang cocok dengan filter No. Faktur.\nKosongkan filter atau periksa nomor faktur.");
    return false;
  }
  if (filtered.length > 10) {
    const confirmed = globalThis.confirm?.(
      `Anda akan mengunduh ${filtered.length} file PDF. Proses ini mungkin memakan waktu beberapa saat.\n\nFaktur yang sudah lama mungkin tidak bisa diunduh dan akan dilewati (skip).\n\nLanjutkan?`,
    );
    if (!confirmed) return false;
  }
  state.isRunning = true;
  deps.showPanel();
  deps.postToScraper({ type: "START_PDF_DOWNLOAD", data: filtered });
  return true;
}

/**
 * Common export action handler shared by XLSX, CSV, and PDF.
 *
 * - If already running: stops scrape, resets pending format, returns true.
 * - If data is available: exports immediately (PDF runs its filter +
 *   confirmation flow internally), returns true.
 * - If no data (XLSX/CSV with multi-invoice filter): starts targeted scrape, returns true.
 * - Otherwise: sets pendingExportFormat and calls startScrape(), returns true.
 *
 * Accepts an optional ContentState + ActionDeps for testability.
 */
export function handleExportAction(
  format: "xlsx" | "csv" | "pdf",
  state: ContentState = contentState,
  deps: ActionDeps = createActionDeps(),
): boolean {
  if (state.isRunning) {
    deps.postToScraper({ type: "STOP_SCRAPE" });
    state.isRunning = false;
    state.pendingExportFormat = null;
    deps.updatePanelIdle();
    return true;
  }

  if (state.scrapedData && state.scrapedFields) {
    // PDF runs its own filtering + confirmation flow.
    if (format === "pdf") {
      startPdfDownload(state.scrapedData, state, deps);
      return true;
    }

    // XLSX / CSV: export immediately
    const exportData: ExportData = {
      data: state.scrapedData,
      fields: state.scrapedFields,
      filenameHint: state.lastExportMeta?.filenameHint,
      source: state.lastExportMeta?.source,
      mode: state.exportMode,
    };
    if (format === "xlsx") {
      deps.exportXLSX(exportData);
    } else {
      deps.exportCSV(exportData);
    }
    return true;
  }

  // No data yet — check multi-invoice filter (XLSX/CSV only)
  if (format !== "pdf") {
    const nums = deps.getMultiInvoiceNumbers();
    if (nums.length > 0) {
      debugLog("[BC] sending SCRAPE_BY_INVOICES", nums);
      state.isRunning = true;
      deps.showPanel();
      state.pendingExportFormat = format;
      deps.postToScraper({
        type: "SCRAPE_BY_INVOICES",
        invoiceNumbers: nums,
      });
      return true;
    }
  }

  state.pendingExportFormat = format;
  startScrape(state, deps);
  return true;
}
