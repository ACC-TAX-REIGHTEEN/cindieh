// ============================================================
// DEBUG-PREFERENCE.TS — extension-storage bridge for the debug flag
// ============================================================
// The page-level hooks in debug.ts cannot reach every context: a `?chdebug`
// query param and the page's localStorage only exist in the page worlds, the
// background service worker has neither a portal URL nor page storage, and the
// popup cannot write either of them. Extension storage is the one place the
// content script, background, and popup all share, so the popup switch stores
// the flag there and each context applies it on startup.
//
// Coverage: content script (isolated world), background, popup. The MAIN-world
// scraper has no browser API, so extension storage is out of reach there — the
// content script therefore MIRRORS the switch into the page's own storage
// (`mirrorDebugToPageWorld`), which is the one channel both worlds share. The
// scraper resolves its flag at module load, so the mirror has to be written
// before scraper.js runs; see `initDebugForPageWorld` and the precedence list
// in debug.ts.
// ============================================================

import { browserAPI } from "./browser-shim";
import { DEBUG_STORAGE_KEY, applyDebugPreference, parseDebugFlag } from "./debug";

/**
 * Written next to the mirrored flag to record that the extension owns that page
 * value. Its absence is what keeps cleanup from deleting a `cindieh:debug` a
 * developer set by hand in DevTools.
 */
export const PAGE_MIRROR_MARKER_KEY = "cindieh:debug:ext";

/**
 * Normalise a stored value to a flag. Booleans (what the popup writes) pass
 * through; strings go through the shared on/off words, so a hand-edited
 * `"1"` behaves the same as the switch. Anything else is "unset" (null).
 */
export function normalizeDebugPreference(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return parseDebugFlag(value);
  return null;
}

/** Read the stored preference; null when unset or storage is unavailable. */
export async function readDebugPreference(): Promise<boolean | null> {
  try {
    const result = await browserAPI.storage.local.get(DEBUG_STORAGE_KEY);
    return normalizeDebugPreference(result?.[DEBUG_STORAGE_KEY]);
  } catch {
    // Storage is unavailable outside an extension context (and in tests).
    return null;
  }
}

/** Persist the preference. Never throws — a failed write must not break the popup. */
export async function writeDebugPreference(enabled: boolean): Promise<void> {
  try {
    await browserAPI.storage.local.set({ [DEBUG_STORAGE_KEY]: enabled });
  } catch {
    // Ignored on purpose: the switch is a diagnostic affordance.
  }
}

/**
 * Copy the switch into the page's own storage — the hook (source 3 in debug.ts)
 * the MAIN-world scraper can actually read, since it has no browser API.
 *
 * `true` writes the on flag plus the ownership marker. Anything else — `false`,
 * or `null` when no preference is stored — removes both, so turning the switch
 * off leaves no `cindieh:debug` behind; a value without our marker is someone
 * else's and is never touched.
 */
export function mirrorDebugToPageWorld(enabled: boolean | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (enabled === true) {
      localStorage.setItem(DEBUG_STORAGE_KEY, "1");
      localStorage.setItem(PAGE_MIRROR_MARKER_KEY, "1");
      return;
    }
    if (localStorage.getItem(PAGE_MIRROR_MARKER_KEY) === null) return;
    localStorage.removeItem(DEBUG_STORAGE_KEY);
    localStorage.removeItem(PAGE_MIRROR_MARKER_KEY);
  } catch {
    // Blocked/partitioned page storage is not fatal: the flag is a diagnostic
    // affordance, and the scraper then falls back to its build default.
  }
}

/**
 * Read the stored preference and apply it to this context's logger. Called on
 * startup by the content script, background, and popup.
 *
 * Resolves to whether the stored value was applied: a `?chdebug` value already
 * in the URL wins over it (see debug.ts). Because the read is async, log lines
 * emitted synchronously during startup still use the previous flag.
 */
export async function initDebugFromExtensionStorage(): Promise<boolean> {
  return applyDebugPreference(await readDebugPreference());
}

/**
 * Content-script entry point: apply the switch here AND mirror it into the page
 * world so the MAIN-world scraper follows it too.
 *
 * The mirror carries the *stored preference*, not this context's resolved flag,
 * because the page world has its own precedence where `?chdebug` still wins.
 *
 * Await this before injecting scraper.js: the scraper resolves its flag at
 * module load, so a mirror written later is only picked up on the next load.
 */
export async function initDebugForPageWorld(): Promise<boolean> {
  const stored = await readDebugPreference();
  const applied = applyDebugPreference(stored);
  mirrorDebugToPageWorld(stored);
  return applied;
}
