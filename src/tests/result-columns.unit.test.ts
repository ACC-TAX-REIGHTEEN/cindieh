// Unit tests for result-columns.ts — the on-screen result tables' column schema.
// These pin what used to be four index-coupled arrays inside a renderer:
// which columns exist, in what order, with which class and which cell value.
import { describe, it, expect } from "vitest";
import { comparisonColumns, checkerColumns } from "../content/result-columns";
import type { ComparisonResult, ComparisonStatus } from "../content/comparer";
import type { BenchmarkType, CheckResult } from "../content/checker-logic";

function comparison(overrides: Partial<ComparisonResult> = {}): ComparisonResult {
  return {
    reference: "000123", refLain: "000456", buyerName: "Pembeli", invoiceDate: "01/07/2026",
    buyerTIN: "0012345678901234", taxInvoiceNumber: "04012600023333322",
    dppSistem: 1000, dppExcel: 1100, ppnSistem: 110, ppnExcel: 121, ppnSelisih: -11,
    status: "BERBEDA", ...overrides,
  };
}

function check(overrides: Partial<CheckResult> = {}): CheckResult {
  return {
    reference: "000123", counterpartyName: "Pembeli", invoiceDate: "01/07/2026",
    counterpartyTIN: "0012345678901234", taxInvoiceNumber: "04012600023333322",
    dppSystem: 1000, dppNilaiLainSystem: 916, ppnSystem: 100,
    dppExpected: 1000, dppNilaiLainExpected: 916, ppnExpected: 100,
    dppDiff: 5, dppNilaiLainDiff: -4, ppnDiff: 3,
    tolerance: 1, benchmark: "DPP", status: "DPP NL Berbeda", ...overrides,
  };
}

/** The header labels, which is what a reader actually sees. */
function labels(columns: readonly { label: string }[]): string[] {
  return columns.map((c) => c.label);
}

/** Render one row to cell text. */
function cells<T>(columns: readonly { value: (row: T, i: number) => string }[], row: T, index = 0): string[] {
  return columns.map((c) => c.value(row, index));
}

describe("comparisonColumns", () => {
  it("lays out nine columns without Referensi Lain", () => {
    expect(labels(comparisonColumns(false))).toEqual([
      "No", "Referensi", "Nama Pembeli",
      "DPP Coretax", "DPP Baru", "PPN Coretax", "PPN Baru", "Selisih PPN", "Status",
    ]);
  });

  it("inserts Referensi Lain directly after Referensi, shifting the rest right", () => {
    // The old rotation produced this by nine chained ternaries; the position
    // is the whole point, so it is asserted explicitly.
    expect(labels(comparisonColumns(true))).toEqual([
      "No", "Referensi", "Referensi Lain", "Nama Pembeli",
      "DPP Coretax", "DPP Baru", "PPN Coretax", "PPN Baru", "Selisih PPN", "Status",
    ]);
  });

  it("adds exactly one column in Referensi Lain mode", () => {
    expect(comparisonColumns(true)).toHaveLength(comparisonColumns(false).length + 1);
  });

  it("marks both reference columns with the ref class and only the amounts numeric", () => {
    const on = comparisonColumns(true);
    expect(on[1].className).toBe("ch-col-ref");
    expect(on[2].className).toBe("ch-col-ref");
    expect(on[3].className).toBe("ch-col-buyer");
    expect(on[on.length - 1].className).toBe("ch-col-status");
    expect(on.filter((c) => c.numeric).map((c) => c.label)).toEqual([
      "No", "DPP Coretax", "DPP Baru", "PPN Coretax", "PPN Baru", "Selisih PPN",
    ]);
  });

  it("renders each cell from its own row field", () => {
    const row = comparison();
    expect(cells(comparisonColumns(false), row)).toEqual([
      "1", "000123", "Pembeli", "1.000", "1.100", "110", "121", "-11", "Berbeda",
    ]);
    expect(cells(comparisonColumns(true), row)[2]).toBe("000456");
  });

  it("shows the friendly status label, not the raw code", () => {
    const cases: [ComparisonStatus, string][] = [
      ["COCOK", "Cocok"],
      ["DPP_BERBEDA", "DPP Berbeda"],
      ["BERBEDA", "Berbeda"],
      ["TIDAK_DITEMUKAN", "Tidak ditemukan"],
      ["HANYA_CORETAX", "Hanya di Coretax"],
    ];
    for (const [status, expected] of cases) {
      const rendered = cells(comparisonColumns(false), comparison({ status }));
      expect(rendered[rendered.length - 1]).toBe(expected);
    }
  });

  it("distinguishes a missing amount from zero", () => {
    // Index 4 is "DPP Baru" (dppExcel); index 3 is "DPP Coretax".
    expect(cells(comparisonColumns(false), comparison({ dppExcel: null }))[4]).toBe("-");
    expect(cells(comparisonColumns(false), comparison({ dppExcel: 0 }))[4]).toBe("0");
  });

  it("numbers rows from the page's start index rather than restarting", () => {
    expect(cells(comparisonColumns(false), comparison(), 20)[0]).toBe("21");
  });
});

describe("checkerColumns", () => {
  const BENCHMARKS: BenchmarkType[] = ["DPP", "DPP_NILAI_LAIN", "PPN"];

  it.each(BENCHMARKS)("lays out ten columns for the %s benchmark", (benchmark) => {
    expect(checkerColumns(benchmark)).toHaveLength(10);
  });

  it("pairs each benchmark's differences with the values it derives", () => {
    // A DPP NL column shows a wider cell, because the amount is long.
    expect(labels(checkerColumns("DPP"))).toEqual([
      "No", "Referensi", "Tanggal", "Nama Pembeli", "DPP", "DPP NL", "PPN",
      "Selisih DPP NL", "Selisih PPN", "Status",
    ]);
    expect(labels(checkerColumns("DPP_NILAI_LAIN"))).toEqual([
      "No", "Referensi", "Tanggal", "Nama Pembeli", "DPP", "DPP NL", "PPN",
      "Selisih DPP", "Selisih PPN", "Status",
    ]);
    expect(labels(checkerColumns("PPN"))).toEqual([
      "No", "Referensi", "Tanggal", "Nama Pembeli", "DPP", "DPP NL", "PPN",
      "Selisih DPP", "Selisih DPP NL", "Status",
    ]);
  });

  it("gives every DPP NL column the wide class and no other column", () => {
    for (const benchmark of BENCHMARKS) {
      const wide = checkerColumns(benchmark)
        .filter((c) => c.className === "ch-col-num-wide")
        .map((c) => c.label);
      expect(wide).toEqual(["DPP NL", ...checkerColumns(benchmark)
        .map((c) => c.label)
        .filter((l) => l.startsWith("Selisih") && l.includes("NL"))]);
    }
  });

  it("classifies the leading columns the same way for every benchmark", () => {
    for (const benchmark of BENCHMARKS) {
      const columns = checkerColumns(benchmark);
      expect(columns[0].className).toBe("ch-col-no");
      expect(columns[1].className).toBe("ch-col-ref");
      expect(columns[2].className).toBe("ch-col-date");
      expect(columns[3].className).toBe("ch-col-buyer");
      expect(columns[columns.length - 1].className).toBe("ch-col-status");
    }
  });

  it("renders the DPP benchmark's derived differences as its two columns", () => {
    const row = check({ benchmark: "DPP" });
    expect(cells(checkerColumns("DPP"), row).slice(7, 9)).toEqual(["-4", "+3"]);
  });

  it("renders the DPP NL benchmark's derived differences as its two columns", () => {
    const row = check({ benchmark: "DPP_NILAI_LAIN" });
    expect(cells(checkerColumns("DPP_NILAI_LAIN"), row).slice(7, 9)).toEqual(["+5", "+3"]);
  });

  it("renders the PPN benchmark's derived differences as its two columns", () => {
    const row = check({ benchmark: "PPN" });
    expect(cells(checkerColumns("PPN"), row).slice(7, 9)).toEqual(["+5", "-4"]);
  });

  it("reads a difference from the ROW's benchmark, not the column's", () => {
    // Every row in a run comes from one checkAllRowsAccuracy call so the two
    // agree; this pins that a row still drives its own cells if that changes.
    const row = check({ benchmark: "PPN" });
    expect(cells(checkerColumns("DPP"), row).slice(7, 9)).toEqual(["+5", "-4"]);
  });

  it("suppresses a difference inside tolerance and shows a missing one as a dash", () => {
    expect(cells(checkerColumns("DPP"), check({ benchmark: "DPP", dppNilaiLainDiff: 1 }))[7]).toBe("-");
    expect(cells(checkerColumns("DPP"), check({ benchmark: "DPP", dppNilaiLainDiff: null }))[7]).toBe("-");
    expect(cells(checkerColumns("DPP"), check({ benchmark: "DPP", dppNilaiLainDiff: -2 }))[7]).toBe("-2");
  });

  it("falls back to the tax-invoice number when a row has no Referensi", () => {
    const row = check({ reference: "", benchmark: "DPP" });
    expect(cells(checkerColumns("DPP"), row)[1]).toBe("04012600023333322");
  });

  it("shows the raw checker status, unlike the comparer's friendly label", () => {
    expect(cells(checkerColumns("DPP"), check({ benchmark: "DPP" }))[9]).toBe("DPP NL Berbeda");
  });

  it("names the counterparty for the side of the transaction", () => {
    // PPN Masukan carries the SELLER. Calling that column "Nama Pembeli" there
    // would describe the taxpayer's own side and mislead.
    expect(labels(checkerColumns("DPP", "pembeli"))[3]).toBe("Nama Pembeli");
    expect(labels(checkerColumns("DPP", "penjual"))[3]).toBe("Nama Penjual");
    // The default stays the PPN Keluaran wording, so existing callers are unchanged.
    expect(labels(checkerColumns("DPP"))).toEqual(labels(checkerColumns("DPP", "pembeli")));
  });

  it("keeps the seller column at the same position and width as the buyer's", () => {
    const asBuyer = checkerColumns("DPP", "pembeli");
    const asSeller = checkerColumns("PPN", "penjual");
    expect(asSeller).toHaveLength(asBuyer.length);
    expect(asSeller[3]!.className).toBe(asBuyer[3]!.className);
    // Only the label differs — the counterparty cell reads the same field.
    expect(cells(asSeller, check())[3]).toBe(cells(asBuyer, check())[3]);
  });

  it("returns a fresh array each call, so a caller cannot corrupt the schema", () => {
    const first = checkerColumns("DPP");
    first.pop();
    expect(checkerColumns("DPP")).toHaveLength(10);
    expect(comparisonColumns(false)).toHaveLength(9);
    expect(comparisonColumns(false)).toHaveLength(9);
  });
});
