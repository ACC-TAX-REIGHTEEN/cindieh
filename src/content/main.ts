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
import { EXPORT_MODE_STORAGE_KEY, normalizeExportMode, type StoredExportMode } from "../shared/export-preferences";
import { getPageExportSource, hasReferenceFilter, isSupportedExportPage } from "./page-context";
import { createMessageDispatcher } from "./postmessage-guard";
import { generateBridgeToken, getBridgeToken, getActiveRunId, isCurrentRunMessage, isStoppedRunMessage, postToScraper } from "./bridge";
import {
  currentRunHandlers,
  failedItemsNotice,
  batchResultNotice,
  stoppedSweepMessage,
  restoredSweepMessage,
  scrapeErrorMessage,
  truncatedResultNotice,
} from "./scrape-result";
import { runLifecycle } from "./run-lifecycle";
import { snapshotAppliesTo, sweepSnapshotStore, type SweepSnapshot } from "./sweep-snapshot";
import { mergePeriodSummaries } from "./scrape-batch";
import { unionRows } from "./scraper-helpers";
import type { ScrapeComplete, ScrapeDataChunkMessage } from "./scraper-types";
import {
  addResultChunk,
  createResultChunkBuffer,
  missingResultChunks,
  resetResultChunks,
  resolveResultRows,
} from "./result-chunks";
import {
  destroyBadge,
  injectBadge,
  showPanel,
  updatePanelComplete,
  updatePanelError,
  updatePanelIdle,

  updatePanelProgress,
  updatePanelStatus,
} from "./ui-badge";
import {
  dropPendingCompare,
  injectComparerModal,
  removeMenusOutsideClickHandler,
  runPendingCompare,
} from "./ui-comparer";
import { dropPendingCheck, runPendingCheck } from "./ui-checker";
import { openPanel } from "./ui-panel";
import {
  clearFilterTimers,
  injectGridFilters,
  injectMultiInvoiceFilter,
  injectToolbarFilter,
  splitInvoiceNumbers,
} from "./ui-filters";
import {
  injectExportButton,
  removeExportButton,
  setExportFormatDefault,
  setOneClickExport,
} from "./ui";
import { handlePdfDownload } from "./downloader";
import { registerShortcuts } from "./shortcuts";

/**
 * Removes the keyboard-shortcut listener, or null while none is installed.
 *
 * Held here rather than inside shortcuts.ts so the listener's lifetime follows
 * the page state: applyPageState() installs it when the extension is on and
 * drops it on teardown, which is the only way the two can be kept in step. A
 * document-level listener that outlives the toolbar is exactly the half-removed
 * state teardownInjectedUi() exists to prevent.
 */
let unregisterShortcuts: (() => void) | null = null;

function startShortcuts(): void {
  // Re-registering without unregistering first would leave two listeners on
  // document, and one Ctrl+Shift+E would then toggle twice -- i.e. not at all.
  unregisterShortcuts?.();
  unregisterShortcuts = registerShortcuts(
    () => runLifecycle.isRunning(),
    () => extensionEnabled,
  );
}

function stopShortcuts(): void {
  unregisterShortcuts?.();
  unregisterShortcuts = null;
}
import {
  applyDebugPreference,
  debugLog,
  debugWarn,
  debugError,
  DEBUG_STORAGE_KEY,
} from "./debug";
import {
  initDebugForPageWorld,
  mirrorDebugToPageWorld,
  normalizeDebugPreference,
} from "./debug-preference";
import {
  getPreferences,
  preferencesFromChanges,
  readPreferences,
  RESET_SCRAPER_REQUEST_KEY,
  setPreferences,
} from "./preferences";
import { mirrorPacingToPageWorld } from "./page-pacing";
import { REFERENCE_FAST_MATCH_MODE, REFERENCE_FIELD } from "./reference-search";
import { describeCompletion, publishCompletion, SHOW_PANEL_REQUEST_KEY } from "./completion-notice";
import {
  createActionDeps,
  handleExportAction,
  startBatchExport,
  startScrape,
  stopRun,
  triggerSearch,
  scrapeIntentForFormat,
} from "./main-actions";

const DEBOUNCE_DELAY_MS = 300;
const GRID_FILTER_INJECT_DELAY_MS = 1500;

/**
 * Elements other modules own but that a master-switch teardown must also
 * remove. Kept as an id list because each one is a top-level element with a
 * stable id; the grid filter is handled separately (its input sits inside a
 * container the portal's table owns).
 */
const TEARDOWN_ELEMENT_IDS = [
  "ch-comparer-overlay",
  "ch-comparer-modal",
  "ch-multi-invoice-toggle",
  "ch-multi-invoice-filter",
  "ch-toolbar-filter-reference",
] as const;

// ── Preferences (popup controls) ─────────────────────
// `extensionEnabled` starts false so nothing is painted before the stored
// preference is known — a disabled extension must never flash a toolbar into
// the page, the same reason injectScraper() awaits the debug mirror. The
// synchronous action paths read the snapshot in preferences.ts instead, which
// readPreferences() has already seeded by the time any button can be clicked.
let extensionEnabled = false;

/**
 * The stored export mode. It is not run state (ADR-0014): it belongs to the
 * popup's EXPORT_MODE_STORAGE_KEY and is maintained by the storage listener
 * below, so the action handlers read it through the deps this builds.
 */
let exportMode: StoredExportMode = "cleaned";

/** Production ActionDeps, built once with the export mode as a live read. */
const actionDeps = createActionDeps(() => exportMode);

const preferencesReady = readPreferences().then((loaded) => {
  extensionEnabled = loaded.enabled;
  mirrorPacingToPageWorld(loaded.delayPreset);
  setExportFormatDefault(loaded.exportFormat);
  setOneClickExport(loaded.oneClickExport);
  return loaded;
});

async function loadExportModePreference(): Promise<void> {
  try {
    const result = await browserAPI.storage.local.get(EXPORT_MODE_STORAGE_KEY);
    exportMode = normalizeExportMode(result[EXPORT_MODE_STORAGE_KEY]);
  } catch (err) {
    debugError("Gagal membaca preferensi format export", err);
  }
}

browserAPI.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;

  const modeChange = changes[EXPORT_MODE_STORAGE_KEY];
  if (modeChange) exportMode = normalizeExportMode(modeChange.newValue);

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

  // "Bersihkan cache" from the popup: same storage seam as everything else the
  // popup asks this tab to do (ADR-0002), so no messaging channel is needed.
  if (changes[RESET_SCRAPER_REQUEST_KEY]) clearScraperCache();

  // A clicked completion toast bringing this tab forward also asks the panel to
  // open: the bar is the only place the reason for the notification is spelled
  // out, and the user may have collapsed it after the run failed.
  if (changes[SHOW_PANEL_REQUEST_KEY]) showPanel();

  const preferencePatch = preferencesFromChanges(changes);
  if (Object.keys(preferencePatch).length === 0) return;
  const applied = setPreferences(preferencePatch);

  // Pacing is mirrored rather than carried on each command, because the delays
  // are applied in the MAIN world, which cannot read extension storage.
  if (preferencePatch.delayPreset !== undefined) mirrorPacingToPageWorld(applied.delayPreset);
  if (preferencePatch.exportFormat !== undefined) setExportFormatDefault(applied.exportFormat);
  if (preferencePatch.oneClickExport !== undefined) setOneClickExport(applied.oneClickExport);

  // The master switch is applied last, so a tab that is being switched off is
  // torn down with the rest of the new preferences already in place.
  if (preferencePatch.enabled !== undefined) {
    extensionEnabled = applied.enabled;
    if (extensionEnabled) {
      applyPageState();
      // Re-enabling is a fresh paint, not a fresh page: a half-sweep read while
      // the extension was off is still offerable now.
      offerResumableSweep();
    } else {
      teardownInjectedUi();
    }
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

// The chunks of the result transfer in flight. One at a time: the
// completion that follows a transfer empties it, so a second transfer
// can never interleave with the first.
const resultChunks = createResultChunkBuffer();

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
  // A disabled extension keeps tracking URL changes (so re-enabling works) but
  // must not paint anything back into the page.
  if (!extensionEnabled) return;

  // Debounce injections to avoid fighting with SPA/Angular rendering
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    // Both surfaces of the Referensi filter — the toolbar box and the grid
    // column — belong to the grids that HAVE a Referensi column, which is not
    // the same question as whether a Referensi identifies a row there.
    if (hasReferenceFilter()) {
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
  if (!extensionEnabled) return;
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

/**
 * Announce a run that did NOT complete — a hard failure or a result rejected as
 * partial/cancelled. The success path publishes inline; these paths used to
 * return first, so a user who opted in only ever heard about runs that went
 * well, which is backwards: the panel is least likely to be watched when a long
 * download dies. Opt-in gate and storage hand-off live in completion-notice.ts.
 * The page href rides along so a click on the toast returns to this exact grid.
 */
function publishIncomplete(message: string): void {
  if (getPreferences().notifyOnComplete) {
    void publishCompletion("error", message, Date.now(), location.href);
  }
}

/**
 * The page messages this world acts on: the current Run's own traffic, plus the
 * stop report of the Run that STOP_SCRAPE just retired.
 *
 * A stopped year-wide sweep produces its report AFTER the stop, out of rows it
 * already had, so it necessarily arrives under the id the stop retired — the
 * alternative was throwing away the masa that had already finished (see
 * scraper-actions.ts and ADR-0020). The window is exactly as wide as that
 * report: the chunk stream a large result travels in (ADR-0017) plus the
 * completion that names how many chunks must arrive. Admitting only the
 * completion would leave the assembly empty and turn a kept sweep into
 * "transfer hasil tidak lengkap" — precisely the large taxpayer the salvage
 * exists for. Both are matched against the retired id, so any other late
 * message from a cancelled run cannot pose as the current Run's.
 */
function isAcceptedPageMessage(msg: Record<string, unknown>): boolean {
  if (msg.type === "SCRAPE_DATA_CHUNK") return isCurrentRunMessage(msg) || isStoppedRunMessage(msg);
  if (msg.type === "SCRAPE_COMPLETE" && msg.cancelled === true) return isStoppedRunMessage(msg);
  return isCurrentRunMessage(msg);
}

const pageMessageDispatcher = createMessageDispatcher({
  direction: "FROM_PAGE",
  token: getBridgeToken,
  handlers: currentRunHandlers({
    SCRAPE_PROGRESS: (msg) => {
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
      if (runLifecycle.isRunning() && scraperResendArmed) {
        scraperResendArmed = false;
        debugLog("Scraper ready; resending START_SCRAPE (was requested earlier)");
        // Repeat the original request's intent (see scrapeIntentForFormat): a
        // data-only export on a withholding page must not turn into a bulk PDF
        // download just because the first message arrived before the scraper did.
        postToScraper({
          type: "START_SCRAPE",
          ...scrapeIntentForFormat(runLifecycle.pendingExport()),
          runId: getActiveRunId(),
        });
      }
    },

    SCRAPE_DATA_CHUNK: (msg) => {
      addResultChunk(resultChunks, msg as unknown as ScrapeDataChunkMessage);
    },

    SCRAPE_COMPLETE: (msg) => {
      const complete = msg as unknown as ScrapeComplete;
      const expected = complete.dataChunks;
      const rows = resolveResultRows(resultChunks, complete);
      const missing = expected === undefined ? [] : missingResultChunks(resultChunks, expected);
      resetResultChunks(resultChunks);

      if (rows === null) {
        // The transfer lost a chunk. Exporting what did arrive would be
        // indistinguishable from a short grid, which is the one thing
        // the truncated-export notice exists to rule out.
        const message =
          `Transfer hasil tidak lengkap: ${missing.length} bagian data tidak diterima. ` +
          "Coba ekspor kembali.";
        debugError(message);
        updatePanelError(message);
        publishIncomplete(message);
        return;
      }

      // A completion that carries per-masa counts is a year-wide sweep, and the
      // rows already on hand may be the kept half of one a stop salvaged: this is
      // the resume, so the union is what settles, what the panel reports and what
      // the file will hold (ADR-0023). Both guards matter — a completion with no
      // counts is not a sweep, and a Run with no kept counts has nothing to be
      // resumed against (a fresh sweep starts from nothing on purpose).
      const kept = runLifecycle.result();
      const resuming = Boolean(complete.periods && kept?.sweep);
      const mergedRows = resuming ? unionRows(kept?.data ?? [], rows) : rows;
      const settled: ScrapeComplete = {
        ...complete,
        data: mergedRows,
        total: mergedRows.length,
        periods:
          resuming && kept?.sweep && complete.periods
            ? {
                ...mergePeriodSummaries(kept.sweep, complete.periods),
                // The union's two halves were counted by two independent
                // accumulators, so their counts can overlap where a failed masa
                // had already collected rows that the resumed retry fetched
                // again. The panel names what the FILE holds, which is the
                // deduplicated union (ADR-0016), not the sum of the counts.
                totalRows: mergedRows.length,
              }
            : complete.periods,
      };

      const outcome = runLifecycle.complete(settled);

      if (outcome.kind === "salvaged") {
        // A stopped sweep: the Run kept the months that finished (the flag is
        // what decides that, in run-lifecycle), so the panel replaces its own
        // cancellation line with how much of the year survived. Nothing runs
        // automatically, and an export the user then asks for names the file as
        // partial (exporter.ts). A stopped RESUME reports the union it kept, so
        // the count it names is a whole sweep's remaining work, not this half's.
        updatePanelStatus(stoppedSweepMessage(settled));
        return;
      }

      if (outcome.kind === "rejected") {
        updatePanelError(outcome.message);
        publishIncomplete(outcome.message);
        return;
      }

      updatePanelComplete(
        settled.total || 0,
        complete.pages || 0,
        complete.elapsed || "0s",
        undefined,
        complete.kind,
        complete.failedItems,
      );

      // A run can come back short without failing: a targeted No. Faktur scrape
      // gets an empty payload for a number Coretax has no row for, and a filtered
      // bulk PDF run only returns the rows it downloaded. The Run withholds the
      // notice for a PDF run, whose pre-download dialog already named them.
      if (outcome.shortfall?.notice) updatePanelStatus(outcome.shortfall.notice);

      // A batch has no server-side total to check against, so its
      // per-period row counts are the completeness evidence and the panel
      // reports them. Says it AFTER the completion line, which owns "selesai".
      if (settled.periods) {
        // The union's counts, not this half's: a resumed sweep reports the whole
        // year it just completed, which is what the file holds.
        updatePanelStatus(batchResultNotice(settled.periods));
        debugLog("Batch selesai:", settled.periods);
      }

      // A short page is only the end of the data if the server agrees it is.
      // When it does not, the panel says the export may be incomplete rather
      // than leaving a partial file looking like a finished one.
      if (complete.truncated) {
        updatePanelStatus(truncatedResultNotice(complete.total, complete.expectedTotal ?? null));
        debugWarn(
          "Scrape terpotong: " +
            complete.total +
            " dari " +
            (complete.expectedTotal ?? "tak diketahui") +
            " baris terkumpul.",
        );
      }

      // A bulk PDF run that named its failures says so here. updatePanelComplete
      // owns the per-file list; this adds the one-line summary above it, and
      // only when names actually arrived — the completion line already carries
      // the bare count for a run that could not name them.
      const failureNotice = failedItemsNotice(complete.failedItems);
      if (failureNotice) updatePanelStatus(failureNotice);

      // Desktop notification is opt-in and raised by the background worker;
      // see completion-notice.ts for why the hand-off goes through storage.
      if (getPreferences().notifyOnComplete) {
        void publishCompletion(
          complete.kind ?? "scrape",
          describeCompletion({
            total: settled.total || 0,
            failureCount: complete.failureCount,
            missing: outcome.shortfall?.count ?? 0,
            // A batch run's own completeness evidence: the toast must not call a
            // sweep with a failed or vanished month a clean success. The union's
            // lists, so a resumed sweep cannot hide the half that failed first.
            failedPeriods: settled.periods?.failedPeriods.length,
            emptyPeriods: settled.periods?.emptyPeriods.length,
            truncated: complete.truncated,
          }),
          Date.now(),
          location.href,
        );
      }

      // Whatever the Run still owed — a pending comparison, check or export,
      // spent exactly once, in the order the panel has always run them. The
      // export goes through the same decision tree the buttons use.
      for (const step of outcome.followUp) {
        if (step.kind === "compare") runPendingCompare();
        else if (step.kind === "check") runPendingCheck();
        else handleExportAction(step.format, actionDeps);
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
      // A failed scrape keeps nothing: there is no usable result, and the
      // requests it owed go with it (ADR-0022). No STOP_SCRAPE is posted — the
      // page world is the one reporting the failure.
      runLifecycle.stop({ keepRows: false });
      updatePanelError(message);
      publishIncomplete(message);
    },

    REFERENCE_SEARCH_NOT_FOUND: (msg) => {
      // The prefix match is the only match (ADR-0012): when it comes back
      // empty the search simply stops — no widening retry, no extra request.
      // The portal grid keeps the empty result it already rendered.
      debugLog("Reference prefix search found no rows for", msg.value);
      updatePanelStatus(`Referensi "${String(msg.value)}" tidak ditemukan.`);
    },
  }, isAcceptedPageMessage),
});
window.addEventListener("message", (event) => pageMessageDispatcher.handle(event));

// ── Grid Filter Event ───────────────────────────────

/**
 * Run a reference search: set the server filter, then let the portal render the
 * result.
 *
 * The prefix match is the only match mode (ADR-0012): when it returns nothing,
 * the panel reports the miss and the search stops. The value is uppercased
 * because the server's Reference filter is case-sensitive.
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

// Both stop controls below call `stopRun` in main-actions.ts — the SAME function
// the export click that doubles as a stop calls. The three steps (post
// STOP_SCRAPE, settle this world's Run, report the cancellation in the panel)
// and the rule about the requests it carried live there, so the only thing a
// control decides is whether the rows it collected survive: this button and the
// stop key drop them, an export click keeps them so the export can still be
// produced (ADR-0027).

document.addEventListener("ch:scrape-toggle", () => {
  if (runLifecycle.isRunning()) {
    stopRun(actionDeps, { keepRows: false });
  } else {
    startScrape(actionDeps);
  }
});

// Stop, from the keyboard. A separate event from the toggle on purpose: a stop
// must never be able to turn into a start if the two ever disagree about what is
// running (shortcuts.ts refuses the key while nothing is running).
document.addEventListener("ch:scrape-stop", () => {
  if (runLifecycle.isRunning()) stopRun(actionDeps, { keepRows: false });
});

// Export format chosen from the toolbar dropdown (XLSX or CSV).
document.addEventListener("ch:export-xlsx", () => {
  handleExportAction("xlsx", actionDeps);
});

// Export CSV
document.addEventListener("ch:export-csv", () => {
  handleExportAction("csv", actionDeps);
});

// Year-wide batch export, chosen from the export dropdown on the e-Faktur PPN
// grids. The panel stays the progress surface for the whole multi-minute run,
// and any export control doubles as its stop through the shared running path
// above.
document.addEventListener("ch:export-batch", () => {
  startBatchExport(actionDeps);
});

// Export PDF
document.addEventListener("ch:export-pdf", () => {
  handleExportAction("pdf", actionDeps);
});

// Auto-start scrape (only starts if not already running, never stops)
document.addEventListener("ch:scrape-start", () => {
  if (runLifecycle.isRunning()) return; // Already running, don't restart
  startScrape(actionDeps);
});

// Open compare modal
document.addEventListener("ch:compare-open", () => {
  openPanel();
});

// Take back a tab's "waiting for the grid" line when the request behind it is
// retired. This is the ONE place that knows both a Run's retirement and the
// tabs: a tab writes that line on the way in, the completion that would have
// replaced it is what a stop retires, and the badge already names the stop — so
// the tab only drops the promise (ADR-0022). Every retirement funnels through
// the life-cycle (a stop, a failed scrape, a rejected transfer, a reset), which
// is why no stop path can forget to say so.
runLifecycle.onRetired((kinds) => {
  for (const kind of kinds) {
    if (kind === "compare") dropPendingCompare();
    else if (kind === "check") dropPendingCheck();
  }
});

// ── A resumable sweep across a reload ─────────────────

/**
 * A sweep with masa still missing that this tab may still offer, or null.
 *
 * Two states arrive here — a stop's kept half and a sweep that finished with a
 * masa the portal failed to deliver — and both are the same offer: the year is
 * short, and the same menu entry finishes it.
 *
 * Held in memory as well as in storage so that a tab which loaded on another
 * workbook page can still resume once the user navigates to the grid the rows
 * came from: the snapshot is read once, at boot, and the page decides.
 */
let keptSweep: SweepSnapshot | null = null;

/**
 * Write the resumable part of a Run wherever a reloaded tab can find it
 * (ADR-0023).
 *
 * The life-cycle announces every change that can touch the rows or the counts, so
 * this listener is the only persistence path — a stop that drops the rows clears
 * the snapshot through the same announcement, and no stop control can forget
 * either half.
 */
runLifecycle.onResumable((result) => sweepSnapshotStore.save(result));

/**
 * Offer a restored sweep to the current page, if it belongs here.
 *
 * Called at boot and after a navigation, which are the two moments the page can
 * change out from under the rows. The guard is the SOURCE, not something about
 * the URL's exact shape: the rows are filed by grid, so a snapshot from PPN
 * Keluaran is not offered on PPN Masukan even though both sweep.
 */
function offerResumableSweep(): void {
  const snapshot = keptSweep;
  if (!snapshot || !extensionEnabled) return;
  if (!snapshotAppliesTo(snapshot, getPageExportSource())) return;
  if (!runLifecycle.restore(snapshot)) return;

  // Consumed: a later navigation resets the Run, and re-offering here would
  // resurrect rows the reset was asked to forget.
  keptSweep = null;
  updatePanelStatus(
    restoredSweepMessage(snapshot.data.length, snapshot.sweep, snapshot.partialSweep),
  );
  debugLog(
    `[Cindieh] restored a resumable sweep: ${snapshot.data.length} rows, ` +
      `${snapshot.sweep.counts.length}/${snapshot.sweep.planned} periods`,
  );
}

// Search a reference in Coretax (from the comparer table)
document.addEventListener("ch:search-reference", (e: Event) => {
  const detail = (e as CustomEvent).detail as { reference?: string } | undefined;
  const reference = detail?.reference;
  if (!reference) return;

  debugLog("Searching reference:", reference);
  searchReference(reference);
});

// ── Init & Navigation ───────────────────────────────

/**
 * Paint (or clear) everything this extension owns on the current page. Single
 * entry point so init, SPA navigation, and the master switch cannot drift into
 * three slightly different injection orders.
 */
function applyPageState(): void {
  if (!extensionEnabled) {
    teardownInjectedUi();
    return;
  }

  startShortcuts();

  if (isSupportedExportPage()) {
    debugLog("Supported page detected, ensuring injection...");
    injectBadge();
    void injectScraper();
    injectExportButton();
    injectMultiInvoiceFilter();
    injectComparerModal();
    if (hasReferenceFilter()) {
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

/**
 * Remove every surface this extension has painted into the page, for the popup's
 * master switch. Deliberately removes all of them rather than the obvious ones:
 * a half-removed toolbar is worse than none, because the buttons that remain
 * still look clickable.
 */
function teardownInjectedUi(): void {
  stopShortcuts();
  removeExportButton();
  clearFilterTimers();
  destroyBadge();
  for (const id of TEARDOWN_ELEMENT_IDS) {
    document.getElementById(id)?.remove();
  }
  // The panel's document-level click handler goes with it: the element removal
  // above takes the overlay's own listeners, not the one on `document`.
  removeMenusOutsideClickHandler();
  const gridFilter = document.getElementById("ch-grid-filter-reference");
  if (gridFilter) (gridFilter.closest(".ch-grid-filter-container") ?? gridFilter).remove();

  // Drop the scraper's captured request too: with the extension off there is
  // nothing that could reuse it, and a re-enable should start clean.
  postToScraper({ type: "RESET_SCRAPER" });
  debugLog("Cindieh dinonaktifkan; UI di halaman dibersihkan.");
}

/**
 * "Bersihkan cache" from the popup: forget the captured request and the scraped
 * rows so the next export cannot reuse anything captured before the click.
 */
function clearScraperCache(): void {
  runLifecycle.reset();
  postToScraper({ type: "RESET_SCRAPER" });
  updatePanelIdle();
  debugLog("Cache scraper dibersihkan atas permintaan popup.");
}

function onNavigate(): void {
  debugLog("Navigate event triggered. Current URL:", window.location.href);

  // Reset content-script state so stale data from the previous page
  // cannot leak into exports on the new page.
  runLifecycle.reset();

  // Ask the scraper (MAIN world) to reset its own state too:
  // captured request cache, filter state, running flags, etc.
  postToScraper({ type: "RESET_SCRAPER" });

  // The reset above announced the emptied Run, which cleared the stored half;
  // the copy read at boot is offered again, because the new page may be the grid
  // it came from.
  offerResumableSweep();

  void preferencesReady.then(applyPageState);
}

function init(): void {
  void loadExportModePreference();
  debugLog("Extension starting up on page...", window.location.href);

  // First paint waits for the stored preferences, so a disabled extension never
  // paints at all. preferencesReady resolves even when storage is unavailable
  // (defaults), so this can never strand the page with no UI forever.
  void preferencesReady.then(() => {
    debugLog("Preferensi diterapkan; mode:", extensionEnabled ? "aktif" : "nonaktif");
    applyPageState();
    // A refresh is the case this exists for: the rows and their per-masa counts
    // outlive the page, so the same menu entry still offers to finish the year.
    void sweepSnapshotStore.load().then((snapshot) => {
      keptSweep = snapshot;
      offerResumableSweep();
    });
  });

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
