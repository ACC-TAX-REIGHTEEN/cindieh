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
import type { ExportMode } from "../content/exporter";

function makeDeps(overrides: Partial<ActionDeps> = {}): ActionDeps {
  return {
    postToScraper: vi.fn(),
    showPanel: vi.fn(),
    updatePanelProgress: vi.fn(),
    updatePanelIdle: vi.fn(),
    updatePanelError: vi.fn(),
    getMultiInvoiceNumbers: vi.fn(() => []),
    isEfakturPage: vi.fn(() => true),
    isBatchPage: vi.fn(() => true),
    shouldConfirmBulkDownload: vi.fn(() => false),
    getExportMode: vi.fn<() => ExportMode>(() => "cleaned"),
    exportXLSX: vi.fn(),
    exportCSV: vi.fn(),
    triggerSearch: vi.fn(),
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

  it("refuses on a page whose period filter was never measured", () => {
    const alertSpy = vi.fn();
    vi.stubGlobal("alert", alertSpy);
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmSpy);
    const deps = makeDeps({ isBatchPage: vi.fn(() => false) });

    expect(startBatchExport(deps)).toBe(false);
    expect(deps.postToScraper).not.toHaveBeenCalled();
    // The confirmation is not even asked: the run could not start regardless.
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalled();
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
});