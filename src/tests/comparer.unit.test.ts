import { describe, it, expect } from "vitest";
import {
  parseIndonesianNumber,
  parsePastedData,
  parseNumericField,
  compareData,
} from "../content/comparer";

describe("parseIndonesianNumber", () => {
  it("parses thousands separator (dot)", () => {
    expect(parseIndonesianNumber("568.000")).toBe(568000);
    expect(parseIndonesianNumber("1.481.203")).toBe(1481203);
  });

  it("parses decimal comma", () => {
    expect(parseIndonesianNumber("1.234,56")).toBe(1234.56);
  });

  it("parses plain numbers", () => {
    expect(parseIndonesianNumber("62.480")).toBe(62480);
    expect(parseIndonesianNumber("1000")).toBe(1000);
  });

  it("handles whitespace", () => {
    expect(parseIndonesianNumber("  568.000  ")).toBe(568000);
  });
});

describe("parsePastedData", () => {
  it("parses tab-separated rows", () => {
    const text = "SZ-0447/07/26\t568.000\t62.480\nHH-0357/07/26\t1.481.203\t162.932";
    const rows = parsePastedData(text);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ reference: "SZ-0447/07/26", dpp: 568000, ppn: 62480 });
    expect(rows[1]).toEqual({ reference: "HH-0357/07/26", dpp: 1481203, ppn: 162932 });
  });

  it("parses rows separated by 2+ spaces", () => {
    const text = "SZ-0447/07/26  568.000  62.480\nHH-0357/07/26   1.481.203   162.932";
    const rows = parsePastedData(text);
    expect(rows).toHaveLength(2);
    expect(rows[0].reference).toBe("SZ-0447/07/26");
  });

  it("parses rows with mixed spaces + tab delimiters (real Excel paste)", () => {
    const text =
      "SZ-0447/07/26 \t 568.000 \t 62.480 \n" +
      " HH-0357/07/26 \t 1.481.203 \t 162.932 \n" +
      " SP-0169/07/26  \t 1.132.023 \t 124.523 ";
    const rows = parsePastedData(text);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ reference: "SZ-0447/07/26", dpp: 568000, ppn: 62480 });
    expect(rows[1]).toEqual({ reference: "HH-0357/07/26", dpp: 1481203, ppn: 162932 });
    expect(rows[2]).toEqual({ reference: "SP-0169/07/26", dpp: 1132023, ppn: 124523 });
  });

  it("skips empty lines and invalid rows", () => {
    const text = "\nSZ-0447/07/26\t568.000\t62.480\n\n\n";
    const rows = parsePastedData(text);
    expect(rows).toHaveLength(1);
  });

  it("skips rows with fewer than 3 columns", () => {
    const text = "SZ-0447/07/26\t568.000\nHH-0357/07/26\t1.481.203\t162.932";
    const rows = parsePastedData(text);
    expect(rows).toHaveLength(1);
  });

  it("skips rows with non-numeric values", () => {
    const text = "SZ-0447/07/26\tabc\t62.480";
    const rows = parsePastedData(text);
    expect(rows).toHaveLength(0);
  });
});

describe("parseNumericField", () => {
  it("parses number values", () => {
    expect(parseNumericField(568000)).toBe(568000);
  });

  it("parses string values", () => {
    expect(parseNumericField("568.000")).toBe(568000);
  });

  it("returns null for null/undefined", () => {
    expect(parseNumericField(null)).toBeNull();
    expect(parseNumericField(undefined)).toBeNull();
  });

  it("returns null for invalid strings", () => {
    expect(parseNumericField("abc")).toBeNull();
  });
});

describe("compareData", () => {
  const scrapedData = [
    { Reference: "SZ-0447/07/26", SellingPrice: 568000, VAT: 62480, BuyerName: "PT Maju Jaya", TaxInvoiceDate: "2026-07-01", BuyerTIN: "123456789", TaxInvoiceNumber: "0400000001" },
    { Reference: "HH-0357/07/26", SellingPrice: 1481203, VAT: 162932, BuyerName: "PT Sejahtera", TaxInvoiceDate: "2026-07-02", BuyerTIN: "987654321", TaxInvoiceNumber: "0400000002" },
    { Reference: "SP-0169/07/26", SellingPrice: 1132023, VAT: 124523, BuyerName: "PT Abadi", TaxInvoiceDate: "2026-07-03", BuyerTIN: "555666777", TaxInvoiceNumber: "0400000003" },
  ];

  it("marks matching rows as COCOK", () => {
    const pasted = parsePastedData("SZ-0447/07/26\t568.000\t62.480");
    const results = compareData(pasted, scrapedData);
    expect(results[0].status).toBe("COCOK");
  });

  it("computes PPN difference (selisih)", () => {
    const pasted = parsePastedData("SZ-0447/07/26\t568.000\t62.480");
    const results = compareData(pasted, scrapedData);
    expect(results[0].ppnSelisih).toBe(0);
  });

  it("computes PPN difference when values differ", () => {
    const pasted = parsePastedData("SZ-0447/07/26\t568.000\t70.000");
    const results = compareData(pasted, scrapedData);
    expect(results[0].ppnSelisih).toBe(62480 - 70000);
  });

  it("returns null PPN difference for unmatched reference", () => {
    const pasted = parsePastedData("ZZ-9999/07/26\t568.000\t62.480");
    const results = compareData(pasted, scrapedData);
    expect(results[0].ppnSelisih).toBeNull();
  });

  it("includes buyer name from scraped row", () => {
    const pasted = parsePastedData("SZ-0447/07/26\t568.000\t62.480");
    const results = compareData(pasted, scrapedData);
    expect(results[0].buyerName).toBe("PT Maju Jaya");
  });

  it("includes export fields from scraped row", () => {
    const pasted = parsePastedData("SZ-0447/07/26\t568.000\t62.480");
    const results = compareData(pasted, scrapedData);
    expect(results[0].invoiceDate).toBe("2026-07-01");
    expect(results[0].buyerTIN).toBe("123456789");
    expect(results[0].taxInvoiceNumber).toBe("0400000001");
  });

  it("returns empty export fields for unmatched reference", () => {
    const pasted = parsePastedData("ZZ-9999/07/26\t568.000\t62.480");
    const results = compareData(pasted, scrapedData);
    expect(results[0].invoiceDate).toBe("");
    expect(results[0].buyerTIN).toBe("");
    expect(results[0].taxInvoiceNumber).toBe("");
  });

  it("returns empty buyer name for unmatched reference", () => {
    const pasted = parsePastedData("ZZ-9999/07/26\t568.000\t62.480");
    const results = compareData(pasted, scrapedData);
    expect(results[0].buyerName).toBe("");
  });

  it("marks differing DPP only as DPP_BERBEDA", () => {
    const pasted = parsePastedData("SZ-0447/07/26\t600.000\t62.480");
    const results = compareData(pasted, scrapedData);
    expect(results[0].status).toBe("DPP_BERBEDA");
  });

  it("marks differing PPN only as PPN_BERBEDA", () => {
    const pasted = parsePastedData("SZ-0447/07/26\t568.000\t70.000");
    const results = compareData(pasted, scrapedData);
    expect(results[0].status).toBe("PPN_BERBEDA");
  });

  it("marks both DPP and PPN differing as BERBEDA", () => {
    const pasted = parsePastedData("SZ-0447/07/26\t600.000\t70.000");
    const results = compareData(pasted, scrapedData);
    expect(results[0].status).toBe("BERBEDA");
  });

  it("marks unmatched reference as TIDAK_DITEMUKAN", () => {
    const pasted = parsePastedData("ZZ-9999/07/26\t568.000\t62.480");
    const results = compareData(pasted, scrapedData);
    expect(results[0].status).toBe("TIDAK_DITEMUKAN");
    expect(results[0].dppSistem).toBeNull();
    expect(results[0].ppnSistem).toBeNull();
  });

  it("matches reference case-insensitively", () => {
    const pasted = parsePastedData("sz-0447/07/26\t568.000\t62.480");
    const results = compareData(pasted, scrapedData);
    expect(results[0].status).toBe("COCOK");
  });

  it("allows difference within tolerance", () => {
    const pasted = parsePastedData("SZ-0447/07/26\t568.000,5\t62.480");
    const results = compareData(pasted, scrapedData, 1);
    expect(results[0].status).toBe("COCOK");
  });

  it("marks difference beyond tolerance as differing", () => {
    const pasted = parsePastedData("SZ-0447/07/26\t568.000,5\t62.480");
    const results = compareData(pasted, scrapedData, 0);
    expect(results[0].status).toBe("DPP_BERBEDA");
  });

  it("includes coretax-only rows on given dates in daily mode", () => {
    const pasted = parsePastedData("SZ-0447/07/26\t568.000\t62.480");
    // Only SZ is pasted; HH (day 2) and SP (day 3) are in coretax.
    const results = compareData(pasted, scrapedData, 0, [2, 3]);
    const statuses = results.map((r) => r.status);
    expect(statuses).toContain("HANYA_CORETAX");
    const onlyCoretax = results.filter((r) => r.status === "HANYA_CORETAX");
    expect(onlyCoretax.length).toBe(2);
    expect(onlyCoretax.some((r) => r.reference === "HH-0357/07/26")).toBe(true);
    expect(onlyCoretax.some((r) => r.reference === "SP-0169/07/26")).toBe(true);
    // Excel-only fields are null for coretax-only rows
    expect(onlyCoretax[0].dppExcel).toBeNull();
    expect(onlyCoretax[0].ppnExcel).toBeNull();
  });

  it("does not include coretax-only rows when daily mode is disabled", () => {
    const pasted = parsePastedData("SZ-0447/07/26\t568.000\t62.480");
    const results = compareData(pasted, scrapedData, 0, null);
    const statuses = results.map((r) => r.status);
    expect(statuses).not.toContain("HANYA_CORETAX");
    expect(results.length).toBe(1);
  });

  it("does not include coretax-only rows outside the selected dates", () => {
    const pasted = parsePastedData("SZ-0447/07/26\t568.000\t62.480");
    // Only day 1 selected; HH (day 2) and SP (day 3) excluded.
    const results = compareData(pasted, scrapedData, 0, [1]);
    const statuses = results.map((r) => r.status);
    expect(statuses).not.toContain("HANYA_CORETAX");
  });

  it("does not duplicate pasted rows that also exist in coretax", () => {
    const pasted = parsePastedData("SZ-0447/07/26\t568.000\t62.480");
    const results = compareData(pasted, scrapedData, 0, [1, 2, 3]);
    const szCount = results.filter((r) => r.reference === "SZ-0447/07/26").length;
    expect(szCount).toBe(1);
  });
});
