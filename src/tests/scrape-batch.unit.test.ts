import { describe, expect, it } from "vitest";
import {
  MEASURED_SWEEP_FILTERS,
  capturedPeriod,
  mergePeriodSummaries,
  overridesForPeriod,
  pendingPeriods,
  periodCode,
  periodPrefix,
  planPeriods,
  summarisePeriods,
  type PeriodCount,
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

// ── Resuming a stopped sweep ─────────────────────────

/** Counts for one year, as a sweep builds them: one entry per masa it recorded. */
function countsOf(...periods: [string, number, string?][]): PeriodCount[] {
  return periods.map(([period, rows, error]) => ({ period, rows, error }));
}

describe("pendingPeriods — what a resume still has to fetch", () => {
  it("names the masa a stop never got to, in year order", () => {
    // Stopped after ten: the two that produced no counts are the work left.
    const summary = summarisePeriods(
      countsOf(
        ["TD.00701", 4], ["TD.00702", 0], ["TD.00703", 7], ["TD.00704", 1],
        ["TD.00705", 2], ["TD.00706", 3], ["TD.00707", 9], ["TD.00708", 5],
        ["TD.00709", 6], ["TD.00710", 8],
      ),
      12,
    );
    expect(pendingPeriods(summary)).toEqual(["TD.00711", "TD.00712"]);
  });

  it("resumes a masa that FAILED but not one that was simply empty", () => {
    // A failed masa holds no rows and the year is missing it; an empty masa was
    // answered by the portal and is a month the taxpayer really has nothing in.
    // Re-asking the second would spend a request to learn nothing.
    const summary = summarisePeriods(
      countsOf(["TD.00701", 3], ["TD.00702", 0, "Masa tidak diambil."]),
      3,
    );
    expect(pendingPeriods(summary)).toEqual(["TD.00702", "TD.00703"]);
  });

  it("has nothing to resume when nothing was kept", () => {
    // No count means no year to plan from: the caller must start a fresh sweep
    // rather than send an empty list, which would report a finished year without
    // making one request.
    expect(pendingPeriods(summarisePeriods([]))).toEqual([]);
  });

  it("is empty once the union covers the year", () => {
    const kept = summarisePeriods(countsOf(["TD.00701", 3]), 12);
    const resumed = summarisePeriods(
      countsOf(...["02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"]
        .map((m) => [`TD.007${m}`, 1] as [string, number])),
      12,
    );
    expect(pendingPeriods(mergePeriodSummaries(kept, resumed))).toEqual([]);
  });
});

describe("mergePeriodSummaries — the union a resume builds", () => {
  it("folds the resumed masa in and keeps the year's own scope", () => {
    const kept = summarisePeriods(countsOf(["TD.00701", 3], ["TD.00702", 0, "gagal"]), 12);
    const resumed = summarisePeriods(countsOf(["TD.00702", 5], ["TD.00703", 0]), 2);

    const union = mergePeriodSummaries(kept, resumed);

    // `planned` is the year, not the half that just arrived: the fraction the
    // panel prints must read "3 dari 12", never "2 dari 2".
    expect(union.planned).toBe(12);
    expect(union.counts.map((c) => c.period)).toEqual([
      "TD.00701", "TD.00702", "TD.00703",
    ]);
    // The retry replaces the failure it retried, and the month the portal
    // answered with nothing is flagged only because its neighbours have rows.
    expect(union.failedPeriods).toEqual([]);
    expect(union.emptyPeriods).toEqual(["TD.00703"]);
    expect(union.totalRows).toBe(8);
  });

  it("lets the incoming count win for a period it covers again", () => {
    const kept = summarisePeriods(countsOf(["TD.00701", 1]), 12);
    const resumed = summarisePeriods(countsOf(["TD.00701", 9]), 12);
    expect(mergePeriodSummaries(kept, resumed).counts).toEqual([{ period: "TD.00701", rows: 9 }]);
  });

  it("recomputes the empty and failed lists instead of merging them by hand", () => {
    // A union of two all-empty halves is not an anomaly: nothing had rows on
    // either side, so the rule that flags an empty masa between populated ones
    // must not fire.
    const kept = summarisePeriods(countsOf(["TD.00701", 0]), 12);
    const resumed = summarisePeriods(countsOf(["TD.00702", 0]), 12);
    const union = mergePeriodSummaries(kept, resumed);
    expect(union.emptyPeriods).toEqual([]);
    expect(union.totalRows).toBe(0);
  });
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
    expect(capturedPeriod(CAPTURED, SOURCE)).toBe("TD.00708");
    expect(capturedPeriod("{}", SOURCE)).toBeNull();
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
    const body = rawBodyOf("INPUT_TAX");

    expect(() => overridesForPeriod(body, "TD.00701", 0, 500, "INPUT_TAX")).toThrow();
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

  it("carries how many periods the sweep was asked for", () => {
    const counts: PeriodCount[] = [{ period: "TD.00701", rows: 16756 }];
    // A finished sweep: the counts ARE the whole answer.
    expect(summarisePeriods(counts).planned).toBe(1);
    // A stopped one: the counts stop where the user stopped, and `planned` is
    // what lets the panel say "10 dari 12 masa" instead of leaving the gap to be
    // inferred from a row count.
    expect(summarisePeriods(counts, 12).planned).toBe(12);
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
