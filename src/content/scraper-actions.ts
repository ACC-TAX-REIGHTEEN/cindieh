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
import { debugLog, debugError, debugWarn } from "./debug";
import { sendScrapeComplete } from "./scrape-result-transfer";
import { mergeRows, collectFields, describePdfItem } from "./scraper-helpers";
import {
  xhrRequest as xhrRequestFn,
  xhrRequestByInvoice as xhrRequestByInvoiceFn,
  xhrDownloadWithholdingPdf as xhrDownloadWithholdingPdfFn,
  xhrDownloadEfakturPdf as xhrDownloadEfakturPdfFn,
} from "./scraper-xhr";
import type { CapturedRequest, ScrapeMessage } from "./scraper-types";
import {
  batchScopeError,
  capturedPeriod,
  capturedYear,
  overridesForPeriod,
  planPeriods,
  summarisePeriods,
  type PeriodCount,
} from "./scrape-batch";
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
/**
 * The rows one Run has collected so far, and the keys already in them.
 *
 * A batch is one Run over many periods, so the periods must share ONE
 * accumulator: a fresh set per period would collect the same invoice twice,
 * once per period, which is precisely what the dedupe key exists to prevent.
 */
export interface ScrapeAccumulator {
  allData: Record<string, unknown>[];
  seen: Set<string>;
}

/**
 * The shape `scrapePaginated` returns. `rowsBefore` is what the run held
 * before this call, which is how a batch learns how much each period added
 * without the loop having to diff two arrays itself.
 */
export interface ScrapePaginatedResult {
  allData: Record<string, unknown>[];
  page: number;
  truncated: boolean;
  expectedTotal: number | null;
}

/**
 * Collect every page of one grid.
 *
 * `overrides` carries the batch period's request-body changes and is merged
 * into every page request, so one call collects one whole period. `accumulator`
 * is what makes the batch one Run rather than twelve.
 */
export async function scrapePaginated(
  captured: CapturedRequest,
  step: number,
  ctx: ScraperContext,
  overrides: Record<string, unknown> = {},
  accumulator: ScrapeAccumulator = { allData: [], seen: new Set<string>() },
): Promise<ScrapePaginatedResult> {
  const { allData, seen } = accumulator;
  let page = 0;
  let first = 0;
  let keepGoing = true;
  let errorCount = 0;
  const startTime = Date.now();
  const { delayMs } = getPaginateConfig(captured.source, pacingOf(ctx));
  // Set when the server's own count says more rows exist than we collected. It
  // does NOT stop the loop — it can be a stale count — but it is reported, so a
  // short export can never again be indistinguishable from a complete one.
  let truncated = false;
  // The largest matching-row count the server has claimed so far.
  let expectedTotal: number | null = null;

  while (keepGoing && !ctx.isStopRequested()) {
    page++;
    try {
      const { rows, total } = await xhrRequestFn(
        captured,
        first,
        step,
        ctx.timeout,
        ctx.signal,
        overrides,
      );
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

      // Trust the server's count over the page shape whenever it gives one.
      if (total !== null && (expectedTotal === null || total > expectedTotal)) {
        expectedTotal = total;
      }
      if (expectedTotal !== null && allData.length < expectedTotal) {
        truncated = true;
        debugLog(
          `Halaman pendek di ${allData.length}/${expectedTotal} baris — server mungkin membatasi Rows=${step}.`,
        );
      }

      if (rows.length < step) {
        keepGoing = false;
      } else if (newRows.length === 0) {
        // A FULL page that added nothing new, while First keeps advancing,
        // means the server is not honouring the offset -- every further page
        // will be the same rows. Without this the loop requests forever, which
        // is both a hang and a sustained load on the portal.
        debugLog(
          `Halaman penuh tanpa baris baru di First=${first} -- server mengabaikan offset, scrape dihentikan.`,
        );
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

  return { allData, page, truncated, expectedTotal };
}

// ── Bulk PDF download — withholding slips ─────────────

/**
 * Download all withholding slip PDFs for the given rows.
 * Sends SCRAPE_PROGRESS and DOWNLOAD_PDF_ITEM messages.
 *
 * @returns The failure count AND the slip number of each failure. The count is
 * what the panel leads with; the names are what make it actionable — without
 * them a 300-slip run reports "4 gagal" and the Wajib Pajak has to re-run the
 * whole thing to find out which four.
 */
export async function downloadBulkWithholdingPdf(
  captured: CapturedRequest,
  allData: Record<string, unknown>[],
  page: number,
  totalElapsed: string,
  ctx: ScraperContext,
): Promise<{ failureCount: number; failedItems: string[] }> {
  let failureCount = 0;
  let consecutiveFailures = 0;
  // Every failure is named: the slip number is the only thing that ties a
  // failed download back to a row once the run is over.
  const failedItems: string[] = [];
  const total = allData.length;
  debugLog(`Starting Bulk PDF download for ${total} items...`);

  for (let i = 0; i < total; i++) {
    if (ctx.isStopRequested()) break;

    const row = allData[i];
    const slip = describePdfItem(row, "WITHHOLDING_SLIPS");
    const status = `Mengunduh PDF ${i + 1}/${total}: ${slip}`;

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
      failedItems.push(slip);
      debugError(`Gagal unduh PDF idx ${i} (${slip}):`, err);
      if (consecutiveFailuresExhausted(ctx, consecutiveFailures)) {
        throw new Error(`${consecutiveFailures} kegagalan unduh PDF berturut-turut. Periksa sesi Coretax dan coba lagi.`);
      }
    }
    await ctx.delay(scaleDelay(800, pacingOf(ctx)));
  }

  return { failureCount, failedItems };
}

// ── Main scraping orchestrator ────────────────────────

/**
 * Attempts per period in a year-wide sweep: the first, plus at most one retry.
 * One transient failure would otherwise cost the rest of the year — a re-run the
 * user pays for with twelve requests, where a retry costs one. Sequential, so the
 * request rate during the retry is unchanged.
 */
export const PERIOD_ATTEMPTS = 2;

/** Pause before a period's one retry — paced like every other delay. */
export const PERIOD_RETRY_DELAY_MS = 2000;

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
  options: { skipPdf?: boolean; batchMonths?: number } = {},
): Promise<void> {
  debugLog(`▶ Starting scrape${options.batchMonths ? ` (${options.batchMonths} masa)` : ""}...`);
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

    // Both filters are required before a sweep may touch the grid, and both
    // fail loudly rather than sweeping something that is not a year: the period
    // codes come from the request the portal just made (never from anything
    // invented here), and the year is a SEPARATE filter that decides which year
    // those codes read. See batchScopeError for what each missing one costs.
    const batchError = options.batchMonths ? batchScopeError(captured.rawBody) : null;
    if (batchError) throw new Error(batchError);

    const periods = options.batchMonths
      ? planPeriods(capturedPeriod(captured.rawBody) ?? "", options.batchMonths)
      : [];
    const accumulator: ScrapeAccumulator = { allData: [], seen: new Set<string>() };
    const periodCounts: PeriodCount[] = [];

    let page = 0;
    let truncated = false;
    let expectedTotal: number | null = null;

    // One period at a time, into ONE accumulator. The row counts are taken
    // around each call rather than from the server: the server's count is per
    // period and, on this endpoint, is not a count at all (see readGridTotal).
    for (const [index, period] of periods.entries()) {
      if (ctx.isStopRequested()) break;
      const before = accumulator.allData.length;
      let result: ScrapePaginatedResult | null = null;
      let failure: string | null = null;

      // A period gets ONE retry, and it is abandoned the moment the run is
      // stopped. The sweep below is the only place a whole year is fetched, so
      // a single transient failure here would otherwise cost every month still
      // to come.
      for (let attempt = 1; attempt <= PERIOD_ATTEMPTS && !ctx.isStopRequested(); attempt++) {
        try {
          // Throws when the captured request has no period filter, which is the
          // case where a "batch" would silently re-scrape one period N times.
          result = await scrapePaginated(
            captured,
            step,
            ctx,
            overridesForPeriod(captured.rawBody, period, 0, step),
            accumulator,
          );
          failure = null;
          break;
        } catch (err) {
          failure = err instanceof Error ? err.message : String(err);
          if (attempt < PERIOD_ATTEMPTS && !ctx.isStopRequested()) {
            debugWarn(`Masa ${period} gagal (percobaan ${attempt}), dicoba sekali lagi:`, failure);
            await ctx.delay(scaleDelay(PERIOD_RETRY_DELAY_MS, pacingOf(ctx)));
          }
        }
      }

      if (!result) {
        // Nothing after the retry either: the period is recorded and the sweep
        // continues — eleven months of a year is worth more than none, and the
        // summary lists it as failed rather than quietly short.
        if (ctx.isStopRequested()) break;
        periodCounts.push({
          period,
          rows: accumulator.allData.length - before,
          error: failure ?? "Masa tidak diambil.",
        });
        debugError(`❌ Masa ${period} gagal:`, failure);
        continue;
      }
      page += result.page;
      periodCounts.push({ period, rows: accumulator.allData.length - before });
      truncated = truncated || result.truncated;
      ctx.sendToContent({
        type: "SCRAPE_PROGRESS",
        total: accumulator.allData.length,
        page,
        elapsed: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
        status: `Masa ${index + 1}/${periods.length} (${period}) — ${accumulator.allData.length} baris`,
      });
      // Between periods the pause is the run's own, not a page's, so it is
      // paced like every other inter-request delay: it may only ever be slower.
      if (index + 1 < periods.length && !ctx.isStopRequested()) {
        await ctx.delay(scaleDelay(100, pacingOf(ctx)));
      }
    }

    if (periods.length === 0) {
      const result = await scrapePaginated(captured, step, ctx, {}, accumulator);
      page = result.page;
      truncated = result.truncated;
      expectedTotal = result.expectedTotal;
    } else if (truncated) {
      // The per-period counts cannot be compared against one total, so the
      // server's claim is dropped rather than reported against the whole year.
      expectedTotal = null;
    }

    const allData = accumulator.allData;
    const periodSummary = periods.length > 0 ? summarisePeriods(periodCounts) : null;

    if (ctx.isStopRequested()) {
      debugLog("⏹ Stopped by user.");
      return;
    }

    if (periodSummary?.emptyPeriods.length) {
      debugWarn(
        `Masa kosong di tengah periode berisi data: ${periodSummary.emptyPeriods.join(", ")}`,
      );
    }

    const fieldSet = collectFields(allData);
    const totalElapsed = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;

    debugLog(`✅ Complete: ${allData.length} records in ${totalElapsed}`);

    let filenameHint = extractFilenameHintFromBody(captured.rawBody, captured.source) || "";

    if (!filenameHint && captured.source.startsWith("PPH_21_")) {
      filenameHint = ctx.getMasaPajakFromDOM();
      debugLog("Filename hint from DOM:", filenameHint);
    }

    // A batch covers a whole year, so it is named for the YEAR. The grid's own
    // hint names one month, and a file called "072026" that holds twelve months
    // is worse than no name at all. Falls back to the month hint when the
    // request carries no year filter, which is still honest.
    if (periods.length > 0) {
      filenameHint = capturedYear(captured.rawBody) || filenameHint;
      debugLog("Batch filename hint (year):", filenameHint);
    }

    // A withholding scrape normally IS a bulk PDF download. An XLSX/CSV export
    // asks for the rows only (skipPdf), so the same scrape can feed the sheet
    // without firing one PDF request per slip.
    const withholdingPdfRun = captured.source === "WITHHOLDING_SLIPS" && !options.skipPdf;
    let failureCount = 0;
    let failedItems: string[] = [];
    if (withholdingPdfRun) {
      ({ failureCount, failedItems } = await downloadBulkWithholdingPdf(
        captured,
        allData,
        page,
        totalElapsed,
        ctx,
      ));
    }
    if (ctx.isStopRequested()) return;

    sendScrapeComplete(ctx.sendToContent, {
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
      failedItems,
      truncated,
      expectedTotal: expectedTotal ?? undefined,
      periods: periodSummary ?? undefined,
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
  // Named for the same reason as the withholding loop: the count alone cannot be
  // acted on once a 300-row run is over.
  const failedItems: string[] = [];
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
    const ref = describePdfItem(row, source);
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
      failedItems.push(ref);
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

  sendScrapeComplete(ctx.sendToContent, {
    type: "SCRAPE_COMPLETE",
    data,
    fields: [],
    total,
    pages: 0,
    elapsed: totalElapsed,
    source,
    partial: failureCount > 0,
    failureCount,
    failedItems,
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

  sendScrapeComplete(ctx.sendToContent, {
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
