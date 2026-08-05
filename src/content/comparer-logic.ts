// ============================================================
// COMPARER-LOGIC.TS — Pure comparison session logic
// ============================================================
// Extracted from ui-comparer.ts for testability.
// No DOM or browser API dependencies.
// Contains session state management, pagination maths, filter
// logic, and status summary generation.
// ============================================================

import type { ComparisonResult, ComparisonStatus } from "./comparer";

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
  };
}

// ── Pagination ─────────────────────────────────────────

export interface PaginationState {
  totalPages: number;
  currentPage: number;
  startIndex: number;
  pageRows: ComparisonResult[];
}

/**
 * Compute pagination over a list of results.
 *
 * Returns a clamped currentPage so callers never need to guard
 * against out-of-range values.
 */
export function computePagination(
  results: ComparisonResult[],
  pageSize: number,
  currentPage: number,
): PaginationState {
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
    .map((s) => parseInt(s, 10))
    .filter((n) => !isNaN(n) && n >= 1 && n <= 31);
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
