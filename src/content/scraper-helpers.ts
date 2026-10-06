// ============================================================
// SCRAPER-HELPERS.TS — Pure helper functions for scraper
// ============================================================
// Extracted from scraper.ts for testability.
// No DOM or browser API dependencies.

import type { ExportSource } from "./page-context";
// ============================================================

/**
 * Build the download PDF URL for efaktur pages.
 * API: einvoiceportal/api/DownloadInvoice/download-invoice-document
 */
export function buildEfakturDownloadUrl(capturedUrl: string): string {
  // Extract base: everything up to einvoiceportal/api/
  const baseMatch = capturedUrl.match(/(.*einvoiceportal\/api\/)/i);
  if (baseMatch) {
    return baseMatch[1] + "DownloadInvoice/download-invoice-document";
  }

  // Fallback: try to construct from origin + known path
  const originMatch = capturedUrl.match(/^(https?:\/\/[^/]+)/i);
  if (originMatch) {
    return originMatch[1] + "/einvoiceportal/api/DownloadInvoice/download-invoice-document";
  }

  return capturedUrl;
}

/**
 * Build the request body for efaktur PDF download.
 */
export function buildEfakturPdfBody(
  row: Record<string, unknown>,
  source: string,
  capturedBody: Record<string, unknown>,
): Record<string, unknown> {
  const menuType =
    source === "OUTPUT_TAX"
      ? "Outgoing"
      : source === "OUTPUT_RETURN"
        ? "OutgoingReturn"
        : source === "INPUT_TAX"
          ? "Input"
          : source === "INPUT_RETURN"
            ? "InputReturn"
            : "Incoming";

  return {
    EInvoiceRecordIdentifier: row.EInvoiceRecordIdentifier || row.RecordId || "",
    EInvoiceAggregateIdentifier: row.EInvoiceAggregateIdentifier || row.AggregateIdentifier || "",
    DocumentAggregateIdentifier:
      row.DocumentFormAggregateIdentifier ||
      row.DocumentAggregateIdentifier ||
      capturedBody.DocumentAggregateIdentifier ||
      "",
    TaxpayerAggregateIdentifier: row.TaxpayerAggregateIdentifier || capturedBody.TaxpayerAggregateIdentifier || "",
    LetterNumber: row.LetterNumber || row.TaxInvoiceNumber || "",
    DocumentDate: row.DocumentDate || row.TaxInvoiceDate || "",
    EInvoiceMenuType: menuType,
    TaxInvoiceStatus: row.TaxInvoiceStatus || "",
  };
}

/**
 * The identity fields the portal gives a row, in the order they are trusted.
 *
 * These are the portal's own per-row identifiers. Invoice numbers are
 * deliberately NOT here: on PPN Masukan the Referensi belongs to the SELLER and
 * repeats across one taxpayer's invoices, so treating it as an identity would
 * merge rows that are genuinely different. A grid carrying neither id falls
 * back to the whole row rather than guessing an identity for it.
 */
const DEDUPE_ID_FIELDS = ["RecordId", "AggregateIdentifier"] as const;

/**
 * Generate a deduplication key for a data row.
 *
 * Two properties make the key STABLE across the pages of one run:
 *
 * - Presence is tested with `undefined`/`null`/`""`, not truthiness. `0` is a
 *   legal RecordId, and `||` skipped it, so such a row fell through to the
 *   whole-row fallback and could not be recognised as the row it already was.
 * - The key names WHICH identity space the value came from. RecordId and
 *   AggregateIdentifier are separate counters on the portal, and the bare
 *   `"5"` they used to produce could collide across the two — one row's id
 *   swallowing an unrelated row's.
 *
 * The JSON fallback sorts object keys so that two rows with identical field
 * values but different key ordering produce the SAME key (preventing missed
 * deduplication). If a row is not a plain object, it is stringified directly.
 */
export function getRowDedupeKey(row: Record<string, unknown>): string {
  for (const field of DEDUPE_ID_FIELDS) {
    const value = row[field];
    if (value === undefined || value === null || value === "") continue;
    return `${field}:${String(value)}`;
  }
  return stableStringify(row);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/**
 * Merge new rows into an existing dataset with deduplication.
 *
 * Pure function extracted from the scraping loops so it can be unit-tested
 * without a live XHR/portal. Rows already present (by dedupe key) are skipped;
 * new rows are appended to `allData` and their keys recorded in `seen`.
 *
 * @param allData  Accumulated rows (mutated in place; the return value is `added`).
 * @param seen     Set of already-seen dedupe keys (mutated in place).
 * @param rows     New rows from the current page/request.
 * @returns        The rows that were actually added (newRows).
 */
export function mergeRows(
  allData: Record<string, unknown>[],
  seen: Set<string>,
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  const added: Record<string, unknown>[] = [];
  for (const row of rows) {
    const key = getRowDedupeKey(row);
    if (!seen.has(key)) {
      seen.add(key);
      allData.push(row);
      added.push(row);
    }
  }
  return added;
}

/** Shown for a row that carries none of the identifiers below. */
export const UNIDENTIFIED_PDF_ITEM = "(tanpa identitas)";

/**
 * The name a bulk-download row is reported under — both in the progress line
 * while the run is in flight, and in the failure list afterwards.
 *
 * Download order is the only thing that ties a failure back to a row once the
 * run is over, so a run that reports "4 gagal" has to be able to say WHICH four.
 * The ladders mirror the two shapes the PDF filename builder already walks
 * (downloader.ts): a Bukti Potong slip is identified by its slip number, which
 * arrives under two spellings depending on which flow captured it (see
 * export-source.ts), and an e-faktur row by its Referensi — the same token the
 * generated filename starts with, so the panel and the downloads folder agree.
 */
export function describePdfItem(
  row: Record<string, unknown>,
  source: ExportSource,
): string {
  const text = (value: unknown): string => String(value ?? "").trim();
  const candidates =
    source === "WITHHOLDING_SLIPS"
      ? [row.WithholdingSlipNumber, row.WithholdingSlipsNumber, row.DocumentNumber]
      : [row.Reference, row.TaxInvoiceNumber, row.LetterNumber, row.ReturnNumber];
  for (const candidate of candidates) {
    const label = text(candidate);
    if (label) return label;
  }
  return UNIDENTIFIED_PDF_ITEM;
}

/**
 * Collect the union of all field names across the dataset.
 * Pure helper extracted from the scraping loops.
 */
export function collectFields(data: Record<string, unknown>[]): string[] {
  const fieldSet = new Set<string>();
  for (const row of data) {
    for (const k of Object.keys(row)) fieldSet.add(k);
  }
  return [...fieldSet];
}
