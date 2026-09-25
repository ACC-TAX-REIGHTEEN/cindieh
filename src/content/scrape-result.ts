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

/** A one-line list of invoice numbers, capped so a long paste cannot flood a panel. */
function listInvoices(numbers: readonly string[]): string {
  const listed = numbers.slice(0, MAX_LISTED_MISSING_INVOICES).join(", ");
  const rest = numbers.length - MAX_LISTED_MISSING_INVOICES;
  return rest > 0 ? `${listed} (+${rest} nomor lain)` : listed;
}

function missingInvoicesNotice(
  requestedCount: number,
  missing: readonly string[],
  reason: string,
): string | null {
  if (missing.length === 0) return null;
  return `${missing.length} dari ${requestedCount} nomor faktur ${reason}: ${listInvoices(missing)}.`;
}

/** Panel notice for a short targeted scrape; null when nothing is missing. */
export function missingInvoicesMessage(
  requestedCount: number,
  missing: readonly string[],
): string | null {
  return missingInvoicesNotice(requestedCount, missing, "tidak ditemukan di Coretax");
}

/**
 * The same notice for a bulk PDF download, where the numbers are missing from
 * the rows already captured rather than from a fresh targeted lookup — those
 * files will simply not be downloaded.
 */
export function skippedInvoicesMessage(
  requestedCount: number,
  skipped: readonly string[],
): string | null {
  return missingInvoicesNotice(
    requestedCount,
    skipped,
    "tidak ada di data yang sudah diambil dan akan dilewati",
  );
}

export interface MissingInvoices {
  /** Numbers the run asked for that no returned row carried, in request order. */
  missing: string[];
  /** Panel notice for a targeted export; null when nothing is missing. */
  notice: string | null;
}

/**
 * Consume a run's requested-invoice list and describe what never came back. The
 * request is cleared either way, so a later run can never be diffed against a
 * stale list.
 *
 * This exists because a number Coretax has no row for is NOT a lookup failure:
 * the request succeeds with an empty payload, so `partial` and `failedInvoices`
 * both stay empty and the result would otherwise come back silently short. The
 * same diff serves a filtered bulk PDF run, whose completion carries only the
 * rows it downloaded — the requested numbers absent from those are the ones the
 * pre-download dialog already named.
 */
export function consumeMissingInvoices(
  state: ContentState,
  rows: readonly Record<string, unknown>[],
): MissingInvoices {
  const requested = state.requestedInvoices;
  state.requestedInvoices = [];
  const missing = findMissingInvoices(requested, rows);
  return { missing, notice: missingInvoicesMessage(requested.length, missing) };
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
