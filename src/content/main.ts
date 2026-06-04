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
import {
  injectBadge,
  injectExportButton,
  injectGridFilters,
  injectMultiInvoiceFilter,
  getMultiInvoiceNumbers,
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
import { debugLog, debugWarn, debugError } from "./debug";

debugLog("Better Coretax aktif");

// ── Types ────────────────────────────────────────────

interface ScrapeState {
  type: "SCRAPE_PROGRESS" | "SCRAPE_COMPLETE" | "SCRAPE_ERROR";
  total?: number;
  page?: number;
  pages?: number;
  elapsed?: string;
  status?: string;
  message?: string;
  data?: Record<string, unknown>[];
  fields?: string[];
}

// ── State storage (persists while page is open) ─────

let lastState: ScrapeState | null = null;
let isRunning = false;
let scrapedData: Record<string, unknown>[] | null = null;
let scrapedFields: string[] | null = null;
let lastExportMeta: { filenameHint?: string; source?: ExportSource } | null = null;

let lastUrl = location.href;
let debounceTimer: any = null;

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
  }, 300);
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
  (msg: Record<string, any>, _sender: any, sendResponse: (response?: any) => void) => {
    if (msg.type === "START_SCRAPE" || msg.type === "STOP_SCRAPE") {
      window.postMessage({ ...msg, direction: "FROM_CONTENT" }, window.location.origin);
      if (msg.type === "START_SCRAPE") {
        isRunning = true;
        lastState = {
          type: "SCRAPE_PROGRESS",
          total: 0,
          page: 0,
          elapsed: "0s",
          status: "Menunggu...",
        };
      }
      sendResponse({ ok: true });
      return true;
    }

    if (msg.type === "GET_STATE") {
      sendResponse({ state: lastState });
      return true;
    }

    return false;
  },
);

// ── Relay: Page → Content → Popup + In-page panel ───

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window) return;
  if (event.origin !== window.location.origin) return;
  if (!event.data || event.data.direction !== "FROM_PAGE") return;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { direction: _direction, ...cleanMsg } = event.data;

  // Store state for reconnection
  if (cleanMsg.type === "SCRAPE_PROGRESS" || cleanMsg.type === "SCRAPE_COMPLETE" || cleanMsg.type === "SCRAPE_ERROR") {
    lastState = cleanMsg as ScrapeState;
  }

  // Update in-page panel
  if (cleanMsg.type === "SCRAPE_PROGRESS") {
    updatePanelProgress(cleanMsg.total || 0, cleanMsg.page || 0, cleanMsg.elapsed || "0s", cleanMsg.status || "");
  }

  if (cleanMsg.type === "SCRAPE_COMPLETE") {
    isRunning = false;
    scrapedData = cleanMsg.data || null;
    // Only update fields if we got actual field data (PDF download sends empty fields)
    if (cleanMsg.fields && cleanMsg.fields.length > 0) {
      scrapedFields = cleanMsg.fields;
    }
    lastExportMeta = {
      filenameHint: cleanMsg.filenameHint as string | undefined,
      source: cleanMsg.source as ExportSource | undefined,
    };
    updatePanelComplete(cleanMsg.total || 0, cleanMsg.pages || 0, cleanMsg.elapsed || "0s", cleanMsg.failureCount);

    // Auto-export if a pending format was requested before scrape started
    if (pendingExportFormat && scrapedData && scrapedFields) {
      if (pendingExportFormat === "pdf") {
        const filtered = applyMultiInvoiceFilter(scrapedData);
        if (filtered.length === 0) {
          pendingExportFormat = null;
          alert("Tidak ada faktur yang cocok dengan filter No. Faktur.");
          return;
        }
        const total = filtered.length;
        if (total > 10) {
          const confirmed = window.confirm(
            `Anda akan mengunduh ${total} file PDF. Proses ini mungkin memakan waktu beberapa saat.\n\nFaktur yang sudah lama mungkin tidak bisa diunduh dan akan dilewati (skip).\n\nLanjutkan?`,
          );
          if (!confirmed) {
            pendingExportFormat = null;
            return;
          }
        }
        isRunning = true;
        window.postMessage(
          {
            type: "START_PDF_DOWNLOAD",
            data: filtered,
            direction: "FROM_CONTENT",
          },
          window.location.origin,
        );
      } else {
        const exportData: ExportData = {
          data: scrapedData,
          fields: scrapedFields,
          filenameHint: lastExportMeta?.filenameHint,
          source: lastExportMeta?.source,
        };
        if (pendingExportFormat === "xlsx") {
          exportXLSX(exportData);
        } else {
          exportCSV(exportData);
        }
      }
      pendingExportFormat = null;
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
    isRunning = false;
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

/** Helper: find and click the search/refresh button */
function triggerSearch(): void {
  const searchBtn = Array.from(document.querySelectorAll("button")).find((btn) => {
    const text = btn.textContent?.toLowerCase() || "";
    const hasIcon = !!btn.querySelector(".pi-search, .pi-refresh, .pi-filter");
    return text.includes("cari") || text.includes("refresh") || hasIcon;
  }) as HTMLButtonElement;

  if (searchBtn) {
    debugLog("Triggering search via button:", searchBtn.textContent?.trim());
    setTimeout(() => searchBtn.click(), 100);
  } else {
    debugWarn("Could not find search/refresh button");
  }
}

// ── In-page button events ───────────────────────────

document.addEventListener("ch:scrape-toggle", () => {
  if (isRunning) {
    // Stop
    window.postMessage({ type: "STOP_SCRAPE", direction: "FROM_CONTENT" }, window.location.origin);
    isRunning = false;
    pendingExportFormat = null;
    updatePanelIdle();
  } else {
    startScrape();
  }
});

// Pending export format: when set, auto-export after scrape completes
let pendingExportFormat: "xlsx" | "csv" | "pdf" | null = null;

/**
 * Common export action handler shared by XLSX, CSV, and PDF.
 * - Stops if already running
 * - Exports immediately if data is available (XLSX/CSV only; PDF returns false for caller to handle)
 * - Checks multi-invoice filter (XLSX/CSV) and starts invoice-targeted scrape if needed
 * - Otherwise sets pendingExportFormat and calls startScrape()
 *
 * Returns false when data is available for PDF (caller must handle filtering/confirmation).
 * Returns true otherwise (action was fully handled).
 */
function handleExportAction(format: "xlsx" | "csv" | "pdf"): boolean {
  if (isRunning) {
    window.postMessage({ type: "STOP_SCRAPE", direction: "FROM_CONTENT" }, window.location.origin);
    isRunning = false;
    pendingExportFormat = null;
    updatePanelIdle();
    return true;
  }

  if (scrapedData && scrapedFields) {
    // PDF: let caller handle filtering, confirmation, and download
    if (format === "pdf") return false;

    // XLSX / CSV: export immediately
    const exportData: ExportData = {
      data: scrapedData,
      fields: scrapedFields,
      filenameHint: lastExportMeta?.filenameHint,
      source: lastExportMeta?.source,
    };
    if (format === "xlsx") {
      exportXLSX(exportData);
    } else {
      exportCSV(exportData);
    }
    return true;
  }

  // No data yet — check multi-invoice filter (XLSX/CSV only)
  if (format !== "pdf") {
    const nums2 = getMultiInvoiceNumbers();
    if (nums2.length > 0) {
      debugLog("[BC] sending SCRAPE_BY_INVOICES", nums2);
      isRunning = true;
      showPanel();
      pendingExportFormat = "pdf";
      window.postMessage(
        {
          type: "SCRAPE_BY_INVOICES",
          invoiceNumbers: nums2,
          direction: "FROM_CONTENT",
        },
        window.location.origin,
      );
      return true;
    }
  }

  pendingExportFormat = format;
  startScrape();
  return true;
}

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
    // Data is available — apply PDF-specific filtering, confirmation, and download
    const filtered = applyMultiInvoiceFilter(scrapedData!);
    if (filtered.length === 0) {
      alert("Tidak ada faktur yang cocok dengan filter No. Faktur.\nKosongkan filter atau periksa nomor faktur.");
      return;
    }
    const total = filtered.length;
    if (total > 10) {
      const confirmed = window.confirm(
        "Anda akan mengunduh " +
          total +
          " file PDF. Proses ini mungkin memakan waktu beberapa saat.\n\nFaktur yang sudah lama mungkin tidak bisa diunduh dan akan dilewati (skip).\n\nLanjutkan?",
      );
      if (!confirmed) return;
    }
    isRunning = true;
    showPanel();
    window.postMessage(
      { type: "START_PDF_DOWNLOAD", data: filtered, direction: "FROM_CONTENT" },
      window.location.origin,
    );
  }
});

// Auto-start scrape (only starts if not already running, never stops)
document.addEventListener("ch:scrape-start", () => {
  if (isRunning) return; // Already running, don't restart
  startScrape();
});

function applyMultiInvoiceFilter(d: Record<string, unknown>[]): Record<string, unknown>[] {
  const nums = getMultiInvoiceNumbers();
  if (nums.length === 0) return d;
  const set = new Set(nums.map((n) => n.toLowerCase()));
  return d.filter((r) => set.has(String(r.TaxInvoiceNumber || r.LetterNumber || "").toLowerCase()));
}

function startScrape(): void {
  showPanel();
  isRunning = true;
  scrapedData = null;
  scrapedFields = null;
  lastExportMeta = null;
  lastState = {
    type: "SCRAPE_PROGRESS",
    total: 0,
    page: 0,
    elapsed: "0s",
    status: "Menunggu...",
  };
  updatePanelProgress(0, 0, "0s", "Menangkap request dari Angular...");
  window.postMessage({ type: "START_SCRAPE", direction: "FROM_CONTENT" }, window.location.origin);
}

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
      }, 1500);
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
  registerShortcuts(() => isRunning);

  if (isSupportedExportPage()) {
    debugLog("Page match found on init.");
    injectExportButton();
    injectMultiInvoiceFilter();
    if (isOutputTaxPage()) {
      injectToolbarFilter();
      setTimeout(() => {
        injectGridFilters();
      }, 1500);
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
