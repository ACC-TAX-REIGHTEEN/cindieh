// Unit tests for the batch helpers around scrape-batch's reader and guard:
// the requested-month normaliser, the captured-year reader, and the per-grid
// table of MEASURED sweep filters.
//
// The table is the point of the suite. A sweep may only run on a grid whose
// filter names were read off the portal, so most of what is asserted here is
// the refusal: an unmeasured grid refuses even when its request carries the
// measured spellings, because a lookalike is not a measurement.
import { describe, expect, it } from "vitest";
import type { ExportSource } from "../content/page-context";
import { GRID_FILTER_NAMES } from "../content/grid-request";
import {
  MEASURED_SWEEP_FILTERS,
  batchMonthCount,
  batchScopeError,
  capturedPeriod,
  capturedYear,
  describeSweepFilters,
  measuredSweepFilters,
  overridesForPeriod,
  periodPrefix,
  planPeriods,
  readSweepFilters,
  resumePeriodCodes,
} from "../content/scrape-batch";
import {
  capturedFilters,
  rawBodyOf,
  rawBodyWith,
  rawBodyWithFilters,
  type EfakturSource,
  type GridFilter,
} from "./__mocks__/grid-requests";

/** The only measured grid. */
const SOURCE: EfakturSource = "OUTPUT_TAX";

/** The grids whose filters have been read off the portal. */
const MEASURED: EfakturSource[] = ["OUTPUT_TAX", "INPUT_TAX", "INPUT_RETURN", "OUTPUT_RETURN"];

/**
 * Sources with no measured row — and the sweep is an e-Faktur feature, so
 * these are the other families. The guard's answer for them is the one every
 * unmeasured grid gets, which is what these cases hold.
 */
const UNMEASURED: ExportSource[] = ["SPT_A2", "WITHHOLDING_SLIPS"];

/** The measured names, read from the table so a rename cannot drift silently. */
const PERIOD_PROPERTY = MEASURED_SWEEP_FILTERS.OUTPUT_TAX?.period ?? "";
const YEAR_PROPERTY = MEASURED_SWEEP_FILTERS.OUTPUT_TAX?.year ?? "";

/**
 * The captured body with its filters swapped: the portal's own request around
 * whatever filter list a scenario needs, instead of a body written from scratch.
 */
function body(filters: GridFilter[]): string {
  return rawBodyWithFilters(SOURCE, filters);
}

describe("resumePeriodCodes", () => {
  it("keeps the codes that look like a period, once each", () => {
    expect(resumePeriodCodes(["TD.00711", "TD.00711", "TD.00712"])).toEqual([
      "TD.00711",
      "TD.00712",
    ]);
  });

  it.each([
    ["not an array", "TD.00711"],
    ["an empty array", []],
    ["nothing usable", ["nope", 42, null, ""]],
    ["a month without a prefix", ["12"]],
    ["undefined", undefined],
    ["null", null],
  ])("is undefined for %s — no resume, so the run stays a fresh sweep", (_label, value) => {
    expect(resumePeriodCodes(value)).toBeUndefined();
  });

  it("drops the unusable entries and keeps the rest", () => {
    // A list that crossed a world boundary: one bad code must not cost the whole
    // resume, and a prefix the portal never sent is dropped by the caller's
    // narrowing against the year plan, not kept on trust here.
    expect(resumePeriodCodes(["XX.99911", "TD.00711", 7])).toEqual([
      "XX.99911",
      "TD.00711",
    ]);
  });
});

describe("batchMonthCount", () => {
  it("accepts a whole year", () => {
    expect(batchMonthCount(12)).toBe(12);
  });

  it("accepts a partial year", () => {
    expect(batchMonthCount(3)).toBe(3);
  });

  it("truncates a fractional count rather than rounding up into a 13th month", () => {
    expect(batchMonthCount(3.9)).toBe(3);
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["more than a year", 13],
    ["far past a year", 5000],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a numeric string", "12"],
    ["null", null],
    ["undefined", undefined],
    ["a boolean", true],
    ["an object", { months: 12 }],
  ])("rejects %s — not a batch, so the run stays an ordinary scrape", (_label, value) => {
    expect(batchMonthCount(value)).toBeUndefined();
  });
});

describe("the measured sweep-filter table", () => {
  // These two names are the measurement ADR-0019 asked for, taken off the live
  // portal on 2026-10-06. Pinned literally: a rename without a fresh measurement
  // would be a guess, and a guess here issues twelve requests for months nobody
  // confirmed the endpoint honours.
  it.each(MEASURED)("records %s's measured filter names", (source) => {
    expect(MEASURED_SWEEP_FILTERS[source]).toEqual({
      period: "TaxInvoicePeriod",
      year: "TaxInvoiceYear",
    });
  });

  it("keeps the measured names readable, so a rename cannot drift silently", () => {
    expect(PERIOD_PROPERTY).not.toBe("");
    expect(YEAR_PROPERTY).not.toBe("");
  });

  it("names the filters the FILE's name is read from, so the two cannot disagree", () => {
    // The sweep's SCOPE finds the period by its measured name; the FILE's name
    // finds it by the names in grid-request.ts. If a measured name were not
    // among them, the two would answer differently about the SAME body — the
    // file named after one filter while the rows came from another.
    expect(GRID_FILTER_NAMES.period).toContain(PERIOD_PROPERTY);
    expect(GRID_FILTER_NAMES.year).toContain(YEAR_PROPERTY);
  });

  it.each(UNMEASURED)("has no row for %s, which is what refuses the sweep", (source) => {
    expect(measuredSweepFilters(source)).toBeNull();
    // And the table itself says so, rather than the row being an empty object
    // some later reader could treat as a measurement.
    expect(MEASURED_SWEEP_FILTERS[source]).toBeUndefined();
  });

  it.each([
    ["no source at all", null],
    ["an undefined source", undefined],
    ["a source outside the e-Faktur grids", "WITHHOLDING_SLIPS" as ExportSource],
  ])("answers null for %s", (_label, source) => {
    expect(measuredSweepFilters(source)).toBeNull();
  });
});

describe("capturedYear", () => {
  it("reads the year the grid is filtered to", () => {
    // The capture itself: period and year as the portal sent them.
    expect(capturedYear(rawBodyOf(SOURCE), SOURCE)).toBe("2026");
  });

  it("accepts a numeric year, which is how a JSON body would carry it", () => {
    expect(capturedYear(body([{ PropertyName: YEAR_PROPERTY, Value: 2026 }]), SOURCE)).toBe("2026");
  });

  it.each([
    ["no filters at all", rawBodyWith(SOURCE, { Filters: undefined })],
    ["an empty filter list", body([])],
    ["no year filter", body([{ PropertyName: PERIOD_PROPERTY, Value: "TD.00708" }])],
    ["a non-year value", body([{ PropertyName: YEAR_PROPERTY, Value: "TD.00708" }])],
    ["a two-digit year", body([{ PropertyName: YEAR_PROPERTY, Value: "26" }])],
    ["a year with trailing text", body([{ PropertyName: YEAR_PROPERTY, Value: "2026 SPT" }])],
    ["a null value", body([{ PropertyName: YEAR_PROPERTY, Value: null }])],
    ["unparseable JSON", "{not json"],
    ["an empty string", ""],
  ])("returns null for %s — a wrong year is worse than none", (_label, raw) => {
    expect(capturedYear(raw, SOURCE)).toBeNull();
  });

  it("agrees with capturedPeriod about which filters the body actually carries", () => {
    // Both readers walk the same array; if one found a value the other missed,
    // the batch would be named for a period it never swept, or vice versa.
    const raw = body([
      { PropertyName: "TaxInvoiceStatus", Value: ["CREATED"] },
      { PropertyName: YEAR_PROPERTY, Value: "2026" },
      { PropertyName: PERIOD_PROPERTY, Value: "TD.00708" },
    ]);
    expect(capturedYear(raw, SOURCE)).toBe("2026");
    expect(capturedPeriod(raw, SOURCE)).toBe("TD.00708");
  });

  it.each(UNMEASURED)("reads no year on %s, because no study says where it lives", (source) => {
    // Two bodies: the PPN Keluaran capture, and the same capture with the
    // measured spellings dropped in — the request looks exactly like a measured
    // grid's. Neither is read, because nobody has confirmed this endpoint
    // honours those names.
    const measuredNames = rawBodyWithFilters(SOURCE, capturedFilters(SOURCE));
    expect(capturedYear(rawBodyOf(SOURCE), source)).toBeNull();
    expect(capturedPeriod(rawBodyOf(SOURCE), source)).toBeNull();
    expect(capturedYear(measuredNames, source)).toBeNull();
    expect(capturedPeriod(measuredNames, source)).toBeNull();
  });
});

describe("batchScopeError — the measured grid", () => {
  // The measured grid's own capture: it carries both filters, so it is the
  // request that satisfies the guard — a fixture the readers are proved
  // against, not a body built to please them.
  const BOTH = rawBodyOf(SOURCE);

  it("lets a sweep run when the request carries the period and the year", () => {
    expect(batchScopeError(BOTH, SOURCE)).toBeNull();
  });

  it("names the missing PERIOD, which would sweep one month twelve times", () => {
    const raw = body([{ PropertyName: YEAR_PROPERTY, Value: "2026" }]);
    // The message names the filter the table expects, so the fix is obvious and
    // a stale table is visible instead of mysterious.
    expect(batchScopeError(raw, SOURCE)).toContain(PERIOD_PROPERTY);
  });

  it("names the missing YEAR, which the period code does not carry itself", () => {
    const raw = body([{ PropertyName: PERIOD_PROPERTY, Value: "TD.00708" }]);
    expect(batchScopeError(raw, SOURCE)).toContain(YEAR_PROPERTY);
  });

  it.each([
    ["unparseable JSON", "{not json"],
    ["an empty string", ""],
    ["a body with no filters", rawBodyWith(SOURCE, { Filters: undefined })],
    ["an empty filter list", body([])],
    ["a period value that is not a code", body([
      { PropertyName: PERIOD_PROPERTY, Value: "Agustus" },
      { PropertyName: YEAR_PROPERTY, Value: "2026" },
    ])],
  ])("refuses %s rather than sweeping something unnamed", (_label, raw) => {
    expect(batchScopeError(raw, SOURCE)).not.toBeNull();
  });

  it("accepts a numeric year, the way capturedYear does", () => {
    const raw = body([
      { PropertyName: PERIOD_PROPERTY, Value: "TD.00708" },
      { PropertyName: YEAR_PROPERTY, Value: 2026 },
    ]);
    expect(batchScopeError(raw, SOURCE)).toBeNull();
  });

  it("distinguishes an unreadable period value from a missing filter", () => {
    // Unreadable is not the same as absent: nothing here can be swept, but the
    // filter IS there, so the message must not send the user hunting for it.
    const raw = body([
      { PropertyName: PERIOD_PROPERTY, Value: "2026-07" },
      { PropertyName: YEAR_PROPERTY, Value: "2026" },
    ]);
    expect(batchScopeError(raw, SOURCE)).toMatch(/belum dikenali/);
    expect(batchScopeError(raw, SOURCE)).not.toContain(`tidak punya filter ${PERIOD_PROPERTY}`);
  });
});

describe("a grid that was never measured", () => {
  // This is the whole point of the table: no hint, no value shape and no
  // similar-sounding property name buys a sweep on a grid nobody has read.
  // The measured grid's capture, dropped into an unmeasured grid's reader:
  // perfectly ordinary filters, still refused — because what is missing is a
  // row for THIS grid, not a filter its body happens to carry.
  const LOOKS_RIGHT = rawBodyOf(SOURCE);

  it.each(UNMEASURED)("refuses %s even when the request carries the measured names", (source) => {
    const error = batchScopeError(LOOKS_RIGHT, source);
    expect(error).not.toBeNull();
    expect(error).toMatch(/belum pernah diukur/);
    // Not a complaint about this request's filters: the grid itself is the
    // reason, and the message has to say so or the user keeps re-trying.
    expect(error).not.toContain("tidak punya filter");
  });

  it("refuses a grid whose filters are spelled differently, which used to pass", () => {
    // The removed hint door accepted this on a name plus a value in the measured
    // shape. A lookalike name is not evidence that the endpoint honours it.
    const raw = rawBodyOf(SOURCE);
    expect(batchScopeError(raw, "SPT_A2")).toMatch(/belum pernah diukur/);
    expect(capturedPeriod(raw, "SPT_A2")).toBeNull();
    expect(capturedYear(raw, "SPT_A2")).toBeNull();
  });

  it("never mistakes an invoice-number filter for the period, however its value ends", () => {
    // `010.000-26.00000012` ends in a month-looking pair too. It is not a
    // candidate on any grid, measured or not.
    const raw = body([
      { PropertyName: "TaxInvoiceNumber", Value: "010.000-26.00000012" },
      { PropertyName: YEAR_PROPERTY, Value: "2026" },
    ]);
    expect(capturedPeriod(raw, SOURCE)).toBeNull();
    expect(batchScopeError(raw, SOURCE)).toContain(PERIOD_PROPERTY);
  });

  it("never sweeps by a credit period, which is a different period entirely", () => {
    // PPN Masukan's request may carry the credit period beside the document
    // period. The grid is measured now, and only its RECORDED name counts: a
    // body carrying "PeriodCredit" carries no period at all, so the sweep is
    // refused rather than run on the credit's month.
    const raw = body([
      { PropertyName: "PeriodCredit", Value: "TD.00703" },
      { PropertyName: "YearCredit", Value: "2026" },
    ]);
    expect(capturedPeriod(raw, "INPUT_TAX")).toBeNull();
    expect(capturedYear(raw, "INPUT_TAX")).toBeNull();
    expect(batchScopeError(raw, "INPUT_TAX")).toContain("TaxInvoicePeriod");
  });
});

describe("the reading the guard decides on", () => {
  // A refusal is still the measurement: the log line names what the request
  // carries so the missing row can be written from it. That makes the reading
  // the artifact to pin, not just an implementation detail.

  it("reports the measured row, the filters, and everything else the request had", () => {
    // The capture: period, year and status — exactly the filters the line below
    // names, in the order the portal sent them.
    const measured = rawBodyOf(SOURCE);
    expect(readSweepFilters(measured, SOURCE)).toEqual({
      measurement: { period: PERIOD_PROPERTY, year: YEAR_PROPERTY },
      period: { name: PERIOD_PROPERTY, value: "TD.00708" },
      year: { name: YEAR_PROPERTY, value: "2026" },
      seen: [PERIOD_PROPERTY, YEAR_PROPERTY, "TaxInvoiceStatus"],
    });
    // Pinned as a whole because the line IS the artifact the portal loop reads
    // back: a reworded log is a changed instruction to whoever measures next.
    expect(describeSweepFilters(measured, SOURCE)).toBe(
      `period=${PERIOD_PROPERTY}=TD.00708 · year=${YEAR_PROPERTY}=2026 · ` +
        `filters seen: ${PERIOD_PROPERTY}, ${YEAR_PROPERTY}, TaxInvoiceStatus`,
    );
  });

  it("says the grid is unmeasured, and names what its request carries", () => {
    // A request that looks like a measured grid's, asked about a source that
    // has no row: the reading says "unmeasured" and still names the filters
    // the request carries.
    const raw = rawBodyOf(SOURCE);
    expect(readSweepFilters(raw, "SPT_A2")).toEqual({
      measurement: null,
      period: null,
      year: null,
      seen: [PERIOD_PROPERTY, YEAR_PROPERTY, "TaxInvoiceStatus"],
    });
    expect(describeSweepFilters(raw, "SPT_A2")).toBe(
      "grid belum terukur · filters seen: TaxInvoicePeriod, TaxInvoiceYear, TaxInvoiceStatus",
    );
  });

  it("reports a measured period filter whose value is in no known format", () => {
    // A measured grid whose spelling moved: the filter is not missing, its VALUE
    // is outside the family periodPrefix reads. Saying "no period filter" would
    // send the user hunting for one that is already there.
    const raw = body([
      { PropertyName: PERIOD_PROPERTY, Value: "Agustus" },
      { PropertyName: YEAR_PROPERTY, Value: "2026" },
    ]);
    expect(readSweepFilters(raw, SOURCE).period).toEqual({
      name: PERIOD_PROPERTY,
      value: "Agustus",
    });
    expect(describeSweepFilters(raw, SOURCE)).toContain(
      `period=${PERIOD_PROPERTY}=Agustus, value in no known format`,
    );
  });

  it.each([
    ["an empty value", ""],
    ["no value key at all", undefined],
  ])("reads a measured period filter that carries %s", (_label, value) => {
    const raw = body([
      { PropertyName: PERIOD_PROPERTY, Value: value },
      { PropertyName: YEAR_PROPERTY, Value: "2026" },
    ]);
    expect(readSweepFilters(raw, SOURCE).period).toEqual({
      name: PERIOD_PROPERTY,
      value: "",
    });
    expect(describeSweepFilters(raw, SOURCE)).toContain(
      `period=${PERIOD_PROPERTY}=, value in no known format`,
    );
    expect(batchScopeError(raw, SOURCE)).toMatch(/belum dikenali/);
  });

  it.each([
    ["an empty filter list", body([])],
    ["a body with no filters key", rawBodyWith(SOURCE, { Filters: undefined })],
    ["unparseable JSON", "{not json"],
    ["an empty string", ""],
  ])("reports nothing found in %s, without inventing a filter", (_label, raw) => {
    expect(readSweepFilters(raw, SOURCE)).toEqual({
      measurement: { period: PERIOD_PROPERTY, year: YEAR_PROPERTY },
      period: null,
      year: null,
      seen: [],
    });
    expect(describeSweepFilters(raw, SOURCE)).toBe(
      "period=none · year=none · filters seen: none",
    );
  });
});

describe("a period filter that carries a LIST of codes", () => {
  // PPN Masukan, Retur PPN Masukan and Retur PPN Keluaran send the selected
  // months as a LIST (`["TD.00709"]`, MatchMode "contains"), where PPN
  // Keluaran sends one string. The reader takes the FIRST code — the plan is
  // built from one code and the sweep writes one code back — and the guard must
  // not mistake a list for a missing filter (ADR-0043). Every list-shaped grid
  // is driven here, so a new one cannot learn the shape without a test of its
  // own.

  const LIST_GRIDS: { source: EfakturSource; code: string }[] = [
    { source: "INPUT_TAX", code: "TD.00709" },
    { source: "INPUT_RETURN", code: "TD.00709" },
    { source: "OUTPUT_RETURN", code: "TD.00702" },
  ];

  /** The grid's own measured names, read from the table so a rename cannot drift. */
  const names = (source: EfakturSource): { period: string; year: string } => ({
    period: MEASURED_SWEEP_FILTERS[source]?.period ?? "",
    year: MEASURED_SWEEP_FILTERS[source]?.year ?? "",
  });

  it.each(LIST_GRIDS)("reads the one code the plan is built from on $source", ({ source, code }) => {
    expect(capturedPeriod(rawBodyOf(source), source)).toBe(code);
    expect(capturedYear(rawBodyOf(source), source)).toBe("2026");
    expect(planPeriods(capturedPeriod(rawBodyOf(source), source) ?? "")).toEqual([
      "TD.00701", "TD.00702", "TD.00703", "TD.00704",
      "TD.00705", "TD.00706", "TD.00707", "TD.00708",
      "TD.00709", "TD.00710", "TD.00711", "TD.00712",
    ]);
  });

  it.each(LIST_GRIDS)(
    "reads the first code of a list that holds several on $source",
    ({ source }) => {
      // The user selected two months in the portal's own filter, so the capture
      // carries two codes. They share the prefix, so the plan is the same twelve
      // months — and the sweep replaces the whole filter with one code at a time.
      const { period, year } = names(source);
      const raw = rawBodyWithFilters(source, [
        {
          PropertyName: period,
          Value: ["TD.00709", "TD.00710"],
          MatchMode: "contains",
          CaseSensitive: true,
        },
        { PropertyName: year, Value: "2026", MatchMode: "equals", CaseSensitive: true },
      ]);
      expect(capturedPeriod(raw, source)).toBe("TD.00709");
      expect(batchScopeError(raw, source)).toBeNull();
    },
  );

  it.each(LIST_GRIDS)("refuses a list that carries no code at all on $source", ({ source }) => {
    const { period, year } = names(source);
    const raw = rawBodyWithFilters(source, [
      { PropertyName: period, Value: [], MatchMode: "contains", CaseSensitive: true },
      { PropertyName: year, Value: "2026", MatchMode: "equals", CaseSensitive: true },
    ]);
    expect(capturedPeriod(raw, source)).toBeNull();
    expect(batchScopeError(raw, source)).toMatch(/belum dikenali/);
  });

  it.each(LIST_GRIDS)(
    "writes one code back as a plain string on $source, which is what the portal reads",
    ({ source }) => {
      // Measured on the portal: the LIST is what the portal sends, the STRING is
      // what it reads. MatchMode, CaseSensitive and every other filter survive.
      const { period, year } = names(source);
      const overrides = overridesForPeriod(rawBodyOf(source), "TD.00701", 0, 500, source) as {
        Filters: Record<string, unknown>[];
        First: number;
        Rows: number;
      };
      expect(overrides.First).toBe(0);
      expect(overrides.Rows).toBe(500);
      expect(overrides.Filters[0]).toEqual({
        PropertyName: period,
        Value: "TD.00701",
        MatchMode: "contains",
        CaseSensitive: true,
        AsString: false,
      });
      // The year filter is carried through untouched — including its own
      // MatchMode, which is "equals" on PPN Masukan and "contains" on the two
      // Retur grids. The extension never rewrites it, so the captured one is
      // what must come back.
      const capturedYearFilter = capturedFilters(source).find(
        (filter) => filter.PropertyName === year,
      );
      expect(overrides.Filters[1]).toEqual(capturedYearFilter);
    },
  );

  it("refuses a value that is several codes joined into one string", () => {
    // The false positive this hardening closes: "TD.00709,TD.00710" used to
    // yield the prefix "TD.00709,TD.007" and twelve codes the portal has never
    // heard of — every one of them empty, and the sweep reporting a year of
    // nothing.
    expect(periodPrefix("TD.00709,TD.00710")).toBeNull();
    expect(periodPrefix("TD.00708")).toBe("TD.007");
  });

  it.each(LIST_GRIDS)("names the missing PERIOD on $source's own body", ({ source }) => {
    const { period, year } = names(source);
    const raw = rawBodyWithFilters(source, [
      { PropertyName: year, Value: "2026", MatchMode: "equals", CaseSensitive: true },
    ]);
    expect(batchScopeError(raw, source)).toContain(period);
  });

  it.each(LIST_GRIDS)("names the missing YEAR on $source's own body", ({ source }) => {
    const { period, year } = names(source);
    const raw = rawBodyWithFilters(source, [
      {
        PropertyName: period,
        Value: ["TD.00709"],
        MatchMode: "contains",
        CaseSensitive: true,
      },
    ]);
    expect(batchScopeError(raw, source)).toContain(year);
  });

  it.each(LIST_GRIDS)(
    "refuses a period value in no known format on $source's own body",
    ({ source }) => {
      const { period, year } = names(source);
      const raw = rawBodyWithFilters(source, [
        {
          PropertyName: period,
          Value: ["Agustus"],
          MatchMode: "contains",
          CaseSensitive: true,
        },
        { PropertyName: year, Value: "2026", MatchMode: "equals", CaseSensitive: true },
      ]);
      expect(batchScopeError(raw, source)).toMatch(/belum dikenali/);
    },
  );

  it.each(LIST_GRIDS)(
    "reports a list-valued period filter as the one code the plan uses on $source",
    ({ source, code }) => {
      const { period, year } = names(source);
      const raw = rawBodyOf(source);
      expect(readSweepFilters(raw, source)).toEqual({
        measurement: { period, year },
        period: { name: period, value: code },
        year: { name: year, value: "2026" },
        seen: [period, year],
      });
      expect(describeSweepFilters(raw, source)).toBe(
        `period=${period}=${code} · year=${year}=2026 · ` +
          `filters seen: ${period}, ${year}`,
      );
    },
  );
});
