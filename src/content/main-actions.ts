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
import { isEfakturPage, type ExportSource } from "./page-context";
import type { ScrapeProgress, ScrapeComplete, ScrapeError } from "./scraper-types";
import { showPanel, updatePanelProgress, updatePanelError, updatePanelIdle } from "./ui-badge";
import { getMultiInvoiceNumbers } from "./ui-filters";
import { postToScraper } from "./bridge";
import { debugLog, debugWarn } from "./debug";
import { getPreferences } from "./preferences";
import { findMissingInvoices, skippedInvoicesMessage } from "./scrape-result";
import { shouldConfirmBulkDownload } from "../shared/extension-preferences";

// ── Types ────────────────────────────────────────────

/**
 * The most recent scrape outcome, retained so main.ts can re-surface it —
 * e.g. showing a prior error after a result is rejected or invalidated.
 */
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
  pendingCheck: boolean;
  /**
   * The No. Faktur numbers this run was asked for — set by a targeted-scrape
   * dispatch and by a filtered bulk PDF download. The completion handler diffs
   * them against the rows that came back to count the shortfall: a not-found
   * number succeeds with an empty payload, so it never reaches `failedInvoices`.
   * Empty when no No. Faktur filter applies.
   */
  requestedInvoices: string[];
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
    pendingCheck: false,
    requestedInvoices: [],
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
  /** Render the panel in its error state (used by the stop path to report cancellation). */
  updatePanelError: (message: string) => void;
  getMultiInvoiceNumbers: () => string[];
  /** True on efaktur pages (PPN Keluaran/Masukan/Retur) — the only pages where the No. Faktur filter applies. */
  isEfakturPage: () => boolean;
  /**
   * Whether a bulk download of `count` files must be confirmed first. Injected
   * because the answer comes from the popup preference, which is read
   * synchronously from the preferences snapshot.
   */
  shouldConfirmBulkDownload: (count: number) => boolean;
  exportXLSX: (data: ExportData) => void;
  exportCSV: (data: ExportData) => void;
  /** Find and click the Coretax search/refresh button. */
  triggerSearch: () => void;
}

/**
 * Shown when a stop (button or re-export) cancels a running operation:
 * the aborted run's results are rejected, so the panel must not promise
 * reusable data.
 */
export const SCRAPE_CANCELLED_MESSAGE =
  "Proses dihentikan. Ekspor dan pemeriksaan otomatis dibatalkan. Jalankan ulang untuk memperoleh data lengkap.";

/** Build a production ActionDeps that calls the real browser globals. */
export function createActionDeps(): ActionDeps {
  return {
    postToScraper,
    showPanel,
    updatePanelProgress,
    updatePanelError,
    updatePanelIdle,
    getMultiInvoiceNumbers,
    isEfakturPage: () => isEfakturPage(),
    shouldConfirmBulkDownload: (count) =>
      shouldConfirmBulkDownload(count, getPreferences().bulkConfirmThreshold),
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

export function applyMultiInvoiceFilter(
  d: Record<string, unknown>[],
  deps: Pick<ActionDeps, "getMultiInvoiceNumbers" | "isEfakturPage"> = createActionDeps(),
): Record<string, unknown>[] {
  // No. Faktur filtering exists for efaktur pages only; on other pages
  // (e.g. withholding slips) pass every row through untouched.
  if (!deps.isEfakturPage()) return d;
  const nums = deps.getMultiInvoiceNumbers();
  if (nums.length === 0) return d;
  const set = new Set(nums.map((n) => n.toLowerCase()));
  return d.filter((r) => set.has(String(r.TaxInvoiceNumber || r.LetterNumber || "").toLowerCase()));
}

/**
 * The START_SCRAPE fields a requested export format implies. On a withholding
 * page the same scrape normally ends in a bulk PDF download, so an XLSX/CSV
 * request has to say "rows only" or the sheet would arrive trailing one PDF per
 * slip. Exported because the INJECTED_READY resend in main.ts must repeat the
 * same intent when the first message was sent before the scraper existed.
 */
export function scrapeIntentForFormat(
  format: ContentState["pendingExportFormat"],
): { skipPdf?: boolean } {
  return format && format !== "pdf" ? { skipPdf: true } : {};
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
  options: { skipPdf?: boolean } = {},
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
  deps.postToScraper({ type: "START_SCRAPE", ...options });
}

/**
 * Start a bulk PDF download for the given rows: apply the multi-invoice
 * filter, confirm when the count is large, show the panel, and post
 * START_PDF_DOWNLOAD to the scraper.
 *
 * Accepts an optional ContentState + ActionDeps for testability.
 */
/**
 * Body of the pre-download confirmation. The threshold that decides WHETHER to
 * ask lives in the popup preference; the wording lives here, next to the flow it
 * interrupts.
 *
 * `skippedNotice` names the filtered numbers the captured data has no row for.
 * It is added to the two standing lines rather than replacing them: "not in the
 * captured rows" and "too old for Coretax to serve" are different reasons a
 * requested file can be absent from a run, and the user needs both.
 */
export function bulkDownloadConfirmMessage(count: number, skippedNotice?: string | null): string {
  const missedSection = skippedNotice ? `\n\n${skippedNotice}` : "";
  return `Anda akan mengunduh ${count} file PDF. Proses ini mungkin memakan waktu beberapa saat.${missedSection}\n\nFaktur yang sudah lama mungkin tidak bisa diunduh dan akan dilewati (skip).\n\nLanjutkan?`;
}

export function startPdfDownload(
  data: Record<string, unknown>[],
  state: ContentState = contentState,
  deps: ActionDeps = createActionDeps(),
): boolean {
  const filtered = applyMultiInvoiceFilter(data, deps);
  if (filtered.length === 0) {
    globalThis.alert?.("Tidak ada faktur yang cocok dengan filter No. Faktur.\nKosongkan filter atau periksa nomor faktur.");
    return false;
  }
  // Numbers the filter asked for that no captured row carries: those files would
  // just be absent from the run. The panel switches to per-file progress the
  // moment the download starts, so a panel notice could not survive — this has
  // to ride the pre-download dialog, or an alert when the threshold means no
  // dialog appears at all.
  const requested = deps.isEfakturPage() ? deps.getMultiInvoiceNumbers() : [];
  const skippedNotice = skippedInvoicesMessage(requested.length, findMissingInvoices(requested, data));

  if (deps.shouldConfirmBulkDownload(filtered.length)) {
    const confirmed = globalThis.confirm?.(bulkDownloadConfirmMessage(filtered.length, skippedNotice));
    if (!confirmed) return false;
  } else if (skippedNotice) {
    globalThis.alert?.(skippedNotice);
  }
  // Hand the request to the completion handler, which diffs it against the rows
  // that were actually downloaded to report the count. Recorded only once the run
  // is really starting, so a declined confirmation leaves nothing behind for a
  // later completion to be measured against.
  state.requestedInvoices = requested;
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
 *   confirmation flow internally), returns true — or false when that flow
 *   declined it (no invoice matched the filter, or the user cancelled the
 *   confirmation), so the caller can tell "nothing started" from "running".
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
    // The aborted run emits no completion, so its request is dropped here (a
    // later scrape must not be diffed against it) and the cancellation is
    // surfaced like the panel toggle does, instead of implying idle reusable data.
    state.requestedInvoices = [];
    deps.updatePanelError(SCRAPE_CANCELLED_MESSAGE);
    return true;
  }

  if (state.scrapedData && state.scrapedFields) {
    // PDF runs its own filtering + confirmation flow, and it reports whether it
    // actually started (nothing matched the filter, or the confirmation was
    // cancelled). Propagate that instead of reporting success unconditionally.
    if (format === "pdf") {
      return startPdfDownload(state.scrapedData, state, deps);
    }

    // XLSX / CSV: export immediately
    const exportData: ExportData = {
      data: state.scrapedData,
      fields: state.scrapedFields,
      filenameHint: state.lastExportMeta?.filenameHint,
      source: state.lastExportMeta?.source,
      mode: state.exportMode,
      filenamePrefix: getPreferences().filenamePrefix,
    };
    if (format === "xlsx") {
      deps.exportXLSX(exportData);
    } else {
      deps.exportCSV(exportData);
    }
    return true;
  }

  // No data yet — check multi-invoice filter (XLSX/CSV only, efaktur pages only)
  if (format !== "pdf" && deps.isEfakturPage()) {
    const nums = deps.getMultiInvoiceNumbers();
    if (nums.length > 0) {
      debugLog("[Cindieh] sending SCRAPE_BY_INVOICES", nums);
      state.isRunning = true;
      deps.showPanel();
      state.pendingExportFormat = format;
      // Remember what was asked for: the completion handler diffs it against the
      // rows that arrive and reports the numbers Coretax has no row for.
      state.requestedInvoices = nums;
      deps.postToScraper({
        type: "SCRAPE_BY_INVOICES",
        invoiceNumbers: nums,
      });
      return true;
    }
  }

  state.pendingExportFormat = format;
  startScrape(state, deps, scrapeIntentForFormat(format));
  return true;
}
