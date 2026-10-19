// Unit tests for page-context.ts
// Covers all URL predicates, inferCapturedSource, and extractFilenameHintFromBody.
import { describe, it, expect } from "vitest";
import {
  isOutputTaxPage,
  isInputTaxPage,
  isOutputReturnPage,
  isInputReturnPage,
  isEfakturPage,
  isVatInvoicePage,
  hasReferenceFilter,
  referenceIsIdentity,
  isCheckerPage,
  checkerRowIdentity,
  counterpartyIsBuyer,
  panelEntryLabel,
  panelEntryLabelFor,
  COMPARER_ENTRY_LABEL,
  CHECKER_ENTRY_LABEL,
  isPanelPage,
  panelGridFacts,
  PANEL_GRIDS,
  type PanelGridId,
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

describe("isVatInvoicePage", () => {
  // The two grids whose rows are the taxpayer's own INVOICES. The Checker is
  // wider than this (it runs on the two Retur grids as well, `isCheckerPage`)
  // and the Comparer narrower (`referenceIsIdentity`: a PPN Masukan Referensi
  // is the SELLER's own, neither unique across a taxpayer's purchases nor
  // reliably present).
  it.each([
    ["https://coretaxdjp.pajak.go.id/e-invoice-portal/output-tax", true],
    ["https://coretaxdjp.pajak.go.id/e-invoice-portal/input-tax", true],
    ["https://coretaxdjp.pajak.go.id/e-invoice-portal/output-return", false],
    ["https://coretaxdjp.pajak.go.id/e-invoice-portal/input-return", false],
    ["https://coretaxdjp.pajak.go.id/returnsheets-portal/value-added-tax-return", false],
    ["https://coretaxdjp.pajak.go.id/withholding-slips-portal/my-withholding-slips", false],
  ])("%s -> %s", (url, expected) => {
    expect(isVatInvoicePage(url)).toBe(expected);
  });

  it("is narrower than the two gates around it, on the Retur grids", () => {
    // Both neighbours cover the retur grids, this fact does not: they are not
    // invoice grids. Named apart from them rather than derived from either, so
    // widening the export or the check cannot silently move this.
    expect(isVatInvoicePage("https://coretaxdjp.pajak.go.id/e-invoice-portal/output-return")).toBe(false);
    expect(isEfakturPage("https://coretaxdjp.pajak.go.id/e-invoice-portal/output-return")).toBe(true);
    expect(isCheckerPage("https://coretaxdjp.pajak.go.id/e-invoice-portal/output-return")).toBe(true);
  });
});

describe("hasReferenceFilter — can this grid be looked up by Referensi?", () => {
  // Both PPN grids carry a Referensi column, so both get the injected filter:
  // a seller's reference still answers a LOOKUP even when several purchases
  // share it. Retur is keyed by NO RETUR and the other portals have no such
  // column at all.
  it.each([
    ["https://coretaxdjp.pajak.go.id/e-invoice-portal/output-tax", true],
    ["https://coretaxdjp.pajak.go.id/e-invoice-portal/input-tax", true],
    ["https://coretaxdjp.pajak.go.id/e-invoice-portal/output-return", false],
    ["https://coretaxdjp.pajak.go.id/e-invoice-portal/input-return", false],
    ["https://coretaxdjp.pajak.go.id/returnsheets-portal/value-added-tax-return", false],
    ["https://coretaxdjp.pajak.go.id/withholding-slips-portal/my-withholding-slips", false],
  ])("%s -> %s", (url, expected) => {
    expect(hasReferenceFilter(url)).toBe(expected);
  });

  it("answers for every URL isVatInvoicePage does — the filter is the VAT grids' own", () => {
    for (const url of [...Object.values(URLS), "https://example.com/anything"]) {
      expect(hasReferenceFilter(url)).toBe(isVatInvoicePage(url));
    }
  });
});

describe("referenceIsIdentity — does a Referensi identify ONE row here?", () => {
  it.each([
    ["https://coretaxdjp.pajak.go.id/e-invoice-portal/output-tax", true],
    ["https://coretaxdjp.pajak.go.id/e-invoice-portal/input-tax", false],
    ["https://coretaxdjp.pajak.go.id/e-invoice-portal/output-return", false],
    ["https://coretaxdjp.pajak.go.id/e-invoice-portal/input-return", false],
    ["https://coretaxdjp.pajak.go.id/returnsheets-portal/value-added-tax-return", false],
    ["https://coretaxdjp.pajak.go.id/withholding-slips-portal/my-withholding-slips", false],
  ])("%s -> %s", (url, expected) => {
    expect(referenceIsIdentity(url)).toBe(expected);
  });

  it("splits from hasReferenceFilter on PPN Masukan: filter yes, identity no", () => {
    // The whole reason the two facts are two facts. One predicate answering both
    // questions means either the Comparer is admitted to a grid where it can
    // only answer "Tidak ditemukan", or Pengecekan's hand-back is withheld from
    // a grid that can serve it.
    expect(hasReferenceFilter(URLS.inputTax)).toBe(true);
    expect(referenceIsIdentity(URLS.inputTax)).toBe(false);

    expect(hasReferenceFilter(URLS.outputTax)).toBe(true);
    expect(referenceIsIdentity(URLS.outputTax)).toBe(true);
  });
});

describe("isCheckerPage — where does the accuracy check run?", () => {
  // A retur row carries the same DPP / DPP Nilai Lain / PPN as an invoice row,
  // and the check tests one row's arithmetic at a time, so it runs on all four
  // e-Faktur grids — and nowhere else.
  it.each([
    ["https://coretaxdjp.pajak.go.id/e-invoice-portal/output-tax", true],
    ["https://coretaxdjp.pajak.go.id/e-invoice-portal/input-tax", true],
    ["https://coretaxdjp.pajak.go.id/e-invoice-portal/output-return", true],
    ["https://coretaxdjp.pajak.go.id/e-invoice-portal/input-return", true],
    ["https://coretaxdjp.pajak.go.id/returnsheets-portal/value-added-tax-return", false],
    ["https://coretaxdjp.pajak.go.id/returnsheets-portal/article-21-26-tax-return", false],
    ["https://coretaxdjp.pajak.go.id/withholding-slips-portal/my-withholding-slips", false],
    ["https://coretaxdjp.pajak.go.id/dashboard", false],
  ])("%s -> %s", (url, expected) => {
    expect(isCheckerPage(url)).toBe(expected);
  });

  it("admits a Retur grid every other page fact of the panel refuses", () => {
    // The reason the facts are named apart: one predicate asked to answer all
    // four questions could only answer three of them.
    expect(isCheckerPage(URLS.outputReturn)).toBe(true);
    expect(isVatInvoicePage(URLS.outputReturn)).toBe(false);
    expect(hasReferenceFilter(URLS.outputReturn)).toBe(false);
    expect(referenceIsIdentity(URLS.outputReturn)).toBe(false);
  });
});

describe("checkerRowIdentity — what names ONE row of a check result?", () => {
  it.each([
    ["https://coretaxdjp.pajak.go.id/e-invoice-portal/output-tax", "referensi"],
    ["https://coretaxdjp.pajak.go.id/e-invoice-portal/input-tax", "referensi"],
    ["https://coretaxdjp.pajak.go.id/e-invoice-portal/output-return", "no-retur"],
    ["https://coretaxdjp.pajak.go.id/e-invoice-portal/input-return", "no-retur"],
  ])("%s -> %s", (url, expected) => {
    expect(checkerRowIdentity(url)).toBe(expected);
  });

  it("reads the Referensi column, the same underlying fact as the filter's", () => {
    // They agree on purpose and are asked separately: the filter's answer is
    // about a LOOKUP, this one about which field a result row is named by.
    for (const url of [...Object.values(URLS), "https://example.com/anything"]) {
      expect(checkerRowIdentity(url)).toBe(hasReferenceFilter(url) ? "referensi" : "no-retur");
    }
  });

  it("does not follow the identity fact, which is PPN Keluaran's alone", () => {
    // The two words are near-synonyms and the questions are not: the checker's
    // column on PPN Masukan is still the seller's reference (with the invoice
    // number as its fallback), and a Retur row has neither.
    expect(checkerRowIdentity(URLS.inputTax)).toBe("referensi");
    expect(referenceIsIdentity(URLS.inputTax)).toBe(false);
    expect(checkerRowIdentity(URLS.outputReturn)).toBe("no-retur");
  });
});

describe("counterpartyIsBuyer — whose invoice do this page's rows carry?", () => {
  it.each([
    ["https://coretaxdjp.pajak.go.id/e-invoice-portal/output-tax", true],
    ["https://coretaxdjp.pajak.go.id/e-invoice-portal/output-return", true],
    ["https://coretaxdjp.pajak.go.id/e-invoice-portal/input-tax", false],
    ["https://coretaxdjp.pajak.go.id/e-invoice-portal/input-return", false],
  ])("%s -> %s", (url, expected) => {
    expect(counterpartyIsBuyer(url)).toBe(expected);
  });

  it("splits from isOutputTaxPage on Retur Keluaran, which does show the buyer", () => {
    // A retur row carries BuyerTIN / BuyerTaxpayerNameClear exactly as the
    // invoice it returns does, so a column reading "Nama Pembeli" is right
    // there — and "Nama Penjual" (what the grid fact would give) is wrong.
    expect(isOutputTaxPage(URLS.outputReturn)).toBe(false);
    expect(counterpartyIsBuyer(URLS.outputReturn)).toBe(true);
  });
});

describe("isPanelPage — is there a tab to offer here?", () => {
  it.each([
    ["https://coretaxdjp.pajak.go.id/e-invoice-portal/output-tax", true],
    ["https://coretaxdjp.pajak.go.id/e-invoice-portal/input-tax", true],
    ["https://coretaxdjp.pajak.go.id/e-invoice-portal/output-return", true],
    ["https://coretaxdjp.pajak.go.id/e-invoice-portal/input-return", true],
    ["https://coretaxdjp.pajak.go.id/returnsheets-portal/value-added-tax-return", false],
    ["https://coretaxdjp.pajak.go.id/withholding-slips-portal/my-withholding-slips", false],
    ["https://coretaxdjp.pajak.go.id/dashboard", false],
  ])("%s -> %s", (url, expected) => {
    expect(isPanelPage(url)).toBe(expected);
  });

  it("is the union of the two tabs' own gates, not one of them", () => {
    // Asked by the keyboard shortcut and the toolbar button, which open the
    // OVERLAY: either tab having something to offer is enough.
    for (const url of [...Object.values(URLS), "https://example.com/anything"]) {
      expect(isPanelPage(url)).toBe(isCheckerPage(url) || referenceIsIdentity(url));
    }
  });
});

describe("panelEntryLabel — what the panel's toolbar entry is called", () => {
  it("names the tab the grid's row offers", () => {
    // The button opens the OVERLAY, so its name follows the tab the page can
    // serve: the Komparator's own name only where a Referensi identifies a row
    // (ADR-0025). Read from the constants rather than retyped, because the page
    // follows THIS wording — microsite-sync holds the published table to it.
    expect(panelEntryLabel(URLS.outputTax)).toBe(COMPARER_ENTRY_LABEL);
    expect(panelEntryLabel(URLS.inputTax)).toBe(CHECKER_ENTRY_LABEL);
    expect(panelEntryLabel(URLS.outputReturn)).toBe(CHECKER_ENTRY_LABEL);
    expect(panelEntryLabel(URLS.inputReturn)).toBe(CHECKER_ENTRY_LABEL);
  });

  it("has no name where there is no button, and is the row's derivation everywhere else", () => {
    for (const url of [...Object.values(URLS), "https://example.com/anything"]) {
      const facts = panelGridFacts(url);
      expect(panelEntryLabel(url), url).toBe(facts ? panelEntryLabelFor(facts) : null);
    }
    expect(panelEntryLabel(URLS.withholding)).toBeNull();
    expect(panelEntryLabel(URLS.sptVat)).toBeNull();
  });
});

// ── PANEL_GRIDS: the one table the panel's facts come from ──────────────────

describe("PANEL_GRIDS — one row per grid, and every projection is a read of it", () => {
  /** The four grids the panel knows, paired with the URL each is recognised by. */
  const ROWS: readonly (readonly [PanelGridId, string])[] = [
    ["OUTPUT_TAX", URLS.outputTax],
    ["INPUT_TAX", URLS.inputTax],
    ["OUTPUT_RETURN", URLS.outputReturn],
    ["INPUT_RETURN", URLS.inputReturn],
  ];

  it("covers exactly the four e-Faktur grids, and no other page resolves to a row", () => {
    // Both directions: every row is reachable from a URL, and nothing outside
    // those URLs gets one. A grid added to the page map without a row here (or
    // the reverse) is a panel that answers "no tab" on a grid it supports.
    for (const [id, url] of ROWS) expect(getPageExportSource(url)).toBe(id);
    expect(Object.keys(PANEL_GRIDS).sort()).toEqual(ROWS.map(([id]) => id).sort());
    for (const url of [URLS.sptVat, URLS.sptPph, URLS.withholding, URLS.unrelated]) {
      expect(panelGridFacts(url), url).toBeNull();
    }
  });

  it("is what every projection answers, row by row", () => {
    // The projections keep their own names because the questions disagree, but
    // not their own answers: one row per grid is the only place a fact lives, so
    // the toolbar entry point, the two tabs, the checker's columns and the
    // popup's copy cannot describe one grid two ways (ADR-0028).
    for (const [, url] of ROWS) {
      const facts = panelGridFacts(url)!;
      expect(facts, url).not.toBeNull();
      expect(hasReferenceFilter(url), url).toBe(facts.referenceFilter);
      expect(referenceIsIdentity(url), url).toBe(facts.comparerTab);
      expect(isCheckerPage(url), url).toBe(facts.checkerTab);
      expect(checkerRowIdentity(url), url).toBe(facts.rowIdentity);
      expect(counterpartyIsBuyer(url), url).toBe(facts.counterpartyIsBuyer);
      expect(panelEntryLabel(url), url).toBe(panelEntryLabelFor(facts));
      expect(isPanelPage(url), url).toBe(facts.checkerTab || facts.comparerTab);
      expect(describePortalPage(url), url).toBe(`Terhubung: ${facts.statusLabel}`);
    }
  });

  it("gives each grid its own name, and each name its own row", () => {
    // Two rows sharing a label would make a progress line (or a popup status
    // line) name the wrong grid while every fact still read correctly.
    const labels = Object.values(PANEL_GRIDS).map((facts) => facts.label);
    const statuses = Object.values(PANEL_GRIDS).map((facts) => facts.statusLabel);
    expect(new Set(labels).size).toBe(labels.length);
    expect(new Set(statuses).size).toBe(statuses.length);
    for (const label of [...labels, ...statuses]) expect(label.trim()).not.toBe("");
  });

  it("holds the deliberate disagreements as data, not as prose", () => {
    // PPN Masukan: looked up by a Referensi, never matched on one (ADR-0021).
    expect(PANEL_GRIDS.INPUT_TAX.referenceFilter).toBe(true);
    expect(PANEL_GRIDS.INPUT_TAX.comparerTab).toBe(false);
    // Retur PPN Keluaran: carries the BUYER, but is not the output-tax grid, has
    // no Referensi column to filter, and gets no Komparator tab (ADR-0024).
    expect(PANEL_GRIDS.OUTPUT_RETURN.counterpartyIsBuyer).toBe(true);
    expect(isOutputTaxPage(URLS.outputReturn)).toBe(false);
    expect(PANEL_GRIDS.OUTPUT_RETURN.referenceFilter).toBe(false);
    expect(PANEL_GRIDS.OUTPUT_RETURN.comparerTab).toBe(false);
    // A Retur row is still a row the check can run on, named by its NO RETUR.
    expect(PANEL_GRIDS.OUTPUT_RETURN.checkerTab).toBe(true);
    expect(PANEL_GRIDS.OUTPUT_RETURN.rowIdentity).toBe("no-retur");
  });

  it("keeps the Referensi filter on the two invoice grids", () => {
    // `isVatInvoicePage` is the name of "these rows are invoices"; the filter is
    // offered on exactly those grids. A deliberate coupling, so it is pinned
    // here rather than left to a comment in either module (ADR-0021).
    for (const [, url] of ROWS) {
      expect(hasReferenceFilter(url), url).toBe(isVatInvoicePage(url));
    }
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
