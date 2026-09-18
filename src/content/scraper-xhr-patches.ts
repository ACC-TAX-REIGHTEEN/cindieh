// ============================================================
// SCRAPER-XHR-PATCHES.TS — XHR prototype patches (P2/P3/P4)
// ============================================================
// Three patches, one seam:
//   P2 open()             — record url/method, reset headers, and wire the
//                           native-download response listener EARLY.
//   P3 send()             — arm native downloads, inject the user's filters,
//                           and capture grid responses for scraping.
//   P4 setRequestHeader() — record headers for the capture above.
//
// Extracted from the scraper.ts IIFE (MAIN world) so filter injection and
// grid capture finally have their own tests — the same split as
// scraper-fetch.ts, scraper-nets.ts, and scraper-pdf.ts. scraper.ts keeps only
// the adapter (deps + install/restore).
//
// Listener ordering (P2) is load-bearing and locked by test: our response
// listener is registered at open() — BEFORE the portal registers its own, which
// it does after open() and before send(). Listener order is callback order for
// the same event type, so the sabotage runs first and the portal never reads
// the real base64. Wiring it in send() instead let the portal read the PDF
// first and save its own Coretax-named file alongside ours.
// ============================================================

import type { ExportSource } from "./page-context";
import type { CapturedRequest, InterceptedXHR } from "./scraper-types";
import { DOWNLOAD_ENDPOINT } from "./scraper-fetch";
import { prepareNativeDownloadXhr, type PdfDownloadSession } from "./scraper-pdf";

/** Filter state owned by the scraper, read fresh on every send(). */
export type FilterState = Record<string, { value: unknown; matchMode: string }>;

/** Filter properties the extension injects itself; stripped before re-adding. */
export const EXTENSION_FILTER_FIELDS = ["Reference", "TaxInvoiceNumber"];

/** Mutable surface being patched — `XMLHttpRequest.prototype` in production. */
export interface XhrPrototypeTarget {
  open(this: InterceptedXHR, ...args: unknown[]): unknown;
  send(this: InterceptedXHR, body?: unknown): unknown;
  setRequestHeader(this: InterceptedXHR, ...args: unknown[]): unknown;
}

export interface XhrPatchesDeps {
  /** The prototype to patch (injected so tests need no live XHR). */
  xhrPrototype: XhrPrototypeTarget;
  /** Arms the processing flag for a native download (see scraper-pdf.ts). */
  session: Pick<PdfDownloadSession, "beginProcessing">;
  /** Registers the early response listener on a native-download XHR. */
  wireNativeDownloadListener: (xhr: InterceptedXHR) => void;
  /** Active filters, read fresh so SET_SERVER_FILTER changes take effect. */
  getFilterState: () => FilterState;
  /** Source of the page as currently rendered — capture fallback. */
  getPageSource: () => ExportSource | null;
  /** Source inferred from a request URL. */
  inferSource: (url: string) => ExportSource | null;
  /** Row map shared with the PDF download session; rebuilt on capture. */
  invoiceRowMap: Map<string, Record<string, unknown>>;
  /** Called once per captured grid response, after the row map is rebuilt. */
  onCaptured: (captured: CapturedRequest) => void;
  /** Records a filter-injection failure — `debugError` in production. */
  logError: (message: string, error: unknown) => void;
}

export interface XhrPatches {
  /** Patch all three methods. Idempotent — a second call is a no-op. */
  install(): void;
  /** Restore what the prototype held at install(). Safe when not installed. */
  restore(): void;
}

// ── Pure core ─────────────────────────────────────────

/**
 * Merge the extension's filters into a request body, in place.
 *
 * Rebuilding from scratch is what keeps it idempotent: extension-owned
 * properties are stripped before they are re-added, so a body that passes
 * through twice (or a portal body that already contains a `Reference` filter)
 * never stacks duplicate entries. A multi-value filter emits one entry per
 * value, with `LogicalOperator: "OR"` on all but the first.
 */
export function injectFilters(
  parsed: Record<string, unknown>,
  filterState: FilterState,
): Record<string, unknown> {
  const filterKey = "Filters" in parsed ? "Filters" : "filters";
  if (!parsed[filterKey]) parsed[filterKey] = [];

  if (Array.isArray(parsed[filterKey])) {
    parsed[filterKey] = (parsed[filterKey] as { PropertyName?: string }[]).filter(
      (f) => !EXTENSION_FILTER_FIELDS.includes(f.PropertyName || ""),
    );

    for (const [field, config] of Object.entries(filterState)) {
      const values = Array.isArray(config.value) ? config.value : [config.value];
      values.forEach((val: unknown, idx: number) => {
        const filterEntry: Record<string, unknown> = {
          PropertyName: field,
          Value: val,
          MatchMode: config.matchMode,
          CaseSensitive: false,
          AsString: false,
        };
        if (Array.isArray(config.value) && idx > 0) {
          filterEntry.LogicalOperator = "OR";
        }
        (parsed[filterKey] as Record<string, unknown>[]).push(filterEntry);
      });
    }
  }

  return parsed;
}

/**
 * Rebuild the invoice → row index from captured grid rows, in place.
 *
 * Keys are lowercased and trimmed so either identifier shape resolves;
 * `LetterNumber` is only added when it differs from `TaxInvoiceNumber`, so the
 * map never grows duplicate aliases for the same row.
 */
export function fillInvoiceRowIndex(
  target: Map<string, Record<string, unknown>>,
  rows: Record<string, unknown>[],
): Map<string, Record<string, unknown>> {
  target.clear();
  for (const row of rows) {
    const taxNum = String(row.TaxInvoiceNumber || "").trim().toLowerCase();
    const letterNum = String(row.LetterNumber || "").trim().toLowerCase();
    if (taxNum) target.set(taxNum, row);
    if (letterNum && letterNum !== taxNum) target.set(letterNum, row);
  }
  return target;
}

/** Coretax wraps grid rows as `{ Payload: { Data: [...] } }`; anything else is not a grid. */
export function isRowsPayload(
  response: unknown,
): response is { Payload: { Data: Record<string, unknown>[] } } {
  return Array.isArray((response as { Payload?: { Data?: unknown } } | null)?.Payload?.Data);
}

/** True when a body carries the paginated grid shape the scraper targets. */
export function isPaginatedGridBody(body: string): boolean {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    return parsed.First !== undefined && parsed.Rows !== undefined;
  } catch {
    return false;
  }
}

// ── Factory ───────────────────────────────────────────

export function createXhrPatches(deps: XhrPatchesDeps): XhrPatches {
  const {
    xhrPrototype,
    session,
    wireNativeDownloadListener,
    getFilterState,
    getPageSource,
    inferSource,
    invoiceRowMap,
    onCaptured,
    logError,
  } = deps;

  // Set by install(), cleared by restore(): doubles as the installed marker so
  // a repeated install() cannot wrap our own wrapper (zombie patches).
  let restoreTargets: (() => void) | null = null;

  return {
    install(): void {
      if (restoreTargets) return;

      const originalOpen = xhrPrototype.open;
      const originalSend = xhrPrototype.send;
      const originalSetRequestHeader = xhrPrototype.setRequestHeader;

      xhrPrototype.open = function (
        this: InterceptedXHR,
        method: string,
        url: string | URL,
        ...args: unknown[]
      ): unknown {
        this.__url = String(url);
        this.__method = method;
        this.__headers = {};
        const result = originalOpen.apply(this, [method, url, ...args]);

        // Register our response reader now, before the portal registers its own
        // (it does so between open() and send()). See the header note.
        if (this.__url?.includes(DOWNLOAD_ENDPOINT)) {
          wireNativeDownloadListener(this);
        }
        return result;
      };

      xhrPrototype.setRequestHeader = function (
        this: InterceptedXHR,
        ...args: unknown[]
      ): unknown {
        const [name, value] = args as [string, string];
        if (this.__headers) this.__headers[name] = value;
        return originalSetRequestHeader.apply(this, args);
      };

      xhrPrototype.send = function (this: InterceptedXHR, body?: unknown): unknown {
        // ── Native 1-click download ──────────────────────
        // Coretax triggers invoice PDF downloads via XHR. This branch handles
        // the NATIVE UI button; extension-owned bulk XHRs are flagged
        // (__isCindiehBulk) and fall through, because those already emit
        // DOWNLOAD_PDF_ITEM from scraper-actions.ts — intercepting them here
        // would send it twice per file.
        if (
          this.__url?.includes(DOWNLOAD_ENDPOINT) &&
          typeof body === "string" &&
          !this.__isCindiehBulk
        ) {
          session.beginProcessing();
          prepareNativeDownloadXhr(this, body);
          return originalSend.call(this, body);
        }

        let finalBody = body;
        // Read once: both the gate and the captured source use it.
        const pageSource = getPageSource();
        const inferredSource = this.__url ? inferSource(this.__url) : null;
        const isKnownSource = !!inferredSource;
        const isPaginatedGridRequest = typeof body === "string" && isPaginatedGridBody(body);
        const isTargetApi = isKnownSource || (!!pageSource && isPaginatedGridRequest);

        // 1. Inject the user's active filters into the request body
        if (isTargetApi && typeof body === "string") {
          try {
            finalBody = JSON.stringify(
              injectFilters(JSON.parse(body) as Record<string, unknown>, getFilterState()),
            );
          } catch (e) {
            logError("Cindieh [Scraper]: Filter injection failed", e);
          }
        }

        // 2. Capture the request for later scraping use
        if (isTargetApi) {
          const currentFinalBody = finalBody;
          const capturedUrl = this.__url;
          const capturedHeaders = this.__headers;
          this.addEventListener("load", () => {
            let respData: unknown = null;
            try {
              respData = JSON.parse((this as XMLHttpRequest).responseText);
            } catch {
              // Non-JSON body: not a grid response.
            }

            if (!isRowsPayload(respData)) return;

            const initialData = respData.Payload.Data;
            fillInvoiceRowIndex(invoiceRowMap, initialData);

            onCaptured({
              url: capturedUrl || "",
              headers: { ...(capturedHeaders || {}) },
              body: null,
              rawBody: typeof currentFinalBody === "string" ? currentFinalBody : "",
              response: respData,
              initialData,
              initialFirst: 0,
              source: inferredSource || pageSource || "OUTPUT_TAX",
            });
          });
        }

        return originalSend.call(this, finalBody);
      };

      restoreTargets = () => {
        xhrPrototype.open = originalOpen;
        xhrPrototype.send = originalSend;
        xhrPrototype.setRequestHeader = originalSetRequestHeader;
      };
    },

    restore(): void {
      restoreTargets?.();
      restoreTargets = null;
    },
  };
}
