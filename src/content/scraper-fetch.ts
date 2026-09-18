// ============================================================
// SCRAPER-FETCH.TS — fetch interceptor for native PDF downloads
// ============================================================
// Extracted from the scraper.ts IIFE (MAIN world) so the fetch path can be
// unit-tested without a live browser, mirroring the scraper-pdf.ts split.
// scraper.ts keeps only the adapter: window.fetch = createFetchDownloadInterceptor(...).
//
// Contract: the request is issued exactly ONCE. A failure while parsing or
// emitting must never replay the request — a replay would hit the download
// endpoint twice and hand the portal an un-sabotaged second response.
// ============================================================

import { debugError, debugWarn } from "./debug";
import type { PdfDownloadSession } from "./scraper-pdf";

/** URL fragment identifying Coretax's invoice-download endpoint. */
export const DOWNLOAD_ENDPOINT = "DownloadInvoice/download-invoice-document";

/** Bulk-download marker, mirrored on RequestInit and on Request objects. */
interface BulkFlagged {
  __isCindiehBulk?: boolean;
}

/**
 * True when the fetch call is one the extension created itself for bulk
 * download — flagged with __isCindiehBulk on the RequestInit or the Request
 * object, mirroring InterceptedXHR on the XHR path.
 */
export function isBulkFetchRequest(...args: unknown[]): boolean {
  const init = args[1] as (RequestInit & BulkFlagged) | undefined;
  if (init?.__isCindiehBulk) return true;
  const input = args[0];
  if (input && typeof input === "object") {
    return (input as BulkFlagged).__isCindiehBulk === true;
  }
  return false;
}

export interface FetchDownloadInterceptorDeps {
  /** The pre-patch fetch; every pass-through route delegates to it. */
  originalFetch: typeof fetch;
  /** Arms the processing flag and unwraps/emits the intercepted PDF. */
  session: Pick<PdfDownloadSession, "beginProcessing" | "handleNativeResponse" | "clearProcessing">;
  /** Builds the failure payload the portal must see after interception. */
  buildDummyResponse: () => string;
}

/**
 * Read the request body the session resolves invoice rows from.
 *
 * Covers both call shapes: a Request object (cloned before reading, so the
 * caller's request stays usable) and an init object/string carrying the JSON
 * body. The init-object case matters — ignoring it silently fell back to
 * `TANPA_REFERENSI` filenames whenever the portal called fetch(url, { body })
 * instead of fetch(new Request(url, { body })).
 */
async function readRequestBody(args: unknown[]): Promise<string> {
  const input = args[0];
  const init = args[1];
  if (input && typeof input === "object" && "body" in input) {
    return await (input as Request).clone().text();
  }
  const initBody = (init as RequestInit | undefined)?.body;
  if (typeof initBody === "string") return initBody;
  return typeof init === "string" ? init : "";
}

/**
 * Build the window.fetch replacement for native PDF downloads.
 *
 * SECURITY: only URLs containing DOWNLOAD_ENDPOINT are inspected; every other
 * request — and every __isCindiehBulk download — passes straight through to the
 * original fetch untouched.
 */
export function createFetchDownloadInterceptor(
  deps: FetchDownloadInterceptorDeps,
): typeof fetch {
  const { originalFetch, session, buildDummyResponse } = deps;

  const interceptedFetch = async (...args: unknown[]): Promise<Response> => {
    const url = typeof args[0] === "string" ? args[0] : (args[0] as Request)?.url;
    if (!url?.includes(DOWNLOAD_ENDPOINT) || isBulkFetchRequest(...args)) {
      return originalFetch(...(args as Parameters<typeof fetch>));
    }

    session.beginProcessing();

    let resp: Response;
    try {
      resp = await originalFetch(...(args as Parameters<typeof fetch>));
    } catch (err) {
      // The request itself failed (network/abort): there is nothing to unwrap,
      // and the portal must see the same rejection it would have seen without
      // the extension. Never replay the request.
      session.clearProcessing();
      debugError("[Cindieh] Fetch interceptor error:", err);
      throw err;
    }

    try {
      const json = await resp.clone().json();
      const reqBody = await readRequestBody(args);
      const { intercepted } = session.handleNativeResponse(json, reqBody);
      if (intercepted) {
        // Block the native download: Coretax sees a FAILURE response and takes
        // its error branch instead of saving a 0-byte PDF from the empty
        // Content (a success dummy made it do exactly that).
        return new Response(buildDummyResponse(), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      debugWarn(
        "[Cindieh] Fetch interceptor: PDF data not found in response.",
        "Response keys:",
        Object.keys(json),
      );
    } catch (err) {
      // The response already arrived — the failure is ours (parse or emit).
      // Hand it back untouched instead of issuing a second request: its body is
      // still unconsumed because only the clone was read.
      session.clearProcessing();
      debugError("[Cindieh] Fetch interceptor error:", err);
    }

    return resp;
  };

  return interceptedFetch as unknown as typeof fetch;
}
