// ============================================================
// BUTTON-STATE.TS — Shared export button element references
// ============================================================
// Extracted from ui.ts to break the circular dependency
// ui.ts ↔ ui-badge.ts. Both modules import button refs from
// here instead of from each other.
// ============================================================

export let exportBtnEl: HTMLButtonElement | null = null; // withholding page: single "Download PDF" button
export let xlsxBtnEl: HTMLButtonElement | null = null; // non-withholding: "Export XLSX" button
export let csvBtnEl: HTMLButtonElement | null = null; // non-withholding: "Export CSV" button
export let pdfBtnEl: HTMLButtonElement | null = null; // efaktur: "Download PDF" button

export function setExportBtnEl(el: HTMLButtonElement | null): void {
  exportBtnEl = el;
}

export function setXlsxBtnEl(el: HTMLButtonElement | null): void {
  xlsxBtnEl = el;
}

export function setCsvBtnEl(el: HTMLButtonElement | null): void {
  csvBtnEl = el;
}

export function setPdfBtnEl(el: HTMLButtonElement | null): void {
  pdfBtnEl = el;
}

export function resetAllButtonRefs(): void {
  exportBtnEl = null;
  xlsxBtnEl = null;
  csvBtnEl = null;
  pdfBtnEl = null;
}
