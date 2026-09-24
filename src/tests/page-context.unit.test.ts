// Unit tests for page-context.ts
// Covers all URL predicates, inferCapturedSource, and extractFilenameHintFromBody.
import { describe, it, expect } from "vitest";
import {
  isOutputTaxPage,
  isInputTaxPage,
  isOutputReturnPage,
  isInputReturnPage,
  isEfakturPage,
  isSptPage,
  isWithholdingPage,
  isSupportedExportPage,
  getPageExportSource,
  inferCapturedSource,
  extractFilenameHintFromBody,
  describePortalPage,
} from "../content/page-context";

// ── URL predicate helpers ────────────────────────────────────────────────────

const URLS: Record<string, string> = {
  outputTax:    "https://coretaxdjp.pajak.go.id/e-invoice-portal/output-tax/list",
  outputTaxVat: "https://coretaxdjp.pajak.go.id/e-invoice-portal/vat-out/list",
  outputTaxKeluaran: "https://coretaxdjp.pajak.go.id/e-invoice-portal/keluaran/list",
  inputTax:     "https://coretaxdjp.pajak.go.id/e-invoice-portal/input-tax/list",
  outputReturn: "https://coretaxdjp.pajak.go.id/e-invoice-portal/output-return/list",
  inputReturn:  "https://coretaxdjp.pajak.go.id/e-invoice-portal/input-return/list",
  sptVat:       "https://coretaxdjp.pajak.go.id/returnsheets-portal/value-added-tax-return/list",
  sptPph:       "https://coretaxdjp.pajak.go.id/returnsheets-portal/article-21-26-tax-return/list",
  withholding:  "https://coretaxdjp.pajak.go.id/withholding-slips-portal/my-withholding-slips/list",
  unrelated:    "https://coretaxdjp.pajak.go.id/dashboard",
};

describe("isOutputTaxPage", () => {
  it("matches /e-invoice-portal with output-tax", () => {
    expect(isOutputTaxPage(URLS.outputTax)).toBe(true);
  });
  it("matches /e-invoice-portal with vat-out alias", () => {
    expect(isOutputTaxPage(URLS.outputTaxVat)).toBe(true);
  });
  it("matches /e-invoice-portal with keluaran alias", () => {
    expect(isOutputTaxPage(URLS.outputTaxKeluaran)).toBe(true);
  });
  it("rejects input-tax page", () => {
    expect(isOutputTaxPage(URLS.inputTax)).toBe(false);
  });
  it("rejects unrelated page", () => {
    expect(isOutputTaxPage(URLS.unrelated)).toBe(false);
  });
  it("is case-insensitive", () => {
    expect(isOutputTaxPage("https://example.com/E-INVOICE-PORTAL/OUTPUT-TAX/list")).toBe(true);
  });
});

describe("isInputTaxPage", () => {
  it("matches /e-invoice-portal with input-tax", () => {
    expect(isInputTaxPage(URLS.inputTax)).toBe(true);
  });
  it("rejects output-tax page", () => {
    expect(isInputTaxPage(URLS.outputTax)).toBe(false);
  });
  it("rejects unrelated page", () => {
    expect(isInputTaxPage(URLS.unrelated)).toBe(false);
  });
});

describe("isOutputReturnPage", () => {
  it("matches /e-invoice-portal with output-return", () => {
    expect(isOutputReturnPage(URLS.outputReturn)).toBe(true);
  });
  it("rejects output-tax page", () => {
    expect(isOutputReturnPage(URLS.outputTax)).toBe(false);
  });
});

describe("isInputReturnPage", () => {
  it("matches /e-invoice-portal with input-return", () => {
    expect(isInputReturnPage(URLS.inputReturn)).toBe(true);
  });
  it("rejects input-tax page", () => {
    expect(isInputReturnPage(URLS.inputTax)).toBe(false);
  });
});

describe("isEfakturPage", () => {
  it("matches each efaktur page type", () => {
    for (const url of [
      URLS.outputTax, URLS.outputTaxVat, URLS.outputTaxKeluaran,
      URLS.inputTax, URLS.outputReturn, URLS.inputReturn,
    ]) {
      expect(isEfakturPage(url)).toBe(true);
    }
  });
  it("rejects non-efaktur pages (SPT, withholding, unrelated)", () => {
    for (const url of [URLS.sptVat, URLS.sptPph, URLS.withholding, URLS.unrelated]) {
      expect(isEfakturPage(url)).toBe(false);
    }
  });
});

describe("isSptPage", () => {
  it("matches returnsheets-portal with value-added-tax-return", () => {
    expect(isSptPage(URLS.sptVat)).toBe(true);
  });
  it("matches returnsheets-portal with article-21-26-tax-return", () => {
    expect(isSptPage(URLS.sptPph)).toBe(true);
  });
  it("rejects e-invoice-portal URL", () => {
    expect(isSptPage(URLS.outputTax)).toBe(false);
  });
  it("rejects unrelated page", () => {
    expect(isSptPage(URLS.unrelated)).toBe(false);
  });
});

describe("isWithholdingPage", () => {
  it("matches withholding-slips-portal with my-withholding-slips", () => {
    expect(isWithholdingPage(URLS.withholding)).toBe(true);
  });
  it("rejects e-invoice-portal URL", () => {
    expect(isWithholdingPage(URLS.outputTax)).toBe(false);
  });
  it("requires both portal and path segment", () => {
    expect(isWithholdingPage("https://example.com/withholding-slips-portal/other")).toBe(false);
  });
});

describe("isSupportedExportPage", () => {
  it("returns true for each supported page type", () => {
    for (const url of [
      URLS.outputTax, URLS.inputTax, URLS.outputReturn,
      URLS.inputReturn, URLS.sptVat, URLS.sptPph, URLS.withholding,
    ]) {
      expect(isSupportedExportPage(url)).toBe(true);
    }
  });
  it("returns false for unrelated pages", () => {
    expect(isSupportedExportPage(URLS.unrelated)).toBe(false);
    expect(isSupportedExportPage("https://google.com")).toBe(false);
    expect(isSupportedExportPage("")).toBe(false);
  });
});

describe("getPageExportSource", () => {
  it("returns OUTPUT_TAX for output-tax URL", () => {
    expect(getPageExportSource(URLS.outputTax)).toBe("OUTPUT_TAX");
  });
  it("returns INPUT_TAX for input-tax URL", () => {
    expect(getPageExportSource(URLS.inputTax)).toBe("INPUT_TAX");
  });
  it("returns OUTPUT_RETURN for output-return URL", () => {
    expect(getPageExportSource(URLS.outputReturn)).toBe("OUTPUT_RETURN");
  });
  it("returns INPUT_RETURN for input-return URL", () => {
    expect(getPageExportSource(URLS.inputReturn)).toBe("INPUT_RETURN");
  });
  it("returns null for SPT pages (inferCapturedSource handles those)", () => {
    expect(getPageExportSource(URLS.sptVat)).toBeNull();
  });
  it("returns null for withholding pages", () => {
    expect(getPageExportSource(URLS.withholding)).toBeNull();
  });
  it("returns null for unrelated pages", () => {
    expect(getPageExportSource(URLS.unrelated)).toBeNull();
  });
});

// ── inferCapturedSource ─────────────────────────────────────────────────────

describe("inferCapturedSource", () => {
  it("infers SPT_A2 from la2-grid in request URL", () => {
    expect(inferCapturedSource("https://example.com/api/la2-grid/list", URLS.unrelated)).toBe("SPT_A2");
  });
  it("infers SPT_B2 from lb2-grid in request URL", () => {
    expect(inferCapturedSource("https://example.com/api/lb2-grid/list", URLS.unrelated)).toBe("SPT_B2");
  });
  it("infers PPH_21_L1A from l1a- in request URL", () => {
    expect(inferCapturedSource("https://example.com/api/l1a-grid/list", URLS.unrelated)).toBe("PPH_21_L1A");
  });
  it("infers PPH_21_L1B from l1b- in request URL", () => {
    expect(inferCapturedSource("https://example.com/api/l1b-grid/list", URLS.unrelated)).toBe("PPH_21_L1B");
  });
  it("infers PPH_21_L2 from l2- in request URL", () => {
    expect(inferCapturedSource("https://example.com/api/l2-grid/list", URLS.unrelated)).toBe("PPH_21_L2");
  });
  it("infers PPH_21_L3 from l3- in request URL", () => {
    expect(inferCapturedSource("https://example.com/api/l3-grid/list", URLS.unrelated)).toBe("PPH_21_L3");
  });
  it("infers WITHHOLDING_SLIPS from getmywithholdingslip in request URL", () => {
    expect(inferCapturedSource("https://example.com/GetMyWithholdingSlip", URLS.unrelated)).toBe("WITHHOLDING_SLIPS");
  });
  it("infers OUTPUT_TAX from outputinvoice/list in request URL", () => {
    expect(inferCapturedSource("https://example.com/outputinvoice/list", URLS.unrelated)).toBe("OUTPUT_TAX");
  });
  it("falls back to page source when request URL has no specific pattern", () => {
    expect(inferCapturedSource("https://example.com/api/some/other/endpoint", URLS.outputTax)).toBe("OUTPUT_TAX");
    expect(inferCapturedSource("https://example.com/api/some/other/endpoint", URLS.inputTax)).toBe("INPUT_TAX");
  });
  it("returns null when both request URL and page URL are unrecognised", () => {
    expect(inferCapturedSource("https://example.com/unknown", URLS.unrelated)).toBeNull();
  });
  it("is case-insensitive for the request URL match", () => {
    expect(inferCapturedSource("https://example.com/GETMYWITHHOLDINGSLIP", URLS.unrelated)).toBe("WITHHOLDING_SLIPS");
  });
});

// ── extractFilenameHintFromBody ─────────────────────────────────────────────

function makeBody(filters: unknown[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ Filters: filters, ...extra });
}

describe("extractFilenameHintFromBody — OUTPUT_TAX", () => {
  it("extracts period from Filters for OUTPUT_TAX", () => {
    const body = makeBody([{ PropertyName: "Period", Value: "202604" }]);
    expect(extractFilenameHintFromBody(body, "OUTPUT_TAX")).toBe("202604");
  });

  it("extracts period with masa filter name", () => {
    const body = makeBody([{ PropertyName: "Masa", Value: "2026-04" }]);
    expect(extractFilenameHintFromBody(body, "OUTPUT_TAX")).toBe("2026-04");
  });

  it("returns undefined when no matching filter is found", () => {
    const body = makeBody([{ PropertyName: "Reference", Value: "REF-001" }]);
    expect(extractFilenameHintFromBody(body, "OUTPUT_TAX")).toBeUndefined();
  });

  it("returns undefined for empty Filters array", () => {
    const body = makeBody([]);
    expect(extractFilenameHintFromBody(body, "OUTPUT_TAX")).toBeUndefined();
  });
});

describe("extractFilenameHintFromBody — INPUT_TAX", () => {
  it("extracts YYYY_MM from month and year filters separately", () => {
    const body = makeBody([
      { PropertyName: "Month", Value: "04" },
      { PropertyName: "Year", Value: "2026" },
    ]);
    expect(extractFilenameHintFromBody(body, "INPUT_TAX")).toBe("2026_04");
  });

  it("extracts YYYY_MM from a combined period filter", () => {
    const body = makeBody([{ PropertyName: "Period", Value: "202604" }]);
    expect(extractFilenameHintFromBody(body, "INPUT_TAX")).toBe("2026_04");
  });

  it("returns undefined when no usable filters exist", () => {
    const body = makeBody([]);
    expect(extractFilenameHintFromBody(body, "INPUT_TAX")).toBeUndefined();
  });
});

describe("extractFilenameHintFromBody — OUTPUT_RETURN / INPUT_RETURN", () => {
  it("extracts a 4-digit year from a year filter", () => {
    const body = makeBody([{ PropertyName: "Year", Value: "2025" }]);
    expect(extractFilenameHintFromBody(body, "OUTPUT_RETURN")).toBe("2025");
  });

  it("extracts year from top-level TaxYear field", () => {
    const body = JSON.stringify({ Filters: [], TaxYear: "2024" });
    expect(extractFilenameHintFromBody(body, "INPUT_RETURN")).toBe("2024");
  });

  it("returns undefined when no year can be extracted", () => {
    const body = makeBody([]);
    expect(extractFilenameHintFromBody(body, "OUTPUT_RETURN")).toBeUndefined();
  });
});

describe("extractFilenameHintFromBody — SPT_A2 / SPT_B2", () => {
  it("extracts period filter for SPT_A2", () => {
    const body = makeBody([{ PropertyName: "Period", Value: "202603" }]);
    expect(extractFilenameHintFromBody(body, "SPT_A2")).toBe("202603");
  });

  it("extracts period filter for SPT_B2", () => {
    const body = makeBody([{ PropertyName: "Masa", Value: "202605" }]);
    expect(extractFilenameHintFromBody(body, "SPT_B2")).toBe("202605");
  });
});

describe("extractFilenameHintFromBody — edge cases", () => {
  it("returns undefined for invalid JSON", () => {
    expect(extractFilenameHintFromBody("not-json", "OUTPUT_TAX")).toBeUndefined();
  });

  it("handles lowercase filter key 'filters'", () => {
    const body = JSON.stringify({ filters: [{ PropertyName: "Period", Value: "202601" }] });
    expect(extractFilenameHintFromBody(body, "OUTPUT_TAX")).toBe("202601");
  });
});

describe("describePortalPage — the popup's status line", () => {
  it("names the specific supported page", () => {
    expect(describePortalPage(URLS.outputTax)).toBe("Terhubung: e-Faktur PPN Keluaran");
    expect(describePortalPage(URLS.inputTax)).toBe("Terhubung: e-Faktur PPN Masukan");
    expect(describePortalPage(URLS.outputReturn)).toBe("Terhubung: Retur PPN Keluaran");
    expect(describePortalPage(URLS.inputReturn)).toBe("Terhubung: Retur PPN Masukan");
    expect(describePortalPage(URLS.withholding)).toBe("Terhubung: Bukti Potong");
  });

  it("separates the two SPT products", () => {
    expect(describePortalPage(URLS.sptVat)).toBe("Terhubung: SPT Masa PPN");
    expect(describePortalPage(URLS.sptPph)).toBe("Terhubung: SPT PPh 21/26");
  });

  it("tells 'portal page we do not support' apart from 'not the portal'", () => {
    // Different advice: one is a supported-page gap, the other is a wrong tab.
    expect(describePortalPage(URLS.unrelated)).toBe("Portal Coretax — halaman ini belum didukung.");
    expect(describePortalPage("https://example.com/")).toBe(
      "Buka portal Coretax untuk memakai fitur ekspor.",
    );
  });

  it("treats an unreadable/absent tab URL as 'not the portal'", () => {
    // The popup gets no url for tabs the extension has no host permission for.
    expect(describePortalPage(undefined)).toBe("Buka portal Coretax untuk memakai fitur ekspor.");
    expect(describePortalPage("")).toBe("Buka portal Coretax untuk memakai fitur ekspor.");
  });
});
