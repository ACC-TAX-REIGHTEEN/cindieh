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
  BULK_CONFIRM_STORAGE_KEY,
  COMPARER_DEFAULTS_STORAGE_KEY,
  DEFAULT_BULK_CONFIRM_THRESHOLD,
  DEFAULT_COMPARER_DEFAULTS,
  DEFAULT_DELAY_PRESET,
  DEFAULT_ENABLED,
  DEFAULT_EXPORT_FORMAT,
  DEFAULT_FILENAME_PREFIX,
  DEFAULT_NOTIFY_ON_COMPLETE,
  DEFAULT_ONE_CLICK_EXPORT,
  DELAY_PRESET_STORAGE_KEY,
  ENABLED_STORAGE_KEY,
  EXPORT_FORMAT_STORAGE_KEY,
  FILENAME_PREFIX_STORAGE_KEY,
  NOTIFY_ON_COMPLETE_STORAGE_KEY,
  ONE_CLICK_EXPORT_STORAGE_KEY,
  PREFERENCE_STORAGE_KEYS,
  normalizeBulkConfirmThreshold,
  normalizeComparerDefaults,
  normalizeDelayPreset,
  normalizeEnabled,
  normalizeExportFormat,
  normalizeFilenamePrefix,
  normalizeNotifyOnComplete,
  normalizeOneClickExport,
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
  filenamePrefix: string;
  notifyOnComplete: boolean;
}

export const DEFAULT_PREFERENCES: ExtensionPreferences = {
  enabled: DEFAULT_ENABLED,
  exportFormat: DEFAULT_EXPORT_FORMAT,
  oneClickExport: DEFAULT_ONE_CLICK_EXPORT,
  delayPreset: DEFAULT_DELAY_PRESET,
  bulkConfirmThreshold: DEFAULT_BULK_CONFIRM_THRESHOLD,
  comparerDefaults: { ...DEFAULT_COMPARER_DEFAULTS, statusFilter: [] },
  filenamePrefix: DEFAULT_FILENAME_PREFIX,
  notifyOnComplete: DEFAULT_NOTIFY_ON_COMPLETE,
};

/**
 * Turn a raw storage snapshot into validated preferences. Exported because the
 * popup's own load path and the tests both need it, and because a partial
 * snapshot (a key never written) must read exactly like the default.
 */
export function normalizePreferences(raw: Record<string, unknown>): ExtensionPreferences {
  return {
    enabled: normalizeEnabled(raw[ENABLED_STORAGE_KEY]),
    exportFormat: normalizeExportFormat(raw[EXPORT_FORMAT_STORAGE_KEY]),
    oneClickExport: normalizeOneClickExport(raw[ONE_CLICK_EXPORT_STORAGE_KEY]),
    delayPreset: normalizeDelayPreset(raw[DELAY_PRESET_STORAGE_KEY]),
    bulkConfirmThreshold: normalizeBulkConfirmThreshold(raw[BULK_CONFIRM_STORAGE_KEY]),
    comparerDefaults: normalizeComparerDefaults(raw[COMPARER_DEFAULTS_STORAGE_KEY]),
    filenamePrefix: normalizeFilenamePrefix(raw[FILENAME_PREFIX_STORAGE_KEY]),
    notifyOnComplete: normalizeNotifyOnComplete(raw[NOTIFY_ON_COMPLETE_STORAGE_KEY]),
  };
}

// ── Live snapshot ─────────────────────────────────────
// Action paths run synchronously (a click can decide to confirm a download in
// the same tick), so they cannot await a storage read. The snapshot is seeded
// with the documented defaults and then kept current by the one asynchronous
// read and by the storage listener, which both funnel through setPreferences.

let cachedPreferences: ExtensionPreferences = {
  ...DEFAULT_PREFERENCES,
  comparerDefaults: { ...DEFAULT_COMPARER_DEFAULTS, statusFilter: [] },
};

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
  cachedPreferences = {
    ...DEFAULT_PREFERENCES,
    comparerDefaults: { ...DEFAULT_COMPARER_DEFAULTS, statusFilter: [] },
  };
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
 * Storage key for each preference field. Kept as an explicit table because the
 * field names are the ones the code reads and the storage keys are the ones the
 * popup writes; a `Partial<ExtensionPreferences>` must never be passed straight
 * to `storage.local.set` or it would write keys nothing reads back.
 */
const STORAGE_KEY_BY_FIELD: Record<keyof ExtensionPreferences, string> = {
  enabled: ENABLED_STORAGE_KEY,
  exportFormat: EXPORT_FORMAT_STORAGE_KEY,
  oneClickExport: ONE_CLICK_EXPORT_STORAGE_KEY,
  delayPreset: DELAY_PRESET_STORAGE_KEY,
  bulkConfirmThreshold: BULK_CONFIRM_STORAGE_KEY,
  comparerDefaults: COMPARER_DEFAULTS_STORAGE_KEY,
  filenamePrefix: FILENAME_PREFIX_STORAGE_KEY,
  notifyOnComplete: NOTIFY_ON_COMPLETE_STORAGE_KEY,
};

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
  const patch: Partial<ExtensionPreferences> = {};
  if (ENABLED_STORAGE_KEY in changes) {
    patch.enabled = normalizeEnabled(changes[ENABLED_STORAGE_KEY]?.newValue);
  }
  if (EXPORT_FORMAT_STORAGE_KEY in changes) {
    patch.exportFormat = normalizeExportFormat(changes[EXPORT_FORMAT_STORAGE_KEY]?.newValue);
  }
  if (ONE_CLICK_EXPORT_STORAGE_KEY in changes) {
    patch.oneClickExport = normalizeOneClickExport(
      changes[ONE_CLICK_EXPORT_STORAGE_KEY]?.newValue,
    );
  }
  if (DELAY_PRESET_STORAGE_KEY in changes) {
    patch.delayPreset = normalizeDelayPreset(changes[DELAY_PRESET_STORAGE_KEY]?.newValue);
  }
  if (BULK_CONFIRM_STORAGE_KEY in changes) {
    patch.bulkConfirmThreshold = normalizeBulkConfirmThreshold(
      changes[BULK_CONFIRM_STORAGE_KEY]?.newValue,
    );
  }
  if (COMPARER_DEFAULTS_STORAGE_KEY in changes) {
    patch.comparerDefaults = normalizeComparerDefaults(
      changes[COMPARER_DEFAULTS_STORAGE_KEY]?.newValue,
    );
  }
  if (FILENAME_PREFIX_STORAGE_KEY in changes) {
    patch.filenamePrefix = normalizeFilenamePrefix(changes[FILENAME_PREFIX_STORAGE_KEY]?.newValue);
  }
  if (NOTIFY_ON_COMPLETE_STORAGE_KEY in changes) {
    patch.notifyOnComplete = normalizeNotifyOnComplete(
      changes[NOTIFY_ON_COMPLETE_STORAGE_KEY]?.newValue,
    );
  }
  return patch;
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
