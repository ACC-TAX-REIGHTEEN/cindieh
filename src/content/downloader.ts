/**
 * DOWNLOADER.TS — Logic for handling PDF downloads with custom naming
 */

export interface WithholdingSlip {
  WithholdingSlipsNumber: string;
  WithholdingSlipsDate: string; // "2026-01-31T00:00:00+07:00"
  EmployerName: string;
  [key: string]: any;
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
    const d = new Date(item.WithholdingSlipsDate);
    if (!isNaN(d.getTime())) {
      month = String(d.getMonth() + 1).padStart(2, "0");
      year = String(d.getFullYear());
    }
  }

  const nomor = (item.WithholdingSlipsNumber || "TANPA_NOMOR").replace(
    /[/\\?%*:|"<>]/g,
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
  item: any,
  reference?: string,
): string {
  const ref = (reference || item.Reference || "TANPA_REFERENSI")
    .replace(/[/\\?%*:|"<>]/g, "-")
    .trim();

  const invoiceNumber = (item.LetterNumber || item.TaxInvoiceNumber || "000")
    .replace(/[/\\?%*:|"<>]/g, "-")
    .trim();

  return `${ref} - ${invoiceNumber}.pdf`;
}

/**
 * Formats Input Tax PDF filename
 */
export function generateInputTaxFilename(item: any): string {
  const ref = (item.Reference || "TANPA_REFERENSI")
    .replace(/[/\\?%*:|"<>]/g, "-")
    .trim();

  const invoiceNumber = (item.TaxInvoiceNumber || item.LetterNumber || "000")
    .replace(/[/\\?%*:|"<>]/g, "-")
    .trim();

  return `${ref} - ${invoiceNumber}.pdf`;
}

/**
 * Formats Return PDF filename (output return or input return)
 */
export function generateReturnFilename(item: any): string {
  const ref = (
    item.ReturnNumber ||
    item.Reference ||
    item.DocumentNumber ||
    "TANPA_REFERENSI"
  )
    .replace(/[/\\?%*:|"<>]/g, "-")
    .trim();

  const invoiceNumber = (
    item.TaxInvoiceNumber ||
    item.LetterNumber ||
    item.ReturnInvoiceNumber ||
    "000"
  )
    .replace(/[/\\?%*:|"<>]/g, "-")
    .trim();

  return `${ref} - ${invoiceNumber}.pdf`;
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
      filename = generateOutputTaxFilename(item as any);
      break;
    case "INPUT_TAX":
      filename = generateInputTaxFilename(item as any);
      break;
    case "OUTPUT_RETURN":
    case "INPUT_RETURN":
      filename = generateReturnFilename(item as any);
      break;
    default:
      filename = generateWithholdingFilename(item as WithholdingSlip);
      break;
  }

  downloadBlob(blob, filename);
}
