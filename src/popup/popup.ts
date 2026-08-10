import { browserAPI } from "../content/browser-shim";
import { EXPORT_MODE_STORAGE_KEY, normalizeExportMode, type StoredExportMode } from "../shared/export-preferences";

const cleanedInput = document.getElementById("mode-cleaned") as HTMLInputElement | null;
const rawInput = document.getElementById("mode-raw") as HTMLInputElement | null;
const statusText = document.getElementById("status-text");

function setChecked(mode: StoredExportMode): void {
  if (cleanedInput) cleanedInput.checked = mode === "cleaned";
  if (rawInput) rawInput.checked = mode === "raw";
  if (statusText) {
    statusText.textContent = mode === "raw" ? "Format asli aktif" : "Format dirapikan aktif";
  }
}

async function loadMode(): Promise<void> {
  const result = await browserAPI.storage.local.get(EXPORT_MODE_STORAGE_KEY);
  setChecked(normalizeExportMode(result[EXPORT_MODE_STORAGE_KEY]));
}

async function saveMode(mode: StoredExportMode): Promise<void> {
  setChecked(mode);
  await browserAPI.storage.local.set({ [EXPORT_MODE_STORAGE_KEY]: mode });
}

cleanedInput?.addEventListener("change", () => {
  if (cleanedInput.checked) void saveMode("cleaned");
});

rawInput?.addEventListener("change", () => {
  if (rawInput.checked) void saveMode("raw");
});

void loadMode();
