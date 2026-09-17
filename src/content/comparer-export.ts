// Pure result grids for the AOA writer; display formatting never changes values.
import type { ComparisonResult } from "./comparer";
import type { BenchmarkType, CheckResult } from "./checker-logic";

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
): ResultExportRows {
  return [
    [
      "No", "Referensi", "Tanggal", "Nama Pembeli", "NPWP/NIK Pembeli",
      "DPP", "DPP NL", "PPN",
      benchmark === "DPP" ? "Selisih DPP NL" : "Selisih DPP",
      benchmark === "PPN" ? "Selisih DPP NL" : "Selisih PPN",
      "Status",
    ],
    ...results.map((r, idx) => [
      idx + 1, r.reference || r.taxInvoiceNumber, r.invoiceDate, r.buyerName, r.buyerTIN,
      r.dppSystem, r.dppNilaiLainSystem, r.ppnSystem,
      benchmark === "DPP" ? r.dppNilaiLainDiff : r.dppDiff,
      benchmark === "PPN" ? r.dppNilaiLainDiff : r.ppnDiff,
      r.status,
    ]),
  ];
}

export function formatResultNumber(value: number | null): string {
  return value === null ? "-" : value.toLocaleString("id-ID");
}

export function formatResultDifference(value: number | null, tolerance: number): string {
  if (value === null || Math.abs(value) <= tolerance) return "-";
  return (value > 0 ? "+" : "") + formatResultNumber(value);
}
