// ── Main-side result acceptance and invalidation ──────────────
// Acceptance, invalidation and the missing-invoice diff moved to
// run-lifecycle.ts (ADR-0014): they are state transitions, and this module is
// now the pure half — the diff itself plus the per-caller wording.

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

export function scrapeErrorMessage(message?: string): string {
  return `${message || "Proses gagal."} Ekspor dan pemeriksaan otomatis dibatalkan. Periksa sesi Coretax dan filter, lalu jalankan ulang.`;
}
