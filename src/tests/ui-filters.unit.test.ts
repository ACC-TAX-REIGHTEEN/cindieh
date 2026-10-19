// Unit tests for ui-filters.ts — the pure helpers shared with main.ts.
// splitInvoiceNumbers / parseMultiInvoiceText are the critical parsing path
// for the multi-invoice filter (gap identified in the audit report).
//
// The DOM describe blocks at the bottom cover injectMultiInvoiceFilter /
// removeMultiInvoiceFilter (injection, re-injection, cleanup, listener
// unregistration) using a minimal fake DOM — no jsdom/happy-dom — following
// the stub style of the triggerSearch tests in main-actions.unit.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// page-context predicates need mocking: their `location.href` default is
// undefined in the node test environment and would throw a ReferenceError.
// `hasReferenceFilter` is the guard both injection paths read. The fact itself
// — true on BOTH PPN grids, Masukan included — is pinned in
// page-context.unit.test.ts, so a stub here keeps this file about the DOM work.
vi.mock("../content/page-context", () => ({
  isEfakturPage: vi.fn(() => true),
  hasReferenceFilter: vi.fn(() => false),
}));

import {
  splitInvoiceNumbers,
  parseMultiInvoiceText,
  injectGridFilters,
  injectToolbarFilter,
  injectMultiInvoiceFilter,
  removeMultiInvoiceFilter,
  getMultiInvoiceNumbers,
} from "../content/ui-filters";
import { cancelInjectionLoops } from "../content/injection-readiness";
import { hasReferenceFilter, isEfakturPage } from "../content/page-context";
import { stubFakeDom, type FakeDoc, type FakeEl, type FakeWindow } from "./__mocks__/fake-dom";

describe("splitInvoiceNumbers", () => {
  it("splits on newlines", () => {
    expect(splitInvoiceNumbers("INV-001\nINV-002")).toEqual(["INV-001", "INV-002"]);
  });

  it("splits on semicolons and commas", () => {
    expect(splitInvoiceNumbers("INV-001;INV-002,INV-003")).toEqual([
      "INV-001",
      "INV-002",
      "INV-003",
    ]);
  });

  it("splits on two or more spaces", () => {
    expect(splitInvoiceNumbers("INV-001  INV-002")).toEqual(["INV-001", "INV-002"]);
    expect(splitInvoiceNumbers("INV-001   INV-002")).toEqual(["INV-001", "INV-002"]);
  });

  it("does not split on a single space", () => {
    expect(splitInvoiceNumbers("INV-001 INV-002")).toEqual(["INV-001 INV-002"]);
  });

  it("trims whitespace and drops empty entries", () => {
    expect(splitInvoiceNumbers("  INV-001  \n\n INV-002 \t")).toEqual(["INV-001", "INV-002"]);
  });

  it("splits on mixed separators and runs of separators", () => {
    expect(splitInvoiceNumbers("INV-001,INV-002;;INV-003\nINV-004")).toEqual([
      "INV-001",
      "INV-002",
      "INV-003",
      "INV-004",
    ]);
  });

  it("handles CRLF line endings", () => {
    expect(splitInvoiceNumbers("INV-001\r\nINV-002\r\nINV-003")).toEqual([
      "INV-001",
      "INV-002",
      "INV-003",
    ]);
  });

  it("drops empty entries from leading/trailing separators", () => {
    expect(splitInvoiceNumbers(";INV-001;")).toEqual(["INV-001"]);
    expect(splitInvoiceNumbers(",INV-001,,INV-002,")).toEqual(["INV-001", "INV-002"]);
  });

  it("returns empty array for empty input", () => {
    expect(splitInvoiceNumbers("")).toEqual([]);
    expect(splitInvoiceNumbers("   ")).toEqual([]);
  });
});

describe("parseMultiInvoiceText", () => {
  it("returns [] for empty or whitespace-only input", () => {
    expect(parseMultiInvoiceText("")).toEqual([]);
    expect(parseMultiInvoiceText("   ")).toEqual([]);
    expect(parseMultiInvoiceText("\n\t ")).toEqual([]);
  });

  it("trims the whole input before splitting", () => {
    expect(parseMultiInvoiceText("  INV-001\nINV-002  ")).toEqual(["INV-001", "INV-002"]);
  });

  it("parses newline-separated efaktur invoice numbers", () => {
    expect(parseMultiInvoiceText("04012600023333322\n04012600023333323")).toEqual([
      "04012600023333322",
      "04012600023333323",
    ]);
  });

  it("parses comma/semicolon separated numbers", () => {
    expect(parseMultiInvoiceText("A,B;C")).toEqual(["A", "B", "C"]);
  });
});

// ── injectMultiInvoiceFilter / removeMultiInvoiceFilter (DOM) ──────────
// The fake DOM itself lives in ./__mocks__/fake-dom.ts (shared with the
// ui-badge tests); these tests only drive it via stubFakeDom().

describe("injectMultiInvoiceFilter / removeMultiInvoiceFilter (DOM)", () => {
  let doc: FakeDoc;
  let win: FakeWindow;

  beforeEach(() => {
    const fake = stubFakeDom();
    doc = fake.doc;
    win = fake.win;
    // Reset any module-level multi-invoice state left by a previous test.
    removeMultiInvoiceFilter();
    vi.mocked(isEfakturPage).mockReturnValue(true);
  });

  afterEach(() => {
    cancelInjectionLoops();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function setupAnchor(): void {
    const toolbar = doc.createElement("div");
    const resetBtn = doc.createElement("button");
    resetBtn.setAttribute("ptooltip", "Setel Ulang Filter");
    toolbar.appendChild(resetBtn);
    doc.buttons = [resetBtn];
  }

  it("injects toggle + panel and registers one listener per document/window hook on efaktur pages", () => {
    setupAnchor();
    injectMultiInvoiceFilter();

    const toggle = doc.getElementById("ch-multi-invoice-toggle");
    const panel = doc.getElementById("ch-multi-invoice-filter");
    expect(toggle).not.toBeNull();
    expect(panel).not.toBeNull();
    expect(toggle!.title).toBe("Filter berdasarkan No. Faktur (multi)");
    expect(toggle!.className).toBe("ch-multi-invoice-toggle");
    expect(toggle!.children.some((c) => c.tagName === "#text" && c.textContent === "No. Faktur")).toBe(true);
    expect(doc.body.children).toContain(panel);
    expect(doc.getElementById("ch-multi-invoice-textarea")).not.toBeNull();
    expect(doc.listenerCount("click")).toBe(1);
    expect(win.listenerCount("scroll")).toBe(1);
    expect(win.listenerCount("resize")).toBe(1);
  });

  it("is idempotent — a second call keeps the same elements and does not stack listeners", () => {
    setupAnchor();
    injectMultiInvoiceFilter();
    const panel = doc.getElementById("ch-multi-invoice-filter")!;

    injectMultiInvoiceFilter();

    expect(doc.getElementById("ch-multi-invoice-filter")).toBe(panel);
    expect(doc.body.children.filter((c) => c.id === "ch-multi-invoice-filter")).toHaveLength(1);
    expect(doc.listenerCount("click")).toBe(1);
    expect(win.listenerCount("scroll")).toBe(1);
    expect(win.listenerCount("resize")).toBe(1);
  });

  it("re-injects cleanly when a re-render removed the toggle but left the panel in <body>", () => {
    setupAnchor();
    injectMultiInvoiceFilter();
    const oldPanel = doc.getElementById("ch-multi-invoice-filter")!;

    // Angular re-render tears down the toolbar toggle; the body-level panel survives.
    doc.getElementById("ch-multi-invoice-toggle")!.remove();

    injectMultiInvoiceFilter();

    const newPanel = doc.getElementById("ch-multi-invoice-filter");
    expect(newPanel).not.toBeNull();
    expect(newPanel).not.toBe(oldPanel);
    expect(oldPanel.parentElement).toBeNull();
    expect(doc.getElementById("ch-multi-invoice-toggle")).not.toBeNull();
    // Old listeners were unregistered, fresh ones registered → counts stay at 1.
    expect(doc.listenerCount("click")).toBe(1);
    expect(win.listenerCount("scroll")).toBe(1);
    expect(win.listenerCount("resize")).toBe(1);
  });

  it("tears everything down on non-efaktur pages and clears the parsed invoice numbers", () => {
    setupAnchor();
    injectMultiInvoiceFilter();
    const textarea = doc.getElementById("ch-multi-invoice-textarea")!;
    textarea.value = "INV-001\nINV-002";
    expect(getMultiInvoiceNumbers()).toEqual(["INV-001", "INV-002"]);

    vi.mocked(isEfakturPage).mockReturnValue(false);
    injectMultiInvoiceFilter();

    expect(doc.getElementById("ch-multi-invoice-toggle")).toBeNull();
    expect(doc.getElementById("ch-multi-invoice-filter")).toBeNull();
    expect(doc.listenerCount("click")).toBe(0);
    expect(win.listenerCount("scroll")).toBe(0);
    expect(win.listenerCount("resize")).toBe(0);
    expect(getMultiInvoiceNumbers()).toEqual([]);
  });

  it("skips injection entirely on non-efaktur pages when nothing was injected before", () => {
    vi.mocked(isEfakturPage).mockReturnValue(false);
    setupAnchor();
    injectMultiInvoiceFilter();

    expect(doc.getElementById("ch-multi-invoice-toggle")).toBeNull();
    expect(doc.getElementById("ch-multi-invoice-filter")).toBeNull();
    expect(doc.listenerCount("click")).toBe(0);
  });

  it("does nothing when no anchor button is found", () => {
    injectMultiInvoiceFilter();

    expect(doc.getElementById("ch-multi-invoice-toggle")).toBeNull();
    expect(doc.getElementById("ch-multi-invoice-filter")).toBeNull();
    expect(doc.listenerCount("click")).toBe(0);
  });

  it("opens/closes the panel when the toggle is clicked (CSS hides it initially)", () => {
    setupAnchor();
    injectMultiInvoiceFilter();
    const toggle = doc.getElementById("ch-multi-invoice-toggle")!;
    const panel = doc.getElementById("ch-multi-invoice-filter")!;
    const stopPropagation = vi.fn();
    const click = toggle.listeners["click"][0];

    click({ stopPropagation });
    expect(panel.style.display).toBe("block");
    expect(stopPropagation).toHaveBeenCalled();

    click({ stopPropagation });
    expect(panel.style.display).toBe("none");
  });

  it("closes an open panel when clicking outside it", () => {
    setupAnchor();
    injectMultiInvoiceFilter();
    const toggle = doc.getElementById("ch-multi-invoice-toggle")!;
    const panel = doc.getElementById("ch-multi-invoice-filter")!;
    toggle.listeners["click"][0]({ stopPropagation: vi.fn() });
    expect(panel.style.display).toBe("block");

    const outside = doc.createElement("div");
    const docClick = [...doc.listeners.get("click")!][0];
    docClick({ target: outside });

    expect(panel.style.display).toBe("none");
  });

  it("updates the count hint as the user types invoice numbers", () => {
    setupAnchor();
    injectMultiInvoiceFilter();
    const textarea = doc.getElementById("ch-multi-invoice-textarea")!;
    const hint = doc.getElementById("ch-multi-invoice-count")!;

    textarea.value = "A\nB\nC";
    textarea.listeners["input"][0]({});
    expect(hint.textContent).toBe("3 nomor faktur terdeteksi");

    textarea.value = "";
    textarea.listeners["input"][0]({});
    expect(hint.textContent).toBe("");
  });

  it("keeps an open panel under its toggle when the page scrolls", () => {
    setupAnchor();
    injectMultiInvoiceFilter();
    const toggle = doc.getElementById("ch-multi-invoice-toggle")!;
    const panel = doc.getElementById("ch-multi-invoice-filter")!;
    toggle.listeners["click"][0]({ stopPropagation: vi.fn() });
    expect(panel.style.display).toBe("block");

    win.scrollY = 120;
    win.scrollX = 30;
    win.fire("scroll");
    expect(panel.style.top).toBe("124px");
    expect(panel.style.left).toBe("30px");

    win.scrollY = 0;
    win.scrollX = 0;
    win.fire("resize");
    expect(panel.style.top).toBe("4px");
    expect(panel.style.left).toBe("0px");
  });

  it("leaves a closed panel alone on scroll and resize", () => {
    setupAnchor();
    injectMultiInvoiceFilter();
    const panel = doc.getElementById("ch-multi-invoice-filter")!;

    win.scrollY = 120;
    win.fire("scroll");
    win.fire("resize");

    // Nothing was ever positioned: the panel is hidden by the stylesheet until
    // the toggle opens it, and only the open path writes these.
    expect(panel.style.top).toBeUndefined();
    expect(panel.style.left).toBeUndefined();
  });

  it("retries while the toolbar is still rendering, and injects when it lands", () => {
    vi.useFakeTimers();
    injectMultiInvoiceFilter();
    expect(doc.getElementById("ch-multi-invoice-toggle")).toBeNull();

    setupAnchor();
    vi.advanceTimersByTime(1000);

    expect(doc.getElementById("ch-multi-invoice-toggle")).not.toBeNull();
    expect(doc.getElementById("ch-multi-invoice-filter")).not.toBeNull();
  });

  it("ignores a click on a toggle whose panel has been torn down", () => {
    setupAnchor();
    injectMultiInvoiceFilter();
    const click = doc.getElementById("ch-multi-invoice-toggle")!.listeners["click"][0];

    removeMultiInvoiceFilter();

    expect(() => click({ stopPropagation: vi.fn() })).not.toThrow();
  });

  it("ignores an outside click once the panel has been torn down", () => {
    setupAnchor();
    injectMultiInvoiceFilter();
    const docClick = [...doc.listeners.get("click")!][0];

    removeMultiInvoiceFilter();

    expect(() => docClick({ target: doc.createElement("div") })).not.toThrow();
  });

  it("injects nothing when the anchor has no parent to sit beside", () => {
    // A detached anchor: the lookup succeeds, but there is nowhere to put the
    // toggle, and the guard has to bail out instead of throwing.
    const orphan = doc.createElement("button");
    orphan.setAttribute("ptooltip", "Setel Ulang Filter");
    doc.buttons = [orphan];

    injectMultiInvoiceFilter();

    expect(doc.getElementById("ch-multi-invoice-toggle")).toBeNull();
    expect(doc.getElementById("ch-multi-invoice-filter")).toBeNull();
  });
});

// ── injectGridFilters / injectToolbarFilter (DOM) ──────────────────────
// The two Referensi filters belong to PPN Keluaran, but they are injected into
// markup the PORTAL owns. Every test below is a way that grid can fail to look
// like a grid — no thead, one header row, no Referensi column, a toolbar that
// has not rendered yet — and the wrong answer is an exception on every Angular
// re-render, not a missing input.

describe("injectGridFilters (DOM)", () => {
  let doc: FakeDoc;

  /** A Coretax-shaped header: the label row, then the row of per-column filters. */
  function buildGrid(labels: readonly string[], options: { rows?: number } = {}): void {
    const thead = doc.createElement("thead");
    const labelRow = doc.createElement("tr");
    for (const label of labels) {
      const th = doc.createElement("th");
      th.textContent = label;
      labelRow.appendChild(th);
    }
    thead.appendChild(labelRow);

    if ((options.rows ?? 2) > 1) {
      const filterRow = doc.createElement("tr");
      for (const label of labels) {
        const th = doc.createElement("th");
        th.appendChild(doc.createTextNode(`filter-${label}`));
        filterRow.appendChild(th);
      }
      thead.appendChild(filterRow);
    }
    doc.body.appendChild(thead);
  }

  beforeEach(() => {
    doc = stubFakeDom().doc;
    vi.mocked(hasReferenceFilter).mockReturnValue(true);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("puts a Referensi search box in that column's filter cell, replacing the portal's own", () => {
    buildGrid(["Kode", "Referensi", "Nama Pembeli"]);

    injectGridFilters();

    const input = doc.getElementById("ch-grid-filter-reference");
    expect(input).not.toBeNull();
    expect(input!.placeholder).toBe("Cari Referensi...");

    // The cell was emptied first: the portal's filter and ours must not stack.
    const filterRow = doc.querySelector("thead")!.children[1];
    const refCell = filterRow.children[1];
    expect(refCell.children).toHaveLength(1);
    expect(refCell.querySelector("#ch-grid-filter-reference")).toBe(input);
  });

  it("does nothing on a page with no Referensi column (a Retur grid)", () => {
    vi.mocked(hasReferenceFilter).mockReturnValue(false);
    buildGrid(["Referensi"]);

    injectGridFilters();

    expect(doc.getElementById("ch-grid-filter-reference")).toBeNull();
  });

  it("does nothing when the table has no header at all", () => {
    injectGridFilters();

    expect(doc.getElementById("ch-grid-filter-reference")).toBeNull();
  });

  it("does nothing when the header has a single row (no filter row to fill)", () => {
    buildGrid(["Referensi"], { rows: 1 });

    injectGridFilters();

    expect(doc.getElementById("ch-grid-filter-reference")).toBeNull();
  });

  it("does nothing when no column is named Referensi", () => {
    buildGrid(["Kode", "Nama Pembeli"]);

    injectGridFilters();

    expect(doc.getElementById("ch-grid-filter-reference")).toBeNull();
    // …and the portal's own filter cells are untouched (the fake keeps a cell's
    // text as its child node, so that is where the label is read from).
    const firstCell = doc.querySelector("thead")!.children[1].children[0];
    expect(firstCell.children).toHaveLength(1);
    expect(firstCell.children[0].textContent).toBe("filter-Kode");
  });

  it("is idempotent — a re-render does not stack a second search box", () => {
    buildGrid(["Referensi"]);
    injectGridFilters();
    const first = doc.getElementById("ch-grid-filter-reference");

    injectGridFilters();

    expect(doc.getElementById("ch-grid-filter-reference")).toBe(first);
    expect(doc.querySelector("thead")!.children[1].children[0].children).toHaveLength(1);
  });
});

describe("injectToolbarFilter (DOM)", () => {
  let doc: FakeDoc;

  /** The portal's reset-filter button, the anchor the search box is placed after. */
  function portalResetButton(): FakeEl {
    const btn = doc.createElement("button");
    btn.setAttribute("ptooltip", "Setel Ulang Filter");
    doc.body.appendChild(btn);
    doc.buttons = [btn];
    return btn;
  }

  beforeEach(() => {
    doc = stubFakeDom().doc;
    vi.mocked(hasReferenceFilter).mockReturnValue(true);
  });
  afterEach(() => {
    cancelInjectionLoops();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("lands the search box immediately after the portal's reset button", () => {
    const anchor = portalResetButton();

    injectToolbarFilter();

    const container = doc.getElementById("ch-toolbar-filter-container");
    expect(container).not.toBeNull();
    const siblings = anchor.parentElement!.children;
    expect(siblings.indexOf(container!)).toBe(siblings.indexOf(anchor) + 1);

    const input = doc.getElementById("ch-toolbar-filter-reference");
    expect(input!.placeholder).toBe("Cari Referensi...");
    expect(input!.style.width).toBe("180px");
  });

  it("finds the reset button by its icon when the tooltip is missing", () => {
    const btn = doc.createElement("button");
    const icon = doc.createElement("span");
    icon.className = "pi pi-filter-slash";
    btn.appendChild(icon);
    doc.body.appendChild(btn);
    doc.buttons = [btn];

    injectToolbarFilter();

    expect(doc.getElementById("ch-toolbar-filter-reference")).not.toBeNull();
  });

  it("finds the reset button by its ct-ovw class as a last resort", () => {
    const btn = doc.createElement("button");
    btn.className = "ct-ovw-btn-mini";
    const icon = doc.createElement("span");
    icon.className = "pi pi-refresh";
    btn.appendChild(icon);
    doc.body.appendChild(btn);
    doc.buttons = [btn];

    injectToolbarFilter();

    expect(doc.getElementById("ch-toolbar-filter-reference")).not.toBeNull();
  });

  it("does nothing on a page with no Referensi column (a Retur grid)", () => {
    vi.mocked(hasReferenceFilter).mockReturnValue(false);
    portalResetButton();

    injectToolbarFilter();

    expect(doc.getElementById("ch-toolbar-filter-reference")).toBeNull();
  });

  it("is idempotent — a re-render does not stack a second search box", () => {
    portalResetButton();
    injectToolbarFilter();
    const first = doc.getElementById("ch-toolbar-filter-reference");

    injectToolbarFilter();

    expect(doc.getElementById("ch-toolbar-filter-reference")).toBe(first);
    expect(doc.getElementById("ch-toolbar-filter-container")!.children).toHaveLength(1);
  });

  it("retries while the toolbar is still rendering, and lands when it appears", () => {
    vi.useFakeTimers();

    injectToolbarFilter();
    expect(doc.getElementById("ch-toolbar-filter-reference")).toBeNull();
    expect(vi.getTimerCount()).toBe(1);

    portalResetButton();
    vi.advanceTimersByTime(1000);

    expect(doc.getElementById("ch-toolbar-filter-reference")).not.toBeNull();
  });

  it("gives up after the last retry instead of polling forever", () => {
    vi.useFakeTimers();

    injectToolbarFilter();
    vi.advanceTimersByTime(10_000);

    expect(vi.getTimerCount()).toBe(0);
    expect(doc.getElementById("ch-toolbar-filter-reference")).toBeNull();
  });

  it("cancelInjectionLoops cancels a pending retry (navigation teardown)", () => {
    vi.useFakeTimers();
    injectToolbarFilter();
    expect(vi.getTimerCount()).toBe(1);

    cancelInjectionLoops();
    expect(vi.getTimerCount()).toBe(0);

    portalResetButton();
    vi.advanceTimersByTime(10_000);
    expect(doc.getElementById("ch-toolbar-filter-reference")).toBeNull();
  });
});
