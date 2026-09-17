// ============================================================
// BRIDGE.TS — Token-validated postMessage bridge between isolated
// world (content script) and MAIN world (scraper).
// ============================================================
// A random token is generated in the ISOLATED world and passed
// through the scraper's <script> URL and every bridge message.
// It is not stored on `window`, but MAIN-world scripts can observe
// it through the shared DOM and postMessage traffic. It correlates
// bridge messages; it is not secret authentication against hostile
// same-page scripts. Source/origin checks bind the window and origin,
// not the JavaScript world; direction is a protocol field, not proof
// of sender identity. Keep token validation and the two-worlds seam
// (accepted limitations: docs/adr/0007).

function generateToken(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  try {
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    }
  } catch {
    // fall through
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface Bridge {
  /** Set the bridge token manually (re-injection / tests). */
  setBridgeToken(t: string): void;
  /** Return the current bridge token. */
  getBridgeToken(): string;
  /** Generate a fresh random token and store it. */
  generateBridgeToken(): string;
  /** Post a message to the page (scraper) world with the bridge token attached. */
  postToScraper(msg: Record<string, unknown>): void;
  getActiveRunId(): number;
  isCurrentRunMessage(msg: Record<string, unknown>): boolean;
}

/**
 * Build an independent bridge instance. `windowRef` is injectable so tests
 * pass a stub instead of touching the global `window`; it defaults to the
 * global in the browser (the only place postToScraper is used).
 */
export function createBridge(windowRef?: Window): Bridge {
  // Resolve lazily at call time: the singleton must pick up a stubbed
  // globalThis.window (tests), while instances can pin an explicit stub.
  const w = (): Window => windowRef ?? globalThis.window;
  let bridgeToken = "";
  let activeRunId = 0;
  let runPage: string | undefined;

  function getActiveRunId(): number {
    return activeRunId;
  }

  function isCurrentRunMessage(msg: Record<string, unknown>): boolean {
    // Native single-PDF downloads and readiness are not scrape operations.
    if (msg.runId === undefined) {
      return msg.type === "INJECTED_READY" || msg.type === "DOWNLOAD_PDF_ITEM";
    }
    return activeRunId > 0 && msg.runId === activeRunId && runPage === w().location.href;
  }

  function setBridgeToken(t: string): void {
    bridgeToken = t;
  }

  function getBridgeToken(): string {
    return bridgeToken;
  }

  function generateBridgeToken(): string {
    bridgeToken = generateToken();
    return bridgeToken;
  }

  function postToScraper(msg: Record<string, unknown>): void {
    const win = w();
    const startsRun = ["START_SCRAPE", "START_PDF_DOWNLOAD", "SCRAPE_BY_INVOICES"].includes(String(msg.type));
    const cancelsRun = msg.type === "STOP_SCRAPE" || msg.type === "RESET_SCRAPER";
    if (startsRun || cancelsRun) {
      // Only the readiness resend explicitly reuses the current operation ID.
      if (cancelsRun || activeRunId === 0 || msg.runId !== activeRunId) activeRunId++;
      runPage = win.location.href;
      msg = { ...msg, runId: activeRunId };
    }
    win.postMessage(
      { ...msg, direction: "FROM_CONTENT", token: bridgeToken },
      win.location.origin,
    );
  }

  return { setBridgeToken, getBridgeToken, generateBridgeToken, postToScraper, getActiveRunId, isCurrentRunMessage };
}

// ── Module singleton ──────────────────────────────────
// Production consumers (main.ts, main-actions.ts, shortcuts.ts) import the
// named helpers below, which delegate to this singleton. Tests should call
// createBridge() for an independent instance instead of mutating shared
// module state — avoids cross-test order dependency.

export const bridge: Bridge = createBridge();

export const setBridgeToken = bridge.setBridgeToken;
export const getBridgeToken = bridge.getBridgeToken;
export const generateBridgeToken = bridge.generateBridgeToken;
export const postToScraper = bridge.postToScraper;
export const getActiveRunId = bridge.getActiveRunId;
export const isCurrentRunMessage = bridge.isCurrentRunMessage;
