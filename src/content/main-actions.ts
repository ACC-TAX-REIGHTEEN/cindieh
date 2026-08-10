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
import { getMultiInvoiceNumbers, showPanel, updatePanelProgress, updatePanelIdle } from "./ui";
import { postToScraper } from "./bridge";
import { debugLog, debugWarn } from "./debug";

// ── Types ────────────────────────────────────────────

export interface ScrapeState {
  type: "SCRAPE_PROGRESS" | "SCRAPE_COMPLETE" | "SCRAPE_ERROR";
  total?: number;
  page?: number;
  pages?: number;
  elapsed?: string;
  status?: string;
  message?: string;
  data?: Record<string, unknown>[];
  fields?: string[];
}

export interface LastExportMeta {
  filenameHint?: string;
  source?: ExportSource;
}

// ── State object ─────────────────────────────────────
// Encapsulates all mutable state that was previously stored as
// bare module-level `let` variables. Tests create a fresh instance
// per test case — no shared singleton, no resetState() ceremony.

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
// main.ts and ui-comparer.ts import this directly.
// Tests should call createContentState() and use the action
// functions directly instead of depending on this singleton.

let _state: ContentState = createContentState();

// ── State Getters / Setters (singleton API) ──────────
// Kept for backward compatibility with main.ts which uses them
// directly. New code should prefer passing a ContentState object.

export function getIsRunning(): boolean { return _state.isRunning; }
export function setIsRunning(v: boolean): void { _state.isRunning = v; }

export function getScrapedData(): Record<string, unknown>[] | null { return _state.scrapedData; }
export function setScrapedData(v: Record<string, unknown>[] | null): void { _state.scrapedData = v; }

export function getScrapedFields(): string[] | null { return _state.scrapedFields; }
export function setScrapedFields(v: string[] | null): void { _state.scrapedFields = v; }

export function getLastExportMeta(): LastExportMeta | null { return _state.lastExportMeta; }
export function setLastExportMeta(v: LastExportMeta | null): void { _state.lastExportMeta = v; }

export function getPendingExportFormat(): "xlsx" | "csv" | "pdf" | null { return _state.pendingExportFormat; }
export function setPendingExportFormat(format: "xlsx" | "csv" | "pdf" | null): void { _state.pendingExportFormat = format; }

export function clearPendingExportFormat(): void { _state.pendingExportFormat = null; }

export function getPendingCompare(): boolean { return _state.pendingCompare; }
export function setPendingCompare(v: boolean): void { _state.pendingCompare = v; }

export function getLastState(): ScrapeState | null { return _state.lastState; }
export function setLastState(v: ScrapeState | null): void { _state.lastState = v; }

export function getExportMode(): ExportMode { return _state.exportMode; }
export function setExportMode(v: ExportMode): void { _state.exportMode = v; }

/** Reset the singleton — call on SPA navigation. */
export function resetState(): void {
  const exportMode = _state.exportMode;
  _state = createContentState();
  _state.exportMode = exportMode;
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

/** Helper: find and click the search/refresh button */
export function triggerSearch(): void {
  const searchBtn = Array.from(document.querySelectorAll("button")).find((btn) => {
    // Ignore Cindieh's own injected buttons (they use pi-search/pi-refresh icons)
    if (btn.id?.startsWith("ch-")) return false;
    const text = btn.textContent?.toLowerCase() || "";
    const hasIcon = !!btn.querySelector(".pi-search, .pi-refresh, .pi-filter");
    return text.includes("cari") || text.includes("refresh") || hasIcon;
  }) as HTMLButtonElement;

  if (searchBtn) {
    debugLog("Triggering search via button:", searchBtn.textContent?.trim());
    setTimeout(() => searchBtn.click(), SEARCH_CLICK_DELAY_MS);
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
  state: ContentState = _state,
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
 * Common export action handler shared by XLSX, CSV, and PDF.
 *
 * - If already running: stops scrape, resets pending format, returns true.
 * - If data is available (XLSX/CSV): exports immediately, returns true.
 * - If data is available (PDF): returns false — caller handles filtering/confirmation.
 * - If no data (XLSX/CSV with multi-invoice filter): starts targeted scrape, returns true.
 * - Otherwise: sets pendingExportFormat and calls startScrape(), returns true.
 *
 * Accepts an optional ContentState + ActionDeps for testability.
 */
export function handleExportAction(
  format: "xlsx" | "csv" | "pdf",
  state: ContentState = _state,
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
    // PDF: let caller handle filtering, confirmation, and download
    if (format === "pdf") return false;

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
