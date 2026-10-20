// ============================================================
// SCRAPER-INSTALL.TS — the MAIN world's install wiring, as a module
// ============================================================
// scraper.ts used to BE the wiring: one IIFE that read `document`,
// `location`, `window`, `XMLHttpRequest.prototype`,
// `HTMLAnchorElement.prototype` and `fetch` directly. Every decision
// inside it — the per-run context that binds a message to one runId
// and one page, what RESET_SCRAPER clears, the not-found latch, the
// teardown that restores each patch on its own — could therefore only
// be exercised by stubbing the whole page, which is why it carried the
// repo's lowest coverage (ADR-0038).
//
// The page is now ONE injected object. `installScraper(env)` does the
// installing and hands back its teardown; `scraper.ts` is the adapter
// that builds env from the globals it actually has and calls this
// once. Every decision above is driveable with a fake env, and the
// boot harness still proves the adapter wired the real prototypes.
//
// What has NOT changed: the patches themselves (scraper-xhr-patches,
// scraper-fetch, scraper-nets), the flows (scraper-actions), the
// context (scraper-context) and the message seam (postmessage-guard).
// This module is the wiring that used to be in the entry.
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
import { batchMonthCount, resumePeriodCodes } from "./scrape-batch";
import {
  startScraping,
  startPdfDownload,
  scrapeByInvoices,
} from "./scraper-actions";
import type { ScraperContext } from "./scraper-context";
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
import { createMessageDispatcher, type MessageEventLike } from "./postmessage-guard";
import { createScrapeRuns } from "./scraper-run";
import { readPacingFromPageWorld } from "./page-pacing";
import { REFERENCE_FIELD, REFERENCE_FAST_MATCH_MODE } from "./reference-search";

/**
 * Everything the install wiring needs from the page it is installing into.
 *
 * The module owns NO page handle of its own: `document`, the window (its
 * message channel, timers and `fetch`), and the two prototypes are all handed
 * in, which is what lets a test install the scraper over a fake page and drive
 * what used to be unreachable.
 */
export interface ScraperEnv {
  /** The page document: the token script, the grid anchors, the MASA PAJAK label. */
  document: Document;
  /**
   * The page window. It is also the guard's SOURCE reference — a message is
   * accepted only when `event.source` is this object — so it must be the real
   * window in production, not a copy.
   */
  window: {
    location: { href: string; origin: string };
    postMessage(message: unknown, origin: string): void;
    addEventListener(
      type: string,
      listener: (event: MessageEventLike) => void,
      options?: { once?: boolean },
    ): void;
    /** The popup save corridor the blob-anchor net's sibling guards. */
    open(url?: string | URL, target?: string, features?: string): WindowProxy | null;
    setTimeout(handler: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
    /** The page's own fetch, read once on install and handed back on teardown. */
    fetch: typeof globalThis.fetch;
  };
  /** Replace the page's fetch. Teardown calls it with the original. */
  setFetch(next: typeof globalThis.fetch): void;
  /** `XMLHttpRequest.prototype` — the three methods the patches replace. */
  xhrPrototype: XMLHttpRequest;
  /** `HTMLAnchorElement.prototype` — the blob-save net. */
  anchorPrototype: HTMLAnchorElement;
  /** Whether to expose the debug hook on the page (development builds only). */
  isDevelopment: boolean;
}

/** What an installed scraper can do: exactly one thing, stop being installed. */
export interface InstalledScraper {
  /** Restore every patched surface. Safe to call once; the pagehide listener does. */
  teardown(): void;
}

/**
 * Read the bridge token out of this script's own `src`, then take the `src`
 * away.
 *
 * The element itself stays in the DOM as the one-time injection marker:
 * injectScraper's getElementById guard then prevents a second scraper instance
 * on SPA navigation (zombie interceptors, ADR-0008). Removing `src` reduces the
 * token's DOM exposure without pretending it is secret — same-page scripts can
 * still observe it in message traffic (ADR-0007).
 */
function readBridgeToken(document: Document, location: { href: string }): string {
  try {
    const selfScript = document.getElementById("__ch_scraper_injected__") as HTMLScriptElement | null;
    if (!selfScript || !selfScript.src) return "";
    const url = new URL(selfScript.src, location.href);
    const token = url.searchParams.get("token") || "";
    selfScript.removeAttribute("src");
    return token;
  } catch {
    return "";
  }
}

/**
 * Install the MAIN world's scraper on this page.
 *
 * Order is load-bearing and identical to the IIFE it replaces: the token and
 * the capture state come first, because the XHR patches read them from the
 * moment they are installed; the response-sabotage nets are installed before
 * the interceptors that can trigger them; and the teardown is registered with
 * `pagehide` only after everything it has to restore exists.
 */
export function installScraper(env: ScraperEnv): InstalledScraper {
  const document = env.document;
  const win = env.window;
  const location = win.location;
  const TIMEOUT = 30000;
  const MAX_ERRORS = 3;

  const bridgeToken = readBridgeToken(document, location);

  const runs = createScrapeRuns();

  // ── Shared scraper context ─────────────────────────
  // Passed to action functions so they don't need to close over
  // this function's mutable variables directly.

  const ctx: ScraperContext = {
    // ── Orchestration ──────────────────────────────────
    isStopRequested: () => false,
    sendToContent,
    emitPdfDownload: (base64, item, source) => {
      try {
        win.postMessage(
          buildPdfDownloadMessage({ base64, item, source, token: bridgeToken }),
          location.origin,
        );
      } catch {
        // never let messaging errors stop the scraping loop
      }
    },
    getMasaPajakFromDOM,
    delay: (ms) => new Promise((resolve) => win.setTimeout(() => resolve(undefined), ms)),
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
    setTimeout: (fn, ms) => win.setTimeout(fn, ms),
    clearTimeout: (h) => win.clearTimeout(h as number),
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
        win.postMessage({
          ...buildPdfDownloadMessage({ base64, item, source, token: bridgeToken }),
          runId: run.id,
        }, location.origin);
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
    // The page window is the object `event.source` is compared against, so it
    // is the one handle the guard cannot be handed a copy of.
    selfWindow: win,
    handlers: {
      START_SCRAPE: (msg) => {
        runAction(msg, (runCtx) =>
          startScraping(() => makeInterceptRequest(runCtx), runCtx, {
            skipPdf: msg.skipPdf === true,
            batchMonths: batchMonthCount(msg.batchMonths),
            // The resume half of a sweep: codes shaped like period codes, then
            // narrowed against the portal's own year plan in scraper-actions.
            sweepPeriods: resumePeriodCodes(msg.sweepPeriods),
            sweepYear: typeof msg.sweepYear === "string" ? msg.sweepYear : undefined,
          }),
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
  win.addEventListener("message", (event) => messageDispatcher.handle(event));

  // ── sendToContent helper ───────────────────────────

  function sendToContent(msg: ScrapeMessage): void {
    try {
      win.postMessage({ ...msg, direction: "FROM_PAGE", token: bridgeToken }, location.origin);
    } catch {
      // Never let messaging errors stop the scraping loop
    }
  }

  // Expose for debugging convenience in development builds only. The adapter
  // decides whether this build is a development one; the minifier eliminates
  // the block in production because the flag is a constant there.
  if (env.isDevelopment) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (win as any).__scraperSendToContent = sendToContent;
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
      const el = document.querySelector(g.tag) as HTMLElement | null;
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
        const input = container.querySelector("input") as HTMLInputElement | null;
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
        win.postMessage(msg, location.origin);
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
  // regression coverage; this module keeps only the adapter and the teardown
  // call below.

  const downloadNets = createDownloadNets({
    session: pdfSession,
    anchorPrototype: env.anchorPrototype,
    windowTarget: win,
    log: debugLog,
  });
  downloadNets.install();

  // ── Fetch Interceptor ──────────────────────────────
  // The interceptor body lives in the extracted, testable module
  // (scraper-fetch.ts) so its "issue the request exactly once" contract has
  // regression coverage; this module keeps only the adapter. The XHR
  // interceptor below stays the primary path — Coretax normally downloads via
  // XHR.
  // SECURITY: the interceptor only inspects URLs matching the specific
  // Coretax download endpoint; all other fetch requests pass through.

  const origFetch = win.fetch;
  env.setFetch(createFetchDownloadInterceptor({
    originalFetch: origFetch,
    session: pdfSession,
    buildDummyResponse: buildSabotagedResponseJson,
  }));

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
  // module keeps only the adapter below and the teardown call, which restores
  // all three methods at once.
  //
  // Listener ordering is load-bearing: our response reader is registered at
  // open(), BEFORE the portal registers its own (which it does between open
  // and send). Wiring it in send() instead let the portal read the real
  // base64 first and save its own Coretax-named PDF alongside ours.

  const xhrPatches = createXhrPatches({
    xhrPrototype: env.xhrPrototype,
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
      ["fetch", () => env.setFetch(origFetch)],
    ];

    for (const [name, restore] of restores) {
      try {
        restore();
      } catch (err) {
        debugError(`[Cindieh] teardown failed for ${name}:`, err);
      }
    }
  }

  win.addEventListener("pagehide", teardownInterceptors, { once: true });

  // ── Request interceptor ────────────────────────────
  // Request interception for scraping delegates to the extracted,
  // testable module in scraper-intercept.ts (wired in the dispatcher above).

  // Signal that the injected script is ready
  sendToContent({ type: "INJECTED_READY" });

  return { teardown: teardownInterceptors };
}
