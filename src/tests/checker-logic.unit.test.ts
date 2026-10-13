// Unit tests for checker-logic.ts
import { describe, it, expect } from "vitest";
import {
  DPP_NILAI_LAIN_DENOMINATOR,
  DPP_NILAI_LAIN_NUMERATOR,
  PPN_RATE,
  PPN_RATE_ON_NILAI_LAIN,
  PPN_RATE_PERCENT,
  createCheckerSession,
  checkRowAccuracy,
  checkAllRowsAccuracy,
  applyCheckerDefaults,
  applyCheckerStatusFilter,
  formatCheckSummary,
  type CheckResult,
} from "../content/checker-logic";
import type { CheckerDefaults } from "../shared/extension-preferences";

// ── Stored Checker defaults ─────────────────────────────────────────────
// The panel owns these three controls for the life of the modal, so the stored
// defaults are applied while it is built. That makes the seed the only thing
// standing between a stored value and a check run with the wrong benchmark.

describe("applyCheckerDefaults", () => {
  it("copies the benchmark, the tolerance and the filter onto the session", () => {
    const session = createCheckerSession();

    applyCheckerDefaults(session, {
      benchmark: "DPP_NILAI_LAIN",
      tolerance: 75,
      statusFilter: ["DATA_TIDAK_LENGKAP", "PPN_BERBEDA"],
    });

    expect(session.benchmark).toBe("DPP_NILAI_LAIN");
    expect(session.tolerance).toBe(75);
    // Canonical order, matching what the panel's own filter would produce.
    expect(session.statusFilter).toEqual(["PPN_BERBEDA", "DATA_TIDAK_LENGKAP"]);
  });

  it("keeps an empty filter empty rather than expanding it to every status", () => {
    // applyCheckerFilter reads an empty set as "no filter", so turning it into
    // a list of all five would quietly change the meaning of the default.
    const session = createCheckerSession();

    applyCheckerDefaults(session, { benchmark: "PPN", tolerance: 0, statusFilter: [] });

    expect(session.statusFilter).toEqual([]);
  });

  it("falls back to the default benchmark for an empty one", () => {
    // The normalizer already refuses an unknown value, so this only fires for a
    // caller that built the defaults object by hand — hence the cast.
    const session = createCheckerSession();

    applyCheckerDefaults(session, {
      benchmark: "" as unknown as CheckerDefaults["benchmark"],
      tolerance: 0,
      statusFilter: [],
    });

    expect(session.benchmark).toBe("DPP");
  });
});

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

describe("checkRowAccuracy - OtherTaxBase = 0", () => {
  // A live-portal row that does not apply DPP Nilai Lain carries OtherTaxBase 0
  // next to a correct DPP and PPN (see exporter.processdata fixtures). The
  // comparison against a derived expectation is dropped, not reported, and its
  // diff stays null so both grids render "-".
  it("reports nothing when the row simply does not apply DPP Nilai Lain (acuan DPP)", () => {
    // DPP 100, DPP NL 0, VAT 11 — the shape the portal actually records.
    const row = {
      TaxInvoiceNumber: "0100000000000009",
      SellingPrice: 100,
      OtherTaxBase: 0,
      VAT: 11,
    };
    expect(checkRowAccuracy(row, "DPP", 0)).toBeNull();
  });

  it("still reports a real PPN error on such a row, with no DPP NL diff", () => {
    const row = {
      TaxInvoiceNumber: "0100000000000009",
      SellingPrice: 100000,
      OtherTaxBase: 0,
      VAT: 12000,
    };

    const res = checkRowAccuracy(row, "DPP", 0);
    expect(res).not.toBeNull();
    expect(res?.status).toBe("PPN Berbeda");
    expect(res?.dppNilaiLainDiff).toBeNull();
  });

  it("exempts the derived DPP NL comparison under acuan PPN as well", () => {
    // VAT 11000 => expected DPP 100000; DPP NL 0 must not be flagged against
    // the derived VAT/12% value.
    const row = {
      TaxInvoiceNumber: "0100000000000009",
      SellingPrice: 100000,
      OtherTaxBase: 0,
      VAT: 11000,
    };
    expect(checkRowAccuracy(row, "PPN", 0)).toBeNull();
  });

  it("keeps DPP Nilai Lain comparable when it is itself the acuan", () => {
    // Under acuan DPP Nilai Lain the 0 IS the value the user chose to check
    // from, so the derived DPP (0) still flags every nonzero DPP — pinned as
    // intentional scope, not an oversight.
    const row = {
      TaxInvoiceNumber: "0100000000000009",
      SellingPrice: 120000,
      OtherTaxBase: 0,
      VAT: 0,
    };

    const res = checkRowAccuracy(row, "DPP_NILAI_LAIN", 0);
    expect(res).not.toBeNull();
    expect(res?.status).toBe("DPP Berbeda");
    // Not exempt: the 0 is the acuan itself, so its diff is a real (zero) one.
    expect(res?.dppNilaiLainDiff).toBe(0);
    expect(res?.dppNilaiLainExpected).toBe(0);
  });

  it("exempts a string-formatted zero the same way", () => {
    const row = {
      TaxInvoiceNumber: "0100000000000009",
      SellingPrice: 100,
      OtherTaxBase: "0",
      VAT: "11",
    };
    expect(checkRowAccuracy(row, "DPP", 0)).toBeNull();
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

describe("counterparty resolution across both PPN grids", () => {
  const amounts = { SellingPrice: 12000000, OtherTaxBase: 11000000, VAT: 0 };

  it("reads the buyer from a PPN Keluaran row", () => {
    const r = checkRowAccuracy(
      { ...amounts, BuyerName: "PT PEMBELI", BuyerTIN: "01.234.567.8-901.000" },
      "DPP",
    );
    expect(r?.counterpartyName).toBe("PT PEMBELI");
    expect(r?.counterpartyTIN).toBe("01.234.567.8-901.000");
  });

  it("reads the seller from a PPN Masukan row", () => {
    const r = checkRowAccuracy(
      { ...amounts, SellerTaxpayerName: "PT PENJUAL", SellerTIN: "09.876.543.2-101.000" },
      "DPP",
    );
    expect(r?.counterpartyName).toBe("PT PENJUAL");
    expect(r?.counterpartyTIN).toBe("09.876.543.2-101.000");
  });

  it("prefers the buyer when a row somehow carries both sides", () => {
    const r = checkRowAccuracy(
      { ...amounts, BuyerName: "PT PEMBELI", SellerTaxpayerName: "PT PENJUAL" },
      "DPP",
    );
    expect(r?.counterpartyName).toBe("PT PEMBELI");
  });

  it("leaves the counterparty blank rather than inventing one", () => {
    const r = checkRowAccuracy({ ...amounts, Reference: "SZ-1/07/26" }, "DPP", 999999);
    expect(r?.counterpartyName).toBe("");
    expect(r?.counterpartyTIN).toBe("");
  });

  it("reaches the same verdict on the same amounts from either grid", () => {
    // The arithmetic is per invoice and side-agnostic: which party is NAMED is
    // the only thing the transaction side changes.
    const keluar = checkRowAccuracy(
      { ...amounts, BuyerName: "PT SAMA", SellerTaxpayerName: "PT LAIN" },
      "DPP_NILAI_LAIN",
    );
    const masuk = checkRowAccuracy(
      { ...amounts, SellerTaxpayerName: "PT SAMA", BuyerName: "PT LAIN" },
      "DPP_NILAI_LAIN",
    );
    expect(masuk?.status).toBe(keluar?.status);
    expect(masuk?.dppDiff).toBe(keluar?.dppDiff);
    expect(masuk?.ppnDiff).toBe(keluar?.ppnDiff);
  });
});

// The audit finding this pins: the tax numbers used to be literals in five
// branches and in the tests themselves, so a rate change would make every row
// read "Berbeda" with nothing failing. They are now one declaration, and these
// assert that declaration still means 11% VAT on an 11/12 base.
describe("tax policy constants", () => {
  it("states the Indonesian VAT rate and the DPP Nilai Lain fraction", () => {
    expect(PPN_RATE_PERCENT).toBe(11);
    expect(PPN_RATE).toBe(0.11);
    expect(DPP_NILAI_LAIN_NUMERATOR).toBe(11);
    expect(DPP_NILAI_LAIN_DENOMINATOR).toBe(12);
    // PPN on the nilai-lain base is 12%, one point above the DPP rate.
    expect(PPN_RATE_ON_NILAI_LAIN).toBe(0.12);
  });

  it("derives the nilai-lain rate from the DPP rate and the fraction, not from a magic +1", () => {
    // The same tax on the 11/12 base: PPN_RATE x (12/11). If the three
    // benchmarks disagreed about the fraction, the same invoice would be called
    // inconsistent depending on which Acuan was chosen — so this is a real
    // invariant, not a restatement of the constants.
    const fraction = DPP_NILAI_LAIN_NUMERATOR / DPP_NILAI_LAIN_DENOMINATOR;
    expect(PPN_RATE_ON_NILAI_LAIN).toBeCloseTo(PPN_RATE / fraction, 12);
    // The same relation read back the other way round.
    expect(PPN_RATE_ON_NILAI_LAIN * fraction).toBeCloseTo(PPN_RATE, 12);
  });

  it("round-trips one invoice across all three Acuan without disagreeing with itself", () => {
    // DPP 12.000.000 -> DPP NL 11.000.000 -> PPN 1.320.000. Each benchmark takes
    // one of those as given and must derive the other two to the same values.
    const dpp = 12000000, dppNl = 11000000, ppn = 1320000;
    const fromDpp = checkRowAccuracy({ SellingPrice: dpp, OtherTaxBase: dppNl, VAT: ppn }, "DPP");
    const fromNl = checkRowAccuracy({ SellingPrice: dpp, OtherTaxBase: dppNl, VAT: ppn }, "DPP_NILAI_LAIN");
    const fromPpn = checkRowAccuracy({ SellingPrice: dpp, OtherTaxBase: dppNl, VAT: ppn }, "PPN");
    // A consistent invoice is never listed at all, whichever Acuan is chosen.
    expect(fromDpp).toBeNull();
    expect(fromNl).toBeNull();
    expect(fromPpn).toBeNull();
  });

  it("reproduces the old inline literals exactly", () => {
    // Guards the refactor itself: the constants must not have shifted rounding.
    expect(Math.round((12000000 * DPP_NILAI_LAIN_NUMERATOR) / DPP_NILAI_LAIN_DENOMINATOR))
      .toBe(Math.round((12000000 * 11) / 12));
    expect(Math.round(12000000 * PPN_RATE)).toBe(Math.round(12000000 * 0.11));
    expect(Math.round(11000000 * PPN_RATE_ON_NILAI_LAIN)).toBe(Math.round(11000000 * 0.12));
    expect(Math.round(1320000 / PPN_RATE)).toBe(Math.round(1320000 / 0.11));
    expect(Math.round(1320000 / PPN_RATE_ON_NILAI_LAIN)).toBe(Math.round(1320000 / 0.12));
  });
});

describe("applyCheckerStatusFilter", () => {
  function makeMockResult(status: string): CheckResult {
    return {
      taxInvoiceNumber: "001",
      invoiceDate: "01/01/2026",
      counterpartyName: "",
      counterpartyTIN: "",
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
      counterpartyName: "",
      counterpartyTIN: "",
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
