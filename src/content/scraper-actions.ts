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
import { sendScrapeComplete } from "./scrape-result-transfer";
import { mergeRows, collectFields } from "./scraper-helpers";
import { rowLabel } from "./row-name";
import {
  xhrRequest as xhrRequestFn,
  xhrRequestByInvoice as xhrRequestByInvoiceFn,
  xhrDownloadWithholdingPdf as xhrDownloadWithholdingPdfFn,
  xhrDownloadEfakturPdf as xhrDownloadEfakturPdfFn,
} from "./scraper-xhr";
import type { GridPage } from "./scraper-xhr";
import { runItems, breakerTripped, type ItemFlow } from "./per-item";
import type { OrchestrationContext } from "./scraper-context";
import type { CapturedRequest } from "./scraper-types";
import {
  batchScope,
  capturedPeriod,
  capturedYear,
  describeSweepFilters,
  overridesForPeriod,
  planPeriods,
} from "./scrape-batch";
import type { Sweep } from "./sweep";
import { runPeriodSweep } from "./period-sweep";
import {
  DEFAULT_DELAY_PRESET,
  scaleDelay,
  type DelayPreset,
} from "../shared/extension-preferences";

// ── Context ──────────────────────────────────────────
// The run's dependencies on the page world arrive through
// `OrchestrationContext` (scraper-context.ts), the MAIN world's one seam.
// It used to be declared here, which made the modules extracted from this one
// import their own parent's type back; the seam now sits below them, and this
// module asks for the half it uses.

function signalArgs(ctx: OrchestrationContext): [] | [AbortSignal] {
  return ctx.signal ? [ctx.signal] : [];
}

/**
 * Circuit breaker shared by the per-item action loops: true once
 * `failures` consecutive item failures reach `ctx.maxErrors`. The arithmetic
 * lives in per-item.ts, so the limit is measured in one place; this is the
 * binding of it to a run's own budget. Callers report the exhaustion
 * themselves: scrapePaginated and the withholding bulk loop throw
 * (startScraping turns that into SCRAPE_ERROR), while the efaktur PDF loop
 * and the targeted-lookup loop send SCRAPE_ERROR and return.
 */
export function consecutiveFailuresExhausted(ctx: OrchestrationContext, failures: number): boolean {
  return breakerTripped(failures, ctx.maxErrors);
}

/**
 * One row of a PDF run, with the name the panel and the report call it.
 *
 * The name is decided once per item: the progress line and the failure
 * report must call the same row the same thing, and a slip number and a
 * Referensi are not the same field.
 */
interface PdfItem {
  row: Record<string, unknown>;
  name: string;
}

/**
 * The sentence both PDF loops give up with.
 *
 * It was written twice, verbatim, and the two copies were free to drift the
 * moment one of them was edited. One wording, two flows.
 */
function pdfDownloadFailures(failures: number): string {
  return `${failures} kegagalan unduh PDF berturut-turut. Periksa sesi Coretax dan coba lagi.`;
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
function pacingOf(ctx: OrchestrationContext): DelayPreset {
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
  ctx: OrchestrationContext,
  overrides: Record<string, unknown> = {},
  accumulator: ScrapeAccumulator = { allData: [], seen: new Set<string>() },
): Promise<ScrapePaginatedResult> {
  const { allData, seen } = accumulator;
  const startTime = Date.now();
  const { delayMs } = getPaginateConfig(captured.source, pacingOf(ctx));
  // Set when the server's own count says more rows exist than we collected. It
  // does NOT stop the loop — it can be a stale count — but it is reported, so a
  // short export can never again be indistinguishable from a complete one.
  let truncated = false;
  // The largest matching-row count the server has claimed so far.
  let expectedTotal: number | null = null;
  // The offset the next request asks for, and the counter the report carries.
  // The offset only advances on a page that brought rows, so a page that
  // FAILED is asked for again — the grid's own retry, and the reason the
  // counter counts attempts rather than pages.
  let offset = 0;
  let page = 0;
  // What the last page brought, for the progress line.
  let lastRows = 0;
  let lastNewRows = 0;

  const elapsed = (): string => `${((Date.now() - startTime) / 1000).toFixed(1)}s`;

  const flow: ItemFlow<number, GridPage> = {
    next: () => {
      page++;
      return { value: offset, index: page, total: 0 };
    },
    reportWhen: "after",
    status: () => `Page ${page}: ${lastRows} baris, ${lastNewRows} baru`,
    attempt: async (item) =>
      xhrRequestFn(captured, item.value, step, ctx.timeout, ctx.signal, overrides),
    accept: (result) => {
      const newRows = mergeRows(allData, seen, result.rows);
      lastRows = result.rows.length;
      lastNewRows = newRows.length;

      debugLog(
        `Page ${page}: ${result.rows.length} rows, ${newRows.length} new, total=${allData.length}, ${elapsed()}`,
      );

      // Trust the server's count over the page shape whenever it gives one.
      if (result.total !== null && (expectedTotal === null || result.total > expectedTotal)) {
        expectedTotal = result.total;
      }
      if (expectedTotal !== null && allData.length < expectedTotal) {
        truncated = true;
        debugLog(
          `Halaman pendek di ${allData.length}/${expectedTotal} baris — server mungkin membatasi Rows=${step}.`,
        );
      }

      if (result.rows.length < step) return false;
      if (newRows.length === 0) {
        // A FULL page that added nothing new, while First keeps advancing,
        // means the server is not honouring the offset -- every further page
        // will be the same rows. Without this the loop requests forever, which
        // is both a hang and a sustained load on the portal.
        debugLog(
          `Halaman penuh tanpa baris baru di First=${offset} -- server mengabaikan offset, scrape dihentikan.`,
        );
        return false;
      }
      offset += step;
      return true;
    },
    recordFailure: () => {
      // A page has no name of its own: the error carries it, and the offset
      // stays put, so the same page is asked for again.
    },
    exhausted: (failures, error) => {
      const errMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`${failures} error berturut-turut: ${errMsg}`);
    },
    delayMs,
    // The backoff between a failed page and the next attempt at it. It is the
    // one delay in the MAIN world that is NOT scaled by the pacing preset:
    // the code's own floor for a request that just failed.
    failureDelayMs: 2000,
  };

  await runItems(flow, {
    isStopped: () => ctx.isStopRequested(),
    progress: (state) => {
      ctx.sendToContent({
        type: "SCRAPE_PROGRESS",
        total: allData.length,
        page,
        elapsed: elapsed(),
        status: state.status,
      });
    },
    breakerTripped: (failures) => consecutiveFailuresExhausted(ctx, failures),
    delay: (ms) => ctx.delay(ms),
  });

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
  ctx: OrchestrationContext,
): Promise<{ failureCount: number; failedItems: string[] }> {
  // Every failure is named: the slip number is the only thing that ties a
  // failed download back to a row once the run is over.
  const failedItems: string[] = [];
  const total = allData.length;
  let index = 0;
  debugLog(`Starting Bulk PDF download for ${total} items...`);

  const flow: ItemFlow<PdfItem, string> = {
    next: () => {
      if (index >= total) return null;
      const row = allData[index];
      index++;
      return { value: { row, name: rowLabel(row, "WITHHOLDING_SLIPS") }, index, total };
    },
    reportWhen: "before",
    status: (item) => `Mengunduh PDF ${item.index}/${total}: ${item.value.name}`,
    attempt: async (item) =>
      xhrDownloadWithholdingPdfFn(captured, item.value.row, ctx.timeout, ...signalArgs(ctx)),
    accept: (base64, item) => {
      ctx.emitPdfDownload(base64, item.value.row, "WITHHOLDING_SLIPS");
      return true;
    },
    recordFailure: (item, error) => {
      failedItems.push(item.value.name);
      debugError(`Gagal unduh PDF idx ${item.index - 1} (${item.value.name}):`, error);
    },
    exhausted: (failures) => {
      // This loop THROWS: the orchestrator turns the throw into SCRAPE_ERROR,
      // so the run ends with one error and no completion.
      throw new Error(pdfDownloadFailures(failures));
    },
    delayMs: scaleDelay(800, pacingOf(ctx)),
  };

  const result = await runItems(flow, {
    isStopped: () => ctx.isStopRequested(),
    progress: (state) => {
      ctx.sendToContent({
        type: "SCRAPE_PROGRESS",
        total: state.index,
        page,
        elapsed: totalElapsed,
        status: state.status,
        currentIndex: state.index,
        totalCount: total,
        failureCount: state.failureCount,
      });
    },
    breakerTripped: (failures) => consecutiveFailuresExhausted(ctx, failures),
    delay: (ms) => ctx.delay(ms),
  });

  return { failureCount: result.failures, failedItems };
}

// ── Main scraping orchestrator ────────────────────────

/**
 * Full scrape: intercept → paginate → (bulk PDF if withholding) → complete.
 * Caller is responsible for setting `isRunning` state before and after.
 *
 * @param interceptRequest - Promise factory that resolves with the captured XHR.
 * @param options.skipPdf - On withholding pages, collect the rows without the
 *   bulk PDF download that a withholding scrape otherwise performs.
 * @param options.batchMonths - Sweep this many months of the year, from January.
 * @param options.sweepPeriods - Sweep exactly these period codes instead: the
 *   resume half of a year-wide sweep (see sweep.missingPeriods).
 * @param options.sweepYear - The year the kept rows belong to, for a resume:
 *   the sweep refuses when the grid's own year filter no longer matches it.
 */
export async function startScraping(
  interceptRequest: () => Promise<CapturedRequest>,
  ctx: OrchestrationContext,
  options: {
    skipPdf?: boolean;
    batchMonths?: number;
    sweepPeriods?: string[];
    sweepYear?: string;
  } = {},
): Promise<void> {
  // A resume is a sweep too: it asks for a subset of the year.
  const resume = options.sweepPeriods?.length ? options.sweepPeriods : undefined;
  const sweeping = Boolean(options.batchMonths || resume);
  debugLog(
    `▶ Starting scrape${
      sweeping ? ` (${resume ? `${resume.length} masa dilanjutkan` : `${options.batchMonths} masa`})` : ""
    }...`,
  );
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

    // A sweep may only touch the grid when the request can answer for a whole
    // year, and the request says how: with the measured period filter (the
    // year is then asked for one masa at a time), or without it (the portal is
    // not filtering by month, and the grid is already showing the year — see
    // ADR-0044). Anything else is refused loudly rather than swept into
    // something that is not a year. The period codes come from the request the
    // portal just made (never from anything invented here), and the year is a
    // SEPARATE filter that decides which year those codes read.
    //
    // The reading is logged BEFORE that guard can throw, because a grid with no
    // measured row is refused outright and the line says so: it names the filters
    // this request carries, which is the spelling to record in the table
    // (ADR-0019, tools/README.md).
    if (sweeping) {
      debugLog(
        `Sweep filters on ${captured.source}: ${describeSweepFilters(captured.rawBody, captured.source)}`,
      );
    }
    const scope = sweeping ? batchScope(captured.rawBody, captured.source) : null;
    if (scope?.kind === "refused") throw new Error(scope.message);

    const year = capturedYear(captured.rawBody, captured.source);
    // A resume says which year its kept rows came from. The grid's year filter
    // is what decides which year a period code READS as, so a filter that moved
    // since the stop would put two years in one file — refuse instead of
    // fetching the same month codes from another year.
    if (resume && options.sweepYear && year !== options.sweepYear) {
      throw new Error(
        `Filter tahun grid sekarang ${year ?? "belum diset"}, sedangkan sisa ekspor berasal dari tahun ${options.sweepYear}. ` +
          "Setel filter tahun grid ke tahun itu, lalu lanjutkan kembali.",
      );
    }

    // A resume NARROWS the portal's own year plan: the codes arrive from the
    // isolated world, and one outside the plan is dropped rather than requested,
    // because a period value invented anywhere but the portal's own request is a
    // period the portal has never heard of (ADR-0018).
    const periods = resume
      ? planPeriods(capturedPeriod(captured.rawBody, captured.source) ?? "").filter((code) => resume.includes(code))
      : options.batchMonths
        ? planPeriods(capturedPeriod(captured.rawBody, captured.source) ?? "", options.batchMonths)
        : [];

    if (resume && periods.length === 0) {
      throw new Error(
        "Masa yang diminta untuk dilanjutkan tidak cocok dengan filter grid saat ini. " +
          "Muat ulang grid pada tahun yang sama, lalu coba lagi.",
      );
    }
    const accumulator: ScrapeAccumulator = { allData: [], seen: new Set<string>() };

    let page = 0;
    let truncated = false;
    let expectedTotal: number | null = null;
    let periodSummary: Sweep | null = null;

    // A sweep is its own module: the period loop, its one retry, the per-period
    // counts and the report a stop owes all live there, so those rules are
    // measurable without a portal request (period-sweep.ts, ADR-0018/0020).
    if (periods.length > 0) {
      const sweep = await runPeriodSweep({
        captured,
        periods,
        rows: accumulator,
        ctx,
        startedAt: startTime,
        // `overridesForPeriod` throws when the request carries no period filter
        // — the case where a "batch" would silently re-scrape one month twelve
        // times. The scope guard above refuses that before this loop is entered.
        fetchPeriod: (period) =>
          scrapePaginated(
            captured,
            step,
            ctx,
            overridesForPeriod(captured.rawBody, period, 0, step, captured.source),
            accumulator,
          ),
      });
      // The stopped report has already gone out, built from the masa that
      // finished; settling this as a completion would contradict it (ADR-0020).
      if (sweep.stopped) return;
      page = sweep.pages;
      truncated = sweep.truncated;
      periodSummary = sweep.summary;
      // The per-period counts cannot be compared against one total, so the
      // server's claim is dropped rather than reported against the whole year.
      expectedTotal = null;
    } else {
      const result = await scrapePaginated(captured, step, ctx, {}, accumulator);
      page = result.page;
      truncated = result.truncated;
      expectedTotal = result.expectedTotal;
    }

    const allData = accumulator.allData;

    if (ctx.isStopRequested()) {
      // Only a plain scrape reaches here: a sweep's stop is reported and
      // returned above, and a stopped ordinary scrape has never sent anything.
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

    // A batch covers a whole year, so it is named for the YEAR — whether the
    // year arrived as twelve monthly requests, or as the grid's own unfiltered
    // view of it (ADR-0044). The grid's own hint names one month, and a file
    // called "072026" that holds twelve months is worse than no name at all.
    // Falls back to the month hint when the request carries no year filter,
    // which is still honest.
    if (sweeping) {
      filenameHint = capturedYear(captured.rawBody, captured.source) || filenameHint;
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
  ctx: OrchestrationContext,
): Promise<void> {
  if (ctx.isStopRequested()) return;
  const source = lastCaptured.source;
  const startTime = Date.now();
  // Named for the same reason as the withholding loop: the count alone cannot be
  // acted on once a 300-row run is over.
  const failedItems: string[] = [];
  const total = data.length;
  let index = 0;

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

  const flow: ItemFlow<PdfItem, string> = {
    next: () => {
      if (index >= total) return null;
      const row = data[index];
      index++;
      return { value: { row, name: rowLabel(row, source) }, index, total };
    },
    reportWhen: "before",
    status: (item) => `Mengunduh PDF ${item.index}/${total}: ${item.value.name}`,
    attempt: async (item) =>
      xhrDownloadEfakturPdfFn(lastCaptured, item.value.row, source, ctx.timeout, ...signalArgs(ctx)),
    accept: (base64, item) => {
      ctx.emitPdfDownload(base64, item.value.row, source);
      return true;
    },
    recordFailure: (item, error) => {
      failedItems.push(item.value.name);
      debugError(`Gagal unduh PDF efaktur idx ${item.index - 1} (${item.value.name}):`, error);
    },
    exhausted: (failures) => {
      // This loop ANNOUNCES the end instead of throwing: it is the one PDF
      // path the user starts on its own, so the error goes straight to the
      // panel and no completion follows it.
      ctx.sendToContent({ type: "SCRAPE_ERROR", message: pdfDownloadFailures(failures) });
    },
    delayMs: scaleDelay(800, pacingOf(ctx)),
  };

  const result = await runItems(flow, {
    isStopped: () => ctx.isStopRequested(),
    progress: (state) => {
      ctx.sendToContent({
        type: "SCRAPE_PROGRESS",
        total: state.index,
        page: 0,
        elapsed: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
        status: state.status,
        currentIndex: state.index,
        totalCount: total,
        failureCount: state.failureCount,
      });
    },
    breakerTripped: (failures) => consecutiveFailuresExhausted(ctx, failures),
    delay: (ms) => ctx.delay(ms),
  });

  if (result.exhausted) return;
  if (ctx.isStopRequested()) return;

  const totalElapsed = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;
  debugLog(
    `✅ PDF download complete: ${total - result.failures}/${total} succeeded, ${result.failures} failed in ${totalElapsed}`,
  );

  sendScrapeComplete(ctx.sendToContent, {
    type: "SCRAPE_COMPLETE",
    data,
    fields: [],
    total,
    pages: 0,
    elapsed: totalElapsed,
    source,
    partial: result.failures > 0,
    failureCount: result.failures,
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
  ctx: OrchestrationContext,
): Promise<void> {
  const MAX_INVOICE_RETRIES = 2;
  const BACKOFF_BASE_MS = 1000;

  const startTime = Date.now();
  const allData: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const failedInvoices: string[] = [];
  let index = 0;

  const flow: ItemFlow<string, Record<string, unknown>[]> = {
    next: () => {
      if (index >= invoiceNumbers.length) return null;
      const num = invoiceNumbers[index];
      index++;
      return { value: num, index, total: invoiceNumbers.length };
    },
    reportWhen: "before",
    status: (item, attempt) =>
      attempt === 1
        ? `Mencari: ${item.value} (${item.index}/${invoiceNumbers.length})`
        : `Mencoba ulang: ${item.value} (percobaan ${attempt}/${MAX_INVOICE_RETRIES + 1})`,
    attempt: async (item, attempt) => {
      try {
        return await xhrRequestByInvoiceFn(lastCaptured, item.value, ctx.timeout, ...signalArgs(ctx));
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (attempt <= MAX_INVOICE_RETRIES) {
          debugLog(`Gagal mencari ${item.value} (percobaan ${attempt}), akan dicoba ulang: ${errMsg}`);
        } else {
          debugError(`Gagal mencari ${item.value} setelah ${MAX_INVOICE_RETRIES + 1} percobaan:`, err);
        }
        throw err;
      }
    },
    accept: (rows) => {
      mergeRows(allData, seen, rows);
      return true;
    },
    recordFailure: (item) => {
      failedInvoices.push(item.value);
    },
    exhausted: (failures) => {
      ctx.sendToContent({
        type: "SCRAPE_ERROR",
        message: `${failures} kegagalan berturut-turut saat mencari faktur. Proses dihentikan.`,
      });
      debugError(`scrapeByInvoices: aborted after ${failures} consecutive failures`);
    },
    delayMs: scaleDelay(50, pacingOf(ctx)),
    retry: { extraAttempts: MAX_INVOICE_RETRIES, backoffMs: BACKOFF_BASE_MS },
  };

  const result = await runItems(flow, {
    isStopped: () => ctx.isStopRequested(),
    progress: (state) => {
      ctx.sendToContent({
        type: "SCRAPE_PROGRESS",
        total: allData.length,
        page: state.index,
        elapsed: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
        status: state.status,
      });
    },
    breakerTripped: (failures) => consecutiveFailuresExhausted(ctx, failures),
    delay: (ms) => ctx.delay(ms),
  });

  if (result.exhausted) return;
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
