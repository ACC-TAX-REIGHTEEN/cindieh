import { browserAPI } from "../content/browser-shim";
import {
  initDebugFromExtensionStorage,
  readDebugPreference,
  writeDebugPreference,
} from "../content/debug-preference";
import { applyDebugPreference, debugError } from "../content/debug";
import { clearPreferences, readPreferences, requestScraperReset, writePreferences } from "../content/preferences";
import type { ExtensionPreferences } from "../content/preferences";
import { describePortalPage } from "../content/page-context";
import { EXPORT_MODE_STORAGE_KEY, normalizeExportMode, type StoredExportMode } from "../shared/export-preferences";
import {
  CHECKER_STATUSES,
  COMPARISON_STATUSES,
  DELAY_PRESET_MULTIPLIER,
  NEVER_CONFIRM_THRESHOLD,
  normalizeBulkConfirmThreshold,
  normalizeCheckerDefaults,
  normalizeComparerDefaults,
  normalizeDelayPreset,
  normalizeFilenamePrefix,
  type CheckerDefaults,
  type ComparerDefaults,
  type StoredCheckerStatus,
  type StoredComparisonStatus,
} from "../shared/extension-preferences";
import {
  bindPreferenceControls,
  paintPreferenceControls,
  type PreferenceControl,
} from "./preference-controls";

// Every control is looked up defensively: the popup degrades to whatever the
// document actually contains rather than throwing on a missing element, which is
// also what keeps it openable when storage or the DOM misbehaves.
const enabledInput = byId<HTMLInputElement>("extension-enabled");
const cleanedInput = byId<HTMLInputElement>("mode-cleaned");
const rawInput = byId<HTMLInputElement>("mode-raw");
const xlsxFormatInput = byId<HTMLInputElement>("format-xlsx");
const csvFormatInput = byId<HTMLInputElement>("format-csv");
const oneClickExportInput = byId<HTMLInputElement>("one-click-export");
const filenamePrefixInput = byId<HTMLInputElement>("filename-prefix");
const delayPresetSelect = byId<HTMLSelectElement>("delay-preset");
const bulkConfirmInput = byId<HTMLInputElement>("bulk-confirm");
const comparerToleranceInput = byId<HTMLInputElement>("comparer-tolerance");
const comparerDailyDatesInput = byId<HTMLInputElement>("comparer-daily-dates");
const checkerBenchmarkSelect = byId<HTMLSelectElement>("checker-benchmark");
const checkerToleranceInput = byId<HTMLInputElement>("checker-tolerance");
const notifyInput = byId<HTMLInputElement>("notify-on-complete");
const debugInput = byId<HTMLInputElement>("debug-logs");
const clearCacheButton = byId<HTMLButtonElement>("clear-cache");
const resetButton = byId<HTMLButtonElement>("reset-preferences");
const statusText = byId<HTMLElement>("status-text");
const portalStatus = byId<HTMLElement>("portal-status");

/** The comparer status checkboxes, paired with the status each one stores. */
const statusCheckboxes = COMPARISON_STATUSES.map((status) => ({
  status,
  input: byId<HTMLInputElement>(`comparer-status-${status}`),
}));

/** The checker's status checkboxes, paired with the status each one stores. */
const checkerStatusCheckboxes = CHECKER_STATUSES.map((status) => ({
  status,
  input: byId<HTMLInputElement>(`checker-status-${status}`),
}));

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function setChecked(el: HTMLInputElement | null, checked: boolean): void {
  if (el) el.checked = checked;
}

/** Resting status line: which export shape is active (not a transient message). */
function setExportModeStatus(mode: StoredExportMode): void {
  if (statusText) {
    statusText.textContent = mode === "raw" ? "Format asli aktif" : "Format dirapikan aktif";
  }
}

/** Transient status line, for something that just happened. */
function setTransientStatus(message: string): void {
  if (statusText) statusText.textContent = message;
}

function readCheckedStatuses(): StoredComparisonStatus[] {
  return statusCheckboxes
    .filter(({ input }) => input?.checked)
    .map(({ status }) => status);
}

// ── Export mode ───────────────────────────────────────
// Its own preference with its own key and its own writer: the export SHAPE
// (`cleaned` / `raw`) is not one of the managed settings, and a reset of those
// must not silently change how data is exported. The radio pair below is
// therefore the one control group this table does not declare.

function setExportModeChecked(mode: StoredExportMode): void {
  setChecked(cleanedInput, mode === "cleaned");
  setChecked(rawInput, mode === "raw");
  setExportModeStatus(mode);
}

async function loadMode(): Promise<void> {
  try {
    const result = await browserAPI.storage.local.get(EXPORT_MODE_STORAGE_KEY);
    setExportModeChecked(normalizeExportMode(result[EXPORT_MODE_STORAGE_KEY]));
  } catch (err) {
    // A failed read must not leave the popup with no radio selected (and an
    // unhandled rejection in the console). Same guard the content script's
    // loadExportModePreference() applies.
    debugError("Gagal membaca preferensi format export", err);
    setExportModeChecked("cleaned");
  }
}

async function saveMode(mode: StoredExportMode): Promise<void> {
  setExportModeChecked(mode);
  try {
    await browserAPI.storage.local.set({ [EXPORT_MODE_STORAGE_KEY]: mode });
  } catch (err) {
    // The UI already reflects the click; surface the failure instead of
    // throwing an unhandled rejection out of a `void`-ed handler.
    debugError("Gagal menyimpan preferensi format export", err);
  }
}

cleanedInput?.addEventListener("change", () => {
  if (cleanedInput.checked) void saveMode("cleaned");
});

rawInput?.addEventListener("change", () => {
  if (rawInput.checked) void saveMode("raw");
});

// ── The preference controls, declared once ────────────
// One row per control (ADR-0037): which element it is, how it paints, what it
// stores, and what the status field says about it. The binder in
// preference-controls.ts owns the lookup, the listener and the write, so a
// control here cannot forget the normalizer or the defensive lookup.

/** Read the current comparer controls back into the stored defaults shape. */
function currentComparerDefaults(): ComparerDefaults {
  return normalizeComparerDefaults({
    tolerance: comparerToleranceInput?.value,
    dailyDates: comparerDailyDatesInput?.value,
    statusFilter: readCheckedStatuses(),
  });
}

/** The checker's status checkboxes that are ticked, in schema order. */
function readCheckedCheckerStatuses(): StoredCheckerStatus[] {
  return checkerStatusCheckboxes
    .filter(({ input }) => input?.checked)
    .map(({ status }) => status);
}

/** Read the current checker controls back into the stored defaults shape. */
function currentCheckerDefaults(): CheckerDefaults {
  return normalizeCheckerDefaults({
    benchmark: checkerBenchmarkSelect?.value,
    tolerance: checkerToleranceInput?.value,
    statusFilter: readCheckedCheckerStatuses(),
  });
}

/**
 * One control of a grouped default.
 *
 * The comparer's three and the checker's three are ONE stored value each, so
 * every member writes the whole object — a partial write would have to re-read
 * the other members, and would store a half-updated filter.
 */
function comparerControl(
  id: string,
  paint: (defaults: ComparerDefaults) => void,
): PreferenceControl {
  return {
    id,
    paint: (preferences) => paint(normalizeComparerDefaults(preferences.comparerDefaults)),
    patch: () => ({ comparerDefaults: currentComparerDefaults() }),
  };
}

function checkerControl(
  id: string,
  paint: (defaults: CheckerDefaults) => void,
): PreferenceControl {
  return {
    id,
    paint: (preferences) => paint(normalizeCheckerDefaults(preferences.checkerDefaults)),
    patch: () => ({ checkerDefaults: currentCheckerDefaults() }),
  };
}

/**
 * The popup's preference controls, in the order the markup presents them.
 *
 * The rows are declared here rather than in preference-controls.ts because they
 * mirror popup.html: an id and the element it names belong together, and a
 * preference's KEY never appears here — only the field it sets.
 */
const PREFERENCE_CONTROLS: readonly PreferenceControl[] = [
  // Master switch.
  {
    id: "extension-enabled",
    paint: (preferences) => setChecked(enabledInput, preferences.enabled),
    patch: () => ({ enabled: enabledInput?.checked ?? false }),
    status: (patch) =>
      patch.enabled
        ? "Cindieh aktif di tab portal."
        : "Cindieh dimatikan; UI di portal dibersihkan.",
  },

  // Export FORMAT default: which format the portal's export menu starts from,
  // and — with one-click export on — which format that click downloads.
  {
    id: "format-xlsx",
    paint: (preferences) => setChecked(xlsxFormatInput, preferences.exportFormat === "xlsx"),
    patch: () => {
      // The browser clears `checked` on the losing radio before firing its
      // `change`; only the newly selected one may write.
      if (!xlsxFormatInput?.checked) return null;
      setChecked(csvFormatInput, false);
      return { exportFormat: "xlsx" };
    },
  },
  {
    id: "format-csv",
    paint: (preferences) => setChecked(csvFormatInput, preferences.exportFormat === "csv"),
    patch: () => {
      if (!csvFormatInput?.checked) return null;
      setChecked(xlsxFormatInput, false);
      return { exportFormat: "csv" };
    },
  },

  // One-click export. Opt-in: the portal button exports instead of opening the
  // menu, and the chevron splits off into its own caret. Off by default because
  // two hit targets take toolbar room.
  {
    id: "one-click-export",
    paint: (preferences) => setChecked(oneClickExportInput, preferences.oneClickExport),
    patch: () => ({ oneClickExport: oneClickExportInput?.checked ?? false }),
    status: (patch) =>
      patch.oneClickExport
        ? "Ekspor sekali klik aktif; tombol panah membuka pilihan format."
        : "Tombol ekspor kembali membuka menu.",
  },

  // Filename prefix. On `input`, not `change`: a user who types a prefix and
  // closes the popup without blurring the field would otherwise lose it.
  {
    id: "filename-prefix",
    event: "input",
    paint: (preferences) => {
      if (filenamePrefixInput) filenamePrefixInput.value = preferences.filenamePrefix;
    },
    patch: () => ({ filenamePrefix: normalizeFilenamePrefix(filenamePrefixInput?.value) }),
  },

  // Rate-limit pacing.
  {
    id: "delay-preset",
    paint: (preferences) => {
      if (delayPresetSelect) delayPresetSelect.value = preferences.delayPreset;
    },
    patch: () => ({ delayPreset: normalizeDelayPreset(delayPresetSelect?.value) }),
    status: (patch) => {
      const preset = normalizeDelayPreset(patch.delayPreset);
      const multiplier = DELAY_PRESET_MULTIPLIER[preset];
      return multiplier === 1
        ? "Jeda normal."
        : `Jeda ${multiplier}\u00d7 lebih lambat; berlaku di tab portal tanpa reload.`;
    },
  },

  // Bulk download confirmation. The normalized value is written back into the
  // box, so the control shows what is actually stored.
  {
    id: "bulk-confirm",
    paint: (preferences) => {
      if (bulkConfirmInput) bulkConfirmInput.value = String(preferences.bulkConfirmThreshold);
    },
    patch: () => {
      const threshold = normalizeBulkConfirmThreshold(bulkConfirmInput?.value);
      if (bulkConfirmInput) bulkConfirmInput.value = String(threshold);
      return { bulkConfirmThreshold: threshold };
    },
    status: (patch) =>
      patch.bulkConfirmThreshold === NEVER_CONFIRM_THRESHOLD
        ? "Unduhan massal tanpa konfirmasi."
        : `Konfirmasi jika lebih dari ${patch.bulkConfirmThreshold} file.`,
  },

  // Comparer defaults — the panel is seeded from these on open.
  comparerControl("comparer-tolerance", (defaults) => {
    // An empty box for the default 0: the panel treats it as "optional value".
    if (comparerToleranceInput) {
      comparerToleranceInput.value = defaults.tolerance > 0 ? String(defaults.tolerance) : "";
    }
  }),
  comparerControl("comparer-daily-dates", (defaults) => {
    if (comparerDailyDatesInput) comparerDailyDatesInput.value = defaults.dailyDates;
  }),
  ...statusCheckboxes.map(({ status, input }) =>
    comparerControl(`comparer-status-${status}`, (defaults) => {
      setChecked(input, defaults.statusFilter.includes(status));
    }),
  ),

  // Checker defaults — same shape, one stored value.
  checkerControl("checker-benchmark", (defaults) => {
    if (checkerBenchmarkSelect) checkerBenchmarkSelect.value = defaults.benchmark;
  }),
  checkerControl("checker-tolerance", (defaults) => {
    // Same rule as the comparer's box: an empty field means "no tolerance".
    if (checkerToleranceInput) {
      checkerToleranceInput.value = defaults.tolerance > 0 ? String(defaults.tolerance) : "";
    }
  }),
  ...checkerStatusCheckboxes.map(({ status, input }) =>
    checkerControl(`checker-status-${status}`, (defaults) => {
      setChecked(input, defaults.statusFilter.includes(status));
    }),
  ),

  // Completion notifications. `notifications` is an OPTIONAL permission,
  // requested on the user's click rather than declared up front: declaring it
  // would make every existing install re-consent to a permission the extension
  // does not need until the user asks for notifications.
  {
    id: "notify-on-complete",
    paint: (preferences) => setChecked(notifyInput, preferences.notifyOnComplete),
    patch: () => ({ notifyOnComplete: notifyInput?.checked ?? false }),
    beforeWrite: async (patch) => !patch.notifyOnComplete || ensureNotificationPermission(),
    // No permission, no switch: leaving it on would promise a notification the
    // extension cannot deliver.
    revert: () => setChecked(notifyInput, false),
    refused: () => "Izin notifikasi ditolak browser.",
    status: (patch) =>
      patch.notifyOnComplete ? "Notifikasi selesai aktif." : "Notifikasi selesai nonaktif.",
  },
];

/**
 * Paint every preference control from storage, and seed the snapshot the other
 * readers use. Falls back to the documented defaults when storage is
 * unavailable, so the popup always renders a definite state.
 */
async function loadPreferences(): Promise<void> {
  paintPreferenceControls(PREFERENCE_CONTROLS, await readPreferences());
}

/** Re-read and repaint everything, used after a reset. */
async function refreshPreferences(): Promise<void> {
  await loadPreferences();
  await loadMode();
}

bindPreferenceControls(PREFERENCE_CONTROLS, {
  write: writePreferences,
  say: setTransientStatus,
});

// ── Debug logging switch ──────────────────────────────
// Stores the flag in extension storage, the one place every extension context
// can read it: the content script applies it on startup and again live on
// storage changes, so an open portal tab needs no reload; the background
// applies it on its next startup. Applying it here as well keeps the popup's
// own logs in step with the switch. The MAIN-world scraper cannot read
// extension storage, so the content script copies the flag into the page's
// storage for it — which means the scraper's own logs follow this switch from
// the next page load on, not instantly (it resolves the flag when it loads).
//
// Not a row above: the debug flag has its own lifecycle (its own key, not in
// the managed set, never cleared by a reset) and it applies to this context.

async function loadDebugSwitch(): Promise<void> {
  if (debugInput) debugInput.checked = (await readDebugPreference()) === true;
  await initDebugFromExtensionStorage();
}

debugInput?.addEventListener("change", () => {
  const enabled = debugInput.checked;
  void writeDebugPreference(enabled).then(() => {
    applyDebugPreference(enabled);
  });
});

// ── Completion notifications: the permission ──────────

async function ensureNotificationPermission(): Promise<boolean> {
  const permissions = browserAPI.permissions;
  if (!permissions) return false;
  try {
    // `request` is called with no `await` in front of it on purpose: Firefox
    // only honours a permission request while the click's user gesture is still
    // live, and awaiting `permissions.contains(...)` first can spend that
    // gesture. Requesting an already-granted permission resolves immediately.
    return await permissions.request({ permissions: ["notifications"] });
  } catch (err) {
    debugError("Gagal meminta izin notifikasi", err);
    return false;
  }
}

// ── Maintenance ───────────────────────────────────────

clearCacheButton?.addEventListener("click", () => {
  void requestScraperReset().then(() => {
    setTransientStatus("Permintaan bersihkan cache dikirim ke tab portal.");
  });
});

resetButton?.addEventListener("click", () => {
  void clearPreferences().then(refreshPreferences).then(async () => {
    // The debug switch predates this schema and is not part of the reset, but
    // its control still has to be repainted to match storage.
    await loadDebugSwitch();
    setTransientStatus("Preferensi dikembalikan ke default.");
  });
});

// ── Tab & version status ──────────────────────────────

async function loadPortalStatus(): Promise<void> {
  if (!portalStatus) return;
  let url: string | undefined;
  try {
    const tabs = await browserAPI.tabs.query({ active: true, currentWindow: true });
    // `url` is only exposed for tabs this extension has host permission for, so
    // an undefined url simply means "not the portal" — no `tabs` permission
    // needed, and none is requested.
    url = tabs?.[0]?.url;
  } catch (err) {
    debugError("Gagal membaca tab aktif", err);
  }

  let version = "";
  try {
    version = browserAPI.runtime.getManifest().version;
  } catch {
    version = "";
  }

  const parts = [describePortalPage(url)];
  if (version) parts.push(`v${version}`);
  portalStatus.textContent = parts.join(" · ");
}

void loadMode();
void loadPreferences();
void loadDebugSwitch();
void loadPortalStatus();

/** The preferences this popup manages, for the reset path's own checks. */
export type ManagedPreferences = ExtensionPreferences;
