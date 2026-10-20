/**
 * DOWNLOADER.TS — Logic for handling PDF downloads with custom naming
 */

import { extractYMD } from "./tax-date";
import { debugWarn } from "./debug";
import { rowInvoiceNumber, rowName } from "./row-name";

export interface WithholdingSlip {
  WithholdingSlipsNumber: string;
  WithholdingSlipsDate: string; // "2026-01-31T00:00:00+07:00"
  EmployerName: string;
  [key: string]: unknown;
}

/** Common shape of an efaktur/return row used for PDF naming. */
export interface PdfItem {
  Reference?: string;
  LetterNumber?: string;
  TaxInvoiceNumber?: string;
  ReturnNumber?: string;
  DocumentNumber?: string;
  ReturnInvoiceNumber?: string;
  [key: string]: unknown;
}

/**
 * Utility to download a blob as a file in the browser
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Converts Base64 string to Blob
 */
export function base64ToBlob(
  base64: string,
  mimeType = "application/pdf",
): Blob {
  if (!base64) throw new Error("base64ToBlob: input is empty");
  // atob throws a DOMException on invalid base64 — let it propagate
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: mimeType });
}

/**
 * Formats the filename as MM-YYYY-Nomor-Nama.pdf
 */
export function generateWithholdingFilename(item: WithholdingSlip): string {
  let month = "00";
  let year = new Date().getFullYear().toString();

  if (item.WithholdingSlipsDate) {
    // Parse the calendar date directly from the ISO string to avoid
    // timezone-dependent shifts from `new Date("...+07:00")`.
    const ymd = extractYMD(item.WithholdingSlipsDate);
    if (ymd) {
      year = ymd.year;
      month = ymd.month;
    } else {
      const d = new Date(item.WithholdingSlipsDate);
      if (!isNaN(d.getTime())) {
        month = String(d.getMonth() + 1).padStart(2, "0");
        year = String(d.getFullYear());
      }
    }
  }

  // The slip number, in either spelling the portal carries it — the same
  // ladder the panel reports the slip under, so a failure report and the file
  // it names cannot disagree about which slip failed.
  const nomor = (rowName(item, "WITHHOLDING_SLIPS") || "TANPA_NOMOR").replace(
    /[/\\?%*:| "<>]/g,
    "-",
  );
  const nama = (item.EmployerName || "TANPA_NAMA")
    .replace(/[/\\?%*:|"<>]/g, "_")
    .substring(0, 50);

  return `${month}-${year}-${nomor}-${nama}.pdf`;
}

/**
 * Formats Output Tax PDF filename as Reference - InvoiceNumber.pdf
 */
export function generateOutputTaxFilename(
  item: PdfItem,
  reference?: string,
): string {
  // The row's name and the invoice it belongs to — the two lists the panel
  // reports the row under, so a failure report and the file it names cannot
  // disagree about which row failed.
  const ref = (reference || rowName(item, "OUTPUT_TAX") || "TANPA_REFERENSI")
    .replace(/[/\\?%*:| "<>]/g, "-")
    .trim();

  const invoiceNumber = (rowInvoiceNumber(item, "OUTPUT_TAX") || "000")
    .replace(/[/\\?%*:| "<>]/g, "-")
    .trim();

  return `${ref} - ${invoiceNumber}.pdf`;
}

/**
 * Formats Input Tax PDF filename
 */
export function generateInputTaxFilename(item: PdfItem): string {
  const ref = (rowName(item, "INPUT_TAX") || "TANPA_REFERENSI")
    .replace(/[/\\?%*:| "<>]/g, "-")
    .trim();

  const invoiceNumber = (rowInvoiceNumber(item, "INPUT_TAX") || "000")
    .replace(/[/\\?%*:| "<>]/g, "-")
    .trim();

  return `${ref} - ${invoiceNumber}.pdf`;
}

/**
 * Formats Return PDF filename (output return or input return)
 */
export function generateReturnFilename(item: PdfItem): string {
  const ref = (rowName(item, "OUTPUT_RETURN") || "TANPA_REFERENSI")
    .replace(/[/\\?%*:| "<>]/g, "-")
    .trim();

  const invoiceNumber = (rowInvoiceNumber(item, "OUTPUT_RETURN") || "000")
    .replace(/[/\\?%*:| "<>]/g, "-")
    .trim();

  return `${ref} - ${invoiceNumber}.pdf`;
}

/**
 * Formats a generic PDF filename for unknown or unsupported PDF sources.
 */
export function generateGenericPdfFilename(
  item: PdfItem,
  source: string,
): string {
  const cleanSource = (source || "DOKUMEN")
    .replace(/[/\\?%*:| "<>]/g, "-")
    .trim();

  const ref = String(
    rowName(item, source) || "TANPA_NOMOR",
  )
    .replace(/[/\\?%*:| "<>]/g, "-")
    .trim();

  return `${cleanSource}-${ref}.pdf`;
}

/**
 * Handles a PDF download by converting base64 to Blob, selecting the appropriate
 * filename generator based on source, and triggering the browser download.
 */
export function handlePdfDownload(
  base64: string,
  item: Record<string, unknown>,
  source: string,
): void {
  const blob = base64ToBlob(base64);
  let filename: string;

  switch (source) {
    case "OUTPUT_TAX":
      filename = generateOutputTaxFilename(item as PdfItem);
      break;
    case "INPUT_TAX":
      filename = generateInputTaxFilename(item as PdfItem);
      break;
    case "OUTPUT_RETURN":
    case "INPUT_RETURN":
      filename = generateReturnFilename(item as PdfItem);
      break;
    case "WITHHOLDING_SLIPS":
      filename = generateWithholdingFilename(item as WithholdingSlip);
      break;
    default:
      debugWarn(`handlePdfDownload: Unknown or unhandled PDF source "${source}", using generic filename fallback.`);
      filename = generateGenericPdfFilename(item as PdfItem, source);
      break;
  }

  downloadBlob(blob, filename);
}
