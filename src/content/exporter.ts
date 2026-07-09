// ============================================================
// EXPORTER.TS — Export scraped data to various formats
// ============================================================
import * as XLSX from "xlsx";
import type { ExportSource } from "./page-context";
import { debugWarn } from "./debug";

export interface ExportData {
  data: Record<string, unknown>[];
  fields: string[];
  filenameHint?: string;
  source?: ExportSource;
}

function downloadFile(content: string | BlobPart, filename: string, mimeType: string): void {
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
  const s = String(value);
  return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
}

function formatDate(dateStr: unknown): string {
  if (!dateStr || typeof dateStr !== "string") return String(dateStr || "");

  // Fast path: pure date "YYYY-MM-DD" (no time component) — safe from timezone shift.
  const dateOnly = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`; // DD/MM/YYYY
  }

  // ISO datetime with explicit offset (e.g. "2026-01-31T23:00:00+07:00").
  // Parse the calendar date in the stated offset, not the local timezone,
  // so the displayed day matches what Coretax shows to the user.
  const iso = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([+-]\d{2}:?\d{2}|Z)$/i);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    const hour = Number(iso[4]);
    const minute = Number(iso[5]);
    const second = Number(iso[6]);
    const offsetMin = parseOffset(iso[7]);
    // Convert to UTC ms, then extract the calendar date at the source offset.
    const utcMs = Date.UTC(year, month - 1, day, hour, minute, second) - offsetMin * 60000;
    const d = new Date(utcMs);
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}/${d.getUTCFullYear()}`;
  }

  // Fallback: best-effort parse (may be timezone-dependent).
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }

  return dateStr;
}

function parseOffset(offset: string): number {
  if (offset.toUpperCase() === "Z") return 0;
  const m = offset.match(/^([+-])(\d{2}):?(\d{2})$/);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

function processData(exportData: ExportData): ExportData {
  if (
    exportData.source === "INPUT_TAX" ||
    exportData.source === "OUTPUT_RETURN" ||
    exportData.source === "INPUT_RETURN"
  ) {
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
    return { data: processedData, fields: exportData.fields, source: exportData.source };
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
    // Dump all fields for B2 dynamically
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
  const hardcodedFields = [
    "TaxInvoiceDate",
    "TaxInvoicePeriod",
    "TaxInvoiceYear",
    "BuyerName",
    "BuyerTIN",
    "TaxInvoiceNumber",
    "TaxInvoiceStatus",
    "BuyerStatus",
    "SellingPrice",
    "OtherTaxBase",
    "VAT",
    "STLG",
    "Reference",
  ];

  const processedData = exportData.data.map((row) => {
    const newRow: Record<string, unknown> = {};

    // Extract Masa (Period) - handle TD007 prefix or use TaxPeriodMonth
    let masa = "";
    const rawMonth = row["TaxInvoicePeriod"] || row["TaxPeriodMonth"] || row["TaxPeriod"] || "";
    if (rawMonth) {
      const sMonth = String(rawMonth);
      masa = sMonth.slice(-2).replace(/^0/, ""); // Take last 2 digits, remove leading zero
    }

    // Extract Tahun (Year)
    let tahun = "";
    const rawYear = row["TaxInvoiceYear"] || row["TaxPeriodYear"] || row["TaxPeriod"] || "";
    if (rawYear) {
      const sYear = String(rawYear);
      // If it's a 6-digit period like 202604, year is the first 4 digits
      if (sYear.length >= 6 && /^\d+$/.test(sYear)) {
        tahun = sYear.slice(0, 4);
      } else if (sYear.length === 4) {
        tahun = sYear;
      }
    }

    for (const f of hardcodedFields) {
      if (f === "TaxInvoicePeriod") {
        newRow[f] = masa;
      } else if (f === "TaxInvoiceYear") {
        newRow[f] = tahun;
      } else {
        let val = row[f];
        if (f === "TaxInvoiceDate") {
          val = formatDate(val);
        }
        newRow[f] = val;
      }
    }
    return newRow;
  });

  // Runtime validation: check if hardcoded fields still match API response
  const allUndefined = processedData.some((row) =>
    hardcodedFields.every((f) => row[f] === undefined || row[f] === null),
  );
  if (allUndefined) {
    debugWarn("API schema may have changed: no hardcoded fields matched in any row", {
      expected: hardcodedFields,
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
  const prefix =
    source && Object.prototype.hasOwnProperty.call(PREFIX_MAP, source)
      ? PREFIX_MAP[source as ExportSource]
      : PREFIX_MAP["default"];

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
        // If sY is YYYYMM, take first 4.
        y = sY.length >= 6 ? sY.slice(0, 4) : sY;
        // Take last 2 digits for month
        m = sM.slice(-2).padStart(2, "0");
      }
      // Priority 2: Consolidated TaxPeriod (usually YYYYMM)
      else if (row["TaxPeriod"] && String(row["TaxPeriod"]).length >= 6) {
        const sP = String(row["TaxPeriod"]);
        y = sP.slice(0, 4);
        m = sP.slice(4, 6);
      }
      // Fallback: Date fields (Last Resort - only if no period fields found)
      else {
        const dateField = isA2 ? row["DocumentDate"] || row["Date"] || "" : row["TaxInvoiceDate"];
        const dStr = String(dateField || "");
        if (dStr) {
          const parts = dStr.split("T")[0].split("-");
          if (parts.length === 3 && parts[0].length === 4) {
            y = parts[0];
            m = parts[1];
          } else {
            const d = new Date(dStr);
            if (!isNaN(d.getTime())) {
              y = String(d.getFullYear());
              m = String(d.getMonth() + 1).padStart(2, "0");
            }
          }
        }
      }

      if (y && m && y.length === 4 && m.length === 2) {
        found.add(`${y}_${m}`); // YYYY_MM
      }
    }
    return Array.from(found).sort();
  };

  const dataPeriods = extractPeriodsFromData();

  // PRIORITY 2: USE DATA ROWS
  if (dataPeriods.length > 0 && source !== "OUTPUT_RETURN" && source !== "INPUT_RETURN") {
    if (dataPeriods.length === 1) {
      return `${prefix}${formatPeriod(dataPeriods[0])}`;
    }
    return `${prefix}${formatPeriod(dataPeriods[0])}-${formatPeriod(dataPeriods[dataPeriods.length - 1])}`;
  }

  // FALLBACK: CURRENT DATE
  const now = new Date();
  const mString = String(now.getMonth() + 1).padStart(2, "0");
  const yString = String(now.getFullYear());
  if (source === "OUTPUT_RETURN" || source === "INPUT_RETURN") {
    return `${prefix}${yString}`;
  }
  return `${prefix}${mString}${yString}`;
}

export function exportCSV(exportData: ExportData): void {
  const filename = generateDynamicFilename(exportData);
  const { data, fields } = processData(exportData);

  let csv = `${fields.map(escapeCSV).join(",")}\n`;
  for (const row of data) {
    csv += `${fields.map((f) => escapeCSV(row[f])).join(",")}\n`;
  }

  downloadFile(`\uFEFF${csv}`, `${filename}.csv`, "text/csv;charset=utf-8");
}

export function exportXLSX(exportData: ExportData): void {
  const filename = generateDynamicFilename(exportData);
  const { data, fields } = processData(exportData);

  const worksheet = XLSX.utils.json_to_sheet(data, { header: fields });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Faktur");

  const excelBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });

  downloadFile(excelBuffer, `${filename}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}
