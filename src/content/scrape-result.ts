// ── Main-side result acceptance and invalidation ──────────────

import type { ContentState } from "./main-actions";
import type { MessageHandler } from "./postmessage-guard";
import type { ScrapeComplete } from "./scraper-types";

/** Runs inside the dispatcher, after its source/origin/token guard. */
export function currentRunHandlers(
  handlers: Record<string, MessageHandler>,
  isCurrentRunMessage: (msg: Record<string, unknown>) => boolean,
): Record<string, MessageHandler> {
  return Object.fromEntries(Object.entries(handlers).map(([type, handler]) => [
    type,
    (msg: Record<string, unknown>) => {
      if (isCurrentRunMessage(msg)) handler(msg);
    },
  ]));
}

export function incompleteResultMessage(result: Pick<ScrapeComplete,
  "partial" | "cancelled" | "failedInvoices" | "failureCount"
>): string | null {
  if (!result.partial && !result.cancelled && !result.failedInvoices?.length && !(result.failureCount && result.failureCount > 0)) {
    return null;
  }
  const reason = result.cancelled ? "Proses dibatalkan." : "Proses belum selesai sepenuhnya.";
  const failures = result.failureCount && result.failureCount > 0 ? ` ${result.failureCount} proses gagal.` : "";
  const invoices = result.failedInvoices?.length ? ` Faktur gagal: ${result.failedInvoices.join(", ")}.` : "";
  return `${reason}${failures}${invoices} Data tidak disimpan sebagai hasil lengkap; ekspor dan pemeriksaan otomatis dibatalkan. Periksa sesi Coretax dan filter, lalu jalankan ulang. PDF yang sudah diunduh tetap tersimpan.`;
}

/** Discard both current and previous cached results, not just pending actions. */
export function invalidateScrapeResult(state: ContentState, message: string): void {
  state.isRunning = false;
  state.scrapedData = null;
  state.scrapedFields = null;
  state.lastExportMeta = null;
  state.pendingExportFormat = null;
  state.pendingCompare = false;
  state.pendingCheck = false;
  // A discarded result must take its request with it: reporting a later scrape's
  // rows against this list would invent "not found" numbers.
  state.requestedInvoices = [];
  state.lastState = { type: "SCRAPE_ERROR", message };
}

/** How many missing numbers the panel lists before summarizing the rest. */
export const MAX_LISTED_MISSING_INVOICES = 5;

/**
 * Requested No. Faktur numbers that no returned row carries.
 *
 * Matching mirrors applyMultiInvoiceFilter (TaxInvoiceNumber, then LetterNumber,
 * case-insensitively) so the report and the export agree on what "one of mine"
 * means. Duplicates in the pasted list are reported once.
 */
export function findMissingInvoices(
  requested: readonly string[],
  rows: readonly Record<string, unknown>[],
): string[] {
  if (requested.length === 0) return [];

  const found = new Set<string>();
  for (const row of rows) {
    const number = String(row.TaxInvoiceNumber || row.LetterNumber || "").trim().toLowerCase();
    if (number) found.add(number);
  }

  const missing: string[] = [];
  const reported = new Set<string>();
  for (const raw of requested) {
    const number = raw.trim();
    const key = number.toLowerCase();
    if (!key || found.has(key) || reported.has(key)) continue;
    reported.add(key);
    missing.push(number);
  }
  return missing;
}

/** Panel notice for a short targeted scrape; null when nothing is missing. */
export function missingInvoicesMessage(
  requestedCount: number,
  missing: readonly string[],
): string | null {
  if (missing.length === 0) return null;
  const listed = missing.slice(0, MAX_LISTED_MISSING_INVOICES).join(", ");
  const rest = missing.length - MAX_LISTED_MISSING_INVOICES;
  const suffix = rest > 0 ? ` (+${rest} nomor lain)` : "";
  return `${missing.length} dari ${requestedCount} nomor faktur tidak ditemukan di Coretax: ${listed}${suffix}.`;
}

/**
 * Consume a targeted scrape's requested-invoice list and describe what never
 * came back. The request is cleared either way, so a later scrape can never be
 * diffed against a stale list.
 *
 * This exists because a number Coretax has no row for is NOT a lookup failure:
 * the request succeeds with an empty payload, so `partial` and `failedInvoices`
 * both stay empty and the export would otherwise come back silently short.
 */
export function consumeMissingInvoices(
  state: ContentState,
  rows: readonly Record<string, unknown>[],
): string | null {
  const requested = state.requestedInvoices;
  state.requestedInvoices = [];
  return missingInvoicesMessage(requested.length, findMissingInvoices(requested, rows));
}

export function scrapeErrorMessage(message?: string): string {
  return `${message || "Proses gagal."} Ekspor dan pemeriksaan otomatis dibatalkan. Periksa sesi Coretax dan filter, lalu jalankan ulang.`;
}

/** Only an accepted result may trigger pending exports or comparisons. */
export function acceptScrapeResult(state: ContentState, result: ScrapeComplete): boolean {
  const warning = incompleteResultMessage(result);
  if (warning) {
    invalidateScrapeResult(state, warning);
    return false;
  }
  state.isRunning = false;
  state.scrapedData = result.data || null;
  // Successful PDF downloads carry no fields; retain the original grid schema.
  if (result.fields?.length) state.scrapedFields = result.fields;
  state.lastExportMeta = { filenameHint: result.filenameHint, source: result.source };
  state.lastState = result;
  return true;
}
