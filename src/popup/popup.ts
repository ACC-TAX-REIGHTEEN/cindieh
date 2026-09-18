import { browserAPI } from "../content/browser-shim";
import {
  initDebugFromExtensionStorage,
  readDebugPreference,
  writeDebugPreference,
} from "../content/debug-preference";
import { applyDebugPreference, debugError } from "../content/debug";
import { EXPORT_MODE_STORAGE_KEY, normalizeExportMode, type StoredExportMode } from "../shared/export-preferences";

const cleanedInput = document.getElementById("mode-cleaned") as HTMLInputElement | null;
const rawInput = document.getElementById("mode-raw") as HTMLInputElement | null;
const debugInput = document.getElementById("debug-logs") as HTMLInputElement | null;
const statusText = document.getElementById("status-text");

function setChecked(mode: StoredExportMode): void {
  if (cleanedInput) cleanedInput.checked = mode === "cleaned";
  if (rawInput) rawInput.checked = mode === "raw";
  if (statusText) {
    statusText.textContent = mode === "raw" ? "Format asli aktif" : "Format dirapikan aktif";
  }
}

async function loadMode(): Promise<void> {
  try {
    const result = await browserAPI.storage.local.get(EXPORT_MODE_STORAGE_KEY);
    setChecked(normalizeExportMode(result[EXPORT_MODE_STORAGE_KEY]));
  } catch (err) {
    // A failed read must not leave the popup with no radio selected (and an
    // unhandled rejection in the console). Same guard the content script's
    // loadExportModePreference() applies.
    debugError("Gagal membaca preferensi format export", err);
    setChecked("cleaned");
  }
}

async function saveMode(mode: StoredExportMode): Promise<void> {
  setChecked(mode);
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

// ── Debug logging switch ─────────────────────────────────
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

void loadMode();
void loadDebugSwitch();
