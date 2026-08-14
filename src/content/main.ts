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
import type { ExportSource } from "./page-context";
import { shouldProcessPageMessage, createMessageDispatcher } from "./postmessage-guard";
import { generateBridgeToken, getBridgeToken, postToScraper } from "./bridge";
import {
  injectBadge,
  injectExportButton,
  injectGridFilters,
  injectMultiInvoiceFilter,
  isOutputTaxPage,
  isSupportedExportPage,
  removeExportButton,
  updatePanelComplete,
  updatePanelError,
  updatePanelIdle,
  updatePanelProgress,
  injectToolbarFilter,
  injectComparerModal,
  openComparerModal,
  runPendingCompare,
  splitInvoiceNumbers,
} from "./ui";
import { handlePdfDownload } from "./downloader";
import { registerShortcuts } from "./shortcuts";
import { debugLog, debugError } from "./debug";
import {
  handleExportAction,
  startScrape,
  triggerSearch,
  getIsRunning,
  setIsRunning,
  setScrapedData,
  setScrapedFields,
  setLastExportMeta,
  getPendingExportFormat,
  setPendingExportFormat,
  getPendingCompare,
  setPendingCompare,
  setLastState,
  setExportMode,
  resetState,
  type ScrapeState,
} from "./main-actions";

const DEBOUNCE_DELAY_MS = 300;
const GRID_FILTER_INJECT_DELAY_MS = 1500;

async function loadExportModePreference(): Promise<void> {
  try {
    const result = await browserAPI.storage.local.get(EXPORT_MODE_STORAGE_KEY);
    setExportMode(normalizeExportMode(result[EXPORT_MODE_STORAGE_KEY]));
  } catch (err) {
    debugError("Gagal membaca preferensi format export", err);
  }
}

browserAPI.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  const change = changes[EXPORT_MODE_STORAGE_KEY];
  if (!change) return;
  setExportMode(normalizeExportMode(change.newValue));
});
debugLog("Cindieh aktif");

let lastUrl = location.href;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

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

  const token = generateBridgeToken();
  const script = document.createElement("script");
  script.id = "__ch_scraper_injected__";
  script.src = `${browserAPI.runtime.getURL("content/scraper.js")}?token=${encodeURIComponent(token)}`;
  script.onload = () => {
    debugLog("Scraper injected into page context");
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
      setLastState(msg as unknown as ScrapeState);
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
      // resend START_SCRAPE so the two worlds stay in sync.
      if (getIsRunning()) {
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
      setIsRunning(false);
      setScrapedData(complete.data || null);
      // Only update fields if we got actual field data (PDF download sends empty fields)
      if (complete.fields && complete.fields.length > 0) {
        setScrapedFields(complete.fields);
      }
      setLastExportMeta({
        filenameHint: complete.filenameHint,
        source: complete.source,
      });
      updatePanelComplete(complete.total || 0, complete.pages || 0, complete.elapsed || "0s", complete.failureCount);
      setLastState(complete as unknown as ScrapeState);

      // If the user clicked "Periksa" before any data was scraped, run the
      // comparison automatically now that scraping is complete.
      if (getPendingCompare()) {
        setPendingCompare(false);
        runPendingCompare();
      }

      // Auto-export if a pending format was requested before scrape started.
      // The same interface the buttons use — one export decision tree.
      const pendingFormat = getPendingExportFormat();
      if (pendingFormat) {
        handleExportAction(pendingFormat);
        setPendingExportFormat(null);
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
      setIsRunning(false);
      setLastState(msg as unknown as ScrapeState);
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
  if (getIsRunning()) {
    postToScraper({ type: "STOP_SCRAPE" });
    setIsRunning(false);
    setPendingExportFormat(null);
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
  if (getIsRunning()) return; // Already running, don't restart
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
  resetState();

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
  registerShortcuts(() => getIsRunning());

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
