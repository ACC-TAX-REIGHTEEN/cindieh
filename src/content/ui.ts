// ============================================================
// UI.TS — Inject export controls into supported Coretax pages
// ============================================================
// Handles export button injection/removal and button placement for the
// e-faktur (PPN), SPT, and withholding-slips pages.
// ============================================================

import {
  isEfakturPage,
  isInputReturnPage,
  isInputTaxPage,
  isOutputReturnPage,
  isOutputTaxPage,
  isPanelPage,
  isSptPage,
  isSupportedExportPage,
  isWithholdingPage,
  referenceIsIdentity,
} from "./page-context";

import { getExportButtonLabel } from "./ui-badge";
import {
  DEFAULT_EXPORT_FORMAT,
  EXPORT_FORMATS,
  type StoredExportFormat,
} from "../shared/extension-preferences";

import { clearFilterTimers, removeMultiInvoiceFilter, scheduleRetry } from "./ui-filters";
import { injectComparerModal } from "./ui-comparer";

import {
  setExportBtnEl,
  setExportDropdownBtnEl,
  setPdfBtnEl,
  setScrapeBtnEl,
  setCompareBtnEl,
  resetAllButtonRefs,
  getExportBtnEl,
  getExportDropdownBtnEl,
  getPdfBtnEl,
  getScrapeBtnEl,
  getCompareBtnEl,
} from "./button-state";

// ── Constants ─────────────────────────────────────────

const MAX_RETRIES = 8;

let isInjected = false;

// ── Default export format ─────────────────────────────
// The popup stores which of the two formats the user normally wants. The
// toolbar's default shape stays ONE compact dropdown — an always-on split
// main-button + caret consumed too much room beside the portal's own buttons —
// so the preference is surfaced INSIDE the menu instead: the stored format
// carries a check mark. Same information, no extra toolbar space. The split
// lives on as the opt-in one-click mode further down.

let defaultExportFormat: StoredExportFormat = DEFAULT_EXPORT_FORMAT;

/** Class on the menu item the popup marks as the user's usual format. */
export const DEFAULT_EXPORT_ITEM_CLASS = "ch-export-dropdown-item-default";

/** Trailing check icon appended to that item. */
const DEFAULT_ITEM_CHECK_CLASS = "ch-export-item-check";

/** The document event each format's export path listens for (see main.ts). */
const FORMAT_EXPORT_EVENT: Record<StoredExportFormat, string> = {
  xlsx: "ch:export-xlsx",
  csv: "ch:export-csv",
};

/** The document event the year-wide batch export listens for (see main.ts). */
const BATCH_EXPORT_EVENT = "ch:export-batch";

/**
 * Apply the stored default: move the check mark onto that format's item. Called
 * at startup (before the toolbar exists — the injection then marks the items it
 * builds) and again on every storage change, so an open tab follows the popup
 * without reloading the portal. The marker is rewritten in place; re-injecting
 * would fight Angular for the same node.
 */
export function setExportFormatDefault(format: StoredExportFormat): void {
  defaultExportFormat = format;
  markDefaultExportItem(document, format);
  // One-click mode names the format it will export in the button's tooltip.
  syncExportButtonMode();
}

/** Move the check marker inside `root`'s menu items (a detached menu is fine). */
function markDefaultExportItem(root: ParentNode, format: StoredExportFormat): void {
  for (const kind of EXPORT_FORMATS) {
    const item = root.querySelector<HTMLElement>(`#ch-export-${kind}-item`);
    if (!item) continue;

    const isDefault = kind === format;
    item.classList.toggle(DEFAULT_EXPORT_ITEM_CLASS, isDefault);
    item.querySelector(`.${DEFAULT_ITEM_CHECK_CLASS}`)?.remove();

    if (isDefault) {
      item.setAttribute("aria-current", "true");
      const check = document.createElement("span");
      check.className = `${DEFAULT_ITEM_CHECK_CLASS} pi pi-check`;
      check.setAttribute("aria-hidden", "true");
      item.appendChild(check);
    } else {
      item.removeAttribute("aria-current");
    }
  }
}

// ── One-click export (opt-in) ─────────────────────────
// Off by default. When the popup turns it on, a plain click on the toolbar
// button exports the stored default format instead of opening the menu, and the
// chevron splits off into its own caret button — the only way to keep the other
// format reachable. Both shapes are built once and switched in place, because a
// preference must never trigger a re-injection.

let oneClickExport = false;

/** The injected dropdown nodes, while they are in the page and switchable. */
interface DropdownNodes {
  exportBtn: HTMLButtonElement;
  caretBtn: HTMLButtonElement;
  caret: HTMLElement;
  menu: HTMLElement;
}

let dropdownNodes: DropdownNodes | null = null;

/**
 * Apply the stored one-click preference. Called at startup (the injection then
 * builds that shape) and on every storage change, so an open tab switches
 * without reloading the portal.
 */
export function setOneClickExport(enabled: boolean): void {
  oneClickExport = enabled;
  syncExportButtonMode();
}

/** Paint the active mode onto the injected dropdown, in place. */
function syncExportButtonMode(): void {
  const nodes = dropdownNodes;
  if (!nodes) return;
  const { exportBtn, caretBtn, caret, menu } = nodes;

  // The two modes do different things with a click on the same button, so a
  // switch always starts from a closed menu.
  menu.classList.add("ch-hidden");

  // The chevron follows whichever control opens the menu: the caret button when
  // the main button exports, the main button itself otherwise. Moving only when
  // needed keeps this a no-op for an already-correct toolbar.
  const chevronParent = oneClickExport ? caretBtn : exportBtn;
  if (caret.parentElement !== chevronParent) chevronParent.appendChild(caret);

  caretBtn.classList.toggle("ch-hidden", !oneClickExport);
  if (oneClickExport) {
    exportBtn.title = `Ekspor langsung ke ${defaultExportFormat.toUpperCase()}`;
  } else {
    exportBtn.removeAttribute("title");
  }
}

/**
 * Document-level click handler that closes the export dropdown. Tracked
 * module-wide so re-injection and removal can unregister it — otherwise every
 * Angular re-render would stack another listener (audit: listener leak).
 */
let outsideClickHandler: ((e: MouseEvent) => void) | null = null;

/**
 * Whether the format menu is open. Module state on purpose: a rebuild driven
 * by an unrelated page mutation has to hand the menu back in the state the
 * user left it, and a fresh hidden menu under a cursor that just opened it
 * reads as "it closed by itself" — which is exactly the bug this guards.
 */
let menuOpen = false;

/** Flip the menu, remembering the direction for the next rebuild. */
function toggleMenu(menu: HTMLElement): void {
  menuOpen = menu.classList.toggle("ch-hidden") === false;
}

/** Open or close the menu and remember which way it went. */
function setMenuOpen(menu: HTMLElement, open: boolean): void {
  menuOpen = open;
  menu.classList.toggle("ch-hidden", !open);
}

// ── Anchor Button Helpers ─────────────────────────────

/** Headers that take the toolbar INSIDE them rather than beside them. */
const HEADER_ANCHOR_SELECTOR =
  ".p-datatable-header .float-left, .p-datatable-header, .card-header .float-left, .card-header";

/** The SPT pages' grids: the toolbar goes in the first one that is on screen. */
const SPT_GRID_HEADER_SELECTOR = `
	rshshr-nvat-la2-grid .p-datatable-header .float-left,
	rshshr-nvat-lb2-grid .p-datatable-header .float-left,
	rshshr-art2126-l1a-grid .p-datatable-header .float-left,
	rshshr-art2126-l1b-grid .p-datatable-header .float-left,
	rshshr-art2126-l2-grid .p-datatable-header .float-left,
	rshshr-art2126-l3-grid .p-datatable-header .float-left
	`;

/** Bukti Potong: any visible datatable/card header. */
const WITHHOLDING_HEADER_SELECTOR = ".p-datatable-header .float-left, .card-header .float-left";

/**
 * Where the toolbar belongs on the current page: the node to place it against,
 * and whether to go before it or inside it. ONE resolution, shared by the
 * injection and by the "is it still where it belongs?" check that runs on
 * every debounced Angular mutation. When those two picked different headers —
 * the SPT injection anchors on one named grid, the old generic lookup found
 * whichever datatable header came first in the document — the check read a
 * perfectly good toolbar as misplaced, tore the whole thing down, and rebuilt
 * it with the menu shut under the user's cursor.
 */
interface ToolbarPlacement {
  anchor: HTMLElement;
  insertMode: "before" | "append";
}

/** First of `headers` that is actually on screen (tab panels hide the rest). */
function firstVisibleHeader(headers: Element[]): HTMLElement | null {
  return (headers.find((el) => (el as HTMLElement).offsetParent !== null) as HTMLElement) || null;
}

function resolveToolbarPlacement(): ToolbarPlacement | null {
  if (isOutputTaxPage() || isInputTaxPage() || isOutputReturnPage() || isInputReturnPage()) {
    const anchor = findEfakturAnchor();
    if (!anchor) return null;
    return {
      anchor,
      insertMode: anchor.matches(HEADER_ANCHOR_SELECTOR) ? "append" : "before",
    };
  }

  if (isSptPage()) {
    const anchor = firstVisibleHeader(Array.from(document.querySelectorAll(SPT_GRID_HEADER_SELECTOR)));
    return anchor ? { anchor, insertMode: "append" } : null;
  }

  if (isWithholdingPage()) {
    const anchor = firstVisibleHeader(Array.from(document.querySelectorAll(WITHHOLDING_HEADER_SELECTOR)));
    return anchor ? { anchor, insertMode: "append" } : null;
  }

  return null;
}

/**
 * Put one injected node where the page's current placement says it belongs, and
 * leave it alone when it is already there. Moving a live node keeps its
 * listeners and the open menu; rebuilding one throws both away.
 */
function placeInToolbar(node: HTMLElement, { anchor, insertMode }: ToolbarPlacement): void {
  if (insertMode === "append") {
    if (!anchor.contains(node)) anchor.appendChild(node);
    return;
  }
  const parent = anchor.parentElement;
  if (parent && !parent.contains(node)) parent.insertBefore(node, anchor);
}

/**
 * The injected toolbar nodes, in the order they are built. Re-placed together
 * so a moved dropdown never leaves its siblings behind in an old container.
 */
function injectedToolbarNodes(): HTMLElement[] {
  return [
    document.getElementById("ch-export-dropdown"),
    document.getElementById("ch-export-btn"),
    document.getElementById("ch-export-pdf-btn"),
    document.getElementById("ch-scrape-btn"),
    document.getElementById("ch-compare-btn"),
  ].filter((node): node is HTMLElement => node !== null);
}

/**
 * Helper to find the page's anchor element that the export controls are placed
 * next to. The e-faktur pages have an action button of their own (or the
 * table header as fallback); the SPT and withholding pages have no such
 * button and are anchored by `resolveToolbarPlacement` instead.
 */
function findEfakturAnchor(): HTMLElement | null {
  if (isInputTaxPage()) {
    const inputTaxAnchor = document.getElementById("CreditInvoiceButtonButton");
    return inputTaxAnchor && inputTaxAnchor.offsetParent !== null ? inputTaxAnchor : null;
  }

  if (isOutputReturnPage()) {
    const outputReturnAnchor = document.getElementById("CancelSelectedInvoicesButton");
    return outputReturnAnchor && outputReturnAnchor.offsetParent !== null ? outputReturnAnchor : null;
  }

  if (isInputReturnPage()) {
    const inputReturnAnchor = document.getElementById("SubmitReturnButton");
    return inputReturnAnchor && inputReturnAnchor.offsetParent !== null ? inputReturnAnchor : null;
  }

  const byId = document.getElementById("SubmitSelectedInvoicesButton");
  if (byId) return byId;

  const buttons = Array.from(document.querySelectorAll("button.p-button"));
  const byText = buttons.find(
    (b) =>
      b.textContent?.toLowerCase().includes("upload faktur") ||
      b.textContent?.toLowerCase().includes("submit selected"),
  );
  if (byText) return byText as HTMLElement;

  const byIcon = document.querySelector(".pi-upload")?.closest("button");
  if (byIcon) return byIcon as HTMLElement;

  const tableHeaderAnchor = document.querySelector(HEADER_ANCHOR_SELECTOR) as HTMLElement | null;
  if (tableHeaderAnchor && tableHeaderAnchor.offsetParent !== null) return tableHeaderAnchor;

  return null;
}

// ── Export Button Injection ───────────────────────────

/**
 * Drop every injected toolbar node and forget their references. Kept in one
 * place so the injection guard and `removeExportButton` cannot drift into two
 * different ideas of "the toolbar is gone".
 */
function clearInjectedToolbar(): void {
  document.getElementById("ch-export-dropdown")?.remove();
  document.getElementById("ch-export-btn")?.remove();
  const pdfBtn = getPdfBtnEl();
  if (pdfBtn) {
    pdfBtn.remove();
    setPdfBtnEl(null);
  }
  const scrapeBtn = getScrapeBtnEl();
  if (scrapeBtn) scrapeBtn.remove();
  const compareBtn = getCompareBtnEl();
  if (compareBtn) compareBtn.remove();
  resetAllButtonRefs();
  dropdownNodes = null;
}

/**
 * Inject the export controls into the toolbar. Every supported page gets the
 * XLSX/CSV dropdown; withholding slips pair it with a bulk "Unduh PDF" button,
 * and e-faktur pages pair it with the PDF, scrape and comparer icon buttons.
 */
export function injectExportButton(retries = MAX_RETRIES): void {
  // True when this call has to rebuild a toolbar Angular took away, as opposed
  // to building the first one for this page. Only a rebuild hands the open menu
  // back to its replacement.
  let rebuilding = false;

  // Check if buttons are already injected. A re-render that drops either the
  // dropdown or the withholding page's PDF button invalidates the whole toolbar,
  // so a rebuild never leaves a half-working pair behind. A toolbar that is
  // merely in the wrong container is MOVED, not rebuilt: these pages mutate
  // constantly, and a rebuild scheduled right behind the click that opened the
  // menu used to hand the user a fresh, closed one.
  if (isInjected) {
    const exportDropdownBtn = document.getElementById("ch-export-dropdown-btn");
    const withholdingPdfBtn = document.getElementById("ch-export-btn");

    const dropdownMissing = !exportDropdownBtn || exportDropdownBtn.offsetParent === null;
    const withholdingPdfMissing =
      isWithholdingPage() && (!withholdingPdfBtn || withholdingPdfBtn.offsetParent === null);

    if (dropdownMissing || withholdingPdfMissing) {
      isInjected = false;
      rebuilding = true;
      clearInjectedToolbar();
    } else {
      const placement = resolveToolbarPlacement();
      if (placement) {
        for (const node of injectedToolbarNodes()) placeInToolbar(node, placement);
        return;
      }
      // No anchor to judge against: fall through, so the page-specific checks
      // below (the SPT "induk" tab) still get their turn and can clear the
      // toolbar a tab switch left behind.
      isInjected = false;
      clearInjectedToolbar();
    }
  }

  const isOutputTax = isOutputTaxPage();
  const isInputTax = isInputTaxPage();
  const isOutputReturn = isOutputReturnPage();
  const isInputReturn = isInputReturnPage();
  const isSpt = isSptPage();
  const isWithholding = isWithholdingPage();

  if (!isSupportedExportPage()) return;

  if (isSpt) {
    // The "induk" tab has no exportable grid of its own — the toolbar belongs
    // to the detail tabs, so it goes away with them.
    const activeTab = document.querySelector(".p-tabview-nav li.p-highlight");
    const tabText = activeTab?.textContent?.trim().toLowerCase() || "";
    if (tabText.includes("induk")) {
      removeExportButton();
      return;
    }
  }

  const placement = resolveToolbarPlacement();
  if (!placement) {
    if (retries > 0) scheduleRetry(() => injectExportButton(retries - 1));
    return;
  }

  const { anchor: anchorEl, insertMode } = placement;
  const containerNode = insertMode === "append" ? anchorEl : anchorEl.parentElement;
  if (!containerNode) return;

  // A toolbar built for the first time on this page always starts closed; only
  // a rebuild of a toolbar the user was mid-click on reopens its menu.
  if (!rebuilding) menuOpen = false;

  isInjected = true;

  if (isWithholding) {
    // Withholding slips: the XLSX/CSV dropdown first (Ekspor leads on every
    // page), then the bulk "Unduh PDF" button beside it.
    buildExportDropdown(containerNode, anchorEl, insertMode);

    setExportBtnEl(document.createElement("button"));
    const exportBtn = getExportBtnEl()!;
    exportBtn.id = "ch-export-btn";
    exportBtn.type = "button";
    exportBtn.className = "p-element btn ct-btn-group mr-1 p-button p-component ch-btn-highlight";

    const icon = document.createElement("span");
    icon.className = "p-button-icon p-button-icon-left pi pi-download";
    icon.setAttribute("aria-hidden", "true");

    const label = document.createElement("span");
    label.className = "p-button-label";
    label.textContent = getExportButtonLabel("pdf", false);

    exportBtn.appendChild(icon);
    exportBtn.appendChild(label);

    if (insertMode === "before") {
      containerNode.insertBefore(exportBtn, anchorEl);
    } else {
      containerNode.appendChild(exportBtn);
    }

    exportBtn.addEventListener("click", (e: MouseEvent) => {
      e.stopPropagation();
      document.dispatchEvent(new CustomEvent("ch:scrape-toggle"));
    });
  } else {
    // Non-withholding pages: the shared XLSX/CSV dropdown, joined below by the
    // e-faktur controls.
    buildExportDropdown(containerNode, anchorEl, insertMode);

    // Add PDF Download button for efaktur pages
    const isEfaktur = isOutputTax || isInputTax || isOutputReturn || isInputReturn;
    if (isEfaktur) {
      setPdfBtnEl(document.createElement("button"));
      const pdfBtn = getPdfBtnEl()!;
      pdfBtn.id = "ch-export-pdf-btn";
      pdfBtn.type = "button";
      pdfBtn.className = "p-element btn ct-btn-group mr-1 p-button p-component ch-btn-highlight";

      const pdfIcon = document.createElement("span");
      pdfIcon.className = "p-button-icon p-button-icon-left pi pi-file-pdf";
      pdfIcon.setAttribute("aria-hidden", "true");

      const pdfLabel = document.createElement("span");
      pdfLabel.className = "p-button-label";
      pdfLabel.textContent = getExportButtonLabel("pdf", false);

      pdfBtn.appendChild(pdfIcon);
      pdfBtn.appendChild(pdfLabel);

      // Insert PDF button
      if (insertMode === "before") {
        containerNode.insertBefore(pdfBtn, anchorEl);
      } else {
        containerNode.appendChild(pdfBtn);
      }

      pdfBtn.addEventListener("click", (e: MouseEvent) => {
        e.stopPropagation();
        document.dispatchEvent(new CustomEvent("ch:export-pdf"));
      });

      // ── Add Scrape Data icon button ──────────────────
      setScrapeBtnEl(document.createElement("button"));
      const scrapeBtn = getScrapeBtnEl()!;
      scrapeBtn.id = "ch-scrape-btn";
      scrapeBtn.type = "button";
      scrapeBtn.className = "p-element btn ct-btn-group mr-1 p-button p-component ch-btn-highlight ch-icon-btn";
      scrapeBtn.title = "Scrape data dari sistem";
      // Icon-only control: `title` is not reliably announced, so the button
      // needs a real accessible name (ui-badge.ts keeps the two in step while a
      // run is in flight).
      scrapeBtn.setAttribute("aria-label", "Scrape data dari sistem");

      const scrapeIcon = document.createElement("span");
      scrapeIcon.className = "p-button-icon p-button-icon-left pi pi-refresh";
      scrapeIcon.setAttribute("aria-hidden", "true");

      scrapeBtn.appendChild(scrapeIcon);

      if (insertMode === "before") {
        containerNode.insertBefore(scrapeBtn, anchorEl);
      } else {
        containerNode.appendChild(scrapeBtn);
      }

      scrapeBtn.addEventListener("click", (e: MouseEvent) => {
        e.stopPropagation();
        document.dispatchEvent(new CustomEvent("ch:scrape-start"));
      });

      // ── Add the panel's entry point ──────────────────
      // ONE button into the Bandingkan / Pengecekan panel, on every page the
      // panel has a tab to offer (`isPanelPage`: the four e-Faktur PPN grids).
      // It is named for the TAB it will open, not for the panel's
      // Keluaran-only feature: on PPN Keluaran it opens the Komparator, while
      // on PPN Masukan and both Retur grids — where a Referensi is somebody
      // else's (README.md, "Kenapa Komparator hanya ada di PPN Keluaran?") or
      // absent — it opens Pengecekan, so a label promising a comparer those
      // grids cannot serve would misdescribe the click.
      //
      // Gating this on the comparer's own fact is what left PPN Masukan with no
      // entry point while the keyboard already reached the check there: the
      // entry point opens the OVERLAY, so it asks the overlay's question
      // (ADR-0021, ADR-0025). The click sends the same `ch:compare-open` event
      // as the shortcut, so the panel's own gate picks the tab and the
      // open-once / Escape semantics stay single-sourced.
      if (isPanelPage()) {
        const canCompare = referenceIsIdentity();
        const panelEntryLabel = canCompare
          ? "Bandingkan data penjualan"
          : "Pengecekan keakuratan nilai";
        setCompareBtnEl(document.createElement("button"));
        const compareBtn = getCompareBtnEl()!;
        compareBtn.id = "ch-compare-btn";
        compareBtn.type = "button";
        compareBtn.className = "p-element btn ct-btn-group mr-1 p-button p-component ch-btn-highlight ch-icon-btn";
        compareBtn.title = panelEntryLabel;
        compareBtn.setAttribute("aria-label", panelEntryLabel);

        const compareIcon = document.createElement("span");
        compareIcon.className = `p-button-icon p-button-icon-left pi ${canCompare ? "pi-list" : "pi-check-circle"}`;
        compareIcon.setAttribute("aria-hidden", "true");

        compareBtn.appendChild(compareIcon);

        if (insertMode === "before") {
          containerNode.insertBefore(compareBtn, anchorEl);
        } else {
          containerNode.appendChild(compareBtn);
        }

        compareBtn.addEventListener("click", (e: MouseEvent) => {
          e.stopPropagation();
          document.dispatchEvent(new CustomEvent("ch:compare-open"));
        });
      }

      // Inject the comparer modal — for every e-Faktur page, because the modal
      // also hosts Pengecekan, which runs on all four of them: PPN Masukan and
      // both Retur grids have no Komparator tab but do have the check
      // (isCheckerPage, ADR-0024).
      injectComparerModal();
    }
  }
}

/**
 * Build the XLSX/CSV export dropdown and its menu, then insert it beside the
 * page's anchor. Shared by every supported page so the menu, the stored-format
 * check mark and the opt-in one-click shape behave identically everywhere. The
 * nodes are tracked in `dropdownNodes` so a preference change re-shapes them in
 * place instead of re-injecting.
 */
function buildExportDropdown(
  containerNode: HTMLElement,
  anchorEl: HTMLElement,
  insertMode: "before" | "append",
): void {
  const exportDropdown = document.createElement("div");
  exportDropdown.id = "ch-export-dropdown";
  exportDropdown.className = "ch-export-dropdown";

  setExportDropdownBtnEl(document.createElement("button"));
  const exportBtn = getExportDropdownBtnEl()!;
  exportBtn.id = "ch-export-dropdown-btn";
  exportBtn.type = "button";
  exportBtn.className = "p-element btn ct-btn-group mr-1 p-button p-component ch-btn-highlight";

  const exportIcon = document.createElement("span");
  exportIcon.className = "p-button-icon p-button-icon-left pi pi-download";
  exportIcon.setAttribute("aria-hidden", "true");

  const exportLabel = document.createElement("span");
  exportLabel.className = "p-button-label";
  exportLabel.textContent = getExportButtonLabel("dropdown", false);

  // The chevron is part of the one button: it is the affordance that says
  // "this opens a menu", not a second hit area.
  const caret = document.createElement("span");
  caret.className = "p-button-icon p-button-icon-right pi pi-chevron-down";
  caret.setAttribute("aria-hidden", "true");

  exportBtn.appendChild(exportIcon);
  exportBtn.appendChild(exportLabel);
  exportBtn.appendChild(caret);
  exportDropdown.appendChild(exportBtn);

  // The caret button exists in both modes but is hidden (and holds no chevron)
  // until one-click mode moves the chevron into it, so `ch-hidden` costs no
  // toolbar space and switching modes never rebuilds the DOM.
  const caretBtn = document.createElement("button");
  caretBtn.id = "ch-export-dropdown-caret";
  caretBtn.type = "button";
  caretBtn.className =
    "p-element btn ct-btn-group p-button p-component ch-btn-highlight ch-export-dropdown-caret ch-hidden";
  caretBtn.title = "Pilih format ekspor lain";
  caretBtn.setAttribute("aria-label", "Pilih format ekspor lain");
  exportDropdown.appendChild(caretBtn);

  // Dropdown menu
  const menu = document.createElement("div");
  menu.id = "ch-export-dropdown-menu";
  menu.className = "ch-export-dropdown-menu ch-hidden";

  const xlsxItem = document.createElement("button");
  xlsxItem.type = "button";
  xlsxItem.className = "ch-export-dropdown-item";
  xlsxItem.id = "ch-export-xlsx-item";
  const xlsxItemIcon = document.createElement("span");
  xlsxItemIcon.className = "pi pi-file-excel";
  xlsxItemIcon.setAttribute("aria-hidden", "true");
  xlsxItem.appendChild(xlsxItemIcon);
  xlsxItem.appendChild(document.createTextNode("Ekspor XLSX"));

  const csvItem = document.createElement("button");
  csvItem.type = "button";
  csvItem.className = "ch-export-dropdown-item";
  csvItem.id = "ch-export-csv-item";
  const csvItemIcon = document.createElement("span");
  csvItemIcon.className = "pi pi-file";
  csvItemIcon.setAttribute("aria-hidden", "true");
  csvItem.appendChild(csvItemIcon);
  csvItem.appendChild(document.createTextNode("Ekspor CSV"));

  menu.appendChild(xlsxItem);
  menu.appendChild(csvItem);

  // The year-wide sweep, on every e-Faktur PPN grid (Keluaran, Masukan, and
  // both Retur) — each is filed per masa, so a year is the natural unit. The
  // sweep reads its period codes from the captured request and stops with a
  // message when that request carries no period filter it recognises, so no
  // grid silently exports the wrong year (scrape-batch.ts). Offered here rather
  // than as its own toolbar button so it costs no space on the seven pages that
  // cannot use it.
  if (isEfakturPage()) {
    const batchItem = document.createElement("button");
    batchItem.type = "button";
    batchItem.className = "ch-export-dropdown-item";
    batchItem.id = "ch-export-batch-item";
    const batchIcon = document.createElement("span");
    batchIcon.className = "pi pi-calendar";
    batchIcon.setAttribute("aria-hidden", "true");
    batchItem.appendChild(batchIcon);
    batchItem.appendChild(document.createTextNode("Ekspor 1 Tahun (12 Masa)"));
    batchItem.title =
      "Mengambil seluruh masa pajak dalam satu file. Prosesnya lama\u2014panel menampilkan progres per masa.";
    menu.appendChild(batchItem);

    batchItem.addEventListener("click", (e: MouseEvent) => {
      e.stopPropagation();
      setMenuOpen(menu, false);
      document.dispatchEvent(new CustomEvent(BATCH_EXPORT_EVENT));
    });
  }

  exportDropdown.appendChild(menu);

  // Mark the format the popup stores as the user's usual pick. The menu is
  // still detached here, so mark by root rather than by id lookup.
  markDefaultExportItem(exportDropdown, defaultExportFormat);

  // Insert the export dropdown
  if (insertMode === "before") {
    containerNode.insertBefore(exportDropdown, anchorEl);
  } else {
    containerNode.appendChild(exportDropdown);
  }

  // One button, one behaviour: open the menu and pick the format inside it —
  // unless the popup opted into one-click export, in which case a plain click
  // exports the stored default and only the caret opens the menu.
  exportBtn.addEventListener("click", (e: MouseEvent) => {
    e.stopPropagation();
    if (!oneClickExport) {
      toggleMenu(menu);
      return;
    }
    setMenuOpen(menu, false);
    document.dispatchEvent(new CustomEvent(FORMAT_EXPORT_EVENT[defaultExportFormat]));
  });

  caretBtn.addEventListener("click", (e: MouseEvent) => {
    e.stopPropagation();
    toggleMenu(menu);
  });

  dropdownNodes = { exportBtn, caretBtn, caret, menu };
  syncExportButtonMode();
  // The mode switch always starts closed; a rebuild does not. Hand the menu
  // back the way the user left it, so a re-render that lands mid-click cannot
  // pull the list out from under the pointer that just opened it.
  if (menuOpen) menu.classList.remove("ch-hidden");

  // Menu item handlers
  xlsxItem.addEventListener("click", (e: MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(menu, false);
    document.dispatchEvent(new CustomEvent("ch:export-xlsx"));
  });

  csvItem.addEventListener("click", (e: MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(menu, false);
    document.dispatchEvent(new CustomEvent("ch:export-csv"));
  });

  // Close menu when clicking outside. Replace any previous handler so
  // repeated injections (Angular re-renders) don't stack listeners.
  if (outsideClickHandler) document.removeEventListener("click", outsideClickHandler);
  outsideClickHandler = (e: MouseEvent) => {
    if (!exportDropdown.contains(e.target as Node)) {
      setMenuOpen(menu, false);
    }
  };
  document.addEventListener("click", outsideClickHandler);
}

// ── Export Button Removal ─────────────────────────────

/** Remove elements on navigation */
export function removeExportButton(): void {
  // A toolbar that is gone cannot have an open menu, and the next page's
  // injection must not inherit this page's state.
  menuOpen = false;
  clearFilterTimers();
  // Tear down the No. Faktur filter too — leaving an export page (e.g. to the
  // dashboard) should not leave the panel orphaned in <body>.
  removeMultiInvoiceFilter();
  if (outsideClickHandler) {
    document.removeEventListener("click", outsideClickHandler);
    outsideClickHandler = null;
  }
  const exportBtn = getExportBtnEl();
  const exportDropdown = document.getElementById("ch-export-dropdown");
  const pdfBtn = getPdfBtnEl();
  const scrapeBtn = getScrapeBtnEl();
  const compareBtn = getCompareBtnEl();
  if (exportBtn) exportBtn.remove();
  if (exportDropdown) exportDropdown.remove();
  if (pdfBtn) pdfBtn.remove();
  if (scrapeBtn) scrapeBtn.remove();
  if (compareBtn) compareBtn.remove();
  resetAllButtonRefs();
  dropdownNodes = null;
}
