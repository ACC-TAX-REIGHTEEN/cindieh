// ============================================================
// SCRAPER-NETS.TS — Backup nets against duplicate native saves
// ============================================================
// The PRIMARY double-download block is the response sabotage done by the
// fetch/XHR interceptors: the portal receives a failure payload, takes its
// error branch, and never builds a file. These two nets guard the SAVE
// corridors the portal would use if that sabotage ever failed (a refused
// defineProperty, an unparseable response, an unexpected event order), so a
// regression there degrades to "one extra blocked click" instead of a second
// Coretax-named PDF:
//
//   1. Blob-anchor save:  Blob → createObjectURL → a.click()
//   2. Popup save:        window.open(blobUrl)
//
// Extracted from the scraper.ts IIFE (MAIN world) into a factory with injected
// targets, so both corridors have unit coverage without a live browser — the
// same split as scraper-fetch.ts and scraper-pdf.ts. scraper.ts keeps only the
// adapter plus the teardown call.
//
// Deliberately NOT patched: URL.createObjectURL. It sits on the same corridor as
// net 1 (breaking either link of that chain stops the save), and unlike net 1 it
// never self-resets — patching it blocked every legitimate PDF blob on the page
// for the whole 5s processing window.
//
// Coverage limit (best-effort by design): only the `click` property and the
// `open` method are replaced. A reference to either taken before install(), and
// `anchor.dispatchEvent(new MouseEvent("click"))`, bypass the nets entirely.
// ============================================================

import type { PdfDownloadSession } from "./scraper-pdf";

/** Mutable surface of net 1 — `HTMLAnchorElement.prototype` in production. */
export interface AnchorClickTarget {
  click(this: HTMLAnchorElement): void;
}

/** Mutable surface of net 2 — `window` in production. */
export interface WindowOpenTarget {
  open(url?: string | URL, target?: string, features?: string): WindowProxy | null;
}

export interface DownloadNetDeps {
  /** Owns the processing flag both nets check and self-reset. */
  session: Pick<PdfDownloadSession, "isProcessing" | "clearProcessing">;
  /** Where the anchor save corridor runs (prototype in production). */
  anchorPrototype: AnchorClickTarget;
  /** Where the popup save corridor runs (`window` in production). */
  windowTarget: WindowOpenTarget;
  /** Records a blocked save — `debugLog` in production. */
  log: (message: string) => void;
}

export interface DownloadNets {
  /** Patch both corridors. Idempotent — a second call is a no-op. */
  install(): void;
  /** Restore what the targets held at install(). Safe when not installed. */
  restore(): void;
}

/** True for the blob: URLs the portal hands a generated PDF to the browser with. */
export function isBlobUrl(url: string | URL | null | undefined): boolean {
  return String(url ?? "").startsWith("blob:");
}

/**
 * True when this anchor click is the portal's own save corridor: the anchor
 * carries a `download` attribute or points at a blob URL. Ordinary links
 * (no download attribute, http/https href) pass through untouched.
 */
export function isPortalSaveAnchor(anchor: { download?: string; href?: string }): boolean {
  return Boolean(anchor.download) || isBlobUrl(anchor.href);
}

/**
 * Build the two backup nets.
 *
 * SECURITY: a net only acts while the session reports processing AND the call
 * looks like the portal's save corridor. Everything else — including unrelated
 * user popups during the 5s window — is forwarded to the original method.
 */
export function createDownloadNets(deps: DownloadNetDeps): DownloadNets {
  const { session, anchorPrototype, windowTarget, log } = deps;

  // Set by install(), cleared by restore(): doubles as the installed marker so
  // a repeated install() cannot wrap our own wrapper (zombie patches).
  let restoreTargets: (() => void) | null = null;

  return {
    install(): void {
      if (restoreTargets) return;

      const originalClick = anchorPrototype.click;
      const originalOpen = windowTarget.open;

      anchorPrototype.click = function (this: HTMLAnchorElement): void {
        if (session.isProcessing() && isPortalSaveAnchor(this)) {
          log("[Cindieh] Memblokir download klik bawaan.");
          session.clearProcessing();
          return;
        }
        // Keep the real receiver so legitimate saves still work.
        originalClick.apply(this);
      };

      windowTarget.open = function (
        this: WindowOpenTarget,
        url?: string | URL,
        target?: string,
        features?: string,
      ): WindowProxy | null {
        if (session.isProcessing() && isBlobUrl(url)) {
          log("[Cindieh] Memblokir window.open blob bawaan.");
          session.clearProcessing();
          return null;
        }
        return originalOpen.call(this, url, target, features);
      };

      restoreTargets = () => {
        anchorPrototype.click = originalClick;
        windowTarget.open = originalOpen;
      };
    },

    restore(): void {
      restoreTargets?.();
      restoreTargets = null;
    },
  };
}
