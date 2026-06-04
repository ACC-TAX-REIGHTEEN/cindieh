// ============================================================
// DEBUG.TS — Conditional debug logging
// ============================================================
// Wraps console.log with a toggleable flag. In production builds
// (NODE_ENV=production), logs are suppressed unless explicitly enabled.
// ============================================================

const IS_DEV = typeof process !== "undefined" && process.env?.NODE_ENV === "development";

let debugEnabled = IS_DEV;

export function enableDebug(): void {
  debugEnabled = true;
}

export function disableDebug(): void {
  debugEnabled = false;
}

export function debugLog(...args: unknown[]): void {
  if (debugEnabled) {
    console.log("[Better Coretax]", ...args);
  }
}

export function debugWarn(...args: unknown[]): void {
  if (debugEnabled) {
    console.warn("[Better Coretax]", ...args);
  }
}

export function debugError(...args: unknown[]): void {
  // Errors are always logged
  console.error("[Better Coretax]", ...args);
}
