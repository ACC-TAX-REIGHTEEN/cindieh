// ============================================================
// SCRAPER.TS — Runs in PAGE context (MAIN world)
// ============================================================
// Injected by main.ts into the page to access Angular's XHR.
// Communicates with content script via window.postMessage.
//
// This file is the ADAPTER, and nothing else (ADR-0038): it builds
// the page environment the install wiring needs and hands it to
// installScraper once. Every decision — the token read, the per-run
// context, RESET_SCRAPER's clearing, the not-found latch, the
// teardown — lives in scraper-install.ts, where a test can drive it
// with a fake page instead of stubbing the whole browser.
//
// Keeping the wiring separate from the page is also what keeps this
// file's only job visible: it is the ONE place in the MAIN world that
// is allowed to reach for `window`, `document`, `fetch` and the two
// prototypes.
// ============================================================

import { installScraper, type ScraperEnv } from "./scraper-install";

const env: ScraperEnv = {
  document,
  window,
  setFetch: (next) => {
    window.fetch = next;
  },
  xhrPrototype: XMLHttpRequest.prototype,
  anchorPrototype: HTMLAnchorElement.prototype,
  // esbuild textually replaces process.env.NODE_ENV, so the debug hook's
  // branch is eliminated entirely in production builds.
  isDevelopment: process.env.NODE_ENV === "development",
};

installScraper(env);
