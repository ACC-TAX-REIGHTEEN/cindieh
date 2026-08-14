// ============================================================
// UI-COMPARER.TS — Modal for paste & compare feature
// ============================================================
// Thin view over a ComparerSession (comparer-logic.ts): builds the
// modal DOM, wires events, and renders session state. All comparison
// decision logic — run, re-run, "Periksa" decision tree — lives in
// comparer-logic.ts where it is pure and testable.
// ============================================================

import { parsePastedData, type ComparisonResult } from "./comparer";
import { downloadXLSXFile } from "./exporter";
import { contentState, startScrape } from "./main-actions";
import {
  applyStatusFilter,
  buildStatusSummary,
  computePagination,
  createComparerSession,
  formatStatusSummary,
  getStatusLabel,
  parseDailyDates,
  prepareComparison,
  rerunComparison,
  runComparison as runSessionComparison,
  type ComparerSession,
} from "./comparer-logic";

const PAGE_SIZE = 10;

// ── Session ───────────────────────────────────────────
// Session state lives in comparer-logic's factory; the view only reads
// and mutates it through comparer-logic's orchestration functions.

const session: ComparerSession = createComparerSession();

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

  const title = document.createElement("h3");
  title.textContent = "Bandingkan Data Penjualan";

  const closeBtn = document.createElement("button");
  closeBtn.className = "ch-comparer-close";
  closeBtn.innerHTML = "&times;";
  closeBtn.setAttribute("aria-label", "Tutup");

  header.appendChild(title);
  header.appendChild(closeBtn);

  // Body
  const body = document.createElement("div");
  body.className = "ch-comparer-body";

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
  // Hidden until the results table is rendered
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

  body.appendChild(pasteSection);
  body.appendChild(btnRow);
  body.appendChild(statusMsg);
  body.appendChild(results);

  modal.appendChild(header);
  modal.appendChild(body);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // ── Event wiring ──────────────────────────────────

  closeBtn.addEventListener("click", closeComparerModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeComparerModal();
  });

  checkBtn.addEventListener("click", handleCheck);

  clearBtn.addEventListener("click", () => {
    textarea.value = "";
    // Always keep the textarea visible after clearing so the user can paste
    // new data immediately (do NOT hide it).
    textarea.classList.remove("ch-hidden");
    const toggleIcon = document.getElementById("ch-comparer-toggle-icon");
    if (toggleIcon) toggleIcon.className = "pi pi-chevron-up";
    results.classList.add("ch-hidden");
    results.innerHTML = "";
    statusMsg.textContent = "";
    statusMsg.className = "ch-comparer-status";
    // Hide the status filter again until results are shown
    const filterWrap = document.getElementById("ch-comparer-filter-wrap");
    if (filterWrap) filterWrap.classList.add("ch-hidden");
  });

  exportBtn.addEventListener("click", handleExportResults);

  // Tolerance input: update tolerance and re-run comparison if results exist
  toleranceInput.addEventListener("change", () => {
    const val = parseInt(toleranceInput.value, 10);
    session.tolerance = isNaN(val) || val < 0 ? 0 : val;
    rerunFromTextarea();
  });

  // Ref Lain checkbox
  refLainCheckbox.addEventListener("change", () => {
    session.refLainEnabled = refLainCheckbox.checked;
    rerunFromTextarea();
  });

  // Daily checkbox: toggle daily mode and show/hide the date input
  dailyCheckbox.addEventListener("change", () => {
    session.dailyEnabled = dailyCheckbox.checked;
    dailyDatesInput.classList.toggle("ch-hidden", !session.dailyEnabled);
    rerunFromTextarea();
  });

  // Daily dates input: parse dates (1-31, comma separated)
  dailyDatesInput.addEventListener("change", () => {
    session.dailyDates = parseDailyDates(dailyDatesInput.value);
    rerunFromTextarea();
  });

  // Status filter dropdown: custom dropdown with checkboxes
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
        // Selecting "Semua Status" unchecks the others
        filterCheckboxes.forEach((other) => {
          if (other.value !== "ALL") other.checked = false;
        });
      } else if (cb.value !== "ALL" && cb.checked) {
        // Selecting a specific status unchecks "Semua Status"
        const allCb = filterCheckboxes.find((c) => c.value === "ALL");
        if (allCb) allCb.checked = false;
      }
      applyFilter();
    });
  });

  // Close the filter menu when clicking outside
  document.addEventListener("click", (e: MouseEvent) => {
    if (!filterWrap.contains(e.target as Node)) {
      filterMenu.classList.add("ch-hidden");
    }
  });

  // Toggle paste section visibility
  toggleBtn.addEventListener("click", () => {
    const isHidden = textarea.classList.contains("ch-hidden");
    textarea.classList.toggle("ch-hidden", !isHidden);
    toggleIcon.className = isHidden ? "pi pi-chevron-up" : "pi pi-chevron-down";
  });

  // Keyboard: Ctrl+Enter to check
  textarea.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleCheck();
    }
  });
}

// ── Open / Close ──────────────────────────────────────

export function openComparerModal(): void {
  const overlay = document.getElementById("ch-comparer-overlay");
  if (overlay) {
    overlay.classList.remove("ch-hidden");
    overlay.style.display = "flex";
    const textarea = document.getElementById("ch-comparer-textarea") as HTMLTextAreaElement;
    if (textarea) {
      textarea.focus();
      // Auto-fill from clipboard if available
      navigator.clipboard.readText().then((text) => {
        if (text && !textarea.value) {
          textarea.value = text;
        }
      }).catch(() => {
        // Permission denied or not available — ignore
      });
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

// ── Check handler ─────────────────────────────────────
// Delegates the decision tree to comparer-logic's prepareComparison;
// maps the returned action onto DOM/UI behaviour.

function handleCheck(): void {
  const statusMsg = document.getElementById("ch-comparer-status");
  if (!statusMsg) return;

  const textarea = document.getElementById("ch-comparer-textarea") as HTMLTextAreaElement;
  const datesInput = document.getElementById("ch-comparer-daily-dates") as HTMLInputElement;
  const textareaValue = textarea ? textarea.value : "";
  const datesValue = datesInput ? datesInput.value : "";
  const scrapedData = contentState.scrapedData;

  const decision = prepareComparison(session, textareaValue, scrapedData, datesValue);

  if (decision.action === "error") {
    statusMsg.textContent = decision.message;
    statusMsg.className = "ch-comparer-status ch-comparer-status-error";
    return;
  }

  if (decision.action === "needScrape") {
    // No scraped data yet — scrape first, then run the comparison automatically.
    statusMsg.textContent = "Belum ada data. Mohon tunggu, sedang melakukan scraping data PPN Keluaran terlebih dahulu...";
    statusMsg.className = "ch-comparer-status ch-comparer-status-info";
    contentState.pendingCompare = true;
    startScrape();
    return;
  }

  runSessionComparison(session, decision.pastedRows, decision.scrapedData);
  renderAfterComparison();
}

/**
 * Re-run the comparison after a control (tolerance, refLain, daily mode,
 * daily dates) changed. No-op unless a comparison is already showing.
 */
function rerunFromTextarea(): void {
  if (session.results.length === 0) return;
  const textarea = document.getElementById("ch-comparer-textarea") as HTMLTextAreaElement;
  const scrapedData = contentState.scrapedData;
  const result = rerunComparison(session, textarea ? textarea.value : "", scrapedData);
  if (result) renderAfterComparison();
}

/**
 * Re-run the comparison after a scrape completes (triggered when the user
 * clicked "Periksa" before any data was scraped). Uses the textarea content
 * and the freshly scraped data.
 */
export function runPendingCompare(): void {
  const textarea = document.getElementById("ch-comparer-textarea") as HTMLTextAreaElement;
  const scrapedData = contentState.scrapedData;
  if (!textarea || !textarea.value.trim() || !scrapedData || scrapedData.length === 0) return;

  const pastedRows = parsePastedData(textarea.value, session.refLainEnabled);
  if (pastedRows.length === 0) return;

  runSessionComparison(session, pastedRows, scrapedData);
  renderAfterComparison();
}

// ── Render results table ──────────────────────────────

function renderAfterComparison(): void {
  renderResults();

  const statusMsg = document.getElementById("ch-comparer-status");
  if (statusMsg) {
    statusMsg.textContent = formatStatusSummary(buildStatusSummary(session.results));
    statusMsg.className = "ch-comparer-status ch-comparer-status-info";
  }

  // Hide the paste textarea after checking (can be re-shown via toggle)
  const textareaEl = document.getElementById("ch-comparer-textarea") as HTMLTextAreaElement;
  const toggleIcon = document.getElementById("ch-comparer-toggle-icon");
  if (textareaEl) textareaEl.classList.add("ch-hidden");
  if (toggleIcon) toggleIcon.className = "pi pi-chevron-down";
}

function renderResults(): void {
  const container = document.getElementById("ch-comparer-results");
  if (!container) return;

  container.classList.remove("ch-hidden");
  container.innerHTML = "";

  // Show the status filter once results are displayed
  const filterWrap = document.getElementById("ch-comparer-filter-wrap");
  if (filterWrap) filterWrap.classList.remove("ch-hidden");

  if (session.results.length === 0) {
    container.textContent = "Tidak ada data untuk ditampilkan.";
    return;
  }

  // Apply status filter and compute pagination via extracted pure functions.
  const filtered = applyStatusFilter(session.results, session.statusFilter);
  const { totalPages: filteredTotalPages, currentPage: clampedPage, startIndex: filteredStart, pageRows: filteredPageRows } =
    computePagination(filtered, PAGE_SIZE, session.currentPage);
  session.currentPage = clampedPage;

  const table = document.createElement("table");
  table.className = "ch-comparer-table";

  // Header
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
  for (const h of headers) {
    const th = document.createElement("th");
    th.textContent = h;
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Body
  const tbody = document.createElement("tbody");
  filteredPageRows.forEach((r, idx) => {
    const tr = document.createElement("tr");
    // Highlight rows that have been viewed (double-clicked); no status colors.
    if (session.viewedRefs.has(r.reference)) {
      tr.classList.add("ch-comparer-row-viewed");
    }

    const isNotFound = r.status === "TIDAK_DITEMUKAN";
    if (!isNotFound) {
      tr.style.cursor = "pointer";
      tr.title = "Klik dua kali untuk mencari referensi ini di Coretax";
    }

    const formatNum = (n: number | null): string => {
      if (n === null) return "-";
      return n.toLocaleString("id-ID");
    };

    const statusLabel = getStatusLabel(r.status);

    const cells = session.refLainEnabled
      ? [
          String(filteredStart + idx + 1),
          r.reference,
          r.refLain,
          r.buyerName,
          formatNum(r.dppSistem),
          formatNum(r.dppExcel),
          formatNum(r.ppnSistem),
          formatNum(r.ppnExcel),
          formatNum(r.ppnSelisih),
          statusLabel,
        ]
      : [
          String(filteredStart + idx + 1),
          r.reference,
          r.buyerName,
          formatNum(r.dppSistem),
          formatNum(r.dppExcel),
          formatNum(r.ppnSistem),
          formatNum(r.ppnExcel),
          formatNum(r.ppnSelisih),
          statusLabel,
        ];

    cells.forEach((c, i) => {
      const td = document.createElement("td");
      td.textContent = c;
      // Right-align numeric columns and the No column
      const numCols = session.refLainEnabled ? [0, 4, 5, 6, 7, 8] : [0, 3, 4, 5, 6, 7];
      if (numCols.includes(i)) {
        td.classList.add("ch-comparer-num");
      }
      tr.appendChild(td);
    });

    // Double-click a row to search the reference in Coretax
    // (disabled for "Tidak ditemukan" rows since there is nothing to search)
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

  // Pagination (based on filtered results)
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

// ── Export results to XLSX ────────────────────────────

function handleExportResults(): void {
  const container = document.getElementById("ch-comparer-results");
  if (!container || container.classList.contains("ch-hidden")) return;

  if (session.results.length === 0) return;

  const headers = session.refLainEnabled
    ? [
        "No",
        "Referensi",
        "Referensi Lain",
        "Nama Pembeli",
        "Tanggal",
        "NIK/NPWP",
        "Nomor Faktur Pajak",
        "DPP Coretax",
        "DPP Baru",
        "PPN Coretax",
        "PPN Baru",
        "Selisih PPN",
        "Status",
      ]
    : [
        "No",
        "Referensi",
        "Nama Pembeli",
        "Tanggal",
        "NIK/NPWP",
        "Nomor Faktur Pajak",
        "DPP Coretax",
        "DPP Baru",
        "PPN Coretax",
        "PPN Baru",
        "Selisih PPN",
        "Status",
      ];

  const formatNum = (n: number | null): string => {
    if (n === null) return "";
    return n.toLocaleString("id-ID");
  };

  const rows: string[][] = [headers];
  session.results.forEach((r, idx) => {
    if (session.refLainEnabled) {
      rows.push([
        String(idx + 1),
        r.reference,
        r.refLain,
        r.buyerName,
        r.invoiceDate,
        r.buyerTIN,
        r.taxInvoiceNumber,
        formatNum(r.dppSistem),
        formatNum(r.dppExcel),
        formatNum(r.ppnSistem),
        formatNum(r.ppnExcel),
        formatNum(r.ppnSelisih),
        r.status,
      ]);
    } else {
      rows.push([
        String(idx + 1),
        r.reference,
        r.buyerName,
        r.invoiceDate,
        r.buyerTIN,
        r.taxInvoiceNumber,
        formatNum(r.dppSistem),
        formatNum(r.dppExcel),
        formatNum(r.ppnSistem),
        formatNum(r.ppnExcel),
        formatNum(r.ppnSelisih),
        r.status,
      ]);
    }
  });

  // Generate XLSX file via the shared writer.
  downloadXLSXFile(rows, "perbandingan-faktur.xlsx", "Perbandingan");
}

// ── Search reference in Coretax ───────────────────────

/**
 * Close the comparer modal, fill the reference search input with the
 * given reference, and trigger a search on the Coretax page.
 */
function searchReference(reference: string): void {
  closeComparerModal();

  const input =
    (document.getElementById("ch-toolbar-filter-reference") as HTMLInputElement) ||
    (document.getElementById("ch-grid-filter-reference") as HTMLInputElement);

  if (input) {
    input.value = reference;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  // Dispatch the same event the Enter key handler uses to set the
  // server filter and trigger the search.
  document.dispatchEvent(
    new CustomEvent("ch:search-reference", { detail: { reference } }),
  );
}
