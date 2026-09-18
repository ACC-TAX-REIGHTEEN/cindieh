// ============================================================
// SCRAPER-INTERCEPT.TS — XHR request interception logic
// ============================================================
// Extracted from the scraper.ts IIFE for testability.
// Contains the interceptRequest factory and the cache-validity
// and trigger helpers that operate on the unified ScraperContext
// (defined in scraper-actions.ts).
// ============================================================

import type { CapturedRequest } from "./scraper-types";
import { debugLog, debugWarn } from "./debug";
import { abortError } from "./scraper-actions";
import type { ScraperContext } from "./scraper-actions";

// ── Context
// The request-capture members (getLastCaptured, getLastCapturedTime,
// getVisibleGridSource, getCurrentPageSource, isWithholdingPage,
// subscribeCapture, queryElement, queryAllButtons, clickElement,
// setTimeout, clearTimeout) are part of the unified ScraperContext
// defined in scraper-actions.ts. All functions below accept
// ScraperContext directly.

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
export function isCacheValid(ctx: ScraperContext): boolean {
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
 * Isolated behind `ctx` (queries + clicks go through the injected context)
 * so tests can verify which branch is taken without needing a real DOM.
 */
export function triggerXhrCapture(ctx: ScraperContext): void {
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
export function interceptRequest(ctx: ScraperContext): Promise<CapturedRequest> {
  return new Promise<CapturedRequest>((resolve, reject) => {
    const signal = ctx.signal;
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    // Fast path: reuse cached request
    if (isCacheValid(ctx)) {
      debugLog("Using cached request from history.");
      resolve(ctx.getLastCaptured()!);
      return;
    }

    let settled = false;
    let unsubscribe: (() => void) | undefined;
    const handles: unknown[] = [];
    const cleanup = () => {
      settled = true;
      for (const handle of handles) ctx.clearTimeout(handle);
      unsubscribe?.();
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      if (settled) return;
      cleanup();
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      unsubscribe = ctx.subscribeCapture((req) => {
        if (settled) return;
        cleanup();
        resolve(req);
      });
      // A context may deliver a capture synchronously while subscribing.
      if (settled) {
        unsubscribe();
        return;
      }

      handles.push(ctx.setTimeout(() => {
        if (!settled) triggerXhrCapture(ctx);
      }, TRIGGER_DELAY_MS));

      handles.push(ctx.setTimeout(() => {
        if (settled) return;
        cleanup();
        reject(new Error(
          "Tidak ada request tertangkap (Timeout). Silakan muat ulang data atau klik tombol filter/cari di halaman.",
        ));
      }, CAPTURE_TIMEOUT_MS));
    } catch (error) {
      if (settled) return;
      cleanup();
      reject(error);
    }
  });
}


