// ============================================================
// PREFERENCES.TS — Extension-storage bridge for the popup controls
// ============================================================
// The popup writes these keys; the content script and background read them.
// Every read is guarded and falls back to the documented default, and every
// value passes through its normalizer in shared/extension-preferences.ts, so
// a rejected `storage.local` call can neither escape as an unhandled rejection
// nor leave a control half-rendered (the guard contract in AGENTS.md).
//
// Isolated world only — this imports the browser runtime shim.

import { browserAPI } from "./browser-shim";
import { debugError } from "./debug";
import {
  PREFERENCE_FIELDS,
  PREFERENCE_STORAGE_KEYS,
  type CheckerDefaults,
  type ComparerDefaults,
  type DelayPreset,
  type StoredExportFormat,
} from "../shared/extension-preferences";

export interface ExtensionPreferences {
  enabled: boolean;
  exportFormat: StoredExportFormat;
  oneClickExport: boolean;
  delayPreset: DelayPreset;
  bulkConfirmThreshold: number;
  comparerDefaults: ComparerDefaults;
  checkerDefaults: CheckerDefaults;
  filenamePrefix: string;
  notifyOnComplete: boolean;
}

/**
 * A fresh copy of the documented defaults.
 *
 * Built by CALLING each row's `defaultValue()` rather than spreading a shared
 * literal: the two defaults objects hold an array, so one instance handed to
 * two readers would let the first reader's edits reach the second.
 */
function defaultPreferences(): ExtensionPreferences {
  const defaults: Record<string, unknown> = {};
  for (const [field, spec] of Object.entries(PREFERENCE_FIELDS)) {
    defaults[field] = spec.defaultValue();
  }
  return defaults as unknown as ExtensionPreferences;
}

export const DEFAULT_PREFERENCES: ExtensionPreferences = defaultPreferences();

/**
 * Turn a raw storage snapshot into validated preferences. Exported because the
 * popup's own load path and the tests both need it, and because a partial
 * snapshot (a key never written) must read exactly like the default.
 *
 * The loop is the whole point of the table (ADR-0037): the field, its key and
 * its normalizer cannot drift apart, so a preference added to the schema is
 * read here without an edit.
 */
export function normalizePreferences(raw: Record<string, unknown>): ExtensionPreferences {
  const preferences: Record<string, unknown> = {};
  for (const [field, spec] of Object.entries(PREFERENCE_FIELDS)) {
    preferences[field] = spec.normalize(raw[spec.key]);
  }
  return preferences as unknown as ExtensionPreferences;
}

// ── Live snapshot ─────────────────────────────────────
// Action paths run synchronously (a click can decide to confirm a download in
// the same tick), so they cannot await a storage read. The snapshot is seeded
// with the documented defaults and then kept current by the one asynchronous
// read and by the storage listener, which both funnel through setPreferences.

let cachedPreferences: ExtensionPreferences = defaultPreferences();

/** The most recent preference value this context knows about. Never rejects. */
export function getPreferences(): ExtensionPreferences {
  return cachedPreferences;
}

/** Merge a patch into the snapshot and return the result. */
export function setPreferences(patch: Partial<ExtensionPreferences>): ExtensionPreferences {
  cachedPreferences = { ...cachedPreferences, ...patch };
  return cachedPreferences;
}

/** Drop the snapshot back to the documented defaults (used by the reset path). */
export function resetPreferencesSnapshot(): ExtensionPreferences {
  cachedPreferences = defaultPreferences();
  return cachedPreferences;
}

/**
 * Read every preference. A failed or unavailable `storage.local` yields the
 * defaults rather than throwing, and reports through debugError.
 */
export async function readPreferences(): Promise<ExtensionPreferences> {
  try {
    const raw = await browserAPI.storage.local.get([...PREFERENCE_STORAGE_KEYS]);
    return setPreferences(normalizePreferences(raw ?? {}));
  } catch (err) {
    debugError("Gagal membaca preferensi ekstensi", err);
    return resetPreferencesSnapshot();
  }
}

/**
 * Storage key for each preference field, read off the one table (ADR-0037).
 *
 * The field names are the ones the code reads and the storage keys are the ones
 * the popup writes; a `Partial<ExtensionPreferences>` must never be passed
 * straight to `storage.local.set` or it would write keys nothing reads back.
 */
const STORAGE_KEY_BY_FIELD: Record<keyof ExtensionPreferences, string> = Object.fromEntries(
  Object.entries(PREFERENCE_FIELDS).map(([field, spec]) => [field, spec.key]),
) as Record<keyof ExtensionPreferences, string>;

/** Persist a subset of preferences. A failed write reports and is contained. */
export async function writePreferences(patch: Partial<ExtensionPreferences>): Promise<void> {
  const payload: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(patch)) {
    payload[STORAGE_KEY_BY_FIELD[field as keyof ExtensionPreferences]] = value;
  }
  if (Object.keys(payload).length === 0) return;

  try {
    await browserAPI.storage.local.set(payload);
    // Keep this context's snapshot in step with what was just stored, so a read
    // that follows a write in the same context cannot see a stale value.
    setPreferences(patch);
  } catch (err) {
    // The UI already reflects the click; contain the failure instead of
    // letting it escape a `void`-ed handler.
    debugError("Gagal menyimpan preferensi ekstensi", err);
  }
}

/** Remove every managed key, taking the extension back to its defaults. */
export async function clearPreferences(): Promise<void> {
  try {
    await browserAPI.storage.local.remove([...PREFERENCE_STORAGE_KEYS]);
  } catch (err) {
    debugError("Gagal mereset preferensi ekstensi", err);
  }
}

/**
 * Map a `storage.onChanged` payload to the preferences it touched, so the
 * content script can apply a change live instead of reloading the portal page.
 * Keys that did not change are simply absent.
 */
export function preferencesFromChanges(
  changes: Record<string, { newValue?: unknown }>,
): Partial<ExtensionPreferences> {
  // One loop over the table (ADR-0037): a key the schema declares is a key this
  // function can apply, and a key it does not declare is silently not a
  // preference — including one a build added and this list forgot.
  const patch: Record<string, unknown> = {};
  for (const [field, spec] of Object.entries(PREFERENCE_FIELDS)) {
    if (spec.key in changes) patch[field] = spec.normalize(changes[spec.key]?.newValue);
  }
  return patch as Partial<ExtensionPreferences>;
}

// ── Popup → content command channel ───────────────────
// ADR-0002 settled on `storage.local` as the popup's seam, and removed the
// `runtime.onMessage` channel because nothing sent on it. A "clear the scraper
// cache" button does need to reach the open portal tab, so rather than reopen
// that channel this reuses the same seam: the popup publishes a changed value
// and the content script's existing storage listener acts on it. Writes are
// overwritten every time, so nothing has to be cleaned up afterwards and a tab
// that is not open simply misses that click.

export const RESET_SCRAPER_REQUEST_KEY = "cindiehResetRequest";

/**
 * Publish a reset request. The value is a timestamp so that two requests in a
 * row are still a real `onChanged` event; consumers only need "it changed".
 */
export async function requestScraperReset(now: number = Date.now()): Promise<void> {
  try {
    await browserAPI.storage.local.set({ [RESET_SCRAPER_REQUEST_KEY]: now });
  } catch (err) {
    debugError("Gagal meminta reset cache scraper", err);
  }
}
