import { describe, expect, it } from "vitest";
import {
  MEASURED_SWEEP_FILTERS,
  capturedPeriod,
  overridesForPeriod,
  periodCode,
  periodPrefix,
  planPeriods,
} from "../content/scrape-batch";
import {
  capturedFilters,
  rawBodyOf,
  rawBodyWithFilters,
  type EfakturSource,
} from "./__mocks__/grid-requests";

/** The one measured grid, and its names as the table records them. */
const SOURCE: EfakturSource = "OUTPUT_TAX";
const PERIOD_PROPERTY = MEASURED_SWEEP_FILTERS.OUTPUT_TAX?.period ?? "";
const YEAR_PROPERTY = MEASURED_SWEEP_FILTERS.OUTPUT_TAX?.year ?? "";

// The captured body — the portal's own request of 2026-10-06, kept in
// grid-requests.ts with its provenance — rather than a body described here. The
// readers below are then proved against what the portal actually sends.
const CAPTURED = rawBodyOf(SOURCE);

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
    expect(capturedPeriod(CAPTURED, SOURCE)).toBe("TD.00708");
    expect(capturedPeriod("{}", SOURCE)).toBeNull();
    // PPN Masukan sends the selected month as a LIST of codes; the plan is
    // built from the first one (ADR-0043).
    expect(capturedPeriod(rawBodyOf("INPUT_TAX"), "INPUT_TAX")).toBe("TD.00709");
  });
});

describe("re-requesting the grid for one period", () => {
  it("changes the period and nothing else", () => {
    const overrides = overridesForPeriod(CAPTURED, "TD.00701", 0, 500, SOURCE) as {
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
      PropertyName: YEAR_PROPERTY,
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
    overridesForPeriod(CAPTURED, "TD.00701", 0, 500, SOURCE);
    expect(before.Filters[0].Value).toBe("TD.00708");
  });

  it("refuses a grid whose filters were never measured", () => {
    // The removed hint door used to sweep this body on a name plus a value in
    // the measured format. With no measured row, nothing may be re-requested:
    // twelve months of a grid nobody has read is a file the user cannot trust.
    const body = rawBodyOf("OUTPUT_RETURN");

    expect(() => overridesForPeriod(body, "TD.00701", 0, 500, "OUTPUT_RETURN")).toThrow();
  });

  it("rewrites PPN Masukan's list-valued period as the one code the portal reads", () => {
    // Measured on the portal (ADR-0043): the LIST is what the portal sends and
    // the STRING is what it reads, with the filter's own MatchMode kept.
    const captured = rawBodyOf("INPUT_TAX");
    const overrides = overridesForPeriod(captured, "TD.00701", 0, 500, "INPUT_TAX") as {
      Filters: Record<string, unknown>[];
    };
    expect(overrides.Filters[0]).toEqual({
      PropertyName: "TaxInvoicePeriod",
      Value: "TD.00701",
      MatchMode: "contains",
      CaseSensitive: true,
      AsString: false,
    });
  });

  it("refuses when the request has no period filter at all", () => {
    // Silently scraping the same period twelve times and calling it a year is
    // the worst outcome available, so this is a hard stop. The body is the
    // capture with its period filter taken away — the portal's own request
    // minus one filter, not a request invented for the test.
    const body = rawBodyWithFilters(
      SOURCE,
      capturedFilters(SOURCE).filter((filter) => filter.PropertyName !== PERIOD_PROPERTY),
    );
    expect(() => overridesForPeriod(body, "TD.00701", 0, 500, SOURCE)).toThrow(/TaxInvoicePeriod/);
    expect(() => overridesForPeriod("{}", "TD.00701", 0, 500, SOURCE)).toThrow(/TaxInvoicePeriod/);
    expect(() => overridesForPeriod("not json", "TD.00701", 0, 500, SOURCE)).toThrow(
      /TaxInvoicePeriod/,
    );
  });
});
