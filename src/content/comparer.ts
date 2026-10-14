// ============================================================
// COMPARER.TS — Parse pasted Excel data and compare with
// scraped efaktur data (Reference, DPP, PPN).
// ============================================================
// Pure functions — no DOM or browser API dependencies.
// ============================================================

import { extractYMD } from "./tax-date";

export interface PastedRow {
  reference: string;
  refLain: string;
  dpp: number;
  ppn: number;
}

export type ComparisonStatus =
  | "COCOK"
  | "DPP_BERBEDA"
  | "PPN_BERBEDA"
  | "BERBEDA"
  | "TIDAK_DITEMUKAN"
  | "HANYA_CORETAX";

export interface ComparisonResult {
  reference: string;
  refLain: string;
  buyerName: string;
  invoiceDate: string;
  buyerTIN: string;
  taxInvoiceNumber: string;
  dppSistem: number | null;
  dppExcel: number | null;
  ppnSistem: number | null;
  ppnExcel: number | null;
  ppnSelisih: number | null;
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
  const trimmed = value.trim();
  if (!/^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/.test(trimmed)) return NaN;
  const num = Number(trimmed.replace(/\./g, "").replace(/,/g, "."));
  return Number.isFinite(num) ? num : NaN;
}

/**
 * Parse pasted text from Excel.
 *
 * When refLain mode is enabled (4 columns):
 *   Reference, Referensi Lain, DPP, PPN
 *
 * When refLain mode is disabled (3 columns):
 *   Reference, DPP, PPN
 *
 * Supports tabs or 2+ spaces as delimiters.
 * Skips empty lines and invalid rows.
 */
export function parsePastedData(text: string, refLainMode = false): PastedRow[] {
  const lines = text.split(/\r?\n/);
  const results: PastedRow[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // TSV cell boundaries must survive trimming, including empty edge cells.
    // Only non-TSV rows use the legacy multiple-space delimiter.
    const parts = line.includes("\t") ? line.split("\t") : trimmed.split(/ {2,}/);
    if (refLainMode) {
      if (parts.length < 4) continue;
      const reference = parts[0].trim();
      if (!reference) continue;
      const refLain = parts[1].trim();
      const dpp = parseIndonesianNumber(parts[2]);
      const ppn = parseIndonesianNumber(parts[3]);
      if (isNaN(dpp) || isNaN(ppn)) continue;
      results.push({ reference, refLain, dpp, ppn });
    } else {
      if (parts.length < 3) continue;
      const reference = parts[0].trim();
      if (!reference) continue;
      const dpp = parseIndonesianNumber(parts[1]);
      const ppn = parseIndonesianNumber(parts[2]);
      if (isNaN(dpp) || isNaN(ppn)) continue;
      results.push({ reference, refLain: "", dpp, ppn });
    }
  }

  return results;
}

/**
 * Parse a numeric value from a scraped row field.
 * Handles numbers, strings with Indonesian format, and null/undefined.
 */
export function parseNumericField(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const num = parseIndonesianNumber(value);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

/**
 * Extract the day-of-month (1-31) from a date value (e.g. "2026-07-01T...").
 * Returns null when no valid day is found.
 */
export function extractDayFromDate(value: unknown): number | null {
  const ymd = extractYMD(value);
  if (!ymd) return null;
  const day = parseInt(ymd.day, 10);
  return day >= 1 && day <= 31 ? day : null;
}
/**
 * Compare pasted data rows against scraped efaktur data.
 * Matches by the "Reference" field (case-insensitive).
 *
 * Status logic:
 * - COCOK: both DPP and PPN match within tolerance
 * - DPP_BERBEDA: only DPP differs, PPN matches
 * - PPN_BERBEDA: only PPN differs, DPP matches
 * - BERBEDA: both DPP and PPN differ
 * - TIDAK_DITEMUKAN: reference not found in scraped data
 * - HANYA_CORETAX: (daily mode) exists in coretax on the given dates but
 *   was not pasted by the user
 *
 * @param pastedRows  - Data parsed from user's Excel paste
 * @param scrapedData - Data from the scraped API response
 * @param tolerance   - Allowed absolute difference (default 0)
 * @param dailyDates  - Day-of-month numbers (1-31) to also check in reverse
 *                      (coretax rows on these dates not in excel). Null disables.
 * @returns Array of comparison results
 */
export function compareData(
  pastedRows: PastedRow[],
  scrapedData: Record<string, unknown>[],
  tolerance = 0,
  dailyDates: number[] | null = null,
): ComparisonResult[] {
  const results: ComparisonResult[] = [];
  const pastedRefs = new Set(pastedRows.map((r) => r.reference.toLowerCase()));

  // ONE pass over the grid builds the lookup, so each pasted row costs a Map hit
  // instead of a scan of every scraped row. The scan was quadratic in the two
  // sizes that matter together: the comparer reads whatever the Run collected,
  // and the year-wide sweep collects ~180k rows for a large taxpayer (44,237
  // across three periods, measured on the portal). Measured against 180k rows,
  // 2,000 pasted rows cost ~3 s when the references exist and ~14 s when most do
  // not, with the panel frozen for the whole of it.
  //
  // First row wins, and an empty key is skipped. Both rules keep the answers
  // byte for byte identical to the scan this replaced: `find` returned the first
  // row whose normalized Reference matched, and a pasted reference is never
  // empty (parsePastedData drops those rows before they get here), so `""` could
  // never be the value being matched.
  const scrapedByReference = new Map<string, Record<string, unknown>>();
  for (const scraped of scrapedData) {
    const key = String(scraped.Reference || "").trim().toLowerCase();
    if (!key || scrapedByReference.has(key)) continue;
    scrapedByReference.set(key, scraped);
  }

  for (const row of pastedRows) {
    const refLower = row.reference.toLowerCase();

    const scrapedRow = scrapedByReference.get(refLower);

    if (!scrapedRow) {
      results.push({
        reference: row.reference,
        refLain: row.refLain,
        buyerName: "",
        invoiceDate: "",
        buyerTIN: "",
        taxInvoiceNumber: "",
        dppSistem: null,
        dppExcel: row.dpp,
        ppnSistem: null,
        ppnExcel: row.ppn,
        ppnSelisih: null,
        status: "TIDAK_DITEMUKAN",
      });
      continue;
    }

    const dppSistem = parseNumericField(scrapedRow.SellingPrice);
    const ppnSistem = parseNumericField(scrapedRow.VAT);

    const dppMatch = dppSistem !== null && Math.abs(dppSistem - row.dpp) <= tolerance;
    const ppnMatch = ppnSistem !== null && Math.abs(ppnSistem - row.ppn) <= tolerance;

    let status: ComparisonStatus;
    if (dppMatch && ppnMatch) {
      status = "COCOK";
    } else if (!dppMatch && !ppnMatch) {
      status = "BERBEDA";
    } else if (!dppMatch) {
      status = "DPP_BERBEDA";
    } else {
      status = "PPN_BERBEDA";
    }

    results.push({
      reference: row.reference,
      refLain: row.refLain,
      buyerName: String(scrapedRow.BuyerName || ""),
      invoiceDate: String(scrapedRow.TaxInvoiceDate || ""),
      buyerTIN: String(scrapedRow.BuyerTIN || ""),
      taxInvoiceNumber: String(scrapedRow.TaxInvoiceNumber || ""),
      dppSistem,
      dppExcel: row.dpp,
      ppnSistem,
      ppnExcel: row.ppn,
      ppnSelisih: ppnSistem !== null ? ppnSistem - row.ppn : null,
      status,
    });
  }

  // Daily mode: include coretax rows on the given dates that were not pasted.
  if (dailyDates && dailyDates.length > 0) {
    const dateSet = new Set(dailyDates);
    for (const s of scrapedData) {
      const ref = String(s.Reference || "").trim();
      if (!ref) continue;
      if (pastedRefs.has(ref.toLowerCase())) continue;

      const day = extractDayFromDate(s.TaxInvoiceDate);
      if (day !== null && dateSet.has(day)) {
        results.push({
          reference: ref,
          refLain: "",
          buyerName: String(s.BuyerName || ""),
          invoiceDate: String(s.TaxInvoiceDate || ""),
          buyerTIN: String(s.BuyerTIN || ""),
          taxInvoiceNumber: String(s.TaxInvoiceNumber || ""),
          dppSistem: parseNumericField(s.SellingPrice),
          dppExcel: null,
          ppnSistem: parseNumericField(s.VAT),
          ppnExcel: null,
          ppnSelisih: null,
          status: "HANYA_CORETAX",
        });
      }
    }
  }

  return results;
}