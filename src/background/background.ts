// ============================================================
// BACKGROUND.TS — Background Script
// ============================================================

// Cross-browser shim — @types/firefox-webext-browser provides global `browser` type
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const browserAPI = typeof browser !== "undefined" ? browser : (globalThis as any).chrome;

console.log("Better Coretax: Background script active");

browserAPI.runtime.onInstalled.addListener(() => {
  console.log("Better Coretax: Extension installed/updated");
});
