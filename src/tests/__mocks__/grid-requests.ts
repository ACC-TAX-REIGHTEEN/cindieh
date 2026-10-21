// ============================================================
// GRID-REQUESTS.TS — one captured grid request per e-Faktur grid
// ============================================================
// Every question this suite asks about a grid starts from the SAME two pieces
// of evidence: the request the portal sent for it (which the sweep's filter
// readers and its scope guard read) and the response row it answers with (which
// the export column mapping reads). Before this file each test wrote its own
// JSON for both, which meant the portal's shape was re-invented in a dozen
// places and a test could pass against a body no request ever looked like.
//
// So the shapes live here, one entry per e-Faktur grid (the four ADR-0019
// scopes the year-wide export to), and consumers take them from here:
//
//   readers  : capturedPeriod / capturedYear / readSweepFilters
//              (scrape-batch, via rawBodyOf / rawBodyWithFilters)
//   guard    : batchScopeError / overridesForPeriod  (same body)
//   columns  : processData / mapColumns              (gridRows / gridRow)
//
// PROVENANCE IS THE POINT OF THE FILE, AND EVERY ENTRY DECLARES IT. `captured`
// means rawBody was read verbatim off a live Coretax session on `capturedOn` —
// it is a claim about the portal, and the only kind of claim that may grow
// MEASURED_SWEEP_FILTERS. `captured: false` means the entry is a STAND-IN whose
// filter spellings are placeholders: it exists so tests share one body instead
// of scattering JSON literals, and citing it as a measurement would be exactly
// the guess ADR-0019 forbids. Same for `rowsCaptured`: the canonical rows below
// are the ones the column tests used before this seam existed, moved verbatim.
//
// Replacing an entry with a real capture is a drop-in: paste the body, set
// `captured`, `capturedOn` and `url` (the test asserts all three move
// together), and `grid-requests.unit.test.ts` re-checks the entry against the
// measured table and the guard. The stand-in's `rawBody` is then deleted, not
// left beside the capture to be reached by accident.
// ============================================================

import type { ExportSource } from "../../content/page-context";
import { MEASURED_SWEEP_FILTERS } from "../../content/scrape-batch";

/** The four e-Faktur PPN grids the year-wide export is scoped to (ADR-0019). */
export const EFAKTUR_SOURCES = [
  "OUTPUT_TAX",
  "INPUT_TAX",
  "OUTPUT_RETURN",
  "INPUT_RETURN",
] as const;

export type EfakturSource = (typeof EFAKTUR_SOURCES)[number] & ExportSource;

/** One entry of the portal's `body.Filters` array, as the request carries it. */
export interface GridFilter {
  PropertyName?: string;
  Value?: unknown;
  MatchMode?: string;
  CaseSensitive?: boolean;
}

/** Evidence about one grid: the request it is served by, and a row it answers with. */
export interface GridRequestFixture {
  /** The grid, which is the argument every reader takes. */
  source: EfakturSource;
  /** Endpoint the portal posted to, or null while the entry is a stand-in. */
  url: string | null;
  /** The request body, as sent (stringified). */
  rawBody: string;
  /** True only when `rawBody` came verbatim off a live portal session. */
  captured: boolean;
  /** The date of that capture; null for a stand-in. Set iff `captured`. */
  capturedOn: string | null;
  /** The canonical response row the export-column tests map. */
  rows: Record<string, unknown>[];
  /** True when `rows` was read off a captured response rather than written here. */
  rowsCaptured: boolean;
}

/**
 * The request body the portal sent for PPN Keluaran on 2026-10-06, posted to
 * /einvoiceportal/api/outputinvoice/list. Transcribed as captured — it is the
 * one body in this project that is known to be the real thing, and the reason
 * the sweep's measured names (`TaxInvoicePeriod`/`TaxInvoiceYear`) are known at
 * all.
 */
const OUTPUT_TAX_RAW_BODY = JSON.stringify({
  SellerTaxpayerAggregateIdentifier: "seller-1",
  First: 0,
  Rows: 50,
  SortField: "TaxInvoiceDate",
  SortOrder: "desc",
  LanguageId: "id-ID",
  TaxpayerAggregateIdentifier: "taxpayer-1",
  Filters: [
    { PropertyName: "TaxInvoicePeriod", Value: "TD.00708", MatchMode: "equals", CaseSensitive: true },
    { PropertyName: "TaxInvoiceYear", Value: "2026", MatchMode: "equals", CaseSensitive: true },
    {
      PropertyName: "TaxInvoiceStatus",
      Value: ["CREATED", "APPROVED", "SAVED_INVALID"],
      MatchMode: "contains",
      CaseSensitive: true,
    },
  ],
});

/**
 * The request body the portal sent for PPN Masukan on 2026-10-21, posted to
 * /einvoiceportal/api/inputinvoice/list.
 *
 * Transcribed as captured, with the taxpayer's own aggregate identifier
 * replaced by a placeholder. Two things here are NOT the PPN Keluaran shape,
 * and both were measured on the portal (ADR-0043):
 *
 * - `TaxInvoicePeriod` carries a LIST of codes (`["TD.00709"]`) with MatchMode
 *   "contains" — the portal's own multi-select, one element for the month that
 *   was selected. The sweep reads the first code and writes ONE code back as a
 *   plain string, which is the write the portal was measured honouring.
 * - `SortField` is empty and `SortOrder` the number 1, where PPN Keluaran
 *   sends "TaxInvoiceDate"/"desc". Nothing in the sweep depends on the sort.
 */
const INPUT_TAX_RAW_BODY = JSON.stringify({
  BuyerTaxpayerAggregateIdentifier: "buyer-1",
  First: 0,
  Rows: 50,
  SortField: "",
  SortOrder: 1,
  LanguageId: "id-ID",
  TaxpayerAggregateIdentifier: "taxpayer-1",
  Filters: [
    {
      PropertyName: "TaxInvoicePeriod",
      Value: ["TD.00709"],
      MatchMode: "contains",
      CaseSensitive: true,
      AsString: false,
    },
    {
      PropertyName: "TaxInvoiceYear",
      Value: "2026",
      MatchMode: "equals",
      CaseSensitive: true,
      AsString: false,
    },
  ],
});

/**
 * The request body the portal sent for Retur PPN Masukan on 2026-10-21, posted
 * to /einvoiceportal/api/inputreturn/list.
 *
 * Transcribed as captured, with the taxpayer's own aggregate identifier
 * replaced by a placeholder. The filters are the same two names as the other
 * measured grids, and the period is a LIST of codes (ADR-0043) — but the YEAR
 * filter's MatchMode is "contains" here, where PPN Masukan's is "equals". The
 * extension carries MatchMode through untouched, so that difference changes
 * nothing in the sweep; it is recorded because a measurement is a record of
 * what the portal sent.
 */
const INPUT_RETURN_RAW_BODY = JSON.stringify({
  BuyerTaxpayerAggregateIdentifier: "buyer-1",
  First: 0,
  Rows: 50,
  SortField: "",
  SortOrder: 1,
  LanguageId: "id-ID",
  TaxpayerAggregateIdentifier: "taxpayer-1",
  Filters: [
    {
      PropertyName: "TaxInvoicePeriod",
      Value: ["TD.00709"],
      MatchMode: "contains",
      CaseSensitive: true,
      AsString: false,
    },
    {
      PropertyName: "TaxInvoiceYear",
      Value: "2026",
      MatchMode: "contains",
      CaseSensitive: true,
      AsString: false,
    },
  ],
});

/**
 * A stand-in body for a grid whose request has never been captured.
 *
 * It parses, it carries two filters, and its filter names are deliberately NOT
 * the measured spellings — so no test can pass by quietly assuming this grid
 * behaves like PPN Keluaran, and nobody can read a placeholder and think the
 * portal was asked. Replacing it is the whole job of the measurement loop
 * (ADR-0019, tools/README.md).
 */
function standInBody(): string {
  return JSON.stringify({
    First: 0,
    Rows: 50,
    SortField: "",
    SortOrder: "",
    LanguageId: "id",
    TaxpayerAggregateIdentifier: "taxpayer-id",
    Filters: [
      { PropertyName: "Period", Value: "TD.00708", MatchMode: "equals", CaseSensitive: true },
      { PropertyName: "Year", Value: "2026", MatchMode: "equals", CaseSensitive: true },
    ],
  });
}

function standIn(source: EfakturSource, rows: Record<string, unknown>[]): GridRequestFixture {
  return {
    source,
    url: null,
    rawBody: standInBody(),
    captured: false,
    capturedOn: null,
    rows,
    rowsCaptured: false,
  };
}

/**
 * One entry per e-Faktur grid. Typed as a full `Record`, so a grid that joins
 * the e-Faktur family cannot ship without a fixture.
 *
 * The `rows` below are the canonical rows the export-column tests used before
 * this seam existed; they are moved verbatim, not re-sourced. None has been
 * read off a captured response yet (`rowsCaptured` says so on every entry).
 */
export const GRID_REQUESTS: Record<EfakturSource, GridRequestFixture> = {
  OUTPUT_TAX: {
    source: "OUTPUT_TAX",
    url: "https://coretaxdjp.pajak.go.id/einvoiceportal/api/outputinvoice/list",
    rawBody: OUTPUT_TAX_RAW_BODY,
    captured: true,
    capturedOn: "2026-10-06",
    rows: [
      {
        TaxInvoiceDate: "2026-04-15T00:00:00+07:00",
        TaxInvoicePeriod: "04",
        TaxInvoiceYear: "2026",
        BuyerName: "PT Maju Jaya",
        BuyerTIN: "123456789",
        TaxInvoiceNumber: "0400000001",
        TaxInvoiceStatus: "Normal",
        BuyerStatus: "PKP",
        SellingPrice: 568000,
        OtherTaxBase: 0,
        VAT: 62480,
        STLG: 0,
        Reference: "REF-001",
        ExtraField: "should be dropped",
      },
    ],
    rowsCaptured: false,
  },
  INPUT_TAX: {
    source: "INPUT_TAX",
    url: "https://coretaxdjp.pajak.go.id/einvoiceportal/api/inputinvoice/list",
    rawBody: INPUT_TAX_RAW_BODY,
    captured: true,
    capturedOn: "2026-10-21",
    rows: [
      {
        TaxInvoiceDate: "2026-03-10T00:00:00+07:00",
        TaxInvoicePeriod: "TD.00703",
        TaxInvoiceYear: "2026",
        SellerTaxpayerName: "PT Supplier",
        SellerTIN: "987654321",
        TaxInvoiceNumber: "0100000999",
        TaxInvoiceStatus: "APPROVED",
        BuyerStatus: "CREDITED",
        PeriodCredit: "TD.00704",
        YearCredit: "2026",
        SellingPrice: 1000000,
        OtherTaxBase: 916667,
        VAT: 110000,
        STLG: 0,
        Reference: "REF-IN-001",
        ExtraField: "should be dropped",
      },
    ],
    rowsCaptured: false,
  },
  OUTPUT_RETURN: standIn("OUTPUT_RETURN", [
    {
      BuyerTIN: "0639343490201000",
      BuyerTaxpayerNameClear: "PT Buyer Clear",
      TaxInvoiceNumber: "0400000123",
      TaxInvoiceDate: "2026-06-18T00:00:00+07:00",
      ReturnNumber: "RET-OUT-001",
      ReturnDate: "2026-07-01T00:00:00+07:00",
      TaxInvoicePeriod: "TD.00706",
      TaxInvoiceYear: "2026",
      BuyerStatus: "CREDITED",
      TaxInvoiceStatus: "APPROVED",
      SellingPrice: 291215,
      OtherTaxBase: 266947,
      VAT: 32034,
      STLG: 0,
      ExtraField: "should be dropped",
    },
  ]),
  INPUT_RETURN: {
    source: "INPUT_RETURN",
    url: "https://coretaxdjp.pajak.go.id/einvoiceportal/api/inputreturn/list",
    rawBody: INPUT_RETURN_RAW_BODY,
    captured: true,
    capturedOn: "2026-10-21",
    rows: [
      {
        SellerTIN: "0016232159201000",
        SellerTaxpayerName: "PT Seller",
        TaxInvoiceNumber: "0100000123",
        TaxInvoiceDate: "2026-06-18T00:00:00+07:00",
        ReturnNumber: "RET-IN-001",
        ReturnDate: "2026-07-02T00:00:00+07:00",
        TaxInvoicePeriod: "TD.00706",
        TaxInvoiceYear: "2026",
        BuyerStatus: "CREDITED",
        TaxInvoiceStatus: "APPROVED",
        SellingPrice: 1000000,
        OtherTaxBase: 916667,
        VAT: 110000,
        STLG: 0,
        ExtraField: "should be dropped",
      },
    ],
    rowsCaptured: false,
  },
};

/** One grid's fixture. Throws when asked for a grid that has none — silent
 *  `undefined` would push the caller back to writing its own JSON. */
export function gridRequest(source: EfakturSource): GridRequestFixture {
  const fixture = GRID_REQUESTS[source];
  if (!fixture) throw new Error(`no grid request fixture for ${source}`);
  return fixture;
}

/** The grid's request body, as sent. */
export function rawBodyOf(source: EfakturSource): string {
  return gridRequest(source).rawBody;
}

/** Parsed body of the fixture — the copy readers and guards see. */
function parseBodyOf(source: EfakturSource): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawBodyOf(source)) as unknown;
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch {
    /* fall through to the error below: a fixture that will not parse is a bug here */
  }
  throw new Error(`the ${source} fixture body does not parse as an object`);
}

/** The filters the captured body carries (a copy; the fixture is never mutated). */
export function capturedFilters(source: EfakturSource): GridFilter[] {
  const filters = parseBodyOf(source).Filters;
  return Array.isArray(filters) ? structuredClone(filters as GridFilter[]) : [];
}

/**
 * The captured body with its `Filters` replaced.
 *
 * Tests that need a body WITHOUT its period filter — the refusal cases — start
 * from the portal's own shape and take one filter away, instead of describing
 * a request that never existed from scratch.
 */
export function rawBodyWithFilters(source: EfakturSource, filters: GridFilter[]): string {
  return rawBodyWith(source, { Filters: filters });
}

/** The captured body with one top-level key changed; `undefined` removes it. */
export function rawBodyWith(source: EfakturSource, patch: Record<string, unknown>): string {
  return JSON.stringify({ ...parseBodyOf(source), ...patch });
}

/**
 * The captured body with the measured period/year filter values set — the body
 * the sweep re-requests one month of one year with.
 *
 * The names come from MEASURED_SWEEP_FILTERS rather than from string literals
 * here, so a renamed filter cannot leave this helper silently editing nothing
 * (the guard, not the fixture, would then be the first thing to notice).
 */
export function rawBodyWithSweep(
  source: EfakturSource,
  values: { period?: string; year?: string },
): string {
  const measurement = MEASURED_SWEEP_FILTERS[source];
  if (!measurement) throw new Error(`${source} has no measured sweep filters to set`);
  const filters = capturedFilters(source).map((filter) => {
    if (values.period !== undefined && filter.PropertyName === measurement.period) {
      return { ...filter, Value: values.period };
    }
    if (values.year !== undefined && filter.PropertyName === measurement.year) {
      return { ...filter, Value: values.year };
    }
    return filter;
  });
  return rawBodyWithFilters(source, filters);
}

/**
 * The captured body with the measured period (or year) filter taken away —
 * the refusal cases, expressed as "the portal's request minus one filter"
 * rather than as a request no grid ever made.
 */
export function rawBodyWithoutSweepFilter(source: EfakturSource, side: "period" | "year"): string {
  const measurement = MEASURED_SWEEP_FILTERS[source];
  if (!measurement) throw new Error(`${source} has no measured sweep filter to remove`);
  const name = measurement[side];
  return rawBodyWithFilters(
    source,
    capturedFilters(source).filter((filter) => filter.PropertyName !== name),
  );
}

/** Every response row the fixture carries for a grid (deep copies). */
export function gridRows(source: EfakturSource): Record<string, unknown>[] {
  return structuredClone(gridRequest(source).rows);
}

/** The first canonical row for a grid — the one the column mapping tests use. */
export function gridRow(source: EfakturSource): Record<string, unknown> {
  const row = gridRows(source)[0];
  if (!row) throw new Error(`no row in the ${source} fixture`);
  return row;
}
