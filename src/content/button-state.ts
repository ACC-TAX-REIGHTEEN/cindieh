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
let _compareBtnEl: HTMLButtonElement | null = null;        // efaktur: "Bandingkan" icon button

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

export function getCompareBtnEl(): HTMLButtonElement | null {
  return _compareBtnEl;
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

export function setCompareBtnEl(el: HTMLButtonElement | null): void {
  _compareBtnEl = el;
}

export function resetAllButtonRefs(): void {
  _exportBtnEl = null;
  _exportDropdownBtnEl = null;
  _pdfBtnEl = null;
  _scrapeBtnEl = null;
  _compareBtnEl = null;
}
