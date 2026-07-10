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
import { debugLog, debugError } from "./debug";
import { mergeRows, collectFields } from "./scraper-helpers";
import {
  xhrRequest as xhrRequestFn,
  xhrRequestByInvoice as xhrRequestByInvoiceFn,
  xhrDownloadWithholdingPdf as xhrDownloadWithholdingPdfFn,
  xhrDownloadEfakturPdf as xhrDownloadEfakturPdfFn,
} from "./scraper-xhr";
import type { CapturedRequest, ScrapeMessage } from "./scraper-types";

// ── Context interface ─────────────────────────────────
// All dependencies on mutable closure state in scraper.ts are
// injected through this interface so the action functions are pure
// enough to unit-test without a live browser.

export interface ScraperContext {
  /** Returns true when a stop has been requested by the user. */
  isStopRequested(): boolean;
  /** Send a ScrapeMessage back to the content script. */
  sendToContent(msg: ScrapeMessage): void;
  /** Post a raw message to window (for DOWNLOAD_PDF_ITEM). */
  postMessage(msg: Record<string, unknown>): void;
  /** Read DOM to get the masa pajak period string (PPh 21 pages). */
  getMasaPajakFromDOM(): string;
  /** XHR timeout in ms. */
  timeout: number;
  /** Maximum consecutive XHR errors before aborting a paginated scrape. */
  maxErrors: number;
}

// ── Helpers ───────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Paginated scraping loop ───────────────────────────

/**
 * Fetch all pages of data from the API using the captured request template.
 * Sends SCRAPE_PROGRESS updates via `ctx.sendToContent` on each page.
 * Stops early if `ctx.isStopRequested()` returns true.
 *
 * @returns Accumulated rows and total page count.
 */
export async function scrapePaginated(
  captured: CapturedRequest,
  step: number,
  delayMs: number,
  ctx: ScraperContext,
): Promise<{ allData: Record<string, unknown>[]; page: number }> {
  const allData: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let page = 0;
  let first = 0;
  let keepGoing = true;
  let errorCount = 0;
  const startTime = Date.now();

  while (keepGoing && !ctx.isStopRequested()) {
    page++;
    try {
      const rows = await xhrRequestFn(captured, first, step, ctx.timeout);
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
        await delay(delayMs);
      }
    } catch (err) {
      errorCount++;
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errorCount >= ctx.maxErrors) {
        keepGoing = false;
        ctx.sendToContent({
          type: "SCRAPE_ERROR",
          message: `${ctx.maxErrors} error berturut-turut: ${errMsg}`,
        });
      } else {
        await delay(2000);
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
      const base64 = await xhrDownloadWithholdingPdfFn(captured, row, ctx.timeout);
      ctx.postMessage({
        type: "DOWNLOAD_PDF_ITEM",
        base64,
        item: row,
        direction: "FROM_PAGE",
      });
      await delay(800);
    } catch (err) {
      failureCount++;
      debugError(`Gagal unduh PDF idx ${i}:`, err);
    }
  }

  return failureCount;
}

// ── Main scraping orchestrator ────────────────────────

/**
 * Full scrape: intercept → paginate → (bulk PDF if withholding) → complete.
 * Caller is responsible for setting `isRunning` state before and after.
 *
 * @param interceptRequest - Promise factory that resolves with the captured XHR.
 */
export async function startScraping(
  interceptRequest: () => Promise<CapturedRequest>,
  ctx: ScraperContext,
): Promise<void> {
  debugLog("▶ Starting scrape...");

  try {
    ctx.sendToContent({
      type: "SCRAPE_PROGRESS",
      total: 0,
      page: 0,
      elapsed: "0s",
      status: "Menangkap request dari Angular...",
    });

    const captured = await interceptRequest();
    const startTime = Date.now();

    const isSpt =
      captured.source === "SPT_A2" || captured.source === "SPT_B2" || captured.source.startsWith("PPH_21_");
    const step = isSpt ? 1000 : 500;
    const delayMs = isSpt ? 150 : 100;

    const { allData, page } = await scrapePaginated(captured, step, delayMs, ctx);

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

    let failureCount = 0;
    if (captured.source === "WITHHOLDING_SLIPS") {
      failureCount = await downloadBulkWithholdingPdf(captured, allData, page, totalElapsed, ctx);
    }

    ctx.sendToContent({
      type: "SCRAPE_COMPLETE",
      data: allData,
      fields: [...fieldSet],
      total: allData.length,
      pages: page,
      elapsed: totalElapsed,
      filenameHint: filenameHint || undefined,
      source: captured.source,
      failureCount,
    });
  } catch (err) {
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
  const source = lastCaptured.source;
  const startTime = Date.now();
  let failureCount = 0;
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
      const base64 = await xhrDownloadEfakturPdfFn(lastCaptured, row, source, ctx.timeout);
      ctx.postMessage({
        type: "DOWNLOAD_PDF_ITEM",
        base64,
        item: row,
        source,
        direction: "FROM_PAGE",
      });
      await delay(800);
    } catch (err) {
      failureCount++;
      debugError(`Gagal unduh PDF efaktur idx ${i} (${ref}):`, err);
    }
  }

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
    failureCount,
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
 * exponential backoff before being skipped. If consecutive failures
 * exceed ctx.maxErrors the entire operation is aborted.
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
        await delay(backoffMs);
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
        const rows = await xhrRequestByInvoiceFn(lastCaptured, num, ctx.timeout);
        mergeRows(allData, seen, rows);
        consecutiveFailures = 0;
        success = true;
        await delay(50);
        break;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (attempt < MAX_INVOICE_RETRIES) {
          debugLog(`Gagal mencari ${num} (percobaan ${attempt + 1}), akan dicoba ulang: ${errMsg}`);
        } else {
          debugError(`Gagal mencari ${num} setelah ${MAX_INVOICE_RETRIES + 1} percobaan:`, err);
        }
      }
    }

    if (!success) {
      consecutiveFailures++;
      if (consecutiveFailures >= ctx.maxErrors) {
        const elapsed = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;
        ctx.sendToContent({
          type: "SCRAPE_ERROR",
          message: `${ctx.maxErrors} kegagalan berturut-turut saat mencari faktur. Proses dihentikan.`,
        });
        debugError(`scrapeByInvoices: aborted after ${ctx.maxErrors} consecutive failures`);
        return;
      }
    }
  }

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
  });
}
