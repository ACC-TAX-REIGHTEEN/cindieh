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

export interface PdfDownloadSessionDeps {
  /** Bridge token; attached to every emitted message. */
  token: string;
  /** Grid-capture row map used to resolve invoice metadata for filenames. */
  getRowMap: () => Map<string, Record<string, unknown>>;
  /** Current page export source; null falls back to OUTPUT_TAX. */
  getSource: () => ExportSource | null;
  /** Emits a DOWNLOAD_PDF_ITEM message (postMessage into the page). */
  emit: (msg: PdfDownloadMessage) => void;
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
  let processing = false;
  let resetTimer: ReturnType<typeof setTimeout> | null = null;

  function beginProcessing(): void {
    processing = true;
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      if (processing) processing = false;
      resetTimer = null;
    }, PROCESSING_RESET_TIMEOUT_MS);
  }

  function clearProcessing(): void {
    processing = false;
    if (resetTimer) {
      clearTimeout(resetTimer);
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
