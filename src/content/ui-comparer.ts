// ============================================================
// UI-COMPARER.TS — Modal for paste & compare feature
// ============================================================
// Injects a modal with a textarea for pasting Excel data,
// a "Periksa" button, and a paginated results table.
// ============================================================

import { compareData, parsePastedData, type ComparisonResult } from "./comparer";
import { getScrapedData, setPendingCompare, startScrape } from "./main-actions";

const PAGE_SIZE = 10;

// ── State ──────────────────────────────────────────────

let comparerModal: HTMLElement | null = null;
let comparerTextarea: HTMLElement | null = null;
let comparerResults: HTMLElement | null = null;
let currentResults: ComparisonResult[] = [];
let currentPage = 1;

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
    "SZ-0447/07/26\t568.000\t62.480\nHH-0357/07/26\t1.481.203\t162.932\nSP-0169/07/26\t1.132.023\t124.523";

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

  const leftGroup = document.createElement("div");
  leftGroup.className = "ch-comparer-btn-left";
  leftGroup.appendChild(checkBtn);
  leftGroup.appendChild(clearBtn);

  const exportBtn = document.createElement("button");
  exportBtn.id = "ch-comparer-export-btn";
  exportBtn.className = "ch-comparer-btn ch-comparer-btn-primary";
  exportBtn.textContent = "Export XLSX";
  exportBtn.title = "Ekspor hasil perbandingan ke file Excel";

  btnRow.appendChild(leftGroup);
  btnRow.appendChild(exportBtn);

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

  comparerModal = modal;
  comparerTextarea = textarea;
  comparerResults = results;

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
  });

  exportBtn.addEventListener("click", handleExportResults);

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

function handleCheck(): void {
  const statusMsg = document.getElementById("ch-comparer-status");
  if (!statusMsg) return;

  const textarea = document.getElementById("ch-comparer-textarea") as HTMLTextAreaElement;
  if (!textarea || !textarea.value.trim()) {
    statusMsg.textContent = "Silakan paste data dari Excel terlebih dahulu.";
    statusMsg.className = "ch-comparer-status ch-comparer-status-error";
    return;
  }

  const pastedRows = parsePastedData(textarea.value);
  if (pastedRows.length === 0) {
    statusMsg.textContent = "Format data tidak dikenali. Pastikan format: Referensi, DPP, PPN (tab-separated).";
    statusMsg.className = "ch-comparer-status ch-comparer-status-error";
    return;
  }

  const scrapedData = getScrapedData();
  if (!scrapedData || scrapedData.length === 0) {
    // No scraped data yet — scrape first, then run the comparison automatically.
    statusMsg.textContent = "Belum ada data. Mohon tunggu, sedang melakukan scraping data PPN Keluaran terlebih dahulu...";
    statusMsg.className = "ch-comparer-status ch-comparer-status-info";
    setPendingCompare(true);
    startScrape();
    return;
  }

  runComparison(pastedRows, scrapedData);
}

function runComparison(
  pastedRows: ReturnType<typeof parsePastedData>,
  scrapedData: Record<string, unknown>[],
): void {
  const statusMsg = document.getElementById("ch-comparer-status");

  currentResults = compareData(pastedRows, scrapedData);
  currentPage = 1;
  renderResults();

  const cocok = currentResults.filter((r) => r.status === "COCOK").length;
  const berbeda = currentResults.filter((r) => r.status === "BERBEDA").length;
  const tidakDitemukan = currentResults.filter((r) => r.status === "TIDAK_DITEMUKAN").length;

  if (statusMsg) {
    statusMsg.textContent = `${currentResults.length} data diperiksa: ${cocok} cocok, ${berbeda} berbeda, ${tidakDitemukan} tidak ditemukan.`;
    statusMsg.className = "ch-comparer-status ch-comparer-status-info";
  }

  // Hide the paste textarea after checking (can be re-shown via toggle)
  const textareaEl = document.getElementById("ch-comparer-textarea") as HTMLTextAreaElement;
  const toggleIcon = document.getElementById("ch-comparer-toggle-icon");
  if (textareaEl) textareaEl.classList.add("ch-hidden");
  if (toggleIcon) toggleIcon.className = "pi pi-chevron-down";
}

/**
 * Re-run the comparison after a scrape completes (triggered when the user
 * clicked "Periksa" before any data was scraped). Uses the textarea content
 * and the freshly scraped data.
 */
export function runPendingCompare(): void {
  const textarea = document.getElementById("ch-comparer-textarea") as HTMLTextAreaElement;
  const scrapedData = getScrapedData();
  if (!textarea || !textarea.value.trim() || !scrapedData || scrapedData.length === 0) return;

  const pastedRows = parsePastedData(textarea.value);
  if (pastedRows.length === 0) return;

  runComparison(pastedRows, scrapedData);
}

// ── Render results table ──────────────────────────────

function renderResults(): void {
  const container = document.getElementById("ch-comparer-results");
  if (!container) return;

  container.classList.remove("ch-hidden");
  container.innerHTML = "";

  if (currentResults.length === 0) {
    container.textContent = "Tidak ada data untuk ditampilkan.";
    return;
  }

  const totalPages = Math.max(1, Math.ceil(currentResults.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageRows = currentResults.slice(start, start + PAGE_SIZE);

  const table = document.createElement("table");
  table.className = "ch-comparer-table";

  // Header
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  const headers = [
    "No",
    "Referensi",
    "Nama Pembeli",
    "DPP Coretax",
    "DPP Baru",
    "PPN Coretax",
    "PPN Baru",
    "Status",
    "",
  ];
  for (const h of headers) {
    const th = document.createElement("th");
    th.textContent = h;
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Body
  const tbody = document.createElement("tbody");
  pageRows.forEach((r, idx) => {
    const tr = document.createElement("tr");
    tr.className = `ch-comparer-row-${r.status.toLowerCase()}`;

    const formatNum = (n: number | null): string => {
      if (n === null) return "-";
      return n.toLocaleString("id-ID");
    };

    const statusLabel = (() => {
      switch (r.status) {
        case "COCOK": return "Cocok";
        case "BERBEDA": return "Berbeda";
        case "TIDAK_DITEMUKAN": return "Tidak ditemukan";
      }
    })();

    const cells = [
      String(start + idx + 1),
      r.reference,
      r.buyerName,
      formatNum(r.dppSistem),
      formatNum(r.dppExcel),
      formatNum(r.ppnSistem),
      formatNum(r.ppnExcel),
      statusLabel,
    ];

    cells.forEach((c, i) => {
      const td = document.createElement("td");
      td.textContent = c;
      // Right-align numeric columns (DPP/PPN) and the No column
      if (i === 0 || i === 3 || i === 4 || i === 5 || i === 6) {
        td.classList.add("ch-comparer-num");
      }
      tr.appendChild(td);
    });

    // Search button (far right)
    const actionTd = document.createElement("td");
    actionTd.className = "ch-comparer-action";
    const searchBtn = document.createElement("button");
    searchBtn.type = "button";
    searchBtn.className = "ch-comparer-search-btn";
    searchBtn.title = "Cari referensi ini di Coretax";
    const searchIcon = document.createElement("span");
    searchIcon.className = "pi pi-search";
    searchIcon.setAttribute("aria-hidden", "true");
    searchBtn.appendChild(searchIcon);
    searchBtn.addEventListener("click", () => {
      searchReference(r.reference);
    });
    actionTd.appendChild(searchBtn);
    tr.appendChild(actionTd);

    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);

  // Pagination
  if (totalPages > 1) {
    const pagination = document.createElement("div");
    pagination.className = "ch-comparer-pagination";

    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "ch-comparer-page-btn";
    prevBtn.textContent = "Sebelumnya";
    prevBtn.disabled = currentPage === 1;
    prevBtn.addEventListener("click", () => {
      if (currentPage > 1) {
        currentPage--;
        renderResults();
      }
    });

    const pageInfo = document.createElement("span");
    pageInfo.className = "ch-comparer-page-info";
    pageInfo.textContent = `Halaman ${currentPage} dari ${totalPages}`;

    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "ch-comparer-page-btn";
    nextBtn.textContent = "Berikutnya";
    nextBtn.disabled = currentPage === totalPages;
    nextBtn.addEventListener("click", () => {
      if (currentPage < totalPages) {
        currentPage++;
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

  if (currentResults.length === 0) return;

  const headers = [
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
    "Status",
  ];

  const formatNum = (n: number | null): string => {
    if (n === null) return "";
    return n.toLocaleString("id-ID");
  };

  const rows: string[][] = [headers];
  currentResults.forEach((r, idx) => {
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
      r.status,
    ]);
  });

  // Generate CSV with BOM for Excel compatibility
  let csv = "\uFEFF";
  for (const row of rows) {
    csv += row
      .map((cell) => {
        if (cell.includes(",") || cell.includes('"') || cell.includes("\n")) {
          return `"${cell.replace(/"/g, '""')}"`;
        }
        return cell;
      })
      .join(",") + "\n";
  }

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "perbandingan-faktur.csv";
  a.click();
  URL.revokeObjectURL(url);
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
