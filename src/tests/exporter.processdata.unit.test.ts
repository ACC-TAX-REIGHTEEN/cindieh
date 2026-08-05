// Unit tests for exporter.ts — processData function
// Validates transformation logic for all 7 ExportSource branches.
import { describe, it, expect } from "vitest";
import { processData, type ExportData } from "../content/exporter";
import type { ExportSource } from "../content/page-context";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeExportData(
  source: ExportSource | undefined,
  rows: Record<string, unknown>[],
  fields?: string[],
  filenameHint?: string,
): ExportData {
  const allFields = fields ?? (rows.length > 0 ? Object.keys(rows[0]) : []);
  return { data: rows, fields: allFields, source, filenameHint };
}

// ── OUTPUT_TAX (default path) ─────────────────────────────────────────────────

describe("processData — OUTPUT_TAX (default hardcoded fields)", () => {
  const row = {
    TaxInvoiceDate: "2026-04-15T00:00:00+07:00",
    TaxInvoicePeriod: "04",
    TaxInvoiceYear: "2026",
    BuyerName: "PT Maju Jaya",
    BuyerTIN: "123456789",
    TaxInvoiceNumber: "0400000001",
    TaxInvoiceStatus: "Normal",
    BuyerStatus: "PKP",
    SellingPrice: 568000,
    OtherTaxBase: 0,
    VAT: 62480,
    STLG: 0,
    Reference: "REF-001",
    ExtraField: "should be dropped",
  };

  it("emits only the 13 hardcoded OUTPUT_TAX fields", () => {
    const result = processData(makeExportData("OUTPUT_TAX", [row]));
    expect(result.fields).toEqual([
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
    ]);
  });

  it("drops fields not in the hardcoded list", () => {
    const result = processData(makeExportData("OUTPUT_TAX", [row]));
    expect(result.data[0]).not.toHaveProperty("ExtraField");
  });

  it("formats TaxInvoiceDate as DD/MM/YYYY", () => {
    const result = processData(makeExportData("OUTPUT_TAX", [row]));
    expect(result.data[0].TaxInvoiceDate).toBe("15/04/2026");
  });

  it("extracts month from TaxInvoicePeriod (drops leading zero)", () => {
    const result = processData(makeExportData("OUTPUT_TAX", [row]));
    expect(result.data[0].TaxInvoicePeriod).toBe("4");
  });

  it("extracts year from TaxInvoiceYear", () => {
    const result = processData(makeExportData("OUTPUT_TAX", [row]));
    expect(result.data[0].TaxInvoiceYear).toBe("2026");
  });

  it("handles TD007-prefixed period values (e.g. TD007-2026-04)", () => {
    const tdRow = { ...row, TaxInvoicePeriod: "TD007-2026-04", TaxInvoiceYear: "TD007-2026-04" };
    const result = processData(makeExportData("OUTPUT_TAX", [tdRow]));
    expect(result.data[0].TaxInvoicePeriod).toBe("4");
    expect(result.data[0].TaxInvoiceYear).toBe("2026");
  });

  it("passes through non-date fields unchanged", () => {
    const result = processData(makeExportData("OUTPUT_TAX", [row]));
    expect(result.data[0].BuyerName).toBe("PT Maju Jaya");
    expect(result.data[0].SellingPrice).toBe(568000);
    expect(result.data[0].Reference).toBe("REF-001");
  });

  it("processes an empty data array without throwing", () => {
    const result = processData(makeExportData("OUTPUT_TAX", []));
    expect(result.data).toEqual([]);
  });
});

// ── INPUT_TAX ─────────────────────────────────────────────────────────────────

describe("processData — INPUT_TAX", () => {
  const row = {
    DocumentDate: "2026-03-10T00:00:00+07:00",
    SellerName: "PT Supplier",
    TaxInvoiceNumber: "0100000999",
    Amount: 1000000,
  };
  const fields = Object.keys(row);

  it("formats ISO datetime fields to DD/MM/YYYY", () => {
    const result = processData(makeExportData("INPUT_TAX", [row], fields));
    expect(result.data[0].DocumentDate).toBe("10/03/2026");
  });

  it("passes through non-date fields unchanged", () => {
    const result = processData(makeExportData("INPUT_TAX", [row], fields));
    expect(result.data[0].SellerName).toBe("PT Supplier");
    expect(result.data[0].Amount).toBe(1000000);
  });

  it("preserves all input fields (no dropping)", () => {
    const result = processData(makeExportData("INPUT_TAX", [row], fields));
    expect(result.fields).toEqual(fields);
  });
});

// ── OUTPUT_RETURN / INPUT_RETURN ──────────────────────────────────────────────

describe("processData — OUTPUT_RETURN / INPUT_RETURN", () => {
  const row = {
    ReturnDate: "2025-12-01T00:00:00+07:00",
    ReturnNumber: "RET-001",
    TaxInvoiceNumber: "0400000123",
    Amount: 500000,
  };
  const fields = Object.keys(row);

  it("formats ISO datetime fields for OUTPUT_RETURN", () => {
    const result = processData(makeExportData("OUTPUT_RETURN", [row], fields));
    expect(result.data[0].ReturnDate).toBe("01/12/2025");
  });

  it("formats ISO datetime fields for INPUT_RETURN", () => {
    const result = processData(makeExportData("INPUT_RETURN", [row], fields));
    expect(result.data[0].ReturnDate).toBe("01/12/2025");
  });

  it("does not drop any fields", () => {
    const result = processData(makeExportData("OUTPUT_RETURN", [row], fields));
    expect(result.fields).toEqual(fields);
    expect(result.data[0].ReturnNumber).toBe("RET-001");
  });
});

// ── SPT_A2 ────────────────────────────────────────────────────────────────────

describe("processData — SPT_A2 (hardcoded 8 fields)", () => {
  const row = {
    DocumentDate: "2026-05-20T00:00:00+07:00",
    Name: "PT Buyer Corp",
    TIN: "987654321",
    DocumentNumber: "DOC-001",
    TaxBase: 1000000,
    OtherTaxBase: 0,
    VAT: 110000,
    STLG: 0,
    ShouldBeDropped: "yes",
  };

  it("emits exactly the 8 hardcoded A2 fields", () => {
    const result = processData(makeExportData("SPT_A2", [row], Object.keys(row)));
    expect(result.fields).toEqual([
      "DocumentDate", "Name", "TIN", "DocumentNumber",
      "TaxBase", "OtherTaxBase", "VAT", "STLG",
    ]);
  });

  it("drops extra fields not in the A2 list", () => {
    const result = processData(makeExportData("SPT_A2", [row], Object.keys(row)));
    expect(result.data[0]).not.toHaveProperty("ShouldBeDropped");
  });

  it("formats DocumentDate as DD/MM/YYYY", () => {
    const result = processData(makeExportData("SPT_A2", [row], Object.keys(row)));
    expect(result.data[0].DocumentDate).toBe("20/05/2026");
  });

  it("passes numeric fields through unchanged", () => {
    const result = processData(makeExportData("SPT_A2", [row], Object.keys(row)));
    expect(result.data[0].TaxBase).toBe(1000000);
    expect(result.data[0].VAT).toBe(110000);
  });
});

// ── SPT_B2 ────────────────────────────────────────────────────────────────────

describe("processData — SPT_B2 (all fields, dynamic)", () => {
  const row = {
    EntryDate: "2026-06-01T00:00:00+07:00",
    Name: "PT Dynamic",
    Amount: 2000000,
  };
  const fields = Object.keys(row);

  it("preserves all dynamic fields", () => {
    const result = processData(makeExportData("SPT_B2", [row], fields));
    expect(result.fields).toEqual(fields);
  });

  it("formats ISO datetime fields", () => {
    const result = processData(makeExportData("SPT_B2", [row], fields));
    expect(result.data[0].EntryDate).toBe("01/06/2026");
  });
});

// ── PPH_21 variants ───────────────────────────────────────────────────────────

describe("processData — PPH_21_L1A / L1B / L2 / L3 (dynamic fields)", () => {
  const row = {
    PayDate: "2026-07-15T00:00:00+07:00",
    EmployeeName: "Budi Santoso",
    GrossIncome: 5000000,
  };
  const fields = Object.keys(row);
  const variants: ExportSource[] = ["PPH_21_L1A", "PPH_21_L1B", "PPH_21_L2", "PPH_21_L3"];

  for (const source of variants) {
    it(`preserves all fields for ${source}`, () => {
      const result = processData(makeExportData(source, [row], fields));
      expect(result.fields).toEqual(fields);
    });

    it(`formats ISO datetime fields for ${source}`, () => {
      const result = processData(makeExportData(source, [row], fields));
      expect(result.data[0].PayDate).toBe("15/07/2026");
    });
  }
});

// ── Multiple rows ─────────────────────────────────────────────────────────────

describe("processData — multiple rows", () => {
  it("processes all rows independently", () => {
    const rows = [
      { TaxInvoiceDate: "2026-01-01T00:00:00+07:00", TaxInvoicePeriod: "01", TaxInvoiceYear: "2026", BuyerName: "A", BuyerTIN: "1", TaxInvoiceNumber: "N1", TaxInvoiceStatus: "x", BuyerStatus: "y", SellingPrice: 100, OtherTaxBase: 0, VAT: 11, STLG: 0, Reference: "R1" },
      { TaxInvoiceDate: "2026-02-01T00:00:00+07:00", TaxInvoicePeriod: "02", TaxInvoiceYear: "2026", BuyerName: "B", BuyerTIN: "2", TaxInvoiceNumber: "N2", TaxInvoiceStatus: "x", BuyerStatus: "y", SellingPrice: 200, OtherTaxBase: 0, VAT: 22, STLG: 0, Reference: "R2" },
    ];
    const result = processData(makeExportData("OUTPUT_TAX", rows));
    expect(result.data).toHaveLength(2);
    expect(result.data[0].TaxInvoiceDate).toBe("01/01/2026");
    expect(result.data[1].TaxInvoiceDate).toBe("01/02/2026");
    expect(result.data[0].Reference).toBe("R1");
    expect(result.data[1].Reference).toBe("R2");
  });
});
