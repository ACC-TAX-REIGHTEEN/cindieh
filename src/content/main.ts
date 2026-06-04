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
import type { ExportSource } from "./page-context";
import { shouldProcessPageMessage } from "./postmessage-guard";
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
  getLastState,
  setLastState,
  type ScrapeState,
} from "./main-actions";

const DEBOUNCE_DELAY_MS = 300;
const GRID_FILTER_INJECT_DELAY_MS = 1500;

debugLog("Better Coretax aktif");

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

  const script = document.createElement("script");
  script.id = "__ch_scraper_injected__";
  script.src = browserAPI.runtime.getURL("content/scraper.js");
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
  window.postMessage({ type: "START_PDF_DOWNLOAD", data: filtered, direction: "FROM_CONTENT" }, window.location.origin);
  return true;
}

// ── Helper: safely send message to popup ────────────

function sendToPopup(msg: Record<string, unknown>): void {
  try {
    browserAPI.runtime.sendMessage(msg).catch(() => {
      // Popup closed or extension context invalidated
    });
  } catch {
    // Extension context invalidated or popup closed
  }
}

// ── Relay: Popup → Content → Page ───────────────────

browserAPI.runtime.onMessage.addListener(
  (msg: Record<string, unknown>, _sender: unknown, sendResponse: (response?: any) => void) => {
    if (msg.type === "START_SCRAPE" || msg.type === "STOP_SCRAPE") {
      window.postMessage({ ...msg, direction: "FROM_CONTENT" }, window.location.origin);
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
  if (!shouldProcessPageMessage(event)) return;

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

  // Forward to popup
  sendToPopup(cleanMsg);
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
      window.postMessage(
        {
          type: "SET_SERVER_FILTER",
          field: "Reference",
          value: value.toUpperCase(),
          direction: "FROM_CONTENT",
        },
        window.location.origin,
      );
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
    // Stop
    window.postMessage({ type: "STOP_SCRAPE", direction: "FROM_CONTENT" }, window.location.origin);
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

// ── Init & Navigation ───────────────────────────────

function onNavigate(): void {
  debugLog("Navigate event triggered. Current URL:", window.location.href);
  if (isSupportedExportPage()) {
    debugLog("Supported page detected, ensuring injection...");
    injectBadge();
    injectScraper();
    injectExportButton();
    injectMultiInvoiceFilter();
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
  debugLog("Extension starting up on page...", window.location.href);
  injectBadge();
  injectScraper();
  registerShortcuts(() => getIsRunning());

  if (isSupportedExportPage()) {
    debugLog("Page match found on init.");
    injectExportButton();
    injectMultiInvoiceFilter();
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
