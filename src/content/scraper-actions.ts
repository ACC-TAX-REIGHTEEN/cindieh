// ============================================================
// SCRAPER-ACTIONS.TS — High-level scraping & download actions
// ============================================================
// Extracted from scraper.ts (MAIN world IIFE) for testability.
// Contains the orchestration logic for paginated scraping,
// bulk PDF downloads, and scrape-by-invoice flows.
//
// Dependencies on browser globals (XHR, postMessage, DOM) are
// injected via the `ctx` parameter so tests can stub them out.
// ============================================================

import { extractFilenameHintFromBody } from "./page-context";
import type { ExportSource } from "./page-context";
import { debugLog, debugError } from "./debug";
import { mergeRows, collectFields } from "./scraper-helpers";
import {
  xhrRequest as xhrRequestFn,
  xhrRequestByInvoice as xhrRequestByInvoiceFn,
  xhrDownloadWithholdingPdf as xhrDownloadWithholdingPdfFn,
  xhrDownloadEfakturPdf as xhrDownloadEfakturPdfFn,
} from "./scraper-xhr";
import type { CapturedRequest, ScrapeMessage } from "./scraper-types";
import {
  DEFAULT_DELAY_PRESET,
  scaleDelay,
  type DelayPreset,
} from "../shared/extension-preferences";

// ── Context interface ─────────────────────────────────
// All dependencies on mutable closure state in scraper.ts are
// injected through this interface. Members cover both the
// orchestration concerns (stopping, messaging, PDF emission, delay)
// and the request-capture concerns (cache state, DOM triggers, timer
// abstraction) — formerly split across ScraperContext and
// InterceptContext. Merging them here lets scraper.ts build a single
// ctx object for both action functions and interceptRequest.

export interface ScraperContext {
  /** Abort in-flight requests and capture waits when this operation is cancelled. */
  signal?: AbortSignal;
  // ── Orchestration (used by scraper-actions) ────────

  /** Returns true when a stop has been requested by the user. */
  isStopRequested(): boolean;
  /** Send a ScrapeMessage back to the content script. */
  sendToContent(msg: ScrapeMessage): void;
  /** Emit a DOWNLOAD_PDF_ITEM message for a bulk-downloaded PDF row. */
  emitPdfDownload(base64: string, item: Record<string, unknown>, source: ExportSource): void;
  /** Read DOM to get the masa pajak period string (PPh 21 pages). */
  getMasaPajakFromDOM(): string;
  /** Sleep for the given number of milliseconds (rate limiting). */
  delay(ms: number): Promise<void>;
  /** XHR timeout in ms. */
  timeout: number;
  /** Maximum consecutive XHR errors before aborting a paginated scrape. */
  maxErrors: number;
  /**
   * The active inter-request pacing preset. Optional so test contexts need not
   * declare it; omitting it means the documented default ("normal"). The
   * production context reads it from the popup's mirrored preference on every
   * run, so a change takes effect without reloading the page.
   */
  getPacing?(): DelayPreset;

  // ── Request capture (used by scraper-intercept) ────

  /** Return the most recently captured request, or null if none. */
  getLastCaptured(): CapturedRequest | null;
  /** Return the epoch-ms timestamp of the last captured request (0 if none). */
  getLastCapturedTime(): number;
  /**
   * Return the ExportSource of the currently-visible grid component, or null
   * when no grid is visible. Used to decide whether the cache is still valid.
   */
  getVisibleGridSource(): ExportSource | null;
  /**
   * Return the ExportSource of the current page URL, or null when the page
   * is not a supported export page.
   */
  getCurrentPageSource(): ExportSource | null;
  /**
   * Return true when the current page URL is a withholding-slips page.
   * Used in the cache-validity check.
   */
  isWithholdingPage(): boolean;
  /**
   * Register a one-shot subscriber that will be called with the next captured
   * request. Returns an unsubscribe function that removes the subscriber
   * without calling it.
   */
  subscribeCapture(fn: (req: CapturedRequest) => void): () => void;
  /**
   * Query a single DOM element by CSS selector.
   * Returns null when no matching element is found.
   */
  queryElement(selector: string): Element | null;
  /**
   * Return all buttons on the page as an array.
   */
  queryAllButtons(): HTMLButtonElement[];
  /** Trigger a click on the given element. */
  clickElement(el: Element): void;
  /**
   * Schedule a callback after `ms` milliseconds. Returns a handle that can
   * be passed to clearTimeout to cancel it.
   * Defaults to window.setTimeout in production; can be stubbed in tests.
   */
  setTimeout(fn: () => void, ms: number): unknown;
  /** Cancel a timeout scheduled by this context's setTimeout. */
  clearTimeout(handle: unknown): void;
}

function signalArgs(ctx: ScraperContext): [] | [AbortSignal] {
  return ctx.signal ? [ctx.signal] : [];
}

/**
 * Circuit breaker shared by the per-item action loops: true once
 * `failures` consecutive item failures reach `ctx.maxErrors`. Callers
 * report the exhaustion themselves: scrapePaginated and the withholding
 * bulk loop throw (startScraping turns that into SCRAPE_ERROR), while the
 * efaktur PDF loop and the targeted-lookup loop send SCRAPE_ERROR and return.
 */
export function consecutiveFailuresExhausted(ctx: ScraperContext, failures: number): boolean {
  return failures >= ctx.maxErrors;
}

/** The DOMException the cancellation paths reject with. */
export function abortError(): DOMException {
  return new DOMException("Permintaan dibatalkan.", "AbortError");
}

// ── Pagination config ─────────────────────────────────
// The Coretax rate-limit pacing lives here, local to the orchestration:
// 500 rows/request for e-invoice, 1000 for SPT, with a slower inter-page
// delay for SPT.

export function getPaginateConfig(
  source: ExportSource,
  preset: DelayPreset = DEFAULT_DELAY_PRESET,
): { step: number; delayMs: number } {
  const isEInvoice =
    source === "OUTPUT_TAX" ||
    source === "INPUT_TAX" ||
    source === "OUTPUT_RETURN" ||
    source === "INPUT_RETURN";
  const isSpt =
    source === "SPT_A2" || source === "SPT_B2" || source.startsWith("PPH_21_");
  return {
    // `step` is fixed by the portal's own page-size caps and is never scaled.
    step: isEInvoice ? 500 : 1000,
    // Pacing only ever slows the run down (multiplier >= 1).
    delayMs: scaleDelay(isSpt ? 150 : 100, preset),
  };
}

/** Read the active preset, falling back to the default for contexts without one. */
function pacingOf(ctx: ScraperContext): DelayPreset {
  return ctx.getPacing?.() ?? DEFAULT_DELAY_PRESET;
}

// ── Paginated scraping loop ───────────────────────────

/**
 * Fetch all pages of data from the API using the captured request template.
 * Sends SCRAPE_PROGRESS updates via `ctx.sendToContent` on each page.
 * Stops early if `ctx.isStopRequested()` returns true.
 *
 * @returns Accumulated rows and total page count. Throws on retry exhaustion.
 */
export async function scrapePaginated(
  captured: CapturedRequest,
  step: number,
  ctx: ScraperContext,
): Promise<{ allData: Record<string, unknown>[]; page: number }> {
  const allData: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let page = 0;
  let first = 0;
  let keepGoing = true;
  let errorCount = 0;
  const startTime = Date.now();
  const { delayMs } = getPaginateConfig(captured.source, pacingOf(ctx));

  while (keepGoing && !ctx.isStopRequested()) {
    page++;
    try {
      const rows = await xhrRequestFn(captured, first, step, ctx.timeout, ...signalArgs(ctx));
      if (ctx.isStopRequested()) break;
      const newRows = mergeRows(allData, seen, rows);

      const elapsed = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;

      debugLog(`Page ${page}: ${rows.length} rows, ${newRows.length} new, total=${allData.length}, ${elapsed}`);

      ctx.sendToContent({
        type: "SCRAPE_PROGRESS",
        total: allData.length,
        page,
        elapsed,
        status: `Page ${page}: ${rows.length} baris, ${newRows.length} baru`,
      });

      if (rows.length < step) {
        keepGoing = false;
      } else {
        first += step;
        errorCount = 0;
        await ctx.delay(delayMs);
      }
    } catch (err) {
      if (ctx.isStopRequested()) break;
      errorCount++;
      const errMsg = err instanceof Error ? err.message : String(err);
      if (consecutiveFailuresExhausted(ctx, errorCount)) {
        throw new Error(`${errorCount} error berturut-turut: ${errMsg}`);
      } else {
        await ctx.delay(2000);
      }
    }
  }

  return { allData, page };
}

// ── Bulk PDF download — withholding slips ─────────────

/**
 * Download all withholding slip PDFs for the given rows.
 * Sends SCRAPE_PROGRESS and DOWNLOAD_PDF_ITEM messages.
 *
 * @returns Number of failed downloads.
 */
export async function downloadBulkWithholdingPdf(
  captured: CapturedRequest,
  allData: Record<string, unknown>[],
  page: number,
  totalElapsed: string,
  ctx: ScraperContext,
): Promise<number> {
  let failureCount = 0;
  let consecutiveFailures = 0;
  const total = allData.length;
  debugLog(`Starting Bulk PDF download for ${total} items...`);

  for (let i = 0; i < total; i++) {
    if (ctx.isStopRequested()) break;

    const row = allData[i];
    const status = `Mengunduh PDF ${i + 1}/${total}: ${row.WithholdingSlipNumber || "..."}`;

    ctx.sendToContent({
      type: "SCRAPE_PROGRESS",
      total: i + 1,
      page,
      elapsed: totalElapsed,
      status,
      currentIndex: i + 1,
      totalCount: total,
      failureCount,
    });

    try {
      const base64 = await xhrDownloadWithholdingPdfFn(captured, row, ctx.timeout, ...signalArgs(ctx));
      if (ctx.isStopRequested()) break;
      ctx.emitPdfDownload(base64, row, "WITHHOLDING_SLIPS");
      consecutiveFailures = 0;
    } catch (err) {
      if (ctx.isStopRequested()) break;
      failureCount++;
      consecutiveFailures++;
      debugError(`Gagal unduh PDF idx ${i}:`, err);
      if (consecutiveFailuresExhausted(ctx, consecutiveFailures)) {
        throw new Error(`${consecutiveFailures} kegagalan unduh PDF berturut-turut. Periksa sesi Coretax dan coba lagi.`);
      }
    }
    await ctx.delay(scaleDelay(800, pacingOf(ctx)));
  }

  return failureCount;
}

// ── Main scraping orchestrator ────────────────────────

/**
 * Full scrape: intercept → paginate → (bulk PDF if withholding) → complete.
 * Caller is responsible for setting `isRunning` state before and after.
 *
 * @param interceptRequest - Promise factory that resolves with the captured XHR.
 * @param options.skipPdf - On withholding pages, collect the rows without the
 *   bulk PDF download that a withholding scrape otherwise performs.
 */
export async function startScraping(
  interceptRequest: () => Promise<CapturedRequest>,
  ctx: ScraperContext,
  options: { skipPdf?: boolean } = {},
): Promise<void> {
  debugLog("▶ Starting scrape...");
  if (ctx.isStopRequested()) return;

  try {
    ctx.sendToContent({
      type: "SCRAPE_PROGRESS",
      total: 0,
      page: 0,
      elapsed: "0s",
      status: "Menangkap request dari Angular...",
    });

    const captured = await interceptRequest();
    if (ctx.isStopRequested()) return;
    const startTime = Date.now();

    const { step } = getPaginateConfig(captured.source);

    const { allData, page } = await scrapePaginated(captured, step, ctx);

    if (ctx.isStopRequested()) {
      debugLog("⏹ Stopped by user.");
      return;
    }

    const fieldSet = collectFields(allData);
    const totalElapsed = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;

    debugLog(`✅ Complete: ${allData.length} records in ${totalElapsed}`);

    let filenameHint = extractFilenameHintFromBody(captured.rawBody, captured.source) || "";

    if (!filenameHint && captured.source.startsWith("PPH_21_")) {
      filenameHint = ctx.getMasaPajakFromDOM();
      debugLog("Filename hint from DOM:", filenameHint);
    }

    // A withholding scrape normally IS a bulk PDF download. An XLSX/CSV export
    // asks for the rows only (skipPdf), so the same scrape can feed the sheet
    // without firing one PDF request per slip.
    const withholdingPdfRun = captured.source === "WITHHOLDING_SLIPS" && !options.skipPdf;
    let failureCount = 0;
    if (withholdingPdfRun) {
      failureCount = await downloadBulkWithholdingPdf(captured, allData, page, totalElapsed, ctx);
    }
    if (ctx.isStopRequested()) return;

    ctx.sendToContent({
      type: "SCRAPE_COMPLETE",
      data: allData,
      fields: [...fieldSet],
      total: allData.length,
      pages: page,
      elapsed: totalElapsed,
      filenameHint: filenameHint || undefined,
      source: captured.source,
      partial: failureCount > 0,
      failureCount,
      // A withholding run IS a bulk PDF download — same message, different job.
      kind: withholdingPdfRun ? "pdf" : "scrape",
    });
  } catch (err) {
    if (ctx.isStopRequested()) return;
    const errMsg = err instanceof Error ? err.message : String(err);
    debugError("❌ Error:", errMsg);
    ctx.sendToContent({ type: "SCRAPE_ERROR", message: errMsg });
  }

  debugLog("⏹ Scraping finished.");
}

// ── Bulk PDF download — efaktur ───────────────────────

/**
 * Download PDFs for a pre-collected list of efaktur rows using the
 * cached captured request. Caller is responsible for `isRunning` state.
 */
export async function startPdfDownload(
  data: Record<string, unknown>[],
  lastCaptured: CapturedRequest,
  ctx: ScraperContext,
): Promise<void> {
  if (ctx.isStopRequested()) return;
  const source = lastCaptured.source;
  const startTime = Date.now();
  let failureCount = 0;
  let consecutiveFailures = 0;
  const total = data.length;

  debugLog(`▶ Starting Bulk PDF download for ${total} efaktur items (source: ${source})...`);

  ctx.sendToContent({
    type: "SCRAPE_PROGRESS",
    total: 0,
    page: 0,
    elapsed: "0s",
    status: `Memulai unduh ${total} PDF...`,
    currentIndex: 0,
    totalCount: total,
    failureCount: 0,
  });

  for (let i = 0; i < total; i++) {
    if (ctx.isStopRequested()) {
      debugLog("⏹ PDF download stopped by user.");
      break;
    }

    const row = data[i];
    const ref = (row.Reference as string) || (row.TaxInvoiceNumber as string) || "...";
    const elapsed = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;

    ctx.sendToContent({
      type: "SCRAPE_PROGRESS",
      total: i + 1,
      page: 0,
      elapsed,
      status: `Mengunduh PDF ${i + 1}/${total}: ${ref}`,
      currentIndex: i + 1,
      totalCount: total,
      failureCount,
    });

    try {
      const base64 = await xhrDownloadEfakturPdfFn(lastCaptured, row, source, ctx.timeout, ...signalArgs(ctx));
      if (ctx.isStopRequested()) return;
      ctx.emitPdfDownload(base64, row, source);
      consecutiveFailures = 0;
    } catch (err) {
      if (ctx.isStopRequested()) return;
      failureCount++;
      consecutiveFailures++;
      debugError(`Gagal unduh PDF efaktur idx ${i} (${ref}):`, err);
      if (consecutiveFailuresExhausted(ctx, consecutiveFailures)) {
        ctx.sendToContent({
          type: "SCRAPE_ERROR",
          message: `${consecutiveFailures} kegagalan unduh PDF berturut-turut. Periksa sesi Coretax dan coba lagi.`,
        });
        return;
      }
    }
    await ctx.delay(scaleDelay(800, pacingOf(ctx)));
  }
  if (ctx.isStopRequested()) return;

  const totalElapsed = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;
  debugLog(
    `✅ PDF download complete: ${total - failureCount}/${total} succeeded, ${failureCount} failed in ${totalElapsed}`,
  );

  ctx.sendToContent({
    type: "SCRAPE_COMPLETE",
    data,
    fields: [],
    total,
    pages: 0,
    elapsed: totalElapsed,
    source,
    partial: failureCount > 0,
    failureCount,
    kind: "pdf",
  });
}

// ── Scrape by invoice numbers ─────────────────────────

/**
 * Fetch rows for a specific list of invoice numbers using individual
 * targeted requests. Much faster than a full paginated scrape when
 * the user only needs a small subset of invoices.
 * Caller is responsible for `isRunning` state.
 *
 * Each invoice number is retried up to MAX_INVOICE_RETRIES times with
 * linear backoff (1s, then 2s) before being skipped. If consecutive
 * failures reach ctx.maxErrors the entire operation is aborted.
 */
export async function scrapeByInvoices(
  invoiceNumbers: string[],
  lastCaptured: CapturedRequest,
  ctx: ScraperContext,
): Promise<void> {
  const MAX_INVOICE_RETRIES = 2;
  const BACKOFF_BASE_MS = 1000;

  const startTime = Date.now();
  const allData: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const failedInvoices: string[] = [];
  let consecutiveFailures = 0;

  for (let i = 0; i < invoiceNumbers.length; i++) {
    if (ctx.isStopRequested()) break;

    const num = invoiceNumbers[i];
    let success = false;

    for (let attempt = 0; attempt <= MAX_INVOICE_RETRIES; attempt++) {
      if (ctx.isStopRequested()) break;

      if (attempt > 0) {
        const backoffMs = BACKOFF_BASE_MS * attempt;
        const elapsed = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;
        ctx.sendToContent({
          type: "SCRAPE_PROGRESS",
          total: allData.length,
          page: i + 1,
          elapsed,
          status: `Mencoba ulang: ${num} (percobaan ${attempt + 1}/${MAX_INVOICE_RETRIES + 1})`,
        });
        await ctx.delay(backoffMs);
        if (ctx.isStopRequested()) return;
      } else {
        const elapsed = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;
        ctx.sendToContent({
          type: "SCRAPE_PROGRESS",
          total: allData.length,
          page: i + 1,
          elapsed,
          status: `Mencari: ${num} (${i + 1}/${invoiceNumbers.length})`,
        });
      }

      try {
        const rows = await xhrRequestByInvoiceFn(lastCaptured, num, ctx.timeout, ...signalArgs(ctx));
        if (ctx.isStopRequested()) return;
        mergeRows(allData, seen, rows);
        consecutiveFailures = 0;
        success = true;
        await ctx.delay(scaleDelay(50, pacingOf(ctx)));
        break;
      } catch (err) {
        if (ctx.isStopRequested()) return;
        const errMsg = err instanceof Error ? err.message : String(err);
        if (attempt < MAX_INVOICE_RETRIES) {
          debugLog(`Gagal mencari ${num} (percobaan ${attempt + 1}), akan dicoba ulang: ${errMsg}`);
        } else {
          debugError(`Gagal mencari ${num} setelah ${MAX_INVOICE_RETRIES + 1} percobaan:`, err);
        }
      }
    }

    if (ctx.isStopRequested()) return;
    if (!success) {
      failedInvoices.push(num);
      consecutiveFailures++;
      if (consecutiveFailuresExhausted(ctx, consecutiveFailures)) {
        ctx.sendToContent({
          type: "SCRAPE_ERROR",
          message: `${ctx.maxErrors} kegagalan berturut-turut saat mencari faktur. Proses dihentikan.`,
        });
        debugError(`scrapeByInvoices: aborted after ${ctx.maxErrors} consecutive failures`);
        return;
      }
      await ctx.delay(scaleDelay(50, pacingOf(ctx)));
    }
  }
  if (ctx.isStopRequested()) return;

  const totalElapsed = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;
  const fieldSet = collectFields(allData);

  ctx.sendToContent({
    type: "SCRAPE_COMPLETE",
    data: allData,
    fields: [...fieldSet],
    total: allData.length,
    pages: invoiceNumbers.length,
    elapsed: totalElapsed,
    source: lastCaptured.source,
    partial: failedInvoices.length > 0,
    failedInvoices,
    failureCount: failedInvoices.length,
    kind: "scrape",
  });
}
