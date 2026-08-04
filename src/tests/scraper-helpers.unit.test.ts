import { describe, it, expect } from "vitest";
import { buildEfakturDownloadUrl, buildEfakturPdfBody, getRowDedupeKey, mergeRows, collectFields } from "../content/scraper-helpers";

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

  it("sets EInvoiceMenuType to OutgoingReturn for OUTPUT_RETURN", () => {
    const body = buildEfakturPdfBody(
      { EInvoiceRecordIdentifier: "rec-1" },
      "OUTPUT_RETURN",
      {}
    );
    expect(body.EInvoiceMenuType).toBe("OutgoingReturn");
  });

  it("sets EInvoiceMenuType to Input for INPUT_TAX", () => {
    const body = buildEfakturPdfBody(
      { EInvoiceRecordIdentifier: "rec-1" },
      "INPUT_TAX",
      {}
    );
    expect(body.EInvoiceMenuType).toBe("Input");
  });

  it("sets EInvoiceMenuType to InputReturn for INPUT_RETURN", () => {
    const body = buildEfakturPdfBody(
      { EInvoiceRecordIdentifier: "rec-1" },
      "INPUT_RETURN",
      {}
    );
    expect(body.EInvoiceMenuType).toBe("InputReturn");
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

  it("produces a deterministic key (key-order independent) when RecordId/AggregateIdentifier are missing", () => {
    const a = { Name: "Test", Amount: 100 };
    const b = { Amount: 100, Name: "Test" }; // same data, different key order
    // The two rows are logically identical, so their dedupe keys must match.
    expect(getRowDedupeKey(a)).toBe(getRowDedupeKey(b));
    // The key must not depend on insertion order of keys.
    expect(getRowDedupeKey(a)).toBe('{"Amount":100,"Name":"Test"}');
  });

  it("prefers RecordId over AggregateIdentifier when both are present", () => {
    expect(getRowDedupeKey({ RecordId: "rec-1", AggregateIdentifier: "agg-1" })).toBe("rec-1");
  });
});

describe("mergeRows", () => {
  it("appends new rows and returns only the added ones", () => {
    const allData: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    const added = mergeRows(allData, seen, [{ RecordId: "a" }, { RecordId: "b" }]);
    expect(added).toHaveLength(2);
    expect(allData).toHaveLength(2);
  });

  it("skips duplicates by RecordId across pages (pagination dedupe)", () => {
    const allData: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    // Page 1
    mergeRows(allData, seen, [
      { RecordId: "r1", Name: "A" },
      { RecordId: "r2", Name: "B" },
    ]);
    // Page 2 overlaps r2 and adds r3
    const added = mergeRows(allData, seen, [
      { RecordId: "r2", Name: "B" },
      { RecordId: "r3", Name: "C" },
    ]);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ RecordId: "r3" });
    expect(allData).toHaveLength(3);
    // No duplicate RecordId in the final dataset
    const ids = allData.map((r) => r.RecordId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("dedupes by deterministic JSON key when RecordId is missing (order-independent)", () => {
    const allData: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    mergeRows(allData, seen, [{ Name: "X", Amount: 10 }]);
    const added = mergeRows(allData, seen, [{ Amount: 10, Name: "X" }]); // same data, swapped keys
    expect(added).toHaveLength(0); // correctly treated as duplicate
    expect(allData).toHaveLength(1);
  });

  it("treats different values with same key shape as distinct", () => {
    const allData: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    mergeRows(allData, seen, [{ Name: "X", Amount: 10 }]);
    const added = mergeRows(allData, seen, [{ Name: "X", Amount: 11 }]); // different amount
    expect(added).toHaveLength(1);
    expect(allData).toHaveLength(2);
  });
});

describe("collectFields", () => {
  it("returns the union of field names across rows", () => {
    const fields = collectFields([
      { a: 1, b: 2 },
      { b: 3, c: 4 },
    ]);
    expect(fields.sort()).toEqual(["a", "b", "c"]);
  });

  it("returns empty array for empty dataset", () => {
    expect(collectFields([])).toEqual([]);
  });
});
