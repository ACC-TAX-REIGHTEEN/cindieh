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
  // chrome.* uses callback style, but we only use runtime.sendMessage,
  // runtime.getURL, runtime.onMessage, and runtime.onInstalled which
  // are compatible between both APIs at the surface level.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (globalThis as any).chrome;
}

export const browserAPI = getBrowserAPI();
