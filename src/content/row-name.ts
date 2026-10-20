// ============================================================
// ROW-NAME.TS — what one scraped row is called
// ============================================================
// A scraped row is named TWICE: once in the panel's progress line and failure
// list, and once in the file the download lands as. Those two names have to be
// the same row, because the download ORDER is the only thing that ties a
// failure back to a row once the run is over — a run that reports "4 gagal"
// has to be able to say WHICH four.
//
// They used to be two different ladders:
//
//   the panel  : Reference → TaxInvoiceNumber → LetterNumber → ReturnNumber
//   the file   : Reference → … (its own list, per source)
//   Bukti Potong: the panel read WithholdingSlipNumber and WithholdingSlipsNumber,
//   the file read WithholdingSlipsNumber only
//
// so the two could name the same row differently, and did:
//
//   - a RETUR row carrying both a Reference and a ReturnNumber was reported as
//     the Reference and filed as the ReturnNumber;
//   - a Bukti Potong row carrying only the SINGULAR slip number was reported
//     as "BP-001" and filed as "TANPA_NOMOR";
//   - an e-faktur row carrying a TaxInvoiceNumber and a LetterNumber was
//     reported as the TaxInvoiceNumber and filed as the LetterNumber.
//
// So the ladder lives here, ONCE, and it is declared per export source as two
// lists:
//
//   - `name`   — the fields that NAME the row (its Reference, its return
//                number, its slip number). This is the file's first slot.
//   - `invoice`— the fields that carry the INVOICE number, which the file
//                carries beside the name. A different fact, and a different
//                list: on PPN Keluaran the invoice is the LetterNumber, on
//                PPN Masukan it is the TaxInvoiceNumber.
//
// The label a row is REPORTED under is the first of `name` then `invoice` the
// row carries — so it is always a token the file also carries, which is the
// whole point. The file takes its two slots from the same two lists, so a
// failure report and the file it names cannot disagree about which row failed.
//
// Pure on purpose: no DOM, no browser API, so every rule here is unit tested
// rather than discovered on a portal.
// ============================================================

import type { ExportSource } from "./page-context";

/** The label a row that carries no name at all is reported under. */
export const UNIDENTIFIED_ROW_NAME = "(tanpa identitas)";

/**
 * The two spellings the withholding slip number arrives under.
 *
 * The bulk-PDF flow carries the singular one and the grid capture the plural
 * one, and a slip can arrive with either — so both are read, in that order,
 * wherever the number is needed. One list, so a name and an exported column
 * cannot disagree about which spelling a slip carries.
 */
export const WITHHOLDING_SLIP_NUMBER_FIELDS = [
  "WithholdingSlipNumber",
  "WithholdingSlipsNumber",
] as const;

/**
 * How one export source names a row.
 *
 * Two lists because a row has two names in a file: the row's own, and the
 * invoice it belongs to. Which fields those are is a fact about the GRID, and
 * it is declared here rather than spelled out again in the file builders.
 */
export interface RowNameSpec {
  /** The fields that NAME the row, in priority order. */
  readonly name: readonly string[];
  /** The fields that carry the INVOICE number, in priority order. */
  readonly invoice: readonly string[];
}

/** The e-faktur grids name a row by its Referensi. */
const EFakturName = ["Reference"] as const;
/** A retur names a row by its return number, and only then by the others. */
const ReturName = ["ReturnNumber", "Reference", "DocumentNumber"] as const;
/** A Bukti Potong names a slip by its slip number, in either spelling. */
const WithholdingName = [...WITHHOLDING_SLIP_NUMBER_FIELDS, "DocumentNumber"] as const;
/**
 * The fallback for a grid with no rule of its own: every field that can name a
 * row anywhere, in the order the rows carry them.
 */
const DefaultName = [
  "Reference",
  "TaxInvoiceNumber",
  "LetterNumber",
  "ReturnNumber",
  "DocumentNumber",
  ...WITHHOLDING_SLIP_NUMBER_FIELDS,
] as const;

/**
 * How each export source names a row.
 *
 * A `Record`, so a grid added to the export sources without a row here does
 * not compile — the same rule the export source spec and the panel's grid table
 * follow.
 */
export const ROW_NAME_SPECS: Record<ExportSource, RowNameSpec> = {
  OUTPUT_TAX: { name: EFakturName, invoice: ["LetterNumber", "TaxInvoiceNumber"] },
  INPUT_TAX: { name: EFakturName, invoice: ["TaxInvoiceNumber", "LetterNumber"] },
  OUTPUT_RETURN: {
    name: ReturName,
    invoice: ["TaxInvoiceNumber", "LetterNumber", "ReturnInvoiceNumber"],
  },
  INPUT_RETURN: {
    name: ReturName,
    invoice: ["TaxInvoiceNumber", "LetterNumber", "ReturnInvoiceNumber"],
  },
  WITHHOLDING_SLIPS: { name: WithholdingName, invoice: [] },
  SPT_A2: { name: DefaultName, invoice: [] },
  SPT_B2: { name: DefaultName, invoice: [] },
  PPH_21_L1A: { name: DefaultName, invoice: [] },
  PPH_21_L1B: { name: DefaultName, invoice: [] },
  PPH_21_L2: { name: DefaultName, invoice: [] },
  PPH_21_L3: { name: DefaultName, invoice: [] },
};

/** The rule for a source, or the fallback for one this module does not know. */
function specOf(source: ExportSource | string): RowNameSpec {
  return ROW_NAME_SPECS[source as ExportSource] ?? { name: DefaultName, invoice: [] };
}

/** A field's value as text — blank for a value that is absent or empty. */
function text(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

/** The first of these fields the row carries, or "" when it carries none. */
function firstOf(row: Record<string, unknown>, fields: readonly string[]): string {
  for (const field of fields) {
    const value = text(row, field);
    if (value) return value;
  }
  return "";
}

/**
 * The row's own name — the first naming field it carries, or "".
 *
 * This is the file's first slot: the token the download is named after.
 */
export function rowName(row: Record<string, unknown>, source: ExportSource | string): string {
  return firstOf(row, specOf(source).name);
}

/**
 * The invoice number the row belongs to, or "" when it carries none.
 *
 * This is the file's second slot — a different fact from the row's name, and
 * a different list: PPN Keluaran's invoice is the LetterNumber, PPN Masukan's
 * is the TaxInvoiceNumber, and a credit note names the invoice it credits.
 */
export function rowInvoiceNumber(
  row: Record<string, unknown>,
  source: ExportSource | string,
): string {
  return firstOf(row, specOf(source).invoice);
}

/**
 * The label a row is REPORTED under — the name, else the invoice number, else
 * the label for a row that carries neither.
 *
 * The panel's progress line and failure list read this, and the file's two
 * slots are drawn from the same two lists, so the label is always a token the
 * file carries too. That is what lets a run that says "4 gagal" name four rows
 * the downloads folder also holds.
 */
export function rowLabel(
  row: Record<string, unknown>,
  source: ExportSource | string,
): string {
  const spec = specOf(source);
  return firstOf(row, spec.name) || firstOf(row, spec.invoice) || UNIDENTIFIED_ROW_NAME;
}
