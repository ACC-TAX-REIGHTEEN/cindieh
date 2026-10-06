// ============================================================
// SCRAPER-XHR.TS — XHR request functions for scraper
// ============================================================
// Extracted from scraper.ts for testability.
// Depends on XMLHttpRequest (browser global).
// ============================================================

import { buildEfakturDownloadUrl, buildEfakturPdfBody } from "./scraper-helpers";
import { abortError } from "./scraper-actions";
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
  return makeXhrRequestPage(captured, bodyOverrides, timeout, signal).then((p) => p.rows);
}

/**
 * One page of grid rows plus the row total the SERVER believes it has.
 *
 * The total is the point. scrapePaginated() has exactly one stop condition —
 * "this page came back shorter than the page size I asked for" — and the
 * response parser used to throw away everything except Payload.Data, so the
 * portal's own count of matching rows was never available. If the server capped
 * Rows below what we asked for, that short page looked like the end of the data
 * and the run reported "Complete" having silently collected a fraction of the
 * grid. Carrying the total lets the caller CHECK completeness instead of
 * inferring it from a shape.
 *
 * `total` is null when the response carries no recognisable count field, which
 * is the normal case for some endpoints — callers must treat null as "unknown",
 * never as "zero rows".
 */
export interface GridPage {
  rows: Record<string, unknown>[];
  /** Rows the server says match this filter, or null when it did not say. */
  total: number | null;
}

/**
 * Field names the grid endpoints have been observed to report the matching row
 * count under. Checked in order; the first numeric one wins. Kept here rather
 * than in the loop so the parser and the capture path agree on what counts.
 */
export const TOTAL_COUNT_FIELDS = [
  "Total",
  "TotalRecords",
  "TotalCount",
  "Count",
  "RecordsTotal",
  "TotalRow",
] as const;

/**
 * Pull the count out of a parsed grid payload, or null when there is none.
 *
 * `rowsRequested` is what the request asked for, and it exists to throw away one
 * specific lie. Coretax's `/einvoiceportal/api/outputinvoice/list` answers EVERY
 * page size with `Payload.TotalRecords = Rows + 1` — measured across Rows of 10,
 * 100, 500, 1000, 2000 and 5000, where the count tracked the request and not the
 * grid (a 500-row page reported 501 and a 5000-row page reported 5001, so the
 * grid holds at least 5000 rows and the "count" was never its size). Read as a
 * total, it says the grid has one row more than we asked to see, which is true
 * of every export and would have made the truncation notice fire on every
 * complete one.
 *
 * So a value of exactly `rowsRequested + 1` is discarded and the search
 * continues. Discarding it costs the caller nothing they can rely on anyway: a
 * grid that genuinely holds `Rows + 1` rows still ends when its second page
 * comes back short, and a genuinely truncated run is still caught by the
 * no-progress guard. Passing no `rowsRequested` keeps the old behaviour for any
 * caller that cannot say what it asked for.
 */
export function readGridTotal(payload: unknown, rowsRequested?: number): number | null {
  if (!payload || typeof payload !== "object") return null;
  const bag = payload as Record<string, unknown>;
  const inner = (bag.Payload ?? bag.payload) as Record<string, unknown> | undefined;
  // Prefer the inner payload's own count; fall back to the envelope.
  for (const source of [inner, bag]) {
    if (!source || typeof source !== "object") continue;
    for (const field of TOTAL_COUNT_FIELDS) {
      const value = (source as Record<string, unknown>)[field];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) continue;
      if (rowsRequested !== undefined && value === rowsRequested + 1) continue;
      return value;
    }
  }
  return null;
}

export function makeXhrRequestPage(
  captured: CapturedRequest,
  bodyOverrides: Record<string, unknown>,
  timeout: number,
  signal?: AbortSignal,
): Promise<GridPage> {
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
          resolve({
            rows: data?.Payload?.Data || [],
            // The page size is read back out of the overrides so an endpoint
            // that echoes it as its count is caught here, once.
            total: readGridTotal(
              data,
              typeof bodyOverrides.Rows === "number" ? bodyOverrides.Rows : undefined,
            ),
          });
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
 * Request a single page of paginated grid data.
 *
 * Returns the rows AND the server own count of matching rows, so the
 * pagination loop can tell a short page that ends the data apart from a
 * short page the server produced by capping its page size. The loop used
 * to have no way to make that distinction.
 */
export function xhrRequest(
  captured: CapturedRequest,
  first: number,
  rows: number,
  timeout: number,
  signal?: AbortSignal,
  extraOverrides: Record<string, unknown> = {},
): Promise<GridPage> {
  // The page's own First/Rows win over a caller's defaults: a batch passes the
  // period's Filters here, and every page of it must paginate normally.
  return makeXhrRequestPage(
    captured,
    { ...extraOverrides, First: first, Rows: rows },
    timeout,
    signal,
  );
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
          // The PDF payload shape varies per endpoint; unwrapPdfData owns the
          // list (Content, Payload.Content, Payload.Message.Data, Payload.Data, Data).
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
