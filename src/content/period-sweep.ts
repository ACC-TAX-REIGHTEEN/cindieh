// ============================================================
// PERIOD-SWEEP.TS — one Run across the tax periods of a year
// ============================================================
// A year-wide export is the same scrape twelve times over, once per masa, and
// the thing that makes it a feature rather than twelve exports is that it stays
// ONE Run: one dedupe set, one completion, one file (scrape-batch.ts owns that
// arithmetic, ADR-0018).
//
// This module is the LOOP above that arithmetic, extracted from
// `startScraping` where it sat between the request guard, the filename rules
// and the completion build. Its rules are the ones a reader has to know:
//
// - **Each period may fail once and is retried once.** A single transient
//   failure would otherwise cost every month still to come, which the user pays
//   for with another twelve requests. The retry is abandoned the moment the run
//   is stopped, and it pauses first — a second try sent straight after the first
//   is the burst the pacing rules exist to prevent.
// - **A failed period is recorded and the sweep continues.** Eleven months of a
//   year are worth more than none, and the summary names the one that failed
//   rather than quietly coming back short.
// - **A period the stop cut short is not counted at all.** It is neither a month
//   with rows nor an empty one, and reporting it as "masa tanpa baris" would
//   send the reader to the portal to look for data the sweep never finished
//   asking for.
// - **A stop reports what it finished.** The rows already collected are the most
//   expensive thing the run can throw away, so a stopped sweep emits ONE
//   cancelled completion built from the masa that finished — and emits nothing
//   when there was nothing to keep (ADR-0020). This is the one place a stop
//   surfaces.
//
// The page loop itself is not here: `fetchPeriod` is the seam, and the caller
// binds it to `scrapePaginated` with the period's request overrides. That keeps
// the module free of XHR and makes the rules above testable from a scripted
// fetcher — the production adapter and a fake are the two adapters that justify
// the seam. `OrchestrationContext` (the MAIN world's one seam, scraper-context.ts)
// supplies the stop check, the progress channel, the delay and the pacing
// preset, exactly as it does for the page loop — and it is imported from BELOW
// this module, so the sweep no longer reaches back into its own parent.
// ============================================================

import {
  DEFAULT_DELAY_PRESET,
  scaleDelay,
  type DelayPreset,
} from "../shared/extension-preferences";
import { debugError, debugLog, debugWarn } from "./debug";
import {
  capturedYear,
  summarisePeriods,
  type PeriodCount,
  type PeriodSummary,
} from "./scrape-batch";
import { sendScrapeComplete } from "./scrape-result-transfer";
import { collectFields } from "./scraper-helpers";
import type { CapturedRequest } from "./scraper-types";
import type { OrchestrationContext } from "./scraper-context";

/**
 * Attempts per period: the first, plus at most one retry.
 *
 * Sequential, so the request rate during the retry is unchanged. Kept here
 * rather than in the caller because it is the sweep's rule, and a caller that
 * forgot it would silently turn a year into a single attempt per month.
 */
export const PERIOD_ATTEMPTS = 2;

/** Pause before a period's one retry — paced like every other delay. */
export const PERIOD_RETRY_DELAY_MS = 2000;

/** The run's rows so far. Every period adds to this ONE accumulator. */
export interface SweepRows {
  allData: Record<string, unknown>[];
}

/** What one period's fetch reports back to the loop. */
export interface PeriodFetchResult {
  /** Pages this period took, for the run's own page count. */
  page: number;
  /** The server claimed more rows than were collected for this period. */
  truncated: boolean;
}

export interface PeriodSweepInput {
  /** The request the portal made, for the filename hint and the source. */
  captured: CapturedRequest;
  /** The period codes to fetch, in order. Never synthesized — see scrape-batch. */
  periods: readonly string[];
  /** The Run's one accumulator: the sweep never starts a second dedupe set. */
  rows: SweepRows;
  ctx: OrchestrationContext;
  /** When the Run started, for the progress line and the stop report's elapsed. */
  startedAt: number;
  /**
   * Fetch one whole period, into `rows`. The production adapter is
   * `scrapePaginated` with that period's request overrides; a test supplies a
   * scripted fetcher, which is what makes the retry and stop rules measurable
   * without a portal.
   */
  fetchPeriod(period: string): Promise<PeriodFetchResult>;
}

export interface PeriodSweepResult {
  /** Every period the sweep recorded, in order. A stopped sweep is partial. */
  summary: PeriodSummary;
  /** Pages fetched by the periods that finished. */
  pages: number;
  /** True when any finished period came back shorter than the server claimed. */
  truncated: boolean;
  /**
   * True when the user stopped the sweep. The report it owed has already been
   * sent from here, so the caller must not settle the Run as a completion.
   */
  stopped: boolean;
}

/** Read the pacing preset, falling back to the documented default. */
function pacingOf(ctx: OrchestrationContext): DelayPreset {
  return ctx.getPacing?.() ?? DEFAULT_DELAY_PRESET;
}

/**
 * Sweep the given periods, into the caller's accumulator.
 *
 * One period at a time, into ONE dedupe set. The row counts are taken around
 * each fetch rather than from the server: the server's count is per period and,
 * on this endpoint, is not a count at all (see readGridTotal).
 */
export async function runPeriodSweep({
  captured,
  periods,
  rows,
  ctx,
  startedAt,
  fetchPeriod,
}: PeriodSweepInput): Promise<PeriodSweepResult> {
  const summaryOf = (counts: PeriodCount[]) => summarisePeriods(counts, periods.length);
  const elapsed = (): string => `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;

  // The report a stopped sweep owes, built from what it already has.
  //
  // `cancelled` (not `partial`) is the load-bearing part: the receiver keeps
  // these rows for a deliberate export and runs nothing automatically, because a
  // stopped year must not produce a file that looks finished (run-lifecycle
  // .salvage, exporter's partial marker). A stop with no rows sends nothing —
  // there is nothing to keep, and the panel's own cancellation line is then the
  // whole truth.
  const reportStop = (counts: PeriodCount[], pages: number, truncated: boolean): void => {
    if (rows.allData.length === 0) return;
    debugLog(
      `⏹ Stopped after ${counts.length}/${periods.length} periods — keeping ${rows.allData.length} rows`,
    );
    sendScrapeComplete(ctx.sendToContent, {
      type: "SCRAPE_COMPLETE",
      data: rows.allData,
      fields: [...collectFields(rows.allData)],
      total: rows.allData.length,
      pages,
      elapsed: elapsed(),
      // The sweep cannot start without a year filter (batchScopeError), so the
      // year IS the name — the isolated world marks it as partial at export.
      filenameHint: capturedYear(captured.rawBody, captured.source) || undefined,
      source: captured.source,
      cancelled: true,
      truncated,
      periods: summaryOf(counts),
    });
  };

  const counts: PeriodCount[] = [];
  let pages = 0;
  let truncated = false;

  for (const [index, period] of periods.entries()) {
    if (ctx.isStopRequested()) break;
    const before = rows.allData.length;
    let result: PeriodFetchResult | null = null;
    let failure: string | null = null;

    // A period gets ONE retry, and it is abandoned the moment the run is
    // stopped: the loop condition re-reads the stop between attempts, so a
    // stopped sweep never starts the second request it had scheduled.
    for (let attempt = 1; attempt <= PERIOD_ATTEMPTS && !ctx.isStopRequested(); attempt++) {
      try {
        result = await fetchPeriod(period);
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
      counts.push({
        period,
        rows: rows.allData.length - before,
        error: failure ?? "Masa tidak diambil.",
      });
      debugError(`❌ Masa ${period} gagal:`, failure);
      continue;
    }
    // A stop during this period cut it short. It is neither a month with rows
    // nor an empty one, so it is not recorded at all.
    if (ctx.isStopRequested()) break;
    pages += result.page;
    counts.push({ period, rows: rows.allData.length - before });
    truncated = truncated || result.truncated;
    ctx.sendToContent({
      type: "SCRAPE_PROGRESS",
      total: rows.allData.length,
      page: pages,
      elapsed: elapsed(),
      status: `Masa ${index + 1}/${periods.length} (${period}) — ${rows.allData.length} baris`,
    });
    // Between periods the pause is the run's own, not a page's, so it is paced
    // like every other inter-request delay: it may only ever be slower.
    if (index + 1 < periods.length && !ctx.isStopRequested()) {
      await ctx.delay(scaleDelay(100, pacingOf(ctx)));
    }
  }

  // A stop that lands after the final period still means the sweep ended early:
  // the report says what it finished rather than presenting it as a whole year.
  if (ctx.isStopRequested()) {
    debugLog("⏹ Stopped by user.");
    reportStop(counts, pages, truncated);
    return { summary: summaryOf(counts), pages, truncated, stopped: true };
  }

  const summary = summaryOf(counts);
  if (summary.emptyPeriods.length) {
    debugWarn(`Masa kosong di tengah periode berisi data: ${summary.emptyPeriods.join(", ")}`);
  }
  return { summary, pages, truncated, stopped: false };
}
