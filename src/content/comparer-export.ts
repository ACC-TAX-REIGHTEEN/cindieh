// Pure result grids for the AOA writer; display formatting never changes values.
import type { ComparisonResult } from "./comparer";
import type { BenchmarkType, CheckResult } from "./checker-logic";
import { COUNTERPARTY_LABEL, type Counterparty } from "./result-columns";

export type ResultExportRows = (string | number | null)[][];

export function buildComparisonExportRows(
  results: readonly ComparisonResult[],
  refLainEnabled: boolean,
): ResultExportRows {
  return [
    [
      "No", "Referensi", ...(refLainEnabled ? ["Referensi Lain"] : []),
      "Nama Pembeli", "Tanggal", "NIK/NPWP", "Nomor Faktur Pajak",
      "DPP Coretax", "DPP Baru", "PPN Coretax", "PPN Baru", "Selisih PPN", "Status",
    ],
    ...results.map((r, idx) => [
      idx + 1, r.reference, ...(refLainEnabled ? [r.refLain] : []),
      r.buyerName, r.invoiceDate, r.buyerTIN, r.taxInvoiceNumber,
      r.dppSistem, r.dppExcel, r.ppnSistem, r.ppnExcel, r.ppnSelisih, r.status,
    ]),
  ];
}

export function buildCheckerExportRows(
  results: readonly CheckResult[],
  benchmark: BenchmarkType,
  counterparty: Counterparty = "pembeli",
): ResultExportRows {
  return [
    [
      "No", "Referensi", "Tanggal",
      `Nama ${COUNTERPARTY_LABEL[counterparty]}`,
      `NPWP/NIK ${COUNTERPARTY_LABEL[counterparty]}`,
      "DPP", "DPP NL", "PPN",
      benchmark === "DPP" ? "Selisih DPP NL" : "Selisih DPP",
      benchmark === "PPN" ? "Selisih DPP NL" : "Selisih PPN",
      "Status",
    ],
    ...results.map((r, idx) => [
      idx + 1, r.reference || r.taxInvoiceNumber, r.invoiceDate,
      r.counterpartyName, r.counterpartyTIN,
      r.dppSystem, r.dppNilaiLainSystem, r.ppnSystem,
      benchmark === "DPP" ? r.dppNilaiLainDiff : r.dppDiff,
      benchmark === "PPN" ? r.dppNilaiLainDiff : r.ppnDiff,
      r.status,
    ]),
  ];
}

// ── Filenames ───────────────────────────────────────────────────
// Both result grids are offered as XLSX and CSV. The base name lives here, not
// in the panel, so the button labels, the generated file, and the microsite
// copy that shows the samples all derive from one place.

export type ResultExportFormat = "xlsx" | "csv";

export const COMPARISON_EXPORT_BASENAME = "perbandingan-faktur";
export const CHECKER_EXPORT_BASENAME = "pengecekan-nilai-faktur";

const EXTENSION: Record<ResultExportFormat, string> = { xlsx: ".xlsx", csv: ".csv" };

/** The full generated filename for one result grid in one format. */
export function resultExportFilename(
  basename: string,
  format: ResultExportFormat,
): string {
  return `${basename}${EXTENSION[format]}`;
}

/** The two button labels, so the panel cannot spell them differently per tab. */
export const RESULT_EXPORT_LABELS: Record<ResultExportFormat, string> = {
  xlsx: "Excel",
  csv: "CSV",
};

export function formatResultNumber(value: number | null): string {
  return value === null ? "-" : value.toLocaleString("id-ID");
}

export function formatResultDifference(value: number | null, tolerance: number): string {
  if (value === null || Math.abs(value) <= tolerance) return "-";
  return (value > 0 ? "+" : "") + formatResultNumber(value);
}
