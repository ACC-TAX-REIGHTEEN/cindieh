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
import { type ExportData, exportXLSX, exportCSV } from "./exporter";
import { EXPORT_MODE_STORAGE_KEY, normalizeExportMode } from "../shared/export-preferences";
import type { ExportSource } from "./page-context";
import { shouldProcessPageMessage } from "./postmessage-guard";
import { generateBridgeToken, getBridgeToken, postToScraper } from "./bridge";
import {
  injectBadge,
  injectExportButton,
  injectGridFilters,
  injectMultiInvoiceFilter,
  isOutputTaxPage,
  isSupportedExportPage,
  removeExportButton,
  showPanel,
  updatePanelComplete,
  updatePanelError,
  updatePanelIdle,
  updatePanelProgress,
  injectToolbarFilter,
  injectComparerModal,
  openComparerModal,
  runPendingCompare,
} from "./ui";
import { handlePdfDownload } from "./downloader";
import { registerShortcuts } from "./shortcuts";
import { debugLog, debugError } from "./debug";
import {
  handleExportAction,
  applyMultiInvoiceFilter,
  startScrape,
  triggerSearch,
  getIsRunning,
  setIsRunning,
  getScrapedData,
  setScrapedData,
  getScrapedFields,
  setScrapedFields,
  getLastExportMeta,
  setLastExportMeta,
  getPendingExportFormat,
  setPendingExportFormat,
  getPendingCompare,
  setPendingCompare,
  getLastState,
  setLastState,
  getExportMode,
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
  };
  (document.head || document.documentElement).appendChild(script);
}

// ── Shared PDF Export ───────────────────────────────
// Filter → confirm → start download. Returns true if download was started.

function handlePdfExport(data: Record<string, unknown>[]): boolean {
  const filtered = applyMultiInvoiceFilter(data);
  if (filtered.length === 0) {
    alert("Tidak ada faktur yang cocok dengan filter No. Faktur.\nKosongkan filter atau periksa nomor faktur.");
    return false;
  }
  const total = filtered.length;
  if (total > 10) {
    const confirmed = window.confirm(
      `Anda akan mengunduh ${total} file PDF. Proses ini mungkin memakan waktu beberapa saat.\n\nFaktur yang sudah lama mungkin tidak bisa diunduh dan akan dilewati (skip).\n\nLanjutkan?`,
    );
    if (!confirmed) return false;
  }
  setIsRunning(true);
  showPanel();
  postToScraper({ type: "START_PDF_DOWNLOAD", data: filtered });
  return true;
}

// ── Relay: Popup → Content → Page ───────────────────
// Popup/background messages arrive through the extension message channel.
// postToScraper applies the bridge token when relaying into the page world.

browserAPI.runtime.onMessage.addListener(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (msg: Record<string, unknown>, _sender: unknown, sendResponse: (response?: any) => void) => {
    if (msg.type === "START_SCRAPE" || msg.type === "STOP_SCRAPE") {
      postToScraper(msg);
      if (msg.type === "START_SCRAPE") {
        setIsRunning(true);
        setLastState({
          type: "SCRAPE_PROGRESS",
          total: 0,
          page: 0,
          elapsed: "0s",
          status: "Menunggu...",
        });
      }
      sendResponse({ ok: true });
      return true;
    }

    if (msg.type === "GET_STATE") {
      sendResponse({ state: getLastState() });
      return true;
    }

    return false;
  },
);

// ── Relay: Page → Content → Popup + In-page panel ───

window.addEventListener("message", (event: MessageEvent) => {
  if (!shouldProcessPageMessage(event, getBridgeToken())) return;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { direction: _direction, ...cleanMsg } = event.data;

  // Store state for reconnection
  if (cleanMsg.type === "SCRAPE_PROGRESS" || cleanMsg.type === "SCRAPE_COMPLETE" || cleanMsg.type === "SCRAPE_ERROR") {
    setLastState(cleanMsg as ScrapeState);
  }

  // Update in-page panel
  if (cleanMsg.type === "SCRAPE_PROGRESS") {
    updatePanelProgress(cleanMsg.total || 0, cleanMsg.page || 0, cleanMsg.elapsed || "0s", cleanMsg.status || "");
  }

  if (cleanMsg.type === "INJECTED_READY") {
    // Scraper just finished initializing. If the user already requested a
    // scrape before the scraper was ready (message would have been lost),
    // resend START_SCRAPE so the two worlds stay in sync.
    if (getIsRunning()) {
      debugLog("Scraper ready; resending START_SCRAPE (was requested earlier)");
      postToScraper({ type: "START_SCRAPE" });
    }
  }

  if (cleanMsg.type === "SCRAPE_COMPLETE") {
    setIsRunning(false);
    setScrapedData(cleanMsg.data || null);
    // Only update fields if we got actual field data (PDF download sends empty fields)
    if (cleanMsg.fields && cleanMsg.fields.length > 0) {
      setScrapedFields(cleanMsg.fields);
    }
    setLastExportMeta({
      filenameHint: cleanMsg.filenameHint as string | undefined,
      source: cleanMsg.source as ExportSource | undefined,
    });
    updatePanelComplete(cleanMsg.total || 0, cleanMsg.pages || 0, cleanMsg.elapsed || "0s", cleanMsg.failureCount);

    // If the user clicked "Periksa" before any data was scraped, run the
    // comparison automatically now that scraping is complete.
    if (getPendingCompare()) {
      setPendingCompare(false);
      runPendingCompare();
    }

    // Auto-export if a pending format was requested before scrape started
    const pendingFormat = getPendingExportFormat();
    const data = getScrapedData();
    const fields = getScrapedFields();
    if (pendingFormat && data && fields) {
      if (pendingFormat === "pdf") {
        handlePdfExport(data);
      } else {
        const exportData: ExportData = {
          data,
          fields,
          filenameHint: getLastExportMeta()?.filenameHint,
          source: getLastExportMeta()?.source,
          mode: getExportMode(),
        };
        if (pendingFormat === "xlsx") {
          exportXLSX(exportData);
        } else {
          exportCSV(exportData);
        }
      }
      setPendingExportFormat(null);
    }
  }

  if (cleanMsg.type === "DOWNLOAD_PDF_ITEM") {
    const { base64, item, source } = cleanMsg;
    try {
      handlePdfDownload(base64, item as Record<string, unknown>, source);
    } catch (err) {
      debugError("Gagal memproses download file", err);
    }
  }

  if (cleanMsg.type === "SCRAPE_ERROR") {
    setIsRunning(false);
    updatePanelError(cleanMsg.message || "Error");
  }

  // Popup state is persisted via main-actions and storage; page messages
  // are reflected in the in-page panel here.
});

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
      const numbers = raw
        ? raw
          .split(/[\n;,]+|\s{2,}/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
        : [];

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
  if (!handleExportAction("pdf")) {
    handlePdfExport(getScrapedData()!);
  }
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
