// ============================================================
// EXPORTER.TS — Export scraped data to various formats
// ============================================================
import * as XLSX from "xlsx";
import type { ExportSource } from "./page-context";
import { debugWarn } from "./debug";
import { extractYear, extractMonth, formatDate, extractYMD, getCurrentYearMonthWIB } from "./tax-date";
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
}

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

export function buildAoaWorkbook(
  rows: readonly (readonly unknown[])[],
  sheetName = "Sheet1",
  options: AoaXLSXOptions = {},
): XLSX.WorkBook {
  const worksheet = XLSX.utils.aoa_to_sheet(rows as unknown[][]);
  for (const [column, format] of Object.entries(options.numberFormats ?? {})) {
    for (let row = 1; row < rows.length; row++) {
      const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: Number(column) })];
      if (cell?.t === "n") cell.z = format;
    }
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  return workbook;
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
export function downloadXLSXFile(
  rows: readonly (readonly unknown[])[],
  filename: string,
  sheetName = "Sheet1",
  options: AoaXLSXOptions = {},
): void {
  const workbook = buildAoaWorkbook(rows, sheetName, options);

  const excelBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  downloadFile(
    excelBuffer,
    filename,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
}

export function processData(exportData: ExportData): ExportData {
  if (exportData.mode === "raw") {
    const processedData = exportData.data.map((row) => {
      const newRow: Record<string, unknown> = {};
      for (const f of exportData.fields) {
        let val = row[f];
        if (typeof val === "string" && val.includes("T") && /^\d{4}-\d{2}-\d{2}T/.test(val)) {
          val = formatDate(val);
        }
        newRow[f] = val;
      }
      return newRow;
    });
    return { data: processedData, fields: exportData.fields, source: exportData.source, mode: exportData.mode };
  }

  const processMappedTaxColumns = (
    columns: readonly (readonly [string, string])[],
    warningMessage: string,
  ): ExportData => {
    const fields = columns.map(([, label]) => label);
    const processedData = exportData.data.map((row) => {
      const newRow: Record<string, unknown> = {};

      for (const [sourceField, outputField] of columns) {
        if (sourceField === "TaxInvoicePeriod" || sourceField === "PeriodCredit") {
          const rawMonth = row[sourceField] || row["TaxPeriodMonth"] || row["TaxPeriod"] || "";
          newRow[outputField] = rawMonth ? extractMonth(rawMonth).replace(/^0/, "") : "";
        } else if (sourceField === "TaxInvoiceYear" || sourceField === "YearCredit") {
          newRow[outputField] = extractYear(row[sourceField] || row["TaxPeriodYear"] || row["TaxPeriod"] || "");
        } else {
          let val = row[sourceField];
          if (sourceField === "TaxInvoiceDate" || sourceField === "ReturnDate") {
            val = formatDate(val);
          }
          newRow[outputField] = val;
        }
      }

      return newRow;
    });

    const sourceFields = columns.map(([sourceField]) => sourceField);
    const allUndefined = exportData.data.some((row) =>
      sourceFields.every((f) => row[f] === undefined || row[f] === null),
    );
    if (allUndefined) {
      debugWarn(warningMessage, {
        expected: sourceFields,
        sampleRow: exportData.data[0],
      });
    }

    return { data: processedData, fields, source: exportData.source };
  };

  if (exportData.source === "INPUT_TAX") {
    return processMappedTaxColumns(
      [
        ["TaxInvoiceDate", "TANGGAL"],
        ["TaxInvoicePeriod", "MASA"],
        ["TaxInvoiceYear", "TAHUN"],
        ["SellerTaxpayerName", "NAMA PENJUAL"],
        ["SellerTIN", "NO IDENTITAS PENJUAL"],
        ["TaxInvoiceNumber", "NO FAKTUR"],
        ["TaxInvoiceStatus", "STATUS"],
        ["BuyerStatus", "STATUS PEMBELI"],
        ["PeriodCredit", "MASA PENGKREDITAN"],
        ["YearCredit", "TAHUN PENGKREDITAN"],
        ["SellingPrice", "DPP"],
        ["OtherTaxBase", "DPP NILAI LAIN"],
        ["VAT", "PPN"],
        ["STLG", "PPNBM"],
        ["Reference", "REFERENSI"],
      ],
      "API schema may have changed: no INPUT_TAX fields matched in any row",
    );
  }

  if (exportData.source === "OUTPUT_RETURN") {
    return processMappedTaxColumns(
      [
        ["BuyerTIN", "NO IDENTITAS PEMBELI"],
        ["BuyerTaxpayerNameClear", "NAMA PEMBELI"],
        ["TaxInvoiceNumber", "NO FAKTUR"],
        ["TaxInvoiceDate", "TANGGAL"],
        ["ReturnNumber", "NO RETUR"],
        ["ReturnDate", "TANGGAL RETUR"],
        ["TaxInvoicePeriod", "MASA"],
        ["TaxInvoiceYear", "TAHUN"],
        ["BuyerStatus", "STATUS PEMBELI"],
        ["TaxInvoiceStatus", "STATUS"],
        ["SellingPrice", "DPP"],
        ["OtherTaxBase", "DPP NILAI LAIN"],
        ["VAT", "PPN"],
        ["STLG", "PPNBM"],
      ],
      "API schema may have changed: no OUTPUT_RETURN fields matched in any row",
    );
  }

  if (exportData.source === "INPUT_RETURN") {
    return processMappedTaxColumns(
      [
        ["SellerTIN", "NO IDENTITAS PENJUAL"],
        ["SellerTaxpayerName", "NAMA PENJUAL"],
        ["TaxInvoiceNumber", "NO FAKTUR"],
        ["TaxInvoiceDate", "TANGGAL"],
        ["ReturnNumber", "NO RETUR"],
        ["ReturnDate", "TANGGAL RETUR"],
        ["TaxInvoicePeriod", "MASA"],
        ["TaxInvoiceYear", "TAHUN"],
        ["BuyerStatus", "STATUS PEMBELI"],
        ["TaxInvoiceStatus", "STATUS"],
        ["SellingPrice", "DPP"],
        ["OtherTaxBase", "DPP NILAI LAIN"],
        ["VAT", "PPN"],
        ["STLG", "PPNBM"],
      ],
      "API schema may have changed: no INPUT_RETURN fields matched in any row",
    );
  }
  if (exportData.source === "WITHHOLDING_SLIPS") {
    // Withholding slips are the one supported grid whose cleaned column set is
    // not pinned by a settled field list. What the rest of the code does confirm:
    // the slip number arrives as `WithholdingSlipNumber` for the bulk-PDF flow
    // (scraper-xhr.ts) but as `WithholdingSlipsNumber` for the PDF filename
    // builder (downloader.ts), the slip date is `WithholdingSlipsDate`, and the
    // withholding agent is `EmployerName` / `TaxIdentificationNumber`. Each
    // column therefore accepts either spelling of the number, and the slip date
    // is what seeds TANGGAL as well as MASA/TAHUN — a withholding row carries no
    // separate tax-period field (extractFilenameHintFromBody and
    // extractPeriodsFromData both have nothing to read for this source). The
    // usual schema-drift warning fires when a row matches none of them, and the
    // "Asli" export mode dumps every captured field verbatim for anyone who
    // needs more than these columns.
    const withholdingColumns: {
      label: string;
      sources: string[];
      format?: "date" | "month" | "year";
    }[] = [
      { label: "NO BUKTI POTONG", sources: ["WithholdingSlipsNumber", "WithholdingSlipNumber"] },
      { label: "TANGGAL", sources: ["WithholdingSlipsDate"], format: "date" },
      { label: "MASA", sources: ["WithholdingSlipsDate"], format: "month" },
      { label: "TAHUN", sources: ["WithholdingSlipsDate"], format: "year" },
      { label: "NAMA PEMOTONG", sources: ["EmployerName"] },
      { label: "NPWP PEMOTONG", sources: ["TaxIdentificationNumber"] },
    ];
    const fields = withholdingColumns.map((column) => column.label);

    // First non-empty value among the candidate spellings of one column.
    const pick = (row: Record<string, unknown>, sources: string[]): unknown => {
      for (const source of sources) {
        const value = row[source];
        if (value !== undefined && value !== null && value !== "") return value;
      }
      return undefined;
    };

    const processedData = exportData.data.map((row) => {
      const newRow: Record<string, unknown> = {};
      for (const column of withholdingColumns) {
        const raw = pick(row, column.sources);
        if (column.format === "date") {
          newRow[column.label] = formatDate(raw);
        } else if (column.format === "month") {
          // MASA/TAHUN come from the slip date's own calendar digits, never via
          // `Date` (see tax-date.ts) — extractMonth only understands period
          // strings, so a full ISO date has to go through extractYMD.
          const month = extractYMD(raw)?.month ?? "";
          newRow[column.label] = month ? month.replace(/^0/, "") : "";
        } else if (column.format === "year") {
          newRow[column.label] = extractYMD(raw)?.year ?? "";
        } else {
          newRow[column.label] = raw;
        }
      }
      return newRow;
    });

    const allUndefined = exportData.data.some((row) =>
      withholdingColumns.every((column) => pick(row, column.sources) === undefined),
    );
    if (allUndefined) {
      debugWarn("API schema may have changed: no WITHHOLDING_SLIPS fields matched in any row", {
        expected: withholdingColumns.flatMap((column) => column.sources),
        sampleRow: exportData.data[0],
      });
    }

    return { data: processedData, fields, source: exportData.source };
  }

  if (exportData.source === "SPT_A2") {
    // Hardcoded columns for SPT Masa PPN Lampiran A2 based on user request
    const a2Fields = ["DocumentDate", "Name", "TIN", "DocumentNumber", "TaxBase", "OtherTaxBase", "VAT", "STLG"];

    const processedData = exportData.data.map((row) => {
      const newRow: Record<string, unknown> = {};
      for (const f of a2Fields) {
        let val = row[f];
        // Format document dates strictly as well as any internal ISO time string
        if (f === "DocumentDate") {
          val = formatDate(val);
        } else if (typeof val === "string" && val.includes("T") && /^\d{4}-\d{2}-\d{2}T/.test(val)) {
          val = formatDate(val);
        }
        newRow[f] = val;
      }
      return newRow;
    });

    // Runtime validation: check if hardcoded fields still match API response
    const allUndefined = processedData.some((row) => a2Fields.every((f) => row[f] === undefined || row[f] === null));
    if (allUndefined) {
      debugWarn("API schema may have changed: no A2 fields matched in any row", {
        expected: a2Fields,
        sampleRow: exportData.data[0],
      });
    }

    return { data: processedData, fields: a2Fields, source: exportData.source };
  }

  if (exportData.source === "SPT_B2" || (exportData.source && exportData.source.startsWith("PPH_21_"))) {
    // Dump every field as-is — SPT B2 and the PPh 21 lampiran share this shape
    const processedData = exportData.data.map((row) => {
      const newRow: Record<string, unknown> = {};
      for (const f of exportData.fields) {
        let val = row[f];
        // Catch ISO dates
        if (typeof val === "string" && val.includes("T") && /^\d{4}-\d{2}-\d{2}T/.test(val)) {
          val = formatDate(val);
        }
        newRow[f] = val;
      }
      return newRow;
    });
    return { data: processedData, fields: exportData.fields, source: exportData.source };
  }

  // Default fallback to OutputTax logic
  const outputTaxColumns = [
    ["TaxInvoiceDate", "TANGGAL"],
    ["TaxInvoicePeriod", "MASA"],
    ["TaxInvoiceYear", "TAHUN"],
    ["BuyerName", "NAMA PEMBELI"],
    ["BuyerTIN", "NO IDENTITAS PEMBELI"],
    ["TaxInvoiceNumber", "NO FAKTUR"],
    ["TaxInvoiceStatus", "STATUS"],
    ["BuyerStatus", "STATUS PEMBELI"],
    ["SellingPrice", "DPP"],
    ["OtherTaxBase", "DPP NILAI LAIN"],
    ["VAT", "PPN"],
    ["STLG", "PPNBM"],
    ["Reference", "REFERENSI"],
  ] as const;
  const hardcodedFields = outputTaxColumns.map(([, label]) => label);

  const processedData = exportData.data.map((row) => {
    const newRow: Record<string, unknown> = {};

    // Extract Masa (Period) - handle TD007 prefix or use TaxPeriodMonth
    let masa = "";
    const rawMonth = row["TaxInvoicePeriod"] || row["TaxPeriodMonth"] || row["TaxPeriod"] || "";
    if (rawMonth) {
      masa = extractMonth(rawMonth).replace(/^0/, ""); // Remove leading zero for display
    }

    // Extract Tahun (Year) - handle TD007 prefix or use separate field
    let tahun = extractYear(
      row["TaxInvoiceYear"] || row["TaxPeriodYear"] || row["TaxPeriod"] || "",
    );

    for (const [sourceField, outputField] of outputTaxColumns) {
      if (sourceField === "TaxInvoicePeriod") {
        newRow[outputField] = masa;
      } else if (sourceField === "TaxInvoiceYear") {
        newRow[outputField] = tahun;
      } else {
        let val = row[sourceField];
        if (sourceField === "TaxInvoiceDate") {
          val = formatDate(val);
        }
        newRow[outputField] = val;
      }
    }
    return newRow;
  });

  // Runtime validation: check if hardcoded fields still match API response
  const sourceFields = outputTaxColumns.map(([sourceField]) => sourceField);
  const allUndefined = exportData.data.some((row) =>
    sourceFields.every((f) => row[f] === undefined || row[f] === null),
  );
  if (allUndefined) {
    debugWarn("API schema may have changed: no hardcoded fields matched in any row", {
      expected: sourceFields,
      sampleRow: exportData.data[0],
    });
  }

  return { data: processedData, fields: hardcodedFields, source: exportData.source };
}

export const PREFIX_MAP: Record<ExportSource | "default", string> = {
  OUTPUT_TAX: "FPK-",
  INPUT_TAX: "FPM-",
  OUTPUT_RETURN: "RET-FPK-",
  INPUT_RETURN: "RET-FPM-",
  SPT_A2: "A2-",
  SPT_B2: "B2-",
  PPH_21_L1A: "PPH21-L1A-",
  PPH_21_L1B: "PPH21-L1B-",
  PPH_21_L2: "PPH21-L2-",
  PPH_21_L3: "PPH21-L3-",
  WITHHOLDING_SLIPS: "BP-",
  default: "FPK-",
};

export function generateDynamicFilename(exportData: ExportData): string {
  const { data: originalData, filenameHint, source } = exportData;
  const isA2 = source === "SPT_A2";
  const basePrefix =
    source && Object.prototype.hasOwnProperty.call(PREFIX_MAP, source)
      ? PREFIX_MAP[source as ExportSource]
      : PREFIX_MAP["default"];
  // The user's own prefix goes in FRONT of the per-source one, so `PTABC-FPK-072026`
  // still ends with the prefix the README documents. Bulk PDF filenames keep
  // their documented shape (see downloader.ts) and are not affected.
  const prefix = `${normalizeFilenamePrefix(exportData.filenamePrefix)}${basePrefix}`;

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
    if (source === "OUTPUT_RETURN" || source === "INPUT_RETURN") {
      const year = filenameHint.replace(/\D/g, "").match(/(20\d{2}|19\d{2})/)?.[1];
      if (year) return `${prefix}${year}`;
    }

    const formatted = formatPeriod(filenameHint);
    // If it's 6 digits (MMYYYY) or 4 digits (YYYY), use it
    if (/^\d{6}$/.test(formatted) || /^\d{4}$/.test(formatted)) {
      return `${prefix}${formatted}`;
    }

    // Fallback for PPh 21 if we have any digits
    if (source && source.startsWith("PPH_21_") && formatted.length >= 4) {
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
      // Fallback: Date fields (Last Resort - only if no period fields found)
      else {
        const dateField = isA2
          ? row["DocumentDate"] || row["Date"] || ""
          : source === "WITHHOLDING_SLIPS"
            ? row["WithholdingSlipsDate"]
            : row["TaxInvoiceDate"];
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

  // PRIORITY 2 (after filenameHint): USE DATA ROWS
  if (dataPeriods.length > 0 && source !== "OUTPUT_RETURN" && source !== "INPUT_RETURN") {
    if (dataPeriods.length === 1) {
      return `${prefix}${formatPeriod(dataPeriods[0])}`;
    }
    return `${prefix}${formatPeriod(dataPeriods[0])}-${formatPeriod(dataPeriods[dataPeriods.length - 1])}`;
  }

  // FALLBACK: CURRENT DATE (Asia/Jakarta, UTC+7 timezone-safe)
  const { year: yString, month: mString } = getCurrentYearMonthWIB();
  if (source === "OUTPUT_RETURN" || source === "INPUT_RETURN") {
    return `${prefix}${yString}`;
  }
  return `${prefix}${mString}${yString}`;
}

export function exportCSV(exportData: ExportData): void {
  const filename = generateDynamicFilename(exportData);
  const { data, fields } = processData(exportData);

  const rows = [fields, ...data.map((row) => fields.map((f) => row[f]))];
  downloadTextFile(buildCSV(rows), `${filename}.csv`, "text/csv;charset=utf-8");
}

export function exportXLSX(exportData: ExportData): void {
  const filename = generateDynamicFilename(exportData);
  const { data, fields } = processData(exportData);

  // JSON → sheet with an explicit header: the main export flow keeps data as
  // row objects keyed by field name, so json_to_sheet + { header: fields }
  // preserves column order and typing. Deliberately separate from
  // downloadXLSXFile (aoa_to_sheet), which serves pre-shaped 2D grids.
  const worksheet = XLSX.utils.json_to_sheet(data, { header: fields });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Faktur");

  const excelBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });

  downloadFile(excelBuffer, `${filename}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}
