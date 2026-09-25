// ============================================================
// SCRAPER.TS — Runs in PAGE context (MAIN world)
// ============================================================
// Injected by main.ts into the page to access Angular's XHR.
// Communicates with content script via window.postMessage.
//
// Responsibilities of this file:
//   1. Read the bridge token from our own <script> src URL.
//   2. Monkey-patch XHR / fetch / anchor clicks / window.open to
//      intercept Coretax requests and block duplicate native downloads.
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
import { debugLog, debugError } from "./debug";
import type { CapturedRequest, ScrapeMessage } from "./scraper-types";
import {
  startScraping,
  startPdfDownload,
  scrapeByInvoices,
  type ScraperContext,
} from "./scraper-actions";
import { interceptRequest as makeInterceptRequest } from "./scraper-intercept";
import {
  buildPdfDownloadMessage,
  buildSabotagedResponseJson,
  createPdfDownloadSession,
  wireNativeDownloadXhrListener,
} from "./scraper-pdf";
import { createFetchDownloadInterceptor } from "./scraper-fetch";
import { createDownloadNets } from "./scraper-nets";
import { createXhrPatches, type FilterState } from "./scraper-xhr-patches";
import { createMessageDispatcher } from "./postmessage-guard";
import { createScrapeRuns } from "./scraper-run";
import { readPacingFromPageWorld } from "./page-pacing";
import { REFERENCE_FIELD, REFERENCE_FAST_MATCH_MODE } from "./reference-search";

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
    // Read per run, not at module load: the popup's pacing choice then applies
    // to the next export in an already-open tab, without a reload.
    getPacing: readPacingFromPageWorld,

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
        runAction(msg, (runCtx) =>
          startScraping(() => makeInterceptRequest(runCtx), runCtx, { skipPdf: msg.skipPdf === true }),
        );
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
          // A new search re-arms the not-found latch below (ADR-0012).
          reportedMisses.delete(field);
          filterState[field] = {
            value,
            // Arrays are identity lookups (No. Faktur); a string takes the
            // caller's mode, defaulting to the wide match older callers expect.
            matchMode: Array.isArray(value)
              ? "equals"
              : typeof msg.matchMode === "string" && msg.matchMode
                ? msg.matchMode
                : "contains",
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
  // so the download interceptors (fetch and XHR) can resolve item metadata
  // for PDF filenames.
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

  // ── Native-download safety nets ────────────────────
  // The PRIMARY double-download block is the response sabotage itself
  // (failure dummy in the fetch/XHR interceptors): the portal takes its
  // error branch and never builds a file. These two patches are BACKUP
  // nets for the corridor where the portal would save a PDF if the
  // sabotage ever failed (defineProperty refusal, unparseable response,
  // unexpected event order). Each covers one corridor:
  //   1. Blob-anchor save:  Blob → createObjectURL → a.click()
  //   2. Popup save:        window.open(blobUrl)
  // createObjectURL is deliberately NOT patched: it sits on the same
  // corridor as the anchor net (blocking either link of the chain stops
  // the save), and unlike the anchor net it never self-resets, so it
  // blocked every legitimate PDF blob on the page for the whole 5s window.
  // The window.open net only blocks blob: opens for the same reason —
  // blanket blocking silently killed unrelated user popups for 5s.
  //
  // Both net bodies live in the extracted, testable module
  // (scraper-nets.ts) so their block/pass-through/self-reset behaviour has
  // regression coverage; this file keeps only the adapter and the teardown
  // call below.

  const downloadNets = createDownloadNets({
    session: pdfSession,
    anchorPrototype: HTMLAnchorElement.prototype,
    windowTarget: window,
    log: debugLog,
  });
  downloadNets.install();

  // ── Fetch Interceptor ──────────────────────────────
  // The interceptor body lives in the extracted, testable module
  // (scraper-fetch.ts) so its "issue the request exactly once" contract has
  // regression coverage; this file keeps only the adapter. The XHR interceptor
  // below stays the primary path — Coretax normally downloads via XHR.
  // SECURITY: the interceptor only inspects URLs matching the specific
  // Coretax download endpoint; all other fetch requests pass through.

  const origFetch = window.fetch;
  window.fetch = createFetchDownloadInterceptor({
    originalFetch: origFetch,
    session: pdfSession,
    buildDummyResponse: buildSabotagedResponseJson,
  });

  // ── Filter state & request cache ──────────────────

  const filterState: FilterState = {};
  const captureSubscribers: ((req: CapturedRequest) => void)[] = [];
  // Fields whose empty prefix response already sent a not-found notice; each
  // new SET_SERVER_FILTER re-arms it, so one search reports at most once.
  const reportedMisses = new Set<string>();
  let lastCaptured: CapturedRequest | null = null;
  let lastCapturedTime = 0;

  // ── XHR prototype patches (P2/P3/P4) ───────────────
  // The three patch bodies live in the extracted, testable module
  // (scraper-xhr-patches.ts) so filter injection, grid capture, and the
  // open()-time listener ordering have their own regression coverage. This
  // file keeps only the adapter below and the teardown call, which restores
  // all three methods at once.
  //
  // Listener ordering is load-bearing: our response reader is registered at
  // open(), BEFORE the portal registers its own (which it does between open
  // and send). Wiring it in send() instead let the portal read the real
  // base64 first and save its own Coretax-named PDF alongside ours.

  const xhrPatches = createXhrPatches({
    xhrPrototype: XMLHttpRequest.prototype,
    session: pdfSession,
    wireNativeDownloadListener: (xhr) => wireNativeDownloadXhrListener(xhr, pdfSession),
    getFilterState: () => filterState,
    getPageSource: () => getPageExportSource(),
    inferSource: (url) => inferCapturedSource(url),
    invoiceRowMap,
    onCaptured: (captured) => {
      // An empty response to a Reference prefix search ends the search with a
      // one-shot not-found notice — no wide-match retry (ADR-0012).
      const referenceFilter = filterState[REFERENCE_FIELD];
      if (
        !runs.isRunning() &&
        referenceFilter &&
        !reportedMisses.has(REFERENCE_FIELD) &&
        referenceFilter.matchMode === REFERENCE_FAST_MATCH_MODE &&
        typeof referenceFilter.value === "string" &&
        referenceFilter.value !== "" &&
        captured.initialData.length === 0
      ) {
        reportedMisses.add(REFERENCE_FIELD);
        debugLog("Reference prefix search found no rows");
        sendToContent({ type: "REFERENCE_SEARCH_NOT_FOUND", value: referenceFilter.value });
      }
      // Capture subscribers are one-shot: taken, then drained.
      const subs = [...captureSubscribers];
      captureSubscribers.length = 0;
      subs.forEach((s) => s(captured));
    },
    logError: debugError,
  });
  xhrPatches.install();

  // ── Teardown ───────────────────────────────────────
  // Restore all monkey-patched globals on full page unload.
  // (SPA navigations keep the patch active intentionally.)

  function teardownInterceptors(): void {
    // Each surface is restored on its own so one refused assignment — say the
    // portal redefined a prototype method as non-writable after we patched it —
    // cannot strand the other patches for the rest of the page's life. Guarded
    // by scraper-boot.unit.test.ts through a throwing property setter.
    const restores: [name: string, restore: () => void][] = [
      ["XHR prototype patches", () => xhrPatches.restore()],
      ["download nets", () => downloadNets.restore()],
      [
        "fetch",
        () => {
          window.fetch = origFetch;
        },
      ],
    ];

    for (const [name, restore] of restores) {
      try {
        restore();
      } catch (err) {
        debugError(`[Cindieh] teardown failed for ${name}:`, err);
      }
    }
  }

  window.addEventListener("pagehide", teardownInterceptors, { once: true });

  // ── Request interceptor ────────────────────────────
  // Request interception for scraping delegates to the extracted,
  // testable module in scraper-intercept.ts (wired in the dispatcher above).

  // Signal that the injected script is ready
  sendToContent({ type: "INJECTED_READY" });
})();
