import { browserAPI } from "../content/browser-shim";
import {
  initDebugFromExtensionStorage,
  readDebugPreference,
  writeDebugPreference,
} from "../content/debug-preference";
import { applyDebugPreference, debugError } from "../content/debug";
import { clearPreferences, readPreferences, requestScraperReset, writePreferences } from "../content/preferences";
import { describePortalPage } from "../content/page-context";
import { EXPORT_MODE_STORAGE_KEY, normalizeExportMode, type StoredExportMode } from "../shared/export-preferences";
import {
  COMPARISON_STATUSES,
  DELAY_PRESET_MULTIPLIER,
  NEVER_CONFIRM_THRESHOLD,
  normalizeBulkConfirmThreshold,
  normalizeComparerDefaults,
  normalizeFilenamePrefix,
  type StoredComparisonStatus,
} from "../shared/extension-preferences";

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

// ── Extension preferences ─────────────────────────────

/**
 * Paint every preference control from storage, and seed the snapshot the other
 * readers use. Falls back to the documented defaults when storage is
 * unavailable, so the popup always renders a definite state.
 */
async function loadPreferences(): Promise<void> {
  const prefs = await readPreferences();

  setChecked(enabledInput, prefs.enabled);

  setChecked(xlsxFormatInput, prefs.exportFormat === "xlsx");
  setChecked(csvFormatInput, prefs.exportFormat === "csv");
  setChecked(oneClickExportInput, prefs.oneClickExport);

  if (filenamePrefixInput) filenamePrefixInput.value = prefs.filenamePrefix;
  if (delayPresetSelect) delayPresetSelect.value = prefs.delayPreset;
  if (bulkConfirmInput) bulkConfirmInput.value = String(prefs.bulkConfirmThreshold);

  const comparer = normalizeComparerDefaults(prefs.comparerDefaults);
  if (comparerToleranceInput) {
    // An empty box for the default 0: the panel treats it as "optional value".
    comparerToleranceInput.value = comparer.tolerance > 0 ? String(comparer.tolerance) : "";
  }
  if (comparerDailyDatesInput) comparerDailyDatesInput.value = comparer.dailyDates;
  for (const { status, input } of statusCheckboxes) {
    setChecked(input, comparer.statusFilter.includes(status));
  }

  setChecked(notifyInput, prefs.notifyOnComplete);
}

/** Re-read and repaint everything, used after a reset. */
async function refreshPreferences(): Promise<void> {
  await loadPreferences();
  await loadMode();
}

/** Read the current comparer controls back into the stored defaults shape. */
function currentComparerDefaults() {
  const tolerance = normalizeComparerDefaults({
    tolerance: comparerToleranceInput?.value,
    dailyDates: comparerDailyDatesInput?.value,
    statusFilter: readCheckedStatuses(),
  });
  return tolerance;
}

// ── Export format default ─────────────────────────────
// Marks which format the portal's export menu starts from, and — with one-click
// export on — which format that click downloads.

xlsxFormatInput?.addEventListener("change", () => {
  if (!xlsxFormatInput.checked) return;
  setChecked(csvFormatInput, false);
  void writePreferences({ exportFormat: "xlsx" });
});

csvFormatInput?.addEventListener("change", () => {
  if (!csvFormatInput.checked) return;
  setChecked(xlsxFormatInput, false);
  void writePreferences({ exportFormat: "csv" });
});

// ── One-click export ──────────────────────────────────
// Opt-in: the portal button exports instead of opening the menu, and the
// chevron splits off into its own caret. Off by default because two hit targets
// take toolbar room.

oneClickExportInput?.addEventListener("change", () => {
  const enabled = oneClickExportInput.checked;
  void writePreferences({ oneClickExport: enabled }).then(() => {
    setTransientStatus(
      enabled
        ? "Ekspor sekali klik aktif; tombol panah membuka pilihan format."
        : "Tombol ekspor kembali membuka menu.",
    );
  });
});

// ── Master switch ─────────────────────────────────────

enabledInput?.addEventListener("change", () => {
  const enabled = enabledInput.checked;
  void writePreferences({ enabled }).then(() => {
    setTransientStatus(
      enabled ? "Cindieh aktif di tab portal." : "Cindieh dimatikan; UI di portal dibersihkan.",
    );
  });
});

// ── Filename prefix ───────────────────────────────────

filenamePrefixInput?.addEventListener("input", () => {
  // On `input`, not `change`: a user who types a prefix and closes the popup
  // without blurring the field would otherwise lose it.
  void writePreferences({ filenamePrefix: normalizeFilenamePrefix(filenamePrefixInput.value) });
});

// ── Pacing ────────────────────────────────────────────

delayPresetSelect?.addEventListener("change", () => {
  const preset = delayPresetSelect.value === "hati-hati" || delayPresetSelect.value === "sabar"
    ? delayPresetSelect.value
    : "normal";
  void writePreferences({ delayPreset: preset });
  const multiplier = DELAY_PRESET_MULTIPLIER[preset];
  setTransientStatus(
    multiplier === 1
      ? "Jeda normal."
      : `Jeda ${multiplier}\u00d7 lebih lambat; berlaku di tab portal tanpa reload.`,
  );
});

// ── Bulk download confirmation ────────────────────────

bulkConfirmInput?.addEventListener("change", () => {
  const threshold = normalizeBulkConfirmThreshold(bulkConfirmInput.value);
  // Write the normalized value back so the box shows what is actually stored.
  bulkConfirmInput.value = String(threshold);
  void writePreferences({ bulkConfirmThreshold: threshold });
  setTransientStatus(
    threshold === NEVER_CONFIRM_THRESHOLD
      ? "Unduhan massal tanpa konfirmasi."
      : `Konfirmasi jika lebih dari ${threshold} file.`,
  );
});

// ── Comparer defaults ─────────────────────────────────
// Each control writes the whole defaults object: they are one stored value, and
// a partial write would have to re-read the other two.

function saveComparerDefaults(): void {
  void writePreferences({ comparerDefaults: currentComparerDefaults() });
}

comparerToleranceInput?.addEventListener("change", saveComparerDefaults);
comparerDailyDatesInput?.addEventListener("change", saveComparerDefaults);
for (const { input } of statusCheckboxes) {
  input?.addEventListener("change", saveComparerDefaults);
}

// ── Debug logging switch ──────────────────────────────
// Stores the flag in extension storage, the one place every extension context
// can read it: the content script applies it on startup and again live on
// storage changes, so an open portal tab needs no reload; the background
// applies it on its next startup. Applying it here as well keeps the popup's
// own logs in step with the switch. The MAIN-world scraper cannot read
// extension storage, so the content script copies the flag into the page's
// storage for it — which means the scraper's own logs follow this switch from
// the next page load on, not instantly (it resolves the flag when it loads).

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

// ── Completion notifications ──────────────────────────
// `notifications` is an OPTIONAL permission, requested from here on the user's
// click rather than declared up front: declaring it would make every existing
// install re-consent to a permission the extension does not need until the user
// asks for notifications. A refused request rolls the switch back.

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

notifyInput?.addEventListener("change", () => {
  const wanted = notifyInput.checked;
  void (async () => {
    if (wanted && !(await ensureNotificationPermission())) {
      // No permission, no switch: leaving it on would promise a notification
      // the extension cannot deliver.
      setChecked(notifyInput, false);
      setTransientStatus("Izin notifikasi ditolak browser.");
      return;
    }
    await writePreferences({ notifyOnComplete: wanted });
    setTransientStatus(wanted ? "Notifikasi selesai aktif." : "Notifikasi selesai nonaktif.");
  })();
});

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
