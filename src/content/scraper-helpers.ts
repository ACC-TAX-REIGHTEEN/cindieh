// ============================================================
// SCRAPER-HELPERS.TS — Pure helper functions for scraper
// ============================================================
// Extracted from scraper.ts for testability.
// No DOM or browser API dependencies.
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
 * Generate a deduplication key for a data row.
 * Uses RecordId, AggregateIdentifier, or a deterministic JSON fallback.
 *
 * The JSON fallback sorts object keys so that two rows with identical
 * field values but different key ordering produce the SAME key
 * (preventing missed deduplication). If a row is not a plain object,
 * it is stringified directly.
 */
export function getRowDedupeKey(row: Record<string, unknown>): string {
  const id = row.RecordId || row.AggregateIdentifier;
  if (id) return String(id);
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
 * @param allData  Accumulated rows (mutated in place, then returned).
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
