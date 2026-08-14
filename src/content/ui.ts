// ============================================================
// UI.TS — Inject export controls into the Coretax PPN page
// ============================================================
// Handles export button injection/removal and button placement.
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

import { clearFilterTimers, scheduleRetry } from "./ui-filters";
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

// ── Anchor Button Helpers ─────────────────────────────

/**
 * Helper to find the "Upload Faktur" button or its container.
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
 * Inject the "Better Export" button into the toolbar.
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

    const caret = document.createElement("span");
    caret.className = "p-button-icon p-button-icon-right pi pi-chevron-down";
    caret.setAttribute("aria-hidden", "true");

    exportBtn.appendChild(exportIcon);
    exportBtn.appendChild(exportLabel);
    exportBtn.appendChild(caret);
    exportDropdown.appendChild(exportBtn);

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

    // Insert the export dropdown
    if (insertMode === "before") {
      containerNode.insertBefore(exportDropdown, anchorEl);
    } else {
      containerNode.appendChild(exportDropdown);
    }

    // Toggle dropdown menu on button click
    exportBtn.addEventListener("click", (e: MouseEvent) => {
      e.stopPropagation();
      menu.classList.toggle("ch-hidden");
    });

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

    // Close menu when clicking outside
    document.addEventListener("click", (e: MouseEvent) => {
      if (!exportDropdown.contains(e.target as Node)) {
        menu.classList.add("ch-hidden");
      }
    });

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
}
