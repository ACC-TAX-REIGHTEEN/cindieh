// ============================================================
// EXPORT-SOURCE.TS — one declaration per export source
// ============================================================
// Every export source declares, in ONE place: the columns its cleaned export
// has, the filename prefix, and the rules for deriving a period for the
// filename. `mapColumns` turns those declarations into cells.
//
// This replaced five hand-written copies of the same column mapper inside
// exporter.ts — one per column SHAPE rather than per source — which meant the
// same "read a period field, fall back, strip the leading zero" logic existed
// in five places that had to be kept in agreement, and a sixth copy of a
// `PREFIX_MAP` walked the same eleven sources again for the filename.
//
// Pure: no DOM, no browser API. Two things are deliberately NOT here:
//
//   * `downloader.ts`'s PDF filename switch. It is a real fourth ladder over
//     these sources, but it runs in the PDF download path where a change costs
//     a portal verification run, and joining it buys nothing for column
//     mapping. Deferred deliberately, not overlooked — see ADR-0015.
//   * `page-context.ts`'s URL predicates. Those answer "which page is this",
//     on captured requests; this module answers "what does this source's
//     export look like", at export time. Coupling them would make MAIN-world
//     request detection depend on export shape.
//
// Why the table is a `Record<ExportSource, …>` and not a lookup with a
// default: the old code's default arm silently exported PPN Keluaran columns
// for any source it did not recognise, so adding a twelfth grid meant adding a
// grid that exported the WRONG columns until someone noticed. An incomplete
// table is now a type error instead of a silently wrong spreadsheet.
// ============================================================

import type { ExportSource } from "./page-context";
import { WITHHOLDING_SLIP_NUMBER_FIELDS } from "./row-name";
import { extractYear, extractMonth, extractYMD, formatDate, formatIsoDateTime } from "./tax-date";

type Row = Record<string, unknown>;

/** Turns the value found in a row into the value written to the sheet. */
type FieldReader = (raw: unknown) => unknown;

// ── The readers ───────────────────────────────────────────
// One per way a cell can be derived. A column picks one; it never writes
// parsing inline.

/** The value as captured. */
const passthrough: FieldReader = (raw) => raw;

/** A date field we KNOW is a date: always `DD/MM/YYYY`. */
const date: FieldReader = formatDate;

/**
 * A period field, for MASA. Drops the leading zero because the sheet's column
 * is a display column, not a sortable one.
 */
const periodMonth: FieldReader = (raw) => extractMonth(raw).replace(/^0/, "");

/** A period field, for TAHUN: four digits. */
const periodYear: FieldReader = extractYear;

/**
 * MASA taken from a DATE's own calendar digits. Two grids need it: Bukti
 * Potong rows carry no tax period at all — the slip date is the only period
 * signal they have — and a RETUR row's tax period is its OWN credit note's,
 * not the invoice it credits (which is what the portal puts in the invoice's
 * period field). `extractMonth` only understands period strings, so a full ISO
 * date has to go through `extractYMD` (ADR-0004: never round-trip through
 * `Date`).
 */
const dateMonth: FieldReader = (raw) => {
  const month = extractYMD(raw)?.month ?? "";
  return month ? month.replace(/^0/, "") : "";
};

/** TAHUN from the same slip date. */
const dateYear: FieldReader = (raw) => extractYMD(raw)?.year ?? "";

/**
 * Catches an ISO datetime that arrived in a field nobody declared is a date.
 * Narrower than `date` on purpose — see `formatIsoDateTime`.
 */
const isoDate: FieldReader = formatIsoDateTime;

// ── A declared column ─────────────────────────────────────

export interface ExportColumn {
  /** The header cell, and the key the value is written under in the sheet. */
  readonly label: string;
  /**
   * Candidate field names, most specific first. The first one carrying a
   * value wins. More than one is not redundancy: Bukti Potong rows spell the
   * slip number two different ways depending on which flow captured them.
   */
  readonly sources: readonly string[];
  /** How to turn that value into a cell. Defaults to passthrough. */
  readonly read?: FieldReader;
}

/**
 * How a source's columns are decided.
 *
 * `declared` is a fixed list — the cleaned export has a column set whether or
 * not the API returned anything, and anything undeclared is dropped.
 *
 * `captured` means the portal decides: every field the request captured IS a
 * column, under its own name. The SPT B2 and PPh 21 lampiran work this way, so a
 * schema change there needs no code change at all.
 */
export type ColumnPlan =
  | { readonly kind: "declared"; readonly columns: readonly ExportColumn[] }
  | { readonly kind: "captured"; readonly read?: FieldReader };

/** Raw ("Asli") mode: every captured field, ISO datetimes reformatted. */
export const CAPTURED_COLUMNS: ColumnPlan = { kind: "captured", read: isoDate };

/** Column shorthand: one field name, no special reading. */
function col(label: string, sources: string | readonly string[], read?: FieldReader): ExportColumn {
  return { label, sources: typeof sources === "string" ? [sources] : sources, read };
}

// ── The period fallbacks ──────────────────────────────────
// The portal spells a tax period several ways, and which one arrives depends on
// the grid. These are the orders the old `||` chains preferred, kept verbatim:
// a grid that sends the primary field still wins, and one that only sends the
// consolidated field still gets a period.

const PERIOD_SOURCES = ["TaxInvoicePeriod", "TaxPeriodMonth", "TaxPeriod"];
const CREDIT_PERIOD_SOURCES = ["PeriodCredit", "TaxPeriodMonth", "TaxPeriod"];
const YEAR_SOURCES = ["TaxInvoiceYear", "TaxPeriodYear", "TaxPeriod"];
const CREDIT_YEAR_SOURCES = ["YearCredit", "TaxPeriodYear", "TaxPeriod"];

// ── The declarations ──────────────────────────────────────

const OUTPUT_TAX_COLUMNS: readonly ExportColumn[] = [
  col("TANGGAL", "TaxInvoiceDate", date),
  col("MASA", PERIOD_SOURCES, periodMonth),
  col("TAHUN", YEAR_SOURCES, periodYear),
  col("NAMA PEMBELI", "BuyerName"),
  col("NO IDENTITAS PEMBELI", "BuyerTIN"),
  col("NO FAKTUR", "TaxInvoiceNumber"),
  col("STATUS", "TaxInvoiceStatus"),
  col("STATUS PEMBELI", "BuyerStatus"),
  col("DPP", "SellingPrice"),
  col("DPP NILAI LAIN", "OtherTaxBase"),
  col("PPN", "VAT"),
  col("PPNBM", "STLG"),
  col("REFERENSI", "Reference"),
];

const INPUT_TAX_COLUMNS: readonly ExportColumn[] = [
  col("TANGGAL", "TaxInvoiceDate", date),
  col("MASA", PERIOD_SOURCES, periodMonth),
  col("TAHUN", YEAR_SOURCES, periodYear),
  col("NAMA PENJUAL", "SellerTaxpayerName"),
  col("NO IDENTITAS PENJUAL", "SellerTIN"),
  col("NO FAKTUR", "TaxInvoiceNumber"),
  col("STATUS", "TaxInvoiceStatus"),
  col("STATUS PEMBELI", "BuyerStatus"),
  col("MASA PENGKREDITAN", CREDIT_PERIOD_SOURCES, periodMonth),
  col("TAHUN PENGKREDITAN", CREDIT_YEAR_SOURCES, periodYear),
  col("DPP", "SellingPrice"),
  col("DPP NILAI LAIN", "OtherTaxBase"),
  col("PPN", "VAT"),
  col("PPNBM", "STLG"),
  col("REFERENSI", "Reference"),
];

const OUTPUT_RETURN_COLUMNS: readonly ExportColumn[] = [
  col("NO IDENTITAS PEMBELI", "BuyerTIN"),
  col("NAMA PEMBELI", "BuyerTaxpayerNameClear"),
  col("NO FAKTUR", "TaxInvoiceNumber"),
  col("TANGGAL FAKTUR", "TaxInvoiceDate", date),
  col("NO RETUR", "ReturnNumber"),
  col("TANGGAL RETUR", "ReturnDate", date),
  // MASA and TAHUN are the RETUR's own period, read from its own date. The
  // portal puts the INVOICE's period in the invoice's period field, so reading
  // it there would date every credit note by the document it credits — the
  // wrong month for a return issued in the month after its invoice.
  col("MASA", ["ReturnDate"], dateMonth),
  col("TAHUN", ["ReturnDate"], dateYear),
  col("STATUS PEMBELI", "BuyerStatus"),
  col("STATUS", "TaxInvoiceStatus"),
  col("DPP", "SellingPrice"),
  col("DPP NILAI LAIN", "OtherTaxBase"),
  col("PPN", "VAT"),
  col("PPNBM", "STLG"),
];

const INPUT_RETURN_COLUMNS: readonly ExportColumn[] = [
  col("NO IDENTITAS PENJUAL", "SellerTIN"),
  col("NAMA PENJUAL", "SellerTaxpayerName"),
  col("NO FAKTUR", "TaxInvoiceNumber"),
  col("TANGGAL FAKTUR", "TaxInvoiceDate", date),
  col("NO RETUR", "ReturnNumber"),
  col("TANGGAL RETUR", "ReturnDate", date),
  // The RETUR's own period, not the invoice's — see OUTPUT_RETURN_COLUMNS.
  col("MASA", ["ReturnDate"], dateMonth),
  col("TAHUN", ["ReturnDate"], dateYear),
  col("STATUS PEMBELI", "BuyerStatus"),
  col("STATUS", "TaxInvoiceStatus"),
  col("DPP", "SellingPrice"),
  col("DPP NILAI LAIN", "OtherTaxBase"),
  col("PPN", "VAT"),
  col("PPNBM", "STLG"),
];

// Bukti Potong is the one grid whose cleaned column set is not pinned by a
// settled field list. What the rest of the code does confirm: the slip number
// arrives under EITHER of two spellings, the slip date is `WithholdingSlipsDate`,
// and the withholding agent is `EmployerName` / `TaxIdentificationNumber`. Hence
// two spellings for the number — read from one list, so the exported column and
// the name the file carries cannot disagree about which spelling a slip has —
// and one date seeding three columns because a slip carries no separate
// tax-period field. The "Asli" export mode still dumps every captured field
// verbatim for anyone who needs more than these six columns.
const WITHHOLDING_COLUMNS: readonly ExportColumn[] = [
  col("NO BUKTI POTONG", WITHHOLDING_SLIP_NUMBER_FIELDS),
  col("TANGGAL", "WithholdingSlipsDate", date),
  col("MASA", "WithholdingSlipsDate", dateMonth),
  col("TAHUN", "WithholdingSlipsDate", dateYear),
  col("NAMA PEMOTONG", "EmployerName"),
  col("NPWP PEMOTONG", "TaxIdentificationNumber"),
];

// Lampiran A2 exports the portal's own field names — its users open these files
// next to the portal's own A2 export, so renaming the columns would break the
// comparison the file exists to support. It is still a declared list: the eight
// fields below are the export, and anything else the request happened to capture
// is dropped.
const SPT_A2_COLUMNS: readonly ExportColumn[] = [
  col("DocumentDate", "DocumentDate", date),
  col("Name", "Name", isoDate),
  col("TIN", "TIN", isoDate),
  col("DocumentNumber", "DocumentNumber", isoDate),
  col("TaxBase", "TaxBase", isoDate),
  col("OtherTaxBase", "OtherTaxBase", isoDate),
  col("VAT", "VAT", isoDate),
  col("STLG", "STLG", isoDate),
];

// ── Filename rules ────────────────────────────────────────

interface FilenameRule {
  /**
   * `masa` names the file MMYYYY, or MMYYYY-MMYYYY when the rows span more than
   * one period. `tahun` names it for the YEAR alone.
   */
  readonly shape: "masa" | "tahun";
  /**
   * PPh 21 accepts a filter value that is not a period at all — the lampiran are
   * filtered by an article/section code ("ART21"), not by masa. No other source
   * does, and none should: a non-period hint elsewhere is a malformed filter.
   */
  readonly looseHint?: boolean;
  /**
   * Last resort for a period, when a row carries no tax-period field at all.
   * Read in order; the first with a value wins.
   */
  readonly periodDateFields: readonly string[];
}

/** The usual shape: masa, seeded by the invoice date when nothing better exists. */
const MASA_BY_INVOICE_DATE: FilenameRule = { shape: "masa", periodDateFields: ["TaxInvoiceDate"] };

export interface ExportSourceSpec {
  /** Prepended to the generated filename. The README documents these. */
  readonly prefix: string;
  /** The cleaned export's columns. */
  readonly columns: ColumnPlan;
  /**
   * What to `debugWarn` when a row matched nothing we declared — the signal
   * that the API's schema moved under us and the sheet is about to be empty.
   * Omitted where the old code had no such check.
   */
  readonly driftWarning?: string;
  readonly filename: FilenameRule;
}

const SPECS: Record<ExportSource, ExportSourceSpec> = {
  OUTPUT_TAX: {
    prefix: "FPK-",
    columns: { kind: "declared", columns: OUTPUT_TAX_COLUMNS },
    driftWarning: "API schema may have changed: no hardcoded fields matched in any row",
    filename: MASA_BY_INVOICE_DATE,
  },
  INPUT_TAX: {
    prefix: "FPM-",
    columns: { kind: "declared", columns: INPUT_TAX_COLUMNS },
    driftWarning: "API schema may have changed: no INPUT_TAX fields matched in any row",
    filename: MASA_BY_INVOICE_DATE,
  },
  OUTPUT_RETURN: {
    prefix: "RET-FPK-",
    columns: { kind: "declared", columns: OUTPUT_RETURN_COLUMNS },
    driftWarning: "API schema may have changed: no OUTPUT_RETURN fields matched in any row",
    // A retur file is named for the year, and that year comes from the
    // request's own year filter rather than from the rows: the rows still carry
    // the INVOICE's masa, which is not the year the retur belongs to. The
    // fallback — used when the request carries no year filter — is the credit
    // note's own date, for the same reason.
    filename: { shape: "tahun", periodDateFields: ["ReturnDate"] },
  },
  INPUT_RETURN: {
    prefix: "RET-FPM-",
    columns: { kind: "declared", columns: INPUT_RETURN_COLUMNS },
    driftWarning: "API schema may have changed: no INPUT_RETURN fields matched in any row",
    filename: { shape: "tahun", periodDateFields: ["ReturnDate"] },
  },
  SPT_A2: {
    prefix: "A2-",
    columns: { kind: "declared", columns: SPT_A2_COLUMNS },
    driftWarning: "API schema may have changed: no A2 fields matched in any row",
    filename: { shape: "masa", periodDateFields: ["DocumentDate", "Date"] },
  },
  SPT_B2: {
    prefix: "B2-",
    // Nothing to declare: Lampiran B2's columns are whatever the grid captured.
    columns: { kind: "captured", read: isoDate },
    filename: MASA_BY_INVOICE_DATE,
  },
  PPH_21_L1A: {
    prefix: "PPH21-L1A-",
    columns: { kind: "captured", read: isoDate },
    filename: { shape: "masa", looseHint: true, periodDateFields: ["TaxInvoiceDate"] },
  },
  PPH_21_L1B: {
    prefix: "PPH21-L1B-",
    columns: { kind: "captured", read: isoDate },
    filename: { shape: "masa", looseHint: true, periodDateFields: ["TaxInvoiceDate"] },
  },
  PPH_21_L2: {
    prefix: "PPH21-L2-",
    columns: { kind: "captured", read: isoDate },
    filename: { shape: "masa", looseHint: true, periodDateFields: ["TaxInvoiceDate"] },
  },
  PPH_21_L3: {
    prefix: "PPH21-L3-",
    columns: { kind: "captured", read: isoDate },
    filename: { shape: "masa", looseHint: true, periodDateFields: ["TaxInvoiceDate"] },
  },
  WITHHOLDING_SLIPS: {
    prefix: "BP-",
    columns: { kind: "declared", columns: WITHHOLDING_COLUMNS },
    driftWarning: "API schema may have changed: no WITHHOLDING_SLIPS fields matched in any row",
    filename: { shape: "masa", periodDateFields: ["WithholdingSlipsDate"] },
  },
};

/**
 * The declaration for a source. An absent or unrecognised source resolves to
 * PPN Keluaran's — the same fallback the old prefix lookup had, kept so an
 * unexpected value still produces a usable PPN Keluaran export rather than
 * throwing. Note that a declared-but-missing entry can no longer reach here:
 * `SPECS` is `Record<ExportSource, …>`, so a new source without a declaration
 * does not compile.
 */
export function getExportSourceSpec(source?: ExportSource): ExportSourceSpec {
  return source && Object.prototype.hasOwnProperty.call(SPECS, source) ? SPECS[source] : SPECS.OUTPUT_TAX;
}

// ── Mapping ───────────────────────────────────────────────

export interface ColumnMapping {
  /** The headers, in order. */
  readonly fields: string[];
  /** One output row per input row, keyed by the labels above. */
  readonly data: Row[];
  /**
   * Set when some row carried NONE of the declared fields — the caller decides
   * whether that is worth a warning, because raw mode expects empty matches.
   */
  readonly drift: { readonly expected: readonly string[]; readonly sampleRow: Row } | null;
}

/**
 * The first of a column's candidate fields that carries a value.
 *
 * Absent means `undefined`, `null` or `""` — deliberately NOT falsiness. A
 * passthrough column reading `OtherTaxBase` must see the `0` that Coretax sends
 * for "no other tax base", and the old code read those columns with a bare
 * `row[field]` that never skipped anything. (Skipping on falsiness is exactly
 * the bug the characterisation matrix caught on its first run: every zero in the
 * row came back as `undefined`.)
 *
 * The period columns replaced `||` chains, which DID skip `0`. That difference
 * has nothing to bite on: `extractMonth(0)` and `formatDate(0)` both return
 * `""` anyway, which is what the chain produced when it found nothing.
 */
function firstSource(row: Row, sources: readonly string[]): unknown {
  for (const source of sources) {
    const value = row[source];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

/** Resolve a source's plan against the fields this request actually captured. */
function columnsFor(plan: ColumnPlan, capturedFields: readonly string[]): ExportColumn[] {
  if (plan.kind === "declared") return [...plan.columns];
  return capturedFields.map((field) => ({ label: field, sources: [field], read: plan.read }));
}

/** Map rows through a plan. This is the one mapper; the plans are the variation. */
export function mapColumns(
  plan: ColumnPlan,
  rows: readonly Row[],
  capturedFields: readonly string[],
): ColumnMapping {
  const columns = columnsFor(plan, capturedFields);

  const data = rows.map((row) => {
    const mapped: Row = {};
    for (const column of columns) {
      const read = column.read ?? passthrough;
      mapped[column.label] = read(firstSource(row, column.sources));
    }
    return mapped;
  });

  const expected = columns.flatMap((column) => column.sources);
  const drift =
    rows.some((row) => expected.every((field) => row[field] === undefined || row[field] === null))
      ? { expected, sampleRow: rows[0] }
      : null;

  return { fields: columns.map((column) => column.label), data, drift };
}
