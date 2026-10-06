// ============================================================
// MAIN-ACTIONS.TS — Export action handlers (extracted from main.ts)
// ============================================================
// Contains the export-related action handlers and the dependencies they need.
//
// The state these handlers used to carry themselves is gone. They now drive a
// Run through run-lifecycle's interface instead of poking fields, which is what
// makes "a pending request is spent exactly once" a rule rather than a habit
// (ADR-0014). ActionDeps stays here, untouched: the export decision tree belongs
// to this module (ADR-0004), and run-lifecycle has no browser dependency.
// ============================================================

import { type ExportData, type ExportMode, exportXLSX, exportCSV } from "./exporter";
import { isEfakturPage, isOutputTaxPage } from "./page-context";
import { showPanel, updatePanelProgress, updatePanelError, updatePanelIdle } from "./ui-badge";
import { getMultiInvoiceNumbers } from "./ui-filters";
import { postToScraper } from "./bridge";
import { debugError, debugLog, debugWarn } from "./debug";
import { getPreferences } from "./preferences";
import { findMissingInvoices, skippedInvoicesMessage } from "./scrape-result";
import { runLifecycle } from "./run-lifecycle";
import { shouldConfirmBulkDownload } from "../shared/extension-preferences";

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
  /**
   * The stored export mode (raw/cleaned). It lives with the popup's
   * EXPORT_MODE_STORAGE_KEY and the storage listener that maintains it, which is
   * main.ts — so it arrives here as a function rather than as run state.
   */
  getExportMode: () => ExportMode;
  /**
   * Whether the year-wide batch export is available here. Injected for the same
   * reason isEfakturPage is: the answer belongs to the page, not to this module,
   * and a test double has to be able to say no.
   */
  isBatchPage: () => boolean;
  /**
   * Both writers are typed as possibly-async: `exportXLSX` must load the
   * SheetJS chunk before it can write, while `exportCSV` is synchronous and
   * needs no library. The union also lets a test double return nothing.
   */
  exportXLSX: (data: ExportData) => void | Promise<void>;
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

/**
 * Shown when the XLSX export cannot produce a file — in practice a failed
 * load of the SheetJS chunk. The export is fire-and-forget from the click, so
 * without this the failure would be a silent no-op.
 */
export const EXPORT_XLSX_FAILED_MESSAGE =
  "Gagal membuat berkas Excel. Periksa koneksi lalu coba ekspor kembali.";

/**
 * Build a production ActionDeps that calls the real browser globals.
 *
 * `getExportMode` has no default on purpose: the export mode is not run state
 * and not something this module can discover, so a caller that forgets it
 * should fail to compile rather than silently export in the wrong mode.
 */
export function createActionDeps(getExportMode: () => ExportMode): ActionDeps {
  return {
    postToScraper,
    showPanel,
    updatePanelProgress,
    updatePanelError,
    updatePanelIdle,
    getMultiInvoiceNumbers,
    isEfakturPage: () => isEfakturPage(),
    // PPN Keluaran only: the one grid whose period filter was measured to be
    // scriptable, and whose twelve months form a single meaningful export.
    isBatchPage: () => isOutputTaxPage(),
    shouldConfirmBulkDownload: (count) =>
      shouldConfirmBulkDownload(count, getPreferences().bulkConfirmThreshold),
    getExportMode,
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
  deps: Pick<ActionDeps, "getMultiInvoiceNumbers" | "isEfakturPage"> = {
    getMultiInvoiceNumbers,
    isEfakturPage: () => isEfakturPage(),
  },
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
  format: "xlsx" | "csv" | "pdf" | null,
): { skipPdf?: boolean } {
  return format && format !== "pdf" ? { skipPdf: true } : {};
}

/**
 * Start a full scrape: show the panel, retire the previous rows, and post
 * START_SCRAPE to the page world.
 *
 * Takes only the three calls a bare scrape uses, so a caller outside the export
 * path (the panel asking for data before it can compare) can supply exactly
 * those rather than a whole ActionDeps it would never touch.
 */
export function startScrape(
  deps: Pick<ActionDeps, "showPanel" | "updatePanelProgress" | "postToScraper">,
  options: { skipPdf?: boolean } = {},
): void {
  deps.showPanel();
  runLifecycle.begin("scrape");
  deps.updatePanelProgress(0, 0, "0s", "Menangkap request dari Angular...");
  deps.postToScraper({ type: "START_SCRAPE", ...options });
}

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

/**
 * Start a bulk PDF download for the given rows: apply the No. Faktur filter,
 * confirm when the count is large, show the panel, and post START_PDF_DOWNLOAD.
 *
 * Returns false when the flow did not start — no invoice matched the filter, or
 * the user cancelled the confirmation — so the caller can tell "nothing
 * started" from "running".
 */
export function startPdfDownload(data: Record<string, unknown>[], deps: ActionDeps): boolean {
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
  runLifecycle.begin("bulk-pdf");
  runLifecycle.noteRequestedInvoices(requested);
  deps.showPanel();
  deps.postToScraper({ type: "START_PDF_DOWNLOAD", data: filtered });
  return true;
}

/**
 * How many months one batch export sweeps: a whole tax year, which is the unit
 * a filing is actually prepared in.
 */
export const BATCH_MONTHS = 12;

/**
 * Body of the batch confirmation.
 *
 * The run is long enough -- measured at roughly four minutes under our own
 * pacing for a taxpayer of this size -- that starting it by accident costs a
 * wait and a stop. It says what it will do, that the panel shows progress, and
 * that it can be stopped, none of which the click itself conveys.
 */
export function batchConfirmMessage(): string {
  return (
    "Ekspor satu tahun mengambil seluruh 12 masa pajak dalam satu file.\n\n" +
    "Prosesnya bisa memakan waktu beberapa menit. Panel menampilkan progres per masa, " +
    "dan proses bisa dihentikan kapan saja.\n\n" +
    "Lanjutkan?"
  );
}

/**
 * Start a year-wide export: ONE Run that sweeps every tax period of the year.
 *
 * Returns false when the flow did not start -- the page does not support it, a
 * run is already in flight, or the confirmation was declined -- so the caller
 * can tell "nothing started" from "running", exactly as startPdfDownload does.
 *
 * A declined confirmation leaves nothing behind: no Run is begun and nothing is
 * posted, because no completion would ever arrive to settle one.
 */
export function startBatchExport(deps: ActionDeps): boolean {
  if (!deps.isBatchPage()) {
    globalThis.alert?.("Ekspor satu tahun hanya tersedia di halaman PPN Keluaran.");
    return false;
  }
  if (runLifecycle.isRunning()) {
    globalThis.alert?.(
      "Masih ada proses yang berjalan. Hentikan atau tunggu sampai selesai sebelum memulai ekspor satu tahun.",
    );
    return false;
  }
  if (!globalThis.confirm?.(batchConfirmMessage())) return false;

  // The XLSX export is requested up front so the completed rows are written out
  // without a second click; the batch is a data scrape, so it asks for rows only.
  runLifecycle.request({ kind: "export", format: "xlsx" });
  runLifecycle.begin("scrape");
  deps.showPanel();
  deps.updatePanelProgress(0, 0, "0s", "Menangkap request dari Angular...");
  debugLog("[Cindieh] starting batch export over", BATCH_MONTHS, "periods");
  deps.postToScraper({
    type: "START_SCRAPE",
    skipPdf: true,
    batchMonths: BATCH_MONTHS,
  });
  return true;
}

/**
 * Common export action handler shared by XLSX, CSV, and PDF.
 *
 * - If already running: stops the run and reports the cancellation, true.
 * - If data is available: exports immediately (PDF runs its filter +
 *   confirmation flow internally), returns true — or false when that flow
 *   declined it (no invoice matched the filter, or the user cancelled the
 *   confirmation), so the caller can tell "nothing started" from "running".
 * - If no data (XLSX/CSV with a No. Faktur filter): starts a targeted scrape,
 *   true.
 * - Otherwise: records the pending format and starts a scrape, true.
 */
export function handleExportAction(format: "xlsx" | "csv" | "pdf", deps: ActionDeps): boolean {
  if (runLifecycle.isRunning()) {
    deps.postToScraper({ type: "STOP_SCRAPE" });
    // The aborted run emits no completion, so its request is dropped here (a
    // later scrape must not be diffed against it) and the cancellation is
    // surfaced like the panel toggle does, instead of implying idle reusable data.
    runLifecycle.cancelExport();
    deps.updatePanelError(SCRAPE_CANCELLED_MESSAGE);
    return true;
  }

  const result = runLifecycle.result();
  if (result) {
    // PDF runs its own filtering + confirmation flow, and it reports whether it
    // actually started (nothing matched the filter, or the confirmation was
    // cancelled). Propagate that instead of reporting success unconditionally.
    if (format === "pdf") {
      return startPdfDownload(result.data, deps);
    }

    const exportData: ExportData = {
      data: result.data,
      fields: result.fields,
      filenameHint: result.filenameHint,
      source: result.source,
      mode: deps.getExportMode(),
      filenamePrefix: getPreferences().filenamePrefix,
    };
    if (format === "xlsx") {
      // Async because the writer first loads the SheetJS chunk. Wrapped in
      // Promise.resolve so a synchronous test double is handled too.
      void Promise.resolve(deps.exportXLSX(exportData)).catch((err: unknown) => {
        debugError("Gagal mengekspor ke Excel", err);
        deps.showPanel();
        deps.updatePanelError(EXPORT_XLSX_FAILED_MESSAGE);
      });
    } else {
      deps.exportCSV(exportData);
    }
    return true;
  }

  // No data yet — check the No. Faktur filter (XLSX/CSV only, efaktur pages only)
  if (format !== "pdf" && deps.isEfakturPage()) {
    const nums = deps.getMultiInvoiceNumbers();
    if (nums.length > 0) {
      runLifecycle.begin("targeted");
      deps.showPanel();
      runLifecycle.request({ kind: "export", format });
      // Remember what was asked for: the completion handler diffs it against the
      // rows that arrive and reports the numbers Coretax has no row for.
      runLifecycle.noteRequestedInvoices(nums);
      debugLog("[Cindieh] sending SCRAPE_BY_INVOICES", nums);
      deps.postToScraper({
        type: "SCRAPE_BY_INVOICES",
        invoiceNumbers: nums,
      });
      return true;
    }
  }

  runLifecycle.request({ kind: "export", format });
  startScrape(deps, scrapeIntentForFormat(format));
  return true;
}