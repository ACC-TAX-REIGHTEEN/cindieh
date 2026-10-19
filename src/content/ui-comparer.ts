// ============================================================
// UI-COMPARER.TS — the panel that hosts BOTH tabs
// ============================================================
// This module is the composition root of the comparison panel and
// the view of its "Bandingkan Data Penjualan" tab. The panel's other
// tab, "Pengecekan Keakuratan Nilai", lives in ui-checker.ts;
// the markup both result grids render lives in
// result-grid-view.ts; and the overlay's own behaviour — which tab
// is showing, opening, closing, Escape, handing a reference back to
// the portal — lives in ui-panel.ts.
//
// The split is a seam, not a shuffle: each tab is now buildable and
// testable without the other, and the panel's cross-tab wiring (the
// two filter menus, the Escape key, the click-outside handler) is
// the only place the two are joined.
// ============================================================

import type { ComparisonResult } from "./comparer";
import { downloadXLSXFile, downloadCSVFile, resultNumberFormats } from "./exporter";
import {
  buildComparisonExportRows,
  COMPARISON_EXPORT_BASENAME,
  RESULT_EXPORT_LABELS,
  resultExportFilename,
  type ResultExportFormat,
} from "./comparer-export";
import { comparerSheetColumns, comparisonColumns } from "./result-columns";
import { runLifecycle } from "./run-lifecycle";
import { createStatusLine } from "./status-line";
import { getPreferences } from "./preferences";
import {
  appendPagination,
  buildHeaderRow,
  buildResultRow,
  buildStatusFilterMenu,
  makeRowInteractive,
  reportResultExportFailure,
  PAGE_SIZE,
  type StatusFilterMenu,
} from "./result-grid-view";
import { checkerView } from "./ui-checker";
import {
  closePanel,
  currentGridLabel,
  RETIRED_REQUEST_NOTICE,
  scrapeForPanel,
  searchReference,
  switchTab,
} from "./ui-panel";
import {
  applyComparerDefaults,
  applyStatusFilter,
  buildStatusSummary,
  computePagination,
  createComparerSession,
  formatStatusSummary,
  prepareComparison,
  rerunComparison,
  runComparison as runSessionComparison,
  type ComparerSession,
} from "./comparer-logic";

// ── Session ───────────────────────────────────────────

const session: ComparerSession = createComparerSession();

/** The tab's status line and result grid, for the messages that name them. */
const STATUS_ID = "ch-comparer-status";

/**
 * This tab's status field.
 *
 * The promise, the summary, an error and the retirement notice all go through
 * it, so the tab has one account of what it is doing and the promise lapses
 * when anything else speaks (status-line.ts, ADR-0029).
 */
const status = createStatusLine(STATUS_ID);
const RESULTS_ID = "ch-comparer-results";
const FILTER_WRAP_ID = "ch-comparer-filter-wrap";

/** The status filter's own rows, in panel order. */
const FILTER_OPTIONS = [
  { value: "COCOK", label: "Cocok" },
  { value: "DPP_BERBEDA", label: "DPP Berbeda" },
  { value: "PPN_BERBEDA", label: "PPN Berbeda" },
  { value: "BERBEDA", label: "Berbeda" },
  { value: "TIDAK_DITEMUKAN", label: "Tidak ditemukan" },
  { value: "HANYA_CORETAX", label: "Hanya di Coretax" },
];

/**
 * The document-level handler that closes an open status-filter menu when the
 * click lands outside it. Module state so the modal can replace it instead of
 * stacking another one, and so teardown can hand the document back.
 */
let menusOutsideClickHandler: ((e: MouseEvent) => void) | null = null;

/**
 * Drop the panel's document-level click handler. Called by the master-switch
 * teardown, which removes the overlay but cannot unregister anything. Safe to
 * call when no handler is registered, and safe to call twice.
 */
export function removeMenusOutsideClickHandler(): void {
  if (!menusOutsideClickHandler) return;
  document.removeEventListener("click", menusOutsideClickHandler);
  menusOutsideClickHandler = null;
}

/**
 * Inject the panel. Both tabs are built here because both are children of the
 * one overlay; everything each tab owns itself lives in its own module.
 */
export function injectComparerModal(): void {
  if (document.getElementById("ch-comparer-modal")) return;

  const overlay = document.createElement("div");
  overlay.id = "ch-comparer-overlay";
  overlay.className = "ch-comparer-overlay";

  const modal = document.createElement("div");
  modal.id = "ch-comparer-modal";
  modal.className = "ch-comparer-modal";
  // The panel is a modal dialog: it covers the portal, traps nothing the user
  // can act on behind it, and Escape dismisses it. Saying so is what lets a
  // screen reader announce it as one and what tells assistive tech the content
  // behind the overlay is inert — the visible "×" alone communicated neither.
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  // Named after what the two tabs actually do, since the panel has no visible
  // heading to point aria-labelledby at.
  modal.setAttribute("aria-label", "Perbandingan data dan pengecekan akuratan nilai");
  // Focusable so openPanel() can move focus into the panel: Escape is handled
  // on the overlay (see below) and would otherwise never be delivered while
  // focus still sits on the portal's own button.
  modal.tabIndex = -1;

  // Header
  const header = document.createElement("div");
  header.className = "ch-comparer-header";

  const tabsContainer = document.createElement("div");
  tabsContainer.className = "ch-comparer-tabs";

  const tabCompareBtn = document.createElement("button");
  tabCompareBtn.id = "ch-tab-compare";
  tabCompareBtn.type = "button";
  tabCompareBtn.className = "ch-comparer-tab ch-comparer-tab-active";
  tabCompareBtn.textContent = "Bandingkan Data Penjualan";

  const tabCheckerBtn = document.createElement("button");
  tabCheckerBtn.id = "ch-tab-checker";
  tabCheckerBtn.type = "button";
  tabCheckerBtn.className = "ch-comparer-tab";
  tabCheckerBtn.textContent = "Pengecekan Keakuratan Nilai";

  tabsContainer.appendChild(tabCompareBtn);
  tabsContainer.appendChild(tabCheckerBtn);

  const closeBtn = document.createElement("button");
  closeBtn.className = "ch-comparer-close";
  closeBtn.textContent = "×";
  closeBtn.setAttribute("aria-label", "Tutup");

  header.appendChild(tabsContainer);
  header.appendChild(closeBtn);

  // Body
  const body = document.createElement("div");
  body.className = "ch-comparer-body";

  // ── View 1: Bandingkan Data Penjualan ─────────────────
  const viewCompare = document.createElement("div");
  viewCompare.id = "ch-comparer-view-compare";
  viewCompare.className = "ch-comparer-view";

  // Paste section (collapsible)
  const pasteSection = document.createElement("div");
  pasteSection.id = "ch-comparer-paste-section";
  pasteSection.className = "ch-comparer-paste-section";

  const pasteHeader = document.createElement("div");
  pasteHeader.className = "ch-comparer-paste-header";

  const pasteTitle = document.createElement("span");
  pasteTitle.textContent = "Data dari Excel";

  const toggleBtn = document.createElement("button");
  toggleBtn.id = "ch-comparer-toggle-btn";
  toggleBtn.type = "button";
  toggleBtn.className = "ch-comparer-toggle-btn";
  toggleBtn.title = "Tampilkan / sembunyikan area paste";
  // Icon-only (a chevron), so the title alone leaves it unnamed for a screen
  // reader.
  toggleBtn.setAttribute("aria-label", "Tampilkan / sembunyikan area paste");
  const toggleIcon = document.createElement("span");
  toggleIcon.id = "ch-comparer-toggle-icon";
  toggleIcon.className = "pi pi-chevron-up";
  toggleIcon.setAttribute("aria-hidden", "true");
  toggleBtn.appendChild(toggleIcon);

  pasteHeader.appendChild(pasteTitle);
  pasteHeader.appendChild(toggleBtn);

  const textarea = document.createElement("textarea");
  textarea.id = "ch-comparer-textarea";
  textarea.className = "ch-comparer-textarea";
  textarea.rows = 8;
  textarea.placeholder =
    "SZ-0447/07/26\tREF-001\t568.000\t62.480\nHH-0357/07/26\tREF-002\t1.481.203\t162.932\nSP-0169/07/26\tREF-003\t1.132.023\t124.523";

  pasteSection.appendChild(pasteHeader);
  pasteSection.appendChild(textarea);

  // Button row: Periksa (left) ... filter + Export Excel + CSV (right)
  const btnRow = document.createElement("div");
  btnRow.className = "ch-comparer-btn-row";

  const checkBtn = document.createElement("button");
  checkBtn.id = "ch-comparer-check-btn";
  checkBtn.className = "ch-comparer-btn ch-comparer-btn-primary";
  checkBtn.textContent = "Periksa";

  const clearBtn = document.createElement("button");
  clearBtn.id = "ch-comparer-clear-btn";
  clearBtn.className = "ch-comparer-btn ch-comparer-btn-secondary";
  clearBtn.textContent = "Hapus";

  // Tolerance input (next to Hapus)
  const toleranceInput = document.createElement("input");
  toleranceInput.id = "ch-comparer-tolerance";
  toleranceInput.type = "number";
  toleranceInput.min = "0";
  toleranceInput.step = "1";
  toleranceInput.placeholder = "Toleransi";
  toleranceInput.className = "ch-comparer-tolerance-input";
  toleranceInput.title = "Toleransi selisih DPP/PPN (default 0)";

  const leftGroup = document.createElement("div");
  leftGroup.className = "ch-comparer-btn-left";
  leftGroup.appendChild(checkBtn);
  leftGroup.appendChild(clearBtn);
  leftGroup.appendChild(toleranceInput);

  // Ref Lain checkbox
  const refLainWrap = document.createElement("div");
  refLainWrap.className = "ch-comparer-daily-wrap";

  const refLainCheckbox = document.createElement("input");
  refLainCheckbox.id = "ch-comparer-ref-lain";
  refLainCheckbox.type = "checkbox";
  refLainCheckbox.checked = true;
  refLainCheckbox.className = "ch-comparer-daily-checkbox";

  const refLainLabel = document.createElement("label");
  refLainLabel.className = "ch-comparer-daily-label";
  refLainLabel.htmlFor = "ch-comparer-ref-lain";
  refLainLabel.textContent = "Ref Lain";

  refLainWrap.appendChild(refLainCheckbox);
  refLainWrap.appendChild(refLainLabel);

  leftGroup.appendChild(refLainWrap);

  // Daily checkbox + date input
  const dailyWrap = document.createElement("div");
  dailyWrap.className = "ch-comparer-daily-wrap";

  const dailyCheckbox = document.createElement("input");
  dailyCheckbox.id = "ch-comparer-daily";
  dailyCheckbox.type = "checkbox";
  dailyCheckbox.checked = true;
  dailyCheckbox.className = "ch-comparer-daily-checkbox";

  const dailyLabel = document.createElement("label");
  dailyLabel.className = "ch-comparer-daily-label";
  dailyLabel.htmlFor = "ch-comparer-daily";
  dailyLabel.textContent = "Hari";

  dailyWrap.appendChild(dailyCheckbox);
  dailyWrap.appendChild(dailyLabel);

  const dailyDatesInput = document.createElement("input");
  dailyDatesInput.id = "ch-comparer-daily-dates";
  dailyDatesInput.type = "text";
  dailyDatesInput.className = "ch-comparer-daily-dates";
  dailyDatesInput.title = "Tanggal (1-31), pisahkan dengan koma";

  leftGroup.appendChild(dailyWrap);
  leftGroup.appendChild(dailyDatesInput);

  applyStoredComparerDefaults(toleranceInput, dailyDatesInput);

  const exportBtn = document.createElement("button");
  exportBtn.id = "ch-comparer-export-btn";
  exportBtn.className = "ch-comparer-btn ch-comparer-btn-primary";
  exportBtn.textContent = RESULT_EXPORT_LABELS.xlsx;
  exportBtn.title = "Ekspor hasil perbandingan ke file Excel";
  exportBtn.disabled = true;

  // Two plain buttons rather than a format menu: the grid export already offers
  // XLSX and CSV side by side, and a second format must not cost a dropdown's
  // open/close state on a panel that is already the largest module in the project.
  const exportCsvBtn = document.createElement("button");
  exportCsvBtn.id = "ch-comparer-export-csv-btn";
  exportCsvBtn.className = "ch-comparer-btn";
  exportCsvBtn.textContent = RESULT_EXPORT_LABELS.csv;
  exportCsvBtn.title = "Ekspor hasil perbandingan ke file CSV";
  exportCsvBtn.disabled = true;

  // Status filter dropdown (next to Export). Seeded from the session, because the
  // popup's stored filter has to survive the modal being re-injected.
  const filterMenu: StatusFilterMenu = buildStatusFilterMenu({
    idPrefix: "ch-comparer",
    options: FILTER_OPTIONS,
    selected: session.statusFilter,
    onApply: (values) => {
      session.statusFilter = values as ComparisonResult["status"][];
      session.currentPage = 1;
      renderResults();
    },
  });

  const rightGroup = document.createElement("div");
  rightGroup.className = "ch-comparer-btn-right";
  rightGroup.appendChild(filterMenu.wrap);
  rightGroup.appendChild(exportBtn);
  rightGroup.appendChild(exportCsvBtn);

  btnRow.appendChild(leftGroup);
  btnRow.appendChild(rightGroup);

  const statusMsg = document.createElement("div");
  statusMsg.id = STATUS_ID;
  statusMsg.className = "ch-comparer-status";

  const results = document.createElement("div");
  results.id = RESULTS_ID;
  results.className = "ch-comparer-results ch-hidden";

  viewCompare.appendChild(pasteSection);
  viewCompare.appendChild(btnRow);
  viewCompare.appendChild(statusMsg);
  viewCompare.appendChild(results);

  // ── View 2: Pengecekan Keakuratan Nilai ────────────
  // Built by its own module; the panel only hosts it.
  checkerView.inject();

  body.appendChild(viewCompare);
  body.appendChild(checkerView.root);

  modal.appendChild(header);
  modal.appendChild(body);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // ── Cross-tab wiring ─────────────────────────────
  // The two tabs are joined exactly here: their filter menus answer the same
  // Escape key and the same click-outside, and nothing below knows which tab a
  // control belongs to.
  const filterMenus = [filterMenu, checkerView.filterMenu].filter(
    (menu): menu is StatusFilterMenu => menu !== null,
  );

  tabCompareBtn.addEventListener("click", () => switchTab("compare"));
  tabCheckerBtn.addEventListener("click", () => switchTab("check"));

  closeBtn.addEventListener("click", closePanel);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closePanel();
  });
  // Escape closes the panel. The listener lives on the OVERLAY rather than on
  // document, so the master-switch teardown that removes the element also drops
  // the handler with it — a document-level one would outlive the panel and keep
  // swallowing a key the portal may want.
  //
  // One press does the least destructive thing available: dismiss an open
  // filter menu first, and only close the panel when there is none. Closing a
  // 300-row comparison because the user meant to close a dropdown would be a
  // harsh reading of the same gesture.
  overlay.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const openMenu = filterMenus.find((menu) => !menu.menu.classList.contains("ch-hidden"));
    if (openMenu) {
      e.stopPropagation();
      openMenu.close();
      return;
    }
    closePanel();
  });

  // Click outside a filter menu closes it. Registered through a tracked
  // handler rather than inline: `document` outlives the panel, so a handler
  // left behind by the master-switch teardown would keep running on every page
  // click and a rebuilt modal would stack a second one beside it.
  removeMenusOutsideClickHandler();
  menusOutsideClickHandler = (e: MouseEvent) => {
    for (const menu of filterMenus) {
      if (!menu.wrap.contains(e.target as Node)) menu.close();
    }
  };
  document.addEventListener("click", menusOutsideClickHandler);

  // ── View 1 event wiring ─────────────────────────

  checkBtn.addEventListener("click", handleCheck);

  clearBtn.addEventListener("click", () => {
    textarea.value = "";
    session.results = [];
    session.currentPage = 1;
    session.viewedRefs.clear();
    runLifecycle.cancelPending("compare");
    exportBtn.disabled = true;
    exportCsvBtn.disabled = true;
    textarea.classList.remove("ch-hidden");
    const icon = document.getElementById("ch-comparer-toggle-icon");
    if (icon) icon.className = "pi pi-chevron-up";
    results.classList.add("ch-hidden");
    results.innerHTML = "";
    status.clear();
    const wrap = document.getElementById(FILTER_WRAP_ID);
    if (wrap) wrap.classList.add("ch-hidden");
  });

  exportBtn.addEventListener("click", () => handleExportResults("xlsx"));
  exportCsvBtn.addEventListener("click", () => handleExportResults("csv"));

  toleranceInput.addEventListener("change", () => {
    const val = parseInt(toleranceInput.value, 10);
    session.tolerance = isNaN(val) || val < 0 ? 0 : val;
    rerunFromTextarea();
  });

  refLainCheckbox.addEventListener("change", () => {
    session.refLainEnabled = refLainCheckbox.checked;
    rerunFromTextarea();
  });

  dailyCheckbox.addEventListener("change", () => {
    session.dailyEnabled = dailyCheckbox.checked;
    dailyDatesInput.classList.toggle("ch-hidden", !session.dailyEnabled);
    rerunFromTextarea();
  });

  dailyDatesInput.addEventListener("change", () => {
    rerunFromTextarea();
  });

  toggleBtn.addEventListener("click", () => {
    const isHidden = textarea.classList.contains("ch-hidden");
    textarea.classList.toggle("ch-hidden", !isHidden);
    toggleIcon.className = isHidden ? "pi pi-chevron-up" : "pi pi-chevron-down";
  });

  textarea.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleCheck();
    }
  });
}

// ── Stored defaults ───────────────────────────────────

/**
 * Apply the popup's Comparer defaults to the session and the two inputs that
 * mirror it. Called while the modal is being built, because the panel owns these
 * controls per session and re-injecting the modal must not lose them.
 */
function applyStoredComparerDefaults(
  toleranceInput: HTMLInputElement,
  dailyDatesInput: HTMLInputElement,
): void {
  const defaults = getPreferences().comparerDefaults;
  applyComparerDefaults(session, defaults);
  // An empty box, not "0": the panel shows the tolerance as an optional value.
  toleranceInput.value = session.tolerance > 0 ? String(session.tolerance) : "";
  dailyDatesInput.value = defaults.dailyDates;
  dailyDatesInput.classList.toggle("ch-hidden", !session.dailyEnabled);
}

// ── Check handlers ────────────────────────────────────

function handleCheck(): void {
  const textarea = document.getElementById("ch-comparer-textarea") as HTMLTextAreaElement;
  const datesInput = document.getElementById("ch-comparer-daily-dates") as HTMLInputElement;
  const textareaValue = textarea ? textarea.value : "";
  const datesValue = datesInput ? datesInput.value : "";
  const scrapedData = runLifecycle.result()?.data ?? null;

  const decision = prepareComparison(session, textareaValue, scrapedData, datesValue);

  runLifecycle.cancelPending("compare");
  if (decision.action === "error") {
    renderComparisonError(decision.message);
    return;
  }

  if (decision.action === "needScrape") {
    renderResults();
    // The line remembers this as the promise it is making, so a retirement can
    // take it back (dropPendingCompare). A detached tab has nowhere to say any
    // of this, so it does not start a scrape it could never report on.
    const shown = status.set(
      "waiting",
      `Belum ada data. Mohon tunggu, sedang melakukan scraping data ${currentGridLabel()} terlebih dahulu...`,
    );
    if (!shown) return;
    runLifecycle.request({ kind: "compare" });
    scrapeForPanel();
    return;
  }

  runSessionComparison(session, decision.pastedRows, decision.scrapedData);
  renderAfterComparison();
}

function rerunFromTextarea(): void {
  if (session.results.length === 0) return;
  runPendingCompare();
}

/** Re-run the comparison a finished Run owed it — main.ts calls this. */
export function runPendingCompare(): void {
  const textarea = document.getElementById("ch-comparer-textarea") as HTMLTextAreaElement;
  const datesInput = document.getElementById("ch-comparer-daily-dates") as HTMLInputElement;
  const result = rerunComparison(
    session, textarea ? textarea.value : "", runLifecycle.result()?.data ?? null,
    datesInput ? datesInput.value : "",
  );
  if (result.action === "error") {
    renderComparisonError(result.message);
  } else {
    renderAfterComparison();
  }
}

/**
 * The comparison this tab queued was retired — a stop, a failure, a lost chunk
 * or a reset — so the line promising it is replaced with the one line saying why
 * the result will not arrive.
 *
 * Nothing else moves: the pasted rows stay, so running it again is one click.
 * The badge carries the stop's own account, and this says only what the tab can
 * know — a blank line read as "nothing was asked for", while a second full
 * explanation would have been two accounts of one event (ADR-0026). The line's
 * own kind is the guard: it replaces a promise and nothing else, so a summary or
 * an error written since — the tab's real output — is out of its reach.
 */
export function dropPendingCompare(): void {
  status.replace("waiting", { kind: "notice", text: RETIRED_REQUEST_NOTICE });
}

function renderComparisonError(message: string): void {
  renderResults();
  status.set("error", message);
  document.getElementById("ch-comparer-textarea")?.classList.remove("ch-hidden");
  const toggleIcon = document.getElementById("ch-comparer-toggle-icon");
  if (toggleIcon) toggleIcon.className = "pi pi-chevron-up";
}

// ── Render results table ──────────────────────────────

function renderAfterComparison(): void {
  renderResults();
  status.set("summary", formatStatusSummary(buildStatusSummary(session.results)));

  const textareaEl = document.getElementById("ch-comparer-textarea") as HTMLTextAreaElement;
  const toggleIcon = document.getElementById("ch-comparer-toggle-icon");
  if (textareaEl) textareaEl.classList.add("ch-hidden");
  if (toggleIcon) toggleIcon.className = "pi pi-chevron-down";
}

function renderResults(): void {
  const exportBtn = document.getElementById("ch-comparer-export-btn") as HTMLButtonElement;
  if (exportBtn) exportBtn.disabled = session.results.length === 0;
  // Both format buttons gate on the same thing — a grid with no results exports
  // nothing in either format, so leaving one enabled would promise a file.
  const exportCsvBtn = document.getElementById("ch-comparer-export-csv-btn") as HTMLButtonElement;
  if (exportCsvBtn) exportCsvBtn.disabled = session.results.length === 0;
  const container = document.getElementById(RESULTS_ID);
  if (!container) return;

  container.classList.remove("ch-hidden");
  container.innerHTML = "";

  const filterWrap = document.getElementById(FILTER_WRAP_ID);
  if (filterWrap) filterWrap.classList.toggle("ch-hidden", session.results.length === 0);

  if (session.results.length === 0) {
    container.classList.add("ch-hidden");
    return;
  }

  const filtered = applyStatusFilter(session.results, session.statusFilter);
  const { totalPages, currentPage: clampedPage, startIndex, pageRows } =
    computePagination(filtered, PAGE_SIZE, session.currentPage);
  session.currentPage = clampedPage;

  const columns = comparisonColumns(session.refLainEnabled);

  const table = document.createElement("table");
  table.className = "ch-comparer-table";
  // The grid has no visible caption, so the table is named for assistive tech.
  table.setAttribute("aria-label", "Hasil perbandingan data penjualan");
  table.appendChild(buildHeaderRow(columns));

  const tbody = document.createElement("tbody");
  pageRows.forEach((r, idx) => {
    const tr = buildResultRow(columns, r, startIndex, idx);
    if (session.viewedRefs.has(r.reference)) {
      tr.classList.add("ch-comparer-row-viewed");
    }

    const isNotFound = r.status === "TIDAK_DITEMUKAN";
    makeRowInteractive(
      tr,
      isNotFound
        ? "Klik 1x untuk melihat teks lengkap"
        : "Klik 1x untuk melihat teks lengkap, klik 2x untuk mencari di Coretax",
    );

    if (!isNotFound) {
      tr.addEventListener("dblclick", () => {
        session.viewedRefs.add(r.reference);
        renderResults();
        searchReference(r.reference);
      });
    }

    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);

  if (totalPages > 1) {
    appendPagination(container, session.currentPage, totalPages, (page) => {
      session.currentPage = page;
      renderResults();
    });
  }
}

// ── Export results ────────────────────────────────────

function handleExportResults(format: ResultExportFormat): void {
  const container = document.getElementById(RESULTS_ID);
  if (!container || container.classList.contains("ch-hidden")) return;

  if (session.results.length === 0) return;

  const rows = buildComparisonExportRows(session.results, session.refLainEnabled);
  const filename = resultExportFilename(COMPARISON_EXPORT_BASENAME, format);
  // CSV is hand-rolled and synchronous: no chunk load, so no failure to report.
  if (format === "csv") {
    downloadCSVFile(rows, filename);
    return;
  }
  // The amount columns' positions come from the same schema the rows do, so a
  // new sheet-only column cannot shift the formats one column left.
  void downloadXLSXFile(rows, filename, "Perbandingan", {
    numberFormats: resultNumberFormats(comparerSheetColumns(session.refLainEnabled)),
  }).catch((err: unknown) => reportResultExportFailure(err, status));
}