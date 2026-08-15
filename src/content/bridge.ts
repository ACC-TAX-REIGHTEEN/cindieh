// ============================================================
// BRIDGE.TS — Secure postMessage bridge between isolated
// world (content script) and MAIN world (scraper).
// ============================================================
// A random token is generated once in the ISOLATED world and
// embedded into the scraper's <script> URL. The scraper reads
// it back from its own <script> tag, so the token never lives
// on `window` and cannot be read by other MAIN-world scripts.
// Every cross-world message must carry this token, which
// prevents a malicious page script (or another extension
// injected into the MAIN world) from forging messages such as
// DOWNLOAD_PDF_ITEM or START_SCRAPE.

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
    win.postMessage(
      { ...msg, direction: "FROM_CONTENT", token: bridgeToken },
      win.location.origin,
    );
  }

  return { setBridgeToken, getBridgeToken, generateBridgeToken, postToScraper };
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
