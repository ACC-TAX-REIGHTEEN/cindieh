// ============================================================
// COMPLETION-INTAKE.TS — what one completion MEANS, before anything is painted
// ============================================================
// Every way a Run can end arrives here as a report: an accepted completion, a
// stop that salvaged its rows, a result refused as incomplete, a chunk stream
// that lost a piece, or a hard failure. The report is data — merged rows, the
// life-cycle's outcome, the panel updates IN ORDER, the notification body and
// the follow-ups still owed — so the rules that used to live inline in main.ts
// right beside six badge calls can be exercised without a page (ADR-0031).
//
// The seam is deliberately narrower than "the panel": a surface update names an
// OUTCOME (`complete`, a `status` topic, an `error`), never a DOM call. main.ts
// maps each one to its badge function, because the badge is the only thing here
// that needs a document. That is the same split ADR-0014 made for the Run's
// state: this module owns what a completion means, run-lifecycle owns whether
// the Run accepted it, and main.ts owns painting.
//
// Three rules are load-bearing and all three used to be conventions:
//
// 1. The transfer is SINGLE-USE (ADR-0017). The buffer is emptied on every
//    path out of `settleCompletion`, including the rejected and salvaged ones,
//    so a later completion can never be answered by chunks of an earlier one.
// 2. The RESUME is what settles (ADR-0023). When the completion carries
//    per-masa counts and the Run still holds a kept sweep, the union of the two
//    halves is the result — previous rows first, deduplicated by the portal's
//    row identity — and the counts are merged with the incoming half winning
//    for a masa it covers again.
// 3. A STOP is not a completion (ADR-0020). A cancelled completion that carries
//    rows is salvaged by the life-cycle, and the report says how much of the
//    year survived instead of pretending the run finished.
//
// No browser call and no DOM: `RunLifecycle` arrives as a parameter so a test
// can build a real one, and the report is plain data.
// ============================================================

import { describeCompletion, type CompletionKind } from "./completion-notice";
import type { ResultChunkBuffer } from "./result-chunks";
import { missingResultChunks, resetResultChunks, resolveResultRows } from "./result-chunks";
import type { FollowUp, RunLifecycle } from "./run-lifecycle";
import {
  batchResultNotice,
  failedItemsNotice,
  incompleteTransferMessage,
  scrapeErrorMessage,
  stoppedSweepMessage,
  truncatedResultNotice,
} from "./scrape-result";
import { unionRows } from "./scraper-helpers";
import { extractYear } from "./tax-date";
import type { ScrapeComplete } from "./scraper-types";
import { emptyPeriods, failedPeriods, mergeSweeps } from "./sweep";

// ── The report ─────────────────────────────────────────

/**
 * One thing the panel has to show, named by its OUTCOME.
 *
 * The order of these in a report is the order the panel shows them, which is
 * the rule this module exists to hold: the completion line first, then what the
 * run found (shortfall, per-masa counts, truncation, failed files), because
 * "selesai" is the line that owns the start of the account.
 */
export type SurfaceUpdate =
  | {
      kind: "complete";
      total: number;
      pages: number;
      elapsed: string;
      /** The completion's own kind, so a PDF run is not announced as a scrape. */
      runKind?: "scrape" | "pdf";
      /** Names of failed downloads, for the panel's expandable list. */
      failedItems?: readonly string[];
    }
  | {
      kind: "status";
      /**
       * Which finding is being stated. The text is already worded; the topic
       * exists so the ordering rule is readable and a caller can log or style
       * one finding without matching on its sentence.
       */
      topic: "stopped-sweep" | "shortfall" | "batch" | "truncated" | "failed-items";
      text: string;
    }
  | {
      kind: "error";
      text: string;
    };

/** How a Run ended, once this module has read its completion. */
export type RunEnding = "accepted" | "salvaged" | "rejected" | "incomplete" | "failed";

/**
 * Everything one completion means, in the order it has to be shown.
 *
 * `completion` is the settled completion — the union merged in, the totals
 * re-derived — for the endings that produced rows (`accepted`, `salvaged`), and
 * null otherwise. It is carried whole because the diagnostics (a batch's counts,
 * a truncated run's expected total) read it, not a second copy of the numbers.
 */
export interface RunReport {
  ending: RunEnding;
  completion: ScrapeComplete | null;
  /** Panel updates, in the order they belong on screen. */
  updates: SurfaceUpdate[];
  /**
   * What a desktop notification should say, when the user opted in, or null
   * for a run the notification must stay silent about (a salvage: the panel
   * already says the run was stopped, and the toast must not call it finished).
   */
  notification: { kind: CompletionKind; detail: string } | null;
  /** Work the Run still owed, in the order the panel has always run it. */
  followUp: FollowUp[];
}

// ── A completion, settled ──────────────────────────────

export interface SettleCompletionInput {
  /** The completion as it arrived, before the transfer is resolved. */
  completion: ScrapeComplete;
  /** The chunks of the transfer in flight. Consumed on every path. */
  transfer: ResultChunkBuffer;
  /** The Run whose result and debts settle here. */
  run: RunLifecycle;
}

/**
 * Settle a finished Run into a report.
 *
 * An incomplete transfer is one MORE way a Run can end badly, not a special
 * case outside the module: the rows that did arrive are not a result (a short
 * grid and a lost chunk are identical once exported), so the report carries the
 * error and no completion. The Run is deliberately left as it was — this path
 * has never settled it, and changing that belongs in its own decision.
 */
export function settleCompletion({ completion, transfer, run }: SettleCompletionInput): RunReport {
  const rows = resolveResultRows(transfer, completion);
  const missing =
    completion.dataChunks === undefined
      ? []
      : missingResultChunks(transfer, completion.dataChunks);

  // Single-use, whichever way this ends: the next completion must not be
  // answered by the chunks of this one (ADR-0017).
  resetResultChunks(transfer);

  if (rows === null) {
    const message = incompleteTransferMessage(missing.length);
    return {
      ending: "incomplete",
      completion: null,
      updates: [{ kind: "error", text: message }],
      notification: { kind: "error", detail: message },
      followUp: [],
    };
  }

  // A completion with per-masa counts is a year-wide sweep; the rows already on
  // hand may be the kept half of one a stop salvaged, and this is the resume. A
  // Run with no kept counts has nothing to be resumed against (a fresh sweep
  // starts from nothing on purpose), so both guards matter (ADR-0023).
  const kept = run.result();
  const resuming = Boolean(completion.periods && kept?.sweep);
  const mergedRows = resuming ? unionRows(kept?.data ?? [], rows) : rows;
  const settled: ScrapeComplete = {
    ...completion,
    data: mergedRows,
    total: mergedRows.length,
    periods:
      resuming && kept?.sweep && completion.periods
        ? // The union's two halves were counted by two independent accumulators,
          // so their counts can overlap where a failed masa had already collected
          // rows that the resumed retry fetched again. The panel names what the
          // FILE holds, which is the deduplicated union (ADR-0016), not the sum
          // of the counts.
          mergeSweeps(kept.sweep, completion.periods, mergedRows.length)
        : completion.periods,
  };

  const outcome = run.complete(settled);

  if (outcome.kind === "salvaged") {
    return {
      ending: "salvaged",
      completion: settled,
      updates: [
        { kind: "status", topic: "stopped-sweep", text: stoppedSweepMessage(settled) },
      ],
      // A stop is not a success: the panel says how much of the year survived,
      // and a toast claiming the run finished is exactly what ADR-0020 forbids.
      notification: null,
      followUp: [],
    };
  }

  if (outcome.kind === "rejected") {
    return {
      ending: "rejected",
      completion: settled,
      updates: [{ kind: "error", text: outcome.message }],
      notification: { kind: "error", detail: outcome.message },
      followUp: [],
    };
  }

  const updates: SurfaceUpdate[] = [
    {
      kind: "complete",
      total: settled.total || 0,
      pages: completion.pages || 0,
      elapsed: completion.elapsed || "0s",
      runKind: completion.kind,
      failedItems: completion.failedItems,
    },
  ];

  // A run can come back short without failing: a targeted No. Faktur scrape
  // gets an empty payload for a number Coretax has no row for, and a filtered
  // bulk PDF run only returns the rows it downloaded. The Run withholds the
  // notice for a PDF run, whose pre-download dialog already named them.
  if (outcome.shortfall?.notice) {
    updates.push({ kind: "status", topic: "shortfall", text: outcome.shortfall.notice });
  }

  // A batch has no server-side total to check against, so its per-period row
  // counts are the completeness evidence and the panel reports them. Says it
  // AFTER the completion line, which owns "selesai".
  if (settled.periods) {
    // The year is what tells a month that has NOT ARRIVED from a month that
    // came back empty — and a sweep's own completion carries it in the file
    // name it was given (the grid's year filter).
    const sweepYear = extractYear(settled.filenameHint ?? "") || null;
    updates.push({
      kind: "status",
      topic: "batch",
      text: batchResultNotice(settled.periods, sweepYear),
    });
  }

  // A short page is only the end of the data if the server agrees it is. When
  // it does not, the panel says the export may be incomplete rather than
  // leaving a partial file looking like a finished one.
  if (completion.truncated) {
    updates.push({
      kind: "status",
      topic: "truncated",
      text: truncatedResultNotice(
        completion.total,
        completion.expectedTotal ?? null,
        Boolean(settled.periods),
      ),
    });
  }

  // A bulk PDF run that named its failures says so here. The completion line
  // owns the per-file count; this adds the one-line summary above it, and only
  // when names actually arrived.
  const failureNotice = failedItemsNotice(completion.failedItems);
  if (failureNotice) {
    updates.push({ kind: "status", topic: "failed-items", text: failureNotice });
  }

  return {
    ending: "accepted",
    completion: settled,
    updates,
    notification: {
      kind: completion.kind ?? "scrape",
      detail: describeCompletion({
        total: settled.total || 0,
        failureCount: completion.failureCount,
        missing: outcome.shortfall?.count ?? 0,
        // A batch run's own completeness evidence: the toast must not call a
        // sweep with a failed or vanished month a clean success. The union's
        // lists, so a resumed sweep cannot hide the half that failed first.
        failedPeriods: settled.periods ? failedPeriods(settled.periods).length : 0,
        emptyPeriods: settled.periods ? emptyPeriods(settled.periods).length : 0,
        truncated: completion.truncated,
      }),
    },
    followUp: outcome.followUp,
  };
}

// ── A Run that failed ──────────────────────────────────

export interface FailedRunInput {
  /** The producer's message, or undefined when it sent none. */
  message?: string;
  run: RunLifecycle;
}

/**
 * Settle a Run that died without a usable result.
 *
 * A failed scrape keeps nothing: there is no result, and the requests the Run
 * owed go with it (ADR-0022). No STOP_SCRAPE is posted — the page world is the
 * one reporting the failure — and no follow-up survives.
 */
export function failedRun({ message, run }: FailedRunInput): RunReport {
  const text = scrapeErrorMessage(message);
  run.stop({ keepRows: false });
  return {
    ending: "failed",
    completion: null,
    updates: [{ kind: "error", text }],
    notification: { kind: "error", detail: text },
    followUp: [],
  };
}
