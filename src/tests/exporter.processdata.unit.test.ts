// Unit tests for exporter.ts — processData function
// Validates transformation logic for all 7 ExportSource branches.
import { describe, it, expect } from "vitest";
import { processData, type ExportData } from "../content/exporter";
import type { ExportSource } from "../content/page-context";
import { gridRow } from "./__mocks__/grid-requests";

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
  // The grid's canonical row, read from the fixture (grid-requests.ts) rather
  // than written here: the columns are proved against one shape shared with the
  // sweep's readers, and a scenario variant below still spells its own.
  const row = gridRow("OUTPUT_TAX");

  it("emits Indonesian OUTPUT_TAX export headers", () => {
    const result = processData(makeExportData("OUTPUT_TAX", [row]));
    expect(result.fields).toEqual([
      "TANGGAL",
      "MASA",
      "TAHUN",
      "NAMA PEMBELI",
      "NO IDENTITAS PEMBELI",
      "NO FAKTUR",
      "STATUS",
      "STATUS PEMBELI",
      "DPP",
      "DPP NILAI LAIN",
      "PPN",
      "PPNBM",
      "REFERENSI",
    ]);
  });

  it("drops fields not in the hardcoded list", () => {
    const result = processData(makeExportData("OUTPUT_TAX", [row]));
    expect(result.data[0]).not.toHaveProperty("ExtraField");
  });

  it("formats TaxInvoiceDate as DD/MM/YYYY", () => {
    const result = processData(makeExportData("OUTPUT_TAX", [row]));
    expect(result.data[0].TANGGAL).toBe("15/04/2026");
  });

  it("extracts month from TaxInvoicePeriod (drops leading zero)", () => {
    const result = processData(makeExportData("OUTPUT_TAX", [row]));
    expect(result.data[0].MASA).toBe("4");
  });

  it("extracts year from TaxInvoiceYear", () => {
    const result = processData(makeExportData("OUTPUT_TAX", [row]));
    expect(result.data[0].TAHUN).toBe("2026");
  });

  it("handles TD007-prefixed period values (e.g. TD007-2026-04)", () => {
    const tdRow = { ...row, TaxInvoicePeriod: "TD007-2026-04", TaxInvoiceYear: "TD007-2026-04" };
    const result = processData(makeExportData("OUTPUT_TAX", [tdRow]));
    expect(result.data[0].MASA).toBe("4");
    expect(result.data[0].TAHUN).toBe("2026");
  });

  it("extracts month from Coretax tax domain period codes (e.g. TD.00706)", () => {
    const tdRow = { ...row, TaxInvoicePeriod: "TD.00706", TaxInvoiceYear: "2026" };
    const result = processData(makeExportData("OUTPUT_TAX", [tdRow]));
    expect(result.data[0].MASA).toBe("6");
  });

  it("passes through non-date fields unchanged", () => {
    const result = processData(makeExportData("OUTPUT_TAX", [row]));
    expect(result.data[0]["NAMA PEMBELI"]).toBe("PT Maju Jaya");
    expect(result.data[0].DPP).toBe(568000);
    expect(result.data[0].REFERENSI).toBe("REF-001");
  });


  it("preserves original Coretax fields when export mode is raw", () => {
    const result = processData({ ...makeExportData("OUTPUT_TAX", [row]), mode: "raw" });
    expect(result.fields).toEqual(Object.keys(row));
    expect(result.data[0].TaxInvoiceDate).toBe("15/04/2026");
    expect(result.data[0].TaxInvoicePeriod).toBe("04");
    expect(result.data[0].BuyerName).toBe("PT Maju Jaya");
    expect(result.data[0]).toHaveProperty("ExtraField", "should be dropped");
  });
  it("processes an empty data array without throwing", () => {
    const result = processData(makeExportData("OUTPUT_TAX", []));
    expect(result.data).toEqual([]);
  });
});

// ── INPUT_TAX ─────────────────────────────────────────────────────────────────

describe("processData � INPUT_TAX", () => {
  const row = gridRow("INPUT_TAX");

  it("emits Indonesian INPUT_TAX export headers", () => {
    const result = processData(makeExportData("INPUT_TAX", [row]));
    expect(result.fields).toEqual([
      "TANGGAL",
      "MASA",
      "TAHUN",
      "NAMA PENJUAL",
      "NO IDENTITAS PENJUAL",
      "NO FAKTUR",
      "STATUS",
      "STATUS PEMBELI",
      "MASA PENGKREDITAN",
      "TAHUN PENGKREDITAN",
      "DPP",
      "DPP NILAI LAIN",
      "PPN",
      "PPNBM",
      "REFERENSI",
    ]);
  });

  it("drops fields not in the INPUT_TAX export list", () => {
    const result = processData(makeExportData("INPUT_TAX", [row]));
    expect(result.data[0]).not.toHaveProperty("ExtraField");
  });

  it("formats TaxInvoiceDate as DD/MM/YYYY", () => {
    const result = processData(makeExportData("INPUT_TAX", [row]));
    expect(result.data[0].TANGGAL).toBe("10/03/2026");
  });

  it("extracts month and year for INPUT_TAX", () => {
    const result = processData(makeExportData("INPUT_TAX", [row]));
    expect(result.data[0].MASA).toBe("3");
    expect(result.data[0].TAHUN).toBe("2026");
  });

  it("maps crediting period and year for INPUT_TAX", () => {
    const result = processData(makeExportData("INPUT_TAX", [row]));
    expect(result.data[0]["MASA PENGKREDITAN"]).toBe("4");
    expect(result.data[0]["TAHUN PENGKREDITAN"]).toBe("2026");
  });

  it("maps seller and tax value fields", () => {
    const result = processData(makeExportData("INPUT_TAX", [row]));
    expect(result.data[0]["NAMA PENJUAL"]).toBe("PT Supplier");
    expect(result.data[0]["NO IDENTITAS PENJUAL"]).toBe("987654321");
    expect(result.data[0].DPP).toBe(1000000);
    expect(result.data[0]["DPP NILAI LAIN"]).toBe(916667);
    expect(result.data[0].PPN).toBe(110000);
    expect(result.data[0].REFERENSI).toBe("REF-IN-001");
  });

// ── OUTPUT_RETURN / INPUT_RETURN ──────────────────────────────────────────────


  it("preserves original Coretax fields when export mode is raw", () => {
    const result = processData({ ...makeExportData("INPUT_TAX", [row]), mode: "raw" });
    expect(result.fields).toEqual(Object.keys(row));
    expect(result.data[0].TaxInvoiceDate).toBe("10/03/2026");
    expect(result.data[0].TaxInvoicePeriod).toBe("TD.00703");
    expect(result.data[0].SellerTaxpayerName).toBe("PT Supplier");
    expect(result.data[0]).toHaveProperty("ExtraField", "should be dropped");
  });
});

describe("processData - OUTPUT_RETURN", () => {
  const row = gridRow("OUTPUT_RETURN");

  it("emits Indonesian OUTPUT_RETURN export headers", () => {
    const result = processData(makeExportData("OUTPUT_RETURN", [row]));
    expect(result.fields).toEqual([
      "NO IDENTITAS PEMBELI",
      "NAMA PEMBELI",
      "NO FAKTUR",
      "TANGGAL",
      "NO RETUR",
      "TANGGAL RETUR",
      "MASA",
      "TAHUN",
      "STATUS PEMBELI",
      "STATUS",
      "DPP",
      "DPP NILAI LAIN",
      "PPN",
      "PPNBM",
    ]);
  });

  it("maps and formats OUTPUT_RETURN fields", () => {
    const result = processData(makeExportData("OUTPUT_RETURN", [row]));
    expect(result.data[0]["NO IDENTITAS PEMBELI"]).toBe("0639343490201000");
    expect(result.data[0]["NAMA PEMBELI"]).toBe("PT Buyer Clear");
    expect(result.data[0].TANGGAL).toBe("18/06/2026");
    expect(result.data[0]["TANGGAL RETUR"]).toBe("01/07/2026");
    expect(result.data[0].MASA).toBe("6");
    expect(result.data[0].TAHUN).toBe("2026");
    expect(result.data[0].DPP).toBe(291215);
    expect(result.data[0]).not.toHaveProperty("ExtraField");
  });
});

describe("processData - INPUT_RETURN", () => {
  const row = gridRow("INPUT_RETURN");

  it("emits Indonesian INPUT_RETURN export headers", () => {
    const result = processData(makeExportData("INPUT_RETURN", [row]));
    expect(result.fields).toEqual([
      "NO IDENTITAS PENJUAL",
      "NAMA PENJUAL",
      "NO FAKTUR",
      "TANGGAL",
      "NO RETUR",
      "TANGGAL RETUR",
      "MASA",
      "TAHUN",
      "STATUS PEMBELI",
      "STATUS",
      "DPP",
      "DPP NILAI LAIN",
      "PPN",
      "PPNBM",
    ]);
  });

  it("maps and formats INPUT_RETURN fields", () => {
    const result = processData(makeExportData("INPUT_RETURN", [row]));
    expect(result.data[0]["NO IDENTITAS PENJUAL"]).toBe("0016232159201000");
    expect(result.data[0]["NAMA PENJUAL"]).toBe("PT Seller");
    expect(result.data[0].TANGGAL).toBe("18/06/2026");
    expect(result.data[0]["TANGGAL RETUR"]).toBe("02/07/2026");
    expect(result.data[0].MASA).toBe("6");
    expect(result.data[0].TAHUN).toBe("2026");
    expect(result.data[0].PPN).toBe(110000);
    expect(result.data[0]).not.toHaveProperty("ExtraField");
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

// ── WITHHOLDING_SLIPS ────────────────────────────────────────────────────────
// Bukti Potong rows were PDF-only until now: the grid rows were already
// captured, but cleaned mode had no mapping for them and fell through to the
// OUTPUT_TAX columns, which produce an empty sheet. These cases pin the two
// number spellings the rest of the code uses and the slip date as the only
// period signal a withholding row carries.

describe("processData — WITHHOLDING_SLIPS", () => {
  const row = {
    WithholdingSlipNumber: "BP-001",
    WithholdingSlipsDate: "2026-07-15T00:00:00+07:00",
    EmployerName: "PT Mitra Sejahtera",
    TaxIdentificationNumber: "01234567890123",
    RecordId: "rec-1",
  };

  it("emits Indonesian withholding export headers", () => {
    const result = processData(makeExportData("WITHHOLDING_SLIPS", [row]));
    expect(result.fields).toEqual([
      "NO BUKTI POTONG",
      "TANGGAL",
      "MASA",
      "TAHUN",
      "NAMA PEMOTONG",
      "NPWP PEMOTONG",
    ]);
  });

  it("reads the slip number from either spelling the codebase uses", () => {
    expect(processData(makeExportData("WITHHOLDING_SLIPS", [row])).data[0]["NO BUKTI POTONG"]).toBe("BP-001");

    const plural = { ...row, WithholdingSlipsNumber: "BP-002" };
    delete (plural as Record<string, unknown>).WithholdingSlipNumber;
    expect(processData(makeExportData("WITHHOLDING_SLIPS", [plural])).data[0]["NO BUKTI POTONG"]).toBe("BP-002");
  });

  it("formats the slip date and derives MASA/TAHUN from it", () => {
    const result = processData(makeExportData("WITHHOLDING_SLIPS", [row]));
    expect(result.data[0].TANGGAL).toBe("15/07/2026");
    expect(result.data[0].MASA).toBe("7");
    expect(result.data[0].TAHUN).toBe("2026");
  });

  it("maps the withholding agent and drops unidentified fields", () => {
    const result = processData(makeExportData("WITHHOLDING_SLIPS", [row]));
    expect(result.data[0]["NAMA PEMOTONG"]).toBe("PT Mitra Sejahtera");
    expect(result.data[0]["NPWP PEMOTONG"]).toBe("01234567890123");
    expect(result.data[0]).not.toHaveProperty("RecordId");
  });

  it("leaves the period columns empty for a row without a slip date", () => {
    const result = processData(
      makeExportData("WITHHOLDING_SLIPS", [{ ...row, WithholdingSlipsDate: "" }]),
    );
    expect(result.data[0].TANGGAL).toBe("");
    expect(result.data[0].MASA).toBe("");
    expect(result.data[0].TAHUN).toBe("");
  });

  it("keeps every captured field when export mode is raw", () => {
    const result = processData({ ...makeExportData("WITHHOLDING_SLIPS", [row]), mode: "raw" });
    expect(result.data[0]).toHaveProperty("RecordId", "rec-1");
    expect(result.data[0].WithholdingSlipsDate).toBe("15/07/2026");
  });

  it("processes an empty data array without throwing", () => {
    expect(processData(makeExportData("WITHHOLDING_SLIPS", [])).data).toEqual([]);
  });
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
    expect(result.data[0].TANGGAL).toBe("01/01/2026");
    expect(result.data[1].TANGGAL).toBe("01/02/2026");
    expect(result.data[0].REFERENSI).toBe("R1");
    expect(result.data[1].REFERENSI).toBe("R2");
  });
});
