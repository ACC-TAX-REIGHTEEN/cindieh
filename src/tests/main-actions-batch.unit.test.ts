// Unit tests for the year-wide batch entry point in main-actions.ts.
//
// A batch is a long, portal-heavy run, so what matters is what does NOT happen:
// no second run while one is in flight, no message posted when the confirmation
// is declined, and no export on a page whose period filter was never measured.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../content/ui-filters", () => ({
  getMultiInvoiceNumbers: () => [],
}));
vi.mock("../content/run-lifecycle", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../content/run-lifecycle")>();
  return { ...actual, runLifecycle: actual.createRunLifecycle() };
});

import {
  startBatchExport,
  batchConfirmMessage,
  BATCH_MONTHS,
  type ActionDeps,
} from "../content/main-actions";
import { runLifecycle } from "../content/run-lifecycle";
import { summarisePeriods } from "../content/scrape-batch";
import type { ExportMode } from "../content/exporter";

function makeDeps(overrides: Partial<ActionDeps> = {}): ActionDeps {
  return {
    postToScraper: vi.fn(),
    showPanel: vi.fn(),
    updatePanelProgress: vi.fn(),
    updatePanelError: vi.fn(),
    getMultiInvoiceNumbers: vi.fn(() => []),
    isEfakturPage: vi.fn(() => true),
    shouldConfirmBulkDownload: vi.fn(() => false),
    getExportMode: vi.fn<() => ExportMode>(() => "cleaned"),
    exportXLSX: vi.fn(),
    exportCSV: vi.fn(),
    ...overrides,
  };
}

describe("startBatchExport", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    runLifecycle.reset();
  });

  it("asks the page world for one batch of a whole tax year, in a single message", () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    const deps = makeDeps();

    expect(startBatchExport(deps)).toBe(true);
    expect(deps.postToScraper).toHaveBeenCalledTimes(1);
    expect(deps.postToScraper).toHaveBeenCalledWith({
      type: "START_SCRAPE",
      skipPdf: true,
      batchMonths: 12,
    });
    expect(BATCH_MONTHS).toBe(12);
  });

  it("leaves the panel visible so the multi-minute run has a progress surface", () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    const deps = makeDeps();
    startBatchExport(deps);
    expect(deps.showPanel).toHaveBeenCalled();
    expect(deps.updatePanelProgress).toHaveBeenCalled();
    expect(runLifecycle.isRunning()).toBe(true);
  });

  it("requests the XLSX export up front, so no second click is needed", () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    startBatchExport(makeDeps());
    expect(runLifecycle.pendingExport()).toBe("xlsx");
  });

  it("starts NOTHING when the confirmation is declined", () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    const deps = makeDeps();

    expect(startBatchExport(deps)).toBe(false);
    // A begun Run with nothing posted would leave the panel claiming work that
    // can never complete.
    expect(deps.postToScraper).not.toHaveBeenCalled();
    expect(runLifecycle.isRunning()).toBe(false);
    expect(runLifecycle.pendingExport()).toBeNull();
  });

  it("refuses on a page that is not an e-Faktur PPN grid", () => {
    const alertSpy = vi.fn();
    vi.stubGlobal("alert", alertSpy);
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmSpy);
    const deps = makeDeps({ isEfakturPage: vi.fn(() => false) });

    expect(startBatchExport(deps)).toBe(false);
    expect(deps.postToScraper).not.toHaveBeenCalled();
    // The confirmation is not even asked: the run could not start regardless.
    expect(confirmSpy).not.toHaveBeenCalled();
    // The alert names the pages that DO have it, because "not here" without
    // "where" leaves the user clicking the same menu on the wrong grid.
    expect(String(alertSpy.mock.calls[0]?.[0])).toMatch(/PPN Masukan/);
  });

  it("refuses while another run is in flight rather than orphaning it", () => {
    const alertSpy = vi.fn();
    vi.stubGlobal("alert", alertSpy);
    vi.stubGlobal("confirm", vi.fn(() => true));
    const deps = makeDeps();
    runLifecycle.begin("scrape");

    expect(startBatchExport(deps)).toBe(false);
    // A second START_SCRAPE would either cancel the first run or run two
    // four-minute sweeps against the portal at once.
    expect(deps.postToScraper).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalled();
  });

  it("the confirmation says what it will do, how long, and that it can be stopped", () => {
    const message = batchConfirmMessage();
    expect(message).toContain("12 masa pajak");
    expect(message).toMatch(/beberapa menit/i);
    expect(message).toMatch(/dihentikan/i);
  });

  // ── Resuming a stopped sweep (ADR-0023) ───────────

  /** Settle a stopped year-wide sweep exactly as the MAIN world reports one. */
  function seedStoppedSweep(finished: [string, number][] = [["TD.00701", 1]]): void {
    runLifecycle.begin("scrape");
    runLifecycle.complete({
      type: "SCRAPE_COMPLETE",
      data: finished.map(([period]) => ({ RecordId: period })),
      fields: ["RecordId"],
      total: finished.length,
      pages: 1,
      elapsed: "1s",
      source: "OUTPUT_TAX",
      filenameHint: "2026",
      cancelled: true,
      periods: summarisePeriods(
        finished.map(([period, rows]) => ({ period, rows })),
        12,
      ),
    });
  }

  it("asks only for the masa a stop never finished, and keeps the rest", () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    seedStoppedSweep([["TD.00701", 4]]);
    const deps = makeDeps();

    expect(startBatchExport(deps)).toBe(true);

    // Eleven requests, not twelve — and the kept rows are still there for the
    // merge when the sweep comes back (main.ts unions them before settling).
    expect(deps.postToScraper).toHaveBeenCalledWith({
      type: "START_SCRAPE",
      skipPdf: true,
      sweepPeriods: [
        "TD.00702", "TD.00703", "TD.00704", "TD.00705", "TD.00706", "TD.00707",
        "TD.00708", "TD.00709", "TD.00710", "TD.00711", "TD.00712",
      ],
      sweepYear: "2026",
    });
    expect(runLifecycle.result()?.data).toEqual([{ RecordId: "TD.00701" }]);
    expect(runLifecycle.result()?.sweep?.planned).toBe(12);
  });

  it("resumes a sweep whose masa FAILED, because that masa holds no rows yet", () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    seedStoppedSweep([["TD.00701", 4], ["TD.00702", 0]]);
    // Mark the second one as a failure rather than an empty month: a stop that
    // landed mid-retry records exactly this shape.
    const kept = runLifecycle.result()!;
    kept.sweep!.counts[1].error = "Masa tidak diambil.";

    const deps = makeDeps();
    startBatchExport(deps);

    const posted = vi.mocked(deps.postToScraper).mock.calls[0][0] as { sweepPeriods: string[] };
    expect(posted.sweepPeriods).toContain("TD.00702");
    expect(posted.sweepPeriods).not.toContain("TD.00701");
  });

  it("starts a FRESH year when the kept half is already whole", () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    const allTwelve = Array.from({ length: 12 }, (_, i) =>
      [`TD.007${String(i + 1).padStart(2, "0")}`, 1] as [string, number],
    );
    runLifecycle.begin("scrape");
    runLifecycle.complete({
      type: "SCRAPE_COMPLETE",
      data: [{ RecordId: 1 }],
      fields: ["RecordId"],
      total: 1,
      pages: 1,
      elapsed: "1s",
      source: "OUTPUT_TAX",
      filenameHint: "2026",
      periods: summarisePeriods(
        allTwelve.map(([period, rows]) => ({ period, rows })),
        12,
      ),
    });
    const deps = makeDeps();

    startBatchExport(deps);

    // Nothing to resume: asking for a subset would be a resume that fetches
    // nothing, and the entry means "a year export" either way.
    expect(deps.postToScraper).toHaveBeenCalledWith({
      type: "START_SCRAPE",
      skipPdf: true,
      batchMonths: 12,
    });
    expect(runLifecycle.result()).toBeNull();
  });

  it("the resume confirmation names what is left and what is already saved", () => {
    const message = batchConfirmMessage({ pending: 2, finished: 10 });
    expect(message).toContain("10 masa sudah tersimpan");
    expect(message).toContain("2 masa tersisa");
    expect(message).toMatch(/tidak menghilangkan masa yang sudah tersimpan/i);
  });
});