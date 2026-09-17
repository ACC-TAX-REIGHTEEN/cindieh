// Unit tests for checker-logic.ts
import { describe, it, expect } from "vitest";
import {
  createCheckerSession,
  checkRowAccuracy,
  checkAllRowsAccuracy,
  applyCheckerStatusFilter,
  formatCheckSummary,
  type CheckResult,
} from "../content/checker-logic";

describe("createCheckerSession", () => {
  it("creates a session with default values", () => {
    const session = createCheckerSession();
    expect(session.benchmark).toBe("DPP");
    expect(session.tolerance).toBe(0);
    expect(session.results).toEqual([]);
    expect(session.statusFilter).toEqual([]);
    expect(session.currentPage).toBe(1);
    expect(session.viewedRefs.size).toBe(0);
  });
});

describe("checkRowAccuracy - Benchmark DPP", () => {
  it("returns null when DPP Nilai Lain and PPN are exact", () => {
    // DPP = 120,000 => expected DPP Nilai Lain = 110,000 (120000*11/12), expected PPN = 13,200 (120000*0.11)
    const row = {
      TaxInvoiceNumber: "0100000000000001",
      TaxInvoiceDate: "2026-07-01T00:00:00+07:00",
      SellingPrice: 120000,
      OtherTaxBase: 110000,
      VAT: 13200,
    };

    const res = checkRowAccuracy(row, "DPP", 0);
    expect(res).toBeNull();
  });

  it("formats ISO date string into DD/MM/YYYY and extracts fallback invoice numbers", () => {
    const row = {
      LetterNumber: "010.000-26.00000002",
      TaxInvoiceDate: "2026-08-15T00:00:00+07:00",
      SellingPrice: 120000,
      OtherTaxBase: 100000, // mismatch
      VAT: 13200,
    };

    const res = checkRowAccuracy(row, "DPP", 0);
    expect(res).not.toBeNull();
    expect(res?.taxInvoiceNumber).toBe("010.000-26.00000002");
    expect(res?.invoiceDate).toBe("15/08/2026");
  });

  it("flags mismatch when DPP Nilai Lain differs", () => {
    const row = {
      TaxInvoiceNumber: "0100000000000001",
      SellingPrice: 120000,
      OtherTaxBase: 100000, // Should be 110000
      VAT: 13200,
    };

    const res = checkRowAccuracy(row, "DPP", 0);
    expect(res).not.toBeNull();
    expect(res?.dppNilaiLainExpected).toBe(110000);
    expect(res?.dppNilaiLainDiff).toBe(-10000);
    expect(res?.status).toBe("DPP NL Berbeda");
  });

  it("flags mismatch when PPN differs", () => {
    const row = {
      TaxInvoiceNumber: "0100000000000001",
      SellingPrice: 100000,
      OtherTaxBase: Math.round((100000 * 11) / 12), // 91667
      VAT: 12000, // Should be 11000
    };

    const res = checkRowAccuracy(row, "DPP", 0);
    expect(res).not.toBeNull();
    expect(res?.ppnExpected).toBe(11000);
    expect(res?.ppnDiff).toBe(1000);
    expect(res?.status).toBe("PPN Berbeda");
  });

  it("flags mismatch when both DPP Nilai Lain and PPN differ", () => {
    const row = {
      TaxInvoiceNumber: "0100000000000001",
      SellingPrice: 120000,
      OtherTaxBase: 100000,
      VAT: 15000,
    };

    const res = checkRowAccuracy(row, "DPP", 0);
    expect(res).not.toBeNull();
    expect(res?.status).toBe("DPP NL & PPN Berbeda");
  });

  it("respects upper and lower tolerance parameter boundaries (+10 and -10)", () => {
    const rowUpper = {
      TaxInvoiceNumber: "0100000000000001",
      SellingPrice: 120000,
      OtherTaxBase: 110010, // Diff = +10
      VAT: 13200,
    };

    const rowLower = {
      TaxInvoiceNumber: "0100000000000001",
      SellingPrice: 120000,
      OtherTaxBase: 109990, // Diff = -10
      VAT: 13200,
    };

    expect(checkRowAccuracy(rowUpper, "DPP", 10)).toBeNull();
    expect(checkRowAccuracy(rowLower, "DPP", 10)).toBeNull();

    expect(checkRowAccuracy(rowUpper, "DPP", 9)).not.toBeNull();
    expect(checkRowAccuracy(rowLower, "DPP", 9)).not.toBeNull();
  });
});

describe("checkRowAccuracy - Benchmark DPP_NILAI_LAIN", () => {
  it("returns null when DPP and PPN match expected from DPP Nilai Lain", () => {
    const row = {
      TaxInvoiceNumber: "0100000000000002",
      SellingPrice: 120000,
      OtherTaxBase: 110000,
      VAT: 13200,
    };

    const res = checkRowAccuracy(row, "DPP_NILAI_LAIN", 0);
    expect(res).toBeNull();
  });

  it("flags DPP mismatch when Acuan is DPP Nilai Lain", () => {
    const row = {
      TaxInvoiceNumber: "0100000000000002",
      SellingPrice: 130000, // Expected 120000
      OtherTaxBase: 110000,
      VAT: 13200,
    };

    const res = checkRowAccuracy(row, "DPP_NILAI_LAIN", 0);
    expect(res).not.toBeNull();
    expect(res?.dppExpected).toBe(120000);
    expect(res?.dppDiff).toBe(10000);
    expect(res?.status).toBe("DPP Berbeda");
  });
});

describe("checkRowAccuracy - Benchmark PPN", () => {
  it("returns null when DPP and DPP Nilai Lain match expected from PPN", () => {
    const row = {
      TaxInvoiceNumber: "0100000000000003",
      SellingPrice: 100000,
      OtherTaxBase: 91667,
      VAT: 11000,
    };

    const res = checkRowAccuracy(row, "PPN", 0);
    expect(res).toBeNull();
  });

  it("flags mismatch when Acuan is PPN and DPP differs", () => {
    const row = {
      TaxInvoiceNumber: "0100000000000003",
      SellingPrice: 95000, // Expected 100000
      OtherTaxBase: 91667,
      VAT: 11000,
    };

    const res = checkRowAccuracy(row, "PPN", 0);
    expect(res).not.toBeNull();
    expect(res?.dppExpected).toBe(100000);
    expect(res?.status).toBe("DPP Berbeda");
  });
});

describe.each(["DPP", "DPP_NILAI_LAIN", "PPN"] as const)("incomplete data - %s", (benchmark) => {
  it.each([undefined, null, "", "  ", "abc", "100abc", "0oops", "1,2,3", NaN, Infinity, -Infinity, "Infinity", true])(
    "reports invalid amounts rather than success: %j", (invalid) => {
      for (const field of ["SellingPrice", "OtherTaxBase", "VAT"]) {
        const result = checkRowAccuracy({ SellingPrice: 0, OtherTaxBase: 0, VAT: 0, [field]: invalid }, benchmark);
        expect(result).not.toBeNull();
        expect(result?.status).toBe("Data tidak lengkap");
        expect(result?.dppExpected).toBeNull();
        expect(result?.dppNilaiLainExpected).toBeNull();
        expect(result?.ppnExpected).toBeNull();
        expect(result?.dppDiff).toBeNull();
        expect(result?.dppNilaiLainDiff).toBeNull();
        expect(result?.ppnDiff).toBeNull();
        const systemField = field === "SellingPrice" ? "dppSystem" : field === "OtherTaxBase" ? "dppNilaiLainSystem" : "ppnSystem";
        expect(result?.[systemField]).toBeNull();
      }
    },
  );

  it("does not report an empty row as accurate", () => {
    expect(checkRowAccuracy({}, benchmark)?.status).toBe("Data tidak lengkap");
  });

  it("preserves genuine zero and valid localized amounts", () => {
    expect(checkRowAccuracy({ SellingPrice: 0, OtherTaxBase: "0", VAT: "0,00" }, benchmark)).toBeNull();
    expect(checkRowAccuracy({ SellingPrice: "120.000", OtherTaxBase: "110.000", VAT: "13.200" }, benchmark)).toBeNull();
  });

  it("preserves valid system values on incomplete rows", () => {
    expect(checkRowAccuracy({ SellingPrice: 120000, OtherTaxBase: null, VAT: 13200 }, benchmark)).toMatchObject({
      dppSystem: 120000, dppNilaiLainSystem: null, ppnSystem: 13200, status: "Data tidak lengkap",
    });
  });

  it("rejects non-finite calculated amounts", () => {
    const result = checkRowAccuracy({ SellingPrice: Number.MAX_VALUE, OtherTaxBase: Number.MAX_VALUE, VAT: Number.MAX_VALUE }, benchmark);
    expect(result?.status).toBe("Data tidak lengkap");
    expect(result?.dppDiff).toBeNull();
  });

  it.each([NaN, Infinity, -1])("does not report success for invalid tolerance: %j", (tolerance) => {
    expect(checkRowAccuracy({ SellingPrice: 0, OtherTaxBase: 0, VAT: 0 }, benchmark, tolerance)?.status).toBe("Data tidak lengkap");
  });
});

describe("checkAllRowsAccuracy", () => {
  it("includes incomplete rows in results, filtering and the summary", () => {
    const results = checkAllRowsAccuracy([
      { TaxInvoiceNumber: "missing" },
      { TaxInvoiceNumber: "zero", SellingPrice: 0, OtherTaxBase: 0, VAT: 0 },
      { TaxInvoiceNumber: "mismatch", SellingPrice: 120000, OtherTaxBase: 100000, VAT: 13200 },
    ], "DPP");
    expect(results).toHaveLength(2);
    expect(applyCheckerStatusFilter(results, ["DATA_TIDAK_LENGKAP"]).map((r) => r.taxInvoiceNumber)).toEqual(["missing"]);
    expect(applyCheckerStatusFilter(results, ["ALL"])).toHaveLength(2);
    expect(applyCheckerStatusFilter(results, ["DPP_NILAI_LAIN_BERBEDA"])).toHaveLength(1);
    expect(formatCheckSummary(results)).toBe("Ditemukan 1 faktur dengan nilai tidak sesuai dan 1 faktur dengan data tidak lengkap.");
    expect(formatCheckSummary(results.slice(0, 1))).toBe("Ditemukan 0 faktur dengan nilai tidak sesuai dan 1 faktur dengan data tidak lengkap.");
  });
  it("filters out matching rows and returns only mismatched rows", () => {
    const scrapedData = [
      { TaxInvoiceNumber: "001", SellingPrice: 120000, OtherTaxBase: 110000, VAT: 13200 }, // Match
      { TaxInvoiceNumber: "002", SellingPrice: 120000, OtherTaxBase: 100000, VAT: 13200 }, // Mismatch
      { TaxInvoiceNumber: "003", SellingPrice: 100000, OtherTaxBase: 91667, VAT: 11000 },  // Match
    ];

    const results = checkAllRowsAccuracy(scrapedData, "DPP", 0);
    expect(results).toHaveLength(1);
    expect(results[0].taxInvoiceNumber).toBe("002");
  });
});

describe("applyCheckerStatusFilter", () => {
  function makeMockResult(status: string): CheckResult {
    return {
      taxInvoiceNumber: "001",
      invoiceDate: "01/01/2026",
      buyerName: "",
      buyerTIN: "",
      reference: "",
      dppSystem: 100,
      dppNilaiLainSystem: 50,
      ppnSystem: 10,
      dppExpected: 100,
      dppNilaiLainExpected: 92,
      ppnExpected: 11,
      dppDiff: 0,
      dppNilaiLainDiff: -42,
      ppnDiff: -1,
      tolerance: 0,
      benchmark: "DPP",
      status,
    };
  }

  const list = [
    makeMockResult("DPP Berbeda"),
    makeMockResult("DPP NL Berbeda"),
    makeMockResult("PPN Berbeda"),
    makeMockResult("DPP NL & PPN Berbeda"),
  ];

  it("returns all items when filter is empty or ALL", () => {
    expect(applyCheckerStatusFilter(list, [])).toHaveLength(4);
    expect(applyCheckerStatusFilter(list, ["ALL"])).toHaveLength(4);
  });

  it("filters by specific status key", () => {
    const resDpp = applyCheckerStatusFilter(list, ["DPP_BERBEDA"]);
    expect(resDpp).toHaveLength(1);
    expect(resDpp[0].status).toBe("DPP Berbeda");

    const resDua = applyCheckerStatusFilter(list, ["DUA_BERBEDA"]);
    expect(resDua).toHaveLength(1);
    expect(resDua[0].status).toBe("DPP NL & PPN Berbeda");
  });
});

describe("formatCheckSummary", () => {
  it("returns success text when results are empty", () => {
    expect(formatCheckSummary([])).toBe("Semua faktur sesuai.");
  });

  it("returns formatted count when mismatched results exist", () => {
    const mockResult = {
      taxInvoiceNumber: "001",
      invoiceDate: "01/01/2026",
      buyerName: "",
      buyerTIN: "",
      reference: "",
      dppSystem: 100,
      dppNilaiLainSystem: 50,
      ppnSystem: 10,
      dppExpected: 100,
      dppNilaiLainExpected: 92,
      ppnExpected: 11,
      dppDiff: 0,
      dppNilaiLainDiff: -42,
      ppnDiff: -1,
      tolerance: 0,
      benchmark: "DPP" as const,
      status: "DPP NL & PPN Berbeda",
    };

    expect(formatCheckSummary([mockResult])).toBe("Ditemukan 1 faktur dengan nilai tidak sesuai.");
  });
});
