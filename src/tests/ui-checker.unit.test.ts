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

/**
 * Which grid the fake portal says we are on, and whether it has an injected
 * Referensi filter. Flipped by the production cases, and deliberately INDEPENDENT
 * flags, because the questions are: `side` + `returns` are the grid's name,
 * `refFilter` is whether a lookup can be handed back, the identity column
 * follows the grid (a retur row has no Referensi at all) and the counterparty
 * follows the side (Retur Keluaran still carries the BUYER). PPN Masukan is the
 * case that proves they are separate facts: it filters, but has no identity.
 */
const page = { side: "out" as "out" | "in", returns: false, refFilter: true };
vi.mock("../content/page-context", () => ({
  isOutputTaxPage: () => page.side === "out" && !page.returns,
  isInputTaxPage: () => page.side === "in" && !page.returns,
  isOutputReturnPage: () => page.side === "out" && page.returns,
  isInputReturnPage: () => page.side === "in" && page.returns,
  isCheckerPage: () => true,
  isPanelPage: () => true,
  hasReferenceFilter: () => page.refFilter,
  checkerRowIdentity: () => (page.returns ? "no-retur" : "referensi"),
  counterpartyIsBuyer: () => page.side === "out",
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
        identity: () => "referensi",
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

  it("takes the waiting line back when the check it queued is retired", () => {
    // A stop (or a failure, a lost chunk, a reset) retires the check behind that
    // line, so no completion will ever arrive to replace it — and a line that
    // keeps promising one is the same lie as an export that never lands.
    fire("ch-checker-check-btn");
    expect(el("ch-checker-status").textContent).toContain("scraping data");

    h.view.dropPending();

    expect(el("ch-checker-status").textContent).toBe("");
    expect(el("ch-checker-status").className).toBe("ch-comparer-status");
  });

  it("leaves a real result summary alone when a retirement lands afterwards", () => {
    // The line is the tab's own output once the check has run: a stop arriving
    // later must not wipe findings the user is reading.
    finishRun([row({ VAT: 110_001 })]);
    fire("ch-checker-check-btn");
    const summary = el("ch-checker-status").textContent;
    expect(summary).not.toBe("");

    h.view.dropPending();

    expect(el("ch-checker-status").textContent).toBe(summary);
  });

  it("takes the line back through the production singleton main.ts calls", async () => {
    await mount({}, true);
    fire("ch-checker-check-btn");
    expect(el("ch-checker-status").textContent).toContain("scraping data");

    (await import("../content/ui-checker")).dropPendingCheck();

    expect(el("ch-checker-status").textContent).toBe("");
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

  it("labels the identity column for the grid, and exports the same one", async () => {
    // The seam, so this proves the tab renders AND writes whatever identity it
    // is handed. A retur row is a "No Retur" on screen and in the file; the
    // production wiring above proves which grid hands it which one.
    await mount({ identity: () => "no-retur", counterparty: () => "pembeli" });
    finishRun([row({ VAT: 110_001, ReturnNumber: "RET-0007", ReturnDate: "2026-07-15" })]);
    fire("ch-checker-check-btn");

    expect(headers()).toContain("No Retur");
    expect(headers()).toContain("Tanggal Retur");
    expect(headers()).not.toContain("Referensi");
    expect(cells(bodyRows()[0])).toContain("RET-0007");
    expect(cells(bodyRows()[0])).toContain("15/07/2026");

    fire("ch-checker-export-btn");
    const [rows] = vi.mocked(h.exporter.downloadXLSXFile).mock.calls[0];
    expect(rows[0]).toEqual([
      "No", "No Retur", "Tanggal Retur", "Nama Pembeli", "NPWP/NIK Pembeli",
      "DPP", "DPP NL", "PPN", "Selisih DPP NL", "Selisih PPN", "Status",
    ]);
    expect(rows[1][1]).toBe("RET-0007");
    expect(rows[1][2]).toBe("15/07/2026");
  });

  it("falls back to the invoice number when a retur row has no NO RETUR", async () => {
    // A retur row with an empty NO RETUR still has to be findable in the report,
    // exactly as an invoice row with no Referensi is.
    await mount({ identity: () => "no-retur" });
    finishRun([row({ VAT: 110_001 })]);
    fire("ch-checker-check-btn");
    expect(cells(bodyRows()[0])).toContain("04012600023333322");
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
    // A Retur grid: main.ts injects no reference filter there, so a
    // double-click would silently do nothing. (PPN Masukan DOES have one — a
    // lookup works with a seller's reference too.)
    await mount({ canSearchInGrid: () => false });
    finishRun([row({ VAT: 110_001 })]);
    fire("ch-checker-check-btn");

    expect(bodyRows()[0].listeners.dblclick ?? []).toHaveLength(0);
  });

  it("reads the side of the transaction, the grid's name and its filter from the page", async () => {
    // The seam proves the tab obeys what it is told; this proves the PRODUCTION
    // tab is told the right things. Without it, `canSearchInGrid`, `identity`
    // and `counterparty` could be wired to anything and every case above would
    // still pass, because they all inject their own answers.
    page.side = "out";
    page.returns = false;
    page.refFilter = true;
    await mount({}, true);
    finishRun([row({ VAT: 110_001 })]);
    fire("ch-checker-check-btn");
    expect(headers()).toContain("Nama Pembeli");
    expect(headers()).toContain("Referensi");
    expect(bodyRows()[0].listeners.dblclick ?? []).toHaveLength(1);

    // PPN Masukan: the invoice's SELLER, and a hand-back that still lands — the
    // injected filter is a LOOKUP, and a seller's reference answers one even
    // when several purchases share it. Gating on the identity fact instead of
    // the filter fact would drop this double-click silently, which is exactly
    // the coupling the two page facts exist to break.
    page.side = "in";
    page.refFilter = true;
    await mount({}, true);
    finishRun([row({ VAT: 110_001 })]);
    fire("ch-checker-check-btn");
    expect(headers()).toContain("Nama Penjual");
    expect(bodyRows()[0].listeners.dblclick ?? []).toHaveLength(1);

    // A grid with no injected filter has nothing to search into.
    page.refFilter = false;
    await mount({}, true);
    finishRun([row({ VAT: 110_001 })]);
    fire("ch-checker-check-btn");
    expect(bodyRows()[0].listeners.dblclick ?? []).toHaveLength(0);

    h.run.reset();
    page.side = "in";
    page.refFilter = true;
    fire("ch-checker-check-btn");
    expect(el("ch-checker-status").textContent).toContain("scraping data PPN Masukan");
    page.side = "out";
  });

  it("names a retur row by its NO RETUR, and keeps the buyer on Retur Keluaran", async () => {
    // The production wiring on a Retur grid: the identity follows the GRID (no
    // Referensi column exists there) while the counterparty follows the SIDE
    // (Retur Keluaran carries the buyer, exactly as the invoice it returns
    // does). One page fact asked to answer both would get one of them wrong.
    page.side = "out";
    page.returns = true;
    page.refFilter = false;
    await mount({}, true);
    finishRun([row({ VAT: 110_001, ReturnNumber: "RET-0001", ReturnDate: "2026-07-15" })]);
    fire("ch-checker-check-btn");

    expect(headers()).toContain("No Retur");
    expect(headers()).toContain("Tanggal Retur");
    expect(headers()).not.toContain("Referensi");
    expect(headers()).toContain("Nama Pembeli");
    expect(cells(bodyRows()[0])).toContain("RET-0001");
    expect(cells(bodyRows()[0])).toContain("15/07/2026");
    // No Referensi filter is injected on a retur grid, so no hand-back is
    // offered — the identity of the row is still read, it just cannot be looked
    // up in the portal.
    expect(bodyRows()[0].listeners.dblclick ?? []).toHaveLength(0);

    // And the progress line names the grid the user is on.
    h.run.reset();
    fire("ch-checker-check-btn");
    expect(el("ch-checker-status").textContent).toContain("scraping data Retur PPN Keluaran");

    page.side = "out";
    page.returns = false;
    page.refFilter = true;
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

  it("formats the Excel cells by the header, not by a counted position", () => {
    // The formats follow the column schema (exporter.resultNumberFormats), so a
    // column added ahead of the amounts moves every one of them right. This reads
    // the positions off the sheet's own header, which is what a hand-written
    // index map here would have silently disagreed with.
    finishRun([row({ VAT: 110_001 })]);
    fire("ch-checker-check-btn");

    fire("ch-checker-export-btn");

    const [rows, , , options] = vi.mocked(h.exporter.downloadXLSXFile).mock.calls[0];
    const formats = options?.numberFormats ?? {};
    const header = rows[0] as string[];
    const at = (label: string) => header.indexOf(label);

    expect(formats[at("DPP")]).toBe(h.exporter.RESULT_NUMBER_FORMAT);
    expect(formats[at("DPP NL")]).toBe(h.exporter.RESULT_NUMBER_FORMAT);
    expect(formats[at("PPN")]).toBe(h.exporter.RESULT_NUMBER_FORMAT);
    const differences = header
      .map((label, index) => ({ label, index }))
      .filter(({ label }) => label.startsWith("Selisih"));
    expect(differences).toHaveLength(2);
    for (const { index } of differences) {
      expect(formats[index]).toBe(h.exporter.RESULT_DIFFERENCE_FORMAT);
    }
    // Nothing else is formatted: the row number is a number too, and an amount
    // format on it is how a report starts printing "1,00" beside its own count.
    expect(Object.keys(formats).map(Number).sort((a, b) => a - b)).toEqual(
      [at("DPP"), at("DPP NL"), at("PPN"), ...differences.map((d) => d.index)].sort((a, b) => a - b),
    );
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