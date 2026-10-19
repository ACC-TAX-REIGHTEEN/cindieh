// ============================================================
// BUTTON-STATE.TS — Shared export button element references
// ============================================================
// Extracted from ui.ts to break the circular dependency
// ui.ts ↔ ui-badge.ts. Both modules import button refs from
// here instead of from each other.
//
// Variables are module-private. All external access goes through
// getters and setters to prevent accidental mutation from outside.
// ============================================================

let _exportBtnEl: HTMLButtonElement | null = null;        // withholding page: single "Download PDF" button
let _exportDropdownBtnEl: HTMLButtonElement | null = null; // non-withholding: export dropdown main button
let _pdfBtnEl: HTMLButtonElement | null = null;            // efaktur: "Download PDF" button
let _scrapeBtnEl: HTMLButtonElement | null = null;         // efaktur: "Scrape Data" icon button
// efaktur: the Bandingkan / Pengecekan panel's toolbar entry. One button named
// for the tab its page can serve (ui.ts, ADR-0025) — and named for the PANEL,
// not for the Komparator, because on three of the four grids it opens
// Pengecekan rather than a comparison (ADR-0028 took the same step for the
// facts behind its label).
let _panelBtnEl: HTMLButtonElement | null = null;

// ── Getters ───────────────────────────────────────────

export function getExportBtnEl(): HTMLButtonElement | null {
  return _exportBtnEl;
}

export function getExportDropdownBtnEl(): HTMLButtonElement | null {
  return _exportDropdownBtnEl;
}

export function getPdfBtnEl(): HTMLButtonElement | null {
  return _pdfBtnEl;
}

export function getScrapeBtnEl(): HTMLButtonElement | null {
  return _scrapeBtnEl;
}

export function getPanelBtnEl(): HTMLButtonElement | null {
  return _panelBtnEl;
}

// ── Setters ───────────────────────────────────────────

export function setExportBtnEl(el: HTMLButtonElement | null): void {
  _exportBtnEl = el;
}

export function setExportDropdownBtnEl(el: HTMLButtonElement | null): void {
  _exportDropdownBtnEl = el;
}

export function setPdfBtnEl(el: HTMLButtonElement | null): void {
  _pdfBtnEl = el;
}

export function setScrapeBtnEl(el: HTMLButtonElement | null): void {
  _scrapeBtnEl = el;
}

export function setPanelBtnEl(el: HTMLButtonElement | null): void {
  _panelBtnEl = el;
}

export function resetAllButtonRefs(): void {
  _exportBtnEl = null;
  _exportDropdownBtnEl = null;
  _pdfBtnEl = null;
  _scrapeBtnEl = null;
  _panelBtnEl = null;
}
