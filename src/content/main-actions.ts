// ============================================================
// MAIN-ACTIONS.TS — Export action handlers (extracted from main.ts)
// ============================================================
// Contains export-related action handlers and shared state
// accessed by both main.ts (message relay) and the export UI events.
// ============================================================

import { type ExportData, exportXLSX, exportCSV } from "./exporter";
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

// ── Constants ────────────────────────────────────────

const SEARCH_CLICK_DELAY_MS = 100;

// ── Shared State ─────────────────────────────────────

let isRunning = false;
let scrapedData: Record<string, unknown>[] | null = null;
let scrapedFields: string[] | null = null;
let lastExportMeta: LastExportMeta | null = null;
let pendingExportFormat: "xlsx" | "csv" | "pdf" | null = null;
let pendingCompare = false;
let lastState: ScrapeState | null = null;

// ── State Getters / Setters ──────────────────────────

export function getIsRunning(): boolean {
  return isRunning;
}

export function setIsRunning(v: boolean): void {
  isRunning = v;
}

export function getScrapedData(): Record<string, unknown>[] | null {
  return scrapedData;
}

export function setScrapedData(v: Record<string, unknown>[] | null): void {
  scrapedData = v;
}

export function getScrapedFields(): string[] | null {
  return scrapedFields;
}

export function setScrapedFields(v: string[] | null): void {
  scrapedFields = v;
}

export function getLastExportMeta(): LastExportMeta | null {
  return lastExportMeta;
}

export function setLastExportMeta(v: LastExportMeta | null): void {
  lastExportMeta = v;
}

export function getPendingExportFormat(): "xlsx" | "csv" | "pdf" | null {
  return pendingExportFormat;
}

export function setPendingExportFormat(format: "xlsx" | "csv" | "pdf" | null): void {
  pendingExportFormat = format;
}

export function clearPendingExportFormat(): void {
  pendingExportFormat = null;
}

export function getPendingCompare(): boolean {
  return pendingCompare;
}

export function setPendingCompare(v: boolean): void {
  pendingCompare = v;
}

export function getLastState(): ScrapeState | null {
  return lastState;
}

export function setLastState(v: ScrapeState | null): void {
  lastState = v;
}

/** Reset all module-level state — call on SPA navigation. */
export function resetState(): void {
  isRunning = false;
  scrapedData = null;
  scrapedFields = null;
  lastExportMeta = null;
  pendingExportFormat = null;
  pendingCompare = false;
  lastState = null;
}

// ── Functions ────────────────────────────────────────

/** Helper: find and click the search/refresh button */
export function triggerSearch(): void {
  const searchBtn = Array.from(document.querySelectorAll("button")).find((btn) => {
    // Ignore Better Coretax's own injected buttons (they use pi-search/pi-refresh icons)
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

export function startScrape(): void {
  showPanel();
  setIsRunning(true);
  setScrapedData(null);
  setScrapedFields(null);
  setLastExportMeta(null);
  setLastState({
    type: "SCRAPE_PROGRESS",
    total: 0,
    page: 0,
    elapsed: "0s",
    status: "Menunggu...",
  });
  updatePanelProgress(0, 0, "0s", "Menangkap request dari Angular...");
  postToScraper({ type: "START_SCRAPE" });
}

/**
 * Common export action handler shared by XLSX, CSV, and PDF.
 * - Stops if already running
 * - Exports immediately if data is available (XLSX/CSV only; PDF returns false for caller to handle)
 * - Checks multi-invoice filter (XLSX/CSV) and starts invoice-targeted scrape if needed
 * - Otherwise sets pendingExportFormat and calls startScrape()
 *
 * Returns false when data is available for PDF (caller must handle filtering/confirmation).
 * Returns true otherwise (action was fully handled).
 */
export function handleExportAction(format: "xlsx" | "csv" | "pdf"): boolean {
  if (getIsRunning()) {
    postToScraper({ type: "STOP_SCRAPE" });
    setIsRunning(false);
    setPendingExportFormat(null);
    updatePanelIdle();
    return true;
  }

  if (getScrapedData() && getScrapedFields()) {
    // PDF: let caller handle filtering, confirmation, and download
    if (format === "pdf") return false;

    // XLSX / CSV: export immediately
    const exportData: ExportData = {
      data: getScrapedData()!,
      fields: getScrapedFields()!,
      filenameHint: getLastExportMeta()?.filenameHint,
      source: getLastExportMeta()?.source,
    };
    if (format === "xlsx") {
      exportXLSX(exportData);
    } else {
      exportCSV(exportData);
    }
    return true;
  }

  // No data yet — check multi-invoice filter (XLSX/CSV only)
  if (format !== "pdf") {
    const nums2 = getMultiInvoiceNumbers();
    if (nums2.length > 0) {
      debugLog("[BC] sending SCRAPE_BY_INVOICES", nums2);
      setIsRunning(true);
      showPanel();
      setPendingExportFormat(format);
      postToScraper({
        type: "SCRAPE_BY_INVOICES",
        invoiceNumbers: nums2,
      });
      return true;
    }
  }

  setPendingExportFormat(format);
  startScrape();
  return true;
}
