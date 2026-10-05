// ============================================================
// RESULT-COLUMNS.TS — The on-screen result tables' column schema
// ============================================================
// Pure: no DOM, no browser API. Both result grids are declared here as lists
// of columns, so a column's label, CSS class, alignment and cell value live in
// ONE place. Previously each grid kept four things in lockstep by index — a
// header array, a class function, a numeric index list, and a cell array — so
// inserting or reordering a column meant editing all four and hoping the
// indices still lined up.
//
// This is the ON-SCREEN shape only. `comparer-export.ts` describes the XLSX
// shape, which is deliberately WIDER: the exported file also carries Tanggal,
// NIK/NPWP and Nomor Faktur Pajak, which the table does not show. Do not merge
// the two schemas without deciding that on purpose.
//
// Why this is not "flow" and may therefore live beside the view (ADR-0003):
// nothing here decides what to run or in what order. It maps a row to cells.

import type { ComparisonResult } from "./comparer";
import type { BenchmarkType, CheckResult } from "./checker-logic";
import { getStatusLabel } from "./comparer-logic";
import { formatResultNumber, formatResultDifference } from "./comparer-export";

export interface ResultColumn<T> {
  /** Header text for the `<th>`. */
  readonly label: string;
  /** Class applied to both the `<th>` and the `<td>`. */
  readonly className: string;
  /** When true the `<td>` also gets the right-alignment class. */
  readonly numeric?: boolean;
  /**
   * The cell text for one row. `index` is the 0-based position WITHIN the
   * current page, which is what the "No" column numbers — it continues across
   * pages rather than restarting at 1.
   */
  readonly value: (row: T, index: number) => string;
}

// ── Per-column shorthands ─────────────────────────────
// Every grid leads with a row number and ends with a status.

function numberColumn<T>(): ResultColumn<T> {
  return {
    label: "No",
    className: "ch-col-no",
    numeric: true,
    value: (_row, index) => String(index + 1),
  };
}

function textColumn<T>(label: string, className: string, pick: (row: T) => string): ResultColumn<T> {
  return { label, className, value: (row) => pick(row) };
}

function amountColumn<T>(label: string, className: string, pick: (row: T) => number | null): ResultColumn<T> {
  return { label, className, numeric: true, value: (row) => formatResultNumber(pick(row)) };
}

// ── Comparer grid (tab 1) ─────────────────────────────

const COMPARISON_COLUMNS: readonly ResultColumn<ComparisonResult>[] = [
  numberColumn<ComparisonResult>(),
  textColumn("Referensi", "ch-col-ref", (r) => r.reference),
  textColumn("Nama Pembeli", "ch-col-buyer", (r) => r.buyerName),
  amountColumn("DPP Coretax", "ch-col-num", (r) => r.dppSistem),
  amountColumn("DPP Baru", "ch-col-num", (r) => r.dppExcel),
  amountColumn("PPN Coretax", "ch-col-num", (r) => r.ppnSistem),
  amountColumn("PPN Baru", "ch-col-num", (r) => r.ppnExcel),
  amountColumn("Selisih PPN", "ch-col-num", (r) => r.ppnSelisih),
  // The comparer shows the friendly label; the checker shows the raw status.
  textColumn("Status", "ch-col-status", (r) => getStatusLabel(r.status)),
];

const REF_LAIN_COLUMN: ResultColumn<ComparisonResult> = textColumn(
  "Referensi Lain",
  "ch-col-ref",
  (r) => r.refLain,
);

/** Where Referensi Lain is inserted: straight after Referensi. */
const REF_LAIN_INDEX = 2;

/**
 * The comparer grid's columns. Referensi Lain mode adds one column and shifts
 * the rest right, which is now stated once here instead of being re-derived
 * from a nine-way rotation at every read.
 */
export function comparisonColumns(refLainEnabled: boolean): ResultColumn<ComparisonResult>[] {
  if (!refLainEnabled) return [...COMPARISON_COLUMNS];
  return [
    ...COMPARISON_COLUMNS.slice(0, REF_LAIN_INDEX),
    REF_LAIN_COLUMN,
    ...COMPARISON_COLUMNS.slice(REF_LAIN_INDEX),
  ];
}

// ── Checker grid (tab 2) ──────────────────────────────

/**
 * One of the two difference columns. The Acuan (benchmark) decides which two
 * values are DERIVED from the benchmark and which two are therefore the ones
 * with a difference to show — so the column pair is a property of the
 * benchmark, not of the row.
 */
interface CheckerDiffSpec {
  readonly label: string;
  /** A DPP Nilai Lain amount gets the wider numeric column. */
  readonly wide: boolean;
  /** The raw difference this column reports. */
  readonly diff: (row: CheckResult) => number | null;
}

/**
 * The two difference columns per Acuan. Reading it as a table is the point: the
 * old code picked the cells with an if/else chain over the row's benchmark and
 * the headers with a three-way nested ternary over the session's, and the two
 * had to be read side by side to confirm they agreed.
 */
const CHECKER_DIFFS: Record<BenchmarkType, readonly [CheckerDiffSpec, CheckerDiffSpec]> = {
  // Acuan DPP: DPP NL and PPN are derived from it.
  DPP: [
    { label: "Selisih DPP NL", wide: true, diff: (r) => r.dppNilaiLainDiff },
    { label: "Selisih PPN", wide: false, diff: (r) => r.ppnDiff },
  ],
  // Acuan DPP NL: DPP and PPN are derived from it.
  DPP_NILAI_LAIN: [
    { label: "Selisih DPP", wide: false, diff: (r) => r.dppDiff },
    { label: "Selisih PPN", wide: false, diff: (r) => r.ppnDiff },
  ],
  // Acuan PPN: DPP and DPP NL are derived from it.
  PPN: [
    { label: "Selisih DPP", wide: false, diff: (r) => r.dppDiff },
    { label: "Selisih DPP NL", wide: true, diff: (r) => r.dppNilaiLainDiff },
  ],
};

/**
 * Which side of the transaction the counterparty sits on. The checker tests one
 * invoice's arithmetic at a time, so the only thing a side changes is the words
 * in the column header and the field the cell reads — never the maths.
 */
export type Counterparty = "pembeli" | "penjual";

export const COUNTERPARTY_LABEL: Record<Counterparty, string> = {
  pembeli: "Pembeli",
  penjual: "Penjual",
};

const CHECKER_COUNTERPARTY_COLUMN: Record<Counterparty, ResultColumn<CheckResult>> = {
  // PPN Keluaran: the invoice's buyer.
  pembeli: textColumn("Nama Pembeli", "ch-col-buyer", (r) => r.counterpartyName),
  // PPN Masukan: the same column, but the invoice's SELLER. Labelling it
  // "Pembeli" there would describe the taxpayer's own side and mislead.
  penjual: textColumn("Nama Penjual", "ch-col-buyer", (r) => r.counterpartyName),
};

const CHECKER_COLUMNS: readonly ResultColumn<CheckResult>[] = [
  numberColumn<CheckResult>(),
  // A row with no Referensi falls back to its tax-invoice number, as the
  // exported sheet does.
  textColumn("Referensi", "ch-col-ref", (r) => r.reference || r.taxInvoiceNumber),
  textColumn("Tanggal", "ch-col-date", (r) => r.invoiceDate),
  amountColumn("DPP", "ch-col-num", (r) => r.dppSystem),
  amountColumn("DPP NL", "ch-col-num-wide", (r) => r.dppNilaiLainSystem),
  amountColumn("PPN", "ch-col-num", (r) => r.ppnSystem),
];

/** Where the counterparty column sits: after No, Referensi and Tanggal. */
const CHECKER_COUNTERPARTY_INDEX = 3;

/** Where the two difference columns go: after the three system amounts. */
const CHECKER_DIFF_INDEX = 7;

const CHECKER_STATUS_COLUMN: ResultColumn<CheckResult> = textColumn(
  "Status",
  "ch-col-status",
  (r) => r.status,
);

/**
 * The checker grid's columns for one Acuan.
 *
 * The column LABELS come from the session's benchmark, but a cell reads its
 * difference from the ROW's own benchmark. That asymmetry is the table's
 * existing behaviour and is preserved deliberately: every row in a run is
 * produced by one `checkAllRowsAccuracy` call so they always agree, while the
 * session value is what fixes the header text. Resolve per row and the table
 * keeps behaving identically if that ever stops being true.
 */
export function checkerColumns(
  benchmark: BenchmarkType,
  counterparty: Counterparty = "pembeli",
): ResultColumn<CheckResult>[] {
  const labels = CHECKER_DIFFS[benchmark];
  const diffCells = labels.map(
    (spec, slot): ResultColumn<CheckResult> => ({
      label: spec.label,
      className: spec.wide ? "ch-col-num-wide" : "ch-col-num",
      numeric: true,
      value: (row) => formatResultDifference(CHECKER_DIFFS[row.benchmark][slot].diff(row), row.tolerance),
    }),
  );
  return [
    ...CHECKER_COLUMNS.slice(0, CHECKER_COUNTERPARTY_INDEX),
    CHECKER_COUNTERPARTY_COLUMN[counterparty],
    ...CHECKER_COLUMNS.slice(CHECKER_COUNTERPARTY_INDEX, CHECKER_DIFF_INDEX),
    ...diffCells,
    // CHECKER_COLUMNS stops at the insertion point, so the status column that
    // used to follow it has to be appended here.
    CHECKER_STATUS_COLUMN,
  ];
}
