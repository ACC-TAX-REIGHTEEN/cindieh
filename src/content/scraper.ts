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
import { debugLog, debugWarn, debugError } from "./debug";
import type { CapturedRequest, ScrapeMessage, InterceptedXHR } from "./scraper-types";
import {
  startScraping,
  startPdfDownload,
  scrapeByInvoices,
  type ScraperContext,
} from "./scraper-actions";

(() => {
  const TIMEOUT = 30000;
  const MAX_ERRORS = 3;

  // ── Bridge token (anti-spoofing) ───────────────────
  // Read the token that the content script embedded into THIS script's
  // own <script src> URL. Other MAIN-world scripts cannot read it because
  // they don't have access to our specific <script> element's src.
  let bridgeToken = "";
  try {
    const selfScript = document.getElementById("__ch_scraper_injected__") as HTMLScriptElement | null;
    if (selfScript && selfScript.src) {
      const url = new URL(selfScript.src, location.href);
      bridgeToken = url.searchParams.get("token") || "";
    }
  } catch {
    bridgeToken = "";
  }

  let isRunning = false;
  let stopRequested = false;

  // ── Shared scraper context ─────────────────────────
  // Passed to action functions so they don't need to close over
  // this IIFE's mutable variables directly.

  const ctx: ScraperContext = {
    isStopRequested: () => stopRequested,
    sendToContent,
    postMessage: (msg) => {
      try {
        window.postMessage({ ...msg, token: bridgeToken }, window.location.origin);
      } catch {
        // never let messaging errors stop the scraping loop
      }
    },
    getMasaPajakFromDOM,
    timeout: TIMEOUT,
    maxErrors: MAX_ERRORS,
  };

  // ── Message listener: content script → scraper ─────

  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;
    if (!event.data || event.data.direction !== "FROM_CONTENT") return;
    // Anti-spoofing: reject messages without the correct bridge token.
    if (event.data.token !== bridgeToken) return;

    const msg = event.data;

    if (msg.type === "START_SCRAPE") {
      if (isRunning) return;
      stopRequested = false;
      isRunning = true;
      startScraping(interceptRequest, ctx).finally(() => {
        isRunning = false;
        debugLog("⏹ Scraping finished. isRunning=false");
      });
    }

    if (msg.type === "STOP_SCRAPE") {
      stopRequested = true;
    }

    if (msg.type === "START_PDF_DOWNLOAD") {
      if (isRunning) return;
      if (!lastCaptured) {
        sendToContent({
          type: "SCRAPE_ERROR",
          message: "Tidak ada data request yang tersimpan. Silakan jalankan ekspor terlebih dahulu.",
        });
        return;
      }
      stopRequested = false;
      isRunning = true;
      startPdfDownload(msg.data as Record<string, unknown>[], lastCaptured, ctx).finally(() => {
        isRunning = false;
      });
    }

    if (msg.type === "SCRAPE_BY_INVOICES") {
      debugLog("RECEIVED SCRAPE_BY_INVOICES:", msg.invoiceNumbers);
      if (isRunning) {
        debugLog("SCRAPE_BY_INVOICES blocked: already running");
        return;
      }
      if (!lastCaptured) {
        sendToContent({
          type: "SCRAPE_ERROR",
          message: "Tidak ada request tersimpan.",
        });
        return;
      }
      stopRequested = false;
      isRunning = true;
      scrapeByInvoices(msg.invoiceNumbers as string[], lastCaptured, ctx).finally(() => {
        isRunning = false;
      });
    }
  });

  // ── sendToContent helper ───────────────────────────

  function sendToContent(msg: ScrapeMessage): void {
    try {
      window.postMessage({ ...msg, direction: "FROM_PAGE", token: bridgeToken }, window.location.origin);
    } catch {
      // Never let messaging errors stop the scraping loop
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__scraperSendToContent = sendToContent;

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
        const match = text.match(/(\d{2}[-/]\d{4})/);
        if (match) return match[1];

        const lastChild = container.lastElementChild;
        if (lastChild && lastChild.textContent) return lastChild.textContent.trim();
      }
    }
    return "";
  }

  // ── Global Download Interceptor ────────────────────
  // Prevents the portal from triggering a duplicate native download
  // while Better Coretax is handling the PDF.

  let isProcessingBetterDownload = false;
  let processingResetTimer: ReturnType<typeof setTimeout> | null = null;

  function setProcessingFlag(): void {
    isProcessingBetterDownload = true;
    if (processingResetTimer) clearTimeout(processingResetTimer);
    processingResetTimer = setTimeout(() => {
      if (isProcessingBetterDownload) {
        debugWarn("[Better Coretax] isProcessingBetterDownload reset by timeout");
        isProcessingBetterDownload = false;
      }
      processingResetTimer = null;
    }, 5000);
  }

  function clearProcessingFlag(): void {
    isProcessingBetterDownload = false;
    if (processingResetTimer) {
      clearTimeout(processingResetTimer);
      processingResetTimer = null;
    }
  }

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  const origAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    if (isProcessingBetterDownload && (this.download || this.href.startsWith("blob:"))) {
      debugLog("[Better Coretax] Memblokir download klik bawaan.");
      clearProcessingFlag();
      return;
    }
    return origAnchorClick.apply(this);
  };

  const origCreateObjectURL = window.URL.createObjectURL;
  window.URL.createObjectURL = function (obj: Blob | MediaSource) {
    if (isProcessingBetterDownload && obj instanceof Blob && obj.type === "application/pdf") {
      debugLog("[Better Coretax] Memblokir pembuatan blob URL bawaan.");
      return "javascript:void(0)";
    }
    return origCreateObjectURL.call(window.URL, obj);
  };

  const origWindowOpen = window.open;
  window.open = function (url?: string | URL, target?: string, features?: string) {
    if (isProcessingBetterDownload) {
      debugLog("[Better Coretax] Memblokir window.open bawaan.");
      return null;
    }
    return origWindowOpen.call(window, url, target, features);
  };

  // ── Fetch Interceptor ──────────────────────────────
  // Sole mechanism for DownloadInvoice/download-invoice-document.
  // SECURITY: Only intercepts URLs matching the specific Coretax
  // download endpoint. All other fetch requests pass through unchanged.

  const origFetch = window.fetch;
  window.fetch = async function (...args: unknown[]) {
    const url =
      typeof args[0] === "string" ? args[0] : (args[0] as Request)?.url;
    if (url?.includes("DownloadInvoice/download-invoice-document")) {
      setProcessingFlag();
      try {
        const resp = await origFetch.apply(window, args as Parameters<typeof fetch>);
        const json = await resp.clone().json();
        const pdfData = json.Content ?? json.Payload?.Content ?? json.Payload?.Message?.Data;
        if (pdfData) {
          // Determine source from current page URL so the correct filename
          // generator is selected (OUTPUT_TAX, INPUT_TAX, etc.).
          // item is unavailable here: the DownloadInvoice endpoint only returns
          // the PDF binary (base64), not invoice metadata. As a result the
          // filename will fall back to "TANPA_REFERENSI - 000.pdf". A proper
          // fix would require passing invoice row data from lastCaptured to
          // this fetch interceptor — left as a future improvement.
          const fetchSource = getPageExportSource() || "OUTPUT_TAX";
          window.postMessage(
            {
              type: "DOWNLOAD_PDF_ITEM",
              base64: pdfData,
              item: {},
              source: fetchSource,
              direction: "FROM_PAGE",
            },
            window.location.origin,
          );
          // NOTE: intentionally do NOT clear the processing flag here — the 5s
          // timeout keeps the native download blocked until we've handled the PDF.
          return new Response(JSON.stringify({ IsSuccessful: true, Content: "" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        debugWarn(
          "[Better Coretax] Fetch interceptor: PDF data not found in response.",
          "Response keys:",
          Object.keys(json),
        );
        clearProcessingFlag();
        return resp;
      } catch (err) {
        debugError("[Better Coretax] Fetch interceptor error:", err);
        clearProcessingFlag();
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
      debugError("[Better Coretax] teardown failed:", err);
    }
  }

  window.addEventListener("pagehide", teardownInterceptors, { once: true });

  // ── Filter state & request cache ──────────────────

  const filterState: Record<string, { value: unknown; matchMode: string }> = {};
  const captureSubscribers: ((req: CapturedRequest) => void)[] = [];
  let lastCaptured: CapturedRequest | null = null;
  let lastCapturedTime = 0;

  // ── Message listener: filter updates ──────────────

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;
    if (event.data.direction !== "FROM_CONTENT") return;
    if (event.data.token !== bridgeToken) return;

    if (event.data.type === "SET_SERVER_FILTER") {
      const { field, value } = event.data;
      if (value) {
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
    }

    if (event.data.type === "CLEAR_FILTERS") {
      const { fields } = event.data;
      if (Array.isArray(fields)) {
        fields.forEach((f: string) => delete filterState[f]);
      }
    }
  });

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
        debugError("Better Coretax [Scraper]: Filter injection failed", e);
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

        const subs = [...captureSubscribers];
        captureSubscribers.length = 0;
        subs.forEach((s) => s(captured));
      });
    }

    return origSend.call(this, finalBody);
  };

  // ── Request interceptor ────────────────────────────

  function interceptRequest(): Promise<CapturedRequest> {
    return new Promise<CapturedRequest>((resolve, reject) => {
      let resolved = false;
      const visibleSource = getVisibleGridSource();
      const currentPageSource = getPageExportSource();
      const canReuseCachedRequest =
        lastCaptured &&
        Date.now() - lastCapturedTime < 300000 &&
        ((visibleSource !== null && lastCaptured.source === visibleSource) ||
          (currentPageSource !== null && lastCaptured.source === currentPageSource) ||
          (isWithholdingPage() && lastCaptured.source === "WITHHOLDING_SLIPS"));

      if (canReuseCachedRequest) {
        debugLog("Using cached request from history.");
        resolved = true;
        resolve(lastCaptured as CapturedRequest);
        return;
      }

      const sub = (req: CapturedRequest) => {
        resolved = true;
        resolve(req);
      };
      captureSubscribers.push(sub);

      // Try clicking "Next Page" to trigger an XHR, then fall back to search/refresh
      setTimeout(() => {
        const nextBtn = document.querySelector("button.p-paginator-next:not(.p-disabled)") as HTMLButtonElement;
        if (nextBtn) {
          debugLog("Triggering Next Page...");
          nextBtn.click();
        } else {
          debugLog("Next button not available/disabled. Trying fallback trigger...");
          const fallbackBtn = Array.from(document.querySelectorAll("button")).find((b) => {
            const t = b.textContent?.toLowerCase() || "";
            return (
              t.includes("cari") ||
              t.includes("search") ||
              t.includes("refresh") ||
              b.querySelector(".pi-search") ||
              b.querySelector(".pi-refresh") ||
              b.querySelector(".pi-filter")
            );
          }) as HTMLButtonElement;

          if (fallbackBtn) {
            debugLog("Triggering fallback button:", fallbackBtn.textContent?.trim());
            fallbackBtn.click();
          } else {
            debugWarn("No trigger buttons found.");
          }
        }
      }, 500);

      setTimeout(() => {
        if (!resolved) {
          const idx = captureSubscribers.indexOf(sub);
          if (idx > -1) captureSubscribers.splice(idx, 1);
          reject(
            new Error(
              "Tidak ada request tertangkap (Timeout). Silakan muat ulang data atau klik tombol filter/cari di halaman.",
            ),
          );
        }
      }, 15000);
    });
  }

  // Signal that the injected script is ready
  sendToContent({ type: "INJECTED_READY" });
})();
