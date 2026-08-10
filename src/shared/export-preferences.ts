export const EXPORT_MODE_STORAGE_KEY = "cindiehExportMode";

export type StoredExportMode = "cleaned" | "raw";

export function normalizeExportMode(value: unknown): StoredExportMode {
  return value === "raw" ? "raw" : "cleaned";
}
