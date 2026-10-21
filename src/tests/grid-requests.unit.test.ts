// ============================================================
// GRID-REQUESTS.UNIT.TEST.TS — the seam's own guarantees
// ============================================================
// The fixtures are only worth having if three things stay true: every e-Faktur
// grid has an entry, each entry declares where its data came from, and the
// capture never disagrees with the measured table or the guard. All three are
// relationships rather than snapshots, so a grid gaining a real capture (or a
// measured row) keeps them true instead of breaking them.
// ============================================================

import { describe, expect, it } from "vitest";
import {
  batchScopeError,
  capturedPeriod,
  capturedYear,
  measuredSweepFilters,
} from "../content/scrape-batch";
import {
  EFAKTUR_SOURCES,
  capturedFilters,
  gridRequest,
  gridRow,
  gridRows,
  rawBodyOf,
  rawBodyWithFilters,
} from "./__mocks__/grid-requests";

describe("the fixture covers every e-Faktur grid", () => {
  it.each(EFAKTUR_SOURCES)("has a request fixture for %s", (source) => {
    const fixture = gridRequest(source);
    expect(fixture.source).toBe(source);

    const body = JSON.parse(fixture.rawBody) as Record<string, unknown>;
    expect(Array.isArray(body.Filters), `${source} fixture must carry a Filters array`).toBe(true);
    expect(gridRows(source).length).toBeGreaterThan(0);
    expect(gridRow(source)).toEqual(gridRows(source)[0]);
  });

  it("declares provenance on every entry", () => {
    for (const source of EFAKTUR_SOURCES) {
      const fixture = gridRequest(source);
      // A capture has a date and an endpoint; a stand-in has neither. Both
      // directions are asserted, because a body read off the portal without its
      // date is exactly how an unverifiable claim outlives the session it came
      // from — and a stand-in with an endpoint would claim a URL nobody posted to.
      expect(fixture.capturedOn === null, `${source}: capturedOn must agree with captured`).toBe(
        !fixture.captured,
      );
      if (fixture.captured) expect(fixture.url, `${source}: a capture has an endpoint`).toBeTruthy();
      else expect(fixture.url, `${source}: a stand-in names no endpoint`).toBeNull();
      expect(typeof fixture.rowsCaptured).toBe("boolean");
    }
  });

  it("makes a capture exactly a measured row — the two tables hold each other", () => {
    // A measured grid without a capture is a claim nobody measured, and a
    // capture of a grid with no row is evidence nobody recorded. The two lists
    // are the same list, so neither can grow without the other.
    const captured = EFAKTUR_SOURCES.filter((source) => gridRequest(source).captured);
    const measured = EFAKTUR_SOURCES.filter((source) => measuredSweepFilters(source) !== null);
    expect(captured).toEqual(measured);
  });

  it.each([
    [
      "OUTPUT_TAX",
      "2026-10-06",
      "https://coretaxdjp.pajak.go.id/einvoiceportal/api/outputinvoice/list",
      "TD.00708",
    ],
    [
      "INPUT_TAX",
      "2026-10-21",
      "https://coretaxdjp.pajak.go.id/einvoiceportal/api/inputinvoice/list",
      "TD.00709",
    ],
  ] as const)(
    "keeps %s's capture, a body known to be the real thing",
    (source, capturedOn, url, period) => {
      const fixture = gridRequest(source);
      expect(fixture.captured).toBe(true);
      expect(fixture.capturedOn).toBe(capturedOn);
      expect(fixture.url).toBe(url);
      expect(capturedPeriod(fixture.rawBody, source)).toBe(period);
      expect(capturedYear(fixture.rawBody, source)).toBe("2026");
    },
  );
});

describe("the capture agrees with the measured table and the guard", () => {
  // These are the relationships that make a fixture worth trusting. A grid
  // cannot be measured without a capture (nobody measured it by looking at a
  // placeholder), and a measured grid's capture must satisfy the guard that
  // reads it — otherwise the table names filters the request does not carry.
  it.each(EFAKTUR_SOURCES)("holds for %s", (source) => {
    const measurement = measuredSweepFilters(source);
    const { captured } = gridRequest(source);

    if (measurement) {
      expect(captured, `${source} is measured, so its body must be a capture`).toBe(true);
      const names = capturedFilters(source)
        .map((filter) => filter.PropertyName)
        .filter((name): name is string => typeof name === "string");
      expect(names).toContain(measurement.period);
      expect(names).toContain(measurement.year);
      expect(batchScopeError(rawBodyOf(source), source)).toBeNull();
    } else {
      // Not measured ⇒ the year-wide export refuses here, whatever the body
      // looks like. That is the whole promise of MEASURED_SWEEP_FILTERS.
      expect(batchScopeError(rawBodyOf(source), source)).toMatch(/belum pernah diukur/);
    }
  });

  it("never lets an uncaptured entry carry the measured filter names", () => {
    // A stand-in that spelled its filters the way PPN Keluaran does would be a
    // measurement-shaped claim nobody made. Real captures carry names, and they
    // are written with captured: true; this is the line between the two.
    for (const source of EFAKTUR_SOURCES) {
      const fixture = gridRequest(source);
      const measurement = measuredSweepFilters(source);
      if (fixture.captured || !measurement) continue;
      const names = capturedFilters(source).map((filter) => filter.PropertyName);
      expect(names, `${source}: an uncaptured entry must not read as measured`).not.toContain(
        measurement.period,
      );
      expect(names).not.toContain(measurement.year);
    }
  });
});

describe("the seam hands out copies, never its own data", () => {
  it("does not change when a test rewrites the filters it was given", () => {
    const before = rawBodyOf("OUTPUT_TAX");
    rawBodyWithFilters("OUTPUT_TAX", []);
    expect(rawBodyOf("OUTPUT_TAX")).toBe(before);
    expect(capturedFilters("OUTPUT_TAX").length).toBeGreaterThan(0);
  });

  it("gives each caller its own rows, so one test's edits cannot reach another", () => {
    const first = gridRow("OUTPUT_TAX");
    first.BuyerName = "PT Someone Else";
    expect(gridRow("OUTPUT_TAX").BuyerName).toBe("PT Maju Jaya");
    expect(gridRows("OUTPUT_TAX")[0]).not.toBe(gridRows("OUTPUT_TAX")[0]);
  });

  it("refuses a grid with no fixture rather than handing back undefined", () => {
    expect(() => gridRequest("SPT_A2" as never)).toThrow(/no grid request fixture/);
  });
});
