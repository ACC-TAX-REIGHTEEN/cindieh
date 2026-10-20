import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import type { ComparisonResult } from "../content/comparer";
import type { BenchmarkType, CheckResult } from "../content/checker-logic";
import {
  buildCheckerExportRows,
  buildComparisonExportRows,
  CHECKER_EXPORT_BASENAME,
  COMPARISON_EXPORT_BASENAME,
  RESULT_EXPORT_LABELS,
  resultExportFilename,
} from "../content/comparer-export";
import {
  checkerColumns,
  checkerSheetColumns,
  comparerSheetColumns,
  formatResultDifference,
  formatResultNumber,
} from "../content/result-columns";
import {
  buildAoaWorkbook,
  buildCSV,
  resultNumberFormats,
  RESULT_DIFFERENCE_FORMAT,
  RESULT_NUMBER_FORMAT,
} from "../content/exporter";
import { stubFakeDom, type FakeDoc, type FakeEl } from "./__mocks__/fake-dom";

vi.mock("../content/main-actions", () => ({
  startScrape: vi.fn(),
}));
// The panel no longer reads run state off a ContentState; it asks a Run
// (ADR-0014). One instance per module-registry reset keeps each case isolated,
// exactly as the old per-test createContentState() did.
vi.mock("../content/run-lifecycle", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../content/run-lifecycle")>();
  return { ...actual, runLifecycle: actual.createRunLifecycle() };
});
// The page predicates default to TRUE: the panel gates its two tabs on which
// page it is (the Komparator is PPN Keluaran's alone, Pengecekan runs on the
// four e-Faktur PPN grids), and nearly every case here needs both tabs present.
// The gating cases move these instead of stubbing a URL, because this file
// replaces page-context wholesale — a location stub could never reach the mock.
//
// `output` and `returns` name the grid; `vat` says whether it carries a
// Referensi column (the filter's fact AND the checker's identity column, which
// the retur grids get as "No Retur"), and `identity` is the Komparator's own
// gate — deliberately separate from all of them: the panel asks whether a
// Referensi identifies a row here, not which of the four grids this is.
// `vi.hoisted` because the factory below runs above the module body.
const pageGates = vi.hoisted(() => ({
  output: true,
  returns: false,
  vat: true,
  identity: true,
  checker: true,
  // A URL none of the four knows, which `openPanel` documents as reachable for
  // a caller that is not going through the toolbar.
  unknown: false,
}));
vi.mock("../content/page-context", () => ({
  isOutputTaxPage: () => !pageGates.unknown && pageGates.output && !pageGates.returns,
  isInputTaxPage: () => !pageGates.unknown && !pageGates.output && !pageGates.returns,
  isOutputReturnPage: () => !pageGates.unknown && pageGates.output && pageGates.returns,
  isInputReturnPage: () => !pageGates.unknown && !pageGates.output && pageGates.returns,
  isCheckerPage: () => pageGates.checker,
  isPanelPage: () => pageGates.checker || pageGates.identity,
  referenceIsIdentity: () => pageGates.identity,
  // The filter's fact tracks the VAT grids: Pengecekan's tab imports it for the
  // hand-back, which is what the panel gates on `identity` above.
  hasReferenceFilter: () => pageGates.vat,
  checkerRowIdentity: () => (pageGates.vat ? "referensi" : "no-retur"),
  // A retur row on the Keluaran side carries the BUYER: the counterparty follows
  // the SIDE, not the grid kind.
  counterpartyIsBuyer: () => pageGates.output,
  // The panel reads its per-grid facts from ONE row (page-context.PANEL_GRIDS),
  // so this file — which replaces the module wholesale — supplies a row instead
  // of only the predicates. The knobs above still drive every other stub.
  panelGridFacts: () =>
    pageGates.unknown
      ? null
      : {
          label: pageGates.returns
            ? pageGates.output
              ? "Retur PPN Keluaran"
              : "Retur PPN Masukan"
            : pageGates.output
              ? "PPN Keluaran"
              : "PPN Masukan",
          statusLabel: pageGates.returns
            ? pageGates.output
              ? "Retur PPN Keluaran"
              : "Retur PPN Masukan"
            : pageGates.output
              ? "e-Faktur PPN Keluaran"
              : "e-Faktur PPN Masukan",
          counterpartyIsBuyer: pageGates.output,
          rowIdentity: pageGates.vat ? "referensi" : "no-retur",
          comparerTab: pageGates.identity,
          checkerTab: pageGates.checker,
          referenceFilter: pageGates.vat,
        },
}));

const comparison: ComparisonResult = {
  reference: "000123", refLain: "000456", buyerName: "Pembeli",
  invoiceDate: "2026-07-01", buyerTIN: "0012345678901234",
  taxInvoiceNumber: "04012600023333322",
  dppSistem: 1234567.890123, dppExcel: 1234567.125678,
  ppnSistem: 0, ppnExcel: 0.1234567, ppnSelisih: -0.1234567,
  status: "BERBEDA",
};
const checker: CheckResult = {
  reference: "000123", counterpartyName: "Pembeli", invoiceDate: "01/07/2026",
  returnNumber: "RET-0007", returnDate: "15/07/2026",
  counterpartyTIN: "0012345678901234", taxInvoiceNumber: "04012600023333322",
  dppSystem: 1234567.890123, dppNilaiLainSystem: 1131687.125678, ppnSystem: 0,
  dppExpected: 1234567, dppNilaiLainExpected: 1131687, ppnExpected: 0,
  dppDiff: -0.1234567, dppNilaiLainDiff: 0.9876543, ppnDiff: 0,
  tolerance: 1, benchmark: "DPP", status: "DPP NL Berbeda",
};

function readback(workbook: XLSX.WorkBook): XLSX.WorkSheet {
  const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const read = XLSX.read(bytes, { type: "array", cellNF: true });
  return read.Sheets[read.SheetNames[0]];
}

function expectNumeric(cell: XLSX.CellObject, value: number, format = RESULT_NUMBER_FORMAT): void {
  expect(cell.t).toBe("n");
  expect(cell.v).toBe(value);
  expect(cell.z).toBe(format);
}

function expectText(cell: XLSX.CellObject, value: string): void {
  expect(cell.t).toBe("s");
  expect(cell.v).toBe(value);
  expect(cell.f).toBeUndefined();
}

/**
 * Split one CSV line into its cells, honouring quotes and doubled quotes. This
 * is what the property under test actually needs: a quoted comma must not shift
 * every later column, and a regex over the raw line cannot tell the difference
 * between "a,b" as one cell and as two.
 */
function csvCells(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      cells.push(current);
      current = "";
    } else current += ch;
  }
  cells.push(current);
  return cells;
}

describe("result grid filenames", () => {
  // The panel used to spell these out as literals at each download call site.
  // They moved into comparer-export.ts so the button labels, the generated file
  // and the microsite samples all derive from one place — which is also where
  // microsite-sync.unit.test.ts now reads them from.
  it("appends the extension for each format", () => {
    expect(resultExportFilename(COMPARISON_EXPORT_BASENAME, "xlsx")).toBe("perbandingan-faktur.xlsx");
    expect(resultExportFilename(COMPARISON_EXPORT_BASENAME, "csv")).toBe("perbandingan-faktur.csv");
  });

  it("keeps the two grids on distinct base names", () => {
    expect(COMPARISON_EXPORT_BASENAME).not.toBe(CHECKER_EXPORT_BASENAME);
    expect(resultExportFilename(CHECKER_EXPORT_BASENAME, "xlsx").endsWith(".xlsx")).toBe(true);
  });

  it("labels both format buttons in the panel's own wording", () => {
    expect(RESULT_EXPORT_LABELS).toEqual({ xlsx: "Excel", csv: "CSV" });
  });
});

describe("result CSV rows", () => {
  // CSV is hand-rolled, so the same grid must survive the text path with its
  // amounts still numeric-looking and its commas quoted rather than shifting
  // every later column by one.
  it("writes the comparison file's wider columns, in the file's order", () => {
    // The exported contract, pinned at the export boundary: the three columns the
    // panel's grid never shows sit between Nama Pembeli and the amounts exactly
    // as the schema declares them (ADR-0030).
    expect(buildComparisonExportRows([comparison], false)[0]).toEqual([
      "No", "Referensi", "Nama Pembeli", "Tanggal", "NIK/NPWP", "Nomor Faktur Pajak",
      "DPP Coretax", "DPP Baru", "PPN Coretax", "PPN Baru", "Selisih PPN", "Status",
    ]);
  });

  it("writes the comparison grid with the same column count as the XLSX grid", () => {
    const rows = buildComparisonExportRows([comparison], true);
    const lines = buildCSV(rows).replace("\uFEFF", "").trim().split("\n");
    expect(csvCells(lines[0]!)).toHaveLength(rows[0]!.length);
    expect(csvCells(lines[1]!)).toHaveLength(rows[0]!.length);
    expect(lines[0]).toContain("Referensi");
  });

  it("keeps a quoted comma inside one cell instead of shifting the columns", () => {
    // The property that makes the text format usable next to Excel: a company
    // name containing a comma must not renumber every amount after it.
    const rows = buildComparisonExportRows([{ ...comparison, buyerName: 'PT A, "B" S.E.' }], true);
    const lines = buildCSV(rows).replace("\uFEFF", "").trim().split("\n");
    expect(lines[1]).toContain('"PT A, ""B"" S.E."');
    expect(csvCells(lines[1]!)).toHaveLength(rows[0]!.length);
    expect(csvCells(lines[1]!)[rows[0]!.indexOf("Nama Pembeli")]).toBe('PT A, "B" S.E.');
  });

  it("writes the checker grid header verbatim", () => {
    const rows = buildCheckerExportRows([checker], "DPP");
    const lines = buildCSV(rows).replace("\uFEFF", "").trim().split("\n");
    expect(csvCells(lines[0]!)).toEqual(rows[0]!.map(String));
    expect(lines[0]).toContain("DPP NL");
  });

  it("keeps the amounts numeric rather than quoted, so a spreadsheet can sum them", () => {
    const rows = buildCheckerExportRows([checker], "DPP");
    const cells = csvCells(
      buildCSV(rows).replace("\uFEFF", "").trim().split("\n")[1]!,
    );
    // DPP / DPP NL / PPN are columns 5-7 of the grid; numbers must survive as
    // bare values, which is the whole reason the result grids number-format
    // those columns in the XLSX path.
    for (const i of [5, 6, 7]) {
      expect(cells[i]).toBe(String(rows[1]![i]));
      expect(Number.isNaN(Number(cells[i]))).toBe(false);
    }
  });
});

describe("the workbook's number formats follow the column schema", () => {
  it("formats the comparison's amount columns wherever the schema puts them", () => {
    // The positions used to be arithmetic here (`refLain ? 7 : 6`), which is the
    // drift the shared schema removes: the three file-only columns move every
    // amount one place right, and only the schema knows that.
    expect(resultNumberFormats(comparerSheetColumns(false))).toEqual({
      6: RESULT_NUMBER_FORMAT,
      7: RESULT_NUMBER_FORMAT,
      8: RESULT_NUMBER_FORMAT,
      9: RESULT_NUMBER_FORMAT,
      10: RESULT_NUMBER_FORMAT,
    });
    expect(resultNumberFormats(comparerSheetColumns(true))).toEqual({
      7: RESULT_NUMBER_FORMAT,
      8: RESULT_NUMBER_FORMAT,
      9: RESULT_NUMBER_FORMAT,
      10: RESULT_NUMBER_FORMAT,
      11: RESULT_NUMBER_FORMAT,
    });
  });

  it("keeps the checker's signed difference columns signed", () => {
    expect(resultNumberFormats(checkerSheetColumns("DPP"))).toEqual({
      5: RESULT_NUMBER_FORMAT,
      6: RESULT_NUMBER_FORMAT,
      7: RESULT_NUMBER_FORMAT,
      8: RESULT_DIFFERENCE_FORMAT,
      9: RESULT_DIFFERENCE_FORMAT,
    });
  });
});

describe("result XLSX rows and AOA readback", () => {
  it.each([true, false])("preserves comparison values with refLain=%s", (refLainEnabled) => {
    const rows = buildComparisonExportRows([comparison, {
      ...comparison, dppSistem: null, ppnSistem: null, ppnSelisih: null,
      status: "TIDAK_DITEMUKAN",
    }, {
      ...comparison, dppExcel: null, ppnExcel: null, ppnSelisih: null,
      status: "HANYA_CORETAX",
    }], refLainEnabled);
    const first = refLainEnabled ? 7 : 6;
    const sheet = readback(buildAoaWorkbook(XLSX, rows, "Perbandingan", {
      numberFormats: Object.fromEntries(Array.from({ length: 5 }, (_, i) => [first + i, RESULT_NUMBER_FORMAT])),
    }));
    const cell = (r: number, c: number) => sheet[XLSX.utils.encode_cell({ r, c })];
    [comparison.dppSistem, comparison.dppExcel, comparison.ppnSistem, comparison.ppnExcel, comparison.ppnSelisih]
      .forEach((value, i) => expectNumeric(cell(1, first + i), value!));
    expectText(cell(1, 1), comparison.reference);
    if (refLainEnabled) expectText(cell(1, 2), comparison.refLain);
    expectText(cell(1, first - 2), comparison.buyerTIN);
    expectText(cell(1, first - 1), comparison.taxInvoiceNumber);
    expect(cell(2, first)).toBeUndefined();
    expect(cell(2, first + 2)).toBeUndefined();
    expect(cell(2, first + 4)).toBeUndefined();
    expect(cell(3, first + 1)).toBeUndefined();
    expect(cell(3, first + 3)).toBeUndefined();
    expect(rows.every((row) => row.length === rows[0].length)).toBe(true);
  });

  it.each<BenchmarkType>(["DPP", "DPP_NILAI_LAIN", "PPN"])("preserves checker values for %s, including differences within tolerance", (benchmark) => {
    const rows = buildCheckerExportRows([{ ...checker, benchmark }], benchmark);
    const sheet = readback(buildAoaWorkbook(XLSX, rows, "Pengecekan", {
      numberFormats: resultNumberFormats(checkerSheetColumns(benchmark)),
    }));
    // Positions come from the header the schema wrote, never counted here: the
    // retur identity and the counterparty's NPWP sit ahead of the amounts, and a
    // hand-written letter (F2, G2...) is exactly what stopped following them.
    const header = rows[0] as string[];
    const at = (label: string) => header.indexOf(label);
    const cellAt = (rowNumber: number, label: string) =>
      sheet[XLSX.utils.encode_cell({ r: rowNumber, c: at(label) })]!;

    expectNumeric(cellAt(1, "DPP"), checker.dppSystem!);
    expectNumeric(cellAt(1, "DPP NL"), checker.dppNilaiLainSystem!);
    expectNumeric(cellAt(1, "PPN"), 0);
    expectNumeric(cellAt(1, benchmark === "DPP" ? "Selisih DPP NL" : "Selisih DPP"),
      (benchmark === "DPP" ? checker.dppNilaiLainDiff : checker.dppDiff)!, RESULT_DIFFERENCE_FORMAT);
    expectNumeric(cellAt(1, benchmark === "PPN" ? "Selisih DPP NL" : "Selisih PPN"),
      (benchmark === "PPN" ? checker.dppNilaiLainDiff : checker.ppnDiff)!, RESULT_DIFFERENCE_FORMAT);
    expectText(cellAt(1, "Referensi"), checker.reference);
    expectText(cellAt(1, "NPWP/NIK Pembeli"), checker.counterpartyTIN);
    // The two signed columns stay together, in schema order, right before Status.
    expect(header.slice(at("PPN") + 1, at("Status"))).toEqual([
      benchmark === "DPP" ? "Selisih DPP NL" : "Selisih DPP",
      benchmark === "PPN" ? "Selisih DPP NL" : "Selisih PPN",
    ]);
  });

  it.each([
    ["pembeli", ["Nama Pembeli", "NPWP/NIK Pembeli"]],
    ["penjual", ["Nama Penjual", "NPWP/NIK Penjual"]],
  ] as const)("heads the checker export with the %s counterparty", (side, expected) => {
    // The sheet has to say what the grid says; a PPN Masukan export labelled
    // "Pembeli" would name the taxpayer's own side.
    const header = buildCheckerExportRows([checker], "DPP", side)[0];
    expect(header[3]).toBe(expected[0]);
    expect(header[4]).toBe(expected[1]);
  });

  it("keeps the PPN Keluaran header as the default", () => {
    const header = buildCheckerExportRows([checker], "DPP")[0];
    expect(header[3]).toBe("Nama Pembeli");
    expect(header[4]).toBe("NPWP/NIK Pembeli");
  });

  it("derives the checker header from the column schema the grid renders", () => {
    // One table decides both views (result-columns.checkerSchema). Spelling a
    // header out in this module again — which is what used to happen, with its
    // own benchmark ternaries — is exactly what this fails on: every label must
    // be the schema's, in the schema's order, with every table column present.
    for (const benchmark of ["DPP", "DPP_NILAI_LAIN", "PPN"] as const) {
      for (const side of ["pembeli", "penjual"] as const) {
        const header = buildCheckerExportRows([checker], benchmark, side)[0];

        expect(header).toEqual(checkerSheetColumns(benchmark, side).map((column) => column.label));

        const table = checkerColumns(benchmark, side).map((column) => column.label);
        expect(header.filter((label) => table.includes(String(label)))).toEqual(table);
      }
    }
  });

  it("names and dates a retur row's sheet by its own document", () => {
    // A retur sheet identifies its rows the way the grid does: the NO RETUR and
    // the retur date, not the reference and invoice date of the invoice the
    // retur returns (which the row also carries).
    const rows = buildCheckerExportRows([checker], "DPP", "pembeli", "no-retur");

    expect(rows[0].slice(0, 3)).toEqual(["No", "No Retur", "Tanggal Retur"]);
    expect(rows[1][1]).toBe(checker.returnNumber);
    expect(rows[1][2]).toBe(checker.returnDate);
  });

  it("falls back to the invoice number for a retur row with no NO RETUR", () => {
    const rows = buildCheckerExportRows(
      [{ ...checker, returnNumber: "" }],
      "DPP",
      "pembeli",
      "no-retur",
    );

    expect(rows[1][1]).toBe(checker.taxInvoiceNumber);
  });

  it("leaves the invoice grids' sheet exactly as it was", () => {
    // The default identity is the pre-existing one, field for field: the retur
    // grids joined without moving what PPN Keluaran and PPN Masukan export.
    const rows = buildCheckerExportRows([checker], "DPP", "pembeli", "referensi");

    expect(rows[0].slice(0, 3)).toEqual(["No", "Referensi", "Tanggal"]);
    expect(rows[1][1]).toBe(checker.reference);
    expect(rows[1][2]).toBe(checker.invoiceDate);
  });

  it("leaves incomplete checker amounts blank and preserves invoice fallback identifiers", () => {
    const rows = buildCheckerExportRows([{
      ...checker, reference: "", dppSystem: null, dppNilaiLainSystem: null,
      ppnSystem: 0, dppDiff: null, dppNilaiLainDiff: null, ppnDiff: null,
      status: "Data tidak lengkap",
    }], "DPP");
    const sheet = readback(buildAoaWorkbook(XLSX, rows));
    for (const address of ["F2", "G2", "I2", "J2"]) expect(sheet[address]).toBeUndefined();
    expect(sheet.H2).toMatchObject({ t: "n", v: 0 });
    expectText(sheet.B2, checker.taxInvoiceNumber);
    expectText(sheet.K2, "Data tidak lengkap");
  });

  it("does not infer numbers or formulas from text, even in formatted columns", () => {
    const sheet = readback(buildAoaWorkbook(XLSX, [
      ["Referensi", "Nilai"], ["=1+1", "00123"], ["+001", "1.234,56789"],
    ], "Hasil", { numberFormats: { 0: RESULT_NUMBER_FORMAT, 1: RESULT_NUMBER_FORMAT } }));
    expectText(sheet.A2, "=1+1");
    expectText(sheet.B2, "00123");
    expectText(sheet.A3, "+001");
    expectText(sheet.B3, "1.234,56789");
  });

  it("distinguishes missing UI amounts from zero and suppresses insignificant UI differences", () => {
    expect(formatResultNumber(null)).toBe("-");
    expect(formatResultNumber(0)).toBe("0");
    expect(formatResultDifference(null, 0)).toBe("-");
    expect(formatResultDifference(0.5, 1)).toBe("-");
    expect(formatResultDifference(1234.5, 0)).toBe("+1.234,5");
    expect(formatResultDifference(-1234.5, 0)).toBe("-1.234,5");
  });
});

describe("comparison UI validation and exports", () => {
  let doc: FakeDoc;
  let ui: typeof import("../content/ui-comparer");
  // The Komparator tab is its own view module now (ADR-0036); the panel above
  // only hosts it.
  let comparer: typeof import("../content/ui-comparer-view");
  let actions: typeof import("../content/main-actions");
  let exporter: typeof import("../content/exporter");
  let run: import("../content/run-lifecycle").RunLifecycle;

  /** Put rows in the Run the way a finished scrape would; null means none. */
  function seedRows(rows: Record<string, unknown>[] | null): void {
    if (rows === null) {
      run.reset();
      return;
    }
    run.begin("scrape");
    run.complete({
      type: "SCRAPE_COMPLETE",
      data: rows,
      fields: ["Reference", "SellingPrice", "OtherTaxBase", "VAT", "BuyerTIN", "TaxInvoiceNumber"],
      total: rows.length,
      pages: 1,
      elapsed: "1s",
      source: "OUTPUT_TAX",
    });
  }

  // Extend only this test's fake with innerHTML clearing and form properties.
  function el(id: string): FakeEl & { disabled: boolean; checked: boolean; innerHTML: string } {
    return doc.getElementById(id)! as ReturnType<typeof el>;
  }
  function fire(id: string, event = "click"): void {
    for (const listener of el(id).listeners[event] ?? []) listener();
  }
  function runValid(): void {
    el("ch-comparer-textarea").value = "000123\t000456\t1.234,56789\t0";
    el("ch-comparer-daily-dates").value = "1";
    seedRows([{
      Reference: "000123", SellingPrice: 1234.56789, VAT: 0,
      BuyerTIN: comparison.buyerTIN, TaxInvoiceNumber: comparison.taxInvoiceNumber,
    }]);
    fire("ch-comparer-check-btn");
    expect(el("ch-comparer-export-btn").disabled).toBe(false);
  }
  function expectCleared(): void {
    expect(el("ch-comparer-results").innerHTML).toBe("");
    expect(el("ch-comparer-results").children).toHaveLength(0);
    expect(el("ch-comparer-results").classList.contains("ch-hidden")).toBe(true);
    expect(el("ch-comparer-filter-wrap").classList.contains("ch-hidden")).toBe(true);
    expect(el("ch-comparer-export-btn").disabled).toBe(true);
    expect(el("ch-comparer-status").className).toContain("status-error");
    expect(el("ch-comparer-textarea").classList.contains("ch-hidden")).toBe(false);
    fire("ch-comparer-export-btn");
    expect(exporter.downloadXLSXFile).not.toHaveBeenCalled();
  }

  it("replaces the waiting line with the reason it will not arrive", () => {
    // A stop, a failure, a lost chunk or a reset retires the comparison behind
    // that line, so no completion will arrive to answer it. The badge carries the
    // stop's own account; the tab says, in one line, why nothing is coming
    // (ADR-0026).
    seedRows(null);
    el("ch-comparer-textarea").value = "000123\t000456\t1.234,56789\t0";
    // Daily mode is on by default, so the day list is part of a valid check.
    el("ch-comparer-daily-dates").value = "1";
    fire("ch-comparer-check-btn");
    expect(el("ch-comparer-status").textContent).toContain("Mohon tunggu");

    comparer.dropPendingCompare();

    expect(el("ch-comparer-status").textContent).toContain("Permintaan dibatalkan");
    expect(el("ch-comparer-status").textContent).not.toBe("");
    // Quiet weight: the badge is the primary account, so the tab's line is not
    // painted like an error.
    expect(el("ch-comparer-status").className).toBe("ch-comparer-status");
    // The rows the user pasted are what re-running needs, and nothing here
    // touches them: the same click works again.
    expect(el("ch-comparer-textarea").value).not.toBe("");
  });

  it("leaves a real comparison summary alone when a retirement lands afterwards", () => {
    runValid();
    const summary = el("ch-comparer-status").textContent;
    expect(summary).not.toBe("");

    comparer.dropPendingCompare();

    expect(el("ch-comparer-status").textContent).toBe(summary);
  });

  it("names its result table and scopes every header cell", () => {
    // The grid is built from a column schema and has no visible caption, so the
    // table carries its own name and each header cell declares its column —
    // without scope, a screen reader reads the cells with no column to hang
    // them on.
    runValid();

    const table = el("ch-comparer-results").children[0];
    expect(table.attributes["aria-label"]).toBeTruthy();

    const headerRow = table.children[0].children[0];
    expect(headerRow.children.length).toBeGreaterThan(0);
    for (const th of headerRow.children) {
      expect(th.attributes["scope"]).toBe("col");
    }
  });

  beforeEach(async () => {
    vi.resetModules();
    doc = stubFakeDom().doc;
    const create = doc.createElement.bind(doc);
    vi.spyOn(doc, "createElement").mockImplementation((tag) => {
      const element = Object.assign(create(tag), { disabled: false, checked: false });
      Object.defineProperty(element, "innerHTML", {
        get: () => "",
        set: () => { element.children = []; element.textContent = ""; },
      });
      return element;
    });
    actions = await import("../content/main-actions");
    run = (await import("../content/run-lifecycle")).runLifecycle;
    // The mocked module keeps one Run across resetModules, so clear it here
    // rather than relying on a fresh instance per case.
    run.reset();
    exporter = await import("../content/exporter");
    vi.spyOn(exporter, "downloadXLSXFile").mockImplementation(async () => {});
    ui = await import("../content/ui-comparer");
    ui.injectComparerModal();
    comparer = await import("../content/ui-comparer-view");
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it.each(["", "1,32", "1,abc"])("clears stale results when raw dates become %j on rerun", (dates) => {
    runValid();
    el("ch-comparer-daily-dates").value = dates;
    fire("ch-comparer-daily-dates", "change");
    expectCleared();
  });

  it("clears stale results when Periksa rejects the current pasted text", () => {
    runValid();
    el("ch-comparer-textarea").value = "invalid";
    fire("ch-comparer-check-btn");
    expectCleared();
  });

  it("clears stale results when data disappears during a rerun", () => {
    runValid();
    seedRows(null);
    fire("ch-comparer-tolerance", "change");
    expectCleared();
  });

  it.each(["dates", "text"])("revalidates current %s after a pending scrape", (input) => {
    el("ch-comparer-textarea").value = "000123\t000456\t1.000\t110";
    el("ch-comparer-daily-dates").value = "1";
    fire("ch-comparer-check-btn");
    expect(actions.startScrape).toHaveBeenCalledOnce();

    // Data arrives. The panel registered a pending comparison when it had
    // nothing to check yet, so the completed run must hand exactly that back.
    const outcome = run.complete({
      type: "SCRAPE_COMPLETE",
      data: [{ Reference: "000123", SellingPrice: 1000, VAT: 110 }],
      fields: ["Reference", "SellingPrice", "VAT"],
      total: 1, pages: 1, elapsed: "1s", source: "OUTPUT_TAX",
    });
    expect(outcome.kind === "accepted" && outcome.followUp).toEqual([{ kind: "compare" }]);

    // The input changed while the scrape ran: revalidation uses what is there
    // now, not what was there when "Periksa" was clicked.
    el(input === "dates" ? "ch-comparer-daily-dates" : "ch-comparer-textarea").value = "";
    comparer.runPendingCompare();
    expectCleared();
  });

  it("clears the session and cancels pending comparison on Hapus", () => {
    runValid();
    // The Run now owes a comparison. Hapus must cancel it: if it survived, the
    // tolerance change below would re-run the comparison and write a status line.
    // (The cancel itself is pinned in run-lifecycle.unit.test.ts.)
    run.request({ kind: "compare" });
    fire("ch-comparer-clear-btn");
    expect(el("ch-comparer-export-btn").disabled).toBe(true);
    fire("ch-comparer-tolerance", "change");
    expect(el("ch-comparer-status").textContent).toBe("");
    fire("ch-comparer-export-btn");
    expect(exporter.downloadXLSXFile).not.toHaveBeenCalled();
  });

  it("passes original numeric values and Excel formats from the comparison export handler", () => {
    runValid();
    fire("ch-comparer-export-btn");
    const [rows, filename, sheetName, options] = vi.mocked(exporter.downloadXLSXFile).mock.calls[0];
    expect(filename).toBe("perbandingan-faktur.xlsx");
    const sheet = readback(buildAoaWorkbook(XLSX, rows, sheetName, options));
    expectNumeric(sheet.H2, 1234.56789);
    expectNumeric(sheet.J2, 0);
    expectText(sheet.F2, comparison.buyerTIN);
    expectText(sheet.G2, comparison.taxInvoiceNumber);
  });

  it("renders and filters incomplete checker data and exports blanks rather than zero", () => {
    seedRows([{
      Reference: "000123", SellingPrice: null, OtherTaxBase: 0, VAT: 0,
    }]);
    fire("ch-checker-check-btn");
    const table = el("ch-checker-results").children[0];
    const cells = table.children[1].children[0].children.map((c) => c.textContent);
    expect(cells.slice(4)).toEqual(["-", "0", "0", "-", "-", "Data tidak lengkap"]);
    const option = el("ch-checker-filter-menu").children
      .map((label) => label.children[0])
      .find((input) => input.value === "DATA_TIDAK_LENGKAP")!;
    Object.assign(option, { checked: true });
    option.listeners.change[0]();
    expect(el("ch-checker-results").children[0].children[1].children).toHaveLength(1);
    fire("ch-checker-export-btn");
    const [rows, , sheetName, options] = vi.mocked(exporter.downloadXLSXFile).mock.calls[0];
    const sheet = readback(buildAoaWorkbook(XLSX, rows, sheetName, options));
    expect(sheet.F2).toBeUndefined();
    expectNumeric(sheet.G2, 0);
    expectNumeric(sheet.H2, 0);
    expect(sheet.I2).toBeUndefined();
    expect(sheet.J2).toBeUndefined();
    expectText(sheet.K2, "Data tidak lengkap");
  });
});

// ── The panel as a dialog ───────────────────────────────────────────────
// The panel covers the portal and is dismissed with a key, so it has to say
// so: role="dialog" + aria-modal is what a screen reader acts on, and Escape is
// the one affordance a dialog user reaches for before reading anything on it.
// Both were absent -- the only dismiss paths were the "×" and a click outside.

describe("the panel as a modal dialog", () => {
  let doc: FakeDoc;
  let ui: typeof import("../content/ui-comparer");
  // Opening and closing the panel belongs to the OVERLAY, not to either tab,
  // so it is asserted against the shell module rather than ui-comparer.ts.
  let panel: typeof import("../content/ui-panel");

  /** Fire a keydown on an element, as a real press would bubble. */
  function press(target: FakeEl, key: string): void {
    for (const listener of target.listeners.keydown ?? []) listener({ key, stopPropagation: () => {} });
  }

  const overlay = (): FakeEl => doc.getElementById("ch-comparer-overlay")!;
  const modal = (): FakeEl => doc.getElementById("ch-comparer-modal")!;
  const isClosed = (): boolean => overlay().classList.contains("ch-hidden");

  beforeEach(async () => {
    vi.resetModules();
    pageGates.output = true;
    pageGates.returns = false;
    pageGates.vat = true;
    pageGates.identity = true;
    pageGates.checker = true;
    pageGates.unknown = false;
    doc = stubFakeDom().doc;
    const create = doc.createElement.bind(doc);
    vi.spyOn(doc, "createElement").mockImplementation((tag) =>
      Object.assign(create(tag), { disabled: false, checked: false }),
    );
    ui = await import("../content/ui-comparer");
    panel = await import("../content/ui-panel");
    ui.injectComparerModal();
    // Opening the panel pre-fills the textarea from the clipboard, so a test
    // that opens it needs the API to exist. Rejects are already swallowed by
    // the caller; an empty resolve is the honest "nothing on the clipboard".
    vi.stubGlobal("navigator", { clipboard: { readText: async () => "" } });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("declares itself a modal dialog with an accessible name", () => {
    expect(modal().getAttribute("role")).toBe("dialog");
    expect(modal().getAttribute("aria-modal")).toBe("true");
    // Named, or a screen reader announces an unlabelled dialog.
    expect(modal().getAttribute("aria-label")).toBeTruthy();
    // Focusable, so focus can be moved INTO it -- Escape is delivered to the
    // overlay, and an overlay nothing inside holds focus for would swallow it.
    expect(modal().tabIndex).toBe(-1);
  });

  it("moves focus into the panel when it opens", () => {
    doc.focusCalls.length = 0;
    panel.openPanel("compare");
    expect(doc.focusCalls[0]).toBe(modal());
  });

  it("closes on Escape", () => {
    panel.openPanel("compare");
    expect(isClosed()).toBe(false);

    press(overlay(), "Escape");

    expect(isClosed()).toBe(true);
  });

  it("ignores every other key", () => {
    panel.openPanel("compare");
    press(overlay(), "Enter");
    press(overlay(), "a");
    expect(isClosed()).toBe(false);
  });

  it("closes an open filter menu first, leaving the panel open", () => {
    // Dismissing a 300-row comparison because the user meant to close a
    // dropdown would be a harsh reading of one gesture, so the first Escape
    // takes the menu and a second takes the panel.
    panel.openPanel("compare");
    const menu = doc.getElementById("ch-comparer-filter-menu")!;
    const toggle = doc.getElementById("ch-comparer-filter-toggle")!;
    for (const listener of toggle.listeners.click ?? []) {
      listener({ stopPropagation: () => {} });
    }
    expect(menu.classList.contains("ch-hidden")).toBe(false);

    press(overlay(), "Escape");
    expect(menu.classList.contains("ch-hidden")).toBe(true);
    expect(isClosed()).toBe(false);

    press(overlay(), "Escape");
    expect(isClosed()).toBe(true);
  });

  it("registers the Escape handler on the overlay, not the document", () => {
    // A document-level listener would outlive the panel: the master-switch
    // teardown removes the element, and the handler would go on swallowing a
    // key the portal may want.
    expect(doc.listenerCount("keydown")).toBe(0);
    expect(overlay().listeners.keydown).toHaveLength(1);
  });

  it("still opens the panel on a browser with no clipboard API", () => {
    // A convenience read must never take the panel down with it. Without this
    // guard the missing API threw synchronously inside openPanel.
    vi.stubGlobal("navigator", {});

    expect(() => panel.openPanel("compare")).not.toThrow();
    expect(isClosed()).toBe(false);
    expect(doc.getElementById("ch-comparer-textarea")!.value).toBe("");
  });

  it("survives a refused clipboard read and leaves the textarea alone", async () => {
    // Firefox refuses readText without a declared clipboard permission; Chrome
    // prompts. Either way the refusal is not the user's problem, but it must
    // not surface as an unhandled rejection.
    vi.stubGlobal("navigator", {
      clipboard: { readText: () => Promise.reject(new Error("NotAllowedError")) },
    });

    panel.openPanel("compare");
    await Promise.resolve();

    expect(isClosed()).toBe(false);
    expect(doc.getElementById("ch-comparer-textarea")!.value).toBe("");
  });

  it("replaces, never stacks, the menus' click-outside handler", () => {
    // One handler on `document`, however many times the panel is rebuilt.
    expect(doc.listenerCount("click")).toBe(1);

    // A teardown removed the modal, so the next injection really rebuilds it.
    doc.getElementById("ch-comparer-modal")!.remove();
    ui.injectComparerModal();
    expect(doc.listenerCount("click")).toBe(1);

    // And the teardown path hands `document` back.
    ui.removeMenusOutsideClickHandler();
    expect(doc.listenerCount("click")).toBe(0);
  });

  it("parks the portal behind the panel and restores it on close", () => {
    // aria-modal claims the content behind the dialog is inert; the DOM has to
    // keep that claim, or Tab walks out of the dialog into the portal.
    const portalRoot = doc.createElement("div");
    doc.body.appendChild(portalRoot);

    panel.openPanel("compare");
    expect(portalRoot.inert).toBe(true);
    // The overlay is the dialog, so it is never parked.
    expect(overlay().inert).toBe(false);

    panel.closePanel();
    expect(portalRoot.inert).toBe(false);
  });

  it("hands focus back to what had it when the panel closes", () => {
    const opener = doc.createElement("button");
    doc.body.appendChild(opener);
    doc.focusCalls.length = 0;
    opener.focus();

    panel.openPanel("compare");
    expect(doc.activeElement).not.toBe(opener);

    panel.closePanel();
    expect(doc.activeElement).toBe(opener);
  });

  // ── Which tab a page is allowed to see ───────────────────────────
  // The Komparator matches internal records by Referensi, so it belongs to
  // PPN Keluaran only (README.md, "Kenapa Komparator tidak ikut ke PPN
  // Masukan?"); Pengecekan is arithmetic on one invoice and runs on either VAT
  // grid. Hiding the tab that does not apply is the rule the checker tab
  // already followed — it now just applies to both tabs.
  const tab = (id: string): FakeEl => doc.getElementById(id)!;
  const view = (id: string): FakeEl => doc.getElementById(id)!;

  it("offers both tabs on PPN Keluaran and opens the Komparator", () => {
    panel.openPanel("compare");

    expect(tab("ch-tab-compare").classList.contains("ch-hidden")).toBe(false);
    expect(tab("ch-tab-checker").classList.contains("ch-hidden")).toBe(false);
    expect(view("ch-comparer-view-compare").classList.contains("ch-hidden")).toBe(false);
  });

  it("names the grid the panel is on, all four of them", () => {
    // The grid's NAME is its own fact: it is what the "still fetching" line says
    // while a check waits for data, and two of the four would silently be
    // reported as one of the invoice grids if it were read off a page gate.
    pageGates.returns = false;
    pageGates.output = true;
    expect(panel.currentGridLabel()).toBe("PPN Keluaran");
    pageGates.output = false;
    expect(panel.currentGridLabel()).toBe("PPN Masukan");
    pageGates.returns = true;
    expect(panel.currentGridLabel()).toBe("Retur PPN Masukan");
    pageGates.output = true;
    expect(panel.currentGridLabel()).toBe("Retur PPN Keluaran");

    // And a page no predicate knows, which the toolbar never reaches but a
    // direct caller can.
    pageGates.unknown = true;
    expect(panel.currentGridLabel()).toBe("grid");
    pageGates.unknown = false;
  });

  it("offers Pengecekan alone on a Retur grid, and lands in it", () => {
    // The four-grid extension (ADR-0024): a retur row carries the same three
    // amounts, so the check runs there — while the Komparator has no Referensi
    // to match on, and the identity column the tab renders is the NO RETUR.
    pageGates.returns = true;
    pageGates.vat = false;
    pageGates.identity = false;

    panel.openPanel("compare");

    expect(tab("ch-tab-compare").classList.contains("ch-hidden")).toBe(true);
    expect(tab("ch-tab-checker").classList.contains("ch-hidden")).toBe(false);
    expect(tab("ch-tab-checker").classList.contains("ch-comparer-tab-active")).toBe(true);
    expect(view("ch-comparer-view-compare").classList.contains("ch-hidden")).toBe(true);
    expect(view("ch-comparer-view-checker").classList.contains("ch-hidden")).toBe(false);
  });

  it("hides Pengecekan where the check cannot run at all", () => {
    // The page gate is its own fact: a grid outside the four e-Faktur PPN grids
    // gets neither tab.
    pageGates.checker = false;
    pageGates.identity = false;

    panel.openPanel("check");

    expect(tab("ch-tab-checker").classList.contains("ch-hidden")).toBe(true);
  });

  it("hides the Komparator tab on PPN Masukan and lands in Pengecekan", () => {
    // A VAT grid where a Referensi is not an identity: Pengecekan applies, the
    // Komparator does not.
    pageGates.output = false;
    pageGates.identity = false;

    // The request is for the Komparator, which this page cannot serve: it
    // falls back to the tab the page can, rather than opening a comparison
    // that could only answer "Tidak ditemukan".
    panel.openPanel("compare");

    expect(tab("ch-tab-compare").classList.contains("ch-hidden")).toBe(true);
    expect(tab("ch-tab-checker").classList.contains("ch-hidden")).toBe(false);
    expect(tab("ch-tab-checker").classList.contains("ch-comparer-tab-active")).toBe(true);
    expect(view("ch-comparer-view-compare").classList.contains("ch-hidden")).toBe(true);
    expect(view("ch-comparer-view-checker").classList.contains("ch-hidden")).toBe(false);
  });
});
