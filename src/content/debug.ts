// ============================================================
// DEBUG.TS — Conditional debug logging
// ============================================================
// Wraps console methods with a toggleable flag. Dev builds log by
// default (NODE_ENV=development); production builds stay silent
// unless a developer opts in through one of the hooks below.
// ============================================================

// esbuild defines process.env.NODE_ENV as a string literal at build time
// ("development" in watch mode, "production" in build mode).
// No typeof guard needed — the define replaces the entire expression textually.
const IS_DEV = process.env.NODE_ENV === "development";

/**
 * Production opt-ins — a release build is silent without one of them. None of
 * them touches the bridge token (ADR-0007). Precedence, highest first:
 *
 * 1. `?chdebug=1` on the page URL — turns logging on for that page load.
 * 2. The popup's "Log debug" switch (extension storage). Applied
 *    asynchronously by `initDebugFromExtensionStorage()` in debug-preference.ts,
 *    which the content script, background, and popup call on startup. The
 *    content script also COPIES it into this list's source 3
 *    (`mirrorDebugToPageWorld`, awaited before scraper.js is injected), because
 *    the MAIN-world scraper has no browser API and cannot read extension
 *    storage — the copy is how the switch reaches it.
 * 3. `localStorage["cindieh:debug"] = "1"` from DevTools — survives reloads
 *    (one command keeps the `[Cindieh]` logs on for that origin). This is the
 *    hook that reaches the MAIN-world scraper, whose logging is otherwise off.
 *    The content script writes the same key when mirroring source 2, marking it
 *    with `cindieh:debug:ext` so turning the switch off removes the copy and
 *    never a value a developer set here by hand.
 * 4. The build default: on in dev builds, off in production.
 *
 * The off words (`0`/`false`/`off`/`no`) turn logging back off. Sources 1 and 3
 * resolve at module load, so a change to them needs a page reload; the popup
 * switch instead takes effect the next time a context starts — and in the MAIN
 * world, which reads only source 3, at the next scraper injection.
 */
export const DEBUG_QUERY_PARAM = "chdebug";
/** Key used in BOTH the page's localStorage (source 3) and extension storage (source 2). */
export const DEBUG_STORAGE_KEY = "cindieh:debug";

const ON_VALUES = new Set(["1", "true", "on", "yes"]);
const OFF_VALUES = new Set(["0", "false", "off", "no"]);

/**
 * Interpret one raw flag value. Returns null when it is unset, blank, or not a
 * recognised on/off word, so callers fall through to the next source.
 */
export function parseDebugFlag(raw: string | null | undefined): boolean | null {
  if (raw === null || raw === undefined) return null;
  const value = raw.trim().toLowerCase();
  if (ON_VALUES.has(value)) return true;
  if (OFF_VALUES.has(value)) return false;
  return null;
}

/**
 * Read the debug flag out of a page URL. A bare `?chdebug` (no value) counts as
 * on. Returns null when the parameter is absent or the URL is unparseable.
 */
export function debugFlagFromUrl(href: string): boolean | null {
  try {
    const raw = new URL(href).searchParams.get(DEBUG_QUERY_PARAM);
    if (raw === null) return null;
    return raw.trim() === "" ? true : parseDebugFlag(raw);
  } catch {
    return null;
  }
}

/**
 * Pick the effective flag: explicit URL value, then explicit stored value,
 * then the build default. Pure.
 */
export function resolveDebugEnabled(sources: {
  urlFlag: boolean | null;
  storageFlag: boolean | null;
  isDev: boolean;
}): boolean {
  if (sources.urlFlag !== null) return sources.urlFlag;
  if (sources.storageFlag !== null) return sources.storageFlag;
  return sources.isDev;
}

function readStoredDebugFlag(): boolean | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return parseDebugFlag(localStorage.getItem(DEBUG_STORAGE_KEY));
  } catch {
    // Storage access can throw (blocked or partitioned storage, private mode).
    return null;
  }
}

function detectDebugEnabled(): { enabled: boolean; urlDecided: boolean } {
  const urlFlag = typeof location === "undefined" ? null : debugFlagFromUrl(location.href);
  return {
    enabled: resolveDebugEnabled({
      urlFlag,
      // Skip the page-storage read when the URL already decided: a URL value is a
      // per-load intent and should not be second-guessed by a stale stored flag.
      storageFlag: urlFlag === null ? readStoredDebugFlag() : null,
      isDev: IS_DEV,
    }),
    urlDecided: urlFlag !== null,
  };
}

const initial = detectDebugEnabled();
let debugEnabled = initial.enabled;
// Set once an authoritative override exists (`?chdebug`, or a programmatic call).
// The async extension-storage preference must not overturn one of those.
let overridden = initial.urlDecided;

/** Whether logging is currently on (resolved at load, overridable below). */
export function isDebugEnabled(): boolean {
  return debugEnabled;
}

/**
 * Apply the flag stored by the popup switch. It only decides when nothing more
 * authoritative did (a `?chdebug` value or a programmatic call), because those
 * are explicit intents that must not be second-guessed by a stored preference.
 * Returns whether it applied.
 */
export function applyDebugPreference(stored: boolean | null | undefined): boolean {
  if (overridden || stored === null || stored === undefined) return false;
  debugEnabled = stored;
  return true;
}

/** Force logging on. Programmatic/test affordance — see the opt-ins above. */
export function enableDebug(): void {
  debugEnabled = true;
  overridden = true;
}

export function disableDebug(): void {
  debugEnabled = false;
  overridden = true;
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
