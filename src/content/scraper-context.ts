// ============================================================
// SCRAPER-CONTEXT.TS — the MAIN world's ONE context seam
// ============================================================
// The MAIN world (the page's own script) runs on ONE context object, built
// once in scraper.ts. This module is where that object's INTERFACE lives, so
// the modules that use it depend on a seam instead of on each other.
//
// It used to live inside scraper-actions.ts, which made the dependency graph
// a tree with two back-edges: the extracted period-sweep.ts imported its own
// parent's context type, and scraper-xhr.ts imported the parent's abortError
// while the parent imported the XHR functions (a real cycle). The seam sits
// BELOW both now: they import it, it imports nothing of theirs.
//
// The interface keeps ONE context per world (ADR-0005 merged the capture and
// the orchestration contexts on purpose) but names its two HALVES, so a module
// asks for the half it actually uses:
//
//   - `CaptureContext` — what the request capture needs of the page
//     (scraper-intercept.ts): the cached request, the DOM triggers, the timers.
//   - `OrchestrationContext` — what a RUN needs of the page world
//     (scraper-actions.ts, period-sweep.ts): the stop check, the progress
//     channel, the delay, the pacing preset.
//
// `ScraperContext` is the union: the one object scraper.ts builds still
// satisfies the whole thing, and a test that only drives the capture no longer
// pays for the orchestration stubs (or the other way round).
// ============================================================

import type { ExportSource } from "./page-context";
import type { CapturedRequest, ScrapeMessage } from "./scraper-types";
import type { DelayPreset } from "../shared/extension-preferences";

/**
 * What a run can be told to stop, and the signal its own requests carry.
 *
 * Both halves carry it: the capture waits on it (a capture must not hang
 * after a stop) and the requests do (an XHR must not outlive its run).
 */
export interface RunSignal {
  /** Abort in-flight requests and capture waits when this operation is cancelled. */
  signal?: AbortSignal;
}

/**
 * The page's REQUEST CAPTURE seam: everything the capture needs to find a
 * request and to make the portal produce one.
 */
export interface CaptureContext extends RunSignal {
  /** Return the most recently captured request, or null if none. */
  getLastCaptured(): CapturedRequest | null;
  /** Return the epoch-ms timestamp of the last captured request (0 if none). */
  getLastCapturedTime(): number;
  /**
   * Return the ExportSource of the currently-visible grid component, or null
   * when no grid is visible. Used to decide whether the cache is still valid.
   */
  getVisibleGridSource(): ExportSource | null;
  /**
   * Return the ExportSource of the current page URL, or null when the page
   * is not a supported export page.
   */
  getCurrentPageSource(): ExportSource | null;
  /**
   * Return true when the current page URL is a withholding-slips page.
   * Used in the cache-validity check.
   */
  isWithholdingPage(): boolean;
  /**
   * Register a one-shot subscriber that will be called with the next captured
   * request. Returns an unsubscribe function that removes the subscriber
   * without calling it.
   */
  subscribeCapture(fn: (req: CapturedRequest) => void): () => void;
  /**
   * Query a single DOM element by CSS selector.
   * Returns null when no matching element is found.
   */
  queryElement(selector: string): Element | null;
  /**
   * Return all buttons on the page as an array.
   */
  queryAllButtons(): HTMLButtonElement[];
  /** Trigger a click on the given element. */
  clickElement(el: Element): void;
  /**
   * Schedule a callback after `ms` milliseconds. Returns a handle that can be
   * passed to clearTimeout to cancel it.
   * Defaults to window.setTimeout in production; can be stubbed in tests.
   */
  setTimeout(fn: () => void, ms: number): unknown;
  /** Cancel a timeout scheduled by this context's setTimeout. */
  clearTimeout(handle: unknown): void;
}

/**
 * The page-world seam a RUN needs: the stop check, the channel back to the
 * isolated world, the delay between requests and the run's own budget.
 */
export interface OrchestrationContext extends RunSignal {
  /** Returns true when a stop has been requested by the user. */
  isStopRequested(): boolean;
  /** Send a ScrapeMessage back to the content script. */
  sendToContent(msg: ScrapeMessage): void;
  /** Emit a DOWNLOAD_PDF_ITEM message for a bulk-downloaded PDF row. */
  emitPdfDownload(base64: string, item: Record<string, unknown>, source: ExportSource): void;
  /** Read DOM to get the masa pajak period string (PPh 21 pages). */
  getMasaPajakFromDOM(): string;
  /** Sleep for the given number of milliseconds (rate limiting). */
  delay(ms: number): Promise<void>;
  /** XHR timeout in ms. */
  timeout: number;
  /** Maximum consecutive XHR errors before aborting a paginated scrape. */
  maxErrors: number;
  /**
   * The active inter-request pacing preset. Optional so test contexts need not
   * declare it; omitting it means the documented default ("normal"). The
   * production context reads it from the popup's mirrored preference on every
   * run, so a change takes effect without reloading the page.
   */
  getPacing?(): DelayPreset;
}

/**
 * The one context the MAIN world builds. Both halves at once — scraper.ts
 * constructs a single object that satisfies this, and a module that needs one
 * half asks for that half (ADR-0005's merge, with the halves named).
 */
export type ScraperContext = CaptureContext & OrchestrationContext;

/**
 * The DOMException the cancellation paths reject with.
 *
 * It lives here, with the seam, because three modules reject with it: the
 * capture, the XHR helpers and the orchestration. When it lived in
 * scraper-actions.ts, the two below it had to import their parent to reach it.
 */
export function abortError(): DOMException {
  return new DOMException("Permintaan dibatalkan.", "AbortError");
}
