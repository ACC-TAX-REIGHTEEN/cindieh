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
  const menuType = source === "OUTPUT_TAX" || source === "OUTPUT_RETURN" ? "Outgoing" : "Incoming";

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
 * Uses RecordId, AggregateIdentifier, or JSON fallback.
 */
export function getRowDedupeKey(row: Record<string, unknown>): string {
  return (row.RecordId as string) || (row.AggregateIdentifier as string) || JSON.stringify(row);
}
