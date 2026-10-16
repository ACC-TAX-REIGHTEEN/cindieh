// ============================================================
// RUN-LIFECYCLE.TS — What one Run knows in the isolated world
// ============================================================
// A Run is one operation on a grid: a scrape, a targeted No. Faktur lookup,
// or a bulk PDF download (CONTEXT.md). The MAIN world owns the Run's identity
// and cancellation (scraper-run.ts, ADR-0010); this module owns everything the
// isolated world knows about it — whether it is in flight, what it still owes,
// and what it last produced.
//
// This module replaced `ContentState`, which was ten mutable fields and no
// behaviour. The rule that mattered — a pending request is spent exactly once
// and abandoned with its Run — was remembered in six places across four
// modules and enforced nowhere; it is enforced here now.
//
// No browser or DOM dependency, so the whole module is testable without a
// page. ActionDeps and the export decision tree stay in main-actions.ts
// (ADR-0004, ADR-0014).
// ============================================================

import type { ExportSource } from "./page-context";
import type { PeriodSummary } from "./scrape-batch";
import type { ScrapeComplete } from "./scraper-types";
import {
  findMissingInvoices,
  incompleteResultMessage,
  missingInvoicesMessage,
} from "./scrape-result";

// ── Values ─────────────────────────────────────────────

/** The rows a finished Run produced, ready for export, comparison or checking. */
export interface RunResult {
  data: Record<string, unknown>[];
  fields: string[];
  /** Filename hint from the grid request, seeding export and PDF filenames. */
  filenameHint?: string;
  source?: ExportSource;
  /**
   * True when these rows came from a sweep the user stopped.
   *
   * The rows are real and the counts are honest, but the file they produce is
   * not a whole year, and a row count cannot say so — ten months look exactly
   * like twelve to whatever reads the file. The export path names it instead
   * (exporter.ts), and only a deliberate export from here can produce one.
   */
  partialSweep?: boolean;
  /**
   * What each masa of a year-wide sweep contributed, so far.
   *
   * Carried with the rows rather than beside them because it is what makes the
   * rows RESUMABLE: `pendingPeriods` reads it to say which masa still have to be
   * fetched, and `mergePeriodSummaries` folds a resumed sweep's own counts back
   * in. Present only while the rows came from a sweep.
   */
  sweep?: PeriodSummary;
}

/** Something the Wajib Pajak asked for before the grid data existed. */
export type RunIntent =
  | { kind: "export"; format: "xlsx" | "csv" | "pdf" }
  | { kind: "compare" }
  | { kind: "check" };

/** A pending intent, carried out by the caller in the order returned. */
export type FollowUp =
  | { kind: "compare" }
  | { kind: "check" }
  | { kind: "export"; format: "xlsx" | "csv" | "pdf" };

/**
 * Requested No. Faktur numbers that no returned row carried.
 *
 * A number Coretax has no row for is NOT a lookup failure: the request
 * succeeds with an empty payload, so `partial` and `failedInvoices` both stay
 * empty and the result would otherwise come back silently short.
 */
export interface Shortfall {
  /** How many of the requested numbers came back with no row. */
  count: number;
  /**
   * The panel notice, or null when this run already named the numbers
   * elsewhere — a bulk PDF run lists them in its pre-download dialog, and the
   * panel switches to per-file progress the moment the download starts, so a
   * panel notice could not survive it.
   */
  notice: string | null;
}

/**
 * What `complete()` reports: either the Run finished and here is what it still
 * owes, or it was rejected and here is why.
 */
export type RunOutcome =
  | { kind: "accepted"; followUp: FollowUp[]; shortfall: Shortfall | null }
  /**
   * The user stopped the Run and what it had already collected was kept. Not a
   * rejection (the rows are real) and not an acceptance (the request is not
   * finished, so nothing it owed is spent and nothing runs automatically).
   */
  | { kind: "salvaged" }
  | { kind: "rejected"; message: string };

/**
 * Which kind of Run is starting.
 *
 * `targeted`, `bulk-pdf` and `sweep-resume` behave alike — all three READ the
 * rows already collected, so all three keep them — but they are named apart
 * because they are distinct Runs, and because `sweep-resume` carries one rule
 * of its own: ending it early keeps the union it was adding to (see `abort`).
 */
export type RunStart = "scrape" | "targeted" | "bulk-pdf" | "sweep-resume";

// ── Interface ──────────────────────────────────────────

export interface RunLifecycle {
  /** Whether a Run is in flight. */
  isRunning(): boolean;

  /** Mark a Run as in flight. A full `scrape` retires the previous rows. */
  begin(start: RunStart): void;

  /**
   * End a Run because its result cannot be used: a stop, a SCRAPE_ERROR, or a
   * completion rejected as incomplete. Forgets what it owed AND what it
   * produced, so nothing survives that a later Run could be measured against.
   *
   * A `sweep-resume` is the exception: the kept union it was adding to survives,
   * because that union belongs to an earlier Run that never failed — losing it
   * would make a failed resume worse than no resume at all.
   *
   * Takes no message: every caller already holds the one it is about to show,
   * and storing it would only invite reading it back out of state again.
   */
  abort(): void;

  /**
   * Stop the Run an export click interrupted: retire every request it carried
   * and keep the rows it had collected, so a following export can still use
   * them. That is the ONE difference from `abort()`, and the reason both exist.
   *
   * Every request, not only the export the click named: a request is spent
   * exactly once, by the Run that recorded it (ADR-0022, CONTEXT.md under
   * "Pending export"). One left pending here would be spent by whatever
   * completion arrived next, and the next one can be a No. Faktur lookup whose
   * rows are the filtered SUBSET — every pasted row outside it would answer
   * "Tidak ditemukan". Rows are not requests: they describe the grid, so they
   * survive the stop.
   */
  stopKeepingRows(): void;

  /** Forget everything, silently. Navigation and "Bersihkan cache". */
  reset(): void;

  /** Record an intent this Run must fulfil when it completes. */
  request(intent: RunIntent): void;

  /**
   * Drop one pending intent and leave the others alone. The panel uses it when
   * the Wajib Pajak clears or re-runs a comparison, which must not cancel a
   * pending export of the same grid.
   */
  cancelPending(kind: RunIntent["kind"]): void;

  /**
   * The export format this Run was asked for, or null. Read by the readiness
   * resend, which must repeat the original request's intent when the first
   * message reached the page before the Scraper did.
   */
  pendingExport(): "xlsx" | "csv" | "pdf" | null;

  /**
   * Record the No. Faktur numbers this Run was asked for. Called only once a
   * run is really starting: a declined confirmation must leave nothing behind,
   * because no completion will ever arrive to consume it.
   */
  noteRequestedInvoices(numbers: readonly string[]): void;

  /**
   * Hear about the requests a retirement took, in the order the panel runs
   * them.
   *
   * This is the ONE thing a tab cannot see for itself. A tab writes its "waiting
   * for the grid" line on the way in, and the completion that would have
   * replaced it is exactly what a stop, a failure, a rejected transfer or a
   * reset retires — so the line outlived the request and kept promising work
   * that could no longer arrive. Every retirement funnels through here, which is
   * why a new stop path cannot forget to say so.
   *
   * One listener: main.ts is the isolated world's wiring layer and routes each
   * kind to the tab that queued it. The life-cycle itself knows nothing about
   * tabs (or the DOM).
   */
  onRetired(listener: (kinds: readonly RunIntent["kind"][]) => void): void;

  /** The last accepted result, or null when there is no reusable data. */
  result(): RunResult | null;

  /**
   * Settle a finished Run: accept it or reject it, spend everything it owed,
   * and report both what happened and what the caller must now do.
   */
  complete(result: ScrapeComplete): RunOutcome;
}

// ── Implementation ─────────────────────────────────────

interface RunState {
  isRunning: boolean;
  /**
   * Whether the Run in flight is finishing a sweep a stop interrupted.
   *
   * It exists for ONE rule: a resume can only ever ADD to the union a stop
   * salvaged, so ending it early (a stop, a failure, a rejection) must not take
   * the kept masa with it. Every other start still drops its result when it
   * ends badly (see `abort`).
   */
  resumingSweep: boolean;
  pendingExportFormat: "xlsx" | "csv" | "pdf" | null;
  pendingCompare: boolean;
  pendingCheck: boolean;
  requestedInvoices: string[];
  data: Record<string, unknown>[] | null;
  fields: string[] | null;
  filenameHint: string | undefined;
  source: ExportSource | undefined;
  partialSweep: boolean;
  sweep: PeriodSummary | null;
}

function freshState(): RunState {
  return {
    isRunning: false,
    resumingSweep: false,
    pendingExportFormat: null,
    pendingCompare: false,
    pendingCheck: false,
    requestedInvoices: [],
    data: null,
    fields: null,
    filenameHint: undefined,
    source: undefined,
    partialSweep: false,
    sweep: null,
  };
}

export function createRunLifecycle(): RunLifecycle {
  const state = freshState();

  let retireListener: ((kinds: readonly RunIntent["kind"][]) => void) | null = null;

  /**
   * Everything this Run owes, spent in one step. Returns the kinds it took, so
   * a retirement can be announced with what it cost — and an empty list stays
   * silent, because a Run that owed nothing has nothing to take back.
   */
  function dropPending(): RunIntent["kind"][] {
    const dropped: RunIntent["kind"][] = [];
    if (state.pendingCompare) dropped.push("compare");
    if (state.pendingCheck) dropped.push("check");
    if (state.pendingExportFormat) dropped.push("export");
    state.pendingExportFormat = null;
    state.pendingCompare = false;
    state.pendingCheck = false;
    state.requestedInvoices = [];
    return dropped;
  }

  /** Drop what this Run owed, and say which requests went with it. */
  function retirePending(): void {
    const dropped = dropPending();
    if (dropped.length > 0) retireListener?.(dropped);
  }

  /**
   * Keep what a stopped Run had collected.
   *
   * A stop is not a completion. The rows stay so the user can still export them
   * by hand, and everything the Run still owed is dropped: nothing may run
   * automatically on a request that was interrupted. A pending comparison is
   * the sharpest case — spent against eleven of twelve months it would produce
   * a result that looks complete, which is the one thing a partial year must
   * never do.
   *
   * Reached only from `complete`, which opens this door for a completion that
   * HAS rows — so what arrives here is kept as it stands rather than
   * re-litigated with guards that could never fire.
   */
  function salvage(
    completion: Pick<ScrapeComplete, "data" | "fields" | "filenameHint" | "source" | "periods">,
  ): void {
    state.isRunning = false;
    state.resumingSweep = false;
    state.data = completion.data;
    state.fields = completion.fields;
    state.filenameHint = completion.filenameHint;
    state.source = completion.source;
    state.partialSweep = true;
    // The union, when a resume was stopped mid-way (main.ts merges the incoming
    // counts into the kept ones before settling); the sweep's own counts
    // otherwise. Either way this is what a later resume reads to know what is
    // still missing.
    state.sweep = completion.periods ?? state.sweep;
    // Nothing to announce in practice — the stop that cut this sweep short
    // already retired what the Run owed — but the rule is one rule: whatever
    // this drops is taken back out loud (see retirePending).
    retirePending();
  }

  /** Everything this Run produced. */
  function dropResult(): void {
    state.data = null;
    state.fields = null;
    state.filenameHint = undefined;
    state.source = undefined;
    // The partial flag and the per-masa counts travel with the rows they
    // describe: leaving either set would mark the NEXT run's file as partial or
    // let it be resumed against months it never fetched.
    state.partialSweep = false;
    state.sweep = null;
  }

  function abort(): void {
    state.isRunning = false;
    retirePending();
    // A resume can only ever ADD to the union a stop salvaged, so ending it
    // early — a stop, a failure, a rejected result — costs the masa it was
    // fetching and never the masa already kept. Dropping the rows here would
    // make a failed resume worse than no resume at all.
    if (state.resumingSweep) {
      state.resumingSweep = false;
      return;
    }
    dropResult();
  }

  return {
    isRunning: () => state.isRunning,

    begin(start) {
      state.isRunning = true;
      // A full scrape is about to replace the grid, so the previous rows stop
      // being reusable. A targeted lookup, a bulk PDF download and a resumed
      // sweep all read the kept rows, so they keep them.
      if (start === "scrape") dropResult();
      // The resume rule in `abort` lasts only as long as the Run that declared
      // it, so it is set here for every start.
      state.resumingSweep = start === "sweep-resume";
    },

    abort,

    stopKeepingRows() {
      state.isRunning = false;
      state.resumingSweep = false;
      // Everything this Run owed, dropped in one step — the comparison and the
      // check included, which is what makes all three stop paths agree.
      retirePending();
    },

    reset() {
      // A tab may still be showing the line it wrote when it queued its
      // request, and a reset retires that request too (navigation, "Bersihkan
      // cache"): forgetting silently is this path's documented job, but a
      // promise left standing is not part of forgetting.
      retirePending();
      Object.assign(state, freshState());
    },

    onRetired(listener) {
      retireListener = listener;
    },

    request(intent) {
      if (intent.kind === "export") state.pendingExportFormat = intent.format;
      if (intent.kind === "compare") state.pendingCompare = true;
      if (intent.kind === "check") state.pendingCheck = true;
    },

    pendingExport: () => state.pendingExportFormat,

    cancelPending(kind) {
      if (kind === "export") state.pendingExportFormat = null;
      if (kind === "compare") state.pendingCompare = false;
      if (kind === "check") state.pendingCheck = false;
    },

    noteRequestedInvoices(numbers) {
      state.requestedInvoices = [...numbers];
    },

    result() {
      // Both guards, because the export path has always required both: a
      // successful PDF run carries no fields of its own and keeps the grid
      // schema it was scraped with.
      if (!state.data || !state.fields) return null;
      const result: RunResult = {
        data: state.data,
        fields: state.fields,
        filenameHint: state.filenameHint,
        source: state.source,
      };
      // Omitted rather than set false: an absent flag IS a whole run, which is
      // the export path's own default, so only the exception is carried.
      if (state.partialSweep) result.partialSweep = true;
      // Same reasoning: only a sweep's rows carry the per-masa counts a resume
      // needs to know which masa are still missing.
      if (state.sweep) result.sweep = state.sweep;
      return result;
    },

    complete(completion) {
      // Settled BEFORE the incompleteness rules, which count `cancelled` as a
      // rejection — and rightly so, for the one cancellation that carries
      // nothing. A stopped sweep that got rows is the exception: they are real,
      // they are the user's, and they must not be thrown away with the request.
      if (completion.cancelled && (completion.data?.length ?? 0) > 0) {
        salvage(completion);
        return { kind: "salvaged" };
      }

      const rejection = incompleteResultMessage(completion);
      if (rejection) {
        abort();
        return { kind: "rejected", message: rejection };
      }

      state.isRunning = false;
      state.data = completion.data || null;
      // Successful PDF downloads carry no fields; retain the original grid
      // schema rather than discarding it.
      if (completion.fields?.length) state.fields = completion.fields;
      state.filenameHint = completion.filenameHint;
      state.source = completion.source;
      state.resumingSweep = false;
      // A completion that reached this line is whole: whatever the previous run
      // kept as a partial sweep does not describe these rows.
      state.partialSweep = false;
      // The counts travel with the rows they describe, and this completion just
      // REPLACED those rows — so a completion that carries no counts describes
      // no sweep, and one that came before it must not survive it. That covers
      // a targeted No. Faktur lookup (whose rows are the filtered SUBSET) and a
      // bulk PDF run's own grid scrape: leaving the old counts behind would let
      // the next year-export offer to "resume" a year whose masa the isolated
      // world no longer holds, and a finished resume would drop the `-sebagian`
      // name off a file that is not a whole year.
      state.sweep = completion.periods ?? null;

      // The request is spent here, whatever happens next, so a later Run can
      // never be diffed against a stale list.
      const requested = state.requestedInvoices;
      state.requestedInvoices = [];

      const missing = findMissingInvoices(requested, completion.data ?? []);
      const shortfall: Shortfall | null =
        missing.length === 0
          ? null
          : {
              count: missing.length,
              notice:
                completion.kind === "pdf"
                  ? null
                  : missingInvoicesMessage(requested.length, missing),
            };

      // Spend what this Run owed, in the order the panel has always run it.
      const followUp: FollowUp[] = [];
      if (state.pendingCompare) {
        state.pendingCompare = false;
        followUp.push({ kind: "compare" });
      }
      if (state.pendingCheck) {
        state.pendingCheck = false;
        followUp.push({ kind: "check" });
      }
      if (state.pendingExportFormat) {
        followUp.push({ kind: "export", format: state.pendingExportFormat });
        state.pendingExportFormat = null;
      }

      return { kind: "accepted", followUp, shortfall };
    },
  };
}

// ── Module singleton ───────────────────────────────────
// Production consumers (main.ts, main-actions.ts, ui-comparer.ts) use this.
// Tests call createRunLifecycle() for an independent instance.

export const runLifecycle: RunLifecycle = createRunLifecycle();