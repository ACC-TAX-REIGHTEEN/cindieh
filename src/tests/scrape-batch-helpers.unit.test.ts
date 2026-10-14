// Unit tests for the batch helpers added after scrape-batch's first suite:
// the requested-month normaliser and the captured-year reader.
//
// Both guard a request that crosses a world boundary, so both are about what
// they REJECT: a bad number must degrade to an ordinary scrape rather than into
// a sweep of nothing or a sweep of everything.
import { describe, expect, it } from "vitest";
import {
  YEAR_PROPERTY,
  batchMonthCount,
  batchScopeError,
  capturedYear,
  capturedPeriod,
} from "../content/scrape-batch";

function body(filters: { PropertyName: string; Value: unknown }[]): string {
  return JSON.stringify({ First: 0, Rows: 50, Filters: filters });
}

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

describe("capturedYear", () => {
  it("reads the year the grid is filtered to", () => {
    const raw = body([
      { PropertyName: "TaxInvoicePeriod", Value: "TD.00708" },
      { PropertyName: YEAR_PROPERTY, Value: "2026" },
    ]);
    expect(capturedYear(raw)).toBe("2026");
  });

  it("accepts a numeric year, which is how a JSON body would carry it", () => {
    expect(capturedYear(body([{ PropertyName: YEAR_PROPERTY, Value: 2026 }]))).toBe("2026");
  });

  it.each([
    ["no filters at all", "{\"First\":0}"],
    ["an empty filter list", body([])],
    ["no year filter", body([{ PropertyName: "TaxInvoicePeriod", Value: "TD.00708" }])],
    ["a non-year value", body([{ PropertyName: YEAR_PROPERTY, Value: "TD.00708" }])],
    ["a two-digit year", body([{ PropertyName: YEAR_PROPERTY, Value: "26" }])],
    ["a year with trailing text", body([{ PropertyName: YEAR_PROPERTY, Value: "2026 SPT" }])],
    ["a null value", body([{ PropertyName: YEAR_PROPERTY, Value: null }])],
    ["unparseable JSON", "{not json"],
    ["an empty string", ""],
  ])("returns null for %s — a wrong year is worse than none", (_label, raw) => {
    expect(capturedYear(raw)).toBeNull();
  });

  it("agrees with capturedPeriod about which filters the body actually carries", () => {
    // Both readers walk the same array; if one found a value the other missed,
    // the batch would be named for a period it never swept, or vice versa.
    const raw = body([
      { PropertyName: "TaxInvoiceStatus", Value: ["CREATED"] },
      { PropertyName: YEAR_PROPERTY, Value: "2026" },
      { PropertyName: "TaxInvoicePeriod", Value: "TD.00708" },
    ]);
    expect(capturedYear(raw)).toBe("2026");
    expect(capturedPeriod(raw)).toBe("TD.00708");
  });
});

describe("batchScopeError", () => {
  const BOTH = body([
    { PropertyName: "TaxInvoicePeriod", Value: "TD.00708" },
    { PropertyName: YEAR_PROPERTY, Value: "2026" },
  ]);

  it("lets a sweep run when the request carries the period and the year", () => {
    expect(batchScopeError(BOTH)).toBeNull();
  });

  it("names the missing PERIOD, which would sweep one month twelve times", () => {
    const raw = body([{ PropertyName: YEAR_PROPERTY, Value: "2026" }]);
    expect(batchScopeError(raw)).toContain("masa pajak");
  });

  it("names the missing YEAR, which the period code does not carry itself", () => {
    // The message has to say which filter is missing: "the request cannot be
    // swept" without saying why leaves the user re-trying the same filter.
    const raw = body([{ PropertyName: "TaxInvoicePeriod", Value: "TD.00708" }]);
    expect(batchScopeError(raw)).toContain("tahun pajak");
  });

  it.each([
    ["unparseable JSON", "{not json"],
    ["an empty string", ""],
    ["a body with no filters", "{\"First\":0}"],
    ["an empty filter list", body([])],
    ["a period value that is not a code", body([
      { PropertyName: "TaxInvoicePeriod", Value: "Agustus" },
      { PropertyName: YEAR_PROPERTY, Value: "2026" },
    ])],
  ])("refuses %s rather than sweeping something unnamed", (_label, raw) => {
    expect(batchScopeError(raw)).not.toBeNull();
  });

  it("accepts a numeric year, the way capturedYear does", () => {
    const raw = body([
      { PropertyName: "TaxInvoicePeriod", Value: "TD.00708" },
      { PropertyName: YEAR_PROPERTY, Value: 2026 },
    ]);
    expect(batchScopeError(raw)).toBeNull();
  });
});