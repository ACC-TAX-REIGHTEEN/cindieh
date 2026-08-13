// Unit tests for scraper-pdf.ts — PDF download module.
// Covers the pure core (unwrap, row resolution, message build)
// and the interception session (processing flag lifecycle, emit).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  unwrapPdfData,
  isSuccessfulPdfResponse,
  resolveInvoiceRow,
  buildPdfDownloadMessage,
  createPdfDownloadSession,
} from "../content/scraper-pdf";

// ── unwrapPdfData ─────────────────────────────────────────────────────────────

describe("unwrapPdfData", () => {
  it("returns top-level Content when present", () => {
    expect(unwrapPdfData({ Content: "BASE64" })).toBe("BASE64");
  });

  it("returns Payload.Content when present", () => {
    expect(unwrapPdfData({ Payload: { Content: "BASE64" } })).toBe("BASE64");
  });

  it("returns Payload.Message.Data when present", () => {
    expect(unwrapPdfData({ Payload: { Message: { Data: "BASE64" } } })).toBe("BASE64");
  });

  it("returns Payload.Data when present", () => {
    expect(unwrapPdfData({ Payload: { Data: "BASE64" } })).toBe("BASE64");
  });

  it("returns top-level Data when present", () => {
    expect(unwrapPdfData({ Data: "BASE64" })).toBe("BASE64");
  });

  it("prefers Content over Payload.Message.Data", () => {
    expect(
      unwrapPdfData({ Content: "TOP", Payload: { Message: { Data: "NESTED" } } }),
    ).toBe("TOP");
  });

  it("returns null when no string payload exists", () => {
    expect(unwrapPdfData({ IsSuccessful: false, Message: "Error" })).toBeNull();
    expect(unwrapPdfData({ Payload: {} })).toBeNull();
    expect(unwrapPdfData({ Payload: { Message: { Data: 12345 } } })).toBeNull();
  });

  it("returns null for null / non-object / empty-string values", () => {
    expect(unwrapPdfData(null)).toBeNull();
    expect(unwrapPdfData(undefined)).toBeNull();
    expect(unwrapPdfData("string")).toBeNull();
    expect(unwrapPdfData({ Content: "" })).toBeNull();
  });
});

// ── isSuccessfulPdfResponse ───────────────────────────────────────────────────

describe("isSuccessfulPdfResponse", () => {
  it("is true when IsSuccessful is true", () => {
    expect(isSuccessfulPdfResponse({ IsSuccessful: true })).toBe(true);
  });

  it("is false when IsSuccessful is false", () => {
    expect(isSuccessfulPdfResponse({ IsSuccessful: false })).toBe(false);
  });

  it("is false when IsSuccessful is missing", () => {
    expect(isSuccessfulPdfResponse({ Content: "BASE64" })).toBe(false);
  });

  it("is false for non-objects", () => {
    expect(isSuccessfulPdfResponse(null)).toBe(false);
    expect(isSuccessfulPdfResponse(undefined)).toBe(false);
  });
});

// ── resolveInvoiceRow ─────────────────────────────────────────────────────────

describe("resolveInvoiceRow", () => {
  const rowMap = new Map([
    ["010.000-26.00000001", { Reference: "SZ-0447/07/26", TaxInvoiceNumber: "010.000-26.00000001" }],
    ["040-001", { LetterNumber: "040-001", Reference: "SZ-0001" }],
  ]);

  it("resolves via TaxInvoiceNumber from the request body", () => {
    const body = JSON.stringify({ TaxInvoiceNumber: "010.000-26.00000001" });
    expect(resolveInvoiceRow(body, rowMap)).toEqual({
      Reference: "SZ-0447/07/26",
      TaxInvoiceNumber: "010.000-26.00000001",
    });
  });

  it("resolves via lowercase taxInvoiceNumber", () => {
    const body = JSON.stringify({ taxInvoiceNumber: "010.000-26.00000001" });
    expect(resolveInvoiceRow(body, rowMap)).toEqual({
      Reference: "SZ-0447/07/26",
      TaxInvoiceNumber: "010.000-26.00000001",
    });
  });

  it("resolves via LetterNumber fallback", () => {
    const body = JSON.stringify({ LetterNumber: "040-001" });
    expect(resolveInvoiceRow(body, rowMap)).toEqual({
      LetterNumber: "040-001",
      Reference: "SZ-0001",
    });
  });

  it("is case-insensitive (map keys are stored lowercase)", () => {
    const body = JSON.stringify({ TaxInvoiceNumber: "ABC-123" });
    const lowercaseMap = new Map([["abc-123", { Reference: "REF-LOWER" }]]);
    expect(resolveInvoiceRow(body, lowercaseMap)).toEqual({ Reference: "REF-LOWER" });
  });

  it("falls back to empty object when the key is unknown", () => {
    expect(resolveInvoiceRow(JSON.stringify({ TaxInvoiceNumber: "NOPE" }), rowMap)).toEqual({});
  });

  it("falls back to empty object on invalid JSON", () => {
    expect(resolveInvoiceRow("not-json", rowMap)).toEqual({});
  });

  it("falls back to empty object on empty body", () => {
    expect(resolveInvoiceRow("", rowMap)).toEqual({});
  });
});

// ── buildPdfDownloadMessage ───────────────────────────────────────────────────

describe("buildPdfDownloadMessage", () => {
  it("builds the DOWNLOAD_PDF_ITEM message with direction and token", () => {
    const msg = buildPdfDownloadMessage({
      base64: "BASE64",
      item: { Reference: "REF-1" },
      source: "OUTPUT_TAX",
      token: "tok-123",
    });
    expect(msg).toEqual({
      type: "DOWNLOAD_PDF_ITEM",
      base64: "BASE64",
      item: { Reference: "REF-1" },
      source: "OUTPUT_TAX",
      direction: "FROM_PAGE",
      token: "tok-123",
    });
  });
});

// ── createPdfDownloadSession ──────────────────────────────────────────────────

describe("createPdfDownloadSession", () => {
  const rowMap = new Map([
    ["010.000-26.00000001", { Reference: "SZ-0447/07/26", TaxInvoiceNumber: "010.000-26.00000001" }],
  ]);

  function makeDeps(overrides: Partial<Parameters<typeof createPdfDownloadSession>[0]> = {}) {
    const emit = vi.fn();
    return {
      token: "tok-123",
      getRowMap: () => rowMap,
      getSource: () => null,
      emit,
      ...overrides,
    } as Parameters<typeof createPdfDownloadSession>[0] & { emit: ReturnType<typeof vi.fn> };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is not processing initially", () => {
    const session = createPdfDownloadSession(makeDeps());
    expect(session.isProcessing()).toBe(false);
  });

  it("beginProcessing arms the flag and the timeout resets it", () => {
    const session = createPdfDownloadSession(makeDeps());
    session.beginProcessing();
    expect(session.isProcessing()).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(session.isProcessing()).toBe(false);
  });

  it("clearProcessing disarms the flag and cancels the reset timer", () => {
    const session = createPdfDownloadSession(makeDeps());
    session.beginProcessing();
    session.clearProcessing();
    expect(session.isProcessing()).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(session.isProcessing()).toBe(false);
  });

  it("emits a message and keeps the flag armed when a valid PDF is intercepted", () => {
    const deps = makeDeps();
    const session = createPdfDownloadSession(deps);
    session.beginProcessing();
    const body = JSON.stringify({ TaxInvoiceNumber: "010.000-26.00000001" });

    const result = session.handleNativeResponse({ Content: "B".repeat(150) }, body);

    expect(result.intercepted).toBe(true);
    expect(session.isProcessing()).toBe(true);
    expect(deps.emit).toHaveBeenCalledTimes(1);
    expect(deps.emit).toHaveBeenCalledWith({
      type: "DOWNLOAD_PDF_ITEM",
      base64: "B".repeat(150),
      item: rowMap.get("010.000-26.00000001"),
      source: "OUTPUT_TAX",
      direction: "FROM_PAGE",
      token: "tok-123",
    });
  });

  it("uses the page source when provided", () => {
    const deps = makeDeps({ getSource: () => "INPUT_TAX" });
    const session = createPdfDownloadSession(deps);
    const result = session.handleNativeResponse({ Content: "B".repeat(150) }, "{}");
    expect(result.intercepted).toBe(true);
    expect(deps.emit.mock.calls[0][0].source).toBe("INPUT_TAX");
  });

  it("clears the flag and does not emit when no PDF data is present", () => {
    const deps = makeDeps();
    const session = createPdfDownloadSession(deps);
    session.beginProcessing();

    const result = session.handleNativeResponse({ IsSuccessful: false, Message: "Error" }, "{}");

    expect(result.intercepted).toBe(false);
    expect(session.isProcessing()).toBe(false);
    expect(deps.emit).not.toHaveBeenCalled();
  });

  it("rejects PDFs shorter than 100 chars as pass-through", () => {
    const deps = makeDeps();
    const session = createPdfDownloadSession(deps);
    session.beginProcessing();

    const result = session.handleNativeResponse({ Content: "short" }, "{}");

    expect(result.intercepted).toBe(false);
    expect(session.isProcessing()).toBe(false);
    expect(deps.emit).not.toHaveBeenCalled();
  });

  it("emits an empty item when the request body cannot resolve a row", () => {
    // A native download whose body has no invoice key (or the grid was never
    // captured) must still emit, with item falling back to {} — the filename
    // generator then uses TANPA_REFERENSI instead of crashing.
    const deps = makeDeps();
    const session = createPdfDownloadSession(deps);
    session.beginProcessing();
    const result = session.handleNativeResponse({ Content: "B".repeat(150) }, "{}");
    expect(result.intercepted).toBe(true);
    expect(deps.emit.mock.calls[0][0].item).toEqual({});
  });
});
