// ============================================================
// EXTENSION-PREFERENCES.TS — Shared preference schema
// ============================================================
// Pure module: no browser API, no DOM. It owns the storage KEYS the popup
// writes and each context reads, plus one normalizer per value. Every reader
// runs its value through a normalizer, so a hand-edited key (DevTools), a
// value written by an older build, or a failed read that yields `undefined`
// can never reach behaviour as an unvalidated shape.
//
// Both JavaScript worlds may import this file: the content script (isolated
// world) reads extension storage through content/preferences.ts, while the
// MAIN-world scraper can only see page storage — see content/page-pacing.ts.

// ── Export format ─────────────────────────────────────

export type StoredExportFormat = "xlsx" | "csv";

export const EXPORT_FORMAT_STORAGE_KEY = "cindiehExportFormat";
export const DEFAULT_EXPORT_FORMAT: StoredExportFormat = "xlsx";

/** Both formats the export menu offers, in menu order. */
export const EXPORT_FORMATS: readonly StoredExportFormat[] = ["xlsx", "csv"];

export function normalizeExportFormat(value: unknown): StoredExportFormat {
  return value === "csv" ? "csv" : DEFAULT_EXPORT_FORMAT;
}

// ── One-click export ──────────────────────────────────
// Opt-in: when on, a plain click on the toolbar's export button downloads the
// stored DEFAULT format instead of opening the menu, and the chevron splits off
// into its own caret button so the other format stays reachable. Off by default
// — the single compact button stays the norm, because two hit targets take
// toolbar room beside the portal's own buttons (see AGENTS.md).

export const ONE_CLICK_EXPORT_STORAGE_KEY = "cindiehOneClickExport";
export const DEFAULT_ONE_CLICK_EXPORT = false;

export function normalizeOneClickExport(value: unknown): boolean {
  // Only an explicit truthy spelling enables it: an unwritten key, a refused
  // read, or a hand-edited value must leave the compact default button alone.
  return value === true || value === "true" || value === "1";
}

// ── Master switch ─────────────────────────────────────

export const ENABLED_STORAGE_KEY = "cindiehEnabled";
export const DEFAULT_ENABLED = true;

export function normalizeEnabled(value: unknown): boolean {
  // Only an explicit `false`/`"false"`/`"0"` disables the extension: an
  // unwritten key must leave it on, and so must a corrupt value.
  if (value === false || value === "false" || value === "0") return false;
  if (value === true || value === "true" || value === "1") return true;
  return DEFAULT_ENABLED;
}

// ── Rate-limit pacing ─────────────────────────────────
// Coretax pacing may only be made GENTLER from the UI. RATE_LIMITING.md fixes
// the floor (never below the code's own inter-request delay, never above the
// portal's page-size cap), so the only knob is a multiplier >= 1 and `step`
// is never touched.

export const DELAY_PRESETS = ["normal", "hati-hati", "sabar"] as const;
export type DelayPreset = (typeof DELAY_PRESETS)[number];

export const DELAY_PRESET_STORAGE_KEY = "cindiehDelayPreset";
export const DEFAULT_DELAY_PRESET: DelayPreset = "normal";

/** Inter-request delay multiplier per preset. Always >= 1 — slower, never faster. */
export const DELAY_PRESET_MULTIPLIER: Record<DelayPreset, number> = {
  normal: 1,
  "hati-hati": 2,
  sabar: 4,
};

export function normalizeDelayPreset(value: unknown): DelayPreset {
  return DELAY_PRESETS.includes(value as DelayPreset)
    ? (value as DelayPreset)
    : DEFAULT_DELAY_PRESET;
}

/** Scale a base inter-request delay by the active preset. */
export function scaleDelay(baseMs: number, preset: DelayPreset): number {
  const multiplier = DELAY_PRESET_MULTIPLIER[normalizeDelayPreset(preset)];
  return Math.round(baseMs * multiplier);
}

// ── Bulk download confirmation ────────────────────────
// One number instead of a boolean pair: the threshold doubles as the on/off
// switch, because 0 means "never confirm". That keeps a single value in
// storage and a single decision in the action layer.

export const BULK_CONFIRM_STORAGE_KEY = "cindiehBulkConfirm";
export const DEFAULT_BULK_CONFIRM_THRESHOLD = 10;
export const NEVER_CONFIRM_THRESHOLD = 0;
export const MAX_BULK_CONFIRM_THRESHOLD = 1000;

export function normalizeBulkConfirmThreshold(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    return DEFAULT_BULK_CONFIRM_THRESHOLD;
  }
  const rounded = Math.floor(parsed);
  if (rounded < NEVER_CONFIRM_THRESHOLD) return NEVER_CONFIRM_THRESHOLD;
  if (rounded > MAX_BULK_CONFIRM_THRESHOLD) return MAX_BULK_CONFIRM_THRESHOLD;
  return rounded;
}

/**
 * True when a download of `count` files must be confirmed first.
 * `threshold` is `unknown` on purpose: it is handed the raw stored value, and
 * normalizing it here is what keeps a corrupt value from disabling the guard.
 */
export function shouldConfirmBulkDownload(count: number, threshold: unknown): boolean {
  const limit = normalizeBulkConfirmThreshold(threshold);
  if (limit === NEVER_CONFIRM_THRESHOLD) return false;
  return count > limit;
}

// ── Comparer defaults ─────────────────────────────────
// The tolerance, the daily date list, and the status filter are entered in
// the in-page panel on every visit. These defaults seed that panel on open.

export const COMPARISON_STATUSES = [
  "COCOK",
  "DPP_BERBEDA",
  "PPN_BERBEDA",
  "BERBEDA",
  "TIDAK_DITEMUKAN",
  "HANYA_CORETAX",
] as const;

export type StoredComparisonStatus = (typeof COMPARISON_STATUSES)[number];

export interface ComparerDefaults {
  /** Allowed absolute DPP/PPN difference before a row counts as mismatched. */
  tolerance: number;
  /** Raw day-of-month list (1-31), kept as typed so the panel can show it back. */
  dailyDates: string;
  /** Empty array means "all statuses" — mirrors ComparerSession.statusFilter. */
  statusFilter: StoredComparisonStatus[];
}

export const COMPARER_DEFAULTS_STORAGE_KEY = "cindiehComparerDefaults";

export const DEFAULT_COMPARER_DEFAULTS: ComparerDefaults = {
  tolerance: 0,
  dailyDates: "",
  statusFilter: [],
};

export const MAX_COMPARER_TOLERANCE = 1_000_000_000_000;

function normalizeTolerance(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(Math.floor(parsed), MAX_COMPARER_TOLERANCE);
}

function normalizeDailyDates(value: unknown): string {
  if (typeof value !== "string") return "";
  // Keep only characters the panel's own parser accepts, so a stored value
  // cannot smuggle something the parser would reject as invalid input.
  return value.replace(/[^\d,;\s]/g, "").slice(0, 200);
}

function normalizeStatusFilter(value: unknown): StoredComparisonStatus[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<StoredComparisonStatus>();
  for (const entry of value) {
    if (COMPARISON_STATUSES.includes(entry as StoredComparisonStatus)) {
      seen.add(entry as StoredComparisonStatus);
    }
  }
  // Storage order is insertion order, not the canonical order — re-emit in the
  // canonical order so the panel's checkboxes and the session agree.
  return COMPARISON_STATUSES.filter((status) => seen.has(status));
}

export function normalizeComparerDefaults(value: unknown): ComparerDefaults {
  if (typeof value !== "object" || value === null) return { ...DEFAULT_COMPARER_DEFAULTS };
  const raw = value as Record<string, unknown>;
  return {
    tolerance: normalizeTolerance(raw.tolerance),
    dailyDates: normalizeDailyDates(raw.dailyDates),
    statusFilter: normalizeStatusFilter(raw.statusFilter),
  };
}

// ── Filename prefix ───────────────────────────────────
// Prepended to every generated export filename so a practitioner can group
// files by client or entity without renaming them afterwards.

export const FILENAME_PREFIX_STORAGE_KEY = "cindiehFilenamePrefix";
export const DEFAULT_FILENAME_PREFIX = "";
export const MAX_FILENAME_PREFIX_LENGTH = 24;

/** Strip anything that would be unsafe or illegal inside a download filename. */
export function normalizeFilenamePrefix(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_FILENAME_PREFIX;
  // Trim BEFORE collapsing inner runs, so padding whitespace cannot become a
  // leading/trailing dash. Trailing dashes are kept: `PTABC-` is the shape a
  // user typing a prefix actually wants.
  const cleaned = value
    .replace(/[\u0000-\u001f/\\:*?"<>|]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  return cleaned.slice(0, MAX_FILENAME_PREFIX_LENGTH);
}

// ── Completion notifications ──────────────────────────

export const NOTIFY_ON_COMPLETE_STORAGE_KEY = "cindiehNotifyOnComplete";
export const DEFAULT_NOTIFY_ON_COMPLETE = false;

export function normalizeNotifyOnComplete(value: unknown): boolean {
  return value === true || value === "true" || value === "1";
}

// ── Registry ──────────────────────────────────────────

/**
 * Every preference key, in the order the popup renders them. `clearPreferences`
 * removes exactly these — never the debug flag, which has its own lifecycle.
 */
export const PREFERENCE_STORAGE_KEYS = [
  ENABLED_STORAGE_KEY,
  EXPORT_FORMAT_STORAGE_KEY,
  ONE_CLICK_EXPORT_STORAGE_KEY,
  DELAY_PRESET_STORAGE_KEY,
  BULK_CONFIRM_STORAGE_KEY,
  COMPARER_DEFAULTS_STORAGE_KEY,
  FILENAME_PREFIX_STORAGE_KEY,
  NOTIFY_ON_COMPLETE_STORAGE_KEY,
] as const;
