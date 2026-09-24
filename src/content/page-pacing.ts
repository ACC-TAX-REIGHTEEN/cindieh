// ============================================================
// PAGE-PACING.TS — Inter-request pacing shared with the MAIN world
// ============================================================
// The pacing preset is chosen in the popup, but the inter-request delays are
// applied inside the MAIN-world scraper, which has no browser API and so
// cannot read extension storage. Page storage is the one channel both worlds
// share, so the content script mirrors the preset there and the scraper reads
// it back — the same bridging strategy debug-preference.ts uses for the log
// switch (see the Gotchas section of AGENTS.md).
//
// Unlike the debug flag this does NOT have to be in place before the scraper
// loads: the preset is resolved when a scrape starts, not at module load, so a
// change made in the popup takes effect on the next run in an already-open tab
// and needs no reload.
//
// No browser API here — this module is imported by the MAIN-world scraper too.

import {
  DEFAULT_DELAY_PRESET,
  normalizeDelayPreset,
  type DelayPreset,
} from "../shared/extension-preferences";

/** Page-storage key holding the mirrored pacing preset. */
export const PACING_STORAGE_KEY = "cindieh:pacing";

/**
 * Write the preset into the page's own storage. A failed write (blocked or
 * partitioned storage) is not fatal: the scraper then falls back to the
 * documented default, which is the safest preset.
 */
export function mirrorPacingToPageWorld(preset: DelayPreset): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(PACING_STORAGE_KEY, normalizeDelayPreset(preset));
  } catch {
    // Ignored on purpose: pacing is a comfort setting, not a correctness one.
  }
}

/**
 * Read the mirrored preset. Called by the scraper when a run starts, so it
 * always reflects the latest popup choice. `null` (unset) normalizes to the
 * default, which is also what a disabled/absent page storage yields.
 */
export function readPacingFromPageWorld(): DelayPreset {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_DELAY_PRESET;
    return normalizeDelayPreset(localStorage.getItem(PACING_STORAGE_KEY));
  } catch {
    return DEFAULT_DELAY_PRESET;
  }
}

/**
 * Remove the mirror. Kept next to the writer so the two stay in step; used when
 * the preference is cleared back to its default, so an uninstalled value does
 * not keep slowing the next run down.
 */
export function clearPacingInPageWorld(): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(PACING_STORAGE_KEY);
  } catch {
    // Ignored on purpose — see mirrorPacingToPageWorld.
  }
}
