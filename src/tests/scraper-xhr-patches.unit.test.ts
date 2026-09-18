// Unit tests for scraper-xhr-patches.ts — the XHR prototype patches (P2 open,
// P3 send, P4 setRequestHeader) extracted from the scraper.ts IIFE so filter
// injection and grid capture finally have tests of their own.
//
// Load-bearing behaviours under test:
//   - open() wires the native-download response listener BEFORE the portal can
//     register its own (registering in send() caused the duplicate download).
//   - send() arms the native download for the portal's own XHR only, never for
//     an extension-owned bulk XHR (that would emit DOWNLOAD_PDF_ITEM twice).
//   - filter injection is idempotent: extension-owned properties are stripped
//     before being re-added, so a body can pass through twice.
//   - capture rebuilds the invoice → row index (lowercase keys, LetterNumber
//     kept only when it differs) and reports the *injected* body as rawBody.
import { describe, it, expect, vi } from "vitest";
import type { ExportSource } from "../content/page-context";
import type { CapturedRequest, InterceptedXHR } from "../content/scraper-types";
import { DOWNLOAD_ENDPOINT } from "../content/scraper-fetch";
import {
  EXTENSION_FILTER_FIELDS,
  createXhrPatches,
  fillInvoiceRowIndex,
  injectFilters,
  isPaginatedGridBody,
  isRowsPayload,
  type FilterState,
  type XhrPatchesDeps,
  type XhrPrototypeTarget,
} from "../content/scraper-xhr-patches";

const DOWNLOAD_URL = `https://coretaxdjp.pajak.go.id/api/${DOWNLOAD_ENDPOINT}`;
const GRID_URL = "https://coretaxdjp.pajak.go.id/api/GetEfakturOutputList";

// ── Fakes ─────────────────────────────────────────────

interface ProtoCall {
  thisArg: unknown;
  args: unknown[];
}

/** Prototype stub: records every pass-through call and its receiver. */
function makePrototype() {
  const openCalls: ProtoCall[] = [];
  const sendCalls: ProtoCall[] = [];
  const headerCalls: ProtoCall[] = [];
  const proto: XhrPrototypeTarget = {
    open(this: InterceptedXHR, ...args: unknown[]): unknown {
      openCalls.push({ thisArg: this, args });
      return "open-result";
    },
    send(this: InterceptedXHR, body?: unknown): unknown {
      sendCalls.push({ thisArg: this, args: [body] });
      return "send-result";
    },
    setRequestHeader(this: InterceptedXHR, ...args: unknown[]): unknown {
      headerCalls.push({ thisArg: this, args });
      return "header-result";
    },
  };
  return { proto, openCalls, sendCalls, headerCalls };
}

/** Minimal XHR double: only what the patches touch. */
function makeXhr(init: Partial<InterceptedXHR> = {}) {
  const listeners: Array<{ type: string; fn: () => void }> = [];
  const raw: Record<string, unknown> = {
    addEventListener(type: string, fn: () => void) {
      listeners.push({ type, fn });
    },
    responseText: "",
    readyState: 4,
    ...init,
  };
  return {
    xhr: raw as unknown as InterceptedXHR,
    listenerTypes: () => listeners.map((l) => l.type),
    fireLoad: () => {
      for (const l of listeners.filter((entry) => entry.type === "load")) l.fn();
    },
    setResponse: (payload: unknown) => {
      raw.responseText = typeof payload === "string" ? payload : JSON.stringify(payload);
    },
    raw,
  };
}

interface DepsOptions {
  filterState?: FilterState;
  pageSource?: ExportSource | null;
  inferred?: ExportSource | null;
}

function makeDeps(options: DepsOptions = {}) {
  const { proto, openCalls, sendCalls, headerCalls } = makePrototype();
  const captured: CapturedRequest[] = [];
  const errors: Array<{ message: string; error: unknown }> = [];
  // Seeded so tests can prove the index is rebuilt, not appended to.
  const rowMap = new Map<string, Record<string, unknown>>([["stale", { Old: true }]]);
  const beginProcessing = vi.fn();
  const wireListener = vi.fn();
  const getFilterState = vi.fn(() => options.filterState ?? {});
  const getPageSource = vi.fn(() => options.pageSource ?? null);
  const inferSource = vi.fn(() => options.inferred ?? null);

  const deps: XhrPatchesDeps = {
    xhrPrototype: proto,
    session: { beginProcessing },
    wireNativeDownloadListener: wireListener,
    getFilterState,
    getPageSource,
    inferSource,
    invoiceRowMap: rowMap,
    onCaptured: (capturedRequest) => captured.push(capturedRequest),
    logError: (message, error) => errors.push({ message, error }),
  };

  const patches = createXhrPatches(deps);
  patches.install();

  return {
    patches,
    proto,
    openCalls,
    sendCalls,
    headerCalls,
    captured,
    errors,
    rowMap,
    beginProcessing,
    wireListener,
    getFilterState,
    getPageSource,
    inferSource,
  };
}

// ── Pure helpers ──────────────────────────────────────

describe("injectFilters", () => {
  it("adds one entry per filter value with the portal's matching flags", () => {
    const parsed = injectFilters({ Filters: [] }, {
      Reference: { value: "SZ-0447/07/26", matchMode: "contains" },
    });

    expect(parsed.Filters).toEqual([
      {
        PropertyName: "Reference",
        Value: "SZ-0447/07/26",
        MatchMode: "contains",
        CaseSensitive: false,
        AsString: false,
      },
    ]);
  });

  it("uses the lowercase key when the body has no Filters property", () => {
    const parsed = injectFilters({}, { Reference: { value: "R-1", matchMode: "equals" } });

    expect(parsed).toHaveProperty("filters");
    expect(parsed.filters).toHaveLength(1);
  });

  it("marks every value after the first with LogicalOperator OR", () => {
    const parsed = injectFilters({}, {
      TaxInvoiceNumber: { value: ["a", "b", "c"], matchMode: "equals" },
    });

    const entries = parsed.filters as Record<string, unknown>[];
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.LogicalOperator)).toEqual([undefined, "OR", "OR"]);
  });

  it("is idempotent: injecting twice does not stack extension entries", () => {
    const state: FilterState = { Reference: { value: ["a", "b"], matchMode: "contains" } };
    const parsed = injectFilters({ Filters: [] }, state);
    injectFilters(parsed, state);

    const entries = parsed.Filters as Record<string, unknown>[];
    expect(entries.filter((e) => e.PropertyName === "Reference")).toHaveLength(2);
  });

  it("strips stale extension filters but keeps the portal's own", () => {
    const parsed = injectFilters(
      {
        Filters: [
          { PropertyName: "Reference", Value: "stale" },
          { PropertyName: "TaxInvoiceNumber", Value: "stale" },
          { PropertyName: "BuyerName", Value: "PT Contoh" },
        ],
      },
      {},
    );

    expect(parsed.Filters).toEqual([{ PropertyName: "BuyerName", Value: "PT Contoh" }]);
  });

  it("removes exactly the fields the extension owns", () => {
    expect(EXTENSION_FILTER_FIELDS).toEqual(["Reference", "TaxInvoiceNumber"]);

    const parsed = injectFilters(
      { Filters: [{ PropertyName: "ReferenceX", Value: "keep" }] },
      {},
    );
    expect(parsed.Filters).toEqual([{ PropertyName: "ReferenceX", Value: "keep" }]);
  });

  it("leaves a non-array Filters value untouched", () => {
    const parsed = injectFilters({ Filters: "already-a-string" }, {
      Reference: { value: "R-1", matchMode: "contains" },
    });

    expect(parsed.Filters).toBe("already-a-string");
  });
});

describe("fillInvoiceRowIndex", () => {
  const row = { TaxInvoiceNumber: "010.000-26.00000001", LetterNumber: "SZ-0447/07/26" };

  it("indexes both identifiers, lowercased and trimmed", () => {
    // The row object itself is stored as-is; only the KEYS are normalised.
    const inputRow = { TaxInvoiceNumber: " 010.000-26.00000001 ", LetterNumber: "SZ-0447/07/26" };
    const map = fillInvoiceRowIndex(new Map(), [inputRow]);

    expect([...map.keys()].sort()).toEqual(["010.000-26.00000001", "sz-0447/07/26"]);
    expect(map.get("010.000-26.00000001")).toBe(inputRow);
    expect(map.get("sz-0447/07/26")).toBe(inputRow);
  });

  it("skips blank identifiers", () => {
    const map = fillInvoiceRowIndex(new Map(), [{ TaxInvoiceNumber: "  ", LetterNumber: "" }]);

    expect(map.size).toBe(0);
  });

  it("does not add an alias when LetterNumber equals TaxInvoiceNumber", () => {
    const map = fillInvoiceRowIndex(new Map(), [
      { TaxInvoiceNumber: "SZ-1", LetterNumber: "SZ-1" },
    ]);

    expect(map.size).toBe(1);
    expect(map.get("sz-1")).toEqual({ TaxInvoiceNumber: "SZ-1", LetterNumber: "SZ-1" });
  });

  it("rebuilds the index instead of appending to it", () => {
    const map = new Map<string, Record<string, unknown>>([["stale", { old: true }]]);

    fillInvoiceRowIndex(map, [row]);

    expect(map.has("stale")).toBe(false);
    expect(map.size).toBe(2);
  });
});

describe("payload guards", () => {
  it("accepts only Payload.Data arrays as grid rows", () => {
    expect(isRowsPayload({ Payload: { Data: [{ a: 1 }] } })).toBe(true);
    expect(isRowsPayload({ Payload: { Data: [] } })).toBe(true);
    expect(isRowsPayload({ Payload: { Data: { a: 1 } } })).toBe(false);
    expect(isRowsPayload({ Payload: {} })).toBe(false);
    expect(isRowsPayload({ Content: "base64" })).toBe(false);
    expect(isRowsPayload(null)).toBe(false);
    expect(isRowsPayload("nope")).toBe(false);
  });

  it("recognises the paginated grid body shape", () => {
    expect(isPaginatedGridBody(JSON.stringify({ First: 0, Rows: 10 }))).toBe(true);
    expect(isPaginatedGridBody(JSON.stringify({ Rows: 10 }))).toBe(false);
    expect(isPaginatedGridBody("not json")).toBe(false);
  });
});

// ── P2: open() ────────────────────────────────────────

describe("open() patch", () => {
  it("records url and method, then resets headers for the new request", () => {
    const { proto, openCalls } = makeDeps();
    const { xhr } = makeXhr({ __headers: { Authorization: "stale-token" } });

    proto.open.call(xhr, "POST", GRID_URL, true);

    expect(xhr.__url).toBe(GRID_URL);
    expect(xhr.__method).toBe("POST");
    expect(xhr.__headers).toEqual({});
    expect(openCalls).toEqual([{ thisArg: xhr, args: ["POST", GRID_URL, true] }]);
  });

  it("wires the native-download response reader at open(), before the portal registers its own", () => {
    const { proto, wireListener } = makeDeps();
    const order: string[] = [];
    wireListener.mockImplementation(() => order.push("wire"));
    const { xhr } = makeXhr();

    proto.open.call(xhr, "POST", DOWNLOAD_URL);
    // The portal registers its reader after open() returns, before send().
    order.push("portal-reader");

    expect(wireListener).toHaveBeenCalledWith(xhr);
    expect(order).toEqual(["wire", "portal-reader"]);
  });

  it("does not wire the reader for any other endpoint", () => {
    const { proto, wireListener } = makeDeps();

    proto.open.call(makeXhr().xhr, "POST", GRID_URL);

    expect(wireListener).not.toHaveBeenCalled();
  });
});

// ── P4: setRequestHeader() ────────────────────────────

describe("setRequestHeader() patch", () => {
  it("records the header and forwards it to the original", () => {
    const { proto, headerCalls } = makeDeps();
    const { xhr } = makeXhr({ __headers: {} });

    proto.setRequestHeader.call(xhr, "Authorization", "Bearer x");

    expect(xhr.__headers).toEqual({ Authorization: "Bearer x" });
    expect(headerCalls).toEqual([{ thisArg: xhr, args: ["Authorization", "Bearer x"] }]);
  });

  it("forwards without recording when open() was never called", () => {
    const { proto, headerCalls } = makeDeps();

    expect(() => proto.setRequestHeader.call(makeXhr().xhr, "Authorization", "Bearer x")).not.toThrow();
    expect(headerCalls).toHaveLength(1);
  });
});

// ── P3: send(), native download branch ────────────────

describe("send() — native download", () => {
  it("arms the session and stashes the body, forwarding the original body untouched", () => {
    const ctx = makeDeps();
    const body = JSON.stringify({ TaxInvoiceNumber: "010.000-26.00000001" });
    const { xhr } = makeXhr({ __url: DOWNLOAD_URL, __headers: { Authorization: "Bearer x" } });

    ctx.proto.send.call(xhr, body);

    expect(ctx.beginProcessing).toHaveBeenCalledTimes(1);
    expect(xhr.__downloadArmed).toBe(true);
    expect(xhr.__downloadBody).toBe(body);
    expect(ctx.sendCalls).toEqual([{ thisArg: xhr, args: [body] }]);
  });

  it("does not inject filters or capture on the download path", () => {
    const ctx = makeDeps({ filterState: { Reference: { value: "R-1", matchMode: "contains" } } });
    const { xhr, listenerTypes } = makeXhr({ __url: DOWNLOAD_URL });

    ctx.proto.send.call(xhr, "{}");

    expect(ctx.getFilterState).not.toHaveBeenCalled();
    expect(ctx.getPageSource).not.toHaveBeenCalled();
    expect(listenerTypes()).toEqual([]);
  });

  it("leaves a non-string body alone (no arming, no capture)", () => {
    const ctx = makeDeps();
    const formData = { looksLike: "FormData" };
    const { xhr } = makeXhr({ __url: DOWNLOAD_URL });

    ctx.proto.send.call(xhr, formData);

    expect(ctx.beginProcessing).not.toHaveBeenCalled();
    expect(xhr.__downloadArmed).toBeUndefined();
    expect(ctx.sendCalls).toEqual([{ thisArg: xhr, args: [formData] }]);
  });

  it("never treats the extension's own bulk XHR as a native download", () => {
    const ctx = makeDeps({ inferred: "OUTPUT_TAX" });
    const body = JSON.stringify({ TaxInvoiceNumber: "x" });
    const { xhr } = makeXhr({ __url: DOWNLOAD_URL, __isCindiehBulk: true });

    ctx.proto.send.call(xhr, body);

    expect(ctx.beginProcessing).not.toHaveBeenCalled();
    expect(xhr.__downloadArmed).toBeUndefined();
  });

  it("ignores other endpoints", () => {
    const ctx = makeDeps();
    const { xhr } = makeXhr({ __url: GRID_URL });

    ctx.proto.send.call(xhr, "{}");

    expect(ctx.beginProcessing).not.toHaveBeenCalled();
  });
});

// ── P3: send(), filter injection ──────────────────────

describe("send() — filter injection", () => {
  it("injects the active filters into a request recognised by its URL", () => {
    const ctx = makeDeps({
      filterState: { Reference: { value: "SZ-0447/07/26", matchMode: "contains" } },
      inferred: "OUTPUT_TAX",
    });
    const { xhr } = makeXhr({ __url: GRID_URL, __headers: {} });

    ctx.proto.send.call(xhr, JSON.stringify({ First: 0, Rows: 10 }));

    // No `Filters` key in this body, so the extension writes the lowercase one.
    const sent = JSON.parse(String(ctx.sendCalls[0].args[0])) as { filters: Record<string, unknown>[] };
    expect(sent.filters).toHaveLength(1);
    expect(sent.filters[0]).toMatchObject({ PropertyName: "Reference", Value: "SZ-0447/07/26" });
    expect(ctx.inferSource).toHaveBeenCalledWith(GRID_URL);
  });

  it("injects into a paginated grid body even when the URL is not recognised", () => {
    const ctx = makeDeps({
      filterState: { TaxInvoiceNumber: { value: "010.000-26.00000001", matchMode: "equals" } },
      pageSource: "OUTPUT_TAX",
    });
    const { xhr } = makeXhr({ __url: "https://coretaxdjp.pajak.go.id/api/unknown" });

    ctx.proto.send.call(xhr, JSON.stringify({ First: 0, Rows: 10 }));

    const sent = JSON.parse(String(ctx.sendCalls[0].args[0])) as { filters: unknown[] };
    expect(sent.filters).toHaveLength(1);
  });

  it("passes an unrelated body through untouched", () => {
    const ctx = makeDeps({ filterState: { Reference: { value: "R-1", matchMode: "contains" } } });
    const body = JSON.stringify({ SomeOther: "payload" });
    const { xhr } = makeXhr({ __url: "https://coretaxdjp.pajak.go.id/api/unknown" });

    ctx.proto.send.call(xhr, body);

    expect(ctx.sendCalls[0].args[0]).toBe(body);
    expect(ctx.getFilterState).not.toHaveBeenCalled();
  });

  it("reports an injection failure and forwards the original body", () => {
    const ctx = makeDeps({ inferred: "OUTPUT_TAX" });
    const { xhr } = makeXhr({ __url: GRID_URL });

    ctx.proto.send.call(xhr, "not-json");

    expect(ctx.errors).toHaveLength(1);
    expect(ctx.errors[0].message).toBe("Cindieh [Scraper]: Filter injection failed");
    expect(ctx.sendCalls[0].args[0]).toBe("not-json");
  });

  it("does not try to inject into a non-string body", () => {
    const ctx = makeDeps({ inferred: "OUTPUT_TAX" });
    const blob = { kind: "Blob" };
    const { xhr } = makeXhr({ __url: GRID_URL });

    ctx.proto.send.call(xhr, blob);

    expect(ctx.sendCalls[0].args[0]).toBe(blob);
    expect(ctx.errors).toEqual([]);
  });
});

// ── P3: send(), grid capture ──────────────────────────

describe("send() — grid capture", () => {
  const ROWS = [
    { TaxInvoiceNumber: "010.000-26.00000001", LetterNumber: "SZ-0447/07/26" },
    { TaxInvoiceNumber: "010.000-26.00000002", LetterNumber: "010.000-26.00000002" },
  ];

  function capturedRequest(ctx: ReturnType<typeof makeDeps>): CapturedRequest {
    const request = ctx.captured[0];
    expect(request).toBeDefined();
    return request;
  }

  it("wires one load listener and reports the captured request", () => {
    const ctx = makeDeps({ inferred: "OUTPUT_TAX" });
    const { xhr, listenerTypes, setResponse, fireLoad } = makeXhr({
      __url: GRID_URL,
      __headers: { Authorization: "Bearer x" },
    });

    ctx.proto.send.call(xhr, JSON.stringify({ First: 0, Rows: 10 }));
    expect(listenerTypes()).toEqual(["load"]);

    setResponse({ Payload: { Data: ROWS } });
    fireLoad();

    const request = capturedRequest(ctx);
    expect(request.url).toBe(GRID_URL);
    expect(request.headers).toEqual({ Authorization: "Bearer x" });
    expect(request.body).toBeNull();
    expect(request.initialData).toEqual(ROWS);
    expect(request.initialFirst).toBe(0);
    expect(request.source).toBe("OUTPUT_TAX");
  });

  it("reports the injected body as rawBody, so a replay keeps the filters", () => {
    const ctx = makeDeps({
      filterState: { Reference: { value: "R-1", matchMode: "contains" } },
      inferred: "OUTPUT_TAX",
    });
    const { xhr, setResponse, fireLoad } = makeXhr({ __url: GRID_URL });

    ctx.proto.send.call(xhr, JSON.stringify({ First: 0, Rows: 10 }));
    const sentBody = String(ctx.sendCalls[0].args[0]);
    setResponse({ Payload: { Data: ROWS } });
    fireLoad();

    expect(capturedRequest(ctx).rawBody).toBe(sentBody);
    expect(capturedRequest(ctx).rawBody).toContain("Reference");
  });

  it("rebuilds the invoice row index from the captured rows", () => {
    const ctx = makeDeps({ inferred: "OUTPUT_TAX" });
    const { xhr, setResponse, fireLoad } = makeXhr({ __url: GRID_URL });

    ctx.proto.send.call(xhr, JSON.stringify({ First: 0, Rows: 10 }));
    setResponse({ Payload: { Data: ROWS } });
    fireLoad();

    expect(ctx.rowMap.has("stale")).toBe(false);
    expect([...ctx.rowMap.keys()].sort()).toEqual(["010.000-26.00000001", "010.000-26.00000002", "sz-0447/07/26"]);
    expect(ctx.rowMap.get("sz-0447/07/26")).toEqual(ROWS[0]);
  });

  it("falls back to the page source when the URL is not recognised", () => {
    const ctx = makeDeps({ pageSource: "SPT_A2" });
    const { xhr, setResponse, fireLoad } = makeXhr({ __url: "https://coretaxdjp.pajak.go.id/api/unknown" });

    ctx.proto.send.call(xhr, JSON.stringify({ First: 0, Rows: 10 }));
    setResponse({ Payload: { Data: ROWS } });
    fireLoad();

    expect(capturedRequest(ctx).source).toBe("SPT_A2");
  });

  it("ignores a response without a Payload.Data array and keeps the row index intact", () => {
    const ctx = makeDeps({ inferred: "OUTPUT_TAX" });
    const { xhr, setResponse, fireLoad } = makeXhr({ __url: GRID_URL });

    ctx.proto.send.call(xhr, JSON.stringify({ First: 0, Rows: 10 }));
    setResponse({ IsSuccessful: false, Message: "Error" });
    fireLoad();

    expect(ctx.captured).toEqual([]);
    expect(ctx.rowMap.has("stale")).toBe(true);
  });

  it("survives a response body that is not JSON at all", () => {
    const ctx = makeDeps({ inferred: "OUTPUT_TAX" });
    const { xhr, setResponse, fireLoad } = makeXhr({ __url: GRID_URL });

    ctx.proto.send.call(xhr, JSON.stringify({ First: 0, Rows: 10 }));
    setResponse("not-json");
    fireLoad();

    expect(ctx.captured).toEqual([]);
  });

  it("captures nothing for an unrelated request", () => {
    const ctx = makeDeps();
    const { xhr, listenerTypes } = makeXhr({ __url: "https://coretaxdjp.pajak.go.id/api/unknown" });

    ctx.proto.send.call(xhr, JSON.stringify({ SomeOther: "payload" }));

    expect(listenerTypes()).toEqual([]);
  });
});

// ── lifecycle ─────────────────────────────────────────

describe("install / restore lifecycle", () => {
  it("restores all three methods to the ones present at install()", () => {
    const { proto } = makePrototype();
    const originalOpen = proto.open;
    const originalSend = proto.send;
    const originalSetRequestHeader = proto.setRequestHeader;
    const patches = createXhrPatches({
      xhrPrototype: proto,
      session: { beginProcessing: vi.fn() },
      wireNativeDownloadListener: vi.fn(),
      getFilterState: () => ({}),
      getPageSource: () => null,
      inferSource: () => null,
      invoiceRowMap: new Map(),
      onCaptured: vi.fn(),
      logError: vi.fn(),
    });

    patches.install();
    expect(proto.open).not.toBe(originalOpen);
    expect(proto.send).not.toBe(originalSend);
    expect(proto.setRequestHeader).not.toBe(originalSetRequestHeader);

    patches.restore();
    expect(proto.open).toBe(originalOpen);
    expect(proto.send).toBe(originalSend);
    expect(proto.setRequestHeader).toBe(originalSetRequestHeader);
  });

  it("is idempotent: a second install() cannot stack a wrapper", () => {
    const ctx = makeDeps();
    const afterFirst = { open: ctx.proto.open, send: ctx.proto.send };

    ctx.patches.install();

    expect(ctx.proto.open).toBe(afterFirst.open);
    expect(ctx.proto.send).toBe(afterFirst.send);
  });

  it("restore() before install() and a repeated restore() are no-ops", () => {
    const { proto } = makePrototype();
    const originalSend = proto.send;
    const patches = createXhrPatches({
      xhrPrototype: proto,
      session: { beginProcessing: vi.fn() },
      wireNativeDownloadListener: vi.fn(),
      getFilterState: () => ({}),
      getPageSource: () => null,
      inferSource: () => null,
      invoiceRowMap: new Map(),
      onCaptured: vi.fn(),
      logError: vi.fn(),
    });

    patches.restore();
    expect(proto.send).toBe(originalSend);

    patches.install();
    patches.restore();
    patches.restore();
    expect(proto.send).toBe(originalSend);
  });

  it("stops recording and capturing after restore()", () => {
    const ctx = makeDeps({ inferred: "OUTPUT_TAX" });
    const { xhr, listenerTypes, setResponse, fireLoad } = makeXhr({ __url: GRID_URL });

    ctx.patches.restore();
    ctx.proto.send.call(xhr, JSON.stringify({ First: 0, Rows: 10 }));
    setResponse({ Payload: { Data: [{ TaxInvoiceNumber: "x" }] } });
    fireLoad();

    expect(ctx.sendCalls).toHaveLength(1);
    expect(listenerTypes()).toEqual([]);
    expect(ctx.captured).toEqual([]);
  });

  it("can be installed again after a restore", () => {
    const ctx = makeDeps({ inferred: "OUTPUT_TAX" });
    const { xhr, listenerTypes, setResponse, fireLoad } = makeXhr({ __url: GRID_URL });

    ctx.patches.restore();
    ctx.patches.install();
    ctx.proto.send.call(xhr, JSON.stringify({ First: 0, Rows: 10 }));
    setResponse({ Payload: { Data: [{ TaxInvoiceNumber: "010.000-26.00000001" }] } });
    fireLoad();

    expect(listenerTypes()).toEqual(["load"]);
    expect(ctx.captured).toHaveLength(1);
  });
});
