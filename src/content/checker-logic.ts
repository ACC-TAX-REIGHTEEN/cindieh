// ============================================================
// CHECKER-LOGIC.TS — Pure calculation & decision logic for
// DPP, DPP Nilai Lain, and PPN accuracy check in PPN Keluaran
// ============================================================

import { parseNumericField } from "./comparer";
import { formatDate } from "./tax-date";

export type BenchmarkType = "DPP" | "DPP_NILAI_LAIN" | "PPN";

export interface CheckResult {
  taxInvoiceNumber: string;
  invoiceDate: string;
  buyerName: string;
  buyerTIN: string;
  reference: string;

  dppSystem: number;
  dppNilaiLainSystem: number;
  ppnSystem: number;

  dppExpected: number;
  dppNilaiLainExpected: number;
  ppnExpected: number;

  dppDiff: number;
  dppNilaiLainDiff: number;
  ppnDiff: number;

  tolerance: number;
  benchmark: BenchmarkType;
  status: string;
}

export interface CheckerSession {
  benchmark: BenchmarkType;
  tolerance: number;
  results: CheckResult[];
  statusFilter: string[];
  currentPage: number;
  viewedRefs: Set<string>;
}

export function createCheckerSession(): CheckerSession {
  return {
    benchmark: "DPP",
    tolerance: 0,
    results: [],
    statusFilter: [],
    currentPage: 1,
    viewedRefs: new Set<string>(),
  };
}

/**
 * Check accuracy of DPP, DPP Nilai Lain, and PPN for a single scraped row.
 * Returns CheckResult if any checked field differs beyond tolerance, or null if accurate.
 */
export function checkRowAccuracy(
  row: Record<string, unknown>,
  benchmark: BenchmarkType,
  tolerance = 0,
): CheckResult | null {
  const dppSystem = parseNumericField(row.SellingPrice) ?? 0;
  const dppNilaiLainSystem = parseNumericField(row.OtherTaxBase) ?? 0;
  const ppnSystem = parseNumericField(row.VAT) ?? 0;

  let dppExpected = dppSystem;
  let dppNilaiLainExpected = dppNilaiLainSystem;
  let ppnExpected = ppnSystem;

  let dppMismatch = false;
  let dppNilaiLainMismatch = false;
  let ppnMismatch = false;

  if (benchmark === "DPP") {
    dppExpected = dppSystem;
    dppNilaiLainExpected = Math.round((dppSystem * 11) / 12);
    ppnExpected = Math.round(dppSystem * 0.11);

    dppNilaiLainMismatch = Math.abs(dppNilaiLainSystem - dppNilaiLainExpected) > tolerance;
    ppnMismatch = Math.abs(ppnSystem - ppnExpected) > tolerance;
  } else if (benchmark === "DPP_NILAI_LAIN") {
    dppNilaiLainExpected = dppNilaiLainSystem;
    dppExpected = Math.round((dppNilaiLainSystem * 12) / 11);
    ppnExpected = Math.round(dppNilaiLainSystem * 0.12);

    dppMismatch = Math.abs(dppSystem - dppExpected) > tolerance;
    ppnMismatch = Math.abs(ppnSystem - ppnExpected) > tolerance;
  } else {
    // benchmark === "PPN"
    ppnExpected = ppnSystem;
    dppExpected = Math.round(ppnSystem / 0.11);
    dppNilaiLainExpected = Math.round(ppnSystem / 0.12);

    dppMismatch = Math.abs(dppSystem - dppExpected) > tolerance;
    dppNilaiLainMismatch = Math.abs(dppNilaiLainSystem - dppNilaiLainExpected) > tolerance;
  }

  if (!dppMismatch && !dppNilaiLainMismatch && !ppnMismatch) {
    return null;
  }

  let status = "";
  if (benchmark === "DPP") {
    if (dppNilaiLainMismatch && ppnMismatch) {
      status = "DPP NL & PPN Berbeda";
    } else if (dppNilaiLainMismatch) {
      status = "DPP NL Berbeda";
    } else {
      status = "PPN Berbeda";
    }
  } else if (benchmark === "DPP_NILAI_LAIN") {
    if (dppMismatch && ppnMismatch) {
      status = "DPP & PPN Berbeda";
    } else if (dppMismatch) {
      status = "DPP Berbeda";
    } else {
      status = "PPN Berbeda";
    }
  } else {
    if (dppMismatch && dppNilaiLainMismatch) {
      status = "DPP & DPP NL Berbeda";
    } else if (dppMismatch) {
      status = "DPP Berbeda";
    } else {
      status = "DPP NL Berbeda";
    }
  }

  const rawDate = row.TaxInvoiceDate || row.DocumentDate || row.Date || "";
  const invoiceDate = formatDate(rawDate);

  const taxInvoiceNumber = String(
    row.TaxInvoiceNumber ||
      row.LetterNumber ||
      row.DocumentNumber ||
      row.ReturnInvoiceNumber ||
      row.InvoiceNumber ||
      ""
  );

  return {
    taxInvoiceNumber,
    invoiceDate,
    buyerName: String(row.BuyerName || row.BuyerTaxpayerNameClear || row.BuyerTaxpayerName || ""),
    buyerTIN: String(row.BuyerTIN || row.BuyerTin || ""),
    reference: String(row.Reference || ""),

    dppSystem,
    dppNilaiLainSystem,
    ppnSystem,

    dppExpected,
    dppNilaiLainExpected,
    ppnExpected,

    dppDiff: dppSystem - dppExpected,
    dppNilaiLainDiff: dppNilaiLainSystem - dppNilaiLainExpected,
    ppnDiff: ppnSystem - ppnExpected,

    tolerance,
    benchmark,
    status,
  };
}

/**
 * Check accuracy across all scraped rows. Returns only mismatched rows beyond tolerance.
 */
export function checkAllRowsAccuracy(
  scrapedData: Record<string, unknown>[],
  benchmark: BenchmarkType,
  tolerance = 0,
): CheckResult[] {
  const results: CheckResult[] = [];
  for (const row of scrapedData) {
    const res = checkRowAccuracy(row, benchmark, tolerance);
    if (res) {
      results.push(res);
    }
  }
  return results;
}

/**
 * Filter check results by selected status filters.
 * Empty statusFilter or containing "ALL" returns all results.
 */
export function applyCheckerStatusFilter(
  results: CheckResult[],
  statusFilter: string[],
): CheckResult[] {
  if (statusFilter.length === 0 || statusFilter.includes("ALL")) {
    return results;
  }
  const set = new Set(statusFilter);
  return results.filter((r) => {
    if (set.has("DPP_BERBEDA") && r.status === "DPP Berbeda") return true;
    if (set.has("DPP_NILAI_LAIN_BERBEDA") && r.status === "DPP NL Berbeda") return true;
    if (set.has("PPN_BERBEDA") && r.status === "PPN Berbeda") return true;
    if (set.has("DUA_BERBEDA") && r.status.includes("&")) return true;
    return false;
  });
}

export function formatCheckSummary(results: CheckResult[]): string {
  if (results.length === 0) {
    return "Semua faktur sesuai.";
  }
  return `Ditemukan ${results.length.toLocaleString("id-ID")} faktur dengan nilai tidak sesuai.`;
}
