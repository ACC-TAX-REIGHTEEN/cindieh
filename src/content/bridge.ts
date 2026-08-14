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

let bridgeToken = "";

export function setBridgeToken(t: string): void {
  bridgeToken = t;
}

export function getBridgeToken(): string {
  return bridgeToken;
}

export function generateBridgeToken(): string {
  bridgeToken = generateToken();
  return bridgeToken;
}

/** Post a message to the page (scraper) world with the bridge token attached. */
export function postToScraper(msg: Record<string, unknown>): void {
  window.postMessage(
    { ...msg, direction: "FROM_CONTENT", token: bridgeToken },
    window.location.origin,
  );
}
