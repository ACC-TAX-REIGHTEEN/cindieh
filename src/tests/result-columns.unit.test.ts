// Unit tests for result-columns.ts — the on-screen result tables' column schema.
// These pin what used to be four index-coupled arrays inside a renderer:
// which columns exist, in what order, with which class and which cell value.
import { describe, it, expect } from "vitest";
import {
  COUNTERPARTY_LABEL,
  checkerColumns,
  checkerSchema,
  checkerSheetColumns,
  comparerSchema,
  comparerSheetColumns,
  comparisonColumns,
  type Counterparty,
} from "../content/result-columns";
import type { CheckerRowIdentity } from "../content/page-context";
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
    returnNumber: "RET-0007", returnDate: "15/07/2026",
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

describe("comparerSchema — the grid beside the wider file", () => {
  /** The sheet half's labels, in the file's own order. */
  function sheetLabels(refLainEnabled: boolean): string[] {
    return labels(comparerSheetColumns(refLainEnabled));
  }

  it("declares the file's wider columns beside the grid's, in the file's order", () => {
    expect(sheetLabels(false)).toEqual([
      "No", "Referensi", "Nama Pembeli", "Tanggal", "NIK/NPWP", "Nomor Faktur Pajak",
      "DPP Coretax", "DPP Baru", "PPN Coretax", "PPN Baru", "Selisih PPN", "Status",
    ]);
    expect(sheetLabels(true)).toEqual([
      "No", "Referensi", "Referensi Lain", "Nama Pembeli", "Tanggal", "NIK/NPWP",
      "Nomor Faktur Pajak", "DPP Coretax", "DPP Baru", "PPN Coretax", "PPN Baru",
      "Selisih PPN", "Status",
    ]);
  });

  it("gives every grid column a file column, and only three the grid does not show", () => {
    // The invariant the pairing exists for: the grid's order is the file's order
    // with the file-only columns taken out, so a column cannot be on the table
    // and missing from the sheet (or sit somewhere else there).
    const FILE_ONLY = ["Tanggal", "NIK/NPWP", "Nomor Faktur Pajak"];
    for (const refLainEnabled of [false, true]) {
      const schema = comparerSchema(refLainEnabled);
      const sheet = sheetLabels(refLainEnabled);

      expect(schema.filter((column) => column.screen === null)).toHaveLength(FILE_ONLY.length);
      expect(sheet.filter((label) => !FILE_ONLY.includes(label))).toEqual(
        labels(comparisonColumns(refLainEnabled)),
      );
      expect(sheet).toHaveLength(comparisonColumns(refLainEnabled).length + FILE_ONLY.length);
    }
  });

  it("writes the raw status and raw amounts in the file, the friendly label and formatted amounts on screen", () => {
    const row = comparison({ status: "DPP_BERBEDA" });
    const schema = comparerSchema(false);
    const sheet = comparerSheetColumns(false);

    expect(cells(comparisonColumns(false), row)).toContain("DPP Berbeda");
    expect(sheet.map((column) => column.value(row, 0))).toContain("DPP_BERBEDA");
    // A number stays a number so a spreadsheet can sum it.
    const dppCoretax = sheet.findIndex((column) => column.label === "DPP Coretax");
    expect(sheet[dppCoretax]!.value(row, 0)).toBe(row.dppSistem);
    // The file-only columns read the row's own document fields.
    const value = (label: string): string | number | null =>
      schema.find((column) => column.sheet.label === label)!.sheet.value(row, 0);
    expect(value("Tanggal")).toBe(row.invoiceDate);
    expect(value("NIK/NPWP")).toBe(row.buyerTIN);
    expect(value("Nomor Faktur Pajak")).toBe(row.taxInvoiceNumber);
  });

  it("marks the amount columns as amounts, and nothing else", () => {
    // What the workbook's number formats are derived from (exporter.resultNumberFormats).
    const amounts = comparerSheetColumns(true)
      .filter((column) => column.format === "amount")
      .map((column) => column.label);
    expect(amounts).toEqual([
      "DPP Coretax", "DPP Baru", "PPN Coretax", "PPN Baru", "Selisih PPN",
    ]);
    expect(comparerSheetColumns(true).map((column) => column.format)).not.toContain("difference");
    expect(comparerSheetColumns(true)[0]!.format).toBeUndefined();
    expect(comparerSheetColumns(true).at(-1)!.format).toBeUndefined();
  });

  it("returns a fresh schema each call", () => {
    const first = comparerSchema(false);
    first.pop();
    expect(comparerSchema(false)).toHaveLength(12);
    expect(comparerSchema(true)).toHaveLength(13);
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

  it("names and dates a retur row by its own document, not the invoice it returns", () => {
    const retur = check({ returnNumber: "RET-0007", returnDate: "15/07/2026" });
    const columns = checkerColumns("DPP", "pembeli", "no-retur");

    expect(labels(columns)).toEqual([
      "No", "No Retur", "Tanggal Retur", "Nama Pembeli",
      "DPP", "DPP NL", "PPN", "Selisih DPP NL", "Selisih PPN", "Status",
    ]);
    expect(cells(columns, retur)[1]).toBe("RET-0007");
    expect(cells(columns, retur)[2]).toBe("15/07/2026");
  });

  it("falls back to the invoice number for a retur row with no NO RETUR", () => {
    // The retur grids' counterpart of the Referensi fallback: a row that has to
    // be findable in the report even when its own identifier is missing.
    const columns = checkerColumns("DPP", "pembeli", "no-retur");
    expect(cells(columns, check({ returnNumber: "" }))[1]).toBe("04012600023333322");
  });

  it("keeps the invoice identity as the default, at the same width and class", () => {
    // The two grids differ in the WORDS and the two cells they read; the shape
    // of the table does not move, so a screenshot of either reads the same.
    const asInvoice = checkerColumns("DPP");
    const asRetur = checkerColumns("DPP", "pembeli", "no-retur");

    expect(labels(asInvoice)).toEqual(labels(checkerColumns("DPP", "pembeli", "referensi")));
    expect(asRetur.map((c) => c.className)).toEqual(asInvoice.map((c) => c.className));
    expect(asRetur.map((c) => c.label)).toEqual([
      "No", "No Retur", "Tanggal Retur",
      ...labels(asInvoice).slice(3),
    ]);
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

// ── The checker's two views of one table ──────────────
// The grid and the file used to be described separately, so a column could be
// added to one and silently left out of the other. `checkerSchema` is now the one
// definition: every column carries the sheet half (required) and, optionally,
// the table half. These pin both readings of it, and the two asymmetries that
// remain deliberate: the file's NPWP/NIK column, and a cell formatted for the
// eye but written raw for the spreadsheet.

describe("checkerSchema — one table for the grid and the file", () => {
  const BENCHMARKS: BenchmarkType[] = ["DPP", "DPP_NILAI_LAIN", "PPN"];
  const SIDES: Counterparty[] = ["pembeli", "penjual"];
  const IDENTITIES: CheckerRowIdentity[] = ["referensi", "no-retur"];

  it("is what both views read", () => {
    for (const benchmark of BENCHMARKS) {
      const schema = checkerSchema(benchmark);
      expect(labels(checkerColumns(benchmark))).toEqual(
        schema.flatMap((column) => (column.screen ? [column.screen.label] : [])),
      );
      expect(checkerSheetColumns(benchmark).map((column) => column.label)).toEqual(
        schema.map((column) => column.sheet.label),
      );
    }
  });

  it("puts every column the table shows into the file, in the same order", () => {
    // The property the shared schema exists for. A new table column without a
    // sheet half does not compile; this catches the other direction — a column
    // the file forgets, or reorders, on any of the twelve grid/benchmark pairs.
    for (const benchmark of BENCHMARKS) {
      for (const counterparty of SIDES) {
        for (const identity of IDENTITIES) {
          const table = labels(checkerColumns(benchmark, counterparty, identity));
          const sheet = checkerSheetColumns(benchmark, counterparty, identity).map((c) => c.label);
          expect(sheet.filter((label) => table.includes(label))).toEqual(table);
        }
      }
    }
  });

  it("keeps the counterparty's NPWP/NIK in the file only, and says whose it is", () => {
    for (const side of SIDES) {
      const fileOnly = checkerSchema("DPP", side)
        .filter((column) => column.screen === null)
        .map((column) => column.sheet.label);

      expect(fileOnly).toEqual([`NPWP/NIK ${COUNTERPARTY_LABEL[side]}`]);
      expect(labels(checkerColumns("DPP", side))).not.toContain(fileOnly[0]);
    }
  });

  it("formats one amount for the eye and writes the same amount raw for the sheet", () => {
    const dpp = checkerSchema("DPP").find((column) => column.sheet.label === "DPP");
    expect(dpp?.screen).not.toBeNull();

    expect(dpp?.screen?.value(check({ dppSystem: 1234 }), 0)).toBe("1.234");
    expect(dpp?.sheet.value(check({ dppSystem: 1234 }), 0)).toBe(1234);
    // Missing stays missing on both sides, but only as a cell the writer can
    // leave empty: "-" in the table, null in the file.
    expect(dpp?.screen?.value(check({ dppSystem: null }), 0)).toBe("-");
    expect(dpp?.sheet.value(check({ dppSystem: null }), 0)).toBeNull();
  });

  it("numbers the sheet's rows exactly as the table numbers them", () => {
    const no = checkerSchema("DPP")[0]!;
    expect(no.screen?.value(check(), 20)).toBe("21");
    expect(no.sheet.value(check(), 20)).toBe(21);
  });

  it("hides a difference within tolerance in the table but keeps the number in the file", () => {
    // The suppression is a display rule; a spreadsheet still gets the value.
    const row = check({ benchmark: "DPP", dppNilaiLainDiff: 1, tolerance: 1 });
    const column = checkerSchema("DPP").find((c) => c.sheet.label === "Selisih DPP NL");

    expect(column?.screen?.value(row, 0)).toBe("-");
    expect(column?.sheet.value(row, 0)).toBe(1);
  });

  it("names and dates both halves by the grid's own document", () => {
    const schema = checkerSchema("DPP", "pembeli", "no-retur");
    expect(schema.slice(1, 3).map((column) => [column.screen?.label, column.sheet.label])).toEqual([
      ["No Retur", "No Retur"],
      ["Tanggal Retur", "Tanggal Retur"],
    ]);

    const retur = check({ returnNumber: "RET-0007", returnDate: "15/07/2026" });
    expect(schema[1]?.sheet.value(retur, 0)).toBe("RET-0007");
    expect(schema[2]?.sheet.value(retur, 0)).toBe("15/07/2026");
  });

  it("gives every column a unique label, so a column can be named unambiguously", () => {
    for (const benchmark of BENCHMARKS) {
      for (const side of SIDES) {
        const sheet = checkerSheetColumns(benchmark, side).map((c) => c.label);
        expect(new Set(sheet).size).toBe(sheet.length);
      }
    }
  });
});
