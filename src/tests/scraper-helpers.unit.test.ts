import { describe, it, expect } from "vitest";
import { buildEfakturDownloadUrl, buildEfakturPdfBody, getRowDedupeKey } from "../content/scraper-helpers";

describe("buildEfakturDownloadUrl", () => {
  it("extracts base URL when einvoiceportal/api/ is present", () => {
    const result = buildEfakturDownloadUrl(
      "https://coretaxdjp.pajak.go.id/einvoiceportal/api/outputinvoice/list"
    );
    expect(result).toBe(
      "https://coretaxdjp.pajak.go.id/einvoiceportal/api/DownloadInvoice/download-invoice-document"
    );
  });

  it("falls back to origin + known path when einvoiceportal/api/ is not in URL", () => {
    const result = buildEfakturDownloadUrl(
      "https://coretaxdjp.pajak.go.id/other/api/endpoint"
    );
    expect(result).toBe(
      "https://coretaxdjp.pajak.go.id/einvoiceportal/api/DownloadInvoice/download-invoice-document"
    );
  });

  it("returns the original URL when no http match is found", () => {
    const result = buildEfakturDownloadUrl("invalid-url");
    expect(result).toBe("invalid-url");
  });

  it("handles case-insensitive match for einvoiceportal/api/", () => {
    const result = buildEfakturDownloadUrl(
      "https://example.com/EINVOICEPORTAL/API/something"
    );
    expect(result).toBe(
      "https://example.com/EINVOICEPORTAL/API/DownloadInvoice/download-invoice-document"
    );
  });
});

describe("buildEfakturPdfBody", () => {
  it("sets EInvoiceMenuType to Outgoing for OUTPUT_TAX", () => {
    const body = buildEfakturPdfBody(
      { EInvoiceRecordIdentifier: "rec-1", LetterNumber: "INV-001" },
      "OUTPUT_TAX",
      {}
    );
    expect(body.EInvoiceMenuType).toBe("Outgoing");
  });

  it("sets EInvoiceMenuType to Outgoing for OUTPUT_RETURN", () => {
    const body = buildEfakturPdfBody(
      { EInvoiceRecordIdentifier: "rec-1" },
      "OUTPUT_RETURN",
      {}
    );
    expect(body.EInvoiceMenuType).toBe("Outgoing");
  });

  it("sets EInvoiceMenuType to Incoming for INPUT_TAX", () => {
    const body = buildEfakturPdfBody(
      { EInvoiceRecordIdentifier: "rec-1" },
      "INPUT_TAX",
      {}
    );
    expect(body.EInvoiceMenuType).toBe("Incoming");
  });

  it("sets EInvoiceMenuType to Incoming for INPUT_RETURN", () => {
    const body = buildEfakturPdfBody(
      { EInvoiceRecordIdentifier: "rec-1" },
      "INPUT_RETURN",
      {}
    );
    expect(body.EInvoiceMenuType).toBe("Incoming");
  });

  it("falls back to RecordId when EInvoiceRecordIdentifier is missing", () => {
    const body = buildEfakturPdfBody(
      { RecordId: "rec-2", LetterNumber: "INV-002", DocumentDate: "2025-01-15" },
      "OUTPUT_TAX",
      {}
    );
    expect(body.EInvoiceRecordIdentifier).toBe("rec-2");
  });

  it("falls back to AggregateIdentifier when EInvoiceAggregateIdentifier is missing", () => {
    const body = buildEfakturPdfBody(
      { AggregateIdentifier: "agg-1" },
      "OUTPUT_TAX",
      {}
    );
    expect(body.EInvoiceAggregateIdentifier).toBe("agg-1");
  });

  it("falls back to TaxInvoiceNumber when LetterNumber is missing", () => {
    const body = buildEfakturPdfBody(
      { TaxInvoiceNumber: "TAX-999" },
      "OUTPUT_TAX",
      {}
    );
    expect(body.LetterNumber).toBe("TAX-999");
  });

  it("falls back to capturedBody.DocumentAggregateIdentifier when row has none", () => {
    const body = buildEfakturPdfBody(
      {},
      "OUTPUT_TAX",
      { DocumentAggregateIdentifier: "cap-doc-1" }
    );
    expect(body.DocumentAggregateIdentifier).toBe("cap-doc-1");
  });

  it("falls back to capturedBody.TaxpayerAggregateIdentifier when row has none", () => {
    const body = buildEfakturPdfBody(
      {},
      "OUTPUT_TAX",
      { TaxpayerAggregateIdentifier: "cap-tax-1" }
    );
    expect(body.TaxpayerAggregateIdentifier).toBe("cap-tax-1");
  });

  it("uses empty string for all fields when no data is available", () => {
    const body = buildEfakturPdfBody({}, "OUTPUT_TAX", {});
    expect(body.EInvoiceRecordIdentifier).toBe("");
    expect(body.EInvoiceAggregateIdentifier).toBe("");
    expect(body.DocumentAggregateIdentifier).toBe("");
    expect(body.LetterNumber).toBe("");
  });
});

describe("getRowDedupeKey", () => {
  it("returns RecordId when present", () => {
    expect(getRowDedupeKey({ RecordId: "rec-123", Name: "Test" })).toBe("rec-123");
  });

  it("falls back to AggregateIdentifier when RecordId is missing", () => {
    expect(getRowDedupeKey({ AggregateIdentifier: "agg-456" })).toBe("agg-456");
  });

  it("returns JSON.stringify when both RecordId and AggregateIdentifier are missing", () => {
    const row = { Name: "Test", Amount: 100 };
    expect(getRowDedupeKey(row)).toBe(JSON.stringify(row));
  });

  it("prefers RecordId over AggregateIdentifier when both are present", () => {
    expect(getRowDedupeKey({ RecordId: "rec-1", AggregateIdentifier: "agg-1" })).toBe("rec-1");
  });
});
