// ============================================================
// SCRAPER-XHR.TS — XHR request functions for scraper
// ============================================================
// Extracted from scraper.ts for testability.
// Depends on XMLHttpRequest (browser global).
// ============================================================

import type { CapturedRequest } from "./scraper-types";

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
): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
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

    const body = { ...JSON.parse(captured.rawBody), ...bodyOverrides };
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
): Promise<Record<string, unknown>[]> {
  return makeXhrRequest(captured, { First: first, Rows: rows }, timeout);
}

/**
 * Make a targeted API request filtered by a single invoice number.
 */
export function xhrRequestByInvoice(
  captured: CapturedRequest,
  invoiceNumber: string,
  timeout: number,
): Promise<Record<string, unknown>[]> {
  const fk = "Filters" in JSON.parse(captured.rawBody) ? "Filters" : "filters";
  return makeXhrRequest(
    captured,
    {
      First: 0,
      Rows: 1,
      [fk]: [
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
  );
}
