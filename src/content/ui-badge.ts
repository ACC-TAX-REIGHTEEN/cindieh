// ============================================================
// UI-BADGE.TS — Floating info bar, badge, and panel state
// ============================================================
// Manages the bottom-right floating badge/info panel that
// displays scrape progress, stats, and completion status.
// ============================================================

import { isWithholdingPage } from "./page-context";
import { exportBtnEl, xlsxBtnEl, csvBtnEl } from "./button-state";

// ── Floating Info State ──────────────────────────────

let badgeEl: HTMLDivElement | null = null;
let statsEl: HTMLDivElement | null = null;
let isPanelRunning = false;

type ExportButtonKind = "xlsx" | "csv" | "pdf";

export function getIdlePanelStatus(): string {
  return "Tidak ada proses berjalan. Mulai ekspor dari tombol Better Export.";
}

export function getToggledPanelVisibility(isCurrentlyVisible: boolean): boolean {
  return !isCurrentlyVisible;
}

export function getExportButtonLabel(kind: ExportButtonKind, isRunning: boolean): string {
  if (isRunning) return "Berhenti";
  if (kind === "xlsx") return "Ekspor XLSX";
  if (kind === "csv") return "Ekspor CSV";
  return "Unduh PDF";
}

interface FloatingElements {
  statusText: HTMLDivElement;
  statTotal: HTMLSpanElement;
  statPages: HTMLSpanElement;
  statTime: HTMLSpanElement;
  progressBar: HTMLDivElement;
}

let els: FloatingElements | null = null;

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
    const shouldShow = getToggledPanelVisibility(!statsEl.classList.contains("ch-hidden"));
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

function getExportButtonIcon(kind: ExportButtonKind, isRunning: boolean): string {
  if (isRunning) return "pi pi-spin pi-spinner";
  if (kind === "xlsx") return "pi pi-file-excel";
  if (kind === "csv") return "pi pi-file";
  return "pi pi-download";
}

function setExportButtonState(btn: HTMLButtonElement | null, kind: ExportButtonKind, isRunning: boolean): void {
  if (!btn) return;
  const icon = btn.querySelector(".p-button-icon") as HTMLElement | null;
  if (icon) icon.className = `p-button-icon p-button-icon-left ${getExportButtonIcon(kind, isRunning)} mr-1`;

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

// ── Public API: Update Floating Info Bar ───────────────

export function updatePanelProgress(total: number, page: number, elapsed: string, status: string): void {
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

export function updatePanelComplete(total: number, pages: number, elapsed: string, failureCount?: number): void {
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

/**
 * Clean up badge DOM elements and nullify refs.
 * Called by removeExportButton in ui.ts.
 */
export function destroyBadge(): void {
  const container = document.getElementById("ch-floating-info-container");
  if (container) container.remove();
  els = null;
  badgeEl = null;
}
