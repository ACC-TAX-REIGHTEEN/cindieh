// Unit tests for scraper-xhr.ts — xhrDownloadWithholdingPdf and xhrDownloadEfakturPdf
// Uses the MockXHR infrastructure from __mocks__/xhr-mock.ts.
import { describe, it, expect, beforeEach } from "vitest";
import { xhrDownloadWithholdingPdf, xhrDownloadEfakturPdf } from "../content/scraper-xhr";
import { MockXHR, stubXHR } from "./__mocks__/xhr-mock";
import type { CapturedRequest } from "../content/scraper-types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeCaptured(overrides: Partial<CapturedRequest> = {}): CapturedRequest {
  return {
    url: "https://coretaxdjp.pajak.go.id/api/GetMyWithholdingSlip",
    headers: { "Content-Type": "application/json", Authorization: "Bearer tok123" },
    body: null,
    rawBody: JSON.stringify({ WithholdingType: "EBUPOTBPU" }),
    response: null,
    initialData: [],
    initialFirst: 0,
    source: "WITHHOLDING_SLIPS",
    ...overrides,
  };
}

const WITHHOLDING_ROW = {
  WithholdingslipsAggregateIdentifier: "agg-1",
  RecordId: "rec-1",
  DocumentFormAggregateIdentifier: "docform-1",
  TaxpayerAggregateIdentifier: "taxpayer-1",
  WithholdingSlipsDate: "2026-01-31T00:00:00+07:00",
  TaxIdentificationNumber: "12345678901234",
  WithholdingSlipNumber: "BP-001",
};

const EFAKTUR_ROW = {
  EInvoiceRecordIdentifier: "erec-1",
  EInvoiceAggregateIdentifier: "eagg-1",
  DocumentFormAggregateIdentifier: "docform-1",
  TaxpayerAggregateIdentifier: "taxpayer-1",
  LetterNumber: "040-001",
  DocumentDate: "2026-04-15T00:00:00+07:00",
  TaxInvoiceStatus: "Normal",
};

const VALID_BASE64 = btoa("A".repeat(200)); // must be > 100 chars to pass the length guard in xhrDownloadEfakturPdf

// ── xhrDownloadWithholdingPdf ─────────────────────────────────────────────────

describe("xhrDownloadWithholdingPdf", () => {
  let instances: MockXHR[];

  beforeEach(() => {
    ({ instances } = stubXHR());
  });

  it("resolves with base64 content on success (Payload.Message.Data path)", async () => {
    const captured = makeCaptured();
    const promise = xhrDownloadWithholdingPdf(captured, WITHHOLDING_ROW, 30000);

    instances[0]._triggerLoad(
      JSON.stringify({ IsSuccessful: true, Payload: { Message: { Data: VALID_BASE64 } } }),
    );

    await expect(promise).resolves.toBe(VALID_BASE64);
  });

  it("rejects when IsSuccessful is false with server error message", async () => {
    const captured = makeCaptured();
    const promise = xhrDownloadWithholdingPdf(captured, WITHHOLDING_ROW, 30000);

    instances[0]._triggerLoad(
      JSON.stringify({ IsSuccessful: false, Message: "PDF tidak ditemukan" }),
    );

    await expect(promise).rejects.toThrow("PDF tidak ditemukan");
  });

  it("rejects with ErrorMessage from Payload when present", async () => {
    const captured = makeCaptured();
    const promise = xhrDownloadWithholdingPdf(captured, WITHHOLDING_ROW, 30000);

    instances[0]._triggerLoad(
      JSON.stringify({
        IsSuccessful: false,
        Payload: { Message: { ErrorMessage: "Dokumen sudah kedaluwarsa" } },
      }),
    );

    await expect(promise).rejects.toThrow("Dokumen sudah kedaluwarsa");
  });

  it("rejects with generic message when PDF data is missing", async () => {
    const captured = makeCaptured();
    const promise = xhrDownloadWithholdingPdf(captured, WITHHOLDING_ROW, 30000);

    instances[0]._triggerLoad(JSON.stringify({ IsSuccessful: true, Payload: {} }));

    await expect(promise).rejects.toThrow("Gagal mengambil konten PDF");
  });

  it("rejects with parse error when response is invalid JSON", async () => {
    const captured = makeCaptured();
    const promise = xhrDownloadWithholdingPdf(captured, WITHHOLDING_ROW, 30000);

    instances[0]._triggerLoad("not-json", 200);

    await expect(promise).rejects.toThrow("Parse error saat download PDF");
  });

  it("rejects with HTTP error on non-2xx status", async () => {
    const captured = makeCaptured();
    const promise = xhrDownloadWithholdingPdf(captured, WITHHOLDING_ROW, 30000);

    instances[0]._triggerLoad("{}", 403);

    await expect(promise).rejects.toThrow("HTTP 403");
  });

  it("rejects with network error on onerror", async () => {
    const captured = makeCaptured();
    const promise = xhrDownloadWithholdingPdf(captured, WITHHOLDING_ROW, 30000);

    instances[0]._triggerError();

    await expect(promise).rejects.toThrow("Network error saat download PDF");
  });

  it("rejects with timeout error on ontimeout", async () => {
    const captured = makeCaptured();
    const promise = xhrDownloadWithholdingPdf(captured, WITHHOLDING_ROW, 30000);

    instances[0]._triggerTimeout();

    await expect(promise).rejects.toThrow("Timeout saat download PDF");
  });

  it("uses a URL derived from the captured URL (replaces GetMyWithholdingSlip)", async () => {
    const captured = makeCaptured({
      url: "https://example.com/api/GetMyWithholdingSlip",
    });
    const promise = xhrDownloadWithholdingPdf(captured, WITHHOLDING_ROW, 30000);

    instances[0]._triggerLoad(
      JSON.stringify({ IsSuccessful: true, Payload: { Message: { Data: VALID_BASE64 } } }),
    );
    await promise;

    const openCall = instances[0].open.mock.calls[0];
    expect(openCall[1]).toContain("DownloadWithholdingSlips/download-pdf-document");
    expect(openCall[1]).not.toContain("GetMyWithholdingSlip");
  });

  it("sets the authorization header from captured headers", async () => {
    const captured = makeCaptured();
    const promise = xhrDownloadWithholdingPdf(captured, WITHHOLDING_ROW, 30000);

    instances[0]._triggerLoad(
      JSON.stringify({ IsSuccessful: true, Payload: { Message: { Data: VALID_BASE64 } } }),
    );
    await promise;

    expect(instances[0].setRequestHeader).toHaveBeenCalledWith("Authorization", "Bearer tok123");
  });

  it("sets xhr.timeout to the provided value", async () => {
    const captured = makeCaptured();
    const promise = xhrDownloadWithholdingPdf(captured, WITHHOLDING_ROW, 15000);

    instances[0]._triggerLoad(
      JSON.stringify({ IsSuccessful: true, Payload: { Message: { Data: VALID_BASE64 } } }),
    );
    await promise;

    expect(instances[0].timeout).toBe(15000);
  });

  it("builds request body with EbupotType from captured rawBody", async () => {
    const captured = makeCaptured({
      rawBody: JSON.stringify({ WithholdingType: "CUSTOM_TYPE" }),
    });
    const promise = xhrDownloadWithholdingPdf(captured, WITHHOLDING_ROW, 30000);

    instances[0]._triggerLoad(
      JSON.stringify({ IsSuccessful: true, Payload: { Message: { Data: VALID_BASE64 } } }),
    );
    await promise;

    const sentBody = JSON.parse(instances[0].send.mock.calls[0][0] as string);
    expect(sentBody.EbupotType).toBe("CUSTOM_TYPE");
  });

  it("falls back to EBUPOTBPU for EbupotType when rawBody has no WithholdingType", async () => {
    const captured = makeCaptured({ rawBody: "{}" });
    const promise = xhrDownloadWithholdingPdf(captured, WITHHOLDING_ROW, 30000);

    instances[0]._triggerLoad(
      JSON.stringify({ IsSuccessful: true, Payload: { Message: { Data: VALID_BASE64 } } }),
    );
    await promise;

    const sentBody = JSON.parse(instances[0].send.mock.calls[0][0] as string);
    expect(sentBody.EbupotType).toBe("EBUPOTBPU");
  });

  it("falls back to defaults when rawBody is not valid JSON", async () => {
    const captured = makeCaptured({ rawBody: "not-json{{{" });
    const promise = xhrDownloadWithholdingPdf(captured, WITHHOLDING_ROW, 30000);

    instances[0]._triggerLoad(
      JSON.stringify({ IsSuccessful: true, Payload: { Message: { Data: VALID_BASE64 } } }),
    );
    await promise;

    const sentBody = JSON.parse(instances[0].send.mock.calls[0][0] as string);
    expect(sentBody.EbupotType).toBe("EBUPOTBPU");
  });
});

// ── xhrDownloadEfakturPdf ─────────────────────────────────────────────────────

describe("xhrDownloadEfakturPdf", () => {
  let instances: MockXHR[];

  beforeEach(() => {
    ({ instances } = stubXHR());
  });

  const BASE_CAPTURED = makeCaptured({
    url: "https://coretaxdjp.pajak.go.id/einvoiceportal/api/outputinvoice/list",
    rawBody: JSON.stringify({
      DocumentAggregateIdentifier: "cap-doc-1",
      TaxpayerAggregateIdentifier: "cap-taxpayer-1",
    }),
    source: "OUTPUT_TAX",
  });

  it("resolves with base64 content via top-level Content field", async () => {
    const promise = xhrDownloadEfakturPdf(BASE_CAPTURED, EFAKTUR_ROW, "OUTPUT_TAX", 30000);

    instances[0]._triggerLoad(JSON.stringify({ Content: VALID_BASE64 }));

    await expect(promise).resolves.toBe(VALID_BASE64);
  });

  it("resolves with base64 content via Payload.Message.Data path", async () => {
    const promise = xhrDownloadEfakturPdf(BASE_CAPTURED, EFAKTUR_ROW, "OUTPUT_TAX", 30000);

    instances[0]._triggerLoad(
      JSON.stringify({ IsSuccessful: true, Payload: { Message: { Data: VALID_BASE64 } } }),
    );

    await expect(promise).resolves.toBe(VALID_BASE64);
  });

  it("resolves with base64 content via Payload.Data path", async () => {
    const promise = xhrDownloadEfakturPdf(BASE_CAPTURED, EFAKTUR_ROW, "OUTPUT_TAX", 30000);

    instances[0]._triggerLoad(JSON.stringify({ Payload: { Data: VALID_BASE64 } }));

    await expect(promise).resolves.toBe(VALID_BASE64);
  });

  it("resolves with base64 content via top-level Data field", async () => {
    const promise = xhrDownloadEfakturPdf(BASE_CAPTURED, EFAKTUR_ROW, "OUTPUT_TAX", 30000);

    instances[0]._triggerLoad(JSON.stringify({ Data: VALID_BASE64 }));

    await expect(promise).resolves.toBe(VALID_BASE64);
  });

  it("rejects when PDF data is empty (< 100 chars)", async () => {
    const promise = xhrDownloadEfakturPdf(BASE_CAPTURED, EFAKTUR_ROW, "OUTPUT_TAX", 30000);

    instances[0]._triggerLoad(JSON.stringify({ Content: "short" }));

    await expect(promise).rejects.toThrow("Gagal mengambil konten PDF (data kosong)");
  });

  it("rejects when PDF data is not present in any known path", async () => {
    const promise = xhrDownloadEfakturPdf(BASE_CAPTURED, EFAKTUR_ROW, "OUTPUT_TAX", 30000);

    instances[0]._triggerLoad(JSON.stringify({ IsSuccessful: false, Message: "Error dari server" }));

    await expect(promise).rejects.toThrow("Error dari server");
  });

  it("rejects with ErrorMessage from Payload when present", async () => {
    const promise = xhrDownloadEfakturPdf(BASE_CAPTURED, EFAKTUR_ROW, "OUTPUT_TAX", 30000);

    instances[0]._triggerLoad(
      JSON.stringify({
        IsSuccessful: false,
        Payload: { Message: { ErrorMessage: "Faktur tidak ditemukan" } },
      }),
    );

    await expect(promise).rejects.toThrow("Faktur tidak ditemukan");
  });

  it("rejects with parse error on invalid JSON", async () => {
    const promise = xhrDownloadEfakturPdf(BASE_CAPTURED, EFAKTUR_ROW, "OUTPUT_TAX", 30000);

    instances[0]._triggerLoad("not-json", 200);

    await expect(promise).rejects.toThrow("Parse error saat download PDF");
  });

  it("rejects with HTTP error on non-2xx status", async () => {
    const promise = xhrDownloadEfakturPdf(BASE_CAPTURED, EFAKTUR_ROW, "OUTPUT_TAX", 30000);

    instances[0]._triggerLoad("{}", 500);

    await expect(promise).rejects.toThrow("HTTP 500");
  });

  it("rejects with network error on onerror", async () => {
    const promise = xhrDownloadEfakturPdf(BASE_CAPTURED, EFAKTUR_ROW, "OUTPUT_TAX", 30000);

    instances[0]._triggerError();

    await expect(promise).rejects.toThrow("Network error saat download PDF");
  });

  it("rejects with timeout error on ontimeout", async () => {
    const promise = xhrDownloadEfakturPdf(BASE_CAPTURED, EFAKTUR_ROW, "OUTPUT_TAX", 30000);

    instances[0]._triggerTimeout();

    await expect(promise).rejects.toThrow("Timeout saat download PDF");
  });

  it("uses the DownloadInvoice URL derived from the captured URL", async () => {
    const promise = xhrDownloadEfakturPdf(BASE_CAPTURED, EFAKTUR_ROW, "OUTPUT_TAX", 30000);

    instances[0]._triggerLoad(JSON.stringify({ Content: VALID_BASE64 }));
    await promise;

    const openCall = instances[0].open.mock.calls[0];
    expect(openCall[1]).toContain("DownloadInvoice/download-invoice-document");
  });

  it("sets EInvoiceMenuType to Outgoing for OUTPUT_TAX", async () => {
    const promise = xhrDownloadEfakturPdf(BASE_CAPTURED, EFAKTUR_ROW, "OUTPUT_TAX", 30000);

    instances[0]._triggerLoad(JSON.stringify({ Content: VALID_BASE64 }));
    await promise;

    const body = JSON.parse(instances[0].send.mock.calls[0][0] as string);
    expect(body.EInvoiceMenuType).toBe("Outgoing");
  });

  it("falls back to defaults when rawBody is not valid JSON", async () => {
    const captured = makeCaptured({
      url: "https://coretaxdjp.pajak.go.id/einvoiceportal/api/outputinvoice/list",
      rawBody: "not-json{{{",
      source: "OUTPUT_TAX",
    });
    const promise = xhrDownloadEfakturPdf(captured, EFAKTUR_ROW, "OUTPUT_TAX", 30000);

    instances[0]._triggerLoad(JSON.stringify({ Content: VALID_BASE64 }));
    await promise;

    const body = JSON.parse(instances[0].send.mock.calls[0][0] as string);
    expect(body.EInvoiceMenuType).toBe("Outgoing");
  });

  it("sets EInvoiceMenuType to Input for INPUT_TAX", async () => {
    const captured = makeCaptured({
      url: "https://coretaxdjp.pajak.go.id/einvoiceportal/api/inputinvoice/list",
      source: "INPUT_TAX",
    });
    const promise = xhrDownloadEfakturPdf(captured, EFAKTUR_ROW, "INPUT_TAX", 30000);

    instances[0]._triggerLoad(JSON.stringify({ Content: VALID_BASE64 }));
    await promise;

    const body = JSON.parse(instances[0].send.mock.calls[0][0] as string);
    expect(body.EInvoiceMenuType).toBe("Input");
  });

  it("sets EInvoiceMenuType to OutgoingReturn for OUTPUT_RETURN", async () => {
    const captured = makeCaptured({ source: "OUTPUT_RETURN" });
    const promise = xhrDownloadEfakturPdf(captured, EFAKTUR_ROW, "OUTPUT_RETURN", 30000);

    instances[0]._triggerLoad(JSON.stringify({ Content: VALID_BASE64 }));
    await promise;

    const body = JSON.parse(instances[0].send.mock.calls[0][0] as string);
    expect(body.EInvoiceMenuType).toBe("OutgoingReturn");
  });

  it("sets EInvoiceMenuType to InputReturn for INPUT_RETURN", async () => {
    const captured = makeCaptured({ source: "INPUT_RETURN" });
    const promise = xhrDownloadEfakturPdf(captured, EFAKTUR_ROW, "INPUT_RETURN", 30000);

    instances[0]._triggerLoad(JSON.stringify({ Content: VALID_BASE64 }));
    await promise;

    const body = JSON.parse(instances[0].send.mock.calls[0][0] as string);
    expect(body.EInvoiceMenuType).toBe("InputReturn");
  });

  it("sets EInvoiceMenuType to Incoming for unknown source", async () => {
    const captured = makeCaptured({ source: "WITHHOLDING_SLIPS" });
    const promise = xhrDownloadEfakturPdf(captured, EFAKTUR_ROW, "WITHHOLDING_SLIPS", 30000);

    instances[0]._triggerLoad(JSON.stringify({ Content: VALID_BASE64 }));
    await promise;

    const body = JSON.parse(instances[0].send.mock.calls[0][0] as string);
    expect(body.EInvoiceMenuType).toBe("Incoming");
  });

  it("falls back to capturedBody fields for identifiers missing from row", async () => {
    const captured = makeCaptured({
      url: BASE_CAPTURED.url,
      rawBody: JSON.stringify({
        DocumentAggregateIdentifier: "cap-doc-fallback",
        TaxpayerAggregateIdentifier: "cap-taxpayer-fallback",
      }),
      source: "OUTPUT_TAX",
    });
    const rowWithoutIds = { LetterNumber: "040-999" };
    const promise = xhrDownloadEfakturPdf(captured, rowWithoutIds, "OUTPUT_TAX", 30000);

    instances[0]._triggerLoad(JSON.stringify({ Content: VALID_BASE64 }));
    await promise;

    const body = JSON.parse(instances[0].send.mock.calls[0][0] as string);
    expect(body.DocumentAggregateIdentifier).toBe("cap-doc-fallback");
    expect(body.TaxpayerAggregateIdentifier).toBe("cap-taxpayer-fallback");
  });

  it("sets authorization header from captured headers", async () => {
    const promise = xhrDownloadEfakturPdf(BASE_CAPTURED, EFAKTUR_ROW, "OUTPUT_TAX", 30000);

    instances[0]._triggerLoad(JSON.stringify({ Content: VALID_BASE64 }));
    await promise;

    expect(instances[0].setRequestHeader).toHaveBeenCalledWith("Authorization", "Bearer tok123");
  });

  it("sets xhr.timeout to the provided value", async () => {
    const promise = xhrDownloadEfakturPdf(BASE_CAPTURED, EFAKTUR_ROW, "OUTPUT_TAX", 12000);

    instances[0]._triggerLoad(JSON.stringify({ Content: VALID_BASE64 }));
    await promise;

    expect(instances[0].timeout).toBe(12000);
  });
});
