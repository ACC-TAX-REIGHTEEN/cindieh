// ============================================================
// DEBUG.TS — Conditional debug logging
// ============================================================
// Wraps console methods with a toggleable flag. In production builds
// (NODE_ENV=production), all logs including errors are suppressed
// unless explicitly enabled via enableDebug().
// ============================================================

// esbuild defines process.env.NODE_ENV as a string literal at build time
// ("development" in watch mode, "production" in build mode).
// No typeof guard needed — the define replaces the entire expression textually.
const IS_DEV = process.env.NODE_ENV === "development";

let debugEnabled = IS_DEV;

export function enableDebug(): void {
  debugEnabled = true;
}

export function disableDebug(): void {
  debugEnabled = false;
}

export function debugLog(...args: unknown[]): void {
  if (debugEnabled) {
    console.log("[Cindieh]", ...args);
  }
}

export function debugWarn(...args: unknown[]): void {
  if (debugEnabled) {
    console.warn("[Cindieh]", ...args);
  }
}

export function debugError(...args: unknown[]): void {
  if (debugEnabled) {
    console.error("[Cindieh]", ...args);
  }
}
