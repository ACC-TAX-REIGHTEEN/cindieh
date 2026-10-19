// Pure result grids for the AOA writer; display formatting never changes values.
import type { ComparisonResult } from "./comparer";
import type { BenchmarkType, CheckResult } from "./checker-logic";
import {
  checkerSheetColumns,
  comparerSheetColumns,
  type Counterparty,
  type SheetColumn,
} from "./result-columns";
import type { CheckerRowIdentity } from "./page-context";

export type ResultExportRows = (string | number | null)[][];

/** The header plus one row per record, both read off the same column list. */
function sheetRows<T>(columns: readonly SheetColumn<T>[], rows: readonly T[]): ResultExportRows {
  return [
    columns.map((column) => column.label),
    ...rows.map((row, index) => columns.map((column) => column.value(row, index))),
  ];
}

/**
 * The comparison sheet, built from the SAME column schema the grid renders
 * (`result-columns.comparerSchema`), so the file could not carry a column the
 * schema does not know about — and the three columns only it shows (Tanggal,
 * NIK/NPWP, Nomor Faktur Pajak) are declared there as sheet-only columns
 * instead of being a second header written here (ADR-0030).
 */
export function buildComparisonExportRows(
  results: readonly ComparisonResult[],
  refLainEnabled: boolean,
): ResultExportRows {
  return sheetRows(comparerSheetColumns(refLainEnabled), results);
}

/**
 * The checker sheet, built from the SAME column schema the grid renders
 * (`result-columns.checkerSchema`), so a column cannot exist on the table and be
 * missing from the file — or head a column here with a label the table does not
 * use. The file is still the wider view: the schema declares the counterparty's
 * NPWP/NIK as a sheet-only column. The default is the invoice grids' identity
 * and PPN Keluaran's counterparty, exactly as the table defaults.
 */
export function buildCheckerExportRows(
  results: readonly CheckResult[],
  benchmark: BenchmarkType,
  counterparty: Counterparty = "pembeli",
  identity: CheckerRowIdentity = "referensi",
): ResultExportRows {
  return sheetRows(checkerSheetColumns(benchmark, counterparty, identity), results);
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
