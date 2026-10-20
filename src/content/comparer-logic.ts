// ============================================================
// COMPARER-LOGIC.TS — Pure comparison session logic
// ============================================================
// Extracted from ui-comparer.ts for testability.
// No DOM or browser API dependencies.
// Contains session state management, pagination maths, filter
// logic, and status summary generation.
// ============================================================

import type { ComparisonResult, ComparisonStatus, CoretaxOnlyScope, PastedRow } from "./comparer";
import { compareData, parsePastedData } from "./comparer";
import { COMPARISON_STATUSES, type ComparerDefaults } from "../shared/extension-preferences";

// ── Session state ──────────────────────────────────────

export interface ComparerSession {
  results: ComparisonResult[];
  currentPage: number;
  tolerance: number;
  /** Empty array means "all statuses" (no filter applied). */
  statusFilter: ComparisonStatus[];
  dailyEnabled: boolean;
  /** Day-of-month values (1-31) for the daily reverse check. */
  dailyDates: number[];
  refLainEnabled: boolean;
  /** References the user has already double-clicked (row highlight). */
  viewedRefs: Set<string>;
}

export function createComparerSession(): ComparerSession {
  return {
    results: [],
    currentPage: 1,
    tolerance: 0,
    statusFilter: [],
    dailyEnabled: true,
    dailyDates: [],
    refLainEnabled: true,
    viewedRefs: new Set(),
  };
}

/**
 * Seed a session's option fields from the stored defaults (popup → Comparer).
 * Pure: the daily-dates string goes through the same parser the panel uses, so a
 * seeded value can never be one the panel itself would reject. The panel's own
 * controls keep overriding these per session — this only removes retyping.
 */
export function applyComparerDefaults(
  session: ComparerSession,
  defaults: ComparerDefaults,
): void {
  session.tolerance = defaults.tolerance;
  // Re-emit through the canonical status list for the same reason the storage
  // normalizer does: the session's order is what the panel labels itself from,
  // and a caller holding a hand-built defaults object would otherwise seed a
  // differently-ordered filter than the stored one it mirrors.
  session.statusFilter = COMPARISON_STATUSES.filter((status) =>
    defaults.statusFilter.includes(status),
  );
  session.dailyDates = parseDailyDates(defaults.dailyDates);
}

// ── Pagination ─────────────────────────────────────────

export interface PaginationState<T = ComparisonResult> {
  totalPages: number;
  currentPage: number;
  startIndex: number;
  pageRows: T[];
}

/**
 * Compute pagination over a list of results.
 *
 * Returns a clamped currentPage so callers never need to guard
 * against out-of-range values.
 */
export function computePagination<T>(
  results: readonly T[],
  pageSize: number,
  currentPage: number,
): PaginationState<T> {
  const totalPages = Math.max(1, Math.ceil(results.length / pageSize));
  const clampedPage = Math.min(Math.max(1, currentPage), totalPages);
  const startIndex = (clampedPage - 1) * pageSize;
  const pageRows = results.slice(startIndex, startIndex + pageSize);
  return { totalPages, currentPage: clampedPage, startIndex, pageRows };
}

// ── Status filtering ───────────────────────────────────

/**
 * Apply the active status filter to the full result set.
 * An empty filter array means "show all".
 */
export function applyStatusFilter(
  results: ComparisonResult[],
  statusFilter: ComparisonStatus[],
): ComparisonResult[] {
  if (statusFilter.length === 0) return results;
  const set = new Set<string>(statusFilter);
  return results.filter((r) => set.has(r.status));
}

// ── Status summary ─────────────────────────────────────

export interface StatusSummary {
  total: number;
  cocok: number;
  berbeda: number;
  tidakDitemukan: number;
  hanyaCoretax: number;
}

/**
 * Count result statuses for the panel summary text.
 * Pure function — no side effects.
 */
export function buildStatusSummary(results: ComparisonResult[]): StatusSummary {
  let cocok = 0;
  let berbeda = 0;
  let tidakDitemukan = 0;
  let hanyaCoretax = 0;

  for (const r of results) {
    switch (r.status) {
      case "COCOK": cocok++; break;
      case "DPP_BERBEDA":
      case "PPN_BERBEDA":
      case "BERBEDA": berbeda++; break;
      case "TIDAK_DITEMUKAN": tidakDitemukan++; break;
      case "HANYA_CORETAX": hanyaCoretax++; break;
    }
  }

  return { total: results.length, cocok, berbeda, tidakDitemukan, hanyaCoretax };
}

/**
 * Format the summary object into the user-facing status string.
 */
export function formatStatusSummary(summary: StatusSummary): string {
  const { total, cocok, berbeda, tidakDitemukan, hanyaCoretax } = summary;
  let text = `${total} data diperiksa: ${cocok} cocok, ${berbeda} berbeda, ${tidakDitemukan} tidak ditemukan`;
  if (hanyaCoretax > 0) text += `, ${hanyaCoretax} hanya di coretax`;
  return `${text}.`;
}

// ── Daily-dates parsing ────────────────────────────────

/**
 * Parse a raw string of day-of-month values (1-31).
 * Accepts comma, semicolon, or whitespace as separators.
 * Invalid or out-of-range values are silently dropped.
 */
export function parseDailyDates(raw: string): number[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  return trimmed
    .split(/[,;\s]+/)
    .map((s) => /^\d+$/.test(s) ? Number(s) : NaN)
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 31);
}

// ── Status label i18n ──────────────────────────────────

export type StatusLabel =
  | "Cocok"
  | "DPP Berbeda"
  | "PPN Berbeda"
  | "Berbeda"
  | "Tidak ditemukan"
  | "Hanya di Coretax";

/**
 * Translate a ComparisonStatus to a display label.
 */
export function getStatusLabel(status: ComparisonStatus): StatusLabel {
  switch (status) {
    case "COCOK": return "Cocok";
    case "DPP_BERBEDA": return "DPP Berbeda";
    case "PPN_BERBEDA": return "PPN Berbeda";
    case "BERBEDA": return "Berbeda";
    case "TIDAK_DITEMUKAN": return "Tidak ditemukan";
    case "HANYA_CORETAX": return "Hanya di Coretax";
  }
}

// ── Session orchestration ─────────────────────────────
// The state transitions the view used to hand-roll: run a fresh
// comparison, re-run with current inputs, and prepare the "Periksa"
// decision tree. No DOM access — the session object is mutated in place
// (results, page, highlights) and the view only renders the outcome.

/**
 * The reverse check's scope, read from the session: daily mode narrows the
 * "hanya di coretax" candidates to the days the Wajib Pajak recorded, while
 * monthly mode (the day box unticked) leaves EVERY row of the grid a
 * candidate. A daily session with no day yet has no scope at all — the panel
 * asks for the days before it runs, so this never silently narrows a check the
 * Wajib Pajak asked for in full.
 */
export function coretaxOnlyScope(session: ComparerSession): CoretaxOnlyScope | null {
  if (!session.dailyEnabled) return { kind: "all" };
  if (session.dailyDates.length === 0) return null;
  return { kind: "days", days: session.dailyDates };
}

/**
 * Run a comparison against already-parsed pasted rows and update the
 * session: fresh results, page reset, viewed highlights cleared.
 */
export function runComparison(
  session: ComparerSession,
  pastedRows: PastedRow[],
  scrapedData: Record<string, unknown>[],
): ComparisonResult[] {
  session.results = compareData(
    pastedRows,
    scrapedData,
    session.tolerance,
    coretaxOnlyScope(session),
  );
  session.currentPage = 1;
  session.viewedRefs.clear();
  return session.results;
}

export type RerunResult =
  | { action: "run"; results: ComparisonResult[] }
  | { action: "error"; message: string };

/**
 * Re-run with the same validation as "Periksa", using the raw date input.
 * Errors invalidate previous results so stale success cannot be exported.
 * Unlike prepareComparison, a rerun never requests a scrape.
 */
export function rerunComparison(
  session: ComparerSession,
  textareaValue: string,
  scrapedData: Record<string, unknown>[] | null,
  dailyDatesInputValue: string,
): RerunResult {
  const decision = prepareComparison(session, textareaValue, scrapedData, dailyDatesInputValue);
  if (decision.action === "error") return decision;
  if (decision.action === "needScrape") {
    return { action: "error", message: "Belum ada data Coretax. Silakan lakukan scraping terlebih dahulu." };
  }
  return { action: "run", results: runComparison(session, decision.pastedRows, decision.scrapedData) };
}

export type PrepareResult =
  | { action: "run"; pastedRows: PastedRow[]; scrapedData: Record<string, unknown>[] }
  | { action: "needScrape"; pastedRows: PastedRow[] }
  | { action: "error"; message: string };

/**
 * Decide what the "Periksa" button must do for the current session and
 * inputs. Ordering is deliberate and load-bearing:
 *   1. daily-dates validation runs before anything else (before scraping);
 *   2. current textarea content is the source of truth, even when hidden;
 *   3. empty input is an error; unparseable input is an error;
 *   4. no scraped data means scrape first.
 * Invalidates previous results, pagination and highlights before validation.
 * Updates dailyDates only from fully valid input (clears them otherwise).
 * The view maps the returned action to DOM/UI behaviour.
 */
export function prepareComparison(
  session: ComparerSession,
  textareaValue: string,
  scrapedData: Record<string, unknown>[] | null,
  dailyDatesInputValue: string,
): PrepareResult {
  session.results = [];
  session.currentPage = 1;
  session.viewedRefs.clear();
  session.dailyDates = [];

  if (session.dailyEnabled) {
    const raw = dailyDatesInputValue.trim();
    if (!raw) {
      return { action: "error", message: "Silakan masukkan tanggal (1-31) terlebih dahulu." };
    }
    const parsed = parseDailyDates(raw);
    if (parsed.length === 0 || parsed.length !== raw.split(/[,;\s]+/).length) {
      return { action: "error", message: "Format tanggal tidak valid. Gunakan angka 1-31, pisahkan dengan koma." };
    }
    session.dailyDates = parsed;
  }


  const text = textareaValue.trim();
  if (!text) {
    return { action: "error", message: "Silakan paste data dari Excel terlebih dahulu." };
  }

  const pastedRows = parsePastedData(textareaValue, session.refLainEnabled);
  if (pastedRows.length === 0) {
    return {
      action: "error",
      message: session.refLainEnabled
        ? "Format data tidak dikenali. Pastikan format: Referensi, Referensi Lain, DPP, PPN (tab-separated)."
        : "Format data tidak dikenali. Pastikan format: Referensi, DPP, PPN (tab-separated).",
    };
  }

  if (!scrapedData || scrapedData.length === 0) {
    return { action: "needScrape", pastedRows };
  }

  return { action: "run", pastedRows, scrapedData };
}
