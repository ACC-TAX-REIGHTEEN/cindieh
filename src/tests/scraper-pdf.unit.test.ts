// Unit tests for scraper-pdf.ts — PDF download module.
// Covers the pure core (unwrap, row resolution, message build)
// and the interception session (processing flag lifecycle, emit).
import { describe, it, expect, vi } from "vitest";
import {
  unwrapPdfData,
  isSuccessfulPdfResponse,
  resolveInvoiceRow,
  buildPdfDownloadMessage,
  createPdfDownloadSession,
  buildSabotagedResponseJson,
  sabotageResponseAccessors,
  handleNativeDownloadXhrLoad,
  prepareNativeDownloadXhr,
  wireNativeDownloadXhrListener,
  type NativeXhrDownloadState,
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
// Timer behaviour is driven through injected setTimeout/clearTimeout deps so
// tests control the reset timer deterministically — no fake timers required.

describe("createPdfDownloadSession", () => {
  const rowMap = new Map([
    ["010.000-26.00000001", { Reference: "SZ-0447/07/26", TaxInvoiceNumber: "010.000-26.00000001" }],
  ]);

  /** Injectable timer harness: records schedules, honours cancellations. */
  function makeTimerHarness() {
    const scheduled: Array<{ fn: () => void; cancelled: boolean }> = [];
    return {
      scheduled,
      setTimeout: (fn: () => void) => {
        scheduled.push({ fn, cancelled: false });
        return scheduled.length;
      },
      clearTimeout: (handle: unknown) => {
        const idx = Number(handle) - 1;
        if (scheduled[idx]) scheduled[idx].cancelled = true;
      },
      fireAll: () => {
        for (const t of scheduled) if (!t.cancelled) t.fn();
      },
    };
  }

  function makeDeps(overrides: Partial<Parameters<typeof createPdfDownloadSession>[0]> = {}) {
    const emit = vi.fn();
    return {
      token: "tok-123",
      getRowMap: () => rowMap,
      getSource: () => null,
      emit,
      setTimeout: vi.fn(() => 1),
      clearTimeout: vi.fn(),
      ...overrides,
    } as Parameters<typeof createPdfDownloadSession>[0] & { emit: ReturnType<typeof vi.fn> };
  }

  it("is not processing initially", () => {
    const session = createPdfDownloadSession(makeDeps());
    expect(session.isProcessing()).toBe(false);
  });

  it("beginProcessing arms the flag and the injected reset timer disarms it", () => {
    const timers = makeTimerHarness();
    const session = createPdfDownloadSession(
      makeDeps({ setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout }),
    );

    session.beginProcessing();
    expect(session.isProcessing()).toBe(true);
    expect(timers.scheduled).toHaveLength(1);

    timers.fireAll();
    expect(session.isProcessing()).toBe(false);
  });

  it("clearProcessing disarms the flag and cancels the pending reset timer", () => {
    const timers = makeTimerHarness();
    const session = createPdfDownloadSession(
      makeDeps({ setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout }),
    );

    session.beginProcessing();
    session.clearProcessing();

    expect(session.isProcessing()).toBe(false);
    expect(timers.scheduled[0].cancelled).toBe(true);

    timers.fireAll();
    expect(session.isProcessing()).toBe(false);
  });

  it("re-beginProcessing cancels the previous reset timer", () => {
    const timers = makeTimerHarness();
    const session = createPdfDownloadSession(
      makeDeps({ setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout }),
    );

    session.beginProcessing();
    session.beginProcessing();

    expect(timers.scheduled).toHaveLength(2);
    expect(timers.scheduled[0].cancelled).toBe(true);
    expect(timers.scheduled[1].cancelled).toBe(false);

    timers.fireAll();
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

// ── Native download XHR wiring ────────────────────────────────────────────────
// Regression coverage for the duplicate-download bug. Contract under test:
//
//   open()  → wireNativeDownloadXhrListener   (our listener registers FIRST,
//            before the portal registers its own response reader)
//   send()  → prepareNativeDownloadXhr        (arms the inert listener and
//            stashes the request body for row resolution)
//   done    → listener runs at readyState 4 — BEFORE the portal's load
//            reader — emits DOWNLOAD_PDF_ITEM and rewrites BOTH response
//            accessors, so the portal reads the dummy payload and never
//            starts its own Coretax-named download.
//
// The dummy MUST be a FAILURE payload (IsSuccessful false): the portal runs
// its save routine on every successful response, so an earlier success-
// with-empty-Content dummy made it save a 0-byte Coretax-named PDF.
//
// The listener acts on readystatechange(4), which fires before `load`, so the
// sabotage precedes the portal's reader regardless of which event it uses.
// The previous (buggy) wiring registered inside send() — after the portal's
// listener — so the portal read the real PDF base64 first and downloaded its
// own Coretax-named file alongside the extension's renamed one. A missing
// arm call (the __downloadArmed flag never set) has the opposite failure:
// the extension's PDF disappears and only the native file downloads.
//
// Deeper seam does not exist: the XHR prototype patches live in scraper.ts's
// IIFE with heavy window/DOM/document dependencies (no jsdom in this repo),
// so the extracted wiring is the closest testable seam to the real path.

describe("native download XHR wiring", () => {
  const PDF_BASE64 = "B".repeat(150);
  const REAL_RESPONSE = JSON.stringify({ IsSuccessful: true, Content: PDF_BASE64 });
  const DUMMY_RESPONSE = buildSabotagedResponseJson();
  const ROW = { Reference: "SZ-0447/07/26", TaxInvoiceNumber: "010.000-26.00000001" };
  const rowMap = new Map([["010.000-26.00000001", ROW]]);

  /** Minimal XHR stub: listeners in registration order, per-instance state. */
  function makeXhr() {
    const listeners: Record<string, Array<(this: unknown) => void>> = {};
    const xhr: NativeXhrDownloadState & {
      readyState: number;
      responseText: string;
      response: string;
      addEventListener(type: string, fn: (evt?: unknown) => void): void;
      fire(type: string): void;
    } = {
      readyState: 4,
      responseText: "",
      response: "",
      addEventListener(type: string, fn: (evt?: unknown) => void) {
        (listeners[type] ??= []).push(fn);
      },
      fire(type: string) {
        for (const fn of listeners[type] ?? []) fn.call(xhr);
      },
    };
    return { xhr, listeners };
  }

  /** Session wired like scraper.ts: emit is captured, guard not involved here. */
  function makeSession() {
    const deps = {
      token: "tok-123",
      getRowMap: () => rowMap,
      getSource: () => "OUTPUT_TAX" as const,
      emit: vi.fn(),
      setTimeout: vi.fn(() => 1),
      clearTimeout: vi.fn(),
    };
    return {
      session: createPdfDownloadSession(deps),
      emit: deps.emit,
    };
  }

  /** The real scraper.ts sequence: wire at open(), arm at send(). */
  function wireAndArm(
    xhr: ReturnType<typeof makeXhr>["xhr"],
    session: ReturnType<typeof makeSession>["session"],
    body: string,
  ) {
    wireNativeDownloadXhrListener(xhr, session); // open()
    session.beginProcessing(); // send()
    expect(prepareNativeDownloadXhr(xhr, body)).toBe(true); // send()
  }

  it("portal's own reader sees the dummy payload, not the PDF", () => {
    const { session, emit } = makeSession();
    const { xhr } = makeXhr();
    wireAndArm(xhr, session, JSON.stringify({ TaxInvoiceNumber: "010.000-26.00000001" }));

    // The portal's consumer registers AFTER our open()-time wiring (as the
    // real portal does after open()): it saves the PDF whenever the response
    // reads as successful — even an empty Content produced a 0-byte file.
    let nativeSaved: string | null = null;
    const portalReader = function (this: typeof xhr) {
      const res = JSON.parse(this.responseText) as { IsSuccessful?: boolean; Content?: string };
      if (res.IsSuccessful) nativeSaved = res.Content ?? null;
    };
    xhr.addEventListener("readystatechange", portalReader); // reader on rs(4)
    xhr.addEventListener("load", portalReader); // reader on load

    xhr.responseText = REAL_RESPONSE;
    xhr.fire("readystatechange");
    xhr.fire("load");

    expect(nativeSaved).toBeNull(); // portal save branch never runs, either event
    expect(xhr.responseText).toBe(DUMMY_RESPONSE);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("dummy payload is a failure so the portal's success branch never runs", () => {
    // Regression guard for the 0-byte Coretax-named PDF: a success-shaped
    // dummy (IsSuccessful true) made the portal save the empty Content.
    const dummy = JSON.parse(buildSabotagedResponseJson()) as { IsSuccessful: boolean };
    expect(dummy.IsSuccessful).toBe(false);
  });

  it("sabotages BOTH responseText and response accessors", () => {
    const { session } = makeSession();
    const { xhr } = makeXhr();
    wireAndArm(xhr, session, JSON.stringify({ TaxInvoiceNumber: "010.000-26.00000001" }));

    xhr.responseText = REAL_RESPONSE;
    xhr.fire("readystatechange");

    expect(xhr.responseText).toBe(DUMMY_RESPONSE);
    expect(xhr.response).toBe(DUMMY_RESPONSE);
  });

  it("resolves the invoice row from the stashed request body", () => {
    const { session, emit } = makeSession();
    const { xhr } = makeXhr();
    wireAndArm(xhr, session, JSON.stringify({ TaxInvoiceNumber: "010.000-26.00000001" }));

    xhr.responseText = REAL_RESPONSE;
    xhr.fire("readystatechange");

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0].item).toEqual(ROW);
  });

  // ── One response per arm: a reused or re-fired XHR handles one download ──
  // The arm state used to survive handling. Two consequences are guarded here:
  // a reused XHR whose later (non-download) response carried a long string
  // could emit a bogus DOWNLOAD_PDF_ITEM with a stale request body, and a
  // duplicate readyState-4 fire would hand the dummy back through
  // handleNativeResponse, clearing the processing flag early and disarming the
  // backup nets for the rest of their window. send() re-arms for each request.

  it("handles a duplicate readyState-4 fire only once", () => {
    const { session, emit } = makeSession();
    const { xhr } = makeXhr();
    wireAndArm(xhr, session, JSON.stringify({ TaxInvoiceNumber: "010.000-26.00000001" }));

    xhr.responseText = REAL_RESPONSE;
    xhr.fire("readystatechange");
    xhr.fire("readystatechange"); // duplicate completion event

    expect(emit).toHaveBeenCalledTimes(1);
    expect(xhr.responseText).toBe(DUMMY_RESPONSE);
    // The duplicate fire must not be treated as a pass-through response.
    expect(session.isProcessing()).toBe(true);
  });

  it("disarms after handling so a reused XHR stays inert until send() re-arms it", () => {
    const { session, emit } = makeSession();
    const { xhr } = makeXhr();
    const body = JSON.stringify({ TaxInvoiceNumber: "010.000-26.00000001" });
    wireAndArm(xhr, session, body);

    xhr.responseText = REAL_RESPONSE;
    xhr.fire("readystatechange");

    expect(emit).toHaveBeenCalledTimes(1);
    expect(xhr.__downloadArmed).toBe(false);
    expect(xhr.__downloadBody).toBeUndefined();

    // The portal reuses the same XHR for a later request that send() does not
    // arm (non-download URL): the stale arm state must not re-handle anything.
    expect(handleNativeDownloadXhrLoad(xhr, REAL_RESPONSE, session)).toBeNull();
    expect(emit).toHaveBeenCalledTimes(1);

    // The next download re-arms through send() and is handled normally.
    expect(prepareNativeDownloadXhr(xhr, body)).toBe(true);
    expect(handleNativeDownloadXhrLoad(xhr, REAL_RESPONSE, session)).not.toBeNull();
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[1][0].item).toEqual(ROW);
  });

  it("disarms even when the response is unparseable", () => {
    const state: NativeXhrDownloadState = { __downloadArmed: true, __downloadBody: "{}" };
    const { session } = makeSession();

    expect(handleNativeDownloadXhrLoad(state, "not-json", session)).toBeNull();
    expect(state.__downloadArmed).toBe(false);
    expect(state.__downloadBody).toBeUndefined();
  });

  it("is inert when send() never armed the XHR (bulk-flagged pass-through)", () => {
    const { session, emit } = makeSession();
    const { xhr } = makeXhr();
    // open() wires the listener for every download-invoice XHR, but send()
    // only arms native ones. A bulk XHR (__isCindiehBulk) is never armed.
    wireNativeDownloadXhrListener(xhr, session);

    xhr.responseText = REAL_RESPONSE;
    xhr.fire("readystatechange");
    xhr.fire("load");

    expect(emit).not.toHaveBeenCalled();
    expect(xhr.responseText).toBe(REAL_RESPONSE);
  });

  it("refuses to arm when the body is not a string (mirrors the send() gate)", () => {
    const xhr = {} as ReturnType<typeof makeXhr>["xhr"];
    expect(prepareNativeDownloadXhr(xhr, undefined)).toBe(false);
    expect(prepareNativeDownloadXhr(xhr, null)).toBe(false);
    expect(xhr.__downloadArmed).toBeUndefined();
    expect(xhr.__downloadBody).toBeUndefined();
  });

  it("does not sabotage when the response carries no PDF payload", () => {
    const { session, emit } = makeSession();
    const { xhr } = makeXhr();
    wireAndArm(xhr, session, JSON.stringify({ TaxInvoiceNumber: "010.000-26.00000001" }));

    const errorResponse = JSON.stringify({ IsSuccessful: false, Message: "Error" });
    xhr.responseText = errorResponse;
    xhr.fire("readystatechange");

    expect(emit).not.toHaveBeenCalled();
    expect(xhr.responseText).toBe(errorResponse);
  });

  it("handleNativeDownloadXhrLoad returns null on unparseable responses", () => {
    const { session } = makeSession();
    const dummy = handleNativeDownloadXhrLoad({ __downloadArmed: true, __downloadBody: "{}" }, "not-json", session);
    expect(dummy).toBeNull();
  });

  it("sabotageResponseAccessors redefines both accessors and survives refusal", () => {
    const target: Record<string, unknown> = { responseText: "real", response: "real" };
    const dummy = buildSabotagedResponseJson();
    const result = sabotageResponseAccessors(target as unknown as XMLHttpRequest, dummy);
    expect(result).toEqual({ responseText: dummy, response: dummy });
    expect(target.responseText).toBe(dummy);
    expect(target.response).toBe(dummy);

    // A reader-only property must not break the sabotage.
    const frozen = Object.defineProperty({}, "responseText", {
      get: () => "real",
      configurable: false,
    });
    expect(() =>
      sabotageResponseAccessors(frozen as unknown as XMLHttpRequest, dummy),
    ).not.toThrow();
  });
});
