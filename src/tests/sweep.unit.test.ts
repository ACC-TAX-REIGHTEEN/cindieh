import { describe, expect, it } from "vitest";
import {
  emptyPeriods,
  failedPeriods,
  finishedPeriods,
  isResumable,
  mergeSweeps,
  missingPeriods,
  sweepOf,
  type PeriodCount,
  type Sweep,
} from "../content/sweep";

// ── Fixtures ───────────────────────────────────────────

/** Counts for one year, as a sweep builds them: one entry per masa it recorded. */
function countsOf(...periods: [string, number, string?][]): PeriodCount[] {
  return periods.map(([period, rows, error]) => ({ period, rows, error }));
}

/** The twelve codes of one year, oldest first. */
function yearPlan(from = 1, to = 12): string[] {
  return Array.from({ length: to - from + 1 }, (_, i) => `TD.007${String(from + i).padStart(2, "0")}`);
}

/** A sweep over the whole year that recorded the given counts. */
function sweepOfYear(counts: PeriodCount[], plan = yearPlan()): Sweep {
  return sweepOf(counts, plan);
}

// ── The plan ───────────────────────────────────────────

describe("a sweep carries its plan", () => {
  it("keeps the codes it covers, not a count of them", () => {
    const sweep = sweepOf(countsOf(["TD.00701", 3]), yearPlan());
    expect(sweep.plan).toEqual(yearPlan());
    // The panel's fraction — "10 dari 12 masa" — reads the plan's own length.
    expect(sweep.plan.length).toBe(12);
  });

  it("counts the rows it holds from the counts, when the caller does not say", () => {
    const sweep = sweepOf(countsOf(["TD.00701", 16756], ["TD.00702", 16830]), yearPlan());
    expect(sweep.totalRows).toBe(33586);
  });

  it("takes the row count the caller knows, when the caller says one", () => {
    // Two halves counted by two accumulators can overlap, so the union's row
    // count is the deduplicated one and the caller holding those rows is the
    // one that knows it (ADR-0016).
    const sweep = sweepOf(countsOf(["TD.00701", 3]), yearPlan(), 2);
    expect(sweep.totalRows).toBe(2);
  });
});

// ── What finished, what failed, what is missing ────────

describe("finishedPeriods — the masa that finished", () => {
  it("counts a masa that was fetched cleanly, and not one that failed", () => {
    const sweep = sweepOfYear(
      countsOf(["TD.00701", 3], ["TD.00702", 0, "Masa tidak diambil."]),
    );
    expect(finishedPeriods(sweep)).toEqual(["TD.00701"]);
  });
});

describe("failedPeriods — the masa that could not be fetched", () => {
  it("keeps a failed masa separate from a quiet one", () => {
    const sweep = sweepOfYear(
      countsOf(["TD.00701", 16756], ["TD.00702", 0, "HTTP 503"]),
    );
    expect(failedPeriods(sweep)).toEqual(["TD.00702"]);
  });
});

describe("emptyPeriods — the masa that came back with nothing", () => {
  it("flags a period that came back empty among periods that did not", () => {
    const sweep = sweepOfYear(
      countsOf(["TD.00701", 16756], ["TD.00702", 0], ["TD.00703", 10651]),
    );
    expect(emptyPeriods(sweep)).toEqual(["TD.00702"]);
  });

  it("does not flag an idle month when the whole year is idle", () => {
    // A taxpayer with no invoices in any month is a legitimate empty export,
    // and flagging it would train the user to ignore the flag.
    const sweep = sweepOfYear(countsOf(["TD.00701", 0], ["TD.00702", 0]));
    expect(emptyPeriods(sweep)).toEqual([]);
  });

  it("reports several anomalies at once", () => {
    const sweep = sweepOfYear(
      countsOf(
        ["TD.00701", 16756],
        ["TD.00702", 0],
        ["TD.00703", 0, "timeout"],
        ["TD.00704", 0],
      ),
    );
    expect(emptyPeriods(sweep)).toEqual(["TD.00702", "TD.00704"]);
    expect(failedPeriods(sweep)).toEqual(["TD.00703"]);
  });
});

describe("missingPeriods — what a resume still has to fetch", () => {
  it("names the masa a stop never got to, in year order", () => {
    // Stopped after ten: the two that produced no counts are the work left.
    const sweep = sweepOfYear(
      countsOf(
        ["TD.00701", 4], ["TD.00702", 0], ["TD.00703", 7], ["TD.00704", 1],
        ["TD.00705", 2], ["TD.00706", 3], ["TD.00707", 9], ["TD.00708", 5],
        ["TD.00709", 6], ["TD.00710", 8],
      ),
    );
    expect(missingPeriods(sweep)).toEqual(["TD.00711", "TD.00712"]);
  });

  it("resumes a masa that FAILED but not one that was simply empty", () => {
    // A failed masa holds no rows and the year is missing it; an empty masa was
    // answered by the portal and is a month the taxpayer really has nothing in.
    // Re-asking the second would spend a request to learn nothing.
    const sweep = sweepOf(countsOf(["TD.00701", 3], ["TD.00702", 0, "Masa tidak diambil."]), [
      "TD.00701",
      "TD.00702",
      "TD.00703",
    ]);
    expect(missingPeriods(sweep)).toEqual(["TD.00702", "TD.00703"]);
  });

  it("names every masa of the plan when nothing at all was recorded", () => {
    // The plan is what a sweep was ASKED for, so a sweep that recorded nothing
    // has all of it missing — including a period the user stopped in the middle
    // of, which is never recorded at all (ADR-0020). The guard that keeps a
    // sweep with NO ROWS out of the resume offer lives where the rows are
    // checked (sweep-snapshot.sweepContentOf), not here.
    expect(missingPeriods(sweepOf([], yearPlan()))).toEqual(yearPlan());
  });

  it("is empty once the union covers the year", () => {
    const kept = sweepOf(countsOf(["TD.00701", 3]), yearPlan());
    const resumed = sweepOf(
      countsOf(
        ...yearPlan(2, 12).map((period) => [period, 1] as [string, number]),
      ),
      yearPlan(2, 12),
    );
    expect(missingPeriods(mergeSweeps(kept, resumed))).toEqual([]);
  });
});

describe("isResumable — whether there is anything left to resume", () => {
  it("is true while a masa is still missing", () => {
    const sweep = sweepOfYear(countsOf(["TD.00701", 3]));
    expect(isResumable(sweep)).toBe(true);
  });

  it("is false once every masa of the plan finished", () => {
    const sweep = sweepOfYear(
      countsOf(
        ...yearPlan().map((period) => [period, 1] as [string, number]),
      ),
    );
    expect(isResumable(sweep)).toBe(false);
  });

  it("is true when a masa FAILED, because the year is missing it", () => {
    const sweep = sweepOfYear(
      countsOf(
        ...yearPlan()
          .filter((period) => period !== "TD.00707")
          .map((period) => [period, 1] as [string, number]),
      ).concat([{ period: "TD.00707", rows: 0, error: "HTTP 503" }]),
    );
    expect(isResumable(sweep)).toBe(true);
    expect(missingPeriods(sweep)).toEqual(["TD.00707"]);
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
    const sweep = sweepOf(measured, yearPlan(1, 3));
    expect(sweep.totalRows).toBe(44237);
    expect(emptyPeriods(sweep)).toEqual([]);
    expect(failedPeriods(sweep)).toEqual([]);
  });

  it("flags a period that came back empty among periods that did not", () => {
    const sweep = sweepOf(
      [
        { period: "TD.00701", rows: 16756 },
        { period: "TD.00702", rows: 0 },
        { period: "TD.00703", rows: 10651 },
      ],
      yearPlan(1, 3),
    );
    expect(emptyPeriods(sweep)).toEqual(["TD.00702"]);
    expect(failedPeriods(sweep)).toEqual([]);
  });

  it("does not flag an idle month when the whole year is idle", () => {
    // A taxpayer with no invoices in any month is a legitimate empty export,
    // and flagging it would train the user to ignore the flag.
    const sweep = sweepOf(
      [
        { period: "TD.00701", rows: 0 },
        { period: "TD.00702", rows: 0 },
      ],
      yearPlan(1, 2),
    );
    expect(emptyPeriods(sweep)).toEqual([]);
    expect(sweep.totalRows).toBe(0);
  });

  it("keeps a failed period separate from a quiet one", () => {
    const sweep = sweepOf(
      [
        { period: "TD.00701", rows: 16756 },
        { period: "TD.00702", rows: 0, error: "HTTP 503" },
      ],
      yearPlan(1, 2),
    );
    expect(failedPeriods(sweep)).toEqual(["TD.00702"]);
    // A failed period is not "empty": it is missing data we do not have.
    expect(emptyPeriods(sweep)).toEqual([]);
    expect(sweep.totalRows).toBe(16756);
  });

  it("reports several anomalies at once", () => {
    const sweep = sweepOf(
      [
        { period: "TD.00701", rows: 16756 },
        { period: "TD.00702", rows: 0 },
        { period: "TD.00703", rows: 0, error: "timeout" },
        { period: "TD.00704", rows: 0 },
      ],
      yearPlan(1, 4),
    );
    expect(emptyPeriods(sweep)).toEqual(["TD.00702", "TD.00704"]);
    expect(failedPeriods(sweep)).toEqual(["TD.00703"]);
  });
});

// ── The union a resume builds ──────────────────────────

describe("mergeSweeps — the union a resume builds", () => {
  it("folds the resumed masa in and keeps the year's own scope", () => {
    const kept = sweepOf(countsOf(["TD.00701", 3], ["TD.00702", 0, "gagal"]), yearPlan());
    const resumed = sweepOf(countsOf(["TD.00702", 5], ["TD.00703", 0]), [
      "TD.00702",
      "TD.00703",
    ]);

    const union = mergeSweeps(kept, resumed);

    // The plan is the year, not the half that just arrived: the fraction the
    // panel prints must read "3 dari 12", never "2 dari 2".
    expect(union.plan.length).toBe(12);
    expect(union.counts.map((c) => c.period)).toEqual([
      "TD.00701", "TD.00702", "TD.00703",
    ]);
    // The retry replaces the failure it retried, and the month the portal
    // answered with nothing is flagged only because its neighbours have rows.
    expect(failedPeriods(union)).toEqual([]);
    expect(emptyPeriods(union)).toEqual(["TD.00703"]);
    expect(union.totalRows).toBe(8);
  });

  it("lets the incoming count win for a period it covers again", () => {
    const kept = sweepOf(countsOf(["TD.00701", 1]), yearPlan());
    const resumed = sweepOf(countsOf(["TD.00701", 9]), yearPlan());
    expect(mergeSweeps(kept, resumed).counts).toEqual([{ period: "TD.00701", rows: 9 }]);
  });

  it("recomputes the empty and failed lists instead of merging them by hand", () => {
    // A union of two all-empty halves is not an anomaly: nothing had rows on
    // either side, so the rule that flags an empty masa between populated ones
    // must not fire.
    const kept = sweepOf(countsOf(["TD.00701", 0]), yearPlan());
    const resumed = sweepOf(countsOf(["TD.00702", 0]), yearPlan());
    const union = mergeSweeps(kept, resumed);
    expect(emptyPeriods(union)).toEqual([]);
    expect(union.totalRows).toBe(0);
  });

  it("takes the deduplicated row count the caller knows", () => {
    const kept = sweepOf(countsOf(["TD.00701", 3]), yearPlan());
    const resumed = sweepOf(countsOf(["TD.00702", 3]), yearPlan());
    // The two halves were counted by two accumulators, so their counts can
    // overlap: the panel names what the FILE holds (ADR-0016).
    expect(mergeSweeps(kept, resumed, 4).totalRows).toBe(4);
  });

  it("keeps the whole year on the table when a resumed half covered only its suffix", () => {
    // THE case a reconstructed plan got wrong: a resume's own half starts
    // wherever the resume began, so its plan is a SUFFIX of the year's. Read on
    // its own the half says it is complete; read as the union it is still
    // missing the months the kept half never fetched.
    const kept = sweepOf(countsOf(["TD.00701", 3]), yearPlan());
    const resumed = sweepOf(
      countsOf(
        ...yearPlan(4, 12).map((period) => [period, 1] as [string, number]),
      ),
      yearPlan(4, 12),
    );

    expect(resumed.plan).toEqual(yearPlan(4, 12));
    const union = mergeSweeps(kept, resumed);
    expect(union.plan).toEqual(yearPlan());
    expect(missingPeriods(union)).toEqual(["TD.00702", "TD.00703"]);
  });
});
