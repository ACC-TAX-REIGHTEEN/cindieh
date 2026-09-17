// ============================================================
// UI-COMPARER.TS — Modal for paste & compare & accuracy check
// ============================================================
// Thin view over a ComparerSession (comparer-logic.ts) and
// CheckerSession (checker-logic.ts): builds the modal DOM with
// tab navigation, wires events, and renders session state.
// ============================================================

import type { ComparisonResult } from "./comparer";
import { downloadXLSXFile, RESULT_NUMBER_FORMAT, RESULT_DIFFERENCE_FORMAT } from "./exporter";
import {
  buildComparisonExportRows,
  buildCheckerExportRows,
  formatResultNumber,
  formatResultDifference,
} from "./comparer-export";
import { contentState, startScrape } from "./main-actions";
import { isOutputTaxPage } from "./page-context";
import {
  applyStatusFilter,
  buildStatusSummary,
  computePagination,
  createComparerSession,
  formatStatusSummary,
  getStatusLabel,
  prepareComparison,
  rerunComparison,
  runComparison as runSessionComparison,
  type ComparerSession,
} from "./comparer-logic";
import {
  applyCheckerStatusFilter,
  checkAllRowsAccuracy,
  createCheckerSession,
  formatCheckSummary,
  type BenchmarkType,
  type CheckerSession,
} from "./checker-logic";

const PAGE_SIZE = 10;

// ── Sessions ───────────────────────────────────────────

const session: ComparerSession = createComparerSession();
const checkerSession: CheckerSession = createCheckerSession();

// ── Switch Tabs ───────────────────────────────────────

function switchTab(tab: "compare" | "check"): void {

  const tabCompareBtn = document.getElementById("ch-tab-compare");
  const tabCheckerBtn = document.getElementById("ch-tab-checker");
  const viewCompare = document.getElementById("ch-comparer-view-compare");
  const viewChecker = document.getElementById("ch-comparer-view-checker");

  if (tabCompareBtn && tabCheckerBtn && viewCompare && viewChecker) {
    if (tab === "compare") {
      tabCompareBtn.classList.add("ch-comparer-tab-active");
      tabCheckerBtn.classList.remove("ch-comparer-tab-active");
      viewCompare.classList.remove("ch-hidden");
      viewChecker.classList.add("ch-hidden");
    } else {
      tabCheckerBtn.classList.add("ch-comparer-tab-active");
      tabCompareBtn.classList.remove("ch-comparer-tab-active");
      viewChecker.classList.remove("ch-hidden");
      viewCompare.classList.add("ch-hidden");
    }
  }
}

// ── Inject the comparer modal ──────────────────────────

export function injectComparerModal(): void {
  if (document.getElementById("ch-comparer-modal")) return;

  const overlay = document.createElement("div");
  overlay.id = "ch-comparer-overlay";
  overlay.className = "ch-comparer-overlay";

  const modal = document.createElement("div");
  modal.id = "ch-comparer-modal";
  modal.className = "ch-comparer-modal";

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

  // Button row: Periksa (left) ... Ekspor Hasil XLSX (right)
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

  const exportBtn = document.createElement("button");
  exportBtn.id = "ch-comparer-export-btn";
  exportBtn.className = "ch-comparer-btn ch-comparer-btn-primary";
  exportBtn.textContent = "Export XLSX";
  exportBtn.title = "Ekspor hasil perbandingan ke file Excel";
  exportBtn.disabled = true;

  // Status filter dropdown (next to Export) — custom dropdown with checkboxes
  const filterOptions: { value: string; label: string }[] = [
    { value: "ALL", label: "Semua Status" },
    { value: "COCOK", label: "Cocok" },
    { value: "DPP_BERBEDA", label: "DPP Berbeda" },
    { value: "PPN_BERBEDA", label: "PPN Berbeda" },
    { value: "BERBEDA", label: "Berbeda" },
    { value: "TIDAK_DITEMUKAN", label: "Tidak ditemukan" },
    { value: "HANYA_CORETAX", label: "Hanya di Coretax" },
  ];

  const filterWrap = document.createElement("div");
  filterWrap.id = "ch-comparer-filter-wrap";
  filterWrap.className = "ch-comparer-filter-wrap";

  const filterToggle = document.createElement("button");
  filterToggle.type = "button";
  filterToggle.id = "ch-comparer-filter-toggle";
  filterToggle.className = "ch-comparer-filter-toggle";
  filterToggle.title = "Filter berdasarkan status";

  const filterToggleLabel = document.createElement("span");
  filterToggleLabel.className = "ch-comparer-filter-toggle-label";
  filterToggleLabel.textContent = "Semua Status";

  const filterToggleIcon = document.createElement("span");
  filterToggleIcon.className = "pi pi-chevron-down";
  filterToggleIcon.setAttribute("aria-hidden", "true");

  filterToggle.appendChild(filterToggleLabel);
  filterToggle.appendChild(filterToggleIcon);

  const filterMenu = document.createElement("div");
  filterMenu.id = "ch-comparer-filter-menu";
  filterMenu.className = "ch-comparer-filter-menu ch-hidden";

  const filterCheckboxes: HTMLInputElement[] = [];
  for (const opt of filterOptions) {
    const item = document.createElement("label");
    item.className = "ch-comparer-filter-item";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = opt.value;
    if (opt.value === "ALL") cb.checked = true;
    filterCheckboxes.push(cb);

    const span = document.createElement("span");
    span.textContent = opt.label;

    item.appendChild(cb);
    item.appendChild(span);
    filterMenu.appendChild(item);
  }

  filterWrap.appendChild(filterToggle);
  filterWrap.appendChild(filterMenu);
  filterWrap.classList.add("ch-hidden");

  const rightGroup = document.createElement("div");
  rightGroup.className = "ch-comparer-btn-right";
  rightGroup.appendChild(filterWrap);
  rightGroup.appendChild(exportBtn);

  btnRow.appendChild(leftGroup);
  btnRow.appendChild(rightGroup);

  const statusMsg = document.createElement("div");
  statusMsg.id = "ch-comparer-status";
  statusMsg.className = "ch-comparer-status";

  const results = document.createElement("div");
  results.id = "ch-comparer-results";
  results.className = "ch-comparer-results ch-hidden";

  viewCompare.appendChild(pasteSection);
  viewCompare.appendChild(btnRow);
  viewCompare.appendChild(statusMsg);
  viewCompare.appendChild(results);

  // ── View 2: Pengecekan Keakuratan Nilai ────────────────
  const viewChecker = document.createElement("div");
  viewChecker.id = "ch-comparer-view-checker";
  viewChecker.className = "ch-comparer-view ch-hidden";

  const checkerBtnRow = document.createElement("div");
  checkerBtnRow.className = "ch-comparer-btn-row";

  const checkerCheckBtn = document.createElement("button");
  checkerCheckBtn.id = "ch-checker-check-btn";
  checkerCheckBtn.className = "ch-comparer-btn ch-comparer-btn-primary";
  checkerCheckBtn.textContent = "Periksa";

  const benchmarkWrap = document.createElement("div");
  benchmarkWrap.className = "ch-checker-benchmark-wrap";

  const benchmarkLabel = document.createElement("label");
  benchmarkLabel.className = "ch-checker-benchmark-label";
  benchmarkLabel.htmlFor = "ch-checker-benchmark-select";
  benchmarkLabel.textContent = "Acuan:";

  const benchmarkSelect = document.createElement("select");
  benchmarkSelect.id = "ch-checker-benchmark-select";
  benchmarkSelect.className = "ch-checker-benchmark-select";

  const optDpp = document.createElement("option");
  optDpp.value = "DPP";
  optDpp.textContent = "DPP";

  const optNilaiLain = document.createElement("option");
  optNilaiLain.value = "DPP_NILAI_LAIN";
  optNilaiLain.textContent = "DPP NL";

  const optPpn = document.createElement("option");
  optPpn.value = "PPN";
  optPpn.textContent = "PPN";

  benchmarkSelect.appendChild(optDpp);
  benchmarkSelect.appendChild(optNilaiLain);
  benchmarkSelect.appendChild(optPpn);

  benchmarkWrap.appendChild(benchmarkLabel);
  benchmarkWrap.appendChild(benchmarkSelect);

  const checkerToleranceInput = document.createElement("input");
  checkerToleranceInput.id = "ch-checker-tolerance";
  checkerToleranceInput.type = "number";
  checkerToleranceInput.min = "0";
  checkerToleranceInput.step = "1";
  checkerToleranceInput.placeholder = "Toleransi";
  checkerToleranceInput.className = "ch-comparer-tolerance-input";
  checkerToleranceInput.title = "Toleransi selisih parameter yang tidak perlu ditampilkan (default 0)";

  const checkerLeftGroup = document.createElement("div");
  checkerLeftGroup.className = "ch-comparer-btn-left";
  checkerLeftGroup.appendChild(checkerCheckBtn);
  checkerLeftGroup.appendChild(benchmarkWrap);
  checkerLeftGroup.appendChild(checkerToleranceInput);

  const checkerExportBtn = document.createElement("button");
  checkerExportBtn.id = "ch-checker-export-btn";
  checkerExportBtn.className = "ch-comparer-btn ch-comparer-btn-primary";
  checkerExportBtn.textContent = "Export XLSX";
  checkerExportBtn.title = "Ekspor hasil pengecekan ke file Excel";

  // Status filter dropdown for Pengecekan
  const checkerFilterOptions: { value: string; label: string }[] = [
    { value: "ALL", label: "Semua Status" },
    { value: "DPP_BERBEDA", label: "DPP Berbeda" },
    { value: "DPP_NILAI_LAIN_BERBEDA", label: "DPP NL Berbeda" },
    { value: "PPN_BERBEDA", label: "PPN Berbeda" },
    { value: "DUA_BERBEDA", label: "Dua Nilai Berbeda" },
    { value: "DATA_TIDAK_LENGKAP", label: "Data tidak lengkap" },
  ];

  const checkerFilterWrap = document.createElement("div");
  checkerFilterWrap.id = "ch-checker-filter-wrap";
  checkerFilterWrap.className = "ch-comparer-filter-wrap ch-hidden";

  const checkerFilterToggle = document.createElement("button");
  checkerFilterToggle.type = "button";
  checkerFilterToggle.id = "ch-checker-filter-toggle";
  checkerFilterToggle.className = "ch-comparer-filter-toggle";
  checkerFilterToggle.title = "Filter berdasarkan status";

  const checkerFilterToggleLabel = document.createElement("span");
  checkerFilterToggleLabel.className = "ch-comparer-filter-toggle-label";
  checkerFilterToggleLabel.textContent = "Semua Status";

  const checkerFilterToggleIcon = document.createElement("span");
  checkerFilterToggleIcon.className = "pi pi-chevron-down";
  checkerFilterToggleIcon.setAttribute("aria-hidden", "true");

  checkerFilterToggle.appendChild(checkerFilterToggleLabel);
  checkerFilterToggle.appendChild(checkerFilterToggleIcon);

  const checkerFilterMenu = document.createElement("div");
  checkerFilterMenu.id = "ch-checker-filter-menu";
  checkerFilterMenu.className = "ch-comparer-filter-menu ch-hidden";

  const checkerFilterCheckboxes: HTMLInputElement[] = [];
  for (const opt of checkerFilterOptions) {
    const item = document.createElement("label");
    item.className = "ch-comparer-filter-item";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = opt.value;
    if (opt.value === "ALL") cb.checked = true;
    checkerFilterCheckboxes.push(cb);

    const span = document.createElement("span");
    span.textContent = opt.label;

    item.appendChild(cb);
    item.appendChild(span);
    checkerFilterMenu.appendChild(item);
  }

  checkerFilterWrap.appendChild(checkerFilterToggle);
  checkerFilterWrap.appendChild(checkerFilterMenu);

  const checkerRightGroup = document.createElement("div");
  checkerRightGroup.className = "ch-comparer-btn-right";
  checkerRightGroup.appendChild(checkerFilterWrap);
  checkerRightGroup.appendChild(checkerExportBtn);

  checkerBtnRow.appendChild(checkerLeftGroup);
  checkerBtnRow.appendChild(checkerRightGroup);

  const checkerStatusMsg = document.createElement("div");
  checkerStatusMsg.id = "ch-checker-status";
  checkerStatusMsg.className = "ch-comparer-status";

  const checkerResults = document.createElement("div");
  checkerResults.id = "ch-checker-results";
  checkerResults.className = "ch-comparer-results ch-hidden";

  viewChecker.appendChild(checkerBtnRow);
  viewChecker.appendChild(checkerStatusMsg);
  viewChecker.appendChild(checkerResults);

  body.appendChild(viewCompare);
  body.appendChild(viewChecker);

  modal.appendChild(header);
  modal.appendChild(body);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // ── Event wiring ──────────────────────────────────

  tabCompareBtn.addEventListener("click", () => switchTab("compare"));
  tabCheckerBtn.addEventListener("click", () => switchTab("check"));

  closeBtn.addEventListener("click", closeComparerModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeComparerModal();
  });

  checkBtn.addEventListener("click", handleCheck);

  clearBtn.addEventListener("click", () => {
    textarea.value = "";
    session.results = [];
    session.currentPage = 1;
    session.viewedRefs.clear();
    contentState.pendingCompare = false;
    exportBtn.disabled = true;
    textarea.classList.remove("ch-hidden");
    const toggleIcon = document.getElementById("ch-comparer-toggle-icon");
    if (toggleIcon) toggleIcon.className = "pi pi-chevron-up";
    results.classList.add("ch-hidden");
    results.innerHTML = "";
    statusMsg.textContent = "";
    statusMsg.className = "ch-comparer-status";
    const filterWrap = document.getElementById("ch-comparer-filter-wrap");
    if (filterWrap) filterWrap.classList.add("ch-hidden");
  });

  exportBtn.addEventListener("click", handleExportResults);

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

  const applyFilter = () => {
    const checked = filterCheckboxes.filter((cb) => cb.checked).map((cb) => cb.value);
    if (checked.includes("ALL")) {
      session.statusFilter = [];
      filterToggleLabel.textContent = "Semua Status";
    } else if (checked.length === 0) {
      session.statusFilter = [];
      filterToggleLabel.textContent = "Semua Status";
    } else {
      session.statusFilter = checked.filter((v) => v !== "ALL") as ComparisonResult["status"][];
      filterToggleLabel.textContent = `${session.statusFilter.length} status`;
    }
    session.currentPage = 1;
    renderResults();
  };

  filterToggle.addEventListener("click", (e: MouseEvent) => {
    e.stopPropagation();
    filterMenu.classList.toggle("ch-hidden");
  });

  filterCheckboxes.forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.value === "ALL" && cb.checked) {
        filterCheckboxes.forEach((other) => {
          if (other.value !== "ALL") other.checked = false;
        });
      } else if (cb.value !== "ALL" && cb.checked) {
        const allCb = filterCheckboxes.find((c) => c.value === "ALL");
        if (allCb) allCb.checked = false;
      }
      applyFilter();
    });
  });

  document.addEventListener("click", (e: MouseEvent) => {
    if (!filterWrap.contains(e.target as Node)) {
      filterMenu.classList.add("ch-hidden");
    }
    if (!checkerFilterWrap.contains(e.target as Node)) {
      checkerFilterMenu.classList.add("ch-hidden");
    }
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

  // ── View 2 (Pengecekan) Event wiring ──────────────

  const applyCheckerFilter = () => {
    const checked = checkerFilterCheckboxes.filter((cb) => cb.checked).map((cb) => cb.value);
    if (checked.includes("ALL") || checked.length === 0) {
      checkerSession.statusFilter = [];
      checkerFilterToggleLabel.textContent = "Semua Status";
    } else {
      checkerSession.statusFilter = checked.filter((v) => v !== "ALL");
      checkerFilterToggleLabel.textContent = `${checkerSession.statusFilter.length} status`;
    }
    checkerSession.currentPage = 1;
    renderCheckerResults();
  };

  checkerFilterToggle.addEventListener("click", (e: MouseEvent) => {
    e.stopPropagation();
    checkerFilterMenu.classList.toggle("ch-hidden");
  });

  checkerFilterCheckboxes.forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.value === "ALL" && cb.checked) {
        checkerFilterCheckboxes.forEach((other) => {
          if (other.value !== "ALL") other.checked = false;
        });
      } else if (cb.value !== "ALL" && cb.checked) {
        const allCb = checkerFilterCheckboxes.find((c) => c.value === "ALL");
        if (allCb) allCb.checked = false;
      }
      applyCheckerFilter();
    });
  });

  checkerCheckBtn.addEventListener("click", handleCheckerCheck);

  benchmarkSelect.addEventListener("change", () => {
    checkerSession.benchmark = benchmarkSelect.value as BenchmarkType;
    rerunChecker();
  });

  checkerToleranceInput.addEventListener("change", () => {
    const val = parseInt(checkerToleranceInput.value, 10);
    checkerSession.tolerance = isNaN(val) || val < 0 ? 0 : val;
    rerunChecker();
  });

  checkerExportBtn.addEventListener("click", handleCheckerExportResults);
}

// ── Open / Close ──────────────────────────────────────

export function openComparerModal(targetTab: "compare" | "check" = "compare"): void {
  const overlay = document.getElementById("ch-comparer-overlay");
  if (overlay) {
    overlay.classList.remove("ch-hidden");
    overlay.style.display = "flex";

    const tabCheckerBtn = document.getElementById("ch-tab-checker");
    if (tabCheckerBtn) {
      tabCheckerBtn.classList.toggle("ch-hidden", !isOutputTaxPage());
    }

    if (targetTab === "check" && isOutputTaxPage()) {
      switchTab("check");
    } else {
      switchTab("compare");
      const textarea = document.getElementById("ch-comparer-textarea") as HTMLTextAreaElement;
      if (textarea) {
        textarea.focus();
        navigator.clipboard.readText().then((text) => {
          if (text && !textarea.value) {
            textarea.value = text;
          }
        }).catch(() => {});
      }
    }
  }
}

export function closeComparerModal(): void {
  const overlay = document.getElementById("ch-comparer-overlay");
  if (overlay) {
    overlay.style.display = "none";
    overlay.classList.add("ch-hidden");
  }
}

// ── Check handlers for Bandingkan ─────────────────────

function handleCheck(): void {
  const statusMsg = document.getElementById("ch-comparer-status");
  if (!statusMsg) return;

  const textarea = document.getElementById("ch-comparer-textarea") as HTMLTextAreaElement;
  const datesInput = document.getElementById("ch-comparer-daily-dates") as HTMLInputElement;
  const textareaValue = textarea ? textarea.value : "";
  const datesValue = datesInput ? datesInput.value : "";
  const scrapedData = contentState.scrapedData;

  const decision = prepareComparison(session, textareaValue, scrapedData, datesValue);

  contentState.pendingCompare = false;
  if (decision.action === "error") {
    renderComparisonError(decision.message);
    return;
  }

  if (decision.action === "needScrape") {
    renderResults();
    statusMsg.textContent = "Belum ada data. Mohon tunggu, sedang melakukan scraping data PPN Keluaran terlebih dahulu...";
    statusMsg.className = "ch-comparer-status ch-comparer-status-info";
    contentState.pendingCompare = true;
    startScrape();
    return;
  }

  runSessionComparison(session, decision.pastedRows, decision.scrapedData);
  renderAfterComparison();
}

function rerunFromTextarea(): void {
  if (session.results.length === 0) return;
  runPendingCompare();
}

export function runPendingCompare(): void {
  const textarea = document.getElementById("ch-comparer-textarea") as HTMLTextAreaElement;
  const datesInput = document.getElementById("ch-comparer-daily-dates") as HTMLInputElement;
  const result = rerunComparison(
    session, textarea ? textarea.value : "", contentState.scrapedData,
    datesInput ? datesInput.value : "",
  );
  if (result.action === "error") {
    renderComparisonError(result.message);
  } else {
    renderAfterComparison();
  }
}

function renderComparisonError(message: string): void {
  renderResults();
  const statusMsg = document.getElementById("ch-comparer-status");
  if (statusMsg) {
    statusMsg.textContent = message;
    statusMsg.className = "ch-comparer-status ch-comparer-status-error";
  }
  document.getElementById("ch-comparer-textarea")?.classList.remove("ch-hidden");
  const toggleIcon = document.getElementById("ch-comparer-toggle-icon");
  if (toggleIcon) toggleIcon.className = "pi pi-chevron-up";
}

// ── Check handlers for Pengecekan ─────────────────────

function handleCheckerCheck(): void {
  const statusMsg = document.getElementById("ch-checker-status");
  if (!statusMsg) return;

  const scrapedData = contentState.scrapedData;
  if (!scrapedData || scrapedData.length === 0) {
    statusMsg.textContent = "Belum ada data. Mohon tunggu, sedang melakukan scraping data PPN Keluaran terlebih dahulu...";
    statusMsg.className = "ch-comparer-status ch-comparer-status-info";
    contentState.pendingCheck = true;
    startScrape();
    return;
  }

  checkerSession.results = checkAllRowsAccuracy(
    scrapedData,
    checkerSession.benchmark,
    checkerSession.tolerance,
  );
  checkerSession.currentPage = 1;
  renderCheckerAfterCheck();
}

function rerunChecker(): void {
  const scrapedData = contentState.scrapedData;
  if (!scrapedData || scrapedData.length === 0) return;

  checkerSession.results = checkAllRowsAccuracy(
    scrapedData,
    checkerSession.benchmark,
    checkerSession.tolerance,
  );
  checkerSession.currentPage = 1;
  renderCheckerAfterCheck();
}

export function runPendingCheck(): void {
  const scrapedData = contentState.scrapedData;
  if (!scrapedData || scrapedData.length === 0) return;

  openComparerModal("check");
  checkerSession.results = checkAllRowsAccuracy(
    scrapedData,
    checkerSession.benchmark,
    checkerSession.tolerance,
  );
  checkerSession.currentPage = 1;
  renderCheckerAfterCheck();
}

// ── Render Bandingkan results table ───────────────────

function renderAfterComparison(): void {
  renderResults();

  const statusMsg = document.getElementById("ch-comparer-status");
  if (statusMsg) {
    statusMsg.textContent = formatStatusSummary(buildStatusSummary(session.results));
    statusMsg.className = "ch-comparer-status ch-comparer-status-info";
  }

  const textareaEl = document.getElementById("ch-comparer-textarea") as HTMLTextAreaElement;
  const toggleIcon = document.getElementById("ch-comparer-toggle-icon");
  if (textareaEl) textareaEl.classList.add("ch-hidden");
  if (toggleIcon) toggleIcon.className = "pi pi-chevron-down";
}

function renderResults(): void {
  const exportBtn = document.getElementById("ch-comparer-export-btn") as HTMLButtonElement;
  if (exportBtn) exportBtn.disabled = session.results.length === 0;
  const container = document.getElementById("ch-comparer-results");
  if (!container) return;

  container.classList.remove("ch-hidden");
  container.innerHTML = "";

  const filterWrap = document.getElementById("ch-comparer-filter-wrap");
  if (filterWrap) filterWrap.classList.toggle("ch-hidden", session.results.length === 0);

  if (session.results.length === 0) {
    container.classList.add("ch-hidden");
    return;
  }

  const filtered = applyStatusFilter(session.results, session.statusFilter);
  const { totalPages: filteredTotalPages, currentPage: clampedPage, startIndex: filteredStart, pageRows: filteredPageRows } =
    computePagination(filtered, PAGE_SIZE, session.currentPage);
  session.currentPage = clampedPage;

  const table = document.createElement("table");
  table.className = "ch-comparer-table";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  const headers = [
    "No",
    "Referensi",
    session.refLainEnabled ? "Referensi Lain" : "Nama Pembeli",
    session.refLainEnabled ? "Nama Pembeli" : "DPP Coretax",
    session.refLainEnabled ? "DPP Coretax" : "DPP Baru",
    session.refLainEnabled ? "DPP Baru" : "PPN Coretax",
    session.refLainEnabled ? "PPN Coretax" : "PPN Baru",
    session.refLainEnabled ? "PPN Baru" : "Selisih PPN",
    session.refLainEnabled ? "Selisih PPN" : "Status",
    session.refLainEnabled ? "Status" : "",
  ].filter((h) => h !== "");
  const getColClass = (i: number): string => {
    if (i === 0) return "ch-col-no";
    if (session.refLainEnabled) {
      if (i === 1 || i === 2) return "ch-col-ref";
      if (i === 3) return "ch-col-buyer";
      if (i >= 4 && i <= 8) return "ch-col-num";
      return "ch-col-status";
    } else {
      if (i === 1) return "ch-col-ref";
      if (i === 2) return "ch-col-buyer";
      if (i >= 3 && i <= 7) return "ch-col-num";
      return "ch-col-status";
    }
  };

  headers.forEach((h, i) => {
    const th = document.createElement("th");
    th.textContent = h;
    th.className = getColClass(i);
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  filteredPageRows.forEach((r, idx) => {
    const tr = document.createElement("tr");
    if (session.viewedRefs.has(r.reference)) {
      tr.classList.add("ch-comparer-row-viewed");
    }

    const isNotFound = r.status === "TIDAK_DITEMUKAN";
    tr.style.cursor = "pointer";
    tr.title = isNotFound
      ? "Klik 1x untuk melihat teks lengkap"
      : "Klik 1x untuk melihat teks lengkap, klik 2x untuk mencari di Coretax";

    tr.addEventListener("click", (e: MouseEvent) => {
      if ((e.target as HTMLElement).tagName === "BUTTON" || (e.target as HTMLElement).tagName === "INPUT") return;
      tr.classList.toggle("ch-comparer-row-expanded");
    });


    const statusLabel = getStatusLabel(r.status);

    const cells = session.refLainEnabled
      ? [
          String(filteredStart + idx + 1),
          r.reference,
          r.refLain,
          r.buyerName,
          formatResultNumber(r.dppSistem),
          formatResultNumber(r.dppExcel),
          formatResultNumber(r.ppnSistem),
          formatResultNumber(r.ppnExcel),
          formatResultNumber(r.ppnSelisih),
          statusLabel,
        ]
      : [
          String(filteredStart + idx + 1),
          r.reference,
          r.buyerName,
          formatResultNumber(r.dppSistem),
          formatResultNumber(r.dppExcel),
          formatResultNumber(r.ppnSistem),
          formatResultNumber(r.ppnExcel),
          formatResultNumber(r.ppnSelisih),
          statusLabel,
        ];

    cells.forEach((c, i) => {
      const td = document.createElement("td");
      td.textContent = c;
      td.title = String(c);
      const colCls = getColClass(i);
      td.className = colCls;
      const numCols = session.refLainEnabled ? [0, 4, 5, 6, 7, 8] : [0, 3, 4, 5, 6, 7];
      if (numCols.includes(i)) {
        td.classList.add("ch-comparer-num");
      }
      tr.appendChild(td);
    });

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

  if (filteredTotalPages > 1) {
    const pagination = document.createElement("div");
    pagination.className = "ch-comparer-pagination";

    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "ch-comparer-page-btn";
    prevBtn.textContent = "Sebelumnya";
    prevBtn.disabled = session.currentPage === 1;
    prevBtn.addEventListener("click", () => {
      if (session.currentPage > 1) {
        session.currentPage--;
        renderResults();
      }
    });

    const pageInfo = document.createElement("span");
    pageInfo.className = "ch-comparer-page-info";
    pageInfo.textContent = `Halaman ${session.currentPage} dari ${filteredTotalPages}`;

    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "ch-comparer-page-btn";
    nextBtn.textContent = "Berikutnya";
    nextBtn.disabled = session.currentPage === filteredTotalPages;
    nextBtn.addEventListener("click", () => {
      if (session.currentPage < filteredTotalPages) {
        session.currentPage++;
        renderResults();
      }
    });

    pagination.appendChild(prevBtn);
    pagination.appendChild(pageInfo);
    pagination.appendChild(nextBtn);
    container.appendChild(pagination);
  }
}

// ── Render Pengecekan results table ───────────────────

function renderCheckerAfterCheck(): void {
  renderCheckerResults();

  const statusMsg = document.getElementById("ch-checker-status");
  if (statusMsg) {
    statusMsg.textContent = formatCheckSummary(checkerSession.results);
    statusMsg.className = "ch-comparer-status ch-comparer-status-info";
  }
}

function renderCheckerResults(): void {
  const container = document.getElementById("ch-checker-results");
  if (!container) return;

  container.classList.remove("ch-hidden");
  container.innerHTML = "";

  const filterWrap = document.getElementById("ch-checker-filter-wrap");
  if (filterWrap) filterWrap.classList.remove("ch-hidden");

  if (checkerSession.results.length === 0) {
    if (filterWrap) filterWrap.classList.add("ch-hidden");
    container.textContent = "Semua faktur sesuai.";
    return;
  }

  const filtered = applyCheckerStatusFilter(checkerSession.results, checkerSession.statusFilter);
  const { totalPages, currentPage, startIndex, pageRows } = computePagination(
    filtered,
    PAGE_SIZE,
    checkerSession.currentPage,
  );
  checkerSession.currentPage = currentPage;

  const table = document.createElement("table");
  table.className = "ch-comparer-table";

  const benchmark = checkerSession.benchmark;
  const headers =
    benchmark === "DPP"
      ? [
          "No",
          "Referensi",
          "Tanggal",
          "Nama Pembeli",
          "DPP",
          "DPP NL",
          "PPN",
          "Selisih DPP NL",
          "Selisih PPN",
          "Status",
        ]
      : benchmark === "DPP_NILAI_LAIN"
        ? [
            "No",
            "Referensi",
            "Tanggal",
            "Nama Pembeli",
            "DPP",
            "DPP NL",
            "PPN",
            "Selisih DPP",
            "Selisih PPN",
            "Status",
          ]
        : [
            "No",
            "Referensi",
            "Tanggal",
            "Nama Pembeli",
            "DPP",
            "DPP NL",
            "PPN",
            "Selisih DPP",
            "Selisih DPP NL",
            "Status",
          ];

  const getCheckerColClass = (i: number, headerName?: string): string => {
    if (i === 0) return "ch-col-no";
    if (i === 1) return "ch-col-ref";
    if (i === 2) return "ch-col-date";
    if (i === 3) return "ch-col-buyer";
    if (headerName && (headerName.includes("NL") || headerName.includes("Nilai Lain"))) return "ch-col-num-wide";
    if (i >= 4 && i <= 8) return "ch-col-num";
    return "ch-col-status";
  };

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");

  headers.forEach((h, i) => {
    const th = document.createElement("th");
    th.textContent = h;
    th.className = getCheckerColClass(i, h);
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  pageRows.forEach((r, idx) => {
    const tr = document.createElement("tr");
    const searchKey = r.reference || r.taxInvoiceNumber;
    tr.style.cursor = "pointer";
    tr.title = searchKey
      ? "Klik 1x untuk melihat teks lengkap, klik 2x untuk mencari di Coretax"
      : "Klik 1x untuk melihat teks lengkap";

    tr.addEventListener("click", (e: MouseEvent) => {
      if ((e.target as HTMLElement).tagName === "BUTTON" || (e.target as HTMLElement).tagName === "INPUT") return;
      tr.classList.toggle("ch-comparer-row-expanded");
    });

    if (checkerSession.viewedRefs.has(searchKey)) {
      tr.classList.add("ch-comparer-row-viewed");
    }


    let diffCol1 = "-";
    let diffCol2 = "-";

    if (r.benchmark === "DPP") {
      diffCol1 = formatResultDifference(r.dppNilaiLainDiff, r.tolerance);
      diffCol2 = formatResultDifference(r.ppnDiff, r.tolerance);
    } else if (r.benchmark === "DPP_NILAI_LAIN") {
      diffCol1 = formatResultDifference(r.dppDiff, r.tolerance);
      diffCol2 = formatResultDifference(r.ppnDiff, r.tolerance);
    } else {
      diffCol1 = formatResultDifference(r.dppDiff, r.tolerance);
      diffCol2 = formatResultDifference(r.dppNilaiLainDiff, r.tolerance);
    }

    const cells = [
      String(startIndex + idx + 1),
      r.reference || r.taxInvoiceNumber,
      r.invoiceDate,
      r.buyerName,
      formatResultNumber(r.dppSystem),
      formatResultNumber(r.dppNilaiLainSystem),
      formatResultNumber(r.ppnSystem),
      diffCol1,
      diffCol2,
      r.status,
    ];

    cells.forEach((c, i) => {
      const td = document.createElement("td");
      td.textContent = c;
      td.title = String(c);
      const colCls = getCheckerColClass(i, headers[i]);
      td.className = colCls;
      if ([0, 4, 5, 6, 7, 8].includes(i)) {
        td.classList.add("ch-comparer-num");
      }
      tr.appendChild(td);
    });

    if (searchKey) {
      tr.addEventListener("dblclick", () => {
        checkerSession.viewedRefs.add(searchKey);
        renderCheckerResults();
        searchReference(searchKey);
      });
    }

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  container.appendChild(table);

  if (totalPages > 1) {
    const pagination = document.createElement("div");
    pagination.className = "ch-comparer-pagination";

    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "ch-comparer-page-btn";
    prevBtn.textContent = "Sebelumnya";
    prevBtn.disabled = checkerSession.currentPage === 1;
    prevBtn.addEventListener("click", () => {
      if (checkerSession.currentPage > 1) {
        checkerSession.currentPage--;
        renderCheckerResults();
      }
    });

    const pageInfo = document.createElement("span");
    pageInfo.className = "ch-comparer-page-info";
    pageInfo.textContent = `Halaman ${checkerSession.currentPage} dari ${totalPages}`;

    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "ch-comparer-page-btn";
    nextBtn.textContent = "Berikutnya";
    nextBtn.disabled = checkerSession.currentPage === totalPages;
    nextBtn.addEventListener("click", () => {
      if (checkerSession.currentPage < totalPages) {
        checkerSession.currentPage++;
        renderCheckerResults();
      }
    });

    pagination.appendChild(prevBtn);
    pagination.appendChild(pageInfo);
    pagination.appendChild(nextBtn);
    container.appendChild(pagination);
  }
}

// ── Export results to XLSX ────────────────────────────

function handleExportResults(): void {
  const container = document.getElementById("ch-comparer-results");
  if (!container || container.classList.contains("ch-hidden")) return;

  if (session.results.length === 0) return;

  const rows = buildComparisonExportRows(session.results, session.refLainEnabled);
  const firstAmount = session.refLainEnabled ? 7 : 6;
  downloadXLSXFile(rows, "perbandingan-faktur.xlsx", "Perbandingan", {
    numberFormats: Object.fromEntries(
      Array.from({ length: 5 }, (_, i) => [firstAmount + i, RESULT_NUMBER_FORMAT]),
    ),
  });
}

function handleCheckerExportResults(): void {
  if (checkerSession.results.length === 0) return;

  const rows = buildCheckerExportRows(checkerSession.results, checkerSession.benchmark);
  downloadXLSXFile(rows, "pengecekan-nilai-faktur.xlsx", "Pengecekan", {
    numberFormats: {
      5: RESULT_NUMBER_FORMAT, 6: RESULT_NUMBER_FORMAT, 7: RESULT_NUMBER_FORMAT,
      8: RESULT_DIFFERENCE_FORMAT, 9: RESULT_DIFFERENCE_FORMAT,
    },
  });
}

// ── Search reference in Coretax ───────────────────────

function searchReference(reference: string): void {
  closeComparerModal();

  const input =
    (document.getElementById("ch-toolbar-filter-reference") as HTMLInputElement) ||
    (document.getElementById("ch-grid-filter-reference") as HTMLInputElement);

  if (input) {
    input.value = reference;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  document.dispatchEvent(
    new CustomEvent("ch:search-reference", { detail: { reference } }),
  );
}
