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

// ── Minimal fake DOM ────────────────────────────────────────────────
// Enough surface for injectMultiInvoiceFilter / removeMultiInvoiceFilter:
// element creation, id lookup, append/insert/remove, attribute & class
// queries, event listeners (element + document + window), and contains().

type Listener = (event?: unknown) => void;

class FakeEl {
  id = "";
  className = "";
  style: Record<string, string> = {};
  value = "";
  title = "";
  type = "";
  htmlFor = "";
  rows = 0;
  placeholder = "";
  textContent = "";
  children: FakeEl[] = [];
  listeners: Record<string, Listener[]> = {};
  attributes: Record<string, string> = {};
  parentElement: FakeEl | null = null;
  nextSibling: FakeEl | null = null;
  tagName: string;
  doc: FakeDoc;

  constructor(tagName: string, doc: FakeDoc) {
    this.tagName = tagName;
    this.doc = doc;
  }

  appendChild(child: FakeEl): FakeEl {
    this.children.push(child);
    child.parentElement = this;
    child.nextSibling = null;
    if (this.children.length > 1) {
      this.children[this.children.length - 2].nextSibling = child;
    }
    this.doc.register(child);
    return child;
  }

  insertBefore(child: FakeEl, ref: FakeEl | null): FakeEl {
    if (!ref) return this.appendChild(child);
    const idx = this.children.indexOf(ref);
    if (idx === -1) return this.appendChild(child);
    this.children.splice(idx, 0, child);
    child.parentElement = this;
    this.doc.register(child);
    return child;
  }

  remove(): void {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx > -1) this.parentElement.children.splice(idx, 1);
      this.parentElement = null;
    }
    this.doc.unregister(this);
  }

  setAttribute(key: string, value: string): void {
    this.attributes[key] = value;
  }

  getAttribute(key: string): string | null {
    return this.attributes[key] ?? null;
  }

  addEventListener(type: string, fn: Listener): void {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(fn);
  }

  getBoundingClientRect(): {
    bottom: number;
    left: number;
    top: number;
    right: number;
    width: number;
    height: number;
  } {
    return { bottom: 0, left: 0, top: 0, right: 0, width: 0, height: 0 };
  }

  contains(node: FakeEl): boolean {
    let current: FakeEl | null = node;
    while (current) {
      if (current === this) return true;
      current = current.parentElement;
    }
    return false;
  }

  querySelector(sel: string): FakeEl | null {
    if (sel.startsWith(".")) {
      const cls = sel.slice(1);
      return this.children.find((c) => c.className.split(/\s+/).includes(cls)) ?? null;
    }
    return null;
  }
}

class FakeDoc {
  byId = new Map<string, FakeEl>();
  buttons: FakeEl[] = [];
  body: FakeEl;
  listeners = new Map<string, Set<Listener>>();

  constructor() {
    this.body = new FakeEl("body", this);
  }

  createElement(tag: string): FakeEl {
    return new FakeEl(tag, this);
  }

  createTextNode(text: string): FakeEl {
    const node = new FakeEl("#text", this);
    node.textContent = text;
    return node;
  }

  getElementById(id: string): FakeEl | null {
    return this.byId.get(id) ?? null;
  }

  querySelectorAll(sel: string): FakeEl[] {
    return sel === "button" ? this.buttons : [];
  }

  register(el: FakeEl): void {
    if (el.id) this.byId.set(el.id, el);
  }

  unregister(el: FakeEl): void {
    if (el.id && this.byId.get(el.id) === el) this.byId.delete(el.id);
  }

  addEventListener(type: string, fn: Listener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(fn);
  }

  removeEventListener(type: string, fn: Listener): void {
    this.listeners.get(type)?.delete(fn);
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

interface FakeWindow {
  scrollY: number;
  scrollX: number;
  addEventListener(type: string, fn: Listener): void;
  removeEventListener(type: string, fn: Listener): void;
  listenerCount(type: string): number;
}

function makeWindowStub(): FakeWindow {
  const listeners = new Map<string, Set<Listener>>();
  return {
    scrollY: 0,
    scrollX: 0,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

// ── injectMultiInvoiceFilter / removeMultiInvoiceFilter (DOM) ──────────

describe("injectMultiInvoiceFilter / removeMultiInvoiceFilter (DOM)", () => {
  let doc: FakeDoc;
  let win: FakeWindow;

  beforeEach(() => {
    doc = new FakeDoc();
    win = makeWindowStub();
    vi.stubGlobal("document", doc as unknown as Document);
    vi.stubGlobal("window", win as unknown as Window & typeof globalThis);
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
