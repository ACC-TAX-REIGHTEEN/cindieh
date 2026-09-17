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

  dppSystem: number | null;
  dppNilaiLainSystem: number | null;
  ppnSystem: number | null;

  dppExpected: number | null;
  dppNilaiLainExpected: number | null;
  ppnExpected: number | null;

  dppDiff: number | null;
  dppNilaiLainDiff: number | null;
  ppnDiff: number | null;

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
 * Returns a mismatch or "Data tidak lengkap" result; null means verified accurate.
 * Missing/invalid values remain null. Incomplete rows have no expected values or diffs.
 */
export function checkRowAccuracy(
  row: Record<string, unknown>,
  benchmark: BenchmarkType,
  tolerance = 0,
): CheckResult | null {
  const dppSystem = parseNumericField(row.SellingPrice);
  const dppNilaiLainSystem = parseNumericField(row.OtherTaxBase);
  const ppnSystem = parseNumericField(row.VAT);

  let dppExpected: number | null = null;
  let dppNilaiLainExpected: number | null = null;
  let ppnExpected: number | null = null;

  let dppMismatch = false;
  let dppNilaiLainMismatch = false;
  let ppnMismatch = false;

  if (dppSystem !== null && dppNilaiLainSystem !== null && ppnSystem !== null &&
      Number.isFinite(tolerance) && tolerance >= 0) {
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
  }

  const incomplete = dppSystem === null || dppNilaiLainSystem === null || ppnSystem === null ||
    dppExpected === null || dppNilaiLainExpected === null || ppnExpected === null ||
    ![dppExpected, dppNilaiLainExpected, ppnExpected,
      dppSystem - dppExpected, dppNilaiLainSystem - dppNilaiLainExpected, ppnSystem - ppnExpected]
      .every(Number.isFinite);
  if (incomplete) {
    dppExpected = dppNilaiLainExpected = ppnExpected = null;
  }

  if (!incomplete && !dppMismatch && !dppNilaiLainMismatch && !ppnMismatch) {
    return null;
  }

  let status = "";
  if (incomplete) {
    status = "Data tidak lengkap";
  } else if (benchmark === "DPP") {
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

    dppDiff: dppSystem !== null && dppExpected !== null ? dppSystem - dppExpected : null,
    dppNilaiLainDiff: dppNilaiLainSystem !== null && dppNilaiLainExpected !== null ? dppNilaiLainSystem - dppNilaiLainExpected : null,
    ppnDiff: ppnSystem !== null && ppnExpected !== null ? ppnSystem - ppnExpected : null,

    tolerance,
    benchmark,
    status,
  };
}

/**
 * Check all scraped rows. Returns mismatched and incomplete rows, never verified matches.
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
    if (set.has("DATA_TIDAK_LENGKAP") && r.status === "Data tidak lengkap") return true;
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
  const incomplete = results.filter((r) => r.status === "Data tidak lengkap").length;
  if (incomplete > 0) {
    const mismatched = results.length - incomplete;
    return `Ditemukan ${mismatched.toLocaleString("id-ID")} faktur dengan nilai tidak sesuai dan ${incomplete.toLocaleString("id-ID")} faktur dengan data tidak lengkap.`;
  }
  return `Ditemukan ${results.length.toLocaleString("id-ID")} faktur dengan nilai tidak sesuai.`;
}
