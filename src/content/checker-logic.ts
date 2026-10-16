// ============================================================
// CHECKER-LOGIC.TS — Pure calculation & decision logic for the
// DPP, DPP Nilai Lain and PPN accuracy check, on any grid whose rows
// carry those three amounts (the four e-Faktur PPN grids, ADR-0024)
// ============================================================

import { parseNumericField } from "./comparer";
import { formatDate } from "./tax-date";
import {
  BENCHMARK_TYPES,
  CHECKER_STATUSES,
  DEFAULT_CHECKER_DEFAULTS,
  type BenchmarkType,
  type CheckerDefaults,
} from "../shared/extension-preferences";

// The benchmark list and the type are the PREFERENCE schema's, because a
// stored value has to be normalized before it reaches this module and the
// normalizer may not import it back. Re-exported here so the domain's own
// importers keep one obvious place to get it from.
export type { BenchmarkType };
export { BENCHMARK_TYPES, CHECKER_STATUSES };

// ── Tax policy, in one place ──────────────────────────────
// The arithmetic below is Indonesian VAT: PPN is 11% of DPP, and DPP is 12/11
// of DPP Nilai Lain (the "nilai lain" base is 11/12 of DPP). Both facts are
// expressed as whole-number fractions on purpose.
//
// WHY THEY ARE NAMED: the audit found these numbers hardcoded across five
// branches — (dpp * 11) / 12, dpp * 0.11, dppNL * 0.12, ppn / 0.11, ppn / 0.12 —
// and pinned in the tests at those same literals. If the rate or the fraction
// ever moved, every row would silently be reported "Berbeda" with no test
// failing first. Deriving all five expressions from ONE rate makes that a single
// edit here, and keeps the rounding on integer fractions rather than drifting
// through the 0.11 representation.
export const PPN_RATE_PERCENT = 11;

/** DPP = DPP Nilai Lain x 12/11, so the "nilai lain" base is 11/12 of DPP. */
export const DPP_NILAI_LAIN_NUMERATOR = 11;
export const DPP_NILAI_LAIN_DENOMINATOR = 12;

/** Derived from the rate so the two can never disagree. */
export const PPN_RATE = PPN_RATE_PERCENT / 100;

/**
 * PPN on a DPP Nilai Lain base. Derived from the DPP rate and the fraction
 * rather than written as "12%": DPP = 12/11 x DPP Nilai Lain, so the same tax
 * on the smaller base is PPN_RATE / (11/12) — which is 12% today, but stays
 * correct if either the rate or the fraction moves. Writing it as
 * `PPN_RATE_PERCENT + 1` produced the same number by coincidence and would have
 * silently diverged the moment either input changed.
 */
export const PPN_RATE_ON_NILAI_LAIN =
  (PPN_RATE_PERCENT * DPP_NILAI_LAIN_DENOMINATOR) /
  (DPP_NILAI_LAIN_NUMERATOR * 100);

export interface CheckResult {
  taxInvoiceNumber: string;
  /**
   * The NO RETUR of the retur nota this row is, or "" on a grid whose rows are
   * invoices. It is what names the row on the two Retur PPN grids, where there
   * is no Referensi to read (page-context.checkerRowIdentity) — carried here
   * rather than looked up again at render time so the table and the export can
   * never disagree about which field identifies a row.
   */
  returnNumber: string;
  invoiceDate: string;
  /**
   * The retur nota's own date, or "" on an invoice grid. The date that belongs
   * with `returnNumber`: on a retur grid the invoice date is still present (the
   * row names the invoice it returns), so the two are separate facts rather
   * than one chain.
   */
  returnDate: string;
  /**
   * The other party on the invoice, whatever side of the transaction they sit
   * on: on PPN Keluaran that is the buyer, on PPN Masukan the seller. The
   * checker works per row and never matches across rows, so which side it is
   * changes only the column label, never the arithmetic.
   */
  counterpartyName: string;
  counterpartyTIN: string;
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
 * Seed the session from the popup's stored Checker defaults.
 *
 * The mirror of applyComparerDefaults: the panel owns these three controls for
 * the life of the modal, and re-injecting the modal must not lose them, so the
 * defaults are applied while it is built rather than fetched later. An empty
 * stored filter means "all statuses", which is also what applyCheckerFilter
 * does with an empty set — so it needs no special case here.
 */
export function applyCheckerDefaults(
  session: CheckerSession,
  defaults: CheckerDefaults,
): void {
  session.benchmark = defaults.benchmark || DEFAULT_CHECKER_DEFAULTS.benchmark;
  session.tolerance = defaults.tolerance;
  session.statusFilter = CHECKER_STATUSES.filter((status) =>
    defaults.statusFilter.includes(status),
  );
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
      dppNilaiLainExpected = Math.round(
        (dppSystem * DPP_NILAI_LAIN_NUMERATOR) / DPP_NILAI_LAIN_DENOMINATOR,
      );
      ppnExpected = Math.round(dppSystem * PPN_RATE);

      dppNilaiLainMismatch = Math.abs(dppNilaiLainSystem - dppNilaiLainExpected) > tolerance;
      ppnMismatch = Math.abs(ppnSystem - ppnExpected) > tolerance;
    } else if (benchmark === "DPP_NILAI_LAIN") {
      dppNilaiLainExpected = dppNilaiLainSystem;
      dppExpected = Math.round(
        (dppNilaiLainSystem * DPP_NILAI_LAIN_DENOMINATOR) / DPP_NILAI_LAIN_NUMERATOR,
      );
      ppnExpected = Math.round(dppNilaiLainSystem * PPN_RATE_ON_NILAI_LAIN);

      dppMismatch = Math.abs(dppSystem - dppExpected) > tolerance;
      ppnMismatch = Math.abs(ppnSystem - ppnExpected) > tolerance;
    } else {
      // benchmark === "PPN"
      ppnExpected = ppnSystem;
      dppExpected = Math.round(ppnSystem / PPN_RATE);
      dppNilaiLainExpected = Math.round(ppnSystem / PPN_RATE_ON_NILAI_LAIN);

      dppMismatch = Math.abs(dppSystem - dppExpected) > tolerance;
      dppNilaiLainMismatch = Math.abs(dppNilaiLainSystem - dppNilaiLainExpected) > tolerance;
    }
  }

  // ── OtherTaxBase = 0: DPP Nilai Lain does not apply to this row ──
  // The portal records rows whose DPP and PPN are complete and correct but
  // whose DPP Nilai Lain is plain 0 (see the live-parse fixtures in
  // exporter.processdata.unit.test.ts: DPP 100, DPP NL 0, VAT 11). Such a row
  // does not apply DPP Nilai Lain at all, so a derived expectation
  // (11/12 × DPP) is not evidence of an error — reporting every such row as
  // "DPP NL Berbeda" washed the real findings in noise (audit 2026-09-24,
  // findings §3). Drop the comparison; its diff stays null so the grid and
  // the export render "-" for it.
  //
  // Exempted only where the expected value was DERIVED from another acuan
  // (benchmarks DPP and PPN). Under the DPP Nilai Lain benchmark the 0 IS the
  // acuan the user chose, so what is derived from it is left as computed.
  const nilaiLainNotApplicable =
    dppNilaiLainSystem === 0 && benchmark !== "DPP_NILAI_LAIN";
  if (nilaiLainNotApplicable) {
    dppNilaiLainMismatch = false;
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

  // The row's own document: an invoice carries its invoice date, a retur nota
  // its retur date, and each is read for the grid that shows it. Two fields
  // rather than one chain, because a retur row has BOTH (it names the invoice
  // it returns), so a chain could only ever pick one of the two.
  const rawDate = row.TaxInvoiceDate || row.DocumentDate || row.Date || "";
  const invoiceDate = formatDate(rawDate);
  const returnDate = formatDate(row.ReturnDate || "");

  // Counterparty resolution is source-agnostic: a PPN Keluaran row never
  // carries SellerTaxpayerName and a PPN Masukan row never carries BuyerName, so
  // one chain serves both. The export-spec column lists are the authority on
  // which spelling each grid sends.
  const counterpartyName = String(
    row.BuyerName ||
      row.BuyerTaxpayerNameClear ||
      row.BuyerTaxpayerName ||
      row.SellerTaxpayerName ||
      row.SellerTaxpayerNameClear ||
      row.SellerName ||
      "",
  );
  const counterpartyTIN = String(
    row.BuyerTIN || row.BuyerTin || row.SellerTIN || row.SellerTin || "",
  );

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
    returnNumber: String(row.ReturnNumber || ""),
    invoiceDate,
    returnDate,
    counterpartyName,
    counterpartyTIN,
    reference: String(row.Reference || ""),

    dppSystem,
    dppNilaiLainSystem,
    ppnSystem,

    dppExpected,
    dppNilaiLainExpected,
    ppnExpected,

    dppDiff: dppSystem !== null && dppExpected !== null ? dppSystem - dppExpected : null,
    dppNilaiLainDiff:
      nilaiLainNotApplicable ||
      dppNilaiLainSystem === null ||
      dppNilaiLainExpected === null
        ? null
        : dppNilaiLainSystem - dppNilaiLainExpected,
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
