import { describe, expect, it } from "vitest";
import {
  PERIOD_PROPERTY,
  capturedPeriod,
  overridesForPeriod,
  periodCode,
  periodPrefix,
  planPeriods,
  summarisePeriods,
  type PeriodCount,
} from "../content/scrape-batch";

// The body the portal actually sent on 2026-10-06, captured off
// /einvoiceportal/api/outputinvoice/list.
const CAPTURED = JSON.stringify({
  SellerTaxpayerAggregateIdentifier: "seller-1",
  First: 0,
  Rows: 50,
  SortField: "TaxInvoiceDate",
  SortOrder: "desc",
  LanguageId: "id-ID",
  TaxpayerAggregateIdentifier: "taxpayer-1",
  Filters: [
    { PropertyName: PERIOD_PROPERTY, Value: "TD.00708", MatchMode: "equals", CaseSensitive: true },
    { PropertyName: "TaxInvoiceYear", Value: "2026", MatchMode: "equals", CaseSensitive: true },
    {
      PropertyName: "TaxInvoiceStatus",
      Value: ["CREATED", "APPROVED", "SAVED_INVALID"],
      MatchMode: "contains",
      CaseSensitive: true,
    },
  ],
});

describe("the portal's period code", () => {
  it("splits the fixed prefix from the month", () => {
    // Measured live: TD.00708 is August.
    expect(periodPrefix("TD.00708")).toBe("TD.007");
    expect(periodCode("TD.007", 8)).toBe("TD.00708");
  });

  it("plans twelve periods from the captured value alone", () => {
    expect(planPeriods("TD.00708")).toEqual([
      "TD.00701", "TD.00702", "TD.00703", "TD.00704",
      "TD.00705", "TD.00706", "TD.00707", "TD.00708",
      "TD.00709", "TD.00710", "TD.00711", "TD.00712",
    ]);
  });

  it("refuses to plan when the captured value is not a period code", () => {
    // Guessing here is what would produce twelve empty months that read as
    // "this taxpayer has no data".
    expect(planPeriods("")).toEqual([]);
    expect(planPeriods("2026")).toEqual([]);
    expect(planPeriods("TD.00713")).toEqual([]); // no month 13
    expect(planPeriods("TD.00700")).toEqual([]);
  });

  it("plans fewer periods when asked for fewer", () => {
    expect(planPeriods("TD.00708", 3)).toEqual(["TD.00701", "TD.00702", "TD.00703"]);
    expect(planPeriods("TD.00708", 0)).toEqual([]);
    expect(planPeriods("TD.00708", 99)).toHaveLength(12);
  });

  it("reads the period the captured request is on", () => {
    expect(capturedPeriod(CAPTURED)).toBe("TD.00708");
    expect(capturedPeriod("{}")).toBeNull();
  });
});

describe("re-requesting the grid for one period", () => {
  it("changes the period and nothing else", () => {
    const overrides = overridesForPeriod(CAPTURED, "TD.00701", 0, 500) as {
      Filters: Record<string, unknown>[];
      First: number;
      Rows: number;
    };

    expect(overrides.First).toBe(0);
    expect(overrides.Rows).toBe(500);
    expect(overrides.Filters[0]).toEqual({
      PropertyName: PERIOD_PROPERTY,
      Value: "TD.00701",
      MatchMode: "equals",
      CaseSensitive: true,
    });
    // The year filter and the status filter survive untouched — a batch that
    // dropped the status filter would export drafts the user never asked for.
    expect(overrides.Filters[1]).toEqual({
      PropertyName: "TaxInvoiceYear",
      Value: "2026",
      MatchMode: "equals",
      CaseSensitive: true,
    });
    expect(overrides.Filters[2]).toMatchObject({
      PropertyName: "TaxInvoiceStatus",
      Value: ["CREATED", "APPROVED", "SAVED_INVALID"],
      MatchMode: "contains",
    });
  });

  it("does not mutate the captured body", () => {
    const before = JSON.parse(CAPTURED) as { Filters: { Value: unknown }[] };
    overridesForPeriod(CAPTURED, "TD.00701", 0, 500);
    expect(before.Filters[0].Value).toBe("TD.00708");
  });

  it("varies the period filter on a grid whose filter is named differently", () => {
    // PPN Masukan and the retur grids were not measured, so the sweep has to
    // find their period filter by name hint + value format and leave the rest
    // of the array, year included, alone.
    const body = JSON.stringify({
      First: 0,
      Rows: 50,
      Filters: [
        { PropertyName: "TaxPeriod", Value: "TD.00703", MatchMode: "equals" },
        { PropertyName: "Year", Value: "2026", MatchMode: "equals" },
      ],
    });

    const overrides = overridesForPeriod(body, "TD.00701", 0, 500) as {
      Filters: Record<string, unknown>[];
    };

    expect(overrides.Filters[0]).toMatchObject({ PropertyName: "TaxPeriod", Value: "TD.00701" });
    expect(overrides.Filters[1]).toMatchObject({ PropertyName: "Year", Value: "2026" });
  });

  it("refuses when the request has no period filter at all", () => {
    // Silently scraping the same period twelve times and calling it a year is
    // the worst outcome available, so this is a hard stop.
    const body = JSON.stringify({ Filters: [{ PropertyName: "TaxInvoiceYear", Value: "2026" }] });
    expect(() => overridesForPeriod(body, "TD.00701", 0, 500)).toThrow(/TaxInvoicePeriod/);
    expect(() => overridesForPeriod("{}", "TD.00701", 0, 500)).toThrow(/TaxInvoicePeriod/);
    expect(() => overridesForPeriod("not json", "TD.00701", 0, 500)).toThrow(/TaxInvoicePeriod/);
  });
});

describe("what a whole batch produced", () => {
  // The measured January-March run: 44,237 rows, no duplicates, every row
  // carrying RecordId.
  const measured: PeriodCount[] = [
    { period: "TD.00701", rows: 16756 },
    { period: "TD.00702", rows: 16830 },
    { period: "TD.00703", rows: 10651 },
  ];

  it("adds up what the periods fetched", () => {
    const summary = summarisePeriods(measured);
    expect(summary.totalRows).toBe(44237);
    expect(summary.emptyPeriods).toEqual([]);
    expect(summary.failedPeriods).toEqual([]);
  });

  it("flags a period that came back empty among periods that did not", () => {
    const summary = summarisePeriods([
      { period: "TD.00701", rows: 16756 },
      { period: "TD.00702", rows: 0 },
      { period: "TD.00703", rows: 10651 },
    ]);
    expect(summary.emptyPeriods).toEqual(["TD.00702"]);
    expect(summary.failedPeriods).toEqual([]);
  });

  it("does not flag an idle month when the whole year is idle", () => {
    // A taxpayer with no invoices in any month is a legitimate empty export,
    // and flagging it would train the user to ignore the flag.
    const summary = summarisePeriods([
      { period: "TD.00701", rows: 0 },
      { period: "TD.00702", rows: 0 },
    ]);
    expect(summary.emptyPeriods).toEqual([]);
    expect(summary.totalRows).toBe(0);
  });

  it("keeps a failed period separate from a quiet one", () => {
    const summary = summarisePeriods([
      { period: "TD.00701", rows: 16756 },
      { period: "TD.00702", rows: 0, error: "HTTP 503" },
    ]);
    expect(summary.failedPeriods).toEqual(["TD.00702"]);
    // A failed period is not "empty": it is missing data we do not have.
    expect(summary.emptyPeriods).toEqual([]);
    expect(summary.totalRows).toBe(16756);
  });

  it("reports several anomalies at once", () => {
    const summary = summarisePeriods([
      { period: "TD.00701", rows: 16756 },
      { period: "TD.00702", rows: 0 },
      { period: "TD.00703", rows: 0, error: "timeout" },
      { period: "TD.00704", rows: 0 },
    ]);
    expect(summary.emptyPeriods).toEqual(["TD.00702", "TD.00704"]);
    expect(summary.failedPeriods).toEqual(["TD.00703"]);
  });
});
