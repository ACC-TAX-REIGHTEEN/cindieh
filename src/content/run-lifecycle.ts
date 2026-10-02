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
  | { kind: "rejected"; message: string };

/**
 * Which kind of Run is starting.
 *
 * `targeted` and `bulk-pdf` behave alike — both READ the captured rows, so
 * both keep them — but they are named apart because they are distinct Runs and
 * a future change may need to tell them apart here.
 */
export type RunStart = "scrape" | "targeted" | "bulk-pdf";

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
   * Takes no message: every caller already holds the one it is about to show,
   * and storing it would only invite reading it back out of state again.
   */
  abort(): void;

  /**
   * Drop this Run's export request and stop it — the export click that doubles
   * as a stop. Deliberately keeps the last good rows so a following export can
   * still use them, and deliberately keeps a pending comparison or check, which
   * outlives the run that was carrying it. Pinned by tests; do not "tidy" this
   * into `abort()` without deciding what should happen to the kept rows.
   */
  cancelExport(): void;

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
  pendingExportFormat: "xlsx" | "csv" | "pdf" | null;
  pendingCompare: boolean;
  pendingCheck: boolean;
  requestedInvoices: string[];
  data: Record<string, unknown>[] | null;
  fields: string[] | null;
  filenameHint: string | undefined;
  source: ExportSource | undefined;
}

function freshState(): RunState {
  return {
    isRunning: false,
    pendingExportFormat: null,
    pendingCompare: false,
    pendingCheck: false,
    requestedInvoices: [],
    data: null,
    fields: null,
    filenameHint: undefined,
    source: undefined,
  };
}

export function createRunLifecycle(): RunLifecycle {
  const state = freshState();

  /** Everything this Run owes, spent in one step. */
  function dropPending(): void {
    state.pendingExportFormat = null;
    state.pendingCompare = false;
    state.pendingCheck = false;
    state.requestedInvoices = [];
  }

  /** Everything this Run produced. */
  function dropResult(): void {
    state.data = null;
    state.fields = null;
    state.filenameHint = undefined;
    state.source = undefined;
  }

  function abort(): void {
    state.isRunning = false;
    dropPending();
    dropResult();
  }

  return {
    isRunning: () => state.isRunning,

    begin(start) {
      state.isRunning = true;
      // A full scrape is about to replace the grid, so the previous rows stop
      // being reusable. A targeted lookup and a bulk PDF download both read the
      // captured rows, so they keep them.
      if (start === "scrape") dropResult();
    },

    abort,

    cancelExport() {
      state.isRunning = false;
      state.pendingExportFormat = null;
      state.requestedInvoices = [];
    },

    reset() {
      Object.assign(state, freshState());
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
      return {
        data: state.data,
        fields: state.fields,
        filenameHint: state.filenameHint,
        source: state.source,
      };
    },

    complete(completion) {
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