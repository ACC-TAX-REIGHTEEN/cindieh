// ============================================================
// UI.TS — Inject export controls into the Coretax PPN page
// ============================================================
// Injects an "Better Export" button into the toolbar.
// Clicking it directly starts/toggles the scrape process.
// Progress is shown in a floating info bar in the bottom-right.
// Communicates via custom DOM events with main.ts.
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

export {
  isInputReturnPage,
  isInputTaxPage,
  isOutputReturnPage,
  isOutputTaxPage,
  isSptPage,
  isSupportedExportPage,
  isWithholdingPage,
};

/**
 * Helper to find the "Upload Faktur" button or its container.
 */
function findAnchorButton(): HTMLElement | null {
  if (isInputTaxPage()) {
    const inputTaxAnchor = document.getElementById("CreditInvoiceButtonButton");
    return inputTaxAnchor && inputTaxAnchor.offsetParent !== null
      ? inputTaxAnchor
      : null;
  }

  if (isOutputReturnPage()) {
    const outputReturnAnchor = document.getElementById(
      "CancelSelectedInvoicesButton",
    );
    return outputReturnAnchor && outputReturnAnchor.offsetParent !== null
      ? outputReturnAnchor
      : null;
  }

  if (isInputReturnPage()) {
    const inputReturnAnchor = document.getElementById("SubmitReturnButton");
    return inputReturnAnchor && inputReturnAnchor.offsetParent !== null
      ? inputReturnAnchor
      : null;
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
  if (tableHeaderAnchor && tableHeaderAnchor.offsetParent !== null)
    return tableHeaderAnchor;

  return null;
}

// ── Floating Info State ──────────────────────────────

let badgeEl: HTMLDivElement | null = null;
let statsEl: HTMLDivElement | null = null;
let exportBtnEl: HTMLButtonElement | null = null; // withholding page: single "Download PDF" button
let xlsxBtnEl: HTMLButtonElement | null = null; // non-withholding: "Export XLSX" button
let csvBtnEl: HTMLButtonElement | null = null; // non-withholding: "Export CSV" button
let pdfBtnEl: HTMLButtonElement | null = null; // efaktur: "Download PDF" button
let isInjected = false;
let isPanelRunning = false;

type ExportButtonKind = "xlsx" | "csv" | "pdf";

export function getIdlePanelStatus(): string {
  return "Tidak ada proses berjalan. Mulai export dari tombol Better Export.";
}

export function getToggledPanelVisibility(
  isCurrentlyVisible: boolean,
): boolean {
  return !isCurrentlyVisible;
}

export function getExportButtonLabel(
  kind: ExportButtonKind,
  isRunning: boolean,
): string {
  if (isRunning) return "Stop Export";
  if (kind === "xlsx") return "Export XLSX";
  if (kind === "csv") return "Export CSV";
  return "Download PDF";
}

interface FloatingElements {
  statusText: HTMLDivElement;
  statTotal: HTMLSpanElement;
  statPages: HTMLSpanElement;
  statTime: HTMLSpanElement;
  progressBar: HTMLDivElement;
}

let els: FloatingElements | null = null;

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

function moveButtonNextToAnchor(
  btn: HTMLElement,
  anchor: HTMLElement,
): boolean {
  const parent = anchor.parentElement;
  if (!parent) return false;
  parent.insertBefore(btn, anchor);
  return true;
}

/** Inject the Floating Info Bar (bottom-right) */
export function injectBadge() {
  // Remove any old versions to avoid duplicates
  const oldContainer = document.getElementById("ch-floating-info-container");
  const oldBadge = document.getElementById("ch-badge");
  if (oldContainer) oldContainer.remove();
  else if (oldBadge) oldBadge.remove();

  console.log("Better Coretax: Injecting floating info bar...");
  const container = document.createElement("div");
  container.id = "ch-floating-info-container";
  container.className = "ch-floating-info";

  // Create stats element
  statsEl = document.createElement("div");
  statsEl.id = "ch-floating-stats";
  statsEl.className = "ch-floating-stats ch-hidden";

  const createStatItem = (label: string, id: string) => {
    const item = document.createElement("div");
    item.className = "ch-f-stat-item";
    const lbl = document.createElement("span");
    lbl.className = "ch-f-label";
    lbl.textContent = label;
    const val = document.createElement("span");
    val.className = "ch-f-value";
    val.id = id;
    val.textContent = "0";
    item.appendChild(lbl);
    item.appendChild(val);
    return { item, val };
  };

  const totalStat = createStatItem("Data", "ch-f-total");
  const pagesStat = createStatItem("Hal", "ch-f-pages");
  const timeStat = createStatItem("Waktu", "ch-f-time");

  const statusText = document.createElement("div");
  statusText.id = "ch-f-status";
  statusText.className = "ch-f-status";
  statusText.textContent = "Siap...";

  const progressContainer = document.createElement("div");
  progressContainer.className = "ch-f-progress-container";
  const progressBar = document.createElement("div");
  progressBar.id = "ch-f-progress-bar";
  progressBar.className = "ch-f-progress-bar";
  progressContainer.appendChild(progressBar);

  statsEl.appendChild(totalStat.item);
  statsEl.appendChild(pagesStat.item);
  statsEl.appendChild(timeStat.item);
  statsEl.appendChild(statusText);
  statsEl.appendChild(progressContainer);

  // Create badge element
  badgeEl = document.createElement("div");
  badgeEl.id = "ch-badge";
  badgeEl.className = "ch-badge";
  badgeEl.textContent = "bc";

  // Wire badge click to toggle the panel.
  badgeEl.addEventListener("click", () => {
    if (!statsEl) return;
    const shouldShow = getToggledPanelVisibility(
      !statsEl.classList.contains("ch-hidden"),
    );
    if (shouldShow && !isPanelRunning) {
      setIdlePanelContent();
    }
    statsEl.classList.toggle("ch-hidden", !shouldShow);
  });

  container.appendChild(statsEl);
  container.appendChild(badgeEl);
  document.body.appendChild(container);

  els = {
    statusText,
    statTotal: totalStat.val,
    statPages: pagesStat.val,
    statTime: timeStat.val,
    progressBar,
  };
}

function setIdlePanelContent(): void {
  if (!els) return;
  els.statTotal.textContent = "0";
  els.statPages.textContent = "0";
  els.statTime.textContent = "-";
  els.statusText.textContent = getIdlePanelStatus();
  els.progressBar.style.width = "0%";
}

function getExportButtonIcon(
  kind: ExportButtonKind,
  isRunning: boolean,
): string {
  if (isRunning) return "pi pi-spin pi-spinner";
  if (kind === "xlsx") return "pi pi-file-excel";
  if (kind === "csv") return "pi pi-file";
  return "pi pi-download";
}

function setExportButtonState(
  btn: HTMLButtonElement | null,
  kind: ExportButtonKind,
  isRunning: boolean,
): void {
  if (!btn) return;
  const icon = btn.querySelector(".p-button-icon") as HTMLElement | null;
  if (icon)
    icon.className = `p-button-icon p-button-icon-left ${getExportButtonIcon(kind, isRunning)} mr-1`;

  const label = btn.querySelector(".p-button-label") as HTMLElement | null;
  if (label) label.textContent = getExportButtonLabel(kind, isRunning);

  btn.classList.toggle("ch-btn-danger", isRunning);
}

/**
 * Show the floating stats panel (removes ch-hidden).
 * Called at the start of every operation to auto-show the panel (Req 4.6).
 */
export function showPanel(): void {
  statsEl?.classList.remove("ch-hidden");
}

/**
 * Finds column index by text.
 */
function findColumnIndex(
  headerRow: HTMLTableRowElement,
  searchTexts: string[],
): number {
  const ths = Array.from(headerRow.querySelectorAll("th"));
  return ths.findIndex((th) => {
    const text = th.textContent?.trim().toLowerCase() || "";
    return searchTexts.some((s) => text.includes(s.toLowerCase()));
  });
}

/**
 * Inject filter inputs into the table header.
 */
export function injectGridFilters(): void {
  if (!isOutputTaxPage()) return;
  const thead = document.querySelector("thead");
  if (!thead) return;

  const headerRows = Array.from(thead.querySelectorAll("tr"));
  if (headerRows.length < 2) return;

  const mainHeaderRow = headerRows[0] as HTMLTableRowElement;
  const filterRow = headerRows[1] as HTMLTableRowElement;

  if (filterRow.querySelector("#ch-grid-filter-reference")) return;

  const refIdx = findColumnIndex(mainHeaderRow, ["Referensi", "Reference"]);
  if (refIdx === -1) return;

  const filterCells = Array.from(filterRow.querySelectorAll("th"));
  const refCell = filterCells[refIdx];
  if (!refCell) return;

  const container = document.createElement("div");
  container.className = "ch-grid-filter-container";

  const filterWrapper = document.createElement("div");
  filterWrapper.className = "p-column-filter p-column-filter-row";

  const fluidWrapper = document.createElement("div");
  fluidWrapper.className = "p-fluid";

  const input = document.createElement("input");
  input.type = "text";
  input.id = "ch-grid-filter-reference";
  input.className = "p-inputtext p-component";
  input.placeholder = "Cari Referensi...";
  Object.assign(input.style, {
    width: "100%",
    fontSize: "12px",
    padding: "0.5rem",
  });

  fluidWrapper.appendChild(input);
  filterWrapper.appendChild(fluidWrapper);
  container.appendChild(filterWrapper);

  refCell.innerHTML = "";
  refCell.appendChild(container);
}

/**
 * Inject filter input into the toolbar.
 */
export function injectToolbarFilter(retries = 15): void {
  if (!isOutputTaxPage()) return;
  if (document.getElementById("ch-toolbar-filter-reference")) return;

  const buttons = Array.from(document.querySelectorAll("button"));
  let anchor =
    buttons.find((b) => b.getAttribute("ptooltip") === "Setel Ulang Filter") ||
    buttons.find((b) => b.querySelector(".pi-filter-slash")) ||
    buttons.find(
      (b) =>
        (b.className.includes("ct-ovw-btn-mini-cancel") ||
          b.className.includes("ct-ovw-btn-mini")) &&
        (b.querySelector(".pi-filter-slash") || b.querySelector(".pi-refresh")),
    );

  if (!anchor) {
    if (retries > 0) setTimeout(() => injectToolbarFilter(retries - 1), 1000);
    return;
  }

  const container = document.createElement("div");
  container.id = "ch-toolbar-filter-container";
  Object.assign(container.style, {
    display: "inline-block",
    marginLeft: "0.5rem",
    verticalAlign: "middle",
  });

  const group = document.createElement("div");
  group.className = "p-inputgroup";

  const addon = document.createElement("span");
  addon.className = "p-inputgroup-addon";
  Object.assign(addon.style, {
    padding: "0 0.5rem",
    fontSize: "12px",
    background: "#334155",
    color: "white",
    border: "1px solid #475569",
    borderRight: "none",
  });
  const icon = document.createElement("i");
  icon.className = "pi pi-search";
  addon.appendChild(icon);

  const input = document.createElement("input");
  input.type = "text";
  input.id = "ch-toolbar-filter-reference";
  input.className = "p-inputtext p-component";
  input.placeholder = "Cari Referensi...";
  Object.assign(input.style, {
    width: "180px",
    fontSize: "12px",
    padding: "0.5rem",
    borderColor: "#475569",
  });

  group.appendChild(addon);
  group.appendChild(input);
  container.appendChild(group);

  anchor.insertAdjacentElement("afterend", container);
}

/**
 * Inject the "Better Export" button into the toolbar.
 */
export function injectExportButton(retries = 15): void {
  // Check if buttons are already injected
  if (isInjected) {
    const xlsxBtn = document.getElementById("ch-export-xlsx-btn");
    const csvBtn = document.getElementById("ch-export-csv-btn");
    const singleBtn = document.getElementById("ch-export-btn");

    // For non-withholding pages, check both XLSX and CSV buttons
    if (!isWithholdingPage()) {
      if (
        !xlsxBtn ||
        xlsxBtn.offsetParent === null ||
        !csvBtn ||
        csvBtn.offsetParent === null
      ) {
        isInjected = false;
        if (xlsxBtn) xlsxBtn.remove();
        if (csvBtn) csvBtn.remove();
        if (pdfBtnEl) {
          pdfBtnEl.remove();
          pdfBtnEl = null;
        }
      } else if (!isButtonPlacedCorrectly(xlsxBtn)) {
        const inputTaxAnchor = isInputTaxPage()
          ? document.getElementById("CreditInvoiceButtonButton")
          : null;
        if (
          inputTaxAnchor &&
          inputTaxAnchor.offsetParent !== null &&
          moveButtonNextToAnchor(xlsxBtn, inputTaxAnchor)
        ) {
          return;
        }
        isInjected = false;
        xlsxBtn.remove();
        if (csvBtn) csvBtn.remove();
        if (pdfBtnEl) {
          pdfBtnEl.remove();
          pdfBtnEl = null;
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
    anchorEl =
      (headers.find(
        (el) => (el as HTMLElement).offsetParent !== null,
      ) as HTMLElement) || null;
    insertMode = "append";
  } else if (isWithholding) {
    const headers = Array.from(
      document.querySelectorAll(
        ".p-datatable-header .float-left, .card-header .float-left",
      ),
    );
    anchorEl =
      (headers.find(
        (el) => (el as HTMLElement).offsetParent !== null,
      ) as HTMLElement) || null;
    insertMode = "append";
  }

  if (!anchorEl) {
    if (retries > 0) setTimeout(() => injectExportButton(retries - 1), 1000);
    return;
  }

  let containerNode =
    insertMode === "append" ? anchorEl : anchorEl.parentElement;
  if (!containerNode) return;

  isInjected = true;

  // For withholding pages: single "Download PDF" button
  if (isWithholding) {
    exportBtnEl = document.createElement("button");
    exportBtnEl.id = "ch-export-btn";
    exportBtnEl.type = "button";
    exportBtnEl.className =
      "p-element btn ct-btn-group mr-1 p-button p-component ch-btn-highlight";

    const icon = document.createElement("span");
    icon.className = "p-button-icon p-button-icon-left pi pi-download";
    icon.setAttribute("aria-hidden", "true");

    const label = document.createElement("span");
    label.className = "p-button-label";
    label.textContent = getExportButtonLabel("pdf", false);

    exportBtnEl.appendChild(icon);
    exportBtnEl.appendChild(label);

    if (insertMode === "before") {
      containerNode.insertBefore(exportBtnEl, anchorEl);
    } else {
      containerNode.appendChild(exportBtnEl);
    }

    // Dispatch ch:scrape-toggle for withholding page
    exportBtnEl.addEventListener("click", (e: MouseEvent) => {
      e.stopPropagation();
      document.dispatchEvent(new CustomEvent("ch:scrape-toggle"));
    });
  } else {
    // For non-withholding pages: two buttons (XLSX + CSV)
    xlsxBtnEl = document.createElement("button");
    xlsxBtnEl.id = "ch-export-xlsx-btn";
    xlsxBtnEl.type = "button";
    xlsxBtnEl.className =
      "p-element btn ct-btn-group mr-1 p-button p-component ch-btn-highlight";

    const xlsxIcon = document.createElement("span");
    xlsxIcon.className = "p-button-icon p-button-icon-left pi pi-file-excel";
    xlsxIcon.setAttribute("aria-hidden", "true");

    const xlsxLabel = document.createElement("span");
    xlsxLabel.className = "p-button-label";
    xlsxLabel.textContent = getExportButtonLabel("xlsx", false);

    xlsxBtnEl.appendChild(xlsxIcon);
    xlsxBtnEl.appendChild(xlsxLabel);

    csvBtnEl = document.createElement("button");
    csvBtnEl.id = "ch-export-csv-btn";
    csvBtnEl.type = "button";
    csvBtnEl.className =
      "p-element btn ct-btn-group mr-1 p-button p-component ch-btn-highlight";

    const csvIcon = document.createElement("span");
    csvIcon.className = "p-button-icon p-button-icon-left pi pi-file";
    csvIcon.setAttribute("aria-hidden", "true");

    const csvLabel = document.createElement("span");
    csvLabel.className = "p-button-label";
    csvLabel.textContent = getExportButtonLabel("csv", false);

    csvBtnEl.appendChild(csvIcon);
    csvBtnEl.appendChild(csvLabel);

    // Insert both buttons
    if (insertMode === "before") {
      containerNode.insertBefore(xlsxBtnEl, anchorEl);
      containerNode.insertBefore(csvBtnEl, anchorEl);
    } else {
      containerNode.appendChild(xlsxBtnEl);
      containerNode.appendChild(csvBtnEl);
    }

    // Wire up event handlers
    xlsxBtnEl.addEventListener("click", (e: MouseEvent) => {
      e.stopPropagation();
      document.dispatchEvent(new CustomEvent("ch:export-xlsx"));
    });

    csvBtnEl.addEventListener("click", (e: MouseEvent) => {
      e.stopPropagation();
      document.dispatchEvent(new CustomEvent("ch:export-csv"));
    });

    // Add PDF Download button for efaktur pages
    const isEfaktur =
      isOutputTax || isInputTax || isOutputReturn || isInputReturn;
    if (isEfaktur) {
      pdfBtnEl = document.createElement("button");
      pdfBtnEl.id = "ch-export-pdf-btn";
      pdfBtnEl.type = "button";
      pdfBtnEl.className =
        "p-element btn ct-btn-group mr-1 p-button p-component ch-btn-highlight";

      const pdfIcon = document.createElement("span");
      pdfIcon.className = "p-button-icon p-button-icon-left pi pi-file-pdf";
      pdfIcon.setAttribute("aria-hidden", "true");

      const pdfLabel = document.createElement("span");
      pdfLabel.className = "p-button-label";
      pdfLabel.textContent = getExportButtonLabel("pdf", false);

      pdfBtnEl.appendChild(pdfIcon);
      pdfBtnEl.appendChild(pdfLabel);

      // Insert PDF button
      if (insertMode === "before") {
        containerNode.insertBefore(pdfBtnEl, anchorEl);
      } else {
        containerNode.appendChild(pdfBtnEl);
      }

      pdfBtnEl.addEventListener("click", (e: MouseEvent) => {
        e.stopPropagation();
        document.dispatchEvent(new CustomEvent("ch:export-pdf"));
      });
    }
  }
}

// ── Public API: Update Floating Info Bar ───────────────

export function updatePanelProgress(
  total: number,
  page: number,
  elapsed: string,
  status: string,
): void {
  if (!els || !statsEl) return;
  isPanelRunning = true;
  statsEl.classList.remove("ch-hidden");
  els.statTotal.textContent = total.toLocaleString("id-ID");
  els.statPages.textContent = String(page);
  els.statTime.textContent = elapsed;
  els.statusText.textContent = status;

  // Update button state based on page type
  if (isWithholdingPage()) {
    // Withholding page: update single export button
    setExportButtonState(exportBtnEl, "pdf", true);
  } else {
    // Non-withholding page: update XLSX and CSV buttons
    setExportButtonState(xlsxBtnEl, "xlsx", true);
    setExportButtonState(csvBtnEl, "csv", true);
  }

  els.progressBar.style.width = `${Math.min(95, page * 10 || 5)}%`;
}

export function updatePanelComplete(
  total: number,
  pages: number,
  elapsed: string,
  failureCount?: number,
): void {
  if (!els || !statsEl) return;
  isPanelRunning = false;
  statsEl.classList.remove("ch-hidden");
  els.statTotal.textContent = total.toLocaleString("id-ID");
  els.statPages.textContent = String(pages);
  els.statTime.textContent = elapsed;

  if (failureCount && failureCount > 0) {
    const succeeded = total - failureCount;
    els.statusText.textContent = `⚠️ ${succeeded}/${total} berhasil, ${failureCount} gagal (PDF sudah tidak tersedia)`;
  } else if (isWithholdingPage()) {
    els.statusText.textContent = `✅ ${total} PDF Berhasil`;
  } else {
    els.statusText.textContent = `✅ ${total} Data Berhasil`;
  }

  if (isWithholdingPage()) {
    // Restore single export button
    setExportButtonState(exportBtnEl, "pdf", false);
  } else {
    // Restore XLSX and CSV buttons
    setExportButtonState(xlsxBtnEl, "xlsx", false);
    setExportButtonState(csvBtnEl, "csv", false);
  }

  els.progressBar.style.width = "100%";
}

export function updatePanelError(message: string): void {
  if (!els || !statsEl) return;
  isPanelRunning = false;
  statsEl.classList.remove("ch-hidden");
  els.statusText.textContent = `❌ ${message}`;

  if (isWithholdingPage()) {
    // Restore single export button
    setExportButtonState(exportBtnEl, "pdf", false);
  } else {
    // Restore XLSX and CSV buttons
    setExportButtonState(xlsxBtnEl, "xlsx", false);
    setExportButtonState(csvBtnEl, "csv", false);
  }
}

export function updatePanelIdle(): void {
  if (!els || !statsEl) return;
  isPanelRunning = false;
  setIdlePanelContent();
  statsEl.classList.add("ch-hidden");

  if (isWithholdingPage()) {
    // Restore single export button
    setExportButtonState(exportBtnEl, "pdf", false);
  } else {
    // Restore XLSX and CSV buttons
    setExportButtonState(xlsxBtnEl, "xlsx", false);
    setExportButtonState(csvBtnEl, "csv", false);
  }
}

/** Remove elements on navigation */
export function removeExportButton(): void {
  if (exportBtnEl) {
    exportBtnEl.remove();
    exportBtnEl = null;
  }
  if (xlsxBtnEl) {
    xlsxBtnEl.remove();
    xlsxBtnEl = null;
  }
  if (csvBtnEl) {
    csvBtnEl.remove();
    csvBtnEl = null;
  }
  if (pdfBtnEl) {
    pdfBtnEl.remove();
    pdfBtnEl = null;
  }
  const container = document.getElementById("ch-floating-info-container");
  if (container) container.remove();
  els = null;
  badgeEl = null;
  statsEl = null;
  isInjected = false;
  isPanelRunning = false;
}
