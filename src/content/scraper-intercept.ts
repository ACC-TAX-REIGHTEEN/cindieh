// ============================================================
// SCRAPER-INTERCEPT.TS — XHR request interception logic
// ============================================================
// Extracted from the scraper.ts IIFE for testability.
// Contains the interceptRequest factory and its injectable
// context interface so tests can stub DOM/timer behaviour.
// ============================================================

import type { CapturedRequest } from "./scraper-types";
import type { ExportSource } from "./page-context";
import { debugLog, debugWarn } from "./debug";

// ── Context interface ──────────────────────────────────

/**
 * All browser-global dependencies needed by interceptRequest, expressed as
 * injectable collaborators so tests can substitute pure stubs.
 */
export interface InterceptContext {
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
   * Schedule a callback after `ms` milliseconds. Returns a handle that can
   * be passed to clearTimeout to cancel it.
   * Defaults to window.setTimeout in production; can be stubbed in tests.
   */
  setTimeout(fn: () => void, ms: number): unknown;
  /** Cancel a timeout scheduled by this context's setTimeout. */
  clearTimeout(handle: unknown): void;
}

// ── Cache validity ──────────────────────────────────────

/** How long (ms) a captured request can be reused before forcing a fresh one. */
const CACHE_TTL_MS = 300_000; // 5 minutes

/**
 * Decide whether the currently cached request can satisfy a new interception.
 *
 * The cache is considered valid when ALL of the following hold:
 * - A request was previously captured.
 * - The capture is younger than CACHE_TTL_MS.
 * - The cached source matches either the visible grid or the current page.
 */
export function isCacheValid(ctx: InterceptContext): boolean {
  const last = ctx.getLastCaptured();
  if (!last) return false;
  if (Date.now() - ctx.getLastCapturedTime() >= CACHE_TTL_MS) return false;

  const visibleSource = ctx.getVisibleGridSource();
  const pageSource = ctx.getCurrentPageSource();

  if (visibleSource !== null && last.source === visibleSource) return true;
  if (pageSource !== null && last.source === pageSource) return true;
  if (ctx.isWithholdingPage() && last.source === "WITHHOLDING_SLIPS") return true;

  return false;
}

// ── Trigger helpers ─────────────────────────────────────

/**
 * Attempt to trigger a fresh XHR by clicking the "Next Page" paginator
 * button, or fall back to any visible Search/Refresh/Filter button.
 * If neither is found, logs a warning and does nothing.
 *
 * Extracted as a pure side-effect function so tests can verify which
 * branch is taken without needing a real DOM.
 */
export function triggerXhrCapture(ctx: InterceptContext): void {
  const nextBtn = ctx.queryElement("button.p-paginator-next:not(.p-disabled)");
  if (nextBtn) {
    debugLog("Triggering Next Page...");
    ctx.clickElement(nextBtn);
    return;
  }

  debugLog("Next button not available/disabled. Trying fallback trigger...");
  const fallbackBtn = ctx.queryAllButtons().find((b) => {
    if (b.id?.startsWith("ch-")) return false; // ignore own injected buttons
    const t = b.textContent?.toLowerCase() || "";
    return (
      t.includes("cari") ||
      t.includes("search") ||
      t.includes("refresh") ||
      !!b.querySelector(".pi-search") ||
      !!b.querySelector(".pi-refresh") ||
      !!b.querySelector(".pi-filter")
    );
  });

  if (fallbackBtn) {
    debugLog("Triggering fallback button:", fallbackBtn.textContent?.trim());
    ctx.clickElement(fallbackBtn);
  } else {
    debugWarn("No trigger buttons found.");
  }
}

// ── Timeouts ────────────────────────────────────────────

/** How long (ms) after the trigger click to wait before giving up. */
const CAPTURE_TIMEOUT_MS = 15_000;
/** How long (ms) to wait before clicking the trigger button. */
const TRIGGER_DELAY_MS = 500;

// ── interceptRequest ────────────────────────────────────

/**
 * Wait for the next captured XHR request, reusing the cache when valid.
 *
 * Behaviour:
 * 1. If the cache is still valid, resolves immediately with the cached request.
 * 2. Otherwise, schedules a trigger click after TRIGGER_DELAY_MS and waits up
 *    to CAPTURE_TIMEOUT_MS for the XHR patch to call a capture subscriber.
 * 3. On timeout, rejects with a user-facing error message.
 *
 * All browser interactions (setTimeout, DOM queries) go through `ctx` so this
 * function is fully testable without a real browser environment.
 */
export function interceptRequest(ctx: InterceptContext): Promise<CapturedRequest> {
  return new Promise<CapturedRequest>((resolve, reject) => {
    // Fast path: reuse cached request
    if (isCacheValid(ctx)) {
      debugLog("Using cached request from history.");
      resolve(ctx.getLastCaptured()!);
      return;
    }

    let resolved = false;

    // Register capture subscriber
    const unsubscribe = ctx.subscribeCapture((req) => {
      if (resolved) return;
      resolved = true;
      ctx.clearTimeout(timeoutHandle);
      resolve(req);
    });

    // Schedule trigger click
    ctx.setTimeout(() => {
      triggerXhrCapture(ctx);
    }, TRIGGER_DELAY_MS);

    // Schedule timeout rejection
    const timeoutHandle = ctx.setTimeout(() => {
      if (!resolved) {
        resolved = true;
        unsubscribe();
        reject(
          new Error(
            "Tidak ada request tertangkap (Timeout). Silakan muat ulang data atau klik tombol filter/cari di halaman.",
          ),
        );
      }
    }, CAPTURE_TIMEOUT_MS);
  });
}

/**
 * Build a production InterceptContext that delegates to the real browser APIs.
 * Called once from scraper.ts and passed to interceptRequest.
 */
export function buildInterceptContext(opts: {
  getLastCaptured: () => CapturedRequest | null;
  getLastCapturedTime: () => number;
  getVisibleGridSource: () => ExportSource | null;
  getCurrentPageSource: () => ExportSource | null;
  isWithholdingPage: () => boolean;
  subscribeCapture: (fn: (req: CapturedRequest) => void) => () => void;
}): InterceptContext {
  return {
    ...opts,
    queryElement: (selector) => document.querySelector(selector),
    queryAllButtons: () => Array.from(document.querySelectorAll("button")),
    clickElement: (el) => (el as HTMLElement).click(),
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (h) => window.clearTimeout(h as number),
  };
}
