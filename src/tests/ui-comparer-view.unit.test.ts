// ============================================================
// UI-COMPARER-VIEW.UNIT.TEST.TS — the Bandingkan tab, on its own
// ============================================================
// The tab became its own module (ADR-0036) for the same reason the
// Pengecekan tab did: so it can be built, driven and asserted WITHOUT
// the overlay, and so the panel that hosts it is only a composition
// root. Every case here mounts `createComparerView(deps)` over a
// private Run and a stub DOM, and drives it through the factory's own
// interface — no `injectComparerModal()`, no openPanel, no page.
//
// What is asserted is the tab's own decisions: when it asks for a
// scrape and when it stays quiet, what it promises while it waits,
// when the promise may be taken back, and where a reference it can
// not find goes. The comparison arithmetic is comparer-logic.ts's and
// is tested there.
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubFakeDom, type FakeDoc, type FakeEl } from "./__mocks__/fake-dom";

// The two file writers are the only browser-adjacent ends this tab
// reaches; everything else it renders is the tab's own decision.
vi.mock("../content/exporter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../content/exporter")>();
  return {
    ...actual,
    downloadXLSXFile: vi.fn(async () => {}),
    downloadCSVFile: vi.fn(),
  };
});

// The production singleton holds the SHARED Run, so the mocked module
// replaces it the way a fresh registry does — the factory cases never
// touch it, and `comparerView.available()` can still be read.
vi.mock("../content/run-lifecycle", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../content/run-lifecycle")>();
  return { ...actual, runLifecycle: actual.createRunLifecycle() };
});

// The two ends of "go and fetch the grid", mocked so a case about the
// tab's decision does not also assert the bridge's.
vi.mock("../content/main-actions", () => ({ startScrape: vi.fn() }));
vi.mock("../content/bridge", () => ({ postToScraper: vi.fn() }));

// ── The tab under test ────────────────────────────────

type ComparerView = import("../content/ui-comparer-view").ComparerView;
type ComparerViewDeps = import("../content/ui-comparer-view").ComparerViewDeps;

interface Harness {
  doc: FakeDoc;
  view: ComparerView;
  deps: ComparerViewDeps;
  /** The Run the tab reads, so a case can finish one the way a scrape does. */
  run: import("../content/run-lifecycle").RunLifecycle;
  scrape: ReturnType<typeof vi.fn>;
  searchReference: ReturnType<typeof vi.fn>;
  exporter: typeof import("../content/exporter");
}

/** Two pasted rows: one the grid will have, one it will not. */
const PASTED = "000123\t000456\t1.234,56789\t0\n999999\t000457\t1.000,00\t110,00";

describe("the tab Bandingkan Data Penjualan, on its own", () => {
  let h: Harness;

  const el = (id: string): FakeEl & { disabled: boolean; checked: boolean } =>
    h.doc.getElementById(id)! as FakeEl & { disabled: boolean; checked: boolean };
  const fire = (id: string, event = "click"): void => {
    for (const listener of el(id).listeners[event] ?? []) listener();
  };
  /** One row per rendered result, without the table's header row. */
  const bodyRows = (): FakeEl[] =>
    el("ch-comparer-results").querySelector("tbody")!.children;
  /** The pasted rows, typed into the tab's own paste area. */
  const paste = (text = PASTED): void => {
    el("ch-comparer-textarea").value = text;
    // Daily mode is on by default, so the day list is part of a valid check.
    el("ch-comparer-daily-dates").value = "1";
  };

  /** Build the tab over a fresh DOM and a fresh Run. */
  async function mount(deps: Partial<ComparerViewDeps> = {}): Promise<void> {
    vi.resetModules();
    const doc = stubFakeDom().doc;
    const create = doc.createElement.bind(doc);
    vi.spyOn(doc, "createElement").mockImplementation((tag) => {
      const element = Object.assign(create(tag), { disabled: false, checked: false });
      Object.defineProperty(element, "innerHTML", {
        get: () => "",
        set: () => {
          element.children = [];
          element.textContent = "";
        },
      });
      return element;
    });

    const runModule = await import("../content/run-lifecycle");
    const run = runModule.createRunLifecycle();
    const exporter = await import("../content/exporter");
    const viewModule = await import("../content/ui-comparer-view");
    const scrape = vi.fn();
    const searchReference = vi.fn();

    h = {
      doc,
      view: null as unknown as ComparerView,
      run,
      scrape,
      searchReference,
      exporter,
      deps: {
        run,
        scrape,
        searchReference,
        gridLabel: () => "PPN Keluaran",
        available: () => true,
        ...deps,
      },
    };
    h.view = viewModule.createComparerView(h.deps);
    h.view.inject();
    // The stub's appendChild is typed for its own elements; the root is a real
    // HTMLElement as far as the tab is concerned.
    h.doc.body.appendChild(h.view.root as unknown as FakeEl);
  }

  /**
   * Settle the Run with rows, as a finished scrape does.
   *
   * The outcome is returned because that is how the Run says what it still owed:
   * a completion hands its follow-up work back, and there is no getter for it.
   */
  function finishRun(rows: Record<string, unknown>[]) {
    h.run.begin("scrape");
    return h.run.complete({
      type: "SCRAPE_COMPLETE",
      data: rows,
      fields: ["Reference", "SellingPrice", "VAT", "BuyerTIN", "TaxInvoiceNumber"],
      total: rows.length,
      pages: 1,
      elapsed: "1s",
      source: "OUTPUT_TAX",
    });
  }

  /** The follow-up work a completed Run hands back, or null when it refused. */
  function followUpOf(outcome: ReturnType<typeof finishRun>): unknown {
    return outcome.kind === "accepted" ? outcome.followUp : null;
  }

  /** The row the pasted reference "000123" is compared against. */
  const scrapedRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    Reference: "000123",
    SellingPrice: 1234.56789,
    VAT: 0,
    BuyerTIN: "0012345678901234",
    TaxInvoiceNumber: "04012600023333322",
    ...over,
  });

  /** Compare a found row and an absent one, and leave the grid showing. */
  function compareTwoRows(): void {
    paste();
    finishRun([scrapedRow()]);
    fire("ch-comparer-check-btn");
    expect(bodyRows()).toHaveLength(2);
  }

  beforeEach(async () => {
    await mount();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  // ── Building the tab ─────────────────────────────

  it("builds its own tab root, so the panel only has to mount it", () => {
    // The shell is handed a button and a view; the tab's markup is here, which
    // is what lets it be mounted without the overlay at all.
    expect(h.view.root.id).toBe("ch-comparer-view-compare");
    expect(el("ch-comparer-textarea")).toBeTruthy();
    expect(el("ch-comparer-check-btn")).toBeTruthy();
    expect(el("ch-comparer-clear-btn")).toBeTruthy();
    expect(el("ch-comparer-tolerance")).toBeTruthy();
    expect(el("ch-comparer-ref-lain")).toBeTruthy();
    expect(el("ch-comparer-daily")).toBeTruthy();
    expect(el("ch-comparer-daily-dates")).toBeTruthy();
    expect(el("ch-comparer-filter-wrap")).toBeTruthy();
    expect(el("ch-comparer-export-btn")).toBeTruthy();
    expect(el("ch-comparer-export-csv-btn")).toBeTruthy();
    expect(el("ch-comparer-status")).toBeTruthy();
    expect(el("ch-comparer-results")).toBeTruthy();
  });

  it("injects once, so a panel rebuilt around the tab cannot double its controls", () => {
    const before = h.view.root.children.length;
    h.view.inject();
    h.view.inject();
    expect(h.view.root.children).toHaveLength(before);
    // The filter menu is what the shell joins across both tabs, and it survives
    // a second inject rather than being replaced by a detached one.
    expect(h.view.filterMenu).not.toBeNull();
    expect(h.view.filterMenu!.wrap.id).toBe("ch-comparer-filter-wrap");
  });

  it("asks its own gate, so a page that cannot match by Referensi never offers it", async () => {
    // The gate is injected, never read from the page by the tab: the tab is
    // what the question is about (ADR-0021, ADR-0036).
    await mount({ available: () => false });
    expect(h.view.available()).toBe(false);
    await mount({ available: () => true });
    expect(h.view.available()).toBe(true);
  });

  // ── Waiting for the grid, and not waiting ─────────

  it("waits for the grid instead of comparing nothing, and keeps what was pasted", () => {
    paste();
    fire("ch-comparer-check-btn");

    // The promise is made in the tab's own line, the Run is told it owes a
    // comparison, and the grid is fetched exactly once.
    expect(el("ch-comparer-status").textContent).toContain("Mohon tunggu");
    expect(el("ch-comparer-status").textContent).toContain("PPN Keluaran");
    expect(followUpOf(finishRun([scrapedRow()]))).toEqual([{ kind: "compare" }]);
    expect(h.scrape).toHaveBeenCalledOnce();
    // Nothing was compared, so there is nothing to export yet.
    expect(el("ch-comparer-export-btn").disabled).toBe(true);
    // The pasted text is the expensive thing to retype; the tab never clears it.
    expect(el("ch-comparer-textarea").value).toBe(PASTED);
  });

  it("does not start a scrape it could never report on", () => {
    // A tab whose line is no longer on the page has nowhere to say what
    // happened; starting a Run it cannot answer would be a fetch for nobody.
    paste();
    // Held before the tab leaves the page: the click has to be fired on the
    // button itself, since by then no id resolves to it.
    const checkBtn = el("ch-comparer-check-btn");
    (h.view.root as unknown as FakeEl).remove();

    for (const listener of checkBtn.listeners["click"]) listener();

    expect(h.scrape).not.toHaveBeenCalled();
    // Nothing was recorded, so the completion that follows owes nothing either.
    expect(followUpOf(finishRun([scrapedRow()]))).toEqual([]);
  });

  it("compares against a settled Run and opens both export paths", () => {
    compareTwoRows();

    expect(h.scrape).not.toHaveBeenCalled();
    const summary = el("ch-comparer-status").textContent;
    expect(summary).not.toBe("");
    expect(summary).not.toContain("Mohon tunggu");
    expect(el("ch-comparer-export-btn").disabled).toBe(false);
    expect(el("ch-comparer-export-csv-btn").disabled).toBe(false);
    // The paste area folds away once there is a result to look at.
    expect(el("ch-comparer-textarea").classList.contains("ch-hidden")).toBe(true);
  });

  it("takes back its own promise, but never a summary", () => {
    paste();
    fire("ch-comparer-check-btn");
    expect(el("ch-comparer-status").textContent).toContain("Mohon tunggu");

    h.view.dropPending();
    expect(el("ch-comparer-status").textContent).toContain("Permintaan dibatalkan");

    finishRun([scrapedRow()]);
    h.view.runPending();
    const summary = el("ch-comparer-status").textContent;
    expect(summary).not.toBe("");

    // A retirement that lands after the real answer leaves it alone.
    h.view.dropPending();
    expect(el("ch-comparer-status").textContent).toBe(summary);
  });

  // ── The grid and its hand-back ────────────────────

  it("hands a found row's reference back to the grid, and offers nothing for a missing one", () => {
    compareTwoRows();

    const found = bodyRows()[0];
    const missing = bodyRows()[1];
    expect(found.listeners["dblclick"]?.length).toBeGreaterThan(0);
    expect(found.title).toContain("klik 2x");
    // A row Coretax does not have has nothing to search for, so it is not
    // advertised as searchable and has no handler behind the claim.
    expect(missing.listeners["dblclick"]).toBeUndefined();
    expect(missing.title).not.toContain("klik 2x");

    for (const listener of found.listeners["dblclick"]) listener();

    expect(h.searchReference).toHaveBeenCalledWith("000123");
    // The row is marked as one already looked at, so the grid says so.
    expect(bodyRows()[0].classList.contains("ch-comparer-row-viewed")).toBe(true);
  });

  it("reruns the comparison when the tolerance changes", () => {
    compareTwoRows();

    el("ch-comparer-tolerance").value = "5";
    fire("ch-comparer-tolerance", "change");

    // The Run already holds the rows, so a rerun needs no second scrape — and a
    // rerun never leaves work owed to a completion that has already arrived.
    expect(h.scrape).not.toHaveBeenCalled();
    expect(el("ch-comparer-export-btn").disabled).toBe(false);
    expect(bodyRows()).toHaveLength(2);
  });

  it("clears its results, its exports and the comparison it asked for on Hapus", () => {
    const retired = vi.fn();
    h.run.onRetired(retired);
    paste();
    fire("ch-comparer-check-btn");

    fire("ch-comparer-clear-btn");

    // A tab retiring its OWN request does not announce it: the badge has no
    // stop to account for, which is why `cancelPending` stays silent while a
    // retirement that takes a request away from a waiting tab does not.
    expect(retired).not.toHaveBeenCalled();
    // Cancelled all the same: the completion that follows owes it nothing.
    expect(followUpOf(finishRun([scrapedRow()]))).toEqual([]);
    expect(el("ch-comparer-textarea").value).toBe("");
    expect(el("ch-comparer-export-btn").disabled).toBe(true);
    expect(el("ch-comparer-export-csv-btn").disabled).toBe(true);
    expect(el("ch-comparer-results").classList.contains("ch-hidden")).toBe(true);
    expect(el("ch-comparer-status").textContent).toBe("");
  });

  // ── Export ─────────────────────────────────────────

  it("exports the grid in either format, from the one set of rows", () => {
    compareTwoRows();

    fire("ch-comparer-export-csv-btn");
    expect(h.exporter.downloadCSVFile).toHaveBeenCalledOnce();
    const [csvRows, csvName] = vi.mocked(h.exporter.downloadCSVFile).mock.calls[0];
    expect(csvName).toBe("perbandingan-faktur.csv");
    // Both pasted references travel, matched or not: the file is the grid.
    expect(JSON.stringify(csvRows)).toContain("000123");
    expect(JSON.stringify(csvRows)).toContain("999999");

    fire("ch-comparer-export-btn");
    expect(h.exporter.downloadXLSXFile).toHaveBeenCalledOnce();
    const [, xlsxName, sheetName, options] = vi.mocked(h.exporter.downloadXLSXFile).mock
      .calls[0] as unknown as [unknown, string, string, { numberFormats?: unknown[] }];
    expect(xlsxName).toBe("perbandingan-faktur.xlsx");
    expect(sheetName).toBe("Perbandingan");
    // The amount formats come off the column schema the rows were built from, so
    // the two cannot disagree about which columns are numbers.
    expect(Object.keys(options.numberFormats ?? {}).length).toBeGreaterThan(0);
  });

  it("reports a failed Excel build in its own status line", async () => {
    compareTwoRows();
    vi.mocked(h.exporter.downloadXLSXFile).mockRejectedValueOnce(
      new Error("chunk tidak tersedia"),
    );

    fire("ch-comparer-export-btn");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(el("ch-comparer-status").textContent).toContain("Gagal");
    expect(el("ch-comparer-status").className).toContain("status-error");
    // The failure does not take the result away: a retry is one click.
    expect(el("ch-comparer-export-btn").disabled).toBe(false);
  });

  // ── The tab's own work when the panel opens on it ─

  it("puts the caret in its paste area when the panel opens on it", () => {
    h.view.focusInput();

    // The fake has no focus tree, so the last focus() call is what holds it.
    expect(h.doc.activeElement).toBe(el("ch-comparer-textarea"));
  });

  it("runs the comparison on Ctrl+Enter in the paste area", () => {
    paste();
    finishRun([scrapedRow()]);

    for (const listener of el("ch-comparer-textarea").listeners["keydown"] ?? []) {
      listener({ ctrlKey: true, key: "Enter", preventDefault: vi.fn() });
    }

    expect(bodyRows()).toHaveLength(2);
    expect(el("ch-comparer-export-btn").disabled).toBe(false);
  });
});
