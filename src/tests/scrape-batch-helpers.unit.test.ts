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
import {
  MEASURED_SWEEP_FILTERS,
  batchMonthCount,
  batchScopeError,
  capturedPeriod,
  capturedYear,
  describeSweepFilters,
  measuredSweepFilters,
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

/** The e-Faktur PPN grids with no measured row yet. */
const UNMEASURED: EfakturSource[] = ["INPUT_TAX", "OUTPUT_RETURN", "INPUT_RETURN"];

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
  it("records PPN Keluaran's measured filter names", () => {
    expect(MEASURED_SWEEP_FILTERS.OUTPUT_TAX).toEqual({
      period: "TaxInvoicePeriod",
      year: "TaxInvoiceYear",
    });
    expect(PERIOD_PROPERTY).not.toBe("");
    expect(YEAR_PROPERTY).not.toBe("");
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
    // Two bodies: the grid's own fixture, and the PPN Keluaran capture dropped
    // into it so the request carries the measured spellings as well. Neither is
    // read, because nobody has confirmed this endpoint honours those names.
    const measuredNames = rawBodyWithFilters(source, capturedFilters(SOURCE));
    expect(capturedYear(rawBodyOf(source), source)).toBeNull();
    expect(capturedPeriod(rawBodyOf(source), source)).toBeNull();
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
    // shape. The INPUT_TAX fixture's stand-in carries exactly that — a
    // period-named filter with a TD.007MM value — and it is now a refusal: a
    // lookalike name is not evidence that the endpoint honours it.
    const raw = rawBodyOf("INPUT_TAX");
    expect(batchScopeError(raw, "INPUT_TAX")).toMatch(/belum pernah diukur/);
    expect(capturedPeriod(raw, "INPUT_TAX")).toBeNull();
    expect(capturedYear(raw, "INPUT_TAX")).toBeNull();
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
    // period. Even with a row for that grid, only the recorded name would count;
    // today the grid has no row at all, and the credit spelling is just one more
    // filter in the reading.
    const raw = body([
      { PropertyName: "PeriodCredit", Value: "TD.00703" },
      { PropertyName: "YearCredit", Value: "2026" },
    ]);
    expect(capturedPeriod(raw, "INPUT_TAX")).toBeNull();
    expect(capturedYear(raw, "INPUT_TAX")).toBeNull();
    expect(batchScopeError(raw, "INPUT_TAX")).toMatch(/belum pernah diukur/);
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
    // The grid's own fixture, whose stand-in filters are named Period/Year.
    const raw = rawBodyOf("INPUT_TAX");
    expect(readSweepFilters(raw, "INPUT_TAX")).toEqual({
      measurement: null,
      period: null,
      year: null,
      seen: ["Period", "Year"],
    });
    expect(describeSweepFilters(raw, "INPUT_TAX")).toBe(
      "grid belum terukur · filters seen: Period, Year",
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
