// ============================================================
// SCRAPER-PDF.TS — PDF download module (MAIN world)
// ============================================================
// All DOWNLOAD_PDF_ITEM emission for the four sites — fetch
// interceptor, XHR interceptor, bulk e-faktur, bulk withholding —
// concentrates here. Exposes a pure core (unwrap, row resolution,
// message build) plus a per-page session that owns the native
// download processing flag.
//
// The item-sourcing rule is deliberate: the interceptor session
// resolves invoice metadata from the grid capture (invoiceRowMap);
// the bulk paths pass their already-known row through
// `emitPdfDownload`. Never re-resolve bulk rows.
// ============================================================

import type { ExportSource } from "./page-context";
import { debugError } from "./debug";

export interface PdfDownloadMessage {
  type: "DOWNLOAD_PDF_ITEM";
  base64: string;
  item: Record<string, unknown>;
  source: ExportSource;
  direction: "FROM_PAGE";
  token: string;
}

/** Result of handling a native download response through the session. */
export interface PdfNativeResponseResult {
  /** True when a valid PDF was emitted and the native download should be blocked. */
  intercepted: boolean;
}

/** The two response accessors the native download consumer may read. */
export interface SabotagedAccessors {
  responseText: string;
  response: string;
}

/**
 * The dummy JSON handed to the native consumer when we intercept its
 * download response. MUST be a FAILURE payload (IsSuccessful false):
 * the portal runs its save routine on every successful response, so a
 * success-with-empty-Content dummy made it write a 0-byte Coretax-named
 * PDF. With IsSuccessful false the portal takes the error branch and
 * saves nothing.
 */
export function buildSabotagedResponseJson(): string {
  return JSON.stringify({ IsSuccessful: false, Content: "" });
}

/**
 * Sabotage BOTH response accessors of a completed native-download XHR so
 * no matter which one the portal's code reads, it sees the dummy payload.
 * defineProperty can fail if a property is non-configurable — caught and
 * ignored so the interception itself is never broken by sabotage.
 */
export function sabotageResponseAccessors(
  xhr: XMLHttpRequest,
  dummy: string = buildSabotagedResponseJson(),
): SabotagedAccessors {
  try {
    Object.defineProperty(xhr, "responseText", {
      get: () => dummy,
      configurable: true,
    });
    Object.defineProperty(xhr, "response", {
      get: () => dummy,
      configurable: true,
    });
  } catch {
    // Sabotage is best-effort; emission already happened.
  }
  return { responseText: dummy, response: dummy };
}

/** Per-XHR state stashed on native-download XHRs by prepareNativeDownloadXhr. */
export interface NativeXhrDownloadState {
  /** True once send() confirmed this XHR is a native (non-bulk) download. */
  __downloadArmed?: boolean;
  /** The raw request body, stashed at send() for row resolution at load. */
  __downloadBody?: string;
}

/**
 * Arm a native-download XHR at send() time: record that this request is a
 * native (non-bulk, string-body) invoice download and stash the request body
 * for row resolution at response time. Returns true when armed.
 *
 * scraper-xhr-patches.ts calls this from its send() patch after its gating checks;
 * keeping the state mutation here makes the arm/wire contract testable —
 * the open()-time listener stays inert until this flag is set.
 */
export function prepareNativeDownloadXhr(
  xhr: NativeXhrDownloadState,
  body: unknown,
): boolean {
  if (typeof body !== "string") return false;
  xhr.__downloadArmed = true;
  xhr.__downloadBody = body;
  return true;
}

/**
 * Pure core of the native-download XHR load handling. Runs the session's
 * unwrap/resolve/emit when the XHR was armed at send(), and returns the
 * dummy JSON the portal must see afterwards — or null for pass-through
 * (not armed, unparseable response, or no PDF payload found).
 *
 * Exactly one response is handled per arm: the arm state is cleared before
 * handling, so a duplicate readyState-4 fire — or an XHR the portal reuses for
 * a later request — can never re-handle the same download with a stale request
 * body. send() re-arms for the next request via prepareNativeDownloadXhr.
 */
export function handleNativeDownloadXhrLoad(
  state: NativeXhrDownloadState,
  responseText: string,
  session: Pick<PdfDownloadSession, "handleNativeResponse" | "clearProcessing">,
): string | null {
  if (!state.__downloadArmed) return null;
  const requestBody = state.__downloadBody ?? "";
  state.__downloadArmed = false;
  state.__downloadBody = undefined;
  try {
    const res = JSON.parse(responseText) as Record<string, unknown>;
    const { intercepted } = session.handleNativeResponse(res, requestBody);
    return intercepted ? buildSabotagedResponseJson() : null;
  } catch (err) {
    debugError("[Cindieh] XHR download interceptor error:", err);
    session.clearProcessing();
    return null;
  }
}

/**
 * Wire the interceptor listener onto a native-download XHR.
 *
 * MUST be called from open() — BEFORE the portal registers its own response
 * reader — so listener registration order puts our sabotage first. The
 * listener acts on readystatechange at readyState 4 (the completed state),
 * which fires BEFORE the load event: whichever event type the portal's reader
 * uses (readystatechange or load), our sabotage has already run when it reads
 * the response, so it sees the dummy payload instead of the real PDF.
 *
 * The listener is inert until send() arms the XHR via
 * prepareNativeDownloadXhr (native download, string body, non-bulk).
 * The previous wiring registered inside send() — after the portal's own
 * listener — so the portal read the real base64 first and downloaded its own
 * Coretax-named PDF alongside ours (duplicate download).
 */
export function wireNativeDownloadXhrListener(
  xhr: { addEventListener(type: string, listener: (evt?: unknown) => void): void },
  session: Pick<PdfDownloadSession, "handleNativeResponse" | "clearProcessing">,
): void {
  xhr.addEventListener("readystatechange", function (this: XMLHttpRequest & NativeXhrDownloadState) {
    if (this.readyState !== 4) return;
    let dummy: string | null = null;
    try {
      // Accessing responseText throws when responseType is not text — let
      // that fail safe: no PDF we could name, so the native flow proceeds.
      dummy = handleNativeDownloadXhrLoad(this, this.responseText, session);
    } catch (err) {
      debugError("[Cindieh] XHR download interceptor error:", err);
      session.clearProcessing();
      return;
    }
    if (dummy !== null) sabotageResponseAccessors(this, dummy);
  });
}

export interface PdfDownloadSessionDeps {
  /** Bridge token; attached to every emitted message. */
  token: string;
  /** Grid-capture row map used to resolve invoice metadata for filenames. */
  getRowMap: () => Map<string, Record<string, unknown>>;
  /** Current page export source; null falls back to OUTPUT_TAX. */
  getSource: () => ExportSource | null;
  /** Emits a DOWNLOAD_PDF_ITEM message (postMessage into the page). */
  emit: (msg: PdfDownloadMessage) => void;
  /**
   * Schedule the processing-flag auto-reset timer. Defaults to the global
   * setTimeout in production; inject a stub in tests (no fake timers needed).
   */
  setTimeout?: (fn: () => void, ms: number) => unknown;
  /** Cancel a timer scheduled by this session's setTimeout. */
  clearTimeout?: (handle: unknown) => void;
}

export interface PdfDownloadSession {
  /** Called when a native download request is detected; arms the processing flag. */
  beginProcessing(): void;
  /**
   * Unwrap + resolve + emit a native download response.
   * On interception the processing flag is intentionally left armed so the
   * 5s timeout keeps the native download blocked; on pass-through it clears.
   */
  handleNativeResponse(response: unknown, requestBody: string): PdfNativeResponseResult;
  clearProcessing(): void;
  isProcessing(): boolean;
}

const PROCESSING_RESET_TIMEOUT_MS = 5000;

// ── Pure core ─────────────────────────────────────────

/**
 * Extract the base64 PDF string from a Coretax download response.
 * Absorbs the four shapes seen across native and bulk paths:
 * `Content → Payload.Content → Payload.Message.Data → Payload.Data → Data`.
 * Returns null when no string payload is found.
 */
export function unwrapPdfData(response: unknown): string | null {
  if (response == null || typeof response !== "object") return null;
  const res = response as Record<string, unknown>;
  const candidates: unknown[] = [res.Content];

  const payload = res.Payload;
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    candidates.push(p.Content);
    const message = p.Message;
    if (message && typeof message === "object") {
      candidates.push((message as Record<string, unknown>).Data);
    }
    candidates.push(p.Data);
  }
  candidates.push(res.Data);

  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c;
  }
  return null;
}

/** True when a response is a successful Coretax payload (IsSuccessful true). */
export function isSuccessfulPdfResponse(response: unknown): boolean {
  if (response == null || typeof response !== "object") return false;
  return (response as Record<string, unknown>).IsSuccessful === true;
}

/**
 * Resolve the full grid row for a native download request body.
 * The DownloadInvoice endpoint only returns the PDF binary, so the invoice
 * identifier (TaxInvoiceNumber / LetterNumber) is extracted from the request
 * body and looked up in the row map built from the grid capture.
 * Falls back to `{}` when resolution is impossible.
 */
export function resolveInvoiceRow(
  requestBody: string,
  rowMap: Map<string, Record<string, unknown>>,
): Record<string, unknown> {
  if (!requestBody) return {};
  try {
    const parsed = JSON.parse(requestBody) as Record<string, unknown>;
    const lookupKey = String(
      parsed.TaxInvoiceNumber ||
        parsed.taxInvoiceNumber ||
        parsed.LetterNumber ||
        parsed.letterNumber ||
        "",
    )
      .trim()
      .toLowerCase();
    if (lookupKey && rowMap.has(lookupKey)) return rowMap.get(lookupKey)!;
  } catch {
    // Best-effort: fall back to empty item if resolution fails.
  }
  return {};
}

/** Build the DOWNLOAD_PDF_ITEM message with direction and token attached. */
export function buildPdfDownloadMessage(params: {
  base64: string;
  item: Record<string, unknown>;
  source: ExportSource;
  token: string;
}): PdfDownloadMessage {
  return {
    type: "DOWNLOAD_PDF_ITEM",
    base64: params.base64,
    item: params.item,
    source: params.source,
    direction: "FROM_PAGE",
    token: params.token,
  };
}

// ── Interception session ──────────────────────────────
// Owns the native download processing flag: armed on detection,
// cleared on pass-through/error, auto-reset by a 5s timeout so a
// success path leaves it blocking the native download until handled.

export function createPdfDownloadSession(deps: PdfDownloadSessionDeps): PdfDownloadSession {
  const schedule = deps.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const cancel =
    deps.clearTimeout ??
    ((handle: unknown) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]));
  let processing = false;
  let resetTimer: unknown = null;

  function beginProcessing(): void {
    processing = true;
    if (resetTimer !== null) cancel(resetTimer);
    resetTimer = schedule(() => {
      if (processing) processing = false;
      resetTimer = null;
    }, PROCESSING_RESET_TIMEOUT_MS);
  }

  function clearProcessing(): void {
    processing = false;
    if (resetTimer !== null) {
      cancel(resetTimer);
      resetTimer = null;
    }
  }

  function handleNativeResponse(
    response: unknown,
    requestBody: string,
  ): PdfNativeResponseResult {
    const pdfData = unwrapPdfData(response);
    if (!pdfData || pdfData.length <= 100) {
      clearProcessing();
      return { intercepted: false };
    }

    const source = deps.getSource() ?? "OUTPUT_TAX";
    const item = resolveInvoiceRow(requestBody, deps.getRowMap());
    deps.emit(buildPdfDownloadMessage({ base64: pdfData, item, source, token: deps.token }));
    // NOTE: intentionally do NOT clear the processing flag here — the 5s
    // timeout keeps the native download blocked until we've handled the PDF.
    return { intercepted: true };
  }

  return {
    beginProcessing,
    handleNativeResponse,
    clearProcessing,
    isProcessing: () => processing,
  };
}
