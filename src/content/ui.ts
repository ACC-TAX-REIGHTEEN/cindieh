// ============================================================
// UI.TS — Inject export controls into supported Coretax pages
// ============================================================
// Handles export button injection/removal and button placement for the
// e-faktur (PPN), SPT, and withholding-slips pages.
// ============================================================

import {
  isInputReturnPage,
  isInputTaxPage,
  isOutputReturnPage,
  isOutputTaxPage,
  isSptPage,
  isSupportedExportPage,
  isWithholdingPage,
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

// ── Anchor Button Helpers ─────────────────────────────

/**
 * Helper to find the page's anchor element that the export controls are placed
 * next to. The anchor differs per page type: an action button (or the table
 * header as fallback) on the e-faktur pages, a table header on the SPT and
 * withholding pages.
 */
function findAnchorButton(): HTMLElement | null {
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

  const tableHeaderAnchor = document.querySelector(
    ".p-datatable-header .float-left, .p-datatable-header, .card-header .float-left, .card-header",
  ) as HTMLElement | null;
  if (tableHeaderAnchor && tableHeaderAnchor.offsetParent !== null) return tableHeaderAnchor;

  return null;
}

function isButtonPlacedCorrectly(btn: HTMLElement): boolean {
  // Check that the button is visible and lives in the same container as the anchor.
  // We no longer require exact sibling adjacency because multiple buttons
  // (XLSX, CSV, PDF) can be inserted before the anchor.
  if (btn.offsetParent === null) return false;

  const anchor = findAnchorButton();
  if (!anchor || anchor.offsetParent === null) return false;

  const container = anchor.parentElement;
  if (!container) return false;

  // Button is either a sibling (before mode) or a child of the anchor (append mode)
  return container.contains(btn) || anchor.contains(btn);
}

function moveButtonNextToAnchor(btn: HTMLElement, anchor: HTMLElement): boolean {
  const parent = anchor.parentElement;
  if (!parent) return false;
  parent.insertBefore(btn, anchor);
  return true;
}

// ── Export Button Injection ───────────────────────────

/**
 * Inject the export controls into the toolbar: a single download button on the
 * withholding page; elsewhere the XLSX/CSV dropdown, plus -- on e-faktur pages
 * only -- the PDF, scrape, and comparer icon buttons.
 */
export function injectExportButton(retries = MAX_RETRIES): void {
  // Check if buttons are already injected
  if (isInjected) {
    const exportDropdownBtn = document.getElementById("ch-export-dropdown-btn");
    const singleBtn = document.getElementById("ch-export-btn");

    // For non-withholding pages, check the export dropdown button
    if (!isWithholdingPage()) {
      if (!exportDropdownBtn || exportDropdownBtn.offsetParent === null) {
        isInjected = false;
        exportDropdownBtn?.remove();
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
      } else if (!isButtonPlacedCorrectly(exportDropdownBtn)) {
        const inputTaxAnchor = isInputTaxPage() ? document.getElementById("CreditInvoiceButtonButton") : null;
        if (inputTaxAnchor && inputTaxAnchor.offsetParent !== null && moveButtonNextToAnchor(exportDropdownBtn, inputTaxAnchor)) {
          return;
        }
        isInjected = false;
        exportDropdownBtn.remove();
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
      } else {
        return;
      }
    } else {
      // For withholding pages, check single button
      if (!singleBtn || singleBtn.offsetParent === null) {
        isInjected = false;
        if (singleBtn) singleBtn.remove();
      } else if (!isButtonPlacedCorrectly(singleBtn)) {
        isInjected = false;
        singleBtn.remove();
      } else {
        return;
      }
    }
  }

  const isOutputTax = isOutputTaxPage();
  const isInputTax = isInputTaxPage();
  const isOutputReturn = isOutputReturnPage();
  const isInputReturn = isInputReturnPage();
  const isSpt = isSptPage();
  const isWithholding = isWithholdingPage();

  if (!isSupportedExportPage()) return;

  let anchorEl: HTMLElement | null = null;
  let insertMode: "before" | "append" = "before";

  if (isOutputTax || isInputTax || isOutputReturn || isInputReturn) {
    anchorEl = findAnchorButton();
    insertMode = anchorEl?.matches(
      ".p-datatable-header .float-left, .p-datatable-header, .card-header .float-left, .card-header",
    )
      ? "append"
      : "before";
  } else if (isSpt) {
    const activeTab = document.querySelector(".p-tabview-nav li.p-highlight");
    const tabText = activeTab?.textContent?.trim().toLowerCase() || "";
    if (tabText.includes("induk")) {
      removeExportButton();
      return;
    }

    const headers = Array.from(
      document.querySelectorAll(`
				rshshr-nvat-la2-grid .p-datatable-header .float-left,
				rshshr-nvat-lb2-grid .p-datatable-header .float-left,
				rshshr-art2126-l1a-grid .p-datatable-header .float-left,
				rshshr-art2126-l1b-grid .p-datatable-header .float-left,
				rshshr-art2126-l2-grid .p-datatable-header .float-left,
				rshshr-art2126-l3-grid .p-datatable-header .float-left
			`),
    );
    anchorEl = (headers.find((el) => (el as HTMLElement).offsetParent !== null) as HTMLElement) || null;
    insertMode = "append";
  } else if (isWithholding) {
    const headers = Array.from(document.querySelectorAll(".p-datatable-header .float-left, .card-header .float-left"));
    anchorEl = (headers.find((el) => (el as HTMLElement).offsetParent !== null) as HTMLElement) || null;
    insertMode = "append";
  }

  if (!anchorEl) {
    if (retries > 0) scheduleRetry(() => injectExportButton(retries - 1));
    return;
  }

  let containerNode = insertMode === "append" ? anchorEl : anchorEl.parentElement;
  if (!containerNode) return;

  isInjected = true;

  // For withholding pages: single "Download PDF" button
  if (isWithholding) {
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
    // For non-withholding pages: a single export dropdown (XLSX + CSV)
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
        menu.classList.toggle("ch-hidden");
        return;
      }
      menu.classList.add("ch-hidden");
      document.dispatchEvent(new CustomEvent(FORMAT_EXPORT_EVENT[defaultExportFormat]));
    });

    caretBtn.addEventListener("click", (e: MouseEvent) => {
      e.stopPropagation();
      menu.classList.toggle("ch-hidden");
    });

    dropdownNodes = { exportBtn, caretBtn, caret, menu };
    syncExportButtonMode();

    // Menu item handlers
    xlsxItem.addEventListener("click", (e: MouseEvent) => {
      e.stopPropagation();
      menu.classList.add("ch-hidden");
      document.dispatchEvent(new CustomEvent("ch:export-xlsx"));
    });

    csvItem.addEventListener("click", (e: MouseEvent) => {
      e.stopPropagation();
      menu.classList.add("ch-hidden");
      document.dispatchEvent(new CustomEvent("ch:export-csv"));
    });

    // Close menu when clicking outside. Replace any previous handler so
    // repeated injections (Angular re-renders) don't stack listeners.
    if (outsideClickHandler) document.removeEventListener("click", outsideClickHandler);
    outsideClickHandler = (e: MouseEvent) => {
      if (!exportDropdown.contains(e.target as Node)) {
        menu.classList.add("ch-hidden");
      }
    };
    document.addEventListener("click", outsideClickHandler);

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

      // ── Add Bandingkan icon button ───────────────────
      setCompareBtnEl(document.createElement("button"));
      const compareBtn = getCompareBtnEl()!;
      compareBtn.id = "ch-compare-btn";
      compareBtn.type = "button";
      compareBtn.className = "p-element btn ct-btn-group mr-1 p-button p-component ch-btn-highlight ch-icon-btn";
      compareBtn.title = "Bandingkan data penjualan";

      const compareIcon = document.createElement("span");
      compareIcon.className = "p-button-icon p-button-icon-left pi pi-list";
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

      // Inject the comparer modal
      injectComparerModal();
    }
  }
}

// ── Export Button Removal ─────────────────────────────

/** Remove elements on navigation */
export function removeExportButton(): void {
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
