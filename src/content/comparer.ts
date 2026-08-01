// ============================================================
// COMPARER.TS — Parse pasted Excel data and compare with
// scraped efaktur data (Reference, DPP, PPN).
// ============================================================
// Pure functions — no DOM or browser API dependencies.
// ============================================================

export interface PastedRow {
  reference: string;
  dpp: number;
  ppn: number;
}

export type ComparisonStatus = "COCOK" | "BERBEDA" | "TIDAK_DITEMUKAN";

export interface ComparisonResult {
  reference: string;
  buyerName: string;
  invoiceDate: string;
  buyerTIN: string;
  taxInvoiceNumber: string;
  dppSistem: number | null;
  dppExcel: number;
  ppnSistem: number | null;
  ppnExcel: number;
  status: ComparisonStatus;
}

/**
 * Parse Indonesian number format:
 * - "." is thousands separator → removed
 * - "," is decimal separator → replaced with "."
 *
 * Examples:
 *   "568.000"    → 568000
 *   "1.234,56"   → 1234.56
 *   "162.932"    → 162932
 */
export function parseIndonesianNumber(value: string): number {
  const cleaned = value.trim().replace(/\./g, "").replace(/,/g, ".");
  return parseFloat(cleaned);
}

/**
 * Parse pasted text from Excel (tab-separated: Reference, DPP, PPN).
 * Supports tabs or 2+ spaces as delimiters.
 * Skips empty lines and invalid rows.
 */
export function parsePastedData(text: string): PastedRow[] {
  const lines = text.trim().split(/\n/);
  const results: PastedRow[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Split by any run of whitespace (tabs and/or 2+ spaces).
    // Excel copy-paste can produce mixed delimiters like "  \t" (spaces + tab),
    // so we treat any whitespace run as a single separator to avoid empty tokens.
    const parts = trimmed.split(/\s+/);
    if (parts.length < 3) continue;

    const reference = parts[0].trim();
    if (!reference) continue;

    const dpp = parseIndonesianNumber(parts[1]);
    const ppn = parseIndonesianNumber(parts[2]);

    if (isNaN(dpp) || isNaN(ppn)) continue;

    results.push({ reference, dpp, ppn });
  }

  return results;
}

/**
 * Parse a numeric value from a scraped row field.
 * Handles numbers, strings with Indonesian format, and null/undefined.
 */
export function parseNumericField(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const num = parseIndonesianNumber(value);
    return isNaN(num) ? null : num;
  }
  return null;
}

/**
 * Compare pasted data rows against scraped efaktur data.
 * Matches by the "Reference" field (case-insensitive).
 *
 * @param pastedRows  - Data parsed from user's Excel paste
 * @param scrapedData - Data from the scraped API response
 * @returns Array of comparison results
 */
export function compareData(
  pastedRows: PastedRow[],
  scrapedData: Record<string, unknown>[],
): ComparisonResult[] {
  const results: ComparisonResult[] = [];

  for (const row of pastedRows) {
    const refLower = row.reference.toLowerCase();

    const scrapedRow = scrapedData.find(
      (s) => String(s.Reference || "").trim().toLowerCase() === refLower,
    );

    if (!scrapedRow) {
      results.push({
        reference: row.reference,
        buyerName: "",
        invoiceDate: "",
        buyerTIN: "",
        taxInvoiceNumber: "",
        dppSistem: null,
        dppExcel: row.dpp,
        ppnSistem: null,
        ppnExcel: row.ppn,
        status: "TIDAK_DITEMUKAN",
      });
      continue;
    }

    const dppSistem = parseNumericField(scrapedRow.SellingPrice);
    const ppnSistem = parseNumericField(scrapedRow.VAT);

    // Allow 1-unit tolerance for rounding differences
    const dppMatch = dppSistem !== null && Math.abs(dppSistem - row.dpp) < 1;
    const ppnMatch = ppnSistem !== null && Math.abs(ppnSistem - row.ppn) < 1;

    results.push({
      reference: row.reference,
      buyerName: String(scrapedRow.BuyerName || ""),
      invoiceDate: String(scrapedRow.TaxInvoiceDate || ""),
      buyerTIN: String(scrapedRow.BuyerTIN || ""),
      taxInvoiceNumber: String(scrapedRow.TaxInvoiceNumber || ""),
      dppSistem,
      dppExcel: row.dpp,
      ppnSistem,
      ppnExcel: row.ppn,
      status: dppMatch && ppnMatch ? "COCOK" : "BERBEDA",
    });
  }

  return results;
}