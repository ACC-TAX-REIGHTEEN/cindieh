// ============================================================
// EXPORTER.TS — Export scraped data to various formats
// ============================================================
// SheetJS is loaded LAZILY from its own chunk (content/xlsx.js); see
// loadXLSX below. Nothing here imports "xlsx" statically, which is what keeps
// ~330KB out of the content script that every portal page load parses.
//
// The workbook builders therefore take the loaded module as a parameter rather
// than closing over it: they stay pure, stay unit-testable with a plain
// `import * as XLSX from "xlsx"` in the test, and make the one real dependency
// of the export path visible at each call site.
import type { ExportSource } from "./page-context";
// Type-only: erased at compile time, so this costs nothing in the bundle. The
// runtime library arrives through the lazily-imported chunk instead.
import type { WorkBook } from "xlsx";
import { browserAPI } from "./browser-shim";
import { debugError, debugWarn } from "./debug";
import { extractYear, extractMonth, extractYMD, getCurrentYearMonthWIB } from "./tax-date";
import { CAPTURED_COLUMNS, getExportSourceSpec, mapColumns } from "./export-source";
import { normalizeFilenamePrefix } from "../shared/extension-preferences";

export type ExportMode = "cleaned" | "raw";

export interface ExportData {
  data: Record<string, unknown>[];
  fields: string[];
  filenameHint?: string;
  source?: ExportSource;
  mode?: ExportMode;
  /**
   * User-chosen prefix (popup) placed in front of the per-source prefix in the
   * generated XLSX/CSV filename. Sanitized here as well as at the storage
   * boundary, because tests and other callers construct ExportData directly.
   */
  filenamePrefix?: string;
  /**
   * These rows came from a sweep the user stopped (run-lifecycle.salvage).
   *
   * It only changes the name, and it has to: a stopped year-wide sweep still
   * holds real rows, but ten months read exactly like twelve once they are in a
   * file. Marked here rather than at each call site so every export path of
   * every source inherits it.
   */
  partialSweep?: boolean;
}

/**
 * The word a partial sweep's filename carries, after the period or year.
 *
 * Read by a person next to the portal, so it is the panel's own Indonesian for
 * it ("sebagian" = partial) and not a code: `FPM-2026-sebagian.xlsx` says what
 * happened without a legend.
 */
export const PARTIAL_SWEEP_MARKER = "sebagian";

function downloadFile(content: string | BlobPart, filename: string, mimeType: string): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function escapeCSV(value: unknown): string {
  if (value == null) return "";
  let s = String(value);
  if (
    typeof value !== "number" &&
    // Prefix a leading apostrophe too: besides making the escape injective
    // (so `'-` and `'=1` round-trip), Excel consumes a single leading `'` as
    // its "text" marker — doubling it preserves a literal apostrophe in data.
    (s.startsWith("'") ||
      /^[=\+@\t\r]/.test(s) ||
      (s.startsWith("-") && isNaN(Number(s))))
  ) {
    s = `'${s}`;
  }
  return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Build a CSV string from rows of string cells, applying CSV escaping.
 * Prepends a UTF-8 BOM so Excel opens it with the right encoding.
 */
export function buildCSV(rows: readonly (readonly unknown[])[]): string {
  let csv = "\uFEFF";
  for (const row of rows) {
    csv += `${row.map(escapeCSV).join(",")}\n`;
  }
  return csv;
}

/** Trigger a browser download for text content. */
export function downloadTextFile(content: string, filename: string, mimeType: string): void {
  downloadFile(content, filename, mimeType);
}

export interface AoaXLSXOptions {
  /** Zero-based column index to Excel number format. Only numeric cells are formatted. */
  numberFormats?: Readonly<Record<number, string>>;
}

export const RESULT_NUMBER_FORMAT = "#,##0.##########";
export const RESULT_DIFFERENCE_FORMAT = "+#,##0.##########;-#,##0.##########;0";

/** The SheetJS module as this project consumes it. */
export type XlsxModule = typeof import("xlsx");

/** Path of the lazily-loaded SheetJS chunk; a web-accessible resource. */
export const XLSX_CHUNK_PATH = "content/xlsx.js";

/**
 * Import the SheetJS chunk. The specifier is a parameter on purpose: a
 * non-literal specifier is what makes esbuild leave this `import()` in place
 * instead of inlining the library into content/main.js.
 */
export function importXlsxChunk(url: string): Promise<XlsxModule> {
  return import(url).then((module) => (module.default ?? module) as XlsxModule);
}

/**
 * One cached chunk load. Exported as a factory so the caching and the
 * retry-on-failure rule can be tested without a real extension URL, and used
 * as a singleton in production.
 */
export function createXlsxChunkLoader(importer: (url: string) => Promise<XlsxModule>) {
  let pending: Promise<XlsxModule> | null = null;
  return {
    /** Resolve the chunk, importing at most once per successful load. */
    load(url: string): Promise<XlsxModule> {
      pending ??= importer(url).catch((err: unknown) => {
        // A failed load must not poison every later export: drop the cache so
        // the next attempt re-imports instead of replaying the same rejection.
        pending = null;
        debugError("Gagal memuat pustaka Excel", err);
        throw err;
      });
      return pending;
    },
  };
}

const xlsxChunk = createXlsxChunkLoader(importXlsxChunk);

/**
 * Load SheetJS, on the first XLSX export of the session.
 *
 * This is the seam that keeps the library off the page-load path: nothing in
 * the content script references it until an export actually asks for a
 * spreadsheet. The CSV path never calls this at all — `buildCSV` is
 * hand-rolled and needs no library.
 */
export function loadXLSX(): Promise<XlsxModule> {
  return xlsxChunk.load(browserAPI.runtime.getURL(XLSX_CHUNK_PATH));
}

export function buildAoaWorkbook(
  xlsx: XlsxModule,
  rows: readonly (readonly unknown[])[],
  sheetName = "Sheet1",
  options: AoaXLSXOptions = {},
): WorkBook {
  const worksheet = xlsx.utils.aoa_to_sheet(rows as unknown[][]);
  for (const [column, format] of Object.entries(options.numberFormats ?? {})) {
    for (let row = 1; row < rows.length; row++) {
      const cell = worksheet[xlsx.utils.encode_cell({ r: row, c: Number(column) })];
      if (cell?.t === "n") cell.z = format;
    }
  }
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, sheetName);
  return workbook;
}

export const XLSX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** UTF-8, matching the BOM buildCSV already prepends. */
export const CSV_MIME_TYPE = "text/csv;charset=utf-8";

/**
 * Build the workbook and trigger the browser download, with an
 * already-loaded SheetJS. Pure and synchronous — see downloadXLSXFile for the
 * lazy entry point the UI calls.
 */
export function downloadWorkbookFile(
  xlsx: XlsxModule,
  rows: readonly (readonly unknown[])[],
  filename: string,
  sheetName = "Sheet1",
  options: AoaXLSXOptions = {},
): void {
  const workbook = buildAoaWorkbook(xlsx, rows, sheetName, options);
  const excelBuffer = xlsx.write(workbook, { bookType: "xlsx", type: "array" });
  downloadFile(excelBuffer, filename, XLSX_MIME_TYPE);
}

/**
 * Trigger a browser download for an XLSX spreadsheet generated from a 2D
 * array of rows (AOA — "array of arrays").
 *
 * Deliberately separate from exportXLSX (json_to_sheet): this path feeds
 * pre-built typed 2D grids — e.g. the comparer results table in
 * ui-comparer.ts — whose rows are already shaped and labeled. json_to_sheet
 * would add nothing but overhead there. Keep the two writers distinct; they
 * serve different data shapes.
 */
export async function downloadXLSXFile(
  rows: readonly (readonly unknown[])[],
  filename: string,
  sheetName = "Sheet1",
  options: AoaXLSXOptions = {},
): Promise<void> {
  downloadWorkbookFile(await loadXLSX(), rows, filename, sheetName, options);
}

/**
 * Trigger a browser download of the same pre-built AOA grid as a CSV file.
 *
 * The mirror of downloadXLSXFile for callers that want the text format, and
 * deliberately library-free: buildCSV is hand-rolled, so this path never loads
 * the SheetJS chunk and works even when that chunk fails to load. The comparer
 * and checker result grids use it, which is why offering CSV there costs
 * nothing — the grid export's own CSV path already proved the shape.
 */
export function downloadCSVFile(
  rows: readonly (readonly unknown[])[],
  filename: string,
): void {
  downloadTextFile(buildCSV(rows), filename, CSV_MIME_TYPE);
}

/**
 * Map scraped rows onto the columns their source declares.
 *
 * Every branch this used to have is now a declaration in `export-source.ts`;
 * all that is left here is choosing the declaration and reporting drift. The
 * returned object is an `ExportData` so the existing destructuring in the
 * writers stays unchanged.
 */
export function processData(exportData: ExportData): ExportData {
  if (exportData.mode === "raw") {
    // Raw mode expects to match nothing in particular — it dumps whatever the
    // grid returned — so it has no drift warning, only the ISO date catch.
    const { data, fields } = mapColumns(CAPTURED_COLUMNS, exportData.data, exportData.fields);
    return { data, fields, source: exportData.source, mode: exportData.mode };
  }

  const spec = getExportSourceSpec(exportData.source);
  const { data, fields, drift } = mapColumns(spec.columns, exportData.data, exportData.fields);
  if (drift && spec.driftWarning) {
    debugWarn(spec.driftWarning, { expected: drift.expected, sampleRow: drift.sampleRow });
  }

  return { data, fields, source: exportData.source };
}

export function generateDynamicFilename(exportData: ExportData): string {
  const name = buildDynamicFilename(exportData);
  // One place decides every grid filename, so the partial marker cannot be
  // forgotten by a caller: a stopped sweep's export is a real file of an
  // unfinished request, and its name is the only thing that can say so.
  return exportData.partialSweep ? `${name}-${PARTIAL_SWEEP_MARKER}` : name;
}

/** The name of the file, before any partial-sweep marker. */
function buildDynamicFilename(exportData: ExportData): string {
  const { data: originalData, filenameHint, source } = exportData;
  const spec = getExportSourceSpec(source);
  // The user's own prefix goes in FRONT of the per-source one, so `PTABC-FPK-072026`
  // still ends with the prefix the README documents. Bulk PDF filenames keep
  // their documented shape (see downloader.ts) and are not affected.
  const prefix = `${normalizeFilenamePrefix(exportData.filenamePrefix)}${spec.prefix}`;
  // A retur file is named for the return YEAR; everything else for the period.
  const yearOnly = spec.filename.shape === "tahun";

  const formatPeriod = (p: string) => {
    // 1. Handle internal format YYYY_MM
    if (p.includes("_")) {
      const parts = p.split("_");
      if (parts.length === 2 && parts[0].length === 4 && parts[1].length === 2) {
        return `${parts[1]}${parts[0]}`; // MMYYYY
      }
    }

    // 2. Clear non-digits to handle cases like TD007-2026-04 -> 007202604
    const digits = p.replace(/\D/g, "");

    // 3. Try to find YYYYMM (6 digits) at the end or as a standalone
    const yyyymmMatch = digits.match(/(\d{4})(\d{2})$/);
    if (yyyymmMatch) {
      const y = parseInt(yyyymmMatch[1]);
      const m = parseInt(yyyymmMatch[2]);
      if (y > 1900 && y < 2100 && m >= 1 && m <= 12) {
        return `${yyyymmMatch[2]}${yyyymmMatch[1]}`; // MMYYYY
      }
    }

    // 4. Try to find MMYYYY (6 digits)
    const mmyyyyMatch = digits.match(/(\d{2})(\d{4})$/);
    if (mmyyyyMatch) {
      const m = parseInt(mmyyyyMatch[1]);
      const y = parseInt(mmyyyyMatch[2]);
      if (y > 1900 && y < 2100 && m >= 1 && m <= 12) {
        return digits.slice(-6);
      }
    }

    return p.replace(/[^a-zA-Z0-9]/g, "");
  };

  if (filenameHint) {
    if (yearOnly) {
      const year = filenameHint.replace(/\D/g, "").match(/(20\d{2}|19\d{2})/)?.[1];
      if (year) return `${prefix}${year}`;
    }

    const formatted = formatPeriod(filenameHint);
    // If it's 6 digits (MMYYYY) or 4 digits (YYYY), use it
    if (/^\d{6}$/.test(formatted) || /^\d{4}$/.test(formatted)) {
      return `${prefix}${formatted}`;
    }

    // The PPh 21 lampiran are filtered by an article code, not by masa, so a
    // hint that is not a period at all is still the best name available.
    if (spec.filename.looseHint && formatted.length >= 4) {
      return `${prefix}${formatted}`;
    }
  }

  // Helper to get periods from data rows
  const extractPeriodsFromData = () => {
    const found = new Set<string>();
    if (!originalData) return [];
    for (const row of originalData) {
      let y = "";
      let m = "";

      // Priority 1: Specific Tax Period fields (common names in Coretax JSON)
      const rawY = row["TaxInvoiceYear"] || row["TaxPeriodYear"] || row["TaxYear"] || row["Year"];
      const rawM = row["TaxInvoicePeriod"] || row["TaxPeriodMonth"] || row["TaxPeriod"] || row["Month"];

      if (rawY && rawM) {
        const sY = String(rawY);
        const sM = String(rawM);
        y = extractYear(sY);
        m = extractMonth(sM).padStart(2, "0");
      }
      // Priority 2: Consolidated TaxPeriod (usually YYYYMM or TD007-YYYY-MM)
      else if (row["TaxPeriod"]) {
        const sP = String(row["TaxPeriod"]);
        y = extractYear(sP);
        m = extractMonth(sP).padStart(2, "0");
      }
      // Fallback: Date fields (Last Resort - only if no period fields found).
      // Which date field is the source's own decision — Lampiran A2 carries no
      // tax period at all, and a Bukti Potong row carries only a slip date.
      else {
        const dateField = spec.filename.periodDateFields
          .map((field) => row[field])
          .find((value) => Boolean(value));
        const ymd = extractYMD(dateField);
        if (ymd) {
          y = ymd.year;
          m = ymd.month;
        }
      }

      if (y && m && y.length === 4 && m.length === 2) {
        found.add(`${y}_${m}`); // YYYY_MM
      }
    }
    return Array.from(found).sort();
  };

  const dataPeriods = extractPeriodsFromData();

  // PRIORITY 2 (after filenameHint): USE DATA ROWS. A retur's rows hold the
  // INVOICE's masa, not the return year, so they are never used for its name.
  if (dataPeriods.length > 0 && !yearOnly) {
    if (dataPeriods.length === 1) {
      return `${prefix}${formatPeriod(dataPeriods[0])}`;
    }
    return `${prefix}${formatPeriod(dataPeriods[0])}-${formatPeriod(dataPeriods[dataPeriods.length - 1])}`;
  }

  // FALLBACK: CURRENT DATE (Asia/Jakarta, UTC+7 timezone-safe)
  const { year: yString, month: mString } = getCurrentYearMonthWIB();
  return yearOnly ? `${prefix}${yString}` : `${prefix}${mString}${yString}`;
}

export function exportCSV(exportData: ExportData): void {
  const filename = generateDynamicFilename(exportData);
  const { data, fields } = processData(exportData);

  const rows = [fields, ...data.map((row) => fields.map((f) => row[f]))];
  downloadTextFile(buildCSV(rows), `${filename}.csv`, CSV_MIME_TYPE);
}

/** The grid export with an already-loaded SheetJS. Pure and synchronous. */
export function writeXlsxFile(xlsx: XlsxModule, exportData: ExportData): void {
  const filename = generateDynamicFilename(exportData);
  const { data, fields } = processData(exportData);

  // JSON → sheet with an explicit header: the main export flow keeps data as
  // row objects keyed by field name, so json_to_sheet + { header: fields }
  // preserves column order and typing. Deliberately separate from
  // downloadXLSXFile (aoa_to_sheet), which serves pre-shaped 2D grids.
  const worksheet = xlsx.utils.json_to_sheet(data, { header: fields });
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, "Faktur");

  const excelBuffer = xlsx.write(workbook, { bookType: "xlsx", type: "array" });

  downloadFile(excelBuffer, `${filename}.xlsx`, XLSX_MIME_TYPE);
}

/** The grid export. Loads the SheetJS chunk first — the only place it is needed. */
export async function exportXLSX(exportData: ExportData): Promise<void> {
  writeXlsxFile(await loadXLSX(), exportData);
}
