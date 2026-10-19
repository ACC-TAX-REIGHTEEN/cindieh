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
// The CHECKER's columns are declared ONCE for both of its halves (the table and
// the XLSX/CSV sheet): `CheckerColumn` pairs an optional `screen` column with a
// REQUIRED `sheet` column, so a column cannot be added to the table and silently
// left out of the file. The file is still the wider view — it carries the
// counterparty's NPWP/NIK, which the table never shows — and that is declared as
// a sheet-only column in the same table instead of a second hand-written one.
//
// The COMPARER follows the same shape: `ComparerColumn` pairs its grid column
// with the file's, and the three columns only the file carries (Tanggal,
// NIK/NPWP, Nomor Faktur Pajak) are declared beside them instead of in a
// second hand-written header inside `comparer-export.ts` (ADR-0030).
//
// Why this is not "flow" and may therefore live beside the view (ADR-0003):
// nothing here decides what to run or in what order. It maps a row to cells.

import type { ComparisonResult } from "./comparer";
import type { BenchmarkType, CheckResult } from "./checker-logic";
import type { CheckerRowIdentity } from "./page-context";
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

// ── Comparer grid (tab 1) and its wider file ──────────

/**
 * One column of the comparison result, as BOTH of its halves.
 *
 * The same pairing as `CheckerColumn`, for the same reason: the sheet is the
 * wider view — it carries Tanggal, NIK/NPWP and Nomor Faktur Pajak, which the
 * table does not show — and those are declared HERE as sheet-only columns. The
 * grid reads the `screen` half, the file reads the `sheet` half, and a column
 * cannot exist in one and be forgotten in the other (ADR-0030).
 *
 * Unlike the checker's pair, `screen` is allowed to be narrower in a second
 * way: the file writes the raw status code where the table shows the friendly
 * label, which is a difference between two cells rather than between two
 * columns.
 */
export interface ComparerColumn {
  /** The table's column, or null when only the file carries it. */
  readonly screen: ResultColumn<ComparisonResult> | null;
  /** The sheet's header and cell. */
  readonly sheet: SheetColumn<ComparisonResult>;
}

/**
 * A column both views share: one label, and two ways of writing the same value —
 * the table's formatted text and the sheet's raw cell.
 */
function comparerSharedColumn(
  screen: ResultColumn<ComparisonResult>,
  sheetValue: (row: ComparisonResult, index: number) => string | number | null,
  sheetFormat?: SheetCellFormat,
): ComparerColumn {
  return {
    screen,
    sheet: sheetFormat
      ? { label: screen.label, value: sheetValue, format: sheetFormat }
      : { label: screen.label, value: sheetValue },
  };
}

/**
 * The columns only the file carries, in the order they sit there: straight
 * after Nama Pembeli, before the amounts.
 */
const COMPARISON_FILE_ONLY_COLUMNS: readonly ComparerColumn[] = [
  { screen: null, sheet: { label: "Tanggal", value: (r) => r.invoiceDate } },
  { screen: null, sheet: { label: "NIK/NPWP", value: (r) => r.buyerTIN } },
  { screen: null, sheet: { label: "Nomor Faktur Pajak", value: (r) => r.taxInvoiceNumber } },
];

/**
 * The comparer's whole result: one row per column, in the FILE's order, with the
 * table's half beside it.
 *
 * This is the ONE definition of which columns the comparison has. Referensi Lain
 * is inserted by `comparerSchema`, so the "shift the rest right" rule is stated
 * once instead of being re-derived from a nine-way rotation at every read.
 */
const COMPARER_SCHEMA: readonly ComparerColumn[] = [
  comparerSharedColumn(numberColumn<ComparisonResult>(), (_row, index) => index + 1),
  comparerSharedColumn(
    textColumn("Referensi", "ch-col-ref", (r) => r.reference),
    (r) => r.reference,
  ),
  comparerSharedColumn(
    textColumn("Nama Pembeli", "ch-col-buyer", (r) => r.buyerName),
    (r) => r.buyerName,
  ),
  ...COMPARISON_FILE_ONLY_COLUMNS,
  comparerSharedColumn(
    amountColumn("DPP Coretax", "ch-col-num", (r) => r.dppSistem),
    (r) => r.dppSistem,
    "amount",
  ),
  comparerSharedColumn(
    amountColumn("DPP Baru", "ch-col-num", (r) => r.dppExcel),
    (r) => r.dppExcel,
    "amount",
  ),
  comparerSharedColumn(
    amountColumn("PPN Coretax", "ch-col-num", (r) => r.ppnSistem),
    (r) => r.ppnSistem,
    "amount",
  ),
  comparerSharedColumn(
    amountColumn("PPN Baru", "ch-col-num", (r) => r.ppnExcel),
    (r) => r.ppnExcel,
    "amount",
  ),
  comparerSharedColumn(
    amountColumn("Selisih PPN", "ch-col-num", (r) => r.ppnSelisih),
    (r) => r.ppnSelisih,
    "amount",
  ),
  // The table shows the friendly label; the file writes the raw status, as both
  // exports always have.
  comparerSharedColumn(
    textColumn("Status", "ch-col-status", (r) => getStatusLabel(r.status)),
    (r) => r.status,
  ),
];

/** The column Referensi Lain mode adds, and where it goes: after Referensi. */
const REF_LAIN_COLUMN: ComparerColumn = comparerSharedColumn(
  textColumn("Referensi Lain", "ch-col-ref", (r) => r.refLain),
  (r) => r.refLain,
);

const REF_LAIN_INDEX = 2;

/** The comparer's columns for one mode, read off the shared schema. */
export function comparerSchema(refLainEnabled: boolean): ComparerColumn[] {
  if (!refLainEnabled) return [...COMPARER_SCHEMA];
  return [
    ...COMPARER_SCHEMA.slice(0, REF_LAIN_INDEX),
    REF_LAIN_COLUMN,
    ...COMPARER_SCHEMA.slice(REF_LAIN_INDEX),
  ];
}

/** The comparer grid's columns: the schema's table half, in order. */
export function comparisonColumns(refLainEnabled: boolean): ResultColumn<ComparisonResult>[] {
  const columns: ResultColumn<ComparisonResult>[] = [];
  for (const column of comparerSchema(refLainEnabled)) {
    if (column.screen) columns.push(column.screen);
  }
  return columns;
}

/** The comparer sheet's columns: the same schema, file half only. */
export function comparerSheetColumns(refLainEnabled: boolean): SheetColumn<ComparisonResult>[] {
  return comparerSchema(refLainEnabled).map((column) => column.sheet);
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

/**
 * The counterparty column, per side, as the TABLE renders it.
 *
 * Exported beside `CHECKER_IDENTITIES` because a reader outside the schema has to
 * be able to NAME the column its grid shows rather than spell it a second time:
 * the microsite's per-grid table is checked against this header, so a column
 * renamed here reports itself instead of leaving the page advertising the old
 * wording (microsite-sync.unit.test.ts).
 */
export const CHECKER_COUNTERPARTY_COLUMNS: Record<Counterparty, ResultColumn<CheckResult>> = {
  // PPN Keluaran: the invoice's buyer.
  pembeli: textColumn("Nama Pembeli", "ch-col-buyer", (r) => r.counterpartyName),
  // PPN Masukan: the same column, but the invoice's SELLER. Labelling it
  // "Pembeli" there would describe the taxpayer's own side and mislead.
  penjual: textColumn("Nama Penjual", "ch-col-buyer", (r) => r.counterpartyName),
};

/**
 * How one grid's checker rows are named: the identity column's label and the
 * cell it reads, plus the date of the document that identity belongs to.
 *
 * ONE table for the panel's grid and the exported sheet, which both read it, so
 * a retur row cannot be a "No Retur" on screen and a "Referensi" in the file.
 * Which of the two applies where is a PAGE fact (page-context.checkerRowIdentity)
 * — nothing here asks where the user is.
 */
export interface CheckerIdentitySpec {
  /** The identity column's header, and what the row's identity is there. */
  readonly label: string;
  readonly value: (row: CheckResult) => string;
  /**
   * The date column's header and cell. A retur grid shows two dates (the
   * invoice's and the retur's), so this one has to say which of them it is.
   */
  readonly dateLabel: string;
  readonly date: (row: CheckResult) => string;
}

export const CHECKER_IDENTITIES: Record<CheckerRowIdentity, CheckerIdentitySpec> = {
  // Both PPN grids: the row is an invoice. A row with no Referensi falls back to
  // its tax-invoice number, as the exported sheet does.
  referensi: {
    label: "Referensi",
    value: (r) => r.reference || r.taxInvoiceNumber,
    dateLabel: "Tanggal",
    date: (r) => r.invoiceDate,
  },
  // Both Retur grids: the row is a retur nota, so it is named by its NO RETUR
  // and dated by the retur date rather than by the invoice it returns.
  "no-retur": {
    label: "No Retur",
    value: (r) => r.returnNumber || r.taxInvoiceNumber,
    dateLabel: "Tanggal Retur",
    date: (r) => r.returnDate,
  },
};

/**
 * How the workbook formats a sheet column's cells. `amount` is an unsigned
 * figure (RESULT_NUMBER_FORMAT); `difference` is a signed one, so a positive
 * value reads `+…` (RESULT_DIFFERENCE_FORMAT). Unset means plain text.
 */
export type SheetCellFormat = "amount" | "difference";

/**
 * A column as the exported sheet writes it: a header, one cell value, and the
 * number format the workbook applies to that cell.
 *
 * The cell is the RAW value — a number stays a number so a spreadsheet can sum
 * it — which is exactly where it differs from the table's formatted text.
 */
export interface SheetColumn<T> {
  readonly label: string;
  readonly value: (row: T, index: number) => string | number | null;
  /** Unset for a text column, including the row number. */
  readonly format?: SheetCellFormat;
}

/**
 * One column of the checker's result, as BOTH of its halves.
 *
 * The table and the file are two views of the same columns, so the module that
 * decides which columns exist is also the module that decides which cells each
 * one writes. `sheet` is REQUIRED and `screen` is optional: every column the
 * check produces reaches the file, while the file carries a few the table does
 * not (the counterparty's NPWP/NIK). That asymmetry is deliberate — a new table
 * column cannot compile without a file column, which is what stops the two from
 * drifting apart again.
 */
export interface CheckerColumn {
  /** The table's column, or null when only the file carries it. */
  readonly screen: ResultColumn<CheckResult> | null;
  /** The sheet's header and cell. */
  readonly sheet: SheetColumn<CheckResult>;
}

/**
 * A column both views share: one label, and two ways of writing the same value —
 * the table's formatted text and the sheet's raw cell.
 */
function sharedColumn(
  screen: ResultColumn<CheckResult>,
  sheetValue: (row: CheckResult, index: number) => string | number | null,
  sheetFormat?: SheetCellFormat,
): CheckerColumn {
  return {
    screen,
    sheet: sheetFormat
      ? { label: screen.label, value: sheetValue, format: sheetFormat }
      : { label: screen.label, value: sheetValue },
  };
}

/** The three system amounts, in the order the checker reports them. */
const CHECKER_AMOUNT_COLUMNS: readonly CheckerColumn[] = [
  sharedColumn(
    amountColumn("DPP", "ch-col-num", (r) => r.dppSystem),
    (r) => r.dppSystem,
    "amount",
  ),
  sharedColumn(
    amountColumn("DPP NL", "ch-col-num-wide", (r) => r.dppNilaiLainSystem),
    (r) => r.dppNilaiLainSystem,
    "amount",
  ),
  sharedColumn(
    amountColumn("PPN", "ch-col-num", (r) => r.ppnSystem),
    (r) => r.ppnSystem,
    "amount",
  ),
];

/** The two leading columns the row identity produces, in its own order. */
function checkerIdentityColumns(identity: CheckerRowIdentity): CheckerColumn[] {
  const spec = CHECKER_IDENTITIES[identity];
  return [
    sharedColumn(textColumn(spec.label, "ch-col-ref", spec.value), spec.value),
    sharedColumn(textColumn(spec.dateLabel, "ch-col-date", spec.date), spec.date),
  ];
}

const CHECKER_STATUS_COLUMN: CheckerColumn = sharedColumn(
  textColumn("Status", "ch-col-status", (r) => r.status),
  (r) => r.status,
);

/**
 * The two difference columns for one Acuan, each with its formatted table cell
 * and its raw sheet cell.
 *
 * The column LABELS come from the session's benchmark, but a cell reads its
 * difference from the ROW's own benchmark. That asymmetry is the table's
 * existing behaviour and is preserved deliberately: every row in a run is
 * produced by one `checkAllRowsAccuracy` call so they always agree, while the
 * session value is what fixes the header text. Resolve per row and both views
 * keep behaving identically if that ever stops being true.
 */
function checkerDiffColumns(benchmark: BenchmarkType): CheckerColumn[] {
  return CHECKER_DIFFS[benchmark].map((spec, slot): CheckerColumn => ({
    screen: {
      label: spec.label,
      className: spec.wide ? "ch-col-num-wide" : "ch-col-num",
      numeric: true,
      value: (row) => formatResultDifference(CHECKER_DIFFS[row.benchmark][slot].diff(row), row.tolerance),
    },
    sheet: {
      label: spec.label,
      value: (row) => CHECKER_DIFFS[row.benchmark][slot].diff(row),
      format: "difference",
    },
  }));
}

/**
 * The checker's whole table: one row per column, in the file's order, with the
 * table's half beside it.
 *
 * This is the ONE definition of which columns the check has. `checkerColumns`
 * and `checkerSheetColumns` are two readings of it, which is why a column cannot
 * exist in one and not the other without saying so here.
 */
export function checkerSchema(
  benchmark: BenchmarkType,
  counterparty: Counterparty = "pembeli",
  identity: CheckerRowIdentity = "referensi",
): CheckerColumn[] {
  return [
    sharedColumn(numberColumn<CheckResult>(), (_row, index) => index + 1),
    ...checkerIdentityColumns(identity),
    sharedColumn(CHECKER_COUNTERPARTY_COLUMNS[counterparty], (r) => r.counterpartyName),
    // The file's own column: the table never shows a NPWP/NIK, and the sheet has
    // carried it since the tab existed. Declared here so it cannot be lost.
    {
      screen: null,
      sheet: {
        label: `NPWP/NIK ${COUNTERPARTY_LABEL[counterparty]}`,
        value: (r) => r.counterpartyTIN,
      },
    },
    ...CHECKER_AMOUNT_COLUMNS,
    ...checkerDiffColumns(benchmark),
    CHECKER_STATUS_COLUMN,
  ];
}

/** The checker grid's columns for one Acuan, read off the shared schema. */
export function checkerColumns(
  benchmark: BenchmarkType,
  counterparty: Counterparty = "pembeli",
  identity: CheckerRowIdentity = "referensi",
): ResultColumn<CheckResult>[] {
  const columns: ResultColumn<CheckResult>[] = [];
  for (const column of checkerSchema(benchmark, counterparty, identity)) {
    if (column.screen) columns.push(column.screen);
  }
  return columns;
}

/** The checker sheet's columns for one Acuan: the same schema, file half only. */
export function checkerSheetColumns(
  benchmark: BenchmarkType,
  counterparty: Counterparty = "pembeli",
  identity: CheckerRowIdentity = "referensi",
): SheetColumn<CheckResult>[] {
  return checkerSchema(benchmark, counterparty, identity).map((column) => column.sheet);
}
