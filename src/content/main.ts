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
import { isOutputTaxPage, isSupportedExportPage } from "./page-context";
import { createMessageDispatcher } from "./postmessage-guard";
import { generateBridgeToken, getBridgeToken, getActiveRunId, isCurrentRunMessage, postToScraper } from "./bridge";
import { acceptScrapeResult, currentRunHandlers, invalidateScrapeResult, scrapeErrorMessage } from "./scrape-result";
import type { ScrapeComplete } from "./scraper-types";
import {
  injectBadge,
  updatePanelComplete,
  updatePanelError,

  updatePanelProgress,
  updatePanelStatus,
} from "./ui-badge";
import { injectComparerModal, openComparerModal, runPendingCompare, runPendingCheck } from "./ui-comparer";
import { injectGridFilters, injectMultiInvoiceFilter, injectToolbarFilter, splitInvoiceNumbers } from "./ui-filters";
import {
  injectExportButton,
  removeExportButton,
} from "./ui";
import { handlePdfDownload } from "./downloader";
import { registerShortcuts } from "./shortcuts";
import { applyDebugPreference, debugLog, debugError, DEBUG_STORAGE_KEY } from "./debug";
import {
  initDebugForPageWorld,
  mirrorDebugToPageWorld,
  normalizeDebugPreference,
} from "./debug-preference";
import { REFERENCE_FAST_MATCH_MODE, REFERENCE_FIELD } from "./reference-search";
import {
  handleExportAction,
  startScrape,
  triggerSearch,
  contentState,
  resetContentState,
  SCRAPE_CANCELLED_MESSAGE,
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

  const modeChange = changes[EXPORT_MODE_STORAGE_KEY];
  if (modeChange) contentState.exportMode = normalizeExportMode(modeChange.newValue);

  // Debug switch: apply in this tab right away so flipping the popup toggle
  // doesn't require reloading the portal page. `?chdebug` still wins. The page
  // mirror is rewritten too, so the MAIN-world scraper picks the switch up as
  // soon as its script is (re)injected — it resolves its flag at module load and
  // cannot read extension storage. `newValue` is undefined when the key was
  // removed, which normalizes to "no preference" and cleans the mirror up.
  const debugChange = changes[DEBUG_STORAGE_KEY];
  if (debugChange) {
    const storedDebug = normalizeDebugPreference(debugChange.newValue);
    applyDebugPreference(storedDebug);
    mirrorDebugToPageWorld(storedDebug);
  }
});

// Apply the popup's debug switch on startup and mirror it into the page world.
// The read is async, so log lines emitted synchronously right after this still
// use the build default; `injectScraper()` awaits this promise instead, so the
// scraper can never load before the mirror is written.
const debugPreferenceReady = initDebugForPageWorld();

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

async function injectScraper(): Promise<void> {
  if (document.getElementById("__ch_scraper_injected__")) return;

  // The scraper reads its log flag at module load and cannot see extension
  // storage, so the mirrored switch has to be in the page's storage BEFORE its
  // script runs — this await is what makes the popup switch reach it at all.
  await debugPreferenceReady;
  // Re-check: two injections can overlap across the await above.
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
    // Keep the id as the one-time injection marker (ADR-0008). Scraper
    // initialization removes src to reduce DOM exposure, not to guarantee
    // secrecy: same-page scripts can observe the token in message traffic.
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
  handlers: currentRunHandlers({
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
        postToScraper({ type: "START_SCRAPE", runId: getActiveRunId() });
      }
    },

    SCRAPE_COMPLETE: (msg) => {
      const complete = msg as unknown as ScrapeComplete;
      if (!acceptScrapeResult(contentState, complete)) {
        if (contentState.lastState?.type === "SCRAPE_ERROR") {
          updatePanelError(contentState.lastState.message);
        }
        return;
      }
      updatePanelComplete(complete.total || 0, complete.pages || 0, complete.elapsed || "0s");

      // If the user clicked "Periksa" before any data was scraped, run the
      // comparison automatically now that scraping is complete.
      if (contentState.pendingCompare) {
        contentState.pendingCompare = false;
        runPendingCompare();
      }

      if (contentState.pendingCheck) {
        contentState.pendingCheck = false;
        runPendingCheck();
      }

      // Auto-export if a pending format was requested before scrape started.
      // The same interface the buttons use — one export decision tree.
      const pendingFormat = contentState.pendingExportFormat;
      if (pendingFormat) {
        contentState.pendingExportFormat = null;
        handleExportAction(pendingFormat);
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
      const message = scrapeErrorMessage(typeof msg.message === "string" ? msg.message : undefined);
      invalidateScrapeResult(contentState, message);
      updatePanelError(message);
    },

    REFERENCE_FILTER_FALLBACK: (msg) => {
      // The scraper already switched the Reference filter to the wide match
      // mode, so the retry only needs the portal to ask again. It is slow by
      // nature (see reference-search.ts), hence the status line — otherwise the
      // wait looks like a hang.
      debugLog("Reference prefix search empty; retrying with contains for", msg.value);
      updatePanelStatus(
        `Referensi "${String(msg.value)}" tidak ditemukan sebagai awalan. Mencari ulang dengan pencocokan lebih luas — proses ini bisa memakan waktu lama.`,
      );
      triggerSearch();
    },
  }, isCurrentRunMessage),
});
window.addEventListener("message", (event) => pageMessageDispatcher.handle(event));

// ── Grid Filter Event ───────────────────────────────

/**
 * Run a reference search: set the server filter, then let the portal render the
 * result.
 *
 * The fast prefix mode goes first; `contains` can take minutes on the same data
 * and the scraper widens to it only when the prefix match came back empty (see
 * reference-search.ts). The value is uppercased because the server's Reference
 * filter is case-sensitive.
 */
function searchReference(value: string): void {
  postToScraper({
    type: "SET_SERVER_FILTER",
    field: REFERENCE_FIELD,
    value: value.trim().toUpperCase(),
    matchMode: REFERENCE_FAST_MATCH_MODE,
  });

  // Reference search is independent of scraping: just set the filter and
  // click the Coretax search button so the table renders the result.
  triggerSearch();
}

document.addEventListener("keyup", (e: KeyboardEvent) => {
  const target = e.target as HTMLInputElement;
  if (!target) return;

  // Reference filter
  if (target.id === "ch-toolbar-filter-reference" || target.id === "ch-grid-filter-reference") {
    if (e.key === "Enter") {
      debugLog("Reference filter triggered via Enter");
      // An empty value clears the server filter, and the search still runs so
      // clearing the input restores all data.
      searchReference(target.value);
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
    const message = SCRAPE_CANCELLED_MESSAGE;
    invalidateScrapeResult(contentState, message);
    updatePanelError(message);
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
  searchReference(reference);
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
    void injectScraper();
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
  void injectScraper();
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
