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
  state.lastState = { type: "SCRAPE_ERROR", message };
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
