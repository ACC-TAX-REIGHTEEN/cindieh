import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import type { ComparisonResult } from "../content/comparer";
import type { BenchmarkType, CheckResult } from "../content/checker-logic";
import {
  buildCheckerExportRows,
  buildComparisonExportRows,
  formatResultDifference,
  formatResultNumber,
} from "../content/comparer-export";
import {
  buildAoaWorkbook,
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
vi.mock("../content/page-context", () => ({ isOutputTaxPage: () => true }));

const comparison: ComparisonResult = {
  reference: "000123", refLain: "000456", buyerName: "Pembeli",
  invoiceDate: "2026-07-01", buyerTIN: "0012345678901234",
  taxInvoiceNumber: "04012600023333322",
  dppSistem: 1234567.890123, dppExcel: 1234567.125678,
  ppnSistem: 0, ppnExcel: 0.1234567, ppnSelisih: -0.1234567,
  status: "BERBEDA",
};
const checker: CheckResult = {
  reference: "000123", buyerName: "Pembeli", invoiceDate: "01/07/2026",
  buyerTIN: "0012345678901234", taxInvoiceNumber: "04012600023333322",
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
      numberFormats: { 5: RESULT_NUMBER_FORMAT, 6: RESULT_NUMBER_FORMAT, 7: RESULT_NUMBER_FORMAT,
        8: RESULT_DIFFERENCE_FORMAT, 9: RESULT_DIFFERENCE_FORMAT },
    }));
    expectNumeric(sheet.F2, checker.dppSystem!);
    expectNumeric(sheet.G2, checker.dppNilaiLainSystem!);
    expectNumeric(sheet.H2, 0);
    expectNumeric(sheet.I2, (benchmark === "DPP" ? checker.dppNilaiLainDiff : checker.dppDiff)!, RESULT_DIFFERENCE_FORMAT);
    expectNumeric(sheet.J2, (benchmark === "PPN" ? checker.dppNilaiLainDiff : checker.ppnDiff)!, RESULT_DIFFERENCE_FORMAT);
    expectText(sheet.B2, checker.reference);
    expectText(sheet.E2, checker.buyerTIN);
    expect(rows[0][8]).toBe(benchmark === "DPP" ? "Selisih DPP NL" : "Selisih DPP");
    expect(rows[0][9]).toBe(benchmark === "PPN" ? "Selisih DPP NL" : "Selisih PPN");
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
    ui.runPendingCompare();
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
