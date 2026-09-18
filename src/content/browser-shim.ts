// ============================================================
// BROWSER-SHIM.TS — Cross-browser API wrapper
// ============================================================
// Provides typed access to the browser extension API for both
// Chrome (chrome.*) and Firefox (browser.*) runtimes.
//
// Requires @types/firefox-webext-browser for browser.* types.
// ============================================================

function getBrowserAPI(): typeof browser {
  if (typeof browser !== "undefined") return browser;
  // chrome.* uses callback style, but the only runtime APIs this project uses
  // — runtime.getURL (main.ts) and runtime.onInstalled (background.ts) — are
  // compatible between both APIs at the surface level. There is no
  // runtime.onMessage channel; the dead one was removed (ADR-0002).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (globalThis as any).chrome;
}

export const browserAPI = getBrowserAPI();
