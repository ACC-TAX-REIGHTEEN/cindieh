// Unit tests for the batch helpers added after scrape-batch's first suite:
// the requested-month normaliser and the captured-year reader.
//
// Both guard a request that crosses a world boundary, so both are about what
// they REJECT: a bad number must degrade to an ordinary scrape rather than into
// a sweep of nothing or a sweep of everything.
import { describe, expect, it } from "vitest";
import {
  PERIOD_PROPERTY,
  YEAR_PROPERTY,
  batchMonthCount,
  batchScopeError,
  capturedYear,
  capturedPeriod,
  describeSweepFilters,
  readSweepFilters,
  resumePeriodCodes,
} from "../content/scrape-batch";

function body(filters: { PropertyName: string; Value: unknown }[]): string {
  return JSON.stringify({ First: 0, Rows: 50, Filters: filters });
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

describe("the other VAT grids", () => {
  // Only PPN Keluaran's filter names were measured. On the other three grids a
  // filter is accepted on TWO signals together — a name that says period/year
  // and a value in the measured format — because the value alone cannot be
  // trusted (an invoice number also ends in two digits that look like a month).

  it("reads a period filter the portal spelled differently, plus a year filter", () => {
    const raw = body([
      { PropertyName: "TaxPeriod", Value: "TD.00703" },
      { PropertyName: "Year", Value: "2026" },
    ]);
    expect(capturedPeriod(raw)).toBe("TD.00703");
    expect(capturedYear(raw)).toBe("2026");
    expect(batchScopeError(raw)).toBeNull();
  });

  it("reads the year from a body field, the way the retur filename hint does", () => {
    const raw = JSON.stringify({
      Filters: [{ PropertyName: "TaxInvoicePeriod", Value: "TD.00705" }],
      TaxYear: "2025",
    });
    expect(capturedYear(raw)).toBe("2025");
    expect(batchScopeError(raw)).toBeNull();
  });

  it("never mistakes an invoice-number filter for the period, however its value ends", () => {
    // `010.000-26.00000012` ends in a month-looking pair too. A value-only
    // match here would sweep twelve invoice numbers instead of twelve months.
    const raw = body([
      { PropertyName: "TaxInvoiceNumber", Value: "010.000-26.00000012" },
      { PropertyName: YEAR_PROPERTY, Value: "2026" },
    ]);
    expect(capturedPeriod(raw)).toBeNull();
    expect(batchScopeError(raw)).toContain("tidak punya filter masa pajak");
  });

  it("refuses a period-named filter whose value is in no known format", () => {
    // This refusal is also the measurement: it is what a grid reports when its
    // filter is real but spelled outside the family the code knows.
    const raw = body([
      { PropertyName: "TaxPeriod", Value: "2026-07" },
      { PropertyName: YEAR_PROPERTY, Value: "2026" },
    ]);
    // Unreadable is not the same as absent: nothing here can be swept, but the
    // filter IS there, so the message must not send the user hunting for it.
    expect(capturedPeriod(raw)).toBeNull();
    expect(batchScopeError(raw)).toMatch(/belum dikenali/);
    expect(batchScopeError(raw)).not.toContain("tidak punya filter masa pajak");
  });

  it.each([
    ["PeriodCredit", "YearCredit"],
    ["PeriodCredit", "TaxInvoiceYear"],
    ["TaxInvoicePeriod", "YearCredit"],
  ])("never sweeps by the credit period (%s / %s)", (periodName, yearName) => {
    // A credit period is a second period filter PPN Masukan may carry; sweeping
    // by it would return twelve coherent months of the WRONG period.
    const raw = body([
      { PropertyName: periodName, Value: "TD.00703" },
      { PropertyName: yearName, Value: "2026" },
    ]);
    const creditPeriod = periodName.includes("Credit");
    const creditYear = yearName.includes("Credit");
    expect(capturedPeriod(raw)).toBe(creditPeriod ? null : "TD.00703");
    expect(capturedYear(raw)).toBe(creditYear ? null : "2026");
    expect(batchScopeError(raw)).not.toBeNull();
  });

  it("prefers the measured names when a request carries both spellings", () => {
    const raw = body([
      { PropertyName: "TaxPeriod", Value: "TD.00703" },
      { PropertyName: "TaxInvoicePeriod", Value: "TD.00708" },
      { PropertyName: "Year", Value: "2025" },
      { PropertyName: YEAR_PROPERTY, Value: "2026" },
    ]);
    expect(capturedPeriod(raw)).toBe("TD.00708");
    expect(capturedYear(raw)).toBe("2026");
  });
});

describe("the reading the guard decides on", () => {
  // The measurement ADR-0019 left open is taken from this reading: a grid that
  // still answers through the hint door is one whose filter NAMES are guesses,
  // and the log line is what hands over the spelling to learn. So the reading
  // has to distinguish the two doors, and it has to name the filters it passed
  // over — a credit period most of all.

  it("names the door each filter was found through", () => {
    const measured = body([
      { PropertyName: PERIOD_PROPERTY, Value: "TD.00708" },
      { PropertyName: YEAR_PROPERTY, Value: "2026" },
    ]);
    expect(readSweepFilters(measured)).toEqual({
      period: { name: "TaxInvoicePeriod", value: "TD.00708", door: "measured" },
      year: { name: YEAR_PROPERTY, value: "2026", door: "measured" },
      seen: ["TaxInvoicePeriod", YEAR_PROPERTY],
    });
    // Pinned as a whole because the line IS the artifact the portal loop reads
    // back: a reworded log is a changed instruction to whoever measures next.
    expect(describeSweepFilters(measured)).toBe(
      "period=TaxInvoicePeriod=TD.00708 (measured name) · year=TaxInvoiceYear=2026 (measured name) · " +
        "period/year-named filters seen: TaxInvoicePeriod, TaxInvoiceYear",
    );
  });

  it("says so when the sweep still rests on a name hint", () => {
    const hinted = body([
      { PropertyName: "TaxPeriod", Value: "TD.00703" },
      { PropertyName: "Year", Value: "2026" },
    ]);
    expect(readSweepFilters(hinted)).toEqual({
      period: { name: "TaxPeriod", value: "TD.00703", door: "hint" },
      year: { name: "Year", value: "2026", door: "hint" },
      seen: ["TaxPeriod", "Year"],
    });
    expect(describeSweepFilters(hinted)).toContain("period=TaxPeriod=TD.00703 (name hint)");
    expect(describeSweepFilters(hinted)).toContain("year=Year=2026 (name hint)");
  });

  it("reports a measured period filter whose value is in no known format", () => {
    // This is an unmeasured grid's real shape: the filter is not missing, its
    // VALUE is outside the family periodPrefix reads. Saying "no period filter"
    // would send the user hunting for one that is already there.
    const raw = body([
      { PropertyName: PERIOD_PROPERTY, Value: "Agustus" },
      { PropertyName: YEAR_PROPERTY, Value: "2026" },
    ]);
    expect(readSweepFilters(raw).period).toEqual({
      name: PERIOD_PROPERTY,
      value: "Agustus",
      door: "measured",
    });
    expect(describeSweepFilters(raw)).toContain(
      `period=${PERIOD_PROPERTY}=Agustus (measured name, value in no known format)`,
    );
  });

  it.each([
    ["an empty value", ""],
    ["no value key at all", undefined],
  ])("reads a measured period filter that carries %s", (_label, value) => {
    // A filter present with nothing in it is an unmeasured shape of its own: the
    // name is the measured one, so the sweep finds the FILTER and still has no
    // code to derive twelve periods from. The reading has to show that rather
    // than report the filter as absent.
    const raw = body([
      { PropertyName: PERIOD_PROPERTY, Value: value },
      { PropertyName: YEAR_PROPERTY, Value: "2026" },
    ]);
    expect(readSweepFilters(raw).period).toEqual({
      name: PERIOD_PROPERTY,
      value: "",
      door: "measured",
    });
    expect(describeSweepFilters(raw)).toContain(
      `period=${PERIOD_PROPERTY}= (measured name, value in no known format)`,
    );
    expect(batchScopeError(raw)).toMatch(/belum dikenali/);
  });

  it("lists a period-named filter it refused, so the refusal is the measurement", () => {
    // `TaxPeriod = 2026-07` is a period spelled outside the measured family: the
    // sweep cannot use it, and the line says exactly which spelling to learn
    // next instead of only that the grid was not recognised.
    const raw = body([
      { PropertyName: "TaxPeriod", Value: "2026-07" },
      { PropertyName: YEAR_PROPERTY, Value: "2026" },
    ]);
    const reading = readSweepFilters(raw);
    expect(reading.period).toBeNull();
    expect(reading.seen).toEqual(["TaxPeriod", YEAR_PROPERTY]);
    expect(describeSweepFilters(raw)).toContain("period=none");
    expect(describeSweepFilters(raw)).toContain("period/year-named filters seen: TaxPeriod, TaxInvoiceYear");
  });

  it.each([
    ["PeriodCredit", "YearCredit"],
    ["PeriodCredit", YEAR_PROPERTY],
    [PERIOD_PROPERTY, "YearCredit"],
  ])("shows the credit filters it passed over (%s / %s)", (periodName, yearName) => {
    // A credit period is the one thing that must never be swept by; keeping it
    // in `seen` is what makes "the guard refused this request" explainable.
    const raw = body([
      { PropertyName: periodName, Value: "TD.00703" },
      { PropertyName: yearName, Value: "2026" },
    ]);
    const reading = readSweepFilters(raw);
    expect(reading.period?.name).toBe(periodName.includes("Credit") ? undefined : periodName);
    expect(reading.year?.name).toBe(yearName.includes("Credit") ? undefined : yearName);
    expect(reading.seen).toEqual([periodName, yearName]);
  });

  it("reads the year a request carries as a body field", () => {
    // The retur grids may state it that way rather than as a filter, and the
    // reading has to show that is where the year came from — that is the
    // measurement that decides whether the body-field fallback is needed there.
    const raw = JSON.stringify({
      Filters: [{ PropertyName: "TaxInvoicePeriod", Value: "TD.00705" }],
      TaxYear: "2025",
    });
    expect(readSweepFilters(raw).year).toEqual({ name: "TaxYear", value: "2025", door: "hint" });
    expect(describeSweepFilters(raw)).toContain("year=TaxYear=2025 (name hint)");
  });

  it.each([
    ["an empty filter list", body([])],
    ["a body with no filters key", '{"First":0}'],
    ["unparseable JSON", "{not json"],
    ["an empty string", ""],
  ])("reports nothing found for %s, without inventing a filter", (_label, raw) => {
    expect(readSweepFilters(raw)).toEqual({ period: null, year: null, seen: [] });
    expect(describeSweepFilters(raw)).toBe(
      "period=none · year=none · period/year-named filters seen: none",
    );
  });

  it("does not count a period-year sounding name it never reads values from", () => {
    // `TaxInvoiceStatus` names neither period nor year, and a filter whose name
    // is unrelated is not a candidate — the seen list is the measurement, so it
    // must not collect noise.
    const raw = body([
      { PropertyName: PERIOD_PROPERTY, Value: "TD.00708" },
      { PropertyName: YEAR_PROPERTY, Value: "2026" },
      { PropertyName: "TaxInvoiceStatus", Value: ["CREATED"] },
      { PropertyName: "SellerTaxpayerAggregateIdentifier", Value: "seller-1" },
    ]);
    expect(readSweepFilters(raw).seen).toEqual([PERIOD_PROPERTY, YEAR_PROPERTY]);
  });
});