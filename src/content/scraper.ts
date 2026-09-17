// ============================================================
// SCRAPER.TS — Runs in PAGE context (MAIN world)
// ============================================================
// Injected by main.ts into the page to access Angular's XHR.
// Communicates with content script via window.postMessage.
//
// Responsibilities of this file:
//   1. Read the bridge token from our own <script> src URL.
//   2. Monkey-patch XHR / fetch / anchor to intercept Coretax
//      requests and block duplicate native downloads.
//   3. Maintain the captured-request cache and filter state.
//   4. Listen for messages from the content script and delegate
//      to the action functions in scraper-actions.ts.
//
// All scraping/download orchestration lives in scraper-actions.ts
// so it can be unit-tested without a live browser.
// ============================================================

import {
  type ExportSource,
  getPageExportSource,
  inferCapturedSource,
  isWithholdingPage,
} from "./page-context";
import { extractMasaPajak } from "./tax-date";
import { debugLog, debugWarn, debugError } from "./debug";
import type { CapturedRequest, ScrapeMessage, InterceptedXHR } from "./scraper-types";
import {
  startScraping,
  startPdfDownload,
  scrapeByInvoices,
  type ScraperContext,
} from "./scraper-actions";
import { interceptRequest as makeInterceptRequest } from "./scraper-intercept";
import {
  buildPdfDownloadMessage,
  createPdfDownloadSession,
} from "./scraper-pdf";
import { createMessageDispatcher } from "./postmessage-guard";
import { createScrapeRuns } from "./scraper-run";

(() => {
  const TIMEOUT = 30000;
  const MAX_ERRORS = 3;

  // ── Bridge correlation token ──────────────────────
  // Shared DOM and message traffic expose this token to MAIN-world scripts.
  // It correlates this bridge, not a secret authentication boundary (ADR-0007).
  let bridgeToken = "";
  try {
    const selfScript = document.getElementById("__ch_scraper_injected__") as HTMLScriptElement | null;
    if (selfScript && selfScript.src) {
      const url = new URL(selfScript.src, location.href);
      bridgeToken = url.searchParams.get("token") || "";
      // Reduce DOM exposure without assuming a guaranteed exposure duration.
      // The element itself stays in the DOM as the one-time injection marker:
      // injectScraper's getElementById guard then prevents a second scraper
      // instance on SPA navigation (zombie interceptors). See ADR-0008.
      selfScript.removeAttribute("src");
    }
  } catch {
    bridgeToken = "";
  }

  const runs = createScrapeRuns();

  // ── Shared scraper context ─────────────────────────
  // Passed to action functions so they don't need to close over
  // this IIFE's mutable variables directly.

  const ctx: ScraperContext = {
    // ── Orchestration ──────────────────────────────────
    isStopRequested: () => false,
    sendToContent,
    emitPdfDownload: (base64, item, source) => {
      try {
        window.postMessage(
          buildPdfDownloadMessage({ base64, item, source, token: bridgeToken }),
          window.location.origin,
        );
      } catch {
        // never let messaging errors stop the scraping loop
      }
    },
    getMasaPajakFromDOM,
    delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    timeout: TIMEOUT,
    maxErrors: MAX_ERRORS,

    // ── Request capture ────────────────────────────────
    getLastCaptured: () => lastCaptured,
    getLastCapturedTime: () => lastCapturedTime,
    getVisibleGridSource,
    getCurrentPageSource: getPageExportSource,
    isWithholdingPage,
    subscribeCapture: (fn) => {
      captureSubscribers.push(fn);
      return () => {
        const idx = captureSubscribers.indexOf(fn);
        if (idx > -1) captureSubscribers.splice(idx, 1);
      };
    },
    queryElement: (selector) => document.querySelector(selector),
    queryAllButtons: () => Array.from(document.querySelectorAll("button")),
    clickElement: (el) => (el as HTMLElement).click(),
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (h) => window.clearTimeout(h as number),
  };

  function runAction(msg: Record<string, unknown>, action: (runCtx: ScraperContext) => Promise<void>): void {
    if (!Number.isSafeInteger(msg.runId) || (msg.runId as number) <= 0) return;
    const run = runs.start(msg.runId as number);
    if (!run) return;
    const page = location.href;
    const isCurrent = () => run.isCurrent() && location.href === page;
    const runCtx: ScraperContext = {
      ...ctx,
      signal: run.signal,
      isStopRequested: () => !isCurrent(),
      sendToContent: (message) => {
        if (isCurrent()) sendToContent({ ...message, runId: run.id });
      },
      emitPdfDownload: (base64, item, source) => {
        if (!isCurrent()) return;
        window.postMessage({
          ...buildPdfDownloadMessage({ base64, item, source, token: bridgeToken }),
          runId: run.id,
        }, window.location.origin);
      },
      clickElement: (el) => { if (isCurrent()) ctx.clickElement(el); },
    };
    void action(runCtx).catch((err: unknown) => {
      runCtx.sendToContent({ type: "SCRAPE_ERROR", message: err instanceof Error ? err.message : String(err) });
    }).finally(() => run.finish());
  }

  // ── Message listener: content script → scraper ─────
  // One guard-then-dispatch seam (FROM_CONTENT) for every message the
  // isolated world sends in. New message types register in the table.

  const messageDispatcher = createMessageDispatcher({
    direction: "FROM_CONTENT",
    token: bridgeToken,
    handlers: {
      START_SCRAPE: (msg) => {
        runAction(msg, (runCtx) => startScraping(() => makeInterceptRequest(runCtx), runCtx));
      },

      STOP_SCRAPE: () => {
        runs.cancel();
      },

      RESET_SCRAPER: () => {
        // Called on SPA navigation to prevent stale state from leaking
        // into the new page. Resets running flags, captured request cache,
        // filter state, and pending capture subscribers.
        runs.cancel();
        lastCaptured = null;
        lastCapturedTime = 0;
        captureSubscribers.length = 0;
        invoiceRowMap.clear();
        for (const key of Object.keys(filterState)) {
          delete filterState[key];
        }
        debugLog("Scraper state reset via RESET_SCRAPER");
      },

      START_PDF_DOWNLOAD: (msg) => {
        if (runs.isRunning()) return;
        if (!lastCaptured) {
          sendToContent({
            type: "SCRAPE_ERROR",
            message: "Tidak ada data request yang tersimpan. Silakan jalankan ekspor terlebih dahulu.",
            runId: msg.runId as number,
          });
          return;
        }
        const captured = lastCaptured;
        runAction(msg, (runCtx) => startPdfDownload(msg.data as Record<string, unknown>[], captured, runCtx));
      },

      SCRAPE_BY_INVOICES: (msg) => {
        debugLog("RECEIVED SCRAPE_BY_INVOICES:", msg.invoiceNumbers);
        if (runs.isRunning()) {
          debugLog("SCRAPE_BY_INVOICES blocked: already running");
          return;
        }
        if (!lastCaptured) {
          sendToContent({
            type: "SCRAPE_ERROR",
            message: "Tidak ada request tersimpan.",
            runId: msg.runId as number,
          });
          return;
        }
        const captured = lastCaptured;
        runAction(msg, (runCtx) => scrapeByInvoices(msg.invoiceNumbers as string[], captured, runCtx));
      },

      SET_SERVER_FILTER: (msg) => {
        const { value } = msg;
        const field = msg.field as string;
        const hasValue =
          value !== undefined &&
          value !== null &&
          value !== "" &&
          (!Array.isArray(value) || value.length > 0);

        if (hasValue) {
          // Invalidate cache when filter changes to ensure a fresh request
          lastCaptured = null;
          lastCapturedTime = 0;
          filterState[field] = {
            value,
            matchMode: Array.isArray(value) ? "equals" : "contains",
          };
        } else {
          delete filterState[field];
        }
      },

      CLEAR_FILTERS: (msg) => {
        const { fields } = msg;
        if (Array.isArray(fields)) {
          fields.forEach((f: string) => delete filterState[f]);
        }
      },
    },
  });
  window.addEventListener("message", (event) => messageDispatcher.handle(event));

  // ── sendToContent helper ───────────────────────────

  function sendToContent(msg: ScrapeMessage): void {
    try {
      window.postMessage({ ...msg, direction: "FROM_PAGE", token: bridgeToken }, window.location.origin);
    } catch {
      // Never let messaging errors stop the scraping loop
    }
  }

  // Expose for debugging convenience in development builds only.
  // esbuild textually replaces process.env.NODE_ENV so the minifier
  // eliminates this block entirely in production builds.
  if (process.env.NODE_ENV === "development") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__scraperSendToContent = sendToContent;
  }

  // ── DOM helpers ────────────────────────────────────

  function getVisibleGridSource(): ExportSource | null {
    const grids: { tag: string; source: ExportSource }[] = [
      { tag: "rshshr-art2126-l1a-grid", source: "PPH_21_L1A" },
      { tag: "rshshr-art2126-l1b-grid", source: "PPH_21_L1B" },
      { tag: "rshshr-art2126-l2-grid", source: "PPH_21_L2" },
      { tag: "rshshr-art2126-l3-grid", source: "PPH_21_L3" },
      { tag: "rshshr-nvat-la2-grid", source: "SPT_A2" },
      { tag: "rshshr-nvat-lb2-grid", source: "SPT_B2" },
    ];
    for (const g of grids) {
      const el = document.querySelector(g.tag) as HTMLElement;
      if (el && el.offsetParent !== null) return g.source;
    }
    return null;
  }

  function getMasaPajakFromDOM(): string {
    const labels = Array.from(document.querySelectorAll("label"));
    const masaLabel =
      labels.find((el) => {
        const txt = el.textContent?.toUpperCase() || "";
        return txt.includes("MASA PAJAK") && (txt.includes("MM") || txt.includes("YYYY"));
      }) || labels.find((el) => el.textContent?.toUpperCase().includes("MASA PAJAK"));

    if (masaLabel) {
      const container = masaLabel.closest(".form-group.row") || masaLabel.parentElement;
      if (container) {
        const input = container.querySelector("input") as HTMLInputElement;
        if (input && input.value) return input.value.trim();

        const text = container.textContent || "";
        const masaPajak = extractMasaPajak(text);
        if (masaPajak) return masaPajak;

        const lastChild = container.lastElementChild;
        if (lastChild && lastChild.textContent) return lastChild.textContent.trim();
      }
    }
    return "";
  }

  // ── PDF download session ───────────────────────────
  // Owns the native download processing flag and DOWNLOAD_PDF_ITEM
  // emission for the fetch/XHR interceptors below.

  // Maps invoice identifiers (TaxInvoiceNumber, LetterNumber) to row data
  // so the fetch interceptor can resolve item metadata for PDF filenames.
  const invoiceRowMap = new Map<string, Record<string, unknown>>();

  const pdfSession = createPdfDownloadSession({
    token: bridgeToken,
    getRowMap: () => invoiceRowMap,
    getSource: () => getPageExportSource(),
    emit: (msg) => {
      try {
        window.postMessage(msg, window.location.origin);
      } catch {
        // never let messaging errors stop the download path
      }
    },
  });

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  const origAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    if (pdfSession.isProcessing() && (this.download || this.href.startsWith("blob:"))) {
      debugLog("[Cindieh] Memblokir download klik bawaan.");
      pdfSession.clearProcessing();
      return;
    }
    return origAnchorClick.apply(this);
  };

  const origCreateObjectURL = window.URL.createObjectURL;
  window.URL.createObjectURL = function (obj: Blob | MediaSource) {
    if (pdfSession.isProcessing() && obj instanceof Blob && obj.type === "application/pdf") {
      debugLog("[Cindieh] Memblokir pembuatan blob URL bawaan.");
      return "";
    }
    return origCreateObjectURL.call(window.URL, obj);
  };

  const origWindowOpen = window.open;
  window.open = function (url?: string | URL, target?: string, features?: string) {
    if (pdfSession.isProcessing()) {
      debugLog("[Cindieh] Memblokir window.open bawaan.");
      return null;
    }
    return origWindowOpen.call(window, url, target, features);
  };

  // ── Fetch Interceptor ──────────────────────────────
  // Sole mechanism for DownloadInvoice/download-invoice-document.
  // SECURITY: Only intercepts URLs matching the specific Coretax
  // download endpoint. All other fetch requests pass through unchanged.

  /**
   * True when the fetch call is one the extension created itself for bulk
   * download — flagged with __isCindiehBulk on the RequestInit or the
   * Request object, mirroring InterceptedXHR on the XHR path.
   */
  function isBulkFetchRequest(...args: unknown[]): boolean {
    const init = args[1] as (RequestInit & { __isCindiehBulk?: boolean }) | undefined;
    if (init?.__isCindiehBulk) return true;
    const req = args[0];
    if (req && typeof req === "object") {
      return (req as { __isCindiehBulk?: boolean }).__isCindiehBulk === true;
    }
    return false;
  }

  const origFetch = window.fetch;
  window.fetch = async function (...args: unknown[]) {
    const url =
      typeof args[0] === "string" ? args[0] : (args[0] as Request)?.url;
    // Guard mirrors the XHR interceptor: skip extension-owned bulk fetches
    // (__isCindiehBulk) so they never double-fire DOWNLOAD_PDF_ITEM. Today the
    // bulk paths use XHR only (xhrDownloadEfakturPdf / xhrDownloadWithholdingPdf),
    // but keep this flag working if any of them moves to fetch.
    if (
      url?.includes("DownloadInvoice/download-invoice-document") &&
      !isBulkFetchRequest(...args)
    ) {
      pdfSession.beginProcessing();
      try {
        const resp = await origFetch.apply(window, args as Parameters<typeof fetch>);
        const json = await resp.clone().json();
        const reqBody =
          typeof args[0] === "object" && args[0] !== null && "body" in args[0]
            ? await (args[0] as Request).clone().text()
            : typeof args[1] === "string"
              ? args[1]
              : "";
        const { intercepted } = pdfSession.handleNativeResponse(json, reqBody);
        if (intercepted) {
          // Block the native download: Coretax sees success but empty Content.
          return new Response(JSON.stringify({ IsSuccessful: true, Content: "" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        debugWarn(
          "[Cindieh] Fetch interceptor: PDF data not found in response.",
          "Response keys:",
          Object.keys(json),
        );
        return resp;
      } catch (err) {
        debugError("[Cindieh] Fetch interceptor error:", err);
        pdfSession.clearProcessing();
        return origFetch.apply(window, args as Parameters<typeof fetch>);
      }
    }
    return origFetch.apply(window, args as Parameters<typeof fetch>);
  };

  // ── Teardown ───────────────────────────────────────
  // Restore all monkey-patched globals on full page unload.
  // (SPA navigations keep the patch active intentionally.)

  function teardownInterceptors(): void {
    try {
      XMLHttpRequest.prototype.open = origOpen;
      XMLHttpRequest.prototype.send = origSend;
      XMLHttpRequest.prototype.setRequestHeader = origSetHeader;
      HTMLAnchorElement.prototype.click = origAnchorClick;
      window.URL.createObjectURL = origCreateObjectURL;
      window.open = origWindowOpen;
      window.fetch = origFetch;
    } catch (err) {
      debugError("[Cindieh] teardown failed:", err);
    }
  }

  window.addEventListener("pagehide", teardownInterceptors, { once: true });

  // ── Filter state & request cache ──────────────────

  const filterState: Record<string, { value: unknown; matchMode: string }> = {};
  const captureSubscribers: ((req: CapturedRequest) => void)[] = [];
  let lastCaptured: CapturedRequest | null = null;
  let lastCapturedTime = 0;

  // ── XHR prototype overrides ────────────────────────

  XMLHttpRequest.prototype.open = function (
    this: InterceptedXHR,
    method: string,
    url: string | URL,
    ...args: unknown[]
  ) {
    this.__url = String(url);
    this.__method = method;
    this.__headers = {};
    return origOpen.apply(this, [method, url, ...args] as Parameters<typeof origOpen>);
  } as typeof XMLHttpRequest.prototype.open;

  XMLHttpRequest.prototype.setRequestHeader = function (this: InterceptedXHR, ...args: [string, string]) {
    if (this.__headers) this.__headers[args[0]] = args[1];
    return origSetHeader.apply(this, args);
  };

  XMLHttpRequest.prototype.send = function (this: InterceptedXHR, body?: Document | XMLHttpRequestBodyInit | null) {
    // ── XHR intercept: native 1-click download ─────────────
    // Coretax triggers invoice PDF downloads via XHR (not fetch).
    // We intercept here so the rename logic fires for both the
    // extension's own bulk-download path AND the native UI button.
    //
    // Skip XHRs that the extension itself created for bulk download
    // (__isCindiehBulk flag). Those are already handled by
    // ctx.postMessage in scraper-actions.ts; intercepting them here
    // would send DOWNLOAD_PDF_ITEM twice per file.
    if (
      this.__url?.includes("DownloadInvoice/download-invoice-document") &&
      typeof body === "string" &&
      !(this as InterceptedXHR & { __isCindiehBulk?: boolean }).__isCindiehBulk
    ) {
      pdfSession.beginProcessing();
      const xhrDownloadBody = body;

      this.addEventListener("load", function (this: XMLHttpRequest) {
        try {
          const res = JSON.parse(this.responseText) as Record<string, unknown>;
          const { intercepted } = pdfSession.handleNativeResponse(res, xhrDownloadBody);
          if (intercepted) {
            debugLog("[Cindieh] XHR download intercepted, posting DOWNLOAD_PDF_ITEM");
            // Block the native download: replace response so Coretax
            // sees a success but with empty Content — same as fetch path.
            Object.defineProperty(this, "responseText", {
              get: () => JSON.stringify({ IsSuccessful: true, Content: "" }),
              configurable: true,
            });
          } else {
            debugWarn("[Cindieh] XHR download interceptor: PDF data not found in response.");
          }
        } catch (err) {
          debugError("[Cindieh] XHR download interceptor error:", err);
          pdfSession.clearProcessing();
        }
      });

      return origSend.call(this, body);
    }

    let finalBody = body;
    const pageSource = getPageExportSource();
    const inferredSource = this.__url ? inferCapturedSource(this.__url) : null;
    const isKnownSource = !!inferredSource;
    let isPaginatedGridRequest = false;

    if (typeof body === "string") {
      try {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        isPaginatedGridRequest = parsed.First !== undefined && parsed.Rows !== undefined;
      } catch {
        isPaginatedGridRequest = false;
      }
    }

    const isTargetApi = isKnownSource || (!!pageSource && isPaginatedGridRequest);

    // 1. Inject active filters into the request body
    if (isTargetApi && typeof body === "string") {
      try {
        const parsed = JSON.parse(body);
        const filterKey = "Filters" in parsed ? "Filters" : "filters";
        if (!parsed[filterKey]) parsed[filterKey] = [];

        if (Array.isArray(parsed[filterKey])) {
          // Remove previously-injected extension filters to prevent duplicates
          const extFields = ["Reference", "TaxInvoiceNumber"];
          parsed[filterKey] = parsed[filterKey].filter(
            (f: { PropertyName?: string }) => !extFields.includes(f.PropertyName || ""),
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
              parsed[filterKey].push(filterEntry);
            });
          }
        }
        finalBody = JSON.stringify(parsed);
      } catch (e) {
        debugError("Cindieh [Scraper]: Filter injection failed", e);
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
        } catch {}

        if (!Array.isArray((respData as { Payload?: { Data?: unknown[] } })?.Payload?.Data)) {
          return;
        }

        const captured: CapturedRequest = {
          url: capturedUrl || "",
          headers: { ...(capturedHeaders || {}) },
          body: null,
          rawBody: typeof currentFinalBody === "string" ? currentFinalBody : "",
          response: respData,
          initialData: (respData as { Payload: { Data: Record<string, unknown>[] } }).Payload.Data,
          initialFirst: 0,
          source: inferredSource || pageSource || "OUTPUT_TAX",
        };

        lastCaptured = captured;
        lastCapturedTime = Date.now();

        // Build invoice → row mapping so the fetch interceptor can
        // resolve item metadata for PDF filenames.
        invoiceRowMap.clear();
        for (const row of captured.initialData) {
          const taxNum = String(row.TaxInvoiceNumber || "").trim().toLowerCase();
          const letterNum = String(row.LetterNumber || "").trim().toLowerCase();
          if (taxNum) invoiceRowMap.set(taxNum, row);
          if (letterNum && letterNum !== taxNum) invoiceRowMap.set(letterNum, row);
        }

        const subs = [...captureSubscribers];
        captureSubscribers.length = 0;
        subs.forEach((s) => s(captured));
      });
    }

    return origSend.call(this, finalBody);
  };

  // ── Request interceptor ────────────────────────────
  // Delegates to the extracted, testable module in scraper-intercept.ts.



  // Signal that the injected script is ready
  sendToContent({ type: "INJECTED_READY" });
})();
