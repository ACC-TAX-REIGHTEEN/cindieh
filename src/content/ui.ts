// ============================================================
// UI.TS — Inject export controls into the Coretax PPN page
// ============================================================
// Central hub that re-exports from ui-badge and ui-filters.
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

import {
  getIdlePanelStatus,
  getToggledPanelVisibility,
  getExportButtonLabel,
  showPanel,
  injectBadge,
  updatePanelProgress,
  updatePanelComplete,
  updatePanelError,
  updatePanelIdle,
  destroyBadge,
} from "./ui-badge";

import { injectGridFilters, injectToolbarFilter, injectMultiInvoiceFilter, getMultiInvoiceNumbers, clearFilterTimers, scheduleRetry } from "./ui-filters";

import {
  setExportBtnEl,
  setXlsxBtnEl,
  setCsvBtnEl,
  setPdfBtnEl,
  resetAllButtonRefs,
  getExportBtnEl,
  getXlsxBtnEl,
  getCsvBtnEl,
  getPdfBtnEl,
} from "./button-state";

// ── Re-export page-context functions ──────────────────

export {
  isInputReturnPage,
  isInputTaxPage,
  isOutputReturnPage,
  isOutputTaxPage,
  isSptPage,
  isSupportedExportPage,
  isWithholdingPage,
};

// ── Re-export badge/filters public API ────────────────

export {
  getIdlePanelStatus,
  getToggledPanelVisibility,
  getExportButtonLabel,
  showPanel,
  injectBadge,
  updatePanelProgress,
  updatePanelComplete,
  updatePanelError,
  updatePanelIdle,
  injectGridFilters,
  injectToolbarFilter,
  injectMultiInvoiceFilter,
  getMultiInvoiceNumbers,
};

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
    const xlsxBtn = document.getElementById("ch-export-xlsx-btn");
    const csvBtn = document.getElementById("ch-export-csv-btn");
    const singleBtn = document.getElementById("ch-export-btn");

    // For non-withholding pages, check both XLSX and CSV buttons
    if (!isWithholdingPage()) {
      if (!xlsxBtn || xlsxBtn.offsetParent === null || !csvBtn || csvBtn.offsetParent === null) {
        isInjected = false;
        if (xlsxBtn) xlsxBtn.remove();
        if (csvBtn) csvBtn.remove();
        const pdfBtn = getPdfBtnEl();
        if (pdfBtn) {
          pdfBtn.remove();
          setPdfBtnEl(null);
        }
      } else if (!isButtonPlacedCorrectly(xlsxBtn)) {
        const inputTaxAnchor = isInputTaxPage() ? document.getElementById("CreditInvoiceButtonButton") : null;
        if (inputTaxAnchor && inputTaxAnchor.offsetParent !== null && moveButtonNextToAnchor(xlsxBtn, inputTaxAnchor)) {
          return;
        }
        isInjected = false;
        xlsxBtn.remove();
        if (csvBtn) csvBtn.remove();
        const pdfBtn = getPdfBtnEl();
        if (pdfBtn) {
          pdfBtn.remove();
          setPdfBtnEl(null);
        }
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
    // For non-withholding pages: two buttons (XLSX + CSV)
    setXlsxBtnEl(document.createElement("button"));
    const xlsxBtn = getXlsxBtnEl()!;
    xlsxBtn.id = "ch-export-xlsx-btn";
    xlsxBtn.type = "button";
    xlsxBtn.className = "p-element btn ct-btn-group mr-1 p-button p-component ch-btn-highlight";

    const xlsxIcon = document.createElement("span");
    xlsxIcon.className = "p-button-icon p-button-icon-left pi pi-file-excel";
    xlsxIcon.setAttribute("aria-hidden", "true");

    const xlsxLabel = document.createElement("span");
    xlsxLabel.className = "p-button-label";
    xlsxLabel.textContent = getExportButtonLabel("xlsx", false);

    xlsxBtn.appendChild(xlsxIcon);
    xlsxBtn.appendChild(xlsxLabel);

    setCsvBtnEl(document.createElement("button"));
    const csvBtn = getCsvBtnEl()!;
    csvBtn.id = "ch-export-csv-btn";
    csvBtn.type = "button";
    csvBtn.className = "p-element btn ct-btn-group mr-1 p-button p-component ch-btn-highlight";

    const csvIcon = document.createElement("span");
    csvIcon.className = "p-button-icon p-button-icon-left pi pi-file";
    csvIcon.setAttribute("aria-hidden", "true");

    const csvLabel = document.createElement("span");
    csvLabel.className = "p-button-label";
    csvLabel.textContent = getExportButtonLabel("csv", false);

    csvBtn.appendChild(csvIcon);
    csvBtn.appendChild(csvLabel);

    // Insert both buttons
    if (insertMode === "before") {
      containerNode.insertBefore(xlsxBtn, anchorEl);
      containerNode.insertBefore(csvBtn, anchorEl);
    } else {
      containerNode.appendChild(xlsxBtn);
      containerNode.appendChild(csvBtn);
    }

    // Wire up event handlers
    xlsxBtn.addEventListener("click", (e: MouseEvent) => {
      e.stopPropagation();
      document.dispatchEvent(new CustomEvent("ch:export-xlsx"));
    });

    csvBtn.addEventListener("click", (e: MouseEvent) => {
      e.stopPropagation();
      document.dispatchEvent(new CustomEvent("ch:export-csv"));
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
    }
  }
}

// ── Export Button Removal ─────────────────────────────

/** Remove elements on navigation */
export function removeExportButton(): void {
  clearFilterTimers();
  const exportBtn = getExportBtnEl();
  const xlsxBtn = getXlsxBtnEl();
  const csvBtn = getCsvBtnEl();
  const pdfBtn = getPdfBtnEl();
  if (exportBtn) exportBtn.remove();
  if (xlsxBtn) xlsxBtn.remove();
  if (csvBtn) csvBtn.remove();
  if (pdfBtn) pdfBtn.remove();
  resetAllButtonRefs();
  destroyBadge();
}
