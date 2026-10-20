// Unit tests for page-surfaces.ts — the page's injected surfaces.
//
// The claim under test is ONE OWNER PER SURFACE: the module that paints a
// surface also takes it away. From the outside that means two things — after
// a teardown nothing of Cindieh's is left in the page, and painting again
// does not stack a second copy of anything.
//
// The list this replaces was a hand-written id list in main.ts, and it had
// already leaked: it named the toolbar filter's INPUT but not the CONTAINER
// the input lives in, so a teardown left the container behind and the next
// injection put a second one next to it.
//
// The page's own facts are the real ones here (a PPN Keluaran URL is a
// supported page with a Referensi column), so what the registry paints is
// what the portal would really get.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { stubFakeDom, type FakeDoc, type FakeEl } from "./__mocks__/fake-dom";

const OUTPUT_TAX_URL = "https://coretaxdjp.pajak.go.id/e-invoice-portal/output-tax";

let doc: FakeDoc;
let pageSurfaces: typeof import("../content/page-surfaces");
let uiPanel: typeof import("../content/ui-panel");

/** The cell the grid's Referensi filter goes into, with the portal's own filter in it. */
let refCell: FakeEl;
/** The portal's own filter in that cell — the one our box takes the cell's place of. */
let portalFilter: FakeEl;

beforeAll(async () => {
  // The panel builds its view when its module loads, so the DOM has to exist
  // before the modules are imported — hence the dynamic import.
  ({ doc } = stubFakeDom());
  pageSurfaces = await import("../content/page-surfaces");
  uiPanel = await import("../content/ui-panel");
});

beforeEach(() => {
  vi.stubGlobal("location", { href: OUTPUT_TAX_URL });
  // A fresh page for every case: the DOM is stubbed once (the panel's view is
  // built once), so the page is emptied and rebuilt instead.
  for (const child of [...doc.body.children]) child.remove();
  refCell = buildPortal();
});

afterEach(() => {
  // The surfaces keep module state (the toolbar's own flags, the panel's
  // session), and the removal is the supported way to put it back.
  pageSurfaces.removePageSurfaces();
});

/**
 * A portal-shaped page: the e-faktur action button the toolbar hangs off, the
 * reset-filter button the Referensi box hangs beside, and a table with a
 * Referensi column whose filter cell still holds the portal's own filter.
 */
function buildPortal(): FakeEl {
  const action = doc.createElement("button");
  action.id = "SubmitSelectedInvoicesButton";
  doc.body.appendChild(action);

  const reset = doc.createElement("button");
  reset.setAttribute("ptooltip", "Setel Ulang Filter");
  doc.body.appendChild(reset);
  // The filters look for the portal's buttons through querySelectorAll.
  doc.buttons = [reset];

  const thead = doc.createElement("thead");
  const labelRow = doc.createElement("tr");
  for (const label of ["Kode", "Referensi", "Nama Pembeli"]) {
    const th = doc.createElement("th");
    th.textContent = label;
    labelRow.appendChild(th);
  }
  thead.appendChild(labelRow);

  const filterRow = doc.createElement("tr");
  let cell: FakeEl | null = null;
  for (const label of ["Kode", "Referensi", "Nama Pembeli"]) {
    const th = doc.createElement("th");
    const filter = doc.createElement("div");
    filter.className = "p-column-filter";
    filter.textContent = `filter-${label}`;
    th.appendChild(filter);
    filterRow.appendChild(th);
    if (label === "Referensi") {
      cell = th;
      portalFilter = filter;
    }
  }
  thead.appendChild(filterRow);
  doc.body.appendChild(thead);

  return cell!;
}

/** Every id Cindieh still has in the page. */
function cindiehIds(): string[] {
  return [...doc.byId.keys()].filter((id) => id.startsWith("ch-"));
}

describe("the page's surfaces", () => {
  it("paints every surface the page needs", () => {
    pageSurfaces.paintPageSurfaces();

    expect(doc.getElementById("ch-floating-info-container")).not.toBeNull(); // the badge
    expect(doc.getElementById("ch-export-dropdown")).not.toBeNull(); // the toolbar
    expect(doc.getElementById("ch-comparer-overlay")).not.toBeNull(); // the panel
    expect(doc.getElementById("ch-toolbar-filter-container")).not.toBeNull(); // the toolbar filter
    expect(doc.getElementById("ch-grid-filter-reference")).not.toBeNull(); // the grid filter
    expect(doc.getElementById("ch-multi-invoice-toggle")).not.toBeNull(); // the No. Faktur filter
  });

  it("takes every surface off the page — nothing of ours is left behind", () => {
    pageSurfaces.paintPageSurfaces();
    expect(cindiehIds().length).toBeGreaterThan(0);

    pageSurfaces.removePageSurfaces();

    // The whole point of one owner per surface: the removal is complete
    // because the owner knows what it built. The toolbar filter's CONTAINER
    // used to survive this — the old id list named the input inside it — and
    // the next injection then put a second container next to the first.
    expect(cindiehIds()).toEqual([]);
  });

  it("does not stack a second copy when the page is painted again", () => {
    pageSurfaces.paintPageSurfaces();
    pageSurfaces.removePageSurfaces();

    pageSurfaces.paintPageSurfaces();

    expect(doc.body.querySelectorAll(".ch-grid-filter-container")).toHaveLength(1);
    expect(doc.body.querySelectorAll("#ch-toolbar-filter-container")).toHaveLength(1);
    expect(doc.body.querySelectorAll("#ch-multi-invoice-toggle")).toHaveLength(1);
    expect(doc.body.querySelectorAll("#ch-floating-info-container")).toHaveLength(1);
  });

  it("hands the portal its own filter back when the grid filter goes", () => {
    pageSurfaces.paintPageSurfaces();
    // Our box has taken the cell's place: the portal's own filter is gone.
    expect(refCell.children[0]?.id).toBe("ch-grid-filter-container");

    pageSurfaces.removePageSurfaces();

    // The cell was emptied to make room for ours, so ours leaving without
    // giving the portal's filter back would leave a column the user can no
    // longer filter.
    expect(refCell.children).toHaveLength(1);
    expect(refCell.children[0]).toBe(portalFilter);
  });

  it("gives the page back its inert state when the panel is removed", () => {
    pageSurfaces.paintPageSurfaces();
    uiPanel.openPanel();
    const parked = doc.body.children.filter((child) => child.inert);
    expect(parked.length).toBeGreaterThan(0);

    pageSurfaces.removePageSurfaces();

    // An open panel parks everything behind it. Removing the panel WITHOUT
    // closing it first would leave a portal the user cannot click: a page
    // that looks fine and answers to nothing.
    expect(doc.body.children.some((child) => child.inert)).toBe(false);
  });

  it("leaves the panel alone on a re-render, so the pasted text survives", () => {
    pageSurfaces.paintPageSurfaces();
    const overlay = doc.getElementById("ch-comparer-overlay")!;
    const textarea = doc.getElementById("ch-comparer-textarea") as FakeEl;
    textarea.value = "000123\t000456";

    pageSurfaces.repaintPageSurfaces();

    // The panel lives in <body>, which Angular does not re-render — so a
    // rebuild would throw away what the user pasted into it.
    expect(doc.getElementById("ch-comparer-overlay")).toBe(overlay);
    expect((doc.getElementById("ch-comparer-textarea") as FakeEl).value).toBe("000123\t000456");
  });

  it("puts the toolbar back after the portal re-renders its header", () => {
    pageSurfaces.paintPageSurfaces();
    // Angular takes the header's contents away and renders its own again.
    doc.getElementById("ch-export-dropdown")!.remove();

    pageSurfaces.repaintPageSurfaces();

    expect(doc.getElementById("ch-export-dropdown")).not.toBeNull();
  });

  it("is safe to remove on a page where nothing was painted", () => {
    expect(() => pageSurfaces.removePageSurfaces()).not.toThrow();
    expect(cindiehIds()).toEqual([]);
  });

  it("names every surface once", () => {
    const names = pageSurfaces.PAGE_SURFACES.map((surface) => surface.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
