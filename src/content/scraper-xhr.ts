// ============================================================
// SCRAPER-XHR.TS — XHR request functions for scraper
// ============================================================
// Extracted from scraper.ts for testability.
// Depends on XMLHttpRequest (browser global).
// ============================================================

import { buildEfakturDownloadUrl, buildEfakturPdfBody } from "./scraper-helpers";
import { unwrapPdfData, isSuccessfulPdfResponse } from "./scraper-pdf";
import type { CapturedRequest } from "./scraper-types";

/** Settle once and release the signal listener, including synchronous setup failures. */
function withXhr<T>(
  signal: AbortSignal | undefined,
  setup: (
    xhr: XMLHttpRequest,
    resolve: (value: T) => void,
    reject: (reason: unknown) => void,
  ) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const abortError = () => new DOMException("Permintaan dibatalkan.", "AbortError");
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    const xhr = new XMLHttpRequest() as XMLHttpRequest & { __isCindiehBulk?: boolean };
    xhr.__isCindiehBulk = true;
    let settled = false;
    const cleanup = () => {
      settled = true;
      signal?.removeEventListener("abort", onAbort);
    };
    const fail = (reason: unknown) => {
      if (settled) return;
      cleanup();
      reject(reason);
    };
    const onAbort = () => {
      if (settled) return;
      // Settle first: abort() can synchronously dispatch XHR events.
      fail(abortError());
      xhr.abort();
    };
    xhr.onabort = () => fail(abortError());
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      setup(xhr, (value) => {
        if (settled) return;
        cleanup();
        resolve(value);
      }, fail);
    } catch (error) {
      fail(error);
    }
  });
}

/**
 * Parse a captured request body defensively. Returns {} for empty or invalid
 * rawBody so callers fall back to defaults instead of throwing a raw
 * SyntaxError before the XHR is even created.
 */
function parseCapturedBody(captured: CapturedRequest): Record<string, unknown> {
  if (!captured.rawBody) return {};
  try {
    return JSON.parse(captured.rawBody) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Shared XHR helper: builds, sends, and parses a POST request.
 * @param captured - The captured request metadata (url, headers, rawBody)
 * @param bodyOverrides - Key-value pairs to merge into the request body
 * @param timeout - XHR timeout in milliseconds
 */
export function makeXhrRequest(
  captured: CapturedRequest,
  bodyOverrides: Record<string, unknown>,
  timeout: number,
  signal?: AbortSignal,
): Promise<Record<string, unknown>[]> {
  return withXhr(signal, (xhr, resolve, reject) => {
    xhr.open("POST", captured.url, true);
    for (const [k, v] of Object.entries(captured.headers)) {
      xhr.setRequestHeader(k, v);
    }
    xhr.timeout = timeout;
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText) as {
            Payload?: { Data?: Record<string, unknown>[] };
          };
          resolve(data?.Payload?.Data || []);
        } catch {
          reject(new Error(`Parse error di ${JSON.stringify(bodyOverrides)}`));
        }
      } else {
        reject(new Error(`HTTP ${xhr.status} di ${JSON.stringify(bodyOverrides)}`));
      }
    };
    xhr.onerror = () => reject(new Error(`Network error di ${JSON.stringify(bodyOverrides)}`));
    xhr.ontimeout = () => reject(new Error(`Timeout di ${JSON.stringify(bodyOverrides)}`));

    const body = { ...parseCapturedBody(captured), ...bodyOverrides };
    xhr.send(JSON.stringify(body));
  });
}

/**
 * Request a single page of paginated data.
 */
export function xhrRequest(
  captured: CapturedRequest,
  first: number,
  rows: number,
  timeout: number,
  signal?: AbortSignal,
): Promise<Record<string, unknown>[]> {
  return makeXhrRequest(captured, { First: first, Rows: rows }, timeout, signal);
}

/**
 * Make a targeted API request filtered by a single invoice number.
 */
export function xhrRequestByInvoice(
  captured: CapturedRequest,
  invoiceNumber: string,
  timeout: number,
  signal?: AbortSignal,
): Promise<Record<string, unknown>[]> {
  let filterKey: "Filters" | "filters" = "Filters";
  try {
    const parsed = JSON.parse(captured.rawBody) as Record<string, unknown>;
    filterKey = "Filters" in parsed ? "Filters" : "filters";
  } catch {
    // Invalid or empty rawBody — fall back to the standard "Filters" key;
    // makeXhrRequest handles the unusable body defensively as well.
  }
  return makeXhrRequest(
    captured,
    {
      First: 0,
      Rows: 10,
      [filterKey]: [
        {
          PropertyName: "TaxInvoiceNumber",
          Value: invoiceNumber,
          MatchMode: "equals",
          CaseSensitive: false,
          AsString: false,
        },
      ],
    },
    timeout,
    signal,
  );
}

/**
 * Download a withholding slip PDF from the DJP API.
 * Returns the base64-encoded PDF content.
 */
export function xhrDownloadWithholdingPdf(
  captured: CapturedRequest,
  row: Record<string, unknown>,
  timeout: number,
  signal?: AbortSignal,
): Promise<string> {
  return withXhr(signal, (xhr, resolve, reject) => {
    const url = captured.url.replace("GetMyWithholdingSlip", "DownloadWithholdingSlips/download-pdf-document");
    xhr.open("POST", url, true);

    for (const [k, v] of Object.entries(captured.headers)) {
      xhr.setRequestHeader(k, v);
    }

    xhr.timeout = timeout;

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const res = JSON.parse(xhr.responseText);
          if (isSuccessfulPdfResponse(res) && unwrapPdfData(res)) {
            resolve(unwrapPdfData(res)!);
          } else {
            reject(
              new Error(
                res.Message ||
                  res.Payload?.Message?.ErrorMessage ||
                  "Gagal mengambil konten PDF",
              ),
            );
          }
        } catch {
          reject(new Error("Parse error saat download PDF"));
        }
      } else {
        reject(new Error(`HTTP ${xhr.status} saat download PDF`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error saat download PDF"));
    xhr.ontimeout = () => reject(new Error("Timeout saat download PDF"));

    const capturedBody = parseCapturedBody(captured);
    const body = {
      WithholdingSlipsAggregateIdentifier: row.WithholdingslipsAggregateIdentifier,
      WithholdingSlipsRecordIdentifier: row.RecordId,
      DocumentAggregateIdentifier: row.DocumentFormAggregateIdentifier,
      TaxpayerAggregateIdentifier: row.TaxpayerAggregateIdentifier,
      EbupotType: capturedBody.WithholdingType || "EBUPOTBPU",
      DocumentDate: row.WithholdingSlipsDate,
      TaxIdentificationNumber: row.TaxIdentificationNumber,
    };

    xhr.send(JSON.stringify(body));
  });
}

/**
 * Download an efaktur PDF (Pajak Keluaran, Masukan, or Retur) from the DJP API.
 * Returns the base64-encoded PDF content.
 */
export function xhrDownloadEfakturPdf(
  captured: CapturedRequest,
  row: Record<string, unknown>,
  source: string,
  timeout: number,
  signal?: AbortSignal,
): Promise<string> {
  return withXhr(signal, (xhr, resolve, reject) => {
    const url = buildEfakturDownloadUrl(captured.url);
    xhr.open("POST", url, true);

    for (const [k, v] of Object.entries(captured.headers)) {
      xhr.setRequestHeader(k, v);
    }

    xhr.timeout = timeout;

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const res = JSON.parse(xhr.responseText);
          // PDF data: res.Content (top-level) or res.Payload.Message.Data
          const pdfData = unwrapPdfData(res);
          if (pdfData && typeof pdfData === "string" && pdfData.length > 100) {
            resolve(pdfData);
          } else {
            reject(
              new Error(
                res.Message || res.Payload?.Message?.ErrorMessage || "Gagal mengambil konten PDF (data kosong)",
              ),
            );
          }
        } catch {
          reject(new Error("Parse error saat download PDF"));
        }
      } else {
        reject(new Error(`HTTP ${xhr.status} saat download PDF`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error saat download PDF"));
    xhr.ontimeout = () => reject(new Error("Timeout saat download PDF"));

    const capturedBody = parseCapturedBody(captured);
    const body = buildEfakturPdfBody(row, source, capturedBody);

    xhr.send(JSON.stringify(body));
  });
}
