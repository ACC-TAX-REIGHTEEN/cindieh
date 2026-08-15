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
vi.mock("../content/page-context", () => ({
  isEfakturPage: vi.fn(() => true),
  isOutputTaxPage: vi.fn(() => false),
}));

import {
  splitInvoiceNumbers,
  parseMultiInvoiceText,
  injectMultiInvoiceFilter,
  removeMultiInvoiceFilter,
  getMultiInvoiceNumbers,
  clearFilterTimers,
} from "../content/ui-filters";
import { isEfakturPage } from "../content/page-context";
import { stubFakeDom, type FakeDoc, type FakeWindow } from "./__mocks__/fake-dom";

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
    clearFilterTimers();
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
    injectMultiInvoiceFilter(0);

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
    injectMultiInvoiceFilter(0);

    expect(doc.getElementById("ch-multi-invoice-toggle")).toBeNull();
    expect(doc.getElementById("ch-multi-invoice-filter")).toBeNull();
    expect(doc.listenerCount("click")).toBe(0);
  });

  it("does nothing when no anchor button is found (retries=0 avoids scheduling a timer)", () => {
    injectMultiInvoiceFilter(0);

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
});
