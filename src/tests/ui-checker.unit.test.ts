import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubFakeDom, type FakeDoc, type FakeEl } from "./__mocks__/fake-dom";

// The SheetJS chunk and the CSV writer are the only things here worth spying
// on; the tab's own work is deciding what to render, which is what these cases
// are about.
vi.mock("../content/exporter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../content/exporter")>();
  return {
    ...actual,
    downloadXLSXFile: vi.fn(async () => {}),
    downloadCSVFile: vi.fn(),
  };
});

// The production view reads the shared Run, so it is replaced per module
// registry — exactly the instance the exported singleton holds.
vi.mock("../content/run-lifecycle", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../content/run-lifecycle")>();
  return { ...actual, runLifecycle: actual.createRunLifecycle() };
});

/** Which grid the fake portal says we are on. Flipped by the production cases. */
const page = { outputTax: true };
vi.mock("../content/page-context", () => ({
  isOutputTaxPage: () => page.outputTax,
  isVatInvoicePage: () => true,
}));

// The production tab's "no data yet" path reaches the real bridge. Mocking the
// two ends of it keeps that case about the tab's own decision.
vi.mock("../content/main-actions", () => ({ startScrape: vi.fn() }));
vi.mock("../content/bridge", () => ({ postToScraper: vi.fn() }));

// ── The tab under test ────────────────────────────────

type CheckerView = import("../content/ui-checker").CheckerView;
type CheckerViewDeps = import("../content/ui-checker").CheckerViewDeps;

interface Harness {
  doc: FakeDoc;
  view: CheckerView;
  deps: CheckerViewDeps;
  /** The Run the view reads, so a case can finish one the way a scrape does. */
  run: import("../content/run-lifecycle").RunLifecycle;
  scrape: ReturnType<typeof vi.fn>;
  searchReference: ReturnType<typeof vi.fn>;
  openCheckTab: ReturnType<typeof vi.fn>;
  exporter: typeof import("../content/exporter");
}

/** A scraped PPN-grid row. Override any amount to make the check disagree. */
const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  Reference: "REF-001",
  TaxInvoiceNumber: "04012600023333322",
  TaxInvoiceDate: "2026-07-01",
  BuyerName: "PT Contoh",
  BuyerTIN: "0012345678901234",
  // DPP 1.000.000 → DPP NL 916.667 and PPN 110.000 at the declared rates.
  SellingPrice: 1_000_000,
  OtherTaxBase: 916_667,
  VAT: 110_000,
  ...over,
});

describe("the tab Pengecekan, on its own", () => {
  let h: Harness;

  const el = (id: string): FakeEl => h.doc.getElementById(id)!;
  const fire = (id: string, event = "click"): void => {
    for (const listener of el(id).listeners[event] ?? []) listener();
  };
  /** The text of every cell in one grid row, in column order. */
  const cells = (rowEl: FakeEl): string[] => rowEl.children.map((cell) => cell.textContent);
  /** The header labels currently drawn. */
  const headers = (): string[] =>
    el("ch-checker-results").querySelector("thead")!.children[0].children.map((th) => th.textContent);
  /** One row per rendered result, minus the table's own header. */
  const bodyRows = (): FakeEl[] =>
    el("ch-checker-results").querySelector("tbody")!.children;
  /** The filter menu's checkboxes, in menu order — the reset row first. */
  const filterCheckboxes = (): (FakeEl & { checked: boolean; value: string })[] =>
    el("ch-checker-filter-menu").children.map(
      (item) => item.children[0] as FakeEl & { checked: boolean; value: string },
    );

  /** Build the tab over a fresh DOM and a fresh Run. */
  async function mount(
    deps: Partial<CheckerViewDeps> = {},
    production = false,
  ): Promise<void> {
    vi.resetModules();
    const doc = stubFakeDom().doc;
    const create = doc.createElement.bind(doc);
    vi.spyOn(doc, "createElement").mockImplementation((tag) => {
      const element = Object.assign(create(tag), { disabled: false, checked: false });
      Object.defineProperty(element, "innerHTML", {
        get: () => "",
        set: () => { element.children = []; element.textContent = ""; },
      });
      return element;
    });
    (globalThis as { document: unknown }).document = doc;

    const runModule = await import("../content/run-lifecycle");
    // The production view holds the SHARED Run, so mounting it means holding the
    // mocked singleton rather than a fresh one — otherwise the case would be
    // seeding a Run the view never reads.
    const run = production ? runModule.runLifecycle : runModule.createRunLifecycle();
    const exporter = await import("../content/exporter");
    const ui = await import("../content/ui-checker");
    const scrape = vi.fn();
    const searchReference = vi.fn();
    const openCheckTab = vi.fn();

    h = {
      doc,
      view: null as unknown as CheckerView,
      run,
      scrape,
      searchReference,
      openCheckTab,
      exporter,
      deps: {
        run,
        scrape,
        searchReference,
        openCheckTab,
        gridLabel: () => "PPN Keluaran",
        counterparty: () => "pembeli",
        canSearchInGrid: () => true,
        ...deps,
      },
    };
    h.view = production ? ui.checkerView : ui.createCheckerView(h.deps);
    h.view.inject();
    // The stub's appendChild is typed for its own elements; the root is a real
    // HTMLElement as far as the tab is concerned.
    h.doc.body.appendChild(h.view.root as unknown as FakeEl);
  }

  /** Settle a Run with rows, as a finished scrape does. */
  function finishRun(rows: Record<string, unknown>[]): void {
    h.run.begin("scrape");
    h.run.complete({
      type: "SCRAPE_COMPLETE",
      data: rows,
      fields: ["Reference", "SellingPrice", "OtherTaxBase", "VAT"],
      total: rows.length,
      pages: 1,
      elapsed: "1s",
      source: "OUTPUT_TAX",
    });
  }

  beforeEach(async () => { await mount(); });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  // ── Building the tab ─────────────────────────────

  it("builds its own tab root, so the panel only has to mount it", () => {
    expect(h.view.root.id).toBe("ch-comparer-view-checker");
    expect(h.view.root.className).toBe("ch-comparer-view ch-hidden");
    expect(el("ch-checker-check-btn")).toBeTruthy();
    expect(el("ch-checker-benchmark-select")).toBeTruthy();
    expect(el("ch-checker-tolerance")).toBeTruthy();
    expect(el("ch-checker-export-btn")).toBeTruthy();
    expect(el("ch-checker-export-csv-btn")).toBeTruthy();
    expect(el("ch-checker-status")).toBeTruthy();
    expect(el("ch-checker-results")).toBeTruthy();
  });

  it("offers exactly the benchmarks the schema declares", () => {
    // One list, two owners: a benchmark the session cannot store must not be
    // selectable, and one it can store must not be missing.
    const options = el("ch-checker-benchmark-select").children;
    expect(options.map((o) => o.value)).toEqual(["DPP", "DPP_NILAI_LAIN", "PPN"]);
    expect(options.map((o) => o.textContent)).toEqual(["DPP", "DPP NL", "PPN"]);
  });

  it("offers a filter checkbox for every schema status, plus the reset row", () => {
    const labels = [...el("ch-checker-filter-menu").children].map((item) => item.children[1].textContent);
    expect(labels).toEqual([
      "Semua Status",
      "DPP Berbeda",
      "DPP NL Berbeda",
      "PPN Berbeda",
      "Dua Nilai Berbeda",
      "Data tidak lengkap",
    ]);
  });

  it("seeds itself from the popup's stored checker defaults", async () => {
    // The panel owns these controls for the life of the modal, so a re-injected
    // tab must not fall back to the session's own defaults.
    await mount();
    (await import("../content/preferences")).setPreferences({
      checkerDefaults: { benchmark: "PPN", tolerance: 5, statusFilter: ["PPN_BERBEDA"] },
    });

    h.view = (await import("../content/ui-checker")).createCheckerView(h.deps);
    h.view.inject();
    expect(el("ch-checker-benchmark-select").value).toBe("PPN");
    expect(el("ch-checker-tolerance").value).toBe("5");
    // The stored filter is what the checkboxes show, not "Semua Status".
    const boxes = filterCheckboxes();
    expect(boxes.map((cb) => [cb.value, cb.checked])).toEqual([
      ["ALL", false],
      ["DPP_BERBEDA", false],
      ["DPP_NILAI_LAIN_BERBEDA", false],
      ["PPN_BERBEDA", true],
      ["DUA_BERBEDA", false],
      ["DATA_TIDAK_LENGKAP", false],
    ]);
  });

  it("shows an empty tolerance box rather than a zero", () => {
    expect(el("ch-checker-tolerance").value).toBe("");
  });

  it("is idempotent — a second injection does not double the controls", () => {
    // The portal is an Angular SPA that re-renders constantly, so the panel can
    // be asked to inject again while it is already on the page.
    const controls = el("ch-checker-check-btn").parentElement!.children.length;
    const results = el("ch-checker-results").children.length;

    h.view.inject();

    expect(el("ch-checker-check-btn").parentElement!.children).toHaveLength(controls);
    expect(el("ch-checker-results").children).toHaveLength(results);
  });

  // ── Running a check ──────────────────────────────

  it("asks for a scrape, and says which grid, when the Run has no rows", () => {
    const request = vi.spyOn(h.run, "request");

    fire("ch-checker-check-btn");

    expect(request).toHaveBeenCalledWith({ kind: "check" });
    expect(h.scrape).toHaveBeenCalledOnce();
    expect(el("ch-checker-status").textContent).toContain("scraping data PPN Keluaran");
    expect(el("ch-checker-status").className).toContain("ch-comparer-status-info");
  });

  it("names the grid the page actually shows", async () => {
    await mount({ gridLabel: () => "PPN Masukan" });
    fire("ch-checker-check-btn");
    expect(el("ch-checker-status").textContent).toContain("scraping data PPN Masukan");
  });

  it("renders the mismatched rows and leaves out the ones that add up", () => {
    finishRun([row(), row({ Reference: "REF-002", VAT: 110_001 })]);

    fire("ch-checker-check-btn");

    // checkAllRowsAccuracy returns only rows that disagree.
    expect(bodyRows()).toHaveLength(1);
    expect(cells(bodyRows()[0])).toContain("REF-002");
    expect(cells(bodyRows()[0])).toContain("PPN Berbeda");
    expect(el("ch-checker-status").textContent).toBe("Ditemukan 1 faktur dengan nilai tidak sesuai.");
  });

  it("reports a clean grid as such, and hides the filter it cannot use", () => {
    finishRun([row()]);

    fire("ch-checker-check-btn");

    expect(el("ch-checker-results").querySelector("table")).toBeNull();
    expect(el("ch-checker-results").textContent).toBe("Semua faktur sesuai.");
    expect(el("ch-checker-status").textContent).toBe("Semua faktur sesuai.");
    // Nothing to filter, so the menu stays out of the way.
    expect(el("ch-checker-filter-wrap").classList.contains("ch-hidden")).toBe(true);
  });

  it("labels the counterparty column for the side of the transaction", async () => {
    finishRun([row({ VAT: 110_001 })]);
    fire("ch-checker-check-btn");
    expect(headers()).toContain("Nama Pembeli");

    await mount({ counterparty: () => "penjual" });
    finishRun([row({ VAT: 110_001 })]);
    fire("ch-checker-check-btn");
    // PPN Masukan carries the seller, so "Pembeli" would describe the
    // taxpayer's own side and mislead.
    expect(headers()).toContain("Nama Penjual");
  });

  it("re-runs the whole grid when the Acuan changes", () => {
    // A row whose DPP is wrong for its DPP NL: under DPP the base is what is
    // tested, under DPP NL it is the derived DPP that is. The verdict therefore
    // has to change with the Acuan, not just the column headers.
    finishRun([row({ SellingPrice: 1_100_000, VAT: 110_001 })]);
    fire("ch-checker-check-btn");
    expect(el("ch-checker-benchmark-select").value).toBe("DPP");
    expect(headers()).toContain("Selisih DPP NL");
    expect(cells(bodyRows()[0])).toContain("DPP NL & PPN Berbeda");

    el("ch-checker-benchmark-select").value = "DPP_NILAI_LAIN";
    fire("ch-checker-benchmark-select", "change");

    expect(headers()).toContain("Selisih DPP");
    expect(headers()).not.toContain("Selisih DPP NL");
    expect(cells(bodyRows()[0])).toContain("DPP & PPN Berbeda");
  });

  it("re-runs the whole grid when the tolerance changes, and a covered difference stops being one", () => {
    finishRun([row({ VAT: 110_001 })]);
    fire("ch-checker-check-btn");
    expect(bodyRows()).toHaveLength(1);

    el("ch-checker-tolerance").value = "2";
    fire("ch-checker-tolerance", "change");

    // The grid is now empty, so the table goes with it rather than lingering.
    expect(el("ch-checker-results").querySelector("table")).toBeNull();
    expect(el("ch-checker-status").textContent).toBe("Semua faktur sesuai.");
  });

  it("treats a negative or unparseable tolerance as none", () => {
    finishRun([row({ VAT: 110_001 })]);
    fire("ch-checker-check-btn");

    el("ch-checker-tolerance").value = "-5";
    fire("ch-checker-tolerance", "change");

    expect(bodyRows()).toHaveLength(1);
  });

  it("re-checks a pending run with the panel reopened on this tab", () => {
    fire("ch-checker-check-btn");
    finishRun([row({ VAT: 110_001 })]);
    h.run.cancelPending("check");

    h.view.runPending();

    expect(h.openCheckTab).toHaveBeenCalledOnce();
    expect(bodyRows()).toHaveLength(1);
  });

  it("does nothing for a pending run with no rows to check", () => {
    h.view.runPending();
    expect(h.openCheckTab).not.toHaveBeenCalled();
    expect(el("ch-checker-status").textContent).toBe("");
  });

  // ── Filtering ────────────────────────────────────

  it("shows only the checked status, and counts it on the toggle", () => {
    finishRun([
      row({ Reference: "REF-PPN", VAT: 110_001 }),
      row({ Reference: "REF-INCOMPLETE", VAT: null }),
    ]);
    fire("ch-checker-check-btn");
    expect(bodyRows()).toHaveLength(2);

    const boxes = filterCheckboxes();
    boxes[3].checked = true; // PPN_BERBEDA
    fire2(boxes[3]);

    expect(cells(bodyRows()[0])).toContain("REF-PPN");
    expect(bodyRows()).toHaveLength(1);
    expect(el("ch-checker-filter-toggle").children[0].textContent).toBe("1 status");
  });

  /** Fire a checkbox's change listener directly — it is not reachable by id. */
  function fire2(box: FakeEl): void {
    for (const listener of box.listeners.change ?? []) listener();
  }

  it("treats 'Semua Status' as exclusive with the individual statuses", () => {
    finishRun([
      row({ Reference: "REF-PPN", VAT: 110_001 }),
      row({ Reference: "REF-INCOMPLETE", VAT: null }),
    ]);
    fire("ch-checker-check-btn");

    const boxes = filterCheckboxes();
    boxes[3].checked = true;
    fire2(boxes[3]);
    expect(boxes[0].checked).toBe(false);

    boxes[0].checked = true;
    fire2(boxes[0]);

    expect(boxes.slice(1).every((box) => !box.checked)).toBe(true);
    expect(bodyRows()).toHaveLength(2);
    expect(el("ch-checker-filter-toggle").children[0].textContent).toBe("Semua Status");
  });

  it("opens and closes its own filter menu", () => {
    const menu = el("ch-checker-filter-menu");
    expect(menu.classList.contains("ch-hidden")).toBe(true);

    for (const listener of el("ch-checker-filter-toggle").listeners.click ?? []) {
      listener({ stopPropagation: () => {} });
    }
    expect(menu.classList.contains("ch-hidden")).toBe(false);

    h.view.filterMenu!.close();
    expect(menu.classList.contains("ch-hidden")).toBe(true);
  });

  // ── Row interaction ──────────────────────────────

  it("expands a row on one click, but not when the click was on a control", () => {
    finishRun([row({ VAT: 110_001 })]);
    fire("ch-checker-check-btn");
    const tr = bodyRows()[0];

    for (const listener of tr.listeners.click ?? []) listener({ target: tr });
    expect(tr.classList.contains("ch-comparer-row-expanded")).toBe(true);

    for (const listener of tr.listeners.click ?? []) listener({ target: { tagName: "INPUT" } });
    // Still expanded: the second click was ignored rather than collapsing it.
    expect(tr.classList.contains("ch-comparer-row-expanded")).toBe(true);
  });

  it("hands a double-clicked row back to the portal grid, and marks it viewed", () => {
    finishRun([row({ VAT: 110_001 })]);
    fire("ch-checker-check-btn");
    const tr = bodyRows()[0];

    for (const listener of tr.listeners.dblclick ?? []) listener();

    expect(h.searchReference).toHaveBeenCalledWith("REF-001");
    expect(bodyRows()[0].classList.contains("ch-comparer-row-viewed")).toBe(true);
  });

  it("searches by tax-invoice number when the row has no Referensi", () => {
    finishRun([row({ Reference: "", VAT: 110_001 })]);
    fire("ch-checker-check-btn");

    for (const listener of bodyRows()[0].listeners.dblclick ?? []) listener();

    expect(h.searchReference).toHaveBeenCalledWith("04012600023333322");
  });

  it("offers no search on a grid that has no Referensi filter injected", async () => {
    // PPN Masukan: main.ts injects the reference filters on isOutputTaxPage()
    // alone, so a double-click there would silently do nothing.
    await mount({ canSearchInGrid: () => false });
    finishRun([row({ VAT: 110_001 })]);
    fire("ch-checker-check-btn");

    expect(bodyRows()[0].listeners.dblclick ?? []).toHaveLength(0);
  });

  it("reads the side of the transaction, the grid's name and its filter from the page", async () => {
    // The seam proves the tab obeys what it is told; this proves the PRODUCTION
    // tab is told the right things. Without it, `canSearchInGrid: isOutputTaxPage`
    // and `counterparty` could be wired to anything and every case above would
    // still pass, because they all inject their own answers.
    page.outputTax = true;
    await mount({}, true);
    finishRun([row({ VAT: 110_001 })]);
    fire("ch-checker-check-btn");
    expect(headers()).toContain("Nama Pembeli");
    expect(bodyRows()[0].listeners.dblclick ?? []).toHaveLength(1);

    // PPN Masukan: the invoice's SELLER, and no injected filter to search into.
    page.outputTax = false;
    await mount({}, true);
    finishRun([row({ VAT: 110_001 })]);
    fire("ch-checker-check-btn");
    expect(headers()).toContain("Nama Penjual");
    expect(bodyRows()[0].listeners.dblclick ?? []).toHaveLength(0);

    h.run.reset();
    page.outputTax = false;
    fire("ch-checker-check-btn");
    expect(el("ch-checker-status").textContent).toContain("scraping data PPN Masukan");
    page.outputTax = true;
  });

  // ── Export ───────────────────────────────────────

  it("exports the grid to Excel, with its own basename", () => {
    finishRun([row({ VAT: 110_001 })]);
    fire("ch-checker-check-btn");

    fire("ch-checker-export-btn");

    expect(h.exporter.downloadXLSXFile).toHaveBeenCalledOnce();
    const [rows, filename] = vi.mocked(h.exporter.downloadXLSXFile).mock.calls[0];
    expect(filename).toBe("pengecekan-nilai-faktur.xlsx");
    // The AOA carries its own header row above the one result.
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("Referensi");
    expect(h.exporter.downloadCSVFile).not.toHaveBeenCalled();
  });

  it("exports the grid to CSV, which needs no chunk and cannot fail", () => {
    finishRun([row({ VAT: 110_001 })]);
    fire("ch-checker-check-btn");

    fire("ch-checker-export-csv-btn");

    expect(h.exporter.downloadCSVFile).toHaveBeenCalledOnce();
    expect(h.exporter.downloadXLSXFile).not.toHaveBeenCalled();
  });

  it("exports nothing when the grid has no results", () => {
    fire("ch-checker-export-btn");
    fire("ch-checker-export-csv-btn");
    expect(h.exporter.downloadXLSXFile).not.toHaveBeenCalled();
    expect(h.exporter.downloadCSVFile).not.toHaveBeenCalled();
  });

  it("reports a failed Excel export on this tab's status line", async () => {
    vi.mocked(h.exporter.downloadXLSXFile).mockRejectedValueOnce(new Error("chunk 404"));
    finishRun([row({ VAT: 110_001 })]);
    fire("ch-checker-check-btn");

    fire("ch-checker-export-btn");
    await Promise.resolve();
    await Promise.resolve();

    expect(el("ch-checker-status").textContent).toBe("Gagal membuat berkas Excel. Coba ekspor kembali.");
    expect(el("ch-checker-status").className).toContain("ch-comparer-status-error");
  });

  // ── Pagination ───────────────────────────────────

  it("pages ten rows at a time and resets to the first page on a filter change", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      row({ Reference: `REF-${String(i).padStart(2, "0")}`, VAT: 110_001 }),
    );
    finishRun(many);
    fire("ch-checker-check-btn");

    expect(bodyRows()).toHaveLength(10);
    expect(cells(bodyRows()[0])).toContain("REF-00");
    const next = el("ch-checker-results").querySelector(".ch-comparer-pagination")!
      .children[2];
    for (const listener of next.listeners.click ?? []) listener();
    expect(cells(bodyRows()[0])).toContain("REF-10");

    const boxes = filterCheckboxes();
    boxes[3].checked = true;
    fire2(boxes[3]);
    expect(cells(bodyRows()[0])).toContain("REF-00");
  });
});