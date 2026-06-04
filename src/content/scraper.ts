// ============================================================
// SCRAPER.TS — Runs in PAGE context (MAIN world)
// ============================================================
// Injected by main.ts into the page to access Angular's XHR.
// Communicates with content script via window.postMessage.
// ============================================================

import {
  type ExportSource,
  extractFilenameHintFromBody,
  getPageExportSource,
  inferCapturedSource,
  isWithholdingPage,
} from "./page-context";

(() => {
  const TIMEOUT = 30000;
  const MAX_ERRORS = 3;

  let isRunning = false;
  let stopRequested = false;

  // ── Types ──────────────────────────────────────────

  interface CapturedRequest {
    url: string;
    headers: Record<string, string>;
    body: Record<string, unknown> | null;
    rawBody: string;
    response: unknown;
    initialData: Record<string, unknown>[];
    initialFirst: number;
    source: ExportSource;
  }

  interface ScrapeProgress {
    type: "SCRAPE_PROGRESS";
    total: number;
    page: number;
    elapsed: string;
    status: string;
    currentIndex?: number; // 1-based position in bulk download
    totalCount?: number; // total items in bulk download
    failureCount?: number; // cumulative failures so far
  }

  interface ScrapeComplete {
    type: "SCRAPE_COMPLETE";
    data: Record<string, unknown>[];
    fields: string[];
    total: number;
    pages: number;
    elapsed: string;
    filenameHint?: string;
    source: ExportSource;
    failureCount?: number; // total failures in bulk download
  }

  interface ScrapeError {
    type: "SCRAPE_ERROR";
    message: string;
  }

  type ScrapeMessage =
    | ScrapeProgress
    | ScrapeComplete
    | ScrapeError
    | { type: "INJECTED_READY" };

  // Extend XHR for intercepted properties
  interface InterceptedXHR extends XMLHttpRequest {
    __url?: string;
    __method?: string;
    __headers?: Record<string, string>;
  }

  // ── Listen for messages from content.js ─────────────

  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;
    if (!event.data || event.data.direction !== "FROM_CONTENT") return;

    const msg = event.data;

    if (msg.type === "START_SCRAPE") {
      if (isRunning) return;
      stopRequested = false;
      startScraping();
    }

    if (msg.type === "STOP_SCRAPE") {
      stopRequested = true;
    }

    if (msg.type === "START_PDF_DOWNLOAD") {
      if (isRunning) return;
      stopRequested = false;
      startPdfDownload(msg.data as Record<string, unknown>[]);
    }

    if (msg.type === "SCRAPE_BY_INVOICES") {
      console.log("[Scraper] RECEIVED SCRAPE_BY_INVOICES:", msg.invoiceNumbers);
      if (isRunning) {
        console.log("[Scraper] SCRAPE_BY_INVOICES blocked: already running");
        return;
      }
      stopRequested = false;
      scrapeByInvoices(msg.invoiceNumbers as string[]);
    }
  });

  // ── Send message to content.js ──────────────────────

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
        return (
          txt.includes("MASA PAJAK") &&
          (txt.includes("MM") || txt.includes("YYYY"))
        );
      }) ||
      labels.find((el) => el.textContent?.toUpperCase().includes("MASA PAJAK"));

    if (masaLabel) {
      const container =
        masaLabel.closest(".form-group.row") || masaLabel.parentElement;
      if (container) {
        // 1. Try input first
        const input = container.querySelector("input") as HTMLInputElement;
        if (input && input.value) return input.value.trim();

        // 2. Try any component with text content that looks like MM-YYYY or MM/YYYY
        const text = container.textContent || "";
        const match = text.match(/(\d{2}[-/]\d{4})/);
        if (match) return match[1];

        // 3. Fallback to last child text
        const lastChild = container.lastElementChild;
        if (lastChild && lastChild.textContent)
          return lastChild.textContent.trim();
      }
    }
    return "";
  }

  function sendToContent(msg: ScrapeMessage): void {
    try {
      window.postMessage(
        { ...msg, direction: "FROM_PAGE" },
        window.location.origin,
      );
    } catch {
      // Never let messaging errors stop the scraping loop
    }
  }

  // ── Intercept XHR to capture Angular's request ──────

  // ── Global XHR Interception Layer ──────────────────

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  // ── Global Download Interceptor (to prevent double download) ──
  let isProcessingBetterDownload = false;
  let processingResetTimer: ReturnType<typeof setTimeout> | null = null;

  function setProcessingFlag(): void {
    isProcessingBetterDownload = true;
    if (processingResetTimer) clearTimeout(processingResetTimer);
    processingResetTimer = setTimeout(() => {
      if (isProcessingBetterDownload) {
        console.warn(
          "[Better Coretax] isProcessingBetterDownload reset by timeout",
        );
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

  const origAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    if (
      isProcessingBetterDownload &&
      (this.download || this.href.startsWith("blob:"))
    ) {
      console.log("[Better Coretax] Memblokir download klik bawaan.");
      clearProcessingFlag();
      return;
    }
    return origAnchorClick.apply(this);
  };

  const origCreateObjectURL = window.URL.createObjectURL;
  window.URL.createObjectURL = function (obj: any) {
    if (
      isProcessingBetterDownload &&
      obj instanceof Blob &&
      obj.type === "application/pdf"
    ) {
      console.log("[Better Coretax] Memblokir pembuatan blob URL bawaan.");
      // isProcessingBetterDownload = false; // Don't reset yet, might be multiple calls
      return "javascript:void(0)";
    }
    return origCreateObjectURL(obj);
  };

  const origWindowOpen = window.open;
  window.open = function (
    url?: string | URL,
    target?: string,
    features?: string,
  ) {
    if (isProcessingBetterDownload) {
      console.log("[Better Coretax] Memblokir window.open bawaan.");
      return null;
    }
    return origWindowOpen.call(window, url, target, features);
  };

  // ── Fetch Interceptor — sole mechanism for DownloadInvoice/download-invoice-document ──
  const origFetch = window.fetch;
  window.fetch = async function (...args: any[]) {
    const url =
      typeof args[0] === "string" ? args[0] : (args[0] as Request)?.url;
    if (url?.includes("DownloadInvoice/download-invoice-document")) {
      setProcessingFlag();
      try {
        const resp = await origFetch.apply(window, args as any);
        const json = await resp.clone().json();
        const pdfData =
          json.Content ?? json.Payload?.Content ?? json.Payload?.Message?.Data;
        if (pdfData) {
          window.postMessage(
            {
              type: "DOWNLOAD_PDF_ITEM",
              base64: pdfData,
              item: {},
              source: "OUTPUT_TAX",
              direction: "FROM_PAGE",
            },
            window.location.origin,
          );
        }
        clearProcessingFlag();
        return new Response(
          JSON.stringify({ IsSuccessful: true, Content: "" }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      } catch (err) {
        console.error("[Better Coretax] Fetch interceptor error:", err);
        clearProcessingFlag();
        return origFetch.apply(window, args as any);
      }
    }
    return origFetch.apply(window, args as any);
  };

  const filterState: Record<string, any> = {};
  const captureSubscribers: ((req: CapturedRequest) => void)[] = [];
  let lastCaptured: CapturedRequest | null = null;
  let lastCapturedTime = 0;

  // ── Message Listener for Filters ───────────────────

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;
    if (event.data.direction !== "FROM_CONTENT") return;
    if (event.data.type === "SET_SERVER_FILTER") {
      const { field, value } = event.data;
      if (value) {
        // Support array values for multi-invoice filtering
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

  // ── Prototype Overrides ────────────────────────────

  XMLHttpRequest.prototype.open = function (
    this: InterceptedXHR,
    method: string,
    url: string | URL,
    ...args: unknown[]
  ) {
    this.__url = String(url);
    this.__method = method;
    this.__headers = {};
    return origOpen.apply(this, [method, url, ...args] as Parameters<
      typeof origOpen
    >);
  } as typeof XMLHttpRequest.prototype.open;

  XMLHttpRequest.prototype.setRequestHeader = function (
    this: InterceptedXHR,
    ...args: [string, string]
  ) {
    if (this.__headers) this.__headers[args[0]] = args[1];
    return origSetHeader.apply(this, args);
  };

  XMLHttpRequest.prototype.send = function (
    this: InterceptedXHR,
    body?: Document | XMLHttpRequestBodyInit | null,
  ) {
    let finalBody = body;
    const pageSource = getPageExportSource();
    const inferredSource = this.__url ? inferCapturedSource(this.__url) : null;
    const isKnownSource = !!inferredSource;
    let isPaginatedGridRequest = false;

    if (typeof body === "string") {
      try {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        isPaginatedGridRequest =
          parsed.First !== undefined && parsed.Rows !== undefined;
      } catch {
        isPaginatedGridRequest = false;
      }
    }

    const isTargetApi =
      isKnownSource || (!!pageSource && isPaginatedGridRequest);

    // 1. Inject Filter (Strategi B)
    if (isTargetApi && typeof body === "string") {
      try {
        const parsed = JSON.parse(body);
        const filterKey = "Filters" in parsed ? "Filters" : "filters";
        if (!parsed[filterKey]) parsed[filterKey] = [];

        if (Array.isArray(parsed[filterKey])) {
          // Remove existing extension-injected filters to prevent duplicates
          const extFields = ["Reference", "TaxInvoiceNumber"];
          parsed[filterKey] = parsed[filterKey].filter(
            (f: { PropertyName?: string }) =>
              !extFields.includes(f.PropertyName || ""),
          );

          // Inject active filters
          for (const [field, config] of Object.entries(filterState)) {
            const cfg = config as { value: unknown; matchMode?: string };
            const values = Array.isArray(cfg.value) ? cfg.value : [cfg.value];
            const matchMode = cfg.matchMode || "contains";
            values.forEach((val: unknown, idx: number) => {
              const filterEntry: Record<string, unknown> = {
                PropertyName: field,
                Value: val,
                MatchMode: matchMode,
                CaseSensitive: false,
                AsString: false,
              };
              // Add LogicalOperator OR for multi-value filters (except first)
              if (Array.isArray(cfg.value) && idx > 0) {
                filterEntry.LogicalOperator = "OR";
              }
              parsed[filterKey].push(filterEntry);
            });
          }
        }
        finalBody = JSON.stringify(parsed);
      } catch (e) {
        console.error("Better Coretax [Scraper]: Filter injection failed", e);
      }
    }

    // 2. Data Inspection & Capture
    if (isTargetApi) {
      const currentFinalBody = finalBody;
      const capturedUrl = this.__url;
      const capturedHeaders = this.__headers;
      this.addEventListener("load", () => {
        let respData: unknown = null;
        try {
          respData = JSON.parse((this as XMLHttpRequest).responseText);
        } catch {}

        const captured: CapturedRequest = {
          url: capturedUrl || "",
          headers: { ...(capturedHeaders || {}) },
          body: null,
          rawBody: typeof currentFinalBody === "string" ? currentFinalBody : "",
          response: respData,
          initialData: Array.isArray(
            (respData as { Payload?: { Data?: unknown[] } })?.Payload?.Data,
          )
            ? (respData as { Payload: { Data: Record<string, unknown>[] } })
                .Payload.Data
            : [],
          initialFirst: 0,
          source: inferredSource || pageSource || "OUTPUT_TAX",
        };

        if (
          !Array.isArray(
            (respData as { Payload?: { Data?: unknown[] } })?.Payload?.Data,
          )
        ) {
          return;
        }

        // Update global cache
        lastCaptured = captured;
        lastCapturedTime = Date.now();

        const subs = [...captureSubscribers];
        captureSubscribers.length = 0;
        subs.forEach((s) => s(captured));
      });
    }

    return origSend.call(this, finalBody);
  };

  // ── Intercept XHR to capture Angular's request ──────

  function interceptRequest(): Promise<CapturedRequest> {
    return new Promise<CapturedRequest>((resolve, reject) => {
      let resolved = false;
      const visibleSource = getVisibleGridSource();
      const currentPageSource = getPageExportSource();
      const canReuseCachedRequest =
        lastCaptured &&
        Date.now() - lastCapturedTime < 300000 &&
        // Ensure we only reuse if the source matches EXACTLY what is currently on screen
        ((visibleSource !== null && lastCaptured.source === visibleSource) ||
          (currentPageSource !== null &&
            lastCaptured.source === currentPageSource) ||
          (isWithholdingPage() && lastCaptured.source === "WITHHOLDING_SLIPS"));

      // 1. Check if we have a "warm" cache from the same portal context
      if (canReuseCachedRequest) {
        console.log("[Scraper] Using cached request from history.");
        resolved = true;
        resolve(lastCaptured as CapturedRequest);
        return;
      }

      const sub = (req: CapturedRequest) => {
        resolved = true;
        resolve(req);
      };
      captureSubscribers.push(sub);

      // 2. Strategy: Try clicking "Next Page" first
      setTimeout(() => {
        const nextBtn = document.querySelector(
          "button.p-paginator-next:not(.p-disabled)",
        ) as HTMLButtonElement;
        if (nextBtn) {
          console.log("[Scraper] Triggering Next Page...");
          nextBtn.click();
        } else {
          // 3. Fallback Strategy: Try clicking "Refresh" or "Cari" if Next is not available
          console.log(
            "[Scraper] Next button not available/disabled. Trying fallback trigger...",
          );
          const fallbackBtn = Array.from(
            document.querySelectorAll("button"),
          ).find((b) => {
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
            console.log(
              "[Scraper] Triggering fallback button:",
              fallbackBtn.textContent?.trim(),
            );
            fallbackBtn.click();
          } else {
            console.warn("[Scraper] No trigger buttons found.");
          }
        }
      }, 500);

      // Timeout
      setTimeout(() => {
        if (!resolved) {
          // Remove subscriber if still there
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

  // ── XHR request function ────────────────────────────

  function xhrRequest(
    captured: CapturedRequest,
    first: number,
    rows: number,
  ): Promise<Record<string, unknown>[]> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", captured.url, true);

      for (const [k, v] of Object.entries(captured.headers)) {
        xhr.setRequestHeader(k, v);
      }

      xhr.timeout = TIMEOUT;

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText) as {
              Payload?: { Data?: Record<string, unknown>[] };
            };
            resolve(data?.Payload?.Data || []);
          } catch {
            reject(new Error(`Parse error di First=${first}`));
          }
        } else {
          reject(new Error(`HTTP ${xhr.status} di First=${first}`));
        }
      };
      xhr.onerror = () => reject(new Error(`Network error di First=${first}`));
      xhr.ontimeout = () => reject(new Error(`Timeout di First=${first}`));

      const body = JSON.parse(captured.rawBody) as Record<string, unknown>;
      body.First = first;
      body.Rows = rows;
      xhr.send(JSON.stringify(body));
    });
  }

  /** Make a targeted API request filtered by a single invoice number. */
  function xhrRequestByInvoice(
    captured: CapturedRequest,
    invoiceNumber: string,
  ): Promise<Record<string, unknown>[]> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", captured.url, true);
      for (const [k, v] of Object.entries(captured.headers))
        xhr.setRequestHeader(k, v);
      xhr.timeout = TIMEOUT;
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText) as {
              Payload?: { Data?: Record<string, unknown>[] };
            };
            resolve(data?.Payload?.Data || []);
          } catch {
            reject(new Error("Parse error"));
          }
        } else {
          reject(new Error(`HTTP ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error("Network error"));
      xhr.ontimeout = () => reject(new Error("Timeout"));
      const body = JSON.parse(captured.rawBody) as Record<string, unknown>;
      body.First = 0;
      body.Rows = 1;
      // Replace ALL filters with only TaxInvoiceNumber — ignore masa/tahun/status
      const fk = "Filters" in body ? "Filters" : "filters";
      (body as any)[fk] = [
        {
          PropertyName: "TaxInvoiceNumber",
          Value: invoiceNumber,
          MatchMode: "equals",
          CaseSensitive: false,
          AsString: false,
        },
      ];
      xhr.send(JSON.stringify(body));
    });
  }

  /** Scrape by individual invoice numbers — much faster than full scrape. */
  async function scrapeByInvoices(invoiceNumbers: string[]): Promise<void> {
    if (!lastCaptured) {
      sendToContent({
        type: "SCRAPE_ERROR",
        message: "Tidak ada request tersimpan.",
      });
      return;
    }
    isRunning = true;
    const startTime = Date.now();
    const allData: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < invoiceNumbers.length; i++) {
      if (stopRequested) break;
      const num = invoiceNumbers[i];
      const elapsed = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;
      sendToContent({
        type: "SCRAPE_PROGRESS",
        total: i + 1,
        page: i + 1,
        elapsed,
        status: `Mencari: ${num} (${i + 1}/${invoiceNumbers.length})`,
      });
      try {
        const rows = await xhrRequestByInvoice(lastCaptured, num);
        for (const row of rows) {
          const key =
            (row.RecordId as string) ||
            (row.AggregateIdentifier as string) ||
            JSON.stringify(row);
          if (!seen.has(key)) {
            seen.add(key);
            allData.push(row);
          }
        }
        await delay(50);
      } catch (err) {
        console.error(`[Scraper] Gagal mencari ${num}:`, err);
      }
    }
    const totalElapsed = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;
    const fieldSet = new Set<string>();
    for (const r of allData) for (const k of Object.keys(r)) fieldSet.add(k);
    sendToContent({
      type: "SCRAPE_COMPLETE",
      data: allData,
      fields: [...fieldSet],
      total: allData.length,
      pages: invoiceNumbers.length,
      elapsed: totalElapsed,
      source: lastCaptured.source,
    });
    isRunning = false;
  }

  /**
   * Fetch PDF document from DJP API
   */
  function xhrDownloadPdf(
    captured: CapturedRequest,
    row: any,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const url = captured.url.replace(
        "GetMyWithholdingSlip",
        "DownloadWithholdingSlips/download-pdf-document",
      );
      xhr.open("POST", url, true);

      for (const [k, v] of Object.entries(captured.headers)) {
        xhr.setRequestHeader(k, v);
      }

      xhr.timeout = TIMEOUT;

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const res = JSON.parse(xhr.responseText);
            if (
              res.IsSuccessful &&
              res.Payload &&
              res.Payload.Message &&
              res.Payload.Message.Data
            ) {
              resolve(res.Payload.Message.Data);
            } else {
              reject(
                new Error(
                  res.Message ||
                    (res.Payload &&
                      res.Payload.Message &&
                      res.Payload.Message.ErrorMessage) ||
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

      // Map identifiers from row to expected request body
      const capturedBody = captured.rawBody ? JSON.parse(captured.rawBody) : {};
      const body = {
        WithholdingSlipsAggregateIdentifier:
          row.WithholdingslipsAggregateIdentifier,
        WithholdingSlipsRecordIdentifier: row.RecordId,
        DocumentAggregateIdentifier: row.DocumentFormAggregateIdentifier,
        TaxpayerAggregateIdentifier: row.TaxpayerAggregateIdentifier,
        EbupotType: capturedBody.WithholdingType || "EBUPOTBPU",
        DocumentDate: row.WithholdingSlipsDate,
        TaxIdentificationNumber: row.TaxIdentificationNumber,
      };

      console.log("[Scraper] Mengirim request PDF dengan payload:", body);
      xhr.send(JSON.stringify(body));
    });
  }

  /**
   * Build the download PDF URL for efaktur pages.
   * API: einvoiceportal/api/DownloadInvoice/download-invoice-document
   */
  function buildEfakturDownloadUrl(
    capturedUrl: string,
    source: string,
  ): string {
    // Extract base: everything up to einvoiceportal/api/
    const baseMatch = capturedUrl.match(/(.*einvoiceportal\/api\/)/i);
    if (baseMatch) {
      return baseMatch[1] + "DownloadInvoice/download-invoice-document";
    }

    // Fallback: try to construct from origin + known path
    const originMatch = capturedUrl.match(/^(https?:\/\/[^/]+)/i);
    if (originMatch) {
      return (
        originMatch[1] +
        "/einvoiceportal/api/DownloadInvoice/download-invoice-document"
      );
    }

    return capturedUrl;
  }

  /**
   * Build the request body for efaktur PDF download.
   * Uses field names discovered from the DJP Coretax DownloadInvoice API.
   */
  function buildEfakturPdfBody(
    row: any,
    source: string,
    capturedBody: Record<string, unknown>,
  ): Record<string, unknown> {
    const menuType =
      source === "OUTPUT_TAX" || source === "OUTPUT_RETURN"
        ? "Outgoing"
        : "Incoming";

    const body = {
      EInvoiceRecordIdentifier:
        row.EInvoiceRecordIdentifier || row.RecordId || "",
      EInvoiceAggregateIdentifier:
        row.EInvoiceAggregateIdentifier || row.AggregateIdentifier || "",
      DocumentAggregateIdentifier:
        row.DocumentFormAggregateIdentifier ||
        row.DocumentAggregateIdentifier ||
        capturedBody.DocumentAggregateIdentifier ||
        "",
      TaxpayerAggregateIdentifier:
        row.TaxpayerAggregateIdentifier ||
        capturedBody.TaxpayerAggregateIdentifier ||
        "",
      LetterNumber: row.LetterNumber || row.TaxInvoiceNumber || "",
      DocumentDate: row.DocumentDate || row.TaxInvoiceDate || "",
      EInvoiceMenuType: menuType,
      TaxInvoiceStatus: row.TaxInvoiceStatus || "",
    };

    return body;
  }

  /**
   * Fetch PDF document from DJP API for efaktur pages
   * (Pajak Masukan, Pajak Keluaran, Retur)
   */
  function xhrDownloadEfakturPdf(
    captured: CapturedRequest,
    row: any,
    source: string,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const url = buildEfakturDownloadUrl(captured.url, source);
      xhr.open("POST", url, true);

      for (const [k, v] of Object.entries(captured.headers)) {
        xhr.setRequestHeader(k, v);
      }

      xhr.timeout = TIMEOUT;

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const res = JSON.parse(xhr.responseText);
            // PDF data: res.Content (top-level) or res.Payload.Message.Data
            const pdfData =
              res.Content ||
              (res.IsSuccessful && res.Payload?.Message?.Data) ||
              res.Payload?.Data ||
              res.Data;
            if (
              pdfData &&
              typeof pdfData === "string" &&
              pdfData.length > 100
            ) {
              resolve(pdfData);
            } else {
              reject(
                new Error(
                  res.Message ||
                    res.Payload?.Message?.ErrorMessage ||
                    "Gagal mengambil konten PDF (data kosong)",
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

      const capturedBody = captured.rawBody ? JSON.parse(captured.rawBody) : {};
      const body = buildEfakturPdfBody(row, source, capturedBody);

      console.log("[Scraper] Mengirim request PDF efaktur:", { url, body });
      xhr.send(JSON.stringify(body));
    });
  }

  function delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * Check if source is an efaktur page (for bulk PDF download)
   */
  function isEfakturSource(source: string): boolean {
    return (
      source === "OUTPUT_TAX" ||
      source === "INPUT_TAX" ||
      source === "OUTPUT_RETURN" ||
      source === "INPUT_RETURN"
    );
  }

  // ── Main scraping function ──────────────────────────

  async function startScraping(): Promise<void> {
    isRunning = true;
    console.log("[Scraper] ▶ Starting scrape...");

    try {
      sendToContent({
        type: "SCRAPE_PROGRESS",
        total: 0,
        page: 0,
        elapsed: "0s",
        status: "Menangkap request dari Angular...",
      });

      const captured = await interceptRequest();

      const allData: Record<string, unknown>[] = [];
      const seen = new Set<string>();
      let page = 0;
      let first = 0;
      let keepGoing = true;
      let errorCount = 0;
      let failureCount = 0; // Track PDF download failures for bulk operations
      const startTime = Date.now();

      const isSpt =
        captured.source === "SPT_A2" ||
        captured.source === "SPT_B2" ||
        captured.source.startsWith("PPH_21_");
      // Boost OutputTax (e-faktur) step to 500 per page and reduce delay to 100ms
      const step = isSpt ? 1000 : 500;
      const delayMs = isSpt ? 150 : 100;

      while (keepGoing && !stopRequested) {
        page++;
        try {
          const rows = await xhrRequest(captured, first, step);
          const newRows: Record<string, unknown>[] = [];

          for (const row of rows) {
            // Fallback identifier if RecordId/AggregateIdentifier is missing.
            const key =
              (row.RecordId as string) ||
              (row.AggregateIdentifier as string) ||
              JSON.stringify(row);
            if (!seen.has(key)) {
              seen.add(key);
              newRows.push(row);
              allData.push(row);
            }
          }

          const elapsed = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;

          console.log(
            `[Scraper] Page ${page}: ${rows.length} rows, ${newRows.length} new, total=${allData.length}, ${elapsed}`,
          );

          sendToContent({
            type: "SCRAPE_PROGRESS",
            total: allData.length,
            page,
            elapsed,
            status: `Page ${page}: ${rows.length} baris, ${newRows.length} baru`,
          });

          if (rows.length < step) {
            keepGoing = false;
          } else {
            first += step;
            errorCount = 0;
            await delay(delayMs);
          }
        } catch (err) {
          errorCount++;
          const errMsg = err instanceof Error ? err.message : String(err);
          if (errorCount >= MAX_ERRORS) {
            keepGoing = false;
            sendToContent({
              type: "SCRAPE_ERROR",
              message: `${MAX_ERRORS} error berturut-turut: ${errMsg}`,
            });
          } else {
            await delay(2000);
          }
        }
      }

      if (stopRequested) {
        console.log("[Scraper] ⏹ Stopped by user.");
        isRunning = false;
        return;
      }

      // Collect all fields
      const fieldSet = new Set<string>();
      for (const r of allData) {
        for (const k of Object.keys(r)) {
          fieldSet.add(k);
        }
      }

      const totalElapsed = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;

      console.log(
        `[Scraper] ✅ Complete: ${allData.length} records in ${totalElapsed}`,
      );

      let filenameHint =
        extractFilenameHintFromBody(captured.rawBody, captured.source) || "";

      // If body doesn't have it (PPh 21/26), try DOM header
      if (!filenameHint && captured.source.startsWith("PPH_21_")) {
        filenameHint = getMasaPajakFromDOM();
        console.log("[Scraper] Filename hint from DOM:", filenameHint);
      }

      if (captured.source === "WITHHOLDING_SLIPS") {
        // Special handling for Bulk PDF Download
        const total = allData.length;
        console.log(
          `[Scraper] Starting Bulk PDF download for ${total} items...`,
        );

        for (let i = 0; i < total; i++) {
          if (stopRequested) break;

          const row = allData[i];
          const status = `Mengunduh PDF ${i + 1}/${total}: ${row.WithholdingSlipNumber || "..."}`;

          sendToContent({
            type: "SCRAPE_PROGRESS",
            total: i + 1,
            page,
            elapsed: totalElapsed,
            status: status,
            currentIndex: i + 1,
            totalCount: total,
            failureCount: failureCount,
          });

          try {
            const base64 = await xhrDownloadPdf(captured, row);
            // Send the individual PDF to content script to trigger browser download
            window.postMessage(
              {
                type: "DOWNLOAD_PDF_ITEM",
                base64: base64,
                item: row,
                direction: "FROM_PAGE",
              },
              window.location.origin,
            );

            // Wait a bit between downloads to be safe
            await delay(800);
          } catch (err) {
            failureCount++;
            console.error(`[Scraper] Gagal unduh PDF idx ${i}:`, err);
            // Continue to next file even if one fails
          }
        }
      }

      sendToContent({
        type: "SCRAPE_COMPLETE",
        data: allData,
        fields: [...fieldSet],
        total: allData.length,
        pages: page,
        elapsed: totalElapsed,
        filenameHint: filenameHint || undefined,
        source: captured.source,
        failureCount: failureCount,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[Scraper] ❌ Error:", errMsg);

      sendToContent({
        type: "SCRAPE_ERROR",
        message: errMsg,
      });
    }

    console.log("[Scraper] ⏹ Scraping finished. isRunning=false");
    isRunning = false;
  }

  /**
   * Start bulk PDF download for efaktur pages using cached request data.
   * Called from main.ts after scrape completes or when data is already available.
   */
  async function startPdfDownload(
    data: Record<string, unknown>[],
  ): Promise<void> {
    if (!lastCaptured) {
      sendToContent({
        type: "SCRAPE_ERROR",
        message:
          "Tidak ada data request yang tersimpan. Silakan jalankan export terlebih dahulu.",
      });
      return;
    }

    isRunning = true;
    const source = lastCaptured.source;
    const startTime = Date.now();
    let failureCount = 0;
    const total = data.length;

    console.log(
      `[Scraper] ▶ Starting Bulk PDF download for ${total} efaktur items (source: ${source})...`,
    );

    sendToContent({
      type: "SCRAPE_PROGRESS",
      total: 0,
      page: 0,
      elapsed: "0s",
      status: `Memulai download ${total} PDF...`,
      currentIndex: 0,
      totalCount: total,
      failureCount: 0,
    });

    for (let i = 0; i < total; i++) {
      if (stopRequested) {
        console.log("[Scraper] ⏹ PDF download stopped by user.");
        break;
      }

      const row = data[i];
      const ref =
        (row.Reference as string) || (row.TaxInvoiceNumber as string) || "...";
      const status = `Mengunduh PDF ${i + 1}/${total}: ${ref}`;

      const elapsed = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;
      sendToContent({
        type: "SCRAPE_PROGRESS",
        total: i + 1,
        page: 0,
        elapsed,
        status,
        currentIndex: i + 1,
        totalCount: total,
        failureCount,
      });

      try {
        const base64 = await xhrDownloadEfakturPdf(lastCaptured, row, source);
        // Send the individual PDF to content script to trigger browser download
        window.postMessage(
          {
            type: "DOWNLOAD_PDF_ITEM",
            base64,
            item: row,
            source,
            direction: "FROM_PAGE",
          },
          window.location.origin,
        );

        // Wait between downloads to avoid rate limiting
        await delay(800);
      } catch (err) {
        failureCount++;
        console.error(
          `[Scraper] Gagal unduh PDF efaktur idx ${i} (${ref}):`,
          err,
        );
        // Continue to next file even if one fails
      }
    }

    const totalElapsed = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;
    console.log(
      `[Scraper] ✅ PDF download complete: ${total - failureCount}/${total} succeeded, ${failureCount} failed in ${totalElapsed}`,
    );

    sendToContent({
      type: "SCRAPE_COMPLETE",
      data,
      fields: [],
      total,
      pages: 0,
      elapsed: totalElapsed,
      source,
      failureCount,
    });

    isRunning = false;
  }

  // Signal that injected script is ready
  sendToContent({ type: "INJECTED_READY" });
})();
