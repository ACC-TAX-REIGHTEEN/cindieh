// ============================================================
// UI-FILTERS.TS — Grid, toolbar, and multi-invoice filters
// ============================================================
// Injects filter inputs into table headers (grid filter) and
// the toolbar (toolbar filter) on the PPN Keluaran page, plus
// the No. Faktur (multi-invoice) filter on every efaktur page.
// ============================================================

import { hasReferenceFilter, isEfakturPage } from "./page-context";
import { createInjectionLoop } from "./injection-readiness";

const TOOLBAR_FILTER_WIDTH = "180px";

/**
 * Finds column index by text.
 */
function findColumnIndex(headerRow: HTMLTableRowElement, searchTexts: string[]): number {
  const ths = Array.from(headerRow.querySelectorAll("th"));
  return ths.findIndex((th) => {
    const text = th.textContent?.trim().toLowerCase() || "";
    return searchTexts.some((s) => text.includes(s.toLowerCase()));
  });
}

/**
 * Inject filter inputs into the table header.
 *
 * Offered wherever the grid carries a Referensi column, so PPN Masukan gets it
 * too: a lookup there works, it just may return several rows that share the
 * seller's reference.
 */
export function injectGridFilters(): void {
  if (!hasReferenceFilter()) return;
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

  const group = document.createElement("div");
  group.className = "p-inputgroup";

  const addon = document.createElement("span");
  addon.className = "p-inputgroup-addon ch-filter-addon";
  addon.style.display = "flex";
  addon.style.alignItems = "center";
  const icon = document.createElement("i");
  icon.className = "pi pi-search";
  addon.appendChild(icon);

  const input = document.createElement("input");
  input.type = "text";
  input.id = "ch-grid-filter-reference";
  input.className = "p-inputtext p-component ch-filter-input";
  input.placeholder = "Cari Referensi...";
  input.style.width = "100%";

  group.appendChild(addon);
  group.appendChild(input);

  const fluidWrapper = document.createElement("div");
  fluidWrapper.className = "p-fluid";
  fluidWrapper.appendChild(group);
  filterWrapper.appendChild(fluidWrapper);
  container.appendChild(filterWrapper);

  while (refCell.firstChild) refCell.removeChild(refCell.firstChild);
  refCell.appendChild(container);
}

/**
 * One round of the toolbar search box: its guards, its anchor lookup, its
 * paint. The answer it gives is the readiness question the loop owns — `false`
 * means the portal has not rendered the anchor yet.
 */
function attemptToolbarFilter(): boolean {
  if (!hasReferenceFilter()) return true;
  if (document.getElementById("ch-toolbar-filter-reference")) return true;

  const buttons = Array.from(document.querySelectorAll("button"));
  let anchor =
    buttons.find((b) => b.getAttribute("ptooltip") === "Setel Ulang Filter") ||
    buttons.find((b) => b.querySelector(".pi-filter-slash")) ||
    buttons.find(
      (b) =>
        (b.className.includes("ct-ovw-btn-mini-cancel") || b.className.includes("ct-ovw-btn-mini")) &&
        (b.querySelector(".pi-filter-slash") || b.querySelector(".pi-refresh")),
    );

  if (!anchor) return false;

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
  addon.className = "p-inputgroup-addon ch-filter-addon";
  addon.style.display = "flex";
  addon.style.alignItems = "center";
  const icon = document.createElement("i");
  icon.className = "pi pi-search";
  addon.appendChild(icon);

  const input = document.createElement("input");
  input.type = "text";
  input.id = "ch-toolbar-filter-reference";
  input.className = "p-inputtext p-component ch-filter-input";
  input.placeholder = "Cari Referensi...";
  input.style.width = TOOLBAR_FILTER_WIDTH;

  group.appendChild(addon);
  group.appendChild(input);
  container.appendChild(group);

  anchor.insertAdjacentElement("afterend", container);
  return true;
}

/** Inject filter input into the toolbar. */
export const injectToolbarFilter = createInjectionLoop(attemptToolbarFilter);

// ── Multi-Invoice Filter State ────────────────────────

let multiInvoiceTextarea: HTMLTextAreaElement | null = null;
let multiInvoicePanel: HTMLElement | null = null;
let multiInvoiceToggle: HTMLButtonElement | null = null;

// Track window/document listeners so cleanup can unregister them — otherwise
// repeated injection (SPA re-renders) would stack duplicate handlers.
let onMultiInvoiceDocClick: ((e: MouseEvent) => void) | null = null;
let onMultiInvoiceWinScroll: (() => void) | null = null;
let onMultiInvoiceWinResize: (() => void) | null = null;

/** Split a multi-invoice textarea value into trimmed, non-empty numbers. */
export function splitInvoiceNumbers(raw: string): string[] {
  return raw
    .split(/[\n;,]+|\s{2,}/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Parse the raw textarea value into invoice numbers (pure; no DOM).
 * Trims the whole input first and returns [] when nothing usable remains.
 */
export function parseMultiInvoiceText(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  return splitInvoiceNumbers(trimmed);
}

/** Get parsed invoice numbers from the multi-invoice filter */
export function getMultiInvoiceNumbers(): string[] {
  if (!multiInvoiceTextarea) return [];
  return parseMultiInvoiceText(multiInvoiceTextarea.value);
}

/**
 * Remove the multi-invoice filter toggle and panel from the DOM, unregister
 * its window/document listeners, and reset module state. Used when leaving an
 * efaktur page so stale invoice numbers cannot leak into exports on other
 * pages (e.g. withholding slips), and before re-injecting after a re-render.
 */
export function removeMultiInvoiceFilter(): void {
  if (onMultiInvoiceDocClick) {
    document.removeEventListener("click", onMultiInvoiceDocClick);
    onMultiInvoiceDocClick = null;
  }
  if (onMultiInvoiceWinScroll) {
    window.removeEventListener("scroll", onMultiInvoiceWinScroll);
    onMultiInvoiceWinScroll = null;
  }
  if (onMultiInvoiceWinResize) {
    window.removeEventListener("resize", onMultiInvoiceWinResize);
    onMultiInvoiceWinResize = null;
  }
  multiInvoiceToggle?.remove();
  multiInvoicePanel?.remove();
  multiInvoiceToggle = null;
  multiInvoicePanel = null;
  multiInvoiceTextarea = null;
}

/**
 * One round of the No. Faktur toggle: its page guard, its stale-half teardown,
 * its anchor lookup, its build. `false` means the portal has not rendered the
 * anchor yet.
 */
function attemptMultiInvoiceFilter(): boolean {
  // The No. Faktur filter belongs to efaktur pages only (PPN Keluaran,
  // PPN Masukan, Retur). On any other supported page — e.g. withholding
  // slips — tear down any leftover UI/state from a previous efaktur visit.
  if (!isEfakturPage()) {
    removeMultiInvoiceFilter();
    return true;
  }

  // The panel lives in <body> and survives Angular re-renders, while the
  // toggle sits inside the rendered page content. If either half is missing
  // (SPA navigation between efaktur pages, or a grid re-render), tear the
  // stale half down so both get re-injected together below.
  const hasToggle = !!document.getElementById("ch-multi-invoice-toggle");
  const hasPanel = !!document.getElementById("ch-multi-invoice-filter");
  if (!hasToggle || !hasPanel) {
    removeMultiInvoiceFilter();
  }
  if (hasToggle && hasPanel) return true;

  const anchor =
    document.getElementById("ch-toolbar-filter-container") ||
    Array.from(document.querySelectorAll("button")).find(
      (b) => b.getAttribute("ptooltip") === "Setel Ulang Filter" || !!b.querySelector(".pi-filter-slash"),
    );

  if (!anchor) return false;

  const toggleBtn = document.createElement("button");
  toggleBtn.id = "ch-multi-invoice-toggle";
  toggleBtn.type = "button";
  toggleBtn.className = "ch-multi-invoice-toggle";
  toggleBtn.title = "Filter berdasarkan No. Faktur (multi)";
  toggleBtn.style.marginLeft = "8px";
  multiInvoiceToggle = toggleBtn;
  const toggleIcon = document.createElement("i");
  toggleIcon.className = "pi pi-filter";
  toggleIcon.setAttribute("aria-hidden", "true");
  toggleIcon.style.marginRight = "4px";
  toggleBtn.appendChild(toggleIcon);
  toggleBtn.appendChild(document.createTextNode("No. Faktur"));

  multiInvoicePanel = document.createElement("div");
  multiInvoicePanel.id = "ch-multi-invoice-filter";
  multiInvoicePanel.className = "ch-multi-invoice-panel";

  const label = document.createElement("label");
  label.htmlFor = "ch-multi-invoice-textarea";
  label.textContent = "No. Faktur (satu per baris / koma / titik koma):";

  multiInvoiceTextarea = document.createElement("textarea");
  multiInvoiceTextarea.id = "ch-multi-invoice-textarea";
  multiInvoiceTextarea.className = "ch-multi-invoice-textarea";
  multiInvoiceTextarea.rows = 5;
  multiInvoiceTextarea.placeholder = "04012600023333322\n04012600023333323\n...";

  const countHint = document.createElement("div");
  countHint.id = "ch-multi-invoice-count";
  countHint.className = "ch-multi-invoice-count";

  multiInvoiceTextarea.addEventListener("input", () => {
    const nums = getMultiInvoiceNumbers();
    countHint.textContent = nums.length > 0 ? `${nums.length} nomor faktur terdeteksi` : "";
  });

  multiInvoicePanel.appendChild(label);
  multiInvoicePanel.appendChild(multiInvoiceTextarea);
  multiInvoicePanel.appendChild(countHint);

  toggleBtn.addEventListener("click", (e: MouseEvent) => {
    e.stopPropagation();
    if (!multiInvoicePanel) return;
    // The panel's stylesheet hides it by default (display: none). Only inline
    // `display: block` counts as open, so the first click always shows it.
    const isVisible = multiInvoicePanel.style.display === "block";
    if (isVisible) {
      multiInvoicePanel.style.display = "none";
    } else {
      // Position the panel below the toggle button with absolute page
      // coordinates (the stylesheet uses position: absolute) so we never need
      // to mutate the parent element's CSS position.
      const rect = toggleBtn.getBoundingClientRect();
      multiInvoicePanel.style.top = `${rect.bottom + window.scrollY + 4}px`;
      multiInvoicePanel.style.left = `${rect.left + window.scrollX}px`;
      multiInvoicePanel.style.display = "block";
    }
  });

  const handleDocClick = (e: MouseEvent): void => {
    if (!multiInvoicePanel || !multiInvoiceToggle) return;
    const target = e.target as HTMLElement;
    if (
      multiInvoicePanel.style.display !== "none" &&
      !multiInvoicePanel.contains(target) &&
      !multiInvoiceToggle.contains(target)
    ) {
      multiInvoicePanel.style.display = "none";
    }
  };

  // Reposition on scroll/resize so panel tracks the button. "Open" is inline
  // `display: block` and nothing else — the panel starts hidden in the
  // stylesheet, so a closed one reads `""` and must be left alone (only the
  // toggle-click handler below sets the inline styles that mean open).
  const handleWinScroll = (): void => {
    if (!multiInvoicePanel || !multiInvoiceToggle || multiInvoicePanel.style.display !== "block") return;
    const rect = multiInvoiceToggle.getBoundingClientRect();
    multiInvoicePanel.style.top = `${rect.bottom + window.scrollY + 4}px`;
    multiInvoicePanel.style.left = `${rect.left + window.scrollX}px`;
  };

  const handleWinResize = (): void => {
    if (!multiInvoicePanel || !multiInvoiceToggle || multiInvoicePanel.style.display !== "block") return;
    const rect = multiInvoiceToggle.getBoundingClientRect();
    multiInvoicePanel.style.top = `${rect.bottom + window.scrollY + 4}px`;
    multiInvoicePanel.style.left = `${rect.left + window.scrollX}px`;
  };

  onMultiInvoiceDocClick = handleDocClick;
  onMultiInvoiceWinScroll = handleWinScroll;
  onMultiInvoiceWinResize = handleWinResize;
  document.addEventListener("click", handleDocClick);
  window.addEventListener("scroll", handleWinScroll, { passive: true });
  window.addEventListener("resize", handleWinResize, { passive: true });

  const parent = anchor.parentElement;
  if (!parent) return true;

  // Insert the toggle button next to the anchor
  parent.insertBefore(toggleBtn, anchor.nextSibling);

  // Append the panel directly to body — no position mutation on Coretax elements
  document.body.appendChild(multiInvoicePanel);
  return true;
}

/** Inject the No. Faktur (multi-invoice) toggle, retrying until the portal renders its anchor. */
export const injectMultiInvoiceFilter = createInjectionLoop(attemptMultiInvoiceFilter);
