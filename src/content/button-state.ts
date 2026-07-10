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

let _exportBtnEl: HTMLButtonElement | null = null; // withholding page: single "Download PDF" button
let _xlsxBtnEl: HTMLButtonElement | null = null;   // non-withholding: "Export XLSX" button
let _csvBtnEl: HTMLButtonElement | null = null;    // non-withholding: "Export CSV" button
let _pdfBtnEl: HTMLButtonElement | null = null;    // efaktur: "Download PDF" button

// ── Getters ───────────────────────────────────────────

export function getExportBtnEl(): HTMLButtonElement | null {
  return _exportBtnEl;
}

export function getXlsxBtnEl(): HTMLButtonElement | null {
  return _xlsxBtnEl;
}

export function getCsvBtnEl(): HTMLButtonElement | null {
  return _csvBtnEl;
}

export function getPdfBtnEl(): HTMLButtonElement | null {
  return _pdfBtnEl;
}

// ── Setters ───────────────────────────────────────────

export function setExportBtnEl(el: HTMLButtonElement | null): void {
  _exportBtnEl = el;
}

export function setXlsxBtnEl(el: HTMLButtonElement | null): void {
  _xlsxBtnEl = el;
}

export function setCsvBtnEl(el: HTMLButtonElement | null): void {
  _csvBtnEl = el;
}

export function setPdfBtnEl(el: HTMLButtonElement | null): void {
  _pdfBtnEl = el;
}

export function resetAllButtonRefs(): void {
  _exportBtnEl = null;
  _xlsxBtnEl = null;
  _csvBtnEl = null;
  _pdfBtnEl = null;
}
