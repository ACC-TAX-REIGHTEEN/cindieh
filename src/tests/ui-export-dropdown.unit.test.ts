// Unit tests for the export dropdown ui.ts injects into the portal toolbar.
//
// Two shapes are pinned here. The DEFAULT shape is the compact single button
// that opens the menu (no separate caret button in the visual flow), with the
// stored format marked by a check inside the menu instead of a second hit area —
// an always-on split main-button + caret was tried and reverted for eating
// toolbar room. The OPT-IN shape (oneClickExport) is the split one: a plain
// click exports the stored default and the caret opens the menu. Both are built
// once and switched in place, so a preference change never re-injects.
//
// The heavy neighbours (filters, comparer modal) are mocked so the menu markup
// and its handlers are exercised on their own.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../content/ui-comparer", () => ({ injectComparerModal: vi.fn() }));
vi.mock("../content/ui-filters", () => ({
  clearFilterTimers: vi.fn(),
  removeMultiInvoiceFilter: vi.fn(),
  scheduleRetry: vi.fn(),
}));

import {
  DEFAULT_EXPORT_ITEM_CLASS,
  injectExportButton,
  removeExportButton,
  setExportFormatDefault,
  setOneClickExport,
} from "../content/ui";
import { stubFakeDom, type FakeDoc, type FakeEl } from "./__mocks__/fake-dom";

const OUTPUT_TAX_URL = "https://coretaxdjp.pajak.go.id/e-invoice-portal/output-tax";
const INPUT_TAX_URL = "https://coretaxdjp.pajak.go.id/e-invoice-portal/input-tax";
const CHECK_CLASS = ".ch-export-item-check";
const CHEVRON_CLASS = ".pi-chevron-down";

let doc: FakeDoc;

/** Document events ui.ts dispatched, in order. */
let events: string[] = [];

beforeEach(() => {
  vi.stubGlobal("location", { href: OUTPUT_TAX_URL });
  // Node has no CustomEvent; ui.ts only needs the type carried through.
  vi.stubGlobal(
    "CustomEvent",
    class {
      type: string;
      constructor(type: string) {
        this.type = type;
      }
    },
  );
  ({ doc } = stubFakeDom());
  events = [];
  Object.assign(doc, {
    dispatchEvent: (event: { type: string }) => {
      events.push(event.type);
      return true;
    },
  });

  // The e-faktur toolbar anchor findAnchorButton() looks for by id.
  const anchor = doc.createElement("button");
  anchor.id = "SubmitSelectedInvoicesButton";
  doc.body.appendChild(anchor);
});

afterEach(() => {
  // ui.ts keeps module state (isInjected, the open-menu flag) that outlives one
  // fake document; the removal path is the supported way to put it back, so a
  // test never inherits the previous test's toolbar.
  removeExportButton();
  vi.unstubAllGlobals();
});

function el(id: string): FakeEl {
  const found = doc.getElementById(id);
  expect(found).not.toBeNull();
  return found!;
}

function click(target: FakeEl): void {
  for (const listener of target.listeners.click ?? []) {
    listener({ stopPropagation: () => {} });
  }
}

function labelOf(button: FakeEl): string {
  return button.querySelector(".p-button-label")!.textContent;
}

describe("export dropdown injection", () => {
  it("injects one visible button in the default mode", () => {
    setExportFormatDefault("xlsx");
    setOneClickExport(false);
    injectExportButton();

    const dropdown = el("ch-export-dropdown");
    const button = el("ch-export-dropdown-btn");
    expect(labelOf(button)).toBe("Ekspor");
    // The chevron is part of that one button — the menu affordance, not a hit
    // area of its own.
    expect(button.querySelector(CHEVRON_CLASS)).not.toBeNull();
    expect(button.listeners.click).toHaveLength(1);

    // The caret button is built in both modes but must stay invisible AND empty
    // here: hidden via .ch-hidden, so it costs the toolbar no room.
    const caret = el("ch-export-dropdown-caret");
    expect(caret.classList.contains("ch-hidden")).toBe(true);
    expect(caret.children).toHaveLength(0);
    expect(dropdown.children).toHaveLength(3);
  });

  it("opens and closes the menu from that single button", () => {
    setOneClickExport(false);
    injectExportButton();
    const button = el("ch-export-dropdown-btn");
    const menu = el("ch-export-dropdown-menu");
    expect(menu.classList.contains("ch-hidden")).toBe(true);

    click(button);
    expect(menu.classList.contains("ch-hidden")).toBe(false);
    // Opening the menu is all it does — no export is fired behind the user.
    expect(events).toEqual([]);

    click(button);
    expect(menu.classList.contains("ch-hidden")).toBe(true);
  });

  it("offers both formats as menu items", () => {
    injectExportButton();

    const hasText = (item: FakeEl, text: string) =>
      item.children.some((child) => child.textContent === text);
    expect(hasText(el("ch-export-xlsx-item"), "Ekspor XLSX")).toBe(true);
    expect(hasText(el("ch-export-csv-item"), "Ekspor CSV")).toBe(true);
  });

  it("marks the stored default on items built after the preference is known", () => {
    // Startup order: the preference resolves before the toolbar is injected.
    setExportFormatDefault("csv");
    injectExportButton();

    const csv = el("ch-export-csv-item");
    const xlsx = el("ch-export-xlsx-item");
    expect(csv.classList.contains(DEFAULT_EXPORT_ITEM_CLASS)).toBe(true);
    expect(csv.querySelector(CHECK_CLASS)).not.toBeNull();
    expect(xlsx.classList.contains(DEFAULT_EXPORT_ITEM_CLASS)).toBe(false);
    expect(xlsx.querySelector(CHECK_CLASS)).toBeNull();
  });

  it("moves the mark without growing the toolbar when the preference changes", () => {
    setExportFormatDefault("xlsx");
    injectExportButton();
    const dropdown = el("ch-export-dropdown");
    const button = el("ch-export-dropdown-btn");

    setExportFormatDefault("csv");

    const csv = el("ch-export-csv-item");
    const xlsx = el("ch-export-xlsx-item");
    expect(csv.classList.contains(DEFAULT_EXPORT_ITEM_CLASS)).toBe(true);
    expect(csv.getAttribute("aria-current")).toBe("true");
    expect(csv.querySelector(CHECK_CLASS)).not.toBeNull();
    expect(xlsx.classList.contains(DEFAULT_EXPORT_ITEM_CLASS)).toBe(false);
    expect(xlsx.getAttribute("aria-current")).toBeNull();
    expect(xlsx.querySelector(CHECK_CLASS)).toBeNull();

    // The button is untouched: same label, same element, no extra node.
    expect(labelOf(button)).toBe("Ekspor");
    expect(el("ch-export-dropdown").children).toBe(dropdown.children);
  });

  it("removes the whole dropdown container on navigation", () => {
    injectExportButton();

    removeExportButton();

    expect(doc.getElementById("ch-export-dropdown")).toBeNull();
    expect(doc.getElementById("ch-export-dropdown-btn")).toBeNull();
    expect(doc.getElementById("ch-export-dropdown-caret")).toBeNull();
    expect(doc.getElementById("ch-export-dropdown-menu")).toBeNull();
  });
});

describe("one-click export mode", () => {
  it("exports the stored default on a click and leaves the caret for the menu", () => {
    setExportFormatDefault("csv");
    setOneClickExport(true);
    injectExportButton();

    const button = el("ch-export-dropdown-btn");
    const caret = el("ch-export-dropdown-caret");
    const menu = el("ch-export-dropdown-menu");

    // The chevron moved to the caret: the main button no longer says "menu".
    expect(caret.classList.contains("ch-hidden")).toBe(false);
    expect(caret.querySelector(CHEVRON_CLASS)).not.toBeNull();
    expect(button.querySelector(CHEVRON_CLASS)).toBeNull();
    expect(button.title).toBe("Ekspor langsung ke CSV");

    click(button);
    expect(events).toEqual(["ch:export-csv"]);
    // …and it does not open the menu behind the download.
    expect(menu.classList.contains("ch-hidden")).toBe(true);

    click(caret);
    expect(menu.classList.contains("ch-hidden")).toBe(false);
    // The caret only opens the menu; it never exports.
    expect(events).toEqual(["ch:export-csv"]);
  });

  it("switches modes in place, without rebuilding the toolbar", () => {
    setOneClickExport(false);
    injectExportButton();
    const dropdown = el("ch-export-dropdown");
    const button = el("ch-export-dropdown-btn");
    const caret = el("ch-export-dropdown-caret");
    expect(caret.classList.contains("ch-hidden")).toBe(true);

    setOneClickExport(true);

    // Same nodes: a preference change re-shapes, it never re-injects.
    expect(el("ch-export-dropdown")).toBe(dropdown);
    expect(el("ch-export-dropdown-btn")).toBe(button);
    expect(el("ch-export-dropdown-caret")).toBe(caret);
    expect(caret.classList.contains("ch-hidden")).toBe(false);
    expect(caret.children.some((child) => child.className.includes("pi-chevron-down"))).toBe(true);
    expect(button.querySelector(CHEVRON_CLASS)).toBeNull();

    setOneClickExport(false);

    expect(el("ch-export-dropdown-btn")).toBe(button);
    expect(caret.classList.contains("ch-hidden")).toBe(true);
    expect(caret.children).toHaveLength(0);
    expect(button.querySelector(CHEVRON_CLASS)).not.toBeNull();

    // Back to being a toggle — a click opens the menu and exports nothing.
    expect(el("ch-export-dropdown-menu").classList.contains("ch-hidden")).toBe(true);
    events = [];
    click(button);
    expect(events).toEqual([]);
    expect(el("ch-export-dropdown-menu").classList.contains("ch-hidden")).toBe(false);
  });

  it("always starts from a closed menu when the mode changes", () => {
    setOneClickExport(false);
    injectExportButton();
    const button = el("ch-export-dropdown-btn");
    const menu = el("ch-export-dropdown-menu");

    click(button);
    expect(menu.classList.contains("ch-hidden")).toBe(false);

    setOneClickExport(true);

    expect(menu.classList.contains("ch-hidden")).toBe(true);
  });
});

// ── Withholding page: dropdown beside the bulk PDF button ────────────────────
// Bukti Potong used to carry a single "Unduh PDF" button. It now also offers the
// XLSX/CSV export of the very rows its scrape already captures, so both controls
// must be injected, wired to their own document events, and removed together.

describe("withholding page toolbar", () => {
  const WITHHOLDING_URL =
    "https://coretaxdjp.pajak.go.id/withholding-slips-portal/my-withholding-slips/list";

  beforeEach(() => {
    vi.stubGlobal("location", { href: WITHHOLDING_URL });
    vi.stubGlobal(
      "CustomEvent",
      class {
        type: string;
        constructor(type: string) {
          this.type = type;
        }
      },
    );
    ({ doc } = stubFakeDom());
    events = [];
    Object.assign(doc, {
      dispatchEvent: (event: { type: string }) => {
        events.push(event.type);
        return true;
      },
    });

    // The withholding injection anchors on the grid's card/datatable header. The
    // fake DOM cannot resolve that descendant selector, so hand it the header.
    const header = doc.createElement("div");
    header.className = "p-datatable-header";
    doc.body.appendChild(header);
    Object.assign(doc, {
      querySelectorAll: (sel: string) => (sel.includes(".float-left") ? [header] : []),
    });
  });

  it("injects the export dropdown beside the bulk PDF button", () => {
    injectExportButton();

    expect(labelOf(el("ch-export-dropdown-btn"))).toBe("Ekspor");
    expect(labelOf(el("ch-export-btn"))).toBe("Unduh PDF");
  });

  it("wires each control to its own document event", () => {
    injectExportButton();

    click(el("ch-export-xlsx-item"));
    expect(events).toEqual(["ch:export-xlsx"]);

    click(el("ch-export-btn"));
    expect(events).toEqual(["ch:export-xlsx", "ch:scrape-toggle"]);
  });

  it("removes both controls together on navigation", () => {
    injectExportButton();

    removeExportButton();

    expect(doc.getElementById("ch-export-dropdown")).toBeNull();
    expect(doc.getElementById("ch-export-btn")).toBeNull();
  });
});

// ── SPT page toolbar: a re-render must not slam the menu shut ────────────────
// The SPT pages put the toolbar inside one named grid's datatable header while
// the page itself carries other tables, so the header an injection anchored on
// and the header a later check resolves are not the same node. Angular mutates
// these pages constantly, and the content script re-runs injectExportButton on
// every debounced mutation — so a check that cannot see the anchor the toolbar
// was really placed in rebuilt the toolbar mid-click and closed the menu the
// user was reaching for.

describe("SPT page toolbar", () => {
  const SPT_URL =
    "https://coretaxdjp.pajak.go.id/returnsheets-portal/value-added-tax-return/list";

  /** The header the SPT injection anchors on (the named grid's float-left). */
  let sptHeader: FakeEl;

  beforeEach(() => {
    // Both toolbar preferences are module state; pin the shape this page is
    // about (the default single button) instead of inheriting a neighbouring
    // suite's one-click mode.
    setExportFormatDefault("xlsx");
    setOneClickExport(false);
    vi.stubGlobal("location", { href: SPT_URL });
    vi.stubGlobal(
      "CustomEvent",
      class {
        type: string;
        constructor(type: string) {
          this.type = type;
        }
      },
    );
    ({ doc } = stubFakeDom());
    events = [];
    Object.assign(doc, {
      dispatchEvent: (event: { type: string }) => {
        events.push(event.type);
        return true;
      },
    });

    // A page table that comes first in the document — the generic
    // ".p-datatable-header .float-left" lookup finds this one, while the SPT
    // injection anchors on the named grid below.
    const otherHeader = doc.createElement("div");
    otherHeader.className = "float-left";
    const otherTable = doc.createElement("div");
    otherTable.className = "p-datatable-header";
    otherTable.appendChild(otherHeader);
    doc.body.appendChild(otherTable);

    sptHeader = doc.createElement("div");
    sptHeader.className = "float-left";
    const sptTable = doc.createElement("div");
    sptTable.className = "p-datatable-header";
    const grid = doc.createElement("div");
    grid.className = "rshshr-nvat-la2-grid";
    sptTable.appendChild(sptHeader);
    grid.appendChild(sptTable);
    doc.body.appendChild(grid);

    // The fake DOM cannot resolve the descendant selector lists, so hand the
    // SPT branch its named grid's header and let the generic lookup find the
    // page's own table.
    Object.assign(doc, {
      querySelectorAll: (sel: string) => (sel.includes("rshshr-nvat-la2-grid") ? [sptHeader] : []),
      querySelector: (sel: string) => {
        if (sel.includes(".p-datatable-header")) return otherHeader;
        if (sel.includes(".p-highlight")) return null;
        return null;
      },
    });
  });

  it("anchors the dropdown in the SPT grid's own header", () => {
    injectExportButton();

    expect(sptHeader.children).toContain(el("ch-export-dropdown"));
  });

  it("keeps the toolbar and the open menu across a re-injection", () => {
    injectExportButton();
    const dropdown = el("ch-export-dropdown");
    const button = el("ch-export-dropdown-btn");

    click(button);
    expect(el("ch-export-dropdown-menu").classList.contains("ch-hidden")).toBe(false);

    // The MutationObserver's debounced re-injection after an Angular re-render.
    injectExportButton();

    expect(el("ch-export-dropdown")).toBe(dropdown);
    expect(el("ch-export-dropdown-btn")).toBe(button);
    expect(el("ch-export-dropdown-menu").classList.contains("ch-hidden")).toBe(false);

    // …and the item the user was reaching for is still clickable.
    click(el("ch-export-xlsx-item"));
    expect(events).toEqual(["ch:export-xlsx"]);
  });

  it("reopens the menu when a lost toolbar really is rebuilt", () => {
    injectExportButton();
    const button = el("ch-export-dropdown-btn");
    click(button);

    // Angular dropped the header the toolbar lived in: the button is gone, so
    // the toolbar has to be rebuilt — without taking the open menu with it.
    sptHeader.remove();
    injectExportButton();

    expect(el("ch-export-dropdown-btn")).not.toBe(button);
    expect(sptHeader.children).toContain(el("ch-export-dropdown"));
    expect(el("ch-export-dropdown-menu").classList.contains("ch-hidden")).toBe(false);
  });
});

// ── The year-wide entry ────────────────────────────────────────────────
// The sweep is offered on the e-Faktur PPN grids — each is filed per masa — and
// withheld on the SPT page, whose export dropdown is otherwise identical. The
// grid decides through isEfakturPage, so the entry cannot appear on a page the
// sweep has no scope for.
describe("the year-wide export entry", () => {
  const EFAKTUR_BASE = "https://coretaxdjp.pajak.go.id/e-invoice-portal";

  it.each([
    ["PPN Keluaran", OUTPUT_TAX_URL, "SubmitSelectedInvoicesButton"],
    ["PPN Masukan", INPUT_TAX_URL, "CreditInvoiceButtonButton"],
    ["Retur Keluaran", `${EFAKTUR_BASE}/output-return`, "CancelSelectedInvoicesButton"],
    ["Retur Masukan", `${EFAKTUR_BASE}/input-return`, "SubmitReturnButton"],
  ])("is offered on %s", (_page, url, anchorId) => {
    vi.stubGlobal("location", { href: url });
    // Each grid anchors on its own action button (findEfakturAnchor picks by).
    const anchor = doc.createElement("button");
    anchor.id = anchorId;
    doc.body.appendChild(anchor);

    injectExportButton();

    expect(doc.getElementById("ch-export-batch-item")).not.toBeNull();
  });

  it("dispatches its own event, so main.ts owns the run", () => {
    injectExportButton();

    click(el("ch-export-batch-item"));

    expect(events).toEqual(["ch:export-batch"]);
  });

  it("is withheld on an SPT page", () => {
    vi.stubGlobal("location", {
      href: "https://coretaxdjp.pajak.go.id/returnsheets-portal/value-added-tax-return",
    });
    const floatLeft = doc.createElement("div");
    floatLeft.className = "float-left";
    const header = doc.createElement("div");
    header.className = "p-datatable-header";
    header.appendChild(floatLeft);
    const grid = doc.createElement("div");
    grid.className = "rshshr-nvat-la2-grid";
    grid.appendChild(header);
    doc.body.appendChild(grid);
    // The fake DOM cannot resolve the descendant selector list, so hand the SPT
    // branch its named grid's header the way the SPT suite above does.
    Object.assign(doc, {
      querySelectorAll: (sel: string) => (sel.includes("rshshr-nvat-la2-grid") ? [floatLeft] : []),
      querySelector: () => null,
    });

    injectExportButton();

    expect(doc.getElementById("ch-export-dropdown")).not.toBeNull();
    expect(doc.getElementById("ch-export-batch-item")).toBeNull();
  });
});

// ── The Komparator's entry point ──────────────────────────────────────
// The Bandingkan button is PPN Keluaran's alone: the Komparator matches
// internal records to Coretax by Referensi, and a PPN Masukan Referensi is the
// seller's (README.md, "Kenapa Komparator tidak ikut ke PPN Masukan?").
// Hiding the entry point beats a button whose every row answers "Tidak
// ditemukan". The modal itself is still injected on both grids — it hosts
// Pengecekan, which does run on PPN Masukan.
describe("the Komparator entry point", () => {
  it("is injected on PPN Keluaran", async () => {
    injectExportButton();

    expect(doc.getElementById("ch-compare-btn")).not.toBeNull();
    // The modal that hosts Pengecekan comes with it.
    expect(vi.mocked(await import("../content/ui-comparer")).injectComparerModal).toHaveBeenCalled();
  });

  it("is withheld on PPN Masukan, while the rest of the toolbar arrives", () => {
    vi.stubGlobal("location", { href: INPUT_TAX_URL });
    // PPN Masukan anchors on its own button (findEfakturAnchor picks by page).
    const inputAnchor = doc.createElement("button");
    inputAnchor.id = "CreditInvoiceButtonButton";
    doc.body.appendChild(inputAnchor);

    injectExportButton();

    expect(doc.getElementById("ch-compare-btn")).toBeNull();
    // Not a general toolbar failure: every shared control is still there.
    expect(doc.getElementById("ch-export-dropdown")).not.toBeNull();
    expect(doc.getElementById("ch-scrape-btn")).not.toBeNull();
  });
});
