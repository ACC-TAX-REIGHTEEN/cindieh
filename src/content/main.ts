// ============================================================
// MAIN.TS — Content Script Bridge (Isolated World)
// ============================================================
// Runs in ISOLATED world (has access to browser.runtime API).
// Injects scraper.ts (compiled) into the page's MAIN world.
// Relays messages: popup ↔ content.js ↔ scraper.js (page context)
// Also handles in-page export button UI events.
// Stores scrape state so popup can reconnect after being closed.
// ============================================================

import { browserAPI } from "./browser-shim";
import { EXPORT_MODE_STORAGE_KEY, normalizeExportMode } from "../shared/export-preferences";
import { isOutputTaxPage, isSupportedExportPage, type ExportSource } from "./page-context";
import { shouldProcessPageMessage, createMessageDispatcher } from "./postmessage-guard";
import { generateBridgeToken, getBridgeToken, postToScraper } from "./bridge";
import {
  injectBadge,
  updatePanelComplete,
  updatePanelError,
  updatePanelIdle,
  updatePanelProgress,
} from "./ui-badge";
import { injectComparerModal, openComparerModal, runPendingCompare } from "./ui-comparer";
import { injectGridFilters, injectMultiInvoiceFilter, injectToolbarFilter, splitInvoiceNumbers } from "./ui-filters";
import {
  injectExportButton,
  removeExportButton,
} from "./ui";
import { handlePdfDownload } from "./downloader";
import { registerShortcuts } from "./shortcuts";
import { debugLog, debugError } from "./debug";
import {
  handleExportAction,
  startScrape,
  triggerSearch,
  contentState,
  resetContentState,
  type ScrapeState,
} from "./main-actions";

const DEBOUNCE_DELAY_MS = 300;
const GRID_FILTER_INJECT_DELAY_MS = 1500;

async function loadExportModePreference(): Promise<void> {
  try {
    const result = await browserAPI.storage.local.get(EXPORT_MODE_STORAGE_KEY);
    contentState.exportMode = normalizeExportMode(result[EXPORT_MODE_STORAGE_KEY]);
  } catch (err) {
    debugError("Gagal membaca preferensi format export", err);
  }
}

browserAPI.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  const change = changes[EXPORT_MODE_STORAGE_KEY];
  if (!change) return;
  contentState.exportMode = normalizeExportMode(change.newValue);
});
debugLog("Cindieh aktif");

let lastUrl = location.href;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

// Rate-limit guard for the INJECTED_READY → START_SCRAPE resend (audit):
// after each scraper injection, resend a pending START_SCRAPE at most once,
// so a repeated INJECTED_READY (e.g. re-injection race) can't spam the
// scraper with duplicate start commands.
let scraperResendArmed = true;

const observer = new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    debugLog("URL changed to", url);
    if (debounceTimer) clearTimeout(debounceTimer);
    onNavigate();
    return;
  }

  if (!isSupportedExportPage()) return;

  // Debounce injections to avoid fighting with SPA/Angular rendering
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    if (isOutputTaxPage()) {
      injectToolbarFilter();
      injectGridFilters();
    }
    injectExportButton();
    injectMultiInvoiceFilter();
  }, DEBOUNCE_DELAY_MS);
});

observer.observe(document.body, { subtree: true, childList: true });

// ── Inject the scraper script into MAIN world ───────

function injectScraper(): void {
  if (document.getElementById("__ch_scraper_injected__")) return;

  // A fresh scraper instance is being created — allow exactly one
  // START_SCRAPE resend from its INJECTED_READY.
  scraperResendArmed = true;

  const token = generateBridgeToken();
  const script = document.createElement("script");
  script.id = "__ch_scraper_injected__";
  script.src = `${browserAPI.runtime.getURL("content/scraper.js")}?token=${encodeURIComponent(token)}`;
  script.onload = () => {
    debugLog("Scraper injected into page context");
    // Deliberately keep the element: scraper.ts stripped `src` (and with it
    // the token) as its first action, and the retained id makes injection
    // one-time per page — SPA navigation never spawns a second scraper
    // instance (ADR-0008).
  };
  script.onerror = () => {
    // Load failed (CSP/network): drop the element so injection can be
    // retried, which also removes the token-bearing src early.
    debugError("Gagal memuat scraper; elemen dihapus untuk percobaan ulang");
    script.remove();
  };
  (document.head || document.documentElement).appendChild(script);
}

// ── Relay: Page → Content → Popup + In-page panel ───
// One guard-then-dispatch seam (FROM_PAGE) for every message the
// scraper sends in. New message types register in the table.

const pageMessageDispatcher = createMessageDispatcher({
  direction: "FROM_PAGE",
  token: getBridgeToken,
  handlers: {
    SCRAPE_PROGRESS: (msg) => {
      contentState.lastState = msg as unknown as ScrapeState;
      updatePanelProgress(
        (msg.total as number) || 0,
        (msg.page as number) || 0,
        (msg.elapsed as string) || "0s",
        (msg.status as string) || "",
      );
    },

    INJECTED_READY: () => {
      // Scraper just finished initializing. If the user already requested a
      // scrape before the scraper was ready (message would have been lost),
      // resend START_SCRAPE so the two worlds stay in sync — at most once per
      // injection (guarded by scraperResendArmed) so repeated INJECTED_READY
      // can't fire duplicate START_SCRAPE / scrape restarts.
      if (contentState.isRunning && scraperResendArmed) {
        scraperResendArmed = false;
        debugLog("Scraper ready; resending START_SCRAPE (was requested earlier)");
        postToScraper({ type: "START_SCRAPE" });
      }
    },

    SCRAPE_COMPLETE: (msg) => {
      const complete = msg as unknown as {
        type: "SCRAPE_COMPLETE";
        data?: Record<string, unknown>[] | null;
        fields?: string[];
        total?: number;
        pages?: number;
        elapsed?: string;
        failureCount?: number;
        filenameHint?: string;
        source?: ExportSource;
      };
      contentState.isRunning = false;
      contentState.scrapedData = complete.data || null;
      // Only update fields if we got actual field data (PDF download sends empty fields)
      if (complete.fields && complete.fields.length > 0) {
        contentState.scrapedFields = complete.fields;
      }
      contentState.lastExportMeta = {
        filenameHint: complete.filenameHint,
        source: complete.source,
      };
      updatePanelComplete(complete.total || 0, complete.pages || 0, complete.elapsed || "0s", complete.failureCount);
      contentState.lastState = complete as unknown as ScrapeState;

      // If the user clicked "Periksa" before any data was scraped, run the
      // comparison automatically now that scraping is complete.
      if (contentState.pendingCompare) {
        contentState.pendingCompare = false;
        runPendingCompare();
      }

      // Auto-export if a pending format was requested before scrape started.
      // The same interface the buttons use — one export decision tree.
      const pendingFormat = contentState.pendingExportFormat;
      if (pendingFormat) {
        handleExportAction(pendingFormat);
        contentState.pendingExportFormat = null;
      }
    },

    DOWNLOAD_PDF_ITEM: (msg) => {
      const { base64, item, source } = msg;
      try {
        handlePdfDownload(base64 as string, item as Record<string, unknown>, source as string);
      } catch (err) {
        debugError("Gagal memproses download file", err);
      }
    },

    SCRAPE_ERROR: (msg) => {
      contentState.isRunning = false;
      contentState.lastState = msg as unknown as ScrapeState;
      updatePanelError((msg.message as string) || "Error");
    },
  },
});
window.addEventListener("message", (event) => pageMessageDispatcher.handle(event));

// ── Grid Filter Event ───────────────────────────────

document.addEventListener("keyup", (e: KeyboardEvent) => {
  const target = e.target as HTMLInputElement;
  if (!target) return;

  // Reference filter (existing)
  if (target.id === "ch-toolbar-filter-reference" || target.id === "ch-grid-filter-reference") {
    if (e.key === "Enter") {
      debugLog("Reference filter triggered via Enter");
      const value = target.value.trim();
      // Send the filter value (empty string clears the server filter) and
      // always trigger search so clearing the input restores all data.
      postToScraper({
        type: "SET_SERVER_FILTER",
        field: "Reference",
        value: value.toUpperCase(),
      });

      // Reference search is independent of scraping: just set the filter and
      // click the Coretax search button so the table renders the result.
      triggerSearch();
    }
  }

  // Multi-invoice filter textarea — just store values, no API filter
  if (target.id === "ch-multi-invoice-textarea") {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const raw = target.value.trim();
      const numbers = raw ? splitInvoiceNumbers(raw) : [];

      // Just update hint — no API filter, no search. Targeted scrape runs on Download PDF click.
      const hint = document.getElementById("ch-multi-invoice-count");
      if (hint) {
        hint.textContent = numbers.length > 0 ? `${numbers.length} nomor siap (klik Download PDF)` : "";
      }
    }
  }
});

// ── In-page button events ───────────────────────────

document.addEventListener("ch:scrape-toggle", () => {
  if (contentState.isRunning) {
    postToScraper({ type: "STOP_SCRAPE" });
    contentState.isRunning = false;
    contentState.pendingExportFormat = null;
    updatePanelIdle();
  } else {
    startScrape();
  }
});

// Export XLSX
document.addEventListener("ch:export-xlsx", () => {
  handleExportAction("xlsx");
});

// Export CSV
document.addEventListener("ch:export-csv", () => {
  handleExportAction("csv");
});

// Export PDF
document.addEventListener("ch:export-pdf", () => {
  handleExportAction("pdf");
});

// Auto-start scrape (only starts if not already running, never stops)
document.addEventListener("ch:scrape-start", () => {
  if (contentState.isRunning) return; // Already running, don't restart
  startScrape();
});

// Open compare modal
document.addEventListener("ch:compare-open", () => {
  openComparerModal();
});

// Search a reference in Coretax (from the comparer table)
document.addEventListener("ch:search-reference", (e: Event) => {
  const detail = (e as CustomEvent).detail as { reference?: string } | undefined;
  const reference = detail?.reference;
  if (!reference) return;

  debugLog("Searching reference:", reference);
  postToScraper({
    type: "SET_SERVER_FILTER",
    field: "Reference",
    value: reference.toUpperCase(),
  });

  // Reference search is independent of scraping: just set the filter and
  // click the Coretax search button so the table renders the result.
  triggerSearch();
});

// ── Init & Navigation ───────────────────────────────

function onNavigate(): void {
  debugLog("Navigate event triggered. Current URL:", window.location.href);

  // Reset content-script state so stale data from the previous page
  // cannot leak into exports on the new page.
  resetContentState(contentState, { preserveExportMode: true });

  // Ask the scraper (MAIN world) to reset its own state too:
  // captured request cache, filter state, running flags, etc.
  postToScraper({ type: "RESET_SCRAPER" });

  if (isSupportedExportPage()) {
    debugLog("Supported page detected, ensuring injection...");
    injectBadge();
    injectScraper();
    injectExportButton();
    injectMultiInvoiceFilter();
    injectComparerModal();
    if (isOutputTaxPage()) {
      injectToolbarFilter();
      setTimeout(() => {
        injectGridFilters();
      }, GRID_FILTER_INJECT_DELAY_MS);
    }
  } else {
    debugLog("Unrecognized page, removing tools if present.");
    removeExportButton();
  }
}

function init(): void {
  void loadExportModePreference();
  debugLog("Extension starting up on page...", window.location.href);
  injectBadge();
  injectScraper();
  registerShortcuts(() => contentState.isRunning);

  if (isSupportedExportPage()) {
    debugLog("Page match found on init.");
    injectExportButton();
    injectMultiInvoiceFilter();
    injectComparerModal();
    if (isOutputTaxPage()) {
      injectToolbarFilter();
      setTimeout(() => {
        injectGridFilters();
      }, GRID_FILTER_INJECT_DELAY_MS);
    }
  } else {
    debugLog("Page match not found on init.");
  }

  window.addEventListener("unhandledrejection", (event) => {
    debugError("Unhandled rejection:", event.reason);
  });

  window.addEventListener("error", (event) => {
    debugError("Global error:", event.message, "at", event.filename, ":", event.lineno);
  });
}

if (document.readyState === "complete") {
  init();
} else {
  window.addEventListener("load", init);
}

export { shouldProcessPageMessage };
