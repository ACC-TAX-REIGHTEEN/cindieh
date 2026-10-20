// ── Main-side result acceptance and invalidation ──────────────
// Acceptance, invalidation and the missing-invoice diff moved to
// run-lifecycle.ts (ADR-0014): they are state transitions, and this module is
// now the pure half — the diff itself plus the per-caller wording.

import type { MessageHandler } from "./postmessage-guard";
import type { ScrapeComplete } from "./scraper-types";
import {
  emptyPeriods,
  failedPeriods,
  finishedPeriods,
  missingPeriods,
  type Sweep,
} from "./sweep";

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

/**
 * The panel line for a chunked transfer that lost a piece (ADR-0017).
 *
 * The count is of MISSING chunks, not rows: nothing reliable is known about how
 * many rows a lost slice held, and a guessed row count would be the same silent
 * short result this notice exists to rule out.
 */
export function incompleteTransferMessage(missingChunks: number): string {
  return (
    `Transfer hasil tidak lengkap: ${missingChunks} bagian data tidak diterima. ` +
    "Coba ekspor kembali."
  );
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

/** How many failed download names the panel lists before summarizing the rest. */
export const MAX_LISTED_FAILED_ITEMS = 8;

/**
 * Panel line naming the individual rows a bulk download could not fetch.
 *
 * The count alone forces the Wajib Paypal to re-run the whole run to find out
 * which files are missing — in a 300-slip withholding batch that is minutes of
 * portal traffic to learn one number. The list is capped so a bad session
 * (every file failing) cannot flood the panel.
 *
 * Returns null when nothing failed or when the producer named nothing: a bare
 * count is still reported by the panel's completion line, so silence here means
 * "no names available", not "no failures".
 */
export function failedItemsNotice(items: readonly string[] | undefined): string | null {
  if (!items?.length) return null;
  const listed = items.slice(0, MAX_LISTED_FAILED_ITEMS).join(", ");
  const rest = items.length - MAX_LISTED_FAILED_ITEMS;
  return `${items.length} file gagal: ${listed}${rest > 0 ? ` (+${rest} lainnya)` : ""}. ` +
    `Berkas lain tetap tersimpan.`;
}

/**
 * The same names, one per line, for the panel's expandable list. Separate from
 * failedItemsNotice so the one-line summary can stay short while the detail
 * block holds the full list.
 */
export function failedItemsDetail(items: readonly string[] | undefined): string {
  if (!items?.length) return "";
  const listed = items.slice(0, MAX_LISTED_FAILED_ITEMS);
  const rest = items.length - listed.length;
  return rest > 0 ? `${listed.join("\n")}\n…dan ${rest} lainnya` : listed.join("\n");
}

/**
 * Panel notice for a run the server says is longer than what we collected.
 *
 * The user already has a file in hand, so the useful thing is to say plainly
 * that it may be short, name both counts, and point at the one action that
 * fixes it (a narrower period filter). `expected` is null only if the portal
 * withheld the count entirely, which is why the fallback phrase exists.
 */
export function truncatedResultNotice(
  collected: number,
  expected: number | null,
): string {
  const target =
    expected === null ? "jumlah yang tidak disebutkan portal" : expected.toLocaleString("id-ID") + " baris";
  return (
    "Data mungkin belum lengkap: terkumpul " +
    collected.toLocaleString("id-ID") +
    " dari " +
    target +
    ". Coretax tampaknya membatasi jumlah baris per halaman, jadi jalankan " +
    "scrape ulang dengan filter masa yang lebih sempit."
  );
}

/**
 * What a batch run reports once it is over.
 *
 * With no usable server-side total, the per-period row counts ARE the
 * completeness evidence, so the panel states them. A period that returned
 * nothing between non-empty neighbours is the finding that can change a
 * filing, so it leads; a period that failed is called out separately, because
 * "no rows" and "could not be fetched" are different problems with different
 * fixes.
 */
export function batchResultNotice(summary: Sweep): string {
  const headline =
    `${summary.counts.length} masa pajak, ${summary.totalRows.toLocaleString("id-ID")} baris`;

  const failed = failedPeriods(summary);
  if (failed.length) {
    return (
      headline +
      ". Masa gagal diambil: " +
      failed.join(", ") +
      ". Coba ekspor kembali."
    );
  }
  const empty = emptyPeriods(summary);
  if (empty.length) {
    return (
      headline +
      ". Masa tanpa baris: " +
      empty.join(", ") +
      " -- periksa di portal apakah ada data di masa tersebut."
    );
  }
  return headline + ".";
}

/**
 * What the panel says when a sweep was stopped and its rows were kept.
 *
 * Four facts, in the order the user needs them: how much of the year arrived,
 * that nothing is running on what did (a stop cancels what the sweep owed),
 * that the rows are still theirs to export, and that the sweep can be RESUMED
 * rather than repeated. The filename sentence is the load-bearing one — a
 * ten-month sweep makes a ten-month file, and the user must not have to infer
 * that from a row count. `exporter.ts` is what actually marks the name; this
 * says so before the file exists, and the resume sentence names the same menu
 * entry the sweep was started from (ADR-0023).
 */
export function stoppedSweepMessage(
  complete: Pick<ScrapeComplete, "total" | "periods">,
): string {
  const rows = `${complete.total.toLocaleString("id-ID")} baris tetap tersimpan`;
  const summary: Sweep | undefined = complete.periods;
  if (!summary) return `Proses dihentikan: ${rows}.`;

  // Finished counts what the sweep actually got; a period that failed is not a
  // month of the year to its reader, so it is named separately rather than
  // folded into the progress fraction.
  const finished = finishedPeriods(summary).length;
  const failed = failedPeriods(summary).length;
  const failures = failed > 0 ? `, ${failed} masa gagal diambil` : "";
  const pending = missingPeriods(summary).length;
  const resume =
    pending > 0
      ? ` Klik "Ekspor 1 Tahun (12 Masa)" lagi untuk melanjutkan ${pending} masa yang belum selesai; masa yang sudah tersimpan tidak akan diambil ulang.`
      : "";

  return (
    `Proses dihentikan: ${finished} dari ${summary.plan.length} masa pajak selesai${failures}, ${rows}. ` +
    "Ekspor otomatis tidak dijalankan; bila data ini diekspor, nama berkasnya ditandai \"sebagian\"." +
    resume
  );
}

/**
 * What the panel says when a resumable sweep was restored after a reload
 * (ADR-0023).
 *
 * It names the same things the sweep itself named — how much of the year survived
 * and how much is left — because a user who refreshed the tab has no other way
 * to learn that the earlier work was not wasted. It does NOT claim anything just
 * happened, and it does not claim anything is running: a restored sweep is only
 * an offer.
 *
 * Two states reach this line, and `partialSweep` is what tells them apart in
 * words: a STOPPED sweep's kept half is still going to be filed as `-sebagian`,
 * while a sweep that FINISHED with a masa the portal failed to deliver was never
 * stopped — its missing month is retried, not continued.
 */
export function restoredSweepMessage(
  rows: number,
  summary: Sweep,
  partialSweep: boolean,
): string {
  const finished = finishedPeriods(summary).length;
  const pending = missingPeriods(summary).length;
  const head =
    "Data ekspor satu tahun dipulihkan setelah halaman dimuat ulang: " +
    `${finished} dari ${summary.plan.length} masa pajak, ${rows.toLocaleString("id-ID")} baris tersimpan. `;

  if (pending === 0) {
    return (
      head +
      (partialSweep
        ? "Ekspor otomatis tidak dijalankan; bila data ini diekspor, nama berkasnya ditandai \"sebagian\"."
        : "Ekspor otomatis tidak dijalankan.")
    );
  }
  if (!partialSweep) {
    return (
      head +
      `Klik "Ekspor 1 Tahun (12 Masa)" untuk mengambil ulang ${pending} masa yang gagal diambil; ` +
      "masa yang sudah tersimpan tidak akan diambil ulang."
    );
  }
  return (
    head +
    `Klik "Ekspor 1 Tahun (12 Masa)" untuk melanjutkan ${pending} masa yang belum selesai; ` +
    "masa yang sudah tersimpan tidak akan diambil ulang."
  );
}

export function scrapeErrorMessage(message?: string): string {
  return `${message || "Proses gagal."} Ekspor dan pemeriksaan otomatis dibatalkan. Periksa sesi Coretax dan filter, lalu jalankan ulang.`;
}
